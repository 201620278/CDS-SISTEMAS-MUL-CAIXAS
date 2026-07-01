let abaTefAtiva = 'geral';
let tefConfigCache = {};

const TEF_CAMPOS_CHECKBOX = new Set([
    'tefHabilitado',
    'pinpadHabilitado',
    'debito',
    'creditoAvista',
    'creditoParcelado',
    'voucher',
    'pix',
    'cancelamento',
    'reimpressao',
    'preAutorizacao'
]);

const TEF_CAMPOS_POR_ABA = {
    geral: ['tefHabilitado', 'tefProvedor', 'tipoIntegracao', 'sdkPath', 'exePath', 'ipTef', 'portaTef', 'tefAmbiente', 'tefTimeout', 'tefTentativas'],
    empresa: ['empresaCodigo', 'lojaCodigo', 'pdvCodigo', 'terminalCodigo', 'caixaCodigo'],
    servidor: [
        'baseUrl', 'ipServidor', 'portaServidor',
        'clientId', 'clientSecret', 'accessToken', 'refreshToken',
        'chaveComunicacao', 'operador'
    ],
    pinpad: ['pinpadHabilitado', 'pinpadModelo', 'fabricante', 'modelo', 'portaCom', 'pinpadIp', 'pinpadPorta', 'serial'],
    operacoes: [
        'debito', 'creditoAvista', 'creditoParcelado', 'voucher',
        'pix', 'cancelamento', 'reimpressao', 'preAutorizacao'
    ]
};

function abrirConfiguracaoTEF() {
    if (typeof carregarPaginaHtml === 'function') {
        carregarPaginaHtml('pages/ConfiguracaoTEF.html', function() {
            initConfiguracaoTEF();
        });
    } else {
        $('#page-content').html('<div class="alert alert-danger">Erro ao carregar configuração TEF.</div>');
    }
}

function isConfiguracaoTefPageLoaded() {
    return document.getElementById('configuracaoTefConteudo') !== null;
}

async function initConfiguracaoTEF() {
    const pageRoot = document.querySelector('.configuracao-tef-page');
    if (!pageRoot || !isConfiguracaoTefPageLoaded()) {
        return;
    }

    if (pageRoot.dataset.tefInitialized === 'true') {
        return;
    }

    pageRoot.dataset.tefInitialized = 'true';
    abaTefAtiva = 'geral';
    tefConfigCache = {};

    configurarAbasTEF();
    configurarBotoesTEF();

    try {
        await carregarConfiguracaoTEF();
    } catch (error) {
        console.error(error);
        if (typeof showNotification === 'function') {
            showNotification(error.message || 'Erro ao carregar configuração TEF.', 'danger');
        }
    }

    selecionarAbaTEFVisual(abaTefAtiva);
    carregarAbaTEFAtiva();
}

function configurarBotoesTEF() {
    document.getElementById('btnVoltarConfigAvancadas')?.addEventListener('click', () => {
        if (typeof loadPage === 'function') {
            loadPage('configuracoes-avancadas');
        }
    });

    document.getElementById('btnSalvarConfiguracaoTEF')?.addEventListener('click', () => {
        salvarConfiguracaoTEF();
    });
}

function configurarAbasTEF() {
    document.querySelectorAll('.configuracao-tef-tab').forEach(tab => {
        tab.addEventListener('click', function() {
            const aba = this.getAttribute('data-aba');
            if (!aba || aba === abaTefAtiva) {
                return;
            }

            sincronizarAbaAtualParaCache();
            abaTefAtiva = aba;
            selecionarAbaTEFVisual(aba);
            carregarAbaTEFAtiva();
        });
    });
}

function selecionarAbaTEFVisual(aba) {
    document.querySelectorAll('.configuracao-tef-tab').forEach(tab => {
        tab.classList.toggle('active', tab.getAttribute('data-aba') === aba);
    });
}

async function carregarConfiguracaoTEF() {
    const response = await fetch(`${API_URL}/tef/configuracao`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.error || 'Erro ao carregar configuração TEF.');
    }

    tefConfigCache = data || {};
}

function obterValorCampoTEF(id) {
    const valor = tefConfigCache[id];
    if (TEF_CAMPOS_CHECKBOX.has(id)) {
        return valor === true || valor === 'true' || valor === '1';
    }
    return valor ?? '';
}

function definirValorCampoTEF(id, valor) {
    if (TEF_CAMPOS_CHECKBOX.has(id)) {
        tefConfigCache[id] = valor ? 'true' : 'false';
        return;
    }
    tefConfigCache[id] = valor ?? '';
}

function sincronizarAbaAtualParaCache() {
    const campos = TEF_CAMPOS_POR_ABA[abaTefAtiva] || [];

    campos.forEach((id) => {
        const elemento = document.getElementById(id);
        if (!elemento) {
            return;
        }

        if (elemento.type === 'checkbox') {
            definirValorCampoTEF(id, elemento.checked);
            return;
        }

        definirValorCampoTEF(id, elemento.value);
    });
}

