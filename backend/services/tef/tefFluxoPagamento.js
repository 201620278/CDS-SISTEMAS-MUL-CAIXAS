/**
 * Regras de fluxo PDV/backend: TEF habilitado prevalece sobre confirmação fiscal manual
 * para pagamentos em cartão (e demais formas TEF).
 */

function normalizarFormaPagamentoTEF(forma) {
  return String(forma || '')
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

const FORMAS_TEF = new Set([
  'cartao',
  'cartao_credito',
  'cartao_debito',
  'credito',
  'debito',
  'pix',
  'pix_tef',
  'tef'
]);

function formaPagamentoUsaTEF(forma) {
  return FORMAS_TEF.has(normalizarFormaPagamentoTEF(forma));
}

function normalizarTipoTef(tipo) {
  const forma = normalizarFormaPagamentoTEF(tipo);
  if (forma === 'pix') {
    return 'pix_tef';
  }
  return forma;
}

function formaPagamentoGravacaoFiscal(forma) {
  const normalizada = normalizarFormaPagamentoTEF(forma);
  if (normalizada === 'pix_tef') {
    return 'pix';
  }
  return normalizada;
}

function ehPagamentoPixTef(tipo) {
  return normalizarTipoTef(tipo) === 'pix_tef';
}

function parseTefHabilitado(valor) {
  return valor === true || valor === 'true' || valor === '1' || valor === 1;
}

function pagamentoMistoExigeTef(pagamentos) {
  return (pagamentos || []).some((pagamento) =>
    formaPagamentoUsaTEF(pagamento?.forma_pagamento)
  );
}

function resolverFluxoPagamentoFiscal({
  modoConfirmacaoFiscal,
  tefHabilitado,
  formaPagamento,
  ehPagamentoMisto,
  pagamentosMistos,
  totalFiscal
}) {
  const formaNormalizada = normalizarFormaPagamentoTEF(formaPagamento);
  const pagamentoExigeTef = ehPagamentoMisto
    ? pagamentoMistoExigeTef(pagamentosMistos)
    : formaPagamentoUsaTEF(formaNormalizada);
  const tefOn = parseTefHabilitado(tefHabilitado);
  const deveUsarTefAutomatico = tefOn && pagamentoExigeTef;
  const modoManual = String(modoConfirmacaoFiscal || 'TEF').toUpperCase() === 'MANUAL';
  const usarConfirmacaoManual = modoManual
    && Number(totalFiscal) > 0
    && !deveUsarTefAutomatico;

  return {
    formaNormalizada,
    pagamentoExigeTef,
    deveUsarTefAutomatico,
    usarConfirmacaoManual
  };
}

function isConfirmacaoFiscalManualFlag(confirmacaoManualFlag, modoGlobalConfirmacaoFiscal) {
  if (
    confirmacaoManualFlag === true
    || confirmacaoManualFlag === 'true'
    || confirmacaoManualFlag === 1
    || confirmacaoManualFlag === '1'
  ) {
    return true;
  }
  return String(modoGlobalConfirmacaoFiscal || 'TEF').toUpperCase() === 'MANUAL';
}

function devePularAutorizacaoTefBackend({
  pagamentosJaProcessados,
  confirmacaoManualFlag,
  tefHabilitado,
  modoGlobalConfirmacaoFiscal
}) {
  if (pagamentosJaProcessados) {
    return true;
  }

  const manual = isConfirmacaoFiscalManualFlag(
    confirmacaoManualFlag,
    modoGlobalConfirmacaoFiscal
  );

  return manual && !parseTefHabilitado(tefHabilitado);
}

module.exports = {
  normalizarFormaPagamentoTEF,
  formaPagamentoUsaTEF,
  normalizarTipoTef,
  formaPagamentoGravacaoFiscal,
  ehPagamentoPixTef,
  parseTefHabilitado,
  pagamentoMistoExigeTef,
  resolverFluxoPagamentoFiscal,
  isConfirmacaoFiscalManualFlag,
  devePularAutorizacaoTefBackend
};
