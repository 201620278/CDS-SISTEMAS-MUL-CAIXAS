function normalizarTexto(texto) {
    return String(texto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .normalize('NFC')
        .toLowerCase();
}

// Função utilitária para normalizar produto com categoria e subcategoria
function normalizarProduto(produto, categorias = window.categoriasSistema || []) {
    const categoriaId = String(produto.categoria_id || produto.categoriaId || '');
    const subcategoriaId = String(produto.subcategoria_id || produto.subcategoriaId || '');
    const categoriaObj = categorias.find(c => String(c.id) === categoriaId);
    const subcategoriaObj = categoriaObj && categoriaObj.subcategorias ? categoriaObj.subcategorias.find(s => String(s.id) === subcategoriaId) : null;
    return {
        ...produto,
        categoria: produto.categoria || produto.categoria_nome || (categoriaObj ? categoriaObj.nome : ''),
        subcategoria: produto.subcategoria || produto.subcategoria_nome || (subcategoriaObj ? subcategoriaObj.nome : '')
    };
}
// Função global para minimizar modais Bootstrap
window.minimizarModal = function(modalId) {
    const $modal = $('#' + modalId);
    if ($modal.length) {
        $modal.modal('hide');
        // Adiciona botão flutuante para restaurar
        if ($('#btn-restaurar-' + modalId).length === 0) {
            const $btn = $('<button id="btn-restaurar-' + modalId + '" class="btn btn-primary position-fixed" style="bottom: 24px; right: 24px; z-index: 2000; box-shadow: 0 2px 8px #0002;">Restaurar Produto</button>');
            $btn.on('click', function() {
                $modal.modal('show');
                // Atualiza categorias e subcategorias ao restaurar
                if (typeof inicializarCategoriasESubcategorias === 'function') {
                    // Pega os dados já preenchidos
                    const produto = {
                        id: $('#produtoId').val(),
                        codigo: $('#codigo').val(),
                        nome: $('#nome').val(),
                        categoria_id: $('#categoria_id').val(),
                        subcategoria_id: $('#subcategoria_id').val(),
                        unidade: $('#unidade').val(),
                        preco_compra: $('#preco_compra').val(),
                        lucro_percentual: $('#lucro_percentual').val(),
                        preco_venda: $('#preco_venda').val(),
                        estoque_atual: $('#estoque_atual').val(),
                        estoque_minimo: $('#estoque_minimo').val(),
                        fornecedor: $('#fornecedor').val()
                    };
                    inicializarCategoriasESubcategorias(produto, !!produto.id);
                }
                $(this).remove();
            });
            $('body').append($btn);
        }
    }
};
// =========================
// MÓDULO DE PRODUTOS
// =========================

// Carrega página de produtos
function loadProdutos() {
    const modoFiscal = typeof modoFiscalQueryParam === 'function' ? modoFiscalQueryParam() : '0';

    $.ajax({
        url: `${API_URL}/produtos?modo_fiscal=${modoFiscal}`,
        method: 'GET',
        success: function (produtos) {
            window.produtosList = produtos || [];
            renderProdutos(window.produtosList);
        },
        error: function () {
            $('#page-content').html('<div class="alert alert-danger">Erro ao carregar produtos!</div>');
        }
    });
}
window.loadProdutos = loadProdutos;

function obterQuantidadeEstoqueProduto(p) {
    if (typeof obterEstoqueDisponivelProduto === 'function') {
        return obterEstoqueDisponivelProduto(p);
    }
    return Number(p?.estoque_atual || 0);
}

function tituloColunaEstoqueLista() {
    if (typeof isModoFiscalVisualizacaoAtivo === 'function' && isModoFiscalVisualizacaoAtivo()) {
        return 'Estoque Fiscal';
    }
    return 'Estoque';
}

function formatarEstoqueDetalheProduto(produto) {
    const unidade = produto.unidade || '';

    if (typeof isModoFiscalVisualizacaoAtivo === 'function' && isModoFiscalVisualizacaoAtivo()) {
        const fiscal = Number(produto.saldo_fiscal ?? 0);
        return `<p><strong>Estoque Fiscal:</strong> ${formatarEstoqueProduto(fiscal, unidade)}</p>`;
    }

    const fiscal = Number(produto.saldo_fiscal ?? 0);
    const naoFiscal = Number(produto.saldo_nao_fiscal ?? 0);
    const total = Number(produto.estoque_atual ?? (fiscal + naoFiscal));

    return `
        <p><strong>Estoque Fiscal:</strong> ${formatarEstoqueProduto(fiscal, unidade)}</p>
        <p><strong>Estoque Não Fiscal:</strong> ${formatarEstoqueProduto(naoFiscal, unidade)}</p>
        <p><strong>Estoque Total:</strong> ${formatarEstoqueProduto(total, unidade)}</p>
    `;
}

function usuarioPodeAjustarEstoque() {
    try {
        const usuario = JSON.parse(localStorage.getItem('user') || '{}');
        const perfil = String(usuario?.perfil || usuario?.nivel || '').trim().toUpperCase();
        return usuario?.role === 'admin' || perfil === 'SUPER_ADMIN' || perfil === 'ADMIN';
    } catch (e) {
        return false;
    }
}

function resolverItemFiscalParaSalvar(saldosIniciais) {
    const modoFiscal = typeof isModoFiscalVisualizacaoAtivo === 'function' && isModoFiscalVisualizacaoAtivo();
    if (modoFiscal) return 1;
    if (Number(saldosIniciais.saldo_nao_fiscal_inicial) > 0 && Number(saldosIniciais.saldo_fiscal_inicial) === 0) {
        return 0;
    }
    return 1;
}

function obterSaldosIniciaisDoFormulario() {
    if ($('#saldo_fiscal_inicial').length) {
        const fiscal = parseFloat($('#saldo_fiscal_inicial').val()) || 0;
        const naoFiscal = parseFloat($('#saldo_nao_fiscal_inicial').val()) || 0;
        return {
            saldo_fiscal_inicial: fiscal,
            saldo_nao_fiscal_inicial: naoFiscal,
            estoque_total: fiscal + naoFiscal
        };
    }

    const legado = parseFloat($('#estoque_atual').val()) || 0;
    return {
        saldo_fiscal_inicial: legado,
        saldo_nao_fiscal_inicial: 0,
        estoque_total: legado
    };
}

function montarHtmlCamposEstoqueProduto(produto, isEdit, opcoes = {}) {
    const temMovimentacoes = Boolean(opcoes.temMovimentacoes ?? produto?.tem_movimentacoes);
    const permiteEditarSaldos = !isEdit || !temMovimentacoes;
    const modoFiscal = typeof isModoFiscalVisualizacaoAtivo === 'function' && isModoFiscalVisualizacaoAtivo();
    const saldoFiscal = Number(produto?.saldo_fiscal ?? 0);
    const saldoNaoFiscal = Number(produto?.saldo_nao_fiscal ?? 0);
    const estoqueTotal = Number(produto?.estoque_atual ?? (saldoFiscal + saldoNaoFiscal));
    const unidade = produto?.unidade || '';

    if (permiteEditarSaldos) {
        if (modoFiscal) {
            return `
                <div class="col-md-6 mb-3">
                    <label for="saldo_fiscal_inicial" class="form-label">Estoque Fiscal Inicial</label>
                    <input
                        type="number"
                        step="0.01"
                        min="0"
                        class="form-control"
                        id="saldo_fiscal_inicial"
                        value="${isEdit ? saldoFiscal : 0}"
                    >
                    <input type="hidden" id="saldo_nao_fiscal_inicial" value="${isEdit ? saldoNaoFiscal : 0}">
                </div>
            `;
        }

        return `
            <div class="col-md-4 mb-3">
                <label for="saldo_fiscal_inicial" class="form-label">Estoque Fiscal Inicial</label>
                <input
                    type="number"
                    step="0.01"
                    min="0"
                    class="form-control"
                    id="saldo_fiscal_inicial"
                    value="${isEdit ? saldoFiscal : 0}"
                >
            </div>
            <div class="col-md-4 mb-3">
                <label for="saldo_nao_fiscal_inicial" class="form-label">Estoque Não Fiscal Inicial</label>
                <input
                    type="number"
                    step="0.01"
                    min="0"
                    class="form-control"
                    id="saldo_nao_fiscal_inicial"
                    value="${isEdit ? saldoNaoFiscal : 0}"
                >
            </div>
            <div class="col-md-4 mb-3">
                <label class="form-label">Estoque Total</label>
                <input
                    type="text"
                    class="form-control bg-light"
                    id="estoque_total_inicial_preview"
                    readonly
                    value="${formatarEstoqueProduto(estoqueTotal, unidade)}"
                >
            </div>
        `;
    }

    const avisoAjuste = temMovimentacoes && usuarioPodeAjustarEstoque()
        ? '<small class="text-muted d-block mt-1">Use o botão <strong>Ajustar Estoque</strong> na lista para alterar saldos.</small>'
        : '';

    if (modoFiscal) {
        return `
            <div class="col-md-6 mb-3">
                <label class="form-label">Estoque Fiscal</label>
                <input
                    type="text"
                    class="form-control bg-light"
                    readonly
                    value="${formatarEstoqueProduto(saldoFiscal, unidade)}"
                >
                ${avisoAjuste}
            </div>
        `;
    }

    return `
        <div class="col-md-4 mb-3">
            <label class="form-label">Estoque Fiscal</label>
            <input
                type="text"
                class="form-control bg-light"
                readonly
                value="${formatarEstoqueProduto(saldoFiscal, unidade)}"
            >
        </div>
        <div class="col-md-4 mb-3">
            <label class="form-label">Estoque Não Fiscal</label>
            <input
                type="text"
                class="form-control bg-light"
                readonly
                value="${formatarEstoqueProduto(saldoNaoFiscal, unidade)}"
            >
        </div>
        <div class="col-md-4 mb-3">
            <label class="form-label">Estoque Total</label>
            <input
                type="text"
                class="form-control bg-light"
                readonly
                value="${formatarEstoqueProduto(estoqueTotal, unidade)}"
            >
            ${avisoAjuste}
        </div>
    `;
}

function atualizarCamposEstoqueModalProduto() {
    const $modal = $('#produtoModal');
    if (!$modal.length || !$modal.hasClass('show')) {
        return;
    }

    const $area = $('#areaCamposEstoqueProduto');
    if (!$area.length) {
        return;
    }

    const saldosForm = obterSaldosIniciaisDoFormulario();
    const isEdit = Boolean($('#produtoId').val());
    const temMovimentacoes = $modal.data('temMovimentacoes') === true;
    const saldosArmazenados = $modal.data('produtoSaldos') || {};

    const produto = {
        unidade: $('#unidade').val() || '',
        tem_movimentacoes: temMovimentacoes,
        saldo_fiscal: temMovimentacoes && isEdit
            ? Number(saldosArmazenados.saldo_fiscal ?? 0)
            : saldosForm.saldo_fiscal_inicial,
        saldo_nao_fiscal: temMovimentacoes && isEdit
            ? Number(saldosArmazenados.saldo_nao_fiscal ?? 0)
            : saldosForm.saldo_nao_fiscal_inicial,
        estoque_atual: temMovimentacoes && isEdit
            ? Number(saldosArmazenados.estoque_atual ?? 0)
            : saldosForm.estoque_total
    };

    $area.html(montarHtmlCamposEstoqueProduto(produto, isEdit, { temMovimentacoes }));

    const permiteEditarSaldos = !isEdit || !temMovimentacoes;
    if (permiteEditarSaldos) {
        $('#saldo_fiscal_inicial').val(saldosForm.saldo_fiscal_inicial);
        const $naoFiscal = $('#saldo_nao_fiscal_inicial');
        if ($naoFiscal.length && $naoFiscal.attr('type') !== 'hidden') {
            $naoFiscal.val(saldosForm.saldo_nao_fiscal_inicial);
        }
    }

    inicializarPreviewEstoqueTotalInicial();
}
window.atualizarCamposEstoqueModalProduto = atualizarCamposEstoqueModalProduto;

function atualizarPreviewEstoqueTotalInicial() {
    const $preview = $('#estoque_total_inicial_preview');
    if (!$preview.length) {
        return;
    }

    const saldos = obterSaldosIniciaisDoFormulario();
    const unidade = $('#unidade').val() || 'un';
    $preview.val(formatarEstoqueProduto(saldos.estoque_total, unidade));
}

function inicializarPreviewEstoqueTotalInicial() {
    const $modal = $('#produtoModal');
    if (!$modal.length) {
        return;
    }

    $modal.off('input.previewEstoqueTotal change.previewEstoqueTotal')
        .on(
            'input.previewEstoqueTotal change.previewEstoqueTotal',
            '#saldo_fiscal_inicial, #saldo_nao_fiscal_inicial, #unidade',
            atualizarPreviewEstoqueTotalInicial
        );

    atualizarPreviewEstoqueTotalInicial();
}
window.inicializarPreviewEstoqueTotalInicial = inicializarPreviewEstoqueTotalInicial;

function formatarEstoqueExibicaoTela(produto) {
    const unidade = produto?.unidade || '';
    const valor = typeof obterEstoqueExibicaoSimplesProduto === 'function'
        ? obterEstoqueExibicaoSimplesProduto(produto)
        : Number(produto?.estoque_atual || 0);
    return formatarEstoqueProduto(valor, unidade);
}

function formatarColunaEstoqueLista(p) {
    const unidade = p.unidade || '';

    if (typeof isModoFiscalVisualizacaoAtivo === 'function' && isModoFiscalVisualizacaoAtivo()) {
        return formatarEstoqueProduto(Number(p.saldo_fiscal ?? 0), unidade);
    }

    const fiscal = Number(p.saldo_fiscal ?? 0);
    const naoFiscal = Number(p.saldo_nao_fiscal ?? 0);
    const total = Number(p.estoque_atual ?? (fiscal + naoFiscal));

    return `
        <div class="small">Fiscal: ${formatarEstoqueProduto(fiscal, unidade)}</div>
        <div class="small">Não Fiscal: ${formatarEstoqueProduto(naoFiscal, unidade)}</div>
        <div class="fw-semibold">Total: ${formatarEstoqueProduto(total, unidade)}</div>
    `;
}

const RELATORIO_PRODUTOS_FILTROS = {
    todos: 'Todos os produtos',
    estoque_baixo: 'Estoque baixo',
    proximo_minimo: 'Próximo do mínimo',
    vencidos: 'Vencidos',
    proximo_vencimento: 'Próximos do vencimento'
};

function showRelatorioEstoqueProdutos() {
    carregarRelatorioEstoqueProdutos('todos');
}

function obterTipoFiltroRelatorioAtual() {
    const modal = document.getElementById('relatorio-estoque-modal');
    if (modal) {
        return modal.getAttribute('data-tipo-filtro') || 'todos';
    }
    return $('#relatorio-tipo-filtro').val() || 'todos';
}

function aplicarFiltroRelatorioProdutos() {
    const tipoFiltro = $('#relatorio-tipo-filtro').val() || 'todos';
    const inicio = $('#relatorio-data-inicio').val() || '';
    const fim = $('#relatorio-data-fim').val() || '';
    carregarRelatorioEstoqueProdutos(tipoFiltro, inicio, fim);
}

function classificarEstoqueProduto(p) {
    const atual = obterQuantidadeEstoqueProduto(p);
    const minimo = Number(p.estoque_minimo || 0);
    if (minimo <= 0) return 'ok';
    if (atual <= minimo) return 'estoque_baixo';
    if (atual <= Math.ceil(minimo * 1.2)) return 'proximo_minimo';
    return 'ok';
}

function classificarValidadeProduto(p) {
    if (Number(p.controlar_validade || 0) !== 1 || !p.data_validade) {
        return 'nao_controla';
    }
    if (p.status_validade === 'vencido') return 'vencido';
    if (p.status_validade === 'proximo') return 'proximo_vencimento';
    return 'ok_validade';
}

function obterStatusVisualProduto(p) {
    const estoque = classificarEstoqueProduto(p);
    const validade = classificarValidadeProduto(p);
    const critico = estoque === 'estoque_baixo' || validade === 'vencido';
    const alerta = estoque === 'proximo_minimo' || validade === 'proximo_vencimento';

    if (critico) return { nivel: 'critico', estoque, validade };
    if (alerta) return { nivel: 'alerta', estoque, validade };
    return { nivel: 'ok', estoque, validade };
}

function classesLinhaStatusProduto(status) {
    if (status.nivel === 'critico') {
        return { row: 'table-danger', text: 'text-danger', estoque: 'text-danger fw-bold' };
    }
    if (status.nivel === 'alerta') {
        return { row: 'table-warning', text: 'text-warning-emphasis', estoque: 'text-warning-emphasis fw-bold' };
    }
    return { row: '', text: '', estoque: '' };
}

function montarBadgesStatusProduto(p) {
    const status = obterStatusVisualProduto(p);
    const badges = [];

    if (status.estoque === 'estoque_baixo') {
        badges.push('<span class="badge bg-danger ms-1">Estoque baixo</span>');
    } else if (status.estoque === 'proximo_minimo') {
        badges.push('<span class="badge bg-warning text-dark ms-1">Próximo do mínimo</span>');
    }

    if (status.validade === 'vencido') {
        badges.push('<span class="badge bg-danger ms-1">Vencido</span>');
    } else if (status.validade === 'proximo_vencimento') {
        const dias = Number(p.dias_para_vencer ?? 0);
        badges.push(`<span class="badge bg-warning text-dark ms-1">Vence em ${dias} dia(s)</span>`);
    }

    return badges.join('');
}

const classificarEstoqueRelatorio = classificarEstoqueProduto;
const classificarValidadeRelatorio = classificarValidadeProduto;

function filtrarProdutosRelatorio(produtos, tipoFiltro) {
    const lista = Array.isArray(produtos) ? produtos : [];

    switch (tipoFiltro) {
        case 'estoque_baixo':
            return lista.filter((p) => classificarEstoqueRelatorio(p) === 'estoque_baixo');
        case 'proximo_minimo':
            return lista.filter((p) => classificarEstoqueRelatorio(p) === 'proximo_minimo');
        case 'vencidos':
            return lista.filter((p) => {
                return classificarValidadeRelatorio(p) === 'vencido' && obterQuantidadeEstoqueProduto(p) > 0;
            });
        case 'proximo_vencimento':
            return lista.filter((p) => {
                return classificarValidadeRelatorio(p) === 'proximo_vencimento' && obterQuantidadeEstoqueProduto(p) > 0;
            });
        case 'todos':
        default:
            return lista;
    }
}

function montarBadgesStatusRelatorio(p) {
    const badges = [];
    const estoque = classificarEstoqueRelatorio(p);

    if (estoque === 'estoque_baixo') {
        badges.push('<span class="badge bg-danger">Estoque baixo</span>');
    } else if (estoque === 'proximo_minimo') {
        badges.push('<span class="badge bg-warning text-dark">Próximo do mínimo</span>');
    }

    const validade = classificarValidadeRelatorio(p);
    if (validade === 'vencido') {
        badges.push('<span class="badge bg-danger">Vencido</span>');
    } else if (validade === 'proximo_vencimento') {
        const dias = Number(p.dias_para_vencer ?? 0);
        badges.push(`<span class="badge bg-warning text-dark">Vence em ${dias} dia(s)</span>`);
    }

    if (!badges.length) {
        badges.push('<span class="badge bg-secondary">OK</span>');
    }

    return badges.join(' ');
}

function formatarValidadeRelatorio(valor) {
    if (!valor) return '-';
    const data = new Date(`${valor}T00:00:00`);
    return Number.isNaN(data.getTime()) ? valor : data.toLocaleDateString('pt-BR');
}

function montarOptionsFiltroRelatorio(tipoAtual) {
    return Object.entries(RELATORIO_PRODUTOS_FILTROS)
        .map(([valor, label]) => {
            const selected = valor === tipoAtual ? 'selected' : '';
            return `<option value="${valor}" ${selected}>${label}</option>`;
        })
        .join('');
}

function parseRelatorioData(valor) {
    if (!valor) return null;
    const data = new Date(`${valor}T00:00:00`);
    return Number.isNaN(data.getTime()) ? null : data;
}

function isRelatorioDataDentroDoIntervalo(dataString, inicio, fim) {
    if (!dataString) return false;

    const data = new Date(dataString);
    if (Number.isNaN(data.getTime())) return false;

    if (inicio && data < inicio) return false;

    if (fim) {
        const fimDoDia = new Date(fim.getTime());
        fimDoDia.setHours(23, 59, 59, 999);
        if (data > fimDoDia) return false;
    }

    return true;
}

function formatarUltimaCompraRelatorio(valor) {
    if (!valor) return '-';
    return formatDate(valor);
}

function printRelatorioEstoqueProdutos() {
    const $modal = $('#relatorio-estoque-modal');
    if (!$modal.length) return;

    const title = 'Relatório de Estoque';
    const bodyHtml = $modal.find('.modal-body').html();
    const css = `
        <style>
            body { font-family: Arial, sans-serif; color: #222; padding: 20px; }
            h1 { font-size: 20px; margin-bottom: 20px; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
            th { background: #f8f9fa; }
            tr.table-danger td { background-color: #f8d7da; }
            tr.table-warning td { background-color: #fff3cd; }
            .badge { display: inline-block; padding: 0.35em 0.65em; border-radius: 0.35rem; }
            .badge.bg-danger { background-color: #dc3545; color: white; }
            .badge.bg-warning { background-color: #ffc107; color: #212529; }
            .badge.bg-secondary { background-color: #6c757d; color: white; }
            .no-print { display: none !important; }
        </style>
    `;

    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
            <head>
                <title>${title}</title>
                ${css}
            </head>
            <body>
                <h1>${title}</h1>
                ${bodyHtml}
            </body>
        </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
}

function carregarRelatorioEstoqueProdutos(tipoFiltro = 'todos', filtroInicio = '', filtroFim = '') {
    const params = new URLSearchParams();
    const modoFiscal = typeof modoFiscalQueryParam === 'function' ? modoFiscalQueryParam() : '0';
    params.append('modo_fiscal', modoFiscal);

    if (filtroInicio) params.append('inicio', filtroInicio);
    if (filtroFim) params.append('fim', filtroFim);

    $.ajax({
        url: `${API_URL}/produtos/relatorio-estoque?${params.toString()}`,
        method: 'GET',
        headers: {
            Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
        },
        success: function(produtos) {
            renderRelatorioEstoqueProdutos(produtos || [], tipoFiltro, filtroInicio, filtroFim);
        },
        error: function(xhr) {
            const erro = xhr.responseJSON?.error || 'Erro ao carregar relatório de estoque.';
            showNotification(erro, 'danger');
        }
    });
}

function renderRelatorioEstoqueProdutos(produtos, tipoFiltro = 'todos', filtroInicio = '', filtroFim = '') {
    produtos = Array.isArray(produtos) ? produtos : [];
    const inicio = parseRelatorioData(filtroInicio);
    const fim = parseRelatorioData(filtroFim);

    let produtosFiltrados = produtos;

    if (inicio || fim) {
        produtosFiltrados = produtos.filter(p => isRelatorioDataDentroDoIntervalo(p.ultima_compra_data, inicio, fim));
    }

    const produtosExibidos = filtrarProdutosRelatorio(produtosFiltrados, tipoFiltro);

    const valorTotalFiscal = produtosExibidos.reduce((sum, p) => {
        const qtd = obterQuantidadeEstoqueProduto(p);
        return sum + (qtd * Number(p.preco_compra || 0));
    }, 0);

    const tituloModo = RELATORIO_PRODUTOS_FILTROS[tipoFiltro] || 'Todos os produtos';

    const filtroLegenda = `Exibindo ${produtosExibidos.length} produto(s) de ${produtosFiltrados.length} no período.`;

    const filtroDatasTexto = (inicio || fim)
        ? `Filtro aplicado pela data da última compra: ${filtroInicio || 'início não informado'} até ${filtroFim || 'fim não informado'}.`
        : 'Nenhum filtro de data aplicado.';

    const modalHtml = `
        <div class="modal fade" id="relatorio-estoque-modal" tabindex="-1" data-tipo-filtro="${tipoFiltro}">
            <div class="modal-dialog modal-xl modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Relatório de Estoque</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
                    </div>
                    <div class="modal-body">
                        <div class="row g-3 mb-3 no-print">
                            <div class="col-md-4">
                                <label class="form-label">Tipo de filtro</label>
                                <select id="relatorio-tipo-filtro" class="form-select">
                                    ${montarOptionsFiltroRelatorio(tipoFiltro)}
                                </select>
                            </div>
                            <div class="col-md-3">
                                <label class="form-label">Data início (última compra)</label>
                                <input type="date" id="relatorio-data-inicio" class="form-control" value="${filtroInicio || ''}">
                            </div>
                            <div class="col-md-3">
                                <label class="form-label">Data fim (última compra)</label>
                                <input type="date" id="relatorio-data-fim" class="form-control" value="${filtroFim || ''}">
                            </div>
                            <div class="col-md-2 d-flex align-items-end gap-2 flex-wrap">
                                <button type="button" class="btn btn-primary w-100" onclick="aplicarFiltroRelatorioProdutos()">
                                    Aplicar
                                </button>
                            </div>
                            <div class="col-12 d-flex gap-2 flex-wrap">
                                <button type="button" class="btn btn-outline-secondary btn-sm" onclick="carregarRelatorioEstoqueProdutos($('#relatorio-tipo-filtro').val() || 'todos')">
                                    Limpar datas
                                </button>
                                <button type="button" class="btn btn-success btn-sm" onclick="printRelatorioEstoqueProdutos()">
                                    Imprimir relatório
                                </button>
                            </div>
                        </div>

                        <div class="mb-3">
                            <strong>${tituloModo}</strong>
                            <div class="text-muted">${filtroLegenda}</div>
                            <div class="text-muted">${filtroDatasTexto}</div>
                            <div class="text-muted">Valor fiscal total exibido: ${formatCurrency(valorTotalFiscal)}</div>
                        </div>

                        <div class="table-responsive">
                            <table class="table table-striped table-hover">
                                <thead>
                                    <tr>
                                        <th>Produto</th>
                                        <th>Categoria</th>
                                        <th>${tituloColunaEstoqueLista()}</th>
                                        <th>Mínimo</th>
                                        <th>Lote</th>
                                        <th>Validade</th>
                                        <th>Última compra</th>
                                        <th>Total em estoque</th>
                                        <th>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${produtosExibidos.length === 0 ? `
                                        <tr>
                                            <td colspan="9" class="text-center">
                                                Nenhum produto encontrado para o filtro selecionado.
                                            </td>
                                        </tr>
                                    ` : produtosExibidos.map(p => {
                                        const estoqueAtual = obterQuantidadeEstoqueProduto(p);
                                        const estoqueMinimo = Number(p.estoque_minimo || 0);
                                        const precoCompra = Number(p.preco_compra || 0);
                                        const totalItem = estoqueAtual * precoCompra;
                                        const classes = classesLinhaStatusProduto(obterStatusVisualProduto(p));

                                        return `
                                            <tr class="${classes.row}">
                                                <td class="${classes.text}">${escapeHtml(p.nome || '-')}</td>
                                                <td>${escapeHtml(p.categoria || '-')}</td>
                                                <td>${formatarColunaEstoqueLista(p)}</td>
                                                <td>${estoqueMinimo}</td>
                                                <td>${escapeHtml(p.lote || '-')}</td>
                                                <td>${formatarValidadeRelatorio(p.data_validade)}</td>
                                                <td>${formatarUltimaCompraRelatorio(p.ultima_compra_data)}</td>
                                                <td>${formatCurrency(totalItem)}</td>
                                                <td>${montarBadgesStatusRelatorio(p)}</td>
                                            </tr>
                                        `;
                                    }).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div class="modal-footer no-print">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    $('#modal-container').html(modalHtml);

    const modalEl = document.getElementById('relatorio-estoque-modal');
    const modal = new bootstrap.Modal(modalEl);

    modalEl.addEventListener('hidden.bs.modal', function () {
        modal.dispose();
        $('#relatorio-estoque-modal').remove();
        $('.modal-backdrop').remove();
    });

    modal.show();
}


function montarOptionsFiltroCategorias(produtos) {
    const mapa = new Map();

    (produtos || []).forEach(p => {
        const id = String(p.categoria_id || '');
        const nome = p.categoria || p.categoria_nome || '';

        if (id && nome) {
            mapa.set(id, nome);
        }
    });

    return Array.from(mapa.entries())
        .sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))
        .map(([id, nome]) => `<option value="${id}">${escapeHtml(nome)}</option>`)
        .join('');
}

function aplicarFiltrosProdutos(produtos) {
    const termo = normalizarTexto($('#buscaProduto').val()).trim();
    const categoriaId = String($('#filtroCategoriaProduto').val() || '');

    // Se houver termo de busca ou filtro de categoria, mostrar tabela normal
    if (termo || categoriaId) {
        $('#categorias-container').hide();
        $('#tabela-produtos-container').show();

        const filtrados = (produtos || []).filter(p => {
            const bateBusca =
                !termo ||
                (p.nome && normalizarTexto(p.nome).includes(termo)) ||
                (p.codigo && normalizarTexto(p.codigo).includes(termo)) ||
                (p.categoria && normalizarTexto(p.categoria).includes(termo)) ||
                (p.fornecedor && normalizarTexto(p.fornecedor).includes(termo));

            const bateCategoria =
                !categoriaId || String(p.categoria_id || '') === categoriaId;

            return bateBusca && bateCategoria;
        });

        $('#produtos-tbody').html(renderProdutosAgrupados(filtrados));
    } else {
        // Se não houver filtro, mostrar categorias
        $('#categorias-container').show();
        $('#tabela-produtos-container').hide();
        carregarCategoriasProdutos();
    }
}

function produtoComEstoqueBaixo(p) {
    return classificarEstoqueProduto(p) === 'estoque_baixo';
}

function produtoProximoMinimo(p) {
    return classificarEstoqueProduto(p) === 'proximo_minimo';
}

function renderProdutoRow(p) {
    const status = obterStatusVisualProduto(p);
    const classes = classesLinhaStatusProduto(status);
    const badges = montarBadgesStatusProduto(p);

    return `
        <tr class="${classes.row}">
            <td class="${classes.text} fw-semibold">${escapeHtml(p.nome || '')}</td>
            <td>${escapeHtml(p.codigo || '')}</td>
            <td>${escapeHtml(p.categoria || p.categoria_nome || '')}</td>
            <td>${escapeHtml(p.unidade || '')}</td>
            <td>${formatCurrency(p.preco_compra || 0)}</td>
            <td>${formatCurrency(p.preco_venda || 0)}</td>
            <td class="${classes.estoque}">
                ${formatarColunaEstoqueLista(p)}
                ${badges}
            </td>
            <td>
                <button class="btn btn-sm btn-info" onclick="viewProduto(${p.id})">
                    <i class="fas fa-eye"></i>
                </button>
                <button class="btn btn-sm btn-warning" onclick="editProduto(${p.id})">
                    <i class="fas fa-edit"></i>
                </button>
                ${usuarioPodeAjustarEstoque() ? `
                <button class="btn btn-sm btn-success" onclick="abrirModalAjustarEstoque(${p.id})" title="Ajustar Estoque">
                    <i class="fas fa-boxes"></i>
                </button>
                ` : ''}
                <button class="btn btn-sm btn-danger" onclick="deleteProduto(${p.id})">
                    <i class="fas fa-trash"></i>
                </button>
                <button class="btn btn-sm btn-secondary" onclick="historicoProduto(${p.id})">
                    <i class="fas fa-history"></i>
                </button>
            </td>
        </tr>
    `;
}

function renderProdutosAgrupados(produtos) {
    if (!produtos || produtos.length === 0) {
        return `
            <tr>
                <td colspan="8" class="text-center text-muted py-4">
                    Nenhum produto encontrado.
                </td>
            </tr>
        `;
    }

    const grupos = {};

    produtos.forEach(produto => {
        const categoria = produto.categoria || produto.categoria_nome || 'SEM CATEGORIA';
        const subcategoria = produto.subcategoria || produto.subcategoria_nome || 'SEM SUBCATEGORIA';

        if (!grupos[categoria]) {
            grupos[categoria] = {};
        }

        if (!grupos[categoria][subcategoria]) {
            grupos[categoria][subcategoria] = [];
        }

        grupos[categoria][subcategoria].push(produto);
    });

    let html = '';

    Object.keys(grupos)
        .sort((a, b) => a.localeCompare(b, 'pt-BR'))
        .forEach(categoria => {
            html += `
                <tr class="table-dark">
                    <td colspan="8" style="font-weight: bold; font-size: 15px;">
                        ${escapeHtml(categoria.toUpperCase())}
                    </td>
                </tr>
            `;

            Object.keys(grupos[categoria])
                .sort((a, b) => a.localeCompare(b, 'pt-BR'))
                .forEach(subcategoria => {
                    html += `
                        <tr class="table-secondary">
                            <td colspan="8" style="font-weight: bold; padding-left: 25px;">
                                ${escapeHtml(subcategoria)}
                            </td>
                        </tr>
                    `;

                    grupos[categoria][subcategoria]
                        .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'))
                        .forEach(produto => {
                            html += renderProdutoRow(produto);
                        });
                });
        });

    return html;
}

function gerarRelatorioEstoque() {
    showRelatorioEstoqueProdutos();
}

// Renderiza listagem de produtos
function renderProdutos(produtos) {
    window.produtosCache = produtos;
    window.produtosOriginais = produtos;
    const html = `
        <div class="row mb-3 g-3">
            <div class="col-md-6 col-lg-4">
                <div class="card mb-0 border-danger h-100" id="cardEstoqueBaixoProdutos">
                    <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2 bg-danger bg-opacity-10">
                        <strong class="text-danger"><i class="fas fa-exclamation-triangle me-2"></i>Alertas de estoque</strong>
                        <button type="button" class="btn btn-sm btn-outline-danger" onclick="carregarEstoqueBaixoProdutos()">
                            <i class="fas fa-sync-alt"></i> Atualizar
                        </button>
                    </div>
                    <div class="card-body" id="listaEstoqueBaixoProdutos">
                        <div class="text-muted">Carregando...</div>
                    </div>
                </div>
            </div>
            <div class="col-md-6 col-lg-4">
                <div class="card-dashboard card-vencimentos h-100" id="cardVencimentosProdutos">
                    <div class="card-icon">⏰</div>
                    <div class="card-info">
                        <h3>Vencimentos</h3>
                        <p>
                            <strong id="qtdProdutosVencidos">0</strong> vencidos |
                            <strong id="qtdProdutosProximos">0</strong> próximos
                        </p>
                        <button type="button" class="btn btn-warning btn-sm" onclick="abrirModalVencimentosProdutos()">
                            Ver produtos
                        </button>
                    </div>
                </div>
            </div>
            <div class="col-md-6 col-lg-4">
                <div class="card-dashboard card-promocoes h-100" id="cardPromocoesProdutos">
                    <div class="card-icon">🎯</div>
                    <div class="card-info">
                        <h3>Promoções Inteligentes</h3>
                        <p>
                            <strong id="qtdSugestoesProdutos">0</strong> sugestões |
                            <strong id="qtdPromocoesProdutos">0</strong> ativas
                        </p>
                        <button type="button" class="btn btn-info btn-sm" onclick="abrirModalPromocoesProdutos()">
                            Ver Sugestões
                        </button>
                    </div>
                </div>
            </div>
        </div>
        <div class="card">
            <div class="card-header">
                <div class="row align-items-center">
                    <div class="col-md-6">
                        <i class="fas fa-box"></i> Lista de Produtos
                    </div>
                    <div class="col-md-8 d-flex justify-content-end align-items-center gap-2 flex-wrap">
                        <button class="btn btn-secondary btn-sm" onclick="gerarRelatorioEstoque()">
                            <i class="fas fa-list"></i> Relatório de estoque
                        </button>

                        <button class="btn btn-primary btn-sm" onclick="showProdutoModal()">
                            <i class="fas fa-plus"></i> Novo Produto
                        </button>

                        <select
                            class="form-select form-select-sm"
                            id="filtroCategoriaProduto"
                            style="width: 200px;"
                        >
                            <option value="">Todas as categorias</option>
                            ${montarOptionsFiltroCategorias(produtos)}
                        </select>

                        <input
                            type="text"
                            class="form-control form-control-sm"
                            id="buscaProduto"
                            placeholder="Buscar produto..."
                            style="width: 200px;"
                        >
                    </div>
                </div>
            </div>

            <div class="card-body">
                <div class="alert alert-info py-2 mb-3">
                    <i class="fas fa-info-circle me-2"></i>
                    Clique em uma categoria para ver os produtos. Use a busca acima para pesquisar em todos os produtos.
                </div>
                <div class="d-flex flex-wrap gap-3 mb-3 small">
                    <span><span class="d-inline-block rounded px-2 py-1 bg-warning">&nbsp;</span> Amarelo: próximo do mínimo ou do vencimento</span>
                    <span><span class="d-inline-block rounded px-2 py-1 bg-danger">&nbsp;</span> Vermelho: estoque no mínimo ou abaixo / vencido</span>
                </div>
                <div id="categorias-container">
                    ${renderCategoriasProdutos(produtos)}
                </div>
                <div class="table-responsive" id="tabela-produtos-container" style="display: none;">
                    <table class="table table-striped table-hover">
                        <thead>
                            <tr>
                                <th>Nome</th>
                                <th>Código</th>
                                <th>Categoria</th>
                                <th>Unidade</th>
                                <th>Preço Compra</th>
                                <th>Preço Venda</th>
                                <th>${tituloColunaEstoqueLista()}</th>
                                <th>Ações</th>
                            </tr>
                        </thead>
                        <tbody id="produtos-tbody">
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;

    $('#page-content').html(html);

    $('#buscaProduto, #filtroCategoriaProduto').on('input change', function () {
        aplicarFiltrosProdutos(produtos);
    });

    // Carregar categorias inicialmente
    carregarCategoriasProdutos();
    inicializarCardEstoqueBaixo();
    inicializarModalVencimentosProdutos();
    carregarVencimentosProdutos();
    carregarDashboardPromocoes();
}

function renderCategoriasProdutos(produtos) {
    if (!produtos || produtos.length === 0) {
        return '<div class="alert alert-warning">Nenhum produto encontrado.</div>';
    }

    // Extrair categorias únicas dos produtos
    const categoriasMap = new Map();
    produtos.forEach(p => {
        const catId = p.categoria_id || '';
        const catNome = p.categoria || p.categoria_nome || 'Sem Categoria';
        if (!categoriasMap.has(catId)) {
            categoriasMap.set(catId, { id: catId, nome: catNome, count: 0 });
        }
        categoriasMap.get(catId).count++;
    });

    const categorias = Array.from(categoriasMap.values()).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

    return categorias.map(cat => `
        <div class="card mb-2 categoria-card" data-categoria-id="${cat.id}">
            <div class="card-header bg-light d-flex justify-content-between align-items-center" style="cursor: pointer;" onclick="toggleProdutosCategoriaMenu('${cat.id}', '${escapeHtml(cat.nome)}')">
                <strong><i class="fas fa-folder me-2"></i>${escapeHtml(cat.nome)}</strong>
                <span class="badge bg-primary">${cat.count}</span>
            </div>
            <div class="card-body p-0" id="produtos-categoria-${cat.id}" style="display: none;">
                <div class="text-center py-3">
                    <div class="spinner-border spinner-border-sm text-primary"></div>
                </div>
            </div>
        </div>
    `).join('');
}

function carregarCategoriasProdutos() {
    $('#categorias-container').html(`
        <div class="text-center py-4">
            <div class="spinner-border text-primary"></div>
            <div class="mt-2">Carregando categorias...</div>
        </div>
    `);

    $.ajax({
        url: `${API_URL}/categorias?tipo=produto`,
        method: 'GET',
        success: function(categorias) {
            if (!categorias || categorias.length === 0) {
                $('#categorias-container').html(`
                    <div class="alert alert-warning">
                        Nenhuma categoria encontrada.
                    </div>
                `);
                return;
            }

            // Contar produtos por categoria
            const categoriasComContagem = categorias.map(cat => {
                const produtosCategoria = (window.produtosCache || []).filter(
                    (p) => String(p.categoria_id) === String(cat.id)
                );
                const count = produtosCategoria.length;
                const countBaixo = produtosCategoria.filter((p) => produtoComEstoqueBaixo(p)).length;
                const countProximo = produtosCategoria.filter((p) => produtoProximoMinimo(p)).length;
                return { ...cat, count, countBaixo, countProximo };
            }).filter(cat => cat.count > 0);

            const html = categoriasComContagem.map(cat => `
                <div class="card mb-2 categoria-card" data-categoria-id="${cat.id}">
                    <div class="card-header bg-light d-flex justify-content-between align-items-center" style="cursor: pointer;" onclick="toggleProdutosCategoriaMenu(${cat.id}, '${escapeHtml(cat.nome)}')">
                        <strong><i class="fas fa-folder me-2"></i>${escapeHtml(cat.nome)}</strong>
                        <span>
                            <span class="badge bg-primary">${cat.count}</span>
                            ${cat.countProximo > 0 ? `<span class="badge bg-warning text-dark ms-1" title="Próximo do estoque mínimo">${cat.countProximo} próx.</span>` : ''}
                            ${cat.countBaixo > 0 ? `<span class="badge bg-danger ms-1" title="Estoque no mínimo ou abaixo">${cat.countBaixo} baixo</span>` : ''}
                        </span>
                    </div>
                    <div class="card-body p-0" id="produtos-categoria-${cat.id}" style="display: none;">
                        <div class="text-center py-3">
                            <div class="spinner-border spinner-border-sm text-primary"></div>
                        </div>
                    </div>
                </div>
            `).join('');

            $('#categorias-container').html(html);
        },
        error: function() {
            $('#categorias-container').html(`
                <div class="alert alert-danger">
                    Erro ao carregar categorias.
                </div>
            `);
        }
    });
}

function toggleProdutosCategoriaMenu(categoriaId, categoriaNome) {
    const container = $(`#produtos-categoria-${categoriaId}`);

    if (container.is(':visible')) {
        container.slideUp();
    } else {
        // Se ainda não carregou os produtos, carregar
        if (container.find('.spinner-border').length > 0) {
            const produtosCategoria = (window.produtosCache || []).filter(p => String(p.categoria_id) === String(categoriaId));

            if (!produtosCategoria || produtosCategoria.length === 0) {
                container.html(`
                    <div class="p-3 text-muted">
                        Nenhum produto nesta categoria.
                    </div>
                `);
            } else {
                const tabelaHtml = `
                    <div class="table-responsive">
                        <table class="table table-striped table-hover mb-0">
                            <thead>
                                <tr>
                                    <th>Nome</th>
                                    <th>Código</th>
                                    <th>Unidade</th>
                                    <th>Preço Compra</th>
                                    <th>Preço Venda</th>
                                    <th>${tituloColunaEstoqueLista()}</th>
                                    <th>Ações</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${produtosCategoria.map(p => renderProdutoRow(p)).join('')}
                            </tbody>
                        </table>
                    </div>
                `;
                container.html(tabelaHtml);
            }
        }

        container.slideDown();
    }
}

function renderProdutosRows(produtos) {
    if (!produtos || produtos.length === 0) {
        return '<tr><td colspan="8" class="text-center">Nenhum produto cadastrado</td></tr>';
    }

    return produtos.map((p) => renderProdutoRow(p)).join('');
}


// Abre modal de produto
function showProdutoModal(produto = null) {
    const isEdit = produto !== null;
    const title = isEdit ? 'Editar Produto' : 'Novo Produto';
    const lucro = isEdit && produto.lucro_percentual !== undefined ? produto.lucro_percentual : '';

    // Remove modais antigos para evitar conflitos de aria-hidden e IDs duplicados
    $('#produtoModal').remove();
    $('#viewProdutoModal').remove();
    const modalHtml = `
        <div class="modal fade" id="produtoModal" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-lg modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header d-flex align-items-center justify-content-between">
                        <h5 class="modal-title mb-0">${title}</h5>
                        <div class="d-flex gap-2">
                            <button type="button" class="btn btn-outline-secondary btn-sm" onclick="minimizarModal('produtoModal')" title="Minimizar">
                                <i class="fas fa-window-minimize"></i>
                            </button>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
                        </div>
                    </div>

                    <div class="modal-body">
                        <form id="produtoForm">
                            <input type="hidden" id="produtoId" value="${isEdit ? (produto.id || '') : ''}">

                            <div class="row">
                                <div class="col-md-6 mb-3">
                                    <label for="codigo" class="form-label">Código</label>
                                    <input
                                        type="text"
                                        class="form-control"
                                        id="codigo"
                                        value="${isEdit ? escapeHtml(produto.codigo || '') : ''}"
                                    >
                                </div>

                                <div class="col-md-6 mb-3">
                                    <label for="nome" class="form-label">Nome *</label>
                                    <input
                                        type="text"
                                        class="form-control"
                                        id="nome"
                                        required
                                        value="${isEdit ? escapeHtml(produto.nome || '') : ''}"
                                    >
                                </div>

                                <div class="col-md-6 mb-3">
                                    <label for="categoria_id" class="form-label">Categoria</label>
                                    <select class="form-control" id="categoria_id">
                                        <option value="">Carregando...</option>
                                    </select>
                                </div>

                                <div class="col-md-6 mb-3">
                                    <label for="subcategoria_id" class="form-label">Subcategoria</label>
                                    <select class="form-control" id="subcategoria_id">
                                        <option value="">Selecione uma categoria</option>
                                    </select>
                                </div>

                                <div class="col-md-6 mb-3">
                                    <label for="unidade" class="form-label">Unidade</label>
                                    <select class="form-control" id="unidade">
                                        <option value="un" ${isEdit && produto.unidade === 'un' ? 'selected' : ''}>Unidade</option>
                                        <option value="kg" ${isEdit && produto.unidade === 'kg' ? 'selected' : ''}>Quilograma</option>
                                        <option value="g" ${isEdit && produto.unidade === 'g' ? 'selected' : ''}>Grama</option>
                                        <option value="l" ${isEdit && produto.unidade === 'l' ? 'selected' : ''}>Litro</option>
                                        <option value="ml" ${isEdit && produto.unidade === 'ml' ? 'selected' : ''}>Mililitro</option>
                                    </select>
                                </div>

                                <div class="col-md-6 mb-3 d-flex align-items-end">
                                    <div class="form-check form-switch">
                                        <input
                                            class="form-check-input"
                                            type="checkbox"
                                            id="vendido_por_peso"
                                            ${isEdit && Number(produto.vendido_por_peso || 0) === 1 ? 'checked' : ''}
                                        >
                                        <label class="form-check-label" for="vendido_por_peso">
                                            Produto vendido por peso
                                        </label>
                                    </div>
                                </div>

                                <div class="col-12" id="areaProdutoPeso" style="display:none;">
                                    <div class="card border-primary mb-3">
                                        <div class="card-header bg-light">
                                            <strong>Configuração de venda por peso</strong>
                                        </div>
                                        <div class="card-body">
                                            <div class="row">
                                                <div class="col-md-4 mb-3">
                                                    <label for="peso_total_compra" class="form-label">Peso Total Comprado (KG)</label>
                                                    <input
                                                        type="number"
                                                        step="0.001"
                                                        class="form-control"
                                                        id="peso_total_compra"
                                                        value="${isEdit ? Number(produto.peso_total_compra || 0) : 0}"
                                                    >
                                                </div>

                                                <div class="col-md-4 mb-3">
                                                    <label for="valor_total_compra" class="form-label">Valor Total da Compra</label>
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        class="form-control"
                                                        id="valor_total_compra"
                                                        value="${isEdit ? Number(produto.valor_total_compra || 0) : 0}"
                                                    >
                                                </div>

                                                <div class="col-md-4 mb-3">
                                                    <label for="custo_por_kg" class="form-label">Custo por KG</label>
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        class="form-control"
                                                        id="custo_por_kg"
                                                        readonly
                                                        value="${isEdit ? Number(produto.custo_por_kg || 0) : 0}"
                                                    >
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div class="col-md-4 mb-3">
                                    <label for="preco_compra" class="form-label">Preço de Compra</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        class="form-control"
                                        id="preco_compra"
                                        value="${isEdit ? Number(produto.preco_compra || 0) : 0}"
                                    >
                                </div>

                                <div class="col-md-4 mb-3">
                                    <label for="lucro_percentual" class="form-label">% Lucro Real</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        class="form-control"
                                        id="lucro_percentual"
                                        placeholder="%"
                                        value="${lucro}"
                                    >
                                </div>

                                <div class="col-md-4 mb-3">
                                    <label for="preco_venda" class="form-label">Preço de Venda *</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        class="form-control"
                                        id="preco_venda"
                                        required
                                        value="${isEdit ? Number(produto.preco_venda || 0) : 0}"
                                    >
                                </div>

                                <div id="areaCamposEstoqueProduto" style="display: contents;">
                                ${montarHtmlCamposEstoqueProduto(produto, isEdit, {
                                    temMovimentacoes: produto?.tem_movimentacoes
                                })}
                                </div>

                                <div class="col-md-6 mb-3">
                                    <label for="estoque_minimo" class="form-label">Estoque Mínimo</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        class="form-control"
                                        id="estoque_minimo"
                                        value="${isEdit ? Number(produto.estoque_minimo || 0) : 0}"
                                    >
                                </div>

                                <div class="col-md-12 mb-3 position-relative">
                                    <label for="fornecedor" class="form-label">Fornecedor</label>
                                    <input
                                        type="text"
                                        class="form-control"
                                        id="fornecedor"
                                        autocomplete="off"
                                        value="${isEdit ? escapeHtml(produto.fornecedor || '') : ''}"
                                    >
                                    <div
                                        id="fornecedor-autocomplete"
                                        class="list-group position-absolute w-100"
                                        style="z-index: 9999; display: none;"
                                    ></div>
                                </div>

                                <div class="col-12">
                                    <div class="row g-3 border rounded p-3 mb-2 bg-light">
                                        <div class="col-md-12">
                                            <div class="form-check">
                                                <input
                                                    class="form-check-input"
                                                    type="checkbox"
                                                    id="controlar_validade"
                                                    ${isEdit && Number(produto.controlar_validade || 0) === 1 ? 'checked' : ''}
                                                >
                                                <label class="form-check-label" for="controlar_validade">
                                                    Controlar validade deste produto
                                                </label>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <!-- Campos para lote inicial (apenas quando controlar_validade está marcado) -->
                                <div class="col-12" id="areaLoteInicial" style="display: none;">
                                    <div class="row g-3 border rounded p-3 mb-2 bg-info bg-opacity-10">
                                        <div class="col-md-12">
                                            <strong>Informações do Lote Inicial</strong>
                                            <small class="text-muted d-block">Preencha estes campos para criar o lote inicial do estoque (apenas para novos produtos com estoque > 0). O lote será gerado automaticamente.</small>
                                        </div>
                                        <div class="col-md-4">
                                            <label for="data_validade_inicial" class="form-label">Data Validade *</label>
                                            <input
                                                type="date"
                                                id="data_validade_inicial"
                                                class="form-control"
                                                value="${isEdit ? (produto.data_validade_inicial || '') : ''}"
                                            >
                                        </div>
                                        <div class="col-md-4">
                                            <label for="dias_alerta_validade" class="form-label">Alertar (dias)</label>
                                            <input
                                                type="number"
                                                id="dias_alerta_validade"
                                                class="form-control"
                                                value="${isEdit ? Number(produto.dias_alerta_validade || 30) : 30}"
                                                min="1"
                                            >
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div class="card mt-3">
                                <div class="card-header p-2">
                                    <button class="btn btn-link text-decoration-none" type="button" data-bs-toggle="collapse" data-bs-target="#dadosFiscaisSection" aria-expanded="true" aria-controls="dadosFiscaisSection">
                                        Dados Fiscais
                                    </button>
                                </div>
                                <div id="dadosFiscaisSection" class="collapse show">
                                    <div class="card-body">
                                        <div class="row">
                                            <div class="col-md-3 mb-3">
                                                <label for="ncm" class="form-label">NCM</label>
                                                <input type="text" class="form-control" id="ncm" value="${isEdit ? escapeHtml(produto.ncm || '') : ''}">
                                            </div>
                                            <div class="col-md-3 mb-3">
                                                <label for="cfop" class="form-label">CFOP</label>
                                                <input type="text" class="form-control" id="cfop" value="${isEdit ? escapeHtml(produto.cfop || '') : ''}">
                                            </div>
                                            <div class="col-md-3 mb-3">
                                                <label for="csosn" class="form-label">CSOSN</label>
                                                <input type="text" class="form-control" id="csosn" value="${isEdit ? escapeHtml(produto.csosn || '') : ''}">
                                            </div>
                                            <div class="col-md-3 mb-3">
                                                <label for="origem" class="form-label">Origem</label>
                                                <input type="number" class="form-control" id="origem" value="${isEdit ? Number(produto.origem || 0) : 0}">
                                            </div>

                                            <div class="col-md-4 mb-3">
                                                <label for="cest" class="form-label">CEST</label>
                                                <input type="text" class="form-control" id="cest" value="${isEdit ? escapeHtml(produto.cest || '') : ''}">
                                            </div>
                                            <div class="col-md-4 mb-3">
                                                <label for="codigo_barras" class="form-label">Código de barras</label>
                                                <input type="text" class="form-control" id="codigo_barras" value="${isEdit ? escapeHtml(produto.codigo_barras || '') : ''}">
                                            </div>
                                            <div class="col-md-4 mb-3">
                                                <label for="aliquota_icms" class="form-label">Alíquota ICMS</label>
                                                <input type="number" step="0.01" class="form-control" id="aliquota_icms" value="${isEdit ? Number(produto.aliquota_icms || 0) : 0}">
                                            </div>
                                            <div class="col-md-4 mb-3">
                                                <label for="aliquota_pis" class="form-label">Alíquota PIS</label>
                                                <input type="number" step="0.01" class="form-control" id="aliquota_pis" value="${isEdit ? Number(produto.aliquota_pis || 0) : 0}">
                                            </div>
                                            <div class="col-md-4 mb-3">
                                                <label for="aliquota_cofins" class="form-label">Alíquota COFINS</label>
                                                <input type="number" step="0.01" class="form-control" id="aliquota_cofins" value="${isEdit ? Number(produto.aliquota_cofins || 0) : 0}">
                                            </div>
                                        </div>
                                    </div>
                                    <!-- Venda em Atacado -->
                                    <div class="col-12">
                                        <div class="card mt-2">
                                            <div class="card-header d-flex align-items-center justify-content-between">
                                                <strong>Venda em Atacado</strong>
                                                <div class="form-check form-switch mb-0">
                                                    <input class="form-check-input" type="checkbox" id="venda_atacado" ${isEdit && Number(produto.venda_atacado || 0) === 1 ? 'checked' : ''}>
                                                </div>
                                            </div>
                                            <div class="card-body" id="areaVendaAtacado" style="display: none;">
                                                <div class="table-responsive">
                                                    <table class="table table-sm table-striped" id="tabelaAtacado">
                                                        <thead>
                                                            <tr>
                                                                <th>Quantidade</th>
                                                                <th>%</th>
                                                                <th>Preço Atacado</th>
                                                                <th></th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            <!-- Faixas serão carregadas dinamicamente -->
                                                        </tbody>
                                                    </table>
                                                </div>
                                                <div class="d-flex gap-2">
                                                    <button type="button" class="btn btn-success btn-sm" id="btnAdicionarFaixa">+ Adicionar Faixa</button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </form>
                    </div>

                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                        <button type="button" class="btn btn-primary" onclick="saveProduto()">Salvar</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    $('#modal-container').html(modalHtml);

    $('#produtoModal').modal('show');
    // inicializar armazenamento temporário de faixas (para produto novo)
    const faixasInit = (produto && Array.isArray(produto.atacado_faixas)) ? produto.atacado_faixas : [];
    $('#produtoModal').data('faixasTemp', faixasInit);
    $('#produtoModal').data('temMovimentacoes', Boolean(produto?.tem_movimentacoes));
    if (isEdit && produto) {
        $('#produtoModal').data('produtoSaldos', {
            saldo_fiscal: produto.saldo_fiscal,
            saldo_nao_fiscal: produto.saldo_nao_fiscal,
            estoque_atual: produto.estoque_atual
        });
    }
    // Remove botão flutuante se existir ao restaurar
    $('#btn-restaurar-produtoModal').remove();

    inicializarCategoriasESubcategorias(produto, isEdit);
    inicializarAutocompleteFornecedor();
    inicializarCalculoPreco(produto, isEdit);
    inicializarVendaAtacado(produto, isEdit);

    if (isEdit && produto) {
        $('#controlar_validade').prop('checked', produto.controlar_validade == 1);
    } else {
        $('#controlar_validade').prop('checked', false);
    }

    // Inicializar controle de visibilidade do lote inicial
    inicializarControleLoteInicial();
    inicializarPreviewEstoqueTotalInicial();
    inicializarEspelhoCodigoBarras(produto, isEdit);

    if (!isEdit) {
        aplicarPadraoFiscalNovoProduto();
    }

    // ...
}

async function aplicarPadraoFiscalNovoProduto() {
    if ($('#produtoId').val()) {
        return;
    }

    try {
        const token = localStorage.getItem('token') || '';
        const response = await fetch(`${API_URL}/configuracoes-avancadas/padrao-fiscal`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        if (!response.ok) {
            return;
        }

        const padrao = await response.json();
        if (padrao.cfop_padrao) {
            $('#cfop').val(padrao.cfop_padrao);
        }
        if (padrao.csosn_padrao) {
            $('#csosn').val(padrao.csosn_padrao);
        }
        if (padrao.origem_padrao !== undefined && padrao.origem_padrao !== null && padrao.origem_padrao !== '') {
            const origem = parseInt(padrao.origem_padrao, 10);
            if (!Number.isNaN(origem)) {
                $('#origem').val(origem);
            }
        }
        if (padrao.cest_padrao) {
            $('#cest').val(padrao.cest_padrao);
        }
    } catch (err) {
        console.warn('Não foi possível carregar padrão fiscal da empresa:', err);
    }
}
window.aplicarPadraoFiscalNovoProduto = aplicarPadraoFiscalNovoProduto;

function inicializarEspelhoCodigoBarras(produto, isEdit) {
    const $modal = $('#produtoModal');
    if (!$modal.length) {
        return;
    }

    const codigoInicial = isEdit ? String(produto?.codigo || '').trim() : '';
    const barrasInicial = isEdit ? String(produto?.codigo_barras || '').trim() : '';

    if (barrasInicial && barrasInicial !== codigoInicial) {
        $modal.data('codigoBarrasEditadoManualmente', true);
        $modal.data('ultimoCodigoEspelhado', '');
    } else {
        $modal.data('codigoBarrasEditadoManualmente', false);
        $modal.data('ultimoCodigoEspelhado', codigoInicial);
    }

    $modal.off('input.espelhoCodigo change.espelhoCodigo')
        .on('input.espelhoCodigo change.espelhoCodigo', '#codigo', function () {
            const codigo = String($(this).val() || '').trim();
            const $barras = $('#codigo_barras');
            const barras = String($barras.val() || '').trim();
            const ultimoEspelhado = String($modal.data('ultimoCodigoEspelhado') || '');
            const manual = $modal.data('codigoBarrasEditadoManualmente') === true;

            if (!manual || barras === '' || barras === ultimoEspelhado) {
                $barras.val(codigo);
                $modal.data('ultimoCodigoEspelhado', codigo);
                $modal.data('codigoBarrasEditadoManualmente', false);
            }
        })
        .on('input.espelhoCodigo change.espelhoCodigo', '#codigo_barras', function () {
            const codigo = String($('#codigo').val() || '').trim();
            const barras = String($(this).val() || '').trim();

            if (barras === codigo) {
                $modal.data('codigoBarrasEditadoManualmente', false);
                $modal.data('ultimoCodigoEspelhado', codigo);
            } else if (barras === '') {
                $modal.data('codigoBarrasEditadoManualmente', false);
                $modal.data('ultimoCodigoEspelhado', '');
            } else {
                $modal.data('codigoBarrasEditadoManualmente', true);
            }
        });
}
window.inicializarEspelhoCodigoBarras = inicializarEspelhoCodigoBarras;

// Função para controlar visibilidade dos campos de lote inicial
function inicializarControleLoteInicial() {
    const $controlarValidade = $('#controlar_validade');
    const $areaLoteInicial = $('#areaLoteInicial');

    function atualizarVisibilidadeLoteInicial() {
        const controlarValidade = $controlarValidade.prop('checked');

        console.log('Atualizando visibilidade lote inicial:', controlarValidade);

        // Mostrar campos de lote inicial quando controlar_validade estiver marcado
        if (controlarValidade) {
            $areaLoteInicial.show();
        } else {
            $areaLoteInicial.hide();
        }
    }

    $controlarValidade.on('change', atualizarVisibilidadeLoteInicial);

    // Verificar estado inicial com delay
    setTimeout(atualizarVisibilidadeLoteInicial, 100);
}


// Inicializa categorias e subcategorias
function inicializarCategoriasESubcategorias(produto, isEdit) {
    if (!(window.categoriasAPI && window.subcategoriasAPI)) {
        $('#categoria_id').html('<option value="">Categorias indisponíveis</option>');
        $('#subcategoria_id').html('<option value="">Subcategorias indisponíveis</option>');
        return;
    }

    function renderCategorias(categoriasComSubs) {
        window.categoriasSistema = categoriasComSubs;
        let catOptions = '<option value="">Selecione</option>';
        categoriasComSubs.forEach(cat => {
            catOptions += `<option value="${cat.id}">${escapeHtml(cat.nome || '')}</option>`;
        });
        $('#categoria_id').html(catOptions);
        if (isEdit && produto && produto.categoria_id) {
            $('#categoria_id').val(String(produto.categoria_id));
        }

        function carregarSubs(catId, selectedSubId) {
            if (!catId) {
                $('#subcategoria_id').html('<option value="">Selecione uma categoria</option>');
                return;
            }
            const cat = categoriasComSubs.find(c => String(c.id) === String(catId));
            let subOptions = '<option value="">Nenhuma</option>';
            (cat && cat.subcategorias ? cat.subcategorias : []).forEach(sub => {
                subOptions += `<option value="${sub.id}">${escapeHtml(sub.nome || '')}</option>`;
            });
            $('#subcategoria_id').html(subOptions);
            if (typeof selectedSubId !== 'undefined' && selectedSubId !== null) {
                $('#subcategoria_id').val(String(selectedSubId));
            }
        }

        $('#categoria_id').off('change').on('change', function () {
            carregarSubs($(this).val());
        });

        if (isEdit && produto && typeof produto.categoria_id !== 'undefined' && produto.categoria_id !== null) {
            let subId = '';
            if (typeof produto.subcategoria_id !== 'undefined' && produto.subcategoria_id !== null && produto.subcategoria_id !== 'null') {
                subId = String(produto.subcategoria_id);
            }
            carregarSubs(produto.categoria_id, subId);
        } else {
            $('#subcategoria_id').html('<option value="">Selecione uma categoria</option>');
        }
    }

    // Renderiza rapidamente com cache local (quando houver) e em seguida
    // sempre sincroniza da API para refletir novas subcategorias sem recarregar a página.
    if (window.categoriasSistema && Array.isArray(window.categoriasSistema) && window.categoriasSistema.length > 0) {
        renderCategorias(window.categoriasSistema);
    }

    const possuiCacheCategorias = window.categoriasSistema && Array.isArray(window.categoriasSistema) && window.categoriasSistema.length > 0;

    $.when(categoriasAPI.listar('produto'), subcategoriasAPI.listar()).done(function (categorias, subcategorias) {
        categorias = categorias[0] || [];
        subcategorias = subcategorias[0] || [];

        const categoriasComSubs = (categorias || []).map(cat => ({
            ...cat,
            subcategorias: (subcategorias || []).filter(sub => String(sub.categoria_id) === String(cat.id))
        }));

        renderCategorias(categoriasComSubs);
    }).fail(function () {
        if (possuiCacheCategorias) {
            return;
        }
        $('#categoria_id').html('<option value="">Erro ao carregar categorias</option>');
        $('#subcategoria_id').html('<option value="">Erro ao carregar subcategorias</option>');
    });
}


// Inicializa autocomplete de fornecedor
function inicializarAutocompleteFornecedor() {
    $('#fornecedor').off('input').on('input', function () {
        const termo = ($(this).val() || '').trim();
        const termoNumerico = termo.replace(/\D/g, '');
        const $lista = $('#fornecedor-autocomplete');

        if (termo.length < 2) {
            $lista.hide().html('');
            return;
        }

        $.ajax({
            url: `${API_URL}/fornecedores?busca=${encodeURIComponent(termo)}`,
            method: 'GET',
            headers: {
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            },
            success: function (fornecedores) {
                const termoLower = termo.toLowerCase();
                const filtrados = (fornecedores || []).filter(f => {
                    if (!f) return false;

                    const nome = String(f.nome || '').toLowerCase();
                    const razao = String(f.razao_social || '').toLowerCase();
                    const cpfCnpj = String(f.cpf_cnpj || '');
                    const cpfCnpjNumerico = cpfCnpj.replace(/\D/g, '');

                    const correspondeTexto = nome.includes(termoLower) || razao.includes(termoLower) || cpfCnpj.toLowerCase().includes(termoLower);
                    const correspondeCnpjNumerico = termoNumerico.length > 0 && cpfCnpjNumerico.includes(termoNumerico);

                    return correspondeTexto || correspondeCnpjNumerico;
                });

                if (filtrados.length === 0) {
                    $lista.hide().html('');
                    return;
                }

                let html = '';
                filtrados.forEach(f => {
                    const label = f.cpf_cnpj
                        ? `${escapeHtml(f.nome || '')} - CNPJ: ${escapeHtml(f.cpf_cnpj)}`
                        : `${escapeHtml(f.nome || '')}`;
                    html += `
                        <button
                            type="button"
                            class="list-group-item list-group-item-action fornecedor-item"
                            data-nome="${escapeHtml(f.nome)}"
                        >
                            ${label}
                        </button>
                    `;
                });

                $lista.html(html).show();

                $('.fornecedor-item').off('click').on('click', function () {
                    $('#fornecedor').val($(this).text().trim());
                    $lista.hide().html('');
                });
            },
            error: function () {
                $lista.hide().html('');
            }
        });
    });

    $('#fornecedor').off('blur').on('blur', function () {
        setTimeout(() => {
            $('#fornecedor-autocomplete').hide().html('');
        }, 200);
    });
}

// ---------- Venda em Atacado (frontend helpers) ----------
function inicializarVendaAtacado(produto, isEdit) {
    const produtoId = produto && produto.id ? String(produto.id) : null;
    const ativo = isEdit && Number(produto.venda_atacado || 0) === 1;

    $('#venda_atacado').off('change').on('change', function() {
        const checked = $(this).is(':checked');
        $('#areaVendaAtacado').toggle(checked);
        // atualizar flag local no produto (quando existir)
        if (produto && produto.id) produto.venda_atacado = checked ? 1 : 0;
    });

    // Botão adicionar faixa
    $('#btnAdicionarFaixa').off('click').on('click', function() {
        adicionarFaixaPrompt(produtoId);
    });

    if (ativo) {
        $('#areaVendaAtacado').show();
        renderFaixasAtacado(produtoId);
    } else {
        $('#areaVendaAtacado').hide();
    }
}

function renderFaixasAtacado(produtoId) {
    const $tbody = $('#tabelaAtacado tbody');
    $tbody.html('');
    if (!produtoId) {
        // carregar faixas temporárias do modal
        const faixasTemp = $('#produtoModal').data('faixasTemp') || [];
        faixasTemp.forEach((r, idx) => {
            const tr = `
                <tr data-temp-index="${idx}">
                    <td>${r.quantidade_minima}</td>
                    <td>${formatarPercentualPorPrecoAtacado(r.preco_atacado)}</td>
                    <td>${formatCurrency(r.preco_atacado)}</td>
                    <td class="text-end">
                        <button class="btn btn-sm btn-outline-primary me-1" onclick="editarFaixaPromptTemp(${idx})">Editar</button>
                        <button class="btn btn-sm btn-outline-danger" onclick="excluirFaixaTemp(${idx})">Excluir</button>
                    </td>
                </tr>
            `;
            $tbody.append(tr);
        });
        return;
    }

    $.ajax({
        url: `${API_URL}/produtos/${produtoId}/atacado`,
        method: 'GET',
        headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || '') },
        success: function(rows) {
            (rows || []).forEach(r => {
                const tr = `
                    <tr data-id="${r.id}">
                        <td>${r.quantidade_minima}</td>
                        <td>${formatarPercentualPorPrecoAtacado(r.preco_atacado)}</td>
                        <td>${formatCurrency(r.preco_atacado)}</td>
                        <td class="text-end">
                            <button class="btn btn-sm btn-outline-primary me-1" onclick="editarFaixaPrompt(${r.id})">Editar</button>
                            <button class="btn btn-sm btn-outline-danger" onclick="excluirFaixa(${r.id}, ${produtoId})">Excluir</button>
                        </td>
                    </tr>
                `;
                $tbody.append(tr);
            });
        },
        error: function() {
            showNotification('Erro ao carregar faixas de atacado.', 'danger');
        }
    });
}

function adicionarFaixaPrompt(produtoId) {
    // Abre uma linha de inserção embutida na tabela de faixas (não usa prompt())
    const $tbody = $('#tabelaAtacado tbody');
    if ($tbody.find('tr[data-editing="nova"]').length) return; // já aberta

    const tr = $(
        `
        <tr data-editing="nova">
            <td><input type="number" min="1" class="form-control form-control-sm input-quantidade" placeholder="Quantidade mínima"></td>
            <td><input type="number" min="0" step="0.01" class="form-control form-control-sm input-percentual" placeholder="% Atacado"></td>
            <td><input type="text" class="form-control form-control-sm input-preco" placeholder="Preço atacado"></td>
            <td class="text-end">
                <button type="button" class="btn btn-sm btn-success btn-salvar-nova me-1">Salvar faixa</button>
                <button type="button" class="btn btn-sm btn-secondary btn-cancelar-nova">Cancelar</button>
            </td>
        </tr>
    `);

    $tbody.prepend(tr);
    fixarEventosFaixaRow(tr);

    // marcar o tr com o produtoId para que handlers genéricos o encontrem
    if (produtoId) tr.attr('data-produto-id', produtoId);

    // salvar ao pressionar Enter na linha ou ao sair do campo de preço; Esc cancela (remove a linha)
    function salvarNova() {
        const dados = extrairDadosFaixaLinha(tr);
        if (!dados) {
            showNotification('Informe quantidade mínima e percentual/preço válidos.', 'warning');
            return;
        }

        const pid = tr.data('produto-id');
        if (!pid) {
            const faixasTemp = $('#produtoModal').data('faixasTemp') || [];
            faixasTemp.push(dados);
            $('#produtoModal').data('faixasTemp', faixasTemp);
            tr.remove();
            renderFaixasAtacado(null);
            showNotification('Faixa adicionada. Salve o produto para persistir.', 'success');
            return;
        }

        $.ajax({
            url: `${API_URL}/produtos/${pid}/atacado`,
            method: 'POST',
            global: false,
            headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || '') },
            contentType: 'application/json',
            data: JSON.stringify(dados),
            success: function() {
                renderFaixasAtacado(pid);
                showNotification('Faixa adicionada com sucesso', 'success');
            },
            error: function(xhr) {
                console.error('Erro ao adicionar faixa:', xhr.status, xhr.responseJSON);
                let err = xhr.responseJSON?.error || 'Erro ao adicionar faixa';
                if (xhr.status === 403) {
                    err = 'Você não tem permissão para gerenciar faixas de atacado';
                } else if (xhr.status === 401) {
                    err = 'Sua sessão expirou. Faça login novamente';
                }
                showNotification(err, 'danger');
            }
        });
    }

    tr.find('input').on('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            salvarNova();
        } else if (e.key === 'Escape') {
            tr.remove();
        }
    });

    tr.find('.btn-salvar-nova').on('click', function() {
        salvarNova();
    });

    tr.find('.btn-cancelar-nova').on('click', function() {
        tr.remove();
    });
}

function editarFaixaPrompt(faixaId) {
    // Editar faixa existente no servidor inline na tabela
    const $tr = $(`#tabelaAtacado tr[data-id='${faixaId}']`);
    if ($tr.length === 0) return showNotification('Faixa não encontrada', 'danger');
    // buscar dados atuais
    $.ajax({ url: `${API_URL}/produtos/atacado/${faixaId}`, method: 'GET', headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || '') }, success: function(faixa) {
        if (!faixa) return showNotification('Faixa não encontrada', 'danger');
        const originalHtml = $tr.html();
        $tr.html(`
            <td><input type="number" min="1" class="form-control form-control-sm input-quantidade" value="${faixa.quantidade_minima}"></td>
            <td><input type="number" min="0" step="0.01" class="form-control form-control-sm input-percentual" value="${calcularPercentualPorPrecoAtacado(faixa.preco_atacado).toFixed(2)}"></td>
            <td><input type="text" class="form-control form-control-sm input-preco" value="${faixa.preco_atacado}"></td>
            <td class="text-end">
                <button class="btn btn-sm btn-success me-1 btn-salvar-edicao">Salvar</button>
                <button class="btn btn-sm btn-secondary btn-cancelar-edicao">Cancelar</button>
            </td>
        `);

        $tr.find('.btn-cancelar-edicao').on('click', function() { $tr.html(originalHtml); });
        fixarEventosFaixaRow($tr);

        $tr.find('.btn-salvar-edicao').on('click', function() {
            const q = parseInt($tr.find('.input-quantidade').val(), 10);
            const percentual = parseNumero($tr.find('.input-percentual').val());
            const precoStr = $tr.find('.input-preco').val() || '';
            const precoManual = parseFloat(precoStr.replace(',', '.'));
            let preco = (!isNaN(precoManual) && precoManual > 0) ? precoManual : 0;
            if ((!preco || preco <= 0) && percentual > 0) {
                preco = obterPrecoPorPercentual(percentual);
            }
            if (!q || q <= 0) { showNotification('Quantidade inválida', 'warning'); return; }
            if (isNaN(preco) || preco <= 0) { showNotification('Preço inválido', 'warning'); return; }

            $.ajax({
                url: `${API_URL}/produtos/atacado/${faixaId}`,
                method: 'PUT',
                global: false,
                headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || '') },
                contentType: 'application/json',
                data: JSON.stringify({ quantidade_minima: q, preco_atacado: preco }),
                success: function() {
                    const pid = $('#produtoId').val();
                    renderFaixasAtacado(pid);
                    showNotification('Faixa atualizada', 'success');
                },
                error: function(xhr) {
                    console.error('Erro ao atualizar faixa:', xhr.status, xhr.responseJSON);
                    let err = xhr.responseJSON?.error || 'Erro ao atualizar faixa';
                    if (xhr.status === 403) {
                        err = 'Você não tem permissão para gerenciar faixas de atacado';
                    } else if (xhr.status === 401) {
                        err = 'Sua sessão expirou. Faça login novamente';
                    }
                    showNotification(err, 'danger');
                }
            });
        });
    }, error: function() { showNotification('Erro ao buscar faixa', 'danger'); } });
}

