const express = require('express');
const router = express.Router();
const db = require('../db/db');
const pagamento = require('./pagamento');
const { aplicarStatusPagamento } = require('../utils/pagamentoStatus');

// Mercado Pago chama esta URL quando o status de um pagamento muda.
router.post('/webhook', async (req, res) => {
  try {
    const tipo = req.query.type || req.body.type;
    const paymentId = (req.query['data.id']) || (req.body.data && req.body.data.id);
    if (tipo !== 'payment' || !paymentId) return res.sendStatus(200);

    const pagamentoInfo = await pagamento.consultarPagamento(paymentId);
    if (!pagamentoInfo) return res.sendStatus(200);

    const pedidoId = pagamentoInfo.external_reference;
    await aplicarStatusPagamento(pedidoId, pagamentoInfo.status, paymentId);

    res.sendStatus(200);
  } catch (e) {
    console.error('[mercadopago webhook] erro:', e.message);
    res.sendStatus(200);
  }
});

// Endpoint auxiliar para a pagina de confirmacao consultar o status do pedido.
router.get('/status/:pedidoId', async (req, res) => {
  const pedido = await db.prepare(`SELECT id, codigo, status, total, valor_desconto, cupom, valor_final, forma_pagamento
    FROM pedidos WHERE id = ?`).get(req.params.pedidoId);
  if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado.' });
  res.json(pedido);
});

module.exports = router;
