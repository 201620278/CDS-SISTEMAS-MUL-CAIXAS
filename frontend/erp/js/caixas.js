let caixas = [];
let terminais = [];
let caixaEmEdicao = null;
let intervaloTerminais = null;

function apiUrlCaixas() {
  return (typeof API_URL === 'string' && API_URL.trim() !== '') ? API_URL : `${window.location.origin}/api`;
}

function tokenCaixas() {
  return localStorage.getItem('token') || '';
}

function loadCaixas() {
  carregarPaginaHtml('caixas.html', function() {
    buscarCaixas();
    buscarTerminais();
    if (intervaloTerminais) clearInterval(intervaloTerminais);
    intervaloTerminais = setInterval(buscarTerminais, 60000);
  });
}

async function buscarTerminais() {
  try {
    const resp = await fetch(`${apiUrlCaixas()}/terminais`, {
      headers: { 'Authorization': 'Bearer ' + tokenCaixas() }
    });

    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      console.warn('Erro ao carregar terminais:', body.error || resp.status);
      return;
    }

    terminais = await resp.json();
    renderizarTerminais();
    atualizarResumo();
    atualizarSelectTerminais(document.getElementById('caixaTerminal')?.value || '');
  } catch (e) {
    console.error('Erro ao buscar terminais:', e);
  }
}

const JANELA_ONLINE_MS = 3 * 60 * 1000;

function terminalEstaOnline(ultimaConexao, flagServidor) {
  if (typeof flagServidor === 'boolean') return flagServidor;
  if (!ultimaConexao) return false;
  const diff = Date.now() - new Date(ultimaConexao).getTime();
  return diff >= 0 && diff < JANELA_ONLINE_MS;
}

function formatarUltimaConexao(ultimaConexao) {
  if (!ultimaConexao) return 'Nunca';
  try {
    return new Date(ultimaConexao).toLocaleString('pt-BR');
  } catch (_) {
    return ultimaConexao;
  }
}

function rotuloTerminal(t) {
  const hostname = t.hostname || '';
  const nome = String(t.nome || '').trim();
  if (nome && nome !== hostname) return nome;
  return hostname || '—';
}

function renderizarTerminais() {
  const tbody = document.getElementById('tabelaTerminais');
  if (!tbody) return;

  if (!terminais.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">Nenhum dispositivo registrado. Abra o PDV em um computador cliente.</td></tr>';
    return;
  }

  tbody.innerHTML = terminais.map((t) => {
    const online = terminalEstaOnline(t.ultima_conexao, t.online);
    const status = online
      ? '<span class="badge bg-success">PDV ativo</span>'
      : '<span class="badge bg-secondary">Offline</span>';
    const caixaNome = t.caixa_nome
      ? escapeHtmlCaixas(t.caixa_nome)
      : '<span class="text-muted">Não vinculado</span>';
    const nomeExibicao = escapeHtmlCaixas(rotuloTerminal(t));
    const hostname = escapeHtmlCaixas(t.hostname || '—');
    const nomeIgualHostname = !t.nome || t.nome === t.hostname;
    const usuarioTerminal = t.usuario_nome
      ? `<strong>${escapeHtmlCaixas(t.usuario_nome)}</strong>`
      : '<span class="text-muted">—</span>';

    return `<tr>
      <td><strong>${nomeExibicao}</strong>${nomeIgualHostname ? ' <small class="text-muted">(sem nome)</small>' : ''}</td>
      <td><code>${hostname}</code></td>
      <td>${usuarioTerminal}</td>
      <td>${caixaNome}</td>
      <td>${status}</td>
      <td><small>${formatarUltimaConexao(t.ultima_conexao)}</small></td>
      <td>
        <button class="btn btn-sm btn-outline-primary" onclick="editarTerminal(${t.id})" title="Nomear e vincular">
          <i class="fas fa-edit"></i>
        </button>
      </td>
    </tr>`;
  }).join('');
}

