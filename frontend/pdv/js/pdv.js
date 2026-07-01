let carrinho = [];
let produtosDisponiveis = [];
let formaPagamentoSelecionada = null;
let clienteSelecionado = null;
let clientesResultados = [];
let vendaPrazoInfo = null;
let vendaEmProcessamento = false;
let pdvClockInterval = null;
let caixaAberto = false;
let pagamentoFiscalAtual = null;
let pagamentosMistos = [];
let formaPagamentoSelecionadaPDV = null;
let supervisorAuthToken = null;
let terminalId = null;
let terminalHostname = null;
/** Escolha explícita do operador: emitir NFC-e nesta venda (null = ainda não definido). */
let pdvEmitirFiscalNaVenda = null;

function sincronizarTerminalGlobalsPdv() {
    window.terminalId = terminalId;
    window.terminalHostname = terminalHostname;
    window.terminalNome = terminalNome;
}
const DESCONTO_MANUAL_LIMITE = 50;

function obterTerminalIdPdv() {
    if (Number.isInteger(terminalId) && terminalId > 0) {
        return terminalId;
    }
    if (Number.isInteger(window.terminalId) && window.terminalId > 0) {
        return window.terminalId;
    }
    return null;
}

function getTerminalRequestData(body = {}) {
    const id = obterTerminalIdPdv();
    if (id) {
        body.terminal_id = id;
    }
    return body;
}

function getTerminalRequestQuery(params = {}) {
    const id = obterTerminalIdPdv();
    if (id) {
        params.terminal_id = id;
    }
    return params;
}

function buildTerminalQueryString(params = {}) {
    const query = getTerminalRequestQuery(params);
    const search = new URLSearchParams(query).toString();
    return search ? `?${search}` : '';
}

function normalizarTexto(texto) {
    return String(texto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .normalize('NFC')
        .toLowerCase();
}

// Buscar promoção ativa de um produto
async function buscarPromocaoAtivaProduto(produtoId) {
    try {
        const response = await fetch(`${API_URL}/produtos/${produtoId}/promocao-ativa`, {
            method: 'GET',
            headers: {
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            }
        });

        if (!response.ok) return null;
        const promocao = await response.json();
        return promocao;
    } catch (e) {
        console.warn(`Erro ao buscar promoção para produto ${produtoId}:`, e);
        return null;
    }
}

function normalizarProdutoPdvLista(produtos) {
    return Array.isArray(produtos) ? produtos.map(p => ({
        ...p,
        saldo_fiscal: Number(p.saldo_fiscal ?? 0),
        saldo_nao_fiscal: Number(p.saldo_nao_fiscal ?? 0),
        estoque_atual: Number(p.estoque_atual || 0),
        preco_venda: Number(p.preco_venda || 0),
        permite_venda_unidade: Number(p.permite_venda_unidade ?? 0) === 1 ? 1 : 0,
        peso_medio_unidade: Number(p.peso_medio_unidade ?? 0),
        preco_unidade: Number(p.preco_unidade ?? 0)
    })) : [];
}

function produtoPermiteEscolhaVendaUnidade(produto) {
    return produtoUsaConversaoUnidadesPdv(produto)
        && Number(produto?.permite_venda_unidade ?? 0) === 1;
}

const TIPO_VENDA_PESO = 'PESO';
const TIPO_VENDA_UNIDADE = 'UNIDADE';

function normalizarTipoVendaItem(item) {
    const tipo = String(item?.tipo_venda || '').toUpperCase();
    if (tipo === TIPO_VENDA_UNIDADE) return TIPO_VENDA_UNIDADE;
    if (tipo === TIPO_VENDA_PESO) return TIPO_VENDA_PESO;
    if (item?.modo_venda === 'unidade') return TIPO_VENDA_UNIDADE;
    return TIPO_VENDA_PESO;
}

function tipoVendaEhUnidade(tipoVenda) {
    const tipo = String(tipoVenda || '').toUpperCase();
    return tipo === TIPO_VENDA_UNIDADE || tipoVenda === 'unidade';
}

function itemVendaPorUnidade(item) {
    return normalizarTipoVendaItem(item) === TIPO_VENDA_UNIDADE;
}

function obterQuantidadeEstoqueParaVenda(produto, quantidadeVenda, tipoVenda = TIPO_VENDA_PESO) {
    if (tipoVendaEhUnidade(tipoVenda)) {
        const pesoMedio = Number(produto?.peso_medio_unidade ?? 0);
        return Number(quantidadeVenda || 0) * pesoMedio;
    }
    return Number(quantidadeVenda || 0);
}

function formatarVendaUnidadeConsulta(produto) {
    if (!produtoUsaConversaoUnidadesPdv(produto)) {
        return 'NÃO';
    }
    return Number(produto?.permite_venda_unidade ?? 0) === 1 ? 'SIM' : 'NÃO';
}

function obterPrecoVendaConsultaPdv(produto) {
    const preco = Number(produto?.preco_venda || 0);
    const temPromocao = produto?.tem_promocao === 1 || produto?.tem_promocao === true;
    const precoPromocional = Number(produto?.preco_promocional || 0);
    return temPromocao && precoPromocional > 0 ? precoPromocional : preco;
}

function formatarPrecoUnidadeConsulta(produto) {
    const precoUnidade = Number(produto?.preco_unidade ?? 0);
    if (Number(produto?.permite_venda_unidade ?? 0) === 1 && precoUnidade > 0) {
        return formatCurrency(precoUnidade);
    }
    const precoVenda = obterPrecoVendaConsultaPdv(produto);
    return precoVenda > 0 ? formatCurrency(precoVenda) : formatCurrency(0);
}

function formatarPesoKgPdv(valor) {
    const n = Math.round(Number(valor || 0) * 1000) / 1000;
    return n.toFixed(3).replace('.', ',');
}

function montarPreviewCalculoVendaUnidade(produto, quantidadeUnidades) {
    const qtd = Math.max(0, Math.round(Number(quantidadeUnidades || 0)));
    const pesoMedio = Number(produto?.peso_medio_unidade ?? 0);
    const precoUnidade = Number(produto?.preco_unidade ?? 0);
    return {
        qtd,
        pesoMedio,
        pesoTotalKg: qtd * pesoMedio,
        precoUnidade,
        valorTotal: qtd * precoUnidade
    };
}

function renderTextoPreviewEstoqueKg(produto, quantidadeUnidades) {
    const calc = montarPreviewCalculoVendaUnidade(produto, quantidadeUnidades);
    if (calc.qtd <= 0 || calc.pesoMedio <= 0) {
        return '—';
    }
    return `${calc.qtd} × ${formatarPesoKgPdv(calc.pesoMedio)} = ${formatarPesoKgPdv(calc.pesoTotalKg)} kg`;
}

function renderTextoPreviewValorUnidade(produto, quantidadeUnidades) {
    const calc = montarPreviewCalculoVendaUnidade(produto, quantidadeUnidades);
    if (calc.qtd <= 0 || calc.precoUnidade <= 0) {
        return '—';
    }
    return `${calc.qtd} × ${formatCurrency(calc.precoUnidade)} = ${formatCurrency(calc.valorTotal)}`;
}

function atualizarPreviewVendaUnidadeModal(produto) {
    const input = document.getElementById('inputQuantidadeProduto');
    if (!input) return;

    const qtd = Math.max(0, Math.round(Number(parseQuantidadePdv(input.value) || 0)));
    const elKg = document.getElementById('previewVendaUnidadeKg');
    const elValor = document.getElementById('previewVendaUnidadeValor');

    if (elKg) {
        elKg.textContent = renderTextoPreviewEstoqueKg(produto, qtd);
    }
    if (elValor) {
        elValor.textContent = renderTextoPreviewValorUnidade(produto, qtd);
    }
}

function urlProdutosPdv() {
    const modoFiscal = typeof modoFiscalQueryParam === 'function' ? modoFiscalQueryParam() : '0';
    return `${API_URL}/produtos?modo_fiscal=${modoFiscal}`;
}

function loadPDV() {
    console.log('Carregando PDV...');

    // Auto-registrar terminal no backend
    autoRegistrarTerminal();

    $.ajax({
        url: urlProdutosPdv(),
        method: 'GET',
        cache: false,
        success: function(produtos) {
            produtosDisponiveis = normalizarProdutoPdvLista(produtos);

            inicializarPDV();
        },
        error: function(xhr) {
            console.error('Erro ao carregar produtos:', xhr);
            produtosDisponiveis = [];
            inicializarPDV();
            showNotification('Erro ao carregar produtos do PDV.', 'danger');
        }
    });
}

// Auto-registrar terminal no backend (somente app PDV dedicado)
const HEARTBEAT_TERMINAL_MS = 2 * 60 * 1000;
let intervaloHeartbeatTerminal = null;
let tentativasRegistroTerminal = 0;
let terminalNome = '';

function deveRegistrarTerminalPdv() {
    if (window.CDS_MODULE === 'pdv') return true;
    const path = String(window.location.pathname || '');
    return path === '/pdv' || path.startsWith('/pdv/');
}

function registrarTerminalOfflineSync() {
    if (!terminalHostname || !deveRegistrarTerminalPdv()) return;
    const url = `${API_URL}/terminais/auto/offline?hostname=${encodeURIComponent(terminalHostname)}&origem=pdv`;
    if (typeof navigator.sendBeacon === 'function') {
        navigator.sendBeacon(url);
        return;
    }
    fetch(url, { method: 'GET', keepalive: true }).catch(() => {});
}

if (!window.__cdsTerminalOfflineRegistrado) {
    window.__cdsTerminalOfflineRegistrado = true;
    window.addEventListener('pagehide', registrarTerminalOfflineSync);
    window.addEventListener('beforeunload', registrarTerminalOfflineSync);
}

function obterUsuarioLogadoPdv() {
    try {
        const user = JSON.parse(localStorage.getItem('user') || '{}');
        return {
            usuario_id: user.id || null,
            usuario_nome: String(user.nome || user.username || '').trim()
        };
    } catch (e) {
        return { usuario_id: null, usuario_nome: '' };
    }
}

async function autoRegistrarTerminal() {
    if (!deveRegistrarTerminalPdv()) {
        return;
    }

    try {
        if (window.electronAPI && typeof window.electronAPI.getTerminalInfo === 'function') {
            const info = window.electronAPI.getTerminalInfo();
            if (info && info.hostname) {
                terminalHostname = info.hostname;
                sessionStorage.setItem('cds_estacao_hostname', terminalHostname);
                sincronizarTerminalGlobalsPdv();
            }
        }

        if (!terminalHostname && typeof resolverHostnameEstacao === 'function') {
            terminalHostname = await resolverHostnameEstacao();
            sincronizarTerminalGlobalsPdv();
        }

        if (!terminalHostname) {
            const emElectron = typeof estaEmElectron === 'function' ? estaEmElectron() : Boolean(window.electronAPI);
            if (emElectron && tentativasRegistroTerminal < 16) {
                tentativasRegistroTerminal += 1;
                setTimeout(autoRegistrarTerminal, 500);
                return;
            }
            console.warn('PDV aberto, mas hostname da estação não foi detectado.');
            return;
        }

        tentativasRegistroTerminal = 0;
        console.log('Terminal PDV detectado:', terminalHostname);

        const headers = {};
        const token = localStorage.getItem('token');
        if (token) headers['Authorization'] = 'Bearer ' + token;

        const usuario = obterUsuarioLogadoPdv();

        $.ajax({
            url: `${API_URL}/terminais/auto`,
            method: 'GET',
            data: {
                hostname: terminalHostname,
                origem: 'pdv',
                usuario_id: usuario.usuario_id || undefined,
                usuario_nome: usuario.usuario_nome || undefined
            },
            headers: headers,
            success: function(terminal) {
                terminalId = terminal.id;
                terminalNome = String(terminal.nome || terminal.hostname || '').trim();
                sincronizarTerminalGlobalsPdv();
                console.log('Terminal PDV registrado:', terminal);
                if (typeof atualizarRotuloTerminalPdvSidebar === 'function') {
                    atualizarRotuloTerminalPdvSidebar();
                }
                if (typeof verificarStatusCaixa === 'function') {
                    verificarStatusCaixa();
                }
            },
            error: function(xhr) {
                console.warn('Erro ao registrar terminal PDV:', xhr.status, xhr.responseText);
                terminalId = null;
            }
        });

        if (!intervaloHeartbeatTerminal) {
            intervaloHeartbeatTerminal = setInterval(autoRegistrarTerminal, HEARTBEAT_TERMINAL_MS);
        }
    } catch (err) {
        console.error('Erro ao detectar terminal PDV:', err);
        terminalId = null;
    }
}

function terminalPdvRegistrado() {
    return Number.isInteger(terminalId) && terminalId > 0;
}

function aguardarTerminalPdv(callback, tentativas = 0) {
    if (terminalPdvRegistrado()) {
        callback(true);
        return;
    }
    if (tentativas >= 40) {
        callback(false);
        return;
    }
    setTimeout(() => aguardarTerminalPdv(callback, tentativas + 1), 500);
}

window.terminalPdvRegistrado = terminalPdvRegistrado;
window.aguardarTerminalPdv = aguardarTerminalPdv;
window.sincronizarTerminalGlobalsPdv = sincronizarTerminalGlobalsPdv;
sincronizarTerminalGlobalsPdv();

function nomePerfilUsuario(usuario) {
    const perfil = String(usuario?.perfil || usuario?.nivel || usuario?.permissao || '')
        .trim()
        .toUpperCase();

    if (perfil === 'SUPER_ADMIN') return 'SUPER ADMIN';
    if (perfil === 'ADMIN') return 'ADMIN';
    if (perfil === 'OPERADOR' || perfil === 'USUARIO') return 'OPERADOR';

    return perfil || 'USUÁRIO';
}

function usuarioEhSupervisor() {
    try {
        const usuario = JSON.parse(localStorage.getItem('user') || '{}');
        const perfil = String(usuario?.perfil || usuario?.nivel || '')
            .trim()
            .toUpperCase();

        return usuario?.role === 'admin' || ['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR'].includes(perfil);
    } catch (e) {
        return false;
    }
}

function mostrarModalAutorizacaoSupervisor(onAuthorized) {
    $('#modal-container').html(`
        <div class="modal fade" id="supervisorAuthModal" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-sm modal-dialog-centered">
                <div class="modal-content border-0 shadow">
                    <div class="modal-header bg-primary">
                        <h5 class="modal-title text-white mb-0">Autorização de Supervisor</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
                    </div>
                    <div class="modal-body">
                        <p>Desconto manual acima de R$ ${DESCONTO_MANUAL_LIMITE.toFixed(2)} exige autorização de supervisor.</p>
                        <div class="mb-3">
                            <label for="supervisorUsername" class="form-label">Usuário</label>
                            <input type="text" class="form-control" id="supervisorUsername" autocomplete="username">
                        </div>
                        <div class="mb-3">
                            <label for="supervisorPassword" class="form-label">Senha</label>
                            <input type="password" class="form-control" id="supervisorPassword" autocomplete="current-password">
                        </div>
                        <div id="supervisorAuthError" class="text-danger small mb-2" style="display:none;"></div>
                        <div class="d-grid gap-2">
                            <button type="button" class="btn btn-primary" id="supervisorAuthSubmit">Autorizar</button>
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `);

    const modalEl = document.getElementById('supervisorAuthModal');
    const modal = new bootstrap.Modal(modalEl, { backdrop: 'static' });
    modal.show();

    $('#supervisorAuthSubmit').off('click').on('click', async function() {
        const username = $('#supervisorUsername').val().trim();
        const password = $('#supervisorPassword').val().trim();
        const errorEl = $('#supervisorAuthError');

        errorEl.hide();

        if (!username || !password) {
            errorEl.text('Informe usuário e senha.').show();
            return;
        }

        try {
            const response = await fetch(`${API_URL}/auth/supervisor/authorize`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (!response.ok) {
                errorEl.text(data?.error || 'Erro ao autorizar supervisão.').show();
                return;
            }

            supervisorAuthToken = data.token;
            modal.hide();

            if (typeof onAuthorized === 'function') {
                onAuthorized();
            }
        } catch (error) {
            errorEl.text('Falha na autorização. Tente novamente.').show();
            console.error('Erro de autorização de supervisor:', error);
        }
    });
}

async function processarPagamentoTEF(tipo, valor, parcelas = 1, opcoes = {}) {
    try {
        if (window.__tefPagamentoEmAndamento) {
            showNotification('Já existe um pagamento TEF em andamento.', 'warning');
            return null;
        }

        window.__tefPagamentoEmAndamento = true;

        const tipoTef = TefFluxoPagamento.normalizarTipoTef(tipo);
        const ehPixTef = TefFluxoPagamento.ehPagamentoPixTef(tipoTef);

        showNotification(
            ehPixTef ? 'Gerando PIX TEF...' : 'Processando pagamento TEF...',
            'info'
        );

        const idempotencyKey = opcoes.idempotency_key
            || `pdv-${tipoTef}-${Number(valor).toFixed(2)}-${Date.now()}`;

        console.log('CHAMANDO TEF:', { tipo, tipoTef, valor, parcelas, idempotencyKey });

        const response = await fetch(`${API_URL}/tef/pagar`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${localStorage.getItem('token') || ''}`
            },
            body: JSON.stringify({
                tipo: tipoTef,
                valor: Number(valor),
                parcelas: Number(parcelas || 1),
                venda_id: opcoes.venda_id || null,
                idempotency_key: idempotencyKey
            })
        });

        const data = await response.json();

        console.log('RETORNO TEF:', data);

        if (response.status === 409 && data.codigo === 'TRANSACAO_DUPLICADA') {
            if (data.transacao_id && (data.aprovado || data.status === 'aprovado')) {
                showNotification('Pagamento TEF já autorizado.', 'info');
                return data;
            }
            throw new Error(data.mensagem || 'Transação TEF duplicada.');
        }

        if (!response.ok) {
            throw new Error(data.error || data.mensagem || 'Erro ao processar TEF.');
        }

        const aprovado = data.aprovado === true
            || data.sucesso === true
            || data.status === 'aprovado';

        if (!aprovado) {
            throw new Error(data.mensagem || 'Pagamento TEF negado.');
        }

        if (ehPixTef) {
            await mostrarModalPixTefPDV(data, valor);
        }

        showNotification(ehPixTef ? 'PIX TEF aprovado.' : 'Pagamento TEF aprovado.', 'success');

        try {
            await fetch(`${API_URL}/impressao/tef`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    comprovante_cliente: data.comprovante_cliente || data.comprovanteCliente,
                    comprovante_estabelecimento: data.comprovante_estabelecimento || data.comprovanteLoja
                })
            });

            console.log('Comprovante TEF enviado para impressão.');
        } catch (printError) {
            console.error('Erro impressão TEF:', printError);
        }

        return data;

    } catch (error) {
        console.error('Erro TEF:', error);
        showNotification(error.message || 'Erro ao processar TEF.', 'danger');
        return null;
    } finally {
        window.__tefPagamentoEmAndamento = false;
    }
}

function abrirModalPagamentoNaoFiscal(valor, onConfirm, onCancel) {
    const valorNum = Number(valor || 0);

    if (valorNum <= 0) {
        if (typeof onConfirm === 'function') {
            onConfirm({ forma_pagamento: 'dinheiro', valor: 0 });
        }
        return;
    }

    const modalHtml = `
        <div class="modal fade" id="pagamentoNaoFiscalModal" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Pagamento Não Fiscal (PF)</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <p class="text-muted mb-2">Itens não fiscais — conta pessoa física, sem TEF.</p>
                        <h4 class="text-center mb-3">Valor: ${formatCurrency(valorNum)}</h4>
                        <div class="payment-methods mb-3 d-flex flex-wrap gap-2">
                            <button type="button" class="nao-fiscal-method-btn btn btn-outline-primary active" data-pagamento="pix">PIX PF</button>
                            <button type="button" class="nao-fiscal-method-btn btn btn-outline-primary" data-pagamento="dinheiro">Dinheiro</button>
                            <button type="button" class="nao-fiscal-method-btn btn btn-outline-primary" data-pagamento="cartao">Cartão PF</button>
                        </div>
                        <div id="nao-fiscal-dinheiro-area" style="display:none;" class="mt-3 p-3 bg-light rounded">
                            <label for="nao-fiscal-valor-recebido" class="form-label fw-bold">Valor Recebido:</label>
                            <input type="number" step="0.01" class="form-control form-control-lg text-end" id="nao-fiscal-valor-recebido" placeholder="0,00">
                            <div class="mt-2">
                                <span class="fw-bold text-success">Troco: </span>
                                <span id="nao-fiscal-troco">${formatCurrency(0)}</span>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                        <button type="button" class="btn btn-primary" id="confirmar-pagamento-nao-fiscal">Confirmar</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    $('#modal-container').html(modalHtml);

    const modalEl = document.getElementById('pagamentoNaoFiscalModal');
    const modal = new bootstrap.Modal(modalEl);
    let formaSelecionada = 'pix';
    let confirmado = false;

    function atualizarTrocoNaoFiscal() {
        const recebido = parseFloat($('#nao-fiscal-valor-recebido').val()) || 0;
        const troco = Math.max(0, recebido - valorNum);
        $('#nao-fiscal-troco').text(formatCurrency(troco));
    }

    function selecionarFormaNaoFiscal(tipo) {
        formaSelecionada = tipo;
        $('.nao-fiscal-method-btn').removeClass('active btn-primary').addClass('btn-outline-primary');
        $(`.nao-fiscal-method-btn[data-pagamento="${tipo}"]`).removeClass('btn-outline-primary').addClass('active btn-primary');

        if (tipo === 'dinheiro') {
            $('#nao-fiscal-dinheiro-area').show();
            $('#nao-fiscal-valor-recebido').val(valorNum.toFixed(2));
            atualizarTrocoNaoFiscal();
        } else {
            $('#nao-fiscal-dinheiro-area').hide();
        }
    }

    modalEl.addEventListener('hidden.bs.modal', function handler() {
        modalEl.removeEventListener('hidden.bs.modal', handler);
        if (!confirmado && typeof onCancel === 'function') {
            onCancel();
        }
    }, { once: true });

    $('.nao-fiscal-method-btn').off('click').on('click', function() {
        selecionarFormaNaoFiscal($(this).data('pagamento'));
    });

    $('#nao-fiscal-valor-recebido').off('input').on('input', atualizarTrocoNaoFiscal);

    $('#confirmar-pagamento-nao-fiscal').off('click').on('click', function() {
        if (formaSelecionada === 'dinheiro') {
            const recebido = parseFloat($('#nao-fiscal-valor-recebido').val()) || 0;
            if (recebido + 0.009 < valorNum) {
                showNotification('Valor recebido insuficiente para o pagamento não fiscal.', 'warning');
                return;
            }
        }

        confirmado = true;
        modal.hide();
        if (typeof onConfirm === 'function') {
            onConfirm({
                forma_pagamento: formaSelecionada,
                valor: valorNum
            });
        }
    });

    modal.show();
    selecionarFormaNaoFiscal('pix');
}

function abrirModalConfirmacaoFiscalManual(valor, onConfirm, onCancel) {
    const valorNum = Number(valor || 0);

    if (valorNum <= 0) {
        if (typeof onConfirm === 'function') {
            onConfirm();
        }
        return;
    }

    const modalHtml = `
        <div class="modal fade" id="confirmacaoFiscalManualModal" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Confirmação de Recebimento Fiscal</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <p class="mb-3">Confirme que o valor fiscal foi recebido.</p>
                        <h4 class="text-center mb-0">Valor fiscal: ${formatCurrency(valorNum)}</h4>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                        <button type="button" class="btn btn-primary" id="confirmar-recebimento-fiscal-manual">Confirmar</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    $('#modal-container').html(modalHtml);

    const modalEl = document.getElementById('confirmacaoFiscalManualModal');
    const modal = new bootstrap.Modal(modalEl);
    let confirmado = false;

    modalEl.addEventListener('hidden.bs.modal', function handler() {
        modalEl.removeEventListener('hidden.bs.modal', handler);
        if (!confirmado && typeof onCancel === 'function') {
            onCancel();
        }
    }, { once: true });

    $('#confirmar-recebimento-fiscal-manual').off('click').on('click', function() {
        confirmado = true;
        modal.hide();
        if (typeof onConfirm === 'function') {
            onConfirm();
        }
    });

    modal.show();
}

async function obterModoConfirmacaoFiscal() {
    try {
        const response = await fetch(`${API_URL}/configuracoes-avancadas/confirmacao-fiscal`, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${localStorage.getItem('token') || ''}`
            }
        });

        if (!response.ok) {
            return 'TEF';
        }

        const data = await response.json();
        const modo = String(data.modo_confirmacao_fiscal || 'TEF').toUpperCase().trim();
        return modo === 'MANUAL' ? 'MANUAL' : 'TEF';
    } catch (error) {
        console.error('Erro ao obter modo de confirmação fiscal:', error);
        return 'TEF';
    }
}

