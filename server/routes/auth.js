const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../db/db');
const { permissoesDe } = require('../middleware/auth');
const { enviarCodigoConfirmacao } = require('../utils/email');

function usuarioPublico(u) {
  return { id: u.id, nome: u.nome, email: u.email, telefone: u.telefone, papel: u.papel };
}

// O que vai para a tela: os dados da sessao + as permissoes efetivas de agora.
// As permissoes nao ficam na sessao de proposito — assim o painel enxerga a
// liberacao (ou a revogacao) do superadmin no proximo carregamento.
function usuarioComPermissoes(u) {
  return { ...u, permissoes: permissoesDe(u) };
}

const VALIDADE_CODIGO_MIN = 15;
const REENVIO_MIN_SEGUNDOS = 60;

function gerarCodigo() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function expiraEmDaqui(minutos) {
  return new Date(Date.now() + minutos * 60 * 1000).toISOString();
}

// Cadastro publico -> sempre cria papel 'cliente', pendente de confirmacao por
// e-mail. So' loga de verdade depois que o codigo enviado for confirmado
// (rota /confirmar) — isso e' o "primeiro acesso" pedido pela loja.
router.post('/registro', async (req, res) => {
  const { nome, email, senha, telefone } = req.body || {};
  if (!nome || !email || !senha) return res.status(400).json({ erro: 'Nome, e-mail e senha são obrigatórios.' });
  if (String(senha).length < 6) return res.status(400).json({ erro: 'A senha deve ter ao menos 6 caracteres.' });

  const emailLimpo = email.toLowerCase().trim();
  const existente = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(emailLimpo);
  if (existente && existente.email_verificado) {
    return res.status(409).json({ erro: 'Já existe uma conta com este e-mail.' });
  }

  const hash = bcrypt.hashSync(senha, 10);
  const codigo = gerarCodigo();
  const expiraEm = expiraEmDaqui(VALIDADE_CODIGO_MIN);
  const nomeLimpo = nome.trim();

  if (existente) {
    // Cadastro anterior nunca foi confirmado: atualiza os dados e manda um codigo novo.
    db.prepare(`UPDATE usuarios SET nome = ?, senha_hash = ?, telefone = ?,
        codigo_verificacao = ?, codigo_expira_em = ?, codigo_enviado_em = datetime('now') WHERE id = ?`)
      .run(nomeLimpo, hash, telefone || null, codigo, expiraEm, existente.id);
  } else {
    db.prepare(`INSERT INTO usuarios
        (nome, email, senha_hash, telefone, papel, ativo, email_verificado, codigo_verificacao, codigo_expira_em, codigo_enviado_em)
        VALUES (?, ?, ?, ?, 'cliente', 1, 0, ?, ?, datetime('now'))`)
      .run(nomeLimpo, emailLimpo, hash, telefone || null, codigo, expiraEm);
  }

  await enviarCodigoConfirmacao(emailLimpo, nomeLimpo, codigo);
  res.status(201).json({ pendente_confirmacao: true, email: emailLimpo });
});

// Confirma o codigo de 6 digitos enviado por e-mail e, so' entao, abre a sessao.
router.post('/confirmar', (req, res) => {
  const { email, codigo } = req.body || {};
  if (!email || !codigo) return res.status(400).json({ erro: 'Informe e-mail e código.' });

  const usuario = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(String(email).toLowerCase().trim());
  if (!usuario) return res.status(404).json({ erro: 'Conta não encontrada.' });
  if (usuario.email_verificado) return res.status(400).json({ erro: 'Esta conta já está confirmada. Faça login.' });
  if (!usuario.codigo_verificacao || String(codigo).trim() !== usuario.codigo_verificacao) {
    return res.status(400).json({ erro: 'Código incorreto.' });
  }
  if (!usuario.codigo_expira_em || new Date(usuario.codigo_expira_em) < new Date()) {
    return res.status(400).json({ erro: 'Código expirado. Peça um novo código.' });
  }

  db.prepare(`UPDATE usuarios SET email_verificado = 1, codigo_verificacao = NULL, codigo_expira_em = NULL WHERE id = ?`)
    .run(usuario.id);

  req.session.usuario = usuarioPublico(usuario);
  res.json(usuarioComPermissoes(req.session.usuario));
});

// Reenvia o codigo de confirmacao (com um pequeno intervalo minimo entre pedidos).
router.post('/reenviar-codigo', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ erro: 'Informe o e-mail.' });

  const usuario = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(String(email).toLowerCase().trim());
  if (!usuario) return res.status(404).json({ erro: 'Conta não encontrada.' });
  if (usuario.email_verificado) return res.status(400).json({ erro: 'Esta conta já está confirmada. Faça login.' });

  if (usuario.codigo_enviado_em) {
    const segundosDesdeUltimoEnvio = (Date.now() - new Date(usuario.codigo_enviado_em.replace(' ', 'T') + 'Z').getTime()) / 1000;
    const faltam = Math.ceil(REENVIO_MIN_SEGUNDOS - segundosDesdeUltimoEnvio);
    if (faltam > 0) return res.status(429).json({ erro: `Aguarde ${faltam}s para pedir um novo código.` });
  }

  const codigo = gerarCodigo();
  db.prepare(`UPDATE usuarios SET codigo_verificacao = ?, codigo_expira_em = ?, codigo_enviado_em = datetime('now') WHERE id = ?`)
    .run(codigo, expiraEmDaqui(VALIDADE_CODIGO_MIN), usuario.id);

  await enviarCodigoConfirmacao(usuario.email, usuario.nome, codigo);
  res.json({ ok: true });
});

router.post('/login', (req, res) => {
  const { email, senha } = req.body || {};
  if (!email || !senha) return res.status(400).json({ erro: 'Informe e-mail e senha.' });

  const usuario = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email.toLowerCase().trim());
  if (!usuario || !usuario.ativo) return res.status(401).json({ erro: 'Credenciais inválidas ou usuário inativo.' });

  // A senha e' checada ANTES de revelar se a conta esta' pendente de confirmacao —
  // senao a resposta vira um jeito de descobrir, sem saber a senha, se aquele
  // e-mail tem cadastro pendente.
  const ok = bcrypt.compareSync(senha, usuario.senha_hash);
  if (!ok) return res.status(401).json({ erro: 'Credenciais inválidas.' });

  if (!usuario.email_verificado) {
    return res.status(403).json({
      erro: 'Confirme seu e-mail antes de entrar. Enviamos um código no seu cadastro.',
      precisa_confirmar: true,
      email: usuario.email
    });
  }

  req.session.usuario = usuarioPublico(usuario);
  res.json(usuarioComPermissoes(req.session.usuario));
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', (req, res) => {
  res.json(req.session.usuario ? usuarioComPermissoes(req.session.usuario) : null);
});

module.exports = router;
