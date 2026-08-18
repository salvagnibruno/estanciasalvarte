// Migracoes idempotentes para bancos que ja existiam antes destas colunas.
// schema.sql cria tudo do zero em bancos novos; aqui ajustamos os antigos.
// Pode rodar quantas vezes for preciso: cada passo verifica antes de agir.

function colunas(db, tabela) {
  return db.prepare(`PRAGMA table_info(${tabela})`).all().map(c => c.name);
}

function adicionarColuna(db, tabela, nome, definicao) {
  if (colunas(db, tabela).includes(nome)) return false;
  db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${nome} ${definicao}`);
  return true;
}

// Classificacao inicial do publico, na mesma regra que o formulario de produto
// aplica: vale o que estiver escrito, olhando a descricao, depois o nome e por
// fim o nome da categoria. Texto que cita os dois generos ("masculinas e
// femininas") descreve peca que serve aos dois, entao continua unissex.
function classificarPublico(db) {
  // Só mexe em quem ainda esta' unissex, e so quando aquele campo cita um genero
  // sem citar o outro. `campo` e' interpolado, mas vem da lista fixa abaixo.
  const porCampo = (valor, campo, palavra, oposta) => db.prepare(`
    UPDATE produtos SET publico = ?
    WHERE publico = 'unissex' AND ${campo} LIKE ? AND ${campo} NOT LIKE ?
  `).run(valor, palavra, oposta).changes;

  // Um campo so' e' consultado se os anteriores nao disserem nada — a descricao
  // que cita os dois generos ja resolve a peca como unissex e barra o resto.
  const semGenero = (campo) => `${campo} NOT LIKE '%masculin%' AND ${campo} NOT LIKE '%feminin%'`;
  const CATEGORIA = `(SELECT c.nome FROM categorias c WHERE c.id = produtos.categoria_id)`;
  const CAMPOS = [
    `COALESCE(descricao, '')`,
    `CASE WHEN ${semGenero(`COALESCE(descricao, '')`)} THEN nome ELSE '' END`,
    `CASE WHEN ${semGenero(`COALESCE(descricao, '')`)} AND ${semGenero('nome')} THEN ${CATEGORIA} ELSE '' END`
  ];

  let feminino = 0;
  let masculino = 0;
  for (const campo of CAMPOS) {
    feminino += porCampo('feminino', campo, '%feminin%', '%masculin%');
    masculino += porCampo('masculino', campo, '%masculin%', '%feminin%');
  }
  const unissex = db.prepare("SELECT COUNT(*) AS total FROM produtos WHERE publico = 'unissex'").get().total;
  return { masculino, feminino, unissex, texto: `${masculino} masculino(s), ${feminino} feminino(s), ${unissex} unissex` };
}

// Reaplica a regra do zero, em todos os produtos. Serve para o botao do painel:
// a classificacao da migracao acontece uma vez so, e a loja pode querer rodar de
// novo depois de reescrever as descricoes.
function reclassificarPublico(db) {
  return db.transaction(() => {
    db.prepare("UPDATE produtos SET publico = 'unissex'").run();
    return classificarPublico(db);
  })();
}

// De->para dos status antigos para o conjunto pedido pela loja.
const STATUS_ANTIGOS = {
  pendente: 'aguardando_pagamento',
  preparando: 'pago',
  concluido: 'finalizado'
};

function migrar(db) {
  const mudancas = [];

  // ---------- produtos: vitrine em destaque e preco promocional ----------
  if (adicionarColuna(db, 'produtos', 'preco_promocional', 'REAL')) mudancas.push('produtos.preco_promocional');
  if (adicionarColuna(db, 'produtos', 'destaque', 'INTEGER NOT NULL DEFAULT 0')) mudancas.push('produtos.destaque');

  // ---------- produtos: publico (masculino / feminino / unissex) ----------
  // Recorte usado na exportacao do catalogo. Na criacao da coluna, os produtos
  // que ja se identificam no proprio nome (ou na categoria) sao classificados
  // uma unica vez; o resto fica 'unissex' para o admin ajustar na tela.
  if (adicionarColuna(db, 'produtos', 'publico', "TEXT NOT NULL DEFAULT 'unissex'")) {
    mudancas.push('produtos.publico');
    mudancas.push(`publico inicial: ${classificarPublico(db).texto}`);
  }

  // A primeira versao do publico classificava por palavras soltas no nome
  // ("prenda", "saia"). A regra passou a ser a do formulario — a descricao manda,
  // depois o nome, depois a categoria — entao os bancos que ja tinham a coluna
  // precisam de uma releitura. `user_version` marca que ja foi feita: nao se
  // repete a cada subida e nao desfaz o que a loja ajustar a mao depois.
  const VERSAO_AJUSTES = 1;
  if (db.pragma('user_version', { simple: true }) < VERSAO_AJUSTES) {
    mudancas.push(`publico relido pela descrição: ${reclassificarPublico(db).texto}`);
    db.pragma(`user_version = ${VERSAO_AJUSTES}`);
  }

  // ---------- produto_cores: foto por cor ----------
  // A pagina do produto troca a imagem principal quando o cliente escolhe a cor.
  if (adicionarColuna(db, 'produto_cores', 'imagem_url', 'TEXT')) mudancas.push('produto_cores.imagem_url');

  // ---------- pedidos: codigo, cliente, desconto e cupom ----------
  // ALTER TABLE do SQLite nao aceita UNIQUE: a unicidade vem do indice abaixo.
  if (adicionarColuna(db, 'pedidos', 'codigo', 'TEXT')) mudancas.push('pedidos.codigo');
  if (adicionarColuna(db, 'pedidos', 'cliente_id', 'INTEGER REFERENCES clientes(id)')) mudancas.push('pedidos.cliente_id');
  if (adicionarColuna(db, 'pedidos', 'valor_desconto', 'REAL NOT NULL DEFAULT 0')) mudancas.push('pedidos.valor_desconto');
  if (adicionarColuna(db, 'pedidos', 'cupom', 'TEXT')) mudancas.push('pedidos.cupom');
  if (adicionarColuna(db, 'pedidos', 'valor_final', 'REAL NOT NULL DEFAULT 0')) mudancas.push('pedidos.valor_final');

  // Indices que dependem das colunas acima (por isso ficam aqui, e nao no schema.sql).
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_pedidos_codigo ON pedidos(codigo) WHERE codigo IS NOT NULL`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_produtos_destaque ON produtos(destaque)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_pedidos_cliente ON pedidos(cliente_id)`);

  // ---------- status antigos -> novos ----------
  const atualizarStatus = db.prepare('UPDATE pedidos SET status = ? WHERE status = ?');
  for (const [antigo, novo] of Object.entries(STATUS_ANTIGOS)) {
    const info = atualizarStatus.run(novo, antigo);
    if (info.changes > 0) mudancas.push(`${info.changes} pedido(s) ${antigo} -> ${novo}`);
  }

  // ---------- valor_final dos pedidos antigos ----------
  const semFinal = db.prepare('UPDATE pedidos SET valor_final = total WHERE valor_final = 0 AND total > 0').run();
  if (semFinal.changes > 0) mudancas.push(`${semFinal.changes} pedido(s) com valor_final preenchido`);

  // ---------- clientes a partir dos pedidos ja existentes ----------
  const pedidosSemCliente = db.prepare('SELECT * FROM pedidos WHERE cliente_id IS NULL ORDER BY id ASC').all();
  if (pedidosSemCliente.length) {
    const vincular = db.transaction(() => {
      for (const pedido of pedidosSemCliente) {
        const cliente = registrarCliente(db, {
          nome: pedido.nome_cliente,
          email: pedido.email_cliente,
          telefone: pedido.telefone_cliente
        });
        if (cliente) db.prepare('UPDATE pedidos SET cliente_id = ? WHERE id = ?').run(cliente.id, pedido.id);
      }
    });
    vincular();
    mudancas.push(`${pedidosSemCliente.length} pedido(s) vinculados a clientes`);
  }

  // ---------- codigo comercial dos pedidos antigos ----------
  const semCodigo = db.prepare('SELECT id, criado_em FROM pedidos WHERE codigo IS NULL ORDER BY id ASC').all();
  if (semCodigo.length) {
    const gravar = db.transaction(() => {
      for (const pedido of semCodigo) {
        const ano = (pedido.criado_em || '').slice(0, 4) || String(new Date().getFullYear());
        db.prepare('UPDATE pedidos SET codigo = ? WHERE id = ?').run(gerarCodigoPedido(db, ano), pedido.id);
      }
    });
    gravar();
    mudancas.push(`${semCodigo.length} pedido(s) com codigo gerado`);
  }

  // ---------- usuarios: confirmacao de e-mail no primeiro acesso ----------
  // Contas que ja existiam antes desta coluna (inclusive o superadmin de
  // bootstrap) nascem confirmadas por padrao — a exigencia vale só a partir
  // daqui, para quem se cadastra pelo formulario público.
  if (adicionarColuna(db, 'usuarios', 'email_verificado', 'INTEGER NOT NULL DEFAULT 1')) mudancas.push('usuarios.email_verificado');
  if (adicionarColuna(db, 'usuarios', 'codigo_verificacao', 'TEXT')) mudancas.push('usuarios.codigo_verificacao');
  if (adicionarColuna(db, 'usuarios', 'codigo_expira_em', 'TEXT')) mudancas.push('usuarios.codigo_expira_em');
  if (adicionarColuna(db, 'usuarios', 'codigo_enviado_em', 'TEXT')) mudancas.push('usuarios.codigo_enviado_em');

  // ---------- clientes: CPF (prefill em compras seguintes do mesmo cliente) ----------
  if (adicionarColuna(db, 'clientes', 'cpf', 'TEXT')) mudancas.push('clientes.cpf');

  // ---------- cupons: validade por periodo e/ou por quantidade de usos ----------
  if (adicionarColuna(db, 'cupons', 'validade_inicio', 'TEXT')) mudancas.push('cupons.validade_inicio');
  if (adicionarColuna(db, 'cupons', 'limite_usos', 'INTEGER')) mudancas.push('cupons.limite_usos');
  if (adicionarColuna(db, 'cupons', 'usos_atuais', 'INTEGER NOT NULL DEFAULT 0')) mudancas.push('cupons.usos_atuais');

  // ---------- pedidos: CPF e enderecos estruturados (nota fiscal) ----------
  if (adicionarColuna(db, 'pedidos', 'cpf_cliente', 'TEXT')) mudancas.push('pedidos.cpf_cliente');
  if (adicionarColuna(db, 'pedidos', 'endereco_resid_cep', 'TEXT')) mudancas.push('pedidos.endereco_resid_cep');
  if (adicionarColuna(db, 'pedidos', 'endereco_resid_logradouro', 'TEXT')) mudancas.push('pedidos.endereco_resid_logradouro');
  if (adicionarColuna(db, 'pedidos', 'endereco_resid_numero', 'TEXT')) mudancas.push('pedidos.endereco_resid_numero');
  if (adicionarColuna(db, 'pedidos', 'endereco_resid_complemento', 'TEXT')) mudancas.push('pedidos.endereco_resid_complemento');
  if (adicionarColuna(db, 'pedidos', 'endereco_resid_bairro', 'TEXT')) mudancas.push('pedidos.endereco_resid_bairro');
  if (adicionarColuna(db, 'pedidos', 'endereco_resid_cidade', 'TEXT')) mudancas.push('pedidos.endereco_resid_cidade');
  if (adicionarColuna(db, 'pedidos', 'endereco_resid_uf', 'TEXT')) mudancas.push('pedidos.endereco_resid_uf');
  if (adicionarColuna(db, 'pedidos', 'entrega_igual_residencial', 'INTEGER NOT NULL DEFAULT 1')) mudancas.push('pedidos.entrega_igual_residencial');
  if (adicionarColuna(db, 'pedidos', 'endereco_entrega_cep', 'TEXT')) mudancas.push('pedidos.endereco_entrega_cep');
  if (adicionarColuna(db, 'pedidos', 'endereco_entrega_logradouro', 'TEXT')) mudancas.push('pedidos.endereco_entrega_logradouro');
  if (adicionarColuna(db, 'pedidos', 'endereco_entrega_numero', 'TEXT')) mudancas.push('pedidos.endereco_entrega_numero');
  if (adicionarColuna(db, 'pedidos', 'endereco_entrega_complemento', 'TEXT')) mudancas.push('pedidos.endereco_entrega_complemento');
  if (adicionarColuna(db, 'pedidos', 'endereco_entrega_bairro', 'TEXT')) mudancas.push('pedidos.endereco_entrega_bairro');
  if (adicionarColuna(db, 'pedidos', 'endereco_entrega_cidade', 'TEXT')) mudancas.push('pedidos.endereco_entrega_cidade');
  if (adicionarColuna(db, 'pedidos', 'endereco_entrega_uf', 'TEXT')) mudancas.push('pedidos.endereco_entrega_uf');

  // ---------- funil por produto: marca de corte, sem apagar historico ----------
  // "Zerar" o funil (visualizacoes -> carrinho -> venda) sem excluir pedidos ou
  // eventos_analytics: as consultas do relatorio (superadmin.js) passam a
  // contar so o que aconteceu depois desta marca. Roda uma unica vez — se a
  // loja quiser zerar de novo no futuro, basta atualizar este valor na tabela.
  const jaTemMarca = db.prepare(`SELECT 1 FROM configuracoes WHERE chave = 'funil_reset_em'`).get();
  if (!jaTemMarca) {
    db.prepare(`INSERT INTO configuracoes (chave, valor) VALUES ('funil_reset_em', datetime('now'))`).run();
    mudancas.push('funil por produto zerado a partir de agora');
  }

  return mudancas;
}

// Cria ou reaproveita o cliente. Reaproveita pelo e-mail quando houver;
// senao, pelo telefone. Mantem o nome/cpf mais recente informado.
function registrarCliente(db, { nome, email, telefone, cpf }) {
  const nomeLimpo = (nome || '').trim();
  const emailLimpo = (email || '').trim().toLowerCase() || null;
  const telefoneLimpo = (telefone || '').trim() || null;
  const cpfLimpo = (cpf || '').replace(/\D/g, '') || null;
  if (!nomeLimpo) return null;

  let existente = null;
  if (emailLimpo) existente = db.prepare('SELECT * FROM clientes WHERE email = ?').get(emailLimpo);
  if (!existente && telefoneLimpo) existente = db.prepare('SELECT * FROM clientes WHERE telefone = ?').get(telefoneLimpo);

  if (existente) {
    db.prepare('UPDATE clientes SET nome = ?, email = IFNULL(?, email), telefone = IFNULL(?, telefone), cpf = IFNULL(?, cpf) WHERE id = ?')
      .run(nomeLimpo, emailLimpo, telefoneLimpo, cpfLimpo, existente.id);
    return db.prepare('SELECT * FROM clientes WHERE id = ?').get(existente.id);
  }

  const info = db.prepare('INSERT INTO clientes (nome, email, telefone, cpf) VALUES (?, ?, ?, ?)')
    .run(nomeLimpo, emailLimpo, telefoneLimpo, cpfLimpo);
  return db.prepare('SELECT * FROM clientes WHERE id = ?').get(info.lastInsertRowid);
}

// Codigo comercial sequencial por ano: ES-2026-0001, ES-2026-0002...
function gerarCodigoPedido(db, ano) {
  const anoAlvo = String(ano || new Date().getFullYear());
  const prefixo = `ES-${anoAlvo}-`;
  const ultimo = db.prepare(
    `SELECT codigo FROM pedidos WHERE codigo LIKE ? ORDER BY codigo DESC LIMIT 1`
  ).get(`${prefixo}%`);

  let proximo = ultimo ? parseInt(ultimo.codigo.slice(prefixo.length), 10) + 1 : 1;
  // Protecao contra buracos/colisoes: avanca ate achar um codigo livre.
  for (let tentativa = 0; tentativa < 10000; tentativa++) {
    const candidato = prefixo + String(proximo).padStart(4, '0');
    const ocupado = db.prepare('SELECT 1 FROM pedidos WHERE codigo = ?').get(candidato);
    if (!ocupado) return candidato;
    proximo++;
  }
  throw new Error('Não foi possível gerar um código de pedido único.');
}

module.exports = { migrar, registrarCliente, gerarCodigoPedido, reclassificarPublico };
