const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const db = require('../db/db');
const { obterLoja } = require('../utils/siteConfig');
const { exigirPermissao } = require('../middleware/auth');

// Logomarca embutida em data URI, calculada na hora (a logo pode ter sido
// trocada pelo superadmin — ver routes/superadmin.js).
//
// O catalogo em PDF nao pode depender da URL da imagem: a pagina abre numa aba
// nova e chama window.print() logo em seguida, e uma imagem que ainda esteja em
// rede (ou que volte como 304 do cache) simplesmente nao entra no papel — era
// esse o motivo do PDF sair sem a logomarca. Embutida, ela faz parte do proprio
// HTML: ja esta decodificada quando a folha e' impressa, sempre.
function logoEmbutida(caminhoPublico) {
  try {
    const arquivo = path.join(__dirname, '..', 'public', caminhoPublico.replace(/^\/+/, ''));
    const tipo = /\.png$/i.test(arquivo) ? 'image/png'
      : /\.svg$/i.test(arquivo) ? 'image/svg+xml'
      : /\.webp$/i.test(arquivo) ? 'image/webp'
      : /\.gif$/i.test(arquivo) ? 'image/gif'
      : 'image/jpeg';
    return `data:${tipo};base64,${fs.readFileSync(arquivo).toString('base64')}`;
  } catch (e) {
    console.error('[catalogo] não foi possível embutir a logomarca:', e.message);
    return null;
  }
}

// GET /api/loja — contatos e identidade (usado pelo cabecalho e pelo catalogo).
// Sem a logo embutida de proposito: o site inteiro chama esta rota e nao precisa
// carregar a imagem em base64 a cada pagina.
router.get('/loja', async (req, res) => res.json(await obterLoja()));

// GET /api/avisos/ativos — só os avisos dentro da janela de exibição, para o
// banner do site (cadastro completo é exclusivo do superadmin).
router.get('/avisos/ativos', async (req, res) => {
  const hoje = new Date().toISOString().slice(0, 10);
  const rows = await db.prepare(`
    SELECT id, titulo, mensagem FROM avisos
    WHERE ativo = 1
      AND (data_inicio IS NULL OR data_inicio <= ?)
      AND (data_fim IS NULL OR data_fim >= ?)
    ORDER BY criado_em DESC
  `).all(hoje, hoje);
  res.json(rows);
});

// Nome do recorte que aparece na capa e no nome do arquivo. Com poucas
// categorias vale listar; com muitas, a capa viraria um paragrafo.
const LIMITE_ESCOPO = 60;
function nomeDoEscopo(slugs, nomes) {
  if (!slugs.length) return 'Catálogo completo';
  // Categoria escolhida sem nenhum produto ativo nao aparece em `nomes`; nesse
  // caso o slug pedido e' o que sobra para nomear o recorte.
  const rotulos = nomes.length ? nomes : slugs;
  const listados = rotulos.join(' · ');
  return listados.length <= LIMITE_ESCOPO ? listados : `${rotulos.length} categorias selecionadas`;
}

// Recorte por publico. 'unissex' nunca e' um filtro sozinho: ele so acompanha
// (ou nao) a selecao masculina/feminina, que e' como a loja monta o catalogo.
const PUBLICOS_FILTRAVEIS = ['masculino', 'feminino'];
function rotuloPublico(publico, comUnissex) {
  const base = publico === 'masculino' ? 'peças masculinas' : 'peças femininas';
  return comUnissex ? `${base} e unissex` : base;
}

