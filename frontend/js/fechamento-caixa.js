function fcMoeda(valor) {
    return Number(valor || 0).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    });
}

function fcNumero(valor) {
    return Number(valor || 0).toLocaleString('pt-BR', {
        minimumFractionDigits: 3,
        maximumFractionDigits: 3
    });
}

function fcHoje() {
    return new Date().toISOString().split('T')[0];
}

function initFechamentoCaixa() {
    const hoje = fcHoje();

    $('#fc_data_inicio').val(hoje);
    $('#fc_data_fim').val(hoje);
    $('#data_caixa_dia').val(hoje);

    carregarFechamentoCaixa();
    carregarCaixaPorDia();
}

function fcModoFiscalParam() {
    if (typeof modoFiscalQueryParam === 'function') {
        return modoFiscalQueryParam();
    }
    return localStorage.getItem('pdv_modo_fiscal_ativo') === '1' ? '1' : '0';
}

function fcModoFiscalAtivo() {
    return fcModoFiscalParam() === '1';
}

async function carregarFechamentoCaixa() {
    const dataInicio = $('#fc_data_inicio').val() || fcHoje();
    const dataFim = $('#fc_data_fim').val() || dataInicio;
    const modoFiscal = fcModoFiscalParam();

    try {
        const caixa = await $.get(`${API_URL}/vendas/relatorio/fechamento-caixa`, {
            data_inicio: dataInicio,
            data_fim: dataFim,
            modo_fiscal: modoFiscal
        });

        $('#fc_total_vendido').text(fcMoeda(caixa.resumo.total_vendido));
        $('#fc_quantidade_vendas').text(caixa.resumo.quantidade_vendas || 0);
        $('#fc_total_descontos').text(fcMoeda(caixa.resumo.total_descontos));
        $('#fc_ticket_medio').text(fcMoeda(caixa.resumo.ticket_medio));

        renderPagamentosFechamento(caixa.pagamentos || []);

        const produtosResp = await $.get(`${API_URL}/vendas/relatorio/produtos-mais-vendidos`, {
            data_inicio: dataInicio,
            data_fim: dataFim,
            modo_fiscal: modoFiscal
        });

        const produtos = produtosResp.produtos || produtosResp || [];
        const modoFiscalAtivo = Boolean(produtosResp.modo_fiscal_ativo ?? fcModoFiscalAtivo());
        renderProdutosMaisVendidos(produtos, modoFiscalAtivo);

    } catch (error) {
        console.error(error);
        showNotification('Erro ao carregar fechamento de caixa', 'danger');
    }
}

function renderPagamentosFechamento(lista) {
    const tbody = $('#fc_tabela_pagamentos');
    tbody.empty();

    if (!lista.length) {
        tbody.html(`
            <tr>
                <td colspan="3" class="text-center text-muted">
                    Nenhuma venda encontrada no período.
                </td>
            </tr>
        `);
        return;
    }

    lista.forEach(item => {
        tbody.append(`
            <tr>
                <td>${item.forma_pagamento || '-'}</td>
                <td>${item.quantidade || 0}</td>
                <td>${fcMoeda(item.total)}</td>
            </tr>
        `);
    });
}

function renderProdutosMaisVendidos(lista, modoFiscalAtivo = false) {
    const tbody = $('#fc_tabela_produtos');
    tbody.empty();

    if (!lista.length) {
        tbody.html(`
            <tr>
                <td colspan="6" class="text-center text-muted">
                    Nenhum produto vendido no período.
                </td>
            </tr>
        `);
        return;
    }

    lista.forEach(produto => {
        const qtdHtml = modoFiscalAtivo
            ? fcNumero(produto.quantidade_vendida)
            : `${fcNumero(produto.quantidade_vendida)}<br><small class="text-muted">F: ${fcNumero(produto.quantidade_fiscal)} | NF: ${fcNumero(produto.quantidade_nao_fiscal)}</small>`;
        const totalHtml = modoFiscalAtivo
            ? fcMoeda(produto.total_vendido)
            : `${fcMoeda(produto.total_vendido)}<br><small class="text-muted">F: ${fcMoeda(produto.total_vendido_fiscal)} | NF: ${fcMoeda(produto.total_vendido_nao_fiscal)}</small>`;

        tbody.append(`
            <tr>
                <td>${produto.codigo || '-'}</td>
                <td>${produto.nome || '-'}</td>
                <td>${produto.unidade || '-'}</td>
                <td>${qtdHtml}</td>
                <td>${totalHtml}</td>
                <td>${fcMoeda(produto.preco_medio)}</td>
            </tr>
        `);
    });
}

function selecionarCaixaHoje() {
    const hoje = fcHoje();
    $('#data_caixa_dia').val(hoje);
    carregarCaixaPorDia();
}

function selecionarCaixaOntem() {
    const data = new Date();
    data.setDate(data.getDate() - 1);

    const ontem = data.toISOString().split('T')[0];

    $('#data_caixa_dia').val(ontem);
    carregarCaixaPorDia();
}

