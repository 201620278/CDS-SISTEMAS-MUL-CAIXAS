window.__financeiroPagarState = window.__financeiroPagarState || {
  modalNovaDespesaInstance: null,
  modalDetalhesPagamento: null,
  modalPagamentoInstance: null,
  contaPagamentoAtual: null
};

function isAdminFinanceiroPagar() {
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    return user.role === 'admin';
  } catch (e) {
    return false;
  }
}

// Contas a Pagar
function renderContasPagar(periodo) {
  const conteudo = document.getElementById('financeiroConteudo');

  if (!conteudo) return;

  conteudo.innerHTML = `
    <div class="financeiro-filtros">
      <div class="financeiro-filtro-grupo">
        <label for="filtroStatusPagar">Status:</label>
        <select id="filtroStatusPagar" class="form-control">
          <option value="todos">Todos</option>
          <option value="pendente">Pendente</option>
          <option value="pago">Pago</option>
          <option value="parcial">Parcial</option>
          <option value="vencido">Vencido</option>
        </select>
      </div>

      <div class="financeiro-filtro-grupo">
        <label for="filtroFornecedorPagar">Fornecedor:</label>
        <input
          type="text"
          id="filtroFornecedorPagar"
          class="form-control"
          placeholder="Nome, CPF ou CNPJ do fornecedor"
        />
      </div>

      <div class="financeiro-acoes">
        <button class="btn btn-danger" onclick="novaDespesa()">
          <i class="fas fa-plus"></i> Nova Despesa
        </button>
        <button class="btn btn-success" onclick="exportarPagar()">
          <i class="fas fa-download"></i> Exportar
        </button>
      </div>
    </div>

    <div class="financeiro-tabela">
      <table id="tabelaPagar">
        <thead>
          <tr>
            <th>Data</th>
            <th>Vencimento</th>
            <th>Fornecedor</th>
            <th>Categoria</th>
            <th>Descrição</th>
            <th>Valor</th>
            <th>Status</th>
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

    <div class="modal fade" id="modalNovaDespesa" tabindex="-1" aria-labelledby="modalNovaDespesaLabel" aria-hidden="true">
      <div class="modal-dialog modal-lg">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title" id="modalNovaDespesaLabel">Nova Despesa</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
          </div>
          <form id="formNovaDespesa">
            <div class="modal-body">
              <div class="row g-3">
                <div class="col-md-8">
                  <label class="form-label">Descrição *</label>
                  <input type="text" class="form-control" id="despesaDescricao" required>
                </div>

                <div class="col-md-4">
                  <label class="form-label">Categoria *</label>
                  <select class="form-select" id="despesaCategoria" required>
                    <option value="">Carregando...</option>
                  </select>
                </div>

                <div class="col-md-4">
                  <label class="form-label">Valor *</label>
                  <input type="number" class="form-control" id="despesaValor" min="0.01" step="0.01" required>
                </div>

                <div class="col-md-4">
                  <label class="form-label">Data do lançamento *</label>
                  <input type="date" class="form-control" id="despesaData" required>
                </div>

                <div class="col-md-4">
                  <label class="form-label">Vencimento *</label>
                  <input type="date" class="form-control" id="despesaVencimento" required>
                </div>

                <div class="col-md-12">
                  <div class="form-check">
                    <input class="form-check-input" type="checkbox" id="despesaParcelado">
                    <label class="form-check-label" for="despesaParcelado">
                      Pagamento parcelado
                    </label>
                  </div>
                </div>

                <div class="col-md-3" id="parcelasGroup" style="display: none;">
                  <label class="form-label">Número de parcelas *</label>
                  <input type="number" class="form-control" id="despesaParcelas" min="2" max="60" value="2">
                </div>

                <div class="col-md-3" id="intervaloGroup" style="display: none;">
                  <label class="form-label">Intervalo (dias) *</label>
                  <input type="number" class="form-control" id="despesaIntervalo" min="1" max="365" value="30">
                </div>

                <div class="col-md-6">
                  <label class="form-label">Fornecedor / Favorecido</label>
                  <input type="text" class="form-control" id="despesaFornecedor" placeholder="Opcional">
                </div>

                <div class="col-md-3">
                  <label class="form-label">Forma de pagamento</label>
                  <select class="form-select" id="despesaFormaPagamento">
                    <option value="dinheiro">Dinheiro</option>
                    <option value="pix">PIX</option>
                    <option value="boleto">Boleto</option>
                    <option value="cartao">Cartão</option>
                    <option value="transferencia">Transferência</option>
                    <option value="outro">Outro</option>
                  </select>
                </div>

                <div class="col-md-3">
                  <label class="form-label">Status</label>
                  <select class="form-select" id="despesaStatus">
                    <option value="pendente">Pendente</option>
                    <option value="pago">Pago</option>
                  </select>
                </div>

                <div class="col-12">
                  <label class="form-label">Observação</label>
                  <textarea class="form-control" id="despesaObservacao" rows="3"></textarea>
                </div>
              </div>

              <div id="erroNovaDespesa" class="text-danger mt-3"></div>

              <div id="previaParcelas" class="mt-3"></div>
            </div>

            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
              <button type="submit" class="btn btn-danger">Salvar Despesa</button>
            </div>
          </form>
        </div>
      </div>
    </div>

    <div class="modal fade" id="modalPagamento" tabindex="-1" aria-labelledby="modalPagamentoLabel" aria-hidden="true">
      <div class="modal-dialog modal-sm">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title" id="modalPagamentoLabel">Pagar Conta</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
          </div>
          <form id="formPagamento">
            <div class="modal-body">
              <div class="row g-3">
                <div class="col-12">
                  <label class="form-label">Valor a Pagar *</label>
                  <input type="number" class="form-control" id="pagamentoValor" min="0.01" step="0.01" required>
                  <small class="text-muted">Valor restante: <span id="pagamentoValorRestante">R$ 0,00</span></small>
                </div>

                <div class="col-12">
                  <label class="form-label">Forma de Pagamento *</label>
                  <select class="form-select" id="pagamentoForma" required>
                    <option value="">Selecione...</option>
                    <option value="dinheiro">Dinheiro</option>
                    <option value="pix">PIX</option>
                    <option value="boleto">Boleto</option>
                    <option value="cartao_credito">Cartão de Crédito</option>
                    <option value="cartao_debito">Cartão de Débito</option>
                    <option value="transferencia">Transferência</option>
                    <option value="cheque">Cheque</option>
                    <option value="outro">Outro</option>
                  </select>
                </div>
              </div>

              <div id="erroPagamento" class="text-danger mt-3"></div>
            </div>

            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
              <button type="submit" class="btn btn-success">Confirmar Pagamento</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `;

  configurarFiltrosPagar();
  inicializarModalNovaDespesa();
  inicializarModalPagamento();
  carregarContasPagar(coletarFiltrosPagar(periodo));
}

