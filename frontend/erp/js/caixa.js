function loadCaixa() {
  $('#page-content').html(`
    <div class="container-fluid">
      <h2 class="mb-3">Fechamento de Caixa</h2>

      <div id="status-caixa-area" class="mb-3"></div>
      <div id="caixa-area"></div>

      <div class="card mb-4 mt-4">
        <div class="card-header bg-dark text-white">
          <strong><i class="fas fa-calendar-alt"></i> Consultar Caixa por Dia</strong>
        </div>
        <div class="card-body">
          <div class="row g-3 align-items-end">
            <div class="col-md-3">
              <label class="form-label">Escolha o dia</label>
              <input type="date" id="data_caixa_dia" class="form-control">
            </div>
            <div class="col-md-3">
              <button class="btn btn-primary w-100" onclick="carregarCaixaPorDia()">
                <i class="fas fa-search"></i> Visualizar Caixa
              </button>
            </div>
            <div class="col-md-3">
              <button class="btn btn-outline-secondary w-100" onclick="selecionarCaixaOntem()">
                Caixa de Ontem
              </button>
            </div>
            <div class="col-md-3">
              <button class="btn btn-outline-success w-100" onclick="selecionarCaixaHoje()">
                Caixa de Hoje
              </button>
            </div>
          </div>
          <div id="resultado_caixa_dia" class="mt-4"></div>
        </div>
      </div>
    </div>
  `);

  // Inicializar data de hoje
  $('#data_caixa_dia').val(new Date().toISOString().split('T')[0]);

  carregarCaixaAberto();
}

function dinheiro(v) {
  return formatCurrency(Number(v || 0));
}

function getTerminalRequestData(body = {}) {
  if (typeof terminalId !== 'undefined' && terminalId !== null) {
    body.terminal_id = terminalId;
  }
  return body;
}

function getTerminalRequestQuery(params = {}) {
  if (typeof terminalId !== 'undefined' && terminalId !== null) {
    params.terminal_id = terminalId;
  }
  return params;
}

function carregarCaixaAberto() {
  $.get(`${API_URL}/caixa/aberto`, getTerminalRequestQuery(), function(resumo) {
    if (!resumo) {
      renderStatusCaixa(null);
      renderAbrirCaixa();
      return;
    }

    renderStatusCaixa(resumo);
    renderCaixaAberto(resumo);
  }).fail(function(xhr) {
    showNotification(xhr.responseJSON?.error || 'Erro ao carregar caixa.', 'danger');
  });
}

function formatarHora(dataTexto) {
  if (!dataTexto) return '--:--';

  const data = new Date(String(dataTexto).replace(' ', 'T'));

  if (isNaN(data.getTime())) {
    return String(dataTexto).slice(11, 16) || '--:--';
  }

  return data.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

function renderStatusCaixa(resumo) {
  if (!resumo) {
    $('#status-caixa-area').html(`
      <div class="alert alert-danger d-flex align-items-center justify-content-between">
        <strong>🔴 Caixa Fechado</strong>
        <span>Abra o caixa para iniciar as vendas e movimentações.</span>
      </div>
    `);
    return;
  }

  $('#status-caixa-area').html(`
    <div class="alert alert-success d-flex align-items-center justify-content-between">
      <strong> Caixa Aberto</strong>
      <span>Aberto desde ${formatarHora(resumo.caixa.aberto_em)}</span>
    </div>
  `);
}

function renderAbrirCaixa() {
  $('.modal-backdrop').remove();
  $('body').removeClass('modal-open').css('padding-right', '');

  $('#caixa-area').html(`
    <div class="card">
      <div class="card-header">
        <strong>Abrir Caixa</strong>
      </div>

      <div class="card-body">
        <div id="saldo-sugerido-info" class="alert alert-info py-2">
          Buscando último saldo de caixa...
        </div>

        <label>Valor inicial em dinheiro</label>

        <input
          type="text"
          inputmode="decimal"
          id="valor-inicial-caixa"
          class="form-control mb-2"
          placeholder="Ex: 50,00"
          autocomplete="off"
        >

        <small class="text-muted d-block mb-3">
          O sistema sugere o último valor contado no fechamento anterior, mas você pode editar se necessário.
        </small>

        <button type="button" class="btn btn-success" onclick="abrirCaixa()">
          Abrir Caixa
        </button>
      </div>
    </div>
  `);

  carregarSaldoInicialSugerido();
}

function carregarSaldoInicialSugerido() {
  $.get(`${API_URL}/caixa/saldo-inicial-sugerido`, function(res) {
    const valor = Number(res.valor_sugerido || 0);

    $('#valor-inicial-caixa').val(
      valor.toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })
    );

    $('#saldo-sugerido-info').html(`
      <strong>Último saldo contado:</strong> ${dinheiro(valor)}
      <br>
      <small>${res.mensagem || 'Valor sugerido carregado.'}</small>
    `);

    setTimeout(() => {
      $('#valor-inicial-caixa').focus().select();
    }, 200);
  }).fail(function() {
    $('#saldo-sugerido-info').removeClass('alert-info').addClass('alert-warning').html(`
      Não foi possível buscar o último saldo. Informe o valor manualmente.
    `);

    $('#valor-inicial-caixa').val('0,00');

    setTimeout(() => {
      $('#valor-inicial-caixa').focus().select();
    }, 200);
  });
}

