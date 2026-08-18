-- Estancia Salvarte - Schema relacional (SQLite)
-- Todas as informacoes de produtos, usuarios, pedidos, carrinho e agenda
-- sao armazenadas em tabelas relacionais (sem uso de JSON).

CREATE TABLE IF NOT EXISTS categorias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  descricao TEXT,
  ordem INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS produtos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  categoria_id INTEGER NOT NULL REFERENCES categorias(id),
  codigo TEXT UNIQUE,
  nome TEXT NOT NULL,
  descricao TEXT,
  custo REAL NOT NULL DEFAULT 0,
  custo_fonte TEXT NOT NULL DEFAULT 'estimado', -- 'tabela' (fornecedor) ou 'estimado'
  percentual_markup REAL NOT NULL DEFAULT 0,
  preco_venda REAL NOT NULL DEFAULT 0,
  preco_manual INTEGER NOT NULL DEFAULT 0, -- 1 = admin fixou preco manualmente (nao recalcular)
  preco_promocional REAL, -- NULL = sem promocao; quando preenchido vira o preco de oferta
  destaque INTEGER NOT NULL DEFAULT 0, -- 1 = aparece no carrossel da vitrine da home
  tipo_estoque TEXT NOT NULL DEFAULT 'estoque', -- 'estoque' ou 'sob_encomenda'
  publico TEXT NOT NULL DEFAULT 'unissex', -- 'masculino', 'feminino' ou 'unissex' (recorte do catalogo)
  imagem_url TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS produto_tamanhos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  tamanho TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS produto_cores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  cor_nome TEXT NOT NULL,
  cor_hex TEXT NOT NULL DEFAULT '#333333',
  -- Foto da peca nesta cor. Quando existe, a pagina do produto troca a imagem
  -- principal ao cliente escolher a cor. NULL = usa a foto do produto.
  imagem_url TEXT
);

-- Linhas: agrupamentos transversais de produto (ex.: "Infantil", "Linha Verão",
-- "Calçados"), cadastradas pelo superadmin. Um produto pode estar em nenhuma,
-- uma, várias ou todas as linhas ao mesmo tempo — por isso é tabela à parte
-- (N:N), diferente de categorias (uma só por produto).
CREATE TABLE IF NOT EXISTS linhas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  ordem INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS produto_linhas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  linha_id INTEGER NOT NULL REFERENCES linhas(id) ON DELETE CASCADE,
  UNIQUE(produto_id, linha_id)
);
CREATE INDEX IF NOT EXISTS idx_produto_linhas_produto ON produto_linhas(produto_id);
CREATE INDEX IF NOT EXISTS idx_produto_linhas_linha ON produto_linhas(linha_id);

CREATE TABLE IF NOT EXISTS produto_estoque (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  tamanho TEXT,
  cor TEXT,
  quantidade INTEGER NOT NULL DEFAULT 0,
  UNIQUE(produto_id, tamanho, cor)
);

CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  telefone TEXT,
  papel TEXT NOT NULL DEFAULT 'cliente', -- 'superadmin' | 'admin' | 'cliente'
  ativo INTEGER NOT NULL DEFAULT 1,
  -- Confirmação de e-mail no primeiro acesso (cadastro público). Contas criadas
  -- pelo superadmin (admin) ou o superadmin de bootstrap nascem já confirmadas.
  email_verificado INTEGER NOT NULL DEFAULT 1,
  codigo_verificacao TEXT,
  codigo_expira_em TEXT,
  codigo_enviado_em TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Permissoes finas concedidas pelo superadmin a um usuario admin.
-- A lista de chaves validas fica em server/permissoes.js; o superadmin nao
-- precisa de linhas aqui (tem tudo por papel).
CREATE TABLE IF NOT EXISTS usuario_permissoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  permissao TEXT NOT NULL,
  concedido_por TEXT, -- e-mail do superadmin que liberou
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(usuario_id, permissao)
);

CREATE TABLE IF NOT EXISTS carrinhos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER REFERENCES usuarios(id),
  sessao_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'aberto', -- 'aberto' | 'abandonado' | 'convertido'
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS carrinho_itens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  carrinho_id INTEGER NOT NULL REFERENCES carrinhos(id) ON DELETE CASCADE,
  produto_id INTEGER NOT NULL REFERENCES produtos(id),
  tamanho TEXT,
  cor TEXT,
  quantidade INTEGER NOT NULL DEFAULT 1,
  preco_unitario REAL NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Cadastro enxuto do comprador. Um cliente e' reaproveitado entre pedidos