async function obterTefHabilitadoConfig() {
    try {
        const response = await fetch(`${API_URL}/tef/fluxo-pdv`, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${localStorage.getItem('token')}`
            }
        });
        if (!response.ok) return false;
        const fluxo = await response.json();
        return fluxo.tefHabilitado === true;
    } catch (error) {
        console.error('Erro ao verificar configuração TEF:', error);
        return false;
    }
}

function pagamentoMistoExigeTef(pagamentos) {
    return (pagamentos || []).some((pagamento) =>
        formaPagamentoUsaTEF(normalizarFormaPagamentoTEF(pagamento.forma_pagamento))
    );
}

async function confirmarRecebimentoFiscalManual(valorFiscal) {
    await new Promise((resolve, reject) => {
        abrirModalConfirmacaoFiscalManual(
            valorFiscal,
            resolve,
            () => reject(new Error('Confirmação de recebimento fiscal cancelada.'))
        );
    });
}

function distribuirQuantidadeVendaLocal(quantidadeVendida, saldoFiscal, saldoNaoFiscal, vendaFiscal = false) {
    quantidadeVendida = Number(quantidadeVendida || 0);
    saldoFiscal = Number(saldoFiscal || 0);
    saldoNaoFiscal = Number(saldoNaoFiscal || 0);
    const priorizarFiscal = vendaFiscal === true;

    const estoqueTotal = saldoFiscal + saldoNaoFiscal;

    if (quantidadeVendida > estoqueTotal) {
        return {
            sucesso: false,
            estoqueTotal
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

function calcularDistribuicaoFiscalLocal(itens, vendaFiscal = false) {
    let totalFiscal = 0;
    let totalNaoFiscal = 0;
    const itensDistribuidos = [];

    for (const item of itens) {
        const produto = produtosDisponiveis.find(
            (p) => Number(p.id) === Number(item.produto_id || item.id)
        );
        const saldos = pdvResolverSaldosProduto(produto || {});
        const qtdVenda = Number(item.quantidade || 0);
        const qtdEstoque = item.quantidade_estoque != null && item.quantidade_estoque !== ''
            ? Number(item.quantidade_estoque)
            : qtdVenda;
        const resultado = distribuirQuantidadeVendaLocal(
            qtdEstoque,
            saldos.saldo_fiscal,
            saldos.saldo_nao_fiscal,
            vendaFiscal
        );

        if (!resultado.sucesso) {
            return {
                sucesso: false,
                error: `Saldo insuficiente para ${produto?.nome || 'produto'}. Disponível: ${resultado.estoqueTotal}`
            };
        }

        const precoUnitario = Number(item.preco_unitario || 0);
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

        totalFiscal += valorFiscal;
        totalNaoFiscal += valorNaoFiscal;

        itensDistribuidos.push({
            produto_id: item.produto_id || item.id,
            quantidade_fiscal: resultado.quantidadeFiscal,
            quantidade_nao_fiscal: resultado.quantidadeNaoFiscal,
            valor_fiscal: valorFiscal,
            valor_nao_fiscal: valorNaoFiscal
        });
    }

    return {
        sucesso: true,
        valor_fiscal: Number(totalFiscal.toFixed(2)),
        valor_nao_fiscal: Number(totalNaoFiscal.toFixed(2)),
        itens: itensDistribuidos
    };
}

async function precalcularDistribuicaoFiscalVenda(itens, vendaFiscal = false) {
    try {
        const response = await fetch(`${API_URL}/vendas/pre-calcular-distribuicao`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${localStorage.getItem('token') || ''}`
            },
            body: JSON.stringify(getTerminalRequestData({
                itens,
                emitir_fiscal: vendaFiscal
            }))
        });

        const data = await response.json().catch(() => ({}));

        if (response.ok && data.sucesso) {
            return data;
        }

        if (!response.ok && data.error) {
            return { sucesso: false, error: data.error };
        }
    } catch (error) {
        console.warn('Falha na API pre-calcular-distribuicao, usando cálculo local:', error);
    }

    return calcularDistribuicaoFiscalLocal(itens, vendaFiscal);
}

function aplicarDescontoProporcionalDistribuicao(distribuicao, subtotal, desconto) {
    const brutoFiscal = Number(distribuicao?.valor_fiscal || 0);
    const brutoNaoFiscal = Number(distribuicao?.valor_nao_fiscal || 0);
    const subtotalNum = Number(subtotal || 0);
    const descontoNum = Number(desconto || 0);
    const totalLiquido = Math.max(0, subtotalNum - descontoNum);

    if (subtotalNum <= 0 || descontoNum <= 0 || totalLiquido === subtotalNum) {
        return {
            valor_fiscal: brutoFiscal,
            valor_nao_fiscal: brutoNaoFiscal
        };
    }

    const fator = totalLiquido / subtotalNum;
    let valorFiscal = Math.round(brutoFiscal * fator * 100) / 100;
    let valorNaoFiscal = Math.round(brutoNaoFiscal * fator * 100) / 100;
    const diff = Math.round((totalLiquido - valorFiscal - valorNaoFiscal) * 100) / 100;

    if (diff !== 0) {
        if (valorFiscal >= valorNaoFiscal) {
            valorFiscal = Math.round((valorFiscal + diff) * 100) / 100;
        } else {
            valorNaoFiscal = Math.round((valorNaoFiscal + diff) * 100) / 100;
        }
    }

    return {
        valor_fiscal: valorFiscal,
        valor_nao_fiscal: valorNaoFiscal
    };
}

async function processarVendaFiscalManual(dadosVenda, valorFiscal) {
    try {
        await confirmarRecebimentoFiscalManual(valorFiscal);
        pagamentoFiscalAtual = { manual: true, valor: valorFiscal };
        return { sucesso: true };
    } catch (error) {
        console.error('Erro na confirmação fiscal manual:', error);
        pagamentoFiscalAtual = null;
        return { sucesso: false, erro: error.message };
    }
}

async function processarVendaFiscalNaoFiscal(dadosVenda, totalFiscal) {
    try {
        const formaFiscal = obterFormaPagamentoFiscal();
        const retorno = await processarPagamentoTEF(formaFiscal, totalFiscal, 1);

        if (!retorno || !(retorno.aprovado || retorno.sucesso || retorno.status === 'aprovado')) {
            throw new Error('Pagamento fiscal não aprovado.');
        }

        pagamentoFiscalAtual = retorno;

        dadosVenda.pagamentoFiscal = {
            valor: totalFiscal,
            nsu: retorno.nsu,
            autorizacao: retorno.autorizacao,
            transacao_id: retorno.transacao_id
        };

        return { sucesso: true, tefFiscal: retorno };
    } catch (error) {
        console.error('Erro ao processar pagamento fiscal:', error);
        pagamentoFiscalAtual = null;
        return { sucesso: false, erro: error.message };
    }
}

function normalizarFormaPagamentoTEF(forma) {
    return TefFluxoPagamento.normalizarFormaPagamentoTEF(forma);
}

function formaPagamentoUsaTEF(forma) {
    return TefFluxoPagamento.formaPagamentoUsaTEF(forma);
}

function formaPagamentoGravacaoFiscalPDV(forma) {
    return TefFluxoPagamento.formaPagamentoGravacaoFiscal(forma);
}

function deveEnviarPagamentosProcessadosPdv(totalFiscal, totalNaoFiscal) {
    return Number(totalFiscal || 0) > 0 && Number(totalNaoFiscal || 0) <= 0;
}

function normalizarPagamentosSemTef(pagamentos) {
    return (pagamentos || [])
        .filter((pagamento) => Number(pagamento.valor) > 0)
        .map((pagamento) => ({
            ...pagamento,
            forma_pagamento: normalizarFormaPagamentoTEF(pagamento.forma_pagamento),
            valor: Number(pagamento.valor)
        }));
}

async function concluirPagamentoNaoFiscalVenda(vendaId, pagamento, emitirFiscal = false) {
    if (!obterTerminalIdPdv()) {
        throw new Error('Terminal não registrado. Aguarde o registro do PDV ou reinicie a aplicação.');
    }

    const response = await fetch(`${API_URL}/vendas/${vendaId}/pagamento-nao-fiscal`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(getTerminalRequestData({
            pagamentos: [pagamento],
            emitir_fiscal: emitirFiscal
        }))
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.error || 'Erro ao registrar pagamento não fiscal.');
    }

    return data;
}

async function obterSaldoPagamentoNaoFiscalVenda(vendaId) {
    const response = await fetch(
        `${API_URL}/vendas/${vendaId}/pagamento-nao-fiscal${buildTerminalQueryString()}`,
        {
        headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
    }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.error || 'Erro ao consultar pagamento não fiscal da venda.');
    }

    return data;
}

function fiscalAutorizadaParaImpressao(fiscal) {
    if (!fiscal || typeof fiscal !== 'object') {
        return false;
    }

    if (fiscal.status === 'sem_itens_fiscais') {
        return false;
    }

    if (fiscal.success === false) {
        return false;
    }

    return fiscal.status === 'autorizada' || fiscal.reused === true;
}

function processarFiscalPosPagamentoPosVenda(vendaId, resultado) {
    pagamentoFiscalAtual = null;
    const fiscal = resultado?.fiscal;

    if (fiscal?.status === 'sem_itens_fiscais') {
        showNotification(
            fiscal.message || 'Venda sem itens fiscais. NFC-e não necessária.',
            'info'
        );
        return;
    }

    if (fiscal?.success === false) {
        showNotification(fiscal.message || 'Erro ao emitir NFC-e.', 'danger');
        mostrarModalErroNFCe(vendaId, fiscal.message || 'NFC-e não autorizada.');
        return;
    }

    if (fiscalAutorizadaParaImpressao(fiscal)) {
        showNotification('NFC-e autorizada pela SEFAZ!', 'success');
        imprimirDANFEFiscal(vendaId);
        return;
    }

    showNotification('Venda finalizada. Emitindo NFC-e...', 'info');
    mostrarModalProcessandoNFCe(vendaId);
    setTimeout(() => emitirNFCeVenda(vendaId), 300);
}

function iniciarFluxoPosVendaComNaoFiscal(vendaId, opcoes = {}) {
    const processarFiscalPosPagamento =
        opcoes.processarFiscalPosPagamento || processarFiscalPosPagamentoPosVenda;

    showNotification('Pagamento fiscal confirmado. Cobre o valor não fiscal.', 'info');

    obterSaldoPagamentoNaoFiscalVenda(vendaId)
        .then(function(info) {
            const valorPendente = Number(
                info.saldo_pendente ??
                info.valor_nao_fiscal ??
                0
            );
            const emitirFiscal = opcoes.emitirFiscal === true
                || (opcoes.emitirFiscal !== false && pdvEmitirFiscalNaVenda === true);

            abrirModalPagamentoNaoFiscal(
                valorPendente,
                async function(pagamento) {
                    try {
                        const resultado = await concluirPagamentoNaoFiscalVenda(
                            vendaId,
                            pagamento,
                            emitirFiscal
                        );

                        processarFiscalPosPagamento(vendaId, resultado);

                        finalizarPosVenda();
                        vendaEmProcessamento = false;
                        showNotification('Venda finalizada com sucesso.', 'success');
                    } catch (error) {
                        vendaEmProcessamento = false;
                        showNotification(error.message || 'Erro ao registrar pagamento não fiscal.', 'danger');
                    }
                },
                function() {
                    vendaEmProcessamento = false;
                    finalizarPosVenda();
                    showNotification(
                        `Venda #${vendaId} aguardando pagamento não fiscal.`,
                        'warning'
                    );
                }
            );
        })
        .catch(function(error) {
            vendaEmProcessamento = false;
            showNotification(error.message || 'Erro ao consultar pagamento não fiscal.', 'danger');
        });
}


async function mostrarModalPixTefPDV(data, valor) {
    const copiaCola = data.pix_copia_cola
        || data.payloadRetorno?.pix_copia_cola
        || data.payload_retorno?.pix_copia_cola
        || '';

    return new Promise((resolve) => {
        const qrPlaceholder = `
            <div class="border rounded p-3 mb-2" style="min-height:180px;display:flex;align-items:center;justify-content:center;background:#f8fafc;">
                <div class="text-center">
                    <div style="font-size:3rem;line-height:1;">&#9641;</div>
                    <small class="text-muted d-block mt-2">QR Code PIX TEF (tela do PC)</small>
                    <small class="text-muted">Na homologação: QR gerado pelo CliSiTef/PayGo</small>
                </div>
            </div>`;

        $('#modal-container').html(`
            <div class="modal fade" id="modalPixTefPDV" tabindex="-1" data-bs-backdrop="static">
                <div class="modal-dialog modal-dialog-centered" style="max-width:420px;">
                    <div class="modal-content border-0 shadow" style="border-radius:12px;overflow:hidden;">
                        <div class="modal-header text-white py-2 px-3" style="background:#0f766e;">
                            <div>
                                <h6 class="modal-title mb-0 fw-bold">PIX TEF</h6>
                                <small class="opacity-75" style="font-size:0.75rem;">Pagamento aprovado via middleware</small>
                            </div>
                        </div>
                        <div class="modal-body p-3 text-center">
                            <div class="mb-2" style="color:#0f766e;font-weight:700;font-size:1.4rem;">
                                R$ ${Number(valor).toFixed(2).replace('.', ',')}
                            </div>
                            ${qrPlaceholder}
                            <label class="form-label small text-start w-100 mb-1">Pix Copia e Cola</label>
                            <textarea id="pixTefCopiaColaPDV" class="form-control form-control-sm" rows="3" readonly style="font-size:0.7rem;">${copiaCola || 'Aguardando retorno do middleware na homologação.'}</textarea>
                            <button type="button" class="btn btn-sm btn-outline-secondary mt-2" id="btnCopiarPixTefPDV">Copiar código PIX</button>
                        </div>
                        <div class="modal-footer py-2">
                            <button type="button" class="btn btn-success w-100" id="btnFecharPixTefPDV">Continuar venda</button>
                        </div>
                    </div>
                </div>
            </div>
        `);

        const modalEl = document.getElementById('modalPixTefPDV');
        const modal = new bootstrap.Modal(modalEl);

        $('#btnCopiarPixTefPDV').on('click', function() {
            const texto = $('#pixTefCopiaColaPDV').val();
            if (navigator.clipboard && texto) {
                navigator.clipboard.writeText(texto);
                showNotification('Código PIX copiado.', 'success');
            }
        });

        $('#btnFecharPixTefPDV').on('click', function() {
            modal.hide();
            resolve();
        });

        modalEl.addEventListener('hidden.bs.modal', () => resolve(), { once: true });
        modal.show();
    });
}

function obterFormaPagamentoFiscal() {
    const forma = formaPagamentoSelecionadaPDV || $('#formaPagamentoPdv').val() || 'cartao';
    return normalizarFormaPagamentoTEF(forma);
}

function montarObjetoTEF(retornoTef) {
    return {
        transacao_id: retornoTef.transacao_id,
        provedor: retornoTef.provedor,
        adquirente: retornoTef.adquirente,
        bandeira: retornoTef.bandeira,
        nsu: retornoTef.nsu,
        autorizacao: retornoTef.autorizacao,
        codigo_transacao: retornoTef.codigo_transacao,
        comprovante_cliente: retornoTef.comprovante_cliente,
        comprovante_estabelecimento: retornoTef.comprovante_estabelecimento,
        cnpj_credenciadora: retornoTef.cnpj_credenciadora || '01425787000104'
    };
}

async function processarPagamentosMistosTEF(pagamentos) {
    const pagamentosProcessados = [];
    const tefHabilitado = await obterTefHabilitadoConfig();

    for (const pagamento of pagamentos) {
        const formaNormalizada = normalizarFormaPagamentoTEF(pagamento.forma_pagamento);
        const valorPagamento = Number(pagamento.valor || 0);

        if (valorPagamento <= 0) {
            continue;
        }

        if (!formaPagamentoUsaTEF(formaNormalizada) || !tefHabilitado) {
            pagamentosProcessados.push(pagamento);
            continue;
        }

        const parcelasTef = formaNormalizada.includes('credito') ? 1 : 1;

        const retornoTef = await processarPagamentoTEF(
            TefFluxoPagamento.normalizarTipoTef(formaNormalizada),
            valorPagamento,
            parcelasTef
        );

        if (!retornoTef || !(retornoTef.aprovado || retornoTef.sucesso || retornoTef.status === 'aprovado')) {
            throw new Error(`Pagamento TEF não aprovado para ${pagamento.forma_pagamento}.`);
        }

        const tef = montarObjetoTEF(retornoTef);

        pagamentosProcessados.push({
            ...pagamento,
            forma_pagamento: formaPagamentoGravacaoFiscalPDV(formaNormalizada),
            valor: valorPagamento,
            tef_transacao_id: retornoTef.transacao_id,
            tef,
            nsu: retornoTef.nsu,
            autorizacao: retornoTef.autorizacao,
            bandeira: retornoTef.bandeira,
            adquirente: retornoTef.adquirente
        });
    }

    return pagamentosProcessados;
}

function inicializarPDV() {
    const usuarioLogado = JSON.parse(localStorage.getItem('user') || '{}');
    const nomeOperador = usuarioLogado.nome || usuarioLogado.username || 'Usuário';
    const perfilOperador = nomePerfilUsuario(usuarioLogado);

    $('#operadorPdv').text(`Operador: ${nomeOperador} - ${perfilOperador}`);

    if (typeof aplicarModoFiscalPdv === 'function') {
        aplicarModoFiscalPdv();
    }

    verificarStatusCaixa();
    atualizarCarrinho();
    iniciarRelogioPDV();
    bindEventosPDV();
    focarCampoCodigo();

    // Verificar status do caixa a cada 30 segundos
    setInterval(verificarStatusCaixa, 30000);
}

// Verificar status do caixa
function verificarStatusCaixa() {
    const consultar = () => {
        $.ajax({
            url: `${API_URL}/caixa/aberto`,
            method: 'GET',
            cache: false,
            data: getTerminalRequestQuery(),
            success: function(caixa) {
                caixaAberto = !!caixa;
                atualizarStatusCaixaUI();
            },
            error: function(xhr) {
                if (xhr.status === 400 && !terminalPdvRegistrado()) {
                    return;
                }
                caixaAberto = false;
                atualizarStatusCaixaUI();
            }
        });
    };

    if (typeof aguardarTerminalPdv === 'function' && typeof terminalPdvRegistrado === 'function') {
        aguardarTerminalPdv((registrado) => {
            if (registrado) consultar();
        });
        return;
    }

    consultar();
}

// Atualizar UI do status do caixa
function atualizarStatusCaixaUI() {
    const statusEl = $('#statusCaixaPdv');
    const btnFinalizar = $('#btnFinalizarVendaPdv');

    if (!statusEl.length) {
        return;
    }
    const statusAnterior = statusEl.hasClass('caixa-aberto');

    if (caixaAberto) {
        statusEl.text('🟢 Caixa Aberto');
        statusEl.removeClass('caixa-fechado').addClass('caixa-aberto');
        btnFinalizar.prop('disabled', carrinho.length === 0);
        // Mostrar notificação apenas quando mudar de fechado para aberto
        if (!statusAnterior && statusEl.data('inicializado')) {
            showNotification('Caixa aberto! Pronto para vender.', 'success');
        }
    } else {
        statusEl.text('🔴 Caixa Fechado');
        statusEl.removeClass('caixa-aberto').addClass('caixa-fechado');
        btnFinalizar.prop('disabled', true);
        // Mostrar notificação apenas quando mudar de aberto para fechado
        if (statusAnterior) {
            showNotification('Caixa fechado. Abra o caixa antes de vender.', 'warning');
        }
    }
    statusEl.data('inicializado', true);
}


// ============================================
// MODO FISCAL PDV - USADO PELO F12
// ============================================
function pdvModoFiscalAtivo() {
    if (typeof modoFiscalAtivoSistema === 'function') {
        return modoFiscalAtivoSistema();
    }
    return localStorage.getItem('pdv_modo_fiscal_ativo') === '1';
}

function pdvResolverSaldosProduto(produto) {
    let item = produto || {};
    if (typeof enriquecerProdutoComCacheEstoque === 'function') {
        item = enriquecerProdutoComCacheEstoque(item);
    }

    const saldoFiscal = Number(item.saldo_fiscal ?? 0);
    let saldoNaoFiscal = Number(item.saldo_nao_fiscal ?? 0);

    if (item.saldo_nao_fiscal === undefined || item.saldo_nao_fiscal === null) {
        const cached = (produtosDisponiveis || []).find(
            (p) => String(p.id) === String(item.id ?? item.produto_id)
        );
        if (cached) {
            saldoNaoFiscal = Number(cached.saldo_nao_fiscal ?? 0);
        }
    }

    return {
        saldo_fiscal: saldoFiscal,
        saldo_nao_fiscal: saldoNaoFiscal,
        estoque_atual: saldoFiscal + saldoNaoFiscal
    };
}

