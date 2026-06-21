function formatarMoedaDashboard(valor) {
    return Number(valor || 0).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    });
}

function escapeHtmlDashboard(texto) {
    if (texto === null || texto === undefined) return '';
    return String(texto)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function labelFormaPagamentoDashboard(forma) {
    const chave = String(forma || '').toLowerCase().trim();
    const mapa = {
        dinheiro: 'Dinheiro',
        pix: 'PIX',
        cartao_credito: 'Cartão crédito',
        credito: 'Cartão crédito',
        cartao_debito: 'Cartão débito',
        debito: 'Cartão débito',
        prazo: 'A prazo',
        misto: 'Pagamento misto',
        nao_informado: 'Não informado'
    };
    return mapa[chave] || (chave ? chave.charAt(0).toUpperCase() + chave.slice(1) : 'Não informado');
}

function setDashboardText(id, valor) {
    const el = document.getElementById(id);
    if (el) el.textContent = valor;
}

function formatarDataBr(iso) {
    if (!iso) return '';
    const partes = String(iso).split('-');
    if (partes.length !== 3) return iso;
    return `${partes[2]}/${partes[1]}/${partes[0]}`;
}

function montarListaProdutosDashboard(lista) {
    if (!lista || lista.length === 0) {
        return '<div class="text-muted">Nenhum dado encontrado.</div>';
    }

    return lista.map((item, index) => `
        <div class="d-flex justify-content-between border-bottom py-2">
            <span>${index + 1}. ${escapeHtmlDashboard(item.nome)}</span>
            <strong>${Number(item.quantidade_vendida || 0)}</strong>
        </div>
    `).join('');
}

function montarListaEstoqueBaixo(lista) {
    if (!lista || lista.length === 0) {
        return '<div class="text-muted">Nenhum produto com estoque baixo.</div>';
    }

    return lista.map((item) => `
        <div class="d-flex justify-content-between border-bottom py-2">
            <span>${escapeHtmlDashboard(item.nome)}</span>
            <span class="text-danger">
                <strong>${Number(item.estoque_atual || 0)}</strong>
                <small class="text-muted">/ mín. ${Number(item.estoque_minimo || 0)} ${escapeHtmlDashboard(item.unidade || '')}</small>
            </span>
        </div>
    `).join('');
}

function montarListaFormasPagamento(lista) {
    if (!lista || lista.length === 0) {
        return '<div class="text-muted">Nenhuma venda no período.</div>';
    }

    return lista.map((item) => `
        <div class="d-flex justify-content-between border-bottom py-2">
            <span>${escapeHtmlDashboard(labelFormaPagamentoDashboard(item.forma_pagamento))}</span>
            <span class="text-end">
                <strong>${formatarMoedaDashboard(item.total)}</strong><br>
                <small class="text-muted">${Number(item.quantidade || 0)} venda(s)</small>
            </span>
        </div>
    `).join('');
}

function montarListaValidadeProdutos(lista) {
    if (!Array.isArray(lista) || lista.length === 0) {
        return '<div class="text-muted">Nenhum produto encontrado.</div>';
    }

    return lista.map(item => `
        <div class="d-flex justify-content-between border-bottom py-2">
            <div>
                <strong>${item.produto_nome || item.nome}</strong><br>
                <small>Lote: ${item.lote || '-'} | Estoque: ${item.quantidade_atual ?? 0}</small>
            </div>
            <div class="text-end">
                <strong>${formatarDataBr(item.data_validade || '-')}</strong>
                ${item.dias_para_vencer !== undefined ? `<br><small class="text-muted">${item.dias_para_vencer} dias</small>` : ''}
            </div>
        </div>
    `).join('');
}

function montarListaBackups(lista) {
    if (!lista || lista.length === 0) {
        return '<div class="text-muted">Nenhum backup encontrado.</div>';
    }

    return lista.slice(0,5).map(item => `
        <div class="d-flex justify-content-between border-bottom py-2">
            <div class="text-truncate" style="max-width:70%">${escapeHtmlDashboard(item.arquivo)}</div>
            <div class="text-end"><small class="text-muted">${formatarDataBr(item.modificado_em.slice(0,10))}</small></div>
        </div>
    `).join('');
}

function montarListaAlerts(alerts) {
    if (!alerts) return '<div class="text-muted">Sem alertas no momento.</div>';

    const parts = [];
    if (Number(alerts.delecoes_24h || 0) > 0) {
        parts.push(`<div class="mb-2">Deleções últimas 24h: <strong>${Number(alerts.delecoes_24h)}</strong></div>`);
    }

    if (alerts.usuarios_ativos_ultima_hora && alerts.usuarios_ativos_ultima_hora.length) {
        parts.push('<div class="mb-2"><strong>Usuários com alta atividade (última hora):</strong></div>');
        parts.push('<div>');
        parts.push(alerts.usuarios_ativos_ultima_hora.map(u => `<div class="d-flex justify-content-between py-1"><span>${escapeHtmlDashboard(u.usuario_nome || 'Anônimo')}</span><small>${Number(u.total)}</small></div>`).join(''));
        parts.push('</div>');
    }

    if (alerts.ultimo_backup_horas !== null) {
        parts.push(`<div class="mt-2">Horas desde último backup: <strong>${alerts.ultimo_backup_horas}</strong></div>`);
        if (alerts.backup_atrasado) {
            parts.push('<div class="text-danger">Backup atrasado: último backup tem mais de 24 horas.</div>');
        }
    }

    if (Array.isArray(alerts.persistentes) && alerts.persistentes.length) {
        parts.push('<hr>');
        parts.push('<div class="mb-1"><strong>Alertas persistentes:</strong></div>');
        parts.push(alerts.persistentes.map(a => `
            <div class="d-flex justify-content-between align-items-center py-1">
                <div>
                    <strong>${escapeHtmlDashboard(a.tipo)}</strong>
                    <div class="small text-muted">${escapeHtmlDashboard(a.descricao || '')}</div>
                </div>
                <div class="text-end">
                    <small class="text-muted">${formatarDataBr((a.criado_em||'').slice(0,10))}</small>
                    <div><button class="btn btn-sm btn-outline-success ms-2" data-alert-id="${a.id}" onclick="resolverAlerta(${a.id})">Resolver</button></div>
                </div>
            </div>
        `).join(''));
    }

    if (parts.length === 0) return '<div class="text-muted">Sem alertas no momento.</div>';
    return parts.join('');
}

async function resolverAlerta(id) {
    const apiUrl = (typeof API_URL === 'string' && API_URL.trim() !== '') ? API_URL : `${window.location.origin}/api`;
    try {
        const resp = await fetch(`${apiUrl}/alertas/${id}/resolve`, {
            method: 'PATCH',
            headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('token') || '') }
        });
        if (!resp.ok) {
            const body = await resp.json().catch(() => ({}));
            throw new Error(body.error || 'Erro ao resolver alerta');
        }
        showNotification('Alerta resolvido', 'success');
        carregarDashboard();
    } catch (e) {
        console.error('Erro resolver alerta:', e);
        showNotification(e.message || 'Erro ao resolver alerta', 'danger');
    }
}