function editarFaixaPromptTemp(index) {
    const $tr = $(`#tabelaAtacado tr[data-temp-index='${index}']`);
    const faixasTemp = $('#produtoModal').data('faixasTemp') || [];
    const faixa = faixasTemp[index];
    if (!$tr.length || !faixa) return showNotification('Faixa não encontrada localmente', 'danger');
    const originalHtml = $tr.html();
    $tr.html(`
        <td><input type="number" min="1" class="form-control form-control-sm input-quantidade" value="${faixa.quantidade_minima}"></td>
        <td><input type="number" min="0" step="0.01" class="form-control form-control-sm input-percentual" value="${calcularPercentualPorPrecoAtacado(faixa.preco_atacado).toFixed(2)}"></td>
        <td><input type="text" class="form-control form-control-sm input-preco" value="${faixa.preco_atacado}"></td>
        <td class="text-end"></td>
    `);

    fixarEventosFaixaRow($tr);

    function salvarEdicaoTemp() {
        const q = parseInt($tr.find('.input-quantidade').val(), 10);
        const percentual = parseNumero($tr.find('.input-percentual').val());
        const precoStr = $tr.find('.input-preco').val() || '';
        const precoManual = parseFloat(precoStr.replace(',', '.'));
        let preco = (!isNaN(precoManual) && precoManual > 0) ? precoManual : 0;
        if ((!preco || preco <= 0) && percentual > 0) {
            preco = obterPrecoPorPercentual(percentual);
        }
        if (!q || q <= 0) { showNotification('Quantidade inválida', 'warning'); return; }
        if (isNaN(preco) || preco <= 0) { showNotification('Preço inválido', 'warning'); return; }

        faixasTemp[index] = { quantidade_minima: q, preco_atacado: preco };
        $('#produtoModal').data('faixasTemp', faixasTemp);
        renderFaixasAtacado(null);
        showNotification('Faixa atualizada localmente. Salve o produto para persistir.', 'success');
    }

    $tr.find('input').on('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            salvarEdicaoTemp();
        } else if (e.key === 'Escape') {
            $tr.html(originalHtml);
        }
    });
}

