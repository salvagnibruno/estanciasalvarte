const express = require('express');
const router = express.Router();
const db = require('../db/db');

// Recupera (ou cria) o carrinho "aberto" do usuario logado ou da sessao de visitante.
function obterCarrinhoAtual(req) {
  const usuarioId = req.session.usuario ? req.session.usuario.id : null;
  const sessaoId = req.sessionID;

  let carrinho;
  if (usuarioId) {
    carrinho = db.prepare(`SELECT * FROM carrinhos WHERE usuario_id = ? AND status = 'aberto' ORDER BY id DESC LIMIT 1`).get(usuarioId);
  } else {
    carrinho = db.prepare(`SELECT * FROM carrinhos WHERE sessao_id = ? AND usuario_id IS NULL AND status = 'aberto' ORDER BY id DESC LIMIT 1`).get(sessaoId);
  }
  if (!carrinho) {
    const info = db.prepare(`INSERT INTO carrinhos (usuario_id, sessao_id, status) VALUES (?, ?, 'aberto')`).run(usuarioId, sessaoId);
    carrinho = db.prepare('SELECT * FROM carrinhos WHERE id = ?').get(info.lastInsertRowid);
  }
  return carrinho;
}

function montarRespostaCarrinho(carrinho) {
  const itens = db.prepare(`
    SELECT ci.*, p.nome AS produto_nome, p.imagem_url, p.tipo_estoque, p.ativo AS produto_ativo
    FROM carrinho_itens ci JOIN produtos p ON p.id = ci.produto_id
    WHERE ci.carrinho_id = ? ORDER BY ci.id ASC
  `).all(carrinho.id);
  const total = itens.reduce((s, i) => s + i.preco_unitario * i.quantidade, 0);
  return { id: carrinho.id, itens, total: Math.round(total * 100) / 100 };
}

router.get('/', (req, res) => {
  const carrinho = obterCarrinhoAtual(req);
  res.json(montarRespostaCarrinho(carrinho));
});

router.post('/itens', (req, res) => {
  const { produto_id, tamanho, cor, quantidade } = req.body || {};
  const qtd = Math.max(1, parseInt(quantidade, 10) || 1);
  const produto = db.prepare('SELECT * FROM produtos WHERE id = ? AND ativo = 1').get(produto_id);
  if (!produto) return res.status(404).json({ erro: 'Produto não encontrado ou inativo.' });

  const carrinho = obterCarrinhoAtual(req);
  const existente = db.prepare(`SELECT * FROM carrinho_itens WHERE carrinho_id = ? AND produto_id = ? AND IFNULL(tamanho,'') = IFNULL(?,'') AND IFNULL(cor,'') = IFNULL(?,'')`)
    .get(carrinho.id, produto_id, tamanho || null, cor || null);

  if (existente) {
    db.prepare('UPDATE carrinho_itens SET quantidade = quantidade + ? WHERE id = ?').run(qtd, existente.id);
  } else {
    db.prepare(`INSERT INTO carrinho_itens (carrinho_id, produto_id, tamanho, cor, quantidade, preco_unitario) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(carrinho.id, produto_id, tamanho || null, cor || null, qtd, produto.preco_venda);
  }
  db.prepare(`UPDATE carrinhos SET atualizado_em = datetime('now') WHERE id = ?`).run(carrinho.id);
  db.prepare(`INSERT INTO eventos_analytics (tipo, produto_id, usuario_id, sessao_id) VALUES ('add_carrinho', ?, ?, ?)`)
    .run(produto_id, req.session.usuario ? req.session.usuario.id : null, req.sessionID);

  res.status(201).json(montarRespostaCarrinho(carrinho));
});

router.put('/itens/:itemId', (req, res) => {
  const { quantidade } = req.body || {};
  const qtd = Math.max(1, parseInt(quantidade, 10) || 1);
  const carrinho = obterCarrinhoAtual(req);
  const item = db.prepare('SELECT * FROM carrinho_itens WHERE id = ? AND carrinho_id = ?').get(req.params.itemId, carrinho.id);
  if (!item) return res.status(404).json({ erro: 'Item não encontrado no carrinho.' });
  db.prepare('UPDATE carrinho_itens SET quantidade = ? WHERE id = ?').run(qtd, item.id);
  res.json(montarRespostaCarrinho(carrinho));
});

router.delete('/itens/:itemId', (req, res) => {
  const carrinho = obterCarrinhoAtual(req);
  const item = db.prepare('SELECT * FROM carrinho_itens WHERE id = ? AND carrinho_id = ?').get(req.params.itemId, carrinho.id);
  if (item) {
    db.prepare('DELETE FROM carrinho_itens WHERE id = ?').run(item.id);
    db.prepare(`INSERT INTO eventos_analytics (tipo, produto_id, usuario_id, sessao_id) VALUES ('remove_carrinho', ?, ?, ?)`)
      .run(item.produto_id, req.session.usuario ? req.session.usuario.id : null, req.sessionID);
  }
  res.json(montarRespostaCarrinho(carrinho));
});

module.exports = { router, obterCarrinhoAtual, montarRespostaCarrinho };