async function carregarCaixaPorDia() {
    const data = $('#data_caixa_dia').val() || fcHoje();

    try {
        const resposta = await $.get(`${API_URL}/caixa/por-data`, {
            data,
            modo_fiscal: fcModoFiscalParam()
        });

        renderizarCaixaDoDia(resposta);

    } catch (error) {
        console.error(error);
        showNotification('Erro ao carregar caixa do dia.', 'danger');
    }
}

function renderizarCaixaDoDia(resposta) {
    const container = $('#resultado_caixa_dia');
    container.empty();

    if (!resposta.caixas || resposta.caixas.length === 0) {
        container.html(`
            <div class="alert alert-warning mb-0">
                Nenhum caixa encontrado para esta data.
            </div>
        `);
        return;
    }

    resposta.caixas.forEach((item) => {
        const caixa = item.caixa;
        const resumo = item.resumo;
        const movs = item.movimentacoes || [];

        const statusClass = caixa.status === 'aberto' ? 'success' : 'secondary';

        container.append(`
            <div class="card mb-4 shadow-sm">
                <div class="card-header d-flex justify-content-between align-items-center">
                    <strong>
                        Caixa #${caixa.id} - ${resposta.data}
                    </strong>

                    <span class="badge bg-${statusClass}">
                        ${String(caixa.status || '').toUpperCase()}
                    </span>
                </div>

                <div class="card-body">
                    <div class="row g-3 mb-4">
                        <div class="col-md-3">
                            <div class="card text-bg-primary">
                                <div class="card-body">
                                    <small>Valor Inicial</small>
                                    <h4>${fcMoeda(resumo.dinheiro.valor_inicial)}</h4>
                                </div>
                            </div>
                        </div>

                        <div class="col-md-3">
                            <div class="card text-bg-success">
                                <div class="card-body">
                                    <small>Total Vendido</small>
                                    <h4>${fcMoeda(resumo.total_vendido)}</h4>
                                </div>
                            </div>
                        </div>

                        <div class="col-md-3">
                            <div class="card text-bg-warning">
                                <div class="card-body">
                                    <small>Dinheiro Esperado</small>
                                    <h4>${fcMoeda(resumo.dinheiro.dinheiro_esperado)}</h4>
                                </div>
                            </div>
                        </div>

                        <div class="col-md-3">
                            <div class="card text-bg-dark">
                                <div class="card-body">
                                    <small>Saldo Geral</small>
                                    <h4>${fcMoeda(resumo.saldo_geral)}</h4>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="row g-3 mb-4">
                        <div class="col-md-3">
                            <strong>Dinheiro:</strong><br>
                            ${fcMoeda(resumo.dinheiro.vendas_dinheiro)}
                        </div>

                        <div class="col-md-3">
                            <strong>Pix:</strong><br>
                            ${fcMoeda(resumo.digital.pix)}
                        </div>

                        <div class="col-md-3">
                            <strong>Cartão Crédito:</strong><br>
                            ${fcMoeda(resumo.digital.cartao_credito)}
                        </div>

                        <div class="col-md-3">
                            <strong>Cartão Débito:</strong><br>
                            ${fcMoeda(resumo.digital.cartao_debito)}
                        </div>
                    </div>

                    <div class="row g-3 mb-4">
                        <div class="col-md-3">
                            <strong>Suprimentos:</strong><br>
                            ${fcMoeda(resumo.dinheiro.suprimentos)}
                        </div>

                        <div class="col-md-3">
                            <strong>Sangrias:</strong><br>
                            ${fcMoeda(resumo.dinheiro.sangrias)}
                        </div>

                        <div class="col-md-3">
                            <strong>Aberto em:</strong><br>
                            ${caixa.aberto_em || '-'}
                        </div>

                        <div class="col-md-3">
                            <strong>Fechado em:</strong><br>
                            ${caixa.fechado_em || '-'}
                        </div>
                    </div>

                    <hr>

                    <h5>Movimentações do Caixa</h5>

                    <div class="table-responsive">
                        <table class="table table-sm table-striped">
                            <thead>
                                <tr>
                                    <th>Tipo</th>
                                    <th>Valor</th>
                                    <th>Motivo</th>
                                    <th>Data</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${
                                    movs.length
                                    ? movs.map(m => `
                                        <tr>
                                            <td>${m.tipo}</td>
                                            <td>${fcMoeda(m.valor)}</td>
                                            <td>${m.motivo || '-'}</td>
                                            <td>${m.criado_em || m.data_movimento || '-'}</td>
                                        </tr>
                                    `).join('')
                                    : `
                                        <tr>
                                            <td colspan="4" class="text-center text-muted">
                                                Nenhuma movimentação registrada.
                                            </td>
                                        </tr>
                                    `
                                }
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `);
    });
}