function excluirFaixaTemp(index) {
    if (!confirm('Deseja realmente excluir esta faixa temporária?')) return;
    const faixasTemp = $('#produtoModal').data('faixasTemp') || [];
    faixasTemp.splice(index, 1);
    $('#produtoModal').data('faixasTemp', faixasTemp);
    renderFaixasAtacado(null);
}

function excluirFaixa(faixaId, produtoId) {
    if (!confirm('Deseja realmente excluir esta faixa de atacado?')) return;
    $.ajax({
        url: `${API_URL}/produtos/atacado/${faixaId}`,
        method: 'DELETE',
        global: false,
        headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || '') },
        success: function() {
            renderFaixasAtacado(produtoId || $('#produtoId').val());
            showNotification('Faixa excluída', 'success');
        },
        error: function() {
            showNotification('Erro ao excluir faixa', 'danger');
        }
    });
}

function parseNumero(valor) {
    return parseFloat(String(valor || '0').replace(',', '.')) || 0;
}

function calcularPercentualPorPrecoAtacado(precoAtacado) {
    const precoVenda = parseNumero($('#preco_venda').val());
    if (precoVenda <= 0) return 0;
    const precoAtacadoConvertido = parseNumero(precoAtacado);
    return ((precoVenda - precoAtacadoConvertido) / precoVenda) * 100;
}

