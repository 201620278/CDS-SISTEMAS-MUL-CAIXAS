/**
 * Motor de Conversão de Unidades
 * Converte embalagens de compra (rolo, galão, fardo…) para a unidade real de estoque/venda (MT, KG, LT…).
 * Campo persistido: produto_fracionado (alias legado de vendido_por_peso).
 */

function moeda(value) {
  const numero = Number(value || 0);
  return Number.isFinite(numero) ? Math.round(numero * 100) / 100 : 0;
}

function custoUnitarioVenda(value) {
  const numero = Number(value || 0);
  return Number.isFinite(numero) ? Math.round(numero * 10000) / 10000 : 0;
}

function produtoUsaConversaoUnidades(produto = {}) {
  return Number(produto.produto_fracionado ?? produto.vendido_por_peso ?? 0) === 1;
}

function itemCompraUsaConversaoUnidades(item = {}) {
  return produtoUsaConversaoUnidades(item);
}

function resolverQuantidadesCompraItem(item = {}) {
  const hasSplit = item.quantidade_fiscal !== undefined || item.quantidade_nao_fiscal !== undefined;

  if (hasSplit) {
    const quantidade_fiscal = Number(item.quantidade_fiscal || 0);
    const quantidade_nao_fiscal = Number(item.quantidade_nao_fiscal || 0);
    const quantidade = quantidade_fiscal + quantidade_nao_fiscal;
    return { quantidade_fiscal, quantidade_nao_fiscal, quantidade };
  }

  const quantidade = Number(item.quantidade || 0);
  if (Number(item.item_fiscal) === 0) {
    return {
      quantidade_fiscal: 0,
      quantidade_nao_fiscal: quantidade,
      quantidade
    };
  }

  return {
    quantidade_fiscal: quantidade,
    quantidade_nao_fiscal: 0,
    quantidade
  };
}

function obterTotalConvertidoItemCompra(item = {}) {
  const qtdEmbalagens = Number(item.quantidade_embalagens || 0);
  const qtdPorEmbalagem = Number(item.quantidade_por_embalagem || 0);
  if (qtdEmbalagens > 0 && qtdPorEmbalagem > 0) {
    return qtdEmbalagens * qtdPorEmbalagem;
  }
  return Number(item.peso_total_compra || 0);
}

function simularConversaoEmbalagem({ qtdEmbalagens, qtdPorEmbalagem, valorTotal }) {
  const qtdTotal = Number(qtdEmbalagens || 0) * Number(qtdPorEmbalagem || 0);
  const valor = Number(valorTotal || 0);
  const custoUnitario = qtdTotal > 0 ? custoUnitarioVenda(valor / qtdTotal) : 0;
  return { qtdTotal, custoUnitario, valorTotal: valor };
}

function resolverCustoUnitarioCadastro(item = {}) {
  const usaConversao = itemCompraUsaConversaoUnidades(item);
  const quantidade = Number(item.quantidade || 0);

  if (usaConversao) {
    const custoRateado = Number(item.custo_unitario_final || 0);
    if (custoRateado > 0) {
      return custoUnitarioVenda(custoRateado);
    }

    const valorTotal = Number(item.valor_total_embalagem || item.subtotal || 0);
    if (valorTotal > 0 && quantidade > 0) {
      return custoUnitarioVenda(valorTotal / quantidade);
    }

    const custoInformado = Number(item.custo_por_kg || item.preco_unitario || 0);
    const valorEmbalagem = Number(item.valor_total_embalagem || 0);
    if (valorEmbalagem > 0 && Math.abs(custoInformado - valorEmbalagem) < 0.01 && quantidade > 0) {
      return custoUnitarioVenda(valorEmbalagem / quantidade);
    }

    return custoUnitarioVenda(custoInformado);
  }

  return moeda(Number(item.custo_unitario_final || item.preco_unitario || 0));
}

