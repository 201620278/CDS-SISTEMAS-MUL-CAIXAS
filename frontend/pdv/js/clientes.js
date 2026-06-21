function normalizarTexto(texto) {
    return String(texto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .normalize('NFC')
        .toLowerCase();
}

// Load clientes page
function loadClientes() {
    $.ajax({
        url: `${API_URL}/clientes`,
        method: 'GET',
        success: function(clientes) {
            renderClientes(clientes);
        },
        error: function() {
            $('#page-content').html('<div class="alert alert-danger">Erro ao carregar clientes!</div>');
        }
    });
}

// Render clientes
function renderClientes(clientes) {
    const html = `
        <div class="card">
            <div class="card-header">
                <div class="row">
                    <div class="col-md-6">
                        <i class="fas fa-users"></i> Lista de Clientes
                    </div>
                    <div class="col-md-6 text-end">
                        <input type="text" class="form-control form-control-sm d-inline-block w-auto me-2" id="buscaCliente" placeholder="Buscar cliente...">
                        <button class="btn btn-primary btn-sm" onclick="showClienteModal()">
                            <i class="fas fa-plus"></i> Novo Cliente
                        </button>
                    </div>
                </div>
            </div>
            <div class="card-body">
                <div class="table-responsive">
                    <table class="table table-striped table-hover">
                        <thead>
                            <tr>
                                <th>Nome</th>
                                <th>CPF/CNPJ</th>
                                <th>Telefone</th>
                                <th>Email</th>
                                <th>Limite Crédito</th>
                                <th>Crédito Atual</th>
                                <th>Ações</th>
                            </tr>
                        </thead>
                        <tbody id="clientes-tbody">
                            ${clientes.map(c => `
                                <tr>
                                    <td>${c.nome}</td>
                                    <td>${formatarCpfCnpj(c.cpf_cnpj) || '-'}</td>
                                    <td>${c.telefone || '-'}</td>
                                    <td>${c.email || '-'}</td>
                                    <td>${formatCurrency(c.limite_credito)}</td>
                                    <td class="${c.credito_atual > 0 ? 'text-danger' : 'text-success'}">
                                        ${formatCurrency(c.credito_atual)}
                                    </td>
                                    <td>
                                        <button class="btn btn-sm btn-info" onclick="viewCliente(${c.id})" title="Detalhes">
                                            <i class="fas fa-eye"></i>
                                        </button>
                                        <button class="btn btn-sm btn-secondary" onclick="historicoComprasCliente(${c.id})" title="Histórico de compras">
                                            <i class="fas fa-receipt"></i>
                                        </button>
                                        <button class="btn btn-sm btn-warning" onclick="editCliente(${c.id})" title="Editar">
                                            <i class="fas fa-edit"></i>
                                        </button>
                                        <button class="btn btn-sm btn-danger" onclick="deleteCliente(${c.id})">
                                            <i class="fas fa-trash"></i>
                                        </button>
                                    </td>
                                </tr>
                            `).join('')}
                            ${clientes.length === 0 ? '<tr><td colspan="7" class="text-center">Nenhum cliente cadastrado</td></tr>' : ''}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
    $('#page-content').html(html);
    $('#buscaCliente').on('input', function() {
        const termo = normalizarTexto($(this).val());
        const filtrados = clientes.filter(c =>
            (c.nome && normalizarTexto(c.nome).includes(termo)) ||
            (c.cpf_cnpj && String(c.cpf_cnpj).toLowerCase().includes(termo))
        );
        $('#clientes-tbody').html(filtrados.map(c => `
            <tr>
                <td>${c.nome}</td>
                <td>${c.cpf_cnpj || '-'}</td>
                <td>${c.telefone || '-'}</td>
                <td>${c.email || '-'}</td>
                <td>${formatCurrency(c.limite_credito)}</td>
                <td class="${c.credito_atual > 0 ? 'text-danger' : 'text-success'}">
                    ${formatCurrency(c.credito_atual)}
                </td>
                <td>
                    <button class="btn btn-sm btn-info" onclick="viewCliente(${c.id})" title="Detalhes">
                        <i class="fas fa-eye"></i>
                    </button>
                    <button class="btn btn-sm btn-secondary" onclick="historicoComprasCliente(${c.id})" title="Histórico de compras">
                        <i class="fas fa-receipt"></i>
                    </button>
                    <button class="btn btn-sm btn-warning" onclick="editCliente(${c.id})" title="Editar">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="deleteCliente(${c.id})">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `).join(''));
    });
    return;
    
    $('#page-content').html(html);
}

// Show cliente modal
function showClienteModal(cliente = null) {
    const isEdit = cliente !== null;
    const title = isEdit ? 'Editar Cliente' : 'Novo Cliente';
    
    const modalHtml = `
        <div class="modal fade" id="clienteModal" tabindex="-1">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">${title}</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <form id="clienteForm">
                            <input type="hidden" id="clienteId" value="${isEdit ? cliente.id : ''}">
                            <div class="row">
                                <div class="col-md-6 mb-3">
                                    <label for="nome" class="form-label">Nome *</label>
                                    <input type="text" class="form-control" id="nome" required value="${isEdit ? cliente.nome : ''}">
                                </div>
                                <div class="col-md-6 mb-3">
                                    <label for="cpf_cnpj" class="form-label">CPF/CNPJ</label>
                                    <input type="text" class="form-control" id="cpf_cnpj" value="${isEdit ? (formatarCpfCnpj(cliente.cpf_cnpj) || '') : ''}" oninput="formatCpfCnpjInput(this)" maxlength="18">
                                </div>
                                <div class="col-md-6 mb-3">
                                    <label for="telefone" class="form-label">Telefone</label>
                                    <input type="text" class="form-control" id="telefone" value="${isEdit ? (cliente.telefone || '') : ''}">
                                </div>
                                <div class="col-md-6 mb-3">
                                    <label for="email" class="form-label">Email</label>
                                    <input type="email" class="form-control" id="email" value="${isEdit ? (cliente.email || '') : ''}">
                                </div>
                                <div class="col-md-4 mb-3">
                                    <label for="cep" class="form-label">CEP</label>
                                    <input type="text" class="form-control" id="cep" maxlength="9" value="${isEdit && cliente.cep ? cliente.cep : ''}" placeholder="00000-000">
                                </div>
                                <div class="col-md-8 mb-3 d-flex align-items-end">
                                    <button type="button" class="btn btn-outline-secondary ms-2" id="buscarCepBtn">Buscar Endereço</button>
                                    <span id="cep-loading" class="ms-2" style="display:none;"><i class="fas fa-spinner fa-spin"></i> Buscando...</span>
                                </div>
                                <div class="col-md-6 mb-3">
                                    <label for="rua" class="form-label">Rua</label>
                                    <input type="text" class="form-control" id="rua" value="${isEdit ? (cliente.rua || '') : ''}">
                                </div>
                                <div class="col-md-2 mb-3">
                                    <label for="numero" class="form-label">Número</label>
                                    <input type="text" class="form-control" id="numero" value="${isEdit ? (cliente.numero || '') : ''}">
                                </div>
                                <div class="col-md-4 mb-3">
                                    <label for="bairro" class="form-label">Bairro</label>
                                    <input type="text" class="form-control" id="bairro" value="${isEdit ? (cliente.bairro || '') : ''}">
                                </div>
                                <div class="col-md-4 mb-3">
                                    <label for="cidade" class="form-label">Cidade</label>
                                    <input type="text" class="form-control" id="cidade" value="${isEdit ? (cliente.cidade || '') : ''}">
                                </div>
                                <div class="col-md-2 mb-3">
                                    <label for="uf" class="form-label">UF</label>
                                    <input type="text" class="form-control" id="uf" maxlength="2" value="${isEdit ? (cliente.uf || '') : ''}">
                                </div>
                                <div class="col-md-6 mb-3">
                                    <label for="limite_credito" class="form-label">Limite de Crédito (fiado)</label>
                                    <input type="number" step="0.01" min="0" class="form-control" id="limite_credito" value="${isEdit ? (cliente.limite_credito || 0) : 0}">
                                    <small class="text-muted">Deve ser maior que zero para permitir vendas com forma &quot;Crédito&quot;.</small>
                                </div>
                            </div>
                        </form>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                        <button type="button" class="btn btn-primary" onclick="saveCliente()">Salvar</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    $('#modal-container').html(modalHtml);
    $('#clienteModal').modal('show');

    // Evento de busca automática ao sair do campo CEP ou clicar no botão
    $('#cep').on('blur', buscarEnderecoPorCep);
    $('#buscarCepBtn').on('click', buscarEnderecoPorCep);

    function buscarEnderecoPorCep() {
        const cep = $('#cep').val().replace(/\D/g, '');
        if (cep.length !== 8) {
            showNotification('CEP inválido!', 'warning');
            return;
        }
        $('#cep-loading').show();
        $.getJSON(`https://viacep.com.br/ws/${cep}/json/`, function(data) {
            $('#cep-loading').hide();
            if (data.erro) {
                showNotification('CEP não encontrado!', 'warning');
                return;
            }
            $('#rua').val(data.logradouro || '');
            $('#bairro').val(data.bairro || '');
            $('#cidade').val(data.localidade || '');
            $('#uf').val(data.uf || '');
        }).fail(function() {
            $('#cep-loading').hide();
            showNotification('Erro ao buscar o CEP!', 'danger');
        });
    }
}

// Save cliente
function saveCliente() {
    const id = $('#clienteId').val();
    const data = {
        nome: $('#nome').val(),
        cpf_cnpj: $('#cpf_cnpj').val(),
        telefone: $('#telefone').val(),
        email: $('#email').val(),
        cep: $('#cep').val(),
        rua: $('#rua').val(),
        numero: $('#numero').val(),
        bairro: $('#bairro').val(),
        cidade: $('#cidade').val(),
        uf: $('#uf').val(),
        limite_credito: parseFloat($('#limite_credito').val())
    };
    
    const url = id ? `${API_URL}/clientes/${id}` : `${API_URL}/clientes`;
    const method = id ? 'PUT' : 'POST';
    
    $.ajax({
        url: url,
        method: method,
        contentType: 'application/json',
        data: JSON.stringify(data),
        success: function() {
            $('#clienteModal').modal('hide');
            showNotification('Cliente salvo com sucesso!');
            loadClientes();
        },
        error: function(xhr) {
            showNotification('Erro ao salvar cliente: ' + (xhr.responseJSON?.error || 'Erro desconhecido'), 'danger');
        }
    });
}

// Edit cliente
function editCliente(id) {
    $.ajax({
        url: `${API_URL}/clientes/${id}`,
        method: 'GET',
        success: function(cliente) {
            showClienteModal(cliente);
        }
    });
}

// Histórico de compras (vendas) do cliente
function historicoComprasCliente(id) {
    $.ajax({
        url: `${API_URL}/clientes/${id}/vendas`,
        method: 'GET',
        success: function(vendas) {
            const modalHtml = `
                <div class="modal fade" id="historicoComprasModal" tabindex="-1">
                    <div class="modal-dialog modal-lg">
                        <div class="modal-content">
                            <div class="modal-header">
                                <h5 class="modal-title">Histórico de compras</h5>
                                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                            </div>
                            <div class="modal-body">
                                <div class="table-responsive">
                                    <table class="table table-sm table-striped">
                                        <thead>
                                            <tr>
                                                <th>Código</th>
                                                <th>Data</th>
                                                <th>Total</th>
                                                <th>Pagamento</th>
                                                <th>Itens</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            ${vendas.length ? vendas.map(v => `
                                                <tr>
                                                    <td>${v.codigo}</td>
                                                    <td>${formatDate(v.data_venda)}</td>
                                                    <td>${formatCurrency(v.total)}</td>
                                                    <td>${v.forma_pagamento || '-'}</td>
                                                    <td>${v.total_itens || 0}</td>
                                                </tr>
                                            `).join('') : '<tr><td colspan="5" class="text-center">Nenhuma compra concluída registrada.</td></tr>'}
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
            $('#historicoComprasModal').modal('show');
        },
        error: function() {
            showNotification('Erro ao carregar histórico de compras.', 'danger');
        }
    });
}

// View cliente
function viewCliente(id) {
    $.ajax({
        url: `${API_URL}/clientes/${id}`,
        method: 'GET',
        success: function(cliente) {
            // Monta o endereço completo
            const enderecoCompleto = [
                cliente.rua,
                cliente.numero ? 'Nº ' + cliente.numero : '',
                cliente.bairro,
                cliente.cidade,
                cliente.uf
            ].filter(Boolean).join(', ');

            const limiteCredito = cliente.limite_credito != null ? formatCurrency(Number(cliente.limite_credito)) : '-';
            const creditoAtual = cliente.credito_atual != null ? formatCurrency(Number(cliente.credito_atual)) : '-';

            const modalHtml = `
                <div class="modal fade" id="viewClienteModal" tabindex="-1">
                    <div class="modal-dialog">
                        <div class="modal-content">
                            <div class="modal-header">
                                <h5 class="modal-title">Detalhes do Cliente</h5>
                                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                            </div>
                            <div class="modal-body">
                                <p><strong>Nome:</strong> ${cliente.nome}</p>
                                <p><strong>CPF/CNPJ:</strong> ${formatarCpfCnpj(cliente.cpf_cnpj) || '-'}</p>
                                <p><strong>Telefone:</strong> ${cliente.telefone || '-'}</p>
                                <p><strong>Email:</strong> ${cliente.email || '-'}</p>
                                <p><strong>CEP:</strong> ${cliente.cep || '-'}</p>
                                <p><strong>Rua:</strong> ${cliente.rua || '-'}</p>
                                <p><strong>Número:</strong> ${cliente.numero || '-'}</p>
                                <p><strong>Bairro:</strong> ${cliente.bairro || '-'}</p>
                                <p><strong>Cidade:</strong> ${cliente.cidade || '-'}</p>
                                <p><strong>UF:</strong> ${cliente.uf || '-'}</p>
                                <p><strong>Limite de Crédito:</strong> ${limiteCredito}</p>
                                <p><strong>Crédito Atual:</strong> ${creditoAtual}</p>
                                <p><strong>Cadastrado em:</strong> ${formatDateTime(cliente.created_at)}</p>
                            </div>
                            <div class="modal-footer">
                                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            
            $('#modal-container').html(modalHtml);
            $('#viewClienteModal').modal('show');
        }
    });
}

// Delete cliente
function deleteCliente(id) {
    if (confirm('Tem certeza que deseja excluir este cliente?')) {
        $.ajax({
            url: `${API_URL}/clientes/${id}`,
            method: 'DELETE',
            success: function() {
                showNotification('Cliente excluído com sucesso!');
                loadClientes();
            },
            error: function(xhr) {
                if (xhr.responseJSON && xhr.responseJSON.error && xhr.status === 400) {
                    showNotification(xhr.responseJSON.error, 'danger');
                } else {
                    showNotification('Erro ao excluir cliente: ' + (xhr.responseJSON?.error || 'Erro desconhecido'), 'danger');
                }
            }
        });
    }
}
