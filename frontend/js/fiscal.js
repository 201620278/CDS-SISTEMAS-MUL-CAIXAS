let fiscalNotasCache = [];
let verTodasNotasFiscais = false;

// Função para formatar data/hora no fuso do Brasil
function formatarDataHoraBrasil(data) {
    if (!data) return '-';

    return new Date(data).toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

function loadFiscal() {
    renderFiscal();
    carregarFiscalNotas();
}

function toggleVerTodasNotasFiscais() {
    verTodasNotasFiscais = !verTodasNotasFiscais;
    carregarFiscalNotas();
}

function renderFiscal() {
    const avisoConfigAvancada = (typeof isSuperAdminUser === 'function' && isSuperAdminUser())
        ? `<div class="alert alert-info py-2 mb-3">
                <i class="fas fa-info-circle"></i>
                A configuração fiscal (certificado, CSC, numeração) está em
                <a href="#" onclick="loadPage('configuracoes-avancadas'); return false;">Configurações Avançadas</a>.
           </div>`
        : '';

    const html = `
        <div class="card shadow-sm">
            <div class="card-header d-flex justify-content-between align-items-center">
                <div><i class="fas fa-receipt"></i> Módulo Fiscal NFC-e</div>
            </div>
            <div class="card-body">
                ${avisoConfigAvancada}
                <ul class="nav nav-tabs mb-3">
                    <li class="nav-item">
                        <button class="nav-link active" data-bs-toggle="tab" data-bs-target="#fiscal-notas-tab" type="button">
                            NFC-e Emitidas
                        </button>
                    </li>
                    <li class="nav-item">
                        <button class="nav-link" data-bs-toggle="tab" data-bs-target="#fiscal-emissao-tab" type="button">
                            Emissão Manual
                        </button>
                    </li>
                    <li class="nav-item">
                        <button class="nav-link" data-bs-toggle="tab" data-bs-target="#fiscal-contabilidade-tab" type="button">
                            Exportar para Contabilidade
                        </button>
                    </li>
                </ul>

                <div class="tab-content">
                    <div class="tab-pane fade show active" id="fiscal-notas-tab">
                        <div class="row g-2 mb-3 align-items-end">
                            <div class="col-md-3">
                                <input type="text" id="fiscalBuscaNota" class="form-control" placeholder="Buscar por chave, venda ou protocolo" oninput="renderTabelaFiscalNotas()">
                            </div>
                            <div class="col-md-2">
                                <select id="fiscalFiltroStatus" class="form-select" onchange="renderTabelaFiscalNotas()">
                                    <option value="">Todos os status</option>
                                    <option value="autorizado">Autorizado</option>
                                    <option value="cancelado">Cancelada</option>
                                    <option value="rejeitada">Rejeitada</option>
                                    <option value="erro">Erro</option>
                                    <option value="pendente">Pendente</option>
                                </select>
                            </div>
                            <div class="col-md-2">
                                <label class="form-label small mb-0 text-muted">Data inicial</label>
                                <input type="date" id="fiscalFiltroDataInicio" class="form-control form-control-sm" onchange="renderTabelaFiscalNotas()">
                            </div>
                            <div class="col-md-2">
                                <label class="form-label small mb-0 text-muted">Data final</label>
                                <input type="date" id="fiscalFiltroDataFim" class="form-control form-control-sm" onchange="renderTabelaFiscalNotas()">
                            </div>
                            <div class="col-md-2">
                                <button class="btn btn-primary w-100" onclick="carregarFiscalNotas()">
                                    <i class="fas fa-rotate-right"></i> Atualizar
                                </button>
                            </div>
                            <div class="col-md-1">
                                <label class="form-check-label text-nowrap small" style="font-size:13px;">
                                    <input type="checkbox" class="form-check-input me-1" id="verTodasNotasFiscaisCheck" onchange="toggleVerTodasNotasFiscais()" ${verTodasNotasFiscais ? 'checked' : ''}>
                                    Todas
                                </label>
                            </div>
                        </div>
                        <div id="fiscal-notas-area"></div>
                    </div>

                    <div class="tab-pane fade" id="fiscal-emissao-tab">
                        <div class="row g-3">
                            <div class="col-md-8">
                                <label class="form-label">ID da venda</label>
                                <input type="number" min="1" id="fiscalVendaIdManual" class="form-control" placeholder="Digite o ID da venda">
                            </div>
                            <div class="col-md-4 d-flex align-items-end">
                                <button class="btn btn-primary w-100" onclick="buscarVendaParaNFCe()">
                                    <i class="fas fa-search"></i> Buscar Venda
                                </button>
                            </div>
                        </div>

                        <div id="dados-venda-nfce" class="mt-3"></div>

                        <button id="btnEmitirNFCe" class="btn btn-warning mt-3 d-none w-100" onclick="emitirNFCeDaVenda()">
                            <i class="fas fa-file-invoice"></i> Emitir NFC-e
                        </button>

                        <div class="alert alert-info mt-3 mb-0">
                            <i class="fas fa-info-circle"></i> Busque a venda pelo ID, confira os dados e clique em "Emitir NFC-e".
                        </div>
                    </div>

                    <div class="tab-pane fade" id="fiscal-contabilidade-tab">
                        <div class="card border-0 bg-light">
                            <div class="card-body">
                                <h6 class="fw-bold mb-3">
                                    <i class="fas fa-file-archive"></i> Exportar para Contabilidade
                                </h6>
                                <p class="text-muted small">
                                    Gera um arquivo ZIP com XMLs de NFC-e autorizadas, XMLs de NF-e de entrada,
                                    relatórios CSV e resumo do período selecionado.
                                </p>
                                <form id="formExportarContabilidade" onsubmit="event.preventDefault(); exportarContabilidadeFiscal(); return false;">
                                    <div class="row g-3">
                                        <div class="col-md-4">
                                            <label for="contabilidadeDataInicial" class="form-label fw-bold">Data Inicial</label>
                                            <input type="date" class="form-control" id="contabilidadeDataInicial" required>
                                        </div>
                                        <div class="col-md-4">
                                            <label for="contabilidadeDataFinal" class="form-label fw-bold">Data Final</label>
                                            <input type="date" class="form-control" id="contabilidadeDataFinal" required>
                                        </div>
                                        <div class="col-md-4 d-flex align-items-end">
                                            <button type="button" class="btn btn-success w-100" id="btnExportarContabilidade" onclick="exportarContabilidadeFiscal(); return false;">
                                                <i class="fas fa-file-archive"></i> Gerar Arquivo para Contabilidade
                                            </button>
                                        </div>
                                    </div>
                                </form>
                                <div id="contabilidadeExportStatus" class="mt-3"></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    $('#page-content').html(html);
}

function getFiscalField(label, id, value = '', help = '', type = 'text', onblur = '', oninput = '') {
    const onblurAttr = onblur ? ` onblur="${onblur}"` : '';
    const oninputAttr = oninput ? ` oninput="${oninput}"` : '';
    return `
        <div class="col-md-4 mb-3">
            <label class="form-label">${label}</label>
            <input type="${type}" class="form-control fiscal-field" id="${id}" value="${String(value || '').replace(/"/g, '&quot;')}"${onblurAttr}${oninputAttr}>
            ${help ? `<div class="form-text">${help}</div>` : ''}
        </div>
    `;
}

function carregarFiscalConfig(targetSelector = '#fiscal-config-form-area') {
    const $target = $(targetSelector);
    if (!$target.length) return;

    $.ajax({
        url: `${API_URL}/fiscal/config`,
        method: 'GET',
        success: function(cfg) {
            const html = `
                <div class="row">
                    <div class="col-md-4 mb-3">
                        <label class="form-label">Ambiente</label>
                        <select class="form-control fiscal-field" id="fiscal_ambiente">
                            <option value="">Selecione</option>
                            <option value="2" ${Number(cfg.ambiente) === 2 ? 'selected' : ''}>2 - Homologação</option>
                            <option value="1" ${Number(cfg.ambiente) === 1 ? 'selected' : ''}>1 - Produção</option>
                        </select>
                        <div class="form-text">Escolha manualmente o ambiente fiscal</div>
                        <div id="alertaAmbiente" class="mt-2"></div>
                    </div>
                    ${getFiscalField('UF', 'fiscal_uf_sigla', cfg.uf || 'CE')}
                    ${getFiscalField('Código UF', 'fiscal_codigo_uf', cfg.codigoUf || '23')}
                    ${getFiscalField('Série', 'fiscal_serie', cfg.serie || 1, '', 'number')}
                    <div class="col-md-4 mb-3">
                        <label class="form-label">Próximo Número NFC-e</label>
                        <input type="number" id="proximoNumeroNfce" class="form-control fiscal-field" min="1" placeholder="Ex: 5001">
                        <div class="form-text">Informe o próximo número da NFC-e. Exemplo: se a última NFC-e emitida foi 2458, informe 2459.</div>
                        <small style="color:red;" id="msgNumeroNfceSuperUser">Apenas SUPER ADMIN pode alterar a numeração NFC-e.</small>
                    </div>
                    <input type="hidden" class="fiscal-field" id="fiscal_numero_atual" value="${cfg.numeroAtual || 1}">
                    ${getFiscalField('Regime tributário CRT', 'fiscal_regime_tributario', cfg.crt || '1', '1 = Simples Nacional')}

                    ${getFiscalField('Nome da empresa', 'nome_empresa', cfg.nomeEmpresa || '')}
                    ${getFiscalField('CNPJ', 'cnpj', cfg.cnpj || '')}
                    ${getFiscalField('Inscrição Estadual', 'fiscal_ie', cfg.ie || '')}
                    ${getFiscalField('Telefone', 'telefone', cfg.telefone || '', '', 'text', '', 'formatPhone(this)')}
                    ${getFiscalField('Email', 'email', cfg.email || '')}

                    ${getFiscalField('Código do município', 'fiscal_municipio_codigo', cfg.municipioCodigo || '2307304')}
                    ${getFiscalField('Município', 'fiscal_municipio_nome', cfg.municipioNome || 'Juazeiro do Norte')}
                    ${getFiscalField('CEP emitente', 'fiscal_emitente_cep', cfg.cep || '', '', 'text', 'buscarCepFiscal(this.value)', 'formatCep(this)')}
                    ${getFiscalField('Logradouro', 'fiscal_emitente_logradouro', cfg.logradouro || '')}
                    ${getFiscalField('Número', 'fiscal_emitente_numero', cfg.numeroEndereco || 'S/N')}
                    ${getFiscalField('Bairro', 'fiscal_emitente_bairro', cfg.bairro || '')}

                    ${getFiscalField('ID CSC', 'fiscal_id_csc', cfg.idCSC || '')}
                    ${getFiscalField('Token CSC', 'fiscal_token_csc', cfg.tokenCSC || '')}

                    <div class="col-md-4 mb-3">
                        <label class="form-label">Enviar certificado A1 (.pfx)</label>
                        <input type="file" id="fiscal_certificado_upload" class="form-control" accept=".pfx">
                        <div class="form-text">Envie o certificado digital da empresa em formato .pfx</div>
                        <div class="form-text mt-2" style="color: ${cfg.certificadoPath ? 'green' : 'red'};">
                            ${cfg.certificadoPath ? 'Certificado ativo' : 'Certificado inativo'}
                        </div>
                    </div>
                    ${getFiscalField('Senha do certificado', 'fiscal_certificado_senha', cfg.certificadoSenha || '', '', 'password')}
                    <input type="hidden" class="fiscal-field" id="fiscal_certificado_path" value="${cfg.certificadoPath || ''}">
                    ${getFiscalField('Tipo impressão', 'fiscal_tp_imp', cfg.tpImp || 4, '4 = DANFE NFC-e')}
                    <div class="col-12">
                        <hr>
                        <h6 class="text-warning">URLs de Homologação</h6>
                    </div>

                    ${getFiscalField('URL consulta QRCode homologação', 'fiscal_csc_qrcode_url_homologacao', (cfg.urlsHomologacao && cfg.urlsHomologacao.consultaQr) || '')}
                    ${getFiscalField('URL consulta chave homologação', 'fiscal_consulta_chave_url_homologacao', (cfg.urlsHomologacao && cfg.urlsHomologacao.consultaChave) || '')}
                    ${getFiscalField('WS autorização homologação', 'fiscal_ws_autorizacao_homologacao', (cfg.urlsHomologacao && cfg.urlsHomologacao.autorizacao) || '')}
                    ${getFiscalField('WS retorno homologação', 'fiscal_ws_retorno_homologacao', (cfg.urlsHomologacao && cfg.urlsHomologacao.retorno) || '')}
                    ${getFiscalField('WS status homologação', 'fiscal_ws_status_homologacao', (cfg.urlsHomologacao && cfg.urlsHomologacao.status) || '')}

                    <div class="col-12">
                        <hr>
                        <h6 class="text-danger">URLs de Produção</h6>
                    </div>

                    ${getFiscalField('URL consulta QRCode produção', 'fiscal_csc_qrcode_url_producao', (cfg.urlsProducao && cfg.urlsProducao.consultaQr) || '')}
                    ${getFiscalField('URL consulta chave produção', 'fiscal_consulta_chave_url_producao', (cfg.urlsProducao && cfg.urlsProducao.consultaChave) || '')}
                    ${getFiscalField('WS autorização produção', 'fiscal_ws_autorizacao_producao', (cfg.urlsProducao && cfg.urlsProducao.autorizacao) || '')}
                    ${getFiscalField('WS retorno produção', 'fiscal_ws_retorno_producao', (cfg.urlsProducao && cfg.urlsProducao.retorno) || '')}
                    ${getFiscalField('WS status produção', 'fiscal_ws_status_producao', (cfg.urlsProducao && cfg.urlsProducao.status) || '')}
                </div>

                <div class="d-flex gap-2 flex-wrap align-items-center">
                    <button class="btn btn-success btn-sm" onclick="salvarConfigFiscal()">
                        <i class="fas fa-save"></i> Salvar tudo
                    </button>
                    <button class="btn btn-primary btn-sm" onclick="uploadCertificadoFiscal()">
                        <i class="fas fa-upload"></i> Enviar certificado
                    </button>
                    <button class="btn btn-secondary btn-sm" onclick="testarCertificadoFiscal()">
                        <i class="fas fa-certificate"></i> Testar certificado
                    </button>
                </div>
            `;

            $target.html(html);

            const proximoNumeroEl = $target.find('#proximoNumeroNfce')[0];
            if (proximoNumeroEl) {
                proximoNumeroEl.value = (parseInt(cfg.numeroAtual || 0) + 1);
            }

            const usuario = JSON.parse(localStorage.getItem('user') || '{}');
            const campoNumero = $target.find('#proximoNumeroNfce')[0];
            const msgNumero = $target.find('#msgNumeroNfceSuperUser')[0];

            if (campoNumero) {
                if (usuario.perfil !== 'SUPER_ADMIN') {
                    campoNumero.disabled = true;
                } else if (msgNumero) {
                    msgNumero.style.display = 'none';
                }
            }

            $target.find('#fiscal_ambiente').on('change', function () {
                const val = $(this).val();
                const $alerta = $target.find('#alertaAmbiente');

                if (val === '1') {
                    $alerta.html(`
                        <div class="alert alert-danger">
                            ⚠️ Você está em PRODUÇÃO. As notas terão valor fiscal real.
                        </div>
                    `);
                } else if (val === '2') {
                    $alerta.html(`
                        <div class="alert alert-warning">
                            🧪 Ambiente de HOMOLOGAÇÃO (teste sem valor fiscal).
                        </div>
                    `);
                } else {
                    $alerta.html('');
                }
            }).trigger('change');
        },
        error: function(xhr) {
            $target.html(`
                <div class="alert alert-danger">
                    Erro ao carregar configuração fiscal: ${xhr.responseJSON?.error || 'erro desconhecido'}
                </div>
            `);
        }
    });
}

function coletarPayloadFiscal() {
    const payload = {};

    $('.fiscal-field').each(function() {
        payload[$(this).attr('id')] = $(this).val();
    });

    return payload;
}

function salvarConfigFiscal() {
    // Validação do próximo número NFC-e
    const proximoNumero = parseInt(document.getElementById('proximoNumeroNfce').value);
    if (!proximoNumero || proximoNumero <= 0) {
        alert('Informe um próximo número NFC-e válido.');
        return;
    }

    const payload = coletarPayloadFiscal();

    // Calcular fiscal_numero_atual como (próximo número - 1)
    payload.fiscal_numero_atual = proximoNumero - 1;

    $.ajax({
        url: `${API_URL}/fiscal/config`,
        method: 'PUT',
        contentType: 'application/json',
        data: JSON.stringify(payload),
        success: function() {
            showNotification('Configuração fiscal salva com sucesso!');
            if ($('#fiscal-config-form-area-avancadas').length) {
                carregarFiscalConfig('#fiscal-config-form-area-avancadas');
            } else {
                carregarFiscalConfig();
            }
        },
        error: function(xhr) {
            showNotification(xhr.responseJSON?.error || 'Erro ao salvar configuração fiscal.', 'danger');
        }
    });
}

function testarCertificadoFiscal() {
    const certificadoPath = $('#fiscal_certificado_path').val();
    const senha = $('#fiscal_certificado_senha').val();

    $.ajax({
        url: `${API_URL}/fiscal/config/certificado/testar`,
        method: 'POST',
        contentType: 'application/json',
        data: JSON.stringify({ certificadoPath, senha }),
        success: function(resp) {
            showNotification(`Certificado validado com sucesso. Tamanho base64: ${resp.certBase64Length}`);
        },
        error: function(xhr) {
            showNotification(xhr.responseJSON?.error || 'Falha ao validar certificado.', 'danger');
        }
    });
}

function uploadCertificadoFiscal() {
    const input = document.getElementById('fiscal_certificado_upload');

    if (!input || !input.files || !input.files.length) {
        showNotification('Selecione um arquivo .pfx para enviar.', 'warning');
        return;
    }

    const formData = new FormData();
    formData.append('certificado', input.files[0]);

    $.ajax({
        url: `${API_URL}/fiscal/certificado/upload`,
        method: 'POST',
        data: formData,
        processData: false,
        contentType: false,
        success: function(resp) {
            $('#fiscal_certificado_path').val(resp.path || '');
            showNotification('Certificado enviado com sucesso!');
        },
        error: function(xhr) {
            showNotification(xhr.responseJSON?.error || 'Erro ao enviar certificado.', 'danger');
        }
    });
}

function carregarFiscalNotas() {
    let url = `${API_URL}/fiscal/notas`;
    if (verTodasNotasFiscais) {
        url += '?todas=1';
    }
    $.ajax({
        url: url,
        method: 'GET',
        success: function(notas) {
            fiscalNotasCache = Array.isArray(notas) ? notas : [];

            // Debug: mostrar status únicos
            const statusUnicos = [...new Set(fiscalNotasCache.map(n => n.status).filter(Boolean))];
            console.log('Status únicos encontrados:', statusUnicos);

            renderTabelaFiscalNotas();
        },
        error: function(xhr) {
            $('#fiscal-notas-area').html(`
                <div class="alert alert-danger">
                    Erro ao carregar NFC-e: ${xhr.responseJSON?.error || 'erro desconhecido'}
                </div>
            `);
        }
    });
}

function renderTabelaFiscalNotas() {
    const termo = ($('#fiscalBuscaNota').val() || '').toLowerCase().trim();
    const status = ($('#fiscalFiltroStatus').val() || '').toLowerCase().trim();
    const dataInicio = $('#fiscalFiltroDataInicio').val();
    const dataFim = $('#fiscalFiltroDataFim').val();

    console.log('Filtro status:', status, 'Total notas:', fiscalNotasCache.length);

    const notas = fiscalNotasCache.filter(n => {
        const matchTermo = !termo || [n.chave_acesso, n.venda_codigo, n.protocolo, n.recibo, n.xml_retorno, n.xml_enviado]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(termo);

        const notaStatus = String(n.status || '').toLowerCase().trim();
        let matchStatus = true;
        if (status) {
            if (status === 'autorizado') {
                matchStatus = notaStatus === 'autorizada' || notaStatus.includes('autoriz');
            } else if (status === 'cancelado') {
                matchStatus = notaStatus === 'cancelada' || notaStatus.includes('cancel');
            } else {
                matchStatus = notaStatus.includes(status);
            }
        }

        // Filtro por data
        let matchData = true;
        if (n.created_at) {
            const notaData = new Date(n.created_at);
            const notaDataStr = notaData.toISOString().split('T')[0];

            if (dataInicio && notaDataStr < dataInicio) {
                matchData = false;
            }
            if (dataFim && notaDataStr > dataFim) {
                matchData = false;
            }
        } else if (dataInicio || dataFim) {
            matchData = false;
        }

        return matchTermo && matchStatus && matchData;
    });

    console.log('Notas filtradas:', notas.length, 'de', fiscalNotasCache.length);

    const html = `
        <div class="table-responsive">
            <table class="table table-striped table-hover align-middle">
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Venda</th>
                        <th>Situação</th>
                        <th>Chave</th>
                        <th>Protocolo</th>
                        <th>Data</th>
                        <th>Ações</th>
                    </tr>
                </thead>
                <tbody>
                    ${notas.length ? notas.map(n => `
                        <tr>
                            <td>${n.id}</td>
                            <td>${n.venda_codigo || n.venda_id || '-'}</td>
                            <td><span class="badge ${getBadgeFiscalClass(n.status)}">${n.status || 'pendente'}</span></td>
                            <td style="max-width:220px; word-break:break-all;">${n.chave_acesso || '-'}</td>
                            <td>${n.protocolo || '-'}</td>
                            <td>${formatarDataHoraBrasil(n.created_at)}</td>
                            <td>
                                <button class="btn btn-sm btn-info" onclick="verDetalheFiscal(${n.id})" title="Visualizar">
                                    <i class="fas fa-eye"></i>
                                </button>

                                ${String(n.status || '').toLowerCase().includes('autoriz') || String(n.status || '').toLowerCase() === 'cancelamento_rejeitado' ? `
                                    <button class="btn btn-sm btn-danger ms-1" onclick="cancelarNfce(${n.id})" title="Cancelar NFC-e">
                                        <i class="fas fa-ban"></i>
                                    </button>
                                ` : ''}
                            </td>
                        </tr>
                    `).join('') : `
                        <tr>
                            <td colspan="7" class="text-center text-muted">Nenhuma NFC-e encontrada.</td>
                        </tr>
                    `}
                </tbody>
            </table>
        </div>
    `;

    $('#fiscal-notas-area').html(html);
}

function getBadgeFiscalClass(status) {
    const s = String(status || '').toLowerCase();

    if (s.includes('autoriz')) return 'bg-success';
    if (s.includes('cancel')) return 'bg-dark';
    if (s.includes('rejeit')) return 'bg-danger';
    if (s.includes('erro')) return 'bg-warning text-dark';

    return 'bg-secondary';
}

function verDetalheFiscal(id) {
    $.ajax({
        url: `${API_URL}/fiscal/notas/${id}`,
        method: 'GET',
        success: function(nota) {
            const modalHtml = `
                <div class="modal fade" id="modalDetalheFiscal" tabindex="-1">
                    <div class="modal-dialog modal-xl modal-dialog-scrollable">
                        <div class="modal-content">
                            <div class="modal-header">
                                <h5 class="modal-title">Detalhe NFC-e #${nota.id}</h5>
                                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                            </div>
                            <div class="modal-body">
                                <div class="row mb-3">
                                    <div class="col-md-4"><strong>Venda:</strong> ${nota.venda_codigo || nota.venda_id || '-'}</div>
                                    <div class="col-md-4"><strong>Status:</strong> ${nota.status || '-'}</div>
                                    <div class="col-md-4"><strong>Protocolo:</strong> ${nota.protocolo || '-'}</div>
                                </div>

                                <div class="mb-2">
                                    <strong>Chave de acesso:</strong><br>${nota.chave_acesso || '-'}
                                </div>

                                <hr>

                                <h6>XML Enviado</h6>
                                <textarea class="form-control mb-3" rows="12" readonly>${nota.xml_enviado || ''}</textarea>

                                <h6>XML de Retorno</h6>
                                <textarea class="form-control" rows="12" readonly>${nota.xml_retorno || ''}</textarea>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            $('#modal-container').html(modalHtml);
            new bootstrap.Modal(document.getElementById('modalDetalheFiscal')).show();
        },
        error: function(xhr) {
            showNotification(xhr.responseJSON?.error || 'Erro ao buscar detalhe da NFC-e.', 'danger');
        }
    });
}

