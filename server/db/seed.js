// Popula o banco com as categorias e produtos da loja.
// custo_fonte: 'tabela' = valor informado pelo dono da loja (lista de custos real).
//              'estimado' = não havia custo exato; foi estimado com base em item equivalente.
const { calcularPrecoVenda } = require('./pricing');

const CORES = {
  preto: { nome: 'Preto', hex: '#1a1a1a' },
  branco: { nome: 'Branco', hex: '#ffffff' },
  azulMarinho: { nome: 'Azul-marinho', hex: '#1c2b6b' },
  bordo: { nome: 'Bordô', hex: '#6d1638' },
  bege: { nome: 'Bege', hex: '#d2b48c' },
  verdeMusgo: { nome: 'Verde-musgo', hex: '#2f3a24' },
  vermelho: { nome: 'Vermelho', hex: '#d21f2c' },
  cinza: { nome: 'Cinza', hex: '#8a8f94' },
  marrom: { nome: 'Marrom', hex: '#4a2e21' },
  amareloBota: { nome: 'Amarelo', hex: '#f4c430' },
  carameloBota: { nome: 'Caramelo', hex: '#c98a3a' },
  marromBota: { nome: 'Marrom escuro', hex: '#4a2e21' },
  pretoBota: { nome: 'Preto', hex: '#14100d' }
};

// Fotos já existentes em public/img/produtos (catálogo do fornecedor Bombachas
// Pampeiro): reaproveitadas para o produto equivalente da lista nova, sem
// depender do código do produto — é só o caminho do arquivo.
const FOTO = (sufixo) => `/img/produtos/pampeiro-${sufixo}.jpg`;

const CATEGORIAS = [
  { slug: 'bombachas-masculinas', nome: 'Bombachas Masculinas', descricao: 'Bombachas masculinas, adultas e infantis.', ordem: 1 },
  { slug: 'bombachas-femininas', nome: 'Bombachas Femininas', descricao: 'Bombachas femininas, adultas e infantis, com elastano.', ordem: 2 },
  { slug: 'alpargatas', nome: 'Alpargatas', descricao: 'Alpargatas de couro, adultas e infantis.', ordem: 3 },
  { slug: 'botas', nome: 'Botas', descricao: 'Botas campeiras.', ordem: 4 },
  { slug: 'casacos-coletes', nome: 'Casacos e Coletes', descricao: 'Jaquetas, coletes — linha inverno.', ordem: 5 },
  { slug: 'camisetas-polos', nome: 'Camisetas e Polos', descricao: 'Camisetas polo em malha PV e PQ — linha verão.', ordem: 6 }
];

// Categorias extras: agrupamentos transversais (um produto pode participar de
// nenhuma, uma, várias ou todas, além da categoria principal declarada em
// cada item de PRODUTOS abaixo). Algumas repetem o nome de uma categoria
// "principal" já cadastrada em CATEGORIAS (ex.: "Bombachas Masculinas") — o
// cadastro reaproveita a existente em vez de duplicar (ver seed()).
const CATEGORIAS_EXTRA = [
  'Infantil', 'Adulto Geral', 'Masculino', 'Feminino', 'Calçados',
  'Bombachas Masculinas', 'Bombachas Femininas', 'Alpargatas', 'Botas',
  'Linha Inverno', 'Linha Verão'
];

const TAM_ADULTO = ['34', '36', '38', '40', '42', '44', '46', '48', '50', '52', '54', '56', '58', '60', '62', '64'];
const TAM_INFANTIL = ['RN', '1', '2', '4', '6', '8', '10', '12', '14', '16'];
const TAM_ROUPA_ADULTO = ['PP', 'P', 'M', 'G', 'GG', 'EG'];
const TAM_ALPARGATA_INFANTIL = ['20', '22', '24', '26', '28', '30', '32'];
const TAM_ALPARGATA_ADULTO = ['33', '34', '35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46'];

