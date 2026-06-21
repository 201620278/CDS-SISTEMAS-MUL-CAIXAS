let caixas = [];
let caixaEmEdicao = null;

function loadCaixas() {
  carregarPaginaHtml('caixas.html', function() {
    buscarCaixas();
  });
}

async function buscarCaixas() {
  const apiUrl = (typeof API_URL === 'string' && API_URL.trim() !== '') ? API_URL : `${window.location.origin}/api`;
  const busca = document.getElementById('busca')?.value || '';
  const status = document.getElementById('filtroStatus')?.value || '';

  const params = new URLSearchParams();
  if (busca.trim()) params.append('busca', busca.trim());
  if (status) params.append('status', status);

  try {
    const resp = await fetch(`${apiUrl}/caixas?${params.toString()}`, {
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('token') || '') }
    });

    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      showNotification(body.error || 'Erro ao carregar caixas', 'danger');
      return;
    }

    const data = await resp.json();
    caixas = data.data || [];
    renderizarCaixas();
    atualizarResumo();
  } catch (e) {
    console.error('Erro ao buscar caixas:', e);
    showNotification('Erro ao buscar caixas', 'danger');
  }
}

function renderizarCaixas() {
  const tbody = document.getElementById('tabelaCaixas');
  if (!tbody) return;

  tbody.innerHTML = '';

  if (caixas.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">Nenhum caixa encontrado</td></tr>';
    return;
  }

  caixas.forEach(c => {
    const status = c.ativo ? '<span class="badge bg-success">Ativo</span>' : '<span class="badge bg-danger">Inativo</span>';
    const dtCriacao = c.created_at ? new Date(c.created_at).toLocaleDateString('pt-BR') : '';
    const qtdTerminais = c.qtd_terminais || 0;
    const descricao = c.descricao || '';

    const btnEditar = `<button class="btn btn-sm btn-primary" onclick="editarCaixa(${c.id})" title="Editar">
      <i class="fas fa-edit"></i>
    </button>`;
    
    let btnDesativar = '';
    if (c.ativo) {
      btnDesativar = `<button class="btn btn-sm btn-warning" onclick="desativarCaixa(${c.id})" title="Desativar">
        <i class="fas fa-ban"></i>
      </button>`;
    } else {
      btnDesativar = `<button class="btn btn-sm btn-success" onclick="reativarCaixa(${c.id})" title="Reativar">
        <i class="fas fa-check"></i>
      </button>`;
    }

    const tr = `<tr>
      <td>${c.id}</td>
      <td><strong>${escapeHtmlCaixas(c.nome)}</strong></td>
      <td>${escapeHtmlCaixas(descricao)}</td>
      <td><span class="badge bg-info">${qtdTerminais}</span></td>
      <td>${status}</td>
      <td><small>${dtCriacao}</small></td>
      <td>
        <div class="btn-group btn-group-sm">
          ${btnEditar}
          ${btnDesativar}
        </div>
      </td>
    </tr>`;

    tbody.innerHTML += tr;
  });
}

function atualizarResumo() {
  const total = caixas.length;
  const ativos = caixas.filter(c => c.ativo).length;
  const inativos = caixas.filter(c => !c.ativo).length;
  const terminais = caixas.reduce((acc, c) => acc + (c.qtd_terminais || 0), 0);

  document.getElementById('totalCaixas').textContent = total;
  document.getElementById('totalAtivos').textContent = ativos;
  document.getElementById('totalInativos').textContent = inativos;
  document.getElementById('totalTerminais').textContent = terminais;
}

function escapeHtmlCaixas(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function limparModalCaixa() {
  caixaEmEdicao = null;
  document.getElementById('modalTitulo').textContent = 'Novo Caixa';
  document.getElementById('caixaNome').value = '';
  document.getElementById('caixaDescricao').value = '';
  document.getElementById('caixaTerminal').value = '';
  document.getElementById('caixaStatus').value = '1';
  document.getElementById('erroCaixaNome').textContent = '';
  document.getElementById('erroCaixaDescricao').textContent = '';
  document.getElementById('erroCaixaTerminal').textContent = '';
}

async function editarCaixa(id) {
  const apiUrl = (typeof API_URL === 'string' && API_URL.trim() !== '') ? API_URL : `${window.location.origin}/api`;

  try {
    const resp = await fetch(`${apiUrl}/caixas/${id}`, {
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('token') || '') }
    });

    if (!resp.ok) {
      showNotification('Erro ao carregar caixa', 'danger');
      return;
    }

    const caixa = await resp.json();
    caixaEmEdicao = caixa;

    document.getElementById('modalTitulo').textContent = `Editar Caixa: ${caixa.nome}`;
    document.getElementById('caixaNome').value = caixa.nome;
    document.getElementById('caixaDescricao').value = caixa.descricao || '';
    document.getElementById('caixaTerminal').value = caixa.terminal_identificador || '';
    document.getElementById('caixaStatus').value = caixa.ativo ? '1' : '0';

    const modal = new bootstrap.Modal(document.getElementById('modalNovoCaixa'));
    modal.show();
  } catch (e) {
    console.error('Erro ao editar caixa:', e);
    showNotification('Erro ao editar caixa', 'danger');
  }
}