function aplicarValoresNaAbaAtual() {
    const campos = TEF_CAMPOS_POR_ABA[abaTefAtiva] || [];

    campos.forEach((id) => {
        const elemento = document.getElementById(id);
        if (!elemento) {
            return;
        }

        if (elemento.type === 'checkbox') {
            elemento.checked = obterValorCampoTEF(id);
            return;
        }

        elemento.value = obterValorCampoTEF(id);
    });
}

function montarPayloadConfiguracaoTEF() {
    sincronizarAbaAtualParaCache();

    const payload = {};
    Object.values(TEF_CAMPOS_POR_ABA).forEach((campos) => {
        campos.forEach((id) => {
            payload[id] = tefConfigCache[id] ?? '';
        });
    });

    return payload;
}

async function salvarConfiguracaoTEF() {
    try {
        const payload = montarPayloadConfiguracaoTEF();

        const response = await fetch(`${API_URL}/tef/configuracao`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(data.error || 'Erro ao salvar configuração TEF.');
        }

        tefConfigCache = data.config || payload;

        if (typeof showNotification === 'function') {
            showNotification(data.message || 'Configuração TEF salva com sucesso.', 'success');
        }
    } catch (error) {
        console.error(error);
        if (typeof showNotification === 'function') {
            showNotification(error.message || 'Erro ao salvar configuração TEF.', 'danger');
        }
    }
}

function carregarAbaTEFAtiva() {
    const conteudo = document.getElementById('configuracaoTefConteudo');
    if (!conteudo) {
        return;
    }

    switch (abaTefAtiva) {
        case 'geral':
            renderizarAbaGeralTEF(conteudo);
            break;
        case 'empresa':
            renderizarAbaEmpresaTEF(conteudo);
            break;
        case 'servidor':
            renderizarAbaServidorTEF(conteudo);
            break;
        case 'pinpad':
            renderizarAbaPinPadTEF(conteudo);
            break;
        case 'operacoes':
            renderizarAbaOperacoesTEF(conteudo);
            break;
        case 'monitor':
            renderizarAbaMonitorTEF(conteudo);
            break;
        case 'diagnostico':
            renderizarAbaDiagnosticoTEF(conteudo);
            break;
        case 'reimpressao':
            renderizarAbaReimpressaoTEF(conteudo);
            break;
        default:
            renderizarAbaPlaceholderTEF(conteudo, 'Configuração TEF', 'Seção em desenvolvimento.');
    }

    aplicarValoresNaAbaAtual();
}

function renderizarAbaGeralTEF(conteudo) {
    conteudo.innerHTML = `
        <div class="card">
            <div class="card-body">
                <h5 class="card-title mb-4">Geral</h5>
                <form id="formTefGeral">
                    <div class="row g-3">
                        <div class="col-12">
                            <div class="form-check form-switch">
                                <input id="tefHabilitado" type="checkbox" class="form-check-input">
                                <label class="form-check-label fw-bold" for="tefHabilitado">TEF Habilitado</label>
                            </div>
                        </div>

                        <div class="col-md-6">
                            <label for="tefProvedor" class="form-label fw-bold">Provedor</label>
                            <select id="tefProvedor" class="form-select">
                                <option value="paygo">PayGo</option>
                                <option value="sitef">CliSiTef</option>
                                <option value="stone">Stone</option>
                                <option value="rede">Rede</option>
                                <option value="getnet">Getnet</option>
                                <option value="cielo">Cielo</option>
                            </select>
                        </div>

                        <div class="col-md-6">
                            <label for="tipoIntegracao" class="form-label fw-bold">Tipo Integração</label>
                            <select id="tipoIntegracao" class="form-select">
                                <option value="dll">DLL</option>
                                <option value="exe">EXE</option>
                                <option value="api">API</option>
                                <option value="tcp">TCP</option>
                            </select>
                        </div>

                        <div class="col-md-6">
                            <label for="sdkPath" class="form-label fw-bold">SDK</label>
                            <input id="sdkPath" type="text" class="form-control" autocomplete="off">
                        </div>

                        <div class="col-md-6">
                            <label for="exePath" class="form-label fw-bold">Executável</label>
                            <input id="exePath" type="text" class="form-control" autocomplete="off">
                        </div>

                        <div class="col-md-6">
                            <label for="ipTef" class="form-label fw-bold">IP</label>
                            <input id="ipTef" type="text" class="form-control" autocomplete="off" placeholder="Ex.: 127.0.0.1">
                        </div>

                        <div class="col-md-6">
                            <label for="portaTef" class="form-label fw-bold">Porta</label>
                            <input id="portaTef" type="number" class="form-control" min="1" max="65535" placeholder="Ex.: 4096">
                        </div>

                        <div class="col-md-6">
                            <label for="tefAmbiente" class="form-label fw-bold">Ambiente</label>
                            <select id="tefAmbiente" class="form-select">
                                <option value="simulacao">Simulação (desenvolvimento)</option>
                                <option value="homologacao">Homologação</option>
                                <option value="producao">Produção</option>
                            </select>
                        </div>

                        <div class="col-md-6">
                            <label for="tefTimeout" class="form-label fw-bold">Timeout (segundos)</label>
                            <input id="tefTimeout" type="number" class="form-control" min="1" placeholder="Ex.: 60">
                        </div>

                        <div class="col-md-6">
                            <label for="tefTentativas" class="form-label fw-bold">Tentativas</label>
                            <input id="tefTentativas" type="number" class="form-control" min="1" placeholder="Ex.: 3">
                        </div>
                    </div>
                </form>
            </div>
        </div>
    `;
}