function preencherDashboard(data) {
    const periodo = data.periodo || {};
    const labelPeriodo = document.getElementById('dashboardPeriodoLabel');
    if (labelPeriodo) {
        labelPeriodo.textContent = `Período: ${formatarDataBr(periodo.inicio)} a ${formatarDataBr(periodo.fim)}`;
    }

    setDashboardText('dashboardVendasHoje', data.vendas_hoje ?? 0);
    setDashboardText('dashboardFaturamentoHoje', formatarMoedaDashboard(data.faturamento_hoje));
    setDashboardText('dashboardLucroHoje', formatarMoedaDashboard(data.lucro_estimado_hoje));
    setDashboardText('dashboardTicketHoje', formatarMoedaDashboard(data.ticket_medio_hoje));

    setDashboardText('dashboardFaturamento', formatarMoedaDashboard(data.faturamento));
    setDashboardText('dashboardVendas', data.total_vendas ?? 0);
    setDashboardText('dashboardTicket', formatarMoedaDashboard(data.ticket_medio));
    setDashboardText('dashboardProdutos', data.produtos_vendidos ?? 0);
    setDashboardText('dashboardLucro', formatarMoedaDashboard(data.lucro_estimado));

    const receber = data.contas_receber || {};
    const pagar = data.contas_pagar || {};
    setDashboardText('dashboardContasReceber', formatarMoedaDashboard(receber.total));
    setDashboardText('dashboardContasReceberQtd', `${receber.quantidade || 0} pendência(s)`);
    setDashboardText('dashboardContasPagar', formatarMoedaDashboard(pagar.total));
    setDashboardText('dashboardContasPagarQtd', `${pagar.quantidade || 0} pendência(s)`);

    setDashboardText('dashboardAuditoriaUltimos7', data.auditoria?.ultimos_7_dias ?? 0);

    const mais = document.getElementById('dashboardMaisVendidos');
    const menos = document.getElementById('dashboardMenosVendidos');
    const estoque = document.getElementById('dashboardEstoqueBaixo');
    const formas = document.getElementById('dashboardFormasPagamento');

    if (mais) {
        mais.innerHTML = montarListaProdutosDashboard(data.mais_vendidos || data.produtos_mais_vendidos);
    }
    if (menos) {
        menos.innerHTML = montarListaProdutosDashboard(data.menos_vendidos || data.produtos_menos_vendidos);
    }
    if (estoque) {
        estoque.innerHTML = montarListaEstoqueBaixo(data.estoque_baixo);
    }
    if (formas) {
        formas.innerHTML = montarListaFormasPagamento(data.vendas_por_forma_pagamento);
    }

    const proximoVencimento = document.getElementById('dashboardProdutosProximoVencimento');
    const vencidos = document.getElementById('dashboardProdutosVencidos');

    if (proximoVencimento) {
        proximoVencimento.innerHTML = montarListaValidadeProdutos(data.produtos_proximo_vencimento);
    }
    if (vencidos) {
        vencidos.innerHTML = montarListaValidadeProdutos(data.produtos_vencidos);
    }

    const backupsEl = document.getElementById('dashboardBackupsRecentes');
    if (backupsEl) backupsEl.innerHTML = montarListaBackups(data.backups?.recentes || []);

    const alertsEl = document.getElementById('dashboardAlerts');
    if (alertsEl) alertsEl.innerHTML = montarListaAlerts(data.alerts || {});
}

