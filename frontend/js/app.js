// API base URL (usa a mesma origem da aplicação para evitar conflito de porta)
const API_URL = (() => {
    if (typeof window.API_URL === 'string' && window.API_URL.trim() !== '') {
        return window.API_URL;
    }
    const resolved = `${window.location.origin}/api`;
    window.API_URL = resolved;
    return resolved;
})();

let currentPage = 'pdv';
let chart = null;

// ============================================
// FUNÇÃO GLOBAL DE LIMPEZA DE MODAIS TRAVADOS
// ============================================
function limparModaisTravados() {
    // remove backdrop
    document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());

    // remove classe que trava scroll/clique
    document.body.classList.remove('modal-open');

    // remove estilos que travam
    document.body.style.overflow = '';
    document.body.style.paddingRight = '';

    // remove aria-hidden presos
    document.querySelectorAll('[aria-hidden="true"]').forEach(el => {
        el.removeAttribute('aria-hidden');
    });

    // remove loading e overlay que possam estar bloqueando
    document.querySelectorAll('.loading, .overlay, .toast-container, .spinner-overlay').forEach(el => {
        el.style.display = 'none';
        el.style.pointerEvents = 'none';
    });

    // Forçar reflow do body para garantir que cliques funcionem
    document.body.style.display = 'none';
    document.body.offsetHeight; // trigger reflow
    document.body.style.display = '';
}

// Executar sempre após fechar modal
$(document).on('hidden.bs.modal', function () {
    limparModaisTravados();
});

// Forçar limpeza automática (anti-travamento)
setInterval(() => {
    const backdrop = document.querySelector('.modal-backdrop');

    if (backdrop && !document.querySelector('.modal.show')) {
        limparModaisTravados();
    }
}, 2000);

// ============================================
// FUNÇÃO DE DIAGNÓSTICO - Elemento Bloqueador
// ============================================
function diagnosticarClique(x, y) {
    const elemento = document.elementFromPoint(x, y);
    console.log('🔍 Elemento no clique:', elemento);
    console.log('🔍 Tag:', elemento?.tagName);
    console.log('🔍 Classes:', elemento?.className);
    console.log('🔍 ID:', elemento?.id);
    console.log('🔍 z-index:', window.getComputedStyle(elemento).zIndex);
    console.log('🔍 pointer-events:', window.getComputedStyle(elemento).pointerEvents);
    console.log('🔍 display:', window.getComputedStyle(elemento).display);
    console.log('🔍 visibility:', window.getComputedStyle(elemento).visibility);
    return elemento;
}

// Ativar diagnóstico de clique com Ctrl+Click
$(document).on('click', function(e) {
    if (e.ctrlKey) {
        diagnosticarClique(e.clientX, e.clientY);
    }
});

// ============================================
// DETECTOR DE TRAVAMENTO PARA ELECTRON
// ============================================
let ultimoClique = Date.now();
let cliquesDetectados = 0;

$(document).on('click', function(e) {
    ultimoClique = Date.now();
    cliquesDetectados++;
});

// Verificar a cada 3 segundos se houve tentativas de clique que falharam
setInterval(() => {
    // Se estamos no Electron e houve tentativa de interação
    if (window.electronAPI && cliquesDetectados > 0) {
        const tempoDesdeUltimoClique = Date.now() - ultimoClique;

        // Se o último clique foi entre 100ms e 2s atrás, pode ter falhado
        if (tempoDesdeUltimoClique > 100 && tempoDesdeUltimoClique < 2000) {
            console.log('🚨 Possível travamento detectado no Electron');

            // Chamar Electron para forçar reflow
            if (window.electronAPI.forcarReflow) {
                window.electronAPI.forcarReflow();
                console.log('✅ Reflow solicitado ao Electron');
            }
        }

        // Resetar contador
        cliquesDetectados = 0;
    }
}, 3000);

