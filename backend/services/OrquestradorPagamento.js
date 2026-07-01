/**
 * ORQUESTRADOR DE PAGAMENTOS - ARQUITETURA OFICIAL CDS SISTEMAS
 * 
 * Este é o ÚNICO local onde todas as decisões de pagamento devem existir.
 * O frontend (PDV) NÃO deve tomar nenhuma decisão de fluxo de pagamento.
 * 
 * FLUXO OBRIGATÓRIO:
 * Venda → Motor Fiscal → Distribuição (valor_fiscal, valor_nao_fiscal) → 
 * Motor Financeiro → 1º Recebimento Fiscal → Confirmação (TEF/Manual) → 
 * status = aguardando_nao_fiscal → 2º Recebimento Não Fiscal → 
 * status = quitada → NFC-e
 */

const tefManager = require('./tef/TefManager');
const tefContrato = require('./tef/tefContrato');
const tefConfigService = require('./tef/tefConfigService');
const tefFluxoPagamento = require('./tef/tefFluxoPagamento');
const { distribuirPagamentos } = require('./DistribuidorPagamento');
const configService = require('./configuracaoService');

/**
 * Processa o fluxo completo de pagamento de uma venda
 * Esta é a entrada principal do orquestrador
 */
async function processarFluxoPagamentoVenda({
  totalFiscal,
  totalNaoFiscal,
  formaPagamento,
  pagamentos,
  tefHabilitado,
  modoConfirmacaoFiscal
}) {
  // Validações básicas
  totalFiscal = Number(totalFiscal || 0);
  totalNaoFiscal = Number(totalNaoFiscal || 0);
  
  // Normalizar pagamentos de entrada
  const pagamentosEntrada = normalizarPagamentosEntrada(pagamentos, formaPagamento);
  
  // Distribuir pagamentos entre fiscal e não fiscal
  const distribuicao = distribuirPagamentos(pagamentosEntrada, totalFiscal, totalNaoFiscal);
  
  // Validar se o pagamento fiscal é suficiente
  if (distribuicao.saldoFiscal > 0) {
    return {
      sucesso: false,
      erro: 'Pagamento fiscal insuficiente.',
      distribuicao
    };
  }
  
  // Processar recebimento fiscal (TEF ou Confirmação Manual)
  const resultadoFiscal = await processarRecebimentoFiscal({
    recebimentosFiscal: distribuicao.recebimentosFiscal,
    totalFiscal,
    tefHabilitado,
    modoConfirmacaoFiscal,
    formaPagamento
  });
  
  if (!resultadoFiscal.sucesso) {
    return {
      sucesso: false,
      erro: resultadoFiscal.erro,
      tef: resultadoFiscal.tef,
      distribuicao
    };
  }
  
  // Determinar status do pagamento (somente recebimentos confirmados, nunca o plano do distribuidor)
  const recebimentosNaoFiscalConfirmados =
    totalFiscal > 0 && totalNaoFiscal > 0
      ? []
      : (distribuicao.recebimentosNaoFiscal || []);

  const statusPagamento = determinarStatusPagamento({
    totalFiscal,
    totalNaoFiscal,
    fiscalProcessado: resultadoFiscal.sucesso,
    recebimentosNaoFiscalConfirmados
  });

  // Montar recebimentos para gravar
  const recebimentosParaGravar = montarRecebimentosParaGravar({
    distribuicao,
    statusPagamento,
    totalFiscal,
    totalNaoFiscal,
    resultadoFiscal
  });
  
  return {
    sucesso: true,
    statusPagamento,
    recebimentos: recebimentosParaGravar,
    distribuicao,
    resultadoFiscal,
    proximaAcao: determinarProximaAcao(statusPagamento, totalNaoFiscal)
  };
}

/**
 * Processa o recebimento fiscal (TEF ou Confirmação Manual)
 */
async function processarRecebimentoFiscal({
  recebimentosFiscal,
  totalFiscal,
  tefHabilitado,
  modoConfirmacaoFiscal,
  formaPagamento
}) {
  // Se não há fiscal, não processa nada
  if (totalFiscal <= 0 || !recebimentosFiscal || recebimentosFiscal.length === 0) {
    return { sucesso: true, tipo: 'sem_fiscal' };
  }
  
  // Determinar se deve usar TEF ou confirmação manual
  const deveUsarTef = await deveUsarTEFParaFiscal({
    tefHabilitado,
    modoConfirmacaoFiscal,
    formaPagamento,
    totalFiscal
  });
  
  if (deveUsarTef) {
    return await processarTEFFiscal(recebimentosFiscal);
  } else {
    return await processarConfirmacaoManualFiscal(recebimentosFiscal);
  }
}

