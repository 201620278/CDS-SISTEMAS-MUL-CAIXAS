/**
 * Configuração de rede da estação (modo local / cliente).
 * Compartilhado entre ERP e PDV.
 */

function escapeHtmlRede(s) {
    if (!s) return '';
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
}

async function carregarConfiguracaoRede() {
    try {
        let config;

        if (window.electronAPI && typeof window.electronAPI.obterModoEstacao === 'function') {
            const estacao = await window.electronAPI.obterModoEstacao();
            config = {
                modo: estacao.modo === 'cliente' ? 'cliente' : 'local',
                ipServidor: estacao.ipServidor || '',
                porta: Number.isInteger(estacao.porta) && estacao.porta > 0 ? estacao.porta : 3001,
                fonte: 'estacao'
            };
        } else {
            const response = await fetch(`${API_URL}/configuracao-rede`, {
                headers: {
                    Authorization: `Bearer ${localStorage.getItem('token')}`
                }
            });

            if (!response.ok) {
                throw new Error(`Falha ao carregar configuração de rede: ${response.status}`);
            }

            config = await response.json();
            config.fonte = 'servidor';
        }

        window.configuracaoRedeAtual = config;
        $('#redeConfigCardContainer').html(renderConfiguracaoRedeCard(config));
        aplicarEstadoConfiguracaoRede();
    } catch (err) {
        console.error(err);
        $('#redeConfigCardContainer').html(`
            <div class="alert alert-danger">
                Não foi possível carregar a configuração de rede. Tente novamente mais tarde.
            </div>
        `);
    }
}

function renderConfiguracaoRedeCard(config = {}) {
    const modo = config.modo === 'cliente' ? 'cliente' : 'local';
    const ipServidor = config.ipServidor || '';
    const porta = Number.isInteger(config.porta) && config.porta > 0 ? config.porta : 3001;
    const temElectron = Boolean(window.electronAPI && typeof window.electronAPI.voltarModoLocal === 'function');

    return `
        <form id="redeConfigForm" onsubmit="return false;">
            ${temElectron ? `
            <div id="containerVoltarServidorLocalRede" class="alert alert-warning mb-3">
                <div class="d-flex flex-wrap align-items-center justify-content-between gap-2">
                    <div>
                        <strong id="tituloModoRedeEstacao">Modo de rede desta estação</strong>
                        <div class="small mb-0">
                            <span id="descricaoModoRedeEstacao">Verificando configuração local...</span>
                            <span class="d-block mt-1">Servidor remoto: <span id="lblServidorRemotoEstacaoRede">-</span></span>
                        </div>
                    </div>
                    <button type="button" class="btn btn-primary btn-sm" id="btnVoltarServidorLocalRede" onclick="voltarServidorLocalEstacao()" disabled>
                        <i class="fas fa-home"></i> Voltar ao servidor local
                    </button>
                </div>
            </div>
            ` : ''}
            <div class="mb-3">
                <label class="form-label fw-bold">Modo de operação</label>
                <div class="form-check">
                    <input class="form-check-input" type="radio" name="modoRede" id="modoLocal" value="local" ${modo === 'local' ? 'checked' : ''}>
                    <label class="form-check-label" for="modoLocal">Local (servidor local integrado)</label>
                </div>
                <div class="form-check">
                    <input class="form-check-input" type="radio" name="modoRede" id="modoCliente" value="cliente" ${modo === 'cliente' ? 'checked' : ''}>
                    <label class="form-check-label" for="modoCliente">Cliente (terminal conectado a servidor remoto)</label>
                </div>
            </div>

            <div id="containerClienteConfig" class="border rounded p-3 mb-3" style="display: ${modo === 'cliente' ? 'block' : 'none'};">
                <div class="mb-3">
                    <label for="redeIpServidor" class="form-label fw-bold">IP do servidor remoto</label>
                    <input type="text" id="redeIpServidor" class="form-control" value="${escapeHtmlRede(ipServidor)}" placeholder="Ex.: 192.168.1.3">
                </div>
                <div class="mb-3">
                    <label for="redePorta" class="form-label fw-bold">Porta do servidor</label>
                    <input type="number" id="redePorta" class="form-control" value="${escapeHtmlRede(String(porta))}" min="1" max="65535">
                </div>
            </div>

            <div class="mb-3">
                <button type="button" class="btn btn-outline-primary me-2" id="btnTestarConexaoServidor" onclick="testarConexaoServidor()">
                    <i class="fas fa-link"></i> Testar Conexão
                </button>
                <button type="button" class="btn btn-success" onclick="salvarConfiguracaoRede()">
                    <i class="fas fa-save"></i> Salvar Configuração
                </button>
            </div>
            <div id="redeConfigStatus" class="p-3 rounded bg-light text-muted">
                ${config.fonte === 'estacao'
                    ? 'Configuração desta estação (arquivo local do computador). Alterações aqui afetam como o sistema inicia neste PC.'
                    : (modo === 'cliente'
                        ? 'Modo cliente selecionado. Informe o servidor remoto e teste a conexão.'
                        : 'Modo local selecionado. O sistema usará o backend local no próximo início.')}
            </div>
        </form>
    `;
}

