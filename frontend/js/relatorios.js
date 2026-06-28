// Relatórios de contas a receber e vendas a prazo
function modoFiscalRelatorioParam() {
    if (typeof modoFiscalQueryParam === 'function') {
        return modoFiscalQueryParam();
    }
    return localStorage.getItem('pdv_modo_fiscal_ativo') === '1' ? '1' : '0';
}

function loadRelatorioContasReceber(tipo = 'em-aberto') {
    let url = `${API_URL}/contas-receber/${tipo}`;
    $.ajax({
        url: url,
        method: 'GET',
        success: function(parcelas) {
            renderRelatorioContasReceber(parcelas, tipo);
        },
        error: function() {
            $('#page-content').html('<div class="alert alert-danger">Erro ao carregar relatório de contas a receber!');
        }
    });
}

function renderRelatorioContasReceber(parcelas, tipo) {
    let titulo = 'Contas a Receber';
    if (tipo === 'vencidas') titulo = 'Contas Vencidas';
    let html = `
        <div class="card">
            <div class="card-header d-flex justify-content-between align-items-center">
                <span><i class="fas fa-file-invoice-dollar"></i> ${titulo}</span>
                <div>
                    <button class="btn btn-outline-primary btn-sm me-2" onclick="loadRelatorioContasReceber('em-aberto')">Em Aberto</button>
                    <button class="btn btn-outline-danger btn-sm" onclick="loadRelatorioContasReceber('vencidas')">Vencidas</button>
                </div>
            </div>
            <div class="card-body">
                <div class="table-responsive">
                    <table class="table table-striped table-hover">
                        <thead>
                            <tr>
                                <th>Venda</th>
                                <th>Cliente</th>
                                <th>Parcela</th>
                                <th>Valor</th>
                                <th>Vencimento</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${parcelas.map(p => `
                                <tr>
                                    <td>${p.venda_codigo || '-'}</td>
                                    <td>${p.cliente_nome || '-'}</td>
                                    <td>${p.numero_parcela}/${p.total_parcelas}</td>
                                    <td>${formatCurrency(p.valor_parcela)}</td>
                                    <td>${formatDate(p.data_vencimento)}</td>
                                    <td><span class="badge bg-${p.status === 'aberto' ? 'warning' : 'success'}">${p.status}</span></td>
                                </tr>
                            `).join('')}
                            ${parcelas.length === 0 ? '<tr><td colspan="6" class="text-center">Nenhuma parcela encontrada</td></tr>' : ''}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
    $('#page-content').html(html);
}

// ===============================
// FECHAMENTO DE CAIXA E PRODUTOS MAIS VENDIDOS
// ===============================

function getToken() {
    return localStorage.getItem('token') || sessionStorage.getItem('token') || '';
}

function moeda(valor) {
    return Number(valor || 0).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    });
}

function numero(valor) {
    return Number(valor || 0).toLocaleString('pt-BR', {
        minimumFractionDigits: 3,
        maximumFractionDigits: 3
    });
}

function hoje() {
    return new Date().toISOString().split('T')[0];
}

// Função principal para carregar a página de relatórios
function loadRelatorios() {
    const html = `
        <div class="d-flex justify-content-between align-items-center mb-4">
            <h2><i class="fas fa-chart-bar"></i> Relatórios</h2>
            <div>
                <button class="btn btn-outline-primary btn-sm me-2" onclick="showRelatorioContasReceber()">Contas a Receber</button>
                <button class="btn btn-info btn-sm" onclick="showProdutosMaisVendidos()">Produtos Mais Vendidos</button>
            </div>
        </div>
        
        <div class="row">
            <div class="col-md-6">
                <div class="card text-center">
                    <div class="card-body">
                        <i class="fas fa-file-invoice-dollar fa-3x text-primary mb-3"></i>
                        <h5>Contas a Receber</h5>
                        <p class="text-muted">Gerenciar parcelas e vendas a prazo</p>
                        <button class="btn btn-primary" onclick="showRelatorioContasReceber()">Acessar</button>
                    </div>
                </div>
            </div>
            <div class="col-md-6">
                <div class="card text-center">
                    <div class="card-body">
                        <i class="fas fa-box fa-3x text-info mb-3"></i>
                        <h5>Produtos Mais Vendidos</h5>
                        <p class="text-muted">Ranking de produtos por período</p>
                        <button class="btn btn-info" onclick="showProdutosMaisVendidos()">Acessar</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    $('#page-content').html(html);
}