function configurarFiltrosPagar() {
  const statusField = document.getElementById('filtroStatusPagar');
  const fornecedorField = document.getElementById('filtroFornecedorPagar');

  if (statusField) {
    statusField.addEventListener('change', filtrarPagar);
  }

  if (fornecedorField) {
    fornecedorField.addEventListener('input', filtrarPagar);
  }
}

function carregarContasPagar(filtros) {
  carregarContasPagarDados(filtros);
}

async function carregarContasPagarDados(filtros) {
  try {
    const params = new URLSearchParams({
      dataInicio: filtros.dataInicio || '',
      dataFim: filtros.dataFim || '',
      status: filtros.status || 'todos',
      fornecedor: filtros.fornecedor || ''
    });

    const response = await fetch(`/api/financeiro/contas-pagar?${params.toString()}`, {
      headers: {
        'Accept': 'application/json',
        'Authorization': 'Bearer ' + localStorage.getItem('token')
      }
    });

    if (response.status === 401) {
      throw new Error('Sessão expirada. Faça login novamente.');
    }

    const dados = await response.json();

    if (!response.ok) {
      throw new Error(dados.error || 'Erro ao carregar contas a pagar');
    }

    const tbody = document.querySelector('#tabelaPagar tbody');
    if (!tbody) return;

    if (dados.success && Array.isArray(dados.contas) && dados.contas.length > 0) {
      tbody.innerHTML = dados.contas.map(conta => `
        <tr>
          <td>${formatarDataPagar(conta.dataEmissao)}</td>
          <td>${formatarDataPagar(conta.dataVencimento)}</td>
          <td>${escapeHtmlFinanceiro(conta.fornecedor || '-')}</td>
          <td>${escapeHtmlFinanceiro(conta.categoria || '-')}</td>
          <td>${escapeHtmlFinanceiro(conta.descricao || '')}</td>
          <td class="font-weight-bold">${formatarMoedaPagar(conta.valor)}</td>
          <td><span class="status-${conta.status}">${escapeHtmlFinanceiro(conta.status)}</span></td>
          <td>
            <button class="btn btn-sm btn-outline-primary" onclick="abrirDetalhesPagar(${conta.id})">
              <i class="fas fa-eye"></i>
            </button>
            <button class="btn btn-sm btn-outline-success" onclick="pagarConta(${conta.id})">
              <i class="fas fa-check"></i>
            </button>
          </td>
        </tr>
      `).join('');
    } else {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center">Nenhuma conta a pagar encontrada</td></tr>';
    }
  } catch (error) {
    console.error('Erro ao carregar contas a pagar:', error);
    const tbody = document.querySelector('#tabelaPagar tbody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center text-danger">Erro ao carregar dados</td></tr>';
    }
  }
}

function filtrarPagar() {
  const periodo = obterPeriodoFinanceiro();
  const filtros = coletarFiltrosPagar(periodo);
  carregarContasPagar(filtros);
}