async function abrirModalConfiguracaoRede(options = {}) {
    if (options.somenteSuperAdmin) {
        if (typeof isSuperAdminUser !== 'function' || !isSuperAdminUser()) {
            showNotification('Acesso negado. Apenas Super Administrador pode alterar a configuração de rede.', 'danger');
            return;
        }
    }

    $('#modal-container').html(`
        <div class="modal fade" id="modalConfiguracaoRede" tabindex="-1" aria-labelledby="modalConfiguracaoRedeLabel" aria-hidden="true">
            <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header bg-primary text-white">
                        <h5 class="modal-title" id="modalConfiguracaoRedeLabel">
                            <i class="fas fa-network-wired"></i> Configuração de Rede
                        </h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Fechar"></button>
                    </div>
                    <div class="modal-body" id="redeConfigCardContainer">
                        <div class="text-center py-4 text-muted">
                            <i class="fas fa-spinner fa-spin me-2"></i> Carregando configuração de rede...
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button>
                    </div>
                </div>
            </div>
        </div>
    `);

    const modalEl = document.getElementById('modalConfiguracaoRede');
    const modal = new bootstrap.Modal(modalEl);
    modal.show();
    await carregarConfiguracaoRede();
}

function aplicarEstadoConfiguracaoRede() {
    const modo = $('input[name="modoRede"]:checked').val() || 'local';
    const isCliente = modo === 'cliente';
    $('#containerClienteConfig').toggle(isCliente);
    $('#btnTestarConexaoServidor').prop('disabled', !isCliente);
    aplicarEstadoBotaoVoltarLocal();
}

async function estaEmModoClienteRemotoElectron() {
    if (!window.electronAPI || typeof window.electronAPI.estaEmModoClienteRemoto !== 'function') {
        return false;
    }

    try {
        return Boolean(await window.electronAPI.estaEmModoClienteRemoto());
    } catch (error) {
        console.error('Erro ao verificar modo cliente remoto:', error);
        return false;
    }
}

async function estacaoConectadaServidorRemoto() {
    const estacao = await obterEstadoRedeEstacaoLocal();
    const runtimeCliente = await estaEmModoClienteRemotoElectron();
    return runtimeCliente || estacao.modo === 'cliente';
}

async function obterEstadoRedeEstacaoLocal() {
    if (!window.electronAPI || typeof window.electronAPI.obterModoEstacao !== 'function') {
        return { modo: 'local', ipServidor: '', porta: 3001 };
    }

    try {
        return await window.electronAPI.obterModoEstacao();
    } catch (error) {
        console.error('Erro ao obter modo da estação:', error);
        return { modo: 'local', ipServidor: '', porta: 3001 };
    }
}

async function aplicarEstadoBotaoVoltarLocal() {
    const temElectron = Boolean(window.electronAPI && typeof window.electronAPI.voltarModoLocal === 'function');
    if (!temElectron) {
        $('#containerVoltarServidorLocal').hide();
        $('#containerVoltarServidorLocalRede').hide();
        return;
    }

    const estacao = await obterEstadoRedeEstacaoLocal();
    const modoCliente = await estacaoConectadaServidorRemoto();
    const destinoRemoto = estacao.ipServidor
        ? `${estacao.ipServidor}:${estacao.porta || 3001}`
        : (typeof window.electronAPI.obterServidorRemoto === 'function'
            ? (window.electronAPI.obterServidorRemoto() || '-')
            : '-');

    $('#lblServidorRemotoEstacao').text(destinoRemoto);
    $('#lblServidorRemotoEstacaoRede').text(destinoRemoto);
    $('#descricaoModoRedeEstacao').text(
        modoCliente
            ? 'Esta estação inicia conectada a um servidor remoto. Use o botão para voltar ao backend local.'
            : 'Esta estação está configurada para usar o servidor local integrado.'
    );
    $('#tituloModoRedeEstacao').text(
        modoCliente ? 'Estação em modo cliente' : 'Estação em modo local'
    );

    $('#containerVoltarServidorLocal').toggle(modoCliente);
    $('#containerVoltarServidorLocalRede').toggle(true);
    $('#btnVoltarServidorLocal').prop('disabled', !modoCliente);
    $('#btnVoltarServidorLocalRede').prop('disabled', !modoCliente);
}

async function voltarServidorLocalEstacao() {
    if (!window.electronAPI || typeof window.electronAPI.voltarModoLocal !== 'function') {
        showNotification('Disponível apenas no aplicativo desktop (Electron).', 'warning');
        return;
    }

    const botao = $('#btnVoltarServidorLocal, #btnVoltarServidorLocalRede');
    botao.prop('disabled', true);

    try {
        const resultado = await window.electronAPI.voltarModoLocal();
        if (resultado?.cancelado) {
            return;
        }
        if (!resultado?.sucesso) {
            throw new Error(resultado?.erro || 'Não foi possível voltar ao modo local.');
        }
    } catch (error) {
        console.error(error);
        showNotification(error.message || 'Erro ao voltar ao modo local.', 'danger');
    } finally {
        botao.prop('disabled', false);
    }
}

