function modoFiscalQueryParam() {
    if (typeof modoFiscalAtivoSistema === 'function') {
        return modoFiscalAtivoSistema() ? '1' : '0';
    }
    return localStorage.getItem('pdv_modo_fiscal_ativo') === '1' ? '1' : '0';
}

function isModoFiscalVisualizacaoAtivo() {
    return modoFiscalQueryParam() === '1';
}

function enriquecerProdutoComCacheEstoque(produto) {
    if (!produto) return produto;

    const produtoId = produto.produto_id ?? produto.id;
    if (!produtoId) return produto;

    const cache = window.produtosCache || window.produtosList || [];
    const cached = cache.find((p) => String(p.id) === String(produtoId));
    if (!cached) return produto;

    return {
        ...produto,
        saldo_fiscal: cached.saldo_fiscal ?? produto.saldo_fiscal,
        saldo_nao_fiscal: cached.saldo_nao_fiscal ?? produto.saldo_nao_fiscal,
        estoque_atual: cached.estoque_atual ?? produto.estoque_atual,
        unidade: produto.unidade || cached.unidade
    };
}

function obterEstoqueExibicaoSimplesProduto(produto) {
    if (!produto) return 0;

    const item = enriquecerProdutoComCacheEstoque(produto);

    if (isModoFiscalVisualizacaoAtivo()) {
        if (item.saldo_fiscal !== undefined && item.saldo_fiscal !== null) {
            return Number(item.saldo_fiscal || 0);
        }
        return Number(item.estoque_atual || 0);
    }

    return Number(item.estoque_atual ?? 0);
}

function obterEstoqueDisponivelProduto(produto) {
    if (!produto) return 0;

    if (isModoFiscalVisualizacaoAtivo()) {
        return Number(produto.saldo_fiscal ?? 0);
    }

    if (produto.estoque_atual !== undefined && produto.estoque_atual !== null && !isModoFiscalVisualizacaoAtivo()) {
        const fiscal = Number(produto.saldo_fiscal ?? 0);
        const naoFiscal = Number(produto.saldo_nao_fiscal ?? 0);
        if (fiscal + naoFiscal > 0) {
            return fiscal + naoFiscal;
        }
        return Number(produto.estoque_atual || 0);
    }

    return Number(produto.saldo_fiscal || 0) + Number(produto.saldo_nao_fiscal || 0);
}

function recarregarModulosModoFiscal() {
    const page = typeof currentPage !== 'undefined' ? currentPage : null;

    if (page === 'vendas' && typeof loadVendas === 'function') {
        loadVendas();
    } else if (page === 'produtos' && typeof loadProdutos === 'function') {
        loadProdutos();
    } else if (page === 'pdv' && typeof loadPDV === 'function') {
        loadPDV();
    } else if (page === 'dashboard' && typeof carregarDashboardComFiltro === 'function') {
        carregarDashboardComFiltro();
    }

    if (typeof atualizarCamposEstoqueModalProduto === 'function') {
        atualizarCamposEstoqueModalProduto();
    }
}

window.modoFiscalQueryParam = modoFiscalQueryParam;
window.isModoFiscalVisualizacaoAtivo = isModoFiscalVisualizacaoAtivo;
window.enriquecerProdutoComCacheEstoque = enriquecerProdutoComCacheEstoque;
window.obterEstoqueExibicaoSimplesProduto = obterEstoqueExibicaoSimplesProduto;
window.obterEstoqueDisponivelProduto = obterEstoqueDisponivelProduto;
window.recarregarModulosModoFiscal = recarregarModulosModoFiscal;
