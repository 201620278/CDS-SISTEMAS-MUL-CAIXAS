const TIPO_VENDA_PESO = 'PESO';
const TIPO_VENDA_UNIDADE = 'UNIDADE';

function normalizarTipoVendaItem(item = {}) {
  const tipo = String(item.tipo_venda || '').toUpperCase();
  if (tipo === TIPO_VENDA_UNIDADE) {
    return TIPO_VENDA_UNIDADE;
  }
  if (tipo === TIPO_VENDA_PESO) {
    return TIPO_VENDA_PESO;
  }
  if (item.modo_venda === 'unidade') {
    return TIPO_VENDA_UNIDADE;
  }
  return TIPO_VENDA_PESO;
}

function itemVendidoPorUnidade(item = {}) {
  return normalizarTipoVendaItem(item) === TIPO_VENDA_UNIDADE;
}

function formatarMoedaCupom(valor) {
  return 'R$ ' + Number(valor || 0).toFixed(2).replace('.', ',');
}

function formatarValorCupomSemPrefixo(valor) {
  return Number(valor || 0).toFixed(2).replace('.', ',');
}

function formatarLinhasItemCupomEscpos(item = {}) {
  const nome = String(item.produto_nome || item.nome || 'Produto').slice(0, 24);
  const subtotal = Number(item.subtotal || 0);

  if (itemVendidoPorUnidade(item)) {
    const qtd = Math.round(Number(item.quantidade || 0));
    return [
      nome,
      `${qtd} UN`,
      formatarMoedaCupom(Number(item.preco_unitario || 0)),
      'Total',
      formatarValorCupomSemPrefixo(subtotal)
    ];
  }

  const qtd = Number(item.quantidade || 0);
  const preco = Number(item.preco_unitario || 0);
  return [
    nome,
    `${qtd} x ${formatarMoedaCupom(preco)} = ${formatarMoedaCupom(subtotal)}`
  ];
}

function rotuloModoVendaItem(item = {}) {
  return itemVendidoPorUnidade(item) ? 'Unidade' : 'Peso';
}

function formatarQuantidadeVendaItem(item = {}) {
  if (itemVendidoPorUnidade(item)) {
    return `${Math.round(Number(item.quantidade || 0))} UN`;
  }

  const unidade = String(item.unidade || '').toUpperCase();
  const quantidade = Number(item.quantidade || 0);
  return unidade ? `${quantidade} ${unidade}` : String(quantidade);
}

function quantidadeEstoqueKgItem(item = {}) {
  return Number(item.quantidade_fiscal || 0) + Number(item.quantidade_nao_fiscal || 0);
}

module.exports = {
  TIPO_VENDA_PESO,
  TIPO_VENDA_UNIDADE,
  normalizarTipoVendaItem,
  itemVendidoPorUnidade,
  formatarMoedaCupom,
  formatarValorCupomSemPrefixo,
  formatarLinhasItemCupomEscpos,
  rotuloModoVendaItem,
  formatarQuantidadeVendaItem,
  quantidadeEstoqueKgItem
};
