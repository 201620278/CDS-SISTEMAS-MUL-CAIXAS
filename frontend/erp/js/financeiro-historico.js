function renderHistoricoFinanceiro(periodo) {
  const container = document.getElementById('financeiroConteudo');

  container.innerHTML = `
    <div class="financeiro-filtros">
      <input type="text" id="filtroDescricao" placeholder="Descrição ou documento">
      
      <select id="filtroTipo">
        <option value="">Todos</option>
        <option value="receita">Receita</option>
        <option value="despesa">Despesa</option>
      </select>

      <select id="filtroStatus">
        <option value="">Todos</option>
        <option value="pendente">Pendente</option>
        <option value="recebido">Recebido</option>
        <option value="pago">Pago</option>
        <option value="vencido">Vencido</option>
      </select>

      <button onclick="carregarHistoricoFinanceiro()">Filtrar</button>
    </div>

    <div class="financeiro-tabela">
      <table>
        <thead>
          <tr>
            <th>Data</th>
            <th>Tipo</th>
            <th>Descrição</th>
            <th>Documento</th>
            <th>Pessoa</th>
            <th>Status</th>
            <th>Forma</th>
            <th>Valor</th>
          </tr>
        </thead>
        <tbody id="tabelaHistoricoFinanceiro"></tbody>
      </table>
    </div>
  `;

  carregarHistoricoFinanceiro(periodo);
}

async function carregarHistoricoFinanceiro(periodo) {
  try {
    const filtroDescricao = document.getElementById('filtroDescricao')?.value || '';
    const filtroTipo = document.getElementById('filtroTipo')?.value || '';
    const filtroStatus = document.getElementById('filtroStatus')?.value || '';

    let url = '/api/financeiro';
    const params = new URLSearchParams();

    if (periodo?.dataInicio) params.append('dataInicio', periodo.dataInicio);
    if (periodo?.dataFim) params.append('dataFim', periodo.dataFim);
    if (filtroDescricao) params.append('busca', filtroDescricao);
    if (filtroTipo) params.append('tipo', filtroTipo);
    if (filtroStatus) params.append('status', filtroStatus);

    if ([...params].length) {
      url += '?' + params.toString();
    }

    const token = localStorage.getItem('token');

    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Authorization': 'Bearer ' + token
      }
    });

    if (res.status === 401) {
      throw new Error('Sessão expirada. Faça login novamente.');
    }

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Erro ao carregar histórico financeiro');
    }

    preencherTabelaHistorico(data);
  } catch (error) {
    console.error('Erro ao carregar histórico financeiro:', error);

    const tbody = document.getElementById('tabelaHistoricoFinanceiro');
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align:center;color:red;">
            ${error.message || 'Erro ao carregar histórico financeiro'}
          </td>
        </tr>
      `;
    }
  }
}

function preencherTabelaHistorico(lista) {
  const tbody = document.getElementById('tabelaHistoricoFinanceiro');

  if (!tbody) {
    console.error('Elemento tabelaHistoricoFinanceiro não encontrado');
    return;
  }

  if (!lista || !lista.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align:center">Nenhum lançamento encontrado</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = lista.map(item => `
    <tr>
      <td>${formatarData(item.data_movimento || item.vencimento)}</td>
      <td>${item.tipo}</td>
      <td>${item.descricao || '-'}</td>
      <td>${item.documento || '-'}</td>
      <td>${item.pessoa_nome || '-'}</td>
      <td><span class="status-${item.status}">${item.status}</span></td>
      <td>${item.forma_pagamento || '-'}</td>
      <td>${formatarMoeda(item.valor)}</td>
    </tr>
  `).join('');
}

function formatarMoeda(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });
}

function formatarData(data) {
  if (!data) return '-';
  const [ano, mes, dia] = data.split('-');
  return `${dia}/${mes}/${ano}`;
}
