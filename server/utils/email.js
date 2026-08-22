// Envio de e-mail transacional (código de confirmação de cadastro, avisos de
// pedido, nota fiscal) via SMTP.
//
// Para ativar de verdade: preencha EMAIL_HOST/EMAIL_PORT/EMAIL_USER/EMAIL_PASS
// no .env (veja server/.env.example — tem o passo a passo para Gmail).
// Sem essas variáveis, o site funciona normalmente: cada função abaixo apenas
// loga no console em vez de enviar, então dá para testar o fluxo inteiro em
// desenvolvimento sem configurar SMTP.

// Caixa de entrada da loja para avisos de pedido novo — independente de quais
// contas tenham papel 'superadmin' (login), pode ser trocada via env sem mexer
// no código.
const EMAIL_AVISO_NOVO_PEDIDO = process.env.EMAIL_AVISO_PEDIDOS || 'estanciasalvarte@gmail.com';

let transportador = null;

function configurado() {
  return !!(process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS);
}

function getTransportador() {
  if (!configurado()) return null;
  if (!transportador) {
    const nodemailer = require('nodemailer');
    transportador = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: parseInt(process.env.EMAIL_PORT, 10) || 587,
      secure: parseInt(process.env.EMAIL_PORT, 10) === 465,
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    });
  }
  return transportador;
}

async function enviarCodigoConfirmacao(destinatario, nome, codigo) {
  if (!configurado()) {
    console.log(`[email] SMTP não configurado — código de confirmação para ${destinatario}: ${codigo}`);
    return { enviado: false, motivo: 'smtp_nao_configurado' };
  }

  const remetente = process.env.EMAIL_FROM || process.env.EMAIL_USER;
  const transporte = getTransportador();
  try {
    await transporte.sendMail({
      from: remetente,
      to: destinatario,
      subject: 'Confirme seu cadastro — Estância Salvarte',
      text: `Olá, ${nome || ''}!\n\nSeu código de confirmação é: ${codigo}\n\nEle vale por 15 minutos. Se você não pediu este cadastro, pode ignorar este e-mail.`,
      html: `<p>Olá, ${nome ? String(nome).replace(/[<>]/g, '') : ''}!</p>
             <p>Seu código de confirmação é:</p>
             <p style="font-size:28px;font-weight:bold;letter-spacing:4px;">${codigo}</p>
             <p>Ele vale por 15 minutos. Se você não pediu este cadastro, pode ignorar este e-mail.</p>`
    });
    return { enviado: true };
  } catch (e) {
    console.error('[email] erro ao enviar código de confirmação:', e.message);
    return { enviado: false, motivo: 'falha_envio' };
  }
}

