// Contas a Receber
let modalDetalhesRecebimento = null;

function isAdminFinanceiro() {
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    return user.role === 'admin';
  } catch (e) {
    return false;
  }
}

function escapeHtmlFinanceiroSafe(texto) {
  return String(texto || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderContasReceber(periodo) {
  const conteudo = document.getElementById('financeiroConteudo');

  conteudo.innerHTML = `
    <div class="financeiro-filtros">
      <div class="financeiro-filtro-grupo">
        <label for="filtroClienteReceber">Cliente:</label>
        <input
          type="text"
          id="filtroClienteReceber"
          class="form-control"
          placeholder="Nome ou CPF do cliente"
        />
      </div>
      <div class="financeiro-filtro-grupo">
        <label for="filtroStatusReceber">Status:</label>
        <select id="filtroStatusReceber" class="form-control">
          <option value="todas">Todas</option>
          <option value="vencidas">Vencidas</option>
          <option value="a_vencer">A Vencer</option>
          <option value="recebidas">Recebidas</option>
        </select>
      </div>
      <div class="financeiro-filtro-grupo">
        <label for="filtroDocumentoReceber">Documento:</label>
        <input type="text" id="filtroDocumentoReceber" class="form-control" placeholder="Número do documento">
      </div>
      <div class="financeiro-filtro-grupo">
        <label for="filtroDataInicioReceber">Data Início:</label>
        <input type="date" id="filtroDataInicioReceber" class="form-control" value="${periodo.dataInicio}">
      </div>
      <div class="financeiro-filtro-grupo">
        <label for="filtroDataFimReceber">Data Fim:</label>
        <input type="date" id="filtroDataFimReceber" class="form-control" value="${periodo.dataFim}">
      </div>
      <div class="financeiro-acoes">
        <button class="btn btn-primary" onclick="novoRecebimento()">
          <i class="fas fa-plus"></i> Nova Conta a Receber
        </button>
        <button class="btn btn-success" onclick="exportarReceber('pdf')">
          <i class="fas fa-file-pdf"></i> Exportar PDF
        </button>
        <button class="btn btn-success" onclick="exportarReceber('excel')">
          <i class="fas fa-file-excel"></i> Exportar Excel
        </button>
        <button class="btn btn-secondary" onclick="filtrarReceber()">
          <i class="fas fa-filter"></i> Filtrar
        </button>
      </div>
    </div>

    <div class="financeiro-tabela">
      <table id="tabelaReceber">
        <thead>
          <tr>
            <th>Cliente</th>
            <th>Descrição</th>
            <th>Documento</th>
            <th>Vencimento</th>
            <th>Valor</th>
            <th>Parcela</th>
            <th>Status</th>
            <th>Origem</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colspan="9" class="text-center">Carregando...</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;

  // Configurar filtros
  configurarFiltrosReceber();

  // Carregar dados
  carregarContasReceber(coletarFiltrosReceber(periodo));
}

function renderDuplicataClientes(periodo) {
  const conteudo = document.getElementById('financeiroConteudo');
  conteudo.innerHTML = `
    <div class="financeiro-filtros">
      <div class="financeiro-filtro-grupo">
        <label for="filtroClienteDuplicata">Cliente:</label>
        <input
          type="text"
          id="filtroClienteDuplicata"
          class="form-control"
          placeholder="Nome, CPF ou telefone"
        />
      </div>
      <div class="financeiro-filtro-grupo">
        <label for="filtroStatusDuplicata">Status:</label>
        <select id="filtroStatusDuplicata" class="form-control">
          <option value="todas">Todas</option>
          <option value="vencidas">Vencidas</option>
          <option value="a_vencer">A Vencer</option>
        </select>
      </div>
      <div class="financeiro-filtro-grupo">
        <label for="filtroDataInicioDuplicata">Data Início:</label>
        <input type="date" id="filtroDataInicioDuplicata" class="form-control" value="${periodo.dataInicio}">
      </div>
      <div class="financeiro-filtro-grupo">
        <label for="filtroDataFimDuplicata">Data Fim:</label>
        <input type="date" id="filtroDataFimDuplicata" class="form-control" value="${periodo.dataFim}">
      </div>
      <div class="financeiro-acoes">
        <button class="btn btn-primary" id="btnFiltrarDuplicata">
          <i class="fas fa-filter"></i> Filtrar
        </button>
      </div>
    </div>

    <div class="financeiro-tabela">
      <table id="tabelaDuplicataClientes">
        <thead>
          <tr>
            <th>Cliente</th>
            <th>CPF / Telefone</th>
            <th>Vendas</th>
            <th>Títulos</th>
            <th>Total em Aberto</th>
            <th>Vencidas</th>
            <th>A Vencer</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colspan="8" class="text-center">Carregando...</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div id="duplicataDetalheContainer" class="duplicata-detalhe-container"></div>
  `;

  document.getElementById('btnFiltrarDuplicata').addEventListener('click', () => filtrarDuplicata());
  document.getElementById('filtroClienteDuplicata').addEventListener('input', () => filtrarDuplicata());
  document.getElementById('filtroStatusDuplicata').addEventListener('change', () => filtrarDuplicata());
  carregarDuplicataClientes(coletarFiltrosDuplicata(periodo));
}

function configurarFiltrosReceber() {
  // Configurar eventos de filtro
  document.getElementById('filtroClienteReceber').addEventListener('input', () => filtrarReceber());
  document.getElementById('filtroStatusReceber').addEventListener('change', () => filtrarReceber());
  document.getElementById('filtroDocumentoReceber').addEventListener('input', () => filtrarReceber());
}

function coletarFiltrosDuplicata(periodo) {
  return {
    cliente: document.getElementById('filtroClienteDuplicata').value.trim(),
    status: document.getElementById('filtroStatusDuplicata').value,
    dataInicio: document.getElementById('filtroDataInicioDuplicata').value || periodo.dataInicio,
    dataFim: document.getElementById('filtroDataFimDuplicata').value || periodo.dataFim
  };
}

function filtrarDuplicata() {
  const filtros = coletarFiltrosDuplicata(obterPeriodoFinanceiro());
  carregarDuplicataClientes(filtros);
}

async function carregarDuplicataClientes(filtros) {
  try {
    const queryString = new URLSearchParams(filtros).toString();
    const response = await fetch(`/api/financeiro/receber/agrupado?${queryString}`, {
      headers: {
        'Authorization': 'Bearer ' + localStorage.getItem('token')
      }
    });
    const dados = await response.json();

    if (!dados.success) {
      throw new Error(dados.error || 'Falha ao carregar lista de duplicatas');
    }

    preencherTabelaDuplicataClientes(dados.clientes || []);
  } catch (error) {
    console.error('Erro ao carregar dívidas por cliente:', error);
    const tbody = document.querySelector('#tabelaDuplicataClientes tbody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center text-danger">Erro ao carregar dados</td></tr>';
    }
  }
}

function preencherTabelaDuplicataClientes(clientes) {
  const tbody = document.querySelector('#tabelaDuplicataClientes tbody');
  if (!tbody) return;

  if (clientes.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center">Nenhuma dívida agrupada encontrada</td></tr>';
    return;
  }

  tbody.innerHTML = clientes.map(cliente => `
    <tr>
      <td>${cliente.nome_cliente}</td>
      <td>${cliente.cpf || '-'}<br>${cliente.telefone || '-'}</td>
      <td>${cliente.quantidade_vendas}</td>
      <td>${cliente.quantidade_titulos}</td>
      <td class="font-weight-bold">${formatarMoeda(cliente.total_divida)}</td>
      <td>${cliente.vencidas}</td>
      <td>${cliente.a_vencer}</td>
      <td>
        <button class="btn btn-sm btn-primary" onclick="abrirDuplicataCliente(${cliente.cliente_id})">
          <i class="fas fa-file-invoice-dollar"></i> Ver Duplicata
        </button>
      </td>
    </tr>
  `).join('');
}

async function abrirDuplicataCliente(clienteId) {
  try {
    const response = await fetch(`/api/financeiro/receber/agrupado/${clienteId}`, {
      headers: {
        'Authorization': 'Bearer ' + localStorage.getItem('token')
      }
    });
    const dados = await response.json();

    if (!dados.success) {
      throw new Error(dados.error || 'Falha ao carregar duplicata do cliente');
    }

    renderizarDuplicataCliente(dados);
  } catch (error) {
    console.error('Erro ao abrir duplicata:', error);
    alert('Não foi possível abrir a duplicata do cliente. Tente novamente.');
  }
}

function renderizarDuplicataCliente(dados) {
  const conteudo = document.getElementById('financeiroConteudo');

  const vendasHtml = dados.vendas.map(venda => `
    <div class="duplicata-venda-card">
      <div class="duplicata-venda-header">
        <div>
          <strong>Venda:</strong> ${venda.numero_venda || venda.venda_id}<br>
          <span class="text-muted">Emissão: ${formatarData(venda.data_venda)} • Vencimento: ${formatarData(venda.data_vencimento)}</span>
        </div>
        <div class="duplicata-venda-status">${formatarStatusBadge(venda.status)}</div>
      </div>
      <div class="duplicata-venda-summary">
        <div><strong>Total:</strong> ${formatarMoeda(venda.valor_total)}</div>
        <div><strong>Pago:</strong> ${formatarMoeda(venda.valor_pago)}</div>
        <div><strong>Saldo:</strong> ${formatarMoeda(venda.saldo_aberto)}</div>
      </div>
      <div class="duplicata-venda-actions">
        <button class="btn btn-sm btn-outline-primary" onclick="toggleVendaDuplicataDetalhes(${venda.venda_id})">Detalhes</button>
      </div>
      <div id="duplicataVendaDetalhes-${venda.venda_id}" class="duplicata-venda-detalhes d-none">
        <div class="duplicata-venda-section">
          <h5>Produtos</h5>
          <table class="table table-sm table-striped">
            <thead>
              <tr>
                <th>Produto</th>
                <th>Quantidade</th>
                <th>Preço</th>
                <th>Subtotal</th>
              </tr>
            </thead>
            <tbody>
              ${venda.produtos.map(prod => `
                <tr>
                  <td>${prod.nome_produto || '-'}</td>
                  <td>${prod.quantidade}</td>
                  <td>${formatarMoeda(prod.preco_unitario)}</td>
                  <td>${formatarMoeda(prod.subtotal)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div class="duplicata-venda-section">
          <h5>Parcelas</h5>
          <table class="table table-sm table-hover">
            <thead>
              <tr>
                <th>Parcela</th>
                <th>Valor</th>
                <th>Restante</th>
                <th>Vencimento</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${venda.parcelas.map(parcela => `
                <tr>
                  <td>${parcela.parcela}</td>
                  <td>${formatarMoeda(parcela.valor_parcela)}</td>
                  <td>${formatarMoeda(parcela.valor_restante)}</td>
                  <td>${formatarData(parcela.vencimento)}</td>
                  <td>${formatarStatusBadge(parcela.status)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `).join('');

  conteudo.innerHTML = `
    <div class="duplicata-header-panel">
      <div>
        <button class="btn btn-outline-secondary mb-3" onclick="renderDuplicataClientes(obterPeriodoFinanceiro())">
          <i class="fas fa-arrow-left"></i> Voltar à lista
        </button>
        <h4>Duplicata - ${dados.cliente.nome}</h4>
        <p class="text-muted">${dados.cliente.cpf || ''}${dados.cliente.cpf && dados.cliente.telefone ? ' • ' : ''}${dados.cliente.telefone || ''}</p>
        <p class="text-muted">${dados.cliente.endereco || ''}</p>
      </div>
      <div class="duplicata-actions-panel">
        <button class="btn btn-success" onclick="abrirPagamentoParcialDuplicata(${dados.cliente.id})">
          <i class="fas fa-hand-holding-usd"></i> Pagamento Parcial
        </button>
        <button class="btn btn-primary" onclick="imprimirExtratoDuplicata(${dados.cliente.id})">
          <i class="fas fa-print"></i> Imprimir Extrato
        </button>
      </div>
    </div>

    <div class="duplicata-resumo-cards">
      <div class="duplicata-resumo-card">
        <strong>Total da Dívida</strong>
        <div>${formatarMoeda(dados.resumo.totalDivida)}</div>
      </div>
      <div class="duplicata-resumo-card">
        <strong>Já Pago</strong>
        <div>${formatarMoeda(dados.resumo.totalPago)}</div>
      </div>
      <div class="duplicata-resumo-card">
        <strong>Saldo Atual</strong>
        <div>${formatarMoeda(dados.resumo.saldoAtual)}</div>
      </div>
      <div class="duplicata-resumo-card">
        <strong>Vendas em Aberto</strong>
        <div>${dados.resumo.quantidadeVendas}</div>
      </div>
      <div class="duplicata-resumo-card">
        <strong>Parcelas em Aberto</strong>
        <div>${dados.resumo.quantidadeTitulos}</div>
      </div>
    </div>

    <div class="duplicata-venda-list">
      ${vendasHtml || '<div class="text-center text-muted py-4">Nenhuma venda em aberto para este cliente.</div>'}
    </div>
  `;
}

function toggleVendaDuplicataDetalhes(vendaId) {
  const target = document.getElementById(`duplicataVendaDetalhes-${vendaId}`);
  if (target) {
    target.classList.toggle('d-none');
  }
}

async function imprimirExtratoDuplicata(clienteId) {
  try {
    const response = await fetch(`/api/financeiro/receber/agrupado/${clienteId}/extrato`, {
      headers: {
        'Authorization': 'Bearer ' + localStorage.getItem('token')
      }
    });
    const dados = await response.json();

    if (!dados.success) {
      throw new Error(dados.error || 'Falha ao gerar extrato');
    }

    const html = gerarHtmlExtratoDuplicata(dados);
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Não foi possível abrir a janela de impressão. Verifique o bloqueador de pop-ups.');
      return;
    }

    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  } catch (error) {
    console.error('Erro ao gerar extrato:', error);
    alert('Não foi possível gerar o extrato. Tente novamente.');
  }
}

let modalPagamentoParcialInicializada = false;
let modalConfirmacaoPagamentoParcial = null;
let pagamentoParcialDadosConfirmacao = null;

async function abrirPagamentoParcialDuplicata(clienteId) {
  try {
    if (!modalPagamentoParcialInicializada) {
      inicializarModalPagamentoParcial();
      modalPagamentoParcialInicializada = true;
    }

    const response = await fetch(`/api/financeiro/receber/agrupado/${clienteId}`, {
      headers: {
        'Authorization': 'Bearer ' + localStorage.getItem('token')
      }
    });
    const dados = await response.json();

    if (!dados.success) {
      alert('Não foi possível carregar informações do cliente');
      return;
    }

    const cliente = dados.cliente;
    const saldoAtual = dados.resumo.saldoAtual;

    document.getElementById('modalPagamentoParcialClienteNome').textContent = cliente.nome;
    document.getElementById('modalPagamentoParcialSaldo').textContent = formatarMoeda(saldoAtual);
    
    document.getElementById('formPagamentoParcial').reset();
    document.getElementById('pagamentoParcialData').value = new Date().toISOString().split('T')[0];
    document.getElementById('pagamentoParcialForma').value = 'dinheiro';
    document.getElementById('pagamentoParcialValor').focus();

    document.getElementById('btnConfirmarPagamentoParcial').dataset.clienteId = clienteId;

    const modal = new bootstrap.Modal(document.getElementById('modalPagamentoParcial'));
    modal.show();
  } catch (error) {
    console.error('Erro ao abrir pagamento parcial:', error);
    alert('Erro ao abrir formulário de pagamento');
  }
}

function inicializarModalPagamentoParcial() {
  const btnConfirmar = document.getElementById('btnConfirmarPagamentoParcial');
  const btnConfirmarSim = document.getElementById('btnConfirmacaoPagamentoParcialSim');
  const modalConfirmacaoElement = document.getElementById('modalConfirmacaoPagamentoParcial');

  if (!btnConfirmar || !btnConfirmarSim || !modalConfirmacaoElement) {
    console.warn('Elementos de confirmação de pagamento parcial não encontrados');
    return;
  }

  if (!btnConfirmar.hasAttribute('data-listener-attached')) {
    btnConfirmar.addEventListener('click', confirmarPagamentoParcial);
    btnConfirmar.setAttribute('data-listener-attached', 'true');
  }

  modalConfirmacaoPagamentoParcial = new bootstrap.Modal(modalConfirmacaoElement);

  if (!btnConfirmarSim.hasAttribute('data-listener-attached')) {
    btnConfirmarSim.addEventListener('click', enviarPagamentoParcialConfirmado);
    btnConfirmarSim.setAttribute('data-listener-attached', 'true');
  }
}

function confirmarPagamentoParcial(event) {
  event.preventDefault();
  const btnConfirmar = event.currentTarget;
  const clienteId = btnConfirmar.dataset.clienteId;
  
  if (!clienteId) {
    alert('Erro: Cliente não identificado');
    return;
  }

  const valor = document.getElementById('pagamentoParcialValor').value.trim();
  const data = document.getElementById('pagamentoParcialData').value;
  const forma = document.getElementById('pagamentoParcialForma').value;
  const observacao = document.getElementById('pagamentoParcialObservacao').value.trim();

  if (!valor || parseFloat(valor) <= 0) {
    alert('Informe um valor válido e maior que zero');
    document.getElementById('pagamentoParcialValor').focus();
    return;
  }

  if (!data) {
    alert('Informe a data do pagamento');
    return;
  }

  pagamentoParcialDadosConfirmacao = {
    clienteId,
    valor: parseFloat(valor),
    data,
    forma,
    observacao: observacao || 'Pagamento parcial via duplicata agrupada'
  };

  const textoConfirmacao = `Confirmar pagamento de R$ ${pagamentoParcialDadosConfirmacao.valor.toFixed(2)} em ${pagamentoParcialDadosConfirmacao.data}?`;
  document.getElementById('confirmacaoPagamentoParcialTexto').textContent = textoConfirmacao;

  if (modalConfirmacaoPagamentoParcial) {
    modalConfirmacaoPagamentoParcial.show();
  }
}

async function enviarPagamentoParcialConfirmado(event) {
  event.preventDefault();
  const btnConfirmarSim = event.currentTarget;

  if (!pagamentoParcialDadosConfirmacao) {
    alert('Dados de pagamento não encontrados. Tente novamente.');
    return;
  }

  const { clienteId, valor, data, forma, observacao } = pagamentoParcialDadosConfirmacao;

  try {
    btnConfirmarSim.disabled = true;
    btnConfirmarSim.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processando...';

    if (modalConfirmacaoPagamentoParcial) {
      modalConfirmacaoPagamentoParcial.hide();
    }

    const response = await fetch(`/api/financeiro/receber/agrupado/${clienteId}/pagamento-parcial`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + localStorage.getItem('token')
      },
      body: JSON.stringify({
        valor,
        data_pagamento: data,
        forma_pagamento: forma,
        observacao
      })
    });

    const dados = await response.json();

    if (!dados.success) {
      throw new Error(dados.error || 'Erro ao processar pagamento');
    }

    const modalParcial = bootstrap.Modal.getInstance(document.getElementById('modalPagamentoParcial'));
    if (modalParcial) {
      modalParcial.hide();
    }

    alert('Pagamento parcial registrado com sucesso!');
    abrirDuplicataCliente(clienteId);
  } catch (error) {
    console.error('Erro ao confirmar pagamento:', error);
    alert('Não foi possível processar o pagamento: ' + error.message);
  } finally {
    btnConfirmarSim.disabled = false;
    btnConfirmarSim.innerHTML = 'Sim';
    pagamentoParcialDadosConfirmacao = null;
  }
}


function gerarHtmlExtratoDuplicata(dados) {
  const vendasHtml = dados.vendas.map(venda => `
    <tr>
      <td>${venda.numero_venda || venda.venda_id}</td>
      <td>${formatarData(venda.data_venda)}</td>
      <td>${formatarMoeda(venda.valor_total)}</td>
      <td>${formatarMoeda(venda.saldo_aberto)}</td>
      <td>${formatarStatusBadge(venda.status)}</td>
    </tr>
  `).join('');

  return `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <title>Extrato de Duplicata</title>
      <style>
        body { font-family: Arial, sans-serif; color: #2c3e50; margin: 20px; }
        h1, h2, h3, h4, h5 { margin: 0; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
        .header .empresa { max-width: 60%; }
        .header .cliente { text-align: right; }
        .resumo { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; margin-bottom: 20px; }
        .resumo-card { padding: 14px; background: #f8f9fa; border-radius: 8px; border: 1px solid #e9ecef; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
        th, td { padding: 10px; border: 1px solid #dfe3e6; }
        th { background: #f1f3f5; text-align: left; }
        .status-badge { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 0.85rem; }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="empresa">
          <h1>${dados.empresa.nome || 'Empresa'}</h1>
          <p>${dados.empresa.endereco || ''}</p>
          <p>CNPJ: ${formatarCNPJ(dados.empresa.cnpj) || '-'}</p>
          <p>Tel: ${dados.empresa.telefone || '-'}</p>
        </div>
        <div class="cliente">
          <h2>Extrato de Dívida</h2>
          <p>${dados.cliente.nome}</p>
          <p>${formatarCPF(dados.cliente.cpf) || ''}</p>
          <p>${dados.cliente.telefone || ''}</p>
          <p>${dados.cliente.endereco || ''}</p>
          <p>Gerado em: ${dados.geradoEm}</p>
        </div>
      </div>
      <div class="resumo">
        <div class="resumo-card"><strong>Total da Dívida</strong><div>${formatarMoeda(dados.resumo.totalDivida)}</div></div>
        <div class="resumo-card"><strong>Total Pago</strong><div>${formatarMoeda(dados.resumo.totalPago)}</div></div>
        <div class="resumo-card"><strong>Saldo Atual</strong><div>${formatarMoeda(dados.resumo.saldoAtual)}</div></div>
        <div class="resumo-card"><strong>Vendas</strong><div>${dados.resumo.quantidadeVendas}</div></div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Venda</th>
            <th>Emissão</th>
            <th>Valor Total</th>
            <th>Saldo</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${vendasHtml}
        </tbody>
      </table>
      <p>Este extrato apresenta as informações de dívida agrupadas por cliente e as vendas em aberto.</p>
    </body>
    </html>
  `;
}

function formatarStatusBadge(status) {
  const map = {
    aberto: '<span class="status-badge" style="background:#ffe8cc;color:#a56300;">Em aberto</span>',
    vencido: '<span class="status-badge" style="background:#f8d7da;color:#721c24;">Vencido</span>',
    parcial: '<span class="status-badge" style="background:#d1ecf1;color:#0c5460;">Parcial</span>',
    recebido: '<span class="status-badge" style="background:#d4edda;color:#155724;">Recebido</span>',
    pago: '<span class="status-badge" style="background:#d4edda;color:#155724;">Pago</span>'
  };
  return map[status] || `<span class="status-badge" style="background:#e2e3e5;color:#383d41;">${status}</span>`;
}

async function carregarContasReceber(filtros) {
  try {
    const queryString = new URLSearchParams(filtros).toString();
    const response = await fetch(`/api/financeiro/receber?${queryString}`, {
      headers: {
        'Authorization': 'Bearer ' + localStorage.getItem('token')
      }
    });
    const dados = await response.json();

    preencherTabelaContasReceber(dados.contas || []);
  } catch (error) {
    console.error('Erro ao carregar contas a receber:', error);
    document.querySelector('#tabelaReceber tbody').innerHTML =
      '<tr><td colspan="9" class="text-center text-danger">Erro ao carregar dados</td></tr>';
  }
}

function preencherTabelaContasReceber(contas) {
  const tbody = document.querySelector('#tabelaReceber tbody');

  if (contas.length > 0) {
    tbody.innerHTML = contas.map(conta => `
      <tr>
        <td>${conta.cliente || '-'}</td>
        <td>${conta.descricao}</td>
        <td>${conta.documento || '-'}</td>
        <td>${formatarData(conta.vencimento)}</td>
        <td class="font-weight-bold">${formatarMoeda(conta.valor)}</td>
        <td>${conta.numero_parcela || '-'} / ${conta.total_parcelas || '-'}</td>
        <td><span class="status-${conta.status}">${conta.status}</span></td>
        <td>${conta.origem || 'manual'}</td>
        <td>
          <button class="btn btn-sm btn-outline-success" onclick="baixarRecebimento(${conta.id})" title="Baixar">
            <i class="fas fa-check"></i>
          </button>
          <button class="btn btn-sm btn-outline-info" onclick="abrirDetalhesReceber(${conta.id})" title="Detalhes">
            <i class="fas fa-eye"></i>
          </button>
          <button class="btn btn-sm btn-outline-primary" onclick="editarContaReceber(${conta.id})" title="Editar">
            <i class="fas fa-edit"></i>
          </button>
          <button class="btn btn-sm btn-outline-warning" onclick="renegociarContaReceber(${conta.id})" title="Renegociar">
            <i class="fas fa-handshake"></i>
          </button>
          <button class="btn btn-sm btn-outline-danger" onclick="cancelarContaReceber(${conta.id})" title="Cancelar">
            <i class="fas fa-times"></i>
          </button>
        </td>
      </tr>
    `).join('');
  } else {
    tbody.innerHTML = '<tr><td colspan="9" class="text-center">Nenhuma conta a receber encontrada</td></tr>';
  }
}

function coletarFiltrosReceber(periodo) {
  return {
    cliente: document.getElementById('filtroClienteReceber').value.trim(),
    status: document.getElementById('filtroStatusReceber').value,
    documento: document.getElementById('filtroDocumentoReceber').value.trim(),
    dataInicio: document.getElementById('filtroDataInicioReceber').value || periodo.dataInicio,
    dataFim: document.getElementById('filtroDataFimReceber').value || periodo.dataFim
  };
}

function filtrarReceber() {
  const filtros = coletarFiltrosReceber(obterPeriodoFinanceiro());
  carregarContasReceber(filtros);
}

async function baixarRecebimento(id) {
  if (!confirm('Tem certeza que deseja baixar este recebimento?')) return;

  try {
    const response = await fetch(`/api/financeiro/receber/${id}/baixar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + localStorage.getItem('token')
      }
    });

    const dados = await response.json();

    if (dados.success) {
      alert('Recebimento baixado com sucesso!');
      const periodo = obterPeriodoFinanceiro();
      carregarContasReceber(coletarFiltrosReceber(periodo));
      // Atualizar dashboard se estiver ativo
      if (typeof carregarDashboardFinanceiro === 'function') {
        carregarDashboardFinanceiro(obterPeriodoFinanceiro());
      }
    } else {
      alert('Erro ao baixar recebimento: ' + (dados.error || 'Erro desconhecido'));
    }
  } catch (error) {
    console.error('Erro ao baixar recebimento:', error);
    alert('Erro ao baixar recebimento');
  }
}

function editarContaReceber(id) {
  // Implementar edição
  alert(`Editar conta a receber ${id} - Em desenvolvimento`);
}

function inicializarModalDetalhesRecebimento() {
  if (!modalDetalhesRecebimento) {
    const modalElement = document.getElementById('modalDetalhesFinanceiro');
    if (modalElement) {
      modalDetalhesRecebimento = new bootstrap.Modal(modalElement);
    }
  }
}

function abrirDetalhesReceber(id) {
  inicializarModalDetalhesRecebimento();

  const body = document.getElementById('modalDetalhesFinanceiroBody');
  const title = document.getElementById('modalDetalhesFinanceiroLabel');

  if (!body || !title) {
    alert('Modal de detalhes não encontrado.');
    return;
  }

  title.textContent = 'Detalhes do Recebimento';
  body.innerHTML = '<div class="text-center text-muted">Carregando detalhes...</div>';

  if (modalDetalhesRecebimento) {
    modalDetalhesRecebimento.show();
  }

  fetch(`/api/financeiro/${id}`, {
    headers: {
      'Authorization': 'Bearer ' + localStorage.getItem('token')
    }
  })
    .then(response => response.json())
    .then(dados => {
      if (!dados || dados.error) {
        throw new Error(dados.error || 'Falha ao carregar detalhes do recebimento.');
      }

      const adminAcoes = isAdminFinanceiro() ? `
        <hr>
        <div class="d-flex gap-2 justify-content-end flex-wrap">
          <button class="btn btn-primary" onclick="abrirEdicaoReceber(${dados.id})">
            <i class="fas fa-edit"></i> Editar
          </button>
          <button class="btn btn-danger" onclick="excluirContaReceber(${dados.id})">
            <i class="fas fa-trash"></i> Excluir
          </button>
        </div>
      ` : '';

      body.innerHTML = `
        <div class="row g-3">
          <div class="col-12 col-md-6"><strong>Cliente:</strong> ${escapeHtmlFinanceiroSafe(dados.pessoa_nome || '-')}</div>
          <div class="col-12 col-md-6"><strong>Documento:</strong> ${escapeHtmlFinanceiroSafe(dados.documento || '-')}</div>
          <div class="col-12 col-md-6"><strong>Valor:</strong> ${formatarMoeda(Number(dados.valor || 0))}</div>
          <div class="col-12 col-md-6"><strong>Data Movimento:</strong> ${dados.data_movimento ? formatarData(dados.data_movimento) : '-'}</div>
          <div class="col-12 col-md-6"><strong>Vencimento:</strong> ${dados.vencimento ? formatarData(dados.vencimento) : '-'}</div>
          <div class="col-12 col-md-6"><strong>Status:</strong> ${formatarStatusBadge(dados.status)}</div>
          <div class="col-12 col-md-6"><strong>Origem:</strong> ${escapeHtmlFinanceiroSafe(dados.origem || 'manual')}</div>
          <div class="col-12 col-md-6"><strong>Parcela:</strong> ${dados.numero_parcela || '-'} / ${dados.total_parcelas || '-'}</div>
          <div class="col-12">
            <strong>Descrição:</strong>
            <p class="mb-1">${escapeHtmlFinanceiroSafe(dados.descricao || '-')}</p>
          </div>
          <div class="col-12">
            <strong>Observação:</strong>
            <p class="mb-0">${escapeHtmlFinanceiroSafe(dados.observacao || '-')}</p>
          </div>
        </div>
        ${adminAcoes}
      `;
    })
    .catch(error => {
      console.error('Erro ao carregar detalhes do recebimento:', error);
      body.innerHTML = `<div class="text-danger">Não foi possível carregar os detalhes. ${escapeHtmlFinanceiroSafe(error.message || '')}</div>`;
    });
}

async function abrirEdicaoReceber(id) {
  const body = document.getElementById('modalDetalhesFinanceiroBody');
  if (!body) return;

  body.innerHTML = '<div class="text-center text-muted">Carregando dados para edição...</div>';

  try {
    const response = await fetch(`/api/financeiro/${id}`, {
      headers: {
        'Authorization': 'Bearer ' + localStorage.getItem('token')
      }
    });

    const dados = await response.json();

    if (!response.ok || dados.error) {
      throw new Error(dados.error || 'Erro ao carregar recebimento para edição.');
    }

    body.innerHTML = `
      <form id="formEditarReceber" class="row g-3">
        <div class="col-md-8">
          <label class="form-label">Descrição</label>
          <input type="text" class="form-control" id="editarReceberDescricao" value="${escapeHtmlFinanceiroSafe(dados.descricao || '')}" required>
        </div>

        <div class="col-md-4">
          <label class="form-label">Valor</label>
          <input type="number" class="form-control" id="editarReceberValor" value="${Number(dados.valor || 0)}" min="0.01" step="0.01" required>
        </div>

        <div class="col-md-4">
          <label class="form-label">Data Movimento</label>
          <input type="date" class="form-control" id="editarReceberData" value="${dados.data_movimento || ''}" required>
        </div>

        <div class="col-md-4">
          <label class="form-label">Vencimento</label>
          <input type="date" class="form-control" id="editarReceberVencimento" value="${dados.vencimento || ''}">
        </div>

        <div class="col-md-4">
          <label class="form-label">Status</label>
          <select class="form-control" id="editarReceberStatus">
            <option value="pendente" ${dados.status === 'pendente' ? 'selected' : ''}>Pendente</option>
            <option value="recebido" ${dados.status === 'recebido' ? 'selected' : ''}>Recebido</option>
            <option value="pago" ${dados.status === 'pago' ? 'selected' : ''}>Pago</option>
            <option value="parcial" ${dados.status === 'parcial' ? 'selected' : ''}>Parcial</option>
            <option value="vencido" ${dados.status === 'vencido' ? 'selected' : ''}>Vencido</option>
          </select>
        </div>

        <div class="col-md-6">
          <label class="form-label">Cliente</label>
          <input type="text" class="form-control" id="editarReceberPessoa" value="${escapeHtmlFinanceiroSafe(dados.pessoa_nome || '')}">
        </div>

        <div class="col-md-6">
          <label class="form-label">Documento</label>
          <input type="text" class="form-control" id="editarReceberDocumento" value="${escapeHtmlFinanceiroSafe(dados.documento || '')}">
        </div>

        <div class="col-md-6">
          <label class="form-label">Categoria</label>
          <input type="text" class="form-control" id="editarReceberCategoria" value="${escapeHtmlFinanceiroSafe(dados.categoria || '')}">
        </div>

        <div class="col-md-6">
          <label class="form-label">Forma de pagamento</label>
          <input type="text" class="form-control" id="editarReceberForma" value="${escapeHtmlFinanceiroSafe(dados.forma_pagamento || '')}">
        </div>

        <div class="col-12">
          <label class="form-label">Observação</label>
          <textarea class="form-control" id="editarReceberObservacao" rows="3">${escapeHtmlFinanceiroSafe(dados.observacao || '')}</textarea>
        </div>

        <div class="col-12 d-flex gap-2 justify-content-end flex-wrap">
          <button type="button" class="btn btn-secondary" onclick="abrirDetalhesReceber(${id})">Cancelar</button>
          <button type="submit" class="btn btn-primary">Salvar Alterações</button>
        </div>
      </form>
    `;

    const form = document.getElementById('formEditarReceber');
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      await salvarEdicaoReceber(id);
    });
  } catch (error) {
    console.error('Erro ao abrir edição do recebimento:', error);
    body.innerHTML = `<div class="text-danger">Erro ao carregar formulário de edição. ${escapeHtmlFinanceiroSafe(error.message || '')}</div>`;
  }
}

async function salvarEdicaoReceber(id) {
  try {
    const payload = {
      descricao: document.getElementById('editarReceberDescricao')?.value?.trim() || '',
      valor: Number(document.getElementById('editarReceberValor')?.value || 0),
      data_movimento: document.getElementById('editarReceberData')?.value || '',
      vencimento: document.getElementById('editarReceberVencimento')?.value || '',
      status: document.getElementById('editarReceberStatus')?.value || 'pendente',
      pessoa_nome: document.getElementById('editarReceberPessoa')?.value?.trim() || '',
      documento: document.getElementById('editarReceberDocumento')?.value?.trim() || '',
      categoria: document.getElementById('editarReceberCategoria')?.value?.trim() || '',
      forma_pagamento: document.getElementById('editarReceberForma')?.value?.trim() || '',
      observacao: document.getElementById('editarReceberObservacao')?.value?.trim() || ''
    };

    if (!payload.descricao || payload.valor <= 0 || !payload.data_movimento) {
      alert('Preencha descrição, valor e data do movimento.');
      return;
    }

    const response = await fetch(`/api/financeiro/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + localStorage.getItem('token')
      },
      body: JSON.stringify(payload)
    });

    const dados = await response.json();

    if (!response.ok || dados.error) {
      throw new Error(dados.error || 'Erro ao salvar alterações.');
    }

    alert('Recebimento atualizado com sucesso.');

    const periodo = obterPeriodoFinanceiro();
    carregarContasReceber(coletarFiltrosReceber(periodo));

    if (typeof carregarDashboardFinanceiro === 'function') {
      carregarDashboardFinanceiro(periodo);
    }

    if (typeof carregarHistoricoFinanceiro === 'function') {
      carregarHistoricoFinanceiro(periodo);
    }

    abrirDetalhesReceber(id);
  } catch (error) {
    console.error('Erro ao salvar edição do recebimento:', error);
    alert(error.message || 'Erro ao salvar alterações.');
  }
}

function renegociarContaReceber(id) {
  // Implementar renegociação
  alert(`Renegociar conta a receber ${id} - Em desenvolvimento`);
}

async function excluirContaReceber(id) {
  if (!confirm('Tem certeza que deseja excluir este recebimento?')) return;

  try {
    const response = await fetch(`/api/financeiro/${id}`, {
      method: 'DELETE',
      headers: {
        'Authorization': 'Bearer ' + localStorage.getItem('token')
      }
    });

    const dados = await response.json();

    if (!response.ok || dados.error) {
      throw new Error(dados.error || 'Erro ao excluir recebimento.');
    }

    alert('Recebimento excluído com sucesso.');

    if (modalDetalhesRecebimento) {
      modalDetalhesRecebimento.hide();
    }

    const periodo = obterPeriodoFinanceiro();
    carregarContasReceber(coletarFiltrosReceber(periodo));

    if (typeof carregarDashboardFinanceiro === 'function') {
      carregarDashboardFinanceiro(periodo);
    }

    if (typeof carregarHistoricoFinanceiro === 'function') {
      carregarHistoricoFinanceiro(periodo);
    }
  } catch (error) {
    console.error('Erro ao excluir recebimento:', error);
    alert(error.message || 'Erro ao excluir recebimento.');
  }
}

function novoRecebimento() {
  // Implementar modal ou navegação para novo recebimento
  alert('Nova conta a receber - Em desenvolvimento');
}

function exportarReceber(tipo) {
  // Implementar exportação
  alert(`Exportação ${tipo.toUpperCase()} em desenvolvimento`);
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

window.abrirEdicaoReceber = abrirEdicaoReceber;
window.salvarEdicaoReceber = salvarEdicaoReceber;
window.excluirContaReceber = excluirContaReceber;