function validarEstoqueVenda(produto, quantidade, modoFiscal) {
    const saldos = pdvResolverSaldosProduto(produto);
    const saldoFiscal = saldos.saldo_fiscal;
    const saldoNaoFiscal = saldos.saldo_nao_fiscal;
    const saldoTotal = saldos.estoque_atual;

    if (modoFiscal) {
        if (saldoFiscal <= 0) {
            return {
                sucesso: false,
                mensagem:
`Saldo insuficiente.

Disponível: 0${saldoNaoFiscal > 0 ? '*' : ''}

${saldoNaoFiscal > 0 ? '* Consulte o estoque disponível.' : ''}`
            };
        }

        if (quantidade > saldoTotal) {
            return {
                sucesso: false,
                mensagem:
`Saldo insuficiente.

Disponível: ${saldoFiscal}${saldoNaoFiscal > 0 ? '*' : ''}

${saldoNaoFiscal > 0 ? '* Consulte o estoque disponível.' : ''}`
            };
        }

        return { sucesso: true };
    }

    if (quantidade > saldoTotal) {
        return {
            sucesso: false,
            mensagem:
`Saldo insuficiente.

Disponível: ${saldoTotal}`
        };
    }

    return { sucesso: true };
}

function pdvValidarEstoqueVenda(produto, quantidade) {
    return validarEstoqueVenda(produto, quantidade, pdvModoFiscalAtivo());
}

function pdvNotificarEstoqueInsuficiente(produto, quantidade) {
    const resultado = pdvValidarEstoqueVenda(produto, quantidade);
    if (!resultado.sucesso) {
        const mensagem = produto?.nome
            ? resultado.mensagem.replace('Saldo insuficiente.', `Saldo insuficiente para ${produto.nome}.`)
            : resultado.mensagem;
        showNotification(mensagem, 'danger');
        return false;
    }
    return true;
}

function pdvEstoqueDisponivel(produto) {
    if (typeof obterEstoqueDisponivelProduto === 'function') {
        return obterEstoqueDisponivelProduto(produto);
    }
    return Number(produto?.estoque_atual || 0);
}

function pdvRotuloEstoque(produto) {
    if (pdvModoFiscalAtivo()) {
        return `Estoque fiscal: ${pdvEstoqueDisponivel(produto)}`;
    }
    const fiscal = Number(produto?.saldo_fiscal ?? 0);
    const naoFiscal = Number(produto?.saldo_nao_fiscal ?? 0);
    const total = Number(produto?.estoque_atual ?? (fiscal + naoFiscal));
    return `F: ${fiscal} | NF: ${naoFiscal} | Total: ${total}`;
}

function aplicarModoFiscalPdv() {
    if (typeof aplicarModoFiscalGlobal === 'function') {
        aplicarModoFiscalGlobal();
        return;
    }

    const ativo = pdvModoFiscalAtivo();
    document.body.classList.toggle('modo-fiscal-ativo', ativo);

    const faixa = document.getElementById('faixaSistemaFiscalPdv');
    if (faixa) faixa.style.display = ativo ? 'block' : 'none';

    const btnFinalizar = document.getElementById('btnFinalizarVendaPdv');
    if (btnFinalizar) {
        const titulo = btnFinalizar.querySelector('.btn-finalizar-titulo');
        if (!titulo) {
            btnFinalizar.textContent = ativo ? 'Emitir NFC-e' : 'Finalizar Venda';
        }
    }

    if (typeof atualizarBarraModoFiscalSidebar === 'function') {
        atualizarBarraModoFiscalSidebar();
    }
}

function alternarModoFiscalPdv() {
    if (typeof implantacaoPermiteFiscal === 'function' && !implantacaoPermiteFiscal()) {
        if (typeof showNotification === 'function') {
            showNotification('Emissão fiscal desabilitada para o tipo de implantação configurado.', 'warning');
        }
        return;
    }

    if (typeof alternarModoFiscalGlobal === 'function') {
        alternarModoFiscalGlobal();
        return;
    }

    const novoValor = pdvModoFiscalAtivo() ? '0' : '1';
    localStorage.setItem('pdv_modo_fiscal_ativo', novoValor);
    aplicarModoFiscalPdv();
}

function focarCampoCodigo() {
    setTimeout(() => {
        const input = $('#buscaProdutoPdv');
        if (input.length) input.trigger('focus');
    }, 120);
}



function obterNomeOperador() {
    try {
        const user = JSON.parse(localStorage.getItem('user') || '{}');
        return user.nome || user.username || 'Usuário';
    } catch (e) {
        return 'Usuário';
    }
}

function iniciarRelogioPDV() {
    atualizarDataHoraPdv();

    if (pdvClockInterval) {
        clearInterval(pdvClockInterval);
    }

    pdvClockInterval = setInterval(atualizarDataHoraPdv, 1000);
}

function atualizarDataHora() {
    atualizarDataHoraPdv();
}