function renderizarAbaEmpresaTEF(conteudo) {
    conteudo.innerHTML = `
        <div class="card">
            <div class="card-body">
                <h5 class="card-title mb-4">Empresa</h5>
                <p class="text-muted small">Códigos específicos de cada cliente. Os valores são salvos no banco de dados.</p>
                <form id="formTefEmpresa">
                    <div class="row g-3">
                        <div class="col-md-6">
                            <label for="empresaCodigo" class="form-label fw-bold">Código da Empresa</label>
                            <input id="empresaCodigo" type="text" class="form-control" autocomplete="off">
                        </div>
                        <div class="col-md-6">
                            <label for="lojaCodigo" class="form-label fw-bold">Código da Loja</label>
                            <input id="lojaCodigo" type="text" class="form-control" autocomplete="off">
                        </div>
                        <div class="col-md-6">
                            <label for="pdvCodigo" class="form-label fw-bold">Código do PDV</label>
                            <input id="pdvCodigo" type="text" class="form-control" autocomplete="off">
                        </div>
                        <div class="col-md-6">
                            <label for="terminalCodigo" class="form-label fw-bold">Código do Terminal</label>
                            <input id="terminalCodigo" type="text" class="form-control" autocomplete="off">
                        </div>
                        <div class="col-md-6">
                            <label for="caixaCodigo" class="form-label fw-bold">Código do Caixa</label>
                            <input id="caixaCodigo" type="text" class="form-control" autocomplete="off">
                        </div>
                    </div>
                </form>
            </div>
        </div>
    `;
}

function renderizarAbaServidorTEF(conteudo) {
    conteudo.innerHTML = `
        <div class="card">
            <div class="card-body">
                <h5 class="card-title mb-4">Servidor</h5>
                <form id="formTefServidor">
                    <div class="row g-3">
                        <div class="col-md-8">
                            <label for="baseUrl" class="form-label fw-bold">Base URL</label>
                            <input id="baseUrl" type="text" class="form-control" autocomplete="off">
                        </div>
                        <div class="col-md-4">
                            <label for="portaServidor" class="form-label fw-bold">Porta</label>
                            <input id="portaServidor" type="number" class="form-control" min="1" max="65535">
                        </div>
                        <div class="col-md-8">
                            <label for="ipServidor" class="form-label fw-bold">IP do Servidor</label>
                            <input id="ipServidor" type="text" class="form-control" autocomplete="off">
                        </div>
                        <div class="col-md-6">
                            <label for="clientId" class="form-label fw-bold">Client ID</label>
                            <input id="clientId" type="text" class="form-control" autocomplete="off">
                        </div>
                        <div class="col-md-6">
                            <label for="clientSecret" class="form-label fw-bold">Client Secret</label>
                            <input id="clientSecret" type="password" class="form-control" autocomplete="off">
                        </div>
                        <div class="col-md-6">
                            <label for="accessToken" class="form-label fw-bold">Access Token</label>
                            <input id="accessToken" type="password" class="form-control" autocomplete="off">
                        </div>
                        <div class="col-md-6">
                            <label for="refreshToken" class="form-label fw-bold">Refresh Token</label>
                            <input id="refreshToken" type="password" class="form-control" autocomplete="off">
                        </div>
                        <div class="col-md-6">
                            <label for="chaveComunicacao" class="form-label fw-bold">Chave de Comunicação</label>
                            <input id="chaveComunicacao" type="password" class="form-control" autocomplete="off">
                        </div>
                        <div class="col-md-6">
                            <label for="operador" class="form-label fw-bold">Operador</label>
                            <input id="operador" type="text" class="form-control" autocomplete="off">
                        </div>
                    </div>
                </form>
            </div>
        </div>
    `;
}