-- pelo e-mail (quando informado) ou pelo telefone.
CREATE TABLE IF NOT EXISTS clientes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  email TEXT,
  telefone TEXT,
  cpf TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_email ON clientes(email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_telefone ON clientes(telefone) WHERE telefone IS NOT NULL;

-- Cadastro de cupons: exclusivo do superadmin (ver routes/superadmin.js).
-- Validade pode ser por período (validade_inicio/validade_fim) e/ou por
-- quantidade de usos (limite_usos) — os dois podem conviver; o cupom vale
-- enquanto TODAS as regras preenchidas ainda permitirem.
CREATE TABLE IF NOT EXISTS cupons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL UNIQUE,
  tipo TEXT NOT NULL DEFAULT 'percentual', -- 'percentual' | 'valor'
  valor REAL NOT NULL DEFAULT 0,
  validade_inicio TEXT, -- 'AAAA-MM-DD'; NULL = vale desde já
  validade TEXT, -- 'AAAA-MM-DD'; NULL = sem prazo final (mantido o nome original da coluna)
  limite_usos INTEGER, -- NULL = sem limite de quantidade de pedidos
  usos_atuais INTEGER NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Produtos aos quais o cupom se aplica. Sem nenhuma linha aqui = cupom vale
-- para o carrinho inteiro (equivalente a "todos os produtos"). Com uma ou mais
-- linhas, o desconto incide só sobre o subtotal dos produtos listados.
CREATE TABLE IF NOT EXISTS cupom_produtos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cupom_id INTEGER NOT NULL REFERENCES cupons(id) ON DELETE CASCADE,
  produto_id INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  UNIQUE(cupom_id, produto_id)
);

CREATE TABLE IF NOT EXISTS pedidos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT UNIQUE, -- codigo comercial do pedido (ex.: ES-2026-0007)
  usuario_id INTEGER REFERENCES usuarios(id),
  cliente_id INTEGER REFERENCES clientes(id),
  nome_cliente TEXT NOT NULL,
  email_cliente TEXT,
  telefone_cliente TEXT,
  cpf_cliente TEXT,
  -- Endereço residencial e de entrega, estruturados (necessários para emissão
  -- de nota fiscal). `entrega_igual_residencial` = 1 quando o cliente não
  -- digitou um endereço de entrega separado (os campos de entrega abaixo vêm
  -- copiados do residencial na hora do checkout).
  endereco_resid_cep TEXT,
  endereco_resid_logradouro TEXT,
  endereco_resid_numero TEXT,
  endereco_resid_complemento TEXT,
  endereco_resid_bairro TEXT,
  endereco_resid_cidade TEXT,
  endereco_resid_uf TEXT,
  entrega_igual_residencial INTEGER NOT NULL DEFAULT 1,
  endereco_entrega_cep TEXT,
  endereco_entrega_logradouro TEXT,
  endereco_entrega_numero TEXT,
  endereco_entrega_complemento TEXT,
  endereco_entrega_bairro TEXT,
  endereco_entrega_cidade TEXT,
  endereco_entrega_uf TEXT,
  endereco_entrega TEXT, -- mantido por compatibilidade: versão em texto único (concatenada) do endereço de entrega
  total REAL NOT NULL DEFAULT 0,          -- soma dos itens, antes do desconto
  valor_desconto REAL NOT NULL DEFAULT 0,
  cupom TEXT,
  valor_final REAL NOT NULL DEFAULT 0,    -- total - valor_desconto (o que o cliente paga)
  status TEXT NOT NULL DEFAULT 'aguardando_pagamento',
    -- aguardando_pagamento|pago|enviado|recebido|finalizado|cancelado
  forma_pagamento TEXT, -- cartao_credito|cartao_debito|pix
  mp_preference_id TEXT,
  mp_payment_id TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pedido_itens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  produto_id INTEGER REFERENCES produtos(id),
  nome_produto TEXT NOT NULL,
  tamanho TEXT,
  cor TEXT,
  quantidade INTEGER NOT NULL DEFAULT 1,
  preco_unitario REAL NOT NULL,
  custo_unitario REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS encomendas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id INTEGER NOT NULL REFERENCES produtos(id),
  usuario_id INTEGER REFERENCES usuarios(id),
  nome TEXT NOT NULL,
  email TEXT,
  telefone TEXT,
  tamanho TEXT,
  cor TEXT,
  quantidade INTEGER NOT NULL DEFAULT 1,
  tipo TEXT NOT NULL DEFAULT 'encomenda', -- 'encomenda' | 'aviso_estoque'
  status TEXT NOT NULL DEFAULT 'aguardando', -- aguardando|avisado|atendido|cancelado
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS interesses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER REFERENCES usuarios(id),
  sessao_id TEXT,
  produto_id INTEGER NOT NULL REFERENCES produtos(id),
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(usuario_id, produto_id)
);