const CORES_BOMBACHA_MASC = ['preto', 'bege', 'marrom', 'verdeMusgo', 'cinza', 'azulMarinho'];
const CORES_BOMBACHA_FEM = ['preto', 'azulMarinho', 'bordo', 'bege', 'verdeMusgo'];
const CORES_BOTA = ['amareloBota', 'carameloBota', 'marromBota', 'pretoBota'];
const CORES_INVERNO = ['preto', 'cinza', 'verdeMusgo', 'azulMarinho', 'vermelho'];
const CORES_POLO_ADULTO = ['preto', 'branco', 'azulMarinho', 'verdeMusgo', 'cinza', 'vermelho', 'bordo'];
const CORES_POLO_INFANTIL = ['azulMarinho', 'vermelho'];

const PRODUTOS = [
  // ---------- Bombachas Masculinas ----------
  { nome: 'Bombacha Pampeana Adulto Masculina', categoria: 'bombachas-masculinas', publico: 'masculino', custo: 76.00,
    tamanhos: TAM_ADULTO, cores: CORES_BOMBACHA_MASC, categorias_extra: ['Adulto Geral', 'Masculino', 'Bombachas Masculinas'], imagem_url: FOTO('2410-1') },
  { nome: 'Bombacha Castelhana Adulto Masculina', categoria: 'bombachas-masculinas', publico: 'masculino', custo: 78.00,
    tamanhos: TAM_ADULTO, cores: CORES_BOMBACHA_MASC, categorias_extra: ['Adulto Geral', 'Masculino', 'Bombachas Masculinas'], imagem_url: FOTO('2410-2') },
  { nome: 'Bombacha Pampeana Adulto Masculina Com Elastano', categoria: 'bombachas-masculinas', publico: 'masculino', custo: 84.00,
    tamanhos: TAM_ADULTO, cores: CORES_BOMBACHA_MASC, categorias_extra: ['Adulto Geral', 'Masculino', 'Bombachas Masculinas'], imagem_url: FOTO('2410-1') },
  { nome: 'Bombacha Castelhana Adulto Masculina Com Elastano', categoria: 'bombachas-masculinas', publico: 'masculino', custo: 86.00,
    tamanhos: TAM_ADULTO, cores: CORES_BOMBACHA_MASC, categorias_extra: ['Adulto Geral', 'Masculino', 'Bombachas Masculinas'], imagem_url: FOTO('2410-2') },
  { nome: 'Bombacha Pampeana Infantil Masculina', categoria: 'bombachas-masculinas', publico: 'masculino', custo: 56.00,
    tamanhos: TAM_INFANTIL, cores: CORES_BOMBACHA_MASC, categorias_extra: ['Infantil', 'Masculino', 'Bombachas Masculinas'], imagem_url: FOTO('2607-3') },
  { nome: 'Bombacha Castelhana Infantil Masculina', categoria: 'bombachas-masculinas', publico: 'masculino', custo: 58.00,
    tamanhos: TAM_INFANTIL, cores: CORES_BOMBACHA_MASC, categorias_extra: ['Infantil', 'Masculino', 'Bombachas Masculinas'], imagem_url: FOTO('2607-4') },
  { nome: 'Bombacha Oxford Adulto com Favo', categoria: 'bombachas-masculinas', publico: 'unissex', custo: 88.00,
    tamanhos: TAM_ADULTO, cores: CORES_BOMBACHA_MASC, categorias_extra: ['Adulto Geral', 'Bombachas Masculinas'], imagem_url: FOTO('2410-3') },

  // ---------- Bombachas Femininas ----------
  { nome: 'Bombacha Pampeana Adulto Feminina Com Elastano', categoria: 'bombachas-femininas', publico: 'feminino', custo: 82.00,
    tamanhos: TAM_ADULTO, cores: CORES_BOMBACHA_FEM, categorias_extra: ['Adulto Geral', 'Feminino', 'Bombachas Femininas'], imagem_url: FOTO('1103-1') },
  { nome: 'Bombacha Castelhana Adulto Feminina Com Elastano', categoria: 'bombachas-femininas', publico: 'feminino', custo: 84.00,
    tamanhos: TAM_ADULTO, cores: CORES_BOMBACHA_FEM, categorias_extra: ['Adulto Geral', 'Feminino', 'Bombachas Femininas'], imagem_url: FOTO('1103-2') },
  { nome: 'Bombacha Pampeana Infantil Feminina Com Elastano', categoria: 'bombachas-femininas', publico: 'feminino', custo: 58.00,
    tamanhos: TAM_INFANTIL, cores: CORES_BOMBACHA_FEM, categorias_extra: ['Infantil', 'Feminino', 'Bombachas Femininas'], imagem_url: FOTO('2607-5') },
  { nome: 'Bombacha Castelhana Infantil Feminina Com Elastano', categoria: 'bombachas-femininas', publico: 'feminino', custo: 58.00,
    tamanhos: TAM_INFANTIL, cores: CORES_BOMBACHA_FEM, categorias_extra: ['Infantil', 'Feminino', 'Bombachas Femininas'], imagem_url: FOTO('2607-6') },

  // ---------- Calçados ----------
  { nome: 'Bota Solado de Pneu', categoria: 'botas', publico: 'unissex', custo: 155.00,
    tamanhos: TAM_ALPARGATA_ADULTO, cores: CORES_BOTA, categorias_extra: ['Adulto Geral', 'Calçados', 'Botas'], imagem_url: FOTO('2018-7') },
  { nome: 'Alpargata de Couro Adulta', categoria: 'alpargatas', publico: 'unissex', custo: 55.00,
    tamanhos: TAM_ALPARGATA_ADULTO, cores: ['marrom'], categorias_extra: ['Adulto Geral', 'Calçados', 'Alpargatas'], imagem_url: FOTO('2018-4') },
  { nome: 'Alpargata de Couro Infantil', categoria: 'alpargatas', publico: 'unissex', custo: 40.00,
    tamanhos: TAM_ALPARGATA_INFANTIL, cores: ['marrom'], categorias_extra: ['Infantil', 'Calçados', 'Alpargatas'], imagem_url: FOTO('2018-3') },

  // ---------- Casacos e Coletes (Linha Inverno) ----------
  { nome: 'Jaqueta-Colete', categoria: 'casacos-coletes', publico: 'unissex', custo: 145.00,
    tamanhos: TAM_ROUPA_ADULTO, cores: CORES_INVERNO, categorias_extra: ['Adulto Geral', 'Linha Inverno'], imagem_url: FOTO('2011-3') },
  { nome: 'Colete Adulto', categoria: 'casacos-coletes', publico: 'unissex', custo: 78.00,
    tamanhos: TAM_ROUPA_ADULTO, cores: CORES_INVERNO, categorias_extra: ['Adulto Geral', 'Linha Inverno'], imagem_url: FOTO('2011-1') },
  { nome: 'Colete Infantil', categoria: 'casacos-coletes', publico: 'unissex', custo: 68.00,
    tamanhos: TAM_INFANTIL, cores: ['azulMarinho', 'vermelho', 'cinza'], categorias_extra: ['Infantil', 'Linha Inverno'], imagem_url: null },

  // ---------- Camisetas e Polos (Linha Verão) ----------
  { nome: 'Camiseta Polo Malha PV Adulto', categoria: 'camisetas-polos', publico: 'unissex', custo: 42.00,
    tamanhos: TAM_ROUPA_ADULTO, cores: CORES_POLO_ADULTO, categorias_extra: ['Adulto Geral', 'Linha Verão'], imagem_url: FOTO('1987-1') },
  { nome: 'Camiseta Polo Malha PQ Adulto', categoria: 'camisetas-polos', publico: 'unissex', custo: 45.00,
    tamanhos: TAM_ROUPA_ADULTO, cores: CORES_POLO_ADULTO, categorias_extra: ['Adulto Geral', 'Linha Verão'], imagem_url: FOTO('1987-1') },
  { nome: 'Camiseta Polo Malha PV Infantil', categoria: 'camisetas-polos', publico: 'unissex', custo: 30.00,
    tamanhos: TAM_INFANTIL, cores: CORES_POLO_INFANTIL, categorias_extra: ['Infantil', 'Linha Verão'], imagem_url: FOTO('1987-4') },
  { nome: 'Camiseta Polo Malha PQ Infantil', categoria: 'camisetas-polos', publico: 'unissex', custo: 35.00,
    tamanhos: TAM_INFANTIL, cores: CORES_POLO_INFANTIL, categorias_extra: ['Infantil', 'Linha Verão'], imagem_url: FOTO('1987-4') }
];