function pegarValorCampo(id) {
  let valor = String($(id).val() || '')
    .replace(/\./g, '')
    .replace(',', '.');

  return Number(valor || 0);
}

function renderCaixaAberto(resumo) {
  // Limpar qualquer modal remanescente e backdrop
  $('.modal-backdrop').remove();
  $('body').removeClass('modal-open').css('padding-right', '');

  // Limpar modais travados via função global se disponível
  if (typeof limparModaisTravados === 'function') {
    limparModaisTravados();
  }

  const d = resumo.dinheiro;
  const digital = resumo.digital;

  $('#caixa-area').html(`
    <div class="row">
      <div class="col-md-4">
        <div class="card mb-3">
          <div class="card-header bg-dark text-white">
            Dinheiro Físico
          </div>
          <div class="card-body">
            <p>Valor Inicial: <strong>${dinheiro(d.valor_inicial)}</strong></p>
            <p>Vendas em Dinheiro: <strong>${dinheiro(d.vendas_dinheiro)}</strong></p>
            <p>Suprimentos: <strong>${dinheiro(d.suprimentos)}</strong></p>
            <p>Sangrias: <strong>${dinheiro(d.sangrias)}</strong></p>
            <hr>
            <h4>Dinheiro Esperado: ${dinheiro(d.dinheiro_esperado)}</h4>
          </div>
        </div>
      </div>

      <div class="col-md-4">
        <div class="card mb-3">
          <div class="card-header bg-primary text-white">
            Recebimentos Digitais
          </div>
          <div class="card-body">
            <p>PIX: <strong>${dinheiro(digital.pix)}</strong></p>
            <p>Cartão Crédito: <strong>${dinheiro(digital.cartao_credito)}</strong></p>
            <p>Cartão Débito: <strong>${dinheiro(digital.cartao_debito)}</strong></p>
            <hr>
            <h4>Total Digital: ${dinheiro(digital.total_digital)}</h4>
          </div>
        </div>
      </div>

      <div class="col-md-4">
        <div class="card mb-3">
          <div class="card-header bg-success text-white">
            Resumo Geral
          </div>
          <div class="card-body">
            <p>Total Vendido: <strong>${dinheiro(resumo.total_vendido)}</strong></p>
            <p>Vendas a Prazo: <strong>${dinheiro(resumo.prazo)}</strong></p>
            <p>Outras Formas: <strong>${dinheiro(resumo.outras_formas)}</strong></p>
            <hr>
            <h4>Saldo Geral: ${dinheiro(resumo.saldo_geral)}</h4>
          </div>
        </div>
      </div>
    </div>

    <div class="card mb-3">
      <div class="card-header">
        <strong>Movimentações do Caixa</strong>
      </div>

      <div class="card-body">
        <div class="row">
          <div class="col-md-4">
            <label>Valor da Sangria</label>
            <input type="text" inputmode="decimal" id="valor-sangria" class="form-control" placeholder="Ex: 50,00">
          </div>

          <div class="col-md-5">
            <label>Motivo</label>
            <input type="text" id="motivo-sangria" class="form-control" placeholder="Ex: retirada para pagamento">
          </div>

          <div class="col-md-3 d-flex align-items-end">
            <button type="button" class="btn btn-warning w-100" onclick="registrarSangria()">
              Registrar Sangria
            </button>
          </div>
        </div>

        <hr>

        <div class="row">
          <div class="col-md-4">
            <label>Valor do Suprimento</label>
            <input type="text" inputmode="decimal" id="valor-suprimento" class="form-control" placeholder="Ex: 100,00">
          </div>

          <div class="col-md-5">
            <label>Motivo</label>
            <input type="text" id="motivo-suprimento" class="form-control" placeholder="Ex: reforço de troco">
          </div>

          <div class="col-md-3 d-flex align-items-end">
            <button type="button" class="btn btn-info w-100" onclick="registrarSuprimento()">
              Registrar Suprimento
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header bg-danger text-white">
        <strong>Fechar Caixa</strong>
      </div>

      <div class="card-body">
        <p>Informe abaixo o dinheiro físico contado na gaveta.</p>

        <label>Dinheiro contado no caixa</label>
        <input type="text" inputmode="decimal" id="valor-fechamento" class="form-control mb-3" placeholder="Ex: 100,00">

        <label>Observação</label>
        <textarea id="observacao-fechamento" class="form-control mb-3"></textarea>

        <button type="button" class="btn btn-danger" onclick="fecharCaixa()">
          Fechar Caixa
        </button>
      </div>
    </div>
  `);

  // Forçar foco no campo de fechamento após renderizar
  setTimeout(() => {
    const campoFechamento = $('#valor-fechamento');
    if (campoFechamento.length > 0) {
      campoFechamento.focus().select();
    }
    // Forçar reflow para garantir cliques no Electron
    if (window.electronAPI && window.electronAPI.forcarReflow) {
      window.electronAPI.forcarReflow();
    }
  }, 300);
}