function inicializarModalNovaDespesa() {
  const modalElement = document.getElementById('modalNovaDespesa');
  const form = document.getElementById('formNovaDespesa');

  if (modalElement && !window.__financeiroPagarState.modalNovaDespesaInstance) {
    window.__financeiroPagarState.modalNovaDespesaInstance = new bootstrap.Modal(modalElement);
  }

  if (form && !form.dataset.bound) {
    form.addEventListener('submit', salvarNovaDespesa);
    form.dataset.bound = 'true';
  }

  // Adicionar toggle para campos de parcelamento
  const checkboxParcelado = document.getElementById('despesaParcelado');
  const parcelasGroup = document.getElementById('parcelasGroup');
  const intervaloGroup = document.getElementById('intervaloGroup');

  if (checkboxParcelado && !checkboxParcelado.dataset.bound) {
    checkboxParcelado.addEventListener('change', function() {
      const isChecked = this.checked;
      if (parcelasGroup) parcelasGroup.style.display = isChecked ? 'block' : 'none';
      if (intervaloGroup) intervaloGroup.style.display = isChecked ? 'block' : 'none';
      if (!isChecked) {
        const parcelasEl = document.getElementById('despesaParcelas');
        const intervaloEl = document.getElementById('despesaIntervalo');
        if (parcelasEl) parcelasEl.value = 2;
        if (intervaloEl) intervaloEl.value = 30;
      }
    });
    checkboxParcelado.dataset.bound = 'true';
  }

  // Adicionar event listeners para atualizar prévia
  const despesaValor = document.getElementById('despesaValor');
  const despesaParcelas = document.getElementById('despesaParcelas');
  const despesaIntervalo = document.getElementById('despesaIntervalo');
  const despesaVencimento = document.getElementById('despesaVencimento');

  if (despesaValor && !despesaValor.dataset.bound) {
    despesaValor.addEventListener('input', atualizarPreviaParcelas);
    despesaValor.dataset.bound = 'true';
  }
  if (despesaParcelas && !despesaParcelas.dataset.bound) {
    despesaParcelas.addEventListener('input', atualizarPreviaParcelas);
    despesaParcelas.dataset.bound = 'true';
  }
  if (despesaIntervalo && !despesaIntervalo.dataset.bound) {
    despesaIntervalo.addEventListener('input', atualizarPreviaParcelas);
    despesaIntervalo.dataset.bound = 'true';
  }
  if (despesaVencimento && !despesaVencimento.dataset.bound) {
    despesaVencimento.addEventListener('input', atualizarPreviaParcelas);
    despesaVencimento.dataset.bound = 'true';
  }
}

async function novaDespesa() {
  if (!window.__financeiroPagarState.modalNovaDespesaInstance) {
    inicializarModalNovaDespesa();
  }

  const descricao = document.getElementById('despesaDescricao');
  const valor = document.getElementById('despesaValor');
  const data = document.getElementById('despesaData');
  const vencimento = document.getElementById('despesaVencimento');
  const fornecedor = document.getElementById('despesaFornecedor');
  const formaPagamento = document.getElementById('despesaFormaPagamento');
  const status = document.getElementById('despesaStatus');
  const observacao = document.getElementById('despesaObservacao');
  const erro = document.getElementById('erroNovaDespesa');

  if (descricao) descricao.value = '';
  if (valor) valor.value = '';
  if (data) data.value = new Date().toISOString().slice(0, 10);
  if (vencimento) vencimento.value = new Date().toISOString().slice(0, 10);
  if (fornecedor) fornecedor.value = '';
  if (formaPagamento) formaPagamento.value = 'dinheiro';
  if (status) status.value = 'pendente';
  if (observacao) observacao.value = '';
  if (erro) erro.innerText = '';

  await carregarCategoriasDespesa();

  if (window.__financeiroPagarState.modalNovaDespesaInstance) {
    window.__financeiroPagarState.modalNovaDespesaInstance.show();
  }
}

async function carregarCategoriasDespesa() {
  try {
    const response = await fetch(`${API_URL}/categorias?tipo=despesa`, {
      headers: {
        'Authorization': 'Bearer ' + localStorage.getItem('token')
      }
    });

    const categorias = await response.json();
    const select = document.getElementById('despesaCategoria');
    if (!select) return;

    if (!Array.isArray(categorias) || !categorias.length) {
      select.innerHTML = '<option value="">Nenhuma categoria de despesa cadastrada</option>';
      return;
    }

    select.innerHTML =
      '<option value="">Selecione</option>' +
      categorias.map(cat => `<option value="${escapeHtmlFinanceiro(cat.nome)}">${escapeHtmlFinanceiro(cat.nome)}</option>`).join('');
  } catch (error) {
    console.error('Erro ao carregar categorias de despesa:', error);
    const select = document.getElementById('despesaCategoria');
    if (select) {
      select.innerHTML = '<option value="">Erro ao carregar categorias</option>';
    }
  }
}

