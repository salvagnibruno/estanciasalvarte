// Popula o banco com as categorias e produtos extraidos do catalogo
// (Catalogo_Rancho_Salvagni.pdf) + custos das tabelas de fornecedor enviadas.
// custo_fonte: 'tabela' = valor veio de uma tabela de custos do fornecedor.
//              'estimado' = nao havia custo exato informado para esse item;
//              foi estimado com base em itens equivalentes. Revisar no painel
//              superadmin (Produtos > Custo) assim que possivel.
const { calcularPrecoVenda } = require('./pricing');

const CORES = {
  preto: { nome: 'Preto', hex: '#1a1a1a' },
  branco: { nome: 'Branco', hex: '#ffffff' },
  azulMarinho: { nome: 'Azul-marinho', hex: '#1c2b6b' },
  bordo: { nome: 'Bordô', hex: '#6d1638' },
  bege: { nome: 'Bege', hex: '#d2b48c' },
  verdeMusgo: { nome: 'Verde-musgo', hex: '#2f3a24' },
  vermelho: { nome: 'Vermelho', hex: '#d21f2c' },
  pink: { nome: 'Pink', hex: '#e6178f' },
  rosaClaro: { nome: 'Rosa-claro', hex: '#f2b8cc' },
  mostarda: { nome: 'Mostarda', hex: '#d9a441' },
  marrom: { nome: 'Marrom', hex: '#4a2e21' },
  cinza: { nome: 'Cinza', hex: '#8a8f94' },
  amareloBota: { nome: 'Amarelo', hex: '#f4c430' },
  carameloBota: { nome: 'Caramelo', hex: '#c98a3a' },
  marromBota: { nome: 'Marrom escuro', hex: '#4a2e21' },
  pretoBota: { nome: 'Preto', hex: '#14100d' }
};

const CATEGORIAS = [
  { slug: 'bombachas-femininas', nome: 'Bombachas Femininas', descricao: 'Bombachas femininas adultas, tradicao e conforto.', ordem: 1 },
  { slug: 'calcas-cargo', nome: 'Calças Cargo', descricao: 'Calças cargo masculinas e femininas.', ordem: 2 },
  { slug: 'saias', nome: 'Saias de Prenda', descricao: 'Saias oxford e suede para prendas.', ordem: 3 },
  { slug: 'linha-infantil', nome: 'Linha Infantil', descricao: 'Bombachas e saias infantis, do RN ao 16.', ordem: 4 },
  { slug: 'linha-verao', nome: 'Linha Verão', descricao: 'Camisetas polo, baby look e bermudas.', ordem: 5 },
  { slug: 'linha-inverno', nome: 'Linha Inverno', descricao: 'Coletes e jaquetas.', ordem: 6 },
  { slug: 'linha-uniformes', nome: 'Linha Uniformes', descricao: 'Jalecos, macacões e uniformes profissionais.', ordem: 7 },
  { slug: 'alpargatas', nome: 'Alpargatas', descricao: 'Alpargatas de tecido e couro.', ordem: 8 },
  { slug: 'botas', nome: 'Botas', descricao: 'Botas campeiras infantis e adultas.', ordem: 9 },
  { slug: 'erva-mate-bebidas', nome: 'Erva-Mate & Bebidas', descricao: 'Erva-mate, cachaça e outros artigos gaúchos.', ordem: 10 },
  { slug: 'servicos', nome: 'Serviços', descricao: 'Serviços de confecção e ajustes sob agendamento.', ordem: 11 }
];

// tamanhosPadraoAdulto / Infantil helpers
const TAM_ADULTO = ['34','36','38','40','42','44','46','48','50','52','54','56','58','60','62','64'];
const TAM_INFANTIL = ['RN','1','2','4','6','8','10','12','14','16'];
const TAM_ROUPA_ADULTO = ['PP','P','M','G','GG','EG'];
const TAM_ALPARGATA_INFANTIL = ['20','22','24','26','28','30','32'];
const TAM_ALPARGATA_ADULTO = ['33','34','35','36','37','38','39','40','41','42','43','44','45','46'];

