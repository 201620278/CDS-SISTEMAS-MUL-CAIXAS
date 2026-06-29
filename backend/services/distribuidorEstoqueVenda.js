function parseVendaFiscalFlag(valor) {
  return valor === true
    || valor === 'true'
    || valor === 1
    || valor === '1';
}

/**
 * Distribui quantidade vendida entre saldo fiscal e não fiscal.
 * @param {boolean} vendaFiscal - true: consome fiscal primeiro; false: consome não fiscal primeiro
 */
function distribuirQuantidadeVenda(
  quantidadeVendida,
  saldoFiscal,
  saldoNaoFiscal,
  vendaFiscal = true
) {
  quantidadeVendida = Number(quantidadeVendida || 0);
  saldoFiscal = Number(saldoFiscal || 0);
  saldoNaoFiscal = Number(saldoNaoFiscal || 0);
  const priorizarFiscal = parseVendaFiscalFlag(vendaFiscal);

  const estoqueTotal = saldoFiscal + saldoNaoFiscal;

  if (quantidadeVendida > estoqueTotal) {
    return {
      sucesso: false,
      estoqueTotal,
      mensagem: `Saldo insuficiente. Disponível: ${estoqueTotal}`
    };
  }

  let quantidadeFiscal;
  let quantidadeNaoFiscal;

  if (priorizarFiscal) {
    quantidadeFiscal = Math.min(quantidadeVendida, saldoFiscal);
    quantidadeNaoFiscal = quantidadeVendida - quantidadeFiscal;
  } else {
    quantidadeNaoFiscal = Math.min(quantidadeVendida, saldoNaoFiscal);
    quantidadeFiscal = quantidadeVendida - quantidadeNaoFiscal;
  }

  return {
    sucesso: true,
    quantidadeFiscal,
    quantidadeNaoFiscal
  };
}

function distribuirItemVenda(item, saldoFiscal, saldoNaoFiscal, vendaFiscal = true) {
  const qtdVenda = Number(item.quantidade || 0);
  const qtdEstoque = item.quantidade_estoque != null && item.quantidade_estoque !== ''
    ? Number(item.quantidade_estoque)
    : qtdVenda;
  const precoUnitario = Number(item.preco_unitario || 0);

  const resultado = distribuirQuantidadeVenda(qtdEstoque, saldoFiscal, saldoNaoFiscal, vendaFiscal);
  if (!resultado.sucesso) {
    return resultado;
  }

  const subtotalVenda = Number((qtdVenda * precoUnitario).toFixed(2));
  let valorFiscal;
  let valorNaoFiscal;

  if (qtdEstoque > 0 && qtdEstoque !== qtdVenda) {
    const ratioFiscal = resultado.quantidadeFiscal / qtdEstoque;
    valorFiscal = Number((subtotalVenda * ratioFiscal).toFixed(2));
    valorNaoFiscal = Number((subtotalVenda - valorFiscal).toFixed(2));
  } else {
    valorFiscal = Number((resultado.quantidadeFiscal * precoUnitario).toFixed(2));
    valorNaoFiscal = Number((resultado.quantidadeNaoFiscal * precoUnitario).toFixed(2));
  }

  return {
    sucesso: true,
    quantidadeFiscal: resultado.quantidadeFiscal,
    quantidadeNaoFiscal: resultado.quantidadeNaoFiscal,
    valorFiscal,
    valorNaoFiscal,
    estoqueTotal: resultado.estoqueTotal
  };
}

module.exports = {
  parseVendaFiscalFlag,
  distribuirQuantidadeVenda,
  distribuirItemVenda
};