function renderizarAbaPinPadTEF(conteudo) {
    conteudo.innerHTML = `
        <div class="card">
            <div class="card-body">
                <h5 class="card-title mb-4">PinPad</h5>
                <p class="text-muted small mb-3">
                    Equipamentos como a <strong>Gertec PPC930 (Rede/Itaú)</strong> são operados via middleware
                    <strong>CliSiTef</strong> ou <strong>PayGo</strong> — o CDS apenas registra o modelo selecionado.
                </p>
                <form id="formTefPinpad">
                    <div class="row g-3">
                        <div class="col-12">
                            <div class="form-check form-switch">
                                <input type="checkbox" id="pinpadHabilitado" class="form-check-input">
                                <label class="form-check-label fw-bold" for="pinpadHabilitado">PinPad Habilitado</label>
                            </div>
                        </div>
                        <div class="col-md-12">
                            <label for="pinpadModelo" class="form-label fw-bold">Modelo PinPad</label>
                            <select id="pinpadModelo" class="form-select">
                                <option value="">Selecione...</option>
                                <option value="GERTEC_PPC930">Gertec PPC930 (Rede/Itaú)</option>
                            </select>
                        </div>
                        <div class="col-md-6">
                            <label for="fabricante" class="form-label fw-bold">Fabricante</label>
                            <input id="fabricante" type="text" class="form-control" autocomplete="off" readonly>
                        </div>
                        <div class="col-md-6">
                            <label for="modelo" class="form-label fw-bold">Modelo</label>
                            <input id="modelo" type="text" class="form-control" autocomplete="off" readonly>
                        </div>
                        <div class="col-md-4">
                            <label for="portaCom" class="form-label fw-bold">Porta COM</label>
                            <input id="portaCom" type="text" class="form-control" autocomplete="off" placeholder="Ex.: COM3">
                        </div>
                        <div class="col-md-4">
                            <label for="pinpadIp" class="form-label fw-bold">IP do PinPad</label>
                            <input id="pinpadIp" type="text" class="form-control" autocomplete="off">
                        </div>
                        <div class="col-md-4">
                            <label for="pinpadPorta" class="form-label fw-bold">Porta do PinPad</label>
                            <input id="pinpadPorta" type="number" class="form-control" min="1" max="65535">
                        </div>
                        <div class="col-md-6">
                            <label for="serial" class="form-label fw-bold">Serial</label>
                            <input id="serial" type="text" class="form-control" autocomplete="off">
                        </div>
                    </div>
                </form>
            </div>
        </div>
    `;

    configurarEventosPinpadTEF();
    carregarCatalogoPinpadsTEF();
}

const PINPAD_MODELOS_MAPA = {
    GERTEC_PPC930: { fabricante: 'Gertec', modelo: 'PPC930' }
};

function aplicarModeloPinpadSelecionado(codigo) {
    const meta = PINPAD_MODELOS_MAPA[codigo];
    const fabricanteEl = document.getElementById('fabricante');
    const modeloEl = document.getElementById('modelo');

    if (meta && fabricanteEl && modeloEl) {
        fabricanteEl.value = meta.fabricante;
        modeloEl.value = meta.modelo;
        definirValorCampoTEF('fabricante', meta.fabricante);
        definirValorCampoTEF('modelo', meta.modelo);
    } else if (fabricanteEl && modeloEl) {
        fabricanteEl.value = '';
        modeloEl.value = '';
        definirValorCampoTEF('fabricante', '');
        definirValorCampoTEF('modelo', '');
    }

    definirValorCampoTEF('pinpadModelo', codigo || '');
}

function configurarEventosPinpadTEF() {
    const select = document.getElementById('pinpadModelo');
    if (!select) return;

    select.addEventListener('change', function() {
        aplicarModeloPinpadSelecionado(this.value);
    });

    const codigoSalvo = obterValorCampoTEF('pinpadModelo') || obterValorCampoTEF('pinpadCodigo');
    if (codigoSalvo) {
        select.value = codigoSalvo;
        aplicarModeloPinpadSelecionado(codigoSalvo);
    }
}

