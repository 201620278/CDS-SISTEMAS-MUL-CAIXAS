/**
 * Testes unitários — regra TEF automático vs confirmação manual.
 * Executar: node tests/tef/tef-fluxo-pagamento.test.js
 */
const assert = require('assert');
const fluxo = require('../../backend/services/tef/tefFluxoPagamento');

let passou = 0;
let falhou = 0;

function test(nome, fn) {
  try {
    fn();
    passou += 1;
    console.log(`  OK  ${nome}`);
  } catch (error) {
    falhou += 1;
    console.error(`  FALHOU  ${nome}`);
    console.error(`         ${error.message}`);
  }
}

console.log('=== TESTES UNITÁRIOS — FLUXO TEF / MANUAL ===\n');

test('TEF habilitado + modo MANUAL + cartão → TEF automático', () => {
  const r = fluxo.resolverFluxoPagamentoFiscal({
    modoConfirmacaoFiscal: 'MANUAL',
    tefHabilitado: true,
    formaPagamento: 'cartao',
    ehPagamentoMisto: false,
    pagamentosMistos: [],
    totalFiscal: 50
  });
  assert.strictEqual(r.deveUsarTefAutomatico, true);
  assert.strictEqual(r.usarConfirmacaoManual, false);
});

test('TEF desabilitado + modo MANUAL + cartão → confirmação manual', () => {
  const r = fluxo.resolverFluxoPagamentoFiscal({
    modoConfirmacaoFiscal: 'MANUAL',
    tefHabilitado: false,
    formaPagamento: 'cartao',
    ehPagamentoMisto: false,
    pagamentosMistos: [],
    totalFiscal: 50
  });
  assert.strictEqual(r.deveUsarTefAutomatico, false);
  assert.strictEqual(r.usarConfirmacaoManual, true);
});

test('TEF habilitado + modo TEF + cartão → TEF automático', () => {
  const r = fluxo.resolverFluxoPagamentoFiscal({
    modoConfirmacaoFiscal: 'TEF',
    tefHabilitado: 'true',
    formaPagamento: 'cartao_debito',
    ehPagamentoMisto: false,
    pagamentosMistos: [],
    totalFiscal: 10
  });
  assert.strictEqual(r.deveUsarTefAutomatico, true);
  assert.strictEqual(r.usarConfirmacaoManual, false);
});

test('TEF habilitado + modo MANUAL + dinheiro → manual (sem TEF)', () => {
  const r = fluxo.resolverFluxoPagamentoFiscal({
    modoConfirmacaoFiscal: 'MANUAL',
    tefHabilitado: true,
    formaPagamento: 'dinheiro',
    ehPagamentoMisto: false,
    pagamentosMistos: [],
    totalFiscal: 30
  });
  assert.strictEqual(r.pagamentoExigeTef, false);
  assert.strictEqual(r.deveUsarTefAutomatico, false);
  assert.strictEqual(r.usarConfirmacaoManual, true);
});

test('Pagamento misto com cartão exige TEF quando habilitado', () => {
  const r = fluxo.resolverFluxoPagamentoFiscal({
    modoConfirmacaoFiscal: 'MANUAL',
    tefHabilitado: 1,
    formaPagamento: 'misto',
    ehPagamentoMisto: true,
    pagamentosMistos: [
      { forma_pagamento: 'dinheiro', valor: 20 },
      { forma_pagamento: 'cartao_credito', valor: 30 }
    ],
    totalFiscal: 50
  });
  assert.strictEqual(r.pagamentoExigeTef, true);
  assert.strictEqual(r.deveUsarTefAutomatico, true);
  assert.strictEqual(r.usarConfirmacaoManual, false);
});

test('Backend: TEF habilitado não pula autorização mesmo com modo MANUAL global', () => {
  const pular = fluxo.devePularAutorizacaoTefBackend({
    pagamentosJaProcessados: false,
    confirmacaoManualFlag: false,
    tefHabilitado: true,
    modoGlobalConfirmacaoFiscal: 'MANUAL'
  });
  assert.strictEqual(pular, false);
});

test('Backend: modo MANUAL global sem TEF pula autorização', () => {
  const pular = fluxo.devePularAutorizacaoTefBackend({
    pagamentosJaProcessados: false,
    confirmacaoManualFlag: false,
    tefHabilitado: false,
    modoGlobalConfirmacaoFiscal: 'MANUAL'
  });
  assert.strictEqual(pular, true);
});

test('Backend: pagamentos já processados no PDV sempre pulam re-autorização', () => {
  const pular = fluxo.devePularAutorizacaoTefBackend({
    pagamentosJaProcessados: true,
    confirmacaoManualFlag: false,
    tefHabilitado: false,
    modoGlobalConfirmacaoFiscal: 'TEF'
  });
  assert.strictEqual(pular, true);
});

test('formaPagamentoUsaTEF reconhece cartão e PIX', () => {
  assert.strictEqual(fluxo.formaPagamentoUsaTEF('cartao_credito'), true);
  assert.strictEqual(fluxo.formaPagamentoUsaTEF('cartao'), true);
  assert.strictEqual(fluxo.formaPagamentoUsaTEF('pix'), true);
  assert.strictEqual(fluxo.formaPagamentoUsaTEF('pix_tef'), true);
  assert.strictEqual(fluxo.formaPagamentoUsaTEF('dinheiro'), false);
});

test('normalizarTipoTef converte pix → pix_tef', () => {
  assert.strictEqual(fluxo.normalizarTipoTef('pix'), 'pix_tef');
  assert.strictEqual(fluxo.normalizarTipoTef('PIX'), 'pix_tef');
  assert.strictEqual(fluxo.normalizarTipoTef('cartao_debito'), 'cartao_debito');
});

test('formaPagamentoGravacaoFiscal grava pix_tef como pix na NFC-e', () => {
  assert.strictEqual(fluxo.formaPagamentoGravacaoFiscal('pix_tef'), 'pix');
  assert.strictEqual(fluxo.formaPagamentoGravacaoFiscal('pix'), 'pix');
  assert.strictEqual(fluxo.formaPagamentoGravacaoFiscal('cartao_credito'), 'cartao_credito');
});

test('TEF habilitado + modo MANUAL + PIX → TEF automático (PIX TEF)', () => {
  const r = fluxo.resolverFluxoPagamentoFiscal({
    modoConfirmacaoFiscal: 'MANUAL',
    tefHabilitado: true,
    formaPagamento: 'pix',
    ehPagamentoMisto: false,
    pagamentosMistos: [],
    totalFiscal: 25
  });
  assert.strictEqual(r.pagamentoExigeTef, true);
  assert.strictEqual(r.deveUsarTefAutomatico, true);
  assert.strictEqual(r.usarConfirmacaoManual, false);
});

test('Pagamento misto dinheiro + PIX exige TEF quando habilitado', () => {
  const r = fluxo.resolverFluxoPagamentoFiscal({
    modoConfirmacaoFiscal: 'MANUAL',
    tefHabilitado: true,
    formaPagamento: 'misto',
    ehPagamentoMisto: true,
    pagamentosMistos: [
      { forma_pagamento: 'dinheiro', valor: 10 },
      { forma_pagamento: 'pix', valor: 15 }
    ],
    totalFiscal: 25
  });
  assert.strictEqual(r.pagamentoExigeTef, true);
  assert.strictEqual(r.deveUsarTefAutomatico, true);
});

console.log(`\n=== RESULTADO: ${passou} ok, ${falhou} falhou ===\n`);
process.exit(falhou > 0 ? 1 : 0);
