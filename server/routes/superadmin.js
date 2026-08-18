const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../db/db');
const { exigirPapel, permissoesDe } = require('../middleware/auth');
const { calcularPrecoVenda } = require('../db/pricing');
const { PERMISSOES, normalizarPermissoes } = require('../permissoes');
const { obterLoja, salvarContato, salvarLogo } = require('../utils/siteConfig');
const { receberImagemSite, URL_BASE_SITE } = require('../middleware/upload');

router.use(exigirPapel('superadmin'));

// ---------- Custo / preco de produtos (exclusivo superadmin) ----------
router.put('/produtos/:id/custo', (req, res) => {
  const produto = db.prepare('SELECT * FROM produtos WHERE id = ?').get(req.params.id);
  if (!produto) return res.status(404).json({ erro: 'Produto não encontrado.' });
  const { custo, custo_fonte } = req.body || {};
  const novoCusto = Math.max(0, parseFloat(custo));
  if (Number.isNaN(novoCusto)) return res.status(400).json({ erro: 'Custo inválido.' });

  const { percentual, preco } = calcularPrecoVenda(novoCusto);
  db.prepare(`UPDATE produtos SET custo = ?, custo_fonte = ?, percentual_markup = ?, preco_venda = ?, preco_manual = 0, atualizado_em = datetime('now') WHERE id = ?`)
    .run(novoCusto, custo_fonte || 'tabela', percentual, preco, produto.id);

  db.prepare(`INSERT INTO historico_precos (produto_id, custo_anterior, custo_novo, preco_anterior, preco_novo, alterado_por)
    VALUES (?, ?, ?, ?, ?, ?)`).run(produto.id, produto.custo, novoCusto, produto.preco_venda, preco, req.session.usuario.email);

  res.json({ ok: true, percentual_markup: percentual, preco_venda: preco });
});

router.put('/produtos/:id/preco', (req, res) => {
  const produto = db.prepare('SELECT * FROM produtos WHERE id = ?').get(req.params.id);
  if (!produto) return res.status(404).json({ erro: 'Produto não encontrado.' });
  const { preco_venda } = req.body || {};
  const novoPreco = Math.max(0, parseFloat(preco_venda));
  if (Number.isNaN(novoPreco)) return res.status(400).json({ erro: 'Preço inválido.' });

  db.prepare(`UPDATE produtos SET preco_venda = ?, preco_manual = 1, atualizado_em = datetime('now') WHERE id = ?`).run(novoPreco, produto.id);
  db.prepare(`INSERT INTO historico_precos (produto_id, custo_anterior, custo_novo, preco_anterior, preco_novo, alterado_por)
    VALUES (?, ?, ?, ?, ?, ?)`).run(produto.id, produto.custo, produto.custo, produto.preco_venda, novoPreco, req.session.usuario.email);

  res.json({ ok: true });
});

// Preco promocional (oferta na vitrine). Enviar 0 ou vazio remove a promocao.
router.put('/produtos/:id/promocao', (req, res) => {
  const produto = db.prepare('SELECT * FROM produtos WHERE id = ?').get(req.params.id);
  if (!produto) return res.status(404).json({ erro: 'Produto não encontrado.' });

  const bruto = req.body ? req.body.preco_promocional : null;
  if (bruto === null || bruto === undefined || bruto === '' || parseFloat(bruto) === 0) {
    db.prepare(`UPDATE produtos SET preco_promocional = NULL, atualizado_em = datetime('now') WHERE id = ?`).run(produto.id);
    return res.json({ ok: true, preco_promocional: null });
  }

  const promocional = parseFloat(bruto);
  if (!Number.isFinite(promocional) || promocional < 0) return res.status(400).json({ erro: 'Preço promocional inválido.' });
  if (promocional >= produto.preco_venda) {
    return res.status(400).json({ erro: 'O preço promocional precisa ser menor que o preço de venda.' });
  }

  db.prepare(`UPDATE produtos SET preco_promocional = ?, atualizado_em = datetime('now') WHERE id = ?`).run(promocional, produto.id);
  res.json({ ok: true, preco_promocional: promocional });
});