function mostrarErroDashboard(mensagem) {
    const msg = `<div class="text-danger">${escapeHtmlDashboard(mensagem)}</div>`;
    [
        'dashboardMaisVendidos',
        'dashboardMenosVendidos',
        'dashboardEstoqueBaixo',
        'dashboardFormasPagamento'
    ].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = msg;
    });
}

function dataHojeDashboard() {
    return new Date().toISOString().slice(0, 10);
}

function dataDiasAtrasDashboard(dias) {
    const data = new Date();
    data.setDate(data.getDate() - Number(dias));
    return data.toISOString().slice(0, 10);
}

function prepararFiltroDashboard() {
    const filtro = document.getElementById('dashboardFiltroRapido');
    const inicio = document.getElementById('dashboardDataInicio');
    const fim = document.getElementById('dashboardDataFim');

    if (!filtro || !inicio || !fim) return;

    const hoje = dataHojeDashboard();

    if (!filtro.value) {
        filtro.value = '7';
    }

    if (filtro.value === 'hoje') {
        inicio.value = hoje;
        fim.value = hoje;
    } else if (filtro.value === '30') {
        inicio.value = dataDiasAtrasDashboard(30);
        fim.value = hoje;
    } else if (filtro.value === '7') {
        inicio.value = dataDiasAtrasDashboard(7);
        fim.value = hoje;
    }

    const personalizado = filtro.value === 'personalizado';

    inicio.disabled = !personalizado;
    fim.disabled = !personalizado;
}

function carregarDashboardComFiltro() {
    prepararFiltroDashboard();

    const inicio = document.getElementById('dashboardDataInicio')?.value || dataDiasAtrasDashboard(7);
    const fim = document.getElementById('dashboardDataFim')?.value || dataHojeDashboard();

    carregarDashboard(inicio, fim);
}

async function carregarDashboard(inicio = null, fim = null) {
    try {
        const apiUrl = (typeof API_URL === 'string' && API_URL.trim() !== '')
            ? API_URL
            : `${window.location.origin}/api`;

        const dataInicio = inicio || dataDiasAtrasDashboard(7);
        const dataFim = fim || dataHojeDashboard();

        // Check if fiscal mode is active
        const modoFiscalAtivo = localStorage.getItem('pdv_modo_fiscal_ativo') === '1';

        console.log('Modo fiscal ativo:', modoFiscalAtivo);

        const response = await fetch(`${apiUrl}/dashboard/resumo?inicio=${dataInicio}&fim=${dataFim}&modo_fiscal=${modoFiscalAtivo ? '1' : '0'}`, {
            headers: {
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            }
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Erro ao carregar dashboard.');
        }

        preencherDashboard(data);

        // Carregar dados de vencimentos usando o novo endpoint de lotes
        carregarVencimentosDashboard(apiUrl);

    } catch (error) {
        console.error('Erro dashboard:', error);
        mostrarErroDashboard(error.message || 'Erro ao carregar dashboard.');
    }
}

async function carregarVencimentosDashboard(apiUrl) {
    try {
        const response = await fetch(`${apiUrl}/produtos/vencimentos/alertas?dias=30`, {
            headers: {
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            }
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('Erro ao carregar vencimentos:', data.error);
            return;
        }

        const proximoVencimento = document.getElementById('dashboardProdutosProximoVencimento');
        const vencidos = document.getElementById('dashboardProdutosVencidos');

        if (Array.isArray(data)) {
            const proximos = data.filter(item => item.status_validade === 'proximo');
            const vencidosList = data.filter(item => item.status_validade === 'vencido');

            if (proximoVencimento) {
                proximoVencimento.innerHTML = montarListaValidadeProdutos(proximos);
            }
            if (vencidos) {
                vencidos.innerHTML = montarListaValidadeProdutos(vencidosList);
            }
        }
    } catch (error) {
        console.error('Erro ao carregar vencimentos:', error);
    }
}

function initDashboard() {
    const filtro = document.getElementById('dashboardFiltroRapido');

    if (filtro) {
        filtro.addEventListener('change', () => {
            prepararFiltroDashboard();
            if (filtro.value !== 'personalizado') {
                carregarDashboardComFiltro();
            }
        });
    }

    prepararFiltroDashboard();
    carregarDashboardComFiltro();
}

window.initDashboard = initDashboard;
window.carregarDashboard = carregarDashboard;
window.carregarDashboardComFiltro = carregarDashboardComFiltro;
