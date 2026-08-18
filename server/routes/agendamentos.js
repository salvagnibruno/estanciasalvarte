const express = require('express');
const router = express.Router();
const db = require('../db/db');
const { exigirPapel } = require('../middleware/auth');

// Cliente solicita um servico (ajustes, confeccao sob medida, etc.)
router.post('/', (req, res) => {
  const { servico_nome, data_servico, horario, local, responsavel, telefone_contato, observacoes } = req.body || {};
  if (!servico_nome || !data_servico || !horario || !local || !responsavel || !telefone_contato) {
    return res.status(400).json({ erro: 'Preencha serviço, data, horário, local, responsável e telefone.' });
  }
  const usuarioId = req.session.usuario ? req.session.usuario.id : null;
  const info = db.prepare(`INSERT INTO agendamentos
    (usuario_id, servico_nome, data_servico, horario, local, responsavel, telefone_contato, observacoes, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pendente')`)
    .run(usuarioId, servico_nome, data_servico, horario, local, responsavel, telefone_contato, observacoes || null);
  res.status(201).json({ id: info.lastInsertRowid, mensagem: 'Solicitação enviada! Você será avisado assim que for analisada.' });
});

router.get('/minhas', (req, res) => {
  if (!req.session.usuario) return res.status(401).json({ erro: 'Login necessário.' });
  const agendamentos = db.prepare('SELECT * FROM agendamentos WHERE usuario_id = ? ORDER BY data_servico DESC').all(req.session.usuario.id);
  res.json(agendamentos);
});

// Gestao (admin/superadmin)
router.get('/', exigirPapel('admin', 'superadmin'), (req, res) => {
  const { status } = req.query;
  let sql = 'SELECT * FROM agendamentos';
  const params = [];
  if (status) { sql += ' WHERE status = ?'; params.push(status); }
  sql += ' ORDER BY data_servico ASC, horario ASC';
  res.json(db.prepare(sql).all(...params));
});

router.put('/:id/deferir', exigirPapel('admin', 'superadmin'), (req, res) => {
  const agendamento = db.prepare('SELECT * FROM agendamentos WHERE id = ?').get(req.params.id);
  if (!agendamento) return res.status(404).json({ erro: 'Agendamento não encontrado.' });
  db.prepare(`UPDATE agendamentos SET status = 'aprovado', motivo_recusa = NULL, atualizado_em = datetime('now') WHERE id = ?`).run(agendamento.id);
  res.json({ ok: true });
});

router.put('/:id/indeferir', exigirPapel('admin', 'superadmin'), (req, res) => {
  const { motivo } = req.body || {};
  const agendamento = db.prepare('SELECT * FROM agendamentos WHERE id = ?').get(req.params.id);
  if (!agendamento) return res.status(404).json({ erro: 'Agendamento não encontrado.' });
  db.prepare(`UPDATE agendamentos SET status = 'recusado', motivo_recusa = ?, atualizado_em = datetime('now') WHERE id = ?`).run(motivo || null, agendamento.id);
  res.json({ ok: true });
});

router.put('/:id/concluir', exigirPapel('admin', 'superadmin'), (req, res) => {
  db.prepare(`UPDATE agendamentos SET status = 'concluido', atualizado_em = datetime('now') WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