function bindEventosPDV() {
    $(document).off('keydown.pdvAtalhos').on('keydown.pdvAtalhos', function(e) {
        if (e.key === 'F1') {
            e.preventDefault();
            e.stopPropagation();
            abrirConsultaProdutosPDV();
        }
        if (e.key === 'F4') {
            e.preventDefault();
            e.stopPropagation();
            if (carrinho.length > 0) {
                const ultimoIndex = carrinho.length - 1;
                const input = $(`.quantidade-item[data-index="${ultimoIndex}"]`);
                if (input.length) {
                    input.trigger('focus');
                    input[0].select();
                }
            } else {
                showNotification('Nenhum item para alterar quantidade.', 'warning');
            }
        }
        if (e.key === 'F7') {
            e.preventDefault();
            e.stopPropagation();
            abrirFechamentoCaixa();
        }
        if (e.key === 'F8') {
            e.preventDefault();
            e.stopPropagation();
            $('#descontoPdv').trigger('focus');
        }
        if (e.key === 'F10') {
            e.preventDefault();
            e.stopPropagation();
            abrirModalDecisaoFiscal();
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            cancelarVendaAtual();
        }
    });

    $('#buscaProdutoPdv').off('keypress').on('keypress', function(e) {
        if (e.which === 13) {
            const codigo = $(this).val().trim();
            if (codigo) {
                adicionarProdutoPorCodigo(codigo);
                $(this).val('');
            }
        }
    });

    $('#btnBuscarProdutoPdv').off('click').on('click', function() {
        const codigo = $('#buscaProdutoPdv').val().trim();
        if (codigo) {
            adicionarProdutoPorCodigo(codigo);
            $('#buscaProdutoPdv').val('');
        } else {
            showNotification('Digite ou bip o código do produto.', 'warning');
        }
        focarCampoCodigo();
    });

    $('#btnLimparVendaPdv').off('click').on('click', limparCarrinho);
    $('#btnCancelarVendaPdv').off('click').on('click', cancelarVendaAtual);
    $('#btnFinalizarVendaPdv').off('click').on('click', abrirTelaPagamento);
    $('#btnFechamentoCaixaPdv').off('click').on('click', abrirFechamentoCaixa);

    $('#btnCalculadoraPdv').off('click').on('click', function() {
        $('#pdvCalculadoraFlutuante').toggleClass('d-none');
    });
    $('#btnFecharCalculadoraPdv').off('click').on('click', function() {
        $('#pdvCalculadoraFlutuante').addClass('d-none');
    });

    $('#formaPagamentoPdv').off('change').on('change', function () {
        if ($(this).val() === 'misto') {
            abrirPagamentoMisto();
        } else {
            pagamentosMistos = [];
        }
        aoAlterarFormaPagamento();
    });
    $('#formaPagamentoPdv').val('');

    // Busca de cliente para venda a prazo (sidebar)
    $('#clienteBuscaPrazo').off('input').on('input', function() {
        const termo = normalizarTexto($(this).val()).trim();
        if (termo.length < 2) {
            $('#clientePrazoSugestoes').empty().hide();
            $('#clientePrazoId').val('');
            return;
        }

        $.ajax({
            url: `${API_URL}/clientes`,
            method: 'GET',
            success: function(clientes) {
                const filtrados = (clientes || []).filter(c =>
                    normalizarTexto(c.nome).includes(termo) ||
                    String(c.cpf_cnpj || '').replace(/\D/g, '').includes(termo.replace(/\D/g, ''))
                );

                if (filtrados.length === 0) {
                    $('#clientePrazoSugestoes').html('<div class="list-group-item" style="font-size:0.8rem;">Nenhum cliente encontrado</div>').show();
                    return;
                }

                $('#clientePrazoSugestoes').html(
                    filtrados.map(c => `
                        <button type="button" class="list-group-item list-group-item-action" data-id="${c.id}" data-nome="${escapeHtml(c.nome || '')}" style="font-size:0.8rem; padding:4px 8px;">
                            ${escapeHtml(c.nome || '')}${c.cpf_cnpj ? ' - ' + formatarCpfCnpj(c.cpf_cnpj) : ''}
                        </button>
                    `).join('')
                ).show();
            },
            error: function() {
                $('#clientePrazoSugestoes').empty().hide();
            }
        });
    });

    $(document).off('click.prazoSugestao').on('click.prazoSugestao', '#clientePrazoSugestoes button', function() {
        const id = $(this).data('id');
        const nome = $(this).data('nome');
        $('#clientePrazoId').val(id);
        $('#clienteBuscaPrazo').val(nome);
        $('#clientePrazoSugestoes').empty().hide();
        $('#clientePrazoSelecionado').show();
        $('#clientePrazoNome').text(nome);
        clienteSelecionado = { id: Number(id), nome: String(nome) };
    });

    $('#btnRemoverClientePrazo').off('click').on('click', function() {
        $('#clientePrazoId').val('');
        $('#clienteBuscaPrazo').val('');
        $('#clientePrazoSelecionado').hide();
        $('#clientePrazoNome').text('');
        clienteSelecionado = null;
        setTimeout(() => $('#clienteBuscaPrazo').trigger('focus'), 50);
    });

    $('#clienteBusca').off('input').on('input', async function () {
        const termo = $(this).val().trim();
        if (termo.length < 2) {
            $('#clienteResultados').empty();
            return;
        }

        try {
            const token = localStorage.getItem('token');
            const resposta = await fetch(`${API_URL}/clientes/buscar?termo=${encodeURIComponent(termo)}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            if (!resposta.ok) {
                throw new Error(`Erro ao buscar clientes: ${resposta.status}`);
            }
            const clientes = await resposta.json();
            renderizarResultadosClientes(clientes);
        } catch (error) {
            console.error('Erro ao buscar clientes:', error);
        }
    });
    $('#clienteResultados').off('click').on('click', '.cliente-item', function() {
        const clienteId = Number($(this).data('id'));
        const cliente = clientesResultados.find(c => Number(c.id) === clienteId);
        if (cliente) {
            selecionarCliente(cliente);
        }
    });

    // Calculadora PDV
    let calcExpression = '';
    const calcDisplay = $('#calcDisplay');

    $('.calc-btn').off('click').on('click', function() {
        const valor = String($(this).data('value'));

        if (valor === 'C') {
            calcExpression = '';
            calcDisplay.text('0');
        } else if (valor === '=') {
            if (calcExpression) {
                try {
                    // Avaliar expressão matemática de forma segura
                    const resultado = Function('"use strict"; return (' + calcExpression + ')')();
                    calcDisplay.text(resultado.toLocaleString('pt-BR', { maximumFractionDigits: 2 }));
                    calcExpression = String(resultado);
                } catch (e) {
                    calcDisplay.text('Erro');
                    calcExpression = '';
                }
            }
        } else {
            // Números e operadores
            if (calcExpression === '' && ['/', '*', '+', '-'].includes(valor)) {
                // Não começar com operador
                return;
            }
            calcExpression += valor;
            calcDisplay.text(calcExpression);
        }

        // Após clicar em =, focar no campo de busca
        if (valor === '=') {
            setTimeout(() => {
                $('#buscaProdutoPdv').trigger('focus');
            }, 100);
        }
    });

    $('#descontoPdv, #acrescimoPdv').off('input').on('input', function() {
        calcularTotal();
        calcularTrocoPDV();
    });

    $('#valorRecebidoPDV').off('input').on('input', calcularTrocoPDV);

    aoAlterarFormaPagamento();
}

function aoAlterarFormaPagamento() {
    const formaPagamento = $('#formaPagamentoPdv').val();
    const boxCliente = $('#pdvClienteBox');
    const boxDinheiro = $('#pdvDinheiroBox');

    // Esconde tudo primeiro
    boxCliente.hide();
    boxDinheiro.hide();

    if (formaPagamento === 'dinheiro') {
        boxDinheiro.show();
        calcularTrocoPDV();

        setTimeout(() => {
            const input = $('#valorRecebidoPDV');
            if (input.length) input.trigger('focus');
        }, 100);
    }

    if (formaPagamento === 'prazo') {
        boxCliente.show();

        // Padrão: 30 dias a partir de hoje
        const hoje = new Date();
        const vencimentoPadrao = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + 30);

        if (!$('#dataVencimentoPrazo').val()) {
            $('#dataVencimentoPrazo').val(vencimentoPadrao.toISOString().split('T')[0]);
        }

        if (!$('#parcelasPrazo').val() || $('#parcelasPrazo').val() === '0') {
            $('#parcelasPrazo').val(1);
        }

        setTimeout(() => {
            $('#clienteBuscaPrazo').trigger('focus');
        }, 100);
    } else {
        limparCamposPrazo();
    }
}

function limparCamposPrazo() {
    $('#clientePrazoId').val('');
    $('#clienteBuscaPrazo').val('');
    $('#clientePrazoSugestoes').empty().hide();
    $('#clientePrazoSelecionado').hide();
    $('#clientePrazoNome').text('');
    $('#dataVencimentoPrazo').val('');
    $('#parcelasPrazo').val(1);
    clienteSelecionado = null;
}

function calcularTrocoPDV() {
    const total = calcularTotalValor();
    const recebido = parseFloat($('#valorRecebidoPDV').val()) || 0;
    const troco = Math.max(0, recebido - total);

    $('#trocoPDV').text(formatCurrency(troco));
}

function renderizarResultadosClientes(clientes) {
    clientesResultados = Array.isArray(clientes) ? clientes : [];
    const container = $('#clienteResultados');

    if (!clientesResultados.length) {
        container.html('<div class="cliente-item">Nenhum cliente encontrado</div>');
        return;
    }

    container.html(clientesResultados.map(cliente => `
        <div class="cliente-item" data-id="${cliente.id}">
            <strong>${escapeHtml(cliente.nome)}</strong><br>
            <small>${formatarCpfCnpj(cliente.cpf_cnpj) || ''}${cliente.telefone ? ' - ' + escapeHtml(cliente.telefone) : ''}</small>
        </div>
    `).join(''));
}

function selecionarCliente(cliente) {
    clienteSelecionado = cliente;
    $('#clienteSelecionado').show();
    $('#clienteSelecionadoNome').text(`${cliente.nome}${cliente.cpf_cnpj ? ' - ' + formatarCpfCnpj(cliente.cpf_cnpj) : ''}`);
    $('#clienteBusca').val(cliente.nome);
    $('#clienteResultados').empty();
}

function removerClienteSelecionado() {
    clienteSelecionado = null;
    $('#clienteSelecionado').hide();
    $('#clienteSelecionadoNome').text('');
    $('#clienteBusca').val('');
    $('#clienteResultados').empty();
}

function abrirCadastroCliente() {
    if (typeof showClienteModal === 'function') {
        showClienteModal();
    } else {
        showNotification('Cadastro de cliente não disponível no momento.', 'warning');
    }
}

function renderCarrinhoItens() {
    if (!Array.isArray(carrinho) || carrinho.length === 0) {
        return '<tr><td colspan="7" class="text-center vazio">Nenhum item no carrinho</td></tr>';
    }

    return carrinho.map((item, index) => {
        const produto = produtosDisponiveis.find(p => Number(p.id) === Number(item.id));
        const vendaUnidade = itemVendaPorUnidade(item);
        const decimal = vendaUnidade ? false : produtoUsaConversaoUnidadesPdv(produto);
        const unidade = vendaUnidade ? 'UN' : String(produto?.unidade || item.unidade || 'UN').toUpperCase();
        const temDesconto = Number(item.desconto_percentual || 0) > 0;
        const classe = temDesconto ? 'table-warning' : '';
        const badgeDesconto = temDesconto ? `<small class="badge bg-danger">-${Number(item.desconto_percentual).toFixed(2)}%</small>` : '';
        const descontoAtacadoValor = Number(item.desconto_atacado || 0);
        const badgeDescontoAtacado = descontoAtacadoValor > 0 ? `<div><small class="text-success">Atacado: -${formatCurrency(descontoAtacadoValor)}</small></div>` : '';
        const modoAtacadoBadge = item.tipo_preco === 'atacado' ? `<div><small class="badge bg-secondary">ATACADO</small></div>` : '';
        const infoVendaUnidade = vendaUnidade && produto
            ? `<div class="text-muted small mt-1">
                    ${renderTextoPreviewEstoqueKg(produto, item.quantidade)}<br>
                    ${renderTextoPreviewValorUnidade(produto, item.quantidade)}
               </div>`
            : '';

        return `
            <tr ${classe ? `class="${classe}"` : ''}>
                <td class="col-qtd">
                    <input type="${decimal ? 'text' : 'number'}"
                           class="form-control form-control-sm quantidade-item"
                           value="${vendaUnidade ? Math.round(Number(item.quantidade || 0)) : formatarQuantidadePdv(item.quantidade, produto)}"
                           min="${decimal ? '0.01' : '1'}"
                           step="${decimal ? '0.01' : '1'}"
                           inputmode="${decimal ? 'decimal' : 'numeric'}"
                           data-index="${index}">
                </td>
                <td class="col-un"><span class="pdv-unidade-badge">${escapeHtml(unidade)}</span></td>
                <td class="col-produto">
                    <span class="pdv-produto-nome">${escapeHtml(item.nome)}</span>
                    ${badgeDesconto}
                    ${badgeDescontoAtacado}
                    ${modoAtacadoBadge}
                    ${infoVendaUnidade}
                </td>
                <td class="col-unit">
                    <input type="number"
                           class="form-control form-control-sm valor-item text-end"
                           value="${Number(item.preco_unitario).toFixed(2)}"
                           min="0.01"
                           step="0.01"
                           data-index="${index}">
                </td>
                <td class="col-desc">
                    <input type="number"
                           class="form-control form-control-sm percentual-item"
                           value="${Number(item.desconto_percentual || 0).toFixed(2)}"
                           min="-100"
                           step="0.01"
                           data-index="${index}">
                </td>
                <td class="col-total pdv-total-linha">${formatCurrency(item.subtotal)}</td>
                <td class="col-acao text-center">
                    <button type="button" class="btn btn-sm btn-outline-danger item-remover" data-index="${index}" title="Remover">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function codigoEhBalanca(codigo) {
    return /^2\d{12}$/.test(String(codigo || '').trim());
}

function unidadeEhKg(produto) {
    return String(produto?.unidade || '').toLowerCase() === 'kg';
}

function produtoUsaConversaoUnidadesPdv(produto) {
    if (typeof window.produtoUsaConversaoUnidades === 'function') {
        return window.produtoUsaConversaoUnidades(produto);
    }
    if (typeof window.produtoEhFracionado === 'function') {
        return window.produtoEhFracionado(produto);
    }
    return Number(produto?.produto_fracionado ?? produto?.vendido_por_peso ?? 0) === 1;
}

/** @deprecated Alias legado — use produtoUsaConversaoUnidadesPdv */
function produtoFracionado(produto) {
    return produtoUsaConversaoUnidadesPdv(produto);
}

function permiteQuantidadeDecimal(produto) {
    return produtoUsaConversaoUnidadesPdv(produto);
}

function quantidadeUsaDecimaisPdv(produto) {
    return produtoUsaConversaoUnidadesPdv(produto) || unidadeEhKg(produto);
}

/** @deprecated Use quantidadeUsaDecimaisPdv */
function quantidadeUsaTresCasas(produto) {
    return quantidadeUsaDecimaisPdv(produto);
}

function parseQuantidadePdv(valor) {
    const texto = String(valor ?? '').trim();
    if (!texto) return NaN;
    let normalizado = texto;
    if (texto.includes(',')) {
        normalizado = texto.replace(/\./g, '').replace(',', '.');
    }
    const numero = parseFloat(normalizado);
    return Number.isFinite(numero) ? numero : NaN;
}

function normalizarQuantidadePdv(quantidade, produto) {
    const qtd = Number(quantidade || 0);
    if (!Number.isFinite(qtd) || qtd <= 0) return 0;
    if (quantidadeUsaDecimaisPdv(produto)) {
        return Number(qtd.toFixed(2));
    }
    return Math.round(qtd);
}

function formatarQuantidadePdv(quantidade, produto) {
    const qtd = Number(quantidade || 0);
    if (!quantidadeUsaDecimaisPdv(produto)) {
        return String(Math.round(qtd));
    }
    const arredondado = Math.round(qtd * 100) / 100;
    if (Number.isInteger(arredondado)) {
        return String(arredondado);
    }
    return arredondado.toFixed(2).replace('.', ',').replace(/,00$/, '').replace(/(\,\d)0$/, '$1');
}

// Padrão profissional comum:
// 2 + 5 dígitos código do produto + 6 dígitos valor total em centavos + dígito verificador
// Exemplo: 2000010014890
// Produto: 00001
// Valor: R$ 14,89
function interpretarCodigoBalanca(codigo) {
    const limpo = String(codigo || '').replace(/\D/g, '');

    if (!codigoEhBalanca(limpo)) return null;

    return {
        codigoProduto: limpo.substring(1, 6),
        valorTotal: Number(limpo.substring(6, 12)) / 100,
        codigoOriginal: limpo
    };
}

function normalizarCodigoProduto(codigo) {
    return String(codigo || '').replace(/\D/g, '').replace(/^0+/, '') || String(codigo || '').trim();
}

function encontrarProdutoPorCodigoOuNome(termo) {
    const busca = normalizarTexto(termo);
    const buscaNumerica = normalizarCodigoProduto(termo);

    return produtosDisponiveis.find(p => {
        const codigo = normalizarTexto(p.codigo);
        const codigoBarras = normalizarTexto(p.codigo_barras);
        const nome = normalizarTexto(p.nome);

        const codigoNumerico = normalizarCodigoProduto(p.codigo);
        const barrasNumerico = normalizarCodigoProduto(p.codigo_barras);

        return (
            (codigo && codigo === busca) ||
            (codigoBarras && codigoBarras === busca) ||
            (codigoNumerico && codigoNumerico === buscaNumerica) ||
            (barrasNumerico && barrasNumerico === buscaNumerica) ||
            (nome && nome.includes(busca))
        );
    });
}

function adicionarItemNoCarrinho(produto, quantidade, precoUnitario, mensagemExtra = '', promocao = null, opcoes = {}) {
    const tipoVenda = normalizarTipoVendaItem(opcoes);

    if (tipoVendaEhUnidade(tipoVenda)) {
        quantidade = Math.max(0, Math.round(Number(quantidade || 0)));
        precoUnitario = Number(produto.preco_unidade ?? precoUnitario ?? 0);
    } else {
        quantidade = normalizarQuantidadePdv(quantidade, produto);
        precoUnitario = Number(precoUnitario || 0);
    }

    if (quantidade <= 0 || precoUnitario <= 0) {
        showNotification('Quantidade ou preço inválido.', 'warning');
        return;
    }

    const quantidadeEstoque = obterQuantidadeEstoqueParaVenda(produto, quantidade, tipoVenda);
    if (tipoVendaEhUnidade(tipoVenda) && quantidadeEstoque <= 0) {
        showNotification('Peso médio da unidade não configurado para este produto.', 'warning');
        return;
    }

    if (!pdvNotificarEstoqueInsuficiente(produto, quantidadeEstoque)) {
        return;
    }

    const precoPromocional = promocao && !tipoVendaEhUnidade(tipoVenda)
        ? Number(promocao.preco_promocional || precoUnitario)
        : precoUnitario;
    const percentualPromocao = promocao && !tipoVendaEhUnidade(tipoVenda)
        ? Number(promocao.desconto_percentual || 0)
        : 0;

    // Aplica preço atacado se ativo: obtém faixas e escolhe maior faixa atendida
    function obterPrecoAtacado(produtoId, quantidadeTotal, precoBase) {
        try {
            let faixas = [];
            $.ajax({ url: `${API_URL}/produtos/${produtoId}/atacado`, method: 'GET', async: false, headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || '') }, success: function(res) { faixas = res || []; } });

            if (!Array.isArray(faixas) || faixas.length === 0) return { preco: precoBase, descontoAtacado: 0 };

            // escolher maior faixa com quantidade_minima <= quantidadeTotal
            let escolhida = null;
            faixas.forEach(f => {
                const qmin = Number(f.quantidade_minima || 0);
                if (quantidadeTotal >= qmin) {
                    if (!escolhida || qmin > Number(escolhida.quantidade_minima || 0)) escolhida = f;
                }
            });

            if (!escolhida) return { preco: precoBase, descontoAtacado: 0 };

            const precoAtacado = Number(escolhida.preco_atacado || 0);
            if (precoAtacado <= 0) return { preco: precoBase, descontoAtacado: 0 };

            const descontoAtacadoTotal = Math.max(0, (Number(produto.preco_venda || precoBase) - precoAtacado) * quantidadeTotal);
            // Aplicar atacado somente se for menor que o preço já calculado (promoções permanecem se forem menores)
            const precoAplicado = Math.min(precoBase, precoAtacado);
            return { preco: precoAplicado, descontoAtacado: Number(descontoAtacadoTotal.toFixed(2)), isAtacado: true };
        } catch (err) {
            return { preco: precoBase, descontoAtacado: 0, isAtacado: false };
        }
    }

    // calcula preco final considerando promoção primeiro, depois atacado (se mais vantajoso)
    let precoFinal = precoPromocional;
    let descontoAtacadoItem = 0;
    
    const itemExistente = carrinho.find(item =>
        Number(item.id) === Number(produto.id) && normalizarTipoVendaItem(item) === tipoVenda
    );

    if (itemExistente) {
        const novaQuantidade = Number(itemExistente.quantidade) + quantidade;
        const novaQuantidadeEstoque = obterQuantidadeEstoqueParaVenda(produto, novaQuantidade, tipoVenda);

        if (!pdvNotificarEstoqueInsuficiente(produto, novaQuantidadeEstoque)) {
            return;
        }

        // reavaliar preço atacado com a nova quantidade total
            if (!tipoVendaEhUnidade(tipoVenda) && Number(produto.venda_atacado || 0) === 1) {
                const atac = obterPrecoAtacado(produto.id, novaQuantidade, precoFinal);
                precoFinal = atac.preco;
                descontoAtacadoItem = atac.descontoAtacado;
                itemExistente.tipo_preco = atac.isAtacado ? 'atacado' : 'varejo';
            }

        const precoBase = tipoVendaEhUnidade(tipoVenda)
            ? Number(produto.preco_unidade || precoFinal)
            : Number(produto.preco_venda || precoFinal);
        const descontoPercentual = precoBase > 0 ? Number(((1 - precoFinal / precoBase) * 100).toFixed(2)) : 0;

        itemExistente.quantidade = tipoVendaEhUnidade(tipoVenda)
            ? novaQuantidade
            : Number(novaQuantidade.toFixed(2));
        itemExistente.preco_unitario = precoFinal;
        itemExistente.desconto_percentual = descontoPercentual;
        itemExistente.promocao_id = promocao?.id || null;
        itemExistente.desconto_atacado = descontoAtacadoItem;
        itemExistente.tipo_venda = tipoVenda;
        itemExistente.subtotal = Number((itemExistente.quantidade * precoFinal).toFixed(2));
    } else {
        // avaliar atacado para quantidade inicial
            if (!tipoVendaEhUnidade(tipoVenda) && Number(produto.venda_atacado || 0) === 1) {
                const atac = obterPrecoAtacado(produto.id, quantidade, precoFinal);
                precoFinal = atac.preco;
                descontoAtacadoItem = atac.descontoAtacado;
            }

            const precoBase = tipoVendaEhUnidade(tipoVenda)
                ? Number(produto.preco_unidade || precoFinal)
                : Number(produto.preco_venda || precoFinal);
            const descontoPercentual = precoBase > 0 ? Number(((1 - precoFinal / precoBase) * 100).toFixed(2)) : 0;

            carrinho.push({
            id: produto.id,
            nome: produto.nome,
            quantidade: tipoVendaEhUnidade(tipoVenda) ? quantidade : Number(quantidade.toFixed(2)),
            preco_unitario: precoFinal,
            preco_base: precoBase,
            desconto_percentual: descontoPercentual,
            promocao_id: promocao?.id || null,
            desconto_atacado: descontoAtacadoItem,
                tipo_preco: (Number(produto.venda_atacado || 0) === 1 && descontoAtacadoItem > 0) ? 'atacado' : 'varejo',
            subtotal: Number((quantidade * precoFinal).toFixed(2)),
            item_fiscal: Number(produto.item_fiscal || 0),
            tipo_venda: tipoVenda
        });
    }

    atualizarCarrinho();
    const msgDesconto = percentualPromocao > 0 ? ` (Promoção -${percentualPromocao}%)` : '';
    showNotification(`${produto.nome} adicionado ao carrinho${msgDesconto}${mensagemExtra}.`, 'success');
    focarCampoCodigo();
}

function abrirModalModoVendaProduto(produto, callback) {
    $('#modalModoVendaProduto').remove();

    const modalHtml = `
        <div class="modal fade" id="modalModoVendaProduto" tabindex="-1">
            <div class="modal-dialog modal-sm modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header py-2">
                        <h6 class="modal-title">Como deseja vender?</h6>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <p class="mb-3 fw-bold">${escapeHtml(produto.nome || 'Produto')}</p>
                        <div class="form-check mb-2">
                            <input class="form-check-input" type="radio" name="modoVendaProduto" id="modoVendaPeso" value="PESO" checked>
                            <label class="form-check-label" for="modoVendaPeso">Peso</label>
                        </div>
                        <div class="form-check">
                            <input class="form-check-input" type="radio" name="modoVendaProduto" id="modoVendaUnidade" value="UNIDADE">
                            <label class="form-check-label" for="modoVendaUnidade">Unidade</label>
                        </div>
                    </div>
                    <div class="modal-footer py-2">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                        <button type="button" class="btn btn-primary" id="btnConfirmarModoVendaProduto">Continuar</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    $('body').append(modalHtml);

    const modalEl = document.getElementById('modalModoVendaProduto');
    const modal = new bootstrap.Modal(modalEl);
    modal.show();

    const confirmar = () => {
        const modo = $('input[name="modoVendaProduto"]:checked').val() || TIPO_VENDA_PESO;
        modal.hide();
        callback(modo);
    };

    $('#btnConfirmarModoVendaProduto').off('click').on('click', confirmar);
    modalEl.addEventListener('hidden.bs.modal', function onHidden() {
        modalEl.removeEventListener('hidden.bs.modal', onHidden);
        $('#modalModoVendaProduto').remove();
    }, { once: true });
}

function continuarAdicionarProdutoPdv(produto, promocao, tipoVenda = TIPO_VENDA_PESO) {
    if (tipoVendaEhUnidade(tipoVenda)) {
        const qtdTeste = obterQuantidadeEstoqueParaVenda(produto, 1, TIPO_VENDA_UNIDADE);
        const validacaoMinima = pdvValidarEstoqueVenda(produto, qtdTeste > 0 ? qtdTeste : 0.001);
        if (!validacaoMinima.sucesso) {
            showNotification(validacaoMinima.mensagem, 'danger');
            return;
        }

        abrirModalQuantidadeProduto(produto, function (quantidade) {
            adicionarItemNoCarrinho(
                produto,
                quantidade,
                Number(produto.preco_unidade || 0),
                ` - ${quantidade} un.`,
                null,
                { tipo_venda: TIPO_VENDA_UNIDADE }
            );
        }, { tipo_venda: TIPO_VENDA_UNIDADE });
        return;
    }

    if (permiteQuantidadeDecimal(produto)) {
        const unidade = String(produto.unidade || 'UN').toUpperCase();
        abrirModalQuantidadeProduto(produto, function (qtd) {
            const extra = unidadeEhKg(produto)
                ? ` - Peso: ${formatarQuantidadePdv(qtd, produto)} KG`
                : ` - Qtd: ${formatarQuantidadePdv(qtd, produto)} ${unidade}`;
            adicionarItemNoCarrinho(
                produto,
                qtd,
                Number(produto.preco_venda || 0),
                extra,
                promocao,
                { tipo_venda: TIPO_VENDA_PESO }
            );
        });
        return;
    }

    abrirModalQuantidadeProduto(produto, function (quantidade) {
        adicionarItemNoCarrinho(
            produto,
            quantidade,
            Number(produto.preco_venda || 0),
            '',
            promocao,
            { tipo_venda: TIPO_VENDA_PESO }
        );
    });
}

function iniciarFluxoAdicionarProdutoPdv(produto, promocao) {
    if (produtoPermiteEscolhaVendaUnidade(produto)) {
        abrirModalModoVendaProduto(produto, function (tipoVenda) {
            continuarAdicionarProdutoPdv(produto, promocao, tipoVenda);
        });
        return;
    }

    continuarAdicionarProdutoPdv(produto, promocao, TIPO_VENDA_PESO);
}

function adicionarProdutoPorCodigo(codigo) {
    if (!codigo || !codigo.trim()) return;

    if (!Array.isArray(produtosDisponiveis) || produtosDisponiveis.length === 0) {
        showNotification('Nenhum produto disponível para venda.', 'warning');
        return;
    }

    const codigoDigitado = String(codigo).trim();

    // 1) Código de balança
    const dadosBalanca = interpretarCodigoBalanca(codigoDigitado);

    if (dadosBalanca) {
        const produtoBalanca = encontrarProdutoPorCodigoOuNome(dadosBalanca.codigoProduto);

        if (!produtoBalanca) {
            showNotification(`Produto da balança não encontrado. Código interno: ${dadosBalanca.codigoProduto}`, 'danger');
            return;
        }

        if (!unidadeEhKg(produtoBalanca)) {
            showNotification(`O produto ${produtoBalanca.nome} não está cadastrado como KG.`, 'warning');
            return;
        }

        const precoKg = Number(produtoBalanca.preco_venda || 0);

        if (precoKg <= 0) {
            showNotification(`Preço por KG inválido para ${produtoBalanca.nome}.`, 'danger');
            return;
        }

        const peso = dadosBalanca.valorTotal / precoKg;

        buscarPromocaoAtivaProduto(produtoBalanca.id).then(promocao => {
            adicionarItemNoCarrinho(
                produtoBalanca,
                peso,
                precoKg,
                ` - Peso: ${formatarQuantidadePdv(peso, { unidade: 'kg', produto_fracionado: 1 })} KG - Total: ${formatCurrency(dadosBalanca.valorTotal)}`,
                promocao
            );
        });

        return;
    }

    // 2) Produto normal
    const produto = encontrarProdutoPorCodigoOuNome(codigoDigitado);

    if (!produto) {
        showNotification(`Produto não encontrado: ${codigo}`, 'danger');
        return;
    }

    const validacaoMinima = pdvValidarEstoqueVenda(produto, 1);
    if (!validacaoMinima.sucesso) {
        showNotification(validacaoMinima.mensagem, 'danger');
        return;
    }

    // Buscar promoção do produto
    buscarPromocaoAtivaProduto(produto.id).then(promocao => {
        iniciarFluxoAdicionarProdutoPdv(produto, promocao);
    });
}

function atualizarQuantidade(index, quantidade) {
    const item = carrinho[index];

    if (!item) return;

    const produto = produtosDisponiveis.find(p => Number(p.id) === Number(item.id));
    if (!produto) {
        showNotification('Produto do carrinho não encontrado no cadastro.', 'danger');
        return;
    }

    const vendaUnidade = itemVendaPorUnidade(item);
    const novaQuantidade = vendaUnidade
        ? Math.max(0, Math.round(Number(parseQuantidadePdv(quantidade) || 0)))
        : normalizarQuantidadePdv(parseQuantidadePdv(quantidade), produto);

    if (Number.isNaN(novaQuantidade) || novaQuantidade <= 0) {
        removerItemCarrinho(index);
        return;
    }

    const quantidadeEstoque = vendaUnidade
        ? obterQuantidadeEstoqueParaVenda(produto, novaQuantidade, 'unidade')
        : novaQuantidade;

    if (vendaUnidade && quantidadeEstoque <= 0) {
        showNotification('Peso médio da unidade não configurado para este produto.', 'warning');
        atualizarCarrinho();
        return;
    }

    if (!pdvNotificarEstoqueInsuficiente(produto, quantidadeEstoque)) {
        atualizarCarrinho();
        return;
    }

    // reavaliar preço atacado quando a quantidade mudar
    let precoAplicado = Number(item.preco_unitario || 0);
    let descontoAtacadoItem = Number(item.desconto_atacado || 0);
    if (!vendaUnidade && Number(produto.venda_atacado || 0) === 1) {
        try {
            let faixas = [];
            $.ajax({ url: `${API_URL}/produtos/${produto.id}/atacado`, method: 'GET', async: false, headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || '') }, success: function(res) { faixas = res || []; } });
            if (Array.isArray(faixas) && faixas.length > 0) {
                let escolhida = null;
                faixas.forEach(f => {
                    const qmin = Number(f.quantidade_minima || 0);
                    if (novaQuantidade >= qmin) {
                        if (!escolhida || qmin > Number(escolhida.quantidade_minima || 0)) escolhida = f;
                    }
                });
                if (escolhida) {
                    const precoAtacado = Number(escolhida.preco_atacado || 0);
                    const precoBase = Number(produto.preco_venda || precoAplicado);
                    const novoPreco = Math.min(precoAplicado, precoAtacado, precoBase);
                    precoAplicado = novoPreco;
                    descontoAtacadoItem = Math.max(0, (Number(produto.preco_venda || precoBase) - novoPreco) * novaQuantidade);
                }
            }
        } catch (err) {
            // ignore
        }
    }

    item.quantidade = novaQuantidade;
    item.preco_unitario = precoAplicado;
    item.desconto_atacado = Number((descontoAtacadoItem || 0).toFixed(2));
    const precoBase = vendaUnidade
        ? Number(produto.preco_unidade || item.preco_base || item.preco_unitario || 0)
        : Number(item.preco_base || produto?.preco_venda || item.preco_unitario || 0);
    item.desconto_percentual = precoBase > 0 ? Number(((1 - precoAplicado / precoBase) * 100).toFixed(2)) : 0;
    item.subtotal = Number((item.preco_unitario * novaQuantidade).toFixed(2));
    atualizarCarrinho();
}

function atualizarPercentual(index, percentual) {
    const item = carrinho[index];
    if (!item) return;

    const produto = produtosDisponiveis.find(p => Number(p.id) === Number(item.id));
    const precoBase = Number(item.preco_base || produto?.preco_venda || item.preco_unitario || 0);
    if (precoBase <= 0) return;

    const precoAplicado = Number((precoBase * (1 - Number(percentual || 0) / 100)).toFixed(2));
    item.desconto_percentual = Number(percentual.toFixed(2));
    item.preco_unitario = precoAplicado > 0 ? precoAplicado : 0.01;
    item.preco_base = precoBase;
    item.subtotal = Number((item.preco_unitario * Number(item.quantidade || 0)).toFixed(2));
    atualizarCarrinho();
}

function atualizarPrecoUnitario(index, valor) {
    const item = carrinho[index];
    if (!item) return;

    const produto = produtosDisponiveis.find(p => Number(p.id) === Number(item.id));
    const precoBase = Number(item.preco_base || produto?.preco_venda || item.preco_unitario || 0);
    if (precoBase <= 0) return;

    const precoUnitario = Number(valor || 0);
    if (precoUnitario <= 0) return;

    const percentual = Number(((1 - precoUnitario / precoBase) * 100).toFixed(2));
    item.desconto_percentual = percentual;
    item.preco_unitario = precoUnitario;
    item.preco_base = precoBase;
    item.subtotal = Number((precoUnitario * Number(item.quantidade || 0)).toFixed(2));
    atualizarCarrinho();
}

function removerItemCarrinho(index) {
    const item = carrinho[index];
    if (!item) return;
    carrinho.splice(index, 1);
    atualizarCarrinho();
    showNotification(`${item.nome} removido do carrinho.`, 'info');
}

function limparCarrinho() {
    if (carrinho.length === 0) return;
    if (!window.confirm('Tem certeza que deseja limpar todo o carrinho?')) return;

    carrinho = [];
    formaPagamentoSelecionada = null;
    vendaPrazoInfo = null;
    clienteSelecionado = null;
    $('#descontoPdv').val(0);
    $('#formaPagamentoPdv').val('');
    $('#pdvClienteBox').hide();
    $('#pdvDinheiroBox').hide();
    limparCamposPrazo();
    atualizarCarrinho();
    focarCampoCodigo();
    showNotification('Carrinho limpo com sucesso.', 'info');
}

function atualizarCarrinho() {
    const tbody = $('#tabelaItensVendaPdv');
    if (tbody.length) {
        tbody.html(renderCarrinhoItens());

        tbody.off('click').on('click', '.item-remover', function() {
            const index = $(this).data('index');
            removerItemCarrinho(index);
        });

        tbody.off('change').on('change', '.quantidade-item', function() {
            const index = $(this).data('index');
            const item = carrinho[index];
            const produto = item ? produtosDisponiveis.find(p => Number(p.id) === Number(item.id)) : null;
            let novaQtd = parseQuantidadePdv($(this).val());
            if (isNaN(novaQtd) || novaQtd <= 0) {
                removerItemCarrinho(index);
            } else {
                atualizarQuantidade(index, novaQtd);
            }
        });

        tbody.on('change', '.percentual-item', function() {
            const index = $(this).data('index');
            const percentual = parseFloat($(this).val());
            if (isNaN(percentual)) {
                atualizarCarrinho();
                return;
            }
            atualizarPercentual(index, percentual);
        });

        tbody.on('change', '.valor-item', function() {
            const index = $(this).data('index');
            const valor = parseFloat($(this).val());
            if (isNaN(valor) || valor <= 0) {
                atualizarCarrinho();
                return;
            }
            atualizarPrecoUnitario(index, valor);
        });
    }

    calcularTotal();

    const total = calcularTotalValor();
    // Só habilita finalizar se caixa aberto E houver itens no carrinho
    $('#btnFinalizarVendaPdv').prop('disabled', !caixaAberto || carrinho.length === 0 || total <= 0);
    $('#btnCancelarVendaPdv').prop('disabled', carrinho.length === 0);
}

function calcularSubtotal() {
    return carrinho.reduce((acc, item) => acc + Number(item.subtotal || 0), 0);
}

function calcularTotalValor() {
    const subtotal = calcularSubtotal();
    const desconto = parseFloat($('#descontoPdv').val()) || 0;
    const acrescimo = parseFloat($('#acrescimoPdv').val()) || 0;
    return Math.max(0, subtotal - desconto + acrescimo);
}

function obterTotalVendaPDV() {
    return Math.round(calcularTotalValor() * 100) / 100;
}

function calcularTotal() {
    const subtotal = calcularSubtotal();
    const total = calcularTotalValor();
    $('#subtotalPdv').text(formatCurrency(subtotal));
    // exibe desconto atacado (informativo)
    const descontoAtacadoTotal = carrinho.reduce((acc, it) => acc + (Number(it.desconto_atacado || 0)), 0);
    $('#descontoAtacadoPdv').text(formatCurrency(descontoAtacadoTotal));
    // exibe quantidade de itens
    const quantidadeItens = carrinho.reduce((acc, it) => acc + Number(it.quantidade || 0), 0);
    $('#itensPdv').text(quantidadeItens);
    $('#totalPdv').text(formatCurrency(total));

    calcularTrocoPDV();
}

function abrirModalPagamento(onConfirm) {
    if (carrinho.length === 0) {
        showNotification('Adicione itens ao carrinho antes de finalizar a venda.', 'warning');
        return;
    }

    const total = calcularTotalValor();
    if (total <= 0) {
        showNotification('O total da venda deve ser maior que zero.', 'warning');
        return;
    }

    const modalHtml = `
        <div class="modal fade" id="pagamentoModal" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Forma de Pagamento</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <h4 class="text-center mb-3">Total: ${formatCurrency(total)}</h4>

                        <div class="payment-methods mb-3 d-flex flex-wrap gap-2">
                            <button type="button" class="payment-method-btn btn btn-outline-primary" data-pagamento="dinheiro">Dinheiro</button>
                            <button type="button" class="payment-method-btn btn btn-outline-primary" data-pagamento="cartao_credito">Cartão Crédito</button>
                            <button type="button" class="payment-method-btn btn btn-outline-primary" data-pagamento="cartao_debito">Cartão Débito</button>
                            <button type="button" class="payment-method-btn btn btn-outline-primary" data-pagamento="pix">PIX</button>
                            <button type="button" class="payment-method-btn btn btn-outline-primary" data-pagamento="prazo">A Prazo</button>
                        </div>

                        <div id="troco-area" style="display:none;" class="mt-4 p-3 bg-light rounded">
                            <div class="mb-3">
                                <label for="valor-recebido" class="form-label fw-bold">Valor Recebido:</label>
                                <input type="number" step="0.01" class="form-control form-control-lg text-end" id="valor-recebido" placeholder="0,00" autofocus>
                            </div>
                            <div class="mt-3 p-2 bg-white rounded border-2 border-success">
                                <div class="d-flex justify-content-between align-items-center">
                                    <span class="fw-bold">Total:</span>
                                    <span style="font-size:1.2rem;">${formatCurrency(total)}</span>
                                </div>
                                <div class="d-flex justify-content-between align-items-center mt-2">
                                    <span class="fw-bold text-success">Troco:</span>
                                    <span id="troco" style="font-size:1.5rem; color:#198754; font-weight:bold;">R$ 0,00</span>
                                </div>
                            </div>
                            <small class="text-muted d-block mt-2">💡 Dica: Digite o valor e pressione <kbd>Enter</kbd> para confirmar</small>
                        </div>

                        <div id="prazo-area" style="display:none;" class="mt-3 position-relative">
                            <div class="mb-2">
                                <label for="cliente-prazo-busca">Cliente *</label>
                                <input type="text" class="form-control" id="cliente-prazo-busca" placeholder="Digite o nome do cliente">
                                <input type="hidden" id="cliente-prazo-id">
                                <div id="cliente-prazo-sugestoes" class="list-group position-absolute w-100" style="z-index: 9999; display:none;"></div>
                            </div>
                            <div class="mb-2">
                                <label for="parcelas-prazo">Quantidade de Parcelas *</label>
                                <input type="number" min="1" max="24" class="form-control" id="parcelas-prazo" value="1">
                            </div>
                            <div class="mb-2">
                                <label for="primeiro-vencimento-prazo">Primeiro Vencimento *</label>
                                <input type="date" class="form-control" id="primeiro-vencimento-prazo">
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                        <button type="button" class="btn btn-primary" id="confirmar-pagamento">Confirmar Pagamento</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    $('#modal-container').html(modalHtml);

    const modalEl = document.getElementById('pagamentoModal');
    const modal = new bootstrap.Modal(modalEl);
    modal.show();

    formaPagamentoSelecionada = null;
    vendaPrazoInfo = null;

    $('.payment-method-btn').off('click').on('click', function() {
        selecionarPagamento($(this).data('pagamento'));
    });

    $('#confirmar-pagamento').off('click').on('click', function() {
        confirmarPagamento(modalEl, onConfirm);
    });

    $('#valor-recebido').off('input').on('input', calcularTroco);

    const formaPagamentoAtual = $('#formaPagamentoPdv').val();
    if (formaPagamentoAtual === 'dinheiro') {
        setTimeout(() => selecionarPagamento('dinheiro'), 0);
    }
}

function selecionarPagamento(tipo) {
    formaPagamentoSelecionada = tipo;

    $('.payment-method-btn').removeClass('active btn-primary').addClass('btn-outline-primary');
    $(`.payment-method-btn[data-pagamento="${tipo}"]`).removeClass('btn-outline-primary').addClass('active btn-primary');

    if (tipo === 'dinheiro') {
        $('#troco-area').show();
        $('#prazo-area').hide();
        $('#valor-recebido').val('');
        calcularTroco();
        // Foco automático no campo de valor recebido após pequeno delay
        setTimeout(() => {
            const valorInput = $('#valor-recebido');
            if (valorInput.length) {
                valorInput.trigger('focus');
                valorInput.off('keypress').on('keypress', function(e) {
                    if (e.which === 13) { // Enter
                        e.preventDefault();
                        document.getElementById('confirmar-pagamento').click();
                    }
                });
            }
        }, 100);
    } else if (tipo === 'prazo') {
        $('#troco-area').hide();
        $('#prazo-area').show();

        const hoje = new Date();
        const primeiroVencimento = new Date(hoje.getFullYear(), hoje.getMonth() + 1, hoje.getDate());
        $('#primeiro-vencimento-prazo').val(primeiroVencimento.toISOString().split('T')[0]);

        $('#cliente-prazo-busca').off('input').on('input', function() {
            const termo = normalizarTexto($(this).val()).trim();
            if (termo.length < 2) {
                $('#cliente-prazo-sugestoes').empty().hide();
                $('#cliente-prazo-id').val('');
                return;
            }

            $.ajax({
                url: `${API_URL}/clientes`,
                method: 'GET',
                success: function(clientes) {
                    const filtrados = (clientes || []).filter(c =>
                        normalizarTexto(c.nome).includes(termo) ||
                        String(c.cpf_cnpj || '').replace(/\D/g, '').includes(termo.replace(/\D/g, ''))
                    );

                    if (filtrados.length === 0) {
                        $('#cliente-prazo-sugestoes').html('<div class="list-group-item">Nenhum cliente encontrado</div>').show();
                        return;
                    }

                    $('#cliente-prazo-sugestoes').html(
                        filtrados.map(c => `
                            <button type="button" class="list-group-item list-group-item-action" data-id="${c.id}" data-nome="${escapeHtml(c.nome || '')}">
                                ${escapeHtml(c.nome || '')}${c.cpf_cnpj ? ' - ' + formatarCpfCnpj(c.cpf_cnpj) : ''}
                            </button>
                        `).join('')
                    ).show();
                },
                error: function() {
                    $('#cliente-prazo-sugestoes').empty().hide();
                }
            });
        });

        $(document).off('click.sugestaoCliente').on('click.sugestaoCliente', '#cliente-prazo-sugestoes button', function() {
            $('#cliente-prazo-id').val($(this).data('id'));
            $('#cliente-prazo-busca').val($(this).data('nome'));
            $('#cliente-prazo-sugestoes').empty().hide();
        });
    } else {
        $('#troco-area').hide();
        $('#prazo-area').hide();
    }
}

function calcularTroco() {
    const total = calcularTotalValor();
    const recebido = parseFloat($('#valor-recebido').val()) || 0;
    const troco = Math.max(0, recebido - total);
    $('#troco').text(formatCurrency(troco));
}

function confirmarPagamento(modalEl, onConfirm) {
    if (!formaPagamentoSelecionada) {
        showNotification('Selecione uma forma de pagamento.', 'warning');
        return;
    }

    if (formaPagamentoSelecionada === 'dinheiro') {
        const recebido = parseFloat($('#valor-recebido').val()) || 0;
        const total = calcularTotalValor();
        if (recebido < total) {
            showNotification('Valor recebido insuficiente.', 'danger');
            return;
        }
    }

    if (formaPagamentoSelecionada === 'prazo') {
        const clienteId = parseInt($('#cliente-prazo-id').val(), 10);
        const parcelas = parseInt($('#parcelas-prazo').val(), 10) || 1;
        const primeiroVencimento = $('#primeiro-vencimento-prazo').val();

        if (!clienteId) {
            showNotification('Selecione o cliente da venda a prazo.', 'danger');
            return;
        }
        if (parcelas < 1) {
            showNotification('Quantidade de parcelas inválida.', 'danger');
            return;
        }
        if (!primeiroVencimento) {
            showNotification('Informe o primeiro vencimento.', 'danger');
            return;
        }

        vendaPrazoInfo = {
            cliente_id: clienteId,
            parcelas,
            primeiro_vencimento: primeiroVencimento,
            cliente_nome: $('#cliente-prazo-busca').val().trim()
        };
    } else {
        vendaPrazoInfo = null;
    }

    const instancia = bootstrap.Modal.getInstance(modalEl);
    if (document.activeElement) {
        document.activeElement.blur();
    }
    if (instancia) instancia.hide();

    if (typeof onConfirm === 'function') {
        onConfirm();
    } else {
        executarFinalizacaoVenda();
    }
}

function abrirModalDecisaoFiscal(skipPagamento = false) {
    if (vendaEmProcessamento) {
        showNotification('A venda já está sendo processada.', 'warning');
        return;
    }

    // Verificar se caixa está aberto
    if (!caixaAberto) {
        showNotification('🔴 Caixa fechado. Abra o caixa antes de vender.', 'danger');
        return;
    }

    if (!Array.isArray(carrinho) || carrinho.length === 0) {
        showNotification('Adicione itens ao carrinho antes de finalizar.', 'warning');
        return;
    }

    const formaPagamento = $('#formaPagamentoPdv').val();

    if (!formaPagamento) {
        showNotification('Selecione uma forma de pagamento.', 'warning');
        return;
    }

    const desconto = parseFloat($('#descontoPdv').val()) || 0;
    const subtotal = calcularSubtotal();
    const total = Math.round((Math.max(0, subtotal - desconto)) * 100) / 100;

    if (total <= 0) {
        showNotification('O total final da venda é inválido.', 'warning');
        return;
    }

    if (formaPagamento === 'dinheiro') {
        const recebido = parseFloat($('#valorRecebidoPDV').val()) || 0;

        if (recebido <= 0) {
            showNotification('Informe o valor recebido em dinheiro.', 'warning');
            $('#valorRecebidoPDV').trigger('focus');
            return;
        }

        if (recebido < total) {
            showNotification('O valor recebido é menor que o total da venda.', 'danger');
            $('#valorRecebidoPDV').trigger('focus');
            return;
        }
    }

    if (formaPagamento === 'prazo') {
        const clienteIdPrazo = clienteSelecionado?.id || Number($('#clientePrazoId').val()) || null;
        if (!clienteIdPrazo) {
            showNotification('Para venda a prazo, selecione um cliente.', 'warning');
            $('#clienteBuscaPrazo').trigger('focus');
            return;
        }
        const parcelas = Number($('#parcelasPrazo').val()) || 1;
        if (parcelas < 1) {
            showNotification('A quantidade de parcelas deve ser no mínimo 1.', 'warning');
            $('#parcelasPrazo').trigger('focus');
            return;
        }
        const dataVenc = $('#dataVencimentoPrazo').val();
        if (!dataVenc) {
            showNotification('Informe a data do primeiro vencimento.', 'warning');
            $('#dataVencimentoPrazo').trigger('focus');
            return;
        }
    }

    const clienteId = clienteSelecionado?.id || vendaPrazoInfo?.cliente_id || Number($('#clientePrazoId').val()) || null;

    formaPagamentoSelecionadaPDV = formaPagamentoSelecionadaPDV || formaPagamento;
    prosseguirFinalizacaoConformeModoFiscal(formaPagamento);
}

/**
 * F12 ativo → venda fiscal (CPF/NFC-e). F12 desativado → venda não fiscal direta.
 * Sem modal de escolha manual.
 */
function prosseguirFinalizacaoConformeModoFiscal(formaPagamentoOverride) {
    const forma = formaPagamentoOverride || formaPagamentoSelecionadaPDV;

    if (typeof implantacaoPermiteFiscal === 'function' && !implantacaoPermiteFiscal()) {
        pdvEmitirFiscalNaVenda = false;
        executarFinalizacaoVenda(false, null, forma);
        return;
    }

    if (pdvModoFiscalAtivo()) {
        pdvEmitirFiscalNaVenda = true;
        mostrarModalCpfCnpjNota();
        return;
    }

    pdvEmitirFiscalNaVenda = false;
    executarFinalizacaoVenda(false, null, forma);
}

function mostrarModalDecisaoFiscal() {
    prosseguirFinalizacaoConformeModoFiscal();
}

window.prosseguirFinalizacaoConformeModoFiscal = prosseguirFinalizacaoConformeModoFiscal;
window.mostrarModalDecisaoFiscal = mostrarModalDecisaoFiscal;

function limparCpfCnpj(valor) {
    return String(valor || '').replace(/\D/g, '');
}

function validarCpfCnpjNota(valor) {
    const doc = limparCpfCnpj(valor);

    if (!doc) return true;

    return doc.length === 11 || doc.length === 14;
}

function abrirPagamentoMisto() {
    const totalVenda = obterTotalVendaPDV();

    function moeda(v) {
        return 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',');
    }

    const opcoes = {
        dinheiro_pix: [
            { id: 'pgDinheiro', label: 'Dinheiro', forma: 'dinheiro' },
            { id: 'pgPix', label: 'Pix', forma: 'pix' }
        ],
        dinheiro_debito: [
            { id: 'pgDinheiro', label: 'Dinheiro', forma: 'dinheiro' },
            { id: 'pgDebito', label: 'Cartão de Débito', forma: 'cartao_debito' }
        ],
        dinheiro_credito: [
            { id: 'pgDinheiro', label: 'Dinheiro', forma: 'dinheiro' },
            { id: 'pgCredito', label: 'Cartão de Crédito', forma: 'cartao_credito' }
        ]
    };

    $('#modal-container').html(`
        <div class="modal fade" id="pagamentoMistoModal" tabindex="-1">
            <div class="modal-dialog modal-dialog-centered modal-lg">
                <div class="modal-content border-0 shadow-lg" style="border-radius: 16px; overflow: hidden;">
                    <div class="modal-header text-white" style="background:#0d6efd;">
                        <div>
                            <h4 class="modal-title mb-0">Pagamento Misto</h4>
                            <small>Escolha a combinação e informe os valores</small>
                        </div>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>

                    <div class="modal-body p-4" style="background:#f5f7fb;">
                        <div class="row g-3 mb-4">
                            <div class="col-md-4">
                                <div class="p-3 bg-white rounded shadow-sm">
                                    <small class="text-muted">TOTAL DA VENDA</small>
                                    <h3 class="mb-0 text-primary">${moeda(totalVenda)}</h3>
                                </div>
                            </div>
                            <div class="col-md-4">
                                <div class="p-3 bg-white rounded shadow-sm">
                                    <small class="text-muted">VALOR INFORMADO</small>
                                    <h3 class="mb-0 text-success" id="totalInformado">${moeda(0)}</h3>
                                </div>
                            </div>
                            <div class="col-md-4">
                                <div class="p-3 bg-white rounded shadow-sm">
                                    <small class="text-muted">VALOR RESTANTE</small>
                                    <h3 class="mb-0 text-danger" id="totalFalta">${moeda(totalVenda)}</h3>
                                </div>
                            </div>
                        </div>

                        <div class="bg-white rounded shadow-sm p-3 mb-3">
                            <label class="fw-bold mb-2">Tipo de pagamento misto</label>
                            <select id="tipoPagamentoMisto" class="form-select form-select-lg">
                                <option value="">-- Selecione a combinação --</option>
                                <option value="dinheiro_pix">Dinheiro + Pix</option>
                                <option value="dinheiro_debito">Dinheiro + Cartão de Débito</option>
                                <option value="dinheiro_credito">Dinheiro + Cartão de Crédito</option>
                            </select>
                        </div>

                        <div id="camposPagamentoMisto"></div>

                        <div id="alertaPagamentoMisto" class="alert alert-warning d-none mt-3 mb-0">
                            A soma dos pagamentos precisa ser igual ao total da venda.
                        </div>
                    </div>

                    <div class="modal-footer bg-white p-3">
                        <button type="button" class="btn btn-outline-secondary btn-lg" data-bs-dismiss="modal">
                            Cancelar
                        </button>

                        <button class="btn btn-success btn-lg px-5" id="btnConfirmarPagamentoMisto" disabled>
                            Confirmar Pagamento
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `);

    const modal = new bootstrap.Modal(document.getElementById('pagamentoMistoModal'));
    modal.show();

    function renderizarCampos(tipo) {
        const campos = opcoes[tipo];

        $('#camposPagamentoMisto').html(campos.map(campo => `
            <div class="bg-white rounded shadow-sm p-3 mb-3">
                <label class="fw-bold mb-2">${campo.label}</label>
                <div class="input-group input-group-lg">
                    <span class="input-group-text">R$</span>
                    <input
                        type="number"
                        step="0.01"
                        min="0"
                        id="${campo.id}"
                        data-forma="${campo.forma}"
                        class="form-control pagamento-misto-input"
                        placeholder="0"
                    >
                </div>
            </div>
        `).join(''));

        $('.pagamento-misto-input').on('input', atualizarTotais);

        const $inputs = $('.pagamento-misto-input');
        if (tipo === 'dinheiro_pix' && $inputs.length >= 2) {
            const $dinheiro = $inputs.filter('[data-forma="dinheiro"]');
            const $pix = $inputs.filter('[data-forma="pix"]');

            function preencherRestantePixMisto() {
                const valDinheiro = Number($dinheiro.val() || 0);
                const restante = Math.round((totalVenda - valDinheiro) * 100) / 100;

                if (valDinheiro > 0 && restante > 0) {
                    $pix.val(restante.toFixed(2));
                } else if (restante <= 0) {
                    $pix.val('0.00');
                }
                atualizarTotais();
            }

            $dinheiro.on('input blur', preencherRestantePixMisto);
        } else if ($inputs.length >= 2) {
            $inputs.first().on('blur', function() {
                const valPrimeiro = Number($(this).val() || 0);
                const $segundo = $inputs.eq(1);
                const valSegundo = Number($segundo.val() || 0);

                if (valPrimeiro > 0 && valSegundo === 0) {
                    const restante = totalVenda - valPrimeiro;
                    if (restante > 0) {
                        $segundo.val(restante.toFixed(2));
                        atualizarTotais();
                    }
                }
            });
        }

        $('.pagamento-misto-input').first().trigger('focus');
        atualizarTotais();
    }

    function atualizarTotais() {
        let informado = 0;

        $('.pagamento-misto-input').each(function () {
            informado += Number($(this).val() || 0);
        });

        const falta = totalVenda - informado;
        const correto = Math.abs(falta) <= 0.01;

        $('#totalInformado').text(moeda(informado));
        $('#totalFalta').text(moeda(falta));

        $('#btnConfirmarPagamentoMisto').prop('disabled', !correto);

        if (correto) {
            $('#alertaPagamentoMisto').addClass('d-none');
            $('#totalFalta').removeClass('text-danger').addClass('text-success');
        } else {
            $('#alertaPagamentoMisto').removeClass('d-none');
            $('#totalFalta').removeClass('text-success').addClass('text-danger');
        }
    }

    $('#tipoPagamentoMisto').on('change', function () {
        const tipo = $(this).val();
        pagamentosMistos = [];

        if (tipo && opcoes[tipo]) {
            renderizarCampos(tipo);
        } else {
            $('#camposPagamentoMisto').empty();
            $('#btnConfirmarPagamentoMisto').prop('disabled', true);
        }
    });

    $('#btnConfirmarPagamentoMisto').on('click', function () {
        const tipoMisto = $('#tipoPagamentoMisto').val();

        if (tipoMisto === 'dinheiro_pix') {
            const $dinheiro = $('#pgDinheiro');
            const $pix = $('#pgPix');
            const valDinheiro = Number($dinheiro.val() || 0);
            const valPixAtual = Number($pix.val() || 0);
            const restante = Math.round((totalVenda - valDinheiro) * 100) / 100;

            if (valDinheiro > 0 && valPixAtual === 0 && restante > 0) {
                $pix.val(restante.toFixed(2));
            }
        }

        pagamentosMistos = [];

        $('.pagamento-misto-input').each(function () {
            const valor = Number($(this).val() || 0);
            const forma = $(this).data('forma');

            if (valor > 0) {
                pagamentosMistos.push({
                    forma_pagamento: forma,
                    valor
                });
            }
        });

        formaPagamentoSelecionadaPDV = 'misto';

        const pagamentoPix = pagamentosMistos.find(p => p.forma_pagamento === 'pix');
        const valorPix = pagamentoPix ? Number(pagamentoPix.valor) : 0;

        if (document.activeElement) {
            document.activeElement.blur();
        }

        modal.hide();

        if (tipoMisto === 'dinheiro_pix' && valorPix > 0) {
            setTimeout(async () => {
                const tefOn = await obterTefHabilitadoConfig();
                if (tefOn) {
                    mostrarModalDecisaoFiscal();
                    return;
                }

                const ativo = await pixAutomaticoHabilitado();
                if (ativo) {
                    iniciarPixAutomaticoPDV(valorPix, {
                        modoMisto: true,
                        onPago: () => {
                            setTimeout(() => mostrarModalDecisaoFiscal(), 300);
                        }
                    });
                } else {
                    mostrarModalDecisaoFiscal();
                }
            }, 300);
            return;
        }

        setTimeout(() => {
            mostrarModalDecisaoFiscal();
        }, 300);
    });
}

function mostrarModalCpfCnpjNota() {
    if (!pdvModoFiscalAtivo()) {
        prosseguirFinalizacaoConformeModoFiscal();
        return;
    }

    pdvEmitirFiscalNaVenda = true;

    $('#modal-container').html(`
        <div class="modal fade" id="cpfCnpjNotaModal" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-sm modal-dialog-centered">
                <div class="modal-content border-0 shadow">
                    <div class="modal-header bg-primary text-white">
                        <h5 class="modal-title mb-0">CPF/CNPJ na Nota</h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>

                    <div class="modal-body">
                        <label class="form-label">Informe CPF ou CNPJ do cliente</label>
                        <input
                            type="text"
                            id="cpfCnpjNotaFiscal"
                            class="form-control"
                            placeholder="Opcional"
                            maxlength="18"
                            autocomplete="off"
                        >

                        <small class="text-muted d-block mt-2">
                            Deixe em branco para emitir como consumidor não identificado.
                        </small>

                        <div class="d-grid gap-2 mt-3">
                            <button type="button" class="btn btn-success" id="btnConfirmarCpfNota">
                                Finalizar Venda
                            </button>

                            <button type="button" class="btn btn-secondary" id="btnEmitirSemCpf">
                                Finalizar sem CPF/CNPJ
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `);

    const modalEl = document.getElementById('cpfCnpjNotaModal');
    const modal = new bootstrap.Modal(modalEl);
    modal.show();

    $('#cpfCnpjNotaFiscal').trigger('focus');

    $('#cpfCnpjNotaFiscal').on('input', function () {
        let v = limparCpfCnpj(this.value);

        if (v.length <= 11) {
            v = v.replace(/(\d{3})(\d)/, '$1.$2');
            v = v.replace(/(\d{3})(\d)/, '$1.$2');
            v = v.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
        } else {
            v = v.replace(/^(\d{2})(\d)/, '$1.$2');
            v = v.replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3');
            v = v.replace(/\.(\d{3})(\d)/, '.$1/$2');
            v = v.replace(/(\d{4})(\d)/, '$1-$2');
        }

        this.value = v;
    });

    $('#btnConfirmarCpfNota').off('click').on('click', function () {
        const cpfCnpj = $('#cpfCnpjNotaFiscal').val();

        if (cpfCnpj && !validarCpfCnpjNota(cpfCnpj)) {
            showNotification('CPF/CNPJ inválido. Informe 11 ou 14 números.', 'warning');
            $('#cpfCnpjNotaFiscal').trigger('focus');
            return;
        }

        if (document.activeElement) {
            document.activeElement.blur();
        }

        modal.hide();

        setTimeout(() => {
            const emitirFiscal = pdvEmitirFiscalNaVenda === true;
            executarFinalizacaoVenda(emitirFiscal, limparCpfCnpj(cpfCnpj), formaPagamentoSelecionadaPDV);
        }, 300);
    });

    $('#btnEmitirSemCpf').off('click').on('click', function () {
        if (document.activeElement) {
            document.activeElement.blur();
        }

        modal.hide();

        setTimeout(() => {
            const emitirFiscal = pdvEmitirFiscalNaVenda === true;
            executarFinalizacaoVenda(emitirFiscal, null, formaPagamentoSelecionadaPDV);
        }, 300);
    });
}

function mostrarModalAvisoDebitoCliente(aviso, totalEmAberto, parcelasVencidas, onConfirm) {
    const detalhes = [];
    if (totalEmAberto > 0) {
        detalhes.push(`Valor em aberto: <strong>${formatCurrency(totalEmAberto)}</strong>`);
    }
    if (parcelasVencidas > 0) {
        detalhes.push(`Parcelas vencidas: <strong>${parcelasVencidas}</strong>`);
    }

    $('#modal-container').html(`
        <div class="modal fade" id="debitoAvisoModal" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-sm modal-dialog-centered">
                <div class="modal-content border-0 shadow">
                    <div class="modal-header bg-warning">
                        <h5 class="modal-title text-dark mb-0">Aviso de Débito</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
                    </div>
                    <div class="modal-body text-center">
                        <p class="mb-3">${escapeHtml(aviso)}</p>
                        <p class="mb-3">${detalhes.join('<br>')}</p>
                        <div class="d-grid gap-2">
                            <button type="button" class="btn btn-danger" id="confirmar-continuar-debito">Continuar mesmo assim</button>
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `);

    const modalEl = document.getElementById('debitoAvisoModal');
    const modal = new bootstrap.Modal(modalEl);
    modal.show();

    $('#confirmar-continuar-debito').off('click').on('click', function() {
        if (document.activeElement) {
            document.activeElement.blur();
        }

        modal.hide();
        if (typeof onConfirm === 'function') {
            onConfirm();
        }
    });
}

async function executarFinalizacaoVenda(emitirFiscal = false, cpfCnpjNota = null, formaPagamentoDireta = null) {
    if (vendaEmProcessamento) {
        showNotification('A venda já está sendo processada.', 'warning');
        return;
    }

    if (!Array.isArray(carrinho) || carrinho.length === 0) {
        showNotification('Adicione itens ao carrinho antes de finalizar.', 'warning');
        return;
    }

    const formaPagamento = formaPagamentoDireta || formaPagamentoSelecionadaPDV || $('#formaPagamentoPdv').val();

    console.log('FORMA PAGAMENTO DETECTADA:', formaPagamento);
    console.log('PAGAMENTOS MISTOS:', pagamentosMistos);

    if (!formaPagamento) {
        showNotification('Informe a forma de pagamento.', 'warning');
        return;
    }

    const clienteId = clienteSelecionado?.id || vendaPrazoInfo?.cliente_id || Number($('#clientePrazoId').val()) || null;
    if (formaPagamento === 'prazo' && !clienteId) {
        showNotification('Para venda a prazo, selecione um cliente.', 'warning');
        $('#clienteBuscaPrazo').trigger('focus');
        return;
    }

    if (formaPagamento === 'prazo') {
        const parcelas = Number($('#parcelasPrazo').val()) || vendaPrazoInfo?.parcelas || 1;
        const dataVenc = $('#dataVencimentoPrazo').val() || vendaPrazoInfo?.primeiro_vencimento;
        if (!dataVenc) {
            showNotification('Informe a data do primeiro vencimento.', 'warning');
            $('#dataVencimentoPrazo').trigger('focus');
            return;
        }
        if (parcelas < 1) {
            showNotification('A quantidade de parcelas deve ser no mínimo 1.', 'warning');
            $('#parcelasPrazo').trigger('focus');
            return;
        }
    }

    const desconto = parseFloat($('#descontoPdv').val()) || 0;
    const subtotal = calcularSubtotal();
    const total = Math.round((Math.max(0, subtotal - desconto)) * 100) / 100;

    if (total <= 0) {
        showNotification('O total final da venda é inválido.', 'warning');
        return;
    }

    const dados = {
        cliente_id: clienteId,
        cliente_nome: clienteSelecionado?.nome || vendaPrazoInfo?.cliente_nome || null,
        forma_pagamento: pagamentosMistos.length > 1 ? "misto" : formaPagamento,
        desconto,
        total,
        emitir_fiscal: false,
        cpf_cnpj_nota: null,
        pagamentos: pagamentosMistos.length > 0 ? pagamentosMistos : [
            {
                forma_pagamento: formaPagamento,
                valor: total
            }
        ],
        itens: carrinho.map(item => {
            const produto = produtosDisponiveis.find(p => Number(p.id) === Number(item.id));
            const tipoVenda = normalizarTipoVendaItem(item);
            const quantidade = tipoVendaEhUnidade(tipoVenda)
                ? Math.max(0, Math.round(Number(item.quantidade || 0)))
                : normalizarQuantidadePdv(item.quantidade, produto);
            const itemPayload = {
            produto_id: Number(item.id),
            quantidade,
            preco_unitario: Number(item.preco_unitario),
            desconto_percentual: Number(item.desconto_percentual || 0),
            promocao_id: item.promocao_id || null,
            desconto_atacado: Number(item.desconto_atacado || 0),
            tipo_preco: item.tipo_preco || 'varejo',
            subtotal: Math.round(Number(item.preco_unitario) * Number(item.quantidade) * 100) / 100,
            item_fiscal: Number(item.item_fiscal || 0),
            tipo_venda: tipoVenda
        };
            if (tipoVendaEhUnidade(tipoVenda) && produto) {
                itemPayload.quantidade_estoque = obterQuantidadeEstoqueParaVenda(produto, quantidade, TIPO_VENDA_UNIDADE);
            }
            return itemPayload;
        }),
        supervisor_token: supervisorAuthToken || null
    };

    if (formaPagamento === 'dinheiro') {
        dados.valor_recebido = parseFloat($('#valorRecebidoPDV').val()) || 0;
    }

    if (formaPagamento === 'prazo') {
        const dataRecebimento = $('#dataVencimentoPrazo').val() || vendaPrazoInfo?.primeiro_vencimento;
        const qtdParcelas = Number($('#parcelasPrazo').val()) || vendaPrazoInfo?.parcelas || 1;
        dados.parcelas = qtdParcelas;
        dados.primeiro_vencimento = dataRecebimento;
    }

    const distribuicao = await precalcularDistribuicaoFiscalVenda(dados.itens, emitirFiscal);

    if (!distribuicao.sucesso) {
        showNotification(distribuicao.error || 'Erro ao calcular distribuição fiscal.', 'danger');
        return;
    }

    const valoresDistribuidos = aplicarDescontoProporcionalDistribuicao(distribuicao, subtotal, desconto);
    let totalFiscal = Number(valoresDistribuidos.valor_fiscal || 0);
    let totalNaoFiscal = Number(valoresDistribuidos.valor_nao_fiscal || 0);

    vendaEmProcessamento = true;

    dados.valor_fiscal = totalFiscal;
    dados.valor_nao_fiscal = totalNaoFiscal;

    const deveEmitirFiscal = emitirFiscal && totalFiscal > 0;
    dados.emitir_fiscal = deveEmitirFiscal;
    dados.cpf_cnpj_nota = deveEmitirFiscal ? cpfCnpjNota : null;

    if (emitirFiscal && totalFiscal === 0 && totalNaoFiscal > 0) {
        showNotification('Venda sem itens fiscais. NFC-e não será emitida.', 'info');
    }

    const ehPagamentoMisto =
        Array.isArray(pagamentosMistos) &&
        pagamentosMistos.length > 0;

    if (totalFiscal === 0 && totalNaoFiscal > 0 && !ehPagamentoMisto) {
        dados.pagamentos = dados.pagamentos.map((pagamento) => ({
            ...pagamento,
            valor: totalNaoFiscal,
            tipo_recebimento: 'nao_fiscal'
        }));
    }

    const formaPagamentoNormalizada = normalizarFormaPagamentoTEF(formaPagamento);

    console.log('DISTRIBUICAO FISCAL PDV:', {
        totalFiscal,
        totalNaoFiscal,
        total,
        itens: distribuicao.itens
    });

    console.log('VERIFICANDO TEF:', {
        formaPagamento,
        formaPagamentoNormalizada,
        ehPagamentoMisto,
        pagamentosMistos
    });

    try {
        const modoConfirmacaoFiscal = await obterModoConfirmacaoFiscal();
        const tefHabilitado = await obterTefHabilitadoConfig();

        const fluxoResolvido = TefFluxoPagamento.resolverFluxoPagamentoFiscal({
            modoConfirmacaoFiscal,
            tefHabilitado,
            formaPagamento: formaPagamentoNormalizada,
            ehPagamentoMisto,
            pagamentosMistos,
            totalFiscal
        });

        const {
            deveUsarTefAutomatico,
            usarConfirmacaoManual,
            pagamentoExigeTef
        } = fluxoResolvido;

        console.log('FLUXO PAGAMENTO FISCAL:', {
            modoConfirmacaoFiscal,
            tefHabilitado,
            pagamentoExigeTef,
            deveUsarTefAutomatico,
            usarConfirmacaoManual
        });

        if (deveUsarTefAutomatico && totalFiscal > 0) {
            const resultadoProcessamento = await processarVendaFiscalNaoFiscal(dados, totalFiscal);

            if (!resultadoProcessamento.sucesso) {
                vendaEmProcessamento = false;
                showNotification(resultadoProcessamento.erro || 'Erro no pagamento fiscal.', 'danger');
                return;
            }

            const formaFiscal = obterFormaPagamentoFiscal();
            const tefFiscal = resultadoProcessamento.tefFiscal;

            dados.tef = montarObjetoTEF(tefFiscal);
            dados.pagamentos = [
                {
                    forma_pagamento: formaPagamentoGravacaoFiscalPDV(formaFiscal),
                    valor: totalFiscal,
                    tipo_recebimento: 'fiscal',
                    tef_transacao_id: tefFiscal.transacao_id,
                    nsu: tefFiscal.nsu,
                    autorizacao: tefFiscal.autorizacao
                }
            ];

            if (deveEnviarPagamentosProcessadosPdv(totalFiscal, totalNaoFiscal)) {
                dados.pagamentos_processados_pdv = true;
            }
        } else if (deveUsarTefAutomatico && ehPagamentoMisto) {
            const pagamentosComTEF = await processarPagamentosMistosTEF(pagamentosMistos);
            dados.pagamentos = pagamentosComTEF;
        } else if (deveUsarTefAutomatico) {
            if (totalNaoFiscal > 0) {
                const pagamentoNaoFiscal = await new Promise((resolve, reject) => {
                    abrirModalPagamentoNaoFiscal(
                        totalNaoFiscal,
                        resolve,
                        () => reject(new Error('Pagamento não fiscal cancelado.'))
                    );
                });

                dados.pagamentos = [
                    {
                        forma_pagamento: pagamentoNaoFiscal.forma_pagamento,
                        valor: totalNaoFiscal,
                        tipo_recebimento: 'nao_fiscal'
                    }
                ];
            } else {
                const parcelasTef = formaPagamentoNormalizada.includes('credito')
                    ? (Number($('#parcelasCartao').val()) || 1)
                    : 1;

                const retornoTef = await processarPagamentoTEF(
                    formaPagamentoNormalizada,
                    total,
                    parcelasTef
                );

                if (!retornoTef || !(retornoTef.aprovado || retornoTef.sucesso || retornoTef.status === 'aprovado')) {
                    vendaEmProcessamento = false;
                    showNotification('Venda cancelada: pagamento TEF não aprovado.', 'warning');
                    return;
                }

                const tef = montarObjetoTEF(retornoTef);

                dados.tef = tef;

                dados.pagamentos = [
                    {
                        forma_pagamento: formaPagamentoGravacaoFiscalPDV(formaPagamentoNormalizada),
                        valor: total,
                        tipo_recebimento: 'fiscal',
                        tef_transacao_id: retornoTef.transacao_id,
                        tef,
                        nsu: retornoTef.nsu,
                        autorizacao: retornoTef.autorizacao,
                        bandeira: retornoTef.bandeira,
                        adquirente: retornoTef.adquirente
                    }
                ];

                if (deveEnviarPagamentosProcessadosPdv(totalFiscal, totalNaoFiscal)) {
                    dados.pagamentos_processados_pdv = true;
                }
            }
        } else if (usarConfirmacaoManual) {
            const resultadoManual = await processarVendaFiscalManual(dados, totalFiscal);

            if (!resultadoManual.sucesso) {
                vendaEmProcessamento = false;
                showNotification(resultadoManual.erro || 'Confirmação fiscal cancelada.', 'danger');
                return;
            }

            if (ehPagamentoMisto) {
                dados.pagamentos = normalizarPagamentosSemTef(pagamentosMistos);
                dados.forma_pagamento = 'misto';
            } else if (totalNaoFiscal > 0) {
                const formaFiscal = obterFormaPagamentoFiscal();
                dados.pagamentos = [
                    {
                        forma_pagamento: formaFiscal,
                        valor: totalFiscal,
                        tipo_recebimento: 'fiscal'
                    }
                ];
            } else {
                dados.pagamentos = [
                    {
                        forma_pagamento: formaPagamentoNormalizada,
                        valor: totalFiscal,
                        tipo_recebimento: 'fiscal'
                    }
                ];
            }

            if (deveEnviarPagamentosProcessadosPdv(totalFiscal, totalNaoFiscal)) {
                dados.pagamentos_processados_pdv = true;
            }
            dados.confirmacao_fiscal_manual = true;
        }
    } catch (error) {
        vendaEmProcessamento = false;
        console.error('Erro no TEF misto:', error);
        showNotification(error.message || 'Venda cancelada: falha no TEF.', 'danger');
        return;
    }

    const itensParaCupom = dados.itens.map(item => {
        const produto = produtosDisponiveis.find(p => Number(p.id) === Number(item.produto_id));
        return {
            ...item,
            produto_nome: produto ? produto.nome : 'Produto',
            tipo_venda: normalizarTipoVendaItem(item)
        };
    });

    function enviarVenda(payload) {
        payload = getTerminalRequestData(payload);

        $.ajax({
            url: `${API_URL}/vendas`,
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify(payload),
            success: function(response) {
                const vendaId = response.venda_id || response.id || response.vendaId || response.venda?.id;
                const statusPagamento = response.status_pagamento;

                if (!vendaId) {
                    vendaEmProcessamento = false;
                    console.error('Resposta da venda sem ID:', response);
                    showNotification('Venda finalizada, mas não foi possível localizar o ID da venda.', 'danger');
                    return;
                }

                if (statusPagamento === 'aguardando_nao_fiscal') {
                    if (Number(dados.valor_fiscal || 0) > 0) {
                        iniciarFluxoPosVendaComNaoFiscal(vendaId, {
                            emitirFiscal: Boolean(dados.emitir_fiscal)
                        });
                        return;
                    }

                    vendaEmProcessamento = false;
                    pagamentoFiscalAtual = null;
                    imprimirCupomNaoFiscal(vendaId, {
                        ...payload,
                        itens: itensParaCupom
                    }, total, desconto);
                    finalizarPosVenda();
                    showNotification('Venda não fiscal finalizada com sucesso.', 'success');
                    return;
                }

                vendaEmProcessamento = false;
                pagamentoFiscalAtual = null;

                const vendaQuitadaCompletamente = !vendaPrazoInfo && statusPagamento === 'quitada';

                if (vendaQuitadaCompletamente && dados.emitir_fiscal) {
                    processarFiscalPosPagamentoPosVenda(vendaId, response);
                } else if (vendaQuitadaCompletamente || vendaPrazoInfo) {
                    imprimirCupomNaoFiscal(vendaId, {
                        ...payload,
                        itens: itensParaCupom
                    }, total, desconto);
                }

                finalizarPosVenda();
                showNotification('Venda finalizada com sucesso.', 'success');
            },
            error: function(xhr) {
                vendaEmProcessamento = false;

                if (xhr.status === 409 && xhr.responseJSON?.pode_continuar) {
                    const aviso = xhr.responseJSON.aviso || 'Cliente possui débitos em aberto.';
                    const totalEmAberto = Number(xhr.responseJSON.total_em_aberto || 0);
                    const parcelasVencidas = Number(xhr.responseJSON.parcelas_vencidas || 0);

                    mostrarModalAvisoDebitoCliente(aviso, totalEmAberto, parcelasVencidas, function() {
                        payload.forcar = true;
                        enviarVenda(payload);
                    });
                    return;
                }

                showNotification(xhr.responseJSON?.error || 'Erro ao finalizar a venda.', 'danger');
            }
        });
    }

    enviarVenda(dados);
}

function finalizarPosVenda() {
    carrinho = [];
    formaPagamentoSelecionada = null;
    clienteSelecionado = null;
    vendaPrazoInfo = null;
    pagamentosMistos = [];
    supervisorAuthToken = null;
    pdvEmitirFiscalNaVenda = null;
    $('#descontoPdv').val(0);
    $('#formaPagamentoPdv').val('');
    $('#valorRecebidoPDV').val('');
    $('#trocoPDV').text('R$ 0,00');
    aoAlterarFormaPagamento();
    removerClienteSelecionado();
    atualizarCarrinho();
    focarCampoCodigo();

    $.ajax({
        url: urlProdutosPdv(),
        method: 'GET',
        cache: false,
        success: function(produtos) {
            produtosDisponiveis = normalizarProdutoPdvLista(produtos);
        }
    });

    if (typeof loadVendas === 'function' && typeof currentPage !== 'undefined' && currentPage === 'vendas') {
        loadVendas();
    }
}

async function cancelarVendaAtual() {
    if (carrinho.length === 0) {
        showNotification('Não há venda em andamento para cancelar.', 'info');
        return;
    }

    if (!window.confirm('Tem certeza que deseja cancelar esta venda?')) return;

    // Cancelar pagamento fiscal se existir
    if (pagamentoFiscalAtual && pagamentoFiscalAtual.transacao_id) {
        try {
            await fetch(`${API_URL}/tef/cancelar`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${localStorage.getItem('token') || ''}`
                },
                body: JSON.stringify({
                    transacao_id: pagamentoFiscalAtual.transacao_id,
                    motivo: 'Cancelamento operador'
                })
            });
            console.log('Pagamento fiscal cancelado pelo operador');
        } catch (cancelError) {
            console.error('Erro ao cancelar pagamento fiscal:', cancelError);
        }
        pagamentoFiscalAtual = null;
    }

    carrinho = [];
    formaPagamentoSelecionada = null;
    clienteSelecionado = null;
    vendaPrazoInfo = null;
    $('#descontoPdv').val(0);
    $('#formaPagamentoPdv').val('');
    $('#valorRecebidoPDV').val('');
    $('#trocoPDV').text('R$ 0,00');
    aoAlterarFormaPagamento();
    removerClienteSelecionado();
    atualizarCarrinho();
    focarCampoCodigo();
    showNotification('Venda cancelada.', 'info');
}

function emitirNFCeVenda(vendaId) {
    if (!vendaId) {
        console.error('emitirNFCeVenda chamado sem vendaId');
        limparModaisTravados();
        showNotification('Erro: ID da venda não encontrado para emitir NFC-e.', 'danger');
        return;
    }

    $.ajax({
        url: `${API_URL}/fiscal/emitir/venda/${vendaId}`,
        method: 'POST',
        timeout: 180000,

        success: function(response) {
            console.log('Retorno NFC-e:', response);

            const modalProcessando = document.getElementById('processandoNFCeModal');
            if (modalProcessando) {
                const instancia = bootstrap.Modal.getInstance(modalProcessando);
                if (document.activeElement) {
                    document.activeElement.blur();
                }
                if (instancia) instancia.hide();
                modalProcessando.remove();
            }

            limparModaisTravados();

            if (response?.status === 'sem_itens_fiscais') {
                showNotification(
                    response.message || 'Venda sem itens fiscais. NFC-e não necessária.',
                    'info'
                );
                return;
            }

            if (!fiscalAutorizadaParaImpressao(response)) {
                const mensagem = response?.message || 'NFC-e não autorizada pela SEFAZ.';
                showNotification(mensagem, 'danger');
                mostrarModalErroNFCe(vendaId, mensagem);
                return;
            }

            showNotification('NFC-e autorizada pela SEFAZ!', 'success');
            imprimirDANFEFiscal(vendaId);
        },

        error: function(xhr) {
            console.error('Erro ao emitir NFC-e:', xhr);

            const modalProcessando = document.getElementById('processandoNFCeModal');
            if (modalProcessando) {
                const instancia = bootstrap.Modal.getInstance(modalProcessando);
                if (document.activeElement) {
                    document.activeElement.blur();
                }
                if (instancia) instancia.hide();
                modalProcessando.remove();
            }

            limparModaisTravados();

            const mensagem =
                xhr.responseJSON?.erro ||
                xhr.responseJSON?.error ||
                xhr.responseJSON?.message ||
                xhr.responseText ||
                'NFC-e não autorizada pela SEFAZ.';

            showNotification(mensagem, 'danger');
            mostrarModalErroNFCe(vendaId, mensagem);
        }
    });
}

function mostrarModalErroNFCe(vendaId, mensagem) {
    $('#modal-container').html(`
        <div class="modal fade" id="erroNFCeModal" tabindex="-1">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content border-0 shadow">
                    <div class="modal-header bg-danger text-white">
                        <h5 class="modal-title">
                            <i class="fas fa-triangle-exclamation me-2"></i>
                            NFC-e não autorizada
                        </h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>

                    <div class="modal-body text-center">
                        <p>
                            A venda <strong>#${vendaId}</strong> foi finalizada, mas a NFC-e não foi autorizada.
                        </p>

                        <div class="alert alert-danger text-start">
                            ${escapeHtml(mensagem)}
                        </div>

                        <div class="d-grid gap-2">
                            <button class="btn btn-warning" onclick="emitirNFCeVenda(${vendaId})">
                                <i class="fas fa-rotate-right me-2"></i>
                                Tentar emitir novamente
                            </button>

                            <button class="btn btn-outline-secondary" onclick="fecharModalErroNFCe()">
                                Fechar
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `);

    const modalEl = document.getElementById('erroNFCeModal');
    const modal = new bootstrap.Modal(modalEl);
    modal.show();
}

function mostrarModalImpressaoFiscal(vendaId, fiscalResponse = {}) {
    const chaveAcesso =
        fiscalResponse.chave_acesso ||
        fiscalResponse.chaveAcesso ||
        fiscalResponse.chave ||
        '';

    const protocolo =
        fiscalResponse.protocolo ||
        fiscalResponse.nProt ||
        fiscalResponse.numero_protocolo ||
        '';

    $('#modal-container').html(`
        <div class="modal fade" id="impressaoFiscalModal" tabindex="-1">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content border-0 shadow">
                    <div class="modal-header bg-success text-white">
                        <h5 class="modal-title">
                            <i class="fas fa-check-circle me-2"></i>
                            NFC-e Emitida
                        </h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>

                    <div class="modal-body text-center">
                        <p class="mb-2">
                            A NFC-e da venda <strong>#${vendaId}</strong> foi enviada para a SEFAZ.
                        </p>

                        ${chaveAcesso ? `
                            <p class="small mb-1">
                                <strong>Chave:</strong><br>
                                ${escapeHtml(chaveAcesso)}
                            </p>
                        ` : ''}

                        ${protocolo ? `
                            <p class="small mb-3">
                                <strong>Protocolo:</strong><br>
                                ${escapeHtml(protocolo)}
                            </p>
                        ` : ''}

                        <div class="d-grid gap-2">
                            <button class="btn btn-success btn-lg" onclick="imprimirDANFEFiscal(${vendaId})">
                                <i class="fas fa-print me-2"></i>
                                Imprimir Cupom Fiscal
                            </button>

                            <button class="btn btn-sm btn-secondary" onclick="verResumoVendaFiscalTEF(${vendaId})">
                                Resumo
                            </button>

                            <button class="btn btn-outline-secondary" data-bs-dismiss="modal">
                                Fechar
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `);

    const modalEl = document.getElementById('impressaoFiscalModal');
    const modal = new bootstrap.Modal(modalEl);
    modal.show();
}

async function mostrarModalProcessandoNFCe(vendaId) {
    // Limpar modais anteriores
    $('#modal-container').empty();
    
    // Remover qualquer backdrop existente
    $('.modal-backdrop').remove();
    $('body').removeClass('modal-open').css('overflow', '').css('padding-right', '');

    $('#modal-container').html(`
        <div class="modal fade" id="processandoNFCeModal" tabindex="-1" data-bs-backdrop="static" data-bs-keyboard="false">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content border-0 shadow">
                    <div class="modal-header bg-primary text-white">
                        <h5 class="modal-title">
                            <i class="fas fa-file-invoice me-2"></i>
                            Emitindo NFC-e
                        </h5>
                    </div>

                    <div class="modal-body text-center">
                        <div class="spinner-border text-primary mb-3" role="status" style="width: 3rem; height: 3rem;"></div>

                        <h5 class="mb-2">Venda #${vendaId}</h5>
                        
                        <p class="text-muted mb-2">
                            <strong>Enviando NFC-e para a SEFAZ...</strong>
                        </p>
                        
                        <div class="alert alert-info mt-3 mb-0">
                            <small>
                                <i class="fas fa-info-circle me-1"></i>
                                Este processo pode levar alguns segundos.<br>
                                Por favor, aguarde e não feche esta janela.
                            </small>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `);

    const modalEl = document.getElementById('processandoNFCeModal');
    const modal = new bootstrap.Modal(modalEl);
    
    // Forçar exibição do modal
    setTimeout(() => {
        modal.show();
    }, 100);
}

// Impressão fiscal/não fiscal: ver frontend/js/fiscalImpressao.js

function limparModaisTravados() {
    document.querySelectorAll('.modal-backdrop').forEach(backdrop => backdrop.remove());
    document.body.classList.remove('modal-open');
    document.body.style.removeProperty('overflow');
    document.body.style.removeProperty('padding-right');
}

function fecharModalErroNFCe() {
    const modalEl = document.getElementById('erroNFCeModal');

    if (modalEl) {
        const instancia = bootstrap.Modal.getInstance(modalEl);
        if (document.activeElement) {
                    document.activeElement.blur();
                }
                if (instancia) instancia.hide();
    }

    setTimeout(() => {
        limparModaisTravados();
    }, 300);
}

function abrirModalQuantidadeProduto(produto, callback, opcoes = {}) {
    $('#modalQuantidadeProduto').remove();

    const vendaPorUnidade = tipoVendaEhUnidade(opcoes.tipo_venda ?? opcoes.modo_venda);
    const unidade = String(produto.unidade || 'UN').toUpperCase();
    const fracionado = vendaPorUnidade ? false : permiteQuantidadeDecimal(produto);

    const modalHtml = `
        <div class="modal fade" id="modalQuantidadeProduto" tabindex="-1">
            <div class="modal-dialog modal-sm modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header py-2">
                        <h6 class="modal-title">Quantidade</h6>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>

                    <div class="modal-body">
                        <p class="mb-2 fw-bold">${produto.nome}</p>

                        <label class="form-label">
                            ${vendaPorUnidade ? 'Quantidade' : (fracionado ? `Quantidade em ${unidade}` : 'Quantidade')}
                        </label>

                        <input 
                            type="${fracionado ? 'text' : 'number'}"
                            class="form-control form-control-lg"
                            id="inputQuantidadeProduto"
                            min="${fracionado ? '0.01' : '1'}"
                            step="${fracionado ? '0.01' : '1'}"
                            inputmode="${fracionado ? 'decimal' : 'numeric'}"
                            value="${fracionado ? '' : '1'}"
                            placeholder="${vendaPorUnidade ? 'Ex: 5' : (fracionado ? 'Ex: 7,25' : 'Ex: 1')}"
                        >

                        <small class="text-muted">
                            ${vendaPorUnidade
                                ? 'Exemplo: 5 unidades'
                                : (fracionado ? `Digite a quantidade em ${unidade}` : 'Digite a quantidade vendida')}
                        </small>

                        ${vendaPorUnidade ? `
                        <div id="previewVendaUnidade" class="mt-3 p-2 bg-light rounded">
                            <div class="small text-muted mb-1">Estoque (KG):</div>
                            <div class="fw-semibold" id="previewVendaUnidadeKg">—</div>
                            <div class="small text-muted mt-2 mb-1">Valor da venda:</div>
                            <div class="fw-semibold text-success" id="previewVendaUnidadeValor">—</div>
                        </div>
                        ` : ''}
                    </div>

                    <div class="modal-footer py-2">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">
                            Cancelar
                        </button>
                        <button type="button" class="btn btn-primary" id="btnConfirmarQuantidadeProduto">
                            Confirmar
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    $('body').append(modalHtml);

    const modalEl = document.getElementById('modalQuantidadeProduto');
    const modal = new bootstrap.Modal(modalEl);

    modal.show();

    modalEl.addEventListener('shown.bs.modal', function () {
        const input = document.getElementById('inputQuantidadeProduto');
        input.focus();
        input.select();
        if (vendaPorUnidade) {
            atualizarPreviewVendaUnidadeModal(produto);
        }
    });

    if (vendaPorUnidade) {
        $('#inputQuantidadeProduto').off('input').on('input', function () {
            atualizarPreviewVendaUnidadeModal(produto);
        });
    }

    $('#btnConfirmarQuantidadeProduto').off('click').on('click', function () {
        confirmarQuantidadeProduto(produto, callback, modal, opcoes);
    });

    $('#inputQuantidadeProduto').off('keydown').on('keydown', function (e) {
        if (e.key === 'Enter') {
            confirmarQuantidadeProduto(produto, callback, modal, opcoes);
        }
    });

    modalEl.addEventListener('hidden.bs.modal', function () {
        $('#modalQuantidadeProduto').remove();
    });
}

function confirmarQuantidadeProduto(produto, callback, modal, opcoes = {}) {
    const valor = $('#inputQuantidadeProduto').val();
    const tipoVenda = normalizarTipoVendaItem(opcoes);
    const quantidade = tipoVendaEhUnidade(tipoVenda)
        ? Math.max(0, Math.round(Number(parseQuantidadePdv(valor) || 0)))
        : normalizarQuantidadePdv(parseQuantidadePdv(valor), produto);

    if (!quantidade || quantidade <= 0) {
        showNotification('Informe uma quantidade válida.', 'warning');
        $('#inputQuantidadeProduto').focus();
        return;
    }

    const quantidadeEstoque = obterQuantidadeEstoqueParaVenda(produto, quantidade, tipoVenda);
    if (tipoVendaEhUnidade(tipoVenda) && quantidadeEstoque <= 0) {
        showNotification('Peso médio da unidade não configurado para este produto.', 'warning');
        $('#inputQuantidadeProduto').focus();
        return;
    }

    if (!pdvNotificarEstoqueInsuficiente(produto, quantidadeEstoque)) {
        $('#inputQuantidadeProduto').focus();
        return;
    }

    if (document.activeElement) {
        document.activeElement.blur();
    }

    modal.hide();

    if (typeof callback === 'function') {
        callback(quantidade);
    }

    $('#buscaProdutoPdv').focus();
}

function abrirTelaPagamento() {
    const totalVenda = obterTotalVendaPDV();

    $('#modal-container').html(`
        <div class="modal fade" id="modalPagamentoPDV" tabindex="-1">
            <div class="modal-dialog modal-dialog-centered modal-xl">
                <div class="modal-content border-0 shadow-lg"
                    style="
                        border-radius: 24px;
                        overflow: hidden;
                        background: #f5f7fb;
                    ">
                    <div class="modal-body p-0">
                        <div class="row g-0">
                            <div class="col-md-4 bg-primary text-white d-flex flex-column justify-content-center align-items-center p-5">
                                <small class="opacity-75 mb-2">
                                    TOTAL DA VENDA
                                </small>
                                <h1 style="
                                    font-size: 4rem;
                                    font-weight: 700;
                                ">
                                    R$ ${totalVenda.toFixed(2).replace('.', ',')}
                                </h1>
                                <div class="mt-4 opacity-75 text-center">
                                    Escolha a forma de pagamento
                                </div>
                            </div>
                            <div class="col-md-8 p-5">
                                <div class="row g-4">
                                    <div class="col-md-6">
                                        <button class="btnPagamentoPDV btn btn-light w-100"
                                            onclick="selecionarPagamentoPDV('dinheiro')">
                                            <div class="atalho">
                                                1
                                            </div>
                                            <div class="titulo">
                                                Dinheiro
                                            </div>
                                        </button>
                                    </div>
                                    <div class="col-md-6">
                                        <button class="btnPagamentoPDV btn btn-light w-100"
                                            onclick="selecionarPagamentoPDV('pix')">
                                            <div class="atalho">
                                                2
                                            </div>
                                            <div class="titulo">
                                                Pix
                                            </div>
                                        </button>
                                    </div>
                                    <div class="col-md-6">
                                        <button class="btnPagamentoPDV btn btn-light w-100"
                                            onclick="selecionarPagamentoPDV('cartao_debito')">
                                            <div class="atalho">
                                                3
                                            </div>
                                            <div class="titulo">
                                                Débito
                                            </div>
                                        </button>
                                    </div>
                                    <div class="col-md-6">
                                        <button class="btnPagamentoPDV btn btn-light w-100"
                                            onclick="selecionarPagamentoPDV('cartao_credito')">
                                            <div class="atalho">
                                                4
                                            </div>
                                            <div class="titulo">
                                                Crédito
                                            </div>
                                        </button>
                                    </div>
                                    <div class="col-md-6">
                                        <button class="btnPagamentoPDV btn btn-warning w-100"
                                            onclick="abrirPagamentoMisto()">
                                            <div class="atalho">
                                                5
                                            </div>
                                            <div class="titulo">
                                                Pagamento Misto
                                            </div>
                                        </button>
                                    </div>
                                    <div class="col-md-6">
                                        <button class="btnPagamentoPDV btn btn-light w-100"
                                            onclick="selecionarPagamentoPDV('prazo')">
                                            <div class="atalho">
                                                6
                                            </div>
                                            <div class="titulo">
                                                A Prazo
                                            </div>
                                        </button>
                                    </div>
                                    <div class="col-md-6">
                                        <button class="btnPagamentoPDV btn btn-outline-danger w-100"
                                            data-bs-dismiss="modal">
                                            <div class="atalho">
                                                ESC
                                            </div>
                                            <div class="titulo">
                                                Cancelar
                                            </div>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `);

    const modal = new bootstrap.Modal(
        document.getElementById('modalPagamentoPDV')
    );

    modal.show();

    $(document).off('keydown.pagamentoPDV');

    $(document).on('keydown.pagamentoPDV', function(e) {
        const modalAberto = $('#modalPagamentoPDV').hasClass('show');

        if (!modalAberto) {
            return;
        }

        if (
            $('input:focus, textarea:focus, select:focus').length > 0
        ) {
            return;
        }

        switch (e.key) {
            case '1':
                e.preventDefault();
                selecionarPagamentoPDV('dinheiro');
                break;

            case '2':
                e.preventDefault();
                selecionarPagamentoPDV('pix');
                break;

            case '3':
                e.preventDefault();
                selecionarPagamentoPDV('cartao_debito');
                break;

            case '4':
                e.preventDefault();
                selecionarPagamentoPDV('cartao_credito');
                break;

            case '5':
                e.preventDefault();
                abrirPagamentoMisto();
                break;

            case '6':
                e.preventDefault();
                selecionarPagamentoPDV('prazo');
                break;

            case 'Escape':
                e.preventDefault();
                if (document.activeElement) {
                    document.activeElement.blur();
                }
                $('#modalPagamentoPDV').modal('hide');
                break;
        }
    });
}

function selecionarPagamentoPDV(forma) {
    $(document).off('keydown.pagamentoPDV');

    pagamentosMistos = [];
    formaPagamentoSelecionadaPDV = forma;

    const modalEl = document.getElementById('modalPagamentoPDV');
    const modal = bootstrap.Modal.getInstance(modalEl);

    if (document.activeElement) {
        document.activeElement.blur();
    }

    if (modal) {
        modal.hide();
    }

    if (forma === 'dinheiro') {
        mostrarModalTroco();
    } else if (forma === 'pix') {
        setTimeout(async () => {
            const tefOn = await obterTefHabilitadoConfig();
            if (tefOn) {
                mostrarModalDecisaoFiscal();
                return;
            }

            const ativo = await pixAutomaticoHabilitado();
            if (ativo) {
                iniciarPixAutomaticoPDV();
            } else {
                mostrarModalDecisaoFiscal();
            }
        }, 300);
    } else if (forma === 'prazo') {
        mostrarModalClientePrazo();
    } else {
        setTimeout(() => {
            mostrarModalDecisaoFiscal();
        }, 300);
    }
}

let intervaloConsultaPixPDV = null;
let pixAutomaticoAtivoCache = null;

async function pixAutomaticoHabilitado() {
    if (pixAutomaticoAtivoCache !== null) {
        return pixAutomaticoAtivoCache;
    }

    try {
        const resp = await fetch(`${API_URL}/pix/config`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        const data = await resp.json();
        pixAutomaticoAtivoCache = !!(data.success && data.config?.ativo);
        return pixAutomaticoAtivoCache;
    } catch (err) {
        console.error('Erro ao verificar Pix automático:', err);
        pixAutomaticoAtivoCache = false;
        return false;
    }
}

async function iniciarPixAutomaticoPDV(valorPix, opcoes = {}) {
    const ativo = await pixAutomaticoHabilitado();

    if (!ativo) {
        if (typeof opcoes.onPago === 'function') {
            opcoes.onPago();
        } else {
            setTimeout(() => mostrarModalDecisaoFiscal(), 300);
        }
        return;
    }

    const totalVenda = valorPix != null && Number(valorPix) > 0
        ? Math.round(Number(valorPix) * 100) / 100
        : obterTotalVendaPDV();

    if (totalVenda <= 0) {
        showNotification('O valor do Pix deve ser maior que zero.', 'warning');
        return;
    }

    try {
        showNotification('Gerando cobrança Pix...', 'info');

        const resp = await fetch(`${API_URL}/pix/criar-cobranca`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({
                valor: totalVenda,
                descricao: opcoes.modoMisto ? 'Venda PDV - Pagamento misto' : 'Venda PDV'
            })
        });

        const data = await resp.json();

        if (!resp.ok || !data.success) {
            throw new Error(data.error || 'Erro ao gerar Pix.');
        }

        mostrarModalAguardandoPixPDV(data.cobranca, totalVenda, opcoes);
        consultarPixAteConfirmarPDV(data.cobranca.txid, opcoes);

    } catch (err) {
        console.error('Erro Pix automático:', err);
        showNotification(err.message || 'Erro ao gerar Pix.', 'danger');
    }
}

function mostrarModalAguardandoPixPDV(cobranca, totalVenda, opcoes = {}) {
    const qrImg = cobranca.qrCodeBase64
        ? `<img src="data:image/png;base64,${cobranca.qrCodeBase64}" alt="QR Code Pix" style="width:320px;height:320px;max-width:100%;display:block;">`
        : `<div class="alert alert-warning py-2 mb-0 small">QR Code não retornado. Use o Pix Copia e Cola.</div>`;

    $('#modal-container').html(`
        <div class="modal fade" id="modalPixAutomaticoPDV" tabindex="-1" data-bs-backdrop="static">
            <div class="modal-dialog modal-dialog-centered" style="max-width:380px;">
                <div class="modal-content border-0 shadow" style="border-radius:12px;overflow:hidden;">
                    <div class="modal-header text-white py-2 px-3" style="background:#0f766e;">
                        <div>
                            <h6 class="modal-title mb-0 fw-bold">Pagamento Pix Automático</h6>
                            <small class="opacity-75" style="font-size:0.75rem;">Aguardando confirmação bancária</small>
                        </div>
                    </div>

                    <div class="modal-body p-3 text-center">
                        <small class="text-muted">${opcoes.modoMisto ? 'Valor restante em Pix' : 'Total da venda'}</small>
                        <div class="mb-2" style="color:#0f766e;font-weight:700;font-size:1.5rem;">
                            R$ ${Number(totalVenda).toFixed(2).replace('.', ',')}
                        </div>
                        ${opcoes.modoMisto ? '<p class="text-muted small mb-2">Dinheiro já informado. Pague o restante via Pix.</p>' : ''}

                        <div class="bg-white border rounded p-1 d-inline-block mb-2">
                            ${qrImg}
                        </div>

                        <div class="alert alert-info py-1 px-2 mb-2 small">
                            <strong>Status:</strong>
                            <span id="statusPixPDV">Aguardando pagamento...</span>
                        </div>

                        <label class="form-label fw-bold small mb-1">Pix Copia e Cola</label>
                        <textarea id="pixCopiaColaPDV" class="form-control form-control-sm" rows="2" readonly style="font-size:0.7rem;">${cobranca.copiaCola || ''}</textarea>

                        <div class="d-grid gap-1 mt-2">
                            <button class="btn btn-outline-primary btn-sm" onclick="copiarPixCopiaColaPDV()">
                                Copiar Pix Copia e Cola
                            </button>
                            <button class="btn btn-outline-danger btn-sm" onclick="cancelarAguardandoPixPDV()">
                                Cancelar
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `);

    const modal = new bootstrap.Modal(document.getElementById('modalPixAutomaticoPDV'));
    modal.show();
}

function consultarPixAteConfirmarPDV(txid, opcoes = {}) {
    if (intervaloConsultaPixPDV) {
        clearInterval(intervaloConsultaPixPDV);
    }

    intervaloConsultaPixPDV = setInterval(async () => {
        try {
            const resp = await fetch(`${API_URL}/pix/status/${encodeURIComponent(txid)}`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            });
            const data = await resp.json();

            if (!resp.ok || !data.success) {
                throw new Error(data.error || 'Erro ao consultar Pix.');
            }

            const status = data.status.status;

            $('#statusPixPDV').text(status);

            if (status === 'PAGO') {
                clearInterval(intervaloConsultaPixPDV);
                intervaloConsultaPixPDV = null;

                $('#statusPixPDV').text('Pix confirmado!');

                setTimeout(() => {
                    const modalEl = document.getElementById('modalPixAutomaticoPDV');
                    const modal = bootstrap.Modal.getInstance(modalEl);

                    if (modal) modal.hide();

                    if (typeof opcoes.onPago === 'function') {
                        opcoes.onPago();
                    } else {
                        formaPagamentoSelecionadaPDV = 'pix';
                        setTimeout(() => {
                            mostrarModalDecisaoFiscal();
                        }, 300);
                    }
                }, 800);
            }

            if (['EXPIRADO', 'CANCELADO', 'ERRO'].includes(status)) {
                clearInterval(intervaloConsultaPixPDV);
                intervaloConsultaPixPDV = null;
                showNotification(`Pix ${status}. Gere uma nova cobrança.`, 'danger');
            }

        } catch (err) {
            console.error('Erro ao consultar Pix:', err);
        }
    }, 3000);
}

function copiarPixCopiaColaPDV() {
    const texto = $('#pixCopiaColaPDV').val();

    navigator.clipboard.writeText(texto)
        .then(() => showNotification('Pix Copia e Cola copiado.', 'success'))
        .catch(() => {
            $('#pixCopiaColaPDV').select();
            document.execCommand('copy');
            showNotification('Pix Copia e Cola copiado.', 'success');
        });
}

function cancelarAguardandoPixPDV() {
    if (intervaloConsultaPixPDV) {
        clearInterval(intervaloConsultaPixPDV);
        intervaloConsultaPixPDV = null;
    }

    const modalEl = document.getElementById('modalPixAutomaticoPDV');
    const modal = bootstrap.Modal.getInstance(modalEl);

    if (modal) {
        modal.hide();
    }

    showNotification('Pagamento Pix cancelado no PDV.', 'warning');
}

function mostrarModalClientePrazo() {
    const totalVenda = obterTotalVendaPDV();

    const hoje = new Date();
    const primeiroVencimento = new Date(hoje.getFullYear(), hoje.getMonth() + 1, hoje.getDate());

    $('#modal-container').html(`
        <div class="modal fade" id="clientePrazoModal" tabindex="-1">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content border-0 shadow-lg" style="border-radius: 18px; overflow: hidden;">
                    <div class="modal-header bg-primary text-white">
                        <h5 class="modal-title">Pagamento a Prazo</h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>

                    <div class="modal-body p-4">
                        <div class="text-center mb-4">
                            <h4 class="mb-2">Total da Venda</h4>
                            <h2 style="color: #0d6efd; font-weight: 700;">
                                R$ ${totalVenda.toFixed(2).replace('.', ',')}
                            </h2>
                        </div>

                        <div class="mb-3">
                            <label for="cliente-prazo-busca" class="form-label fw-bold">Cliente *</label>
                            <input type="text" class="form-control form-control-lg" id="cliente-prazo-busca" placeholder="Digite o nome do cliente">
                            <input type="hidden" id="cliente-prazo-id">
                            <div id="cliente-prazo-sugestoes" class="list-group position-absolute w-100" style="z-index: 9999; display:none; max-height: 200px; overflow-y: auto;"></div>
                        </div>

                        <div class="mb-3">
                            <label for="parcelas-prazo" class="form-label fw-bold">Quantidade de Parcelas *</label>
                            <input type="number" min="1" max="24" class="form-control form-control-lg" id="parcelas-prazo" value="1">
                        </div>

                        <div class="mb-3">
                            <label for="primeiro-vencimento-prazo" class="form-label fw-bold">Primeiro Vencimento *</label>
                            <input type="date" class="form-control form-control-lg" id="primeiro-vencimento-prazo" value="${primeiroVencimento.toISOString().split('T')[0]}">
                        </div>

                        <div class="d-grid gap-2 mt-4">
                            <button class="btn btn-primary btn-lg" onclick="confirmarPagamentoPrazo()">
                                Confirmar
                            </button>
                            <button class="btn btn-secondary" data-bs-dismiss="modal">
                                Cancelar
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `);

    const modal = new bootstrap.Modal(document.getElementById('clientePrazoModal'));
    modal.show();

    // Focar no input de cliente
    setTimeout(() => {
        $('#cliente-prazo-busca').focus();
    }, 500);

    // Busca de cliente
    $('#cliente-prazo-busca').off('input').on('input', function() {
        const termo = normalizarTexto($(this).val()).trim();
        if (termo.length < 2) {
            $('#cliente-prazo-sugestoes').empty().hide();
            $('#cliente-prazo-id').val('');
            return;
        }

        $.ajax({
            url: `${API_URL}/clientes`,
            method: 'GET',
            success: function(clientes) {
                const filtrados = (clientes || []).filter(c =>
                    normalizarTexto(c.nome).includes(termo) ||
                    String(c.cpf_cnpj || '').replace(/\D/g, '').includes(termo.replace(/\D/g, ''))
                );

                if (filtrados.length === 0) {
                    $('#cliente-prazo-sugestoes').html('<div class="list-group-item">Nenhum cliente encontrado</div>').show();
                    return;
                }

                $('#cliente-prazo-sugestoes').html(
                    filtrados.map(c => `
                        <button type="button" class="list-group-item list-group-item-action" data-id="${c.id}" data-nome="${escapeHtml(c.nome || '')}">
                            ${escapeHtml(c.nome || '')}${c.cpf_cnpj ? ' - ' + formatarCpfCnpj(c.cpf_cnpj) : ''}
                        </button>
                    `).join('')
                ).show();
            },
            error: function() {
                $('#cliente-prazo-sugestoes').empty().hide();
            }
        });
    });

    // Selecionar cliente da sugestão
    $(document).off('click.sugestaoCliente').on('click.sugestaoCliente', '#cliente-prazo-sugestoes button', function() {
        $('#cliente-prazo-id').val($(this).data('id'));
        $('#cliente-prazo-busca').val($(this).data('nome'));
        $('#cliente-prazo-sugestoes').empty().hide();
    });
}

function confirmarPagamentoPrazo() {
    const clienteId = parseInt($('#cliente-prazo-id').val(), 10);
    const parcelas = parseInt($('#parcelas-prazo').val(), 10) || 1;
    const primeiroVencimento = $('#primeiro-vencimento-prazo').val();

    if (!clienteId) {
        showNotification('Selecione o cliente da venda a prazo.', 'danger');
        return;
    }
    if (parcelas < 1) {
        showNotification('Quantidade de parcelas inválida.', 'danger');
        return;
    }
    if (!primeiroVencimento) {
        showNotification('Informe o primeiro vencimento.', 'danger');
        return;
    }

    vendaPrazoInfo = {
        cliente_id: clienteId,
        parcelas,
        primeiro_vencimento: primeiroVencimento,
        cliente_nome: $('#cliente-prazo-busca').val().trim()
    };

    // Fechar modal
    const modalEl = document.getElementById('clientePrazoModal');
    const modal = bootstrap.Modal.getInstance(modalEl);
    if (modal) {
        modal.hide();
    }

    // Continuar fluxo fiscal / não fiscal
    setTimeout(() => {
        mostrarModalDecisaoFiscal();
    }, 300);
}

function mostrarModalTroco() {
    const totalVenda = obterTotalVendaPDV();

    $('#modal-container').html(`
        <div class="modal fade" id="trocoModal" tabindex="-1">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content border-0 shadow-lg" style="border-radius: 18px; overflow: hidden;">
                    <div class="modal-header bg-success text-white">
                        <h5 class="modal-title">Pagamento em Dinheiro</h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>

                    <div class="modal-body p-4">
                        <div class="text-center mb-4">
                            <h4 class="mb-2">Total da Venda</h4>
                            <h2 style="color: #16a34a; font-weight: 700;">
                                R$ ${totalVenda.toFixed(2).replace('.', ',')}
                            </h2>
                        </div>

                        <div class="mb-3">
                            <label for="valorRecebido" class="form-label fw-bold">Valor Recebido</label>
                            <input type="number" step="0.01" class="form-control form-control-lg" id="valorRecebido" placeholder="Digite o valor recebido">
                        </div>

                        <div class="p-3 bg-light rounded border">
                            <div class="d-flex justify-content-between align-items-center">
                                <span class="fw-bold">Troco:</span>
                                <span id="trocoCalculado" style="font-size: 1.5rem; color: #16a34a; font-weight: 700;">R$ 0,00</span>
                            </div>
                        </div>

                        <div class="d-grid gap-2 mt-4">
                            <button class="btn btn-success btn-lg" onclick="confirmarTroco()">
                                Confirmar
                            </button>
                            <button class="btn btn-secondary" data-bs-dismiss="modal">
                                Cancelar
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `);

    const modal = new bootstrap.Modal(document.getElementById('trocoModal'));
    modal.show();

    // Focar no input
    setTimeout(() => {
        $('#valorRecebido').focus();
    }, 500);

    // Calcular troco ao digitar
    $('#valorRecebido').off('input').on('input', function() {
        const valorRecebido = Number(String($(this).val()).replace(',', '.')) || 0;
        const troco = valorRecebido - totalVenda;
        $('#trocoCalculado').text(`R$ ${Math.max(0, troco).toFixed(2).replace('.', ',')}`);
    });

    // Confirmar com Enter
    $('#valorRecebido').off('keydown').on('keydown', function(e) {
        if (e.key === 'Enter') {
            confirmarTroco();
        }
    });
}

function confirmarTroco() {
    const totalVenda = obterTotalVendaPDV();

    const valorRecebido = Number(String($('#valorRecebido').val()).replace(',', '.')) || 0;

    if (valorRecebido < totalVenda) {
        showNotification('Valor recebido deve ser maior ou igual ao total da venda.', 'warning');
        $('#valorRecebido').focus();
        return;
    }

    const modalEl = document.getElementById('trocoModal');
    const modal = bootstrap.Modal.getInstance(modalEl);

    if (document.activeElement) {
        document.activeElement.blur();
    }

    if (modal) {
        modal.hide();
    }

    setTimeout(() => {
        mostrarModalDecisaoFiscal();
    }, 300);
}

// =======================================================
// CONSULTA DE PRODUTOS NO PDV - F1
// =======================================================

function abrirConsultaProdutosPDV() {
    $('#modalConsultaProdutosPDV').remove();

    const modalHtml = `
        <div class="modal fade" id="modalConsultaProdutosPDV" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header bg-primary text-white">
                        <h5 class="modal-title">
                            <i class="fas fa-search"></i> Consulta de Produtos - F1
                        </h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>

                    <div class="modal-body">
                        <div class="alert alert-info py-2 mb-3">
                            Use esta tela apenas para consultar preço/estoque. Clique em <strong>Adicionar</strong> somente se quiser mandar o produto para o carrinho.
                        </div>

                        <div class="input-group mb-3">
                            <span class="input-group-text">
                                <i class="fas fa-barcode"></i>
                            </span>
                            <input
                                type="text"
                                id="inputConsultaProdutoPDV"
                                class="form-control form-control-lg"
                                placeholder="Buscar por nome, código, código de barras ou ID..."
                                autocomplete="off"
                            >
                            <button class="btn btn-primary" type="button" onclick="buscarProdutosConsultaPDV()">
                                Buscar
                            </button>
                        </div>

                        <div id="resultadoConsultaProdutosPDV">
                            <div class="text-muted text-center py-4">
                                Digite o nome, código ou ID do produto para consultar.
                            </div>
                        </div>
                    </div>

                    <div class="modal-footer">
                        <small class="text-muted me-auto">
                            ESC fecha a consulta. Enter busca o produto.
                        </small>
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">
                            Voltar ao PDV
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    $('body').append(modalHtml);

    const modalEl = document.getElementById('modalConsultaProdutosPDV');
    const modal = new bootstrap.Modal(modalEl);

    modal.show();

    modalEl.addEventListener('shown.bs.modal', function () {
        $('#inputConsultaProdutoPDV').trigger('focus');
        carregarCategoriasConsultaPDV();
    });

    $('#inputConsultaProdutoPDV').off('keydown').on('keydown', function (e) {
        if (e.key === 'Enter') {
            buscarProdutosConsultaPDV();
        }
    });

    modalEl.addEventListener('hidden.bs.modal', function () {
        $('#modalConsultaProdutosPDV').remove();
        focarCampoCodigo();
    });
}

function carregarCategoriasConsultaPDV() {
    $('#resultadoConsultaProdutosPDV').html(`
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
                $('#resultadoConsultaProdutosPDV').html(`
                    <div class="alert alert-warning">
                        Nenhuma categoria encontrada.
                    </div>
                `);
                return;
            }

            const html = categorias.map(cat => `
                <div class="card mb-2 categoria-card" data-categoria-id="${cat.id}">
                    <div class="card-header bg-light d-flex justify-content-between align-items-center" style="cursor: pointer;" onclick="toggleProdutosCategoria(${cat.id})">
                        <strong><i class="fas fa-folder me-2"></i>${escapeHtml(cat.nome)}</strong>
                        <i class="fas fa-chevron-down" id="chevron-${cat.id}"></i>
                    </div>
                    <div class="card-body p-0" id="produtos-categoria-${cat.id}" style="display: none;">
                        <div class="text-center py-3">
                            <div class="spinner-border spinner-border-sm text-primary"></div>
                        </div>
                    </div>
                </div>
            `).join('');

            $('#resultadoConsultaProdutosPDV').html(`
                <div class="alert alert-info py-2 mb-3">
                    <i class="fas fa-info-circle me-2"></i>
                    Clique em uma categoria para ver os produtos. Use a busca acima para pesquisar em todos os produtos.
                </div>
                ${html}
            `);
        },
        error: function() {
            $('#resultadoConsultaProdutosPDV').html(`
                <div class="alert alert-danger">
                    Erro ao carregar categorias.
                </div>
            `);
        }
    });
}

