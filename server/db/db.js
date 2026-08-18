const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const { seed } = require('./seed');
const { migrar } = require('./migrate');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'estancia.db');
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