function abrirCaixa() {
  const valor = pegarValorCampo('#valor-inicial-caixa');

  if (valor < 0) {
    showNotification('Informe um valor inicial válido.', 'warning');
    return;
  }

  $.ajax({
    url: `${API_URL}/caixa/abrir`,
    method: 'POST',
    contentType: 'application/json',
    data: JSON.stringify(getTerminalRequestData({ valor_inicial: valor })),
    success: function() {
      showNotification('Caixa aberto com sucesso.', 'success');
      carregarCaixaAberto();
    },
    error: function(xhr) {
      showNotification(xhr.responseJSON?.error || 'Erro ao abrir caixa.', 'danger');
    }
  });
}

function registrarSangria() {
  const valor = pegarValorCampo('#valor-sangria');
  const motivo = $('#motivo-sangria').val();

  if (valor <= 0) {
    showNotification('Informe um valor válido para sangria.', 'warning');
    return;
  }

  // Criar modal para senha de administrador
  const modalHtml = `
    <div class="modal fade" id="modalSenhaAdmin" tabindex="-1" style="display: none;">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Senha de Administrador</h5>
            <button type="button" class="btn-close" onclick="fecharModalSenha()"></button>
          </div>
          <div class="modal-body">
            <p>Confirme a sangria de <strong>${dinheiro(valor)}</strong></p>
            <label for="senha-admin-input">Digite a senha do administrador:</label>
            <input type="password" id="senha-admin-input" class="form-control" placeholder="Senha">
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" onclick="fecharModalSenha()">Cancelar</button>
            <button type="button" class="btn btn-primary" onclick="confirmarSangriaComSenha()">Confirmar</button>
          </div>
        </div>
      </div>
    </div>
    <div class="modal-backdrop fade show" id="modal-backdrop-senha" style="display: none;"></div>
  `;

  // Adicionar modal ao body
  $('body').append(modalHtml);
  
  // Mostrar modal e backdrop
  $('#modalSenhaAdmin').css('display', 'block').addClass('show');
  $('#modal-backdrop-senha').css('display', 'block');
  $('body').addClass('modal-open').css('overflow', 'hidden');

  // Focar no campo de senha
  setTimeout(() => {
    $('#senha-admin-input').focus();
  }, 300);

  $('#senha-admin-input').on('keydown', function(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (typeof window.confirmarSangriaComSenha === 'function') {
        window.confirmarSangriaComSenha();
      }
    }
  });

  // Funções globais para o modal
  window.fecharModalSenha = function() {
    $('#modalSenhaAdmin').remove();
    $('#modal-backdrop-senha').remove();
    $('body').removeClass('modal-open').css('overflow', '');
    showNotification('Sangria cancelada.', 'warning');
  };

  window.confirmarSangriaComSenha = function() {
    const senhaAdmin = $('#senha-admin-input').val();
    
    if (!senhaAdmin) {
      showNotification('Digite a senha do administrador.', 'warning');
      return;
    }

    // Fechar modal
    $('#modalSenhaAdmin').remove();
    $('#modal-backdrop-senha').remove();
    $('body').removeClass('modal-open').css('overflow', '');

    // Enviar requisição
    $.ajax({
      url: `${API_URL}/caixa/sangria`,
      method: 'POST',
      contentType: 'application/json',
      global: false,
      data: JSON.stringify(getTerminalRequestData({
        valor,
        motivo,
        senha_admin: senhaAdmin
      })),
      success: function() {
        showNotification('Sangria registrada com sucesso.', 'success');
        carregarCaixaAberto();
      },
      error: function(xhr) {
        if (typeof isErroSessaoExpirada === 'function' && isErroSessaoExpirada(xhr)) {
          handleUnauthorized();
          return;
        }
        showNotification(xhr.responseJSON?.error || 'Erro ao registrar sangria.', 'danger');
      }
    });
  };

  // Fechar modal com ESC
  $(document).one('keydown', function(e) {
    if (e.key === 'Escape') {
      if (window.fecharModalSenha) {
        window.fecharModalSenha();
      }
    }
  });

  // Fechar modal clicando no backdrop
  $('#modal-backdrop-senha').one('click', function() {
    if (window.fecharModalSenha) {
      window.fecharModalSenha();
    }
  });
}

