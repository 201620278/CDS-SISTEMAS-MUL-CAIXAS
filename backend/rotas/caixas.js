const express = require('express');
const router = express.Router();
const db = require('../database');
const { gravarAuditoria } = require('../services/auditoria');
const { verificarPermissaoEspecifica } = require('./auth');

function obterColunasCaixas(callback) {
  db.all(`PRAGMA table_info('caixas')`, [], (err, rows) => {
    if (err) return callback(err, null);
    const cols = new Set((rows || []).map((row) => row.name));
    callback(null, cols);
  });
}

function montarSelectCaixas(cols) {
  const campos = ['c.id', 'c.nome', 'c.descricao', 'c.ativo'];
  if (cols.has('created_at')) campos.push('c.created_at');
  campos.push('COUNT(DISTINCT t.id) as qtd_terminais');
  return campos.join(', ');
}

function montarGroupByCaixas(cols) {
  const campos = ['c.id', 'c.nome', 'c.descricao', 'c.ativo'];
  if (cols.has('created_at')) campos.push('c.created_at');
  return campos.join(', ');
}

function montarSqlInserirCaixa(cols) {
  const campos = ['nome', 'descricao', 'ativo'];
  const placeholders = ['?', '?', '?'];
  if (cols.has('created_at')) {
    campos.push('created_at');
    placeholders.push("datetime('now')");
  }
  if (cols.has('updated_at')) {
    campos.push('updated_at');
    placeholders.push("datetime('now')");
  }
  return `INSERT INTO caixas (${campos.join(', ')}) VALUES (${placeholders.join(', ')})`;
}

function montarSqlAtualizarCaixa(cols) {
  const setPart = ['nome = ?', 'descricao = ?', 'ativo = ?'];
  if (cols.has('updated_at')) {
    setPart.push("updated_at = datetime('now')");
  }
  return `UPDATE caixas SET ${setPart.join(', ')} WHERE id = ?`;
}

function vincularTerminalAoCaixa(caixaId, hostname, callback) {
  const h = String(hostname || '').trim();
  if (!h) return callback(null);

  db.get(`SELECT id, caixa_id FROM terminais WHERE hostname = ?`, [h], (err, row) => {
    if (err) return callback(err);

    const agora = new Date().toISOString();

    if (row) {
      if (row.caixa_id && Number(row.caixa_id) !== Number(caixaId)) {
        return callback(null, { error: 'Terminal já vinculado a outro caixa' });
      }
      return db.run(
        `UPDATE terminais SET caixa_id = ?, updated_at = ? WHERE id = ?`,
        [caixaId, agora, row.id],
        (updateErr) => callback(updateErr)
      );
    }

    db.run(
      `INSERT INTO terminais (nome, hostname, caixa_id, ativo, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)`,
      [h, h, caixaId, agora, agora],
      (insertErr) => callback(insertErr)
    );
  });
}

// GET /api/caixas — Listar caixas com filtros e busca
router.get('/', verificarPermissaoEspecifica('caixa'), (req, res) => {
  const { busca, status } = req.query;
  obterColunasCaixas((errCols, cols) => {
    if (errCols) return res.status(500).json({ error: errCols.message });

    let sql = `
      SELECT 
        ${montarSelectCaixas(cols)}
      FROM caixas c
      LEFT JOIN terminais t ON t.caixa_id = c.id AND t.ativo = 1
      WHERE 1=1
    `;
    const params = [];

    if (status !== undefined && status !== '') {
    if (status === 'ativo') {
      sql += ` AND c.ativo = 1`;
    } else if (status === 'inativo') {
      sql += ` AND c.ativo = 0`;
    }
  }

  if (busca && busca.trim()) {
    sql += ` AND (c.nome LIKE ? OR c.descricao LIKE ?)`;
    const buscaPadrao = `%${busca.trim()}%`;
    params.push(buscaPadrao, buscaPadrao);
  }

    sql += ` GROUP BY ${montarGroupByCaixas(cols)} ORDER BY c.ativo DESC, c.nome ASC`;

    db.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ data: rows || [], total: rows ? rows.length : 0 });
    });
  });
});

