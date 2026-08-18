// Dados de contato/identidade do site quando o superadmin já personalizou
// algo pelo painel. Sem nenhuma personalização salva, vale o padrão de
// server/loja.js (o mesmo de sempre) — assim o site nunca fica "sem nada"
// so' porque ninguém mexeu na tela ainda.
const db = require('../db/db');
const LOJA_PADRAO = require('../loja');

const CHAVE = 'site_contato';

function somenteDigitos(v) {
  return String(v || '').replace(/\D/g, '');
}

function handleInstagram(v) {
  return String(v || '').trim()
    .replace(/^@/, '')
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/\/+$/, '');
}

// Recebe os campos crus do formulário e devolve o objeto completo (com os
// links/labels derivados), no mesmo formato de server/loja.js.
function montarContato({ telefone, whatsapp, instagram, email, logo } = {}) {
  const telefoneDigitos = somenteDigitos(telefone);
  const whatsappDigitos = somenteDigitos(whatsapp);
  const handle = handleInstagram(instagram);

  return {
    telefone: telefone ? String(telefone).trim() : null,
    telefoneLink: telefoneDigitos ? `tel:+55${telefoneDigitos}` : null,
    whatsapp: whatsappDigitos ? `https://wa.me/55${whatsappDigitos}` : null,
    whatsappLabel: whatsapp ? String(whatsapp).trim() : null,
    instagram: handle ? `https://instagram.com/${handle}` : null,
    instagramLabel: handle ? `@${handle}` : null,
    email: email ? String(email).trim() : null,
    logo: logo || null
  };
}

function obterContatoSalvo() {
  const row = db.prepare('SELECT valor FROM configuracoes WHERE chave = ?').get(CHAVE);
  return row ? JSON.parse(row.valor) : null;
}

function gravar(contato) {
  db.prepare(`INSERT INTO configuracoes (chave, valor) VALUES (?, ?)
    ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`).run(CHAVE, JSON.stringify(contato));
  return contato;
}

// Dados completos que o site deve usar agora: nome/assinatura/descrição/favicon
// continuam sempre do loja.js (não têm tela de edição); contato e logo vêm do
// que foi salvo, uma vez que algo já tenha sido salvo.
function obterLoja() {
  const salvo = obterContatoSalvo();
  return salvo ? { ...LOJA_PADRAO, ...salvo } : LOJA_PADRAO;
}

function salvarContato(camposCrus) {
  // Reaproveita a logo atual: esta tela nao mexe nela (troca de logo tem rota propria).
  const atual = obterContatoSalvo();
  const contato = montarContato({ ...camposCrus, logo: atual ? atual.logo : LOJA_PADRAO.logo });
  return gravar(contato);
}

function salvarLogo(logoUrl) {
  const atual = obterContatoSalvo() || montarContato(LOJA_PADRAO);
  return gravar({ ...atual, logo: logoUrl });
}

module.exports = { obterLoja, salvarContato, salvarLogo };
