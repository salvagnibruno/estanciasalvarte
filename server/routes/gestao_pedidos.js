// Gestão de pedidos pelo admin: itens, cupom, dados do cliente,
// cancelamento/troca, reconciliação manual de pagamento e nota fiscal.
// Tudo atrás da permissão 'gerenciar_pedidos' (superadmin sempre passa —
// ver middleware/auth.js:exigirPermissao).
const express = require('express');
const path = require('path');
const router = express.Router();
const db = require('../db/db');
const { exigirPermissao } = require('../middleware/auth');
const { avaliarCupom, registrarUsoCupom } = require('./cupons');
const pagamento = require('./pagamento');
const { definirStatusPedido, aplicarStatusPagamento } = require('../utils/pagamentoStatus');
const email = require('../utils/email');
const { receberNotaFiscal, PASTA_NOTAS } = require('../middleware/upload');
const { erroDoEndereco, formatarEnderecoTexto } = require('./pedidos');
const { validarCPF, somenteDigitos } = require('../utils/cpf');

router.use(exigirPermissao('gerenciar_pedidos'));

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STATUS_VALIDOS = ['aguardando_pagamento', 'pago', 'enviado', 'recebido', 'finalizado', 'cancelado', 'desistencia'];

async function registrarEdicao(pedidoId, req, tipo, detalhe) {
  await db.prepare(`INSERT INTO pedido_edicoes (pedido_id, usuario_email, tipo, detalhe) VALUES (?, ?, ?, ?)`)
    .run(pedidoId, req.session.usuario ? req.session.usuario.email : null, tipo, detalhe || null);
}

// Recalcula total/valor_desconto/valor_final a partir dos itens de verdade e
// do cupom gravado no pedido — nunca confia em valor solto vindo da tela.
// Reaproveita avaliarCupom (o mesmo validador do checkout, ver routes/cupons.js).
async function recalcularPedido(pedidoId) {
  const pedido = await db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedidoId);
  const itens = await db.prepare('SELECT * FROM pedido_itens WHERE pedido_id = ?').all(pedidoId);
  const total = Math.round(itens.reduce((s, i) => s + i.preco_unitario * i.quantidade, 0) * 100) / 100;

  let valorDesconto = 0;
  let cupomFinal = pedido.cupom;
  if (pedido.cupom) {
    const resultado = await avaliarCupom(pedido.cupom, itens.map(i => ({
      produto_id: i.produto_id, quantidade: i.quantidade, preco_unitario: i.preco_unitario
    })));
    // Cupom deixou de se aplicar (ex.: produto removido do pedido) — some do
    // pedido em vez de deixar valor_desconto desatualizado.
    if (resultado.valido) valorDesconto = resultado.desconto;
    else cupomFinal = null;
  }
  const valorFinal = Math.round((total - valorDesconto) * 100) / 100;

  await db.prepare(`UPDATE pedidos SET total = ?, valor_desconto = ?, cupom = ?, valor_final = ?, atualizado_em = datetime('now') WHERE id = ?`)
    .run(total, valorDesconto, cupomFinal, valorFinal, pedidoId);
  return { total, valor_desconto: valorDesconto, cupom: cupomFinal, valor_final: valorFinal };
}

// Troca de estoque numa edição de item: devolve a linha antiga (se o produto
// dela ainda existir e for do tipo 'estoque') e debita a linha nova (mesma
// regra). Chamada só quando o pedido ainda tem estoque reservado e não
// devolvido — pedido já encerrado (cancelado/desistência) é bloqueado antes
// de chegar aqui, então nunca mexe em estoque que já voltou pra loja.
async function ajustarEstoqueTroca(itemAntigo, itemNovo) {
  for (const [item, sinal] of [[itemAntigo, 1], [itemNovo, -1]]) {
    if (!item || !item.produto_id) continue;
    const produto = await db.prepare('SELECT tipo_estoque FROM produtos WHERE id = ?').get(item.produto_id);
    if (!produto || produto.tipo_estoque === 'sob_encomenda') continue;
    if (sinal > 0) {
      await db.prepare(`UPDATE produto_estoque SET quantidade = quantidade + ?
        WHERE produto_id = ? AND IFNULL(tamanho,'') = IFNULL(?,'') AND IFNULL(cor,'') = IFNULL(?,'')`)
        .run(item.quantidade, item.produto_id, item.tamanho, item.cor);
    } else {
      await db.prepare(`UPDATE produto_estoque SET quantidade = MAX(0, quantidade - ?)
        WHERE produto_id = ? AND IFNULL(tamanho,'') = IFNULL(?,'') AND IFNULL(cor,'') = IFNULL(?,'')`)
        .run(item.quantidade, item.produto_id, item.tamanho, item.cor);
    }
  }
}

