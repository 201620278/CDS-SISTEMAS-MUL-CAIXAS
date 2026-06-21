// Relatórios Financeiro
function renderRelatoriosFinanceiros(periodo) {
  const conteudo = document.getElementById('financeiroConteudo');

  conteudo.innerHTML = `
    <div class="financeiro-filtros">
      <div class="financeiro-filtro-grupo">
        <label for="tipoRelatorio">Tipo de Relatório:</label>
        <select id="tipoRelatorio" class="form-control">
          <option value="resumo">Resumo Financeiro</option>
          <option value="receber">Contas a Receber</option>
          <option value="pagar">Contas a Pagar</option>
          <option value="fluxo">Fluxo Financeiro</option>
          <option value="inadimplencia">Inadimplência</option>
        </select>
      </div>
      <div class="financeiro-acoes">
        <button class="btn btn-primary" onclick="carregarRelatorioSelecionado()">
          <i class="fas fa-chart-bar"></i> Gerar Relatório
        </button>
        <button class="btn btn-success" onclick="exportarRelatorio()">
          <i class="fas fa-download"></i> Exportar
        </button>
      </div>
    </div>

    <div id="relatorioContainer" class="mt-4">
      <div class="text-center text-muted">
        <i class="fas fa-chart-line fa-3x mb-3"></i>
        <p>Selecione um tipo de relatório e clique em "Gerar Relatório"</p>
      </div>
    </div>
  `;

  // Configurar eventos
  document.getElementById('tipoRelatorio').addEventListener('change', function() {
    // Limpar relatório anterior quando mudar o tipo
    document.getElementById('relatorioContainer').innerHTML = `
      <div class="text-center text-muted">
        <i class="fas fa-chart-line fa-3x mb-3"></i>
        <p>Clique em "Gerar Relatório" para visualizar</p>
      </div>
    `;
  });
}

async function gerarRelatorio() {
  return carregarRelatorioSelecionado();
}

function renderizarRelatorio(tipo, titulo, dados, periodo) {
  const container = document.getElementById('relatorioContainer');

  let html = `
    <div class="card">
      <div class="card-header">
        <h4 class="mb-0">${titulo}</h4>
        <small class="text-muted">Período: ${formatarData(periodo.dataInicio)} a ${formatarData(periodo.dataFim)}</small>
      </div>
      <div class="card-body">
  `;

  switch (tipo) {
    case 'resumo':
      html += renderizarResumoFinanceiro(dados);
      break;
    case 'receber':
      html += renderizarRelatorioReceber(dados);
      break;
    case 'pagar':
      html += renderizarRelatorioPagar(dados);
      break;
    case 'fluxo':
      html += renderizarFluxoCaixa(dados);
      break;
    case 'inadimplencia':
      html += renderizarInadimplencia(dados);
      break;
  }

  html += `
      </div>
    </div>
  `;

  container.innerHTML = html;
}

function renderizarFluxoCaixa(dados) {
  return `
    <div class="row">
      <div class="col-md-6">
        <h5>Entradas</h5>
        <div class="dashboard-card recebido mb-3">
          <p class="valor">${formatarMoeda(dados.entradas || 0)}</p>
        </div>
      </div>
      <div class="col-md-6">
        <h5>Saídas</h5>
        <div class="dashboard-card pagar mb-3">
          <p class="valor">${formatarMoeda(dados.saidas || 0)}</p>
        </div>
      </div>
    </div>
    <div class="row">
      <div class="col-12">
        <h5>Saldo</h5>
        <div class="dashboard-card saldo">
          <p class="valor">${formatarMoeda((dados.entradas || 0) - (dados.saidas || 0))}</p>
        </div>
      </div>
    </div>
  `;
}

