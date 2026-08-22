// Migracoes idempotentes para bancos que ja existiam antes destas colunas.
// schema.sql cria tudo do zero em bancos novos; aqui ajustamos os antigos.
// Pode rodar quantas vezes for preciso: cada passo verifica antes de agir.

async function colunas(db, tabela) {
  return (await db.prepare(`PRAGMA table_info(${tabela})`).all()).map(c => c.name);
}

async function adicionarColuna(db, tabela, nome, definicao) {
  if ((await colunas(db, tabela)).includes(nome)) return false;
  await db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${nome} ${definicao}`);
  return true;
}

// Marca de "já rodou uma vez" — substitui o antigo PRAGMA user_version (que
// era exclusivo do better-sqlite3) por uma linha na tabela configuracoes.
async function jaFeito(db, chave) {
  return !!(await db.prepare('SELECT 1 FROM configuracoes WHERE chave = ?').get(chave));
}
async function marcarFeito(db, chave) {
  await db.prepare(`INSERT INTO configuracoes (chave, valor) VALUES (?, '1')
    ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`).run(chave);
}

// Classificacao inicial do publico, na mesma regra que o formulario de produto
// aplica: vale o que estiver escrito, olhando a descricao, depois o nome e por
// fim o nome da categoria. Texto que cita os dois generos ("masculinas e
// femininas") descreve peca que serve aos dois, entao continua unissex.
async function classificarPublico(db) {
  // Só mexe em quem ainda esta' unissex, e so quando aquele campo cita um genero
  // sem citar o outro. `campo` e' interpolado, mas vem da lista fixa abaixo.
  const porCampo = async (valor, campo, palavra, oposta) => (await db.prepare(`
    UPDATE produtos SET publico = ?
    WHERE publico = 'unissex' AND ${campo} LIKE ? AND ${campo} NOT LIKE ?
  `).run(valor, palavra, oposta)).changes;

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
    feminino += await porCampo('feminino', campo, '%feminin%', '%masculin%');
    masculino += await porCampo('masculino', campo, '%masculin%', '%feminin%');
  }
  const unissex = (await db.prepare("SELECT COUNT(*) AS total FROM produtos WHERE publico = 'unissex'").get()).total;
  return { masculino, feminino, unissex, texto: `${masculino} masculino(s), ${feminino} feminino(s), ${unissex} unissex` };
}

// Reaplica a regra do zero, em todos os produtos. Serve para o botao do painel:
// a classificacao da migracao acontece uma vez so, e a loja pode querer rodar de
// novo depois de reescrever as descricoes.
function reclassificarPublico(db) {
  return db.transaction(async (tx) => {
    await tx.prepare("UPDATE produtos SET publico = 'unissex'").run();
    return classificarPublico(tx);
  })();
}

// De->para dos status antigos para o conjunto pedido pela loja.
const STATUS_ANTIGOS = {
  pendente: 'aguardando_pagamento',
  preparando: 'pago',
  concluido: 'finalizado'
};

// Substitui o catálogo antigo (produtos/categorias de desenvolvimento) pela
// lista definitiva de produtos da loja — uma única vez, marcado em
// configuracoes.catalogo_versao. Pedidos já fechados não são apagados: o
// produto_id do item vira NULL (o pedido guarda nome/preço/custo do momento
// da compra à parte), exatamente como já acontece ao excluir um produto pelo
// painel. Depois desta limpeza, db/seed.js roda e cadastra os produtos novos.
const CATALOGO_VERSAO_ATUAL = 2;
async function resetarCatalogoAntigo(db) {
  const row = await db.prepare(`SELECT valor FROM configuracoes WHERE chave = 'catalogo_versao'`).get();
  const versaoAtual = row ? parseInt(row.valor, 10) : 1;
  if (versaoAtual >= CATALOGO_VERSAO_ATUAL) return false;

  const limpar = db.transaction(async (tx) => {
    await tx.prepare('UPDATE pedido_itens SET produto_id = NULL WHERE produto_id IS NOT NULL').run();
    await tx.prepare('DELETE FROM eventos_analytics WHERE produto_id IS NOT NULL').run();
    for (const tabela of ['produto_tamanhos', 'produto_cores', 'produto_estoque', 'cupom_produtos',
      'produto_linhas', 'interesses', 'encomendas', 'carrinho_itens', 'historico_precos']) {
      await tx.prepare(`DELETE FROM ${tabela}`).run();
    }
    await tx.prepare('DELETE FROM produtos').run();
    await tx.prepare('DELETE FROM linhas').run();
    await tx.prepare('DELETE FROM categorias').run();
    await tx.prepare(`INSERT INTO configuracoes (chave, valor) VALUES ('catalogo_versao', ?)
      ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`).run(String(CATALOGO_VERSAO_ATUAL));
  });
  await limpar();
  return true;
}

async function migrar(db) {
  const mudancas = [];

  // ---------- produtos: vitrine em destaque e preco promocional ----------
  if (await adicionarColuna(db, 'produtos', 'preco_promocional', 'REAL')) mudancas.push('produtos.preco_promocional');
  if (await adicionarColuna(db, 'produtos', 'destaque', 'INTEGER NOT NULL DEFAULT 0')) mudancas.push('produtos.destaque');

  // ---------- produtos: publico (masculino / feminino / unissex) ----------
  // Recorte usado na exportacao do catalogo. Na criacao da coluna, os produtos
  // que ja se identificam no proprio nome (ou na categoria) sao classificados
  // uma unica vez; o resto fica 'unissex' para o admin ajustar na tela.
  if (await adicionarColuna(db, 'produtos', 'publico', "TEXT NOT NULL DEFAULT 'unissex'")) {
    mudancas.push('produtos.publico');
    mudancas.push(`publico inicial: ${(await classificarPublico(db)).texto}`);
  }

  // A primeira versao do publico classificava por palavras soltas no nome
  // ("prenda", "saia"). A regra passou a ser a do formulario — a descricao manda,
  // depois o nome, depois a categoria — entao os bancos que ja tinham a coluna
  // precisam de uma releitura. Roda uma unica vez (marca em `configuracoes`):
  // nao se repete a cada subida e nao desfaz o que a loja ajustar a mao depois.
  if (!(await jaFeito(db, 'publico_relido_v1'))) {
    mudancas.push(`publico relido pela descrição: ${(await reclassificarPublico(db)).texto}`);
    await marcarFeito(db, 'publico_relido_v1');
  }

  // ---------- produto_cores: foto por cor ----------
  // A pagina do produto troca a imagem principal quando o cliente escolhe a cor.
  if (await adicionarColuna(db, 'produto_cores', 'imagem_url', 'TEXT')) mudancas.push('produto_cores.imagem_url');

  // ---------- pedidos: codigo, cliente, desconto e cupom ----------
  // ALTER TABLE do SQLite nao aceita UNIQUE: a unicidade vem do indice abaixo.
  if (await adicionarColuna(db, 'pedidos', 'codigo', 'TEXT')) mudancas.push('pedidos.codigo');
  if (await adicionarColuna(db, 'pedidos', 'cliente_id', 'INTEGER REFERENCES clientes(id)')) mudancas.push('pedidos.cliente_id');
  if (await adicionarColuna(db, 'pedidos', 'valor_desconto', 'REAL NOT NULL DEFAULT 0')) mudancas.push('pedidos.valor_desconto');
  if (await adicionarColuna(db, 'pedidos', 'cupom', 'TEXT')) mudancas.push('pedidos.cupom');
  if (await adicionarColuna(db, 'pedidos', 'valor_final', 'REAL NOT NULL DEFAULT 0')) mudancas.push('pedidos.valor_final');

  // Indices que dependem das colunas acima (por isso ficam aqui, e nao no schema.sql).
  await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_pedidos_codigo ON pedidos(codigo) WHERE codigo IS NOT NULL`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_produtos_destaque ON produtos(destaque)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_pedidos_cliente ON pedidos(cliente_id)`);

  // ---------- status antigos -> novos ----------
  for (const [antigo, novo] of Object.entries(STATUS_ANTIGOS)) {
    const info = await db.prepare('UPDATE pedidos SET status = ? WHERE status = ?').run(novo, antigo);
    if (info.changes > 0) mudancas.push(`${info.changes} pedido(s) ${antigo} -> ${novo}`);
  }

  // ---------- valor_final dos pedidos antigos ----------
  const semFinal = await db.prepare('UPDATE pedidos SET valor_final = total WHERE valor_final = 0 AND total > 0').run();
  if (semFinal.changes > 0) mudancas.push(`${semFinal.changes} pedido(s) com valor_final preenchido`);

  // ---------- clientes a partir dos pedidos ja existentes ----------
  const pedidosSemCliente = await db.prepare('SELECT * FROM pedidos WHERE cliente_id IS NULL ORDER BY id ASC').all();
  if (pedidosSemCliente.length) {
    const vincular = db.transaction(async (tx) => {
      for (const pedido of pedidosSemCliente) {
        const cliente = await registrarCliente(tx, {
          nome: pedido.nome_cliente,
          email: pedido.email_cliente,
          telefone: pedido.telefone_cliente
        });
        if (cliente) await tx.prepare('UPDATE pedidos SET cliente_id = ? WHERE id = ?').run(cliente.id, pedido.id);
      }
    });
    await vincular();
    mudancas.push(`${pedidosSemCliente.length} pedido(s) vinculados a clientes`);
  }

  // ---------- codigo comercial dos pedidos antigos ----------
  const semCodigo = await db.prepare('SELECT id, criado_em FROM pedidos WHERE codigo IS NULL ORDER BY id ASC').all();
  if (semCodigo.length) {
    const gravar = db.transaction(async (tx) => {
      for (const pedido of semCodigo) {
        const ano = (pedido.criado_em || '').slice(0, 4) || String(new Date().getFullYear());
        await tx.prepare('UPDATE pedidos SET codigo = ? WHERE id = ?').run(await gerarCodigoPedido(tx, ano), pedido.id);
      }
    });
    await gravar();
    mudancas.push(`${semCodigo.length} pedido(s) com codigo gerado`);
  }

  // ---------- usuarios: confirmacao de e-mail no primeiro acesso ----------
  // Contas que ja existiam antes desta coluna (inclusive o superadmin de
  // bootstrap) nascem confirmadas por padrao — a exigencia vale só a partir
  // daqui, para quem se cadastra pelo formulario público.
  if (await adicionarColuna(db, 'usuarios', 'email_verificado', 'INTEGER NOT NULL DEFAULT 1')) mudancas.push('usuarios.email_verificado');
  if (await adicionarColuna(db, 'usuarios', 'codigo_verificacao', 'TEXT')) mudancas.push('usuarios.codigo_verificacao');
  if (await adicionarColuna(db, 'usuarios', 'codigo_expira_em', 'TEXT')) mudancas.push('usuarios.codigo_expira_em');
  if (await adicionarColuna(db, 'usuarios', 'codigo_enviado_em', 'TEXT')) mudancas.push('usuarios.codigo_enviado_em');

  // ---------- clientes: CPF (prefill em compras seguintes do mesmo cliente) ----------
  if (await adicionarColuna(db, 'clientes', 'cpf', 'TEXT')) mudancas.push('clientes.cpf');

  // ---------- cupons: validade por periodo e/ou por quantidade de usos ----------
  if (await adicionarColuna(db, 'cupons', 'validade_inicio', 'TEXT')) mudancas.push('cupons.validade_inicio');
  if (await adicionarColuna(db, 'cupons', 'limite_usos', 'INTEGER')) mudancas.push('cupons.limite_usos');
  if (await adicionarColuna(db, 'cupons', 'usos_atuais', 'INTEGER NOT NULL DEFAULT 0')) mudancas.push('cupons.usos_atuais');

  // ---------- pedidos: CPF e enderecos estruturados (nota fiscal) ----------
  if (await adicionarColuna(db, 'pedidos', 'cpf_cliente', 'TEXT')) mudancas.push('pedidos.cpf_cliente');
  if (await adicionarColuna(db, 'pedidos', 'endereco_resid_cep', 'TEXT')) mudancas.push('pedidos.endereco_resid_cep');
  if (await adicionarColuna(db, 'pedidos', 'endereco_resid_logradouro', 'TEXT')) mudancas.push('pedidos.endereco_resid_logradouro');
  if (await adicionarColuna(db, 'pedidos', 'endereco_resid_numero', 'TEXT')) mudancas.push('pedidos.endereco_resid_numero');
  if (await adicionarColuna(db, 'pedidos', 'endereco_resid_complemento', 'TEXT')) mudancas.push('pedidos.endereco_resid_complemento');
  if (await adicionarColuna(db, 'pedidos', 'endereco_resid_bairro', 'TEXT')) mudancas.push('pedidos.endereco_resid_bairro');
  if (await adicionarColuna(db, 'pedidos', 'endereco_resid_cidade', 'TEXT')) mudancas.push('pedidos.endereco_resid_cidade');
  if (await adicionarColuna(db, 'pedidos', 'endereco_resid_uf', 'TEXT')) mudancas.push('pedidos.endereco_resid_uf');
  if (await adicionarColuna(db, 'pedidos', 'entrega_igual_residencial', 'INTEGER NOT NULL DEFAULT 1')) mudancas.push('pedidos.entrega_igual_residencial');
  if (await adicionarColuna(db, 'pedidos', 'endereco_entrega_cep', 'TEXT')) mudancas.push('pedidos.endereco_entrega_cep');
  if (await adicionarColuna(db, 'pedidos', 'endereco_entrega_logradouro', 'TEXT')) mudancas.push('pedidos.endereco_entrega_logradouro');
  if (await adicionarColuna(db, 'pedidos', 'endereco_entrega_numero', 'TEXT')) mudancas.push('pedidos.endereco_entrega_numero');
  if (await adicionarColuna(db, 'pedidos', 'endereco_entrega_complemento', 'TEXT')) mudancas.push('pedidos.endereco_entrega_complemento');
  if (await adicionarColuna(db, 'pedidos', 'endereco_entrega_bairro', 'TEXT')) mudancas.push('pedidos.endereco_entrega_bairro');
  if (await adicionarColuna(db, 'pedidos', 'endereco_entrega_cidade', 'TEXT')) mudancas.push('pedidos.endereco_entrega_cidade');
  if (await adicionarColuna(db, 'pedidos', 'endereco_entrega_uf', 'TEXT')) mudancas.push('pedidos.endereco_entrega_uf');

  // ---------- pedidos: prazo de pagamento, reserva de estoque, cancelamento, nota fiscal ----------
  if (await adicionarColuna(db, 'pedidos', 'expira_em', 'TEXT')) mudancas.push('pedidos.expira_em');
  if (await adicionarColuna(db, 'pedidos', 'erro_pagamento', 'TEXT')) mudancas.push('pedidos.erro_pagamento');
  if (await adicionarColuna(db, 'encomendas', 'pedido_id', 'INTEGER REFERENCES pedidos(id)')) mudancas.push('encomendas.pedido_id');
  if (await adicionarColuna(db, 'pedidos', 'estoque_reservado', 'INTEGER NOT NULL DEFAULT 0')) mudancas.push('pedidos.estoque_reservado');
  if (await adicionarColuna(db, 'pedidos', 'estoque_devolvido', 'INTEGER NOT NULL DEFAULT 0')) mudancas.push('pedidos.estoque_devolvido');
  if (await adicionarColuna(db, 'pedidos', 'motivo_cancelamento', 'TEXT')) mudancas.push('pedidos.motivo_cancelamento');
  if (await adicionarColuna(db, 'pedidos', 'nfce_status', 'TEXT')) mudancas.push('pedidos.nfce_status');
  if (await adicionarColuna(db, 'pedidos', 'nfce_numero', 'TEXT')) mudancas.push('pedidos.nfce_numero');
  if (await adicionarColuna(db, 'pedidos', 'nfce_chave', 'TEXT')) mudancas.push('pedidos.nfce_chave');
  if (await adicionarColuna(db, 'pedidos', 'nfce_pdf_url', 'TEXT')) mudancas.push('pedidos.nfce_pdf_url');
  if (await adicionarColuna(db, 'pedidos', 'nfce_emitida_em', 'TEXT')) mudancas.push('pedidos.nfce_emitida_em');
  if (await adicionarColuna(db, 'pedidos', 'parcelas', 'INTEGER')) mudancas.push('pedidos.parcelas');
  if (await adicionarColuna(db, 'pedidos', 'parcelas_com_juros', 'INTEGER NOT NULL DEFAULT 0')) mudancas.push('pedidos.parcelas_com_juros');
  if (await adicionarColuna(db, 'cupons', 'limite_tipo', "TEXT NOT NULL DEFAULT 'geral'")) mudancas.push('cupons.limite_tipo');
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_pedidos_expira ON pedidos(status, expira_em)`);
  await db.exec(`CREATE TABLE IF NOT EXISTS pedido_edicoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
    usuario_email TEXT,
    tipo TEXT NOT NULL,
    detalhe TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_pedido_edicoes_pedido ON pedido_edicoes(pedido_id)`);

  // Pedidos antigos ainda aguardando pagamento: dá 1h a partir de agora (não a
  // partir de criado_em, que poderia estar anos no passado e desistir tudo de
  // uma vez). `estoque_reservado` fica 0 nesses pedidos antigos (padrão da
  // coluna), então o sweep de expiração nunca devolve estoque que eles nunca
  // chegaram a reservar sob a regra anterior (que só debitava ao confirmar o
  // pagamento).
  const semPrazo = await db.prepare(`UPDATE pedidos SET expira_em = datetime('now', '+1 hour')
    WHERE status = 'aguardando_pagamento' AND expira_em IS NULL`).run();
  if (semPrazo.changes > 0) mudancas.push(`${semPrazo.changes} pedido(s) aguardando pagamento com prazo de expiração definido`);

  // ---------- produto_estoque: some duplicada por causa do NULL no UNIQUE ----------
  // O UNIQUE(produto_id,tamanho,cor) antigo nao pegava tamanho/cor NULL (NULL
  // nao e' igual a NULL pro SQLite): produto sem variacao (o caso mais comum)
  // furava a restricao e cada "Salvar" na tela de estoque inserida uma linha
  // nova em vez de atualizar a existente. Junta as duplicatas (soma a
  // quantidade na mais antiga, apaga o resto) antes de criar o indice novo,
  // que normaliza NULL como '' e passa a bloquear isso de verdade.
  const duplicados = await db.prepare(`
    SELECT produto_id, IFNULL(tamanho,'') AS tam, IFNULL(cor,'') AS cor, MIN(id) AS manter, SUM(quantidade) AS total
    FROM produto_estoque GROUP BY produto_id, tam, cor HAVING COUNT(*) > 1
  `).all();
  for (const d of duplicados) {
    await db.prepare(`UPDATE produto_estoque SET quantidade = ? WHERE id = ?`).run(d.total, d.manter);
    await db.prepare(`DELETE FROM produto_estoque WHERE produto_id = ? AND IFNULL(tamanho,'') = ? AND IFNULL(cor,'') = ? AND id != ?`)
      .run(d.produto_id, d.tam, d.cor, d.manter);
  }
  if (duplicados.length) mudancas.push(`${duplicados.length} grupo(s) de estoque duplicado consolidados`);
  await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_produto_estoque_unico
    ON produto_estoque(produto_id, IFNULL(tamanho,''), IFNULL(cor,''))`);

  // ---------- catalogo: troca de linha de produtos (uma vez so) ----------
  if (await resetarCatalogoAntigo(db)) mudancas.push('catálogo antigo substituído pela nova lista de produtos');

  // ---------- funil por produto: marca de corte, sem apagar historico ----------
  // "Zerar" o funil (visualizacoes -> carrinho -> venda) sem excluir pedidos ou
  // eventos_analytics: as consultas do relatorio (superadmin.js) passam a
  // contar so o que aconteceu depois desta marca. Roda uma unica vez — se a
  // loja quiser zerar de novo no futuro, basta atualizar este valor na tabela.
  const jaTemMarca = await db.prepare(`SELECT 1 FROM configuracoes WHERE chave = 'funil_reset_em'`).get();
  if (!jaTemMarca) {
    await db.prepare(`INSERT INTO configuracoes (chave, valor) VALUES ('funil_reset_em', datetime('now'))`).run();
    mudancas.push('funil por produto zerado a partir de agora');
  }

  return mudancas;
}

// Cria ou reaproveita o cliente. Reaproveita pelo e-mail quando houver;
// senao, pelo telefone. Mantem o nome/cpf mais recente informado.
async function registrarCliente(db, { nome, email, telefone, cpf }) {
  const nomeLimpo = (nome || '').trim();
  const emailLimpo = (email || '').trim().toLowerCase() || null;
  const telefoneLimpo = (telefone || '').trim() || null;
  const cpfLimpo = (cpf || '').replace(/\D/g, '') || null;
  if (!nomeLimpo) return null;

  let existente = null;
  if (emailLimpo) existente = await db.prepare('SELECT * FROM clientes WHERE email = ?').get(emailLimpo);
  if (!existente && telefoneLimpo) existente = await db.prepare('SELECT * FROM clientes WHERE telefone = ?').get(telefoneLimpo);

  if (existente) {
    await db.prepare('UPDATE clientes SET nome = ?, email = IFNULL(?, email), telefone = IFNULL(?, telefone), cpf = IFNULL(?, cpf) WHERE id = ?')
      .run(nomeLimpo, emailLimpo, telefoneLimpo, cpfLimpo, existente.id);
    return db.prepare('SELECT * FROM clientes WHERE id = ?').get(existente.id);
  }

  const info = await db.prepare('INSERT INTO clientes (nome, email, telefone, cpf) VALUES (?, ?, ?, ?)')
    .run(nomeLimpo, emailLimpo, telefoneLimpo, cpfLimpo);
  return db.prepare('SELECT * FROM clientes WHERE id = ?').get(info.lastInsertRowid);
}

// Codigo comercial sequencial por ano: ES-2026-0001, ES-2026-0002...
async function gerarCodigoPedido(db, ano) {
  const anoAlvo = String(ano || new Date().getFullYear());
  const prefixo = `ES-${anoAlvo}-`;
  const ultimo = await db.prepare(
    `SELECT codigo FROM pedidos WHERE codigo LIKE ? ORDER BY codigo DESC LIMIT 1`
  ).get(`${prefixo}%`);

  let proximo = ultimo ? parseInt(ultimo.codigo.slice(prefixo.length), 10) + 1 : 1;
  // Protecao contra buracos/colisoes: avanca ate achar um codigo livre.
  for (let tentativa = 0; tentativa < 10000; tentativa++) {
    const candidato = prefixo + String(proximo).padStart(4, '0');
    const ocupado = await db.prepare('SELECT 1 FROM pedidos WHERE codigo = ?').get(candidato);
    if (!ocupado) return candidato;
    proximo++;
  }
  throw new Error('Não foi possível gerar um código de pedido único.');
}

module.exports = { migrar, registrarCliente, gerarCodigoPedido, reclassificarPublico };
