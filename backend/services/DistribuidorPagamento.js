function distribuirPagamentos(pagamentos = [], totalFiscal = 0, totalNaoFiscal = 0) {
  let saldoFiscal = Number(totalFiscal);
  let saldoNaoFiscal = Number(totalNaoFiscal);

  const recebimentosFiscal = [];
  const recebimentosNaoFiscal = [];

  const prioridade = [
    'pix',
    'cartao_debito',
    'cartao_credito',
    'cartao',
    'dinheiro'
  ];

  pagamentos.sort((a, b) => {
    const pa = prioridade.indexOf(a.forma_pagamento);
    const pb = prioridade.indexOf(b.forma_pagamento);

    return pa - pb;
  });

  for (const pagamento of pagamentos) {
    let valorDisponivel = Number(pagamento.valor || 0);

    if (saldoFiscal > 0) {
      const valorFiscal = Math.min(saldoFiscal, valorDisponivel);

      if (valorFiscal > 0) {
        recebimentosFiscal.push({
          ...pagamento,
          valor: valorFiscal,
          tipo_recebimento: 'fiscal'
        });

        saldoFiscal -= valorFiscal;
        valorDisponivel -= valorFiscal;
      }
    }

    if (valorDisponivel > 0 && saldoNaoFiscal > 0) {
      const valorNaoFiscal = Math.min(saldoNaoFiscal, valorDisponivel);

      recebimentosNaoFiscal.push({
        ...pagamento,
        valor: valorNaoFiscal,
        tipo_recebimento: 'nao_fiscal'
      });

      saldoNaoFiscal -= valorNaoFiscal;
    }
  }

  return {
    recebimentosFiscal,
    recebimentosNaoFiscal,
    saldoFiscal,
    saldoNaoFiscal
  };
}

module.exports = {
  distribuirPagamentos
};