// ---------- Reajuste de precos em lote ----------
// Aplica um percentual sobre um conjunto de produtos:
//   escopo 'selecao'   -> so os ids enviados (um ou varios, de qualquer categoria)
//   escopo 'categoria' -> todos os produtos de uma categoria
//   escopo 'todos'     -> a linha inteira da loja
//
// A base do calculo muda o significado do percentual:
//   base 'venda' -> reajuste sobre o preco de venda atual (+10% = 10% mais caro)
//   base 'custo' -> markup sobre o custo (+55% = custo x 1,55), a mesma conta da
//                   regra em db/pricing.js, so que com o percentual escolhido na
//                   hora e valendo para o lote inteiro. Serve tambem para precificar
//                   produto que ainda esta sem preco de venda.
//
// Com `simular: true` nada e' gravado: volta so a previa (antes x depois), que e'
// o que a tela mostra antes de o operador confirmar.
const ARREDONDAMENTOS = {
  centavo: (v) => Math.round(v * 100) / 100,
  // Preco "psicologico" terminando em ,90 (o mais proximo: 249,37 -> 249,90).
  noventa: (v) => Math.max(0.90, Math.round(v - 0.90) + 0.90),
  inteiro: (v) => Math.max(1, Math.round(v))
};

router.post('/produtos/reajuste', (req, res) => {
  const { percentual, escopo, categoria_id, ids, arredondamento, ajustar_promocional, simular } = req.body || {};

  const pct = parseFloat(percentual);
  if (!Number.isFinite(pct) || pct === 0) {
    return res.status(400).json({ erro: 'Informe um percentual diferente de zero (negativo reduz o preço).' });
  }
  if (pct <= -100) return res.status(400).json({ erro: 'A redução não pode chegar a 100%.' });
  if (pct > 300) return res.status(400).json({ erro: 'Reajuste acima de 300% — confira o percentual digitado.' });

  const arredondar = ARREDONDAMENTOS[arredondamento] || ARREDONDAMENTOS.centavo;
  const fator = 1 + pct / 100;
  const base = (req.body || {}).base === 'custo' ? 'custo' : 'venda';

  let filtro = '';
  const params = [];
  if (escopo === 'categoria') {
    const catId = parseInt(categoria_id, 10);
    if (!Number.isInteger(catId)) return res.status(400).json({ erro: 'Escolha a categoria do reajuste.' });
    filtro = 'WHERE p.categoria_id = ?';
    params.push(catId);
  } else if (escopo === 'selecao') {
    const lista = [...new Set((Array.isArray(ids) ? ids : []).map(n => parseInt(n, 10)).filter(Number.isInteger))];
    if (!lista.length) return res.status(400).json({ erro: 'Marque pelo menos um produto na tabela.' });
    filtro = `WHERE p.id IN (${lista.map(() => '?').join(',')})`;
    params.push(...lista);
  } else if (escopo !== 'todos') {
    return res.status(400).json({ erro: 'Escopo inválido. Use "todos", "categoria" ou "selecao".' });
  }

  const produtos = db.prepare(`
    SELECT p.*, c.nome AS categoria_nome
    FROM produtos p JOIN categorias c ON c.id = p.categoria_id
    ${filtro}
    ORDER BY c.ordem ASC, c.nome ASC, p.nome ASC
  `).all(...params);

  const itens = [];
  const ignorados = [];

  for (const p of produtos) {
    const valorBase = base === 'custo' ? p.custo : p.preco_venda;
    if (!(valorBase > 0)) {
      ignorados.push({
        id: p.id,
        nome: p.nome,
        motivo: base === 'custo' ? 'Sem custo cadastrado.' : 'Sem preço de venda definido.'
      });
      continue;
    }

    const precoNovo = Math.max(0.01, arredondar(valorBase * fator));

    // Promocao vigente: so conta enquanto for menor que o preco cheio.
    const promoAtual = p.preco_promocional > 0 && p.preco_promocional < p.preco_venda ? p.preco_promocional : null;
    let promoNova = promoAtual;
    if (promoAtual !== null && ajustar_promocional) {
      // Mantem o mesmo desconto proporcional que a oferta ja tinha sobre o preco
      // cheio — vale para as duas bases (no reajuste sobre a venda a proporcao e'
      // o proprio percentual; no markup sobre o custo, nao seria).
      promoNova = Math.max(0.01, arredondar(promoAtual * (precoNovo / p.preco_venda)));
    }
    // Depois do reajuste a oferta precisa continuar valendo a pena; se encostou
    // no preco cheio ela e' desfeita (senao ficaria um valor morto no banco).
    const promocaoRemovida = promoNova !== null && promoNova >= precoNovo;
    if (promocaoRemovida) promoNova = null;

    if (precoNovo === p.preco_venda && promoNova === promoAtual) {
      ignorados.push({ id: p.id, nome: p.nome, motivo: 'O cálculo devolveu o mesmo preço.' });
      continue;
    }

    itens.push({
      id: p.id,
      nome: p.nome,
      codigo: p.codigo,
      categoria_nome: p.categoria_nome,
      preco_anterior: p.preco_venda,
      preco_novo: precoNovo,
      diferenca: Math.round((precoNovo - p.preco_venda) * 100) / 100,
      promocional_anterior: promoAtual,
      promocional_novo: promoNova,
      promocao_removida: promocaoRemovida,
      custo: p.custo,
      // Alerta da previa: o preco (ou a oferta) fica abaixo do que a peca custa.
      abaixo_do_custo: p.custo > 0 && Math.min(precoNovo, promoNova || precoNovo) < p.custo
    });
  }

  if (!simular && itens.length) {
    const gravar = db.transaction(() => {
      // preco_manual = 1 nas duas bases: o valor passou a vir de um percentual
      // escolhido na hora, e nao da tabela de markup por faixa de custo — um
      // recalculo futuro nao pode atropelar o reajuste.
      // Na base 'custo' o percentual_markup passa a refletir o markup aplicado.
      const atualizar = base === 'custo'
        ? db.prepare(`UPDATE produtos
            SET preco_venda = ?, preco_promocional = ?, percentual_markup = ?, preco_manual = 1, atualizado_em = datetime('now')
            WHERE id = ?`)
        : db.prepare(`UPDATE produtos
            SET preco_venda = ?, preco_promocional = ?, preco_manual = 1, atualizado_em = datetime('now')
            WHERE id = ?`);
      const historiar = db.prepare(`INSERT INTO historico_precos
        (produto_id, custo_anterior, custo_novo, preco_anterior, preco_novo, alterado_por)
        VALUES (?, ?, ?, ?, ?, ?)`);
      const origem = base === 'custo' ? 'sobre o custo' : 'sobre a venda';
      for (const it of itens) {
        if (base === 'custo') atualizar.run(it.preco_novo, it.promocional_novo, pct / 100, it.id);
        else atualizar.run(it.preco_novo, it.promocional_novo, it.id);
        historiar.run(it.id, it.custo, it.custo, it.preco_anterior, it.preco_novo,
          `${req.session.usuario.email} (reajuste ${pct > 0 ? '+' : ''}${pct}% ${origem})`);
      }
    });
    gravar();
  }

  res.json({
    simulado: !!simular,
    percentual: pct,
    base,
    escopo: escopo || 'todos',
    total_analisados: produtos.length,
    total_alterados: itens.length,
    total_ignorados: ignorados.length,
    itens,
    ignorados
  });
});