// ============================================
// DIAGNÓSTICO AUTOMÁTICO DE ELEMENTOS BLOQUEADORES
// ============================================
function diagnosticarElementosBloqueadores() {
    const suspeitos = [
        '.modal-backdrop',
        '.modal-backdrop-senha',
        '.swal2-container',
        '.toast-container',
        '.spinner-overlay',
        '.loading',
        '.overlay',
        '.modal-open::before',
        'body.pdv-mode.menu-open::before'
    ];

    let encontrados = [];

    suspeitos.forEach(seletor => {
        const elementos = document.querySelectorAll(seletor);
        if (elementos.length > 0) {
            elementos.forEach((el, i) => {
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                encontrados.push({
                    seletor: seletor,
                    index: i,
                    tag: el.tagName,
                    id: el.id,
                    classes: el.className,
                    zIndex: style.zIndex,
                    display: style.display,
                    visibility: style.visibility,
                    pointerEvents: style.pointerEvents,
                    width: rect.width,
                    height: rect.height,
                    top: rect.top,
                    left: rect.left
                });
            });
        }
    });

    // Verificar elemento no centro da tela
    const centroX = window.innerWidth / 2;
    const centroY = window.innerHeight / 2;
    const elementoCentro = document.elementFromPoint(centroX, centroY);

    return {
        suspeitos: encontrados,
        elementoNoCentro: elementoCentro ? {
            tag: elementoCentro.tagName,
            id: elementoCentro.id,
            classes: elementoCentro.className,
            zIndex: window.getComputedStyle(elementoCentro).zIndex
        } : null,
        bodyClasses: document.body.className,
        timestamp: new Date().toISOString()
    };
}

// Logar diagnóstico a cada 10 segundos (apenas no Electron)
if (window.electronAPI) {
    setInterval(() => {
        const diag = diagnosticarElementosBloqueadores();
        if (diag.suspeitos.length > 0) {
            console.log('🔍 Elementos suspeitos detectados:', diag);
        }
    }, 10000);
}


// ============================================
// MODO FISCAL GLOBAL - F12
// Menu continua normal, mas dados não fiscais são filtrados
// ============================================
function modoFiscalAtivoSistema() {
    return localStorage.getItem('pdv_modo_fiscal_ativo') === '1';
}

function aplicarModoFiscalGlobal() {
    const ativo = modoFiscalAtivoSistema();
    document.body.classList.toggle('modo-fiscal-ativo', ativo);

    const faixa = document.getElementById('faixaSistemaFiscalPdv');
    if (faixa) {
        faixa.style.display = ativo ? 'block' : 'none';
    }

    const tituloPdv = document.querySelector('.pdv-header-left span');
    if (tituloPdv) {
        tituloPdv.textContent = ativo
            ? 'PDV - Frente de Caixa Fiscal NFC-e'
            : 'PDV - Frente de Caixa';
    }

    const btnFinalizar = document.getElementById('btnFinalizarVendaPdv');
    if (btnFinalizar) {
        btnFinalizar.textContent = ativo
            ? 'Emitir NFC-e'
            : 'Finalizar Venda';
    }
}

function alternarModoFiscalGlobal() {
    const novoValor = modoFiscalAtivoSistema() ? '0' : '1';
    localStorage.setItem('pdv_modo_fiscal_ativo', novoValor);
    aplicarModoFiscalGlobal();

    if (typeof showNotification === 'function') {
        showNotification(
            novoValor === '1'
                ? 'Modo fiscal ativado. As vendas não fiscais ficarão ocultas nas consultas.'
                : 'Modo completo ativado. Vendas fiscais e não fiscais liberadas.',
            novoValor === '1' ? 'success' : 'info'
        );
    }

    if (typeof currentPage !== 'undefined' && currentPage === 'vendas' && typeof loadVendas === 'function') {
        loadVendas();
    }
}

function handleUnauthorized() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login';
}

$(document).ajaxError(function(event, xhr) {
    if (xhr && (xhr.status === 401 || xhr.status === 403)) {
        handleUnauthorized();
    }
});

