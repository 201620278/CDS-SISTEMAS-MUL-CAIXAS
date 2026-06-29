/**
 * Nome amigável do terminal PDV (identificação no Gerenciar Caixas).
 */

function obterHostnameTerminalPdv() {
    if (typeof window.terminalHostname === 'string' && window.terminalHostname.trim()) {
        return window.terminalHostname.trim();
    }
    try {
        return String(sessionStorage.getItem('cds_estacao_hostname') || '').trim();
    } catch (e) {
        return '';
    }
}

function obterNomeTerminalPdvAtual() {
    if (typeof window.terminalNome === 'string' && window.terminalNome.trim()) {
        return window.terminalNome.trim();
    }
    return '';
}

function rotuloExibicaoTerminalPdv() {
    const hostname = obterHostnameTerminalPdv();
    const nome = obterNomeTerminalPdvAtual();
    if (nome && nome !== hostname) return nome;
    return hostname || '—';
}

function atualizarRotuloTerminalPdvSidebar() {
    const el = document.getElementById('pdv-terminal-rotulo');
    if (!el) return;

    const hostname = obterHostnameTerminalPdv();
    const nome = obterNomeTerminalPdvAtual();
    const temNomeCustom = Boolean(nome && hostname && nome !== hostname);

    el.classList.remove('text-info', 'text-muted', 'text-warning');

    if (temNomeCustom) {
        el.innerHTML = `<i class="fas fa-tag"></i> PDV: <strong>${escapeHtmlNomeTerminal(nome)}</strong>`;
        el.classList.add('text-info');
        el.style.display = 'block';
        return;
    }

    if (hostname) {
        el.innerHTML = `<i class="fas fa-desktop"></i> PC: <code>${escapeHtmlNomeTerminal(hostname)}</code> <span class="text-warning">(sem nome)</span>`;
        el.classList.add('text-muted');
        el.style.display = 'block';
        return;
    }

    el.style.display = 'none';
    el.textContent = '';
}