// ---------- Permissoes finas ----------
// Catalogo das permissoes que podem ser concedidas (para montar a tela).
router.get('/permissoes', (req, res) => res.json(PERMISSOES));

// Substitui o conjunto de permissoes do usuario pelo que veio no corpo.
router.put('/usuarios/:id/permissoes', (req, res) => {
  const usuario = db.prepare('SELECT id, papel FROM usuarios WHERE id = ?').get(req.params.id);
  if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' });
  if (usuario.papel === 'superadmin') {
    return res.status(400).json({ erro: 'O superadmin já tem todas as permissões — não há o que conceder.' });
  }
  if (usuario.papel !== 'admin') {
    return res.status(400).json({ erro: 'Só acessos administrativos recebem permissões.' });
  }
  if (!Array.isArray(req.body && req.body.permissoes)) {
    return res.status(400).json({ erro: 'Envie a lista completa de permissões em "permissoes".' });
  }

  const concedidas = normalizarPermissoes(req.body.permissoes);
  const gravar = db.transaction(() => {
    db.prepare('DELETE FROM usuario_permissoes WHERE usuario_id = ?').run(usuario.id);
    const ins = db.prepare('INSERT INTO usuario_permissoes (usuario_id, permissao, concedido_por) VALUES (?, ?, ?)');
    concedidas.forEach(p => ins.run(usuario.id, p, req.session.usuario.email));
  });
  gravar();

  res.json({ ok: true, permissoes: concedidas });
});

