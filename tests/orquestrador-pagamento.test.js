const assert = require('assert');
const {
  determinarStatusPagamento,
  montarRecebimentosParaGravar
} = require('../backend/services/OrquestradorPagamento');

function test(name, fn) {
  try {
    fn();
    console.log(`OK ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test('Cenário 1 — venda mista com fiscal processado aguarda não fiscal', () => {
  const status = determinarStatusPagamento({
    totalFiscal: 71.2,
    totalNaoFiscal: 35.6,
    fiscalProcessado: true,
    recebimentosNaoFiscalConfirmados: []
  });

  assert.strictEqual(status, 'aguardando_nao_fiscal');
});

test('Cenário 1 — venda mista não usa plano do distribuidor como quitada', () => {
  const status = determinarStatusPagamento({
    totalFiscal: 71.2,
    totalNaoFiscal: 35.6,
    fiscalProcessado: true,
    recebimentosNaoFiscalConfirmados: [
      { tipo_recebimento: 'nao_fiscal', valor: 35.6 }
    ]
  });

  assert.strictEqual(status, 'quitada');
});

test('Cenário 2 — venda totalmente fiscal quitada após processamento', () => {
  const status = determinarStatusPagamento({
    totalFiscal: 71.2,
    totalNaoFiscal: 0,
    fiscalProcessado: true,
    recebimentosNaoFiscalConfirmados: []
  });

  assert.strictEqual(status, 'quitada');
});

test('Cenário 3 — venda totalmente não fiscal quitada com recebimento confirmado', () => {
  const status = determinarStatusPagamento({
    totalFiscal: 0,
    totalNaoFiscal: 35.6,
    fiscalProcessado: true,
    recebimentosNaoFiscalConfirmados: [
      { tipo_recebimento: 'nao_fiscal', valor: 35.6 }
    ]
  });

  assert.strictEqual(status, 'quitada');
});

test('Cenário 3 — venda totalmente não fiscal pendente sem recebimento', () => {
  const status = determinarStatusPagamento({
    totalFiscal: 0,
    totalNaoFiscal: 35.6,
    fiscalProcessado: true,
    recebimentosNaoFiscalConfirmados: []
  });

  assert.strictEqual(status, 'pendente');
});

test('Montagem — venda mista grava somente recebimentos fiscais na 1ª etapa', () => {
  const recebimentos = montarRecebimentosParaGravar({
    distribuicao: {
      recebimentosFiscal: [
        { forma_pagamento: 'pix', valor: 71.2, tipo_recebimento: 'fiscal' }
      ],
      recebimentosNaoFiscal: [
        { forma_pagamento: 'pix', valor: 35.6, tipo_recebimento: 'nao_fiscal' }
      ]
    },
    statusPagamento: 'aguardando_nao_fiscal',
    totalFiscal: 71.2,
    totalNaoFiscal: 35.6
  });

  assert.strictEqual(recebimentos.length, 1);
  assert.strictEqual(recebimentos[0].tipo_recebimento, 'fiscal');
  assert.strictEqual(recebimentos[0].valor, 71.2);
});

test('Montagem — venda somente não fiscal grava recebimento não fiscal', () => {
  const recebimentos = montarRecebimentosParaGravar({
    distribuicao: {
      recebimentosFiscal: [],
      recebimentosNaoFiscal: [
        { forma_pagamento: 'dinheiro', valor: 35.6, tipo_recebimento: 'nao_fiscal' }
      ]
    },
    statusPagamento: 'quitada',
    totalFiscal: 0,
    totalNaoFiscal: 35.6
  });

  assert.strictEqual(recebimentos.length, 1);
  assert.strictEqual(recebimentos[0].tipo_recebimento, 'nao_fiscal');
});

console.log('Todos os testes do OrquestradorPagamento passaram.');