function showRelatorioContasReceber() {
    loadRelatorioContasReceber('em-aberto');
}

function showFechamentoCaixa() {
    const html = `
        <div class="card">
            <div class="card-header d-flex justify-content-between align-items-center">
                <h3><i class="fas fa-cash-register"></i> Fechamento de Caixa</h3>
                <button class="btn btn-outline-secondary btn-sm" onclick="loadRelatorios()">
                    <i class="fas fa-arrow-left"></i> Voltar
                </button>
            </div>
            <div class="card-body">
                <div class="row mb-4">
                    <div class="col-md-3">
                        <label>Data inicial:</label>
                        <input type="date" id="data_inicio" class="form-control">
                    </div>
                    <div class="col-md-3">
                        <label>Data final:</label>
                        <input type="date" id="data_fim" class="form-control">
                    </div>
                    <div class="col-md-3">
                        <label>&nbsp;</label>
                        <button class="btn btn-primary w-100" onclick="carregarFechamentoCaixa()">
                            <i class="fas fa-search"></i> Buscar
                        </button>
                    </div>
                </div>

                <div class="row mb-4">
                    <div class="col-md-3">
                        <div class="card bg-dark text-white">
                            <div class="card-body text-center">
                                <h6>Total vendido</h6>
                                <h4 id="total_vendido">R$ 0,00</h4>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-3">
                        <div class="card bg-dark text-white">
                            <div class="card-body text-center">
                                <h6>Quantidade de vendas</h6>
                                <h4 id="quantidade_vendas">0</h4>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-3">
                        <div class="card bg-dark text-white">
                            <div class="card-body text-center">
                                <h6>Descontos</h6>
                                <h4 id="total_descontos">R$ 0,00</h4>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-3">
                        <div class="card bg-dark text-white">
                            <div class="card-body text-center">
                                <h6>Ticket médio</h6>
                                <h4 id="ticket_medio">R$ 0,00</h4>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="card mb-4">
                    <div class="card-header">
                        <h5><i class="fas fa-credit-card"></i> Vendas por forma de pagamento</h5>
                    </div>
                    <div class="card-body">
                        <div class="table-responsive">
                            <table class="table table-striped">
                                <thead>
                                    <tr>
                                        <th>Forma</th>
                                        <th>Quantidade</th>
                                        <th>Total</th>
                                    </tr>
                                </thead>
                                <tbody id="tabela_pagamentos"></tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <div class="card">
                    <div class="card-header">
                        <h5><i class="fas fa-box"></i> Produtos mais vendidos</h5>
                    </div>
                    <div class="card-body">
                        <div class="table-responsive">
                            <table class="table table-striped">
                                <thead>
                                    <tr>
                                        <th>Código</th>
                                        <th>Produto</th>
                                        <th>Unidade</th>
                                        <th>Quantidade vendida</th>
                                        <th>Total vendido</th>
                                        <th>Preço médio</th>
                                    </tr>
                                </thead>
                                <tbody id="tabela_produtos"></tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    $('#page-content').html(html);
    
    // Definir datas padrão e carregar
    document.getElementById('data_inicio').value = hoje();
    document.getElementById('data_fim').value = hoje();
    carregarFechamentoCaixa();
}

function showProdutosMaisVendidos() {
    const html = `
        <div class="card">
            <div class="card-header d-flex justify-content-between align-items-center">
                <h3><i class="fas fa-box"></i> Produtos Mais Vendidos</h3>
                <button class="btn btn-outline-secondary btn-sm" onclick="loadRelatorios()">
                    <i class="fas fa-arrow-left"></i> Voltar
                </button>
            </div>
            <div class="card-body">
                <div class="row mb-4">
                    <div class="col-md-3">
                        <label>Data inicial:</label>
                        <input type="date" id="data_inicio" class="form-control">
                    </div>
                    <div class="col-md-3">
                        <label>Data final:</label>
                        <input type="date" id="data_fim" class="form-control">
                    </div>
                    <div class="col-md-3">
                        <label>Limite:</label>
                        <select id="limite" class="form-control">
                            <option value="10">Top 10</option>
                            <option value="20" selected>Top 20</option>
                            <option value="30">Top 30</option>
                            <option value="50">Top 50</option>
                        </select>
                    </div>
                    <div class="col-md-3">
                        <label>&nbsp;</label>
                        <button class="btn btn-primary w-100" onclick="carregarProdutosMaisVendidos()">
                            <i class="fas fa-search"></i> Buscar
                        </button>
                    </div>
                </div>

                <div class="card">
                    <div class="card-body">
                        <div class="table-responsive">
                            <table class="table table-striped">
                                <thead>
                                    <tr>
                                        <th>Código</th>
                                        <th>Produto</th>
                                        <th>Unidade</th>
                                        <th>Quantidade vendida</th>
                                        <th>Total vendido</th>
                                        <th>Preço médio</th>
                                    </tr>
                                </thead>
                                <tbody id="tabela_produtos"></tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    $('#page-content').html(html);
    
    // Definir datas padrão e carregar
    document.getElementById('data_inicio').value = hoje();
    document.getElementById('data_fim').value = hoje();
    carregarProdutosMaisVendidos();
}