function emitirFiscalManual() {
    const vendaId = Number($('#fiscalVendaIdManual').val());

    if (!vendaId) {
        showNotification('Informe um ID de venda válido.', 'warning');
        return;
    }

    $.ajax({
        url: `${API_URL}/fiscal/emitir/venda/${vendaId}`,
        method: 'POST',
        success: function(resp) {
            if (resp?.danfeHtml) {
                imprimirHtmlFiscal(resp.danfeHtml);
            }

            showNotification(resp?.message || 'Processo fiscal executado.');
            carregarFiscalNotas();
        },
        error: function(xhr) {
            showNotification(xhr.responseJSON?.error || 'Erro ao emitir NFC-e.', 'danger');
        }
    });
}

// Variável para armazenar dados da venda buscada
let vendaNFCeCache = null;

function buscarVendaParaNFCe() {
    const vendaId = Number($('#fiscalVendaIdManual').val());

    if (!vendaId) {
        showNotification('Informe o ID da venda.', 'warning');
        return;
    }

    $.ajax({
        url: `${API_URL}/vendas/${vendaId}/detalhes`,
        method: 'GET',
        success: function(data) {
            vendaNFCeCache = data;

            let html = `
                <div class="card shadow-sm">
                    <div class="card-header bg-light">
                        <h6 class="mb-0"><i class="fas fa-shopping-cart"></i> Venda #${data.venda.id}</h6>
                    </div>
                    <div class="card-body">
                        <div class="row mb-3">
                            <div class="col-md-6">
                                <p class="mb-1"><strong>Cliente:</strong> ${data.venda.cliente_nome || 'Consumidor Final'}</p>
                                <p class="mb-1"><strong>Data:</strong> ${formatarDataHoraBrasil(data.venda.data_venda)}</p>
                            </div>
                            <div class="col-md-6 text-md-end">
                                <p class="mb-1"><strong>Total:</strong> <span class="h5 text-success">${dinheiro(data.venda.total)}</span></p>
                                <p class="mb-1"><strong>Forma:</strong> ${data.venda.forma_pagamento}</p>
                            </div>
                        </div>

                        <table class="table table-sm table-striped">
                            <thead>
                                <tr>
                                    <th>Produto</th>
                                    <th class="text-center">Qtd</th>
                                    <th class="text-end">Preço Unit.</th>
                                    <th class="text-end">Subtotal</th>
                                </tr>
                            </thead>
                            <tbody>
            `;

            data.itens.forEach(item => {
                html += `
                    <tr>
                        <td>${item.produto_nome}</td>
                        <td class="text-center">${item.quantidade}</td>
                        <td class="text-end">${dinheiro(item.preco_unitario || item.preco)}</td>
                        <td class="text-end">${dinheiro(item.subtotal)}</td>
                    </tr>
                `;
            });

            html += `
                            </tbody>
                        </table>
                    </div>
                </div>
            `;

            $('#dados-venda-nfce').html(html);
            $('#btnEmitirNFCe').removeClass('d-none');

            showNotification('Venda encontrada! Confira os dados antes de emitir.', 'success');
        },
        error: function(xhr) {
            vendaNFCeCache = null;
            $('#dados-venda-nfce').html('');
            $('#btnEmitirNFCe').addClass('d-none');
            showNotification(xhr.responseJSON?.error || 'Erro ao buscar venda.', 'danger');
        }
    });
}

