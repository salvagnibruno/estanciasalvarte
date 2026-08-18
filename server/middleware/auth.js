const db = require('../db/db');
const { CHAVES, normalizarPermissoes } = require('../permissoes');

function usuarioAtual(req, res, next) {
  res.locals.usuario = req.session.usuario || null;
  next();
}

function exigirLogin(req, res, next) {
  if (!req.session.usuario) return res.status(401).json({ erro: 'Login necessário.' });
  next();
}

function exigirPapel(...papeis) {
  return (req, res, next) => {
    const usuario = req.session.usuario;
    if (!usuario) return res.status(401).json({ erro: 'Login necessário.' });
    if (!papeis.includes(usuario.papel)) return res.status(403).json({ erro: 'Acesso não autorizado para este perfil.' });
    next();
  };
}

// Permissoes efetivas de um usuario. Lidas do banco a cada consulta (e nao da
// sessao) para que uma revogacao do superadmin valha na hora, sem novo login.
function permissoesDe(usuario) {
  if (!usuario) return [];
  if (usuario.papel === 'superadmin') return [...CHAVES];
  const gravadas = db.prepare('SELECT permissao FROM usuario_permissoes WHERE usuario_id = ?')
    .all(usuario.id).map(r => r.permissao);
  return normalizarPermissoes(gravadas);
}

function temPermissao(usuario, chave) {
  return permissoesDe(usuario).includes(chave);
}

// Protege uma rota por permissao concedida. Superadmin passa sempre.
function exigirPermissao(chave) {
  return (req, res, next) => {
    const usuario = req.session.usuario;
    if (!usuario) return res.status(401).json({ erro: 'Login necessário.' });
    if (usuario.papel === 'superadmin') return next();
    if (usuario.papel !== 'admin') return res.status(403).json({ erro: 'Acesso não autorizado para este perfil.' });
    if (!temPermissao(usuario, chave)) {
      return res.status(403).json({ erro: 'Seu acesso não tem esta permissão. Solicite a liberação ao superadmin.' });
    }
    next();
  };
}

module.exports = { usuarioAtual, exigirLogin, exigirPapel, permissoesDe, temPermissao, exigirPermissao };