// ---------- Listagem ----------
router.get('/', async (req, res) => {
  const pedidos = await db.prepare('SELECT * FROM pedidos ORDER BY id DESC').all();
  res.json(await Promise.all(pedidos.map(async p => ({
    ...p,
    itens: await db.prepare('SELECT * FROM pedido_itens WHERE pedido_id = ?').all(p.id)
  }))));
});

router.get('/:id', async (req, res) => {
  const pedido = await db.prepare('SELECT * FROM pedidos WHERE id = ?').get(req.params.id);
  if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado.' });
  const itens = await db.prepare('SELECT * FROM pedido_itens WHERE pedido_id = ?').all(pedido.id);
  res.json({ ...pedido, itens });
});

// ---------- Status (com "Desistência" e devolução de estoque embutidas —
// ver server/utils/pagamentoStatus.js:definirStatusPedido) ----------
router.put('/:id/status', async (req, res) => {
  const { status } = req.body || {};
  if (!STATUS_VALIDOS.includes(status)) return res.status(400).json({ erro: 'Status inválido.' });
  const novoStatus = await definirStatusPedido(req.params.id, status);
  if (!novoStatus) return res.status(404).json({ erro: 'Pedido não encontrado.' });
  await registrarEdicao(req.params.id, req, 'status', `→ ${status}`);
  res.json({ ok: true });
});

// ---------- Dados do cliente / endereço / motivo de cancelamento ----------
router.put('/:id', async (req, res) => {
  const pedido = await db.prepare('SELECT * FROM pedidos WHERE id = ?').get(req.params.id);
  if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado.' });

  const {
    nome_cliente, email_cliente, telefone_cliente, cpf_cliente,
    endereco_residencial, entrega_igual_residencial, endereco_entrega,
    motivo_cancelamento
  } = req.body || {};

  if (email_cliente !== undefined && email_cliente && !EMAIL_REGEX.test(String(email_cliente).trim())) {
    return res.status(400).json({ erro: 'Informe um e-mail válido.' });
  }
  if (cpf_cliente !== undefined && cpf_cliente && !validarCPF(cpf_cliente)) {
    return res.status(400).json({ erro: 'Informe um CPF válido.' });
  }

  // Residencial: se veio no corpo, precisa vir completo (mesma regra do
  // checkout) — endereço pela metade não serve pra nota fiscal nem entrega.
  let residencial = null;
  if (endereco_residencial !== undefined) {
    const erro = erroDoEndereco(endereco_residencial, 'residencial');
    if (erro) return res.status(400).json({ erro });
    residencial = endereco_residencial;
  }

  const igualResidencial = entrega_igual_residencial !== undefined ? !!entrega_igual_residencial : !!pedido.entrega_igual_residencial;
  let entrega = null;
  let enderecoEntregaTexto = pedido.endereco_entrega;
  if (igualResidencial) {
    entrega = residencial || {
      cep: pedido.endereco_resid_cep, logradouro: pedido.endereco_resid_logradouro, numero: pedido.endereco_resid_numero,
      complemento: pedido.endereco_resid_complemento, bairro: pedido.endereco_resid_bairro,
      cidade: pedido.endereco_resid_cidade, uf: pedido.endereco_resid_uf
    };
    enderecoEntregaTexto = formatarEnderecoTexto(entrega);
  } else if (endereco_entrega !== undefined) {
    const erro = erroDoEndereco(endereco_entrega, 'de entrega');
    if (erro) return res.status(400).json({ erro });
    entrega = endereco_entrega;
    enderecoEntregaTexto = formatarEnderecoTexto(entrega);
  }

  const campos = {
    id: pedido.id,
    nome_cliente: nome_cliente !== undefined ? nome_cliente : pedido.nome_cliente,
    email_cliente: email_cliente !== undefined ? (email_cliente ? String(email_cliente).trim().toLowerCase() : null) : pedido.email_cliente,
    telefone_cliente: telefone_cliente !== undefined ? telefone_cliente : pedido.telefone_cliente,
    cpf_cliente: cpf_cliente !== undefined ? somenteDigitos(cpf_cliente) : pedido.cpf_cliente,
    resid_cep: residencial ? residencial.cep : pedido.endereco_resid_cep,
    resid_logradouro: residencial ? residencial.logradouro : pedido.endereco_resid_logradouro,
    resid_numero: residencial ? residencial.numero : pedido.endereco_resid_numero,
    resid_complemento: residencial ? (residencial.complemento || null) : pedido.endereco_resid_complemento,
    resid_bairro: residencial ? residencial.bairro : pedido.endereco_resid_bairro,
    resid_cidade: residencial ? residencial.cidade : pedido.endereco_resid_cidade,
    resid_uf: residencial ? String(residencial.uf).toUpperCase() : pedido.endereco_resid_uf,
    entrega_igual_residencial: igualResidencial ? 1 : 0,
    entrega_cep: entrega ? entrega.cep : pedido.endereco_entrega_cep,
    entrega_logradouro: entrega ? entrega.logradouro : pedido.endereco_entrega_logradouro,
    entrega_numero: entrega ? entrega.numero : pedido.endereco_entrega_numero,
    entrega_complemento: entrega ? (entrega.complemento || null) : pedido.endereco_entrega_complemento,
    entrega_bairro: entrega ? entrega.bairro : pedido.endereco_entrega_bairro,
    entrega_cidade: entrega ? entrega.cidade : pedido.endereco_entrega_cidade,
    entrega_uf: entrega ? String(entrega.uf).toUpperCase() : pedido.endereco_entrega_uf,
    endereco_entrega_texto: enderecoEntregaTexto,
    motivo_cancelamento: motivo_cancelamento !== undefined ? motivo_cancelamento : pedido.motivo_cancelamento
  };

  await db.prepare(`UPDATE pedidos SET
    nome_cliente = @nome_cliente, email_cliente = @email_cliente, telefone_cliente = @telefone_cliente, cpf_cliente = @cpf_cliente,
    endereco_resid_cep = @resid_cep, endereco_resid_logradouro = @resid_logradouro, endereco_resid_numero = @resid_numero,
    endereco_resid_complemento = @resid_complemento, endereco_resid_bairro = @resid_bairro,
    endereco_resid_cidade = @resid_cidade, endereco_resid_uf = @resid_uf,
    entrega_igual_residencial = @entrega_igual_residencial,
    endereco_entrega_cep = @entrega_cep, endereco_entrega_logradouro = @entrega_logradouro, endereco_entrega_numero = @entrega_numero,
    endereco_entrega_complemento = @entrega_complemento, endereco_entrega_bairro = @entrega_bairro,
    endereco_entrega_cidade = @entrega_cidade, endereco_entrega_uf = @entrega_uf,
    endereco_entrega = @endereco_entrega_texto,
    motivo_cancelamento = @motivo_cancelamento, atualizado_em = datetime('now')
    WHERE id = @id`).run(campos);

  await registrarEdicao(pedido.id, req, 'dados_cliente', 'Dados do cliente/endereço atualizados pelo admin');
  res.json({ ok: true });
});