async function salvarNovaDespesa(event) {
  event.preventDefault();

  try {
    const erroEl = document.getElementById('erroNovaDespesa');
    if (erroEl) erroEl.innerText = '';

    const payload = {
      tipo: 'despesa',
      descricao: (document.getElementById('despesaDescricao')?.value || '').trim(),
      categoria: document.getElementById('despesaCategoria')?.value || '',
      valor: Number(document.getElementById('despesaValor')?.value || 0),
      data_movimento: document.getElementById('despesaData')?.value || '',
      vencimento: document.getElementById('despesaVencimento')?.value || '',
      pessoa_nome: (document.getElementById('despesaFornecedor')?.value || '').trim() || null,
      forma_pagamento: document.getElementById('despesaFormaPagamento')?.value || 'dinheiro',
      status: document.getElementById('despesaStatus')?.value || 'pendente',
      observacao: (document.getElementById('despesaObservacao')?.value || '').trim(),
      origem: 'manual'
    };

    if (!payload.descricao || !payload.categoria || payload.valor <= 0 || !payload.data_movimento || !payload.vencimento) {
      if (erroEl) erroEl.innerText = 'Preencha os campos obrigatórios.';
      return;
    }

    const isParcelado = document.getElementById('despesaParcelado')?.checked || false;
    const numParcelas = isParcelado ? Number(document.getElementById('despesaParcelas')?.value || 2) : 1;
    const intervaloDias = isParcelado ? Number(document.getElementById('despesaIntervalo')?.value || 30) : 0;

    if (isParcelado && (numParcelas < 2 || intervaloDias < 1)) {
      if (erroEl) erroEl.innerText = 'Preencha número de parcelas (mín. 2) e intervalo (mín. 1 dia) para parcelamento.';
      return;
    }

    const valorParcela = payload.valor / numParcelas;
    let vencimentoBase = new Date(payload.vencimento);

    for (let i = 1; i <= numParcelas; i++) {
      const parcelaPayload = {
        ...payload,
        valor: valorParcela,
        vencimento: new Date(vencimentoBase.getTime() + (i - 1) * intervaloDias * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        numero_parcela: i,
        total_parcelas: numParcelas,
        descricao: `${payload.descricao} (Parcela ${i}/${numParcelas})`
      };

      try {
        const response = await fetch(`${API_URL}/financeiro`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + localStorage.getItem('token')
          },
          body: JSON.stringify(parcelaPayload)
        });

        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.error || `Erro na parcela ${i}`);
        }
      } catch (error) {
        console.error(`Erro ao salvar parcela ${i}:`, error);
        if (erroEl) erroEl.innerText = `Erro ao salvar parcela ${i}: ${error.message}`;
        return;
      }
    }

    if (window.__financeiroPagarState.modalNovaDespesaInstance) {
      window.__financeiroPagarState.modalNovaDespesaInstance.hide();
    }

    if (typeof showNotification === 'function') {
      showNotification('Despesa cadastrada com sucesso.', 'success');
    } else {
      alert('Despesa cadastrada com sucesso.');
    }

    const periodo = obterPeriodoFinanceiro();
    carregarContasPagar(coletarFiltrosPagar(periodo));

    if (typeof carregarDashboardFinanceiro === 'function') {
      carregarDashboardFinanceiro(periodo);
    }

    if (typeof carregarHistoricoFinanceiro === 'function') {
      carregarHistoricoFinanceiro(periodo);
    }
  } catch (error) {
    console.error('Erro ao salvar nova despesa:', error);
    const erroEl = document.getElementById('erroNovaDespesa');
    if (erroEl) erroEl.innerText = 'Erro ao conectar com o servidor.';
  }
}

function inicializarModalDetalhesPagamento() {
  if (!window.__financeiroPagarState.modalDetalhesPagamento) {
    const modalElement = document.getElementById('modalDetalhesFinanceiro');
    if (modalElement) {
      window.__financeiroPagarState.modalDetalhesPagamento = new bootstrap.Modal(modalElement);
    }
  }
}

function inicializarModalPagamento() {
  const modalElement = document.getElementById('modalPagamento');
  const form = document.getElementById('formPagamento');

  if (modalElement && !window.__financeiroPagarState.modalPagamentoInstance) {
    window.__financeiroPagarState.modalPagamentoInstance = new bootstrap.Modal(modalElement);
  }

  if (form && !form.dataset.bound) {
    form.addEventListener('submit', processarPagamento);
    form.dataset.bound = 'true';
  }
}

function pagarConta(id) {
  abrirModalPagamento(id);
}

async function abrirModalPagamento(id) {
  try {
    const response = await fetch(`/api/financeiro/contas-pagar/${id}/detalhes`, {
      headers: {
        'Authorization': 'Bearer ' + localStorage.getItem('token')
      }
    });

    const dados = await response.json();

    if (!response.ok || dados.error) {
      throw new Error(dados.error || 'Erro ao carregar dados da conta.');
    }

    window.__financeiroPagarState.contaPagamentoAtual = dados;

    const valorInput = document.getElementById('pagamentoValor');
    const valorRestanteSpan = document.getElementById('pagamentoValorRestante');
    const formaPagamentoSelect = document.getElementById('pagamentoForma');
    const erroEl = document.getElementById('erroPagamento');

    if (valorInput) {
      valorInput.value = dados.valor || 0;
    }

    if (valorRestanteSpan) {
      valorRestanteSpan.textContent = formatarMoedaPagar(dados.valor || 0);
    }

    if (formaPagamentoSelect) {
      formaPagamentoSelect.value = dados.forma_pagamento || '';
    }

    if (erroEl) {
      erroEl.innerText = '';
    }

    if (window.__financeiroPagarState.modalPagamentoInstance) {
      window.__financeiroPagarState.modalPagamentoInstance.show();
    }
  } catch (error) {
    console.error('Erro ao abrir modal de pagamento:', error);
    alert('Erro ao carregar dados da conta: ' + error.message);
  }
}