async function salvarCaixa() {
  const nome = document.getElementById('caixaNome')?.value?.trim() || '';
  const descricao = document.getElementById('caixaDescricao')?.value?.trim() || '';
  const terminal = document.getElementById('caixaTerminal')?.value?.trim() || '';
  const ativo = document.getElementById('caixaStatus')?.value === '1';

  // Limpar erros
  document.getElementById('erroCaixaNome').textContent = '';
  document.getElementById('erroCaixaDescricao').textContent = '';
  document.getElementById('erroCaixaTerminal').textContent = '';

  // Validar
  let temErro = false;
  if (!nome) {
    document.getElementById('erroCaixaNome').textContent = 'Informe o nome do caixa';
    temErro = true;
  }
  if (!terminal) {
    document.getElementById('erroCaixaTerminal').textContent = 'Informe o identificador do terminal';
    temErro = true;
  }

  if (temErro) return;

  const apiUrl = (typeof API_URL === 'string' && API_URL.trim() !== '') ? API_URL : `${window.location.origin}/api`;
  const token = localStorage.getItem('token') || '';
  const body = { nome, descricao, terminal_identificador: terminal, ativo };

  try {
    const url = caixaEmEdicao ? `${apiUrl}/caixas/${caixaEmEdicao.id}` : `${apiUrl}/caixas`;
    const method = caixaEmEdicao ? 'PUT' : 'POST';

    const resp = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify(body)
    });

    const data = await resp.json();

    if (!resp.ok) {
      showNotification(data.error || 'Erro ao salvar caixa', 'danger');
      return;
    }

    showNotification(data.message || 'Caixa salvo com sucesso', 'success');

    // Fechar modal
    const modal = bootstrap.Modal.getInstance(document.getElementById('modalNovoCaixa'));
    if (modal) modal.hide();

    buscarCaixas();
  } catch (e) {
    console.error('Erro ao salvar caixa:', e);
    showNotification('Erro ao salvar caixa', 'danger');
  }
}

async function desativarCaixa(id) {
  if (!confirm('Deseja realmente desativar este caixa?')) return;

  const apiUrl = (typeof API_URL === 'string' && API_URL.trim() !== '') ? API_URL : `${window.location.origin}/api`;
  const token = localStorage.getItem('token') || '';

  try {
    const resp = await fetch(`${apiUrl}/caixas/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token }
    });

    const data = await resp.json();

    if (!resp.ok) {
      showNotification(data.error || 'Erro ao desativar caixa', 'danger');
      return;
    }

    showNotification(data.message || 'Caixa desativado com sucesso', 'success');
    buscarCaixas();
  } catch (e) {
    console.error('Erro ao desativar caixa:', e);
    showNotification('Erro ao desativar caixa', 'danger');
  }
}

async function reativarCaixa(id) {
  if (!confirm('Deseja realmente reativar este caixa?')) return;

  const apiUrl = (typeof API_URL === 'string' && API_URL.trim() !== '') ? API_URL : `${window.location.origin}/api`;
  const token = localStorage.getItem('token') || '';

  try {
    const resp = await fetch(`${apiUrl}/caixas/${id}/reativar`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      }
    });

    const data = await resp.json();

    if (!resp.ok) {
      showNotification(data.error || 'Erro ao reativar caixa', 'danger');
      return;
    }

    showNotification(data.message || 'Caixa reativado com sucesso', 'success');
    buscarCaixas();
  } catch (e) {
    console.error('Erro ao reativar caixa:', e);
    showNotification('Erro ao reativar caixa', 'danger');
  }
}

// Disparar busca ao mudar filtro
document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('busca')?.addEventListener('keyup', function(e) {
    if (e.key === 'Enter') buscarCaixas();
  });
  document.getElementById('filtroStatus')?.addEventListener('change', buscarCaixas);
});
