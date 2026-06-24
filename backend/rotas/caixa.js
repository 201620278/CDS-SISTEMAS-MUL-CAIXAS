const express = require('express');
const router = express.Router();
const db = require('../database');
const { verificarToken } = require('./auth');
const { validarCaixaAberto } = require('../middleware/validarCaixaAberto');
const bcrypt = require('bcryptjs');
const { gravarAuditoria } = require('../services/auditoria');
const { FILTRO_VENDA_VALIDA, getExprValorVenda } = require('../services/reportFiscalHelpers');

function n(valor) {
  return Number(valor || 0);
}

function agoraLocalBrasil() {
  const agora = new Date();

  const dataBrasil = new Date(
    agora.toLocaleString('en-US', { timeZone: 'America/Fortaleza' })
  );

  const ano = dataBrasil.getFullYear();
  const mes = String(dataBrasil.getMonth() + 1).padStart(2, '0');
  const dia = String(dataBrasil.getDate()).padStart(2, '0');
  const hora = String(dataBrasil.getHours()).padStart(2, '0');
  const min = String(dataBrasil.getMinutes()).padStart(2, '0');
  const seg = String(dataBrasil.getSeconds()).padStart(2, '0');

  return `${ano}-${mes}-${dia} ${hora}:${min}:${seg}`;
}

function hoje() {
  return agoraLocalBrasil().slice(0, 10);
}

