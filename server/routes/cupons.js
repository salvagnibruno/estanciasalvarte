const express = require('express');
const router = express.Router();
const db = require('../db/db');
const { obterCarrinhoAtual, montarRespostaCarrinho } = require('./carrinho');
const { somenteDigitos } = require('../utils/cpf');

// Avalia um cupom contra os itens do carrinho (e nao contra um total solto
// vindo da tela): so' assim da' para restringir o desconto a produtos
// especificos, e o valor final nao depende do que o cliente mandar.
// `itens` no formato de carrinho_itens: { produto_id, quantidade, preco_unitario, ... }
// `cpfBruto` so' e' necessario para cupons com limite_tipo = 'por_cliente'.
async function avaliarCupom(codigoBruto, itens, cpfBruto) {
  const codigo = (codigoBruto || '').trim().toUpperCase();
  if (!codigo) return { valido: false, codigo: null, desconto: 0, motivo: 'Informe um cupom.' };

  const cupom = await db.prepare('SELECT * FROM cupons WHERE UPPER(codigo) = ?').get(codigo);
  if (!cupom) return { valido: false, codigo, desconto: 0, motivo: 'Cupom não encontrado.' };
  if (!cupom.ativo) return { valido: false, codigo, desconto: 0, motivo: 'Este cupom não está mais ativo.' };

  const hoje = new Date().toISOString().slice(0, 10);
  if (cupom.validade_inicio && hoje < cupom.validade_inicio) {
    return { valido: false, codigo, desconto: 0, motivo: 'Este cupom ainda não é válido.' };
  }
  if (cupom.validade && hoje > cupom.validade) {
    return { valido: false, codigo, desconto: 0, motivo: 'Cupom vencido.' };
  }

  if (cupom.limite_tipo === 'por_cliente') {
    // Limite conta por CPF, nao pelo total de pedidos: um cupom com "2" aqui
    // pode ser usado por 100 clientes diferentes, 2 vezes cada um.
    const cpfLimpo = somenteDigitos(cpfBruto);
    if (!cpfLimpo) {
      return { valido: false, codigo, desconto: 0, motivo: 'Informe o CPF antes de aplicar este cupom.' };
    }
    if (cupom.limite_usos !== null) {
      const usosDoCliente = (await db.prepare(`
        SELECT COUNT(*) AS total FROM pedidos
        WHERE UPPER(cupom) = ? AND cpf_cliente = ? AND status NOT IN ('cancelado', 'desistencia')
      `).get(codigo, cpfLimpo)).total;
      if (usosDoCliente >= cupom.limite_usos) {
        return { valido: false, codigo, desconto: 0, motivo: 'Você já utilizou este cupom o número máximo de vezes permitido.' };
      }
    }
  } else if (cupom.limite_usos !== null && cupom.usos_atuais >= cupom.limite_usos) {
    return { valido: false, codigo, desconto: 0, motivo: 'Este cupom já atingiu o limite de usos.' };
  }

  // Sem produtos vinculados = vale para o carrinho inteiro. Com produtos
  // vinculados, o desconto incide so' sobre o subtotal desses itens.
  const produtosDoCupom = (await db.prepare('SELECT produto_id FROM cupom_produtos WHERE cupom_id = ?').all(cupom.id)).map(r => r.produto_id);
  const listaItens = Array.isArray(itens) ? itens : [];
  const itensAplicaveis = produtosDoCupom.length
    ? listaItens.filter(i => produtosDoCupom.includes(i.produto_id))
    : listaItens;
  const base = Math.max(0, itensAplicaveis.reduce((s, i) => s + i.preco_unitario * i.quantidade, 0));

  if (produtosDoCupom.length && base === 0) {
    return { valido: false, codigo, desconto: 0, motivo: 'Este cupom não se aplica aos produtos do seu carrinho.' };
  }

  const bruto = cupom.tipo === 'percentual' ? base * (cupom.valor / 100) : cupom.valor;
  const desconto = Math.round(Math.min(Math.max(bruto, 0), base) * 100) / 100;

  return {
    valido: desconto > 0,
    codigo: cupom.codigo,
    desconto,
    motivo: desconto > 0 ? null : 'Cupom sem desconto aplicável a este carrinho.'
  };
}

// Conta mais um uso do cupom. Chamada só depois que o pedido é gravado de
// verdade (routes/pedidos.js), nunca na validação/preview.
async function registrarUsoCupom(codigo) {
  if (!codigo) return;
  await db.prepare('UPDATE cupons SET usos_atuais = usos_atuais + 1 WHERE UPPER(codigo) = ?').run(String(codigo).toUpperCase());
}

// GET /api/cupons/validar?codigo=BEMVINDO10&cpf=00000000000 — usa o carrinho de
// verdade da sessão/usuário. `cpf` só é obrigatório para cupons "por cliente".
router.get('/validar', async (req, res) => {
  const carrinho = await obterCarrinhoAtual(req);
  const { itens } = await montarRespostaCarrinho(carrinho);
  res.json(await avaliarCupom(req.query.codigo, itens, req.query.cpf));
});

module.exports = { router, avaliarCupom, registrarUsoCupom };