async function carregarCatalogoPinpadsTEF() {
    const select = document.getElementById('pinpadModelo');
    if (!select) return;

    try {
        const response = await fetch(`${API_URL}/tef/pinpads-catalogo`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        const data = await response.json().catch(() => ({}));
        const pinpads = data.pinpads || [];

        if (pinpads.length > 0) {
            const valorAtual = select.value || obterValorCampoTEF('pinpadModelo') || obterValorCampoTEF('pinpadCodigo');
            select.innerHTML = '<option value="">Selecione...</option>' + pinpads.map((p) => {
                const label = p.nomeExibicao || p.nome;
                PINPAD_MODELOS_MAPA[p.codigo] = { fabricante: p.fabricante, modelo: p.modelo };
                return `<option value="${escapeHtml(p.codigo)}">${escapeHtml(label)}</option>`;
            }).join('');
            if (valorAtual) {
                select.value = valorAtual;
                aplicarModeloPinpadSelecionado(valorAtual);
            }
        }
    } catch (error) {
        console.warn('Catálogo PinPad TEF indisponível, usando opções padrão.', error);
    }
}

function renderizarAbaOperacoesTEF(conteudo) {
    conteudo.innerHTML = `
        <div class="card">
            <div class="card-body">
                <h5 class="card-title mb-4">Operações</h5>
                <form id="formTefOperacoes">
                    <div class="row g-3">
                        <div class="col-md-6">
                            <div class="form-check">
                                <input type="checkbox" id="debito" class="form-check-input">
                                <label class="form-check-label" for="debito">Débito</label>
                            </div>
                        </div>
                        <div class="col-md-6">
                            <div class="form-check">
                                <input type="checkbox" id="creditoAvista" class="form-check-input">
                                <label class="form-check-label" for="creditoAvista">Crédito à Vista</label>
                            </div>
                        </div>
                        <div class="col-md-6">
                            <div class="form-check">
                                <input type="checkbox" id="creditoParcelado" class="form-check-input">
                                <label class="form-check-label" for="creditoParcelado">Crédito Parcelado</label>
                            </div>
                        </div>
                        <div class="col-md-6">
                            <div class="form-check">
                                <input type="checkbox" id="voucher" class="form-check-input">
                                <label class="form-check-label" for="voucher">Voucher</label>
                            </div>
                        </div>
                        <div class="col-md-6">
                            <div class="form-check">
                                <input type="checkbox" id="pix" class="form-check-input">
                                <label class="form-check-label" for="pix">Pix</label>
                            </div>
                        </div>
                        <div class="col-md-6">
                            <div class="form-check">
                                <input type="checkbox" id="cancelamento" class="form-check-input">
                                <label class="form-check-label" for="cancelamento">Cancelamento</label>
                            </div>
                        </div>
                        <div class="col-md-6">
                            <div class="form-check">
                                <input type="checkbox" id="reimpressao" class="form-check-input">
                                <label class="form-check-label" for="reimpressao">Reimpressão</label>
                            </div>
                        </div>
                        <div class="col-md-6">
                            <div class="form-check">
                                <input type="checkbox" id="preAutorizacao" class="form-check-input">
                                <label class="form-check-label" for="preAutorizacao">Pré-autorização</label>
                            </div>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    `;
}

function renderizarAbaMonitorTEF(conteudo) {
    conteudo.innerHTML = `
        <div class="card">
            <div class="card-body">
                <h5 class="card-title mb-4">Monitor TEF</h5>
                <div class="row g-3">
                    <div class="col-md-6">
                        <div class="card bg-light">
                            <div class="card-body text-center">
                                <h6 class="card-subtitle mb-2 text-muted">PinPad</h6>
                                <div id="monitorPinpadStatus" class="badge bg-secondary fs-5">Verificando...</div>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-6">
                        <div class="card bg-light">
                            <div class="card-body text-center">
                                <h6 class="card-subtitle mb-2 text-muted">Servidor</h6>
                                <div id="monitorServidorStatus" class="badge bg-secondary fs-5">Verificando...</div>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-6">
                        <div class="card bg-light">
                            <div class="card-body text-center">
                                <h6 class="card-subtitle mb-2 text-muted">Internet</h6>
                                <div id="monitorInternetStatus" class="badge bg-secondary fs-5">Verificando...</div>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-6">
                        <div class="card bg-light">
                            <div class="card-body text-center">
                                <h6 class="card-subtitle mb-2 text-muted">Último NSU</h6>
                                <div id="monitorUltimoNsu" class="fs-5">-</div>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-6">
                        <div class="card bg-light">
                            <div class="card-body text-center">
                                <h6 class="card-subtitle mb-2 text-muted">Pendências</h6>
                                <div id="monitorPendencias" class="badge bg-warning fs-5">0</div>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-6">
                        <div class="card bg-light">
                            <div class="card-body text-center">
                                <h6 class="card-subtitle mb-2 text-muted">Reversões</h6>
                                <div id="monitorReversoes" class="badge bg-info fs-5">0</div>
                            </div>
                        </div>
                    </div>
                    <div class="col-12">
                        <div class="card bg-light">
                            <div class="card-body text-center">
                                <h6 class="card-subtitle mb-2 text-muted">Erros Recentes</h6>
                                <div id="monitorErros" class="text-start" style="max-height: 200px; overflow-y: auto;">
                                    <small class="text-muted">Nenhum erro recente</small>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <button type="button" class="btn btn-primary mt-3" onclick="atualizarMonitorTEF()">
                    <i class="fas fa-sync"></i> Atualizar
                </button>
            </div>
        </div>
    `;
    
    atualizarMonitorTEF();
}

async function atualizarMonitorTEF() {
    try {
        const response = await fetch(`${API_URL}/tef/status`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });

        const data = await response.json().catch(() => ({}));

        if (response.ok && data) {
            document.getElementById('monitorPinpadStatus').className = 
                `badge fs-5 ${data.pinpad?.habilitado ? 'bg-success' : 'bg-secondary'}`;
            document.getElementById('monitorPinpadStatus').textContent = 
                data.pinpad?.habilitado ? 'Online' : 'Offline';

            document.getElementById('monitorServidorStatus').className = 
                `badge fs-5 ${data.servidor?.configurado ? 'bg-success' : 'bg-secondary'}`;
            document.getElementById('monitorServidorStatus').textContent = 
                data.servidor?.configurado ? 'Online' : 'Offline';

            document.getElementById('monitorInternetStatus').className = 'badge bg-success fs-5';
            document.getElementById('monitorInternetStatus').textContent = 'Online';

            document.getElementById('monitorUltimoNsu').textContent = data.ultimo_nsu || '-';
            document.getElementById('monitorPendencias').textContent = data.pendencias || 0;
            document.getElementById('monitorReversoes').textContent = data.reversoes || 0;

            if (data.erros && data.erros.length > 0) {
                document.getElementById('monitorErros').innerHTML = data.erros.map(erro => 
                    `<div class="alert alert-danger py-1 mb-1"><small>${escapeHtml(erro)}</small></div>`
                ).join('');
            }
        }
    } catch (error) {
        console.error('Erro ao atualizar monitor TEF:', error);
    }
}

