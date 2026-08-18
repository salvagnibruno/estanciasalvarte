const express = require('express');
const router = express.Router();
const db = require('../db/db');

router.get('/', async (req, res) => {
  if (!req.session.usuario) return res.json([]);
  const rows = await db.prepare(`
    SELECT i.id, p.* FROM interesses i JOIN produtos p ON p.id = i.produto_id
    WHERE i.usuario_id = ? ORDER BY i.criado_em DESC
  `).all(req.session.usuario.id);
  res.json(rows);
});

router.post('/', async (req, res) => {
  if (!req.session.usuario) return res.status(401).json({ erro: 'Login necessário para salvar interesses.' });
  const { produto_id } = req.body || {};
  try {
    await db.prepare('INSERT INTO interesses (usuario_id, produto_id) VALUES (?, ?)').run(req.session.usuario.id, produto_id);
  } catch (e) { /* ja existe */ }
  res.status(201).json({ ok: true });
});

router.delete('/:produtoId', async (req, res) => {
  if (!req.session.usuario) return res.status(401).json({ erro: 'Login necessário.' });
  await db.prepare('DELETE FROM interesses WHERE usuario_id = ? AND produto_id = ?').run(req.session.usuario.id, req.params.produtoId);
  res.json({ ok: true });
});

module.exports = router;