function emitirNFCeDaVenda() {
    if (!vendaNFCeCache) {
        showNotification('Busque uma venda primeiro.', 'warning');
        return;
    }

    const vendaId = vendaNFCeCache.venda.id;

    $.ajax({
        url: `${API_URL}/fiscal/emitir/venda/${vendaId}`,
        method: 'POST',
        success: function(resp) {
            if (resp?.danfeHtml) {
                imprimirHtmlFiscal(resp.danfeHtml);
            }

            showNotification(resp?.message || 'NFC-e emitida com sucesso!', 'success');
            carregarFiscalNotas();

            // Limpar cache e dados
            vendaNFCeCache = null;
            $('#dados-venda-nfce').html('');
            $('#btnEmitirNFCe').addClass('d-none');
            $('#fiscalVendaIdManual').val('');
        },
        error: function(xhr) {
            showNotification(xhr.responseJSON?.error || 'Erro ao emitir NFC-e.', 'danger');
        }
    });
}

function imprimirHtmlFiscal(html) {
    const win = window.open('', '_blank', 'width=420,height=800');

    if (!win) {
        showNotification('Permita popups para imprimir o DANFE NFC-e.', 'warning');
        return;
    }

    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();

    setTimeout(() => win.print(), 500);
}

// Buscar CEP para configuração fiscal
function buscarCepFiscal(cep) {
    if (!cep || cep.length < 8) return;

    // Remover caracteres não numéricos
    cep = cep.replace(/\D/g, '');

    if (cep.length !== 8) return;

    // Mostrar loading
    showNotification('Buscando endereço fiscal...', 'info');

    fetch(`https://viacep.com.br/ws/${cep}/json/`)
        .then(response => response.json())
        .then(data => {
            if (data.erro) {
                showNotification('CEP não encontrado.', 'warning');
                return;
            }

            // Preencher os campos fiscais
            $('#fiscal_emitente_logradouro').val(data.logradouro || '');
            $('#fiscal_emitente_bairro').val(data.bairro || '');
            $('#fiscal_municipio_nome').val(data.localidade || '');
            $('#fiscal_uf_sigla').val(data.uf || '');

            showNotification('Endereço fiscal preenchido automaticamente.');
        })
        .catch(error => {
            console.error('Erro ao buscar CEP fiscal:', error);
            showNotification('Erro ao buscar CEP. Tente novamente.', 'danger');
        });
}