async function carregarFechamentoCaixa() {
    const dataInicio = document.getElementById('data_inicio').value || hoje();
    const dataFim = document.getElementById('data_fim').value || dataInicio;

    const token = getToken();

    try {
        const resCaixa = await fetch(`${API_URL}/vendas/relatorio/fechamento-caixa?data_inicio=${dataInicio}&data_fim=${dataFim}&modo_fiscal=${modoFiscalRelatorioParam()}`, {
            headers: {
                'Authorization': `Bearer ${token}` 
            }
        });

        const caixa = await resCaixa.json();

        if (!resCaixa.ok) {
            alert(caixa.error || 'Erro ao carregar fechamento de caixa');
            return;
        }

        document.getElementById('total_vendido').textContent = moeda(caixa.resumo.total_vendido);
        document.getElementById('quantidade_vendas').textContent = caixa.resumo.quantidade_vendas || 0;
        document.getElementById('total_descontos').textContent = moeda(caixa.resumo.total_descontos);
        document.getElementById('ticket_medio').textContent = moeda(caixa.resumo.ticket_medio);

        const tabelaPagamentos = document.getElementById('tabela_pagamentos');
        tabelaPagamentos.innerHTML = '';

        if (!caixa.pagamentos || caixa.pagamentos.length === 0) {
            tabelaPagamentos.innerHTML = `
                <tr>
                    <td colspan="3">Nenhuma venda encontrada.</td>
                </tr>
            `;
        } else {
            caixa.pagamentos.forEach(item => {
                tabelaPagamentos.innerHTML += `
                    <tr>
                        <td>${item.forma_pagamento || '-'}</td>
                        <td>${item.quantidade || 0}</td>
                        <td>${moeda(item.total)}</td>
                    </tr>
                `;
            });
        }

        await carregarProdutosMaisVendidosInterno(dataInicio, dataFim);
    } catch (error) {
        console.error('Erro:', error);
        alert('Erro ao carregar fechamento de caixa');
    }
}

async function carregarProdutosMaisVendidos() {
    const dataInicio = document.getElementById('data_inicio').value || hoje();
    const dataFim = document.getElementById('data_fim').value || dataInicio;
    const limite = document.getElementById('limite') ? document.getElementById('limite').value : 20;

    await carregarProdutosMaisVendidosInterno(dataInicio, dataFim, limite);
}