const PRODUTOS = [
  // Bombachas Femininas
  { codigo: '1103/1', nome: 'Bombacha Pampeana Feminina Adulta', categoria: 'bombachas-femininas', custo: 82, custoFonte: 'tabela',
    tamanhos: TAM_ADULTO, cores: ['preto','azulMarinho','bordo','bege','verdeMusgo'] },
  { codigo: '1103/2', nome: 'Bombacha Castelhana Feminina Adulta', categoria: 'bombachas-femininas', custo: 84, custoFonte: 'tabela',
    tamanhos: TAM_ADULTO, cores: ['preto','azulMarinho','bordo','bege','verdeMusgo'] },

  // Calça Cargo
  { codigo: '1309/1', nome: 'Calça Cargo Feminina', categoria: 'calcas-cargo', custo: 88, custoFonte: 'tabela',
    tamanhos: TAM_ADULTO, cores: ['preto','azulMarinho','bordo','bege','verdeMusgo'] },
  { codigo: '1309/2', nome: 'Calça Cargo Masculina', categoria: 'calcas-cargo', custo: 82, custoFonte: 'tabela',
    tamanhos: TAM_ADULTO, cores: ['preto','bege','marrom','verdeMusgo','cinza','azulMarinho'] },

  // Saias
  { codigo: '1103/3', nome: 'Saia Oxford', categoria: 'saias', custo: 75, custoFonte: 'tabela',
    tamanhos: TAM_ADULTO, cores: ['preto','bordo','vermelho','marrom','pink','rosaClaro','bege','mostarda','azulMarinho','verdeMusgo'] },
  { codigo: '1103/4', nome: 'Saia Suede', categoria: 'saias', custo: 85, custoFonte: 'tabela',
    tamanhos: TAM_ADULTO, cores: ['preto','bordo','vermelho','marrom','pink','rosaClaro','bege','mostarda','azulMarinho','verdeMusgo'] },

  // Linha Infantil
  { codigo: '2607/1', nome: 'Bombacha Oxford Favo Masculina Infantil', categoria: 'linha-infantil', custo: 58, custoFonte: 'estimado',
    tamanhos: TAM_INFANTIL, cores: ['preto','bege','marrom','verdeMusgo','cinza','azulMarinho'] },
  { codigo: '2607/2', nome: 'Bombacha Oxford Lisa Masculina Infantil', categoria: 'linha-infantil', custo: 31, custoFonte: 'estimado',
    tamanhos: TAM_INFANTIL, cores: ['preto','bege','marrom','verdeMusgo','cinza','azulMarinho'] },
  { codigo: '2607/3', nome: 'Bombacha Pampeana Masculina Infantil', categoria: 'linha-infantil', custo: 56, custoFonte: 'tabela',
    tamanhos: TAM_INFANTIL, cores: ['preto','bege','marrom','verdeMusgo','cinza','azulMarinho'] },
  { codigo: '2607/4', nome: 'Bombacha Castelhana Masculina Infantil', categoria: 'linha-infantil', custo: 58, custoFonte: 'tabela',
    tamanhos: TAM_INFANTIL, cores: ['preto','bege','marrom','verdeMusgo','cinza','azulMarinho'] },
  { codigo: '2607/5', nome: 'Bombacha Pampeana Feminina Infantil', categoria: 'linha-infantil', custo: 58, custoFonte: 'tabela',
    tamanhos: TAM_INFANTIL, cores: ['preto','azulMarinho','bordo','bege','verdeMusgo'] },
  { codigo: '2607/6', nome: 'Bombacha Castelhana Feminina Infantil', categoria: 'linha-infantil', custo: 58, custoFonte: 'tabela',
    tamanhos: TAM_INFANTIL, cores: ['preto','azulMarinho','bordo','bege','verdeMusgo'] },
  { codigo: '2607/7', nome: 'Saia Infantil', categoria: 'linha-infantil', custo: 55, custoFonte: 'tabela',
    tamanhos: TAM_INFANTIL, cores: ['pink','rosaClaro','vermelho','bordo','azulMarinho','verdeMusgo'] },

  // Linha Verao
  { codigo: '1987/1', nome: 'Camiseta Polo Adulta', categoria: 'linha-verao', custo: 42, custoFonte: 'tabela',
    tamanhos: TAM_ROUPA_ADULTO, cores: ['preto','branco','azulMarinho','verdeMusgo','cinza','vermelho','bordo'] },
  { codigo: '1987/2', nome: 'Bermuda Adulta', categoria: 'linha-verao', custo: 52, custoFonte: 'tabela',
    tamanhos: TAM_ROUPA_ADULTO, cores: ['preto','bege','marrom','verdeMusgo','cinza','azulMarinho'] },
  { codigo: '1987/3', nome: 'Baby Look Adulta', categoria: 'linha-verao', custo: 42, custoFonte: 'tabela',
    tamanhos: TAM_ROUPA_ADULTO, cores: ['preto','branco','azulMarinho','verdeMusgo','cinza','vermelho','bordo','pink'] },
  { codigo: '1987/4', nome: 'Camiseta Polo Infantil', categoria: 'linha-verao', custo: 30, custoFonte: 'tabela',
    tamanhos: TAM_INFANTIL, cores: ['azulMarinho','vermelho'] },
  { codigo: '1987/5', nome: 'Baby Look Infantil', categoria: 'linha-verao', custo: 35, custoFonte: 'tabela',
    tamanhos: TAM_INFANTIL, cores: ['vermelho','pink'] },
  { codigo: '1987/6', nome: 'Bermuda Masculina Infantil', categoria: 'linha-verao', custo: 45, custoFonte: 'estimado',
    tamanhos: TAM_INFANTIL, cores: ['azulMarinho'] },

  // Linha Inverno
  { codigo: '2011/1', nome: 'Colete Reversível Feminino', categoria: 'linha-inverno', custo: 98, custoFonte: 'tabela',
    tamanhos: TAM_ROUPA_ADULTO, cores: ['preto','cinza','verdeMusgo','azulMarinho','vermelho','bordo','pink'] },
  { codigo: '2011/2', nome: 'Colete Reversível Masculino', categoria: 'linha-inverno', custo: 98, custoFonte: 'tabela',
    tamanhos: TAM_ROUPA_ADULTO, cores: ['preto','cinza','verdeMusgo','azulMarinho','vermelho','bordo'] },
  { codigo: '2011/3', nome: 'Jaqueta Colete Feminina', categoria: 'linha-inverno', custo: 145, custoFonte: 'tabela',
    tamanhos: TAM_ROUPA_ADULTO, cores: ['preto','cinza','verdeMusgo','azulMarinho','vermelho','bordo','pink'] },
  { codigo: '2011/4', nome: 'Jaqueta Colete Masculina', categoria: 'linha-inverno', custo: 145, custoFonte: 'tabela',
    tamanhos: TAM_ROUPA_ADULTO, cores: ['preto','cinza','verdeMusgo','azulMarinho','vermelho'] },
  { codigo: '2011/5', nome: 'Jaqueta Soft Feminina', categoria: 'linha-inverno', custo: 145, custoFonte: 'estimado',
    tamanhos: TAM_ROUPA_ADULTO, cores: ['preto','cinza','verdeMusgo','azulMarinho','vermelho','bordo','pink'] },
  { codigo: '2011/6', nome: 'Jaqueta Soft Masculina', categoria: 'linha-inverno', custo: 145, custoFonte: 'estimado',
    tamanhos: TAM_ROUPA_ADULTO, cores: ['preto','cinza','verdeMusgo','azulMarinho','vermelho'] },

  // Linha Uniformes
  { codigo: '1975/1', nome: 'Jaleco Manga Curta', categoria: 'linha-uniformes', custo: 65, custoFonte: 'estimado',
    tamanhos: ['PP','P','M','G','GG','EG','EXG'], cores: ['azulMarinho','cinza'] },
  { codigo: '1975/2', nome: 'Jaleco Manga Longa', categoria: 'linha-uniformes', custo: 75, custoFonte: 'estimado',
    tamanhos: ['PP','P','M','G','GG','EG','EXG'], cores: ['azulMarinho','cinza'] },
  { codigo: '1975/3', nome: 'Macacão Manga Curta', categoria: 'linha-uniformes', custo: 95, custoFonte: 'estimado',
    tamanhos: ['PP','P','M','G','GG','EG','EXG'], cores: ['azulMarinho','cinza'] },
  { codigo: '1975/4', nome: 'Macacão Manga Longa', categoria: 'linha-uniformes', custo: 110, custoFonte: 'estimado',
    tamanhos: ['PP','P','M','G','GG','EG','EXG'], cores: ['azulMarinho','cinza'] },
  { codigo: '1975/5', nome: 'Camiseta Uniforme', categoria: 'linha-uniformes', custo: 35, custoFonte: 'estimado',
    tamanhos: ['PP','P','M','G','GG','EG','EXG'], cores: ['azulMarinho','cinza'] },
  { codigo: '1975/6', nome: 'Bermuda Uniforme', categoria: 'linha-uniformes', custo: 52, custoFonte: 'estimado',
    tamanhos: ['PP','P','M','G','GG','EG','EXG'], cores: ['azulMarinho','cinza'] },
  { codigo: '1975/7', nome: 'Calça Uniforme', categoria: 'linha-uniformes', custo: 70, custoFonte: 'estimado',
    tamanhos: ['PP','P','M','G','GG','EG','EXG'], cores: ['azulMarinho','cinza'] },

  // Alpargatas
  { codigo: '2018/1', nome: 'Alpargata Infantil de Tecido', categoria: 'alpargatas', custo: 30, custoFonte: 'estimado',
    tamanhos: TAM_ALPARGATA_INFANTIL, cores: ['preto','branco','azulMarinho','verdeMusgo','bordo'] },
  { codigo: '2018/2', nome: 'Alpargata Adulta de Tecido', categoria: 'alpargatas', custo: 38, custoFonte: 'tabela',
    tamanhos: TAM_ALPARGATA_ADULTO, cores: ['preto','branco','azulMarinho','verdeMusgo','bordo'] },
  { codigo: '2018/3', nome: 'Alpargata Infantil de Couro', categoria: 'alpargatas', custo: 40, custoFonte: 'tabela',
    tamanhos: TAM_ALPARGATA_INFANTIL, cores: ['marrom'] },
  { codigo: '2018/4', nome: 'Alpargata Adulta de Couro', categoria: 'alpargatas', custo: 55, custoFonte: 'tabela',
    tamanhos: TAM_ALPARGATA_ADULTO, cores: ['marrom'] },

  // Botas
  { codigo: '2018/5', nome: 'Bota Infantil Campeira Pneu', categoria: 'botas', custo: 115, custoFonte: 'tabela',
    tamanhos: TAM_ALPARGATA_INFANTIL, cores: ['amareloBota','carameloBota','marromBota','pretoBota'] },
  { codigo: '2018/6', nome: 'Bota Infantil Campeira Gel', categoria: 'botas', custo: 115, custoFonte: 'tabela',
    tamanhos: TAM_ALPARGATA_INFANTIL, cores: ['amareloBota','carameloBota','marromBota','pretoBota'] },
  { codigo: '2018/7', nome: 'Bota Adulto Campeira Pneu', categoria: 'botas', custo: 155, custoFonte: 'tabela',
    tamanhos: TAM_ALPARGATA_ADULTO, cores: ['amareloBota','carameloBota','marromBota','pretoBota'] },
  { codigo: '2018/8', nome: 'Bota Adulto Campeira Gel', categoria: 'botas', custo: 170, custoFonte: 'tabela',
    tamanhos: TAM_ALPARGATA_ADULTO, cores: ['amareloBota','carameloBota','marromBota','pretoBota'] },
  { codigo: '2018/9', nome: 'Bota Adulto Ginete Gel', categoria: 'botas', custo: 195, custoFonte: 'estimado',
    tamanhos: TAM_ALPARGATA_ADULTO, cores: ['amareloBota','carameloBota','marromBota','pretoBota'] },
  { codigo: '2018/10', nome: 'Bota Adulto Cano Duro Gel', categoria: 'botas', custo: 225, custoFonte: 'tabela',
    tamanhos: TAM_ALPARGATA_ADULTO, cores: ['amareloBota','carameloBota','marromBota','pretoBota'] }
];