$(document).ready(function() {
    if (!localStorage.getItem('token')) return;

    aplicarModoFiscalGlobal();

    $(document).off('keydown.modoFiscalF12').on('keydown.modoFiscalF12', function(e) {
        if (e.key === 'F12') {
            e.preventDefault();
            e.stopImmediatePropagation();
            alternarModoFiscalGlobal();
            return false;
        }
    });

    carregarLogoSidebar();
    filtrarMenuPorPermissoes();

    $('.nav-link').on('click', function(e) {
        e.preventDefault();
        const page = $(this).data('page');
        loadPage(page);
        $('.nav-link').removeClass('active');
        $(this).addClass('active');
    });

    // Carregar o PDV na primeira abertura do sistema
    $('.nav-link').removeClass('active');
    $('.nav-link[data-page="pdv"]').addClass('active');
    loadPage(currentPage);
});

// Mapeamento de páginas para permissões
const PERMISSOES_PAGINAS = {
    'pdv': 'pdv',
    'caixa': 'caixa',
    'produtos': 'produtos',
    'clientes': 'clientes',
    'compras': 'compras',
    'fornecedores': 'fornecedores',
    'vendas': 'vendas',
    'financeiro': 'financeiro',
    'categorias': 'categorias',
    'fiscal': 'fiscal',
    'configuracoes': 'configuracoes',
    'usuarios': 'usuarios',
    'relatorios': 'relatorios'
};

function obterPermissoesUsuario() {
    try {
        const user = JSON.parse(localStorage.getItem('user') || '{}');
        return {
            role: user.role || 'operador',
            permissoes: user.permissoes || []
        };
    } catch (e) {
        return { role: 'operador', permissoes: [] };
    }
}

function usuarioTemPermissao(page) {
    const { role, permissoes } = obterPermissoesUsuario();

    // Admin tem acesso a tudo
    if (role === 'admin') return true;

    // Verifica se tem permissão específica para a página
    const permissaoNecessaria = PERMISSOES_PAGINAS[page];
    if (!permissaoNecessaria) return true; // Página sem restrição

    return permissoes.includes(permissaoNecessaria);
}

function filtrarMenuPorPermissoes() {
    $('.nav-link').each(function() {
        const page = $(this).data('page');
        if (!usuarioTemPermissao(page)) {
            $(this).parent().hide(); // Esconde o <li> pai
        }
    });
}

function renderSidebarBrandPadrao() {
    const brand = document.getElementById('sidebar-brand');
    if (!brand) return;

    brand.innerHTML = `
        <h5 class="text-white">CDS</h5>
        <small class="text-muted">Sistemas</small>
    `;
}

async function carregarLogoSidebar() {
    const brand = document.getElementById('sidebar-brand');
    if (!brand) return;

    try {
        const response = await fetch(`${API_URL}/configuracoes`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });

        if (!response.ok) {
            renderSidebarBrandPadrao();
            return;
        }

        const configuracoes = await response.json();
        const logoConfig = Array.isArray(configuracoes)
            ? configuracoes.find((config) => config.chave === 'logo')
            : null;
        const logoPath = logoConfig && logoConfig.valor ? String(logoConfig.valor).trim() : '';

        if (!logoPath) {
            renderSidebarBrandPadrao();
            return;
        }

        const logoUrl = logoPath.startsWith('/')
            ? `${API_URL.replace('/api', '')}${logoPath}`
            : logoPath;

        brand.innerHTML = `
            <img
                src="${logoUrl}"
                alt="Logo da empresa"
                class="img-fluid"
                style="max-height: 110px; object-fit: contain;"
            >
        `;
    } catch (error) {
        console.error('Erro ao carregar logo da sidebar:', error);
        renderSidebarBrandPadrao();
    }
}

function isScriptAlreadyLoaded(src) {
    return Array.from(document.scripts).some(script => {
        return script.src && script.src.endsWith(src);
    });
}

