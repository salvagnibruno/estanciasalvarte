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

// .trim() de proposito: colar o token num campo de variavel de ambiente
// (Render, Fly, etc.) facilmente entra com um espaco ou quebra de linha
// grudado, e o header "Authorization: Bearer <token>" vira invalido sem
// nenhum aviso visivel — a API do Mercado Pago devolve so um 403 generico
// ("At least one policy returned UNAUTHORIZED"), sem indicar o motivo.
function tokenConfigurado() {
  return (process.env.MERCADOPAGO_ACCESS_TOKEN || '').trim();
}

function configurado() {
  return !!tokenConfigurado();
}

function getClient() {
  const token = tokenConfigurado();
  if (!token) return null;
  if (!mpClient) {
    const { MercadoPagoConfig, Preference: Pref, Payment: Pay } = require('mercadopago');
    mpClient = new MercadoPagoConfig({ accessToken: token });
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

// Payer completo (nome/sobrenome separados, telefone com DDD, CPF) — a
// documentacao do Mercado Pago recomenda mandar isso pra' agilizar o
// checkout, e pagamento no Brasil (Pix em especial) tem exigencia crescente
// de identificacao do pagador para compliance. So' usamos dado que o
// checkout ja' coleta (nunca inventamos nada).
function payerDoPedido(pedido) {
  const partesNome = String(pedido.nome_cliente || '').trim().split(/\s+/).filter(Boolean);
  const foneDigitos = String(pedido.telefone_cliente || '').replace(/\D/g, '');
  const cpfDigitos = String(pedido.cpf_cliente || '').replace(/\D/g, '');
  return {
    name: partesNome[0] || undefined,
    surname: partesNome.slice(1).join(' ') || undefined,
    email: pedido.email_cliente || undefined,
    phone: foneDigitos.length >= 10 ? { area_code: foneDigitos.slice(0, 2), number: foneDigitos.slice(2) } : undefined,
    identification: cpfDigitos.length === 11 ? { type: 'CPF', number: cpfDigitos } : undefined
  };
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

  const agora = new Date();
  const expiraEm = new Date(agora.getTime() + VALIDADE_LINK_MS);

  const preference = new Preference(client);
  const resposta = await preference.create({
    body: {
      items: itensMp,
      payer: payerDoPedido(pedido),
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
// "At least one policy returned UNAUTHORIZED" / PA_UNAUTHORIZED_RESULT_FROM_POLICIES
// e' um 403 generico do "policy agent" do proprio Mercado Pago — nao diz o
// motivo, mas na pratica costuma ser token de PRODUCAO invalido/revogado (ou
// colado com espaco/quebra de linha a mais) ou a conta da loja ainda incompleta/
// nao verificada no Mercado Pago (falta cadastro bancario, documento, etc.).
// Nenhum dos dois da' pra' corrigir por codigo — o dono da loja precisa checar
// no proprio painel do Mercado Pago.
const DICA_POLICY_UNAUTHORIZED = 'Isto costuma acontecer quando o Access Token '
  + 'de produção está errado/revogado ou o cadastro da loja no Mercado Pago '
  + 'ainda não está completo (verificação de identidade/conta bancária). '
  + 'Gere um novo token de PRODUÇÃO em mercadopago.com.br/developers/panel e confira '
  + 'se a conta não tem pendência de verificação.';

function detalheErroMp(e) {
  let texto;
  if (e && typeof e === 'object') {
    const causas = Array.isArray(e.cause)
      ? e.cause.map(c => (c && (c.description || c.code)) || JSON.stringify(c)).join('; ')
      : null;
    // status/code/blocked_by vem no PROPRIO corpo JSON quando a API devolve
    // (o SDK joga fora o objeto Response — a gente nao tem acesso ao status
    // HTTP separado do fetch, so' ao que a API escreveu dentro do corpo).
    const partes = [
      e.status ? `HTTP ${e.status}` : null,
      e.message,
      e.error,
      e.code,
      e.blocked_by ? `bloqueado por: ${e.blocked_by}` : null,
      causas
    ].filter(Boolean);
    if (partes.length) texto = partes.join(' — ');
    else { try { texto = JSON.stringify(e); } catch { /* segue pro fallback */ } }
  }
  if (!texto) texto = String((e && e.message) || e || 'Erro desconhecido.');
  if (/policy|unauthorized/i.test(texto)) texto += ' — ' + DICA_POLICY_UNAUTHORIZED;
  return texto;
}

module.exports = { configurado, criarPreferencia, consultarPagamento, detalheErroMp };
