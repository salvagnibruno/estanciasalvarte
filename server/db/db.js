const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const { seed } = require('./seed');
const { migrar } = require('./migrate');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'estancia.db');

// Em produção (DB_PATH aponta para um volume persistente fora do repositório),
// a primeira subida encontra o volume vazio — copia o banco já versionado no
// repo (com catálogo, preços e cadastros atuais) para lá, uma única vez. Nas
// subidas seguintes o arquivo já existe no volume e não é mais tocado — o que
// for gravado em produção depois disso nunca é sobrescrito por um deploy novo.
if (process.env.DB_PATH && !fs.existsSync(DB_PATH)) {
  const bancoDoRepo = path.join(__dirname, 'estancia.db');
  if (fs.existsSync(bancoDoRepo)) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.copyFileSync(bancoDoRepo, DB_PATH);
    console.log(`[setup] Banco copiado do repositório para o volume persistente (${DB_PATH}).`);
  }
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// Ajusta bancos criados antes das colunas novas (clientes, cupom, destaque...).
const mudancas = migrar(db);
if (mudancas.length) console.log(`[migracao] ${mudancas.join(' | ')}`);

const seedResult = seed(db);
if (!seedResult.skipped) {
  console.log(`[seed] ${seedResult.categorias} categorias, ${seedResult.linhas} linhas e ${seedResult.total} produtos cadastrados.`);
}
// Nota: db/catalogo_pampeiro.js (linha masculina do catálogo do fornecedor)
// foi incorporado ao próprio db/seed.js na revisão do catálogo — não roda mais.

// Garante o usuario superadmin do dono da loja.
const SUPERADMIN_EMAIL = 'bruno.salvagni@gmail.com';
const existente = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(SUPERADMIN_EMAIL);
if (!existente) {
  const senhaInicial = process.env.SUPERADMIN_SENHA_INICIAL || 'TrocarSenha@2026';
  const hash = bcrypt.hashSync(senhaInicial, 10);
  db.prepare(`INSERT INTO usuarios (nome, email, senha_hash, papel, ativo) VALUES (?, ?, ?, 'superadmin', 1)`)
    .run('Bruno Salvagni', SUPERADMIN_EMAIL, hash);
  console.log('======================================================================');
  console.log(`[setup] Usuario superadmin criado: ${SUPERADMIN_EMAIL}`);
  console.log(`[setup] Senha inicial: ${senhaInicial}  (troque assim que possivel)`);
  console.log('======================================================================');
}

module.exports = db;