function toggleProdutosCategoria(categoriaId) {
    const container = $(`#produtos-categoria-${categoriaId}`);
    const chevron = $(`#chevron-${categoriaId}`);

    if (container.is(':visible')) {
        container.slideUp();
        chevron.removeClass('fa-chevron-up').addClass('fa-chevron-down');
    } else {
        // Se ainda não carregou os produtos, carregar
        if (container.find('.spinner-border').length > 0) {
            $.ajax({
                url: `${API_URL}/produtos`,
                method: 'GET',
                data: { categoria_id: categoriaId },
                success: function(produtos) {
                    if (!produtos || produtos.length === 0) {
                        container.html(`
                            <div class="p-3 text-muted">
                                Nenhum produto nesta categoria.
                            </div>
                        `);
                    } else {
                        const produtosHtml = produtos.map(p => `
                            <div class="p-2 border-bottom produto-item" data-produto-id="${p.id}">
                                <div class="d-flex justify-content-between align-items-center">
                                    <div>
                                        <strong>${escapeHtml(p.nome)}</strong>
                                        <small class="text-muted d-block">${p.codigo_barras || p.codigo || ''}</small>
                                    </div>
                                    <div class="text-end">
                                        <div class="fw-bold text-primary">${formatCurrency(p.preco_venda)}</div>
                                        <small class="text-muted">${pdvRotuloEstoque(p)}</small>
                                    </div>
                                </div>
                                <button class="btn btn-sm btn-primary mt-2 w-100" onclick="adicionarProdutoConsultaPDV(${p.id})">
                                    <i class="fas fa-plus"></i> Adicionar
                                </button>
                            </div>
                        `).join('');

                        container.html(produtosHtml);
                    }
                },
                error: function() {
                    container.html(`
                        <div class="p-3 text-danger">
                            Erro ao carregar produtos.
                        </div>
                    `);
                }
            });
        }

        container.slideDown();
        chevron.removeClass('fa-chevron-down').addClass('fa-chevron-up');
    }
}

