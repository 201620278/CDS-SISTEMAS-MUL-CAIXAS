  const express = require('express');
  const router = express.Router();
  const db = require('../database');
  const moment = require('moment');
  const { validarCaixaAberto } = require('../middleware/validarCaixaAberto');
  const configService = require('../services/configuracaoService');
  const { emitirPorVendaId } = require('../services/fiscal/emissor');
  const tefManager = require('../services/tef/TefManager');
  const tefContrato = require('../services/tef/tefContrato');
  const tefFluxoPagamento = require('../services/tef/tefFluxoPagamento');
  const tefConfigService = require('../services/tef/tefConfigService');
  const lotesService = require('../services/lotesService');
  const {
    normalizarItemFiscal,
    separarItensFiscalNaoFiscal,
    separarItensDistribuidos
  } = require('../services/fiscalNaoFiscalService');
  const { distribuirPagamentos } = require('../services/DistribuidorPagamento');
  const {
    distribuirQuantidadeVenda
  } = require('../services/distribuidorEstoqueVenda');
  const { cancelarFiscal } = require('../services/tef/ReversaoFiscal');
  const { resolverQuantidadesVendaItem, calcularDevolucaoVendaFiscalPrimeiro } = require('../services/estoqueFiscalService');
  const cancelarNfce = require('../services/fiscal/cancelarNfce');
  const {
    FILTRO_VENDA_VALIDA,
    isModoFiscalRelatorio,
    getExprValorVenda,
    getExprValorItem,
    getExprValorItemFiscal,
    getExprValorItemNaoFiscal,
    getExprQuantidadeItem,
    getExprQuantidadeItemFiscal,
    getExprQuantidadeItemNaoFiscal,
    getFiltroItensFiscal
  } = require('../services/reportFiscalHelpers');

  function extrairTagXmlCancelamento(xml, tag) {
    const regex = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i');
    const match = String(xml || '').match(regex);
    return match ? match[1] : null;
  }

  function extrairCancelamentoSefaz(xml) {
    const texto = String(xml || '');
    const blocoEventoMatch = texto.match(/<retEvento[\s\S]*?<\/retEvento>/i);
    const blocoEvento = blocoEventoMatch ? blocoEventoMatch[0] : texto;

    return {
      cStatEvento: extrairTagXmlCancelamento(blocoEvento, 'cStat'),
      xMotivoEvento: extrairTagXmlCancelamento(blocoEvento, 'xMotivo'),
      protocoloCancelamento: extrairTagXmlCancelamento(blocoEvento, 'nProt'),
      dataCancelamento: extrairTagXmlCancelamento(blocoEvento, 'dhRegEvento')
    };
  }

  function devolverSaldosDistribuidos(produtoId, quantidadeFiscal, quantidadeNaoFiscal, callback) {
    const qtdFiscal = Number(quantidadeFiscal || 0);
    const qtdNaoFiscal = Number(quantidadeNaoFiscal || 0);

    if (qtdFiscal <= 0 && qtdNaoFiscal <= 0) {
      return callback(null);
    }

    db.run(`
      UPDATE produtos
      SET
        saldo_fiscal = saldo_fiscal + ?,
        saldo_nao_fiscal = saldo_nao_fiscal + ?,
        estoque_atual = (saldo_fiscal + ?) + (saldo_nao_fiscal + ?),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [qtdFiscal, qtdNaoFiscal, qtdFiscal, qtdNaoFiscal, produtoId], callback);
  }

  function devolverEstoqueItemVenda(item, callback) {
    const qtds = resolverQuantidadesVendaItem(item);

    db.get(`
      SELECT
        COALESCE(SUM(quantidade_fiscal), 0) AS devolvido_fiscal,
        COALESCE(SUM(quantidade_nao_fiscal), 0) AS devolvido_nao_fiscal
      FROM vendas_devolucoes
      WHERE venda_item_id = ?
    `, [item.id], (devErr, devRow) => {
      const qtdFiscal = devErr
        ? Number(qtds.quantidade_fiscal || 0)
        : Math.max(0, Number(qtds.quantidade_fiscal || 0) - Number(devRow?.devolvido_fiscal || 0));
      const qtdNaoFiscal = devErr
        ? Number(qtds.quantidade_nao_fiscal || 0)
        : Math.max(0, Number(qtds.quantidade_nao_fiscal || 0) - Number(devRow?.devolvido_nao_fiscal || 0));

      if (qtdFiscal <= 0 && qtdNaoFiscal <= 0) {
        return callback(null);
      }

      lotesService.produtoControlaValidade(item.produto_id, (controlErr, controlaValidade) => {
        if (controlErr) return callback(controlErr);

        const aplicarSaldos = (saldoErr) => {
          if (saldoErr) return callback(saldoErr);
          devolverSaldosDistribuidos(
            item.produto_id,
            qtdFiscal,
            qtdNaoFiscal,
            callback
          );
        };

        if (controlaValidade) {
          lotesService.restaurarLotesVenda(item.id, aplicarSaldos);
          return;
        }

        aplicarSaldos(null);
      });
    });
  }

  function devolverEstoqueItensVenda(itens, callback) {
    if (!itens || itens.length === 0) {
      return callback(null);
    }

    let indice = 0;

    function processarProximo() {
      if (indice >= itens.length) {
        return callback(null);
      }

      const item = itens[indice];
      indice += 1;

      devolverEstoqueItemVenda(item, (err) => {
        if (err) return callback(err);
        processarProximo();
      });
    }

    processarProximo();
  }

  function cancelarRecebimentosVenda(vendaId, callback) {
    db.run(`
      UPDATE venda_recebimentos
      SET status = 'cancelado'
      WHERE venda_id = ?
        AND tipo_recebimento = 'fiscal'
        AND COALESCE(status, 'aprovado') != 'cancelado'
    `, [vendaId], (errFiscal) => {
      if (errFiscal) return callback(errFiscal);

      db.run(`
        UPDATE venda_recebimentos
        SET status = 'cancelado'
        WHERE venda_id = ?
          AND tipo_recebimento = 'nao_fiscal'
          AND COALESCE(status, 'aprovado') != 'cancelado'
      `, [vendaId], callback);
    });
  }

  function buscarNfceAutorizadaVenda(vendaId, callback) {
    db.get(`
      SELECT id, status
      FROM nfce_notas
      WHERE venda_id = ?
        AND status IN ('autorizada', 'cancelamento_rejeitado')
        AND (
          (chave_acesso IS NOT NULL AND chave_acesso <> '')
          OR (xml_retorno IS NOT NULL AND xml_retorno LIKE '%<cStat>100</cStat>%')
        )
      ORDER BY id DESC
      LIMIT 1
    `, [vendaId], callback);
  }

  async function cancelarNfceAutorizadaVenda(vendaId, justificativa) {
    const cancelamento = await cancelarNfce(vendaId, justificativa.trim());
    const retornoTexto = typeof cancelamento.sefaz === 'string'
      ? cancelamento.sefaz
      : JSON.stringify(cancelamento.sefaz);
    const dadosCancelamento = extrairCancelamentoSefaz(retornoTexto);
    const canceladoComSucesso =
      String(dadosCancelamento.cStatEvento) === '135' ||
      String(dadosCancelamento.cStatEvento) === '136' ||
      String(dadosCancelamento.cStatEvento) === '155';

    if (!canceladoComSucesso) {
      throw new Error(dadosCancelamento.xMotivoEvento || 'Cancelamento de NFC-e rejeitado pela SEFAZ.');
    }

    await new Promise((resolve, reject) => {
      const resumoCancelamento = `
STATUS CANCELAMENTO: cancelada
cStatEvento: ${dadosCancelamento.cStatEvento || ''}
xMotivoEvento: ${dadosCancelamento.xMotivoEvento || ''}
protocoloCancelamento: ${dadosCancelamento.protocoloCancelamento || ''}
dataCancelamento: ${dadosCancelamento.dataCancelamento || ''}
justificativa: ${justificativa.trim()}
`;

      db.run(`
        UPDATE nfce_notas
        SET status = 'cancelada',
            xml_retorno = COALESCE(xml_retorno, '') || char(10) || ? || char(10) || ?,
            updated_at = datetime('now', 'localtime')
        WHERE id = ?
      `, [resumoCancelamento, retornoTexto, cancelamento.notaId], (updErr) => {
        if (updErr) return reject(updErr);
        resolve();
      });
    });
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

  // Função auxiliar para reduzir estoque com FEFO
  function reduzirEstoqueComFEFO(vendaItemId, produtoId, quantidade, itemFiscal, callback) {
    lotesService.produtoControlaValidade(produtoId, (err, controlaValidade) => {
      if (err) return callback(err);

      if (!controlaValidade) {
        // Produto não controla validade - usar estoque consolidado normal
        if (Number(itemFiscal) === 1) {
          db.run(`
            UPDATE produtos
            SET
              saldo_fiscal = saldo_fiscal - ?,
              estoque_atual = (saldo_fiscal - ?) + saldo_nao_fiscal
            WHERE id = ?
          `, [quantidade, quantidade, produtoId], callback);
        } else {
          db.run(`
            UPDATE produtos
            SET
              saldo_nao_fiscal = saldo_nao_fiscal - ?,
              estoque_atual = saldo_fiscal + (saldo_nao_fiscal - ?)
            WHERE id = ?
          `, [quantidade, quantidade, produtoId], callback);
        }
        return;
      }

      // Produto controla validade - usar FEFO
      lotesService.consumirLotesFEFO(produtoId, quantidade, (consumoErr, consumoLotes) => {
        if (consumoErr) return callback(consumoErr);

        // Registrar quais lotes foram consumidos
        lotesService.registrarConsumoVenda(vendaItemId, consumoLotes, (registroErr) => {
          if (registroErr) return callback(registroErr);

          // Atualizar estoque consolidado e saldos fiscal/não fiscal
          if (Number(itemFiscal) === 1) {
            db.run(`
              UPDATE produtos
              SET
                saldo_fiscal = saldo_fiscal - ?,
                estoque_atual = (saldo_fiscal - ?) + saldo_nao_fiscal
              WHERE id = ?
            `, [quantidade, quantidade, produtoId], callback);
          } else {
            db.run(`
              UPDATE produtos
              SET
                saldo_nao_fiscal = saldo_nao_fiscal - ?,
                estoque_atual = saldo_fiscal + (saldo_nao_fiscal - ?)
              WHERE id = ?
            `, [quantidade, quantidade, produtoId], callback);
          }
        });
      });
    });
  }

  function reduzirEstoqueDistribuido(
    vendaItemId,
    produtoId,
    quantidadeFiscal,
    quantidadeNaoFiscal,
    callback
  ) {

    const executarNaoFiscal = () => {

      if (Number(quantidadeNaoFiscal || 0) <= 0) {
        return callback(null);
      }

      reduzirEstoqueComFEFO(
        vendaItemId,
        produtoId,
        quantidadeNaoFiscal,
        0,
        callback
      );

    };

    if (Number(quantidadeFiscal || 0) <= 0) {
      return executarNaoFiscal();
    }

    reduzirEstoqueComFEFO(
      vendaItemId,
      produtoId,
      quantidadeFiscal,
      1,
      (err) => {

        if (err) {
          return callback(err);
        }

        executarNaoFiscal();

      }
    );

  }

  function atualizarStatusPagamentoVenda(vendaId, status, tefTransacaoId) {
    if (tefTransacaoId) {
      db.run(
        `UPDATE vendas SET status_pagamento = ?, tef_transacao_id = ? WHERE id = ?`,
        [status, tefTransacaoId, vendaId]
      );
    } else {
      db.run(
        `UPDATE vendas SET status_pagamento = ? WHERE id = ?`,
        [status, vendaId]
      );
    }
  }

  // Função para gravar recebimentos
  function flattenRecebimentos(recebimentos) {
    if (!Array.isArray(recebimentos)) {
      return [];
    }

    return recebimentos.flatMap((item) => (Array.isArray(item) ? item : [item]));
  }

  function gravarRecebimentos(vendaId, recebimentos, callback) {
    const lista = flattenRecebimentos(recebimentos);
    let index = 0;

    function next() {
      if (index >= lista.length) {
        callback(null);
        return;
      }

      const r = lista[index++];

      db.run(`
        INSERT INTO venda_recebimentos
        (
          venda_id,
          tipo_recebimento,
          forma_pagamento,
          valor,
          tef_transacao_id,
          nsu,
          autorizacao,
          status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        vendaId,
        r.tipo_recebimento,
        r.forma_pagamento,
        Number(r.valor || 0),
        r.tef_transacao_id || null,
        r.nsu || null,
        r.autorizacao || null,
        'aprovado'
      ], next);
    }

    next();
  }

  // TEF exclusivo para recebimentos fiscais (conta empresa)
  async function processarPagamentosTef(recebimentos) {
    let tefHabilitado = false;

    try {
      const tefConfig = await tefConfigService.obterConfiguracao();
      tefHabilitado = tefFluxoPagamento.parseTefHabilitado(tefConfig.tefHabilitado);
    } catch (error) {
      console.error('Erro ao verificar configuração TEF:', error);
      tefHabilitado = false;
    }

    if (!tefHabilitado) {
      console.log('TEF desabilitado, pulando autorização de pagamentos TEF');
      return { sucesso: true, transacoes: [] };
    }

    const pagamentosTef = recebimentos.filter((p) => {
      const forma = String(p.forma_pagamento || '').toLowerCase();
      return forma === 'cartao_debito'
        || forma === 'cartao_credito'
        || forma === 'cartao'
        || forma === 'pix'
        || forma === 'pix_tef';
    });

    if (pagamentosTef.length === 0) {
      return { sucesso: true, transacoes: [] };
    }

    const transacoesAutorizadas = [];

    for (const pagamento of pagamentosTef) {
      if (pagamento.tef_transacao_id) {
        transacoesAutorizadas.push(pagamento.tef_transacao_id);
        continue;
      }

      try {
        const tefFluxoPagamento = require('../services/tef/tefFluxoPagamento');
        const tipoTef = tefFluxoPagamento.normalizarTipoTef(pagamento.forma_pagamento);
        const retornoTEF = await tefManager.autorizar({
          venda_id: null,
          tipo: tipoTef,
          valor: pagamento.valor,
          parcelas: 1
        });

        if (!tefContrato.estaAprovado(retornoTEF)) {
          // Cancelar transações anteriores
          for (const transacaoId of transacoesAutorizadas) {
            try {
              await tefManager.cancelar(transacaoId, 'Pagamento fiscal não aprovado');
            } catch (cancelError) {
              console.error(`Erro ao cancelar transação TEF ${transacaoId}:`, cancelError);
            }
          }
          return { sucesso: false, erro: retornoTEF };
        }

        if (retornoTEF.transacao_id) {
          transacoesAutorizadas.push(retornoTEF.transacao_id);
          pagamento.tef_transacao_id = retornoTEF.transacao_id;
          pagamento.nsu = retornoTEF.nsu;
          pagamento.autorizacao = retornoTEF.autorizacao;
        }
      } catch (error) {
        console.error('Erro ao autorizar pagamento TEF fiscal:', error);
        // Cancelar transações anteriores
        for (const transacaoId of transacoesAutorizadas) {
          try {
            await tefManager.cancelar(transacaoId, 'Erro no pagamento fiscal');
          } catch (cancelError) {
            console.error(`Erro ao cancelar transação TEF ${transacaoId}:`, cancelError);
          }
        }
        return { sucesso: false, erro: error.message };
      }
    }

    return { sucesso: true, transacoes: transacoesAutorizadas };
  }

  function montarDistribuicaoPagamento(pagamentosEntrada, totalFiscal, totalNaoFiscal, pagamentosJaProcessados) {
    if (
      pagamentosJaProcessados &&
      Array.isArray(pagamentosEntrada) &&
      pagamentosEntrada.some((p) => p.tipo_recebimento)
    ) {
      return {
        recebimentosFiscal: pagamentosEntrada.filter((p) => p.tipo_recebimento === 'fiscal'),
        recebimentosNaoFiscal: pagamentosEntrada.filter((p) => p.tipo_recebimento === 'nao_fiscal'),
        saldoFiscal: 0,
        saldoNaoFiscal: 0
      };
    }

    return distribuirPagamentos(pagamentosEntrada, totalFiscal, totalNaoFiscal);
  }

  function isConfirmacaoFiscalManual(confirmacaoManualFlag) {
    return tefFluxoPagamento.isConfirmacaoFiscalManualFlag(
      confirmacaoManualFlag,
      configService.getModoConfirmacaoFiscal()
    );
  }

  async function processarTefRecebimentosFiscais(recebimentos, pagamentosJaProcessados, confirmacaoManualFlag) {
    let tefHabilitado = false;
    try {
      const tefConfig = await tefConfigService.obterConfiguracao();
      tefHabilitado = tefFluxoPagamento.parseTefHabilitado(tefConfig.tefHabilitado);
    } catch (error) {
      console.error('Erro ao verificar configuração TEF:', error);
    }

    if (tefFluxoPagamento.devePularAutorizacaoTefBackend({
      pagamentosJaProcessados,
      confirmacaoManualFlag,
      tefHabilitado,
      modoGlobalConfirmacaoFiscal: configService.getModoConfirmacaoFiscal()
    })) {
      const transacoes = (recebimentos || [])
        .map((p) => p.tef_transacao_id)
        .filter(Boolean);
      return { sucesso: true, transacoes };
    }

    return processarPagamentosTef(recebimentos);
  }

  function resolverStatusPagamentoVenda({
    totalFiscal,
    totalNaoFiscal,
    resultadoTefFiscal,
    recebimentosNaoFiscal
  }) {
    const temNaoFiscal = Number(totalNaoFiscal) > 0;
    const temFiscal = Number(totalFiscal) > 0;
    const fiscalOk = resultadoTefFiscal?.sucesso === true;
    const tefFiscalId = resultadoTefFiscal?.transacoes?.[0] || null;
    const recebimentosNf = Array.isArray(recebimentosNaoFiscal) ? recebimentosNaoFiscal : [];
    const totalRecebidoNaoFiscal = recebimentosNf.reduce(
      (acc, p) => acc + Number(p.valor || 0),
      0
    );
    const naoFiscalQuitado = !temNaoFiscal || (
      recebimentosNf.length > 0
      && Math.abs(totalRecebidoNaoFiscal - Number(totalNaoFiscal)) <= 0.01
    );

    if (temFiscal && !fiscalOk) {
      return { status: 'pendente', tefId: null };
    }

    if (temFiscal && temNaoFiscal && fiscalOk && !naoFiscalQuitado) {
      return { status: 'aguardando_nao_fiscal', tefId: tefFiscalId };
    }

    if (!temFiscal && temNaoFiscal && naoFiscalQuitado) {
      return { status: 'quitada', tefId: null };
    }

    if (fiscalOk && naoFiscalQuitado) {
      return { status: 'quitada', tefId: tefFiscalId };
    }

    return { status: 'pendente', tefId: null };
  }

  function montarRecebimentosParaGravar(distribuicaoPagamento, statusPagamento) {
    const recebimentosFiscal = distribuicaoPagamento.recebimentosFiscal || [];
    const recebimentosNaoFiscal = distribuicaoPagamento.recebimentosNaoFiscal || [];

    if (statusPagamento === 'aguardando_nao_fiscal') {
      return [...recebimentosFiscal];
    }

    return [...recebimentosFiscal, ...recebimentosNaoFiscal];
  }

  function aplicarStatusPagamentoVenda(vendaId, params) {
    const statusPagamento = resolverStatusPagamentoVenda(params);
    atualizarStatusPagamentoVenda(vendaId, statusPagamento.status, statusPagamento.tefId);
    return statusPagamento;
  }

  const FORMAS_NAO_FISCAL_PERMITIDAS = new Set([
    'pix',
    'dinheiro',
    'cartao',
    'cartao_pf',
    'outro'
  ]);

  const FORMAS_TEF_FISCAL = new Set([
    'cartao_debito',
    'cartao_credito'
  ]);

  function calcularSaldoNaoFiscal(venda, recebimentosNaoFiscal) {
    const valorNaoFiscal = Number(venda.valor_nao_fiscal || 0);
    const recebimentos = Array.isArray(recebimentosNaoFiscal) ? recebimentosNaoFiscal : [];
    const valorRecebido = recebimentos.reduce(
      (acc, r) => acc + Number(r.valor || 0),
      0
    );
    const saldoPendente = Math.round((valorNaoFiscal - valorRecebido) * 100) / 100;

    return {
      valorNaoFiscal,
      valorRecebido,
      saldoPendente: Math.max(0, saldoPendente)
    };
  }

  function normalizarPagamentosNaoFiscal(body) {
    if (Array.isArray(body.pagamentos) && body.pagamentos.length > 0) {
      return body.pagamentos;
    }

    if (body.forma_pagamento && body.valor != null) {
      return [{
        forma_pagamento: body.forma_pagamento,
        valor: body.valor
      }];
    }

    return [];
  }

  function validarPagamentosNaoFiscal(pagamentos) {
    for (const pagamento of pagamentos) {
      const forma = String(pagamento.forma_pagamento || '').toLowerCase().trim();

      if (!forma) {
        return 'Informe a forma de pagamento não fiscal.';
      }

      if (FORMAS_TEF_FISCAL.has(forma) || pagamento.tef_transacao_id) {
        return 'Pagamento não fiscal não utiliza TEF.';
      }

      if (!FORMAS_NAO_FISCAL_PERMITIDAS.has(forma)) {
        return `Forma de pagamento não fiscal inválida: ${forma}.`;
      }

      if (Number(pagamento.valor || 0) <= 0) {
        return 'Valor do pagamento não fiscal deve ser maior que zero.';
      }
    }

    return null;
  }

  async function vincularNfceTransacoesVenda(vendaId, fiscal) {
    if (!fiscal?.success || !fiscal?.numero || !fiscal?.chave) {
      return;
    }

    const rows = await new Promise((resolve, reject) => {
      db.all(`
        SELECT tef_transacao_id
        FROM venda_recebimentos
        WHERE venda_id = ? AND tef_transacao_id IS NOT NULL
      `, [vendaId], (err, result) => {
        if (err) return reject(err);
        resolve(result || []);
      });
    });

    for (const row of rows) {
      try {
        await tefManager.vincularNfce(row.tef_transacao_id, fiscal.numero, fiscal.chave);
      } catch (vincError) {
        console.error(`Erro ao vincular NFC-e à transação TEF ${row.tef_transacao_id}:`, vincError);
      }
    }
  }

  async function emitirFiscalSeSolicitado(vendaId, emitirFiscal, venda) {
    const emitirExplicito = emitirFiscal === true
      || emitirFiscal === 'true'
      || emitirFiscal === 1
      || emitirFiscal === '1';
    const emitirExplicitoNegado = emitirFiscal === false
      || emitirFiscal === 'false'
      || emitirFiscal === 0
      || emitirFiscal === '0';
    const deveEmitir = emitirExplicito
      || (!emitirExplicitoNegado && Number(venda?.valor_fiscal || 0) > 0);

    if (!deveEmitir) {
      return null;
    }

    try {
      const fiscal = await emitirPorVendaId(vendaId);

      if (fiscal?.status === 'sem_itens_fiscais') {
        return fiscal;
      }

      await vincularNfceTransacoesVenda(vendaId, fiscal);
      return fiscal;
    } catch (error) {
      console.error('Erro ao emitir NFC-e após pagamento não fiscal:', error);
      return {
        success: false,
        status: 'erro_emissao',
        message: error.message
      };
    }
  }

  function obterTerminalId(req) {
    const rawId = req.body?.terminal_id || req.query?.terminal_id || req.headers['x-terminal-id'];
    const id = Number(rawId || 0);
    return Number.isInteger(id) && id > 0 ? id : null;
  }

  // Nota: validação de caixa agora é feita pelo middleware `validarCaixaAberto`.
  // Funções legadas que consultavam a tabela `caixa` foram removidas para
  // evitar inconsistências com o modelo de `caixa_sessoes`.

  // Responder venda com emissão fiscal opcional
  async function responderVendaComFiscal(res, payload) {
    const respostaBase = {
      id: payload.vendaId,
      codigo: payload.codigo,
      message: payload.message,
      status_pagamento: payload.statusPagamento || 'quitada'
    };

    if (!payload.emitirFiscal) {
      return res.json({
        ...respostaBase,
        fiscal: null
      });
    }

    if (Number(payload.valorFiscal || 0) <= 0) {
      return res.json({
        ...respostaBase,
        fiscal: null
      });
    }

    if (payload.statusPagamento !== 'quitada') {
      return res.json({
        ...respostaBase,
        fiscal: {
          success: false,
          status: 'aguardando_pagamento',
          message: 'Aguardando pagamento não fiscal para emitir NFC-e.'
        }
      });
    }

    try {
      const fiscal = await emitirPorVendaId(payload.vendaId);

      if (fiscal?.status === 'sem_itens_fiscais') {
        return res.json({
          ...respostaBase,
          fiscal
        });
      }

      // Vincular NFC-e às transações TEF autorizadas (se houver)
      // As transações TEF já foram processadas antes de gravar a venda
      // Aqui apenas vinculamos à NFC-e se necessário
      if (fiscal.success && fiscal.numero && fiscal.chave) {
        // Buscar transações TEF da venda para vincular
        db.all(`
          SELECT tef_transacao_id FROM venda_recebimentos
          WHERE venda_id = ? AND tef_transacao_id IS NOT NULL
        `, [payload.vendaId], async (err, rows) => {
          if (err) {
            console.error('Erro ao buscar transações TEF:', err);
            return;
          }

          for (const row of rows) {
            try {
              await tefManager.vincularNfce(row.tef_transacao_id, fiscal.numero, fiscal.chave);
              console.log(`NFC-e ${fiscal.numero} vinculada à transação TEF ${row.tef_transacao_id}`);
            } catch (vincError) {
              console.error(`Erro ao vincular NFC-e à transação TEF ${row.tef_transacao_id}:`, vincError);
            }
          }
        });
      }
      
      res.json({
        ...respostaBase,
        fiscal
      });
    } catch (error) {
      console.error('Erro ao emitir NFC-e:', error);
      
      // Reverter pagamentos TEF autorizados
      if (transacoesTefAutorizadas.length > 0) {
        for (const transacaoId of transacoesTefAutorizadas) {
          try {
            await tefManager.cancelar(transacaoId, 'Falha na emissão NFC-e');
            console.log(`Transação TEF ${transacaoId} cancelada devido a falha na NFC-e`);
          } catch (cancelError) {
            console.error(`Erro ao cancelar transação TEF ${transacaoId}:`, cancelError);
          }
        }
      }

      res.json({
        ...respostaBase,
        fiscal: {
          success: false,
          status: 'erro_emissao',
          message: error.message
        }
      });
    }
  }

  // Listar vendas com busca
  router.get('/', (req, res) => {
    const busca = String(req.query.busca || '').trim();
    const todas = req.query.todas === '1';
    const somenteFiscal = String(req.query.modo || '').toLowerCase() === 'fiscal';

    let where = '';
    const params = [];

    if (busca) {
      where = `
        WHERE (
          v.id LIKE ?
          OR v.codigo LIKE ?
          OR c.nome LIKE ?
          OR v.forma_pagamento LIKE ?
          OR v.status LIKE ?
        )
      `;

      const termo = `%${busca}%`;
      params.push(termo, termo, termo, termo, termo);
    }

    if (!todas) {
      const dataHoje = agoraLocalBrasil().slice(0, 10);
      where += (where ? ' AND ' : ' WHERE ');
      where += ` v.data_venda = ? `;
      params.push(dataHoje);
    }

    if (somenteFiscal) {
      where += (where ? ' AND ' : ' WHERE ');
      where += ` n.id IS NOT NULL `;
    }

    db.all(`
      SELECT
        v.id,
        v.codigo,
        v.data_venda,
        v.created_at,
        v.cliente_id,
        v.total,
        v.valor_fiscal,
        v.valor_nao_fiscal,
        v.desconto,
        v.forma_pagamento,
        v.status,
        n.id AS nfce_id,
        n.numero AS nfce_numero,
        n.status AS nfce_status,
        n.chave_acesso AS nfce_chave,
        c.nome AS cliente_nome,
        (
          SELECT COUNT(*)
          FROM vendas_itens vi
          WHERE vi.venda_id = v.id
        ) AS total_itens
      FROM vendas v
      LEFT JOIN clientes c ON c.id = v.cliente_id
      LEFT JOIN nfce_notas n ON n.id = (
        SELECT n2.id
        FROM nfce_notas n2
        WHERE n2.venda_id = v.id
        ORDER BY n2.id DESC
        LIMIT 1
      )
      ${where}
      ORDER BY v.data_venda DESC, v.id DESC
    `, params, (err, rows) => {
      if (err) {
        console.error('Erro ao listar vendas:', err);
        return res.status(500).json({ error: err.message });
      }

      res.setHeader('Cache-Control', 'no-store');
      res.json(rows || []);
    });
  });

  // Buscar venda por ID
  router.get('/:id', (req, res) => {
    const { id } = req.params;
    
    db.get(`
      SELECT v.*, c.nome as cliente_nome, c.cpf_cnpj as cliente_cpf
      FROM vendas v
      LEFT JOIN clientes c ON v.cliente_id = c.id
      WHERE v.id = ?
    `, [id], (err, venda) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      
      db.all(`
        SELECT vi.*, p.nome as produto_nome, p.codigo as produto_codigo, p.unidade
        FROM vendas_itens vi
        JOIN produtos p ON vi.produto_id = p.id
        WHERE vi.venda_id = ?
      `, [id], (err, itens) => {
        if (err) {
          res.status(500).json({ error: err.message });
          return;
        }
        res.json({ ...venda, itens });
      });
    });
  });

  // Buscar detalhes completos da venda para emissão de NFC-e
  router.get('/:id/detalhes', (req, res) => {
    const vendaId = req.params.id;

    db.get(`
      SELECT v.*, c.nome as cliente_nome
      FROM vendas v
      LEFT JOIN clientes c ON c.id = v.cliente_id
      WHERE v.id = ?
    `, [vendaId], (err, venda) => {
      if (err) return res.status(500).json({ error: err.message });

      if (!venda) {
        return res.status(404).json({ error: 'Venda não encontrada' });
      }

      db.all(`
        SELECT vi.*, p.nome as produto_nome
        FROM vendas_itens vi
        JOIN produtos p ON p.id = vi.produto_id
        WHERE vi.venda_id = ?
      `, [vendaId], (errItens, itens) => {
        if (errItens) return res.status(500).json({ error: errItens.message });

        res.json({
          venda,
          itens
        });
      });
    });
  });

  // Criar nova venda

  // NOVA LÓGICA: Suporte a venda a prazo
  // Substitui o bloqueio por verificação baseada em sessão (`caixa_sessoes`)
  router.post('/pre-calcular-distribuicao', validarCaixaAberto, (req, res) => {
    const { itens } = req.body;

    if (!itens || !Array.isArray(itens) || itens.length === 0) {
      return res.status(400).json({
        sucesso: false,
        error: 'Itens da venda são obrigatórios.'
      });
    }

    if (itens.some((item) => item.produto_id === undefined || item.produto_id === null)) {
      return res.status(400).json({
        sucesso: false,
        error: 'Um ou mais itens da venda não possuem produto vinculado.'
      });
    }

    const produtoIds = Array.from(
      new Set(itens.map((item) => item.produto_id).filter((id) => id !== undefined && id !== null))
    );

    db.all(`
      SELECT
        id,
        nome,
        saldo_fiscal,
        saldo_nao_fiscal
      FROM produtos
      WHERE id IN (${produtoIds.map(() => '?').join(',')})
    `, produtoIds, (err, produtos) => {
      if (err) {
        return res.status(500).json({ sucesso: false, error: err.message });
      }

      const produtoMap = produtos.reduce((map, produto) => {
        map[produto.id] = produto;
        return map;
      }, {});

      const itensDistribuidos = [];

      for (const item of itens) {
        const produto = produtoMap[item.produto_id];

        if (!produto) {
          return res.status(400).json({
            sucesso: false,
            error: `Produto ID ${item.produto_id} não encontrado`
          });
        }

        const resultado = distribuirQuantidadeVenda(
          Number(item.quantidade || 0),
          Number(produto.saldo_fiscal || 0),
          Number(produto.saldo_nao_fiscal || 0)
        );

        if (!resultado.sucesso) {
          return res.status(400).json({
            sucesso: false,
            error:
              `Saldo insuficiente para ${produto.nome}. ` +
              `Disponível: ${resultado.estoqueTotal}`
          });
        }

        const precoUnitario = Number(item.preco_unitario || 0);

        itensDistribuidos.push({
          produto_id: item.produto_id,
          quantidade_fiscal: resultado.quantidadeFiscal,
          quantidade_nao_fiscal: resultado.quantidadeNaoFiscal,
          valor_fiscal: Number((resultado.quantidadeFiscal * precoUnitario).toFixed(2)),
          valor_nao_fiscal: Number((resultado.quantidadeNaoFiscal * precoUnitario).toFixed(2))
        });
      }

      const { totalFiscal, totalNaoFiscal } = separarItensDistribuidos(itensDistribuidos);

      res.json({
        sucesso: true,
        valor_fiscal: totalFiscal,
        valor_nao_fiscal: totalNaoFiscal,
        itens: itensDistribuidos
      });
    });
  });

  function validarSomaPagamentosVenda(pagamentosVenda, total, opcoes = {}) {
    if (!Array.isArray(pagamentosVenda) || pagamentosVenda.length === 0) {
      return null;
    }

    const totalPagamentos = pagamentosVenda.reduce(
      (soma, p) => soma + Number(p.valor || 0),
      0
    );
    const totalVenda = Number(total || 0);

    if (Math.abs(totalPagamentos - totalVenda) <= 0.01) {
      return null;
    }

    const valorFiscal = Number(opcoes.valor_fiscal || 0);
    const valorNaoFiscal = Number(opcoes.valor_nao_fiscal || 0);
    const vendaMista = valorFiscal > 0 && valorNaoFiscal > 0;

    if (!vendaMista) {
      return 'A soma dos pagamentos precisa ser igual ao total da venda.';
    }

    const tipoRecebimento = (p) => String(p.tipo_recebimento || '').toLowerCase().trim();
    const todosFiscais = pagamentosVenda.every((p) => tipoRecebimento(p) === 'fiscal');
    const todosNaoFiscais = pagamentosVenda.every((p) => tipoRecebimento(p) === 'nao_fiscal');

    if (todosFiscais && Math.abs(totalPagamentos - valorFiscal) <= 0.01) {
      return null;
    }

    if (todosNaoFiscais && Math.abs(totalPagamentos - valorNaoFiscal) <= 0.01) {
      return null;
    }

    return 'A soma dos pagamentos precisa ser igual ao total da venda.';
  }

  router.post('/', validarCaixaAberto, (req, res) => {
    console.log('ENTROU NA ROTA DE EMISSAO NFC-E');
    console.log('DADOS RECEBIDOS PARA EMISSAO:', req.body);

    const {
      cliente_id,
      total,
      desconto,
      forma_pagamento,
      itens,
      parcelas,
      primeiro_vencimento,
      forcar,
      emitir_fiscal,
      valor_recebido,
      cpf_cnpj_nota,
      pagamentos,
      tef,
      valor_fiscal,
      valor_nao_fiscal,
      pagamentos_processados_pdv,
      confirmacao_fiscal_manual
    } = req.body;

    const pagamentosProcessadosPdv = pagamentos_processados_pdv === true
      || pagamentos_processados_pdv === 'true'
      || pagamentos_processados_pdv === 1
      || pagamentos_processados_pdv === '1';

    const confirmacaoFiscalManual = isConfirmacaoFiscalManual(confirmacao_fiscal_manual);

    const cpfCnpjNotaLimpo = String(cpf_cnpj_nota || '').replace(/\D/g, '');

    if (cpfCnpjNotaLimpo && ![11, 14].includes(cpfCnpjNotaLimpo.length)) {
      return res.status(400).json({
        error: 'CPF/CNPJ informado na nota é inválido.'
      });
    }

    const pagamentosVenda = Array.isArray(pagamentos) ? pagamentos : [];

    let formaPagamentoFinal = forma_pagamento;

    if (pagamentosVenda.length > 1) {
      formaPagamentoFinal = "misto";
    }

    const erroSomaPagamentos = validarSomaPagamentosVenda(pagamentosVenda, total, {
      valor_fiscal,
      valor_nao_fiscal
    });

    if (erroSomaPagamentos) {
      return res.status(400).json({ error: erroSomaPagamentos });
    }

    const totalNum = Number(total);
    const formasPendentes = ['prazo'];
    const formaPagamentoNormalizada = String(forma_pagamento || '').toLowerCase().trim();
    const vendaFicaPendente = formasPendentes.includes(formaPagamentoNormalizada);

    const buscarNomeCliente = (callback) => {
      if (!cliente_id) {
        callback(null, null, null);
        return;
      }

      db.get(
        'SELECT nome, cpf_cnpj FROM clientes WHERE id = ?',
        [cliente_id],
        (err, cliente) => {
          if (err) {
            callback(err);
            return;
          }

          callback(null, cliente ? cliente.nome : null, cliente ? cliente.cpf_cnpj : null);
        }
      );
    };

    if (!itens || !Array.isArray(itens) || itens.length === 0) {
      res.status(400).json({ error: 'Informe ao menos um item na venda.' });
      return;
    }
    if (Number.isNaN(totalNum) || totalNum <= 0) {
      res.status(400).json({ error: 'Total inválido.' });
      return;
    }

    if (forma_pagamento === 'prazo' && !cliente_id) {
      return res.status(400).json({
        error: 'Cliente é obrigatório para venda a prazo.'
      });
    }

    const produtoIds = Array.from(new Set(itens.map(item => item.produto_id).filter(id => id !== undefined && id !== null)));

    if (itens.some(item => item.produto_id === undefined || item.produto_id === null)) {
      res.status(400).json({ error: 'Um ou mais itens da venda não possuem produto vinculado.' });
      return;
    }

    db.all(`
      SELECT
        id,
        nome,
        saldo_fiscal,
        saldo_nao_fiscal,
        estoque_atual
      FROM produtos
      WHERE id IN (${produtoIds.map(() => '?').join(',')})
    `, produtoIds, (err, produtos) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }

      const produtoMap = produtos.reduce((map, produto) => {
        map[produto.id] = produto;
        return map;
      }, {});

      const faltantes = itens.reduce((acumulador, item) => {
        const produto = produtoMap[item.produto_id];
        if (!produto) {
          acumulador.push(`Produto ID ${item.produto_id} não encontrado`);
        }
        return acumulador;
      }, []);

      if (faltantes.length > 0) {
        res.status(400).json({ error: 'Erro na venda: ' + faltantes.join('; ') });
        return;
      }

      const distribuicaoItens = [];

      for (const item of itens) {

        const produto =
          produtoMap[item.produto_id];

        const resultado =
          distribuirQuantidadeVenda(
            Number(item.quantidade || 0),
            Number(produto.saldo_fiscal || 0),
            Number(produto.saldo_nao_fiscal || 0)
          );

        if (!resultado.sucesso) {

          return res.status(400).json({
            error:
              `Saldo insuficiente para ${produto.nome}. ` +
              `Disponível: ${resultado.estoqueTotal}`
          });

        }

        distribuicaoItens.push({
          ...item,

          quantidade_fiscal:
            resultado.quantidadeFiscal,

          quantidade_nao_fiscal:
            resultado.quantidadeNaoFiscal,

          valor_fiscal:
            Number(
              (
                resultado.quantidadeFiscal *
                Number(item.preco_unitario || 0)
              ).toFixed(2)
            ),

          valor_nao_fiscal:
            Number(
              (
                resultado.quantidadeNaoFiscal *
                Number(item.preco_unitario || 0)
              ).toFixed(2)
            )
        });
      }

      // Venda a prazo exige cliente
      if (forma_pagamento === 'prazo') {
      if (!cliente_id) {
        res.status(400).json({ error: 'Cliente obrigatório para venda a prazo.' });
        return;
      }
      // Validar débitos e parcelas vencidas, a menos que forçar esteja ativo
      if (!forcar) {
        const hoje = agoraLocalBrasil().slice(0, 10);
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
          const totalEmAberto = Number(row?.total_em_aberto || 0);
          const parcelasVencidas = Number(row?.parcelas_vencidas || 0);
          if (totalEmAberto > 0 || parcelasVencidas > 0) {
            // Avisar operador e pedir confirmação
            res.status(409).json({
              aviso: 'Cliente possui débitos em aberto.',
              total_em_aberto: totalEmAberto,
              parcelas_vencidas: parcelasVencidas,
              pode_continuar: true
            });
            return;
          }
          executarVendaPrazo();
        });
        return;
      }
      // Função para executar venda a prazo
      executarVendaPrazo();
      async function executarVendaPrazo() {
        const codigo = `VND-${agoraLocalBrasil().replace(/[- :]/g, '').slice(0, 14)}`;
        const data_venda = agoraLocalBrasil().slice(0, 10);

        // Calcular valores fiscal e não fiscal
        const { totalFiscal, totalNaoFiscal } = separarItensDistribuidos(distribuicaoItens);

        // Distribuir pagamentos entre fiscal e não fiscal
        const distribuicaoPagamento = montarDistribuicaoPagamento(
          req.body.pagamentos || [],
          totalFiscal,
          totalNaoFiscal,
          pagamentosProcessadosPdv
        );

        // Validar se o pagamento fiscal é suficiente
        if (distribuicaoPagamento.saldoFiscal > 0) {
          return res.status(400).json({
            error: 'Pagamento fiscal insuficiente.'
          });
        }

        const resultadoTefFiscal = await processarTefRecebimentosFiscais(
          distribuicaoPagamento.recebimentosFiscal,
          pagamentosProcessadosPdv,
          confirmacaoFiscalManual
        );

        if (!resultadoTefFiscal.sucesso) {
          return res.status(400).json({
            error: 'Pagamento fiscal não autorizado',
            tef: resultadoTefFiscal.erro
          });
        }

        const statusPagamentoResolvido = resolverStatusPagamentoVenda({
          totalFiscal,
          totalNaoFiscal,
          resultadoTefFiscal,
          recebimentosNaoFiscal: distribuicaoPagamento.recebimentosNaoFiscal
        });

        db.serialize(() => {
          db.run('BEGIN IMMEDIATE');
          db.run(`
            INSERT INTO vendas (codigo, data_venda, cliente_id, total, desconto, forma_pagamento, status, caixa_sessao_id, caixa_id, terminal_id, operador_id, valor_fiscal, valor_nao_fiscal, status_pagamento, tef_transacao_id)
              VALUES (?, ?, ?, ?, ?, ?, 'concluida', ?, ?, ?, ?, ?, ?, ?, ?)
            `, [codigo, data_venda, cliente_id, totalNum, desconto || 0, formaPagamentoFinal, req.caixaSessaoId || null, req.caixaId, req.terminalId || null, req.operadorId, totalFiscal, totalNaoFiscal, statusPagamentoResolvido.status, statusPagamentoResolvido.tefId], function(err) {
            if (err) {
              db.run('ROLLBACK');
              res.status(500).json({ error: err.message });
              return;
            }
            const vendaId = this.lastID;

            gravarRecebimentos(
              vendaId,
              montarRecebimentosParaGravar(distribuicaoPagamento, statusPagamentoResolvido.status),
              (err) => {
                if (err) {
                  db.run('ROLLBACK');
                  res.status(500).json({ error: err.message });
                  return;
                }
              }
            );

            const transacoesTefParaVincular = [];

            if (tef && tef.transacao_id) {
              transacoesTefParaVincular.push(tef.transacao_id);
            }

            pagamentosVenda.forEach((p) => {
              const idTef = p.tef_transacao_id || p.tef?.transacao_id;
              if (idTef) {
                transacoesTefParaVincular.push(idTef);
              }
            });

            [...new Set(transacoesTefParaVincular)].forEach((transacaoId) => {
              db.run(`
                UPDATE tef_transacoes
                SET venda_id = ?
                WHERE id = ?
              `, [
                vendaId,
                transacaoId
              ], (tefErr) => {
                if (tefErr) {
                  console.error('Erro ao vincular TEF à venda:', tefErr);
                }
              });
            });

            let itensProcessados = 0;
            distribuicaoItens.forEach(item => {
              const quantidadeFiscal =
                Number(
                  item.quantidade_fiscal || 0
                );

              const quantidadeNaoFiscal =
                Number(
                  item.quantidade_nao_fiscal || 0
                );

              const itemFiscal =
                quantidadeFiscal > 0
                  ? 1
                  : 0;

              const precoUnitario =
                Number(
                  item.preco_unitario || 0
                );

              const valorFiscal =
                Number(
                  (
                    quantidadeFiscal *
                    precoUnitario
                  ).toFixed(2)
                );

              const valorNaoFiscal =
                Number(
                  (
                    quantidadeNaoFiscal *
                    precoUnitario
                  ).toFixed(2)
                );

              db.run(`
                INSERT INTO vendas_itens (venda_id, produto_id, quantidade, preco_unitario, desconto_percentual, promocao_id, desconto_atacado, tipo_preco, subtotal, item_fiscal, quantidade_fiscal, quantidade_nao_fiscal, valor_fiscal, valor_nao_fiscal)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `, [vendaId, item.produto_id, item.quantidade, item.preco_unitario, item.desconto_percentual || 0, item.promocao_id || null, item.desconto_atacado || 0, item.tipo_preco || 'varejo', item.subtotal, itemFiscal, quantidadeFiscal, quantidadeNaoFiscal, valorFiscal, valorNaoFiscal], (itemErr) => {
                if (itemErr) {
                  db.run('ROLLBACK');
                  res.status(500).json({ error: itemErr.message });
                  return;
                }

                // Usar FEFO para reduzir estoque
                reduzirEstoqueDistribuido(this.lastID, item.produto_id, item.quantidade_fiscal, item.quantidade_nao_fiscal, (estErr) => {
                  if (estErr) {
                    db.run('ROLLBACK');
                    res.status(500).json({ error: estErr.message });
                    return;
                  }
                  itensProcessados++;
                  if (itensProcessados === itens.length) {
                    if (pagamentosVenda.length > 0) {
                      const stmtPagamentos = db.prepare(`
                        INSERT INTO venda_pagamentos (
                          venda_id, forma_pagamento, valor,
                          tef_transacao_id, tef_nsu, tef_autorizacao,
                          tef_bandeira, tef_adquirente,
                          tef_comprovante_cliente, tef_comprovante_estabelecimento
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                      `);

                      pagamentosVenda.forEach((p) => {
                        stmtPagamentos.run(
                          vendaId,
                          p.forma_pagamento,
                          Number(p.valor || 0),
                          p.tef_transacao_id || p.tef?.transacao_id || null,
                          p.nsu || p.tef?.nsu || null,
                          p.autorizacao || p.tef?.autorizacao || null,
                          p.bandeira || p.tef?.bandeira || null,
                          p.adquirente || p.tef?.adquirente || null,
                          p.tef?.comprovante_cliente || null,
                          p.tef?.comprovante_estabelecimento || null
                        );
                      });

                      stmtPagamentos.finalize();
                    } else {
                      db.run(
                        `
                        INSERT INTO venda_pagamentos (
                          venda_id, forma_pagamento, valor,
                          tef_transacao_id, tef_nsu, tef_autorizacao,
                          tef_bandeira, tef_adquirente,
                          tef_comprovante_cliente, tef_comprovante_estabelecimento
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `,
                        [
                          vendaId,
                          formaPagamentoFinal,
                          Number(total || 0),
                          tef?.transacao_id || null,
                          tef?.nsu || null,
                          tef?.autorizacao || null,
                          tef?.bandeira || null,
                          tef?.adquirente || null,
                          tef?.comprovante_cliente || null,
                          tef?.comprovante_estabelecimento || null
                        ]
                      );
                    }

                    // Gerar parcelas
                    const qtdParcelas = Number(parcelas) || 1;
                    const valorParcela = Math.round((totalNum / qtdParcelas) * 100) / 100;
                    let vencimento = moment(primeiro_vencimento, 'YYYY-MM-DD');
                    for (let i = 1; i <= qtdParcelas; i++) {
                      db.run(`
                        INSERT INTO contas_receber (venda_id, cliente_id, numero_parcela, total_parcelas, valor_parcela, valor_restante, data_vencimento, status)
                        VALUES (?, ?, ?, ?, ?, ?, ?, 'aberto')
                      `, [vendaId, cliente_id, i, qtdParcelas, valorParcela, valorParcela, vencimento.format('YYYY-MM-DD')]);
                      vencimento = vencimento.add(1, 'months');
                    }
                    buscarNomeCliente((clienteErr, clienteNome, clienteCpf) => {
                      if (clienteErr) {
                        db.run('ROLLBACK');
                        res.status(500).json({ error: clienteErr.message });
                        return;
                      }

                      const inserirFinanceiroPrazo = (indice = 1, venc = moment(primeiro_vencimento, 'YYYY-MM-DD')) => {
                        if (indice > qtdParcelas) {
                          db.run('COMMIT');

                          responderVendaComFiscal(res, {
                            vendaId,
                            codigo,
                            message: 'Venda a prazo registrada com sucesso',
                            emitirFiscal: !!emitir_fiscal,
                            valorFiscal: totalFiscal,
                            statusPagamento: statusPagamentoResolvido.status,
                            pagamentosTef: pagamentosVenda
                          });
                          return;
                        }

                        db.run(`
                          INSERT INTO financeiro (
                            tipo, descricao, valor, data_movimento, categoria, forma_pagamento,
                            referencia_id, referencia_tipo, status, origem, documento, vencimento,
                            numero_parcela, total_parcelas, venda_id, pessoa_nome, baixado_em
                          ) VALUES ('receita', ?, ?, ?, 'vendas', ?, ?, 'venda', 'pendente', 'venda', ?, ?, ?, ?, ?, ?, NULL)
                        `, [
                          `Venda ${codigo} - Parcela ${indice}/${qtdParcelas}`,
                          valorParcela,
                          data_venda,
                          forma_pagamento,
                          vendaId,
                          clienteCpf,
                          venc.format('YYYY-MM-DD'),
                          indice,
                          qtdParcelas,
                          vendaId,
                          clienteNome
                        ], (finErr) => {
                          if (finErr) {
                            db.run('ROLLBACK');
                            res.status(500).json({ error: finErr.message });
                            return;
                          }

                          inserirFinanceiroPrazo(indice + 1, moment(venc).add(1, 'months'));
                        });
                      };

                      inserirFinanceiroPrazo();
                    });
                  }
                });
              });
            });
          });
        });
      }
      return;
    }

    // Venda à vista ou crédito antigo
    const executarVenda = async () => {
      const codigo = `VND-${agoraLocalBrasil().replace(/[- :]/g, '').slice(0, 14)}`;
      const data_venda = agoraLocalBrasil().slice(0, 10);

      // Calcular valores fiscal e não fiscal
      const { totalFiscal, totalNaoFiscal } = separarItensDistribuidos(distribuicaoItens);

      // Distribuir pagamentos entre fiscal e não fiscal
      const distribuicaoPagamento = montarDistribuicaoPagamento(
        req.body.pagamentos || [],
        totalFiscal,
        totalNaoFiscal,
        pagamentosProcessadosPdv
      );

      // Validar se o pagamento fiscal é suficiente
      if (distribuicaoPagamento.saldoFiscal > 0) {
        return res.status(400).json({
          error: 'Pagamento fiscal insuficiente.'
        });
      }

      const resultadoTefFiscal = await processarTefRecebimentosFiscais(
        distribuicaoPagamento.recebimentosFiscal,
        pagamentosProcessadosPdv,
        confirmacaoFiscalManual
      );

      if (!resultadoTefFiscal.sucesso) {
        return res.status(400).json({
          error: 'Pagamento fiscal não autorizado',
          tef: resultadoTefFiscal.erro
        });
      }

      const statusPagamentoResolvido = resolverStatusPagamentoVenda({
        totalFiscal,
        totalNaoFiscal,
        resultadoTefFiscal,
        recebimentosNaoFiscal: distribuicaoPagamento.recebimentosNaoFiscal
      });

      db.serialize(() => {
        db.run('BEGIN IMMEDIATE');
        db.run(`
          INSERT INTO vendas (
            codigo,
            data_venda,
            cliente_id,
            total,
            desconto,
            forma_pagamento,
            status,
            valor_recebido,
            caixa_sessao_id,
            caixa_id,
            terminal_id,
            cpf_cnpj_nota,
            operador_id,
            valor_fiscal,
            valor_nao_fiscal,
            status_pagamento,
            tef_transacao_id
          )
          VALUES (?, ?, ?, ?, ?, ?, 'concluida', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          codigo,
          data_venda,
          cliente_id || null,
          totalNum,
          desconto || 0,
          formaPagamentoFinal,
          valor_recebido || null,
          req.caixaSessaoId || null,
          req.caixaId,
          req.terminalId || null,
          emitir_fiscal ? cpfCnpjNotaLimpo || null : null,
          req.operadorId,
          totalFiscal,
          totalNaoFiscal,
          statusPagamentoResolvido.status,
          statusPagamentoResolvido.tefId
        ], function(err) {
          if (err) {
            db.run('ROLLBACK');
            res.status(500).json({ error: err.message });
            return;
          }
          const vendaId = this.lastID;

          gravarRecebimentos(
            vendaId,
            montarRecebimentosParaGravar(distribuicaoPagamento, statusPagamentoResolvido.status),
            (err) => {
              if (err) {
                db.run('ROLLBACK');
                res.status(500).json({ error: err.message });
                return;
              }
            }
          );

          const transacoesTefParaVincular = [];

          if (tef && tef.transacao_id) {
            transacoesTefParaVincular.push(tef.transacao_id);
          }

          pagamentosVenda.forEach((p) => {
            const idTef = p.tef_transacao_id || p.tef?.transacao_id;
            if (idTef) {
              transacoesTefParaVincular.push(idTef);
            }
          });

          [...new Set(transacoesTefParaVincular)].forEach((transacaoId) => {
            db.run(`
              UPDATE tef_transacoes
              SET venda_id = ?
              WHERE id = ?
            `, [
              vendaId,
              transacaoId
            ], (tefErr) => {
              if (tefErr) {
                console.error('Erro ao vincular TEF à venda:', tefErr);
              }
            });
          });

          let itensProcessados = 0;
          distribuicaoItens.forEach(item => {
            const quantidadeFiscal =
              Number(
                item.quantidade_fiscal || 0
              );

            const quantidadeNaoFiscal =
              Number(
                item.quantidade_nao_fiscal || 0
              );

            const itemFiscal =
              quantidadeFiscal > 0
                ? 1
                : 0;

            const precoUnitario =
              Number(
                item.preco_unitario || 0
              );

            const valorFiscal =
              Number(
                (
                  quantidadeFiscal *
                  precoUnitario
                ).toFixed(2)
              );

            const valorNaoFiscal =
              Number(
                (
                  quantidadeNaoFiscal *
                  precoUnitario
                ).toFixed(2)
              );

            db.run(`
              INSERT INTO vendas_itens (venda_id, produto_id, quantidade, preco_unitario, desconto_percentual, promocao_id, desconto_atacado, tipo_preco, subtotal, item_fiscal, quantidade_fiscal, quantidade_nao_fiscal, valor_fiscal, valor_nao_fiscal)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [vendaId, item.produto_id, item.quantidade, item.preco_unitario, item.desconto_percentual || 0, item.promocao_id || null, item.desconto_atacado || 0, item.tipo_preco || 'varejo', item.subtotal, itemFiscal, quantidadeFiscal, quantidadeNaoFiscal, valorFiscal, valorNaoFiscal], (itemErr) => {
              if (itemErr) {
                db.run('ROLLBACK');
                res.status(500).json({ error: itemErr.message });
                return;
              }

              // Usar FEFO para reduzir estoque
              reduzirEstoqueDistribuido(this.lastID, item.produto_id, item.quantidade_fiscal, item.quantidade_nao_fiscal, (estErr) => {
                if (estErr) {
                  db.run('ROLLBACK');
                  res.status(500).json({ error: estErr.message });
                  return;
                }
                itensProcessados++;
                if (itensProcessados === itens.length) {
                  if (pagamentosVenda.length > 0) {
                    const stmtPagamentos = db.prepare(`
                      INSERT INTO venda_pagamentos (
                        venda_id, forma_pagamento, valor,
                        tef_transacao_id, tef_nsu, tef_autorizacao,
                        tef_bandeira, tef_adquirente,
                        tef_comprovante_cliente, tef_comprovante_estabelecimento
                      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `);

                    pagamentosVenda.forEach((p) => {
                      stmtPagamentos.run(
                        vendaId,
                        p.forma_pagamento,
                        Number(p.valor || 0),
                        p.tef_transacao_id || p.tef?.transacao_id || null,
                        p.nsu || p.tef?.nsu || null,
                        p.autorizacao || p.tef?.autorizacao || null,
                        p.bandeira || p.tef?.bandeira || null,
                        p.adquirente || p.tef?.adquirente || null,
                        p.tef?.comprovante_cliente || null,
                        p.tef?.comprovante_estabelecimento || null
                      );
                    });

                    stmtPagamentos.finalize();
                  } else {
                    db.run(
                      `
                      INSERT INTO venda_pagamentos (
                        venda_id, forma_pagamento, valor,
                        tef_transacao_id, tef_nsu, tef_autorizacao,
                        tef_bandeira, tef_adquirente,
                        tef_comprovante_cliente, tef_comprovante_estabelecimento
                      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                      `,
                      [
                        vendaId,
                        formaPagamentoFinal,
                        Number(total || 0),
                        tef?.transacao_id || null,
                        tef?.nsu || null,
                        tef?.autorizacao || null,
                        tef?.bandeira || null,
                        tef?.adquirente || null,
                        tef?.comprovante_cliente || null,
                        tef?.comprovante_estabelecimento || null
                      ]
                    );
                  }

                  const statusFinanceiro = vendaFicaPendente ? 'pendente' : 'recebido';
                  const baixadoEm = statusFinanceiro === 'recebido' ? data_venda : null;
                  const finalizarResposta = () => {
                    db.run('COMMIT');

                    responderVendaComFiscal(res, {
                      vendaId,
                      codigo,
                      message: 'Venda registrada com sucesso',
                      emitirFiscal: !!emitir_fiscal,
                      valorFiscal: totalFiscal,
                      statusPagamento: statusPagamentoResolvido.status,
                      pagamentosTef: pagamentosVenda
                    });
                  };

                  const inserirContasReceberSeNecessario = (callback) => {
                    if (forma_pagamento === 'prazo' && cliente_id) {
                      const valorParcela = totalNum;
                      db.run(`
                        INSERT INTO contas_receber (
                          venda_id, cliente_id, numero_parcela, total_parcelas, valor_parcela,
                          valor_restante, data_vencimento, status
                        ) VALUES (?, ?, ?, ?, ?, ?, date('now', '+30 day'), 'aberto')
                      `, [vendaId, cliente_id, 1, 1, valorParcela, valorParcela], (crErr) => {
                        if (crErr) {
                          db.run('ROLLBACK');
                          res.status(500).json({ error: crErr.message });
                          return;
                        }
                        callback();
                      });
                    } else {
                      callback();
                    }
                  };

                  buscarNomeCliente((clienteErr, clienteNome, clienteCpf) => {
                    if (clienteErr) {
                      db.run('ROLLBACK');
                      res.status(500).json({ error: clienteErr.message });
                      return;
                    }

                    db.run(`
                      INSERT INTO financeiro (
                        tipo, descricao, valor, data_movimento, categoria, forma_pagamento,
                        referencia_id, referencia_tipo, status, origem, documento, vencimento,
                        numero_parcela, total_parcelas, venda_id, pessoa_nome, baixado_em
                      ) VALUES ('receita', ?, ?, ?, 'vendas', ?, ?, 'venda', ?, 'venda', ?, ?, 1, 1, ?, ?, ?)
                    `, [
                      `Venda ${codigo}`,
                      totalNum,
                      data_venda,
                      forma_pagamento,
                      vendaId,
                      statusFinanceiro,
                      clienteCpf,
                      data_venda,
                      vendaId,
                      clienteNome,
                      baixadoEm
                    ], (finErr) => {
                      if (finErr) {
                        db.run('ROLLBACK');
                        res.status(500).json({ error: finErr.message });
                        return;
                      }

                      const aposFinanceiro = () => {
                        if (forma_pagamento === 'prazo' && cliente_id) {
                          db.run(`
                            UPDATE clientes
                            SET credito_atual = COALESCE(credito_atual, 0) + ?
                            WHERE id = ?
                          `, [totalNum, cliente_id], (credErr) => {
                            if (credErr) {
                              db.run('ROLLBACK');
                              res.status(500).json({ error: credErr.message });
                              return;
                            }

                            finalizarResposta();
                          });
                        } else {
                          finalizarResposta();
                        }
                      };

                      inserirContasReceberSeNecessario(aposFinanceiro);
                    });
                  });
                }
              });
            });
          });
        });
      });
    };

    // Venda à vista pode ser sem cliente
    if (forma_pagamento === 'credito') {
      if (!cliente_id) {
        res.status(400).json({ error: 'Cliente obrigatório para venda a crédito.' });
        return;
      }
      db.get(
        'SELECT credito_atual, limite_credito FROM clientes WHERE id = ?',
        [cliente_id],
        (err, cliente) => {
          if (err) {
            res.status(500).json({ error: err.message });
            return;
          }
          if (!cliente) {
            res.status(400).json({ error: 'Cliente não encontrado.' });
            return;
          }
          if (Number(cliente.limite_credito) <= 0) {
            res.status(400).json({ error: 'Configure um limite de crédito maior que zero para este cliente.' });
            return;
          }
          if (Number(cliente.credito_atual) + totalNum > Number(cliente.limite_credito)) {
            res.status(400).json({ error: 'Limite de crédito excedido.' });
            return;
          }
          executarVenda();
        }
      );
    } else {
      executarVenda();
    }
  });
  });

  // Consultar saldo não fiscal pendente
  router.get('/:id/pagamento-nao-fiscal', (req, res) => {
    const { id } = req.params;

    db.get('SELECT * FROM vendas WHERE id = ?', [id], (err, venda) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }

      if (!venda) {
        res.status(404).json({ error: 'Venda não encontrada.' });
        return;
      }

      db.all(`
        SELECT *
        FROM venda_recebimentos
        WHERE venda_id = ? AND tipo_recebimento = 'nao_fiscal'
        ORDER BY id ASC
      `, [id], (recErr, recebimentos) => {
        if (recErr) {
          res.status(500).json({ error: recErr.message });
          return;
        }

        const saldo = calcularSaldoNaoFiscal(venda, recebimentos);

        res.json({
          venda_id: Number(id),
          codigo: venda.codigo,
          status_pagamento: venda.status_pagamento,
          valor_fiscal: Number(venda.valor_fiscal || 0),
          valor_nao_fiscal: saldo.valorNaoFiscal,
          valor_recebido_nao_fiscal: saldo.valorRecebido,
          saldo_pendente: saldo.saldoPendente,
          recebimentos_nao_fiscal: recebimentos || [],
          aguardando_pagamento: venda.status_pagamento === 'aguardando_nao_fiscal'
        });
      });
    });
  });

  // Registrar pagamento não fiscal e quitar venda
  router.post('/:id/pagamento-nao-fiscal', validarCaixaAberto, (req, res) => {
    const { id } = req.params;
    const pagamentosInformados = normalizarPagamentosNaoFiscal(req.body || {});

    if (pagamentosInformados.length === 0) {
      res.status(400).json({ error: 'Informe ao menos um pagamento não fiscal.' });
      return;
    }

    const erroValidacao = validarPagamentosNaoFiscal(pagamentosInformados);
    if (erroValidacao) {
      res.status(400).json({ error: erroValidacao });
      return;
    }

    db.get('SELECT * FROM vendas WHERE id = ?', [id], (err, venda) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }

      if (!venda) {
        res.status(404).json({ error: 'Venda não encontrada.' });
        return;
      }

      if (venda.status !== 'concluida') {
        res.status(400).json({ error: 'Venda não está ativa para recebimento.' });
        return;
      }

      const valorFiscalVenda = Number(venda.valor_fiscal || 0);

      if (valorFiscalVenda <= 0) {
        if (venda.status_pagamento === 'quitada') {
          res.json({
            id: Number(id),
            codigo: venda.codigo,
            status_pagamento: 'quitada',
            message: 'Venda sem itens fiscais já finalizada. NFC-e não necessária.',
            saldo_pendente: 0,
            fiscal: {
              success: true,
              status: 'sem_itens_fiscais',
              message: 'Venda sem itens fiscais. NFC-e não necessária.'
            }
          });
          return;
        }

        res.status(400).json({
          error: 'Venda sem itens fiscais deve ser finalizada em POST /vendas.',
          status_pagamento: venda.status_pagamento
        });
        return;
      }

      if (venda.status_pagamento !== 'aguardando_nao_fiscal') {
        res.status(400).json({
          error: 'Venda não está aguardando pagamento não fiscal.',
          status_pagamento: venda.status_pagamento
        });
        return;
      }

      db.all(`
        SELECT *
        FROM venda_recebimentos
        WHERE venda_id = ? AND tipo_recebimento = 'nao_fiscal'
      `, [id], (recErr, recebimentosAtuais) => {
        if (recErr) {
          res.status(500).json({ error: recErr.message });
          return;
        }

        const saldo = calcularSaldoNaoFiscal(venda, recebimentosAtuais);

        if (saldo.saldoPendente <= 0) {
          res.status(400).json({ error: 'Não há saldo não fiscal pendente nesta venda.' });
          return;
        }

        const totalInformado = pagamentosInformados.reduce(
          (acc, p) => acc + Number(p.valor || 0),
          0
        );

        if (Math.abs(totalInformado - saldo.saldoPendente) > 0.01) {
          res.status(400).json({
            error: 'Valor informado não confere com o saldo não fiscal pendente.',
            saldo_pendente: saldo.saldoPendente
          });
          return;
        }

        const recebimentos = pagamentosInformados.map((pagamento) => ({
          tipo_recebimento: 'nao_fiscal',
          forma_pagamento: String(pagamento.forma_pagamento).toLowerCase().trim(),
          valor: Number(pagamento.valor || 0),
          tef_transacao_id: null,
          nsu: pagamento.nsu || null,
          autorizacao: pagamento.autorizacao || null
        }));

        db.serialize(() => {
          db.run('BEGIN IMMEDIATE');

          gravarRecebimentos(id, recebimentos, (gravarErr) => {
            if (gravarErr) {
              db.run('ROLLBACK');
              res.status(500).json({ error: gravarErr.message });
              return;
            }

            db.run(
              `UPDATE vendas SET status_pagamento = ? WHERE id = ?`,
              ['quitada', id],
              (updateErr) => {
                if (updateErr) {
                  db.run('ROLLBACK');
                  res.status(500).json({ error: updateErr.message });
                  return;
                }

                db.run('COMMIT', async (commitErr) => {
                  if (commitErr) {
                    res.status(500).json({ error: commitErr.message });
                    return;
                  }

                  const fiscal = await emitirFiscalSeSolicitado(id, req.body.emitir_fiscal, venda);

                  res.json({
                    id: Number(id),
                    codigo: venda.codigo,
                    status_pagamento: 'quitada',
                    message: 'Pagamento não fiscal registrado com sucesso.',
                    saldo_pendente: 0,
                    fiscal
                  });
                });
              }
            );
          });
        });
      });
    });
  });

  function garantirTabelaDevolucoesVenda(callback) {
    db.run(`
      CREATE TABLE IF NOT EXISTS vendas_devolucoes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        venda_id INTEGER NOT NULL,
        venda_item_id INTEGER NOT NULL,
        produto_id INTEGER NOT NULL,
        quantidade DECIMAL(10,3) NOT NULL,
        quantidade_fiscal DECIMAL(10,3) NOT NULL DEFAULT 0,
        quantidade_nao_fiscal DECIMAL(10,3) NOT NULL DEFAULT 0,
        valor_unitario DECIMAL(10,2) NOT NULL,
        valor_total DECIMAL(10,2) NOT NULL,
        motivo TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, callback);
  }

  // Devolução parcial de venda (restaura saldo fiscal primeiro)
  router.post('/:id/devolver', validarCaixaAberto, (req, res) => {
    const vendaId = Number(req.params.id);
    const motivo = String(req.body?.motivo || '').trim();
    const itens = Array.isArray(req.body?.itens) ? req.body.itens : [];

    if (!motivo || motivo.length < 10) {
      return res.status(400).json({ error: 'Informe um motivo com no mínimo 10 caracteres.' });
    }

    const itensValidos = itens
      .map((i) => ({
        venda_item_id: Number(i.venda_item_id),
        quantidade: Number(i.quantidade)
      }))
      .filter((i) => i.venda_item_id > 0 && i.quantidade > 0);

    if (!itensValidos.length) {
      return res.status(400).json({ error: 'Informe ao menos um item para devolução.' });
    }

    garantirTabelaDevolucoesVenda((tableErr) => {
      if (tableErr) {
        return res.status(500).json({ error: tableErr.message });
      }

      db.get('SELECT * FROM vendas WHERE id = ?', [vendaId], (vendaErr, venda) => {
        if (vendaErr) {
          return res.status(500).json({ error: vendaErr.message });
        }
        if (!venda) {
          return res.status(404).json({ error: 'Venda não encontrada.' });
        }
        if (String(venda.status || '').toLowerCase() === 'cancelada') {
          return res.status(400).json({ error: 'Venda cancelada não pode receber devolução.' });
        }

        db.serialize(() => {
          db.run('BEGIN IMMEDIATE');

          let index = 0;
          let valorTotalDevolvido = 0;
          const itensProcessados = [];

          function processarProximo() {
            if (index >= itensValidos.length) {
              return finalizar();
            }

            const itemReq = itensValidos[index++];
            db.get(`
              SELECT
                vi.*,
                COALESCE(p.nome, 'Produto') AS produto_nome,
                COALESCE((
                  SELECT SUM(vd.quantidade_fiscal)
                  FROM vendas_devolucoes vd
                  WHERE vd.venda_item_id = vi.id
                ), 0) AS qtd_fiscal_ja_devolvida,
                COALESCE((
                  SELECT SUM(vd.quantidade_nao_fiscal)
                  FROM vendas_devolucoes vd
                  WHERE vd.venda_item_id = vi.id
                ), 0) AS qtd_nao_fiscal_ja_devolvida,
                COALESCE((
                  SELECT SUM(vd.quantidade)
                  FROM vendas_devolucoes vd
                  WHERE vd.venda_item_id = vi.id
                ), 0) AS quantidade_ja_devolvida
              FROM vendas_itens vi
              LEFT JOIN produtos p ON p.id = vi.produto_id
              WHERE vi.id = ? AND vi.venda_id = ?
            `, [itemReq.venda_item_id, vendaId], (itemErr, item) => {
              if (itemErr) {
                db.run('ROLLBACK');
                return res.status(500).json({ error: itemErr.message });
              }
              if (!item) {
                db.run('ROLLBACK');
                return res.status(404).json({ error: 'Item da venda não encontrado.' });
              }

              const qtdsItem = resolverQuantidadesVendaItem(item);
              const qtdVendida = Number(qtdsItem.quantidade || 0);
              const qtdJaDevolvida = Number(item.quantidade_ja_devolvida || 0);
              const qtdDisponivel = qtdVendida - qtdJaDevolvida;
              const qtdDevolver = Number(itemReq.quantidade || 0);

              if (qtdDevolver > qtdDisponivel + 0.0009) {
                db.run('ROLLBACK');
                return res.status(400).json({
                  error: `Produto "${item.produto_nome}" permite devolver no máximo ${qtdDisponivel}.`
                });
              }

              const splitDevolucao = calcularDevolucaoVendaFiscalPrimeiro(item, qtdDevolver, {
                fiscal: item.qtd_fiscal_ja_devolvida,
                nao_fiscal: item.qtd_nao_fiscal_ja_devolvida
              });

              const valorUnitario = Number(item.preco_unitario || 0);
              const valorTotal = Number((splitDevolucao.qtdTotal * valorUnitario).toFixed(2));
              valorTotalDevolvido += valorTotal;

              db.run(`
                INSERT INTO vendas_devolucoes (
                  venda_id, venda_item_id, produto_id, quantidade,
                  quantidade_fiscal, quantidade_nao_fiscal,
                  valor_unitario, valor_total, motivo
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              `, [
                vendaId,
                item.id,
                item.produto_id,
                splitDevolucao.qtdTotal,
                splitDevolucao.qtdFiscal,
                splitDevolucao.qtdNaoFiscal,
                valorUnitario,
                valorTotal,
                motivo
              ], (insertErr) => {
                if (insertErr) {
                  db.run('ROLLBACK');
                  return res.status(500).json({ error: insertErr.message });
                }

                devolverSaldosDistribuidos(
                  item.produto_id,
                  splitDevolucao.qtdFiscal,
                  splitDevolucao.qtdNaoFiscal,
                  (estoqueErr) => {
                    if (estoqueErr) {
                      db.run('ROLLBACK');
                      return res.status(500).json({ error: estoqueErr.message });
                    }

                    itensProcessados.push({
                      venda_item_id: item.id,
                      produto_id: item.produto_id,
                      quantidade: splitDevolucao.qtdTotal,
                      quantidade_fiscal: splitDevolucao.qtdFiscal,
                      quantidade_nao_fiscal: splitDevolucao.qtdNaoFiscal,
                      valor_total: valorTotal
                    });

                    processarProximo();
                  }
                );
              });
            });
          }

          function finalizar() {
            db.run('COMMIT');
            res.json({
              success: true,
              message: 'Devolução registrada com sucesso.',
              venda_id: vendaId,
              valor_total_devolvido: Number(valorTotalDevolvido.toFixed(2)),
              itens: itensProcessados
            });
          }

          processarProximo();
        });
      });
    });
  });

  // Cancelar venda
  router.put('/:id/cancelar', validarCaixaAberto, (req, res) => {
    const { id } = req.params;
    const motivo = req.body.motivo || req.body.justificativa || '';

    db.get('SELECT * FROM vendas WHERE id = ?', [id], (err, venda) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      if (!venda) {
        res.status(404).json({ error: 'Venda não encontrada.' });
        return;
      }
      if (venda.status !== 'concluida') {
        res.status(400).json({ error: 'Apenas vendas concluídas podem ser canceladas.' });
        return;
      }

          gravarAuditoria({
            usuario_id: req.operadorId || req.user?.id || null,
            usuario_nome: req.user?.username || req.user?.nome || null,
            modulo: 'vendas',
            acao: 'cancelar_venda',
            referencia_tipo: 'venda',
            referencia_id: id,
            detalhes: { motivo_cancelamento: req.body.motivo || null, ip: req.ip, sessao_id: req.caixaSessaoId || null },
            ip_requisicao: req.ip || null
          }).catch((auditErr) => console.error('Erro ao gravar auditoria de cancelamento de venda:', auditErr));

      const executarCancelamentoVenda = () => {
      db.serialize(() => {
        db.run('BEGIN IMMEDIATE');

        db.all('SELECT * FROM vendas_itens WHERE venda_id = ?', [id], (itErr, itens) => {
          if (itErr) {
            db.run('ROLLBACK');
            res.status(500).json({ error: itErr.message });
            return;
          }

          const finalizarCancelamento = () => {
            cancelarRecebimentosVenda(id, (recErr) => {
              if (recErr) {
                db.run('ROLLBACK');
                res.status(500).json({ error: recErr.message });
                return;
              }

            db.run(`
              UPDATE vendas
              SET status = 'cancelada',
                  cancelada = 1,
                  data_cancelamento = CURRENT_TIMESTAMP
              WHERE id = ?
            `, [id], (upErr) => {
              if (upErr) {
                db.run('ROLLBACK');
                res.status(500).json({ error: upErr.message });
                return;
              }

              db.run(`
                INSERT INTO financeiro (
                  tipo, descricao, valor, data_movimento, categoria, forma_pagamento,
                  referencia_id, referencia_tipo, status, origem, documento, vencimento,
                  venda_id, baixado_em
                ) VALUES ('despesa', ?, ?, ?, 'estorno_venda', 'estorno', ?, 'estorno_venda', 'pago', 'cancelamento_venda', ?, ?, ?, ?)
              `, [
                `Estorno cancelamento ${venda.codigo}`,
                venda.total,
                venda.data_venda,
                id,
                venda.codigo,
                venda.data_venda,
                id,
                venda.data_venda
              ], (finErr) => {
                if (finErr) {
                  db.run('ROLLBACK');
                  res.status(500).json({ error: finErr.message });
                  return;
                }

                if (venda.forma_pagamento === 'credito' && venda.cliente_id) {
                  db.run(`
                    UPDATE clientes
                    SET credito_atual = CASE
                      WHEN (credito_atual - ?) < 0 THEN 0
                      ELSE credito_atual - ?
                    END
                    WHERE id = ?
                  `, [venda.total, venda.total, venda.cliente_id], (credErr) => {
                    if (credErr) {
                      db.run('ROLLBACK');
                      res.status(500).json({ error: credErr.message });
                      return;
                    }
                    db.run('COMMIT');
                    res.json({ message: 'Venda cancelada com sucesso' });
                  });
                } else {
                  db.run('COMMIT');
                  res.json({ message: 'Venda cancelada com sucesso' });
                }
              });
            });
            });
          };

          devolverEstoqueItensVenda(itens, (estErr) => {
            if (estErr) {
              db.run('ROLLBACK');
              res.status(500).json({ error: estErr.message });
              return;
            }
            finalizarCancelamento();
          });
        });
      });
      };

      buscarNfceAutorizadaVenda(id, (nfceErr, nfce) => {
        if (nfceErr) {
          return res.status(500).json({ error: nfceErr.message });
        }

        if (!nfce) {
          return executarCancelamentoVenda();
        }

        if (motivo.trim().length < 15) {
          return res.status(400).json({
            error: 'Justificativa deve ter no mínimo 15 caracteres para cancelar NFC-e autorizada.'
          });
        }

        cancelarNfceAutorizadaVenda(id, motivo)
          .then(() => executarCancelamentoVenda())
          .catch((cancelErr) => res.status(400).json({ error: cancelErr.message }));
      });
    });
  });

  // Cancelar venda não fiscal
  router.post('/cancelar/:id', validarCaixaAberto, (req, res) => {
    const vendaId = req.params.id;
    const { motivo } = req.body;

    db.get(
      'SELECT * FROM vendas WHERE id = ?',
      [vendaId],
      (err, venda) => {
        if (err || !venda) {
          return res.status(404).json({
            sucesso: false,
            mensagem: 'Venda não encontrada.'
          });
        }

        if (venda.cancelada === 1) {
          return res.status(400).json({
            sucesso: false,
            mensagem: 'Venda já cancelada.'
          });
        }

        const prosseguirCancelamento = () => {
          buscarNfceAutorizadaVenda(vendaId, (errNfce, nfceAutorizada) => {
            if (errNfce) {
              return res.status(500).json({
                sucesso: false,
                mensagem: 'Erro ao verificar NFC-e.'
              });
            }

            const executarCancelamentoLocal = () => {
              db.serialize(() => {
                db.run('BEGIN IMMEDIATE');

                db.all(
                  'SELECT * FROM vendas_itens WHERE venda_id = ?',
                  [vendaId],
                  (errItens, itens) => {
                    if (errItens) {
                      db.run('ROLLBACK');
                      return res.status(500).json({
                        sucesso: false,
                        mensagem: 'Erro ao buscar itens.'
                      });
                    }

                    devolverEstoqueItensVenda(itens, (estErr) => {
                      if (estErr) {
                        db.run('ROLLBACK');
                        return res.status(500).json({
                          sucesso: false,
                          mensagem: estErr.message
                        });
                      }

                      cancelarRecebimentosVenda(vendaId, (recErr) => {
                        if (recErr) {
                          db.run('ROLLBACK');
                          return res.status(500).json({
                            sucesso: false,
                            mensagem: recErr.message
                          });
                        }

                        db.run(
                          `
                          UPDATE vendas
                          SET
                            cancelada = 1,
                            status = 'cancelada',
                            data_cancelamento = CURRENT_TIMESTAMP
                          WHERE id = ?
                          `,
                          [vendaId],
                          function (errUpdate) {
                            if (errUpdate) {
                              db.run('ROLLBACK');
                              return res.status(500).json({
                                sucesso: false,
                                mensagem: errUpdate.message
                              });
                            }

                            db.run(
                              `
                              INSERT INTO vendas_canceladas (
                                venda_id,
                                motivo,
                                usuario_id
                              ) VALUES (?, ?, ?)
                              `,
                              [
                                vendaId,
                                motivo || 'Não informado',
                                req.operadorId || req.user?.id || null
                              ]
                            );

                            db.run(
                              `
                              UPDATE financeiro
                              SET
                                status = 'cancelado',
                                observacao = COALESCE(observacao, '') || ' | Cancelado automaticamente pela venda #' || ?
                              WHERE venda_id = ?
                              `,
                              [vendaId, vendaId],
                              function (errFinanceiro) {
                                if (errFinanceiro) {
                                  console.error('Erro ao cancelar financeiro da venda:', errFinanceiro.message);
                                }
                              }
                            );

                            db.run(
                              `
                              UPDATE contas_receber
                              SET
                                status = 'cancelado',
                                observacao = COALESCE(observacao, '') || ' | Cancelado automaticamente pela venda #' || ?
                              WHERE venda_id = ?
                              `,
                              [vendaId, vendaId],
                              (errReceber) => {
                                if (errReceber) {
                                  db.run('ROLLBACK');
                                  return res.status(500).json({
                                    sucesso: false,
                                    mensagem: errReceber.message
                                  });
                                }

                                db.run('COMMIT');
                                res.json({
                                  sucesso: true,
                                  mensagem: 'Venda cancelada com sucesso.'
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
            };

            if (!nfceAutorizada) {
              return executarCancelamentoLocal();
            }

            const justificativa = motivo || '';
            if (justificativa.trim().length < 15) {
              return res.status(400).json({
                sucesso: false,
                mensagem: 'Justificativa deve ter no mínimo 15 caracteres para cancelar NFC-e autorizada.'
              });
            }

            cancelarNfceAutorizadaVenda(vendaId, justificativa)
              .then(() => executarCancelamentoLocal())
              .catch((cancelErr) => res.status(400).json({
                sucesso: false,
                mensagem: cancelErr.message
              }));
          });
        };

        if (
          venda.status_pagamento === 'fiscal_pago' ||
          venda.status_pagamento === 'aguardando_nao_fiscal'
        ) {
          const estornarFiscal = venda.tef_transacao_id
            ? cancelarFiscal(venda.tef_transacao_id, motivo || 'Cancelamento de venda')
            : Promise.resolve();

          estornarFiscal
            .then(() => prosseguirCancelamento())
            .catch((tefErr) => {
              console.error('Erro ao cancelar pagamento fiscal TEF:', tefErr);
              return res.status(500).json({
                sucesso: false,
                mensagem: 'Erro ao estornar pagamento fiscal.'
              });
            });
          return;
        }

        prosseguirCancelamento();
      }
    );
  });

  // Excluir venda
  router.delete('/:id', (req, res) => {
    const id = Number(req.params.id);

    db.get(`
      SELECT *
      FROM vendas
      WHERE id = ?
    `, [id], (err, venda) => {

      if (err) {
        return res.status(500).json({ error: err.message });
      }

      if (!venda) {
        return res.status(404).json({ error: 'Venda não encontrada' });
      }

      if (venda.nfce_id) {
        return res.status(400).json({
          error: 'Venda fiscal não pode ser excluída. Cancele a NFC-e primeiro.'
        });
      }

      db.run(`
        DELETE FROM vendas_itens WHERE venda_id = ?
      `, [id], (errItens) => {

        if (errItens) {
          return res.status(500).json({ error: errItens.message });
        }

        db.run(`
          DELETE FROM vendas WHERE id = ?
        `, [id], (errVenda) => {

          if (errVenda) {
            return res.status(500).json({ error: errVenda.message });
          }

          res.json({
            success: true,
            message: 'Venda excluída com sucesso'
          });
        });
      });
    });
  });

  // Relatório de fechamento de caixa (resumo de vendas por período)
  router.get('/relatorio/fechamento-caixa', (req, res) => {
    const { data_inicio, data_fim, modo_fiscal } = req.query;

    if (!data_inicio || !data_fim) {
      return res.status(400).json({ error: 'data_inicio e data_fim são obrigatórios' });
    }

    const modoFiscal = modo_fiscal || '0';
    const exprValor = getExprValorVenda(modoFiscal);

    db.all(`
      SELECT
        forma_pagamento,
        COUNT(*) as quantidade,
        SUM(${exprValor}) as total
      FROM vendas v
      WHERE ${FILTRO_VENDA_VALIDA}
        AND date(v.data_venda) BETWEEN date(?) AND date(?)
      GROUP BY forma_pagamento
      ORDER BY total DESC
    `, [data_inicio, data_fim], (err, pagamentos) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      db.get(`
        SELECT
          COUNT(*) as quantidade_vendas,
          SUM(${exprValor}) as total_vendido,
          SUM(desconto) as total_descontos,
          AVG(${exprValor}) as ticket_medio
        FROM vendas v
        WHERE ${FILTRO_VENDA_VALIDA}
          AND date(v.data_venda) BETWEEN date(?) AND date(?)
      `, [data_inicio, data_fim], (errResumo, resumo) => {
        if (errResumo) {
          return res.status(500).json({ error: errResumo.message });
        }

        res.json({
          modo_fiscal_ativo: isModoFiscalRelatorio(modoFiscal),
          resumo: resumo || {
            quantidade_vendas: 0,
            total_vendido: 0,
            total_descontos: 0,
            ticket_medio: 0
          },
          pagamentos: pagamentos || []
        });
      });
    });
  });

  // Relatório de produtos mais vendidos
  router.get('/relatorio/produtos-mais-vendidos', (req, res) => {
    const { data_inicio, data_fim, modo_fiscal, limite } = req.query;

    if (!data_inicio || !data_fim) {
      return res.status(400).json({ error: 'data_inicio e data_fim são obrigatórios' });
    }

    const modoFiscal = modo_fiscal || '0';
    const exprValor = getExprValorItem(modoFiscal);
    const exprQtd = getExprQuantidadeItem(modoFiscal);
    const exprQtdFiscal = getExprQuantidadeItemFiscal();
    const exprQtdNaoFiscal = getExprQuantidadeItemNaoFiscal();
    const exprValorFiscal = getExprValorItem('1');
    const exprValorNaoFiscal = getExprValorItemNaoFiscal();
    const filtroItens = getFiltroItensFiscal(modoFiscal);
    const limit = Math.min(Math.max(parseInt(limite, 10) || 100, 1), 500);

    db.all(`
      SELECT
        p.id,
        p.codigo,
        p.nome,
        p.unidade,
        SUM(${exprQtd}) as quantidade_vendida,
        SUM(${exprQtdFiscal}) as quantidade_fiscal,
        SUM(${exprQtdNaoFiscal}) as quantidade_nao_fiscal,
        SUM(${exprValor}) as total_vendido,
        SUM(${exprValorFiscal}) as total_vendido_fiscal,
        SUM(${exprValorNaoFiscal}) as total_vendido_nao_fiscal,
        CASE
          WHEN SUM(${exprQtd}) > 0 THEN SUM(${exprValor}) / SUM(${exprQtd})
          ELSE AVG(vi.preco_unitario)
        END as preco_medio
      FROM vendas v
      INNER JOIN vendas_itens vi ON v.id = vi.venda_id
      INNER JOIN produtos p ON vi.produto_id = p.id
      WHERE ${FILTRO_VENDA_VALIDA}
        AND date(v.data_venda) BETWEEN date(?) AND date(?)
        ${filtroItens}
      GROUP BY p.id
      HAVING quantidade_vendida > 0
      ORDER BY total_vendido DESC
      LIMIT ?
    `, [data_inicio, data_fim, limit], (err, produtos) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      res.json({
        modo_fiscal_ativo: isModoFiscalRelatorio(modoFiscal),
        produtos: produtos || []
      });
    });
  });

  // Relatório de vendas por período
  router.get('/relatorio/periodo', (req, res) => {
    const { data_inicio, data_fim, modo_fiscal } = req.query;
    const modoFiscal = modo_fiscal || '0';
    const exprValor = getExprValorVenda(modoFiscal);

    db.all(`
      SELECT
        DATE(v.data_venda) as data,
        COUNT(*) as total_vendas,
        SUM(${exprValor}) as valor_total,
        AVG(${exprValor}) as valor_medio,
        SUM(CASE WHEN v.cliente_id IS NOT NULL THEN 1 ELSE 0 END) as vendas_com_cliente
      FROM vendas v
      WHERE ${FILTRO_VENDA_VALIDA}
        AND date(v.data_venda) BETWEEN date(?) AND date(?)
      GROUP BY DATE(v.data_venda)
      ORDER BY data DESC
    `, [data_inicio, data_fim], (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json({
        modo_fiscal_ativo: isModoFiscalRelatorio(modoFiscal),
        dias: rows || []
      });
    });
  });

  module.exports = router;