function registrarSuprimento() {
  const valor = pegarValorCampo('#valor-suprimento');
  const motivo = $('#motivo-suprimento').val();

  $.ajax({
    url: `${API_URL}/caixa/suprimento`,
    method: 'POST',
    contentType: 'application/json',
    data: JSON.stringify(getTerminalRequestData({ valor, motivo })),
    success: function() {
      showNotification('Suprimento registrado com sucesso.', 'success');
      carregarCaixaAberto();
    },
    error: function(xhr) {
      showNotification(xhr.responseJSON?.error || 'Erro ao registrar suprimento.', 'danger');
    }
  });
}

function fecharCaixa() {
  const valorFechamento = pegarValorCampo('#valor-fechamento');
  const observacao = $('#observacao-fechamento').val();

  if (!confirm('Tem certeza que deseja fechar o caixa?')) return;

  $.ajax({
    url: `${API_URL}/caixa/fechar`,
    method: 'POST',
    contentType: 'application/json',
    data: JSON.stringify(getTerminalRequestData({
      valor_informado: valorFechamento,
      observacao
    })),
    success: function(res) {
      showNotification('Caixa fechado com sucesso.', 'success');
      carregarCaixaAberto();
      console.log('Resumo fechamento:', res.resumo);
    },
    error: function(xhr) {
      showNotification(xhr.responseJSON?.error || 'Erro ao fechar caixa.', 'danger');
    }
  });
}