function renderizarReceitasDespesas(dados) {
  return `
    <div class="row">
      <div class="col-md-6">
        <h5>Total Receitas</h5>
        <div class="dashboard-card recebido">
          <p class="valor">${formatarMoeda(dados.receitas || 0)}</p>
        </div>
      </div>
      <div class="col-md-6">
        <h5>Total Despesas</h5>
        <div class="dashboard-card pagar">
          <p class="valor">${formatarMoeda(dados.despesas || 0)}</p>
        </div>
      </div>
    </div>
    <div class="mt-4">
      <h5>Comparativo Mensal</h5>
      <div class="financeiro-tabela">
        <table>
          <thead>
            <tr>
              <th>Mês</th>
              <th>Receitas</th>
              <th>Despesas</th>
              <th>Saldo</th>
            </tr>
          </thead>
          <tbody>
            ${(dados.mensal || []).map(item => `
              <tr>
                <td>${item.mes}</td>
                <td>${formatarMoeda(item.receitas)}</td>
                <td>${formatarMoeda(item.despesas)}</td>
                <td class="${item.saldo >= 0 ? 'text-success' : 'text-danger'} font-weight-bold">
                  ${formatarMoeda(item.saldo)}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderizarInadimplencia(dados) {
  return `
    <div class="row">
      <div class="col-md-4">
        <div class="dashboard-card vencido">
          <h3>Contas Vencidas</h3>
          <p class="valor">${dados.vencidas || 0}</p>
        </div>
      </div>
      <div class="col-md-4">
        <div class="dashboard-card amarelo">
          <h3>Contas a Vencer (7 dias)</h3>
          <p class="valor">${dados.vencer7dias || 0}</p>
        </div>
      </div>
      <div class="col-md-4">
        <div class="dashboard-card">
          <h3>Valor Total em Atraso</h3>
          <p class="valor">${formatarMoeda(dados.valorAtraso || 0)}</p>
        </div>
      </div>
    </div>
    <div class="mt-4">
      <h5>Detalhes das Contas em Atraso</h5>
      <div class="financeiro-tabela">
        <table>
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Valor</th>
              <th>Dias em Atraso</th>
              <th>Data Vencimento</th>
            </tr>
          </thead>
          <tbody>
            ${(dados.contasAtraso || []).map(conta => `
              <tr>
                <td>${conta.cliente}</td>
                <td>${formatarMoeda(conta.valor)}</td>
                <td class="text-danger font-weight-bold">${conta.diasAtraso}</td>
                <td>${formatarData(conta.dataVencimento)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderizarLucroPrejuizo(dados) {
  const lucroPrejuizo = (dados.receitas || 0) - (dados.despesas || 0);
  const classe = lucroPrejuizo >= 0 ? 'text-success' : 'text-danger';
  const titulo = lucroPrejuizo >= 0 ? 'Lucro' : 'Prejuízo';

  return `
    <div class="row">
      <div class="col-md-6">
        <h5>Receitas Totais</h5>
        <div class="dashboard-card recebido">
          <p class="valor">${formatarMoeda(dados.receitas || 0)}</p>
        </div>
      </div>
      <div class="col-md-6">
        <h5>Despesas Totais</h5>
        <div class="dashboard-card pagar">
          <p class="valor">${formatarMoeda(dados.despesas || 0)}</p>
        </div>
      </div>
    </div>
    <div class="row mt-3">
      <div class="col-12">
        <h5>${titulo} do Período</h5>
        <div class="dashboard-card saldo">
          <p class="valor ${classe}">${formatarMoeda(Math.abs(lucroPrejuizo))}</p>
        </div>
      </div>
    </div>
  `;
}

function renderizarResumoFinanceiro(dados) {
  return `
    <div class="row">
      <div class="col-md-4">
        <div class="dashboard-card recebido">
          <h5>Receitas</h5>
          <p class="valor">${formatarMoeda(dados.receitas.total || 0)}</p>
          <small>Recebidas: ${formatarMoeda(dados.receitas.recebidas || 0)}</small>
        </div>
      </div>
      <div class="col-md-4">
        <div class="dashboard-card pagar">
          <h5>Despesas</h5>
          <p class="valor">${formatarMoeda(dados.despesas.total || 0)}</p>
          <small>Pagas: ${formatarMoeda(dados.despesas.pagas || 0)}</small>
        </div>
      </div>
      <div class="col-md-4">
        <div class="dashboard-card saldo">
          <h5>Saldo</h5>
          <p class="valor">${formatarMoeda((dados.receitas.total || 0) - (dados.despesas.total || 0))}</p>
        </div>
      </div>
    </div>
  `;
}

function renderizarRelatorioReceber(dados) {
  const colunas = ['Cliente', 'Descrição', 'Documento', 'Vencimento', 'Valor', 'Status', 'Origem'];
  const linhas = (dados.contas || []).map(conta => [
    conta.cliente || '-',
    conta.descricao || '-',
    conta.documento || '-',
    formatarData(conta.dataVencimento),
    formatarMoeda(conta.valor || 0),
    conta.status || '-',
    conta.origem || '-'
  ]);
  return renderTabelaRelatorio(colunas, linhas);
}

function renderizarRelatorioPagar(dados) {
  const colunas = ['Fornecedor', 'Descrição', 'Documento', 'Categoria', 'Vencimento', 'Valor', 'Status', 'Forma de Pagamento', 'Origem'];
  const linhas = (dados.contas || []).map(conta => [
    conta.fornecedor || '-',
    conta.descricao || '-',
    conta.documento || '-',
    conta.categoria || '-',
    formatarData(conta.dataVencimento),
    formatarMoeda(conta.valor || 0),
    conta.status || '-',
    conta.forma_pagamento || '-',
    conta.origem || '-'
  ]);
  return renderTabelaRelatorio(colunas, linhas);
}

function exportarRelatorio() {
  const tipo = document.getElementById('tipoRelatorio').value;
  const periodo = obterPeriodoFinanceiro();

  // Implementar exportação (PDF, Excel, etc.)
  alert(`Exportação do relatório "${tipo}" em desenvolvimento`);
}

// Funções obrigatórias do prompt
function carregarRelatorioSelecionado() {
  const tipo = document.getElementById('tipoRelatorio').value;
  const periodo = obterPeriodoFinanceiro();
  
  switch (tipo) {
    case 'resumo':
      return gerarRelatorioResumo(coletarFiltrosRelatorios(periodo));
    case 'receber':
      return gerarRelatorioReceber(coletarFiltrosRelatorios(periodo));
    case 'pagar':
      return gerarRelatorioPagar(coletarFiltrosRelatorios(periodo));
    case 'fluxo':
      return gerarRelatorioFluxo(coletarFiltrosRelatorios(periodo));
    case 'inadimplencia':
      return gerarRelatorioInadimplencia(coletarFiltrosRelatorios(periodo));
    default:
      return Promise.resolve();
  }
}

async function gerarRelatorioResumo(filtros) {
  try {
    const response = await fetch(
      `/api/financeiro/relatorios/resumo?dataInicio=${filtros.dataInicio}&dataFim=${filtros.dataFim}`,
      {
        headers: {
          'Accept': 'application/json',
          'Authorization': 'Bearer ' + localStorage.getItem('token')
        }
      }
    );

    if (response.status === 401) {
      throw new Error('Sessão expirada. Faça login novamente.');
    }

    const dados = await response.json();

    if (!response.ok) {
      throw new Error(dados.error || 'Erro ao gerar relatório resumo');
    }

    if (dados.success) {
      renderizarRelatorio('resumo', 'Resumo Financeiro', dados.resumo, filtros);
    }
  } catch (error) {
    console.error('Erro ao gerar relatório resumo:', error);
  }
}

async function gerarRelatorioReceber(filtros) {
  try {
    const response = await fetch(
      `/api/financeiro/relatorios/receber?dataInicio=${filtros.dataInicio}&dataFim=${filtros.dataFim}&status=${filtros.status}&cliente=${encodeURIComponent(filtros.cliente || '')}`,
      {
        headers: {
          'Accept': 'application/json',
          'Authorization': 'Bearer ' + localStorage.getItem('token')
        }
      }
    );

    if (response.status === 401) {
      throw new Error('Sessão expirada. Faça login novamente.');
    }

    const dados = await response.json();

    if (!response.ok) {
      throw new Error(dados.error || 'Erro ao gerar relatório receber');
    }

    if (dados.success) {
      renderizarRelatorio('receber', 'Contas a Receber', dados, filtros);
    }
  } catch (error) {
    console.error('Erro ao gerar relatório receber:', error);
  }
}

async function gerarRelatorioPagar(filtros) {
  try {
    const response = await fetch(
      `/api/financeiro/relatorios/pagar?dataInicio=${filtros.dataInicio}&dataFim=${filtros.dataFim}&status=${filtros.status}&fornecedor=${encodeURIComponent(filtros.fornecedor || '')}`,
      {
        headers: {
          'Accept': 'application/json',
          'Authorization': 'Bearer ' + localStorage.getItem('token')
        }
      }
    );

    if (response.status === 401) {
      throw new Error('Sessão expirada. Faça login novamente.');
    }

    const dados = await response.json();

    if (!response.ok) {
      throw new Error(dados.error || 'Erro ao gerar relatório pagar');
    }

    if (dados.success) {
      renderizarRelatorio('pagar', 'Contas a Pagar', dados, filtros);
    }
  } catch (error) {
    console.error('Erro ao gerar relatório pagar:', error);
  }
}

async function gerarRelatorioFluxo(filtros) {
  try {
    const response = await fetch(`/api/financeiro/relatorios/fluxo?dataInicio=${filtros.dataInicio}&dataFim=${filtros.dataFim}`, {
      headers: {
        'Accept': 'application/json',
        'Authorization': 'Bearer ' + localStorage.getItem('token')
      }
    });
    const dados = await response.json();
    
    if (dados.success) {
      renderizarRelatorio('fluxo', 'Fluxo Financeiro', dados, filtros);
    }
  } catch (error) {
    console.error('Erro ao gerar relatório fluxo:', error);
  }
}

async function gerarRelatorioInadimplencia(filtros) {
  try {
    const response = await fetch(
      `/api/financeiro/relatorios/inadimplencia?dataInicio=${filtros.dataInicio}&dataFim=${filtros.dataFim}`,
      {
        headers: {
          'Accept': 'application/json',
          'Authorization': 'Bearer ' + localStorage.getItem('token')
        }
      }
    );

    if (response.status === 401) {
      throw new Error('Sessão expirada. Faça login novamente.');
    }

    const dados = await response.json();

    if (!response.ok) {
      throw new Error(dados.error || 'Erro ao gerar relatório inadimplência');
    }

    if (dados.success) {
      renderizarRelatorio('inadimplencia', 'Relatório de Inadimplência', dados, filtros);
    }
  } catch (error) {
    console.error('Erro ao gerar relatório inadimplência:', error);
  }
}

function renderTabelaRelatorio(colunas, linhas) {
  if (!linhas || linhas.length === 0) {
    return '<div class="text-center text-muted">Nenhum dado encontrado</div>';
  }

  let html = '<div class="financeiro-tabela"><table><thead><tr>';
  
  colunas.forEach(coluna => {
    html += `<th>${coluna}</th>`;
  });
  
  html += '</tr></thead><tbody>';
  
  linhas.forEach(linha => {
    html += '<tr>';
    linha.forEach(celula => {
      html += `<td>${celula}</td>`;
    });
    html += '</tr>';
  });
  
  html += '</tbody></table></div>';
  return html;
}

function coletarFiltrosRelatorios(periodo) {
  return {
    dataInicio: periodo.dataInicio,
    dataFim: periodo.dataFim,
    status: 'todas', // Por enquanto, sem filtros adicionais
    cliente: '',
    fornecedor: ''
  };
}

function formatarMoeda(valor) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(valor);
}

function formatarData(data) {
  return new Date(data).toLocaleDateString('pt-BR');
}

function coletarFiltrosRelatorios(periodo) {
  return {
    dataInicio: periodo.dataInicio,
    dataFim: periodo.dataFim,
    status: document.getElementById('filtroStatusRelatorio')?.value || 'todas',
    cliente: document.getElementById('filtroClienteRelatorio')?.value || '',
    fornecedor: document.getElementById('filtroFornecedorRelatorio')?.value || '',
    tipo: document.getElementById('tipoRelatorio')?.value || 'resumo'
  };
}

function formatarData(data) {
  return new Date(data).toLocaleDateString('pt-BR');
}

function formatarMoeda(valor) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(valor);
}