function escaparHtml(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function itemTexto(i) {
  return `${i.quantidade}x ${i.nome_produto || i.produto_nome}${i.tamanho ? ' - ' + i.tamanho : ''}${i.cor ? ' - ' + i.cor : ''}`;
}

function itensParaTexto(itens) {
  return (itens || []).map(itemTexto).join('\n');
}

function itensParaHtml(itens) {
  return `<ul>${(itens || []).map(i => `<li>${escaparHtml(itemTexto(i))}</li>`).join('')}</ul>`;
}

function formatarMoeda(valor) {
  return (valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Aviso à loja de que chegou um pedido novo — disparado logo depois que o
// pedido e' gravado (routes/pedidos.js), qualquer que seja a forma de
// pagamento escolhida. `baseUrl` (protocolo+host da requisicao) monta o link
// direto pro painel: se o navegador da loja ja' estiver logado, cai direto na
// aba Pedidos; senao, o login.html manda pra' la' sozinho depois de entrar
// (ver public/js/admin.js e public/login.html, ambos com suporte a ?next=).
async function enviarAvisoNovoPedido(pedido, itens, baseUrl) {
  const destinatarios = [EMAIL_AVISO_NOVO_PEDIDO];
  const linkPainel = baseUrl ? `${baseUrl}/login.html?next=${encodeURIComponent('/superadmin/index.html#pedidos')}` : null;

  if (!configurado()) {
    console.log(`[email] SMTP não configurado — novo pedido ${pedido.codigo || pedido.id} (${pedido.nome_cliente}) não notificado por e-mail.`);
    return { enviado: false, motivo: 'smtp_nao_configurado' };
  }

  const remetente = process.env.EMAIL_FROM || process.env.EMAIL_USER;
  const transporte = getTransportador();
  try {
    await transporte.sendMail({
      from: remetente,
      to: destinatarios.join(', '),
      subject: `Novo pedido ${pedido.codigo || pedido.id} — Estância Salvarte`,
      text: `Chegou um pedido novo (código ${pedido.codigo || pedido.id}) no valor de ${formatarMoeda(pedido.valor_final)}.\n\nCliente: ${pedido.nome_cliente}\nTelefone: ${pedido.telefone_cliente || '-'}\nForma de pagamento: ${pedido.forma_pagamento || '-'}${pedido.parcelas ? ` (${pedido.parcelas}x${pedido.parcelas_com_juros ? ', com juros' : ', sem juros'})` : ''}\n\nItens:\n${itensParaTexto(itens)}\n${linkPainel ? `\nClique aqui para ver os detalhes: ${linkPainel}` : ''}`,
      html: `<p>Chegou um pedido novo (código <strong>${escaparHtml(pedido.codigo || pedido.id)}</strong>) no valor de <strong>${formatarMoeda(pedido.valor_final)}</strong>.</p>
             <p><strong>Cliente:</strong> ${escaparHtml(pedido.nome_cliente)}<br>
             <strong>Telefone:</strong> ${escaparHtml(pedido.telefone_cliente || '-')}<br>
             <strong>Forma de pagamento:</strong> ${escaparHtml(pedido.forma_pagamento || '-')}${pedido.parcelas ? ` (${pedido.parcelas}x${pedido.parcelas_com_juros ? ', com juros' : ', sem juros'})` : ''}</p>
             <p><strong>Itens:</strong></p>${itensParaHtml(itens)}
             ${linkPainel ? `<p><a href="${linkPainel}">Clique aqui para ver os detalhes</a></p>` : ''}`
    });
    return { enviado: true };
  } catch (e) {
    console.error('[email] erro ao enviar aviso de novo pedido:', e.message);
    return { enviado: false, motivo: 'falha_envio' };
  }
}

// Confirmação ao cliente logo após finalizar a compra (pedido gravado, com
// código) — disparada em routes/pedidos.js:checkout, independente de status
// de pagamento. `mensagem` é o mesmo texto mostrado na tela de confirmação
// (ver MSG_LINK_EM_BREVE/MSG_COMBINAR em routes/pedidos.js): enxuto de
// propósito, sem falar de estoque — isso fica só no painel interno.
async function enviarConfirmacaoPedido(pedido, itens, { mensagem } = {}) {
  if (!pedido.email_cliente) return { enviado: false, motivo: 'sem_email_cliente' };
  if (!configurado()) {
    console.log(`[email] SMTP não configurado — confirmação do pedido ${pedido.codigo} não enviada para ${pedido.email_cliente}.`);
    return { enviado: false, motivo: 'smtp_nao_configurado' };
  }

  const parcelasTexto = pedido.parcelas
    ? `${pedido.parcelas}x de ${formatarMoeda(pedido.valor_final / pedido.parcelas)}${pedido.parcelas_com_juros ? ' (+ taxa de juros)' : pedido.parcelas > 1 ? ' (Sem juros)' : ' - À vista (Sem juros)'}`
    : null;

  const remetente = process.env.EMAIL_FROM || process.env.EMAIL_USER;
  const transporte = getTransportador();
  try {
    await transporte.sendMail({
      from: remetente,
      to: pedido.email_cliente,
      subject: `Pedido ${pedido.codigo} recebido — Estância Salvarte`,
      text: `Olá, ${pedido.nome_cliente}!\n\nRecebemos seu pedido.\n\nPedido: ${pedido.codigo}\nValor total: ${formatarMoeda(pedido.valor_final)}${parcelasTexto ? `\nParcelamento: ${parcelasTexto}` : ''}\n\nItens:\n${itensParaTexto(itens)}\n\n${mensagem || ''}\n\nObrigado pela compra!`,
      html: `<p>Olá, ${escaparHtml(pedido.nome_cliente)}!</p>
             <p>Recebemos seu pedido. 🎉</p>
             <p><strong>Pedido:</strong> ${escaparHtml(pedido.codigo)}<br>
             <strong>Valor total:</strong> ${formatarMoeda(pedido.valor_final)}
             ${parcelasTexto ? `<br><strong>Parcelamento:</strong> ${escaparHtml(parcelasTexto)}` : ''}</p>
             <p><strong>Itens:</strong></p>${itensParaHtml(itens)}
             ${mensagem ? `<p>${escaparHtml(mensagem)}</p>` : ''}
             <p>Obrigado pela compra!</p>`
    });
    return { enviado: true };
  } catch (e) {
    console.error('[email] erro ao enviar confirmação de pedido:', e.message);
    return { enviado: false, motivo: 'falha_envio' };
  }
}

// Confirmação ao cliente quando o pagamento é aprovado — disparada dentro de
// aplicarStatusPagamento (server/utils/pagamentoStatus.js), na transição
// para status = 'pago'.
async function enviarConfirmacaoPagamento(pedido, itens) {
  if (!pedido.email_cliente) return { enviado: false, motivo: 'sem_email_cliente' };
  if (!configurado()) {
    console.log(`[email] SMTP não configurado — confirmação de pagamento do pedido ${pedido.codigo} não enviada para ${pedido.email_cliente}.`);
    return { enviado: false, motivo: 'smtp_nao_configurado' };
  }

  const remetente = process.env.EMAIL_FROM || process.env.EMAIL_USER;
  const transporte = getTransportador();
  try {
    await transporte.sendMail({
      from: remetente,
      to: pedido.email_cliente,
      subject: `Pagamento confirmado — pedido ${pedido.codigo} — Estância Salvarte`,
      text: `Olá, ${pedido.nome_cliente}!\n\nSeu pagamento foi confirmado.\n\nPedido: ${pedido.codigo}\nValor pago: ${formatarMoeda(pedido.valor_final)}\n\nItens:\n${itensParaTexto(itens)}\n\nObrigado pela compra!`,
      html: `<p>Olá, ${escaparHtml(pedido.nome_cliente)}!</p>
             <p>Seu pagamento foi confirmado. ✅</p>
             <p><strong>Pedido:</strong> ${escaparHtml(pedido.codigo)}<br>
             <strong>Valor pago:</strong> ${formatarMoeda(pedido.valor_final)}</p>
             <p><strong>Itens:</strong></p>${itensParaHtml(itens)}
             <p>Obrigado pela compra!</p>`
    });
    return { enviado: true };
  } catch (e) {
    console.error('[email] erro ao enviar confirmação de pagamento:', e.message);
    return { enviado: false, motivo: 'falha_envio' };
  }
}

// Envio da nota fiscal (NFC-e) ao cliente — disparado só quando o lojista
// clica em "Enviar nota fiscal ao cliente" no painel (ação manual, separada
// do upload do PDF — ver routes/gestao_pedidos.js).
async function enviarNotaFiscal(pedido, caminhoPdf) {
  if (!pedido.email_cliente) return { enviado: false, motivo: 'sem_email_cliente' };
  if (!configurado()) {
    console.log(`[email] SMTP não configurado — nota fiscal do pedido ${pedido.codigo} não enviada (arquivo em ${caminhoPdf}).`);
    return { enviado: false, motivo: 'smtp_nao_configurado' };
  }

  const remetente = process.env.EMAIL_FROM || process.env.EMAIL_USER;
  const transporte = getTransportador();
  try {
    await transporte.sendMail({
      from: remetente,
      to: pedido.email_cliente,
      subject: `Nota fiscal do pedido ${pedido.codigo} — Estância Salvarte`,
      text: `Olá, ${pedido.nome_cliente}!\n\nSegue em anexo a nota fiscal (NFC-e) do seu pedido ${pedido.codigo}.`,
      html: `<p>Olá, ${escaparHtml(pedido.nome_cliente)}!</p><p>Segue em anexo a nota fiscal (NFC-e) do seu pedido ${escaparHtml(pedido.codigo)}.</p>`,
      attachments: [{ filename: `nota-fiscal-${pedido.codigo}.pdf`, path: caminhoPdf }]
    });
    return { enviado: true };
  } catch (e) {
    console.error('[email] erro ao enviar nota fiscal:', e.message);
    return { enviado: false, motivo: 'falha_envio' };
  }
}

module.exports = {
  configurado, enviarCodigoConfirmacao,
  enviarAvisoNovoPedido, enviarConfirmacaoPedido, enviarConfirmacaoPagamento, enviarNotaFiscal
};