// GET /api/caixas/:id — Buscar caixa por ID
router.get('/:id', verificarPermissaoEspecifica('caixa'), (req, res) => {
  const { id } = req.params;
  db.get(`
    SELECT
      c.*, 
      COUNT(DISTINCT t.id) as qtd_terminais,
      (SELECT hostname FROM terminais WHERE caixa_id = c.id LIMIT 1) as terminal_identificador
    FROM caixas c
    LEFT JOIN terminais t ON t.caixa_id = c.id AND t.ativo = 1
    WHERE c.id = ?
    GROUP BY c.id
  `, [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Caixa não encontrado' });
    res.json(row);
  });
});

// POST /api/caixas — Criar novo caixa (SUPER_ADMIN | ADMIN)
router.post('/', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Não autenticado' });
  if (!['SUPER_ADMIN', 'ADMIN'].includes(req.user.perfil)) {
    return res.status(403).json({ error: 'Sem permissão' });
  }

  const { nome, descricao, terminal_identificador, ativo = 1 } = req.body;

  // Validações
  if (!nome || !nome.trim()) {
    return res.status(400).json({ error: 'Nome do caixa é obrigatório' });
  }

  // Verificar se já existe caixa com este nome
  db.get(`SELECT id FROM caixas WHERE nome = ?`, [nome.trim()], (errCheck, existing) => {
    if (errCheck) return res.status(500).json({ error: errCheck.message });
    if (existing) {
      return res.status(400).json({ error: 'Já existe um caixa com este nome' });
    }

    // Se terminal foi fornecido, validar unicidade
    if (terminal_identificador && terminal_identificador.trim()) {
      db.get(
        `SELECT id FROM terminais WHERE hostname = ? AND caixa_id IS NOT NULL`,
        [terminal_identificador.trim()],
        (errTerminal, existingTerminal) => {
          if (errTerminal) return res.status(500).json({ error: errTerminal.message });
          if (existingTerminal) {
            return res.status(400).json({ error: 'Terminal já vinculado a outro caixa' });
          }
          inserirCaixa();
        }
      );
    } else {
      inserirCaixa();
    }
  });

  function inserirCaixa() {
    obterColunasCaixas((errCols, cols) => {
      if (errCols) return res.status(500).json({ error: errCols.message });
      const sql = montarSqlInserirCaixa(cols);
      const params = [nome.trim(), descricao || '', ativo ? 1 : 0];

      db.run(sql, params, function (err) {
        if (err) return res.status(500).json({ error: err.message });
        const caixaId = this.lastID;

        const registrarAuditoriaCriar = () => {
          gravarAuditoria({
            usuario_id: req.user.id,
            usuario_nome: req.user.nome || req.user.username,
            modulo: 'caixas',
            acao: 'criar',
            referencia_tipo: 'caixa',
            referencia_id: caixaId,
            detalhes: JSON.stringify({ nome, terminal: terminal_identificador })
          }).catch(e => console.error('Erro auditoria:', e));
        };

        if (terminal_identificador && terminal_identificador.trim()) {
          vincularTerminalAoCaixa(caixaId, terminal_identificador.trim(), (errUpdate, linkErr) => {
            if (linkErr) {
              return res.status(400).json(linkErr);
            }
            if (errUpdate) {
              console.error('Erro ao vincular terminal:', errUpdate);
              return res.status(500).json({ error: errUpdate.message });
            }
            registrarAuditoriaCriar();
            res.status(201).json({ id: caixaId, message: 'Caixa criado com sucesso' });
          });
        } else {
          registrarAuditoriaCriar();
          res.status(201).json({ id: caixaId, message: 'Caixa criado com sucesso' });
        }
      });
    });
  }
});