async function carregarProdutosMaisVendidosInterno(dataInicio, dataFim, limite = 30) {
    const token = getToken();
    const modoFiscal = modoFiscalRelatorioParam();

    try {
        const resProdutos = await fetch(`${API_URL}/vendas/relatorio/produtos-mais-vendidos?data_inicio=${dataInicio}&data_fim=${dataFim}&limite=${limite}&modo_fiscal=${modoFiscal}`, {
            headers: {
                'Authorization': `Bearer ${token}` 
            }
        });

        const body = await resProdutos.json();
        const produtos = Array.isArray(body) ? body : (body.produtos || []);
        const modoFiscalAtivo = Array.isArray(body) ? modoFiscal === '1' : Boolean(body.modo_fiscal_ativo);

        if (!resProdutos.ok) {
            alert(body.error || 'Erro ao carregar produtos mais vendidos');
            return;
        }

        const thead = document.querySelector('#tabela_produtos')?.closest('table')?.querySelector('thead tr');
        if (thead) {
            thead.innerHTML = modoFiscalAtivo
                ? `
                    <th>Código</th>
                    <th>Produto</th>
                    <th>Unidade</th>
                    <th>Qtd fiscal (KG)</th>
                    <th>Valor fiscal</th>
                    <th>Preço médio</th>
                `
                : `
                    <th>Código</th>
                    <th>Produto</th>
                    <th>Unidade</th>
                    <th>Qtd fiscal (KG)</th>
                    <th>Qtd não fiscal (KG)</th>
                    <th>Qtd total (KG)</th>
                    <th>Valor fiscal</th>
                    <th>Valor não fiscal</th>
                    <th>Total</th>
                    <th>Preço médio</th>
                `;
        }

        const tabelaProdutos = document.getElementById('tabela_produtos');
        tabelaProdutos.innerHTML = '';

        if (!produtos || produtos.length === 0) {
            const colspan = modoFiscalAtivo ? 6 : 10;
            tabelaProdutos.innerHTML = `
                <tr>
                    <td colspan="${colspan}">Nenhum produto vendido no período.</td>
                </tr>
            `;
            return;
        }

        produtos.forEach(produto => {
            if (modoFiscalAtivo) {
                tabelaProdutos.innerHTML += `
                    <tr>
                        <td>${produto.codigo || '-'}</td>
                        <td>${produto.nome || '-'}</td>
                        <td>${produto.unidade || '-'}</td>
                        <td>${numero(produto.quantidade_fiscal ?? produto.quantidade_vendida)}</td>
                        <td>${moeda(produto.total_vendido_fiscal ?? produto.total_vendido)}</td>
                        <td>${moeda(produto.preco_medio)}</td>
                    </tr>
                `;
            } else {
                tabelaProdutos.innerHTML += `
                    <tr>
                        <td>${produto.codigo || '-'}</td>
                        <td>${produto.nome || '-'}</td>
                        <td>${produto.unidade || '-'}</td>
                        <td>${numero(produto.quantidade_fiscal)}</td>
                        <td>${numero(produto.quantidade_nao_fiscal)}</td>
                        <td>${numero(produto.quantidade_vendida)}</td>
                        <td>${moeda(produto.total_vendido_fiscal)}</td>
                        <td>${moeda(produto.total_vendido_nao_fiscal)}</td>
                        <td>${moeda(produto.total_vendido)}</td>
                        <td>${moeda(produto.preco_medio)}</td>
                    </tr>
                `;
            }
        });
    } catch (error) {
        console.error('Erro:', error);
        alert('Erro ao carregar produtos mais vendidos');
    }
}

// Histórico de vendas a prazo de um cliente
function loadHistoricoVendasPrazo(clienteId) {
    $.ajax({
        url: `${API_URL}/contas-receber/historico/${clienteId}`,
        method: 'GET',
        success: function(parcelas) {
            renderHistoricoVendasPrazo(parcelas);
        },
        error: function() {
            $('#page-content').html('<div class="alert alert-danger">Erro ao carregar histórico do cliente!');
        }
    });
}

