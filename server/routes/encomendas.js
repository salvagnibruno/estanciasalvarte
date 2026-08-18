const express = require('express');
const router = express.Router();
const db = require('../db/db');

// Cliente pede para "Encomendar" um produto sob encomenda, ou "Avisar quando chegar"
// para um produto sem estoque no momento.
router.post('/', (req, res) => {
  const { produto_id, nome, email, telefone, tamanho, cor, quantidade, tipo } = req.body || {};
  if (!produto_id || !nome || !telefone) {
    return res.status(400).json({ erro: 'Produto, nome e telefone são obrigatórios.' });
  }
  const produto = db.prepare('SELECT id FROM produtos WHERE id = ?').get(produto_id);
  if (!produto) return res.status(404).json({ erro: 'Produto não encontrado.' });

  const usuarioId = req.session.usuario ? req.session.usuario.id : null;
  const tipoFinal = tipo === 'aviso_estoque' ? 'aviso_estoque' : 'encomenda';
  const info = db.prepare(`INSERT INTO encomendas
    (produto_id, usuario_id, nome, email, telefone, tamanho, cor, quantidade, tipo, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'aguardando')`)
    .run(produto_id, usuarioId, nome, email || null, telefone, tamanho || null, cor || null, Math.max(1, parseInt(quantidade, 10) || 1), tipoFinal);

  res.status(201).json({ id: info.lastInsertRowid, mensagem: tipoFinal === 'encomenda'
    ? 'Encomenda registrada! Entraremos em contato para combinar prazo e pagamento.'
    : 'Anotado! Vamos te avisar assim que este produto voltar ao estoque.' });
});

module.exports = router;
