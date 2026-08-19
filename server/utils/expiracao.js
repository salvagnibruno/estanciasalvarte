// Sweep periodico: pedidos ainda aguardando pagamento cujo prazo (igual a'
// validade do proprio link do Mercado Pago, ver routes/pagamento.js) ja
// passou viram "Desistência" — nunca sao apagados, ficam na tabela para o
// vendedor retomar contato. Processo Node unico (sem workers distribuidos),
// entao um setInterval simples e' seguro aqui, sem risco de duas varreduras
// simultaneas (ver wiring em server.js).
const db = require('../db/db');
const { definirStatusPedido } = require('./pagamentoStatus');

async function flipPedidosExpirados() {
  const vencidos = await db.prepare(`SELECT id FROM pedidos
    WHERE status = 'aguardando_pagamento' AND expira_em IS NOT NULL AND expira_em < datetime('now')`).all();

  for (const { id } of vencidos) {
    await definirStatusPedido(id, 'desistencia');
  }
  if (vencidos.length) console.log(`[expiracao] ${vencidos.length} pedido(s) marcados como Desistência.`);
  return vencidos.length;
}

module.exports = { flipPedidosExpirados };
