const express = require('express');
const router = express.Router();
const db = require('../db/db');
const { obterCarrinhoAtual, montarRespostaCarrinho } = require('./carrinho');
const pagamento = require('./pagamento');
const { registrarCliente, gerarCodigoPedido } = require('../db/migrate');
const { avaliarCupom, registrarUsoCupom } = require('./cupons');
const { validarCPF, somenteDigitos } = require('../utils/cpf');
const email = require('../utils/email');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UFS_VALIDAS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB',
  'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

// Endereço completo é exigido tanto do residencial quanto do de entrega (quando
// diferente do residencial): é o que a nota fiscal e a entrega precisam.
function erroDoEndereco(e, rotulo) {
  e = e || {};
  if (!e.cep || !e.logradouro || !e.numero || !e.bairro || !e.cidade || !e.uf) {
    return `Informe o endereço ${rotulo} completo (CEP, logradouro, número, bairro e cidade/UF).`;
  }
  if (!UFS_VALIDAS.includes(String(e.uf).toUpperCase())) {
    return `UF do endereço ${rotulo} inválida.`;
  }
  return null;
}

function formatarEnderecoTexto(e) {
  return [
    `${e.logradouro}, ${e.numero}${e.complemento ? ' - ' + e.complemento : ''}`,
    e.bairro,
    `${e.cidade}/${String(e.uf).toUpperCase()}`,
    e.cep ? `CEP ${e.cep}` : null
  ].filter(Boolean).join(' - ');
}

// Estoque e' reservado (debitado) na criacao do pedido, nao so' quando pago —
// para nao vender o mesmo item pra dois clientes com pagamento pendente (ver
// server/utils/pagamentoStatus.js, que devolve o estoque se o pedido expirar,
// for cancelado ou tiver o pagamento recusado). Produto "sob encomenda" nao
// tem estoque proprio: a loja produz/compra por pedido, entao nunca falta.
// `itens` aqui vem de montarRespostaCarrinho, que ja traz `tipo_estoque`.
//
// Item sem estoque suficiente NAO bloqueia o checkout: o pedido segue normal
// (a quantidade que faltar vira uma encomenda automatica, ver checkout()
// abaixo) — so' informamos o cliente do que ficou pendente.
async function itensComFaltaDeEstoque(itens) {
  const faltantes = [];
  for (const item of itens) {
    if (item.tipo_estoque === 'sob_encomenda') continue;
    // SUM em vez de pegar uma linha so': a baixa de estoque (mais abaixo, e em
    // devolverEstoquePedido/ajustarEstoqueTroca) ja' afeta TODAS as linhas que
    // baterem no IFNULL, entao a conferencia precisa enxergar o mesmo total —
    // senao uma duplicata remanescente (de antes do indice unico por expressao
    // existir) engana a conferencia mesmo com o estoque de verdade disponivel.
    const linha = await db.prepare(`SELECT SUM(quantidade) AS quantidade FROM produto_estoque
      WHERE produto_id = ? AND IFNULL(tamanho,'') = IFNULL(?,'') AND IFNULL(cor,'') = IFNULL(?,'')`)
      .get(item.produto_id, item.tamanho, item.cor);
    const disponivel = linha && linha.quantidade != null ? linha.quantidade : 0;
    if (disponivel < item.quantidade) faltantes.push({ ...item, faltam: item.quantidade - disponivel });
  }
  return faltantes;
}

function mensagemEncomendas(itensFaltantes) {
  if (!itensFaltantes.length) return null;
  const partes = itensFaltantes.map(i => `"${i.produto_nome}" (${i.faltam} unidade${i.faltam > 1 ? 's' : ''})`);
  return `Sem estoque suficiente para ${partes.join(', ')} agora — registramos um pedido de encomenda e vamos combinar o prazo pelo WhatsApp/telefone.`;
}