function formatarPercentualPorPrecoAtacado(precoAtacado) {
    const percentual = calcularPercentualPorPrecoAtacado(precoAtacado);
    return `${percentual.toFixed(2)}%`;
}

function obterPrecoPorPercentual(percentual) {
    const precoVenda = parseNumero($('#preco_venda').val());
    if (precoVenda <= 0) return 0;
    return precoVenda * (1 - (parseNumero(percentual) / 100));
}

function extrairDadosFaixaLinha($tr) {
    const q = parseInt($tr.find('.input-quantidade').val(), 10);
    const percentual = parseNumero($tr.find('.input-percentual').val());
    const precoStr = $tr.find('.input-preco').val() || '';
    const precoManual = parseFloat(String(precoStr).replace(',', '.'));
    let preco = (!isNaN(precoManual) && precoManual > 0) ? precoManual : 0;

    if ((!preco || preco <= 0) && percentual > 0) {
        preco = obterPrecoPorPercentual(percentual);
    }

    if (!q || q <= 0 || isNaN(preco) || preco <= 0) {
        return null;
    }

    return {
        quantidade_minima: q,
        preco_atacado: Number(preco.toFixed(2))
    };
}

async function commitFaixaAtacadoPendente(produtoId) {
    const $tr = $('#tabelaAtacado tr[data-editing="nova"]');
    if (!$tr.length) {
        return true;
    }

    const dados = extrairDadosFaixaLinha($tr);
    if (!dados) {
        showNotification('Informe quantidade mínima e percentual/preço da faixa de atacado.', 'warning');
        return false;
    }

    if (!produtoId) {
        const faixasTemp = $('#produtoModal').data('faixasTemp') || [];
        faixasTemp.push(dados);
        $('#produtoModal').data('faixasTemp', faixasTemp);
        $tr.remove();
        return true;
    }

    try {
        const response = await fetch(`${API_URL}/produtos/${produtoId}/atacado`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            },
            body: JSON.stringify(dados)
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            showNotification(err.error || 'Erro ao salvar faixa de atacado.', 'danger');
            return false;
        }

        $tr.remove();
        renderFaixasAtacado(String(produtoId));
        return true;
    } catch (error) {
        console.error('Erro ao salvar faixa de atacado pendente:', error);
        showNotification('Erro ao salvar faixa de atacado.', 'danger');
        return false;
    }
}