function renderizarAbaDiagnosticoTEF(conteudo) {
    conteudo.innerHTML = `
        <div class="card">
            <div class="card-body">
                <h5 class="card-title mb-4">Diagnóstico TEF</h5>
                <div class="row g-3">
                    <div class="col-md-6">
                        <div class="card bg-light">
                            <div class="card-body d-flex align-items-center">
                                <div id="diagConfiguracao" class="badge bg-secondary me-2">Pendente</div>
                                <span>Configuração carregada</span>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-6">
                        <div class="card bg-light">
                            <div class="card-body d-flex align-items-center">
                                <div id="diagAdapter" class="badge bg-secondary me-2">Pendente</div>
                                <span>Adapter carregado</span>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-6">
                        <div class="card bg-light">
                            <div class="card-body d-flex align-items-center">
                                <div id="diagBanco" class="badge bg-secondary me-2">Pendente</div>
                                <span>Banco conectado</span>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-6">
                        <div class="card bg-light">
                            <div class="card-body d-flex align-items-center">
                                <div id="diagMonitor" class="badge bg-secondary me-2">Pendente</div>
                                <span>Monitor ativo</span>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-6">
                        <div class="card bg-light">
                            <div class="card-body d-flex align-items-center">
                                <div id="diagReimpressao" class="badge bg-secondary me-2">Pendente</div>
                                <span>Reimpressão ativa</span>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-6">
                        <div class="card bg-light">
                            <div class="card-body d-flex align-items-center">
                                <div id="diagConciliacao" class="badge bg-secondary me-2">Pendente</div>
                                <span>Conciliação ativa</span>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-6">
                        <div class="card bg-light">
                            <div class="card-body d-flex align-items-center">
                                <div id="diagCancelamento" class="badge bg-secondary me-2">Pendente</div>
                                <span>Cancelamento ativo</span>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-6">
                        <div class="card bg-light">
                            <div class="card-body d-flex align-items-center">
                                <div id="diagVenda" class="badge bg-secondary me-2">Pendente</div>
                                <span>Venda integrada</span>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-6">
                        <div class="card bg-light">
                            <div class="card-body d-flex align-items-center">
                                <div id="diagNfce" class="badge bg-secondary me-2">Pendente</div>
                                <span>NFC-e integrada</span>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-6">
                        <div class="card bg-light">
                            <div class="card-body d-flex align-items-center">
                                <div id="diagSDK" class="badge bg-secondary me-2">Pendente</div>
                                <span>SDK encontrado</span>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="mt-3">
                    <button type="button" class="btn btn-primary" onclick="executarDiagnosticoCompleto()">
                        <i class="fas fa-stethoscope"></i> Executar Diagnóstico
                    </button>
                </div>
                <div id="diagResultado" class="mt-3"></div>
            </div>
        </div>
    `;
    
    executarDiagnosticoCompleto();
}