function obterTerminalId(req) {
  const rawId = req.body?.terminal_id || req.query?.terminal_id || req.headers['x-terminal-id'];
  const id = Number(rawId || 0);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function obterSessaoAberta(terminalId, callback) {
  if (terminalId) {
    db.get(
      `SELECT * FROM caixa_sessoes WHERE status = 'aberto' AND terminal_id = ? ORDER BY id DESC LIMIT 1`,
      [terminalId],
      callback
    );
    return;
  }

  db.get(
    `SELECT * FROM caixa_sessoes WHERE status = 'aberto' ORDER BY id DESC LIMIT 1`,
    [],
    callback
  );
}

function obterCaixaAberto(terminalId, callback) {
  if (terminalId) {
    db.get(
      `SELECT * FROM caixa WHERE status = 'aberto' AND terminal_id = ? ORDER BY id DESC LIMIT 1`,
      [terminalId],
      callback
    );
    return;
  }

  db.get(
    `SELECT * FROM caixa WHERE status = 'aberto' ORDER BY id DESC LIMIT 1`,
    [],
    callback
  );
}

function normalizarForma(forma) {
  return String(forma || '').toLowerCase().trim();
}

function calcularResumoCaixa(caixa, options = {}, callback) {
  const data = caixa.data;
  const sessaoId = options.sessaoId || null;
  const modoFiscal = options.modo_fiscal || '0';
  const exprValor = getExprValorVenda(modoFiscal);

  // Se não recebeu sessaoId, tentar resolver a última sessão para este caixa
  const obterSessao = (cb) => {
    // Não tentar resolver "última sessão" implicitamente aqui.
    // Se a função não recebeu `sessaoId`, retornamos null e deixamos o chamador decidir.
    return cb(null, sessaoId || null);
  };

  obterSessao((sessErr, resolvedSessaoId) => {
    if (sessErr) return callback(sessErr);

    if (!resolvedSessaoId) {
      // Sem sessão associada -> retornar resumo vazio baseado no caixa
      return callback(null, {
        caixa,
        total_vendido: 0,
        dinheiro: {
          valor_inicial: n(caixa.valor_inicial),
          vendas_dinheiro: 0,
          suprimentos: 0,
          sangrias: 0,
          dinheiro_esperado: n(caixa.valor_inicial)
        },
        digital: { pix: 0, cartao_credito: 0, cartao_debito: 0, total_digital: 0 },
        prazo: 0,
        outras_formas: 0,
        saldo_geral: n(caixa.valor_inicial)
      });
    }

    db.all(`
      SELECT v.forma_pagamento, SUM(${exprValor}) AS total
      FROM vendas v
      WHERE ${FILTRO_VENDA_VALIDA}
        AND v.caixa_sessao_id = ?
      GROUP BY v.forma_pagamento
    `, [resolvedSessaoId], (err, vendas) => {
      if (err) return callback(err);

      db.get(`
        SELECT SUM(valor) AS total_sangrias
        FROM caixa_movimentacoes
        WHERE sessao_id = ? AND tipo = 'sangria'
      `, [resolvedSessaoId], (err2, sangriasRow) => {
      if (err2) return callback(err2);
        db.get(`
          SELECT SUM(valor) AS total_suprimentos
          FROM caixa_movimentacoes
          WHERE sessao_id = ? AND tipo = 'suprimento'
        `, [resolvedSessaoId], (err3, suprimentosRow) => {
        if (err3) return callback(err3);

        let vendasDinheiro = 0;
        let vendasPix = 0;
        let vendasCartaoCredito = 0;
        let vendasCartaoDebito = 0;
        let vendasPrazo = 0;
        let outrasFormas = 0;

        (vendas || []).forEach(v => {
          const forma = normalizarForma(v.forma_pagamento);
          const total = n(v.total);

          if (forma === 'dinheiro') vendasDinheiro += total;
          else if (forma === 'pix') vendasPix += total;
          else if (forma === 'cartao_credito' || forma === 'credito') vendasCartaoCredito += total;
          else if (forma === 'cartao_debito' || forma === 'debito') vendasCartaoDebito += total;
          else if (forma === 'prazo') vendasPrazo += total;
          else outrasFormas += total;
        });

        const totalSangrias = n(sangriasRow?.total_sangrias);
        const totalSuprimentos = n(suprimentosRow?.total_suprimentos);

        const totalDigital = vendasPix + vendasCartaoCredito + vendasCartaoDebito;
        const totalVendido = vendasDinheiro + totalDigital + vendasPrazo + outrasFormas;

        const dinheiroEsperado =
          n(caixa.valor_inicial) +
          vendasDinheiro +
          totalSuprimentos -
          totalSangrias;

        const saldoGeral =
          n(caixa.valor_inicial) +
          totalVendido +
          totalSuprimentos -
          totalSangrias;

        callback(null, {
          caixa,
          total_vendido: totalVendido,
          dinheiro: {
            valor_inicial: n(caixa.valor_inicial),
            vendas_dinheiro: vendasDinheiro,
            suprimentos: totalSuprimentos,
            sangrias: totalSangrias,
            dinheiro_esperado: dinheiroEsperado
          },
          digital: {
            pix: vendasPix,
            cartao_credito: vendasCartaoCredito,
            cartao_debito: vendasCartaoDebito,
            total_digital: totalDigital
          },
          prazo: vendasPrazo,
          outras_formas: outrasFormas,
          saldo_geral: saldoGeral
        });
      });
    });
  });
});
}

function isAdminUsuario(usuario) {
  const perfil = String(usuario?.perfil || '').trim().toUpperCase();
  return usuario?.role === 'admin' || ['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR'].includes(perfil);
}

function validarSenhaAdmin(senhaAdmin, callback) {
  if (!senhaAdmin) {
    return callback(null, false);
  }

  db.all(`SELECT * FROM usuarios WHERE COALESCE(ativo, 1) = 1`, [], async (err, usuarios) => {
    if (err) return callback(err);

    if (!usuarios || usuarios.length === 0) {
      return callback(null, false);
    }

    for (const usuario of usuarios) {
      if (!isAdminUsuario(usuario)) continue;

      const senhaBanco =
        usuario.password_hash ||
        usuario.senha_hash ||
        usuario.senha ||
        usuario.password;

      if (!senhaBanco) continue;

      const senhaOk = await bcrypt.compare(senhaAdmin, senhaBanco).catch(() => false);

      if (senhaOk || senhaAdmin === senhaBanco) {
        return callback(null, true);
      }
    }

    return callback(null, false);
  });
}

router.get('/aberto', (req, res) => {
  const terminalId = obterTerminalId(req);

  // Preferir sessão aberta por terminal
  obterSessaoAberta(terminalId, (sessErr, sessao) => {
    if (sessErr) return res.status(500).json({ error: sessErr.message });
    if (sessao) {
      // buscar caixa relacionado
      db.get('SELECT * FROM caixa WHERE id = ?', [sessao.caixa_id], (cErr, caixa) => {
        if (cErr) return res.status(500).json({ error: cErr.message });
        if (!caixa) return res.json(null);
        calcularResumoCaixa(caixa, { sessaoId: sessao.id }, (calcErr, resumo) => {
          if (calcErr) return res.status(500).json({ error: calcErr.message });
          resumo.sessao = sessao;
          res.json(resumo);
        });
      });
      return;
    }

    // fallback para compatibilidade com implementações antigas
    obterCaixaAberto(terminalId, (err, caixa) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!caixa) return res.json(null);

      calcularResumoCaixa(caixa, {}, (calcErr, resumo) => {
        if (calcErr) return res.status(500).json({ error: calcErr.message });
        res.json(resumo);
      });
    });
  });
});