function fixarEventosFaixaRow($row) {
    const $percentual = $row.find('.input-percentual');
    const $preco = $row.find('.input-preco');

    $percentual.off('input').on('input', function() {
        const valor = parseNumero($percentual.val());
        const preco = obterPrecoPorPercentual(valor);
        if (preco > 0) {
            $preco.val(preco.toFixed(2));
        }
    });

    $preco.off('input').on('input', function() {
        const valor = parseNumero($preco.val());
        if (valor <= 0) {
            $percentual.val('0.00');
            return;
        }
        const percentual = calcularPercentualPorPrecoAtacado(valor);
        $percentual.val(percentual.toFixed(2));
    });
}


// Inicializa cálculo automático do preço de venda
function inicializarCalculoPreco(produto, isEdit) {
    let atualizando = false;

    function numero(valor) {
        return parseFloat(String(valor || '0').replace(',', '.')) || 0;
    }

    function produtoPorPesoAtivo() {
        return $('#vendido_por_peso').is(':checked');
    }

    function atualizarAreaPeso() {
        const ativo = produtoPorPesoAtivo();

        $('#areaProdutoPeso').toggle(ativo);

        if (ativo) {
            $('#unidade').val('kg');
            calcularCustoPorKg();
        }
    }

    function calcularCustoPorKg() {
        if (!produtoPorPesoAtivo()) return;

        const pesoTotal = numero($('#peso_total_compra').val());
        const valorTotal = numero($('#valor_total_compra').val());

        if (pesoTotal > 0 && valorTotal > 0) {
            const custoKg = valorTotal / pesoTotal;

            $('#custo_por_kg').val(custoKg.toFixed(2));
            $('#preco_compra').val(custoKg.toFixed(2));

            calcularPrecoVendaPorLucro();
        }
    }

    function calcularPrecoVendaPorLucro() {
        if (atualizando) return;
        atualizando = true;

        const precoCompra = numero($('#preco_compra').val());
        const lucro = numero($('#lucro_percentual').val());

        if (precoCompra > 0) {
            const precoVenda = precoCompra + (precoCompra * lucro / 100);
            $('#preco_venda').val(precoVenda.toFixed(2));
        }

        atualizando = false;
    }

    function calcularLucroPorPrecoVenda() {
        if (atualizando) return;
        atualizando = true;

        const precoCompra = numero($('#preco_compra').val());
        const precoVenda = numero($('#preco_venda').val());

        if (precoCompra > 0 && precoVenda > 0) {
            const lucro = ((precoVenda - precoCompra) / precoCompra) * 100;
            $('#lucro_percentual').val(lucro.toFixed(2));
        }

        atualizando = false;
    }

    $('#vendido_por_peso').off('change').on('change', atualizarAreaPeso);

    $('#peso_total_compra, #valor_total_compra')
        .off('input')
        .on('input', calcularCustoPorKg);

    $('#preco_compra')
        .off('input')
        .on('input', function () {
            if (produtoPorPesoAtivo()) {
                $('#custo_por_kg').val(numero($('#preco_compra').val()).toFixed(2));
            }

            if ($('#lucro_percentual').val() !== '') {
                calcularPrecoVendaPorLucro();
            } else {
                calcularLucroPorPrecoVenda();
            }
        });

    $('#lucro_percentual')
        .off('input')
        .on('input', calcularPrecoVendaPorLucro);

    $('#preco_venda')
        .off('input')
        .on('input', calcularLucroPorPrecoVenda);

    atualizarAreaPeso();

    if (isEdit && produto) {
        setTimeout(() => {
            if ($('#lucro_percentual').val() !== '') {
                calcularPrecoVendaPorLucro();
            } else {
                calcularLucroPorPrecoVenda();
            }
        }, 100);
    }
}


// Salva produto
async function saveProduto() {
    const id = $('#produtoId').val();

    if ($('#venda_atacado').is(':checked')) {
        const faixaSalva = await commitFaixaAtacadoPendente(id || null);
        if (!faixaSalva) {
            return;
        }
    }

    const saldosIniciais = obterSaldosIniciaisDoFormulario();

    const data = {
        codigo: ($('#codigo').val() || '').trim(),
        nome: ($('#nome').val() || '').trim(),
        categoria_id: $('#categoria_id').val() ? String($('#categoria_id').val()) : null,
        subcategoria_id: $('#subcategoria_id').val() ? String($('#subcategoria_id').val()) : null,
        unidade: ($('#unidade').val() || '').trim(),
        preco_compra: parseFloat($('#preco_compra').val()) || 0,
        preco_venda: parseFloat($('#preco_venda').val()) || 0,
        lucro_percentual: $('#lucro_percentual').val() !== '' ? parseFloat($('#lucro_percentual').val()) : null,
        estoque_minimo: parseFloat($('#estoque_minimo').val()) || 0,
        fornecedor: ($('#fornecedor').val() || '').trim(),
        data_validade: ($('#data_validade').val() || '').trim() || null,
        lote: ($('#lote').val() || '').trim(),
        dias_alerta_validade: parseInt($('#dias_alerta_validade').val(), 10) || 30,
        controlar_validade: $('#controlar_validade').is(':checked') ? 1 : 0,
        ncm: ($('#ncm').val() || '').trim(),
        cfop: ($('#cfop').val() || '').trim(),
        csosn: ($('#csosn').val() || '').trim(),
        origem: $('#origem').val() !== '' ? parseInt($('#origem').val(), 10) : 0,
        cest: ($('#cest').val() || '').trim(),
        codigo_barras: ($('#codigo_barras').val() || '').trim(),
        aliquota_icms: parseFloat($('#aliquota_icms').val()) || 0,
        aliquota_pis: parseFloat($('#aliquota_pis').val()) || 0,
        aliquota_cofins: parseFloat($('#aliquota_cofins').val()) || 0,
        vendido_por_peso: $('#vendido_por_peso').is(':checked') ? 1 : 0,
        peso_total_compra: parseFloat($('#peso_total_compra').val()) || 0,
        valor_total_compra: parseFloat($('#valor_total_compra').val()) || 0,
        custo_por_kg: parseFloat($('#custo_por_kg').val()) || 0,
        venda_atacado: $('#venda_atacado').is(':checked') ? 1 : 0,
        // Campos para lote inicial (apenas para novos produtos)
        data_validade_inicial: ($('#data_validade_inicial').val() || '').trim() || null
    };

    if ($('#saldo_fiscal_inicial').length) {
        data.saldo_fiscal_inicial = saldosIniciais.saldo_fiscal_inicial;
        data.saldo_nao_fiscal_inicial = saldosIniciais.saldo_nao_fiscal_inicial;
    }

    data.item_fiscal = resolverItemFiscalParaSalvar(saldosIniciais);
    console.log('[AUDIT PRODUTO] Payload salvar:', JSON.stringify(data, null, 2));
    console.log('[AUDIT PRODUTO] item_fiscal enviado:', data.item_fiscal);

    // Validação para produtos com controle de validade e estoque inicial
    if (!id && data.controlar_validade === 1 && saldosIniciais.estoque_total > 0) {
        if (!data.data_validade_inicial) {
            showNotification('Para produtos com controle de validade e estoque inicial, informe a data de validade.', 'warning');
            $('#data_validade_inicial').focus();
            return;
        }
    }

    if (!data.nome) {
        showNotification('Informe o nome do produto.', 'warning');
        $('#nome').focus();
        return;
    }

    if (data.preco_venda <= 0) {
        showNotification('Informe um preço de venda válido.', 'warning');
        $('#preco_venda').focus();
        return;
    }

    if (data.preco_compra < 0) {
        showNotification('Preço de compra inválido.', 'warning');
        $('#preco_compra').focus();
        return;
    }

    if (data.vendido_por_peso === 1) {
        if (data.peso_total_compra <= 0) {
            showNotification('Informe o peso total comprado em KG.', 'warning');
            $('#peso_total_compra').focus();
            return;
        }

        if (data.valor_total_compra <= 0) {
            showNotification('Informe o valor total da compra.', 'warning');
            $('#valor_total_compra').focus();
            return;
        }

        if (data.custo_por_kg <= 0) {
            showNotification('Custo por KG inválido.', 'warning');
            $('#custo_por_kg').focus();
            return;
        }
    }

    if (saldosIniciais.saldo_fiscal_inicial < 0 || saldosIniciais.saldo_nao_fiscal_inicial < 0) {
        showNotification('Saldos iniciais não podem ser negativos.', 'warning');
        $('#saldo_fiscal_inicial').focus();
        return;
    }

    if ($('#saldo_fiscal_inicial').length && saldosIniciais.estoque_total < 0) {
        showNotification('Estoque inicial inválido.', 'warning');
        $('#saldo_fiscal_inicial').focus();
        return;
    }

    if (data.estoque_minimo < 0) {
        showNotification('Estoque mínimo inválido.', 'warning');
        $('#estoque_minimo').focus();
        return;
    }

    const url = id ? `${API_URL}/produtos/${id}` : `${API_URL}/produtos`;
    const method = id ? 'PUT' : 'POST';
    // incluir faixas temporárias (se houver) para salvar junto com o produto
    const faixasTemp = $('#produtoModal').data('faixasTemp');
    if (!id && Array.isArray(faixasTemp) && faixasTemp.length > 0) {
        data.atacado_faixas = faixasTemp;
    }

    $.ajax({
        url: url,
        method: method,
        contentType: 'application/json',
        headers: {
            Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
        },
        data: JSON.stringify(data),
        success: function (produtoSalvo) {
            $('#produtoModal').modal('hide');
            showNotification('Produto salvo com sucesso!', 'success');
            // Atualiza lista local se necessário
            if (window.produtosList && Array.isArray(window.produtosList)) {
                const produtoNormalizado = normalizarProduto(produtoSalvo, window.categoriasSistema || []);
                const indexExistente = window.produtosList.findIndex(p => String(p.id) === String(produtoNormalizado.id));

                if (indexExistente >= 0) {
                    window.produtosList[indexExistente] = produtoNormalizado;
                } else {
                    window.produtosList.unshift(produtoNormalizado);
                }

                if (typeof renderProdutos === 'function') {
                    renderProdutos(window.produtosList);
                }
            } else {
                loadProdutos();
            }
        },
        error: function (xhr) {
            const erro = xhr.responseJSON?.error || 'Erro desconhecido';
            showNotification('Erro ao salvar produto: ' + erro, 'danger');
        }
    });
}
window.saveProduto = saveProduto;


