// Envio de e-mail transacional (código de confirmação de cadastro) via SMTP.
//
// Para ativar de verdade: preencha EMAIL_HOST/EMAIL_PORT/EMAIL_USER/EMAIL_PASS
// no .env (veja server/.env.example — tem o passo a passo para Gmail).
// Sem essas variáveis, o site funciona normalmente: o código de confirmação
// aparece no console/log do servidor em vez de ser enviado por e-mail, então
// dá para testar o fluxo inteiro em desenvolvimento sem configurar SMTP.

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

module.exports = { configurado, enviarCodigoConfirmacao };