// ---------- Gestao de usuarios admin/superadmin ----------
router.get('/usuarios', (req, res) => {
  const usuarios = db.prepare(`SELECT id, nome, email, telefone, papel, ativo, criado_em FROM usuarios WHERE papel IN ('admin','superadmin') ORDER BY criado_em DESC`).all();
  res.json(usuarios.map(u => ({ ...u, permissoes: permissoesDe(u) })));
});

router.post('/usuarios', (req, res) => {
  const { nome, email, senha, telefone } = req.body || {};
  if (!nome || !email || !senha) return res.status(400).json({ erro: 'Nome, e-mail e senha são obrigatórios.' });
  const existente = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email.toLowerCase().trim());
  if (existente) return res.status(409).json({ erro: 'Já existe uma conta com este e-mail.' });
  const hash = bcrypt.hashSync(senha, 10);

  // As permissoes marcadas na hora de liberar o acesso entram junto com o cadastro.
  const concedidas = normalizarPermissoes((req.body || {}).permissoes);
  const criar = db.transaction(() => {
    const info = db.prepare(`INSERT INTO usuarios (nome, email, senha_hash, telefone, papel, ativo) VALUES (?, ?, ?, ?, 'admin', 1)`)
      .run(nome.trim(), email.toLowerCase().trim(), hash, telefone || null);
    const ins = db.prepare('INSERT INTO usuario_permissoes (usuario_id, permissao, concedido_por) VALUES (?, ?, ?)');
    concedidas.forEach(p => ins.run(info.lastInsertRowid, p, req.session.usuario.email));
    return info.lastInsertRowid;
  });

  res.status(201).json({ id: criar(), permissoes: concedidas });
});

router.put('/usuarios/:id/ativo', (req, res) => {
  const { ativo } = req.body || {};
  const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.params.id);
  if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' });
  if (usuario.papel === 'superadmin') return res.status(400).json({ erro: 'Não é possível desativar um superadmin.' });
  db.prepare('UPDATE usuarios SET ativo = ? WHERE id = ?').run(ativo ? 1 : 0, usuario.id);
  res.json({ ok: true });
});

// ---------- Cupons (cadastro exclusivo do superadmin) ----------
// Sem produtos vinculados = cupom vale para o carrinho inteiro ("nenhum" produto
// especifico restringindo, ou "todos" — dá no mesmo resultado). Com produtos
// vinculados, o desconto so' incide sobre os itens daquela lista.
function cupomComProdutos(cupom) {
  const produtos = db.prepare(`
    SELECT p.id, p.nome FROM cupom_produtos cp JOIN produtos p ON p.id = cp.produto_id
    WHERE cp.cupom_id = ? ORDER BY p.nome ASC
  `).all(cupom.id);
  return { ...cupom, produtos };
}

router.get('/cupons', (req, res) => {
  const cupons = db.prepare('SELECT * FROM cupons ORDER BY ativo DESC, criado_em DESC').all();
  res.json(cupons.map(cupomComProdutos));
});

