// Logica compartilhada de "o que fazer quando o status de um pedido muda" —
// usada pelo webhook do Mercado Pago, pela reconciliacao manual do admin, pela
// troca manual de status no painel e pelo sweep de expiracao (server/utils/
// expiracao.js). Centralizar aqui garante que o efeito colateral (nota fiscal
// pendente, e-mail de confirmacao, devolucao de estoque) roda exatamente uma
// vez por pedido, nao importa por qual desses quatro caminhos ele chegou.
const db = require('../db/db');
const email = require('./email');

// Devolve o estoque de um pedido para produto_estoque (cancelamento,
// desistencia ou pagamento recusado). So' age se o estoque foi reservado
// nesse pedido (na criacao, ver routes/pedidos.js) e ainda nao foi devolvido —
// protege tanto contra pedidos antigos (de antes desta mudanca, que nunca
// reservaram) quanto contra devolucao em dobro se o status mudar de novo.
// `executor` e' o `db` normal ou um `tx` de dentro de uma transacao.
async function devolverEstoquePedido(executor, pedidoId) {
  const pedido = await executor.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedidoId);
  if (!pedido || !pedido.estoque_reservado || pedido.estoque_devolvido) return false;

  const itens = await executor.prepare('SELECT * FROM pedido_itens WHERE pedido_id = ?').all(pedidoId);
  for (const item of itens) {
    if (!item.produto_id) continue; // produto excluido depois: nada para devolver
    await executor.prepare(`UPDATE produto_estoque SET quantidade = quantidade + ?
      WHERE produto_id = ? AND IFNULL(tamanho,'') = IFNULL(?,'') AND IFNULL(cor,'') = IFNULL(?,'')`)
      .run(item.quantidade, item.produto_id, item.tamanho, item.cor);
  }
  await executor.prepare(`UPDATE pedidos SET estoque_devolvido = 1 WHERE id = ?`).run(pedidoId);
  return true;
}

// Aplica um novo status a um pedido e dispara os efeitos colaterais de uma so
// vez: nota fiscal pendente + e-mail de confirmacao ao virar 'pago' (so' na
// primeira vez); devolucao de estoque ao virar 'cancelado' ou 'desistencia'
// (so' na primeira vez). Usado por toda troca de status do sistema — webhook,
// reconciliacao manual, troca manual no painel e sweep de expiracao — para o
// efeito nunca rodar duas vezes nem faltar num dos caminhos.
async function definirStatusPedido(pedidoId, novoStatus, { paymentId } = {}) {
  const aplicar = db.transaction(async (tx) => {
    const pedido = await tx.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedidoId);
    if (!pedido) return null;
    const statusAnterior = pedido.status;

    await tx.prepare(`UPDATE pedidos SET status = ?, mp_payment_id = COALESCE(?, mp_payment_id), atualizado_em = datetime('now') WHERE id = ?`)
      .run(novoStatus, paymentId ? String(paymentId) : null, pedidoId);

    if (novoStatus === 'pago' && statusAnterior !== 'pago') {
      await tx.prepare(`UPDATE pedidos SET nfce_status = 'pendente' WHERE id = ?`).run(pedidoId);
    }
    if ((novoStatus === 'cancelado' || novoStatus === 'desistencia')
      && statusAnterior !== 'cancelado' && statusAnterior !== 'desistencia') {
      await devolverEstoquePedido(tx, pedidoId);
    }
    return { statusAnterior, novoStatus };
  });

  const resultado = await aplicar();
  if (!resultado) return null;

  // E-mail e evento de analytics ficam fora da transacao (nao sao dados
  // criticos de consistencia) e nunca derrubam a troca de status se falharem.
  if (resultado.novoStatus === 'pago' && resultado.statusAnterior !== 'pago') {
    const itens = await db.prepare('SELECT * FROM pedido_itens WHERE pedido_id = ?').all(pedidoId);
    const pedidoAtual = await db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedidoId);
    email.enviarConfirmacaoPagamento(pedidoAtual, itens).catch(e => console.error('[email] confirmação de pagamento:', e.message));
    for (const item of itens) {
      if (!item.produto_id) continue;
      await db.prepare(`INSERT INTO eventos_analytics (tipo, produto_id) VALUES ('compra_concluida', ?)`)
        .run(item.produto_id).catch(e => console.error('[analytics] compra_concluida:', e.message));
    }
  }

  return resultado.novoStatus;
}

// Traduz o status bruto do Mercado Pago para o status interno e aplica —
// usado pelo webhook e pela reconciliacao manual (routes/gestao_pedidos.js).
async function aplicarStatusPagamento(pedidoId, statusMP, paymentId) {
  const pedido = await db.prepare('SELECT status FROM pedidos WHERE id = ?').get(pedidoId);
  if (!pedido) return null;

  let novoStatus = pedido.status;
  if (statusMP === 'approved') novoStatus = 'pago';
  else if (statusMP === 'rejected') novoStatus = 'cancelado';
  else if (statusMP === 'pending' || statusMP === 'in_process') novoStatus = 'aguardando_pagamento';

  return definirStatusPedido(pedidoId, novoStatus, { paymentId });
}

module.exports = { definirStatusPedido, aplicarStatusPagamento, devolverEstoquePedido };