async function processarPagamento(event) {
  event.preventDefault();

  try {
    const erroEl = document.getElementById('erroPagamento');
    if (erroEl) erroEl.innerText = '';

    const valor = Number(document.getElementById('pagamentoValor')?.value || 0);
    const formaPagamento = document.getElementById('pagamentoForma')?.value || '';

    if (valor <= 0) {
      if (erroEl) erroEl.innerText = 'O valor deve ser maior que zero.';
      return;
    }

    if (!formaPagamento) {
      if (erroEl) erroEl.innerText = 'Selecione a forma de pagamento.';
      return;
    }

    const conta = window.__financeiroPagarState.contaPagamentoAtual;
    if (!conta) {
      if (erroEl) erroEl.innerText = 'Dados da conta não encontrados.';
      return;
    }

    const response = await fetch(`/api/financeiro/pagar/${conta.id}/baixar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + localStorage.getItem('token')
      },
      body: JSON.stringify({
        valor: valor,
        forma_pagamento: formaPagamento
      })
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || 'Erro ao processar pagamento.');
    }

    if (window.__financeiroPagarState.modalPagamentoInstance) {
      window.__financeiroPagarState.modalPagamentoInstance.hide();
    }

    alert('Pagamento realizado com sucesso!');

    const periodo = obterPeriodoFinanceiro();
    carregarContasPagar(coletarFiltrosPagar(periodo));

    if (typeof carregarDashboardFinanceiro === 'function') {
      carregarDashboardFinanceiro(periodo);
    }
  } catch (error) {
    console.error('Erro ao processar pagamento:', error);
    const erroEl = document.getElementById('erroPagamento');
    if (erroEl) erroEl.innerText = error.message || 'Erro ao processar pagamento.';
  }
}

async function baixarPagamento(id) {
  try {
    const response = await fetch(`/api/financeiro/pagar/${id}/baixar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + localStorage.getItem('token')
      }
    });

    const result = await response.json();

    if (result.success) {
      alert('Pagamento realizado com sucesso!');
      const periodo = obterPeriodoFinanceiro();
      carregarContasPagar(coletarFiltrosPagar(periodo));

      if (typeof carregarDashboardFinanceiro === 'function') {
        carregarDashboardFinanceiro(periodo);
      }
    } else {
      alert('Erro ao realizar pagamento: ' + (result.error || 'Erro desconhecido'));
    }
  } catch (error) {
    console.error('Erro ao baixar pagamento:', error);
    alert('Erro ao conectar com o servidor');
  }
}

