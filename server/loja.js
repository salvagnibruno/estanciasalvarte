// Dados de contato e identidade da loja — fonte unica usada pelo site,
// pelo cabecalho e pelo catalogo em PDF. Alterar aqui muda em todo lugar.
const LOJA = {
  nome: 'Estância Salvarte',
  assinatura: 'Tradição que se veste. Qualidade que se leva.',
  descricao: 'Artigos gaúchos, confecção e serviços — bombachas, botas, alpargatas, uniformes e muito mais.',
  // Logomarca oficial da loja (arte original, sem recriacao). Mantem a placa
  // clara do fundo de proposito: o nome na logo e' marrom escuro e some se for
  // aplicado direto sobre o marrom do cabecalho ou sobre a capa do catalogo.
  logo: '/img/logo-oficial.jpg',
  favicon: '/img/favicon.png',
  telefone: '(54) 99931-5550',
  telefoneLink: 'tel:+5554999315550',
  whatsapp: 'https://wa.me/5554999315550',
  whatsappLabel: '(54) 99931-5550',
  instagram: 'https://instagram.com/estanciasalvarte',
  instagramLabel: '@estanciasalvarte',
  email: null,          // preencher quando a loja definir o e-mail comercial
  endereco: null,       // preencher com o endereco da loja, se quiser no catalogo
  site: 'estanciasalvarte.com.br',
  // Parcelamento no cartão de crédito (ver server/utils/siteConfig.js e o
  // menu Site > "Pagamento" no painel superadmin). parcelasSemJuros = até
  // quantas parcelas o cliente NÃO paga juros; parcelasMax = até quantas
  // parcelas o cartão aceita no total (as que passarem de parcelasSemJuros
  // aparecem marcadas "Com juros" na tela do cliente).
  parcelasSemJuros: 3,
  parcelasMax: 12
};

module.exports = LOJA;