// Histórico de preços
function showHistoricoPrecos(produtoId) {
    $.ajax({
        url: `${API_URL}/produtos/${produtoId}/historico-precos`,
        method: 'GET',
        success: function (rows) {
            const modalHtml = `
                <div class="modal fade" id="historicoPrecosModal" tabindex="-1" aria-hidden="true">
                    <div class="modal-dialog modal-lg">
                        <div class="modal-content">
                            <div class="modal-header">
                                <h5 class="modal-title">Histórico de preços</h5>
                                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                            </div>
                            <div class="modal-body">
                                <div class="table-responsive">
                                    <table class="table table-sm table-striped">
                                        <thead>
                                            <tr>
                                                <th>Data</th>
                                                <th>P. compra (de →)</th>
                                                <th>P. venda (de →)</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            ${(rows && rows.length)
                                                ? rows.map(r => `
                                                    <tr>
                                                        <td>${formatDateTime(r.created_at)}</td>
                                                        <td>${formatCurrency(r.preco_compra_anterior || 0)} → ${formatCurrency(r.preco_compra_novo || 0)}</td>
                                                        <td>${formatCurrency(r.preco_venda_anterior || 0)} → ${formatCurrency(r.preco_venda_novo || 0)}</td>
                                                    </tr>
                                                `).join('')
                                                : '<tr><td colspan="3" class="text-center">Nenhuma alteração de preço registrada ainda.</td></tr>'
                                            }
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                            <div class="modal-footer">
                                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            $('#modal-container').html(modalHtml);
            $('#historicoPrecosModal').modal('show');
        },
        error: function () {
            showNotification('Erro ao carregar histórico de preços.', 'danger');
        }
    });
}
window.showHistoricoPrecos = showHistoricoPrecos;


function historicoProduto(produtoId) {
    const token = localStorage.getItem('token') || '';
    const headers = { Authorization: 'Bearer ' + token };
    const modoFiscal = typeof isModoFiscalVisualizacaoAtivo === 'function' && isModoFiscalVisualizacaoAtivo();

    Promise.all([
        fetch(`${API_URL}/produtos/${produtoId}/historico-estoque`, { headers }).then((r) => (r.ok ? r.json() : [])),
        fetch(`${API_URL}/produtos/${produtoId}/historico-precos`, { headers }).then((r) => (r.ok ? r.json() : [])),
        fetch(`${API_URL}/produtos/${produtoId}`, { headers }).then((r) => (r.ok ? r.json() : null))
    ])
        .then(([ajustes, precos, produto]) => {
            const nomeProduto = produto?.nome || `Produto #${produtoId}`;

            const linhasAjustes = (ajustes && ajustes.length)
                ? ajustes.map((r) => `
                    <tr>
                        <td>${formatDateTime(r.criado_em)}</td>
                        <td>${escapeHtml(r.usuario_nome || '-')}</td>
                        <td>${escapeHtml(r.motivo || '-')}</td>
                        <td class="text-end">${Number(r.ajuste_fiscal || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}</td>
                        ${modoFiscal ? '' : `<td class="text-end">${Number(r.ajuste_nao_fiscal || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}</td>`}
                        <td class="text-end">${Number(r.estoque_total_antes || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })} → ${Number(r.estoque_total_depois || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}</td>
                    </tr>
                `).join('')
                : `<tr><td colspan="${modoFiscal ? 5 : 6}" class="text-center text-muted">Nenhum ajuste de estoque registrado.</td></tr>`;

            const linhasPrecos = (precos && precos.length)
                ? precos.map((r) => `
                    <tr>
                        <td>${formatDateTime(r.created_at)}</td>
                        <td>${formatCurrency(r.preco_compra_anterior || 0)} → ${formatCurrency(r.preco_compra_novo || 0)}</td>
                        <td>${formatCurrency(r.preco_venda_anterior || 0)} → ${formatCurrency(r.preco_venda_novo || 0)}</td>
                    </tr>
                `).join('')
                : '<tr><td colspan="3" class="text-center text-muted">Nenhuma alteração de preço registrada.</td></tr>';

            const modalHtml = `
                <div class="modal fade" id="historicoProdutoModal" tabindex="-1" aria-hidden="true">
                    <div class="modal-dialog modal-xl modal-dialog-scrollable">
                        <div class="modal-content">
                            <div class="modal-header">
                                <h5 class="modal-title">Histórico — ${escapeHtml(nomeProduto)}</h5>
                                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                            </div>
                            <div class="modal-body">
                                <ul class="nav nav-tabs mb-3" role="tablist">
                                    <li class="nav-item" role="presentation">
                                        <button class="nav-link active" data-bs-toggle="tab" data-bs-target="#hist-ajustes" type="button">Ajustes de Estoque</button>
                                    </li>
                                    <li class="nav-item" role="presentation">
                                        <button class="nav-link" data-bs-toggle="tab" data-bs-target="#hist-precos" type="button">Preços</button>
                                    </li>
                                </ul>
                                <div class="tab-content">
                                    <div class="tab-pane fade show active" id="hist-ajustes">
                                        <div class="table-responsive">
                                            <table class="table table-sm table-striped">
                                                <thead>
                                                    <tr>
                                                        <th>Data</th>
                                                        <th>Usuário</th>
                                                        <th>Motivo</th>
                                                        <th class="text-end">Ajuste Fiscal</th>
                                                        ${modoFiscal ? '' : '<th class="text-end">Ajuste Não Fiscal</th>'}
                                                        <th class="text-end">Total (antes → depois)</th>
                                                    </tr>
                                                </thead>
                                                <tbody>${linhasAjustes}</tbody>
                                            </table>
                                        </div>
                                    </div>
                                    <div class="tab-pane fade" id="hist-precos">
                                        <div class="table-responsive">
                                            <table class="table table-sm table-striped">
                                                <thead>
                                                    <tr>
                                                        <th>Data</th>
                                                        <th>P. compra (de →)</th>
                                                        <th>P. venda (de →)</th>
                                                    </tr>
                                                </thead>
                                                <tbody>${linhasPrecos}</tbody>
                                            </table>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div class="modal-footer">
                                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            $('#historicoProdutoModal').remove();
            $('#modal-container').append(modalHtml);
            $('#historicoProdutoModal').modal('show');
        })
        .catch(() => {
            showNotification('Erro ao carregar histórico do produto.', 'danger');
        });
}
window.historicoProduto = historicoProduto;


// Excluir produto
function deleteProduto(id) {
    if (!confirm('Tem certeza que deseja excluir este produto?')) {
        return;
    }

    $.ajax({
        url: `${API_URL}/produtos/${id}`,
        method: 'DELETE',
        headers: {
            Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
        },
        success: function () {
            showNotification('Produto excluído com sucesso!', 'success');
            loadProdutos();
        },
        error: function (xhr) {
            const erro = xhr.responseJSON?.error || 'Erro desconhecido';
            showNotification('Erro ao excluir produto: ' + erro, 'danger');
        }
    });
}
window.deleteProduto = deleteProduto;


// Editar produto
function editProduto(id) {
    $.ajax({
        url: `${API_URL}/produtos/${id}`,
        method: 'GET',
        headers: {
            Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
        },
        success: function (produto) {
            showProdutoModal(produto);
        },
        error: function () {
            showNotification('Erro ao carregar produto para edição.', 'danger');
        }
    });
}
window.editProduto = editProduto;


function abrirModalAjustarEstoque(produtoId) {
    if (!usuarioPodeAjustarEstoque()) {
        showNotification('Acesso restrito: apenas ADMIN ou SUPER_ADMIN podem ajustar estoque.', 'warning');
        return;
    }

    const modoFiscal = typeof isModoFiscalVisualizacaoAtivo === 'function' && isModoFiscalVisualizacaoAtivo();

    $.ajax({
        url: `${API_URL}/produtos/${produtoId}`,
        method: 'GET',
        headers: {
            Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
        },
        success: function (produto) {
            const saldoFiscal = Number(produto.saldo_fiscal ?? 0);
            const saldoNaoFiscal = Number(produto.saldo_nao_fiscal ?? 0);
            const estoqueTotal = Number(produto.estoque_atual ?? (saldoFiscal + saldoNaoFiscal));
            const unidade = produto.unidade || '';
            const controlaValidade = Number(produto.controlar_validade || 0) === 1;

            const camposFiscal = modoFiscal ? `
                <div class="col-md-6 mb-3">
                    <label class="form-label">Saldo Fiscal Atual</label>
                    <input type="text" class="form-control bg-light" readonly value="${formatarEstoqueProduto(saldoFiscal, unidade)}">
                </div>
                <div class="col-md-6 mb-3">
                    <label for="ajuste_fiscal" class="form-label">Ajuste Fiscal (+/-)</label>
                    <input type="number" step="0.01" class="form-control" id="ajuste_fiscal" value="0">
                </div>
            ` : `
                <div class="col-md-4 mb-3">
                    <label class="form-label">Saldo Fiscal Atual</label>
                    <input type="text" class="form-control bg-light" readonly value="${formatarEstoqueProduto(saldoFiscal, unidade)}">
                </div>
                <div class="col-md-4 mb-3">
                    <label class="form-label">Saldo Não Fiscal Atual</label>
                    <input type="text" class="form-control bg-light" readonly value="${formatarEstoqueProduto(saldoNaoFiscal, unidade)}">
                </div>
                <div class="col-md-4 mb-3">
                    <label class="form-label">Estoque Total</label>
                    <input type="text" class="form-control bg-light" readonly value="${formatarEstoqueProduto(estoqueTotal, unidade)}">
                </div>
                <div class="col-md-6 mb-3">
                    <label for="ajuste_fiscal" class="form-label">Ajuste Fiscal (+/-)</label>
                    <input type="number" step="0.01" class="form-control" id="ajuste_fiscal" value="0">
                </div>
                <div class="col-md-6 mb-3">
                    <label for="ajuste_nao_fiscal" class="form-label">Ajuste Não Fiscal (+/-)</label>
                    <input type="number" step="0.01" class="form-control" id="ajuste_nao_fiscal" value="0">
                </div>
            `;

            const camposValidade = controlaValidade ? `
                <div class="col-12"><hr class="my-2"><small class="text-muted">Produto com controle de validade — informe validade em ajustes positivos.</small></div>
                <div class="col-md-4 mb-3">
                    <label for="ajuste_lote" class="form-label">Lote</label>
                    <input type="text" class="form-control" id="ajuste_lote" value="">
                </div>
                <div class="col-md-4 mb-3">
                    <label for="ajuste_data_fabricacao" class="form-label">Data Fabricação</label>
                    <input type="date" class="form-control" id="ajuste_data_fabricacao" value="">
                </div>
                <div class="col-md-4 mb-3">
                    <label for="ajuste_data_validade" class="form-label">Data Validade</label>
                    <input type="date" class="form-control" id="ajuste_data_validade" value="">
                </div>
            ` : '';

            const modalHtml = `
                <div class="modal fade" id="ajustarEstoqueModal" tabindex="-1" aria-hidden="true">
                    <div class="modal-dialog">
                        <div class="modal-content">
                            <div class="modal-header">
                                <h5 class="modal-title">Ajustar Estoque — ${escapeHtml(produto.nome || '')}</h5>
                                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                            </div>
                            <div class="modal-body">
                                <form id="ajustarEstoqueForm">
                                    <input type="hidden" id="ajuste_produto_id" value="${produtoId}">
                                    <input type="hidden" id="ajuste_controla_validade" value="${controlaValidade ? 1 : 0}">
                                    <div class="row">
                                        ${camposFiscal}
                                        ${camposValidade}
                                        <div class="col-12 mb-3">
                                            <label for="ajuste_motivo" class="form-label">Motivo *</label>
                                            <textarea class="form-control" id="ajuste_motivo" rows="2" required placeholder="Descreva o motivo do ajuste"></textarea>
                                        </div>
                                    </div>
                                </form>
                            </div>
                            <div class="modal-footer">
                                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                                <button type="button" class="btn btn-primary" onclick="salvarAjusteEstoque()">Confirmar Ajuste</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            $('#ajustarEstoqueModal').remove();
            $('#modal-container').append(modalHtml);
            $('#ajustarEstoqueModal').modal('show');
        },
        error: function () {
            showNotification('Erro ao carregar produto para ajuste de estoque.', 'danger');
        }
    });
}
window.abrirModalAjustarEstoque = abrirModalAjustarEstoque;


function salvarAjusteEstoque() {
    const produtoId = $('#ajuste_produto_id').val();
    const motivo = ($('#ajuste_motivo').val() || '').trim();
    const ajusteFiscal = parseFloat($('#ajuste_fiscal').val()) || 0;
    const ajusteNaoFiscal = parseFloat($('#ajuste_nao_fiscal').val()) || 0;
    const controlaValidade = $('#ajuste_controla_validade').val() === '1';
    const modoFiscal = typeof isModoFiscalVisualizacaoAtivo === 'function' && isModoFiscalVisualizacaoAtivo();

    if (!motivo) {
        showNotification('Informe o motivo do ajuste.', 'warning');
        $('#ajuste_motivo').focus();
        return;
    }

    if (ajusteFiscal === 0 && ajusteNaoFiscal === 0) {
        showNotification('Informe ao menos um ajuste diferente de zero.', 'warning');
        $('#ajuste_fiscal').focus();
        return;
    }

    const ajustePositivo = Math.max(0, ajusteFiscal) + Math.max(0, (modoFiscal ? 0 : ajusteNaoFiscal));
    if (controlaValidade && ajustePositivo > 0 && !($('#ajuste_data_validade').val() || '').trim()) {
        showNotification('Informe a data de validade para ajuste positivo em produto com controle de validade.', 'warning');
        $('#ajuste_data_validade').focus();
        return;
    }

    const payload = {
        ajuste_fiscal: ajusteFiscal,
        ajuste_nao_fiscal: modoFiscal ? 0 : ajusteNaoFiscal,
        motivo
    };

    if (controlaValidade) {
        payload.lote = ($('#ajuste_lote').val() || '').trim() || undefined;
        payload.data_fabricacao = ($('#ajuste_data_fabricacao').val() || '').trim() || undefined;
        payload.data_validade = ($('#ajuste_data_validade').val() || '').trim() || undefined;
    }

    $.ajax({
        url: `${API_URL}/produtos/${produtoId}/ajustar-estoque`,
        method: 'POST',
        contentType: 'application/json',
        headers: {
            Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
        },
        data: JSON.stringify(payload),
        success: function () {
            $('#ajustarEstoqueModal').modal('hide');
            showNotification('Estoque ajustado com sucesso!', 'success');
            loadProdutos();
        },
        error: function (xhr) {
            const erro = xhr.responseJSON?.error || 'Erro desconhecido';
            showNotification('Erro ao ajustar estoque: ' + erro, 'danger');
        }
    });
}
window.salvarAjusteEstoque = salvarAjusteEstoque;


// Visualizar produto
function viewProduto(id) {
    const modoFiscal = typeof modoFiscalQueryParam === 'function' ? modoFiscalQueryParam() : '0';

    $.ajax({
        url: `${API_URL}/produtos/${id}?modo_fiscal=${modoFiscal}`,
        method: 'GET',
        headers: {
            Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
        },
        success: function (produto) {
            const produtoNormalizado = normalizarProduto(produto, window.categoriasSistema || []);
            const modalHtml = `
                <div class="modal fade" id="viewProdutoModal" tabindex="-1" aria-hidden="true">
                    <div class="modal-dialog">
                        <div class="modal-content">
                            <div class="modal-header d-flex align-items-center justify-content-between">
                                <h5 class="modal-title">Detalhes do Produto</h5>
                                <div class="d-flex gap-2">
                                    <button type="button" class="btn btn-outline-secondary btn-sm" onclick="minimizarModal('viewProdutoModal')" title="Minimizar">
                                        <i class="fas fa-window-minimize"></i>
                                    </button>
                                    <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                                </div>
                            </div>
                            <div class="modal-body">
                                <p><strong>Nome:</strong> ${escapeHtml(produtoNormalizado.nome || '-')}</p>
                                <p><strong>Código:</strong> ${escapeHtml(produtoNormalizado.codigo || '-')}</p>
                                <p><strong>Categoria:</strong> ${escapeHtml(produtoNormalizado.categoria || '-')}</p>
                                <p><strong>Subcategoria:</strong> ${escapeHtml(produtoNormalizado.subcategoria || '-')}</p>
                                <p><strong>Unidade:</strong> ${escapeHtml(produtoNormalizado.unidade || '-')}</p>
                                <p><strong>Preço de Compra:</strong> ${formatCurrency(produtoNormalizado.preco_compra || 0)}</p>
                                <p><strong>Preço de Venda:</strong> ${formatCurrency(produtoNormalizado.preco_venda || 0)}</p>
                                ${formatarEstoqueDetalheProduto(produto)}
                                <p><strong>Estoque Mínimo:</strong> ${Number(produtoNormalizado.estoque_minimo || 0)}</p>
                                <p><strong>Fornecedor:</strong> ${escapeHtml(produtoNormalizado.fornecedor || '-')}</p>
                            </div>
                            <div class="modal-footer">
                                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            $('#modal-container').html(modalHtml);
            $('#viewProdutoModal').modal('show');
        },
        error: function () {
            showNotification('Erro ao carregar detalhes do produto.', 'danger');
        }
    });
}
window.viewProduto = viewProduto;

// ============================================
// FUNÇÕES DE PROMOÇÕES INTELIGENTES
// ============================================

/**
 * Carrega dados do dashboard de promoções (card)
 */
async function carregarDashboardPromocoes() {
    try {
        const response = await fetch(`${API_URL}/produtos/promocoes/dashboard`, {
            method: 'GET',
            headers: {
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            }
        });

        if (!response.ok) {
            console.error('Erro ao carregar dashboard de promoções');
            return;
        }

        const dados = await response.json();

        // Atualizar elementos do card
        $('#qtdSugestoesProdutos').text(dados.sugestoes_pendentes || 0);
        $('#qtdPromocoesProdutos').text(dados.promocoes_ativas || 0);
    } catch (error) {
        console.error('Erro ao carregar dashboard de promoções:', error);
    }
}

function formatarMoedaPromocao(valor) {
    return Number(valor || 0).toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

async function carregarEstatisticasPromocoes() {
    try {
        const response = await fetch(`${API_URL}/produtos/promocoes/dashboard`, {
            method: 'GET',
            headers: {
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            }
        });

        if (!response.ok) {
            console.error('Erro ao carregar estatísticas de promoções');
            return;
        }

        const dados = await response.json();

        $('#statsPromocoesCriadas').text(dados.promocoes_criadas || 0);
        $('#statsProdutosSalvosVencimento').text(dados.produtos_salvos_vencimento || 0);
        $('#statsReceitaGerada').text(`R$ ${formatarMoedaPromocao(dados.receita_gerada || 0)}`);
        $('#statsPerdasEvitadas').text(`R$ ${formatarMoedaPromocao(dados.perdas_evitadas || 0)}`);
    } catch (error) {
        console.error('Erro ao carregar estatísticas de promoções:', error);
    }
}

/**
 * Abre modal com sugestões de promoções
 */
async function abrirModalPromocoesProdutos() {
    // Limpar modal anterior
    $('#modalPromocoesProdutos').remove();

    const modalHtml = `
        <div class="modal fade" id="modalPromocoesProdutos" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-lg modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Promoções Inteligentes - Sugestões</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
                    </div>
                    <div class="modal-body">
                        <ul class="nav nav-tabs" id="abas-promocoes" role="tablist">
                            <li class="nav-item" role="presentation">
                                <button class="nav-link active" id="aba-sugestoes" data-bs-toggle="tab" data-bs-target="#painel-sugestoes" type="button" role="tab" aria-controls="painel-sugestoes" aria-selected="true">
                                    Sugestões
                                </button>
                            </li>
                            <li class="nav-item" role="presentation">
                                <button class="nav-link" id="aba-ativas" data-bs-toggle="tab" data-bs-target="#painel-ativas" type="button" role="tab" aria-controls="painel-ativas" aria-selected="false">
                                    Ativas
                                </button>
                            </li>
                            <li class="nav-item" role="presentation">
                                <button class="nav-link" id="aba-encerradas" data-bs-toggle="tab" data-bs-target="#painel-encerradas" type="button" role="tab" aria-controls="painel-encerradas" aria-selected="false">
                                    Encerradas
                                </button>
                            </li>
                            <li class="nav-item" role="presentation">
                                <button class="nav-link" id="aba-estatisticas" data-bs-toggle="tab" data-bs-target="#painel-estatisticas" type="button" role="tab" aria-controls="painel-estatisticas" aria-selected="false">
                                    Estatísticas
                                </button>
                            </li>
                        </ul>

                        <div class="tab-content mt-3" id="conteudo-abas-promocoes">
                            <!-- ABA SUGESTÕES -->
                            <div class="tab-pane fade show active" id="painel-sugestoes" role="tabpanel" aria-labelledby="aba-sugestoes">
                                <div id="lista-sugestoes" class="spinner-wrapper">
                                    <div class="text-center">
                                        <div class="spinner-border spinner-border-sm text-primary"></div>
                                        <p class="text-muted mt-2">Carregando sugestões...</p>
                                    </div>
                                </div>
                            </div>

                            <!-- ABA ATIVAS -->
                            <div class="tab-pane fade" id="painel-ativas" role="tabpanel" aria-labelledby="aba-ativas">
                                <div id="lista-promocoes-ativas" class="spinner-wrapper">
                                    <div class="text-center">
                                        <div class="spinner-border spinner-border-sm text-primary"></div>
                                        <p class="text-muted mt-2">Carregando promoções ativas...</p>
                                    </div>
                                </div>
                            </div>

                            <!-- ABA ENCERRADAS -->
                            <div class="tab-pane fade" id="painel-encerradas" role="tabpanel" aria-labelledby="aba-encerradas">
                                <div id="lista-promocoes-encerradas" class="spinner-wrapper">
                                    <div class="text-center">
                                        <div class="spinner-border spinner-border-sm text-primary"></div>
                                        <p class="text-muted mt-2">Carregando promoções encerradas...</p>
                                    </div>
                                </div>
                            </div>

                            <!-- ABA ESTATÍSTICAS -->
                            <div class="tab-pane fade" id="painel-estatisticas" role="tabpanel" aria-labelledby="aba-estatisticas">
                                <div class="row g-3">
                                    <div class="col-12 col-md-6 col-xl-3">
                                        <div class="card h-100 border-secondary border-1 shadow-sm">
                                            <div class="card-body py-3 px-3 text-center">
                                                <p class="text-uppercase text-muted small mb-2">Promoções criadas</p>
                                                <p class="h5 fw-bold mb-0" id="statsPromocoesCriadas">0</p>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="col-12 col-md-6 col-xl-3">
                                        <div class="card h-100 border-secondary border-1 shadow-sm">
                                            <div class="card-body py-3 px-3 text-center">
                                                <p class="text-uppercase text-muted small mb-2">Produtos salvos do vencimento</p>
                                                <p class="h5 fw-bold mb-0" id="statsProdutosSalvosVencimento">0</p>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="col-12 col-md-6 col-xl-3">
                                        <div class="card h-100 border-secondary border-1 shadow-sm">
                                            <div class="card-body py-3 px-3 text-center">
                                                <p class="text-uppercase text-muted small mb-2">Receita gerada por promoções</p>
                                                <p class="h5 fw-bold mb-0" id="statsReceitaGerada">R$ 0,00</p>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="col-12 col-md-6 col-xl-3">
                                        <div class="card h-100 border-secondary border-1 shadow-sm">
                                            <div class="card-body py-3 px-3 text-center">
                                                <p class="text-uppercase text-muted small mb-2">Perdas evitadas</p>
                                                <p class="h5 fw-bold mb-0" id="statsPerdasEvitadas">R$ 0,00</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="modal-footer">
                        <button type="button" class="btn btn-warning" onclick="verificarPromocoeExpiradas()">
                            <i class="fas fa-exclamation-triangle"></i> Verificar Expiradas
                        </button>
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button>
                        <button type="button" class="btn btn-primary" onclick="abrirModalGerarSugestoesAvancado()">
                            <i class="fas fa-magic"></i> Gerar Sugestões
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Adicionar modal ao DOM
    if (!$('#modal-container').length) {
        $('body').append('<div id="modal-container"></div>');
    }
    $('#modal-container').html(modalHtml);

    // Mostrar modal
    const modal = new bootstrap.Modal(document.getElementById('modalPromocoesProdutos'));
    modal.show();

    // Carregar dados das três abas e as estatísticas da promoção inteligente
    carregarEstatisticasPromocoes();
    carregarSugestoesPromocoes(true);
    carregarPromocoes('ativas');
    carregarPromocoes('encerradas');
}

window.abrirModalPromocoesProdutos = abrirModalPromocoesProdutos;

/**
 * Abre modal avançado para gerar sugestões com seleção de produtos e desconto customizável
 */
async function abrirModalGerarSugestoesAvancado() {
    // Limpar modal anterior
    $('#modalGerarSugestoesAvancado').remove();

    const modalHtml = `
        <div class="modal fade" id="modalGerarSugestoesAvancado" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-lg modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">
                            <i class="fas fa-cog"></i> Gerar Sugestões de Promoções
                        </h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
                    </div>
                    <div class="modal-body">
                        <!-- Seção de Desconto -->
                        <div class="mb-4">
                            <label for="descontoPercentual" class="form-label">
                                <strong>Desconto Percentual (%)</strong>
                            </label>
                            <div class="input-group">
                                <input type="number" class="form-control" id="descontoPercentual" 
                                    value="15" min="1" max="100" step="0.5">
                                <span class="input-group-text">%</span>
                            </div>
                            <small class="form-text text-muted">Deixe em branco para usar o desconto padrão (15%)</small>
                        </div>

                        <!-- Seção de Seleção de Produtos -->
                        <div class="mb-3">
                            <div class="d-flex justify-content-between align-items-center mb-2">
                                <label class="form-label mb-0">
                                    <strong>Selecionar Produtos</strong>
                                </label>
                                <div>
                                    <button type="button" class="btn btn-sm btn-outline-secondary" onclick="selecionarTodosProdutosAvancado()">
                                        Selecionar Todos
                                    </button>
                                    <button type="button" class="btn btn-sm btn-outline-secondary" onclick="desseleccionarTodosProdutosAvancado()">
                                        Desselecionar Todos
                                    </button>
                                </div>
                            </div>
                        </div>

                        <!-- Lista de Produtos com Checkboxes -->
                        <div id="listaProdutosAvancado" class="border rounded p-3" style="max-height: 300px; overflow-y: auto;">
                            <div class="text-center">
                                <div class="spinner-border spinner-border-sm text-primary"></div>
                                <p class="text-muted mt-2">Carregando produtos...</p>
                            </div>
                        </div>

                        <small class="form-text text-muted d-block mt-2">
                            <strong id="qtdProdutosSelecionados">0</strong> produtos selecionados.
                            Elegíveis por validade (até 7 dias) ou giro baixo (15+ dias sem venda).
                        </small>
                    </div>

                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                        <button type="button" class="btn btn-primary" onclick="gerarSugestoesAvancado()">
                            <i class="fas fa-check-circle"></i> Gerar Sugestões
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Adicionar modal ao DOM
    if (!$('#modal-container-avancado').length) {
        $('body').append('<div id="modal-container-avancado"></div>');
    }
    $('#modal-container-avancado').html(modalHtml);

    // Fechar modal de sugestões anterior, se estiver aberto
    const modalSugestoesEl = document.getElementById('modalPromocoesProdutos');
    if (modalSugestoesEl) {
        const modalSugestoes = bootstrap.Modal.getInstance(modalSugestoesEl) || new bootstrap.Modal(modalSugestoesEl);
        modalSugestoes.hide();
    }

    // Mostrar modal avançado
    const modal = new bootstrap.Modal(document.getElementById('modalGerarSugestoesAvancado'));
    modal.show();

    // Carregar produtos elegíveis para promoção (validade + giro)
    await carregarProdutosElegiveisPromocao();
}

window.abrirModalGerarSugestoesAvancado = abrirModalGerarSugestoesAvancado;

function montarDetalheProdutoElegivel(produto) {
    if (Number(produto.controlar_validade) === 1 && Number.isFinite(Number(produto.dias_para_vencer))) {
        const dias = Number(produto.dias_para_vencer);
        if (dias < 0) {
            return `Validade: venceu há ${Math.abs(dias)} dia(s)`;
        }
        if (dias === 0) {
            return 'Validade: vence hoje';
        }
        return `Validade: ${dias} dia(s) para vencer`;
    }

    if (Number.isFinite(Number(produto.dias_sem_venda))) {
        return `Sem venda há ${produto.dias_sem_venda} dia(s)`;
    }

    if (String(produto.motivo || '').includes('Nunca Vendeu')) {
        return 'Nunca vendido';
    }

    return 'Elegível para promoção';
}

/**
 * Carrega produtos elegíveis para sugestão (validade ou giro baixo)
 */
async function carregarProdutosElegiveisPromocao() {
    const container = $('#listaProdutosAvancado');

    try {
        const response = await fetch(`${API_URL}/produtos/promocoes/produtos-elegiveis`, {
            method: 'GET',
            headers: {
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            }
        });

        if (!response.ok) {
            throw new Error('Erro ao carregar produtos elegíveis');
        }

        const produtosElegiveis = await response.json();

        if (!produtosElegiveis || produtosElegiveis.length === 0) {
            container.html(`
                <div class="alert alert-info">
                    <i class="fas fa-info-circle"></i> Nenhum produto elegível no momento.
                    Produtos entram aqui por validade próxima/vencida ou por giro baixo (15+ dias sem venda).
                </div>
            `);
            return;
        }

        let html = '<div class="list-group">';

        produtosElegiveis.forEach(p => {
            const detalhe = montarDetalheProdutoElegivel(p);

            html += `
                <label class="list-group-item">
                    <div class="d-flex align-items-center">
                        <input type="checkbox" class="form-check-input me-3 checkbox-produto-avancado" 
                            value="${p.id}" data-nome="${escapeHtml(p.nome)}" data-preco="${p.preco_venda}">
                        <div class="flex-grow-1">
                            <div class="d-flex justify-content-between align-items-start gap-2">
                                <strong>${escapeHtml(p.nome)}</strong>
                                ${formatarBadgeMotivoSugestao(p.motivo)}
                            </div>
                            <small class="text-muted">
                                ${escapeHtml(detalhe)} |
                                Estoque: ${formatarEstoqueExibicaoTela(p)} |
                                Preço: ${formatCurrency(p.preco_venda || 0)}
                            </small>
                        </div>
                    </div>
                </label>
            `;
        });

        html += '</div>';
        container.html(html);

        $('.checkbox-produto-avancado').on('change', atualizarContadorProdutosSelecionados);
        atualizarContadorProdutosSelecionados();
    } catch (error) {
        console.error('Erro ao carregar produtos elegíveis:', error);
        container.html(`
            <div class="alert alert-danger">
                <i class="fas fa-exclamation-circle"></i> Erro ao carregar produtos elegíveis.
            </div>
        `);
    }
}

window.carregarProdutosElegiveisPromocao = carregarProdutosElegiveisPromocao;

/** @deprecated Use carregarProdutosElegiveisPromocao */
async function carregarProdutosComValidade() {
    return carregarProdutosElegiveisPromocao();
}

window.carregarProdutosComValidade = carregarProdutosComValidade;

/**
 * Atualiza contador de produtos selecionados
 */
function atualizarContadorProdutosSelecionados() {
    const qtd = $('.checkbox-produto-avancado:checked').length;
    $('#qtdProdutosSelecionados').text(qtd);
}

/**
 * Seleciona todos os produtos
 */
function selecionarTodosProdutosAvancado() {
    $('.checkbox-produto-avancado').prop('checked', true);
    atualizarContadorProdutosSelecionados();
}

window.selecionarTodosProdutosAvancado = selecionarTodosProdutosAvancado;

/**
 * Desseleciona todos os produtos
 */
function desseleccionarTodosProdutosAvancado() {
    $('.checkbox-produto-avancado').prop('checked', false);
    atualizarContadorProdutosSelecionados();
}

window.desseleccionarTodosProdutosAvancado = desseleccionarTodosProdutosAvancado;

/**
 * Gera sugestões com opções avançadas (múltiplos produtos e desconto customizável)
 */
async function gerarSugestoesAvancado() {
    // Obter produtos selecionados
    const produtosSelecionados = $('.checkbox-produto-avancado:checked').map(function() {
        return parseInt($(this).val());
    }).get();

    if (produtosSelecionados.length === 0) {
        showNotification('Selecione pelo menos um produto', 'warning');
        return;
    }

    // Obter desconto percentual
    const desconto = parseFloat($('#descontoPercentual').val()) || 15;

    if (desconto <= 0 || desconto > 100) {
        showNotification('Desconto deve estar entre 1% e 100%', 'warning');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/produtos/promocoes/gerar-sugestoes`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            },
            body: JSON.stringify({
                produto_ids: produtosSelecionados,
                desconto_percentual: desconto
            })
        });

        if (!response.ok) {
            throw new Error('Erro ao gerar sugestões');
        }

        const resultado = await response.json();
        showNotification(
            resultado.message || `${resultado.total} sugestão(ões) gerada(s).`,
            resultado.total > 0 ? 'success' : 'info'
        );
        
        // Fechar modal
        bootstrap.Modal.getInstance(document.getElementById('modalGerarSugestoesAvancado')).hide();

        // Recarregar dados
        carregarSugestoesPromocoes();
        carregarDashboardPromocoes();
    } catch (error) {
        console.error('Erro ao gerar sugestões:', error);
        showNotification('Erro ao gerar sugestões', 'danger');
    }
}

