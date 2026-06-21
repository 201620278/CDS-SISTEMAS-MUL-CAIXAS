let vendasList = [];
let termoBuscaVendas = '';
let verTodasVendas = false;

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
    // const modoFiscalHistoricoAtivo = typeof modoFiscalAtivoSistema === 'function' && modoFiscalAtivoSistema();
    // const avisoModoFiscal = modoFiscalHistoricoAtivo
    //     ? `<div class="alert alert-success py-2 mb-3"><strong>SISTEMA FISCAL:</strong> exibindo apenas vendas com NFC-e.</div>`
    //     : '';

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
                <!-- Mensagem de modo fiscal removida -->
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

                <div class="table-responsive">
                    <table class="table table-striped table-hover">
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>Código</th>
                                <th>Data</th>
                                <th>Cliente</th>
                                <th>Total</th>
                                <th>Forma</th>
                                <th>Status</th>
                                <th>Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${vendas.map(v => `
                                <tr>
                                    <td>${v.id || '-'}</td>
                                    <td>${escapeHtml(v.codigo || '-')}</td>
                                    <td>${formatDate(v.data_venda || v.created_at)}</td>
                                    <td>${escapeHtml(v.cliente_nome || 'Não informado')}</td>
                                    <td>${formatCurrency(v.total)}</td>
                                    <td>${rotuloFormaPagamento(v.forma_pagamento)}</td>
                                    <td>${rotuloStatusVenda(v.status)}</td>
                                    <td>
                                        <button class="btn btn-sm btn-info" onclick="viewVenda(${v.id})"><i class="fas fa-eye"></i></button>
                                        <button class="btn btn-sm btn-secondary" title="Resumo Venda/NFC-e/TEF" onclick="verResumoVendaFiscalTEF(${v.id})">📄</button>
                                        ${v.status !== 'cancelada' ? `<button class="btn btn-sm btn-danger" onclick="cancelarVendaNaoFiscal(${v.id})"><i class="fas fa-times"></i></button>` : ''}
                                    </td>
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

function showVendaModal(venda) {
    const itens = venda.itens || [];
    const itensHtml = itens.map(item => `
        <tr>
            <td>${item.produto_id || '-'}</td>
            <td>${escapeHtml(item.produto_nome || '-')}</td>
            <td>${formatCurrency(item.preco_unitario)}</td>
            <td>${Number(item.quantidade || 0)}</td>
            <td>${formatCurrency(item.subtotal)}</td>
        </tr>
    `).join('') || '<tr><td colspan="5" class="text-center">Nenhum item encontrado.</td></tr>';

    const modalHtml = `
        <div class="modal fade" id="vendaModal" tabindex="-1" aria-labelledby="vendaModalLabel" aria-hidden="true">
            <div class="modal-dialog modal-xl modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="vendaModalLabel">Venda ${escapeHtml(venda.codigo || String(venda.id))}</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
                    </div>
                    <div class="modal-body">
                        <div class="row mb-3">
                            <div class="col-sm-4"><strong>ID:</strong> ${venda.id || '-'}</div>
                            <div class="col-sm-4"><strong>Data:</strong> ${formatDate(venda.data_venda || venda.created_at)}</div>
                            <div class="col-sm-4"><strong>Cliente:</strong> ${escapeHtml(venda.cliente_nome || 'Não informado')}</div>
                        </div>
                        <div class="row mb-3">
                            <div class="col-sm-4"><strong>Total:</strong> ${formatCurrency(venda.total)}</div>
                            <div class="col-sm-4"><strong>Desconto:</strong> ${formatCurrency(venda.desconto)}</div>
                            <div class="col-sm-4"><strong>Pagamento:</strong> ${rotuloFormaPagamento(venda.forma_pagamento)}</div>
                        </div>
                        <div class="row mb-3">
                            <div class="col-sm-4"><strong>Status:</strong> ${rotuloStatusVenda(venda.status)}</div>
                            <div class="col-sm-4"><strong>Documento:</strong> ${escapeHtml(venda.documento || '-')}</div>
                            <div class="col-sm-4"><strong>Número de itens:</strong> ${itens.length}</div>
                        </div>
                        <div class="table-responsive">
                            <table class="table table-sm table-bordered">
                                <thead>
                                    <tr>
                                        <th>ID Produto</th>
                                        <th>Produto</th>
                                        <th>Preço</th>
                                        <th>Quantidade</th>
                                        <th>Subtotal</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${itensHtml}
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
                            <textarea id="motivoCancelamento" class="form-control" rows="3" placeholder="Informe o motivo do cancelamento..."></textarea>
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
                    body: JSON.stringify({
                        motivo
                    })
                }
            );

            const dados = await resposta.json();

            if (!dados.sucesso) {
                throw new Error(dados.mensagem);
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
