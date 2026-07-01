let vendasList = [];
let termoBuscaVendas = '';
let verTodasVendas = true;

function loadVendas() {
    let url = `${API_URL}/vendas`;
    const params = [];

    if (termoBuscaVendas) {
        params.push(`busca=${encodeURIComponent(termoBuscaVendas)}`);
    }
    if (verTodasVendas) {
        params.push('todas=1');
    }

    if (typeof modoFiscalAtivoSistema === 'function' && modoFiscalAtivoSistema()) {
        params.push('modo=fiscal');
    }
    if (params.length) {
        url += '?' + params.join('&');
    }

    $.ajax({ url, method: 'GET' })
        .done(function(vendas) {
            vendasList = vendas || [];
            renderVendas(vendasList);
        })
        .fail(function() {
            $('#page-content').html('<div class="alert alert-danger">Erro ao carregar histórico de vendas.</div>');
        });
}

function buscarVendasHistorico() {
    termoBuscaVendas = $('#buscaHistoricoVendas').val().trim();
    loadVendas();
}

function limparBuscaVendasHistorico() {
    termoBuscaVendas = '';
    $('#buscaHistoricoVendas').val('');
    loadVendas();
}

function toggleVerTodasVendas() {
    verTodasVendas = !verTodasVendas;
    loadVendas();
}