function abrirDetalhesPagar(id) {
  inicializarModalDetalhesPagamento();

  const body = document.getElementById('modalDetalhesFinanceiroBody');
  const title = document.getElementById('modalDetalhesFinanceiroLabel');

  if (!body || !title) {
    alert('Modal de detalhes não encontrado.');
    return;
  }

  title.textContent = 'Detalhes da Conta a Pagar';
  body.innerHTML = '<div class="text-center text-muted">Carregando detalhes...</div>';

  if (window.__financeiroPagarState.modalDetalhesPagamento) {
    window.__financeiroPagarState.modalDetalhesPagamento.show();
  }

  fetch(`/api/financeiro/contas-pagar/${id}/detalhes`, {
    headers: {
      'Authorization': 'Bearer ' + localStorage.getItem('token')
    }
  })
    .then(response => response.json())
    .then(dados => {
      if (!dados || dados.error) {
        throw new Error(dados.error || 'Falha ao carregar detalhes da conta a pagar.');
      }

      const adminAcoes = isAdminFinanceiroPagar() ? `
        <hr>
        <div class="d-flex gap-2 justify-content-end flex-wrap">
          <button class="btn btn-primary" onclick="abrirEdicaoPagar(${dados.id})">
            <i class="fas fa-edit"></i> Editar
          </button>
          <button class="btn btn-danger" onclick="excluirContaPagar(${dados.id})">
            <i class="fas fa-trash"></i> Excluir
          </button>
        </div>
      ` : '';

      const compra = dados.compra || null;
      const itensCompra = dados.itens_compra || [];

      const parcelado = Number(dados.total_parcelas || 1) > 1 ? 'Sim' : 'Não';

      const blocoCompra = compra ? `
        <hr>

        <h6 class="mb-3">
          <i class="fas fa-file-invoice"></i> Dados da Compra / Nota Fiscal
        </h6>

        <div class="row g-3">
          <div class="col-12 col-md-4">
            <strong>Nº NF:</strong> ${escapeHtmlFinanceiro(compra.numero_nf || compra.nota_fiscal || '-')}
          </div>

          <div class="col-12 col-md-4">
            <strong>Série:</strong> ${escapeHtmlFinanceiro(compra.serie_nf || '-')}
          </div>

          <div class="col-12 col-md-4">
            <strong>Modelo:</strong> ${escapeHtmlFinanceiro(compra.modelo_nf || '-')}
          </div>

          <div class="col-12 col-md-4">
            <strong>Data da Compra:</strong> ${formatarDataPagar(compra.data_compra)}
          </div>

          <div class="col-12 col-md-4">
            <strong>Data Emissão NF:</strong> ${compra.data_emissao ? formatarDataPagar(compra.data_emissao) : '-'}
          </div>

          <div class="col-12 col-md-4">
            <strong>Data Entrada:</strong> ${compra.data_entrada ? formatarDataPagar(compra.data_entrada) : '-'}
          </div>

          <div class="col-12">
            <strong>Chave de Acesso:</strong>
            <div style="word-break: break-all;">
              ${escapeHtmlFinanceiro(compra.chave_acesso || '-')}
            </div>
          </div>

          <div class="col-12 col-md-4">
            <strong>Total da NF:</strong> ${formatarMoedaPagar(compra.valor_total_nota || compra.total || 0)}
          </div>

          <div class="col-12 col-md-4">
            <strong>Forma Pagamento:</strong> ${escapeHtmlFinanceiro(compra.forma_pagamento || dados.forma_pagamento || '-')}
          </div>

          <div class="col-12 col-md-4">
            <strong>Condição:</strong> ${escapeHtmlFinanceiro(compra.condicao_pagamento || '-')}
          </div>
        </div>

        <div class="mt-3 d-flex gap-2 flex-wrap">
          <button class="btn btn-outline-primary" onclick="viewCompra(${compra.id})">
            <i class="fas fa-eye"></i> Ver compra completa
          </button>
        </div>

        <h6 class="mt-4 mb-2">Itens da Compra</h6>

        <div class="table-responsive">
          <table class="table table-sm table-bordered">
            <thead>
              <tr>
                <th>Produto</th>
                <th>Qtd</th>
                <th>Custo Unit.</th>
                <th>Subtotal</th>
              </tr>
            </thead>
            <tbody>
              ${
                itensCompra.length
                  ? itensCompra.map(item => `
                    <tr>
                      <td>${escapeHtmlFinanceiro(item.produto_nome || item.descricao_produto || '-')}</td>
                      <td>${Number(item.quantidade || 0)}</td>
                      <td>${formatarMoedaPagar(item.preco_unitario || 0)}</td>
                      <td>${formatarMoedaPagar(item.subtotal || 0)}</td>
                    </tr>
                  `).join('')
                  : `<tr><td colspan="4" class="text-center text-muted">Nenhum item encontrado.</td></tr>`
              }
            </tbody>
          </table>
        </div>
      ` : '';

      body.innerHTML = `
        <div class="row g-3">
          <div class="col-12 col-md-6">
            <strong>Fornecedor:</strong> ${escapeHtmlFinanceiro(dados.pessoa_nome || '-')}
          </div>

          <div class="col-12 col-md-6">
            <strong>Documento:</strong> ${escapeHtmlFinanceiro(dados.documento || compra?.numero_nf || '-')}
          </div>

          <div class="col-12 col-md-6">
            <strong>Valor:</strong> ${formatarMoedaPagar(dados.valor)}
          </div>

          <div class="col-12 col-md-6">
            <strong>Data Movimento:</strong> ${formatarDataPagar(dados.data_movimento)}
          </div>

          <div class="col-12 col-md-6">
            <strong>Vencimento:</strong> ${dados.vencimento ? formatarDataPagar(dados.vencimento) : '-'}
          </div>

          <div class="col-12 col-md-6">
            <strong>Data Pagamento:</strong> ${dados.baixado_em ? formatarDataPagar(dados.baixado_em) : '-'}
          </div>

          <div class="col-12 col-md-6">
            <strong>Status:</strong> ${formatarStatusBadgeSeguro(dados.status)}
          </div>

          <div class="col-12 col-md-6">
            <strong>Origem:</strong> ${escapeHtmlFinanceiro(dados.origem || 'manual')}
          </div>

          <div class="col-12 col-md-6">
            <strong>Parcelado:</strong> ${parcelado}
          </div>

          <div class="col-12 col-md-6">
            <strong>Parcela:</strong> ${dados.numero_parcela || 1} / ${dados.total_parcelas || 1}
          </div>

          <div class="col-12">
            <strong>Descrição:</strong>
            <p class="mb-1">${escapeHtmlFinanceiro(dados.descricao || '-')}</p>
          </div>

          <div class="col-12">
            <strong>Observação:</strong>
            <p class="mb-0">${escapeHtmlFinanceiro(dados.observacao || '-')}</p>
          </div>
        </div>

        ${blocoCompra}

        ${adminAcoes}
      `;
    })
    .catch(error => {
      console.error('Erro ao carregar detalhes da conta a pagar:', error);
      body.innerHTML = `<div class="text-danger">Não foi possível carregar os detalhes. ${escapeHtmlFinanceiro(error.message || '')}</div>`;
    });
}