function adicionarProdutoConsultaPDV(produtoId) {
    const produto = produtosDisponiveis.find(p => Number(p.id) === Number(produtoId));
    if (!produto) {
        showNotification('Produto não encontrado na lista do PDV. Atualize o PDV e tente novamente.', 'danger');
        return;
    }

    const qtdTeste = produtoPermiteEscolhaVendaUnidade(produto)
        ? obterQuantidadeEstoqueParaVenda(produto, 1, TIPO_VENDA_UNIDADE)
        : 1;
    const validacaoMinima = pdvValidarEstoqueVenda(produto, qtdTeste > 0 ? qtdTeste : 1);
    if (!validacaoMinima.sucesso) {
        showNotification(validacaoMinima.mensagem, 'warning');
        return;
    }

    buscarPromocaoAtivaProduto(produto.id).then(promocao => {
        iniciarFluxoAdicionarProdutoPdv(produto, promocao);
    });
}

function buscarProdutosConsultaPDV() {
    const termo = $('#inputConsultaProdutoPDV').val().trim();

    if (!termo) {
        carregarCategoriasConsultaPDV();
        return;
    }

    $('#resultadoConsultaProdutosPDV').html(`
        <div class="text-center py-4">
            <div class="spinner-border text-primary"></div>
            <div class="mt-2">Buscando produtos...</div>
        </div>
    `);

    $.ajax({
        url: `${API_URL}/produtos/consulta-pdv/buscar?q=${encodeURIComponent(termo)}&modo_fiscal=${typeof modoFiscalQueryParam === 'function' ? modoFiscalQueryParam() : '0'}`,
        method: 'GET',
        cache: false,
        success: function (produtos) {
            renderizarProdutosConsultaPDV(produtos || []);
        },
        error: function (xhr) {
            console.error('Erro na consulta de produtos:', xhr.responseJSON || xhr.responseText || xhr);

            const msg = xhr.responseJSON?.error || 'Erro ao consultar produtos.';

            $('#resultadoConsultaProdutosPDV').html(`
                <div class="alert alert-danger">
                    ${msg}
                </div>
            `);
        }
    });
}