function atualizarSelectTerminais(valorSelecionado) {
  const select = document.getElementById('caixaTerminal');
  if (!select) return;

  const atual = valorSelecionado || select.value || '';
  select.innerHTML = '<option value="">Selecione um dispositivo...</option>';

  terminais.forEach((t) => {
    const hostname = t.hostname || t.nome || '';
    if (!hostname) return;
    const opt = document.createElement('option');
    opt.value = hostname;
    const online = terminalEstaOnline(t.ultima_conexao, t.online);
    const rotulo = rotuloTerminal(t);
    const nomeCustom = t.nome && t.nome !== t.hostname;
    const vinculo = t.caixa_nome ? ` — ${t.caixa_nome}` : '';
    opt.textContent = nomeCustom
      ? `${rotulo} (${hostname})${online ? ' · online' : ''}${vinculo}`
      : `${hostname}${online ? ' · online' : ''}${vinculo} (sem nome)`;
    select.appendChild(opt);
  });

  if (atual) {
    const existe = Array.from(select.options).some((o) => o.value === atual);
    if (!existe) {
      const optExtra = document.createElement('option');
      optExtra.value = atual;
      optExtra.textContent = `${atual} (atual)`;
      select.appendChild(optExtra);
    }
    select.value = atual;
  }
}

