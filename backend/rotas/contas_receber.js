// Rotas para contas a receber (parcelas de vendas a prazo)
const express = require('express');
const router = express.Router();
const db = require('../database');
const moment = require('moment');
const { gravarAuditoria } = require('../services/auditoria');
const { validarCaixaAberto } = require('../middleware/validarCaixaAberto');

router.get('/em-aberto', (req, res) => {
  db.all(`
    SELECT cr.*, c.nome as cliente_nome, v.codigo as venda_codigo
    FROM contas_receber cr
    LEFT JOIN clientes c ON cr.cliente_id = c.id
    LEFT JOIN vendas v ON cr.venda_id = v.id
    WHERE cr.status = 'aberto'
    ORDER BY cr.data_vencimento ASC
  `, (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

router.get('/vencidas', (req, res) => {
  const hoje = moment().format('YYYY-MM-DD');
  db.all(`
    SELECT cr.*, c.nome as cliente_nome, v.codigo as venda_codigo
    FROM contas_receber cr
    LEFT JOIN clientes c ON cr.cliente_id = c.id
    LEFT JOIN vendas v ON cr.venda_id = v.id
    WHERE cr.status = 'aberto' AND cr.data_vencimento < ?
    ORDER BY cr.data_vencimento ASC
  `, [hoje], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

router.get('/historico/:cliente_id', (req, res) => {
  const { cliente_id } = req.params;
  db.all(`
    SELECT cr.*, v.codigo as venda_codigo
    FROM contas_receber cr
    LEFT JOIN vendas v ON cr.venda_id = v.id
    WHERE cr.cliente_id = ?
    ORDER BY cr.data_vencimento DESC
  `, [cliente_id], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

router.get('/verificar/:cliente_id', (req, res) => {
  const { cliente_id } = req.params;
  const hoje = moment().format('YYYY-MM-DD');
  db.get(`
    SELECT
      SUM(CASE WHEN status = 'aberto' THEN valor_restante ELSE 0 END) as total_em_aberto,
      COUNT(CASE WHEN status = 'aberto' AND data_vencimento < ? THEN 1 END) as parcelas_vencidas
    FROM contas_receber
    WHERE cliente_id = ?
  `, [hoje, cliente_id], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(row);
  });
});

router.post('/pagar/:id', validarCaixaAberto, (req, res) => {
  const { id } = req.params;
  const { valor_pago, data_pagamento, forma_pagamento } = req.body;
  const valorNum = Number(valor_pago);
  const data = data_pagamento || moment().format('YYYY-MM-DD');

  if (Number.isNaN(valorNum) || valorNum <= 0) {
    res.status(400).json({ error: 'Informe um valor pago válido.' });
    return;
  }

  db.get(
    `
      SELECT cr.*, c.nome as cliente_nome, v.codigo as venda_codigo
      FROM contas_receber cr
      LEFT JOIN clientes c ON cr.cliente_id = c.id
      LEFT JOIN vendas v ON cr.venda_id = v.id
      WHERE cr.id = ?
    `,
    [id],
    (err, conta) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      if (!conta) {
        res.status(404).json({ error: 'Parcela não encontrada.' });
        return;
      }
      if (conta.status !== 'aberto') {
        res.status(400).json({ error: 'Apenas parcelas em aberto podem receber pagamento.' });
        return;
      }

      const restante = Number(conta.valor_restante);
      if (valorNum > restante) {
        res.status(400).json({ error: 'O valor pago não pode ser maior que o valor restante.' });
        return;
      }

      db.serialize(() => {
        db.run('BEGIN IMMEDIATE');

        db.run(
          `
            UPDATE contas_receber
            SET
              valor_restante = valor_restante - ?,
              status = CASE WHEN (valor_restante - ?) <= 0 THEN 'pago' ELSE 'aberto' END,
              data_pagamento = ?
            WHERE id = ?
          `,
          [valorNum, valorNum, data, id],
          function(upErr) {
            if (upErr) {
              db.run('ROLLBACK');
              res.status(500).json({ error: upErr.message });
              return;
            }

            db.run(
              `
                UPDATE financeiro
                SET data_movimento = ?, vencimento = ?, status = 'recebido', baixado_em = ?
                WHERE referencia_id = ? AND referencia_tipo = 'venda' AND status = 'pendente'
              `,
              [data, data, data, conta.venda_id],
              () => {
                db.run(
                  `
                    INSERT INTO financeiro (tipo, descricao, valor, data_movimento, categoria, forma_pagamento, referencia_id, referencia_tipo, status, baixado_em)
                    VALUES ('receita', ?, ?, ?, 'contas_receber', ?, ?, 'conta_receber', 'recebido', ?)
                  `,
                  [
                    `Recebimento parcela ${conta.numero_parcela}/${conta.total_parcelas} - Venda ${conta.venda_codigo || conta.venda_id || '-'}`,
                    valorNum,
                    data,
                    forma_pagamento || null,
                    id,
                    data
                  ],
                  (finErr) => {
                    if (finErr) {
                      db.run('ROLLBACK');
                      res.status(500).json({ error: finErr.message });
                      return;
                    }

                    const finalizar = () => {
                      db.run('COMMIT');

                      gravarAuditoria({
                        usuario_id: req.operadorId || req.user?.id || null,
                        usuario_nome: req.user?.nome || req.user?.username || null,
                        modulo: 'contas_receber',
                        acao: 'pagar_parcela',
                        referencia_tipo: 'conta_receber',
                        referencia_id: id,
                        detalhes: {
                          valor_pago: valorNum,
                          forma_pagamento: forma_pagamento || null,
                          sessao_id: req.caixaSessaoId || null
                        },
                        ip_requisicao: req.ip || null
                      }).catch((auditErr) => console.error('Erro ao gravar auditoria de pagamento de parcela:', auditErr));

                      res.json({
                        message: 'Pagamento registrado',
                        id,
                        valor_pago: valorNum,
                        valor_restante_anterior: restante,
                        valor_restante_novo: restante - valorNum
                      });
                    };

                    if (conta.cliente_id) {
                      db.run(
                        `
                          UPDATE clientes
                          SET credito_atual = CASE
                            WHEN (credito_atual - ?) < 0 THEN 0
                            ELSE credito_atual - ?
                          END
                          WHERE id = ?
                        `,
                        [valorNum, valorNum, conta.cliente_id],
                        (credErr) => {
                          if (credErr) {
                            db.run('ROLLBACK');
                            res.status(500).json({ error: credErr.message });
                            return;
                          }
                          finalizar();
                        }
                      );
                    } else {
                      finalizar();
                    }
                  }
                );
              }
            );
          }
        );
      });
    }
  );
});

module.exports = router;