router.get('/saldo-inicial-sugerido', (req, res) => {
  db.get(`
    SELECT
      id,
      valor_fechamento,
      fechado_em
    FROM caixa
    WHERE status = 'fechado'
    ORDER BY id DESC
    LIMIT 1
  `, [], (err, caixa) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    const valor = Number(caixa?.valor_fechamento || 0);

    res.json({
      valor_sugerido: valor,
      ultimo_caixa_id: caixa?.id || null,
      fechado_em: caixa?.fechado_em || null,
      mensagem: caixa
        ? 'Saldo sugerido carregado do último fechamento.'
        : 'Nenhum fechamento anterior encontrado.'
    });
  });
});

router.post('/abrir', verificarToken, (req, res) => {
  const valorInicial = n(req.body.valor_inicial);
  const terminalId = obterTerminalId(req);

  // Impedir abertura se já existir SESSÃO aberta neste terminal (lock de terminal)
  obterSessaoAberta(terminalId, (sessErr, sessaoAberta) => {
    if (sessErr) return res.status(500).json({ error: sessErr.message });
    if (sessaoAberta) {
      return res.status(400).json({ error: 'Já existe um caixa aberto neste terminal.' });
    }

    const caixaData = {
      data: hoje(),
      valor_inicial: valorInicial,
      status: 'aberto',
      aberto_em: agoraLocalBrasil(),
      operador_abertura_id: req.user?.id || null,
      terminal_id: terminalId
    };

    db.insertSafe('caixa', caixaData, function(insertErr, info) {
      if (insertErr) return res.status(500).json({ error: insertErr.message });

      const caixaId = info && info.lastID ? info.lastID : this && this.lastID ? this.lastID : null;

      // Criar sessão de caixa vinculada (cada abertura gera nova sessão)
      db.run(`
        INSERT INTO caixa_sessoes (
          caixa_id, terminal_id, operador_id, valor_abertura, aberto_em, status
        ) VALUES (?, ?, ?, ?, DATETIME('now','localtime'), 'aberto')
      `, [caixaId, terminalId, req.user?.id || null, valorInicial], function(sessInsertErr) {
        if (sessInsertErr) {
          // tentar rollback da caixa principal
          db.run('DELETE FROM caixa WHERE id = ?', [caixaId]);
          return res.status(500).json({ error: sessInsertErr.message });
        }

        const sessaoId = this.lastID;

        db.run(`
          INSERT INTO caixa_movimentacoes (
            caixa_id,
            sessao_id,
            tipo,
            valor,
            motivo,
            usuario_id,
            terminal_id
          ) VALUES (?, ?, 'abertura', ?, 'Abertura de caixa', ?, ?)
        `, [caixaId, sessaoId, valorInicial, req.user?.id || null, terminalId], (movErr) => {
          if (movErr) return res.status(500).json({ error: movErr.message });

          // Registrar auditoria centralizada
          gravarAuditoria({
            usuario_id: req.user?.id || null,
            usuario_nome: req.user?.nome || req.user?.username || null,
            modulo: 'caixa',
            acao: 'abrir_caixa',
            referencia_tipo: 'caixa_sessao',
            referencia_id: sessaoId,
            detalhes: { valor_inicial: valorInicial, caixa_id: caixaId },
            ip_requisicao: req.ip || null
          }).catch((auditErr) => console.error('Erro ao gravar auditoria de abertura de caixa:', auditErr));

          res.json({
            message: 'Caixa aberto com sucesso.',
            caixa_id: caixaId,
            sessao_id: sessaoId
          });
        });
      });
    });
  });
});

