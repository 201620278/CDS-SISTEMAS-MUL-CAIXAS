const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const db = require('../database');
const { gravarAuditoria } = require('../services/auditoria');

const JWT_SECRET = process.env.JWT_SECRET || 'mercantil_do_nando_secret_key_2024';
const HEARTBEAT_ONLINE_MS = 3 * 60 * 1000;

function terminalEstaOnline(ultimaConexao) {
  if (!ultimaConexao) return false;
  const diff = Date.now() - new Date(ultimaConexao).getTime();
  return diff >= 0 && diff < HEARTBEAT_ONLINE_MS;
}

function anexarStatusOnline(rows) {
  return (rows || []).map((row) => ({
    ...row,
    online: terminalEstaOnline(row.ultima_conexao)
  }));
}

function extrairUsuarioHeartbeat(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (authHeader) {
    try {
      const token = String(authHeader).split(' ')[1];
      if (token) {
        const decoded = jwt.verify(token, JWT_SECRET);
        return {
          usuario_id: decoded.id || null,
          usuario_nome: String(decoded.nome || decoded.username || '').trim() || null
        };
      }
    } catch (e) { /* ignore token inválido no heartbeat */ }
  }

  const usuarioId = req.query.usuario_id ? Number(req.query.usuario_id) : null;
  const usuarioNome = req.query.usuario_nome ? String(req.query.usuario_nome).trim() : null;
  return {
    usuario_id: Number.isInteger(usuarioId) && usuarioId > 0 ? usuarioId : null,
    usuario_nome: usuarioNome || null
  };
}