function escapeHtmlNomeTerminal(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

async function resolverHostnameParaNomear() {
    let hostname = obterHostnameTerminalPdv();

    if (!hostname && window.electronAPI && typeof window.electronAPI.getTerminalInfo === 'function') {
        const info = window.electronAPI.getTerminalInfo();
        if (info?.hostname) {
            hostname = String(info.hostname).trim();
        }
    }

    if (!hostname && typeof resolverHostnameEstacao === 'function') {
        hostname = await resolverHostnameEstacao();
    }

    return hostname || '';
}

async function abrirModalNomeTerminalPdv(options = {}) {
    if (options.somenteSuperAdmin) {
        if (typeof isSuperAdminUser !== 'function' || !isSuperAdminUser()) {
            showNotification('Acesso negado. Apenas Super Administrador pode nomear este PDV.', 'danger');
            return;
        }
    }

    const hostname = await resolverHostnameParaNomear();
    if (!hostname) {
        showNotification('Hostname do computador não detectado. Abra o PDV pelo aplicativo Electron.', 'warning');
        return;
    }

    const nomeAtual = obterNomeTerminalPdvAtual();
    const valorInicial = nomeAtual && nomeAtual !== hostname ? nomeAtual : '';

    $('#modal-container').html(`
        <div class="modal fade" id="modalNomeTerminalPdv" tabindex="-1" aria-labelledby="modalNomeTerminalPdvLabel" aria-hidden="true">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header bg-primary text-white">
                        <h5 class="modal-title" id="modalNomeTerminalPdvLabel">
                            <i class="fas fa-tag"></i> Nome deste PDV
                        </h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Fechar"></button>
                    </div>
                    <div class="modal-body">
                        <p class="text-muted small mb-3">
                            Este nome aparece no <strong>Gerenciar Caixas</strong> do ERP para você saber qual computador vincular a cada caixa.
                        </p>
                        <div class="mb-3">
                            <label class="form-label text-muted">Identificador do PC (hostname)</label>
                            <input type="text" class="form-control" id="nomeTerminalHostname" value="${escapeHtmlNomeTerminal(hostname)}" readonly>
                        </div>
                        <div class="mb-3">
                            <label for="nomeTerminalPdvInput" class="form-label fw-bold">Nome do PDV <span class="text-danger">*</span></label>
                            <input type="text" class="form-control" id="nomeTerminalPdvInput" value="${escapeHtmlNomeTerminal(valorInicial)}" maxlength="80" placeholder="Ex: Caixa Frente, PDV 02 - Açougue">
                            <small class="text-muted d-block mt-1">Use um nome que a equipe reconheça na loja.</small>
                        </div>
                        <div class="mb-2">
                            <span class="text-muted small me-1">Sugestões:</span>
                            <button type="button" class="btn btn-outline-secondary btn-sm me-1 mb-1" onclick="aplicarSugestaoNomeTerminalPdv('Caixa Frente')">Caixa Frente</button>
                            <button type="button" class="btn btn-outline-secondary btn-sm me-1 mb-1" onclick="aplicarSugestaoNomeTerminalPdv('Caixa 02')">Caixa 02</button>
                            <button type="button" class="btn btn-outline-secondary btn-sm me-1 mb-1" onclick="aplicarSugestaoNomeTerminalPdv('PDV Açougue')">PDV Açougue</button>
                            <button type="button" class="btn btn-outline-secondary btn-sm mb-1" onclick="aplicarSugestaoNomeTerminalPdv('PDV Padaria')">PDV Padaria</button>
                        </div>
                        <div id="nomeTerminalPdvStatus" class="small text-muted"></div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                        <button type="button" class="btn btn-success" onclick="salvarNomeTerminalPdv()">
                            <i class="fas fa-save"></i> Salvar nome
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `);

    const modalEl = document.getElementById('modalNomeTerminalPdv');
    const modal = new bootstrap.Modal(modalEl);
    modal.show();
    setTimeout(() => document.getElementById('nomeTerminalPdvInput')?.focus(), 300);
}

function aplicarSugestaoNomeTerminalPdv(nome) {
    const input = document.getElementById('nomeTerminalPdvInput');
    if (input) input.value = nome;
}

async function salvarNomeTerminalPdv() {
    const hostname = document.getElementById('nomeTerminalHostname')?.value?.trim() || obterHostnameTerminalPdv();
    const nome = document.getElementById('nomeTerminalPdvInput')?.value?.trim() || '';
    const statusEl = document.getElementById('nomeTerminalPdvStatus');

    if (!hostname) {
        showNotification('Hostname do terminal não encontrado.', 'warning');
        return;
    }

    if (!nome) {
        if (statusEl) statusEl.textContent = 'Informe um nome para o PDV.';
        showNotification('Informe um nome para identificar este PDV.', 'warning');
        return;
    }

    if (statusEl) statusEl.textContent = 'Salvando...';

    try {
        const headers = {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('token')}`
        };
        const payload = JSON.stringify({ hostname, nome });
        const endpoints = [
            { method: 'PUT', url: `${API_URL}/terminais/auto/nome` },
            { method: 'POST', url: `${API_URL}/terminais/auto/nome` }
        ];

        let response = null;
        for (const endpoint of endpoints) {
            response = await fetch(endpoint.url, {
                method: endpoint.method,
                headers,
                body: payload
            });
            if (response.status !== 404) break;
        }

        if (response && response.status === 404 && window.terminalId) {
            response = await fetch(`${API_URL}/terminais/${window.terminalId}`, {
                method: 'PUT',
                headers,
                body: JSON.stringify({ nome })
            });
        }

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            if (response.status === 404) {
                throw new Error('Servidor sem a rota de nomeação. Reinicie o PC servidor (backend) e atualize o sistema.');
            }
            throw new Error(data.error || `HTTP ${response.status}`);
        }

        window.terminalId = data.id;
        window.terminalNome = data.nome || nome;
        if (typeof terminalId !== 'undefined') terminalId = data.id;
        if (typeof terminalNome !== 'undefined') terminalNome = data.nome || nome;
        if (typeof sincronizarTerminalGlobalsPdv === 'function') sincronizarTerminalGlobalsPdv();

        atualizarRotuloTerminalPdvSidebar();
        showNotification(`PDV nomeado como "${nome}". No ERP, procure este nome em Gerenciar Caixas.`, 'success');

        const modalEl = document.getElementById('modalNomeTerminalPdv');
        const modal = modalEl ? bootstrap.Modal.getInstance(modalEl) : null;
        if (modal) modal.hide();
    } catch (err) {
        console.error(err);
        if (statusEl) statusEl.textContent = err.message || 'Erro ao salvar nome.';
        showNotification(err.message || 'Erro ao salvar nome do PDV.', 'danger');
    }
}

window.abrirModalNomeTerminalPdv = abrirModalNomeTerminalPdv;
window.salvarNomeTerminalPdv = salvarNomeTerminalPdv;
window.aplicarSugestaoNomeTerminalPdv = aplicarSugestaoNomeTerminalPdv;
window.atualizarRotuloTerminalPdvSidebar = atualizarRotuloTerminalPdvSidebar;
window.rotuloExibicaoTerminalPdv = rotuloExibicaoTerminalPdv;
