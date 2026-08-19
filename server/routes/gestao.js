const express = require('express');
const router = express.Router();
const db = require('../db/db');
const { exigirPapel } = require('../middleware/auth');
const { receberImagemProduto, removerArquivoLocal, URL_BASE } = require('../middleware/upload');
const { montarProduto } = require('./produtos');

router.use(exigirPapel('admin', 'superadmin'));

function ehSuperadmin(req) {
  return req.session.usuario.papel === 'superadmin';
}

// ---------- Categorias ----------
// A vitrine, o filtro do painel e o catalogo em PDF leem daqui. O slug e' o que
// vai para a URL da loja (/catalogo.html?categoria=botas), entao e' sempre
// normalizado no servidor — a tela pode mandar o nome cru que sai certo.
function gerarSlug(texto) {
  return String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // tira acentos
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Nome e slug sao UNIQUE no schema: sem esta conferencia o erro chegaria na tela
// como falha 500 do SQLite, sem dizer o que estava repetido.
async function conflitoCategoria(nome, slug, idIgnorado) {
  const outra = await db.prepare(`SELECT nome, slug FROM categorias
    WHERE (nome = ? COLLATE NOCASE OR slug = ?) AND id IS NOT ?`).get(nome, slug, idIgnorado);
  if (!outra) return null;
  return outra.slug === slug
    ? `Já existe uma categoria com o endereço "${slug}" (${outra.nome}).`
    : `Já existe uma categoria chamada "${outra.nome}".`;
}

async function categoriasComTotais() {
  return db.prepare(`
    SELECT c.*,
           (SELECT COUNT(*) FROM produtos p WHERE p.categoria_id = c.id) AS total_produtos,
           (SELECT COUNT(*) FROM produtos p WHERE p.categoria_id = c.id AND p.ativo = 1) AS total_ativos
    FROM categorias c ORDER BY c.ordem ASC, c.nome ASC
  `).all();
}

router.get('/categorias', async (req, res) => {
  res.json(await categoriasComTotais());
});

router.post('/categorias', async (req, res) => {
  const { nome, slug, descricao, ordem } = req.body || {};
  const nomeLimpo = String(nome || '').trim();
  if (!nomeLimpo) return res.status(400).json({ erro: 'Informe o nome da categoria.' });

  const slugLimpo = gerarSlug(slug || nomeLimpo);
  if (!slugLimpo) return res.status(400).json({ erro: 'O nome precisa ter ao menos uma letra ou número.' });

  const conflito = await conflitoCategoria(nomeLimpo, slugLimpo, null);
  if (conflito) return res.status(400).json({ erro: conflito });

  // Sem ordem informada a categoria nova entra no fim da lista.
  const ordemInformada = parseInt(ordem, 10);
  const ordemFinal = Number.isInteger(ordemInformada)
    ? ordemInformada
    : (await db.prepare('SELECT COALESCE(MAX(ordem), 0) + 1 AS proxima FROM categorias').get()).proxima;

  const info = await db.prepare('INSERT INTO categorias (nome, slug, descricao, ordem) VALUES (?, ?, ?, ?)')
    .run(nomeLimpo, slugLimpo, descricao ? String(descricao).trim() : null, ordemFinal);
  res.status(201).json({ id: info.lastInsertRowid, slug: slugLimpo });
});

router.put('/categorias/:id', async (req, res) => {
  const categoria = await db.prepare('SELECT * FROM categorias WHERE id = ?').get(req.params.id);
  if (!categoria) return res.status(404).json({ erro: 'Categoria não encontrada.' });

  const { nome, slug, descricao, ordem } = req.body || {};
  const nomeLimpo = nome !== undefined ? String(nome).trim() : categoria.nome;
  if (!nomeLimpo) return res.status(400).json({ erro: 'Informe o nome da categoria.' });

  // Slug em branco na tela = "gere de novo a partir do nome".
  const slugLimpo = slug !== undefined && String(slug).trim()
    ? gerarSlug(slug)
    : (nome !== undefined ? gerarSlug(nomeLimpo) : categoria.slug);
  if (!slugLimpo) return res.status(400).json({ erro: 'O nome precisa ter ao menos uma letra ou número.' });

  const conflito = await conflitoCategoria(nomeLimpo, slugLimpo, categoria.id);
  if (conflito) return res.status(400).json({ erro: conflito });

  const ordemInformada = parseInt(ordem, 10);
  await db.prepare('UPDATE categorias SET nome = ?, slug = ?, descricao = ?, ordem = ? WHERE id = ?').run(
    nomeLimpo,
    slugLimpo,
    descricao !== undefined ? (String(descricao).trim() || null) : categoria.descricao,
    Number.isInteger(ordemInformada) ? ordemInformada : categoria.ordem,
    categoria.id
  );
  res.json({ ok: true, slug: slugLimpo });
});

// DELETE /categorias/:id?mover_para=<id>
// produtos.categoria_id e' NOT NULL: nao existe produto sem categoria. Por isso
// a exclusao de uma categoria com produtos so acontece junto com o destino para
// onde eles vao — a tela pergunta antes, e a resposta 409 diz quantos sao.
router.delete('/categorias/:id', async (req, res) => {
  const categoria = await db.prepare('SELECT * FROM categorias WHERE id = ?').get(req.params.id);
  if (!categoria) return res.status(404).json({ erro: 'Categoria não encontrada.' });

  const total = (await db.prepare('SELECT COUNT(*) AS total FROM produtos WHERE categoria_id = ?').get(categoria.id)).total;
  if (!total) {
    await db.prepare('DELETE FROM categorias WHERE id = ?').run(categoria.id);
    return res.json({ ok: true, movidos: 0 });
  }

  const destinoId = parseInt(req.query.mover_para, 10);
  if (!Number.isInteger(destinoId)) {
    return res.status(409).json({
      erro: `"${categoria.nome}" tem ${total} produto(s). Escolha para qual categoria eles vão antes de excluir.`,
      total_produtos: total
    });
  }
  if (destinoId === categoria.id) {
    return res.status(400).json({ erro: 'Escolha uma categoria diferente para receber os produtos.' });
  }
  const destino = await db.prepare('SELECT id, nome FROM categorias WHERE id = ?').get(destinoId);
  if (!destino) return res.status(400).json({ erro: 'A categoria de destino não existe mais.' });

  const excluir = db.transaction(async (tx) => {
    await tx.prepare(`UPDATE produtos SET categoria_id = ?, atualizado_em = datetime('now') WHERE categoria_id = ?`)
      .run(destino.id, categoria.id);
    await tx.prepare('DELETE FROM categorias WHERE id = ?').run(categoria.id);
  });
  await excluir();

  res.json({ ok: true, movidos: total, destino: destino.nome });
});

// ---------- Produtos ----------
router.get('/produtos', async (req, res) => {
  const rows = await db.prepare(`
    SELECT p.*, c.nome AS categoria_nome, c.slug AS categoria_slug
    FROM produtos p JOIN categorias c ON c.id = p.categoria_id
    ORDER BY p.nome ASC
  `).all();
  res.json(await Promise.all(rows.map(r => montarProduto(r, { incluirCusto: ehSuperadmin(req) }))));
});

router.get('/produtos/:id', async (req, res) => {
  const row = await db.prepare(`
    SELECT p.*, c.nome AS categoria_nome, c.slug AS categoria_slug
    FROM produtos p JOIN categorias c ON c.id = p.categoria_id WHERE p.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ erro: 'Produto não encontrado.' });
  res.json(await montarProduto(row, { incluirCusto: ehSuperadmin(req) }));
});

// POST /produtos/publico-automatico
// Reaplica em todos os produtos a mesma regra do formulario (descricao, depois
// nome, depois categoria). A classificacao da migracao roda uma vez so, na
// criacao da coluna; este botao existe para rodar de novo depois que as
// descricoes forem revisadas.
router.post('/produtos/publico-automatico', async (req, res) => {
  const { reclassificarPublico } = require('../db/migrate');
  const resumo = await reclassificarPublico(db);
  res.json({ ok: true, ...resumo });
});

// Recorte do produto no catalogo. Valor fora da lista vira 'unissex' — nunca
// deixa a coluna com um estado que o filtro de exportacao nao saiba ler.
const PUBLICOS = ['masculino', 'feminino', 'unissex'];
function publicoValido(valor) {
  return PUBLICOS.includes(String(valor || '').toLowerCase()) ? String(valor).toLowerCase() : 'unissex';
}

router.post('/produtos', async (req, res) => {
  const { categoria_id, codigo, nome, descricao, tipo_estoque, imagem_url, tamanhos, cores, destaque, publico, linhas_ids } = req.body || {};
  if (!categoria_id || !nome) return res.status(400).json({ erro: 'Categoria e nome são obrigatórios.' });

  const info = await db.prepare(`INSERT INTO produtos
    (categoria_id, codigo, nome, descricao, custo, custo_fonte, percentual_markup, preco_venda, tipo_estoque, publico, imagem_url, destaque, ativo)
    VALUES (?, ?, ?, ?, 0, 'estimado', 0, 0, ?, ?, ?, ?, 1)`)
    .run(categoria_id, codigo || null, nome, descricao || null,
      tipo_estoque === 'sob_encomenda' ? 'sob_encomenda' : 'estoque',
      publicoValido(publico), imagem_url || null, destaque ? 1 : 0);
  const produtoId = info.lastInsertRowid;

  const insTamanho = db.prepare('INSERT INTO produto_tamanhos (produto_id, tamanho) VALUES (?, ?)');
  for (const t of (tamanhos || [])) await insTamanho.run(produtoId, t);
  const insCor = db.prepare('INSERT INTO produto_cores (produto_id, cor_nome, cor_hex) VALUES (?, ?, ?)');
  for (const c of (cores || [])) await insCor.run(produtoId, c.cor_nome || c.nome, c.cor_hex || c.hex || '#333333');
  const insLinha = db.prepare('INSERT INTO produto_linhas (produto_id, linha_id) VALUES (?, ?)');
  const linhasLimpa = (Array.isArray(linhas_ids) ? linhas_ids : []).map(n => parseInt(n, 10)).filter(Number.isInteger);
  for (const linhaId of linhasLimpa) await insLinha.run(produtoId, linhaId);

  res.status(201).json({ id: produtoId, aviso: !ehSuperadmin(req) ? 'Produto criado sem preço de venda. Peça ao superadmin para definir o custo e liberar o preço.' : undefined });
});

router.put('/produtos/:id', async (req, res) => {
  const produto = await db.prepare('SELECT * FROM produtos WHERE id = ?').get(req.params.id);
  if (!produto) return res.status(404).json({ erro: 'Produto não encontrado.' });

  const { categoria_id, codigo, nome, descricao, tipo_estoque, imagem_url, destaque, publico } = req.body || {};
  const novaImagem = imagem_url !== undefined ? (imagem_url || null) : produto.imagem_url;
  await db.prepare(`UPDATE produtos SET categoria_id = ?, codigo = ?, nome = ?, descricao = ?, tipo_estoque = ?, publico = ?, imagem_url = ?, destaque = ?, atualizado_em = datetime('now')
    WHERE id = ?`).run(
      categoria_id || produto.categoria_id,
      codigo !== undefined ? codigo : produto.codigo,
      nome || produto.nome,
      descricao !== undefined ? descricao : produto.descricao,
      tipo_estoque || produto.tipo_estoque,
      publico !== undefined ? publicoValido(publico) : produto.publico,
      novaImagem,
      destaque !== undefined ? (destaque ? 1 : 0) : produto.destaque,
      produto.id
    );
  // Se a foto enviada por upload deixou de ser a do produto, o arquivo sai do disco.
  if (produto.imagem_url && produto.imagem_url !== novaImagem) removerArquivoLocal(produto.imagem_url);
  // admin NUNCA altera custo/preco_venda por aqui, mesmo que envie no corpo da requisição.
  res.json({ ok: true });
});

router.put('/produtos/:id/tamanhos-cores', async (req, res) => {
  const produto = await db.prepare('SELECT id FROM produtos WHERE id = ?').get(req.params.id);
  if (!produto) return res.status(404).json({ erro: 'Produto não encontrado.' });
  const { tamanhos, cores } = req.body || {};

  const tx = db.transaction(async (txDb) => {
    if (Array.isArray(tamanhos)) {
      await txDb.prepare('DELETE FROM produto_tamanhos WHERE produto_id = ?').run(produto.id);
      const ins = txDb.prepare('INSERT INTO produto_tamanhos (produto_id, tamanho) VALUES (?, ?)');
      for (const t of tamanhos) await ins.run(produto.id, t);
    }
    if (Array.isArray(cores)) {
      // A lista chega inteira e substitui a anterior. As fotos por cor sao
      // guardadas antes e devolvidas pelo nome da cor: sem isso, salvar a grade
      // de tamanhos apagaria as fotos que o admin ja tinha enviado.
      const fotosPorCor = new Map(
        (await txDb.prepare('SELECT cor_nome, imagem_url FROM produto_cores WHERE produto_id = ? AND imagem_url IS NOT NULL')
          .all(produto.id)).map(c => [c.cor_nome, c.imagem_url])
      );
      const enviadas = new Set(cores.map(c => c.cor_nome || c.nome));

      await txDb.prepare('DELETE FROM produto_cores WHERE produto_id = ?').run(produto.id);
      const ins = txDb.prepare('INSERT INTO produto_cores (produto_id, cor_nome, cor_hex, imagem_url) VALUES (?, ?, ?, ?)');
      for (const c of cores) {
        const nome = c.cor_nome || c.nome;
        // `imagem_url` no corpo tem prioridade (a tela pode ter acabado de trocar);
        // se nao veio, mantem a que ja existia para aquela cor.
        const foto = c.imagem_url !== undefined ? (c.imagem_url || null) : (fotosPorCor.get(nome) || null);
        await ins.run(produto.id, nome, c.cor_hex || c.hex || '#333333', foto);
      }

      // Cor removida da lista: o arquivo dela sai do disco.
      for (const [nome, url] of fotosPorCor) {
        if (!enviadas.has(nome)) removerArquivoLocal(url);
      }
    }
  });
  await tx();
  res.json({ ok: true });
});

// Substitui o conjunto de linhas do produto pelo que veio no corpo (nenhuma,
// uma, várias ou todas as linhas cadastradas).
router.put('/produtos/:id/linhas', async (req, res) => {
  const produto = await db.prepare('SELECT id FROM produtos WHERE id = ?').get(req.params.id);
  if (!produto) return res.status(404).json({ erro: 'Produto não encontrado.' });

  const linhasIds = [...new Set((Array.isArray((req.body || {}).linhas_ids) ? req.body.linhas_ids : [])
    .map(n => parseInt(n, 10)).filter(Number.isInteger))];

  const gravar = db.transaction(async (tx) => {
    await tx.prepare('DELETE FROM produto_linhas WHERE produto_id = ?').run(produto.id);
    const ins = tx.prepare('INSERT INTO produto_linhas (produto_id, linha_id) VALUES (?, ?)');
    for (const linhaId of linhasIds) await ins.run(produto.id, linhaId);
  });
  await gravar();

  res.json({ ok: true, linhas_ids: linhasIds });
});

// ---------- Foto do produto ----------
// A mesma imagem alimenta a vitrine, o carrossel da home, a pagina do produto
// e o catalogo em PDF: todos leem produtos.imagem_url.
router.post('/produtos/:id/imagem', receberImagemProduto, async (req, res) => {
  const produto = await db.prepare('SELECT id, imagem_url FROM produtos WHERE id = ?').get(req.params.id);
  if (!produto) {
    if (req.file) removerArquivoLocal(`${URL_BASE}/${req.file.filename}`);
    return res.status(404).json({ erro: 'Produto não encontrado.' });
  }
  if (!req.file) return res.status(400).json({ erro: 'Nenhuma imagem foi enviada.' });

  const imagemUrl = `${URL_BASE}/${req.file.filename}`;
  await db.prepare(`UPDATE produtos SET imagem_url = ?, atualizado_em = datetime('now') WHERE id = ?`)
    .run(imagemUrl, produto.id);

  // Troca de foto: o arquivo antigo sai do disco para nao acumular lixo.
  if (produto.imagem_url && produto.imagem_url !== imagemUrl) removerArquivoLocal(produto.imagem_url);

  res.status(201).json({ ok: true, imagem_url: imagemUrl });
});

// ---------- Foto de uma cor especifica ----------
// Cada cor pode ter a sua propria foto. A pagina do produto troca a imagem
// principal quando o cliente escolhe a cor; sem foto propria, a cor mostra a
// foto do produto. O :id na URL e' o do produto (o multer usa para nomear o
// arquivo), e :corId identifica a linha em produto_cores.
async function corDoProduto(req) {
  return db.prepare('SELECT * FROM produto_cores WHERE id = ? AND produto_id = ?')
    .get(req.params.corId, req.params.id);
}

router.post('/produtos/:id/cores/:corId/imagem', receberImagemProduto, async (req, res) => {
  const cor = await corDoProduto(req);
  if (!cor) {
    if (req.file) removerArquivoLocal(`${URL_BASE}/${req.file.filename}`);
    return res.status(404).json({ erro: 'Cor não encontrada neste produto.' });
  }
  if (!req.file) return res.status(400).json({ erro: 'Nenhuma imagem foi enviada.' });

  const imagemUrl = `${URL_BASE}/${req.file.filename}`;
  await db.prepare('UPDATE produto_cores SET imagem_url = ? WHERE id = ?').run(imagemUrl, cor.id);
  if (cor.imagem_url && cor.imagem_url !== imagemUrl) removerArquivoLocal(cor.imagem_url);

  res.status(201).json({ ok: true, cor_id: cor.id, imagem_url: imagemUrl });
});

router.delete('/produtos/:id/cores/:corId/imagem', async (req, res) => {
  const cor = await corDoProduto(req);
  if (!cor) return res.status(404).json({ erro: 'Cor não encontrada neste produto.' });

  await db.prepare('UPDATE produto_cores SET imagem_url = NULL WHERE id = ?').run(cor.id);
  removerArquivoLocal(cor.imagem_url);
  res.json({ ok: true, cor_id: cor.id, imagem_url: null });
});

router.delete('/produtos/:id/imagem', async (req, res) => {
  const produto = await db.prepare('SELECT id, imagem_url FROM produtos WHERE id = ?').get(req.params.id);
  if (!produto) return res.status(404).json({ erro: 'Produto não encontrado.' });

  await db.prepare(`UPDATE produtos SET imagem_url = NULL, atualizado_em = datetime('now') WHERE id = ?`).run(produto.id);
  removerArquivoLocal(produto.imagem_url);
  res.json({ ok: true, imagem_url: null });
});

router.put('/produtos/:id/estoque', async (req, res) => {
  const produto = await db.prepare('SELECT id FROM produtos WHERE id = ?').get(req.params.id);
  if (!produto) return res.status(404).json({ erro: 'Produto não encontrado.' });
  const { tamanho, cor, quantidade } = req.body || {};
  const qtd = Math.max(0, parseInt(quantidade, 10) || 0);
  await db.prepare(`INSERT INTO produto_estoque (produto_id, tamanho, cor, quantidade) VALUES (?, ?, ?, ?)
    ON CONFLICT(produto_id, tamanho, cor) DO UPDATE SET quantidade = excluded.quantidade`)
    .run(produto.id, tamanho || null, cor || null, qtd);
  res.json({ ok: true });
});

// Liga/desliga a vitrine em destaque (carrossel da home).
router.put('/produtos/:id/destaque', async (req, res) => {
  const { destaque } = req.body || {};
  await db.prepare(`UPDATE produtos SET destaque = ?, atualizado_em = datetime('now') WHERE id = ?`)
    .run(destaque ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

router.put('/produtos/:id/ativo', async (req, res) => {
  const { ativo } = req.body || {};
  await db.prepare(`UPDATE produtos SET ativo = ?, atualizado_em = datetime('now') WHERE id = ?`).run(ativo ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

router.delete('/produtos/:id', async (req, res) => {
  const produto = await db.prepare('SELECT id, imagem_url FROM produtos WHERE id = ?').get(req.params.id);
  if (!produto) return res.status(404).json({ erro: 'Produto não encontrado.' });

  // Fotos por cor: lidas antes do CASCADE levar as linhas embora.
  const fotosDasCores = (await db.prepare('SELECT imagem_url FROM produto_cores WHERE produto_id = ? AND imagem_url IS NOT NULL')
    .all(produto.id)).map(c => c.imagem_url);

  // Tamanhos, cores e estoque saem por ON DELETE CASCADE. As tabelas abaixo
  // apontam para produtos SEM cascade, entao a exclusao esbarrava na chave
  // estrangeira e voltava erro 500 — bastava o produto ter uma visualizacao
  // registrada, um item em carrinho ou uma linha de historico de preco.
  const excluir = db.transaction(async (tx) => {
    // Pedido ja fechado nao pode sumir: pedido_itens guarda nome, preco e custo
    // do momento da compra, entao basta soltar a referencia ao produto.
    await tx.prepare('UPDATE pedido_itens SET produto_id = NULL WHERE produto_id = ?').run(produto.id);
    for (const tabela of ['historico_precos', 'eventos_analytics', 'interesses', 'encomendas', 'carrinho_itens']) {
      await tx.prepare(`DELETE FROM ${tabela} WHERE produto_id = ?`).run(produto.id);
    }
    await tx.prepare('DELETE FROM produtos WHERE id = ?').run(produto.id);
  });
  await excluir();

  removerArquivoLocal(produto.imagem_url);
  fotosDasCores.forEach(removerArquivoLocal);
  res.json({ ok: true });
});

// ---------- Encomendas / avisos de estoque ----------
router.get('/encomendas', async (req, res) => {
  const rows = await db.prepare(`
    SELECT e.*, p.nome AS produto_nome FROM encomendas e JOIN produtos p ON p.id = e.produto_id
    ORDER BY e.criado_em DESC
  `).all();
  res.json(rows);
});

router.put('/encomendas/:id/status', async (req, res) => {
  const { status } = req.body || {};
  if (!['aguardando', 'avisado', 'atendido', 'cancelado'].includes(status)) {
    return res.status(400).json({ erro: 'Status inválido.' });
  }
  await db.prepare('UPDATE encomendas SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ ok: true });
});

// ---------- Pedidos ----------
// Movido para routes/gestao_pedidos.js (edição de itens, cupom, dados do
// cliente, cancelamento/troca, reconciliação e nota fiscal).

// ---------- Clientes ----------
router.get('/clientes', async (req, res) => {
  const clientes = await db.prepare(`
    SELECT cl.*,
      (SELECT COUNT(*) FROM pedidos p WHERE p.cliente_id = cl.id) AS total_pedidos,
      (SELECT IFNULL(SUM(p.valor_final),0) FROM pedidos p
        WHERE p.cliente_id = cl.id AND p.status IN ('pago','enviado','recebido','finalizado')) AS total_gasto,
      (SELECT MAX(p.criado_em) FROM pedidos p WHERE p.cliente_id = cl.id) AS ultima_compra
    FROM clientes cl
    ORDER BY cl.nome ASC
  `).all();
  res.json(clientes);
});

// ---------- Pesquisa de satisfacao (CSAT) ----------
router.get('/csat', async (req, res) => {
  const respostas = await db.prepare('SELECT * FROM csat ORDER BY criado_em DESC').all();
  const resumo = await db.prepare(`
    SELECT COUNT(*) AS total,
      ROUND(AVG(nota_precos), 2) AS media_precos,
      ROUND(AVG(nota_site), 2) AS media_site,
      ROUND(AVG(nota_geral), 2) AS media_geral,
      SUM(CASE WHEN primeira_compra = 1 THEN 1 ELSE 0 END) AS primeiras_compras,
      SUM(CASE WHEN recomendaria = 1 THEN 1 ELSE 0 END) AS recomendariam
    FROM csat
  `).get();
  res.json({ resumo, respostas });
});

// Cupons: cadastro é exclusivo do superadmin (ver routes/superadmin.js).

module.exports = router;