router.post('/sangria', verificarToken, validarCaixaAberto, async (req, res) => {
  const valor = n(req.body.valor);
  const motivo = req.body.motivo || 'Sangria de caixa';
  const operadorId = req.user?.id || null;
  const operadorNome = req.user?.nome || req.user?.username || 'Desconhecido';
  const senhaAdmin = req.body.senha_admin;

  if (valor <= 0) {
    return res.status(400).json({ error: 'Informe um valor válido para sangria.' });
  }

  const terminalId = obterTerminalId(req);

  validarSenhaAdmin(senhaAdmin, (senhaErr, senhaValida) => {
    if (senhaErr) {
      return res.status(500).json({ error: senhaErr.message });
    }

    if (!senhaValida) {
      return res.status(400).json({ error: 'Senha de administrador inválida para realizar sangria.' });
    }

    obterSessaoAberta(terminalId, (errSess, sessao) => {
        if (errSess) {
          return res.status(500).json({ error: errSess.message });
        }

        if (!sessao) {
          return res.status(400).json({ error: terminalId ? 'Nenhuma sessão de caixa aberta para este terminal.' : 'Nenhuma sessão de caixa aberta.' });
        }

        db.get('SELECT * FROM caixa WHERE id = ?', [sessao.caixa_id], (errCaixa, caixa) => {
          if (errCaixa) return res.status(500).json({ error: errCaixa.message });
          if (!caixa) return res.status(400).json({ error: 'Caixa vinculado à sessão não encontrado.' });

          calcularResumoCaixa(caixa, { sessaoId: sessao.id }, (calcErr, resumo) => {
            if (calcErr) {
              return res.status(500).json({ error: calcErr.message });
            }

            if (valor > resumo.dinheiro.dinheiro_esperado) {
              return res.status(400).json({
                error: `Sangria maior que o dinheiro esperado. Disponível: ${resumo.dinheiro.dinheiro_esperado.toFixed(2)}`
              });
            }

            db.serialize(() => {
              db.run('BEGIN IMMEDIATE');

              db.run(
                `INSERT INTO caixa_movimentacoes (
                  caixa_id,
                  sessao_id,
                  tipo,
                  valor,
                  motivo,
                  usuario_id,
                  operador_nome,
                  terminal_id
                ) VALUES (?, ?, 'sangria', ?, ?, ?, ?, ?)`,
                [caixa.id, sessao.id, valor, motivo, operadorId, operadorNome, terminalId],
                (movErr) => {
                  if (movErr) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: movErr.message });
                  }

                  db.run(
                      `INSERT INTO auditoria_caixa (
                        sessao_id,
                        caixa_id,
                        operador_id,
                        terminal_id,
                        acao,
                        tipo_movimentacao,
                        valor,
                        detalhes
                      ) VALUES (?, ?, ?, ?, 'sangria', 'sangria', ?, ?)`,
                      [sessao.id, caixa.id, operadorId, sessao.terminal_id || terminalId, valor, JSON.stringify({ motivo, operador: operadorNome, sessao_id: sessao.id })], (auditErr) => {
                      if (auditErr) console.error('Erro ao registrar auditoria:', auditErr);

                      db.run('COMMIT', (commitErr) => {
                        if (commitErr) {
                          db.run('ROLLBACK');
                          return res.status(500).json({ error: commitErr.message });
                        }

                        // auditoria centralizada
                        gravarAuditoria({
                          usuario_id: operadorId,
                          usuario_nome: operadorNome,
                          modulo: 'caixa',
                          acao: 'sangria',
                          referencia_tipo: 'caixa_sessao',
                          referencia_id: sessao.id,
                          detalhes: { valor, motivo, caixa_id: caixa.id },
                          ip_requisicao: req.ip || null
                        }).catch((auditErr) => console.error('Erro ao gravar auditoria de sangria:', auditErr));

                        res.json({
                          message: 'Sangria registrada com sucesso.',
                          valor,
                          motivo,
                          operador: operadorNome
                        });
                      });
                    }
                  );
                }
              );
            });
          });
        });
      }
    );
  });
});