async function buscarCaixas() {
  const busca = document.getElementById('busca')?.value || '';
  const status = document.getElementById('filtroStatus')?.value || '';

  const params = new URLSearchParams();
  if (busca.trim()) params.append('busca', busca.trim());
  if (status) params.append('status', status);

  try {
    const resp = await fetch(`${apiUrlCaixas()}/caixas?${params.toString()}`, {
      headers: { 'Authorization': 'Bearer ' + tokenCaixas() }
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
  const online = terminais.filter(t => terminalEstaOnline(t.ultima_conexao, t.online)).length;
  const vinculados = terminais.filter(t => t.caixa_id).length;

  const elTotal = document.getElementById('totalCaixas');
  const elAtivos = document.getElementById('totalAtivos');
  const elInativos = document.getElementById('totalInativos');
  const elOnline = document.getElementById('totalTerminaisOnline');
  const elVinculados = document.getElementById('totalTerminaisVinculados');

  if (elTotal) elTotal.textContent = total;
  if (elAtivos) elAtivos.textContent = ativos;
  if (elInativos) elInativos.textContent = inativos;
  if (elOnline) elOnline.textContent = online;
  if (elVinculados) elVinculados.textContent = vinculados;
}

function preencherSelectCaixasTerminal(selectId, caixaSelecionado) {
  const select = document.getElementById(selectId);
  if (!select) return;

  const atual = caixaSelecionado != null && caixaSelecionado !== '' ? String(caixaSelecionado) : '';
  select.innerHTML = '<option value="">Nenhum (desvincular)</option>';

  caixas.forEach((c) => {
    const opt = document.createElement('option');
    opt.value = String(c.id);
    opt.textContent = `${c.nome}${c.ativo ? '' : ' (inativo)'}`;
    select.appendChild(opt);
  });

  if (atual) select.value = atual;
}

function editarTerminal(id) {
  const abrir = async () => {
    if (!caixas.length) await buscarCaixas();

    const terminal = terminais.find(t => Number(t.id) === Number(id));
    if (!terminal) {
      showNotification('Dispositivo não encontrado', 'danger');
      return;
    }

    document.getElementById('terminalEditId').value = terminal.id;
    document.getElementById('terminalEditHostname').value = terminal.hostname || '';
    document.getElementById('terminalEditNome').value = terminal.nome || terminal.hostname || '';
    document.getElementById('erroTerminalNome').textContent = '';
    preencherSelectCaixasTerminal('terminalEditCaixa', terminal.caixa_id || '');

    const modal = new bootstrap.Modal(document.getElementById('modalEditarTerminal'));
    modal.show();
  };

  abrir().catch((e) => {
    console.error('Erro ao abrir terminal:', e);
    showNotification('Erro ao abrir configuração do dispositivo', 'danger');
  });
}

async function salvarTerminal() {
  const id = document.getElementById('terminalEditId')?.value;
  const nome = document.getElementById('terminalEditNome')?.value?.trim() || '';
  const caixaId = document.getElementById('terminalEditCaixa')?.value || '';

  document.getElementById('erroTerminalNome').textContent = '';
  if (!nome) {
    document.getElementById('erroTerminalNome').textContent = 'Informe um nome para o terminal';
    return;
  }

  try {
    const resp = await fetch(`${apiUrlCaixas()}/terminais/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + tokenCaixas()
      },
      body: JSON.stringify({
        nome,
        caixa_id: caixaId ? Number(caixaId) : null
      })
    });

    const data = await resp.json();
    if (!resp.ok) {
      showNotification(data.error || 'Erro ao salvar dispositivo', 'danger');
      return;
    }

    showNotification('Dispositivo atualizado com sucesso', 'success');
    const modal = bootstrap.Modal.getInstance(document.getElementById('modalEditarTerminal'));
    if (modal) modal.hide();

    buscarCaixas();
    buscarTerminais();
  } catch (e) {
    console.error('Erro ao salvar terminal:', e);
    showNotification('Erro ao salvar dispositivo', 'danger');
  }
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
  document.getElementById('caixaStatus').value = '1';
  document.getElementById('erroCaixaNome').textContent = '';
  document.getElementById('erroCaixaDescricao').textContent = '';
  document.getElementById('erroCaixaTerminal').textContent = '';
  atualizarSelectTerminais('');
}

async function editarCaixa(id) {
  try {
    const resp = await fetch(`${apiUrlCaixas()}/caixas/${id}`, {
      headers: { 'Authorization': 'Bearer ' + tokenCaixas() }
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
    document.getElementById('caixaStatus').value = caixa.ativo ? '1' : '0';
    await buscarTerminais();
    atualizarSelectTerminais(caixa.terminal_identificador || '');

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

  document.getElementById('erroCaixaNome').textContent = '';
  document.getElementById('erroCaixaDescricao').textContent = '';
  document.getElementById('erroCaixaTerminal').textContent = '';

  let temErro = false;
  if (!nome) {
    document.getElementById('erroCaixaNome').textContent = 'Informe o nome do caixa';
    temErro = true;
  }
  if (!terminal) {
    document.getElementById('erroCaixaTerminal').textContent = 'Selecione o dispositivo (abra o PDV no computador desejado)';
    temErro = true;
  }

  if (temErro) return;

  const body = { nome, descricao, terminal_identificador: terminal, ativo };

  try {
    const url = caixaEmEdicao ? `${apiUrlCaixas()}/caixas/${caixaEmEdicao.id}` : `${apiUrlCaixas()}/caixas`;
    const method = caixaEmEdicao ? 'PUT' : 'POST';

    const resp = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + tokenCaixas()
      },
      body: JSON.stringify(body)
    });

    const data = await resp.json();

    if (!resp.ok) {
      showNotification(data.error || 'Erro ao salvar caixa', 'danger');
      return;
    }

    showNotification(data.message || 'Caixa salvo com sucesso', 'success');

    const modal = bootstrap.Modal.getInstance(document.getElementById('modalNovoCaixa'));
    if (modal) modal.hide();

    buscarCaixas();
    buscarTerminais();
  } catch (e) {
    console.error('Erro ao salvar caixa:', e);
    showNotification('Erro ao salvar caixa', 'danger');
  }
}

async function desativarCaixa(id) {
  if (!confirm('Deseja realmente desativar este caixa?')) return;

  try {
    const resp = await fetch(`${apiUrlCaixas()}/caixas/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + tokenCaixas() }
    });

    const data = await resp.json();

    if (!resp.ok) {
      showNotification(data.error || 'Erro ao desativar caixa', 'danger');
      return;
    }

    showNotification(data.message || 'Caixa desativado com sucesso', 'success');
    buscarCaixas();
    buscarTerminais();
  } catch (e) {
    console.error('Erro ao desativar caixa:', e);
    showNotification('Erro ao desativar caixa', 'danger');
  }
}

async function reativarCaixa(id) {
  if (!confirm('Deseja realmente reativar este caixa?')) return;

  try {
    const resp = await fetch(`${apiUrlCaixas()}/caixas/${id}/reativar`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + tokenCaixas()
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

document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('busca')?.addEventListener('keyup', function(e) {
    if (e.key === 'Enter') buscarCaixas();
  });
  document.getElementById('filtroStatus')?.addEventListener('change', buscarCaixas);
});

document.getElementById('modalNovoCaixa')?.addEventListener('show.bs.modal', function() {
  buscarTerminais();
});
