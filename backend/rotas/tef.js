const express = require('express');
const router = express.Router();
const tefService = require('../services/tef');
const tefConfiguracaoRoutes = require('./tefConfiguracao');
const tefConciliacaoRoutes = require('./tefConciliacao');
const db = require('../database');
const sdkDetector = require('../services/tef/sdkDetector');
const tefConciliacaoService = require('../services/tef/tefConciliacaoService');
const tefDiagnosticoService = require('../services/tef/tefDiagnosticoService');
const tefEvents = require('../services/tef/tefEvents');
const tefContrato = require('../services/tef/tefContrato');
const { verificarToken } = require('./auth');
const tefConfigService = require('../services/tef/tefConfigService');
const tefFluxoPagamento = require('../services/tef/tefFluxoPagamento');
const configService = require('../services/configuracaoService');

router.use(tefConfiguracaoRoutes);
router.use(tefConciliacaoRoutes);

/** Estado TEF para o PDV (operador autenticado, sem dados sensíveis). */
router.get('/fluxo-pdv', verificarToken, async (req, res) => {
  try {
    const tefConfig = await tefConfigService.obterConfiguracao();
    res.json({
      tefHabilitado: tefFluxoPagamento.parseTefHabilitado(tefConfig.tefHabilitado),
      pixHabilitado: tefFluxoPagamento.parseTefHabilitado(tefConfig.pix),
      modoConfirmacaoFiscal: configService.getModoConfirmacaoFiscal()
    });
  } catch (error) {
    console.error('Erro ao consultar fluxo TEF do PDV:', error);
    res.status(500).json({ error: 'Erro ao consultar configuração TEF do PDV.' });
  }
});

router.post('/pagar', async (req, res) => {
  try {
    const {
      venda_id,
      tipo,
      valor,
      parcelas,
      idempotency_key
    } = req.body;

    if (!tipo) {
      return res.status(400).json({ error: 'Tipo de pagamento TEF não informado.' });
    }

    if (!valor || Number(valor) <= 0) {
      return res.status(400).json({ error: 'Valor TEF inválido.' });
    }

    const resultado = await tefService.iniciarPagamento({
      venda_id: venda_id || null,
      tipo,
      valor: Number(valor),
      parcelas: Number(parcelas || 1),
      idempotency_key: idempotency_key || null
    });

    if (resultado.codigo === 'TRANSACAO_DUPLICADA' && !resultado.aprovado && resultado.sucesso !== true) {
      return res.status(409).json(resultado);
    }

    if (resultado.sucesso === false && resultado.codigo && !tefContrato.estaAprovado(resultado)) {
      return res.status(422).json(resultado);
    }

    res.json(resultado);
  } catch (error) {
    console.error('Erro TEF:', error);
    res.status(500).json({
      error: error.message || 'Erro ao processar TEF.'
    });
  }
});

router.get('/transacao/:id', (req, res) => {
  const id = Number(req.params.id);

  db.get(`
    SELECT *
    FROM tef_transacoes
    WHERE id = ?
  `, [id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    if (!row) {
      return res.status(404).json({ error: 'Transação TEF não encontrada.' });
    }

    res.json(row);
  });
});

router.get('/venda/:vendaId/comprovantes', (req, res) => {
  const vendaId = Number(req.params.vendaId);

  db.all(`
    SELECT
      id,
      venda_id,
      forma_pagamento,
      valor,
      tef_transacao_id,
      tef_nsu,
      tef_autorizacao,
      tef_bandeira,
      tef_adquirente,
      tef_comprovante_cliente,
      tef_comprovante_estabelecimento
    FROM venda_pagamentos
    WHERE venda_id = ?
      AND tef_transacao_id IS NOT NULL
  `, [vendaId], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    res.json(rows || []);
  });
});

router.get('/venda/:vendaId/resumo', (req, res) => {
  const vendaId = Number(req.params.vendaId);

  db.get(`
    SELECT
      v.id AS venda_id,
      v.total AS venda_total,
      v.forma_pagamento AS venda_forma_pagamento,
      v.data_venda,

      n.numero AS nfce_numero,
      n.chave_acesso AS nfce_chave,
      n.status AS nfce_status,
      n.protocolo AS nfce_protocolo,

      vp.tef_transacao_id,
      vp.tef_nsu,
      vp.tef_autorizacao,
      vp.tef_bandeira,
      vp.tef_adquirente

    FROM vendas v

    LEFT JOIN nfce_notas n
      ON n.venda_id = v.id

    LEFT JOIN venda_pagamentos vp
      ON vp.venda_id = v.id
      AND vp.tef_transacao_id IS NOT NULL

    WHERE v.id = ?

    ORDER BY n.id DESC
    LIMIT 1
  `, [vendaId], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    if (!row) {
      return res.status(404).json({ error: 'Venda não encontrada.' });
    }

    res.json(row);
  });
});

