// Integracao com Mercado Pago (Checkout Pro) - cartao de credito, debito e Pix
// tudo processado na conta Mercado Pago da loja.
//
// Para ativar de verdade: crie um Access Token de producao em
// https://www.mercadopago.com.br/developers/panel e configure a variavel de
// ambiente MERCADOPAGO_ACCESS_TOKEN (veja server/.env.example).
// Sem essa variavel, o site funciona normalmente mas o checkout online fica
// desativado e o pedido é registrado como "combinar pagamento via WhatsApp".

let mpClient = null;
let Preference = null;
let Payment = null;

function configurado() {
  return !!process.env.MERCADOPAGO_ACCESS_TOKEN;
}

function getClient() {
  if (!configurado()) return null;
  if (!mpClient) {
    const { MercadoPagoConfig, Preference: Pref, Payment: Pay } = require('mercadopago');
    mpClient = new MercadoPagoConfig({ accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN });
    Preference = Pref;
    Payment = Pay;
  }
  return mpClient;
}

// Prazo de pagamento do link: 1h. O pedido guarda esse mesmo instante em
// pedidos.expira_em (ver routes/pedidos.js), entao os dois vencem juntos — o
// Mercado Pago recusa o pagamento no proprio checkout dele depois desse prazo,
// e o sweep de expiracao (server/utils/expiracao.js) marca o pedido como
// "Desistência" no mesmo momento.
const VALIDADE_LINK_MS = 60 * 60 * 1000;

async function criarPreferencia(pedido, itens, baseUrl) {
  const client = getClient();
  if (!client) return null;

  // Com desconto, o Mercado Pago nao aceita item negativo: mandamos uma
  // unica linha ja com o valor final. Sem desconto, vai item a item.
  const temDesconto = (pedido.valor_desconto || 0) > 0;
  const itensMp = temDesconto
    ? [{
        title: `Pedido ${pedido.codigo || pedido.id} (cupom ${pedido.cupom || 'aplicado'})`,
        quantity: 1,
        unit_price: pedido.valor_final,
        currency_id: 'BRL'
      }]
    : itens.map(i => ({
        title: i.nome_produto || i.produto_nome,
        quantity: i.quantidade,
        unit_price: i.preco_unitario,
        currency_id: 'BRL'
      }));

  const agora = new Date();
  const expiraEm = new Date(agora.getTime() + VALIDADE_LINK_MS);

  const preference = new Preference(client);
  const resposta = await preference.create({
    body: {
      items: itensMp,
      payer: { name: pedido.nome_cliente, email: pedido.email_cliente || undefined },
      external_reference: String(pedido.id),
      back_urls: {
        success: `${baseUrl}/pedido-confirmado.html?pedido=${pedido.id}`,
        pending: `${baseUrl}/pedido-confirmado.html?pedido=${pedido.id}`,
        failure: `${baseUrl}/checkout.html?falha=1`
      },
      auto_return: 'approved',
      notification_url: `${baseUrl}/api/pagamento/webhook`,
      expires: true,
      expiration_date_from: agora.toISOString(),
      expiration_date_to: expiraEm.toISOString()
    }
  });
  // `expiraEm` calculado aqui (nao lido de volta da resposta do MP) para
  // garantir que o pedido no nosso banco vence exatamente junto com o link.
  return { ...resposta, expiraEm: expiraEm.toISOString() };
}

async function consultarPagamento(paymentId) {
  const client = getClient();
  if (!client) return null;
  const payment = new Payment(client);
  return payment.get({ id: paymentId });
}

// O SDK do Mercado Pago (RestClient.fetch) joga fora o corpo de erro da API
// direto — `throw await response.json()` — entao o que cai no catch NAO e' um
// Error (nao tem stack, e .message pode nem existir dependendo do formato do
// erro). Aqui a gente monta um texto legivel a partir do que a API mandou
// (message/error/cause), com JSON bruto como ultimo recurso, pra' guardar em
// pedidos.erro_pagamento e o superadmin conseguir ver a causa real sem
// precisar de acesso ao log do servidor.
function detalheErroMp(e) {
  if (e && typeof e === 'object') {
    const causas = Array.isArray(e.cause)
      ? e.cause.map(c => (c && (c.description || c.code)) || JSON.stringify(c)).join('; ')
      : null;
    const partes = [e.message, e.error, causas].filter(Boolean);
    if (partes.length) return partes.join(' — ');
    try { return JSON.stringify(e); } catch { /* segue pro fallback */ }
  }
  return String((e && e.message) || e || 'Erro desconhecido.');
}

module.exports = { configurado, criarPreferencia, consultarPagamento, detalheErroMp };