// Valida os campos comuns ao criar/editar. Devolve {erro} OU os valores prontos para gravar.
function validarCamposCupom(body) {
  const { codigo, tipo, valor, validade_inicio, validade_fim, limite_usos, produtos_ids } = body || {};
  const codigoLimpo = (codigo || '').trim().toUpperCase();
  if (!codigoLimpo) return { erro: 'Informe o código do cupom.' };
  if (!['percentual', 'valor'].includes(tipo)) return { erro: 'Tipo deve ser percentual ou valor.' };

  const valorNumero = parseFloat(valor);
  if (!Number.isFinite(valorNumero) || valorNumero <= 0) return { erro: 'Informe um valor de desconto maior que zero.' };
  if (tipo === 'percentual' && valorNumero > 100) return { erro: 'Percentual não pode passar de 100%.' };

  const inicio = String(validade_inicio || '').trim() || null;
  const fim = String(validade_fim || '').trim() || null;
  if (inicio && fim && inicio > fim) return { erro: 'A data inicial de validade não pode ser depois da data final.' };

  let limiteUsosNumero = null;
  if (limite_usos !== undefined && limite_usos !== null && String(limite_usos).trim() !== '') {
    limiteUsosNumero = parseInt(limite_usos, 10);
    if (!Number.isInteger(limiteUsosNumero) || limiteUsosNumero <= 0) {
      return { erro: 'O limite de usos deve ser um número inteiro maior que zero (ex.: 5 para valer só nos 5 primeiros pedidos).' };
    }
  }

  const produtosIds = [...new Set((Array.isArray(produtos_ids) ? produtos_ids : [])
    .map(n => parseInt(n, 10)).filter(Number.isInteger))];

  return { codigoLimpo, tipo, valorNumero, inicio, fim, limiteUsosNumero, produtosIds };
}

router.post('/cupons', (req, res) => {
  const v = validarCamposCupom(req.body);
  if (v.erro) return res.status(400).json(v);

  const existente = db.prepare('SELECT id FROM cupons WHERE UPPER(codigo) = ?').get(v.codigoLimpo);
  if (existente) return res.status(409).json({ erro: 'Já existe um cupom com este código.' });

  const criar = db.transaction(() => {
    const info = db.prepare(`INSERT INTO cupons (codigo, tipo, valor, validade_inicio, validade, limite_usos, ativo)
      VALUES (?, ?, ?, ?, ?, ?, 1)`).run(v.codigoLimpo, v.tipo, v.valorNumero, v.inicio, v.fim, v.limiteUsosNumero);
    const ins = db.prepare('INSERT INTO cupom_produtos (cupom_id, produto_id) VALUES (?, ?)');
    v.produtosIds.forEach(pid => ins.run(info.lastInsertRowid, pid));
    return info.lastInsertRowid;
  });

  res.status(201).json({ id: criar() });
});

router.put('/cupons/:id', (req, res) => {
  const cupom = db.prepare('SELECT * FROM cupons WHERE id = ?').get(req.params.id);
  if (!cupom) return res.status(404).json({ erro: 'Cupom não encontrado.' });

  const v = validarCamposCupom(req.body);
  if (v.erro) return res.status(400).json(v);

  const conflito = db.prepare('SELECT id FROM cupons WHERE UPPER(codigo) = ? AND id != ?').get(v.codigoLimpo, cupom.id);
  if (conflito) return res.status(409).json({ erro: 'Já existe outro cupom com este código.' });

  const gravar = db.transaction(() => {
    db.prepare(`UPDATE cupons SET codigo = ?, tipo = ?, valor = ?, validade_inicio = ?, validade = ?, limite_usos = ? WHERE id = ?`)
      .run(v.codigoLimpo, v.tipo, v.valorNumero, v.inicio, v.fim, v.limiteUsosNumero, cupom.id);
    db.prepare('DELETE FROM cupom_produtos WHERE cupom_id = ?').run(cupom.id);
    const ins = db.prepare('INSERT INTO cupom_produtos (cupom_id, produto_id) VALUES (?, ?)');
    v.produtosIds.forEach(pid => ins.run(cupom.id, pid));
  });
  gravar();

  res.json({ ok: true });
});

