const express = require('express');
const router = express.Router();
const db = require('../db/db');

async function montarProduto(row, { incluirCusto } = { incluirCusto: false }) {
  const tamanhos = (await db.prepare('SELECT tamanho FROM produto_tamanhos WHERE produto_id = ? ORDER BY id').all(row.id)).map(r => r.tamanho);
  // `imagem_url` da cor alimenta a troca de foto na pagina do produto.
  const cores = await db.prepare('SELECT id, cor_nome, cor_hex, imagem_url FROM produto_cores WHERE produto_id = ? ORDER BY id').all(row.id);
  const estoque = await db.prepare('SELECT tamanho, cor, quantidade FROM produto_estoque WHERE produto_id = ?').all(row.id);
  const linhas = await db.prepare(`
    SELECT l.id, l.nome, l.slug FROM produto_linhas pl JOIN linhas l ON l.id = pl.linha_id
    WHERE pl.produto_id = ? ORDER BY l.ordem ASC
  `).all(row.id);
  const estoqueTotal = estoque.reduce((soma, e) => soma + e.quantidade, 0);
  // Promocao so vale se for um valor menor que o preco cheio.
  const promocional = row.preco_promocional && row.preco_promocional > 0 && row.preco_promocional < row.preco_venda
    ? row.preco_promocional
    : null;

  const produto = {
    id: row.id,
    codigo: row.codigo,
    nome: row.nome,
    descricao: row.descricao,
    categoria_id: row.categoria_id,
    categoria_nome: row.categoria_nome,
    categoria_slug: row.categoria_slug,
    preco_venda: row.preco_venda,
    preco_promocional: promocional,
    preco_exibido: promocional || row.preco_venda,
    em_promocao: !!promocional,
    destaque: !!row.destaque,
    tipo_estoque: row.tipo_estoque,
    publico: row.publico || 'unissex',
    imagem_url: row.imagem_url,
    ativo: !!row.ativo,
    criado_em: row.criado_em, // a vitrine usa para marcar "novidade"
    tamanhos,
    cores,
    linhas,
    estoque,
    estoque_total: estoqueTotal,
    disponivel: row.tipo_estoque === 'estoque' ? estoqueTotal > 0 : true
  };
  if (incluirCusto) {
    produto.custo = row.custo;
    produto.custo_fonte = row.custo_fonte;
    produto.percentual_markup = row.percentual_markup;
    produto.margem_reais = Math.round((row.preco_venda - row.custo) * 100) / 100;
  }
  return produto;
}

// GET /api/categorias
router.get('/categorias', async (req, res) => {
  const categorias = await db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM produtos p WHERE p.categoria_id = c.id AND p.ativo = 1) AS total_produtos
    FROM categorias c ORDER BY ordem ASC
  `).all();
  res.json(categorias);
});

// GET /api/linhas — usado pelo filtro do catálogo público e pelo cadastro de produto.
router.get('/linhas', async (req, res) => {
  const linhas = await db.prepare(`
    SELECT l.*, (
      SELECT COUNT(*) FROM produto_linhas pl JOIN produtos p ON p.id = pl.produto_id
      WHERE pl.linha_id = l.id AND p.ativo = 1
    ) AS total_produtos
    FROM linhas l ORDER BY l.ordem ASC
  `).all();
  res.json(linhas);
});

// Preco que vale para o cliente (promocional quando houver).
const PRECO_EFETIVO = `CASE WHEN p.preco_promocional > 0 AND p.preco_promocional < p.preco_venda
                            THEN p.preco_promocional ELSE p.preco_venda END`;

// Ordenacoes que a vitrine oferece. Lista fechada: o valor vem da tela.
const ORDENACOES = {
  nome: 'p.nome ASC',
  nome_desc: 'p.nome DESC',
  menor_preco: `${PRECO_EFETIVO} ASC, p.nome ASC`,
  maior_preco: `${PRECO_EFETIVO} DESC, p.nome ASC`,
  novidades: 'p.criado_em DESC, p.nome ASC'
};

// GET /api/produtos?categoria=slug&linha=slug&busca=termo&ordem=nome&destaque=1
router.get('/produtos', async (req, res) => {
  const { categoria, linha, busca, destaque } = req.query;
  let sql = `SELECT p.*, c.nome AS categoria_nome, c.slug AS categoria_slug
             FROM produtos p JOIN categorias c ON c.id = p.categoria_id
             WHERE p.ativo = 1`;
  const params = [];
  if (categoria) { sql += ' AND c.slug = ?'; params.push(categoria); }
  if (linha) {
    sql += ` AND p.id IN (SELECT pl.produto_id FROM produto_linhas pl JOIN linhas l ON l.id = pl.linha_id WHERE l.slug = ?)`;
    params.push(linha);
  }
  if (busca) { sql += ' AND (p.nome LIKE ? OR p.descricao LIKE ?)'; params.push(`%${busca}%`, `%${busca}%`); }
  if (destaque === '1') sql += ' AND p.destaque = 1';
  sql += ' ORDER BY ' + (ORDENACOES[req.query.ordem] || ORDENACOES.nome);

  const rows = await db.prepare(sql).all(...params);
  res.json(await Promise.all(rows.map(r => montarProduto(r))));
});

// GET /api/produtos/:id
router.get('/produtos/:id', async (req, res) => {
  const row = await db.prepare(`
    SELECT p.*, c.nome AS categoria_nome, c.slug AS categoria_slug
    FROM produtos p JOIN categorias c ON c.id = p.categoria_id
    WHERE p.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ erro: 'Produto não encontrado.' });

  await db.prepare(`INSERT INTO eventos_analytics (tipo, produto_id, usuario_id, sessao_id) VALUES ('view_produto', ?, ?, ?)`)
    .run(row.id, req.session.usuario ? req.session.usuario.id : null, req.session.sid);

  res.json(await montarProduto(row));
});

module.exports = { router, montarProduto };