// PUT /api/caixas/:id — Editar caixa (SUPER_ADMIN | ADMIN)
router.put('/:id', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Não autenticado' });
  if (!['SUPER_ADMIN', 'ADMIN'].includes(req.user.perfil)) {
    return res.status(403).json({ error: 'Sem permissão' });
  }

  const { id } = req.params;
  const { nome, descricao, terminal_identificador, ativo } = req.body;

  // Validações
  if (!nome || !nome.trim()) {
    return res.status(400).json({ error: 'Nome do caixa é obrigatório' });
  }

  // Obter caixa atual
  db.get(`SELECT * FROM caixas WHERE id = ?`, [id], (errGet, caixa) => {
    if (errGet) return res.status(500).json({ error: errGet.message });
    if (!caixa) return res.status(404).json({ error: 'Caixa não encontrado' });

    // Verificar se outro caixa tem este nome
    db.get(
      `SELECT id FROM caixas WHERE nome = ? AND id != ?`,
      [nome.trim(), id],
      (errDup, dup) => {
        if (errDup) return res.status(500).json({ error: errDup.message });
        if (dup) {
          return res.status(400).json({ error: 'Já existe outro caixa com este nome' });
        }

        // Se terminal foi fornecido, validar
        if (terminal_identificador && terminal_identificador.trim()) {
          db.get(
            `SELECT id, caixa_id FROM terminais WHERE hostname = ? LIMIT 1`,
            [terminal_identificador.trim()],
            (errTerminal, terminal) => {
              if (errTerminal) return res.status(500).json({ error: errTerminal.message });
              if (terminal && terminal.caixa_id && terminal.caixa_id != id) {
                return res.status(400).json({ error: 'Terminal já vinculado a outro caixa' });
              }
              atualizarCaixa();
            }
          );
        } else {
          atualizarCaixa();
        }
      }
    );

    function atualizarCaixa() {
      const novoAtivo = ativo !== undefined ? (ativo ? 1 : 0) : caixa.ativo;
      obterColunasCaixas((errCols, cols) => {
        if (errCols) return res.status(500).json({ error: errCols.message });
        const sqlUpdate = montarSqlAtualizarCaixa(cols);
        const paramsUpdate = [nome.trim(), descricao || '', novoAtivo, id];

        db.run(sqlUpdate, paramsUpdate, (errUpdate) => {
          if (errUpdate) return res.status(500).json({ error: errUpdate.message });

          const novoTerminal = terminal_identificador && terminal_identificador.trim() ? terminal_identificador.trim() : null;

          db.get(
            `SELECT hostname FROM terminais WHERE caixa_id = ? LIMIT 1`,
            [id],
            (errCurrent, currentTerminal) => {
              if (errCurrent) {
                return res.status(500).json({ error: errCurrent.message });
              }

              const currentHostname = currentTerminal ? currentTerminal.hostname : null;

              const finalizaAtualizacao = () => {
                gravarAuditoria({
                  usuario_id: req.user.id,
                  usuario_nome: req.user.nome || req.user.username,
                  modulo: 'caixas',
                  acao: 'editar',
                  referencia_tipo: 'caixa',
                  referencia_id: id,
                  detalhes: JSON.stringify({ nome, terminal: novoTerminal })
                }).catch(e => console.error('Erro auditoria:', e));

                res.json({ message: 'Caixa atualizado com sucesso' });
              };

              if (!novoTerminal) {
                if (!currentHostname) {
                  return finalizaAtualizacao();
                }

                return db.run(
                  `UPDATE terminais SET caixa_id = NULL WHERE caixa_id = ?`,
                  [id],
                  (errDetach) => {
                    if (errDetach) {
                      return res.status(500).json({ error: errDetach.message });
                    }
                    return finalizaAtualizacao();
                  }
                );
              }

              if (currentHostname === novoTerminal) {
                return finalizaAtualizacao();
              }

              db.get(
                `SELECT id, caixa_id FROM terminais WHERE hostname = ? LIMIT 1`,
                [novoTerminal],
                (errTerm, novoTerminalRow) => {
                  if (errTerm) {
                    return res.status(500).json({ error: errTerm.message });
                  }

                  if (novoTerminalRow && novoTerminalRow.caixa_id && novoTerminalRow.caixa_id != id) {
                    return res.status(400).json({ error: 'Terminal já vinculado a outro caixa' });
                  }

                  const detachCurrent = currentHostname
                    ? (callback) => db.run(`UPDATE terminais SET caixa_id = NULL WHERE caixa_id = ?`, [id], callback)
                    : (callback) => callback();

                  detachCurrent((errDetach) => {
                    if (errDetach) {
                      return res.status(500).json({ error: errDetach.message });
                    }

                    vincularTerminalAoCaixa(id, novoTerminal, (errAttach, linkErr) => {
                      if (linkErr) {
                        return res.status(400).json(linkErr);
                      }
                      if (errAttach) {
                        return res.status(500).json({ error: errAttach.message });
                      }
                      finalizaAtualizacao();
                    });
                  });
                }
              );
            }
          );
        });
      });
    }
  });
});