function renderHistoricoVendasPrazo(parcelas) {
    let html = `
        <div class="card">
            <div class="card-header">
                <i class="fas fa-history"></i> Histórico de Vendas a Prazo
            </div>
            <div class="card-body">
                <div class="table-responsive">
                    <table class="table table-striped table-hover">
                        <thead>
                            <tr>
                                <th>Venda</th>
                                <th>Parcela</th>
                                <th>Valor</th>
                                <th>Vencimento</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${parcelas.map(p => `
                                <tr>
                                    <td>${p.venda_codigo || '-'}</td>
                                    <td>${p.numero_parcela}/${p.total_parcelas}</td>
                                    <td>${formatCurrency(p.valor_parcela)}</td>
                                    <td>${formatDate(p.data_vencimento)}</td>
                                    <td><span class="badge bg-${p.status === 'aberto' ? 'warning' : 'success'}">${p.status}</span></td>
                                </tr>
                            `).join('')}
                            ${parcelas.length === 0 ? '<tr><td colspan="5" class="text-center">Nenhuma venda a prazo encontrada</td></tr>' : ''}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
    $('#page-content').html(html);
}

// ===============================
// FECHAMENTO DE CAIXA E PRODUTOS MAIS VENDIDOS
// ===============================

function getToken() {
    return localStorage.getItem('token') || sessionStorage.getItem('token') || '';
}

function moeda(valor) {
    return Number(valor || 0).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    });
}

function numero(valor) {
    return Number(valor || 0).toLocaleString('pt-BR', {
        minimumFractionDigits: 3,
        maximumFractionDigits: 3
    });
}

function hoje() {
    return new Date().toISOString().split('T')[0];
}

// Função principal para carregar a página de relatórios
function loadRelatorios() {
    const html = `
        <div class="d-flex justify-content-between align-items-center mb-4">
            <h2><i class="fas fa-chart-bar"></i> Relatórios</h2>
            <div>
                <button class="btn btn-outline-primary btn-sm me-2" onclick="showRelatorioContasReceber()">Contas a Receber</button>
                <button class="btn btn-info btn-sm" onclick="showProdutosMaisVendidos()">Produtos Mais Vendidos</button>
            </div>
        </div>
        
        <div class="row">
            <div class="col-md-6">
                <div class="card text-center">
                    <div class="card-body">
                        <i class="fas fa-file-invoice-dollar fa-3x text-primary mb-3"></i>
                        <h5>Contas a Receber</h5>
                        <p class="text-muted">Gerenciar parcelas e vendas a prazo</p>
                        <button class="btn btn-primary" onclick="showRelatorioContasReceber()">Acessar</button>
                    </div>
                </div>
            </div>
            <div class="col-md-6">
                <div class="card text-center">
                    <div class="card-body">
                        <i class="fas fa-box fa-3x text-info mb-3"></i>
                        <h5>Produtos Mais Vendidos</h5>
                        <p class="text-muted">Ranking de produtos por período</p>
                        <button class="btn btn-info" onclick="showProdutosMaisVendidos()">Acessar</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    $('#page-content').html(html);
}

function showRelatorioContasReceber() {
    loadRelatorioContasReceber('em-aberto');
}

