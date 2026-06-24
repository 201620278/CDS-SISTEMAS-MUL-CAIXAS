function distribuirQuantidadeVenda(
  quantidadeVendida,
  saldoFiscal,
  saldoNaoFiscal
) {
  quantidadeVendida = Number(quantidadeVendida || 0);
  saldoFiscal = Number(saldoFiscal || 0);
  saldoNaoFiscal = Number(saldoNaoFiscal || 0);

  const estoqueTotal =
    saldoFiscal +
    saldoNaoFiscal;

  if (quantidadeVendida > estoqueTotal) {
    return {
      sucesso: false,
      estoqueTotal,
      mensagem: `Saldo insuficiente. Disponível: ${estoqueTotal}`
    };
  }

  const quantidadeFiscal =
    Math.min(
      quantidadeVendida,
      saldoFiscal
    );

  const quantidadeNaoFiscal =
    quantidadeVendida -
    quantidadeFiscal;

  return {
    sucesso: true,
    quantidadeFiscal,
    quantidadeNaoFiscal
  };
}

module.exports = {
  distribuirQuantidadeVenda
};
