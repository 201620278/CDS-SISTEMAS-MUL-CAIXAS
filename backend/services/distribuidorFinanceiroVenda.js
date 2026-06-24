function somarValoresDistribuidos(itens) {

  let totalFiscal = 0;
  let totalNaoFiscal = 0;

  for (const item of itens) {

    totalFiscal +=
      Number(item.valor_fiscal || 0);

    totalNaoFiscal +=
      Number(item.valor_nao_fiscal || 0);

  }

  return {
    totalFiscal:
      Number(totalFiscal.toFixed(2)),

    totalNaoFiscal:
      Number(totalNaoFiscal.toFixed(2))
  };

}

module.exports = {
  somarValoresDistribuidos
};