// DELETE /api/caixas/:id — Desativar caixa (soft delete)
router.delete('/:id', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Não autenticado' });
  if (!['SUPER_ADMIN', 'ADMIN'].includes(req.user.perfil)) {
    return res.status(403).json({ error: 'Sem permissão' });
  }

  const { id } = req.params;

  // Verificar se caixa administrativo está com sessão aberta
  db.get(
    `SELECT id FROM caixa_sessoes WHERE caixa_id = ? AND status = 'aberto' LIMIT 1`,
    [id],
    (errCheck, sessaoAberta) => {
      if (errCheck) return res.status(500).json({ error: errCheck.message });
      if (sessaoAberta) {
        return res.status(400).json({ error: 'Não é possível desativar um caixa com sessão aberta.' });
      }

      // Soft delete
      obterColunasCaixas((errCols, cols) => {
        if (errCols) return res.status(500).json({ error: errCols.message });
        const sql = cols.has('updated_at')
          ? `UPDATE caixas SET ativo = 0, updated_at = datetime('now') WHERE id = ?`
          : `UPDATE caixas SET ativo = 0 WHERE id = ?`;

        db.run(sql, [id], function (err) {
          if (err) return res.status(500).json({ error: err.message });
          if (this.changes === 0) return res.status(404).json({ error: 'Caixa não encontrado' });

          gravarAuditoria({
            usuario_id: req.user.id,
            usuario_nome: req.user.nome || req.user.username,
            modulo: 'caixas',
            acao: 'desativar',
            referencia_tipo: 'caixa',
            referencia_id: id,
            detalhes: JSON.stringify({})
          }).catch(e => console.error('Erro auditoria:', e));

          res.json({ message: 'Caixa desativado com sucesso' });
        });
      });
    }
  );
});

// PUT /api/caixas/:id/reativar — Reativar caixa
router.put('/:id/reativar', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Não autenticado' });
  if (!['SUPER_ADMIN', 'ADMIN'].includes(req.user.perfil)) {
    return res.status(403).json({ error: 'Sem permissão' });
  }

  const { id } = req.params;

  obterColunasCaixas((errCols, cols) => {
    if (errCols) return res.status(500).json({ error: errCols.message });
    const sql = cols.has('updated_at')
      ? `UPDATE caixas SET ativo = 1, updated_at = datetime('now') WHERE id = ?`
      : `UPDATE caixas SET ativo = 1 WHERE id = ?`;

    db.run(sql, [id], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: 'Caixa não encontrado' });

      gravarAuditoria({
        usuario_id: req.user.id,
        usuario_nome: req.user.nome || req.user.username,
        modulo: 'caixas',
        acao: 'reativar',
        referencia_tipo: 'caixa',
        referencia_id: id,
        detalhes: JSON.stringify({})
      }).catch(e => console.error('Erro auditoria:', e));

      res.json({ message: 'Caixa reativado com sucesso' });
    });
  });
});

module.exports = router;
