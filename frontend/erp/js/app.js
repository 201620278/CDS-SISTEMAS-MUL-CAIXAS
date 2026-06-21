/**
 * Roteador do módulo CDS ERP (Retaguarda).
 */
window.CDS_MODULE = 'erp';
window.CDS_DEFAULT_PAGE = 'dashboard';

function loadPage(page) {
    currentPage = page;

    if (!paginaPermitidaPorImplantacao(page)) {
        showNotification('Este módulo não está habilitado para o tipo de implantação configurado.', 'warning');
        if (page !== 'dashboard') loadPage('dashboard');
        return;
    }

    if (!usuarioTemPermissao(page)) {
        showNotification('Você não tem permissão para acessar esta página.', 'warning');
        if (page !== 'dashboard') loadPage('dashboard');
        return;
    }

    if (typeof desativarPdvFullscreen === 'function') {
        desativarPdvFullscreen();
    }
    document.body.classList.remove('menu-open', 'pdv-mode');

    switch (page) {
        case 'dashboard':
            return carregarPaginaHtml('dashboard.html', function () {
                if (typeof initDashboard === 'function') initDashboard();
            });
        case 'produtos':
            return typeof loadProdutos === 'function'
                ? loadProdutos()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar produtos.</div>');
        case 'clientes':
            return typeof loadClientes === 'function'
                ? loadClientes()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar clientes.</div>');
        case 'compras':
            return typeof loadCompras === 'function'
                ? loadCompras()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar compras.</div>');
        case 'fornecedores':
            return typeof loadFornecedores === 'function'
                ? loadFornecedores()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar fornecedores.</div>');
        case 'vendas':
            return typeof loadVendas === 'function'
                ? loadVendas()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar histórico de vendas.</div>');
        case 'financeiro':
            return carregarPaginaHtml('financeiro.html', function () {
                if (typeof initFinanceiro === 'function') initFinanceiro();
            });
        case 'licenca':
            return typeof loadLicenca === 'function'
                ? loadLicenca()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar licença.</div>');
        case 'caixa':
            return typeof loadCaixa === 'function'
                ? loadCaixa()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar caixa.</div>');
        case 'configuracoes':
            return typeof loadConfiguracoes === 'function'
                ? loadConfiguracoes()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar configurações.</div>');
        case 'configuracoes-avancadas':
            return typeof loadConfiguracoesAvancadas === 'function'
                ? loadConfiguracoesAvancadas()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar configurações avançadas.</div>');
        case 'fiscal':
            return typeof loadFiscal === 'function'
                ? loadFiscal()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar o módulo fiscal.</div>');
        case 'categorias':
            return carregarPaginaHtml('categorias.html', function () {
                if (typeof loadCategoriasAndSubcategorias === 'function') {
                    loadCategoriasAndSubcategorias();
                } else if (typeof loadCategorias === 'function') {
                    loadCategorias();
                }
            });
        case 'auditoria':
            return carregarPaginaHtml('auditoria.html', function () {
                if (typeof carregarAuditoria === 'function') {
                    carregarAuditoria(1);
                } else if (typeof loadAuditoria === 'function') {
                    loadAuditoria();
                }
            });
        case 'caixas':
            return carregarPaginaHtml('caixas.html', function () {
                if (typeof loadCaixas === 'function') {
                    buscarCaixas();
                }
            });
        default:
            $('#page-content').html('<div class="alert alert-warning">Página não encontrada.</div>');
    }
}

$(document).ready(function () {
    inicializarShellModulo({ defaultPage: 'dashboard' });
});