// Formatar telefone
function formatPhone(input) {
    let value = input.value.replace(/\D/g, '');
    if (value.length <= 11) {
        value = value.replace(/(\d{2})(\d{1})(\d{4})(\d{4})/, '($1)$2.$3-$4');
        input.value = value;
    }
}

// Formatar CEP
function cancelarNfce(id) {
    const modalHtml = `
        <div class="modal fade" id="modalCancelarNfce" tabindex="-1">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header bg-danger text-white">
                        <h5 class="modal-title"><i class="fas fa-ban"></i> Cancelar NFC-e #${id}</h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <label class="form-label fw-bold">Justificativa do cancelamento (mínimo 15 caracteres):</label>
                        <textarea id="justificativaCancelarNfce" class="form-control" rows="4" maxlength="255" placeholder="Ex: Erro na emissão da nota fiscal..."></textarea>
                        <div class="form-text text-end"><span id="contarCharsCancelar">0</span>/255</div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                        <button type="button" class="btn btn-danger" id="btnConfirmarCancelarNfce">
                            <i class="fas fa-ban"></i> Confirmar Cancelamento
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    $('#modal-container').html(modalHtml);
    const modalEl = document.getElementById('modalCancelarNfce');
    const modal = new bootstrap.Modal(modalEl);

    const textarea = document.getElementById('justificativaCancelarNfce');
    const contador = document.getElementById('contarCharsCancelar');
    textarea.addEventListener('input', () => {
        contador.textContent = textarea.value.length;
    });

    document.getElementById('btnConfirmarCancelarNfce').addEventListener('click', () => {
        const justificativa = textarea.value.trim();

        if (!justificativa || justificativa.length < 15) {
            showNotification('A justificativa precisa ter no mínimo 15 caracteres.', 'warning');
            textarea.focus();
            return;
        }

        modal.hide();

        $.ajax({
            url: `${API_URL}/fiscal/notas/${id}/cancelar`,
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ justificativa }),
            success: function(resp) {
                showNotification(resp.message || 'Cancelamento enviado com sucesso.');
                carregarFiscalNotas();
            },
            error: function(xhr) {
                const resp = xhr.responseJSON || {};
                showNotification(resp.error || resp.message || 'Erro ao cancelar NFC-e.', 'danger');
            }
        });
    });

    modal.show();
}

function definirPeriodoContabilidadePadrao() {
    const hoje = new Date();
    const ano = hoje.getFullYear();
    const mes = String(hoje.getMonth() + 1).padStart(2, '0');
    const ultimoDia = new Date(ano, hoje.getMonth() + 1, 0).getDate();
    const inicio = `${ano}-${mes}-01`;
    const fim = `${ano}-${mes}-${String(ultimoDia).padStart(2, '0')}`;

    $('#contabilidadeDataInicial').val(inicio);
    $('#contabilidadeDataFinal').val(fim);
}

async function exportarContabilidadeFiscal() {
    const dataInicial = $('#contabilidadeDataInicial').val();
    const dataFinal = $('#contabilidadeDataFinal').val();
    const $status = $('#contabilidadeExportStatus');
    const $btn = $('#btnExportarContabilidade');

    if (!dataInicial || !dataFinal) {
        showNotification('Informe a data inicial e a data final.', 'warning');
        return false;
    }

    if (dataInicial > dataFinal) {
        showNotification('A data inicial não pode ser maior que a data final.', 'warning');
        return false;
    }

    const textoOriginal = $btn.html();
    $btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Gerando...');
    $status.html('<div class="alert alert-info mb-0"><i class="fas fa-spinner fa-spin"></i> Preparando exportação...</div>');

    try {
        const response = await fetch(`${API_URL}/fiscal/exportar-contabilidade`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({ dataInicial, dataFinal })
        });

        if (!response.ok) {
            let mensagem = 'Erro ao gerar arquivo para contabilidade.';
            try {
                const erroJson = await response.json();
                mensagem = erroJson.error || mensagem;
            } catch (e) {
                // mantém mensagem padrão
            }
            throw new Error(mensagem);
        }

        const blob = await response.blob();
        const [anoRef, mesRef] = dataFinal.split('-');
        const nomeArquivo = response.headers.get('X-Export-Filename')
            || `CONTABILIDADE_${anoRef}_${mesRef}.zip`;

        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = nomeArquivo;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);

        let arquivos = [];
        let resumo = null;

        try {
            arquivos = JSON.parse(response.headers.get('X-Export-Arquivos') || '[]');
        } catch (e) {
            arquivos = [];
        }

        try {
            resumo = JSON.parse(response.headers.get('X-Export-Resumo') || 'null');
        } catch (e) {
            resumo = null;
        }

        const listaArquivos = arquivos.length
            ? `<ul class="mb-0 mt-2">${arquivos.map((item) => `<li><code>${item}</code></li>`).join('')}</ul>`
            : '';

        const resumoHtml = resumo
            ? `<div class="small text-muted mt-2">
                    Período: ${resumo.periodo}<br>
                    NFC-e: ${resumo.quantidadeNfce} | Vendas: R$ ${Number(resumo.valorTotalVendas || 0).toFixed(2)}<br>
                    Entradas: ${resumo.quantidadeEntradas} | Compras: R$ ${Number(resumo.valorTotalCompras || 0).toFixed(2)}
               </div>`
            : '';

        $status.html(`
            <div class="alert alert-success mb-0">
                <strong>Arquivo gerado com sucesso:</strong> <code>${nomeArquivo}</code>
                ${resumoHtml}
                ${listaArquivos}
            </div>
        `);

        showNotification('Arquivo para contabilidade gerado com sucesso.', 'success');
    } catch (err) {
        console.error(err);
        $status.html(`<div class="alert alert-danger mb-0">${err.message || 'Erro ao exportar.'}</div>`);
        showNotification(err.message || 'Erro ao exportar para contabilidade.', 'danger');
    } finally {
        $btn.prop('disabled', false).html(textoOriginal);
    }

    return false;
}

$(document).on('shown.bs.tab', 'button[data-bs-target="#fiscal-contabilidade-tab"]', definirPeriodoContabilidadePadrao);

function formatCep(input) {
    let value = input.value.replace(/\D/g, '');
    if (value.length <= 8) {
        value = value.replace(/(\d{5})(\d{3})/, '$1-$2');
        input.value = value;
    }
}