function showFechamentoCaixa() {
    const html = `
        <div class="card">
            <div class="card-header d-flex justify-content-between align-items-center">
                <h3><i class="fas fa-cash-register"></i> Fechamento de Caixa</h3>
                <button class="btn btn-outline-secondary btn-sm" onclick="loadRelatorios()">
                    <i class="fas fa-arrow-left"></i> Voltar
                </button>
            </div>
            <div class="card-body">
                <div class="row mb-4">
                    <div class="col-md-3">
                        <label>Data inicial:</label>
                        <input type="date" id="data_inicio" class="form-control">
                    </div>
                    <div class="col-md-3">
                        <label>Data final:</label>
                        <input type="date" id="data_fim" class="form-control">
                    </div>
                    <div class="col-md-3">
                        <label>&nbsp;</label>
                        <button class="btn btn-primary w-100" onclick="carregarFechamentoCaixa()">
                            <i class="fas fa-search"></i> Buscar
                        </button>
                    </div>
                </div>

                <div class="row mb-4">
                    <div class="col-md-3">
                        <div class="card bg-dark text-white">
                            <div class="card-body text-center">
                                <h6>Total vendido</h6>
                                <h4 id="total_vendido">R$ 0,00</h4>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-3">
                        <div class="card bg-dark text-white">
                            <div class="card-body text-center">
                                <h6>Quantidade de vendas</h6>
                                <h4 id="quantidade_vendas">0</h4>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-3">
                        <div class="card bg-dark text-white">
                            <div class="card-body text-center">
                                <h6>Descontos</h6>
                                <h4 id="total_descontos">R$ 0,00</h4>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-3">
                        <div class="card bg-dark text-white">
                            <div class="card-body text-center">
                                <h6>Ticket médio</h6>
                                <h4 id="ticket_medio">R$ 0,00</h4>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="card mb-4">
                    <div class="card-header">
                        <h5><i class="fas fa-credit-card"></i> Vendas por forma de pagamento</h5>
                    </div>
                    <div class="card-body">
                        <div class="table-responsive">
                            <table class="table table-striped">
                                <thead>
                                    <tr>
                                        <th>Forma</th>
                                        <th>Quantidade</th>
                                        <th>Total</th>
                                    </tr>
                                </thead>
                                <tbody id="tabela_pagamentos"></tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <div class="card">
                    <div class="card-header">
                        <h5><i class="fas fa-box"></i> Produtos mais vendidos</h5>
                    </div>
                    <div class="card-body">
                        <div class="table-responsive">
                            <table class="table table-striped">
                                <thead>
                                    <tr>
                                        <th>Código</th>
                                        <th>Produto</th>
                                        <th>Unidade</th>
                                        <th>Quantidade vendida</th>
                                        <th>Total vendido</th>
                                        <th>Preço médio</th>
                                    </tr>
                                </thead>
                                <tbody id="tabela_produtos"></tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    $('#page-content').html(html);
    
    // Definir datas padrão e carregar
    document.getElementById('data_inicio').value = hoje();
    document.getElementById('data_fim').value = hoje();
    carregarFechamentoCaixa();
}

function showProdutosMaisVendidos() {
    const html = `
        <div class="card">
            <div class="card-header d-flex justify-content-between align-items-center">
                <h3><i class="fas fa-box"></i> Produtos Mais Vendidos</h3>
                <button class="btn btn-outline-secondary btn-sm" onclick="loadRelatorios()">
                    <i class="fas fa-arrow-left"></i> Voltar
                </button>
            </div>
            <div class="card-body">
                <div class="row mb-4">
                    <div class="col-md-3">
                        <label>Data inicial:</label>
                        <input type="date" id="data_inicio" class="form-control">
                    </div>
                    <div class="col-md-3">
                        <label>Data final:</label>
                        <input type="date" id="data_fim" class="form-control">
                    </div>
                    <div class="col-md-3">
                        <label>Limite:</label>
                        <select id="limite" class="form-control">
                            <option value="10">Top 10</option>
                            <option value="20" selected>Top 20</option>
                            <option value="30">Top 30</option>
                            <option value="50">Top 50</option>
                        </select>
                    </div>
                    <div class="col-md-3">
                        <label>&nbsp;</label>
                        <button class="btn btn-primary w-100" onclick="carregarProdutosMaisVendidos()">
                            <i class="fas fa-search"></i> Buscar
                        </button>
                    </div>
                </div>

                <div class="card">
                    <div class="card-body">
                        <div class="table-responsive">
                            <table class="table table-striped">
                                <thead>
                                    <tr>
                                        <th>Código</th>
                                        <th>Produto</th>
                                        <th>Unidade</th>
                                        <th>Quantidade vendida</th>
                                        <th>Total vendido</th>
                                        <th>Preço médio</th>
                                    </tr>
                                </thead>
                                <tbody id="tabela_produtos"></tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    $('#page-content').html(html);
    
    // Definir datas padrão e carregar
    document.getElementById('data_inicio').value = hoje();
    document.getElementById('data_fim').value = hoje();
    carregarProdutosMaisVendidos();
}

async function carregarFechamentoCaixa() {
    const dataInicio = document.getElementById('data_inicio').value || hoje();
    const dataFim = document.getElementById('data_fim').value || dataInicio;

    const token = getToken();

    try {
        const resCaixa = await fetch(`${API_URL}/vendas/relatorio/fechamento-caixa?data_inicio=${dataInicio}&data_fim=${dataFim}&modo_fiscal=${modoFiscalRelatorioParam()}`, {
            headers: {
                'Authorization': `Bearer ${token}` 
            }
        });

        const caixa = await resCaixa.json();

        if (!resCaixa.ok) {
            alert(caixa.error || 'Erro ao carregar fechamento de caixa');
            return;
        }

        document.getElementById('total_vendido').textContent = moeda(caixa.resumo.total_vendido);
        document.getElementById('quantidade_vendas').textContent = caixa.resumo.quantidade_vendas || 0;
        document.getElementById('total_descontos').textContent = moeda(caixa.resumo.total_descontos);
        document.getElementById('ticket_medio').textContent = moeda(caixa.resumo.ticket_medio);

        const tabelaPagamentos = document.getElementById('tabela_pagamentos');
        tabelaPagamentos.innerHTML = '';

        if (!caixa.pagamentos || caixa.pagamentos.length === 0) {
            tabelaPagamentos.innerHTML = `
                <tr>
                    <td colspan="3">Nenhuma venda encontrada.</td>
                </tr>
            `;
        } else {
            caixa.pagamentos.forEach(item => {
                tabelaPagamentos.innerHTML += `
                    <tr>
                        <td>${item.forma_pagamento || '-'}</td>
                        <td>${item.quantidade || 0}</td>
                        <td>${moeda(item.total)}</td>
                    </tr>
                `;
            });
        }

        await carregarProdutosMaisVendidosInterno(dataInicio, dataFim);
    } catch (error) {
        console.error('Erro:', error);
        alert('Erro ao carregar fechamento de caixa');
    }
}

