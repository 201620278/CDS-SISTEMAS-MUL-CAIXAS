function isModoFiscalRelatorio(modoFiscal) {
  return modoFiscal === '1' || modoFiscal === true || modoFiscal === 'true';
}

const FILTRO_VENDA_VALIDA = `(v.status IS NULL OR v.status != 'cancelada')`;

function getExprValorVenda(modoFiscal, alias = 'v') {
  if (isModoFiscalRelatorio(modoFiscal)) {
    return `COALESCE(${alias}.valor_fiscal, 0)`;
  }
  return `COALESCE(NULLIF(COALESCE(${alias}.valor_fiscal, 0) + COALESCE(${alias}.valor_nao_fiscal, 0), 0), ${alias}.total, 0)`;
}

function getExprValorVendaFiscal(alias = 'v') {
  return `COALESCE(${alias}.valor_fiscal, 0)`;
}

function getExprValorVendaNaoFiscal(alias = 'v') {
  return `COALESCE(${alias}.valor_nao_fiscal, 0)`;
}

function getExprValorItem(modoFiscal, alias = 'vi') {
  if (isModoFiscalRelatorio(modoFiscal)) {
    return `COALESCE(${alias}.valor_fiscal, 0)`;
  }
  return `COALESCE(NULLIF(COALESCE(${alias}.valor_fiscal, 0) + COALESCE(${alias}.valor_nao_fiscal, 0), 0), ${alias}.subtotal, 0)`;
}

function getExprValorItemFiscal(alias = 'vi') {
  return `COALESCE(${alias}.valor_fiscal, 0)`;
}

function getExprValorItemNaoFiscal(alias = 'vi') {
  return `COALESCE(${alias}.valor_nao_fiscal, 0)`;
}

function getExprQuantidadeItem(modoFiscal, alias = 'vi') {
  if (isModoFiscalRelatorio(modoFiscal)) {
    return `COALESCE(${alias}.quantidade_fiscal, 0)`;
  }
  return `COALESCE(NULLIF(COALESCE(${alias}.quantidade_fiscal, 0) + COALESCE(${alias}.quantidade_nao_fiscal, 0), 0), ${alias}.quantidade, 0)`;
}

function getExprQuantidadeItemFiscal(alias = 'vi') {
  return `COALESCE(${alias}.quantidade_fiscal, 0)`;
}

function getExprQuantidadeItemNaoFiscal(alias = 'vi') {
  return `COALESCE(${alias}.quantidade_nao_fiscal, 0)`;
}

function getFiltroItensFiscal(modoFiscal, alias = 'vi') {
  if (isModoFiscalRelatorio(modoFiscal)) {
    return `AND COALESCE(${alias}.quantidade_fiscal, 0) > 0`;
  }
  return '';
}

function getExprLucroItem(modoFiscal, aliasVi = 'vi', aliasP = 'p') {
  const valor = getExprValorItem(modoFiscal, aliasVi);
  const qtd = getExprQuantidadeItem(modoFiscal, aliasVi);
  return `(${valor} - (${qtd} * COALESCE(${aliasP}.preco_compra, 0)))`;
}

function sqlRankingProdutos(modoFiscal) {
  const exprQtd = getExprQuantidadeItem(modoFiscal, 'vi');
  const exprQtdFiscal = getExprQuantidadeItemFiscal('vi');
  const exprQtdNaoFiscal = getExprQuantidadeItemNaoFiscal('vi');

  if (isModoFiscalRelatorio(modoFiscal)) {
    return `
      SELECT
        p.id,
        p.nome,
        COALESCE(SUM(${exprQtd}), 0) AS quantidade_vendida,
        COALESCE(SUM(${exprQtdFiscal}), 0) AS quantidade_fiscal,
        0 AS quantidade_nao_fiscal
      FROM produtos p
      LEFT JOIN vendas_itens vi ON vi.produto_id = p.id
      LEFT JOIN vendas v ON v.id = vi.venda_id
        AND date(v.data_venda) BETWEEN date(?) AND date(?)
        AND ${FILTRO_VENDA_VALIDA}
      GROUP BY p.id, p.nome
    `;
  }

  return `
    SELECT
      p.id,
      p.nome,
      COALESCE(SUM(${exprQtd}), 0) AS quantidade_vendida,
      COALESCE(SUM(${exprQtdFiscal}), 0) AS quantidade_fiscal,
      COALESCE(SUM(${exprQtdNaoFiscal}), 0) AS quantidade_nao_fiscal
    FROM produtos p
    LEFT JOIN vendas_itens vi ON vi.produto_id = p.id
    LEFT JOIN vendas v ON v.id = vi.venda_id
      AND date(v.data_venda) BETWEEN date(?) AND date(?)
      AND ${FILTRO_VENDA_VALIDA}
    GROUP BY p.id, p.nome
  `;
}

module.exports = {
  FILTRO_VENDA_VALIDA,
  isModoFiscalRelatorio,
  getExprValorVenda,
  getExprValorVendaFiscal,
  getExprValorVendaNaoFiscal,
  getExprValorItem,
  getExprValorItemFiscal,
  getExprValorItemNaoFiscal,
  getExprQuantidadeItem,
  getExprQuantidadeItemFiscal,
  getExprQuantidadeItemNaoFiscal,
  getFiltroItensFiscal,
  getExprLucroItem,
  sqlRankingProdutos
};