router.post('/suprimento', verificarToken, validarCaixaAberto, (req, res) => {
  const valor = n(req.body.valor);
  const motivo = req.body.motivo || 'Suprimento de caixa';
  const operadorId = req.user?.id || null;
  const operadorNome = req.user?.nome || req.user?.username || 'Desconhecido';

  if (valor <= 0) {
    return res.status(400).json({ error: 'Informe um valor válido para suprimento.' });
  }

  const terminalId = obterTerminalId(req);

  obterSessaoAberta(terminalId, (errSess, sessao) => {
      if (errSess) return res.status(500).json({ error: errSess.message });
      if (!sessao) return res.status(400).json({ error: terminalId ? 'Nenhuma sessão de caixa aberta para este terminal.' : 'Nenhuma sessão de caixa aberta.' });

      db.get('SELECT * FROM caixa WHERE id = ?', [sessao.caixa_id], (err, caixa) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!caixa) return res.status(400).json({ error: 'Caixa vinculado à sessão não encontrado.' });

        db.serialize(() => {
          db.run('BEGIN IMMEDIATE');

          db.run(
            `INSERT INTO caixa_movimentacoes (
              caixa_id,
              sessao_id,
              tipo,
              valor,
              motivo,
              usuario_id,
              operador_nome,
              terminal_id
            ) VALUES (?, ?, 'suprimento', ?, ?, ?, ?, ?)`,
            [caixa.id, sessao.id, valor, motivo, operadorId, operadorNome, terminalId],
            (movErr) => {
              if (movErr) {
                db.run('ROLLBACK');
                return res.status(500).json({ error: movErr.message });
              }

              db.run(
                `INSERT INTO auditoria_caixa (
                  sessao_id,
                  caixa_id,
                  operador_id,
                  terminal_id,
                  acao,
                  tipo_movimentacao,
                  valor,
                  detalhes,
                  ip_requisicao
                ) VALUES (?, ?, ?, ?, 'suprimento', 'suprimento', ?, ?, ?)`,
                [sessao.id, caixa.id, operadorId, sessao.terminal_id || terminalId, valor, JSON.stringify({ motivo, operador: operadorNome, sessao_id: sessao.id }), req.ip || null],
                (auditErr) => {
                  if (auditErr) console.error('Erro ao registrar auditoria:', auditErr);

                  db.run('COMMIT', (commitErr) => {
                    if (commitErr) {
                      db.run('ROLLBACK');
                      return res.status(500).json({ error: commitErr.message });
                    }

                    // auditoria centralizada
                    gravarAuditoria({
                      usuario_id: operadorId,
                      usuario_nome: operadorNome,
                      modulo: 'caixa',
                      acao: 'suprimento',
                      referencia_tipo: 'caixa_sessao',
                      referencia_id: sessao.id,
                      detalhes: { valor, motivo, caixa_id: caixa.id },
                      ip_requisicao: req.ip || null
                    }).catch((auditErr) => console.error('Erro ao gravar auditoria de suprimento:', auditErr));

                    res.json({
                      message: 'Suprimento registrado com sucesso.',
                      valor,
                      motivo,
                      operador: operadorNome
                    });
                  });
                }
              );
            }
          );
        });
      });
    }
  );
});