function seed(db) {
  const jaTemDados = db.prepare('SELECT COUNT(*) AS n FROM produtos').get().n > 0;
  if (jaTemDados) return { skipped: true };

  const insCategoria = db.prepare('INSERT INTO categorias (nome, slug, descricao, ordem) VALUES (@nome, @slug, @descricao, @ordem)');
  const catIds = {};
  const tx1 = db.transaction(() => {
    for (const c of CATEGORIAS) {
      const info = insCategoria.run(c);
      catIds[c.slug] = info.lastInsertRowid;
    }
  });
  tx1();

  const insProduto = db.prepare(`INSERT INTO produtos
    (categoria_id, codigo, nome, descricao, custo, custo_fonte, percentual_markup, preco_venda, tipo_estoque, imagem_url, ativo)
    VALUES (@categoria_id, @codigo, @nome, @descricao, @custo, @custo_fonte, @percentual_markup, @preco_venda, @tipo_estoque, @imagem_url, 1)`);
  const insTamanho = db.prepare('INSERT INTO produto_tamanhos (produto_id, tamanho) VALUES (?, ?)');
  const insCor = db.prepare('INSERT INTO produto_cores (produto_id, cor_nome, cor_hex) VALUES (?, ?, ?)');
  const insEstoque = db.prepare('INSERT INTO produto_estoque (produto_id, tamanho, cor, quantidade) VALUES (?, ?, ?, ?)');

  const tx2 = db.transaction(() => {
    let seq = 0;
    for (const p of PRODUTOS) {
      seq++;
      const { percentual, preco } = calcularPrecoVenda(p.custo);
      // uma pequena parte do catalogo comeca sob encomenda para demonstrar o fluxo
      const tipoEstoque = (seq % 9 === 0) ? 'sob_encomenda' : 'estoque';
      const info = insProduto.run({
        categoria_id: catIds[p.categoria],
        codigo: p.codigo,
        nome: p.nome,
        descricao: p.descricao || null,
        custo: p.custo,
        custo_fonte: p.custoFonte,
        percentual_markup: percentual,
        preco_venda: preco,
        tipo_estoque: tipoEstoque,
        imagem_url: null
      });
      const produtoId = info.lastInsertRowid;
      for (const t of p.tamanhos) insTamanho.run(produtoId, t);
      for (const corKey of p.cores) {
        const cor = CORES[corKey] || { nome: corKey, hex: '#333333' };
        insCor.run(produtoId, cor.nome, cor.hex);
      }
      if (tipoEstoque === 'estoque') {
        // estoque inicial de demonstracao: 6 unidades por tamanho, so na 1a cor cadastrada
        const primeiraCorKey = p.cores[0];
        const primeiraCor = (CORES[primeiraCorKey] || { nome: primeiraCorKey }).nome;
        for (const t of p.tamanhos) {
          insEstoque.run(produtoId, t, primeiraCor, 6);
        }
      }
    }
  });
  tx2();

  return { skipped: false, total: PRODUTOS.length, categorias: CATEGORIAS.length };
}

module.exports = { seed, CATEGORIAS, PRODUTOS, CORES };