function carregarPaginaHtml(url, callback) {
    // Limpar modais travados antes de trocar o conteúdo
    limparModaisTravados();

    $.get(url, function(html) {
        const $page = $('#page-content');
        const nodes = $.parseHTML(html, document, true);

        $page.empty();

        if (!nodes) {
            if (typeof callback === 'function') callback();
            return;
        }

        const inlineScripts = [];
        const pendingScripts = [];

        nodes.forEach(node => {
            if (node.nodeType === 1 && node.tagName.toLowerCase() === 'script') {
                if (node.src) {
                    const srcPath = node.getAttribute('src');
                    if (!isScriptAlreadyLoaded(srcPath)) {
                        pendingScripts.push(new Promise((resolve) => {
                            const script = document.createElement('script');
                            script.src = srcPath;
                            script.onload = resolve;
                            script.onerror = resolve;
                            document.body.appendChild(script);
                        }));
                    }
                } else {
                    inlineScripts.push(node.text || node.textContent || node.innerHTML || '');
                }
            } else {
                $page.append(node);
            }
        });

        inlineScripts.forEach(code => {
            if (code.trim()) {
                $.globalEval(code);
            }
        });

        const executarCallback = () => {
            aplicarModoFiscalGlobal();
            if (typeof callback === 'function') callback();
            aplicarModoFiscalGlobal();
        };

        if (pendingScripts.length === 0) {
            executarCallback();
        } else {
            Promise.all(pendingScripts).then(executarCallback);
        }
    }).fail(function() {
        $('#page-content').html('<div class="alert alert-danger">Erro ao carregar a página solicitada.</div>');
    });
}

function loadPage(page) {
    currentPage = page;

    // Verificar permissão antes de carregar a página
    if (!usuarioTemPermissao(page)) {
        showNotification('Você não tem permissão para acessar esta página.', 'warning');
        if (page !== 'pdv') {
            loadPage('pdv'); // Redireciona para PDV
        }
        return;
    }

    // Controle de fullscreen para PDV
    if (typeof ativarPdvFullscreen === 'function' && typeof desativarPdvFullscreen === 'function') {
        if (page === 'pdv') {
            ativarPdvFullscreen();
        } else {
            desativarPdvFullscreen();
            // Garantir que o menu esteja fechado ao sair do PDV
            document.body.classList.remove('menu-open');
            document.body.classList.remove('pdv-mode');
            // Restaurar foco na página após sair do modo PDV
            setTimeout(() => {
                document.body.focus();
                // Forçar reflow do body para garantir que cliques funcionem
                document.body.style.display = 'none';
                document.body.offsetHeight; // trigger reflow
                document.body.style.display = '';
            }, 50);
        }
    }

    switch (page) {
            case 'pdv':
            return carregarPaginaHtml('pdv.html', function() {
                if (typeof loadPDV === 'function') {
                    loadPDV();
                } else {
                    $('#page-content').html('<div class="alert alert-danger">Erro ao carregar o PDV.</div>');
                }
            });
        case 'dashboard':
            return carregarPaginaHtml('dashboard.html', function() {
                if (typeof initDashboard === 'function') {
                    initDashboard();
                } else {
                    $('#page-content').html('<div class="alert alert-danger">Erro ao carregar dashboard.</div>');
                }
            });
        case 'produtos':
            return typeof loadProdutos === 'function' ? loadProdutos() : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar produtos.</div>');
        case 'clientes':
            return typeof loadClientes === 'function' ? loadClientes() : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar clientes.</div>');
        case 'compras':
            return typeof loadCompras === 'function' ? loadCompras() : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar compras.</div>');
        case 'fornecedores':
            return typeof loadFornecedores === 'function' ? loadFornecedores() : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar fornecedores.</div>');
        case 'vendas':
            return typeof loadVendas === 'function' ? loadVendas() : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar histórico de vendas.</div>');
        case 'financeiro':
            return carregarPaginaHtml('financeiro.html', function() {
                if (typeof initFinanceiro === 'function') {
                    initFinanceiro();
                } else {
                    $('#page-content').html('<div class="alert alert-danger">Erro ao carregar financeiro.</div>');
                }
            });
        case 'licenca':
            return typeof loadLicenca === 'function' ? loadLicenca() : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar licença.</div>');
        case 'caixa':
            return typeof loadCaixa === 'function' ? loadCaixa() : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar caixa.</div>');
        case 'configuracoes':
            return typeof loadConfiguracoes === 'function' ? loadConfiguracoes() : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar configurações.</div>');
        case 'fiscal':
            return typeof loadFiscal === 'function'
                ? loadFiscal()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar o módulo fiscal.</div>');
        case 'categorias':
            return carregarPaginaHtml('categorias.html', function() {
                if (typeof loadCategoriasAndSubcategorias === 'function') {
                    loadCategoriasAndSubcategorias();
                } else if (typeof loadCategorias === 'function') {
                    loadCategorias();
                }
            });
        default:
            $('#page-content').html('<div class="alert alert-warning">Página não encontrada.</div>');
    }
}