/**
 * Processa TEF para recebimentos fiscais
 */
async function processarTEFFiscal(recebimentosFiscal) {
  const tefConfig = await tefConfigService.obterConfiguracao();
  const tefOn = tefFluxoPagamento.parseTefHabilitado(tefConfig.tefHabilitado);
  
  if (!tefOn) {
    return { sucesso: false, erro: 'TEF desabilitado no sistema.' };
  }
  
  // Filtrar apenas recebimentos que exigem TEF
  const recebimentosTEF = recebimentosFiscal.filter(r => 
    tefFluxoPagamento.formaPagamentoUsaTEF(r.forma_pagamento)
  );
  
  if (recebimentosTEF.length === 0) {
    // Não há TEF, considerar como confirmado manualmente
    return { sucesso: true, tipo: 'manual', recebimentos: recebimentosFiscal };
  }
  
  const transacoesAutorizadas = [];
  
  for (const recebimento of recebimentosTEF) {
    // Se já tem transação TEF, apenas valida
    if (recebimento.tef_transacao_id) {
      transacoesAutorizadas.push(recebimento.tef_transacao_id);
      continue;
    }
    
    try {
      const tipoTef = tefFluxoPagamento.normalizarTipoTef(recebimento.forma_pagamento);
      const retornoTEF = await tefManager.autorizar({
        venda_id: null,
        tipo: tipoTef,
        valor: recebimento.valor,
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
        return { 
          sucesso: false, 
          erro: retornoTEF.mensagem || 'Pagamento TEF não aprovado',
          tef: retornoTEF 
        };
      }
      
      if (retornoTEF.transacao_id) {
        transacoesAutorizadas.push(retornoTEF.transacao_id);
        recebimento.tef_transacao_id = retornoTEF.transacao_id;
        recebimento.nsu = retornoTEF.nsu;
        recebimento.autorizacao = retornoTEF.autorizacao;
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
  
  return { 
    sucesso: true, 
    tipo: 'tef', 
    transacoes: transacoesAutorizadas,
    recebimentos: recebimentosFiscal 
  };
}

/**
 * Processa confirmação manual do recebimento fiscal
 */
async function processarConfirmacaoManualFiscal(recebimentosFiscal) {
  // Confirmação manual apenas marca como aprovado
  const recebimentosConfirmados = recebimentosFiscal.map(r => ({
    ...r,
    status: 'aprovado'
  }));
  
  return { 
    sucesso: true, 
    tipo: 'manual', 
    recebimentos: recebimentosConfirmados 
  };
}

/**
 * Determina se deve usar TEF para pagamento fiscal
 */
async function deveUsarTEFParaFiscal({
  tefHabilitado,
  modoConfirmacaoFiscal,
  formaPagamento,
  totalFiscal
}) {
  if (totalFiscal <= 0) return false;
  
  const tefOn = tefFluxoPagamento.parseTefHabilitado(tefHabilitado);
  if (!tefOn) return false;
  
  const modoManual = String(modoConfirmacaoFiscal || 'TEF').toUpperCase() === 'MANUAL';
  if (modoManual) return false;
  
  // Verificar se a forma de pagamento exige TEF
  const formaNormalizada = tefFluxoPagamento.normalizarFormaPagamentoTEF(formaPagamento);
  return tefFluxoPagamento.formaPagamentoUsaTEF(formaNormalizada);
}

/**
 * Determina o status do pagamento.
 * A distribuição matemática NÃO confirma recebimento — apenas recebimentos efetivos.
 */
function determinarStatusPagamento({
  totalFiscal,
  totalNaoFiscal,
  fiscalProcessado,
  recebimentosNaoFiscalConfirmados
}) {
  const temFiscal = totalFiscal > 0;
  const temNaoFiscal = totalNaoFiscal > 0;
  const confirmados = Array.isArray(recebimentosNaoFiscalConfirmados)
    ? recebimentosNaoFiscalConfirmados
    : [];

  const totalConfirmadoNaoFiscal = confirmados.reduce(
    (acc, recebimento) => acc + Number(recebimento.valor || 0),
    0
  );
  const naoFiscalConfirmado =
    confirmados.length > 0
    && Math.abs(totalConfirmadoNaoFiscal - totalNaoFiscal) <= 0.01;

  if (!temFiscal && !temNaoFiscal) {
    return 'quitada';
  }

  // Venda mista: fiscal + não fiscal — 2ª etapa obrigatória
  if (temFiscal && temNaoFiscal) {
    if (!fiscalProcessado) {
      return 'pendente';
    }

    if (naoFiscalConfirmado) {
      return 'quitada';
    }

    return 'aguardando_nao_fiscal';
  }

  // Venda somente não fiscal — pagamento único na criação
  if (!temFiscal && temNaoFiscal) {
    return naoFiscalConfirmado ? 'quitada' : 'pendente';
  }

  // Venda somente fiscal
  if (temFiscal && !temNaoFiscal) {
    return fiscalProcessado ? 'quitada' : 'pendente';
  }

  return 'pendente';
}

/**
 * Monta os recebimentos para gravar no banco.
 * Venda mista na 1ª etapa grava somente recebimentos fiscais.
 */
function montarRecebimentosParaGravar({
  distribuicao,
  statusPagamento,
  totalFiscal,
  totalNaoFiscal,
  resultadoFiscal
}) {
  const { recebimentosFiscal, recebimentosNaoFiscal } = distribuicao;
  const vendaMista = Number(totalFiscal || 0) > 0 && Number(totalNaoFiscal || 0) > 0;
  const somenteFiscal =
    statusPagamento === 'aguardando_nao_fiscal'
    || vendaMista;

  if (somenteFiscal) {
    return recebimentosFiscal.map((recebimento) => ({
      ...recebimento,
      tipo_recebimento: 'fiscal',
      status: 'aprovado'
    }));
  }

  return [
    ...recebimentosFiscal.map((recebimento) => ({
      ...recebimento,
      tipo_recebimento: recebimento.tipo_recebimento || 'fiscal',
      status: 'aprovado'
    })),
    ...recebimentosNaoFiscal.map((recebimento) => ({
      ...recebimento,
      tipo_recebimento: 'nao_fiscal',
      status: 'aprovado'
    }))
  ];
}

/**
 * Determina a próxima ação a ser executada
 */
function determinarProximaAcao(statusPagamento, totalNaoFiscal) {
  if (statusPagamento === 'aguardando_nao_fiscal') {
    return 'registrar_pagamento_nao_fiscal';
  }
  
  if (statusPagamento === 'quitada' && totalNaoFiscal > 0) {
    return 'emitir_nfce';
  }
  
  if (statusPagamento === 'quitada') {
    return 'concluida';
  }
  
  return 'aguardando';
}

/**
 * Normaliza os pagamentos de entrada
 */
function normalizarPagamentosEntrada(pagamentos, formaPagamentoPadrao) {
  if (!Array.isArray(pagamentos) || pagamentos.length === 0) {
    // Se não informou pagamentos, cria um com a forma padrão
    return [{
      forma_pagamento: formaPagamentoPadrao || 'dinheiro',
      valor: 0 // Será ajustado pelo distribuidor
    }];
  }
  
  return pagamentos.map(p => ({
    forma_pagamento: p.forma_pagamento || formaPagamentoPadrao || 'dinheiro',
    valor: Number(p.valor || 0),
    tef_transacao_id: p.tef_transacao_id || null,
    nsu: p.nsu || null,
    autorizacao: p.autorizacao || null
  }));
}

/**
 * Processa o pagamento não fiscal (segunda etapa do fluxo)
 */
async function processarPagamentoNaoFiscal({
  vendaId,
  valorNaoFiscal,
  pagamentosInformados
}) {
  const totalInformado = pagamentosInformados.reduce(
    (acc, p) => acc + Number(p.valor || 0),
    0
  );
  
  if (Math.abs(totalInformado - valorNaoFiscal) > 0.01) {
    return {
      sucesso: false,
      erro: 'Valor informado não confere com o saldo não fiscal pendente.',
      saldo_pendente: valorNaoFiscal
    };
  }
  
  const recebimentos = pagamentosInformados.map(pagamento => ({
    tipo_recebimento: 'nao_fiscal',
    forma_pagamento: String(pagamento.forma_pagamento).toLowerCase().trim(),
    valor: Number(pagamento.valor || 0),
    tef_transacao_id: null,
    nsu: pagamento.nsu || null,
    autorizacao: pagamento.autorizacao || null,
    status: 'aprovado'
  }));
  
  return {
    sucesso: true,
    recebimentos,
    statusPagamento: 'quitada'
  };
}

module.exports = {
  processarFluxoPagamentoVenda,
  processarPagamentoNaoFiscal,
  determinarStatusPagamento,
  montarRecebimentosParaGravar
};
