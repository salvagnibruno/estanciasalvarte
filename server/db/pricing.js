// Regra de precificacao da Estancia Salvarte (definida pelo superadmin/dono):
//   custo <= 50.00           -> markup de 55%
//   50.01 <= custo <= 80.00  -> markup de 50%
//   80.01 <= custo <= 120.00 -> markup de 45%
//   custo > 120.00           -> markup de 40%
function markupParaCusto(custo) {
  if (custo <= 50) return 0.55;
  if (custo <= 80) return 0.50;
  if (custo <= 120) return 0.45;
  return 0.40;
}

function calcularPrecoVenda(custo) {
  const percentual = markupParaCusto(custo);
  const preco = custo * (1 + percentual);
  return { percentual, preco: Math.round(preco * 100) / 100 };
}

module.exports = { markupParaCusto, calcularPrecoVenda };