function formatCurrency(value) {
    if (value === undefined || value === null || Number.isNaN(Number(value))) value = 0;
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    }).format(Number(value));
}

function formatDate(date) {
    if (!date) return '';
    const d = new Date(date);
    return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString('pt-BR');
}

function formatDateTime(dateString) {
    if (!dateString) return '-';

    const data = new Date(dateString);

    return Number.isNaN(data.getTime())
        ? dateString
        : data.toLocaleString('pt-BR', {
            timeZone: 'America/Fortaleza'
        });
}

function formatarDataHoraBR(dataHora) {
  if (!dataHora) return '-';

  const [data, hora] = dataHora.split(' ');
  const [ano, mes, dia] = data.split('-');

  return `${dia}/${mes}/${ano} ${hora}`;
}

// Formata CNPJ: 65957340000150 -> 65.957.340/0001-50
function formatarCNPJ(cnpj) {
  if (!cnpj) return '';
  const numeros = String(cnpj).replace(/\D/g, '');
  if (numeros.length !== 14) return cnpj;
  return numeros.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
}

// Formata CPF: 12345678901 -> 123.456.789-01
function formatarCPF(cpf) {
  if (!cpf) return '';
  const numeros = String(cpf).replace(/\D/g, '');
  if (numeros.length !== 11) return cpf;
  return numeros.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

// Formata CPF ou CNPJ automaticamente
function formatarCpfCnpj(valor) {
  if (!valor) return '';
  const numeros = String(valor).replace(/\D/g, '');
  if (numeros.length === 11) return formatarCPF(numeros);
  if (numeros.length === 14) return formatarCNPJ(numeros);
  return valor;
}

// Formata CPF/CNPJ em tempo real (para inputs)
function formatCpfCnpjInput(input) {
    let value = input.value.replace(/\D/g, '');
    if (value.length <= 11) {
        // CPF: 000.000.000-00
        value = value.replace(/(\d{3})(\d)/, '$1.$2');
        value = value.replace(/(\d{3})(\d)/, '$1.$2');
        value = value.replace(/(\d{3})(\d)/, '$1-$2');
    } else {
        // CNPJ: 00.000.000/0000-00
        value = value.replace(/(\d{2})(\d)/, '$1.$2');
        value = value.replace(/(\d{3})(\d)/, '$1.$2');
        value = value.replace(/(\d{3})(\d)/, '$1/$2');
        value = value.replace(/(\d{4})(\d)/, '$1-$2');
    }
    input.value = value;
}

function showNotification(mensagem, tipo = 'success') {
    const container = document.getElementById('notification-container');

    if (!container) return;

    const id = 'notif-' + Date.now();

    const alert = document.createElement('div');
    alert.id = id;
    alert.className = `alert alert-${tipo} alert-dismissible fade show`;
    alert.style.pointerEvents = 'auto'; // Permitir interação com a notificação
    alert.innerHTML = `
        ${mensagem}
        <button type="button" class="btn-close" onclick="fecharNotificacao('${id}')"></button>
    `;

    container.appendChild(alert);

    setTimeout(() => {
        fecharNotificacao(id);
    }, 3000);
}

function fecharNotificacao(id) {
    const el = document.getElementById(id);
    if (!el) return;

    el.classList.remove('show');

    setTimeout(() => {
        el.remove();
    }, 300);
}

$.ajaxSetup({
    beforeSend: function(xhr, settings) {
        if (settings.url && !settings.url.includes('/api/')) return;
        const token = localStorage.getItem('token');
        if (token) {
            xhr.setRequestHeader('Authorization', 'Bearer ' + token);
        }
    }
});