async function carregarProdutosMaisVendidos() {
    const dataInicio = document.getElementById('data_inicio').value || hoje();
    const dataFim = document.getElementById('data_fim').value || dataInicio;
    const limite = document.getElementById('limite') ? document.getElementById('limite').value : 20;

    await carregarProdutosMaisVendidosInterno(dataInicio, dataFim, limite);
}

async function carregarProdutosMaisVendidosInterno(dataInicio, dataFim, limite = 30) {
    const token = getToken();
    const modoFiscal = modoFiscalRelatorioParam();

    try {
        const resProdutos = await fetch(`${API_URL}/vendas/relatorio/produtos-mais-vendidos?data_inicio=${dataInicio}&data_fim=${dataFim}&limite=${limite}&modo_fiscal=${modoFiscal}`, {
            headers: {
                'Authorization': `Bearer ${token}` 
            }
        });

        const body = await resProdutos.json();
        const produtos = Array.isArray(body) ? body : (body.produtos || []);
        const modoFiscalAtivo = Array.isArray(body) ? modoFiscal === '1' : Boolean(body.modo_fiscal_ativo);

        if (!resProdutos.ok) {
            alert(body.error || 'Erro ao carregar produtos mais vendidos');
            return;
        }

        const thead = document.querySelector('#tabela_produtos')?.closest('table')?.querySelector('thead tr');
        if (thead) {
            thead.innerHTML = modoFiscalAtivo
                ? `
                    <th>Código</th>
                    <th>Produto</th>
                    <th>Unidade</th>
                    <th>Qtd fiscal (KG)</th>
                    <th>Valor fiscal</th>
                    <th>Preço médio</th>
                `
                : `
                    <th>Código</th>
                    <th>Produto</th>
                    <th>Unidade</th>
                    <th>Qtd fiscal (KG)</th>
                    <th>Qtd não fiscal (KG)</th>
                    <th>Qtd total (KG)</th>
                    <th>Valor fiscal</th>
                    <th>Valor não fiscal</th>
                    <th>Total</th>
                    <th>Preço médio</th>
                `;
        }

        const tabelaProdutos = document.getElementById('tabela_produtos');
        tabelaProdutos.innerHTML = '';

        if (!produtos || produtos.length === 0) {
            const colspan = modoFiscalAtivo ? 6 : 10;
            tabelaProdutos.innerHTML = `
                <tr>
                    <td colspan="${colspan}">Nenhum produto vendido no período.</td>
                </tr>
            `;
            return;
        }

        produtos.forEach(produto => {
            if (modoFiscalAtivo) {
                tabelaProdutos.innerHTML += `
                    <tr>
                        <td>${produto.codigo || '-'}</td>
                        <td>${produto.nome || '-'}</td>
                        <td>${produto.unidade || '-'}</td>
                        <td>${numero(produto.quantidade_fiscal ?? produto.quantidade_vendida)}</td>
                        <td>${moeda(produto.total_vendido_fiscal ?? produto.total_vendido)}</td>
                        <td>${moeda(produto.preco_medio)}</td>
                    </tr>
                `;
            } else {
                tabelaProdutos.innerHTML += `
                    <tr>
                        <td>${produto.codigo || '-'}</td>
                        <td>${produto.nome || '-'}</td>
                        <td>${produto.unidade || '-'}</td>
                        <td>${numero(produto.quantidade_fiscal)}</td>
                        <td>${numero(produto.quantidade_nao_fiscal)}</td>
                        <td>${numero(produto.quantidade_vendida)}</td>
                        <td>${moeda(produto.total_vendido_fiscal)}</td>
                        <td>${moeda(produto.total_vendido_nao_fiscal)}</td>
                        <td>${moeda(produto.total_vendido)}</td>
                        <td>${moeda(produto.preco_medio)}</td>
                    </tr>
                `;
            }
        });
    } catch (error) {
        console.error('Erro:', error);
        alert('Erro ao carregar produtos mais vendidos');
    }
}