async function abrirEdicaoPagar(id) {
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
      throw new Error(dados.error || 'Erro ao carregar conta a pagar para edição.');
    }

    body.innerHTML = `
      <form id="formEditarPagar" class="row g-3">
        <div class="col-md-8">
          <label class="form-label">Descrição</label>
          <input type="text" class="form-control" id="editarPagarDescricao" value="${escapeHtmlFinanceiro(dados.descricao || '')}" required>
        </div>

        <div class="col-md-4">
          <label class="form-label">Valor</label>
          <input type="number" class="form-control" id="editarPagarValor" value="${Number(dados.valor || 0)}" min="0.01" step="0.01" required>
        </div>

        <div class="col-md-4">
          <label class="form-label">Data Movimento</label>
          <input type="date" class="form-control" id="editarPagarData" value="${dados.data_movimento || ''}" required>
        </div>

        <div class="col-md-4">
          <label class="form-label">Vencimento</label>
          <input type="date" class="form-control" id="editarPagarVencimento" value="${dados.vencimento || ''}">
        </div>

        <div class="col-md-4">
          <label class="form-label">Status</label>
          <select class="form-control" id="editarPagarStatus">
            <option value="pendente" ${dados.status === 'pendente' ? 'selected' : ''}>Pendente</option>
            <option value="pago" ${dados.status === 'pago' ? 'selected' : ''}>Pago</option>
            <option value="recebido" ${dados.status === 'recebido' ? 'selected' : ''}>Recebido</option>
            <option value="parcial" ${dados.status === 'parcial' ? 'selected' : ''}>Parcial</option>
            <option value="vencido" ${dados.status === 'vencido' ? 'selected' : ''}>Vencido</option>
          </select>
        </div>

        <div class="col-md-6">
          <label class="form-label">Fornecedor / Favorecido</label>
          <input type="text" class="form-control" id="editarPagarPessoa" value="${escapeHtmlFinanceiro(dados.pessoa_nome || '')}">
        </div>

        <div class="col-md-6">
          <label class="form-label">Documento</label>
          <input type="text" class="form-control" id="editarPagarDocumento" value="${escapeHtmlFinanceiro(dados.documento || '')}">
        </div>

        <div class="col-md-6">
          <label class="form-label">Categoria</label>
          <input type="text" class="form-control" id="editarPagarCategoria" value="${escapeHtmlFinanceiro(dados.categoria || '')}">
        </div>

        <div class="col-md-6">
          <label class="form-label">Forma de pagamento</label>
          <input type="text" class="form-control" id="editarPagarForma" value="${escapeHtmlFinanceiro(dados.forma_pagamento || '')}">
        </div>

        <div class="col-12">
          <label class="form-label">Observação</label>
          <textarea class="form-control" id="editarPagarObservacao" rows="3">${escapeHtmlFinanceiro(dados.observacao || '')}</textarea>
        </div>

        <div class="col-12 d-flex gap-2 justify-content-end flex-wrap">
          <button type="button" class="btn btn-secondary" onclick="abrirDetalhesPagar(${id})">Cancelar</button>
          <button type="submit" class="btn btn-primary">Salvar Alterações</button>
        </div>
      </form>
    `;

    const form = document.getElementById('formEditarPagar');
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      await salvarEdicaoPagar(id);
    });
  } catch (error) {
    console.error('Erro ao abrir edição da conta a pagar:', error);
    body.innerHTML = `<div class="text-danger">Erro ao carregar formulário de edição. ${escapeHtmlFinanceiro(error.message || '')}</div>`;
  }
}

async function salvarEdicaoPagar(id) {
  try {
    const payload = {
      descricao: document.getElementById('editarPagarDescricao')?.value?.trim() || '',
      valor: Number(document.getElementById('editarPagarValor')?.value || 0),
      data_movimento: document.getElementById('editarPagarData')?.value || '',
      vencimento: document.getElementById('editarPagarVencimento')?.value || '',
      status: document.getElementById('editarPagarStatus')?.value || 'pendente',
      pessoa_nome: document.getElementById('editarPagarPessoa')?.value?.trim() || '',
      documento: document.getElementById('editarPagarDocumento')?.value?.trim() || '',
      categoria: document.getElementById('editarPagarCategoria')?.value?.trim() || '',
      forma_pagamento: document.getElementById('editarPagarForma')?.value?.trim() || '',
      observacao: document.getElementById('editarPagarObservacao')?.value?.trim() || ''
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

    alert('Conta a pagar atualizada com sucesso.');

    const periodo = obterPeriodoFinanceiro();
    carregarContasPagar(coletarFiltrosPagar(periodo));

    if (typeof carregarDashboardFinanceiro === 'function') {
      carregarDashboardFinanceiro(periodo);
    }

    if (typeof carregarHistoricoFinanceiro === 'function') {
      carregarHistoricoFinanceiro(periodo);
    }

    abrirDetalhesPagar(id);
  } catch (error) {
    console.error('Erro ao salvar edição da conta a pagar:', error);
    alert(error.message || 'Erro ao salvar alterações.');
  }
}

async function excluirContaPagar(id) {
  if (!confirm('Tem certeza que deseja excluir esta conta a pagar?')) return;

  try {
    const response = await fetch(`/api/financeiro/${id}`, {
      method: 'DELETE',
      headers: {
        'Authorization': 'Bearer ' + localStorage.getItem('token')
      }
    });

    const dados = await response.json();

    if (!response.ok || dados.error) {
      throw new Error(dados.error || 'Erro ao excluir conta a pagar.');
    }

    alert('Conta a pagar excluída com sucesso.');

    if (window.__financeiroPagarState.modalDetalhesPagamento) {
      window.__financeiroPagarState.modalDetalhesPagamento.hide();
    }

    const periodo = obterPeriodoFinanceiro();
    carregarContasPagar(coletarFiltrosPagar(periodo));

    if (typeof carregarDashboardFinanceiro === 'function') {
      carregarDashboardFinanceiro(periodo);
    }

    if (typeof carregarHistoricoFinanceiro === 'function') {
      carregarHistoricoFinanceiro(periodo);
    }
  } catch (error) {
    console.error('Erro ao excluir conta a pagar:', error);
    alert(error.message || 'Erro ao excluir conta a pagar.');
  }
}

function coletarFiltrosPagar(periodo) {
  return {
    fornecedor: document.getElementById('filtroFornecedorPagar')?.value.trim() || '',
    status: document.getElementById('filtroStatusPagar')?.value || 'todos',
    dataInicio: periodo?.dataInicio || '',
    dataFim: periodo?.dataFim || ''
  };
}

function formatarDataPagar(data) {
  if (!data) return '-';
  const d = new Date(data);
  if (Number.isNaN(d.getTime())) return data;
  return d.toLocaleDateString('pt-BR');
}

function formatarMoedaPagar(valor) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(Number(valor || 0));
}