window.gerarSugestoesAvancado = gerarSugestoesAvancado;

function formatarBadgeMotivoSugestao(motivo) {
    const texto = String(motivo || '-');
    let badgeClass = 'bg-secondary';

    if (texto.startsWith('🔴')) badgeClass = 'bg-danger';
    else if (texto.startsWith('🟠')) badgeClass = 'bg-warning text-dark';
    else if (texto.startsWith('🟡')) badgeClass = 'bg-warning text-dark';
    else if (texto.startsWith('⚫')) badgeClass = 'bg-dark';

    return `<span class="badge ${badgeClass}">${escapeHtml(texto)}</span>`;
}

function ehMotivoValidade(motivo) {
    const texto = String(motivo || '');
    return texto.includes('Vence') || texto.includes('Vencido') || texto === 'vencimento_proximo';
}

function formatarInfoValidadeSugestao(sugestao) {
    const dias = Number(sugestao.dias_para_vencer);

    if (!Number.isFinite(dias)) return '';

    if (dias < 0) {
        return `<br><small class="text-muted">Venceu há ${Math.abs(dias)} dia(s)</small>`;
    }

    if (dias === 0) {
        return '<br><small class="text-muted">Vence hoje</small>';
    }

    return `<br><small class="text-muted">${dias} dia(s) para vencer</small>`;
}

function formatarInfoSugestao(sugestao) {
    if (ehMotivoValidade(sugestao.motivo)) {
        return formatarInfoValidadeSugestao(sugestao);
    }

    const diasSemVenda = Number(sugestao.dias_sem_venda);
    if (Number.isFinite(diasSemVenda)) {
        return `<br><small class="text-muted">Sem venda há ${diasSemVenda} dia(s)</small>`;
    }

    if (String(sugestao.motivo || '').includes('Nunca Vendeu')) {
        return '<br><small class="text-muted">Nunca vendido</small>';
    }

    return '';
}

/**
 * Carrega sugestões de promoções
 */
async function carregarSugestoesPromocoes(autoGerar = false) {
    const container = $('#lista-sugestoes');
    container.html('<div class="text-center"><div class="spinner-border spinner-border-sm text-primary"></div></div>');

    try {
        const response = await fetch(`${API_URL}/produtos/promocoes/sugestoes`, {
            method: 'GET',
            headers: {
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            }
        });

        if (!response.ok) {
            throw new Error('Erro ao carregar sugestões');
        }

        const sugestoes = await response.json();

        if (!sugestoes || sugestoes.length === 0) {
            if (autoGerar) {
                const resultado = await gerarSugestoesPromocoes({ silent: true });
                if (resultado?.total > 0) {
                    return carregarSugestoesPromocoes(false);
                }
            }

            container.html(`
                <div class="alert alert-info">
                    <i class="fas fa-info-circle"></i> Nenhuma sugestão de promoção disponível no momento.
                </div>
            `);
            return;
        }

        let html = '<div class="table-responsive"><table class="table table-striped table-hover">';
        html += `
            <thead>
                <tr>
                    <th>Produto</th>
                    <th>Motivo</th>
                    <th>${tituloColunaEstoqueLista()}</th>
                    <th>Preço Atual</th>
                    <th>Desconto Sugerido</th>
                    <th>Preço Promocional</th>
                    <th>Ações</th>
                </tr>
            </thead>
            <tbody>
        `;

        sugestoes.forEach(s => {
            const desconto = Number(s.desconto_percentual || 0).toFixed(2);
            const diasInfo = formatarInfoSugestao(s);
            html += `
                <tr>
                    <td>
                        <strong>${escapeHtml(s.nome_produto || '-')}</strong>
                        ${diasInfo}
                    </td>
                    <td>${formatarBadgeMotivoSugestao(s.motivo)}</td>
                    <td>${escapeHtml(formatarEstoqueExibicaoTela(s))}</td>
                    <td>${formatCurrency(s.preco_atual || 0)}</td>
                    <td><span class="badge bg-danger">${desconto}%</span></td>
                    <td>${formatCurrency(s.preco_sugerido || 0)}</td>
                    <td>
                        <button class="btn btn-sm btn-success" onclick="aceitarSugestaoPromocao(${s.id})" title="Editar desconto e criar promoção">
                            <i class="fas fa-check"></i> Aceitar
                        </button>
                        <button class="btn btn-sm btn-danger" onclick="rejeitarSugestaoPromocao(${s.id})" title="Descartar sugestão">
                            <i class="fas fa-times"></i> Rejeitar
                        </button>
                    </td>
                </tr>
            `;
        });

        html += '</tbody></table></div>';
        container.html(html);
    } catch (error) {
        console.error('Erro ao carregar sugestões:', error);
        container.html(`
            <div class="alert alert-danger">
                <i class="fas fa-exclamation-circle"></i> Erro ao carregar sugestões.
            </div>
        `);
    }
}

/**
 * Carrega promoções (ativas ou encerradas)
 */
async function carregarPromocoes(tipo) {
    const container = tipo === 'ativas' 
        ? $('#lista-promocoes-ativas') 
        : $('#lista-promocoes-encerradas');

    container.html('<div class="text-center"><div class="spinner-border spinner-border-sm text-primary"></div></div>');

    try {
        const response = await fetch(`${API_URL}/produtos/promocoes?status=${tipo}`, {
            method: 'GET',
            headers: {
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            }
        });

        if (!response.ok) {
            throw new Error('Erro ao carregar promoções');
        }

        const promocoes = await response.json();

        if (!promocoes || promocoes.length === 0) {
            const mensagem = tipo === 'ativas' 
                ? 'Nenhuma promoção ativa no momento.'
                : 'Nenhuma promoção encerrada.';
            container.html(`
                <div class="alert alert-info">
                    <i class="fas fa-info-circle"></i> ${mensagem}
                </div>
            `);
            return;
        }

        let html = '<div class="table-responsive"><table class="table table-striped table-hover">';
        html += `
            <thead>
                <tr>
                    <th>Produto</th>
                    <th>Preço Original</th>
                    <th>Preço Promocional</th>
                    <th>Desconto</th>
                    <th>Período</th>
                    <th>Status</th>
                    ${tipo === 'ativas' ? '<th>Ações</th>' : ''}
                </tr>
            </thead>
            <tbody>
        `;

        promocoes.forEach(p => {
            const desconto = Number(p.desconto_percentual || 0).toFixed(2);
            const dataInicio = new Date(p.data_inicio).toLocaleDateString('pt-BR');
            const dataFim = new Date(p.data_fim).toLocaleDateString('pt-BR');
            
            // Calcular status real
            const hoje = new Date();
            hoje.setHours(0, 0, 0, 0);
            const fimDate = new Date(p.data_fim);
            fimDate.setHours(0, 0, 0, 0);
            const inicioDate = new Date(p.data_inicio);
            inicioDate.setHours(0, 0, 0, 0);
            
            let statusReal = p.status;
            let badgeClass = 'bg-secondary';
            
            if (p.status === 'ativa') {
                if (fimDate < hoje) {
                    statusReal = '⚠️ EXPIRADA';
                    badgeClass = 'bg-danger';
                } else if (inicioDate > hoje) {
                    statusReal = '🕐 NÃO INICIADA';
                    badgeClass = 'bg-warning text-dark';
                } else {
                    statusReal = '✅ VIGENTE';
                    badgeClass = 'bg-success';
                }
            } else if (p.status === 'encerrada') {
                statusReal = '❌ ENCERRADA';
                badgeClass = 'bg-secondary';
            }

            html += `
                <tr>
                    <td><strong>${escapeHtml(p.nome_produto || '-')}</strong></td>
                    <td>${formatCurrency(p.preco_original || 0)}</td>
                    <td>${formatCurrency(p.preco_promocional || 0)}</td>
                    <td>${desconto}%</td>
                    <td>${dataInicio} até ${dataFim}</td>
                    <td><span class="badge ${badgeClass}">${statusReal}</span></td>
                    ${tipo === 'ativas' ? `
                        <td>
                            <button class="btn btn-sm btn-danger" onclick="encerrarPromocao(${p.id})">
                                <i class="fas fa-stop-circle"></i> Encerrar
                            </button>
                        </td>
                    ` : ''}
                </tr>
            `;
        });

        html += '</tbody></table></div>';
        container.html(html);
    } catch (error) {
        console.error('Erro ao carregar promoções:', error);
        container.html(`
            <div class="alert alert-danger">
                <i class="fas fa-exclamation-circle"></i> Erro ao carregar promoções.
            </div>
        `);
    }
}

