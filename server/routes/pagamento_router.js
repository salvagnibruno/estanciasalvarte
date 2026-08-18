const express = require('express');
const router = express.Router();
const db = require('../db/db');
const pagamento = require('./pagamento');

// Mercado Pago chama esta URL quando o status de um pagamento muda.
router.post('/webhook', async (req, res) => {
  try {
    const tipo = req.query.type || req.body.type;
    const paymentId = (req.query['data.id']) || (req.body.data && req.body.data.id);
    if (tipo !== 'payment' || !paymentId) return res.sendStatus(200);

    const pagamentoInfo = await pagamento.consultarPagamento(paymentId);
    if (!pagamentoInfo) return res.sendStatus(200);

    const pedidoId = pagamentoInfo.external_reference;
    const pedido = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedidoId);
    if (!pedido) return res.sendStatus(200);

    let novoStatus = pedido.status;
    if (pagamentoInfo.status === 'approved') novoStatus = 'pago';
    else if (pagamentoInfo.status === 'rejected') novoStatus = 'cancelado';
    else if (pagamentoInfo.status === 'pending' || pagamentoInfo.status === 'in_process') novoStatus = 'aguardando_pagamento';

    db.prepare(`UPDATE pedidos SET status = ?, mp_payment_id = ?, atualizado_em = datetime('now') WHERE id = ?`)
      .run(novoStatus, String(paymentId), pedidoId);

    if (novoStatus === 'pago' && pedido.status !== 'pago') {
      const itens = db.prepare('SELECT * FROM pedido_itens WHERE pedido_id = ?').all(pedidoId);
      for (const item of itens) {
        if (!item.produto_id) continue;
        db.prepare(`UPDATE produto_estoque SET quantidade = MAX(0, quantidade - ?)
          WHERE produto_id = ? AND IFNULL(tamanho,'') = IFNULL(?,'') AND IFNULL(cor,'') = IFNULL(?,'')`)
          .run(item.quantidade, item.produto_id, item.tamanho, item.cor);
        db.prepare(`INSERT INTO eventos_analytics (tipo, produto_id) VALUES ('compra_concluida', ?)`).run(item.produto_id);
      }
    }

    res.sendStatus(200);
  } catch (e) {
    console.error('[mercadopago webhook] erro:', e.message);
    res.sendStatus(200);
  }
});

// Endpoint auxiliar para a pagina de confirmacao consultar o status do pedido.
router.get('/status/:pedidoId', (req, res) => {
  const pedido = db.prepare(`SELECT id, codigo, status, total, valor_desconto, cupom, valor_final, forma_pagamento
    FROM pedidos WHERE id = ?`).get(req.params.pedidoId);
  if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado.' });
  res.json(pedido);
});

module.exports = router;
