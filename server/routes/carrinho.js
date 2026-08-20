const express = require('express');
const router = express.Router();
const db = require('../db/db');

// Recupera (ou cria) o carrinho "aberto" do usuario logado ou da sessao de visitante.
async function obterCarrinhoAtual(req) {
  const usuarioId = req.session.usuario ? req.session.usuario.id : null;
  const sessaoId = req.session.sid;

  let carrinho;
  if (usuarioId) {
    carrinho = await db.prepare(`SELECT * FROM carrinhos WHERE usuario_id = ? AND status = 'aberto' ORDER BY id DESC LIMIT 1`).get(usuarioId);
  } else {
    carrinho = await db.prepare(`SELECT * FROM carrinhos WHERE sessao_id = ? AND usuario_id IS NULL AND status = 'aberto' ORDER BY id DESC LIMIT 1`).get(sessaoId);
  }
  if (!carrinho) {
    const info = await db.prepare(`INSERT INTO carrinhos (usuario_id, sessao_id, status) VALUES (?, ?, 'aberto')`).run(usuarioId, sessaoId);
    carrinho = await db.prepare('SELECT * FROM carrinhos WHERE id = ?').get(info.lastInsertRowid);
  }
  return carrinho;
}

async function montarRespostaCarrinho(carrinho) {
  const itens = await db.prepare(`
    SELECT ci.*, p.nome AS produto_nome, p.imagem_url, p.tipo_estoque, p.ativo AS produto_ativo
    FROM carrinho_itens ci JOIN produtos p ON p.id = ci.produto_id
    WHERE ci.carrinho_id = ? ORDER BY ci.id ASC
  `).all(carrinho.id);
  const total = itens.reduce((s, i) => s + i.preco_unitario * i.quantidade, 0);
  return { id: carrinho.id, itens, total: Math.round(total * 100) / 100 };
}

router.get('/', async (req, res) => {
  const carrinho = await obterCarrinhoAtual(req);
  res.json(await montarRespostaCarrinho(carrinho));
});

router.post('/itens', async (req, res) => {
  const { produto_id, tamanho, cor, quantidade } = req.body || {};
  const qtd = Math.max(1, parseInt(quantidade, 10) || 1);
  const produto = await db.prepare('SELECT * FROM produtos WHERE id = ? AND ativo = 1').get(produto_id);
  if (!produto) return res.status(404).json({ erro: 'Produto não encontrado ou inativo.' });

  const carrinho = await obterCarrinhoAtual(req);
  const existente = await db.prepare(`SELECT * FROM carrinho_itens WHERE carrinho_id = ? AND produto_id = ? AND IFNULL(tamanho,'') = IFNULL(?,'') AND IFNULL(cor,'') = IFNULL(?,'')`)
    .get(carrinho.id, produto_id, tamanho || null, cor || null);

  if (existente) {
    await db.prepare('UPDATE carrinho_itens SET quantidade = quantidade + ? WHERE id = ?').run(qtd, existente.id);
  } else {
    await db.prepare(`INSERT INTO carrinho_itens (carrinho_id, produto_id, tamanho, cor, quantidade, preco_unitario) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(carrinho.id, produto_id, tamanho || null, cor || null, qtd, produto.preco_venda);
  }
  await db.prepare(`UPDATE carrinhos SET atualizado_em = datetime('now') WHERE id = ?`).run(carrinho.id);
  await db.prepare(`INSERT INTO eventos_analytics (tipo, produto_id, usuario_id, sessao_id) VALUES ('add_carrinho', ?, ?, ?)`)
    .run(produto_id, req.session.usuario ? req.session.usuario.id : null, req.session.sid);

  res.status(201).json(await montarRespostaCarrinho(carrinho));
});

router.put('/itens/:itemId', async (req, res) => {
  const { quantidade } = req.body || {};
  const qtd = Math.max(1, parseInt(quantidade, 10) || 1);
  const carrinho = await obterCarrinhoAtual(req);
  const item = await db.prepare('SELECT * FROM carrinho_itens WHERE id = ? AND carrinho_id = ?').get(req.params.itemId, carrinho.id);
  if (!item) return res.status(404).json({ erro: 'Item não encontrado no carrinho.' });
  await db.prepare('UPDATE carrinho_itens SET quantidade = ? WHERE id = ?').run(qtd, item.id);
  res.json(await montarRespostaCarrinho(carrinho));
});

router.delete('/', async (req, res) => {
  const carrinho = await obterCarrinhoAtual(req);
  await db.prepare('DELETE FROM carrinho_itens WHERE carrinho_id = ?').run(carrinho.id);
  await db.prepare(`INSERT INTO eventos_analytics (tipo, usuario_id, sessao_id) VALUES ('carrinho_esvaziado', ?, ?)`)
    .run(req.session.usuario ? req.session.usuario.id : null, req.session.sid);
  res.json(await montarRespostaCarrinho(carrinho));
});

router.delete('/itens/:itemId', async (req, res) => {
  const carrinho = await obterCarrinhoAtual(req);
  const item = await db.prepare('SELECT * FROM carrinho_itens WHERE id = ? AND carrinho_id = ?').get(req.params.itemId, carrinho.id);
  if (item) {
    await db.prepare('DELETE FROM carrinho_itens WHERE id = ?').run(item.id);
    await db.prepare(`INSERT INTO eventos_analytics (tipo, produto_id, usuario_id, sessao_id) VALUES ('remove_carrinho', ?, ?, ?)`)
      .run(item.produto_id, req.session.usuario ? req.session.usuario.id : null, req.session.sid);
  }
  res.json(await montarRespostaCarrinho(carrinho));
});

module.exports = { router, obterCarrinhoAtual, montarRespostaCarrinho };