/**
 * Aceita sugestão de promoção - abre modal para editar desconto
 */
async function aceitarSugestaoPromocao(sugestaoId) {
    try {
        // Buscar dados da sugestão
        const response = await fetch(`${API_URL}/produtos/promocoes/sugestoes`, {
            method: 'GET',
            headers: {
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            }
        });

        if (!response.ok) {
            throw new Error('Erro ao carregar sugestões');
        }

        const sugestoes = await response.json();
        const sugestao = sugestoes.find(s => s.id === sugestaoId);

        if (!sugestao) {
            throw new Error('Sugestão não encontrada');
        }

        // Abrir modal para confirmar e editar desconto
        abrirModalConfirmarSugestao(sugestao);
    } catch (error) {
        console.error('Erro ao aceitar sugestão:', error);
        showNotification('Erro ao aceitar sugestão', 'danger');
    }
}

/**
 * Abre modal para confirmar sugestão e editar desconto
 */
async function abrirModalConfirmarSugestao(sugestao) {
    const hoje = new Date().toISOString().split('T')[0];
    const amanhaDate = new Date();
    amanhaDate.setDate(amanhaDate.getDate() + 1);
    const amanha = amanhaDate.toISOString().split('T')[0];

    const modalHtml = `
        <div class="modal fade" id="modalConfirmarSugestao" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">
                            <i class="fas fa-check-circle text-success"></i> Confirmar Promoção
                        </h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
                    </div>
                    <div class="modal-body">
                        <div class="row mb-3">
                            <div class="col-md-6">
                                <label class="form-label"><strong>Produto</strong></label>
                                <p class="form-control-static">${escapeHtml(sugestao.nome_produto || '')}</p>
                            </div>
                            <div class="col-md-6">
                                <label class="form-label"><strong>Motivo</strong></label>
                                <p class="form-control-static">
                                    <span class="badge bg-info">${sugestao.motivo.replace(/_/g, ' ')}</span>
                                </p>
                            </div>
                        </div>

                        <div class="row mb-3">
                            <div class="col-md-6">
                                <label class="form-label"><strong>Preço Atual</strong></label>
                                <p class="form-control-static">${formatCurrency(sugestao.preco_atual || 0)}</p>
                            </div>
                            <div class="col-md-6">
                                <label class="form-label"><strong>Estoque Disponível</strong></label>
                                <p class="form-control-static">${escapeHtml(formatarEstoqueExibicaoTela(sugestao))}</p>
                            </div>
                        </div>

                        <hr>

                        <div class="row mb-3">
                            <div class="col-md-4">
                                <label for="descontoConfirmar" class="form-label">
                                    <strong>Desconto (%)</strong>
                                </label>
                                <div class="input-group">
                                    <input type="number" class="form-control" id="descontoConfirmar" 
                                        value="${Number(sugestao.desconto_percentual || 15).toFixed(2)}" 
                                        min="1" max="100" step="0.5">
                                    <span class="input-group-text">%</span>
                                </div>
                            </div>
                            <div class="col-md-4">
                                <label class="form-label"><strong>Preço Promocional</strong></label>
                                <p class="form-control-static" id="precoPromocionalDisplay">
                                    ${formatCurrency(sugestao.preco_sugerido || 0)}
                                </p>
                            </div>
                            <div class="col-md-4">
                                <label class="form-label"><strong>Economia</strong></label>
                                <p class="form-control-static text-success" id="economiaDisplay">
                                    ${formatCurrency((sugestao.preco_atual - sugestao.preco_sugerido) || 0)}
                                </p>
                            </div>
                        </div>

                        <hr>

                        <div class="row mb-3">
                            <div class="col-md-6">
                                <label for="dataInicioConfirmar" class="form-label"><strong>Data Início</strong></label>
                                <input type="date" class="form-control" id="dataInicioConfirmar" value="${hoje}">
                            </div>
                            <div class="col-md-6">
                                <label for="dataFimConfirmar" class="form-label"><strong>Data Fim</strong></label>
                                <input type="date" class="form-control" id="dataFimConfirmar" value="${amanha}">
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                        <button type="button" class="btn btn-success" onclick="confirmarSugestaoPromocao(${sugestao.id}, ${sugestao.produto_id}, ${sugestao.preco_atual})">
                            <i class="fas fa-check"></i> Criar Promoção
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    if (!$('#modal-container-sugestao').length) {
        $('body').append('<div id="modal-container-sugestao"></div>');
    }
    $('#modal-container-sugestao').html(modalHtml);

    const modal = new bootstrap.Modal(document.getElementById('modalConfirmarSugestao'));
    modal.show();

    // Atualizar preço promocional ao mudar desconto
    const precoAtualValue = sugestao.preco_atual || 0;
    $('#descontoConfirmar').on('change', function() {
        const desconto = parseFloat($(this).val()) || 0;
        const precoPromocional = (precoAtualValue * (1 - desconto / 100)).toFixed(2);
        const economia = (precoAtualValue - precoPromocional).toFixed(2);
        
        $('#precoPromocionalDisplay').text(formatCurrency(precoPromocional));
        $('#economiaDisplay').text(formatCurrency(economia));
    });
}

/**
 * Confirma e cria a promoção
 */
async function confirmarSugestaoPromocao(sugestaoId, produtoId, precoOriginal) {
    try {
        const desconto = parseFloat($('#descontoConfirmar').val()) || 15;
        const dataInicio = $('#dataInicioConfirmar').val();
        const dataFim = $('#dataFimConfirmar').val();

        if (!dataInicio || !dataFim) {
            showNotification('Preencha as datas de início e fim', 'warning');
            return;
        }

        if (new Date(dataInicio) > new Date(dataFim)) {
            showNotification('Data de fim não pode ser anterior à data de início', 'warning');
            return;
        }

        // Calcular preço promocional
        const precoPromocional = (precoOriginal * (1 - desconto / 100)).toFixed(2);

        // Criar promoção
        const responsePromocao = await fetch(`${API_URL}/produtos/promocoes`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            },
            body: JSON.stringify({
                produto_id: produtoId,
                preco_original: precoOriginal,
                preco_promocional: precoPromocional,
                data_inicio: dataInicio,
                data_fim: dataFim
            })
        });

        if (!responsePromocao.ok) {
            throw new Error('Erro ao criar promoção');
        }

        const resultadoPromocao = await responsePromocao.json();

        // Marcar sugestão como aceita
        const responseSugestao = await fetch(`${API_URL}/produtos/promocoes/sugestoes/${sugestaoId}/processar`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            },
            body: JSON.stringify({ acao: 'aceitar' })
        });

        if (!responseSugestao.ok) {
            console.warn('Sugestão não foi marcada como aceita, mas a promoção foi criada');
        }

        showNotification('Promoção criada e ativada com sucesso!', 'success');
        
        // Fechar modal
        bootstrap.Modal.getInstance(document.getElementById('modalConfirmarSugestao')).hide();
        
        // Recarregar dados
        carregarSugestoesPromocoes();
        carregarPromocoes('ativas');
        carregarDashboardPromocoes();
    } catch (error) {
        console.error('Erro ao confirmar sugestão:', error);
        showNotification('Erro ao criar promoção', 'danger');
    }
}

window.aceitarSugestaoPromocao = aceitarSugestaoPromocao;
window.confirmarSugestaoPromocao = confirmarSugestaoPromocao;

/**
 * Rejeita sugestão de promoção
 */
async function rejeitarSugestaoPromocao(sugestaoId) {
    try {
        const response = await fetch(`${API_URL}/produtos/promocoes/sugestoes/${sugestaoId}/processar`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            },
            body: JSON.stringify({ acao: 'rejeitar' })
        });

        if (!response.ok) {
            throw new Error('Erro ao rejeitar sugestão');
        }

        showNotification('Sugestão rejeitada!', 'info');
        carregarSugestoesPromocoes();
    } catch (error) {
        console.error('Erro ao rejeitar sugestão:', error);
        showNotification('Erro ao rejeitar sugestão', 'danger');
    }
}

window.rejeitarSugestaoPromocao = rejeitarSugestaoPromocao;

/**
 * Encerra promoção ativa
 */
async function encerrarPromocao(promocaoId) {
    if (!confirm('Tem certeza que deseja encerrar esta promoção?')) {
        return;
    }

    try {
        const response = await fetch(`${API_URL}/produtos/promocoes/${promocaoId}/encerrar`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            },
            body: JSON.stringify({ motivo_encerramento: 'Encerrada pelo usuário' })
        });

        if (!response.ok) {
            throw new Error('Erro ao encerrar promoção');
        }

        showNotification('Promoção encerrada com sucesso!', 'success');
        carregarPromocoes('ativas');
        carregarPromocoes('encerradas');
        carregarDashboardPromocoes();
    } catch (error) {
        console.error('Erro ao encerrar promoção:', error);
        showNotification('Erro ao encerrar promoção', 'danger');
    }
}

window.encerrarPromocao = encerrarPromocao;

/**
 * Verifica e encerra promoções expiradas manualmente
 */
async function verificarPromocoeExpiradas() {
    try {
        const response = await fetch(`${API_URL}/produtos/verificar-expiradas-agora`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            }
        });

        if (!response.ok) {
            throw new Error('Erro ao verificar promoções expiradas');
        }

        const resultado = await response.json();
        
        showNotification(resultado.message, 'success');
        
        // Recarregar as listas de promoções
        carregarPromocoes('ativas');
        carregarPromocoes('encerradas');
        carregarDashboardPromocoes();
        carregarEstatisticasPromocoes();
        
    } catch (error) {
        console.error('Erro ao verificar promoções expiradas:', error);
        showNotification('Erro ao verificar promoções expiradas', 'danger');
    }
}

window.verificarPromocoeExpiradas = verificarPromocoeExpiradas;
/**
 * Gera sugestões automáticas (versão simples - sem parâmetros)
 * @deprecated Use gerarSugestoesAvancado() em vez disso
 */
async function gerarSugestoesPromocoes(options = { silent: false }) {
    try {
        const response = await fetch(`${API_URL}/produtos/promocoes/gerar-sugestoes`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            },
            body: JSON.stringify({
                produto_ids: [],
                desconto_percentual: 15
            })
        });

        if (!response.ok) {
            throw new Error('Erro ao gerar sugestões');
        }

        const resultado = await response.json();
        if (!options.silent) {
            showNotification(resultado.message || `${resultado.total} sugestão(ões) gerada(s).`, resultado.total > 0 ? 'success' : 'info');
        }

        if (!options.silent) {
            carregarSugestoesPromocoes();
        }
        carregarDashboardPromocoes();

        return resultado;
    } catch (error) {
        console.error('Erro ao gerar sugestões:', error);
        if (!options.silent) {
            showNotification('Erro ao gerar sugestões', 'danger');
        }
        return null;
    }
}

window.gerarSugestoesPromocoes = gerarSugestoesPromocoes;

window.viewProduto = viewProduto;


// Escape HTML
function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatarEstoqueProduto(valor, unidade = '') {
    const numero = Number(valor || 0);
    const unidadeNormalizada = String(unidade || '').toUpperCase();

    if (unidadeNormalizada === 'KG') {
        return `${numero.toFixed(3)} kg`;
    }

    return `${numero.toFixed(0)} ${unidade || 'UN'}`;
}

function montarTabelaEstoqueResumo(lista, classeLinha) {
  if (!lista.length) return '';

  return `
    <table class="table table-sm table-hover mb-0">
      <thead>
        <tr>
          <th>Produto</th>
          <th>Código</th>
          <th class="text-end">Estoque</th>
          <th class="text-end">Mínimo</th>
        </tr>
      </thead>
      <tbody>
        ${lista.map((p) => `
          <tr class="${classeLinha}">
            <td class="fw-semibold">${escapeHtml(p.nome || '')}</td>
            <td>${escapeHtml(p.codigo || '-')}</td>
            <td class="text-end fw-bold">${formatarColunaEstoqueLista(p)}</td>
            <td class="text-end">${formatarEstoqueProduto(p.estoque_minimo, p.unidade)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function montarListaEstoqueBaixoProdutos(criticos, proximos) {
  const listaCriticos = Array.isArray(criticos) ? criticos : [];
  const listaProximos = Array.isArray(proximos) ? proximos : [];

  if (!listaCriticos.length && !listaProximos.length) {
    return '<div class="text-muted">Nenhum alerta de estoque no momento.</div>';
  }

  let html = '<div class="d-flex flex-column gap-2">';

  if (listaCriticos.length) {
    html += `
      <div class="d-flex justify-content-between align-items-center">
        <span class="text-danger fw-semibold">Estoque no mínimo ou abaixo (${listaCriticos.length})</span>
        <button type="button" class="btn btn-sm btn-outline-danger" onclick="carregarRelatorioEstoqueProdutos('estoque_baixo')">Ver todos</button>
      </div>
    `;
  }

  if (listaProximos.length) {
    html += `
      <div class="d-flex justify-content-between align-items-center">
        <span class="text-warning-emphasis fw-semibold">Próximo do mínimo (${listaProximos.length})</span>
        <button type="button" class="btn btn-sm btn-outline-warning" onclick="carregarRelatorioEstoqueProdutos('proximo_minimo')">Ver todos</button>
      </div>
    `;
  }

  html += '</div>';
  return html;
}

function separarProdutosPorEstoque(produtos) {
  const criticos = [];
  const proximos = [];

  (produtos || []).forEach((p) => {
    const tipo = classificarEstoqueProduto(p);
    if (tipo === 'estoque_baixo') criticos.push(p);
    else if (tipo === 'proximo_minimo') proximos.push(p);
  });

  return { criticos, proximos };
}

async function carregarEstoqueBaixoProdutos() {
  const container = document.getElementById('listaEstoqueBaixoProdutos');
  if (!container) return;

  container.innerHTML = '<div class="text-muted">Carregando...</div>';

  const cache = window.produtosCache || window.produtosList || [];
  if (cache.length) {
    const { criticos, proximos } = separarProdutosPorEstoque(cache);
    container.innerHTML = montarListaEstoqueBaixoProdutos(criticos, proximos);
    return;
  }

  try {
    const response = await fetch(`${API_URL}/produtos/estoque/baixo?modo_fiscal=${modoFiscalQueryParam()}`, {
      headers: {
        Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
      }
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Erro ao carregar estoque baixo.');
    }

    container.innerHTML = montarListaEstoqueBaixoProdutos(data, []);
  } catch (error) {
    console.error('Erro estoque baixo:', error);
    container.innerHTML = '<div class="text-danger">Erro ao carregar alertas de estoque.</div>';
  }
}

function inicializarCardEstoqueBaixo() {
  carregarEstoqueBaixoProdutos();
}

window.carregarEstoqueBaixoProdutos = carregarEstoqueBaixoProdutos;

function inicializarModalVencimentosProdutos() {
    if ($('#modalVencimentosProdutos').length) return;

    $('body').append(`
        <div class="modal fade" id="modalVencimentosProdutos" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-lg modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Produtos vencidos ou próximos do vencimento</h5>
                        <button type="button" class="btn-close" onclick="fecharModalVencimentosProdutos()" aria-label="Fechar"></button>
                    </div>
                    <div class="modal-body">
                        <table class="table table-striped table-hover">
                            <thead>
                                <tr>
                                    <th>Produto</th>
                                    <th>${tituloColunaEstoqueLista()}</th>
                                    <th>Lote</th>
                                    <th>Validade</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody id="listaVencimentosProdutos">
                                <tr>
                                    <td colspan="5">Carregando...</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    `);
}

async function carregarVencimentosProdutos() {
    try {
        const modoFiscal = typeof modoFiscalQueryParam === 'function' ? modoFiscalQueryParam() : '0';
        const response = await fetch(`${API_URL}/produtos/vencimentos/alertas?dias=30&modo_fiscal=${modoFiscal}`, {
            headers: {
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            }
        });
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Erro ao carregar vencimentos');
        }

        $('#qtdProdutosVencidos').text(data.vencidos || 0);
        $('#qtdProdutosProximos').text(data.proximos || 0);

        renderizarListaVencimentosProdutos(data.produtos || []);
    } catch (error) {
        console.error('Erro ao carregar vencimentos:', error);
        $('#qtdProdutosVencidos').text('0');
        $('#qtdProdutosProximos').text('0');
    }
}

function renderizarListaVencimentosProdutos(produtos) {
    const tbody = $('#listaVencimentosProdutos');

    if (!tbody.length) return;

    if (!produtos.length) {
        tbody.html(`
            <tr>
                <td colspan="5" class="text-center text-muted">
                    Nenhum produto vencido ou próximo do vencimento.
                </td>
            </tr>
        `);
        return;
    }

    tbody.html(produtos.map((produto) => {
        const vencido = produto.status_validade === 'vencido';
        const statusTexto = vencido
            ? 'Vencido'
            : `Vence em ${produto.dias_para_vencer} dia(s)`;

        const linhaClasse = vencido ? 'table-danger' : 'table-warning';
        const badgeClasse = vencido ? 'bg-danger' : 'bg-warning text-dark';

        const validadeFormatada = produto.data_validade
            ? new Date(produto.data_validade + 'T00:00:00').toLocaleDateString('pt-BR')
            : '-';

        return `
            <tr class="${linhaClasse}">
                <td class="fw-semibold">${escapeHtml(produto.nome || '-')}</td>
                <td>${formatarEstoqueExibicaoTela(produto)}</td>
                <td>${escapeHtml(produto.lote || '-')}</td>
                <td>${validadeFormatada}</td>
                <td>
                    <span class="badge ${badgeClasse}">
                        ${statusTexto}
                    </span>
                </td>
            </tr>
        `;
    }).join(''));
}

function abrirModalVencimentosProdutos() {
    carregarVencimentosProdutos();
    const el = document.getElementById('modalVencimentosProdutos');
    if (el) {
        bootstrap.Modal.getOrCreateInstance(el).show();
    }
}

function fecharModalVencimentosProdutos() {
    const el = document.getElementById('modalVencimentosProdutos');
    if (el) {
        bootstrap.Modal.getInstance(el)?.hide();
    }
}

window.carregarVencimentosProdutos = carregarVencimentosProdutos;
window.abrirModalVencimentosProdutos = abrirModalVencimentosProdutos;
window.fecharModalVencimentosProdutos = fecharModalVencimentosProdutos;