function resolverCustoUnitarioProdutoCadastro(produto = {}) {
  if (!produtoUsaConversaoUnidades(produto)) {
    return custoUnitarioVenda(produto.preco_compra);
  }

  const pesoTotal = Number(produto.peso_total_compra || 0);
  const valorTotal = Number(produto.valor_total_compra || 0);
  const custoLegado = Number(produto.custo_por_kg || 0);
  const precoCompra = Number(produto.preco_compra || 0);

  let unitarioReferencia = 0;
  if (pesoTotal > 0 && valorTotal > 0) {
    unitarioReferencia = custoUnitarioVenda(valorTotal / pesoTotal);
  } else if (pesoTotal > 1 && precoCompra > 0) {
    unitarioReferencia = custoUnitarioVenda(precoCompra / pesoTotal);
  }

  if (custoLegado > 0) {
    const pareceEmbalagem = precoCompra <= 0
      || (valorTotal > 0 && Math.abs(precoCompra - valorTotal) < 0.02)
      || (unitarioReferencia > 0 && precoCompra >= unitarioReferencia * 3);
    if (pareceEmbalagem && custoLegado < precoCompra) {
      return custoUnitarioVenda(custoLegado);
    }
  }

  if (unitarioReferencia > 0) {
    const pareceEmbalagem = precoCompra <= 0
      || (valorTotal > 0 && Math.abs(precoCompra - valorTotal) < 0.02)
      || precoCompra >= unitarioReferencia * 3;
    if (pareceEmbalagem) {
      return unitarioReferencia;
    }
  }

  return custoUnitarioVenda(precoCompra);
}

function resolverPrecosCadastroAposCompra(item = {}) {
  const atualizarVenda = Number(item.atualizar_preco_venda ?? 1) === 1;
  const margem = Number(item.margem_lucro ?? 30);
  const precoCompra = resolverCustoUnitarioCadastro(item);
  const precoVenda = atualizarVenda && precoCompra > 0
    ? moeda(precoCompra * (1 + margem / 100))
    : null;

  return {
    precoCompra,
    lucroPercentual: margem,
    precoVenda,
    atualizarVenda
  };
}

function validarDistribuicaoConversaoUnidadesItem(item = {}) {
  if (!itemCompraUsaConversaoUnidades(item)) return null;

  const qtds = resolverQuantidadesCompraItem(item);
  const totalConvertido = obterTotalConvertidoItemCompra(item);
  const nome = String(item.produto_nome || item.produto_id || 'Produto').trim();

  if (totalConvertido <= 0) {
    return `${nome}: informe a conversão de unidades antes da distribuição fiscal.`;
  }

  const soma = Number(qtds.quantidade_fiscal || 0) + Number(qtds.quantidade_nao_fiscal || 0);
  if (soma <= 0) {
    return `${nome}: informe quantidades absolutas em fiscal e/ou não fiscal.`;
  }

  if (Math.abs(soma - totalConvertido) > 0.001) {
    return `${nome}: fiscal (${qtds.quantidade_fiscal}) + não fiscal (${qtds.quantidade_nao_fiscal}) deve somar ${totalConvertido} (total convertido).`;
  }

  return null;
}

function resolverQuantidadesEstoqueCompraItem(item = {}) {
  if (!itemCompraUsaConversaoUnidades(item)) {
    return {
      ...resolverQuantidadesCompraItem(item),
      quantidade_convertida: Number(resolverQuantidadesCompraItem(item).quantidade || 0)
    };
  }

  const qtds = resolverQuantidadesCompraItem(item);
  const totalConvertido = obterTotalConvertidoItemCompra(item);
  const qtdEmbalagens = Number(item.quantidade_embalagens || 0);
  const quantidade_fiscal = Number(qtds.quantidade_fiscal || 0);
  const quantidade_nao_fiscal = Number(qtds.quantidade_nao_fiscal || 0);
  const somaInformada = quantidade_fiscal + quantidade_nao_fiscal;

  let quantidade = somaInformada > 0 ? somaInformada : totalConvertido;
  if (quantidade <= 0) {
    quantidade = Number(item.peso_total_compra || item.quantidade || 0);
  }

  if (qtdEmbalagens > 0 && Math.abs(quantidade - qtdEmbalagens) < 0.001 && totalConvertido > qtdEmbalagens) {
    quantidade = totalConvertido;
  }
  if (totalConvertido > 0 && qtdEmbalagens > 0 && Math.abs(quantidade - qtdEmbalagens) < 0.001) {
    quantidade = totalConvertido;
  }

  const quantidade_convertida = totalConvertido > 0 ? totalConvertido : quantidade;

  if (somaInformada <= 0 && quantidade_convertida > 0) {
    return {
      quantidade_fiscal: quantidade_convertida,
      quantidade_nao_fiscal: 0,
      quantidade: quantidade_convertida,
      quantidade_convertida
    };
  }

  return {
    quantidade_fiscal,
    quantidade_nao_fiscal,
    quantidade: somaInformada > 0 ? somaInformada : quantidade_convertida,
    quantidade_convertida
  };
}