// ---------- Itens ----------
router.post('/:id/itens', async (req, res) => {
  const pedido = await db.prepare('SELECT * FROM pedidos WHERE id = ?').get(req.params.id);
  if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado.' });
  if (pedido.estoque_devolvido) return res.status(409).json({ erro: 'Este pedido já foi encerrado — crie um novo pedido em vez de editar este.' });

  const { produto_id, tamanho, cor, quantidade, preco_unitario } = req.body || {};
  const produto = await db.prepare('SELECT * FROM produtos WHERE id = ?').get(produto_id);
  if (!produto) return res.status(400).json({ erro: 'Produto não encontrado.' });

  const qtd = Math.max(1, parseInt(quantidade, 10) || 1);
  const preco = preco_unitario !== undefined && preco_unitario !== null && preco_unitario !== ''
    ? Number(preco_unitario) : produto.preco_venda;

  const info = await db.prepare(`INSERT INTO pedido_itens (pedido_id, produto_id, nome_produto, tamanho, cor, quantidade, preco_unitario, custo_unitario)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(pedido.id, produto.id, produto.nome, tamanho || null, cor || null, qtd, preco, produto.custo);

  await ajustarEstoqueTroca(null, { produto_id: produto.id, tamanho: tamanho || null, cor: cor || null, quantidade: qtd });
  const totais = await recalcularPedido(pedido.id);
  await registrarEdicao(pedido.id, req, 'item_add', `+ ${qtd}x ${produto.nome}${tamanho ? ' ' + tamanho : ''}${cor ? ' ' + cor : ''}`);
  res.status(201).json({ ok: true, item_id: info.lastInsertRowid, ...totais });
});

router.put('/:id/itens/:itemId', async (req, res) => {
  const pedido = await db.prepare('SELECT * FROM pedidos WHERE id = ?').get(req.params.id);
  if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado.' });
  if (pedido.estoque_devolvido) return res.status(409).json({ erro: 'Este pedido já foi encerrado — crie um novo pedido em vez de editar este.' });
  const itemAtual = await db.prepare('SELECT * FROM pedido_itens WHERE id = ? AND pedido_id = ?').get(req.params.itemId, pedido.id);
  if (!itemAtual) return res.status(404).json({ erro: 'Item não encontrado neste pedido.' });

  const { produto_id, tamanho, cor, quantidade, preco_unitario } = req.body || {};
  const trocouProduto = produto_id !== undefined && Number(produto_id) !== itemAtual.produto_id;
  const produto = await db.prepare('SELECT * FROM produtos WHERE id = ?').get(trocouProduto ? produto_id : itemAtual.produto_id);
  if (!produto) return res.status(400).json({ erro: 'Produto não encontrado.' });

  const qtd = quantidade !== undefined ? Math.max(1, parseInt(quantidade, 10) || 1) : itemAtual.quantidade;
  const novoTamanho = tamanho !== undefined ? (tamanho || null) : itemAtual.tamanho;
  const novaCor = cor !== undefined ? (cor || null) : itemAtual.cor;
  const preco = preco_unitario !== undefined && preco_unitario !== null && preco_unitario !== ''
    ? Number(preco_unitario) : (trocouProduto ? produto.preco_venda : itemAtual.preco_unitario);

  await db.prepare(`UPDATE pedido_itens SET produto_id = ?, nome_produto = ?, tamanho = ?, cor = ?, quantidade = ?, preco_unitario = ?, custo_unitario = ? WHERE id = ?`)
    .run(produto.id, produto.nome, novoTamanho, novaCor, qtd, preco, produto.custo, itemAtual.id);

  await ajustarEstoqueTroca(
    { produto_id: itemAtual.produto_id, tamanho: itemAtual.tamanho, cor: itemAtual.cor, quantidade: itemAtual.quantidade },
    { produto_id: produto.id, tamanho: novoTamanho, cor: novaCor, quantidade: qtd }
  );
  const totais = await recalcularPedido(pedido.id);
  await registrarEdicao(pedido.id, req, 'item_edit',
    `${itemAtual.nome_produto}${itemAtual.tamanho ? ' ' + itemAtual.tamanho : ''} → ${qtd}x ${produto.nome}${novoTamanho ? ' ' + novoTamanho : ''}${novaCor ? ' ' + novaCor : ''}`);
  res.json({ ok: true, ...totais });
});

router.delete('/:id/itens/:itemId', async (req, res) => {
  const pedido = await db.prepare('SELECT * FROM pedidos WHERE id = ?').get(req.params.id);
  if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado.' });
  if (pedido.estoque_devolvido) return res.status(409).json({ erro: 'Este pedido já foi encerrado — crie um novo pedido em vez de editar este.' });
  const item = await db.prepare('SELECT * FROM pedido_itens WHERE id = ? AND pedido_id = ?').get(req.params.itemId, pedido.id);
  if (!item) return res.status(404).json({ erro: 'Item não encontrado neste pedido.' });

  await db.prepare('DELETE FROM pedido_itens WHERE id = ?').run(item.id);
  await ajustarEstoqueTroca({ produto_id: item.produto_id, tamanho: item.tamanho, cor: item.cor, quantidade: item.quantidade }, null);
  const totais = await recalcularPedido(pedido.id);
  await registrarEdicao(pedido.id, req, 'item_remove', `- ${item.quantidade}x ${item.nome_produto}`);
  res.json({ ok: true, ...totais });
});

// ---------- Cupom ----------
router.put('/:id/cupom', async (req, res) => {
  const pedido = await db.prepare('SELECT * FROM pedidos WHERE id = ?').get(req.params.id);
  if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado.' });
  const { codigo } = req.body || {};
  const itens = await db.prepare('SELECT * FROM pedido_itens WHERE pedido_id = ?').all(pedido.id);

  if (codigo) {
    const resultado = await avaliarCupom(codigo, itens.map(i => ({ produto_id: i.produto_id, quantidade: i.quantidade, preco_unitario: i.preco_unitario })));
    if (!resultado.valido) return res.status(400).json({ erro: resultado.motivo });
    // Conta uso novo so' quando o codigo realmente muda — reaplicar o mesmo
    // cupom (ex.: depois de editar um item) nao deve inflar usos_atuais.
    if (pedido.cupom !== resultado.codigo) await registrarUsoCupom(resultado.codigo);
    await db.prepare('UPDATE pedidos SET cupom = ? WHERE id = ?').run(resultado.codigo, pedido.id);
    await registrarEdicao(pedido.id, req, 'cupom', `${pedido.cupom || '-'} → ${resultado.codigo}`);
  } else {
    await db.prepare('UPDATE pedidos SET cupom = NULL WHERE id = ?').run(pedido.id);
    await registrarEdicao(pedido.id, req, 'cupom', `${pedido.cupom || '-'} → removido`);
  }
  const totais = await recalcularPedido(pedido.id);
  res.json({ ok: true, ...totais });
});

// ---------- Reconciliação manual de pagamento ----------
router.post('/:id/reconciliar', async (req, res) => {
  const pedido = await db.prepare('SELECT * FROM pedidos WHERE id = ?').get(req.params.id);
  if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado.' });
  if (!pedido.mp_payment_id) {
    return res.status(400).json({ erro: 'Este pedido ainda não tem um pagamento do Mercado Pago associado. Aguarde o cliente iniciar o pagamento ou combine diretamente com ele.' });
  }
  if (!pagamento.configurado()) return res.status(400).json({ erro: 'Mercado Pago não está configurado nesta loja.' });

  const info = await pagamento.consultarPagamento(pedido.mp_payment_id);
  if (!info) return res.status(502).json({ erro: 'Não foi possível consultar o Mercado Pago agora. Tente novamente.' });

  const novoStatus = await aplicarStatusPagamento(pedido.id, info.status, pedido.mp_payment_id);
  await registrarEdicao(pedido.id, req, 'reconciliacao', `Mercado Pago: ${info.status} → ${novoStatus}`);
  res.json({ ok: true, status: novoStatus });
});

// ---------- Nota fiscal ----------
// Upload do PDF já emitido manualmente no Sebrae — só grava o arquivo e o
// status; não envia e-mail (isso é uma ação separada, ver /enviar abaixo).
router.post('/:id/nota-fiscal', receberNotaFiscal, async (req, res) => {
  const pedido = await db.prepare('SELECT id FROM pedidos WHERE id = ?').get(req.params.id);
  if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado.' });
  if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo foi enviado.' });

  const { numero, chave } = req.body || {};
  await db.prepare(`UPDATE pedidos SET nfce_pdf_url = ?, nfce_numero = ?, nfce_chave = ?, nfce_status = 'emitida', nfce_emitida_em = datetime('now') WHERE id = ?`)
    .run(req.file.filename, numero || null, chave || null, pedido.id);
  await registrarEdicao(pedido.id, req, 'nota_fiscal', `Nota fiscal anexada${numero ? ' (nº ' + numero + ')' : ''}`);
  res.status(201).json({ ok: true });
});

// Baixa o PDF já anexado — rota autenticada (a nota tem CPF/endereço do
// cliente; o arquivo em si fica fora de public/, ver middleware/upload.js).
router.get('/:id/nota-fiscal', async (req, res) => {
  const pedido = await db.prepare('SELECT nfce_pdf_url FROM pedidos WHERE id = ?').get(req.params.id);
  if (!pedido || !pedido.nfce_pdf_url) return res.status(404).json({ erro: 'Nenhuma nota fiscal anexada a este pedido.' });
  res.sendFile(path.join(PASTA_NOTAS, pedido.nfce_pdf_url), (erro) => {
    if (erro && !res.headersSent) res.status(404).json({ erro: 'Arquivo da nota fiscal não encontrado.' });
  });
});

// Dispara o e-mail com o PDF anexado — ação manual e separada do upload
// acima (o lojista decide a hora de enviar).
router.post('/:id/nota-fiscal/enviar', async (req, res) => {
  const pedido = await db.prepare('SELECT * FROM pedidos WHERE id = ?').get(req.params.id);
  if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado.' });
  if (!pedido.nfce_pdf_url) return res.status(400).json({ erro: 'Anexe o PDF da nota fiscal antes de enviar.' });

  const caminho = path.join(PASTA_NOTAS, pedido.nfce_pdf_url);
  const resultado = await email.enviarNotaFiscal(pedido, caminho);
  if (!resultado.enviado) {
    const mensagem = resultado.motivo === 'sem_email_cliente' ? 'Este pedido não tem e-mail de cliente cadastrado.'
      : resultado.motivo === 'smtp_nao_configurado' ? 'O envio de e-mail (SMTP) não está configurado nesta loja.'
      : 'Não foi possível enviar o e-mail agora.';
    return res.status(400).json({ erro: mensagem });
  }
  await registrarEdicao(pedido.id, req, 'nota_fiscal', 'Nota fiscal enviada por e-mail ao cliente');
  res.json({ ok: true });
});

module.exports = router;
