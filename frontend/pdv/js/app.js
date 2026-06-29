/**
 * Roteador do módulo CDS PDV (Frente de Caixa).
 */
window.CDS_MODULE = 'pdv';
window.CDS_DEFAULT_PAGE = 'pdv';

function loadPage(page) {
    currentPage = page;

    if (!paginaPermitidaPorImplantacao(page)) {
        showNotification('Este módulo não está habilitado para o tipo de implantação configurado.', 'warning');
        if (page !== 'pdv') loadPage('pdv');
        return;
    }

    if (!usuarioTemPermissao(page)) {
        showNotification('Você não tem permissão para acessar esta página.', 'warning');
        if (page !== 'pdv') loadPage('pdv');
        return;
    }

    if (typeof ativarPdvFullscreen === 'function' && typeof desativarPdvFullscreen === 'function') {
        if (page === 'pdv') {
            ativarPdvFullscreen();
        } else {
            desativarPdvFullscreen();
            document.body.classList.remove('menu-open', 'pdv-mode');
        }
    }

    switch (page) {
        case 'pdv':
            return carregarPaginaHtml('pdv.html', function () {
                if (typeof loadPDV === 'function') loadPDV();
            });
        case 'consulta':
            return carregarPaginaHtml('pdv.html', function () {
                if (typeof loadPDV === 'function') {
                    loadPDV();
                    setTimeout(() => {
                        if (typeof abrirConsultaProdutosPDV === 'function') {
                            abrirConsultaProdutosPDV();
                        }
                    }, 300);
                }
            });
        case 'clientes':
            return typeof loadClientes === 'function'
                ? loadClientes()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar clientes.</div>');
        case 'caixa':
            return typeof loadCaixa === 'function'
                ? loadCaixa()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar caixa.</div>');
        case 'reimpressao':
        case 'vendas':
            return typeof loadVendas === 'function'
                ? loadVendas()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar reimpressão.</div>');
        case 'tef':
            showNotification('TEF integrado ao fluxo de venda. Para reimprimir comprovantes, use Reimpressão de Cupom.', 'info');
            return loadPage('reimpressao');
        case 'configuracao-rede':
            if (typeof abrirModalConfiguracaoRede === 'function') {
                abrirModalConfiguracaoRede({ somenteSuperAdmin: true });
            }
            currentPage = 'pdv';
            $('.nav-link').removeClass('active');
            $('.nav-link[data-page="pdv"]').first().addClass('active');
            return;
        case 'nome-terminal-pdv':
            if (typeof abrirModalNomeTerminalPdv === 'function') {
                abrirModalNomeTerminalPdv({ somenteSuperAdmin: true });
            }
            currentPage = 'pdv';
            $('.nav-link').removeClass('active');
            $('.nav-link[data-page="pdv"]').first().addClass('active');
            return;
        default:
            $('#page-content').html('<div class="alert alert-warning">Página não encontrada.</div>');
    }
}

$(document).ready(function () {
    inicializarShellModulo({ defaultPage: 'pdv' });
});