function selecionarCaixaHoje() {
  const hoje = new Date().toISOString().split('T')[0];
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
  const data = $('#data_caixa_dia').val() || new Date().toISOString().split('T')[0];

  try {
    const resposta = await $.get(`${API_URL}/caixa/por-data`, { data });
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
          <strong>Caixa #${caixa.id} - ${resposta.data}</strong>
          <span class="badge bg-${statusClass}">${String(caixa.status || '').toUpperCase()}</span>
        </div>
        <div class="card-body">
          <div class="row g-3 mb-4">
            <div class="col-md-3">
              <div class="card text-bg-primary">
                <div class="card-body">
                  <small>Valor Inicial</small>
                  <h4>${dinheiro(resumo.dinheiro.valor_inicial)}</h4>
                </div>
              </div>
            </div>
            <div class="col-md-3">
              <div class="card text-bg-success">
                <div class="card-body">
                  <small>Total Vendido</small>
                  <h4>${dinheiro(resumo.total_vendido)}</h4>
                </div>
              </div>
            </div>
            <div class="col-md-3">
              <div class="card text-bg-warning">
                <div class="card-body">
                  <small>Dinheiro Esperado</small>
                  <h4>${dinheiro(resumo.dinheiro.dinheiro_esperado)}</h4>
                </div>
              </div>
            </div>
            <div class="col-md-3">
              <div class="card text-bg-dark">
                <div class="card-body">
                  <small>Saldo Geral</small>
                  <h4>${dinheiro(resumo.saldo_geral)}</h4>
                </div>
              </div>
            </div>
          </div>

          <div class="row g-3 mb-4">
            <div class="col-md-3"><strong>Dinheiro:</strong><br>${dinheiro(resumo.dinheiro.vendas_dinheiro)}</div>
            <div class="col-md-3"><strong>Pix:</strong><br>${dinheiro(resumo.digital.pix)}</div>
            <div class="col-md-3"><strong>Cartão Crédito:</strong><br>${dinheiro(resumo.digital.cartao_credito)}</div>
            <div class="col-md-3"><strong>Cartão Débito:</strong><br>${dinheiro(resumo.digital.cartao_debito)}</div>
          </div>

          <div class="row g-3 mb-4">
            <div class="col-md-3"><strong>Suprimentos:</strong><br>${dinheiro(resumo.dinheiro.suprimentos)}</div>
            <div class="col-md-3"><strong>Sangrias:</strong><br>${dinheiro(resumo.dinheiro.sangrias)}</div>
            <div class="col-md-3"><strong>Aberto em:</strong><br>${caixa.aberto_em || '-'}</div>
            <div class="col-md-3"><strong>Fechado em:</strong><br>${caixa.fechado_em || '-'}</div>
          </div>

          ${caixa.status === 'fechado' ? `
            <div class="mb-3">
              <button class="btn btn-sm btn-outline-primary me-2" onclick="abrirDetalhesFechamento(${caixa.id})">
                <i class="fas fa-info-circle"></i> Detalhes do Fechamento
              </button>
              <button class="btn btn-sm btn-secondary" onclick="reimprimirFechamento(${caixa.id})">
                <i class="fas fa-print"></i> Reimprimir Fechamento
              </button>
            </div>
          ` : ''}

          <hr>
          <h5>Movimentações do Caixa</h5>
          <div class="table-responsive">
            <table class="table table-sm table-striped">
              <thead>
                <tr><th>Tipo</th><th>Valor</th><th>Motivo</th><th>Usuário</th><th>Data</th></tr>
              </thead>
              <tbody>
                ${movs.length ? movs.map(m => `
                  <tr>
                    <td>${m.tipo}</td>
                    <td>${dinheiro(m.valor)}</td>
                    <td>${m.motivo || '-'}</td>
                    <td>${m.usuario_nome || 'Sistema'}</td>
                    <td>${m.criado_em || m.data_movimento || '-'}</td>
                  </tr>
                `).join('') : '<tr><td colspan="5" class="text-center text-muted">Nenhuma movimentação registrada.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `);
  });
}