router.post('/cancelar', async (req, res) => {
  try {
    const { transacao_id, motivo } = req.body;

    if (!transacao_id) {
      return res.status(400).json({ error: 'transacao_id é obrigatório.' });
    }

    const resultado = await tefService.cancelarPagamento(
      Number(transacao_id),
      motivo || 'Cancelamento da venda'
    );

    res.json(resultado);

  } catch (error) {
    console.error('Erro ao cancelar TEF:', error);
    res.status(500).json({
      error: error.message || 'Erro ao cancelar TEF.'
    });
  }
});

router.get('/transacoes/recentes', (req, res) => {
  const limit = Number(req.query.limit) || 20;
  const apenasIntegradas = req.query.apenas_integradas === '1' || req.query.apenas_integradas === 'true';

  const sql = apenasIntegradas
    ? `SELECT * FROM tef_transacoes WHERE venda_id IS NOT NULL ORDER BY criado_em DESC LIMIT ?`
    : `SELECT * FROM tef_transacoes ORDER BY criado_em DESC LIMIT ?`;

  db.all(sql, [limit], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    res.json(rows || []);
  });
});

router.get('/pinpads-catalogo', async (req, res) => {
  try {
    const pinpadCatalogService = require('../services/tef/pinpadCatalogService');
    const pinpads = await pinpadCatalogService.listarCatalogoAtivo();
    res.json({ sucesso: true, pinpads });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

router.get('/diagnostico-sdk', async (req, res) => {
  try {
    const sdks = sdkDetector.localizarSDKs();

    return res.json({
      sucesso: true,
      encontrados: sdks
    });

  } catch (error) {
    return res.status(500).json({
      sucesso: false,
      erro: error.message
    });
  }
});

router.get('/diagnostico', async (req, res) => {
  try {
    const sdks = sdkDetector.localizarSDKs();

    res.json({
      sucesso: true,
      sdkEncontrado: sdks.length > 0,
      sdks
    });
  } catch (error) {
    res.status(500).json({
      sucesso: false,
      erro: error.message
    });
  }
});

router.get('/diagnostico-completo', async (req, res) => {
  try {
    const relatorio = await tefDiagnosticoService.executarDiagnosticoCompleto();
    res.json(relatorio);
  } catch (error) {
    console.error('Erro diagnóstico TEF completo:', error);
    res.status(500).json({
      sucesso: false,
      erro: error.message
    });
  }
});

router.get('/eventos', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const enviar = (evento, payload) => {
    res.write(`event: ${evento}\ndata: ${JSON.stringify(payload)}\n\n`);
  };

  const onPinpad = (payload) => enviar('pinpad', payload);
  const onEstado = (payload) => enviar('estado', payload);
  const onErro = (payload) => enviar('erro', payload);

  tefEvents.onPinpad(onPinpad);
  tefEvents.onEstado(onEstado);
  tefEvents.onErro(onErro);

  enviar('conectado', { mensagem: 'Stream de eventos TEF ativo', timestamp: new Date().toISOString() });

  req.on('close', () => {
    tefEvents.off('pinpad', onPinpad);
    tefEvents.off('estado', onEstado);
    tefEvents.off('erro', onErro);
  });
});

router.get('/transacoes-pendentes', async (req, res) => {
  try {
    db.all(`
      SELECT id, venda_id, tipo, valor, status, provedor, criado_em
      FROM tef_transacoes
      WHERE status = 'pendente'
      ORDER BY criado_em DESC
    `, (err, rows) => {
      if (err) {
        return res.status(500).json({
          sucesso: false,
          erro: err.message
        });
      }

      res.json({
        sucesso: true,
        quantidade: rows.length,
        transacoes: rows || []
      });
    });
  } catch (error) {
    res.status(500).json({
      sucesso: false,
      erro: error.message
    });
  }
});

router.post('/reconciliar-pendentes', async (req, res) => {
  try {
    const tefManager = require('../services/tef/TefManager');

    db.all(`
      SELECT id, venda_id, tipo, valor, status, provedor, criado_em
      FROM tef_transacoes
      WHERE status = 'pendente'
      ORDER BY criado_em DESC
    `, async (err, rows) => {
      if (err) {
        return res.status(500).json({
          sucesso: false,
          erro: err.message
        });
      }

      if (!rows || rows.length === 0) {
        return res.json({
          sucesso: true,
          mensagem: 'Nenhuma transação pendente encontrada',
          reconciliadas: 0
        });
      }

      let reconciliadas = 0;
      let falhas = 0;

      for (const transacao of rows) {
        try {
          const resultado = await tefManager.consultar(transacao.id);

          if (resultado && resultado.status && resultado.status !== 'pendente') {
            await new Promise((resolve, reject) => {
              db.run(`
                UPDATE tef_transacoes
                SET status = ?, nsu = COALESCE(?, nsu), autorizacao = COALESCE(?, autorizacao),
                    atualizado_em = datetime('now')
                WHERE id = ?
              `, [resultado.status, resultado.nsu || null, resultado.autorizacao || null, transacao.id], (updateErr) => {
                if (updateErr) return reject(updateErr);
                resolve();
              });
            });
            reconciliadas++;
          } else {
            falhas++;
          }
        } catch (error) {
          console.error(`Erro ao reconciliar transação ${transacao.id}:`, error);
          falhas++;
        }
      }

      res.json({
        sucesso: true,
        mensagem: 'Reconciliação concluída',
        total: rows.length,
        reconciliadas,
        falhas
      });
    });
  } catch (error) {
    res.status(500).json({
      sucesso: false,
      erro: error.message
    });
  }
});

router.get('/monitor-status', async (req, res) => {
  try {
    const tefMonitorService = require('../services/tef/tefMonitorService');
    
    // Verificar se o monitor está respondendo
    const status = await tefMonitorService.obterStatusMonitor();
    
    res.json({
      sucesso: true,
      monitor_ativo: true,
      status
    });
  } catch (error) {
    console.error('Erro ao verificar status do monitor:', error);
    res.json({
      sucesso: false,
      monitor_ativo: false,
      erro: error.message
    });
  }
});

router.get('/venda-integrada', async (req, res) => {
  try {
    // Verificar se há vínculo entre venda_pagamentos e tef_transacoes
    db.get(`
      SELECT COUNT(*) as total
      FROM venda_pagamentos vp
      INNER JOIN tef_transacoes tt ON vp.tef_transacao_id = tt.id
      WHERE vp.tef_transacao_id IS NOT NULL
    `, [], (err, row) => {
      if (err) {
        return res.status(500).json({
          sucesso: false,
          erro: err.message
        });
      }

      const integrada = (row?.total || 0) > 0;
      
      res.json({
        sucesso: true,
        integrada,
        total_vinculos: row?.total || 0
      });
    });
  } catch (error) {
    res.status(500).json({
      sucesso: false,
      erro: error.message
    });
  }
});

router.get('/conciliacao', async (req, res) => {
  try {
    const { data_inicio, data_fim } = req.query;
    
    const dataInicio = data_inicio || new Date().toISOString().split('T')[0];
    const dataFim = data_fim || new Date().toISOString().split('T')[0];
    
    const resultado = await tefConciliacaoService.executarConciliacao(dataInicio, dataFim);
    
    res.json(resultado);
  } catch (error) {
    console.error('Erro ao executar conciliação TEF:', error);
    res.status(500).json({
      sucesso: false,
      erro: error.message
    });
  }
});

router.post('/transacao/:id/reimprimir', async (req, res) => {
  try {
    const transacaoId = Number(req.params.id);
    const { tipo } = req.body;

    if (!tipo || !['cliente', 'loja'].includes(tipo)) {
      return res.status(400).json({ error: 'Tipo inválido. Use "cliente" ou "loja".' });
    }

    const resultado = await tefService.reimprimirPagamento(transacaoId, tipo);

    if (!resultado.sucesso) {
      return res.status(400).json({
        sucesso: false,
        error: resultado.mensagem || 'Comprovante não disponível.'
      });
    }

    res.json({
      sucesso: true,
      tipo,
      comprovante: resultado.comprovante,
      mensagem: resultado.mensagem
    });
  } catch (error) {
    console.error('Erro ao reimprimir comprovante:', error);
    res.status(500).json({
      error: error.message || 'Erro ao reimprimir comprovante.'
    });
  }
});

module.exports = router;