let auditPage = 1;
let auditPageSize = 25;

function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

async function carregarAuditoria(page = 1) {
    auditPage = page;
    const apiUrl = (typeof API_URL === 'string' && API_URL.trim() !== '') ? API_URL : `${window.location.origin}/api`;

    const modulo = document.getElementById('auditFiltroModulo')?.value || '';
    const acao = document.getElementById('auditFiltroAcao')?.value || '';
    const usuario = document.getElementById('auditFiltroUsuario')?.value || '';
    const inicio = document.getElementById('auditDataInicio')?.value || '';
    const fim = document.getElementById('auditDataFim')?.value || '';

    const params = new URLSearchParams({ page: String(page), pageSize: String(auditPageSize) });
    if (modulo) params.set('modulo', modulo);
    if (acao) params.set('acao', acao);
    if (usuario) params.set('usuario_nome', usuario);
    if (inicio) params.set('inicio', inicio);
    if (fim) params.set('fim', fim);

    try {
        const resp = await fetch(`${apiUrl}/auditoria/list?${params.toString()}`, {
            headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || '') }
        });

        const data = await resp.json();
        if (!resp.ok) {
            throw new Error(data.error || 'Erro ao buscar auditoria');
        }

        const tbody = document.getElementById('auditTabelaCorpo');
        tbody.innerHTML = '';

        (data.rows || []).forEach(row => {
            const detalhes = (() => {
                try { return typeof row.detalhes === 'string' ? row.detalhes : JSON.stringify(row.detalhes || {}); } catch (e) { return String(row.detalhes || ''); }
            })();

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${(row.criado_em || '').replace('T', ' ').slice(0,19)}</td>
                <td>${escapeHtml(row.usuario_nome)}</td>
                <td>${escapeHtml(row.modulo)}</td>
                <td>${escapeHtml(row.acao)}</td>
                <td>${escapeHtml((row.referencia_tipo || '') + (row.referencia_id ? ' #' + row.referencia_id : ''))}</td>
                <td><small>${escapeHtml(detalhes)}</small></td>
            `;
            tbody.appendChild(tr);
        });

        const resumo = document.getElementById('auditResumo');
        resumo.textContent = `Página ${data.page} — itens nesta página: ${data.rows.length} — total: ${data.total}`;

        document.getElementById('auditPrev').disabled = data.page <= 1;
        document.getElementById('auditNext').disabled = (data.page * data.pageSize) >= data.total;

    } catch (err) {
        console.error('Erro auditoria:', err);
        showNotification(err.message || 'Erro ao carregar auditoria', 'danger');
    }
}

document.getElementById('auditBuscar')?.addEventListener('click', () => carregarAuditoria(1));
document.getElementById('auditPrev')?.addEventListener('click', () => carregarAuditoria(Math.max(1, auditPage - 1)));
document.getElementById('auditNext')?.addEventListener('click', () => carregarAuditoria(auditPage + 1));

// Carregar inicialmente
carregarAuditoria(1);
