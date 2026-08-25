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

// Carrinho de visitante (sem login) parado ha' mais de 30 dias e' esvaziado
// automaticamente — ninguem mais volta a ver aquele carrinho depois disso.
// Carrinho de cliente LOGADO nunca entra aqui (usuario_id IS NOT NULL fica de
// fora do WHERE): só some se a propria pessoa remover os itens. DELETE FROM
// carrinhos (em vez de só limpar os itens) e' seguro porque cascata
// (carrinho_itens.carrinho_id ON DELETE CASCADE) leva os itens junto, e
// carrinho.js cria um carrinho novo na proxima visita sem nenhum problema.
async function limparCarrinhosExpirados() {
  const info = await db.prepare(`DELETE FROM carrinhos
    WHERE usuario_id IS NULL AND atualizado_em < datetime('now', '-30 days')`).run();
  if (info.changes) console.log(`[expiracao] ${info.changes} carrinho(s) de visitante com mais de 30 dias esvaziado(s).`);
  return info.changes;
}

module.exports = { flipPedidosExpirados, limparCarrinhosExpirados };