async function seed(db) {
  const jaTemDados = (await db.prepare('SELECT COUNT(*) AS n FROM produtos').get()).n > 0;
  if (jaTemDados) return { skipped: true };

  const catIds = {};
  // Nome de categoria -> id, para o lookup das categorias extras (algumas
  // repetem o nome de uma categoria principal já criada acima — reaproveita
  // em vez de duplicar).
  const catIdPorNome = {};
  let categoriasExtraCriadas = 0;

  const tx1 = db.transaction(async (tx) => {
    const insCategoria = tx.prepare('INSERT INTO categorias (nome, slug, descricao, ordem) VALUES (@nome, @slug, @descricao, @ordem)');
    for (const c of CATEGORIAS) {
      const info = await insCategoria.run(c);
      catIds[c.slug] = info.lastInsertRowid;
      catIdPorNome[c.nome] = info.lastInsertRowid;
    }
    const insCategoriaExtra = tx.prepare('INSERT INTO categorias (nome, slug, descricao, ordem) VALUES (?, ?, NULL, ?)');
    for (let i = 0; i < CATEGORIAS_EXTRA.length; i++) {
      const nome = CATEGORIAS_EXTRA[i];
      if (catIdPorNome[nome]) continue; // já existe como categoria principal
      const slug = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      const info = await insCategoriaExtra.run(nome, slug, CATEGORIAS.length + i + 1);
      catIdPorNome[nome] = info.lastInsertRowid;
      categoriasExtraCriadas++;
    }
  });
  await tx1();

  const tx2 = db.transaction(async (tx) => {
    const insProduto = tx.prepare(`INSERT INTO produtos
      (categoria_id, codigo, nome, descricao, custo, custo_fonte, percentual_markup, preco_venda, tipo_estoque, publico, imagem_url, ativo)
      VALUES (@categoria_id, @codigo, @nome, @descricao, @custo, 'tabela', @percentual_markup, @preco_venda, @tipo_estoque, @publico, @imagem_url, 1)`);
    const insTamanho = tx.prepare('INSERT INTO produto_tamanhos (produto_id, tamanho) VALUES (?, ?)');
    const insCor = tx.prepare('INSERT INTO produto_cores (produto_id, cor_nome, cor_hex) VALUES (?, ?, ?)');
    const insEstoque = tx.prepare('INSERT INTO produto_estoque (produto_id, tamanho, cor, quantidade) VALUES (?, ?, ?, ?)');
    const insProdutoCategoria = tx.prepare('INSERT OR IGNORE INTO produto_categorias (produto_id, categoria_id) VALUES (?, ?)');

    let seq = 0;
    for (const p of PRODUTOS) {
      seq++;
      const { percentual, preco } = calcularPrecoVenda(p.custo);
      const codigo = `P${String(seq).padStart(3, '0')}`;
      const categoriaPrincipalId = catIds[p.categoria];
      const info = await insProduto.run({
        categoria_id: categoriaPrincipalId,
        codigo,
        nome: p.nome,
        descricao: null,
        custo: p.custo,
        percentual_markup: percentual,
        preco_venda: preco,
        tipo_estoque: 'estoque',
        publico: p.publico,
        imagem_url: p.imagem_url || null
      });
      const produtoId = info.lastInsertRowid;

      for (const t of p.tamanhos) await insTamanho.run(produtoId, t);
      for (const corKey of p.cores) {
        const cor = CORES[corKey] || { nome: corKey, hex: '#333333' };
        await insCor.run(produtoId, cor.nome, cor.hex);
      }
      // estoque inicial de demonstração: 6 unidades por tamanho, na 1a cor cadastrada
      const primeiraCorKey = p.cores[0];
      const primeiraCor = (CORES[primeiraCorKey] || { nome: primeiraCorKey }).nome;
      for (const t of p.tamanhos) await insEstoque.run(produtoId, t, primeiraCor, 6);

      await insProdutoCategoria.run(produtoId, categoriaPrincipalId);
      for (const nomeExtra of p.categorias_extra) {
        const categoriaId = catIdPorNome[nomeExtra];
        if (categoriaId) await insProdutoCategoria.run(produtoId, categoriaId);
      }
    }
  });
  await tx2();

  return {
    skipped: false,
    total: PRODUTOS.length,
    categorias: CATEGORIAS.length + categoriasExtraCriadas
  };
}

module.exports = { seed, CATEGORIAS, CATEGORIAS_EXTRA, PRODUTOS, CORES };