function renderVendas(vendas) {
    const modoFiscal = historicoVendaModoFiscalAtivo();

    const html = `
        <div class="card">
            <div class="card-header d-flex justify-content-between align-items-center">
                <div><i class="fas fa-receipt"></i> Histórico de Vendas</div>
                <div class="d-flex gap-2 align-items-center">
                    <label class="form-check-label text-nowrap" style="font-size:14px;">
                        <input type="checkbox" class="form-check-input me-1" id="verTodasVendasCheck" onchange="toggleVerTodasVendas()" ${verTodasVendas ? 'checked' : ''}>
                        Ver todas
                    </label>
                    <button class="btn btn-primary btn-sm" onclick="loadVendas()"><i class="fas fa-sync"></i> Atualizar</button>
                </div>
            </div>
            <div class="card-body">
                <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">
                    <small class="text-muted">${vendas.length} venda(s) encontrada(s)</small>
                    ${!verTodasVendas ? '<small class="text-warning"><i class="fas fa-filter"></i> Exibindo apenas vendas de hoje</small>' : ''}
                </div>
                <div class="row mb-3">
                    <div class="col-md-8">
                        <input
                            type="text"
                            id="buscaHistoricoVendas"
                            class="form-control"
                            placeholder="Buscar por ID, código, cliente, forma de pagamento ou status..."
                            value="${escapeHtml(termoBuscaVendas)}"
                            onkeydown="if(event.key === 'Enter') buscarVendasHistorico()"
                        >
                    </div>
                    <div class="col-md-4 d-flex gap-2">
                        <button class="btn btn-success" onclick="buscarVendasHistorico()">
                            <i class="fas fa-search"></i> Buscar
                        </button>
                        <button class="btn btn-secondary" onclick="limparBuscaVendasHistorico()">
                            <i class="fas fa-times"></i> Limpar
                        </button>
                    </div>
                </div>

                <div class="table-responsive historico-vendas-tabela">
                    <table class="table table-striped table-hover">
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>Código</th>
                                <th>Data</th>
                                <th>Cliente</th>
                                <th>${modoFiscal ? 'Total fiscal' : 'Total'}</th>
                                <th>Forma</th>
                                <th>Status</th>
                                <th class="historico-venda-acoes-col">Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${vendas.map(v => `
                                <tr>
                                    <td>${v.id || '-'}</td>
                                    <td>${escapeHtml(v.codigo || '-')}</td>
                                    <td>${formatDate(v.data_venda || v.created_at)}</td>
                                    <td>${escapeHtml(v.cliente_nome || 'Não informado')}</td>
                                    <td>${formatCurrency(modoFiscal ? (v.valor_fiscal ?? v.total) : v.total)}</td>
                                    <td>${rotuloFormaPagamento(v.forma_pagamento)}</td>
                                    <td>${rotuloStatusVenda(v.status)}</td>
                                    <td class="historico-venda-acoes-col">${montarHtmlAcoesHistoricoVenda(v)}</td>
                                </tr>
                            `).join('') || '<tr><td colspan="8" class="text-center">Nenhuma venda encontrada.</td></tr>'}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;

    $('#page-content').html(html);
}

function viewVenda(id) {
    $.ajax({ url: `${API_URL}/vendas/${id}`, method: 'GET' })
        .done(function(venda) {
            showVendaModal(venda);
        })
        .fail(function() {
            showNotification('Erro ao carregar detalhes da venda.', 'danger');
        });
}

function rotuloModoVendaItem(item) {
    const tipo = String(item?.tipo_venda || '').toUpperCase();
    if (tipo === 'UNIDADE' || item?.modo_venda === 'unidade') return 'Unidade';
    return 'Peso';
}

function formatarQuantidadeVendaItem(item) {
    const tipo = String(item?.tipo_venda || '').toUpperCase();
    if (tipo === 'UNIDADE' || item?.modo_venda === 'unidade') {
        return `${Math.round(Number(item.quantidade || 0))} UN`;
    }
    const unidade = String(item?.unidade || '').toUpperCase();
    const quantidade = Number(item?.quantidade || 0);
    return unidade ? `${quantidade} ${unidade}` : String(quantidade);
}

function formatarQuantidadeEstoqueKg(item) {
    const kg = Number(item?.quantidade_fiscal || 0) + Number(item?.quantidade_nao_fiscal || 0);
    if (kg <= 0) return '—';
    return `${kg.toFixed(3).replace('.', ',')} KG`;
}

function showVendaModal(venda) {
    const modoFiscal = historicoVendaModoFiscalAtivo();
    const itens = filtrarItensHistoricoVenda(venda);
    const totalExibido = obterTotalExibicaoHistoricoVenda(venda, itens);
    const mostrarNaoFiscal = exibirCupomNaoFiscalHistorico(venda);

    const itensHtml = itens.map(item => {
        if (modoFiscal) {
            return `
        <tr>
            <td>${item.produto_id || '-'}</td>
            <td>${escapeHtml(item.produto_nome || '-')}</td>
            <td>${rotuloModoVendaItem(item)}</td>
            <td>${formatCurrency(item.preco_unitario)}</td>
            <td>${Number(item.quantidade_fiscal ?? 0).toFixed(3).replace('.', ',')}</td>
            <td>${formatCurrency(item.valor_fiscal ?? 0)}</td>
        </tr>`;
        }

        return `
        <tr>
            <td>${item.produto_id || '-'}</td>
            <td>${escapeHtml(item.produto_nome || '-')}</td>
            <td>${rotuloModoVendaItem(item)}</td>
            <td>${formatCurrency(item.preco_unitario)}</td>
            <td>${formatarQuantidadeVendaItem(item)}</td>
            <td>${Number(item.quantidade_fiscal ?? 0).toFixed(3).replace('.', ',')}</td>
            <td>${Number(item.quantidade_nao_fiscal ?? 0).toFixed(3).replace('.', ',')}</td>
            <td>${formatarQuantidadeEstoqueKg(item)}</td>
            <td>${formatCurrency(item.valor_fiscal ?? 0)}</td>
            <td>${formatCurrency(item.valor_nao_fiscal ?? 0)}</td>
            <td>${formatCurrency(item.subtotal)}</td>
        </tr>`;
    }).join('') || `<tr><td colspan="${modoFiscal ? 6 : 11}" class="text-center">Nenhum item encontrado.</td></tr>`;

    const modalHtml = `
        <div class="modal fade" id="vendaModal" tabindex="-1" aria-labelledby="vendaModalLabel" aria-hidden="true">
            <div class="modal-dialog modal-xl modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="vendaModalLabel">Venda ${escapeHtml(venda.codigo || String(venda.id))}${modoFiscal ? ' <small class="text-muted">(somente fiscal)</small>' : ''}</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
                    </div>
                    <div class="modal-body">
                        <div class="row mb-3">
                            <div class="col-sm-4"><strong>ID:</strong> ${venda.id || '-'}</div>
                            <div class="col-sm-4"><strong>Data:</strong> ${formatDate(venda.data_venda || venda.created_at)}</div>
                            <div class="col-sm-4"><strong>Cliente:</strong> ${escapeHtml(venda.cliente_nome || 'Não informado')}</div>
                        </div>
                        <div class="row mb-3">
                            <div class="col-sm-4"><strong>${modoFiscal ? 'Total fiscal:' : 'Total:'}</strong> ${formatCurrency(totalExibido)}</div>
                            <div class="col-sm-4"><strong>Desconto:</strong> ${formatCurrency(venda.desconto)}</div>
                            <div class="col-sm-4"><strong>Pagamento:</strong> ${rotuloFormaPagamento(venda.forma_pagamento)}</div>
                        </div>
                        <div class="row mb-3">
                            <div class="col-sm-4"><strong>Status:</strong> ${rotuloStatusVenda(venda.status)}</div>
                            <div class="col-sm-4"><strong>Documento:</strong> ${escapeHtml(venda.documento || '-')}</div>
                            <div class="col-sm-4"><strong>Número de itens:</strong> ${itens.length}</div>
                        </div>
                        ${vendaPossuiNfceAutorizada(venda) ? `
                        <div class="alert alert-success py-2 mb-3">
                            <i class="fas fa-receipt"></i>
                            NFC-e autorizada${venda.nfce_numero ? ` — nota <strong>#${escapeHtml(String(venda.nfce_numero))}</strong>` : ''}
                        </div>` : ''}
                        ${mostrarNaoFiscal ? `
                        <div class="alert alert-warning py-2 mb-3">
                            <i class="fas fa-file-invoice"></i>
                            Comprovante não fiscal disponível${Number(venda.valor_nao_fiscal || 0) > 0 ? ` — R$ ${Number(venda.valor_nao_fiscal).toFixed(2).replace('.', ',')}` : ''}
                        </div>` : ''}
                        <div class="table-responsive">
                            <table class="table table-sm table-bordered">
                                <thead>
                                    <tr>
                                        <th>ID Produto</th>
                                        <th>Produto</th>
                                        <th>Modo</th>
                                        <th>Preço</th>
                                        ${modoFiscal ? `
                                        <th>Qtd Fiscal (KG)</th>
                                        <th>Valor Fiscal</th>` : `
                                        <th>Qtd Venda</th>
                                        <th>Qtd Fiscal (KG)</th>
                                        <th>Qtd Não Fiscal (KG)</th>
                                        <th>Estoque (KG)</th>
                                        <th>Valor Fiscal</th>
                                        <th>Valor Não Fiscal</th>
                                        <th>Subtotal</th>`}
                                    </tr>
                                </thead>
                                <tbody>
                                    ${itensHtml}
                                </tbody>
                            </table>
                        </div>
                    </div>
                    <div class="modal-footer">
                        ${mostrarNaoFiscal ? `
                        <button type="button" class="btn btn-warning" onclick="reimprimirCupomNaoFiscalHistorico(${venda.id})">
                            <i class="fas fa-receipt"></i> Reimprimir cupom não fiscal
                        </button>` : ''}
                        ${vendaPossuiNfceAutorizada(venda) ? `
                        <button type="button" class="btn btn-success" onclick="reimprimirCupomFiscalHistorico(${venda.id})">
                            <i class="fas fa-print"></i> Reimprimir cupom fiscal
                        </button>` : ''}
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    $('#modal-container').html(modalHtml);
    const vendaModal = new bootstrap.Modal(document.getElementById('vendaModal'));
    vendaModal.show();
}

function rotuloFormaPagamento(value) {
    const mapa = {
        dinheiro: 'Dinheiro',
        pix: 'PIX',
        cartao_credito: 'Cartão crédito',
        cartao_debito: 'Cartão débito',
        boleto: 'Boleto',
        transferencia: 'Transferência',
        cheque: 'Cheque',
        credito: 'Crédito',
        prazo: 'A prazo'
    };
    return mapa[value] || (value ? String(value) : '-');
}

function rotuloStatusVenda(status) {
    const mapa = {
        concluida: 'Concluída',
        pendente: 'Pendente',
        cancelada: 'Cancelada'
    };
    return mapa[status] || (status ? String(status) : '-');
}

function escapeHtml(text) {
    if (text === undefined || text === null) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function montarPayloadCancelamentoVenda(motivo) {
    const payload = { motivo };
    if (typeof getTerminalRequestData === 'function') {
        return getTerminalRequestData(payload);
    }
    if (Number.isInteger(window.terminalId) && window.terminalId > 0) {
        payload.terminal_id = window.terminalId;
    }
    return payload;
}

function extrairMensagemErroResposta(dados, status) {
    return dados?.mensagem || dados?.error || `Erro ao cancelar venda (HTTP ${status}).`;
}

function cancelarVendaNaoFiscal(vendaId) {
    // Usar modal customizado em vez de prompt() para compatibilidade com Electron
    const modalHtml = `
        <div class="modal fade" id="modalCancelarVenda" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header bg-danger text-white">
                        <h5 class="modal-title">Cancelar Venda #${vendaId}</h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Fechar"></button>
                    </div>
                    <div class="modal-body">
                        <div class="alert alert-warning">
                            <i class="fas fa-exclamation-triangle"></i>
                            Atenção: Esta ação irá devolver os produtos ao estoque.
                        </div>
                        <div class="mb-3">
                            <label for="motivoCancelamento" class="form-label fw-bold">Motivo do cancelamento:</label>
                            <textarea id="motivoCancelamento" class="form-control" rows="3" placeholder="Descreva o motivo do cancelamento (mínimo 15 caracteres se houver NFC-e)..."></textarea>
                            <small class="text-muted">Para vendas com NFC-e autorizada, o motivo precisa ter pelo menos 15 caracteres.</small>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Voltar</button>
                        <button type="button" class="btn btn-danger" id="btnConfirmarCancelamento">
                            <i class="fas fa-times"></i> Confirmar Cancelamento
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Remover modal anterior se existir
    const modalAnterior = document.getElementById('modalCancelarVenda');
    if (modalAnterior) {
        modalAnterior.remove();
    }

    // Adicionar modal ao DOM
    const modalContainer = document.createElement('div');
    modalContainer.innerHTML = modalHtml;
    document.body.appendChild(modalContainer);

    // Inicializar e mostrar modal
    const modal = new bootstrap.Modal(document.getElementById('modalCancelarVenda'));
    modal.show();

    // Focar no textarea
    setTimeout(() => {
        document.getElementById('motivoCancelamento').focus();
    }, 100);

    // Handler do botão confirmar
    document.getElementById('btnConfirmarCancelamento').addEventListener('click', async () => {
        const motivo = document.getElementById('motivoCancelamento').value.trim();

        if (!motivo) {
            showNotification('Informe o motivo do cancelamento.', 'warning');
            return;
        }

        if (motivo.length < 15) {
            const confirmarCurto = window.confirm(
                'O motivo tem menos de 15 caracteres. Vendas com NFC-e exigem no mínimo 15. Deseja continuar mesmo assim?'
            );
            if (!confirmarCurto) {
                return;
            }
        }

        modal.hide();

        try {
            const resposta = await fetch(
                `${API_URL}/vendas/cancelar/${vendaId}`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${localStorage.getItem('token')}`
                    },
                    body: JSON.stringify(montarPayloadCancelamentoVenda(motivo))
                }
            );

            const dados = await resposta.json().catch(() => ({}));

            if (!resposta.ok || !dados.sucesso) {
                throw new Error(extrairMensagemErroResposta(dados, resposta.status));
            }

            showNotification(
                'Venda cancelada com sucesso.',
                'success'
            );

            loadVendas();

        } catch (error) {
            showNotification(
                error.message,
                'danger'
            );
        }
    });
}

function abrirDevolucaoVenda(vendaId) {
    $.ajax({ url: `${API_URL}/vendas/${vendaId}`, method: 'GET' })
        .done(function(venda) {
            const itens = (venda.itens || []).map((item) => `
                <tr>
                    <td>${escapeHtml(item.produto_nome || '-')}</td>
                    <td class="text-center">${rotuloModoVendaItem(item)}</td>
                    <td class="text-center">${formatarQuantidadeVendaItem(item)}</td>
                    <td class="text-center">${Number(item.quantidade_fiscal ?? 0).toFixed(3).replace('.', ',')}</td>
                    <td class="text-center">${Number(item.quantidade_nao_fiscal ?? 0).toFixed(3).replace('.', ',')}</td>
                    <td class="text-center">${formatarQuantidadeEstoqueKg(item)}</td>
                    <td>
                        <input type="number" min="0" step="0.001" class="form-control form-control-sm devolucao-qtd"
                            data-item-id="${item.id}" placeholder="0">
                    </td>
                </tr>
            `).join('') || '<tr><td colspan="7" class="text-center">Sem itens</td></tr>';

            const modalHtml = `
                <div class="modal fade" id="modalDevolucaoVenda" tabindex="-1">
                    <div class="modal-dialog modal-lg">
                        <div class="modal-content">
                            <div class="modal-header bg-warning">
                                <h5 class="modal-title">Devolução — Venda ${escapeHtml(venda.codigo || vendaId)}</h5>
                                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                            </div>
                            <div class="modal-body">
                                <p class="text-muted small">Informe a quantidade em KG a devolver. Restaura estoque fiscal primeiro, depois não fiscal.</p>
                                <div class="mb-3">
                                    <label class="form-label fw-bold">Motivo (mín. 10 caracteres)</label>
                                    <textarea id="motivoDevolucaoVenda" class="form-control" rows="2"></textarea>
                                </div>
                                <table class="table table-sm table-bordered">
                                    <thead>
                                        <tr>
                                            <th>Produto</th>
                                            <th>Modo</th>
                                            <th>Qtd Venda</th>
                                            <th>Fiscal (KG)</th>
                                            <th>Não Fiscal (KG)</th>
                                            <th>Estoque (KG)</th>
                                            <th>Qtd devolver (KG)</th>
                                        </tr>
                                    </thead>
                                    <tbody>${itens}</tbody>
                                </table>
                            </div>
                            <div class="modal-footer">
                                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                                <button type="button" class="btn btn-warning" id="btnConfirmarDevolucaoVenda">Confirmar</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            $('#modal-container').html(modalHtml);
            const modal = new bootstrap.Modal(document.getElementById('modalDevolucaoVenda'));
            modal.show();

            $('#btnConfirmarDevolucaoVenda').on('click', async function() {
                const motivo = $('#motivoDevolucaoVenda').val().trim();
                if (motivo.length < 10) {
                    showNotification('Informe um motivo com no mínimo 10 caracteres.', 'warning');
                    return;
                }

                const itensDevolver = [];
                $('.devolucao-qtd').each(function() {
                    const qtd = Number($(this).val() || 0);
                    const vendaItemId = Number($(this).data('item-id'));
                    if (qtd > 0 && vendaItemId > 0) {
                        itensDevolver.push({ venda_item_id: vendaItemId, quantidade: qtd });
                    }
                });

                if (!itensDevolver.length) {
                    showNotification('Informe a quantidade de ao menos um item.', 'warning');
                    return;
                }

                try {
                    const response = await fetch(`${API_URL}/vendas/${vendaId}/devolver`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${localStorage.getItem('token')}`
                        },
                        body: JSON.stringify({ motivo, itens: itensDevolver })
                    });
                    const data = await response.json();
                    if (!response.ok) {
                        throw new Error(data.error || 'Erro ao registrar devolução.');
                    }
                    modal.hide();
                    showNotification(data.message || 'Devolução registrada.', 'success');
                    loadVendas();
                } catch (error) {
                    showNotification(error.message, 'danger');
                }
            });
        })
        .fail(function() {
            showNotification('Erro ao carregar venda para devolução.', 'danger');
        });
}

async function verResumoVendaFiscalTEF(vendaId) {
    try {
        const response = await fetch(`${API_URL}/tef/venda/${vendaId}/resumo`);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Erro ao buscar resumo da venda.');
        }

        alert(
`VENDA INTERNA: #${data.venda_id}
NFC-e SEFAZ: ${data.nfce_numero ? '#' + data.nfce_numero : 'Não emitida'}
STATUS NFC-e: ${data.nfce_status || 'Não informado'}

TEF:
Adquirente: ${data.tef_adquirente || 'Não possui TEF'}
Bandeira: ${data.tef_bandeira || '-'}
NSU: ${data.tef_nsu || '-'}
Autorização: ${data.tef_autorizacao || '-'}`
        );

    } catch (error) {
        console.error('Erro resumo venda:', error);
        showNotification(error.message || 'Erro ao buscar resumo.', 'danger');
    }
}