router.post('/fechar', verificarToken, validarCaixaAberto, (req, res) => {
  const valorInformado = n(req.body.valor_informado);
  const observacao = req.body.observacao || '';
  const operadorId = req.user?.id || null;
  const operadorNome = req.user?.nome || req.user?.username || 'Desconhecido';
  const terminalId = obterTerminalId(req);
  obterSessaoAberta(terminalId, (errSess, sessao) => {
      if (errSess) return res.status(500).json({ error: errSess.message });
      if (!sessao) return res.status(400).json({ error: terminalId ? 'Nenhuma sessão de caixa aberta para este terminal.' : 'Nenhuma sessão de caixa aberta.' });

      db.get('SELECT * FROM caixa WHERE id = ?', [sessao.caixa_id], (err, caixa) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!caixa) return res.status(400).json({ error: 'Caixa vinculado à sessão não encontrado.' });

        // Verificar se sessão já possui fechamento (impedir duplicidade)
        db.get(`SELECT id FROM caixa_fechamentos WHERE sessao_id = ? LIMIT 1`, [sessao.id], (checkErr, jaFechado) => {
          if (checkErr) return res.status(500).json({ error: checkErr.message });
          if (jaFechado) {
            return res.status(400).json({ error: 'Esta sessão de caixa já foi fechada. Use REIMPRESSÃO se necessário reimprimir.' });
          }

          calcularFechamentoDetalhado(caixa, { sessaoId: sessao.id }, (calcErr, detalhes) => {
            if (calcErr) return res.status(500).json({ error: calcErr.message });

            const diferenca = valorInformado - detalhes.total_esperado;

            db.serialize(() => {
              db.run('BEGIN IMMEDIATE');

              // Atualizar status do caixa e resumos do fechamento
              db.run(`
                UPDATE caixa SET
                  status = 'fechado',
                  fechado_em = DATETIME('now', 'localtime'),
                  fechado_por = ?,
                  valor_fechamento = ?,
                  total_sangrias = ?,
                  total_suprimentos = ?,
                  saldo_esperado = ?,
                  diferenca = ?,
                  observacao = ?
                WHERE id = ?
              `, [
                operadorId,
                valorInformado,
                detalhes.total_sangrias,
                detalhes.total_suprimentos,
                detalhes.total_esperado,
                diferenca,
                observacao,
                caixa.id
              ], (updateErr) => {
                if (updateErr) {
                  db.run('ROLLBACK');
                  return res.status(500).json({ error: updateErr.message });
                }

                // Registrar fechamento detalhado
                db.run(`
                  INSERT INTO caixa_fechamentos (
                    sessao_id,
                    caixa_id,
                    operador_id,
                    terminal_id,
                    data_fechamento,
                    valor_inicial,
                    vendas_dinheiro,
                    vendas_pix,
                    vendas_debito,
                    vendas_credito,
                    vendas_prazo,
                    vendas_tef,
                    total_sangrias,
                    total_suprimentos,
                    total_vendido,
                    total_esperado,
                    total_informado,
                    diferenca,
                    observacao
                  ) VALUES (?, ?, ?, ?, DATETIME('now', 'localtime'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                  sessao.id,
                  caixa.id,
                  operadorId,
                  sessao.terminal_id || terminalId,
                  detalhes.valor_inicial,
                  detalhes.vendas_dinheiro,
                  detalhes.vendas_pix,
                  detalhes.vendas_debito,
                  detalhes.vendas_credito,
                  detalhes.vendas_prazo,
                  detalhes.vendas_tef,
                  detalhes.total_sangrias,
                  detalhes.total_suprimentos,
                  detalhes.total_vendido,
                  detalhes.total_esperado,
                  valorInformado,
                  diferenca,
                  observacao
                ], (insertErr) => {
                  if (insertErr) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: insertErr.message });
                  }

                  // Atualizar sessão para fechado
                  db.run(`UPDATE caixa_sessoes SET status = 'fechado', fechado_em = DATETIME('now','localtime'), valor_fechamento = ? WHERE id = ?`, [valorInformado, sessao.id], (sessUpdErr) => {
                    if (sessUpdErr) console.error('Erro ao atualizar sessao:', sessUpdErr);

                    // Registrar auditoria
                    db.run(`
                      INSERT INTO auditoria_caixa (
                        sessao_id,
                        caixa_id,
                        operador_id,
                        terminal_id,
                        acao,
                        tipo_movimentacao,
                        valor,
                        detalhes,
                        ip_requisicao
                      ) VALUES (?, ?, ?, ?, 'fechamento', 'fechamento', ?, ?, ?)
                    `, [
                      sessao.id,
                      caixa.id,
                      operadorId,
                      sessao.terminal_id || terminalId,
                      valorInformado,
                      JSON.stringify({
                        diferenca,
                        operador: operadorNome,
                        observacao,
                        sessao_id: sessao.id
                      }),
                      req.ip || null
                    ], (auditErr) => {
                      if (auditErr) console.error('Erro ao registrar auditoria:', auditErr);

                      // Registrar movimentação
                      db.run(`
                        INSERT INTO caixa_movimentacoes (
                          caixa_id,
                          sessao_id,
                          tipo,
                          valor,
                          motivo,
                          usuario_id,
                          operador_nome
                        ) VALUES (?, ?, 'fechamento', ?, 'Fechamento de caixa', ?, ?)
                      `, [caixa.id, sessao.id, valorInformado, operadorId, operadorNome], (movErr) => {
                        if (movErr) {
                          db.run('ROLLBACK');
                          return res.status(500).json({ error: movErr.message });
                        }

                        db.run('COMMIT', (commitErr) => {
                          if (commitErr) {
                            db.run('ROLLBACK');
                            return res.status(500).json({ error: commitErr.message });
                          }

                          // auditoria centralizada do fechamento
                          gravarAuditoria({
                            usuario_id: operadorId,
                            usuario_nome: operadorNome,
                            modulo: 'caixa',
                            acao: 'fechar_caixa',
                            referencia_tipo: 'caixa_sessao',
                            referencia_id: sessao.id,
                            detalhes: { valor_informado: valorInformado, diferenca, observacao, caixa_id: caixa.id },
                            ip_requisicao: req.ip || null
                          }).catch((auditErr) => console.error('Erro ao gravar auditoria de fechamento de caixa:', auditErr));

                          res.json({
                            message: 'Caixa fechado com sucesso.',
                            caixa_id: caixa.id,
                            sessao_id: sessao.id,
                            operador: operadorNome,
                            detalhes: {
                              ...detalhes,
                              total_informado: valorInformado,
                              diferenca
                            }
                          });
                        });
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    }
  );
});

// Função para calcular fechamento detalhado com todas as formas de pagamento
function calcularFechamentoDetalhado(caixa, options = {}, callback) {
  const data = caixa.data;
  const sessaoId = options.sessaoId || null;
  const modoFiscal = options.modo_fiscal || '0';
  const exprValor = getExprValorVenda(modoFiscal);

  const vendasWhere = 'v.caixa_sessao_id = ?';

  db.all(`
    SELECT v.forma_pagamento, SUM(${exprValor}) AS total
    FROM vendas v
    WHERE ${FILTRO_VENDA_VALIDA}
      AND ${vendasWhere}
    GROUP BY v.forma_pagamento
  `, [sessaoId], (err, vendas) => {
    if (err) return callback(err);

      const whereMov = 'sessao_id = ?';
      db.get(`
        SELECT SUM(valor) AS total_sangrias
        FROM caixa_movimentacoes
        WHERE ${whereMov} AND tipo = 'sangria'
      `, [sessaoId], (err2, sangriasRow) => {
      if (err2) return callback(err2);

        db.get(`
          SELECT SUM(valor) AS total_suprimentos
          FROM caixa_movimentacoes
          WHERE ${whereMov} AND tipo = 'suprimento'
        `, [sessaoId], (err3, suprimentosRow) => {
        if (err3) return callback(err3);

        let vendasDinheiro = 0;
        let vendasPix = 0;
        let vendasCartaoCredito = 0;
        let vendasCartaoDebito = 0;
        let vendasPrazo = 0;
        let vendasTef = 0;

        (vendas || []).forEach(v => {
          const forma = normalizarForma(v.forma_pagamento);
          const total = n(v.total);

          if (forma === 'dinheiro') vendasDinheiro += total;
          else if (forma === 'pix') vendasPix += total;
          else if (forma === 'cartao_credito' || forma === 'credito') vendasCartaoCredito += total;
          else if (forma === 'cartao_debito' || forma === 'debito') vendasCartaoDebito += total;
          else if (forma === 'prazo') vendasPrazo += total;
          else if (forma === 'tef' || forma === 'cartao') vendasTef += total;
        });

        const totalSangrias = n(sangriasRow?.total_sangrias);
        const totalSuprimentos = n(suprimentosRow?.total_suprimentos);
        const valorInicial = n(caixa.valor_inicial);

        const totalVendido = vendasDinheiro + vendasPix + vendasCartaoCredito + vendasCartaoDebito + vendasPrazo + vendasTef;
        const totalEsperado = valorInicial + vendasDinheiro + totalSuprimentos - totalSangrias;

        callback(null, {
          valor_inicial: valorInicial,
          vendas_dinheiro: vendasDinheiro,
          vendas_pix: vendasPix,
          vendas_debito: vendasCartaoDebito,
          vendas_credito: vendasCartaoCredito,
          vendas_prazo: vendasPrazo,
          vendas_tef: vendasTef,
          total_sangrias: totalSangrias,
          total_suprimentos: totalSuprimentos,
          total_vendido: totalVendido,
          total_esperado: totalEsperado
        });
      });
    });
  });
}

function obterDetalhesCaixa(caixaId, callback) {
  db.get(`
    SELECT c.*, ua.nome AS aberto_por_nome, uf.nome AS fechado_por_nome
    FROM caixa c
    LEFT JOIN usuarios ua ON ua.id = c.aberto_por
    LEFT JOIN usuarios uf ON uf.id = c.fechado_por
    WHERE c.id = ?
  `, [caixaId], (err, caixa) => {
    if (err) return callback(err);
    if (!caixa) return callback(null, null);

    db.get(`SELECT id FROM caixa_sessoes WHERE caixa_id = ? ORDER BY id DESC LIMIT 1`, [caixaId], (sErr, sRow) => {
      if (sErr) return callback(sErr);

      if (!sRow) {
        // sem sessão: retornar sem movimentações/auditoria
        return callback(null, {
          caixa,
          fechamento: null,
          movimentacoes: [],
          auditoria: []
        });
      }

      const sessaoId = sRow.id;

      db.get(
        `SELECT * FROM caixa_fechamentos WHERE sessao_id = ? ORDER BY id DESC LIMIT 1`,
        [sessaoId],
        (fechErr, fechamento) => {
          if (fechErr) return callback(fechErr);

          db.all(`SELECT cm.*, u.nome as usuario_nome FROM caixa_movimentacoes cm LEFT JOIN usuarios u ON u.id = cm.usuario_id WHERE cm.sessao_id = ? ORDER BY cm.id DESC`, [sessaoId], (movErr, movimentacoes) => {
            if (movErr) return callback(movErr);

            db.all(`SELECT * FROM auditoria_caixa WHERE sessao_id = ? ORDER BY criado_em DESC`, [sessaoId], (auditErr, auditoria) => {
              if (auditErr) return callback(auditErr);

              callback(null, {
                caixa,
                fechamento: fechamento || null,
                movimentacoes: movimentacoes || [],
                auditoria: auditoria || []
              });
            });
          });
        }
      );
    });
  });
}

router.get('/fechamento/:caixa_id', (req, res) => {
  const caixaId = Number(req.params.caixa_id);

  obterDetalhesCaixa(caixaId, (err, detalhes) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!detalhes) return res.status(404).json({ error: 'Caixa não encontrado.' });

    res.json({
      caixa: detalhes.caixa,
      fechamento: detalhes.fechamento,
      movimentacoes: detalhes.movimentacoes,
      auditoria: detalhes.auditoria
    });
  });
});

router.get('/historico', (req, res) => {
  db.all(`
    SELECT c.*, ua.nome AS aberto_por_nome, uf.nome AS fechado_por_nome
    FROM caixa c
    LEFT JOIN usuarios ua ON ua.id = c.aberto_por
    LEFT JOIN usuarios uf ON uf.id = c.fechado_por
    ORDER BY c.id DESC
    LIMIT 100
  `, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

router.get('/movimentacoes/:caixa_id', validarCaixaAberto, (req, res) => {
  const sessaoId = req.caixaSessaoId;
  if (!sessaoId) return res.status(400).json({ error: 'Nenhuma sessão de caixa aberta para este terminal.' });

  db.all(`
      SELECT cm.*, u.nome as usuario_nome
      FROM caixa_movimentacoes cm
      LEFT JOIN usuarios u ON u.id = cm.usuario_id
      WHERE cm.sessao_id = ?
      ORDER BY cm.id DESC
    `, [sessaoId], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows || []);
    });
});

router.get('/por-data', (req, res) => {
  const data = req.query.data || hoje();
  const modoFiscal = req.query.modo_fiscal || '0';

  db.all(`
    SELECT c.*, ua.nome AS aberto_por_nome, uf.nome AS fechado_por_nome
    FROM caixa c
    LEFT JOIN usuarios ua ON ua.id = c.aberto_por
    LEFT JOIN usuarios uf ON uf.id = c.fechado_por
    WHERE c.data = ?
    ORDER BY c.id DESC
  `, [data], (err, caixas) => {
    if (err) {
      return res.status(500).json({
        sucesso: false,
        mensagem: err.message
      });
    }

    if (!caixas || caixas.length === 0) {
      return res.json({
        sucesso: true,
        data,
        caixas: []
      });
    }

    const resultado = [];
    let processados = 0;

    caixas.forEach((caixa) => {
      // Resolver última sessão e calcular resumo por sessão
      db.get(`SELECT id FROM caixa_sessoes WHERE caixa_id = ? ORDER BY id DESC LIMIT 1`, [caixa.id], (sErr, sRow) => {
        if (sErr) {
          return res.status(500).json({ sucesso: false, mensagem: sErr.message });
        }

        const sessaoId = sRow ? sRow.id : null;

        calcularResumoCaixa(caixa, { sessaoId, modo_fiscal: modoFiscal }, (calcErr, resumo) => {
          if (calcErr) {
            return res.status(500).json({ sucesso: false, mensagem: calcErr.message });
          }

          if (!sessaoId) {
            resultado.push({ caixa, resumo, movimentacoes: [] });
            processados++;
            if (processados === caixas.length) {
              res.json({ sucesso: true, data, caixas: resultado });
            }
            return;
          }

          db.all(`
            SELECT cm.*, u.nome as usuario_nome
            FROM caixa_movimentacoes cm
            LEFT JOIN usuarios u ON u.id = cm.usuario_id
            WHERE cm.sessao_id = ?
            ORDER BY cm.id DESC
          `, [sessaoId], (movErr, movimentacoes) => {
            if (movErr) return res.status(500).json({ sucesso: false, mensagem: movErr.message });

            resultado.push({ caixa, resumo, movimentacoes: movimentacoes || [] });

            processados++;

            if (processados === caixas.length) {
              res.json({ sucesso: true, data, caixas: resultado });
            }
          });
        });
      });
    });
  });
});

module.exports = router;