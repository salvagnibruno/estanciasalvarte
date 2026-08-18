// Dados vindos do catalogo do fornecedor (Fabrica Bombachas Pampeiro, ed. 01
// 2024/25) e as fotos extraidas dele. Roda pelo db/db.js a cada inicializacao e
// e' idempotente: so cria o que falta e nunca sobrescreve o que o admin mexeu.
//
// Fotos: public/img/produtos/pampeiro-<codigo com - no lugar de />.jpg
const fs = require('fs');
const path = require('path');
const { calcularPrecoVenda } = require('./pricing');

const PASTA_FOTOS = path.join(__dirname, '..', 'public', 'img', 'produtos');
const URL_FOTOS = '/img/produtos';

// Paleta da loja (mesmos hexes ja usados pelos outros produtos).
const CORES = {
  preto: { cor_nome: 'Preto', cor_hex: '#1a1a1a' },
  bege: { cor_nome: 'Bege', cor_hex: '#d2b48c' },
  marrom: { cor_nome: 'Marrom', cor_hex: '#4a2e21' },
  musgo: { cor_nome: 'Verde-musgo', cor_hex: '#2f3a24' },
  cinza: { cor_nome: 'Cinza', cor_hex: '#8a8f94' },
  marinho: { cor_nome: 'Azul-marinho', cor_hex: '#1c2b6b' }
};

// 34 ao 64, de dois em dois — igual as bombachas femininas adultas ja cadastradas.
const TAMANHOS_ADULTO = Array.from({ length: 16 }, (_, i) => String(34 + i * 2));

// As 6 cores que o catalogo do fornecedor mostra para toda a linha masculina.
const CORES_BOMBACHA = [CORES.preto, CORES.bege, CORES.marrom, CORES.musgo, CORES.cinza, CORES.marinho];

const CATEGORIA_MASCULINA = {
  nome: 'Bombachas Masculinas',
  slug: 'bombachas-masculinas',
  descricao: 'Bombachas masculinas adultas — tradição, estilo e durabilidade para o dia a dia e para as ocasiões especiais.',
  // Entra logo depois de "Bombachas Femininas" para as duas linhas ficarem juntas.
  depois_de: 'bombachas-femininas'
};

// Custo: o PDF do fornecedor nao traz preco. Cada valor abaixo e' o custo do
// equivalente direto ja cadastrado (mesma peca na linha feminina adulta), por
// isso entram como 'estimado' — o superadmin confirma pela tabela do fornecedor
// e o preco se recalcula sozinho.
const PRODUTOS_MASCULINOS = [
  {
    codigo: '2410/1',
    nome: 'Bombacha Pampeana Masculina Adulta',
    descricao: 'Bombacha pampeana masculina em tecido resistente, com caimento tradicional. '
      + 'Confeccionada para o uso diário no campo e para as ocasiões especiais.',
    custo: 82,           // = 1103/1 Bombacha Pampeana Feminina Adulta
    custo_base: '1103/1'
  },
  {
    codigo: '2410/2',
    nome: 'Bombacha Castelhana Masculina Adulta',
    descricao: 'Bombacha castelhana masculina, de corte mais amplo e acabamento reforçado. '
      + 'A escolha clássica de quem monta e trabalha no campo.',
    custo: 84,           // = 1103/2 Bombacha Castelhana Feminina Adulta
    custo_base: '1103/2'
  },
  {
    codigo: '2410/3',
    nome: 'Bombacha Oxford Favo Masculina Adulta',
    descricao: 'Bombacha masculina em oxford com textura favo de mel, leve e de secagem rápida. '
      + 'Boa alternativa para os dias quentes sem perder a tradição.',
    custo: 84,           // faixa da castelhana adulta (no infantil, favo = castelhana)
    custo_base: '1103/2'
  },
  {
    codigo: '2410/4',
    nome: 'Bombacha Oxford Lisa Masculina Adulta',
    descricao: 'Bombacha masculina em oxford liso, de toque macio e caimento leve. '
      + 'Versátil para o dia a dia, no campo ou na cidade.',
    custo: 82,           // faixa da pampeana adulta
    custo_base: '1103/1'
  }
];

// codigo -> nome do arquivo da foto. Extraidas do PDF do fornecedor.
function arquivoFoto(codigo) {
  return `pampeiro-${codigo.replace('/', '-')}.jpg`;
}