CREATE TABLE IF NOT EXISTS agendamentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER REFERENCES usuarios(id),
  servico_nome TEXT NOT NULL,
  data_servico TEXT NOT NULL,
  horario TEXT NOT NULL,
  local TEXT NOT NULL,
  responsavel TEXT NOT NULL,
  telefone_contato TEXT NOT NULL,
  observacoes TEXT,
  status TEXT NOT NULL DEFAULT 'pendente', -- pendente|aprovado|recusado|concluido
  motivo_recusa TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS eventos_analytics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL, -- view_produto|add_carrinho|remove_carrinho|checkout_iniciado|compra_concluida
  produto_id INTEGER REFERENCES produtos(id),
  usuario_id INTEGER REFERENCES usuarios(id),
  sessao_id TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Pares chave/valor de configuração interna (ex.: marca de corte do funil por
-- produto, dados de contato do site). Não é tela de configuração do lojista —
-- é estado interno do sistema; a tela em si fica em routes/superadmin.js.
CREATE TABLE IF NOT EXISTS configuracoes (
  chave TEXT PRIMARY KEY,
  valor TEXT
);

-- Avisos/banners exibidos aos clientes no site, dentro de uma janela de datas
-- (ex.: "loja fechada no feriado", "promoção de fim de ano"). Cadastro
-- exclusivo do superadmin — ver routes/superadmin.js.
CREATE TABLE IF NOT EXISTS avisos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo TEXT NOT NULL,
  mensagem TEXT,
  data_inicio TEXT, -- 'AAAA-MM-DD'; NULL = já vale desde já
  data_fim TEXT,    -- 'AAAA-MM-DD'; NULL = sem data para sair de exibição
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_avisos_ativo ON avisos(ativo);

CREATE TABLE IF NOT EXISTS historico_precos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id INTEGER NOT NULL REFERENCES produtos(id),
  custo_anterior REAL,
  custo_novo REAL,
  preco_anterior REAL,
  preco_novo REAL,
  alterado_por TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Pesquisa de satisfacao respondida pelo cliente logo apos a compra.
CREATE TABLE IF NOT EXISTS csat (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id INTEGER REFERENCES pedidos(id),
  pedido_codigo TEXT,
  cliente_id INTEGER REFERENCES clientes(id),
  nome_cliente TEXT,
  email_cliente TEXT,
  telefone_cliente TEXT,
  nota_precos INTEGER,       -- 1 a 5: percepcao de preco
  nota_site INTEGER,         -- 1 a 5: usabilidade do site na compra
  nota_geral INTEGER,        -- 1 a 5: experiencia geral
  primeira_compra INTEGER,   -- 1 = sim, 0 = nao
  recomendaria INTEGER,      -- 1 = sim, 0 = nao
  comentario TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')) -- data e hora do envio
);

-- Registro de acessos as paginas publicas (para analise posterior).
CREATE TABLE IF NOT EXISTS acessos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER REFERENCES usuarios(id),
  sessao_id TEXT,
  caminho TEXT NOT NULL,
  referencia TEXT,
  user_agent TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Os indices de produtos.destaque e pedidos.cliente_id ficam em migrate.js:
-- em bancos antigos essas colunas so existem depois do ALTER TABLE.
CREATE INDEX IF NOT EXISTS idx_produtos_categoria ON produtos(categoria_id);
CREATE INDEX IF NOT EXISTS idx_csat_pedido ON csat(pedido_id);
CREATE INDEX IF NOT EXISTS idx_acessos_criado ON acessos(criado_em);
CREATE INDEX IF NOT EXISTS idx_carrinho_itens_carrinho ON carrinho_itens(carrinho_id);
CREATE INDEX IF NOT EXISTS idx_pedido_itens_pedido ON pedido_itens(pedido_id);
CREATE INDEX IF NOT EXISTS idx_eventos_tipo ON eventos_analytics(tipo);
CREATE INDEX IF NOT EXISTS idx_agendamentos_status ON agendamentos(status);
CREATE INDEX IF NOT EXISTS idx_usuario_permissoes_usuario ON usuario_permissoes(usuario_id);
