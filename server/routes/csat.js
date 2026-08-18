const express = require('express');
const router = express.Router();
const db = require('../db/db');

function nota(valor) {
  const n = parseInt(valor, 10);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

function booleano(valor) {
  if (valor === true || valor === 1 || valor === '1' || valor === 'sim') return 1;
  if (valor === false || valor === 0 || valor === '0' || valor === 'nao') return 0;
  return null;
}

// GET /api/csat/pedido/:pedidoId — a pagina de confirmacao usa para nao
// pedir a avaliacao duas vezes do mesmo pedido.
router.get('/pedido/:pedidoId', async (req, res) => {
  const resposta = await db.prepare('SELECT id, criado_em FROM csat WHERE pedido_id = ?').get(req.params.pedidoId);
  res.json({ respondido: !!resposta, criado_em: resposta ? resposta.criado_em : null });
});

// POST /api/csat — grava a avaliacao vinculada ao pedido e ao cliente.
router.post('/', async (req, res) => {
  const { pedido_id, nota_precos, nota_site, nota_geral, primeira_compra, recomendaria, comentario } = req.body || {};

  const pedido = await db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedido_id);
  if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado.' });

  const jaRespondeu = await db.prepare('SELECT id FROM csat WHERE pedido_id = ?').get(pedido.id);
  if (jaRespondeu) return res.status(409).json({ erro: 'Esta compra já foi avaliada. Obrigado!' });

  const notas = {
    precos: nota(nota_precos),
    site: nota(nota_site),
    geral: nota(nota_geral)
  };
  if (!notas.precos || !notas.site || !notas.geral) {
    return res.status(400).json({ erro: 'Responda as três notas (preços, site e experiência geral).' });
  }

  const info = await db.prepare(`INSERT INTO csat
    (pedido_id, pedido_codigo, cliente_id, nome_cliente, email_cliente, telefone_cliente,
     nota_precos, nota_site, nota_geral, primeira_compra, recomendaria, comentario)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      pedido.id, pedido.codigo, pedido.cliente_id, pedido.nome_cliente,
      pedido.email_cliente, pedido.telefone_cliente,
      notas.precos, notas.site, notas.geral,
      booleano(primeira_compra), booleano(recomendaria),
      (comentario || '').trim() || null
    );

  res.status(201).json({ id: info.lastInsertRowid, ok: true });
});

module.exports = router;