router.post('/checkout', async (req, res) => {
  const {
    nome_cliente, email_cliente, telefone_cliente, cpf_cliente,
    endereco_residencial, entrega_igual_residencial, endereco_entrega,
    forma_pagamento, cupom
  } = req.body || {};

  if (!nome_cliente || !telefone_cliente) {
    return res.status(400).json({ erro: 'Nome e telefone são obrigatórios para finalizar o pedido.' });
  }
  if (!email_cliente || !EMAIL_REGEX.test(String(email_cliente).trim())) {
    return res.status(400).json({ erro: 'Informe um e-mail válido: é necessário para a nota fiscal e para acompanhar o pedido.' });
  }
  if (!validarCPF(cpf_cliente)) {
    return res.status(400).json({ erro: 'Informe um CPF válido: é necessário para a emissão da nota fiscal.' });
  }

  const erroResidencial = erroDoEndereco(endereco_residencial, 'residencial');
  if (erroResidencial) return res.status(400).json({ erro: erroResidencial });
  const residencial = endereco_residencial;

  // Sem endereco_entrega (ou com entrega_igual_residencial explicitamente true),
  // a entrega copia o residencial — o cliente não precisa digitar duas vezes.
  const igualResidencial = entrega_igual_residencial !== false;
  let entrega = residencial;
  if (!igualResidencial) {
    const erroEntrega = erroDoEndereco(endereco_entrega, 'de entrega');
    if (erroEntrega) return res.status(400).json({ erro: erroEntrega });
    entrega = endereco_entrega;
  }

  const carrinho = await obterCarrinhoAtual(req);
  const { itens, total } = await montarRespostaCarrinho(carrinho);
  if (itens.length === 0) return res.status(400).json({ erro: 'Seu carrinho está vazio.' });

  const itensFaltantes = await itensComFaltaDeEstoque(itens);

  // O desconto e' sempre recalculado aqui, a partir dos itens de verdade: o
  // valor que veio da tela nao e' confiavel.
  const resultadoCupom = cupom ? await avaliarCupom(cupom, itens) : null;
  const valorDesconto = resultadoCupom && resultadoCupom.valido ? resultadoCupom.desconto : 0;
  const cupomAplicado = resultadoCupom && resultadoCupom.valido ? resultadoCupom.codigo : null;
  const valorFinal = Math.round((total - valorDesconto) * 100) / 100;

  const usuarioId = req.session.usuario ? req.session.usuario.id : null;
  const cpfLimpo = somenteDigitos(cpf_cliente);
  const cliente = await registrarCliente(db, { nome: nome_cliente, email: email_cliente, telefone: telefone_cliente, cpf: cpfLimpo });
  const codigo = await gerarCodigoPedido(db, new Date().getFullYear());

  // Grava o pedido, os itens e reserva o estoque (debita na hora, nao so'
  // quando pago) numa unica transacao: ou o pedido inteiro entra com o
  // estoque debitado, ou nada entra — nunca um pedido "pela metade".
  const gravarPedido = db.transaction(async (tx) => {
    const info = await tx.prepare(`INSERT INTO pedidos
      (codigo, usuario_id, cliente_id, nome_cliente, email_cliente, telefone_cliente, cpf_cliente,
       endereco_resid_cep, endereco_resid_logradouro, endereco_resid_numero, endereco_resid_complemento,
       endereco_resid_bairro, endereco_resid_cidade, endereco_resid_uf, entrega_igual_residencial,
       endereco_entrega_cep, endereco_entrega_logradouro, endereco_entrega_numero, endereco_entrega_complemento,
       endereco_entrega_bairro, endereco_entrega_cidade, endereco_entrega_uf, endereco_entrega,
       total, valor_desconto, cupom, valor_final, status, forma_pagamento, estoque_reservado)
      VALUES (@codigo, @usuario_id, @cliente_id, @nome_cliente, @email_cliente, @telefone_cliente, @cpf_cliente,
       @resid_cep, @resid_logradouro, @resid_numero, @resid_complemento, @resid_bairro, @resid_cidade, @resid_uf,
       @entrega_igual_residencial,
       @entrega_cep, @entrega_logradouro, @entrega_numero, @entrega_complemento, @entrega_bairro, @entrega_cidade, @entrega_uf,
       @endereco_entrega_texto, @total, @valor_desconto, @cupom, @valor_final, 'aguardando_pagamento', @forma_pagamento, 1)`)
      .run({
        codigo, usuario_id: usuarioId, cliente_id: cliente ? cliente.id : null,
        nome_cliente, email_cliente: email_cliente.trim().toLowerCase(), telefone_cliente, cpf_cliente: cpfLimpo,
        resid_cep: residencial.cep, resid_logradouro: residencial.logradouro, resid_numero: residencial.numero,
        resid_complemento: residencial.complemento || null, resid_bairro: residencial.bairro,
        resid_cidade: residencial.cidade, resid_uf: String(residencial.uf).toUpperCase(),
        entrega_igual_residencial: igualResidencial ? 1 : 0,
        entrega_cep: entrega.cep, entrega_logradouro: entrega.logradouro, entrega_numero: entrega.numero,
        entrega_complemento: entrega.complemento || null, entrega_bairro: entrega.bairro,
        entrega_cidade: entrega.cidade, entrega_uf: String(entrega.uf).toUpperCase(),
        endereco_entrega_texto: formatarEnderecoTexto(entrega),
        total, valor_desconto: valorDesconto, cupom: cupomAplicado, valor_final: valorFinal, forma_pagamento: forma_pagamento || null
      });
    const novoPedidoId = info.lastInsertRowid;

    const insItem = tx.prepare(`INSERT INTO pedido_itens (pedido_id, produto_id, nome_produto, tamanho, cor, quantidade, preco_unitario, custo_unitario)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const item of itens) {
      const produto = await tx.prepare('SELECT custo FROM produtos WHERE id = ?').get(item.produto_id);
      await insItem.run(novoPedidoId, item.produto_id, item.produto_nome, item.tamanho, item.cor, item.quantidade, item.preco_unitario, produto ? produto.custo : 0);
      if (item.tipo_estoque !== 'sob_encomenda') {
        await tx.prepare(`UPDATE produto_estoque SET quantidade = MAX(0, quantidade - ?)
          WHERE produto_id = ? AND IFNULL(tamanho,'') = IFNULL(?,'') AND IFNULL(cor,'') = IFNULL(?,'')`)
          .run(item.quantidade, item.produto_id, item.tamanho, item.cor);
      }
    }
    return novoPedidoId;
  });
  const pedidoId = await gravarPedido();

  // Item que faltou estoque vira encomenda automatica, ligada a este pedido
  // (o cliente ja' sabe do prazo combinado — ver aviso montado abaixo).
  for (const item of itensFaltantes) {
    await db.prepare(`INSERT INTO encomendas
      (produto_id, usuario_id, pedido_id, nome, email, telefone, tamanho, cor, quantidade, tipo, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'encomenda', 'aguardando')`)
      .run(item.produto_id, usuarioId, pedidoId, nome_cliente, email_cliente.trim().toLowerCase(), telefone_cliente,
        item.tamanho, item.cor, item.faltam);
  }
  const avisoEstoque = mensagemEncomendas(itensFaltantes);

  if (cupomAplicado) await registrarUsoCupom(cupomAplicado);

  await db.prepare(`UPDATE carrinhos SET status = 'convertido' WHERE id = ?`).run(carrinho.id);
  await db.prepare(`INSERT INTO eventos_analytics (tipo, usuario_id, sessao_id) VALUES ('checkout_iniciado', ?, ?)`)
    .run(usuarioId, req.session.sid);

  const pedido = await db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedidoId);

  // Aviso ao superadmin de que chegou um pedido novo — nao bloqueia o
  // checkout se o envio falhar (SMTP fora do ar, por exemplo).
  email.enviarAvisoNovoPedido(pedido, itens).catch(e => console.error('[email] aviso de novo pedido:', e.message));

  if (forma_pagamento !== 'combinar' && pagamento.configurado()) {
    try {
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const preferencia = await pagamento.criarPreferencia(pedido, itens, baseUrl);
      await db.prepare('UPDATE pedidos SET mp_preference_id = ?, expira_em = ? WHERE id = ?')
        .run(preferencia.id, preferencia.expiraEm, pedidoId);
      return res.status(201).json({ pedido_id: pedidoId, codigo, checkout_url: preferencia.init_point, aviso: avisoEstoque || undefined });
    } catch (e) {
      const detalhe = pagamento.detalheErroMp(e);
      console.error('[mercadopago] erro ao criar preferência:', detalhe);
      await db.prepare('UPDATE pedidos SET erro_pagamento = ? WHERE id = ?').run(detalhe, pedidoId);
      const aviso = [avisoEstoque, 'Não foi possível iniciar o pagamento online agora. Entraremos em contato pelo WhatsApp para combinar o pagamento.'].filter(Boolean).join(' ');
      return res.status(201).json({ pedido_id: pedidoId, codigo, checkout_url: null, aviso });
    }
  }

  const aviso = [avisoEstoque, 'Pagamento online ainda não configurado nesta loja. Combinaremos o pagamento por WhatsApp/telefone.'].filter(Boolean).join(' ');
  res.status(201).json({ pedido_id: pedidoId, codigo, checkout_url: null, aviso });
});

router.get('/meus-pedidos', async (req, res) => {
  if (!req.session.usuario) return res.status(401).json({ erro: 'Login necessário.' });
  const pedidos = await db.prepare('SELECT * FROM pedidos WHERE usuario_id = ? ORDER BY id DESC').all(req.session.usuario.id);
  const comItens = await Promise.all(pedidos.map(async p => ({
    ...p,
    itens: await db.prepare('SELECT * FROM pedido_itens WHERE pedido_id = ?').all(p.id)
  })));
  res.json(comItens);
});

router.get('/:id', async (req, res) => {
  const pedido = await db.prepare('SELECT * FROM pedidos WHERE id = ?').get(req.params.id);
  if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado.' });
  const itens = await db.prepare('SELECT * FROM pedido_itens WHERE pedido_id = ?').all(pedido.id);
  res.json({ ...pedido, itens });
});

module.exports = router;
module.exports.erroDoEndereco = erroDoEndereco;
module.exports.formatarEnderecoTexto = formatarEnderecoTexto;
module.exports.UFS_VALIDAS = UFS_VALIDAS;