function fetchComTimeout(url, timeout = 15000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error('Timeout de conexão atingido'));
        }, timeout);

        fetch(url, {
            method: 'GET',
            cache: 'no-cache',
            credentials: 'same-origin'
        }).then((response) => {
            clearTimeout(timer);
            resolve(response);
        }).catch((error) => {
            clearTimeout(timer);
            reject(error);
        });
    });
}

async function testarConexaoServidor() {
    const modo = $('input[name="modoRede"]:checked').val() || 'local';
    const porta = Number($('#redePorta').val()) || 3001;
    const ipServidor = $('#redeIpServidor').val().trim();

    if (modo === 'cliente' && !ipServidor) {
        showNotification('Informe o IP do servidor remoto.', 'warning');
        return;
    }

    const urls = modo === 'cliente'
        ? [
            `http://${ipServidor}:${porta}/ping`,
            `http://${ipServidor}:${porta}/api/ping`
        ]
        : [`${window.location.origin}/api/ping`];

    const statusBox = $('#redeConfigStatus');
    statusBox.removeClass('bg-light bg-success bg-warning bg-danger').addClass('bg-light').text('Testando conexão...');

    let lastError = null;
    for (const url of urls) {
        try {
            const response = await fetchComTimeout(url, 15000);
            if (!response.ok) {
                lastError = new Error(`Resposta inválida do servidor: ${response.status}`);
                continue;
            }
            statusBox.removeClass('bg-light bg-warning bg-danger').addClass('bg-success text-white').text(`Conexão OK com ${url}`);
            showNotification('Conexão com o servidor testada com sucesso.', 'success');
            return;
        } catch (err) {
            lastError = err;
        }
    }

    const mensagem = lastError ? lastError.message : 'Falha desconhecida';
    statusBox.removeClass('bg-light bg-warning bg-success').addClass('bg-danger text-white').text(`Falha ao conectar: ${mensagem}`);
    showNotification(`Falha ao conectar no servidor: ${mensagem}`, 'danger');
}

async function salvarConfiguracaoRede() {
    const modo = $('input[name="modoRede"]:checked').val() || 'local';
    const porta = Number($('#redePorta').val()) || 3001;
    const ipServidor = $('#redeIpServidor').val().trim();

    if (modo === 'cliente' && !ipServidor) {
        showNotification('Informe o IP do servidor remoto antes de salvar.', 'warning');
        return;
    }

    const payload = {
        modo,
        porta,
        ipServidor: modo === 'cliente' ? ipServidor : ''
    };

    try {
        if (window.electronAPI && typeof window.electronAPI.salvarModoEstacao === 'function') {
            const resultado = await window.electronAPI.salvarModoEstacao(payload);

            if (!resultado || !resultado.sucesso) {
                throw new Error(resultado?.erro || 'Não foi possível salvar a configuração local da estação.');
            }

            window.configuracaoRedeAtual = payload;
            $('#redeConfigStatus')
                .removeClass('bg-light bg-warning bg-danger')
                .addClass('bg-success text-white')
                .text(resultado.reiniciado
                    ? 'Configuração salva. O sistema está reiniciando...'
                    : 'Configuração desta estação salva. Reinicie o sistema para aplicar, se necessário.');
            showNotification('Configuração de rede desta estação salva com sucesso.', 'success');
            await aplicarEstadoBotaoVoltarLocal();
            return;
        }

        const response = await fetch(`${API_URL}/configuracao-rede`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `HTTP ${response.status}`);
        }

        const result = await response.json();
        window.configuracaoRedeAtual = result.config;
        $('#redeConfigStatus').removeClass('bg-light bg-warning bg-danger').addClass('bg-success text-white').text('Configuração de rede salva. Reinicie o sistema para aplicar o modo selecionado.');
        showNotification('Configuração de rede salva com sucesso.', 'success');
    } catch (err) {
        console.error(err);
        $('#redeConfigStatus').removeClass('bg-light bg-warning bg-success').addClass('bg-danger text-white').text(`Erro ao salvar configuração: ${err.message}`);
        showNotification(`Erro ao salvar configuração de rede: ${err.message}`, 'danger');
    }
}

$(document).on('change', 'input[name="modoRede"]', aplicarEstadoConfiguracaoRede);

window.abrirModalConfiguracaoRede = abrirModalConfiguracaoRede;
window.carregarConfiguracaoRede = carregarConfiguracaoRede;
window.salvarConfiguracaoRede = salvarConfiguracaoRede;
window.testarConexaoServidor = testarConexaoServidor;
window.voltarServidorLocalEstacao = voltarServidorLocalEstacao;
window.aplicarEstadoBotaoVoltarLocal = aplicarEstadoBotaoVoltarLocal;
window.obterEstadoRedeEstacaoLocal = obterEstadoRedeEstacaoLocal;
window.estacaoConectadaServidorRemoto = estacaoConectadaServidorRemoto;