async function executarDiagnosticoCompleto() {
    const resultadoDiv = document.getElementById('diagResultado');
    if (resultadoDiv) {
        resultadoDiv.innerHTML = '<div class="spinner-border text-primary" role="status"></div>';
    }

    try {
        const response = await fetch(`${API_URL}/tef/diagnostico-completo`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        const relatorio = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(relatorio.erro || 'Falha no diagnóstico TEF');
        }

        const mapaBadges = {
            adapter_selecionado: 'diagAdapter',
            middleware_instalado: 'diagSDK',
            dll_encontrada: 'diagSDK',
            pinpad_configurado: 'diagMonitor',
            banco_acessivel: 'diagBanco',
            configuracao_valida: 'diagConfiguracao',
            adapter_operacional: 'diagAdapter'
        };

        (relatorio.itens || []).forEach((item) => {
            const elId = mapaBadges[item.chave];
            if (elId) atualizarStatus(elId, item.ok);
        });

        atualizarStatus('diagReimpressao', true);
        atualizarStatus('diagConciliacao', true);
        atualizarStatus('diagCancelamento', true);
        atualizarStatus('diagVenda', true);
        atualizarStatus('diagNfce', true);

        if (resultadoDiv) {
            const pct = relatorio.percentualProntidao || 0;
            const pendencias = (relatorio.pendencias || []).map((p) => `<li>${p}</li>`).join('');
            const pinpad = relatorio.pinpad || {};

            resultadoDiv.innerHTML = `
                <div class="alert ${pct >= 90 ? 'alert-success' : pct >= 70 ? 'alert-warning' : 'alert-danger'}">
                    <strong>Prontidão TEF:</strong> ${pct}%
                    <div class="small mt-1">Provedor: ${relatorio.resumo?.provedor || '-'} | Ambiente: ${relatorio.resumo?.ambiente || '-'} | Modo: ${relatorio.adapter?.modo || '-'}</div>
                    ${pinpad.configurado ? `<div class="small mt-1"><strong>PinPad:</strong> ${pinpad.configurado} | <strong>Middleware:</strong> ${pinpad.middleware} | <strong>Status:</strong> ${pinpad.status}</div>` : ''}
                </div>
                ${pendencias ? `<ul class="small text-muted">${pendencias}</ul>` : ''}
                <pre class="small bg-light p-2 rounded" style="max-height:240px;overflow:auto;">${JSON.stringify(relatorio, null, 2)}</pre>
            `;
        }
    } catch (error) {
        console.error('Erro ao executar diagnóstico completo:', error);
        if (resultadoDiv) {
            resultadoDiv.innerHTML = `
                <div class="alert alert-danger">
                    <strong>Erro:</strong> ${error.message}
                </div>
            `;
        }
    }
}

function atualizarStatus(elementId, ok) {
    const elemento = document.getElementById(elementId);
    if (elemento) {
        elemento.className = `badge me-2 ${ok ? 'bg-success' : 'bg-danger'}`;
        elemento.textContent = ok ? '✓' : '✗';
    }
}

async function verificarSDK() {
    const resposta = await fetch('/api/tef/diagnostico-sdk', {
        headers: {
            Authorization: `Bearer ${localStorage.getItem('token') || ''}`
        }
    });
    const dados = await resposta.json();
    console.log(dados);
}

async function executarDiagnosticoTEF() {
    const resultadoDiv = document.getElementById('diagResultado');
    resultadoDiv.innerHTML = '<div class="spinner-border text-primary" role="status"></div>';

    try {
        const response = await fetch(`${API_URL}/tef/testar`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });

        const data = await response.json().catch(() => ({}));

        if (response.ok && data.testes) {
            data.testes.forEach(teste => {
                const elemento = document.getElementById(`diag${capitalize(teste.tipo)}`);
                if (elemento) {
                    elemento.className = `badge ${teste.sucesso ? 'bg-success' : 'bg-danger'}`;
                    elemento.textContent = teste.sucesso ? 'OK' : 'Falha';
                }
            });

            resultadoDiv.innerHTML = `
                <div class="alert ${data.sucesso ? 'alert-success' : 'alert-warning'}">
                    <strong>${data.mensagem}</strong>
                </div>
            `;
        } else {
            resultadoDiv.innerHTML = `
                <div class="alert alert-danger">
                    <strong>Erro:</strong> ${data.error || 'Falha ao executar diagnóstico'}
                </div>
            `;
        }
    } catch (error) {
        console.error('Erro ao executar diagnóstico TEF:', error);
        resultadoDiv.innerHTML = `
            <div class="alert alert-danger">
                <strong>Erro:</strong> ${error.message}
            </div>
        `;
    }
}

