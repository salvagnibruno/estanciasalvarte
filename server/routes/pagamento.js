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
      notification_url: `${baseUrl}/api/pagamento/webhook`
    }
  });
  return resposta;
}

async function consultarPagamento(paymentId) {
  const client = getClient();
  if (!client) return null;
  const payment = new Payment(client);
  return payment.get({ id: paymentId });
}

module.exports = { configurado, criarPreferencia, consultarPagamento };