function calcularSubtotalFinanceiroItemCompra(item = {}) {
  const qtds = itemCompraUsaConversaoUnidades(item)
    ? resolverQuantidadesEstoqueCompraItem(item)
    : resolverQuantidadesCompraItem(item);
  const quantidade = Number(qtds.quantidade || 0);
  const precoUnitario = itemCompraUsaConversaoUnidades(item)
    ? resolverCustoUnitarioCadastro({ ...item, ...qtds })
    : moeda(item.custo_unitario_final || item.preco_unitario || 0);

  return moeda(quantidade * precoUnitario);
}

function montarItemCompraConversaoUnidades({
  produto_nome = 'Produto teste',
  compra_em = 'Rolo',
  quantidade_embalagens,
  quantidade_por_embalagem,
  valor_total_embalagem,
  quantidade_fiscal = 0,
  quantidade_nao_fiscal = 0,
  unidade = 'MT',
  margem_lucro = 30
}) {
  const conv = simularConversaoEmbalagem({
    qtdEmbalagens: quantidade_embalagens,
    qtdPorEmbalagem: quantidade_por_embalagem,
    valorTotal: valor_total_embalagem
  });

  const item = {
    produto_fracionado: 1,
    vendido_por_peso: 1,
    produto_nome,
    compra_em,
    quantidade_embalagens,
    quantidade_por_embalagem,
    valor_total_embalagem,
    unidade,
    margem_lucro,
    quantidade_fiscal,
    quantidade_nao_fiscal,
    peso_total_compra: conv.qtdTotal,
    preco_unitario: conv.custoUnitario,
    custo_unitario_final: conv.custoUnitario,
    custo_por_kg: conv.custoUnitario
  };

  const qtds = resolverQuantidadesEstoqueCompraItem(item);
  const precos = resolverPrecosCadastroAposCompra({ ...item, ...qtds, quantidade: qtds.quantidade });
  const subtotal = calcularSubtotalFinanceiroItemCompra({ ...item, ...qtds, quantidade: qtds.quantidade });

  return {
    ...item,
    ...qtds,
    quantidade: qtds.quantidade,
    preco_unitario: precos.precoCompra,
    preco_venda_sugerido: precos.precoVenda,
    subtotal
  };
}

const produtoEhFracionado = produtoUsaConversaoUnidades;
const itemCompraEhFracionado = itemCompraUsaConversaoUnidades;
const validarDistribuicaoFracionadoItem = validarDistribuicaoConversaoUnidadesItem;
const montarItemCompraFracionado = montarItemCompraConversaoUnidades;

module.exports = {
  moeda,
  custoUnitarioVenda,
  produtoUsaConversaoUnidades,
  produtoEhFracionado,
  itemCompraUsaConversaoUnidades,
  itemCompraEhFracionado,
  resolverQuantidadesCompraItem,
  obterTotalConvertidoItemCompra,
  obterTotalConvertidoItemCompraBackend: obterTotalConvertidoItemCompra,
  simularConversaoEmbalagem,
  resolverCustoUnitarioCadastro,
  resolverCustoUnitarioProdutoCadastro,
  resolverPrecosCadastroAposCompra,
  validarDistribuicaoConversaoUnidadesItem,
  validarDistribuicaoFracionadoItem,
  resolverQuantidadesEstoqueCompraItem,
  calcularSubtotalFinanceiroItemCompra,
  montarItemCompraConversaoUnidades,
  montarItemCompraFracionado
};