function formatarStatusBadgeSeguro(status) {
  const texto = escapeHtmlFinanceiro(status || '-');
  return `<span class="status-${texto.toLowerCase()}">${texto}</span>`;
}

function escapeHtmlFinanceiro(texto) {
  return String(texto || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Função para atualizar a prévia das parcelas
function atualizarPreviaParcelas() {
  const isParcelado = document.getElementById('despesaParcelado')?.checked || false;
  const valorTotal = Number(document.getElementById('despesaValor')?.value || 0);
  const numParcelas = Number(document.getElementById('despesaParcelas')?.value || 2);
  const intervaloDias = Number(document.getElementById('despesaIntervalo')?.value || 30);
  const vencimentoBase = document.getElementById('despesaVencimento')?.value;

  const previaDiv = document.getElementById('previaParcelas');
  if (!previaDiv) return;

  if (!isParcelado || valorTotal <= 0 || numParcelas < 2 || !vencimentoBase) {
    previaDiv.innerHTML = '';
    return;
  }

  const valorParcela = valorTotal / numParcelas;
  let html = '<h6>Prévia das Parcelas:</h6><ul class="list-group">';

  let dataAtual = new Date(vencimentoBase);
  for (let i = 1; i <= numParcelas; i++) {
    const dataFormatada = dataAtual.toLocaleDateString('pt-BR');
    html += `<li class="list-group-item d-flex justify-content-between align-items-center">
      Parcela ${i}/${numParcelas}
      <span>${formatarMoedaPagar(valorParcela)} - Vence em ${dataFormatada}</span>
    </li>`;
    dataAtual = new Date(dataAtual.getTime() + intervaloDias * 24 * 60 * 60 * 1000);
  }

  html += '</ul>';
  previaDiv.innerHTML = html;
}

// Função para atualizar a prévia das parcelas
function atualizarPreviaParcelas() {
  const isParcelado = document.getElementById('despesaParcelado')?.checked || false;
  const valorTotal = Number(document.getElementById('despesaValor')?.value || 0);
  const numParcelas = Number(document.getElementById('despesaParcelas')?.value || 2);
  const intervaloDias = Number(document.getElementById('despesaIntervalo')?.value || 30);
  const vencimentoBase = document.getElementById('despesaVencimento')?.value;

  const previaDiv = document.getElementById('previaParcelas');
  if (!previaDiv) return;

  if (!isParcelado || valorTotal <= 0 || numParcelas < 2 || !vencimentoBase) {
    previaDiv.innerHTML = '';
    return;
  }

  const valorParcela = valorTotal / numParcelas;
  let html = '<h6>Prévia das Parcelas:</h6><ul class="list-group">';

  let dataAtual = new Date(vencimentoBase);
  for (let i = 1; i <= numParcelas; i++) {
    const dataFormatada = dataAtual.toLocaleDateString('pt-BR');
    html += `<li class="list-group-item d-flex justify-content-between align-items-center">
      Parcela ${i}/${numParcelas}
      <span>${formatarMoedaPagar(valorParcela)} - Vence em ${dataFormatada}</span>
    </li>`;
    dataAtual = new Date(dataAtual.getTime() + intervaloDias * 24 * 60 * 60 * 1000);
  }

  html += '</ul>';
  previaDiv.innerHTML = html;
}

// Expor globalmente
window.renderContasPagar = renderContasPagar;
window.carregarContasPagar = carregarContasPagar;
window.novaDespesa = novaDespesa;
window.abrirDetalhesPagar = abrirDetalhesPagar;
window.pagarConta = pagarConta;
window.filtrarPagar = filtrarPagar;
window.abrirEdicaoPagar = abrirEdicaoPagar;
window.salvarEdicaoPagar = salvarEdicaoPagar;
window.excluirContaPagar = excluirContaPagar;