function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function renderizarAbaReimpressaoTEF(conteudo) {
    conteudo.innerHTML = `
        <div class="card">
            <div class="card-body">
                <h5 class="card-title mb-4">Reimpressão de Comprovantes TEF</h5>
                <div class="row mb-3">
                    <div class="col-md-6">
                        <button type="button" class="btn btn-primary w-100" onclick="carregarUltimasTransacoesTEF()">
                            <i class="fas fa-sync"></i> Carregar Últimas Transações
                        </button>
                    </div>
                </div>
                <div id="listaTransacoesTEF" class="table-responsive">
                    <div class="text-center py-5 text-muted">
                        <i class="fas fa-receipt fa-2x mb-3"></i>
                        <p>Clique em "Carregar Últimas Transações" para ver vendas com TEF integrado</p>
                    </div>
                </div>
            </div>
        </div>
    `;
}

async function carregarUltimasTransacoesTEF() {
    const listaDiv = document.getElementById('listaTransacoesTEF');
    listaDiv.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-primary" role="status"></div></div>';

    try {
        const response = await fetch(`${API_URL}/tef/transacoes/recentes?limit=20&apenas_integradas=1`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });

        const transacoes = await response.json().catch(() => []);

        if (!response.ok) {
            throw new Error('Erro ao carregar transações');
        }

        if (!transacoes || transacoes.length === 0) {
            listaDiv.innerHTML = `
                <div class="text-center py-5 text-muted">
                    <i class="fas fa-inbox fa-2x mb-3"></i>
                    <p>Nenhuma transação TEF vinculada a venda encontrada</p>
                </div>
            `;
            return;
        }

        const tabela = `
            <table class="table table-striped table-hover">
                <thead>
                    <tr>
                        <th>Data</th>
                        <th>NSU</th>
                        <th>Autorização</th>
                        <th>Adquirente</th>
                        <th>Bandeira</th>
                        <th>Valor</th>
                        <th>Status</th>
                        <th>Ações</th>
                    </tr>
                </thead>
                <tbody>
                    ${transacoes.map(t => `
                        <tr>
                            <td>${formatDateTime(t.criado_em)}</td>
                            <td>${escapeHtml(t.nsu || '-')}</td>
                            <td>${escapeHtml(t.autorizacao || '-')}</td>
                            <td>${escapeHtml(t.adquirente || '-')}</td>
                            <td>${escapeHtml(t.bandeira || '-')}</td>
                            <td>R$ ${Number(t.valor || 0).toFixed(2)}</td>
                            <td>
                                <span class="badge ${t.status === 'aprovado' ? 'bg-success' : t.status === 'negado' ? 'bg-danger' : 'bg-warning'}">
                                    ${escapeHtml(t.status || '-')}
                                </span>
                            </td>
                            <td>
                                <div class="btn-group btn-group-sm">
                                    <button type="button" class="btn btn-outline-primary" onclick="reimprimirComprovanteTEF(${t.id}, 'cliente')" title="Reimprimir Cliente">
                                        <i class="fas fa-user"></i>
                                    </button>
                                    <button type="button" class="btn btn-outline-secondary" onclick="reimprimirComprovanteTEF(${t.id}, 'loja')" title="Reimprimir Loja">
                                        <i class="fas fa-store"></i>
                                    </button>
                                </div>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;

        listaDiv.innerHTML = tabela;

    } catch (error) {
        console.error('Erro ao carregar transações TEF:', error);
        listaDiv.innerHTML = `
            <div class="alert alert-danger">
                <strong>Erro:</strong> ${error.message}
            </div>
        `;
    }
}

async function reimprimirComprovanteTEF(transacaoId, tipo) {
    try {
        // First, get transaction details to find venda_id
        const transacaoResponse = await fetch(`${API_URL}/tef/transacao/${transacaoId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });

        const transacaoData = await transacaoResponse.json().catch(() => ({}));

        if (transacaoResponse.ok && transacaoData.venda_id) {
            // Open the sale before reprinting
            if (typeof loadPage === 'function') {
                loadPage('venda', { id: transacaoData.venda_id });
            }
        }

        const response = await fetch(`${API_URL}/tef/transacao/${transacaoId}/reimprimir`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({ tipo })
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(data.error || 'Erro ao reimprimir comprovante');
        }

        if (typeof showNotification === 'function') {
            showNotification(`Comprovante de ${tipo === 'cliente' ? 'cliente' : 'loja'} reimpresso com sucesso.`, 'success');
        }

    } catch (error) {
        console.error('Erro ao reimprimir comprovante:', error);
        if (typeof showNotification === 'function') {
            showNotification(error.message || 'Erro ao reimprimir comprovante', 'danger');
        }
    }
}

function renderizarAbaPlaceholderTEF(conteudo, titulo, descricao) {
    conteudo.innerHTML = `
        <div class="card">
            <div class="card-body text-center py-5 text-muted">
                <i class="fas fa-tools fa-2x mb-3"></i>
                <h5>${escapeHtml(titulo)}</h5>
                <p class="mb-0">${escapeHtml(descricao)}</p>
                <small>Esta seção será implementada nas próximas etapas.</small>
            </div>
        </div>
    `;
}