router.put('/cupons/:id/ativo', (req, res) => {
  const { ativo } = req.body || {};
  db.prepare('UPDATE cupons SET ativo = ? WHERE id = ?').run(ativo ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

// ---------- Configurações do site (contato, redes sociais, logomarca) ----------
router.get('/site', (req, res) => {
  res.json(obterLoja());
});

router.put('/site', (req, res) => {
  const { telefone, whatsapp, instagram, email } = req.body || {};
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) {
    return res.status(400).json({ erro: 'Informe um e-mail válido (ou deixe em branco).' });
  }
  res.json(salvarContato({ telefone, whatsapp, instagram, email }));
});

router.post('/site/logo', receberImagemSite, (req, res) => {
  if (!req.file) return res.status(400).json({ erro: 'Nenhuma imagem foi enviada.' });
  const logoUrl = `${URL_BASE_SITE}/${req.file.filename}`;
  res.status(201).json(salvarLogo(logoUrl));
});

// ---------- Avisos (banners com período de exibição) ----------
router.get('/avisos', (req, res) => {
  res.json(db.prepare('SELECT * FROM avisos ORDER BY criado_em DESC').all());
});

function validarCamposAviso(body) {
  const { titulo, mensagem, data_inicio, data_fim } = body || {};
  const tituloLimpo = String(titulo || '').trim();
  if (!tituloLimpo) return { erro: 'Informe o título do aviso.' };

  const inicio = String(data_inicio || '').trim() || null;
  const fim = String(data_fim || '').trim() || null;
  if (inicio && fim && inicio > fim) return { erro: 'A data inicial não pode ser depois da data final.' };

  return { tituloLimpo, mensagemLimpa: String(mensagem || '').trim() || null, inicio, fim };
}

router.post('/avisos', (req, res) => {
  const v = validarCamposAviso(req.body);
  if (v.erro) return res.status(400).json(v);

  const info = db.prepare(`INSERT INTO avisos (titulo, mensagem, data_inicio, data_fim, ativo) VALUES (?, ?, ?, ?, 1)`)
    .run(v.tituloLimpo, v.mensagemLimpa, v.inicio, v.fim);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.put('/avisos/:id', (req, res) => {
  const aviso = db.prepare('SELECT id FROM avisos WHERE id = ?').get(req.params.id);
  if (!aviso) return res.status(404).json({ erro: 'Aviso não encontrado.' });

  const v = validarCamposAviso(req.body);
  if (v.erro) return res.status(400).json(v);

  db.prepare(`UPDATE avisos SET titulo = ?, mensagem = ?, data_inicio = ?, data_fim = ? WHERE id = ?`)
    .run(v.tituloLimpo, v.mensagemLimpa, v.inicio, v.fim, aviso.id);
  res.json({ ok: true });
});

router.put('/avisos/:id/ativo', (req, res) => {
  const { ativo } = req.body || {};
  db.prepare('UPDATE avisos SET ativo = ? WHERE id = ?').run(ativo ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

router.delete('/avisos/:id', (req, res) => {
  const info = db.prepare('DELETE FROM avisos WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ erro: 'Aviso não encontrado.' });
  res.json({ ok: true });
});

// ---------- Relatorios ----------
router.get('/relatorios/resumo', (req, res) => {
  const totalProdutos = db.prepare('SELECT COUNT(*) n FROM produtos WHERE ativo = 1').get().n;
  const totalPedidos = db.prepare(`SELECT COUNT(*) n FROM pedidos`).get().n;
  // Faturamento usa valor_final: e' o que o cliente realmente pagou (ja com cupom).
  const faturamento = db.prepare(`SELECT IFNULL(SUM(valor_final),0) v FROM pedidos WHERE status IN ('pago','enviado','recebido','finalizado')`).get().v;
  const custoVendido = db.prepare(`
    SELECT IFNULL(SUM(pi.custo_unitario * pi.quantidade),0) v
    FROM pedido_itens pi JOIN pedidos p ON p.id = pi.pedido_id
    WHERE p.status IN ('pago','enviado','recebido','finalizado')
  `).get().v;
  const carrinhosAbertos = db.prepare(`SELECT COUNT(*) n FROM carrinhos WHERE status = 'aberto'`).get().n;
  const agendamentosPendentes = db.prepare(`SELECT COUNT(*) n FROM agendamentos WHERE status = 'pendente'`).get().n;
  const encomendasAbertas = db.prepare(`SELECT COUNT(*) n FROM encomendas WHERE status = 'aguardando'`).get().n;

  res.json({
    total_produtos: totalProdutos,
    total_pedidos: totalPedidos,
    faturamento: Math.round(faturamento * 100) / 100,
    lucro_bruto: Math.round((faturamento - custoVendido) * 100) / 100,
    carrinhos_abertos: carrinhosAbertos,
    agendamentos_pendentes: agendamentosPendentes,
    encomendas_abertas: encomendasAbertas
  });
});

// Produtos mais colocados no carrinho mas sem compra finalizada (abandono)
router.get('/relatorios/carrinho-abandonado', (req, res) => {
  const rows = db.prepare(`
    SELECT p.id, p.nome, p.preco_venda, COUNT(*) AS vezes_no_carrinho, SUM(ci.quantidade) AS unidades_no_carrinho
    FROM carrinho_itens ci
    JOIN carrinhos c ON c.id = ci.carrinho_id
    JOIN produtos p ON p.id = ci.produto_id
    WHERE c.status != 'convertido'
    GROUP BY p.id
    ORDER BY vezes_no_carrinho DESC
    LIMIT 15
  `).all();
  res.json(rows);
});

// Produtos mais vendidos (por unidades, em pedidos pagos/concluidos)
router.get('/relatorios/mais-vendidos', (req, res) => {
  const rows = db.prepare(`
    SELECT pi.produto_id AS id, pi.nome_produto AS nome, SUM(pi.quantidade) AS unidades_vendidas,
           SUM(pi.preco_unitario * pi.quantidade) AS receita
    FROM pedido_itens pi JOIN pedidos p ON p.id = pi.pedido_id
    WHERE p.status IN ('pago','enviado','recebido','finalizado')
    GROUP BY pi.produto_id
    ORDER BY unidades_vendidas DESC
    LIMIT 15
  `).all();
  res.json(rows);
});

// Produtos mais rentaveis (maior lucro total = (preco-custo)*quantidade vendida)
router.get('/relatorios/mais-rentaveis', (req, res) => {
  const rows = db.prepare(`
    SELECT pi.produto_id AS id, pi.nome_produto AS nome,
           SUM(pi.quantidade) AS unidades_vendidas,
           SUM((pi.preco_unitario - pi.custo_unitario) * pi.quantidade) AS lucro_total,
           ROUND(AVG(pi.preco_unitario - pi.custo_unitario), 2) AS lucro_medio_unitario
    FROM pedido_itens pi JOIN pedidos p ON p.id = pi.pedido_id
    WHERE p.status IN ('pago','enviado','recebido','finalizado')
    GROUP BY pi.produto_id
    ORDER BY lucro_total DESC
    LIMIT 15
  `).all();
  res.json(rows);
});

// Funil de tendencia: visualizacoes x carrinho x compra, por produto.
// So' conta o que aconteceu depois da marca "funil_reset_em" (ver
// db/migrate.js) — assim o funil comeca zerado a partir da publicacao da
// loja, sem apagar eventos_analytics nem pedidos (que os outros relatorios
// desta pagina continuam usando por inteiro).
router.get('/relatorios/funil-produtos', (req, res) => {
  const corte = db.prepare(`SELECT valor FROM configuracoes WHERE chave = 'funil_reset_em'`).get();
  const desde = corte ? corte.valor : '0000-01-01';
  const rows = db.prepare(`
    SELECT p.id, p.nome,
      (SELECT COUNT(*) FROM eventos_analytics e WHERE e.produto_id = p.id AND e.tipo = 'view_produto' AND e.criado_em > ?) AS visualizacoes,
      (SELECT COUNT(*) FROM eventos_analytics e WHERE e.produto_id = p.id AND e.tipo = 'add_carrinho' AND e.criado_em > ?) AS adicoes_carrinho,
      (SELECT IFNULL(SUM(pi.quantidade),0) FROM pedido_itens pi JOIN pedidos pe ON pe.id = pi.pedido_id
         WHERE pi.produto_id = p.id AND pe.status IN ('pago','enviado','recebido','finalizado') AND pe.criado_em > ?) AS unidades_vendidas
    FROM produtos p
    ORDER BY visualizacoes DESC
    LIMIT 20
  `).all(desde, desde, desde);
  res.json(rows);
});

router.get('/relatorios/vendas-por-dia', (req, res) => {
  const rows = db.prepare(`
    SELECT date(criado_em) AS dia, COUNT(*) AS pedidos, SUM(valor_final) AS total
    FROM pedidos WHERE status IN ('pago','enviado','recebido','finalizado')
    GROUP BY date(criado_em) ORDER BY dia DESC LIMIT 30
  `).all();
  res.json(rows);
});

module.exports = router;
