// Permissoes finas que o superadmin concede (ou nao) a cada usuario admin.
// O superadmin tem todas por definicao — nunca precisa de concessao.
//
// Para criar uma permissao nova: acrescente uma entrada aqui e proteja a rota
// correspondente com exigirPermissao('<chave>'). A tela do superadmin monta os
// checkboxes automaticamente a partir desta lista.
const PERMISSOES = [
  {
    chave: 'exportar_catalogo',
    nome: 'Exportar catálogo',
    descricao: 'Gerar o catálogo comercial completo em PDF, com produtos, fotos e preços da loja.'
  },
  {
    chave: 'gerenciar_pedidos',
    nome: 'Gerenciar pedidos',
    descricao: 'Editar itens, cupom e dados do cliente em pedidos, e reconciliar pagamentos manualmente.'
  }
];

const CHAVES = PERMISSOES.map(p => p.chave);

// Filtra uma lista qualquer, deixando so chaves reconhecidas e sem repeticao.
function normalizarPermissoes(lista) {
  if (!Array.isArray(lista)) return [];
  return [...new Set(lista.map(p => String(p || '').trim()))].filter(p => CHAVES.includes(p));
}

module.exports = { PERMISSOES, CHAVES, normalizarPermissoes };