function fotoDisponivel(codigo) {
  return fs.existsSync(path.join(PASTA_FOTOS, arquivoFoto(codigo)));
}

// ---------- Categoria ----------
function garantirCategoria(db) {
  const existente = db.prepare('SELECT id FROM categorias WHERE slug = ?').get(CATEGORIA_MASCULINA.slug);
  if (existente) return { id: existente.id, criada: false };

  const anterior = db.prepare('SELECT ordem FROM categorias WHERE slug = ?').get(CATEGORIA_MASCULINA.depois_de);
  const ordem = anterior ? anterior.ordem + 1 : 1;

  const criar = db.transaction(() => {
    // Abre espaco na ordenacao para a nova categoria entrar no lugar certo.
    db.prepare('UPDATE categorias SET ordem = ordem + 1 WHERE ordem >= ?').run(ordem);
    return db.prepare('INSERT INTO categorias (nome, slug, descricao, ordem) VALUES (?, ?, ?, ?)')
      .run(CATEGORIA_MASCULINA.nome, CATEGORIA_MASCULINA.slug, CATEGORIA_MASCULINA.descricao, ordem)
      .lastInsertRowid;
  });

  return { id: criar(), criada: true };
}

// ---------- Produtos da linha masculina ----------
function garantirProdutos(db, categoriaId) {
  const criados = [];

  for (const item of PRODUTOS_MASCULINOS) {
    if (db.prepare('SELECT id FROM produtos WHERE codigo = ?').get(item.codigo)) continue;

    const { percentual, preco } = calcularPrecoVenda(item.custo);
    const foto = fotoDisponivel(item.codigo) ? `${URL_FOTOS}/${arquivoFoto(item.codigo)}` : null;

    const criar = db.transaction(() => {
      const id = db.prepare(`INSERT INTO produtos
        (categoria_id, codigo, nome, descricao, custo, custo_fonte, percentual_markup, preco_venda,
         tipo_estoque, imagem_url, destaque, ativo)
        VALUES (?, ?, ?, ?, ?, 'estimado', ?, ?, 'sob_encomenda', ?, 0, 1)`)
        .run(categoriaId, item.codigo, item.nome, item.descricao, item.custo, percentual, preco, foto)
        .lastInsertRowid;

      const insTam = db.prepare('INSERT INTO produto_tamanhos (produto_id, tamanho) VALUES (?, ?)');
      TAMANHOS_ADULTO.forEach(t => insTam.run(id, t));
      const insCor = db.prepare('INSERT INTO produto_cores (produto_id, cor_nome, cor_hex) VALUES (?, ?, ?)');
      CORES_BOMBACHA.forEach(c => insCor.run(id, c.cor_nome, c.cor_hex));
      return id;
    });

    criar();
    criados.push(`${item.codigo} ${item.nome} (custo estimado R$ ${item.custo} de ${item.custo_base} -> venda R$ ${preco})`);
  }

  return criados;
}

// ---------- Fotos dos produtos ----------
// Preenche imagem_url apenas de quem ainda esta sem foto: se o admin subiu uma
// foto propria pelo painel, ela fica.
function vincularFotos(db) {
  const semFoto = db.prepare(
    `SELECT id, codigo FROM produtos WHERE codigo IS NOT NULL AND (imagem_url IS NULL OR imagem_url = '')`
  ).all();

  const gravar = db.prepare(`UPDATE produtos SET imagem_url = ?, atualizado_em = datetime('now') WHERE id = ?`);
  const vinculadas = [];
  const aplicar = db.transaction(() => {
    for (const p of semFoto) {
      if (!fotoDisponivel(p.codigo)) continue;
      gravar.run(`${URL_FOTOS}/${arquivoFoto(p.codigo)}`, p.id);
      vinculadas.push(p.codigo);
    }
  });
  aplicar();

  return vinculadas;
}

function aplicar(db) {
  const mudancas = [];

  const categoria = garantirCategoria(db);
  if (categoria.criada) mudancas.push(`categoria "${CATEGORIA_MASCULINA.nome}" criada`);

  const criados = garantirProdutos(db, categoria.id);
  criados.forEach(c => mudancas.push('produto ' + c));

  const fotos = vincularFotos(db);
  if (fotos.length) mudancas.push(`${fotos.length} foto(s) do catálogo Pampeiro vinculadas`);

  return mudancas;
}

module.exports = { aplicar, PRODUTOS_MASCULINOS, CATEGORIA_MASCULINA, arquivoFoto };