function registrarTerminalAuto(req, res) {
  const origem = String(req.query.origem || '').trim().toLowerCase();
  if (origem !== 'pdv') {
    return res.status(400).json({ error: 'Heartbeat de terminal permitido apenas pelo módulo PDV (origem=pdv).' });
  }

  const hostname = String(req.query.hostname || '').trim();
  if (!hostname || hostname === 'web-browser') {
    return res.status(400).json({ error: 'Hostname do terminal PDV inválido.' });
  }

  const { usuario_id: usuarioId, usuario_nome: usuarioNome } = extrairUsuarioHeartbeat(req);

  db.get(`SELECT * FROM terminais WHERE hostname = ?`, [hostname], (err, terminal) => {
    if (err) return res.status(500).json({ error: err.message });

    const agora = new Date().toISOString();
    if (terminal) {
      db.run(
        `UPDATE terminais SET ultima_conexao = ?, usuario_id = ?, usuario_nome = ?, updated_at = ? WHERE id = ?`,
        [agora, usuarioId, usuarioNome, agora, terminal.id],
        (updateErr) => {
          if (updateErr) {
            console.error('Erro ao atualizar terminal:', updateErr);
          }
          db.get(`SELECT * FROM terminais WHERE id = ?`, [terminal.id], (getErr, updated) => {
            if (getErr) return res.status(500).json({ error: getErr.message });
            res.json({ ...updated, online: true });
          });
        }
      );
      return;
    }

    const nomeTerminal = hostname;
    db.run(
      `INSERT INTO terminais (nome, hostname, usuario_id, usuario_nome, ativo, ultima_conexao, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
      [hostname, hostname, usuarioId, usuarioNome, agora, agora, agora],
      function(insertErr) {
        if (insertErr) return res.status(500).json({ error: insertErr.message });

        const novoId = this.lastID;
        db.get(`SELECT * FROM terminais WHERE id = ?`, [novoId], (getErr, novoTerminal) => {
          if (getErr) return res.status(500).json({ error: getErr.message });

          gravarAuditoria({
            usuario_id: req.user?.id || null,
            usuario_nome: req.user?.nome || req.user?.username || null,
            modulo: 'terminais',
            acao: 'criar_terminal',
            referencia_tipo: 'terminal',
            referencia_id: novoId,
            detalhes: { nome: nomeTerminal, hostname, origem: 'pdv' },
            ip_requisicao: req.ip || null
          }).catch((auditErr) => console.error('Erro ao gravar auditoria de terminal:', auditErr));

          res.json({ ...novoTerminal, online: true });
        });
      }
    );
  });
}

function registrarTerminalOffline(req, res) {
  const origem = String(req.query.origem || '').trim().toLowerCase();
  if (origem !== 'pdv') {
    return res.status(400).json({ error: 'Desconexão permitida apenas pelo módulo PDV (origem=pdv).' });
  }

  const hostname = String(req.query.hostname || '').trim();
  if (!hostname) {
    return res.status(400).json({ error: 'Hostname do terminal não pode estar vazio.' });
  }

  const agora = new Date().toISOString();
  db.run(
    `UPDATE terminais SET ultima_conexao = NULL, usuario_id = NULL, usuario_nome = NULL, updated_at = ? WHERE hostname = ?`,
    [agora, hostname],
    function(updateErr) {
      if (updateErr) return res.status(500).json({ error: updateErr.message });
      res.json({ ok: true, offline: true, hostname, changes: this.changes });
    }
  );
}

router.get('/', (req, res) => {
  db.all(`
    SELECT t.*, c.nome AS caixa_nome
    FROM terminais t
    LEFT JOIN caixas c ON c.id = t.caixa_id
    WHERE COALESCE(t.ativo, 1) = 1
    ORDER BY t.ultima_conexao DESC, t.id
  `, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(anexarStatusOnline(rows));
  });
});

router.post('/', (req, res) => {
  const { nome, hostname, caixa_id, ativo } = req.body;
  const nomeTerminal = String(nome || hostname || '').trim();

  if (!nomeTerminal) {
    return res.status(400).json({ error: 'Nome ou hostname do terminal é obrigatório.' });
  }

  const valores = [nomeTerminal, String(hostname || nomeTerminal).trim() || null, caixa_id || null, ativo === 0 ? 0 : 1, new Date().toISOString(), new Date().toISOString()];

  db.run(
    `INSERT INTO terminais (nome, hostname, caixa_id, ativo, ultima_conexao, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    valores,
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      db.get(`SELECT * FROM terminais WHERE id = ?`, [this.lastID], (getErr, row) => {
        if (getErr) return res.status(500).json({ error: getErr.message });
        res.status(201).json(row);
      });
    }
  );
});

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const { nome, hostname, caixa_id, ativo } = req.body;

  db.get(`SELECT * FROM terminais WHERE id = ?`, [id], (err, terminal) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!terminal) return res.status(404).json({ error: 'Terminal não encontrado.' });

    const updatedNome = nome !== undefined ? String(nome).trim() : terminal.nome;
    if (!updatedNome) {
      return res.status(400).json({ error: 'Nome do terminal é obrigatório.' });
    }

    const updatedHostname = hostname !== undefined ? String(hostname).trim() : terminal.hostname;
    const updatedCaixaId = caixa_id === '' || caixa_id === null || caixa_id === undefined
      ? null
      : Number(caixa_id);
    const updatedAtivo = ativo !== undefined ? (ativo ? 1 : 0) : terminal.ativo;
    const agora = new Date().toISOString();

    const aplicarAtualizacao = () => {
      db.run(
        `UPDATE terminais SET nome = ?, hostname = ?, caixa_id = ?, ativo = ?, updated_at = ? WHERE id = ?`,
        [updatedNome, updatedHostname, updatedCaixaId, updatedAtivo, agora, id],
        (updateErr) => {
          if (updateErr) return res.status(500).json({ error: updateErr.message });
          db.get(`
            SELECT t.*, c.nome AS caixa_nome
            FROM terminais t
            LEFT JOIN caixas c ON c.id = t.caixa_id
            WHERE t.id = ?
          `, [id], (getErr, row) => {
            if (getErr) return res.status(500).json({ error: getErr.message });

            gravarAuditoria({
              usuario_id: req.user?.id || null,
              usuario_nome: req.user?.nome || req.user?.username || null,
              modulo: 'terminais',
              acao: 'atualizar_terminal',
              referencia_tipo: 'terminal',
              referencia_id: id,
              detalhes: { antes: terminal, depois: { nome: updatedNome, hostname: updatedHostname, caixa_id: updatedCaixaId, ativo: updatedAtivo } },
              ip_requisicao: req.ip || null
            }).catch((auditErr) => console.error('Erro ao gravar auditoria de atualização de terminal:', auditErr));

            res.json(row);
          });
        }
      );
    };

    if (updatedCaixaId) {
      db.get(`SELECT id FROM caixas WHERE id = ?`, [updatedCaixaId], (errCaixa, caixa) => {
        if (errCaixa) return res.status(500).json({ error: errCaixa.message });
        if (!caixa) return res.status(400).json({ error: 'Caixa não encontrado.' });

        db.run(
          `UPDATE terminais SET caixa_id = NULL WHERE caixa_id = ? AND id != ?`,
          [updatedCaixaId, id],
          (errDetach) => {
            if (errDetach) return res.status(500).json({ error: errDetach.message });
            aplicarAtualizacao();
          }
        );
      });
      return;
    }

    aplicarAtualizacao();
  });
});

module.exports = router;
module.exports.registrarTerminalAuto = registrarTerminalAuto;
module.exports.registrarTerminalOffline = registrarTerminalOffline;
module.exports.terminalEstaOnline = terminalEstaOnline;
module.exports.HEARTBEAT_ONLINE_MS = HEARTBEAT_ONLINE_MS;
