const path = require('path');
const fs = require('fs');
const { createClient } = require('@libsql/client');
const bcrypt = require('bcryptjs');
const { seed } = require('./seed');
const { migrar } = require('./migrate');

// TURSO_DATABASE_URL/TURSO_AUTH_TOKEN (produção, ver server/.env.example) —
// sem eles, usa um arquivo local (bom para desenvolvimento, não precisa de
// conta Turso). "file:" é um banco SQLite comum no disco, lido pelo mesmo
// driver libsql.
const TURSO_URL = process.env.TURSO_DATABASE_URL;
const isRemoto = !!TURSO_URL;

// RÉPLICA EMBARCADA: em produção, ler direto do Turso (client 100% remoto)
// fazia CADA consulta (categorias, vitrine, carrinho, painel...) esperar uma
// viagem de rede até o banco — isso é o que deixava o site inteiro lento,
// principalmente em conexão móvel, já que uma única página faz várias
// consultas em sequência. A "embedded replica" do libsql resolve isso: mantém
// um arquivo SQLite local (replica.db), sincronizado em segundo plano com o
// Turso. Leituras passam a ser locais (instantâneas); só a sincronização e as
// escritas tocam a rede. Ver syncIfRemoto(), chamado após cada escrita.
const REPLICA_PATH = path.join(__dirname, 'replica.db');
const client = isRemoto
  ? createClient({
      url: `file:${REPLICA_PATH}`,
      syncUrl: TURSO_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
      syncInterval: 60 // sincroniza sozinho a cada 60s, além da sincronização após escritas
    })
  // DB_PATH (ver fly.toml): aponta para o volume persistente (/data) em
  // hospedagens como Fly.io. Sem ela, cai no arquivo dentro do repositório —
  // correto só para desenvolvimento local. IMPORTANTE: antes desta correção,
  // DB_PATH era definida no fly.toml mas nunca lida aqui, então o banco vivia
  // dentro do contêiner e era descartado a cada deploy/reinício (schema,
  // migração e catálogo inteiro eram refeitos do zero toda vez — lento e, na
  // prática, apagava pedidos e alterações feitas em produção).
  : createClient({ url: `file:${process.env.DB_PATH || path.join(__dirname, 'estancia.db')}` });

// Chamado depois de toda escrita (INSERT/UPDATE/DELETE) para que a réplica
// local reflita a mudança imediatamente — sem isso, uma leitura logo após
// escrever (ex.: "meu pedido foi criado, mostra ele na tela") poderia não
// encontrar o dado ainda, porque a réplica só sincronizaria no próximo
// intervalo de 60s.
async function syncIfRemoto() {
  if (isRemoto) await client.sync();
}

// Em produção (banco fora do repositório) e ainda sem nenhuma tabela, importa
// o estancia.db versionado no repo — assim o primeiro deploy já sobe com
// catálogo, preços e cadastros atuais. Só roda uma vez: nas subidas seguintes
// a tabela usuarios já existe e nada é sobrescrito.
async function importarBancoDoRepoSeVazio() {
  if (!process.env.TURSO_DATABASE_URL) return; // já é o arquivo local — nada a importar
  const bancoDoRepo = path.join(__dirname, 'estancia.db');
  if (!fs.existsSync(bancoDoRepo)) return;

  // schema.sql já rodou (a tabela existe, mesmo vazia) — o que importa aqui é
  // se já HÁ linhas nela, não se ela existe.
  const jaTemUsuario = await client.execute(`SELECT COUNT(*) AS n FROM usuarios`);
  if (Number(jaTemUsuario.rows[0].n) > 0) return; // banco remoto já tem dados: não mexe

  // A estrutura (tabelas/índices) já existe no Turso — veio do próprio
  // schema.sql, executado logo acima. Só falta copiar as linhas. Só de tabelas
  // que existem nos dois lados: o arquivo local pode ter sobras de versões
  // antigas (ex.: a tabela "sessions", de quando a sessão ainda vinha do
  // banco) que não fazem parte do schema atual.
  const Database = require('better-sqlite3');
  const local = new Database(bancoDoRepo, { readonly: true });
  const tabelasRemotas = new Set((await client.execute(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
  )).rows.map(r => r.name));
  const dadosTabelas = local.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
    .all().filter(t => tabelasRemotas.has(t.name));
  for (const { name } of dadosTabelas) {
    const linhas = local.prepare(`SELECT * FROM ${name}`).all();
    for (const linha of linhas) {
      const colunas = Object.keys(linha);
      const sql = `INSERT INTO ${name} (${colunas.join(', ')}) VALUES (${colunas.map(() => '?').join(', ')})`;
      await client.execute({ sql, args: colunas.map(c => linha[c]) });
    }
  }
  local.close();
  await client.sync(); // reflete as linhas recem-importadas na replica local
  console.log(`[setup] Banco importado do repositório para o Turso (${dadosTabelas.length} tabela(s) copiadas).`);
}