// GET /api/catalogo?categorias=slug1,slug2&precos=1
// Monta o catalogo comercial agrupado por categoria. Sem categoria nenhuma, vem
// completo; `categorias` aceita uma, varias ou todas (`categoria=slug` continua
// valendo, no singular, para os links antigos).
// `precos=0` gera a versao sem valores (para orcamento sob consulta).
//
// Exportacao e' restrita: traz custo indireto do negocio (linha completa de
// produtos e precos num arquivo unico), entao exige a permissao especifica.
router.get('/catalogo', exigirPermissao('exportar_catalogo'), async (req, res) => {
  // O catalogo carrega preco, estoque e a selecao de categorias do momento:
  // nada aqui pode vir do cache do navegador. Sem isto, gerar o PDF duas vezes
  // seguidas podia trazer a resposta anterior.
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');

  const incluirPrecos = req.query.precos !== '0';
  const slugs = [...new Set(
    String(req.query.categorias || req.query.categoria || '')
      .split(',').map(s => s.trim()).filter(Boolean)
  )];

  // `publico=masculino|feminino` recorta por genero; `unissex=0` deixa de fora
  // as pecas que servem aos dois. Sem `publico`, entra tudo.
  const publico = PUBLICOS_FILTRAVEIS.includes(req.query.publico) ? req.query.publico : null;
  const incluirUnissex = req.query.unissex !== '0';
  // `destaque=1` recorta para so' os produtos marcados como destaque (o mesmo
  // sinalizador do carrossel da home). Sem isso, entram todos os ativos.
  const somenteDestaque = req.query.destaque === '1';

  const params = [];
  let filtro = 'WHERE p.ativo = 1';
  if (slugs.length) {
    filtro += ` AND c.slug IN (${slugs.map(() => '?').join(', ')})`;
    params.push(...slugs);
  }
  if (publico) {
    filtro += incluirUnissex ? " AND p.publico IN (?, 'unissex')" : ' AND p.publico = ?';
    params.push(publico);
  }
  if (somenteDestaque) {
    filtro += ' AND p.destaque = 1';
  }

  const linhas = await db.prepare(`
    SELECT p.id, p.codigo, p.nome, p.descricao, p.preco_venda, p.preco_promocional,
           p.destaque, p.tipo_estoque, p.imagem_url,
           c.id AS categoria_id, c.nome AS categoria_nome, c.slug AS categoria_slug, c.ordem AS categoria_ordem
    FROM produtos p
    JOIN categorias c ON c.id = p.categoria_id
    ${filtro}
    ORDER BY c.ordem ASC, c.nome ASC, p.nome ASC
  `).all(...params);

  const porCategoria = new Map();
  for (const linha of linhas) {
    if (!porCategoria.has(linha.categoria_id)) {
      porCategoria.set(linha.categoria_id, {
        nome: linha.categoria_nome,
        slug: linha.categoria_slug,
        produtos: []
      });
    }

    const tamanhos = (await db.prepare('SELECT tamanho FROM produto_tamanhos WHERE produto_id = ? ORDER BY id')
      .all(linha.id)).map(t => t.tamanho);
    const cores = await db.prepare('SELECT cor_nome, cor_hex FROM produto_cores WHERE produto_id = ? ORDER BY id')
      .all(linha.id);

    const promocional = linha.preco_promocional && linha.preco_promocional > 0 && linha.preco_promocional < linha.preco_venda
      ? linha.preco_promocional
      : null;

    const produto = {
      id: linha.id,
      codigo: linha.codigo,
      nome: linha.nome,
      descricao: linha.descricao,
      imagem_url: linha.imagem_url,
      destaque: !!linha.destaque,
      sob_encomenda: linha.tipo_estoque === 'sob_encomenda',
      tamanhos,
      cores
    };
    if (incluirPrecos) {
      produto.preco_venda = linha.preco_venda;
      produto.preco_promocional = promocional;
      produto.preco_exibido = promocional || linha.preco_venda;
    }
    porCategoria.get(linha.categoria_id).produtos.push(produto);
  }

  const categorias = [...porCategoria.values()];
  const loja = await obterLoja();
  res.json({
    // `logo_embutida` e' o que a folha usa; `logo` fica como reserva caso a
    // leitura do arquivo tenha falhado na subida do servidor.
    loja: { ...loja, logo_embutida: logoEmbutida(loja.logo) },
    incluir_precos: incluirPrecos,
    // O escopo sai dos nomes que realmente vieram; se uma categoria escolhida
    // estiver sem produto ativo, ela nao entra na capa nem no arquivo.
    escopo: nomeDoEscopo(slugs, categorias.map(c => c.nome))
      + (publico ? ` — ${rotuloPublico(publico, incluirUnissex)}` : '')
      + (somenteDestaque ? ' — somente destaques' : ''),
    categorias_pedidas: slugs,
    publico,
    inclui_unissex: publico ? incluirUnissex : null,
    somente_destaque: somenteDestaque,
    total_produtos: linhas.length,
    gerado_em: new Date().toISOString(),
    categorias
  });
});

module.exports = router;