function renderizarProdutosConsultaPDV(produtos) {
    if (!produtos.length) {
        $('#resultadoConsultaProdutosPDV').html(`
            <div class="alert alert-warning">
                Nenhum produto encontrado.
            </div>
        `);
        return;
    }

    const linhas = produtos.map(p => {
        const estoque = pdvEstoqueDisponivel(p);
        const preco = Number(p.preco_venda || 0);
        const precoCompra = Number(p.preco_compra || 0);
        const estoqueBaixo = estoque <= Number(p.estoque_minimo || 0);
        const semEstoque = !pdvValidarEstoqueVenda(p, 1).sucesso;
        const temPromocao = p.tem_promocao === 1 || p.tem_promocao === true;
        const precoPromocional = Number(p.preco_promocional || 0);
        const descontoPercentual = Number(p.desconto_percentual || 0);
        
        const precoExibido = temPromocao && precoPromocional > 0 ? precoPromocional : preco;
        const marcaPromocao = temPromocao ? `<span class="badge bg-danger ms-2"><i class="fas fa-tag"></i> -${descontoPercentual}%</span>` : '';
        const linhaDescontoPreco = temPromocao && precoPromocional > 0 
            ? `<del class="text-muted small">${formatCurrency(preco)}</del> ${formatCurrency(precoPromocional)}`
            : formatCurrency(preco);

        return `
            <tr ${temPromocao ? 'class="table-warning"' : ''}>
                <td>${p.id}</td>
                <td>
                    <strong>${escapeHtml(p.nome)}</strong>${marcaPromocao}<br>
                    <small class="text-muted">
                        Código: ${escapeHtml(p.codigo || '-')} |
                        Barras: ${escapeHtml(p.codigo_barras || '-')}
                    </small>
                </td>
                <td>${escapeHtml(p.unidade || 'UN')}</td>
                <td>${formatCurrency(precoCompra)}</td>
                <td class="fw-bold ${temPromocao ? 'text-danger' : 'text-success'}">${linhaDescontoPreco}</td>
                <td>${formatarVendaUnidadeConsulta(p)}</td>
                <td>${formatarPrecoUnidadeConsulta(p)}</td>
                <td>
                    <span class="badge ${semEstoque ? 'bg-danger' : estoqueBaixo ? 'bg-warning text-dark' : 'bg-success'}">
                        ${estoque}
                    </span>
                </td>
                <td class="text-end">
                    <button
                        type="button"
                        class="btn btn-sm btn-success"
                        ${semEstoque ? 'disabled' : ''}
                        onclick="adicionarProdutoConsultaPDV(${p.id})"
                    >
                        <i class="fas fa-cart-plus"></i> Adicionar
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    $('#resultadoConsultaProdutosPDV').html(`
        <div class="table-responsive">
            <table class="table table-sm table-hover align-middle">
                <thead class="table-light">
                    <tr>
                        <th>ID</th>
                        <th>Produto</th>
                        <th>Un.</th>
                        <th>Preço Compra</th>
                        <th>Preço Venda</th>
                        <th>Venda Unidade</th>
                        <th>Preço Unidade</th>
                        <th>Estoque</th>
                        <th class="text-end">Ação</th>
                    </tr>
                </thead>
                <tbody>
                    ${linhas}
                </tbody>
            </table>
        </div>
    `);
}

function atualizarDataHoraPdv() {
  const el = document.getElementById("dataHoraPdv");
  if (!el) return;

  const agora = new Date();
  el.textContent = agora.toLocaleString("pt-BR");
}

// Função para abrir fechamento de caixa
function abrirFechamentoCaixa() {
    if (typeof loadPage === 'function') {
        // Fecha o menu lateral se estiver aberto
        if (typeof fecharMenuPdv === 'function') {
            fecharMenuPdv();
        } else {
            document.body.classList.remove('menu-open');
        }
        // Sai do modo fullscreen do PDV antes de navegar
        if (typeof desativarPdvFullscreen === 'function') {
            desativarPdvFullscreen();
        }
        // Remove a classe do body
        document.body.classList.remove('pdv-mode');
        // Carrega a página de caixa
        loadPage('caixa');
        // Atualiza o menu ativo
        $('.nav-link').removeClass('active');
        $('.nav-link[data-page="caixa"]').addClass('active');
    } else {
        showNotification('Erro ao navegar para fechamento de caixa.', 'danger');
    }
}

document.addEventListener("DOMContentLoaded", () => {
    if (!document.getElementById('statusCaixaPdv')) {
        return;
    }

    const busca = document.getElementById("buscaProdutoPdv");
    if (busca) {
        busca.focus();
    }

    if (typeof aplicarModoFiscalPdv === 'function') {
        aplicarModoFiscalPdv();
    }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "F2") {
    e.preventDefault();
    document.getElementById("buscaProdutoPdv")?.focus();
  }

  if (e.key === "F7") {
    e.preventDefault();
    abrirFechamentoCaixa();
  }

  if (e.key === "F10") {
    e.preventDefault();
    document.getElementById("btnFinalizarVendaPdv")?.click();
  }

  if (e.key === "Escape") {
    e.preventDefault();
    // Se menu estiver aberto, fecha o menu
    if (document.body.classList.contains('menu-open')) {
      fecharMenuPdv();
    } else {
      document.getElementById("btnCancelarVendaPdv")?.click();
    }
  }
});

// PDV Fullscreen Mode
function ativarPdvFullscreen() {
  document.body.classList.add('pdv-mode');
}

function desativarPdvFullscreen() {
  document.body.classList.remove('pdv-mode');
}

function abrirMenuPdv() {
  document.body.classList.add('menu-open');
}

function fecharMenuPdv() {
  document.body.classList.remove('menu-open');
}

// Event listener para botão de menu
$(document).off('click.menuPdv').on('click.menuPdv', '#btnMenuPdv', function(e) {
  e.preventDefault();
  e.stopPropagation();
  abrirMenuPdv();
});

// Fechar menu ao clicar no overlay ou em um item do menu
$(document).off('click.fecharMenu').on('click.fecharMenu', function(e) {
  if (document.body.classList.contains('menu-open')) {
    // Se clicou no overlay (fora do menu) ou em um link do menu
    const clickedSidebar = $(e.target).closest('#sidebar').length > 0;
    const clickedMenuButton = $(e.target).closest('#btnMenuPdv').length > 0;

    if (!clickedSidebar && !clickedMenuButton) {
      fecharMenuPdv();
    }

    // Se clicou em um link do menu, fecha o menu e desativa fullscreen
    if ($(e.target).closest('.nav-link').length > 0) {
      fecharMenuPdv();
      desativarPdvFullscreen();
    }
  }
});

// Ativar fullscreen quando carregar PDV
$(document).ready(function() {
  if (currentPage === 'pdv') {
    ativarPdvFullscreen();
  }
});

// Correção global para evitar aviso:
// "Blocked aria-hidden on an element because its descendant retained focus"
$(document).on('hide.bs.modal', '.modal', function () {
    if (document.activeElement && this.contains(document.activeElement)) {
        document.activeElement.blur();
    }
});

// Limpeza extra quando o modal terminar de fechar
$(document).on('hidden.bs.modal', '.modal', function () {
    if (document.activeElement) {
        document.activeElement.blur();
    }

    $('.modal-backdrop').remove();

    if ($('.modal.show').length === 0) {
        $('body').removeClass('modal-open');
        $('body').css('padding-right', '');
    }
});

async function verResumoVendaFiscalTEF(vendaId) {
    try {
        const response = await fetch(`${API_URL}/tef/venda/${vendaId}/resumo`);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Erro ao buscar resumo da venda.');
        }

        const texto = `
VENDA INTERNA: #${data.venda_id}
NFC-e SEFAZ: ${data.nfce_numero ? '#' + data.nfce_numero : 'Não emitida'}
STATUS NFC-e: ${data.nfce_status || 'Não informado'}
CHAVE: ${data.nfce_chave || 'Não informada'}

TEF:
Adquirente: ${data.tef_adquirente || 'Não possui TEF'}
Bandeira: ${data.tef_bandeira || '-'}
NSU: ${data.tef_nsu || '-'}
Autorização: ${data.tef_autorizacao || '-'}
        `;

        alert(texto);

    } catch (error) {
        console.error('Erro resumo venda:', error);
        showNotification(error.message || 'Erro ao buscar resumo.', 'danger');
    }
}