// ---------- Camada de compatibilidade com o formato do better-sqlite3 ----------
// O resto do código chama db.prepare(sql).get/.all/.run(...) e db.transaction(fn) —
// mesmo formato de antes, mas agora assíncrono (retorna Promise).
function normalizarArgs(args) {
  if (args.length === 1 && args[0] !== null && typeof args[0] === 'object' && !Array.isArray(args[0])) {
    return args[0]; // parâmetros nomeados (@nome), passados como um único objeto
  }
  return args;
}

function prepareOn(executor) {
  return (sql) => ({
    get: async (...args) => (await executor.execute({ sql, args: normalizarArgs(args) })).rows[0],
    all: async (...args) => (await executor.execute({ sql, args: normalizarArgs(args) })).rows,
    run: async (...args) => {
      const r = await executor.execute({ sql, args: normalizarArgs(args) });
      await syncIfRemoto();
      return { lastInsertRowid: Number(r.lastInsertRowid), changes: r.rowsAffected };
    }
  });
}

// db.transaction(async (tx) => { await tx.prepare(...).run(...); ... })
// devolve uma função; ao chamá-la, roda tudo dentro de uma transação e faz
// commit/rollback sozinho. `tx` tem o mesmo .prepare(...) de sempre.
function transaction(fn) {
  return async (...args) => {
    const tx = await client.transaction('write');
    try {
      const txDb = { prepare: prepareOn(tx) };
      const resultado = await fn(txDb, ...args);
      await tx.commit();
      await syncIfRemoto();
      return resultado;
    } catch (e) {
      await tx.rollback();
      throw e;
    } finally {
      tx.close();
    }
  };
}

const db = {
  prepare: prepareOn(client),
  transaction,
  exec: async (sql) => {
    const r = await client.executeMultiple(sql);
    await syncIfRemoto();
    return r;
  }
};

async function iniciar() {
  // Antes de qualquer leitura/escrita, traz a réplica local em dia com o
  // Turso — evita rodar schema/migração em cima de um replica.db vazio
  // (primeira subida) ou desatualizado (deploy novo em cima de um disco
  // antigo).
  if (isRemoto) await client.sync();

  await db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  await importarBancoDoRepoSeVazio();

  const mudancas = await migrar(db);
  if (mudancas.length) console.log(`[migracao] ${mudancas.join(' | ')}`);

  const seedResult = await seed(db);
  if (!seedResult.skipped) {
    console.log(`[seed] ${seedResult.categorias} categorias, ${seedResult.linhas} linhas e ${seedResult.total} produtos cadastrados.`);
  }

  const SUPERADMIN_EMAIL = 'bruno.salvagni@gmail.com';
  const existente = await db.prepare('SELECT id FROM usuarios WHERE email = ?').get(SUPERADMIN_EMAIL);
  if (!existente) {
    const senhaInicial = process.env.SUPERADMIN_SENHA_INICIAL || 'TrocarSenha@2026';
    const hash = bcrypt.hashSync(senhaInicial, 10);
    await db.prepare(`INSERT INTO usuarios (nome, email, senha_hash, papel, ativo) VALUES (?, ?, ?, 'superadmin', 1)`)
      .run('Bruno Salvagni', SUPERADMIN_EMAIL, hash);
    console.log('======================================================================');
    console.log(`[setup] Usuario superadmin criado: ${SUPERADMIN_EMAIL}`);
    console.log(`[setup] Senha inicial: ${senhaInicial}  (troque assim que possivel)`);
    console.log('======================================================================');
  }
}

module.exports = db;
module.exports.iniciar = iniciar;