function abrirDetalhesFechamento(caixaId) {
  $.get(`${API_URL}/caixa/fechamento/${caixaId}`, function(res) {
    const caixa = res.caixa || {};
    const fechamento = res.fechamento || {};
    const auditoria = res.auditoria || [];
    const movimentacoes = res.movimentacoes || [];

    const html = `
      <div class="modal fade" id="modalDetalhesFechamento" tabindex="-1" style="display: block;">
        <div class="modal-dialog modal-xl">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">Detalhes do Fechamento do Caixa #${caixa.id}</h5>
              <button type="button" class="btn-close" onclick="fecharModalDetalhesFechamento()"></button>
            </div>
            <div class="modal-body">
              <div class="row mb-3">
                <div class="col-md-4"><strong>Valor Inicial:</strong> ${dinheiro(fechamento.valor_inicial)}</div>
                <div class="col-md-4"><strong>Vendas Dinheiro:</strong> ${dinheiro(fechamento.vendas_dinheiro)}</div>
                <div class="col-md-4"><strong>Total Informado:</strong> ${dinheiro(fechamento.total_informado)}</div>
              </div>
              <div class="row mb-3">
                <div class="col-md-4"><strong>PIX:</strong> ${dinheiro(fechamento.vendas_pix)}</div>
                <div class="col-md-4"><strong>Crédito:</strong> ${dinheiro(fechamento.vendas_credito)}</div>
                <div class="col-md-4"><strong>Débito:</strong> ${dinheiro(fechamento.vendas_debito)}</div>
              </div>
              <div class="row mb-3">
                <div class="col-md-4"><strong>Prazo:</strong> ${dinheiro(fechamento.vendas_prazo)}</div>
                <div class="col-md-4"><strong>TEF:</strong> ${dinheiro(fechamento.vendas_tef)}</div>
                <div class="col-md-4"><strong>Diferença:</strong> ${dinheiro(fechamento.diferenca)}</div>
              </div>
              <div class="row mb-3">
                <div class="col-md-4"><strong>Suprimentos:</strong> ${dinheiro(fechamento.total_suprimentos)}</div>
                <div class="col-md-4"><strong>Sangrias:</strong> ${dinheiro(fechamento.total_sangrias)}</div>
                <div class="col-md-4"><strong>Status:</strong> ${caixa.status}</div>
              </div>
              <div class="mb-3">
                <strong>Observação:</strong>
                <p>${caixa.observacao || '<em>Sem observação</em>'}</p>
              </div>
              <h6>Movimentações</h6>
              <div class="table-responsive mb-3">
                <table class="table table-sm table-striped">
                  <thead>
                    <tr><th>Tipo</th><th>Valor</th><th>Motivo</th><th>Usuário</th><th>Data</th></tr>
                  </thead>
                  <tbody>
                    ${movimentacoes.length ? movimentacoes.map(m => `
                      <tr>
                        <td>${m.tipo}</td>
                        <td>${dinheiro(m.valor)}</td>
                        <td>${m.motivo || '-'}</td>
                        <td>${m.usuario_nome || 'Sistema'}</td>
                        <td>${m.criado_em || m.data_movimento || '-'}</td>
                      </tr>
                    `).join('') : '<tr><td colspan="5" class="text-center text-muted">Nenhuma movimentação registrada.</td></tr>'}
                  </tbody>
                </table>
              </div>
              <h6>Auditoria</h6>
              <div class="table-responsive">
                <table class="table table-sm table-striped">
                  <thead>
                    <tr><th>Data</th><th>Ação</th><th>Tipo</th><th>Valor</th><th>Detalhes</th></tr>
                  </thead>
                  <tbody>
                    ${auditoria.length ? auditoria.map(a => `
                      <tr>
                        <td>${a.criado_em || '-'}</td>
                        <td>${a.acao}</td>
                        <td>${a.tipo_movimentacao || '-'}</td>
                        <td>${dinheiro(a.valor)}</td>
                        <td>${a.detalhes || '-'}</td>
                      </tr>
                    `).join('') : '<tr><td colspan="5" class="text-center text-muted">Nenhum registro de auditoria.</td></tr>'}
                  </tbody>
                </table>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" onclick="fecharModalDetalhesFechamento()">Fechar</button>
            </div>
          </div>
        </div>
      </div>
      <div class="modal-backdrop fade show" id="modal-backdrop-detalhes"></div>
    `;

    $('body').append(html);
    $('body').addClass('modal-open').css('overflow', 'hidden');
  }).fail(function(xhr) {
    showNotification(xhr.responseJSON?.error || 'Erro ao carregar detalhes de fechamento.', 'danger');
  });
}

function fecharModalDetalhesFechamento() {
  $('#modalDetalhesFechamento').remove();
  $('#modal-backdrop-detalhes').remove();
  $('body').removeClass('modal-open').css('overflow', '');
}

function reimprimirFechamento(caixaId) {
  if (!confirm('Deseja reimprimir o fechamento deste caixa?')) return;

  $.ajax({
    url: `${API_URL}/caixa/${caixaId}/reimprimir`,
    method: 'POST',
    contentType: 'application/json',
    data: JSON.stringify({}),
    success: function(res) {
      showNotification(res.message || 'Reimpressão registrada.', 'success');
      fecharModalDetalhesFechamento();
      abrirDetalhesFechamento(caixaId);
    },
    error: function(xhr) {
      showNotification(xhr.responseJSON?.error || 'Erro ao reimprimir fechamento.', 'danger');
    }
  });
}
