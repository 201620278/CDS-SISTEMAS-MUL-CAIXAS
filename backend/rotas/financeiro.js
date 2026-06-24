const express = require('express');
const router = express.Router();
const db = require('../database');
const moment = require('moment');
const { gravarAuditoria } = require('../services/auditoria');
const { validarCaixaAberto } = require('../middleware/validarCaixaAberto');
const { FILTRO_VENDA_VALIDA, isModoFiscalRelatorio } = require('../services/reportFiscalHelpers');

console.log('ROTA FINANCEIRO CARREGADA:', __filename);

router.get('/teste-rota-financeiro', (req, res) => {
  res.json({
    ok: true,
    arquivo: __filename,
    mensagem: 'rota financeiro ativa'
  });
});

function parseNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function arredondarCentavos(value) {
  return Math.round(parseNumber(value) * 100) / 100;
}

async function consultarRecebimentosVendaSplit(dataInicio, dataFim, modoFiscal) {
  const modoFiscalAtivo = isModoFiscalRelatorio(modoFiscal);
  const params = [];
  let dateFilter = '';

  if (dataInicio && dataFim) {
    dateFilter = ' AND date(v.data_venda) BETWEEN date(?) AND date(?)';
    params.push(dataInicio, dataFim);
  }

  const rows = await dbAllAsync(`
    SELECT
      vr.tipo_recebimento,
      COALESCE(SUM(vr.valor), 0) AS total,
      COUNT(*) AS quantidade
    FROM venda_recebimentos vr
    INNER JOIN vendas v ON v.id = vr.venda_id
    WHERE ${FILTRO_VENDA_VALIDA}
      AND COALESCE(vr.status, 'aprovado') != 'cancelado'
      ${modoFiscalAtivo ? "AND vr.tipo_recebimento = 'fiscal'" : ''}
      ${dateFilter}
    GROUP BY vr.tipo_recebimento
  `, params);

  const map = (rows || []).reduce((acc, row) => {
    acc[row.tipo_recebimento || 'fiscal'] = {
      total: parseNumber(row.total),
      quantidade: parseNumber(row.quantidade)
    };
    return acc;
  }, {});

  const fiscal = map.fiscal || { total: 0, quantidade: 0 };
  const naoFiscal = map.nao_fiscal || { total: 0, quantidade: 0 };

  return {
    modo_fiscal_ativo: modoFiscalAtivo,
    fiscal,
    nao_fiscal: naoFiscal,
    total: {
      total: fiscal.total + (modoFiscalAtivo ? 0 : naoFiscal.total),
      quantidade: fiscal.quantidade + (modoFiscalAtivo ? 0 : naoFiscal.quantidade)
    }
  };
}

function calcularValorFiscalConta(valor, vendaTotal, valorFiscal) {
  const totalVenda = parseNumber(vendaTotal);
  if (totalVenda <= 0) {
    return parseNumber(valor);
  }
  return arredondarCentavos(parseNumber(valor) * (parseNumber(valorFiscal) / totalVenda));
}

function calcularValorNaoFiscalConta(valor, vendaTotal, valorNaoFiscal) {
  const totalVenda = parseNumber(vendaTotal);
  if (totalVenda <= 0) {
    return 0;
  }
  return arredondarCentavos(parseNumber(valor) * (parseNumber(valorNaoFiscal) / totalVenda));
}

function dbGetAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbAllAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function requireAdminFinanceiro(req, res) {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({ error: 'Apenas o administrador pode editar ou excluir lançamentos financeiros.' });
    return false;
  }
  return true;
}

function formatoStatus(tipo, status) {
  if (status) return status;
  return tipo === 'receita' ? 'recebido' : 'pago';
}

function inserirMovimentacao(data) {
  return new Promise((resolve, reject) => {
    const {
      tipo,
      descricao,
      valor,
      data_movimento,
      categoria,
      forma_pagamento,
      referencia_id,
      referencia_tipo,
      status,
      origem,
      documento,
      vencimento,
      numero_parcela,
      total_parcelas,
      compra_id,
      venda_id,
      pessoa_nome,
      observacao
    } = data;

    db.run(`
      INSERT INTO financeiro (
        tipo, descricao, valor, data_movimento, categoria, forma_pagamento,
        referencia_id, referencia_tipo, status, origem, documento, vencimento,
        numero_parcela, total_parcelas, compra_id, venda_id, pessoa_nome, observacao,
        baixado_em
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      tipo,
      descricao,
      valor,
      data_movimento,
      categoria || null,
      forma_pagamento || null,
      referencia_id || null,
      referencia_tipo || null,
      formatoStatus(tipo, status),
      origem || 'manual',
      documento || null,
      vencimento || data_movimento,
      numero_parcela || null,
      total_parcelas || null,
      compra_id || null,
      venda_id || null,
      pessoa_nome || null,
      observacao || null,
      ['pago', 'recebido'].includes(formatoStatus(tipo, status)) ? (data.baixado_em || data_movimento) : null
    ], function(err) {
      if (err) reject(err);
      else resolve(this.lastID);
    });
  });
}

router.get('/', (req, res) => {
  const { dataInicio, dataFim, tipo, status, busca } = req.query;

  let sql = `SELECT * FROM financeiro WHERE 1=1`;
  const params = [];

  if (dataInicio && dataFim) {
    sql += ` AND date(data_movimento) BETWEEN ? AND ?`;
    params.push(dataInicio, dataFim);
  }

  if (tipo) {
    sql += ` AND tipo = ?`;
    params.push(tipo);
  }

  if (status) {
    sql += ` AND status = ?`;
    params.push(status);
  }

  if (busca) {
    sql += ` AND (descricao LIKE ? OR documento LIKE ?)`;
    params.push(`%${busca}%`, `%${busca}%`);
  }

  sql += ` ORDER BY date(data_movimento) DESC, id DESC`;

  db.all(sql, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    res.json(rows);
  });
});

router.get('/resumo', (req, res) => {
  const { data_inicio, data_fim, tipo, categoria, forma_pagamento, status, origem } = req.query;

  let sql = `
    SELECT 
      SUM(CASE WHEN tipo = 'receita' THEN valor ELSE 0 END) AS total_receitas,
      SUM(CASE WHEN tipo = 'despesa' THEN valor ELSE 0 END) AS total_despesas,
      SUM(CASE WHEN tipo = 'receita' AND status IN ('recebido','pago') THEN valor ELSE 0 END) AS total_recebido,
      SUM(CASE WHEN tipo = 'despesa' AND status IN ('pago','recebido') THEN valor ELSE 0 END) AS total_pago,
      SUM(CASE WHEN tipo = 'receita' AND status = 'pendente' THEN valor ELSE 0 END) AS total_a_receber,
      SUM(CASE WHEN tipo = 'despesa' AND status = 'pendente' THEN valor ELSE 0 END) AS total_a_pagar
    FROM financeiro
    WHERE 1=1
  `;
  const params = [];

  if (data_inicio && data_fim) {
    sql += ' AND COALESCE(vencimento, data_movimento) BETWEEN ? AND ?';
    params.push(data_inicio, data_fim);
  }
  if (tipo) {
    sql += ' AND tipo = ?';
    params.push(tipo);
  }
  if (categoria) {
    sql += ' AND categoria = ?';
    params.push(categoria);
  }
  if (forma_pagamento) {
    sql += ' AND forma_pagamento = ?';
    params.push(forma_pagamento);
  }
  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }
  if (origem) {
    sql += ' AND origem = ?';
    params.push(origem);
  }

  db.get(sql, params, (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    const resumo = row || {};
    resumo.total_receitas = parseNumber(resumo.total_receitas);
    resumo.total_despesas = parseNumber(resumo.total_despesas);
    resumo.total_recebido = parseNumber(resumo.total_recebido);
    resumo.total_pago = parseNumber(resumo.total_pago);
    resumo.total_a_receber = parseNumber(resumo.total_a_receber);
    resumo.total_a_pagar = parseNumber(resumo.total_a_pagar);
    resumo.saldo = resumo.total_recebido - resumo.total_pago;
    res.json(resumo);
  });
});

router.post('/', (req, res) => {
  const {
    tipo,
    descricao,
    valor,
    data_movimento,
    categoria,
    forma_pagamento,
    documento,
    vencimento,
    observacao,
    compra_id,
    pessoa_nome,
    status
  } = req.body;

  if (!tipo || !descricao || !valor || !data_movimento) {
    res.status(400).json({ error: 'Tipo, descrição, valor e data são obrigatórios.' });
    return;
  }

  if (!['receita', 'despesa'].includes(tipo)) {
    res.status(400).json({ error: 'Tipo de movimentação inválido.' });
    return;
  }

  inserirMovimentacao({
    tipo,
    descricao,
    valor,
    data_movimento,
    categoria,
    forma_pagamento,
    documento,
    vencimento,
    observacao,
    compra_id,
    pessoa_nome,
    origem: 'manual',
    referencia_tipo: 'manual',
    status: status || (tipo === 'despesa' ? 'pendente' : 'recebido')
  }).then((id) => {
    // gravar auditoria de criação de movimentação financeira
    gravarAuditoria({
      usuario_id: req.user?.id || null,
      usuario_nome: req.user?.nome || req.user?.username || null,
      modulo: 'financeiro',
      acao: 'criar_movimentacao',
      referencia_tipo: 'financeiro',
      referencia_id: id,
      detalhes: { tipo, descricao, valor, data_movimento, categoria },
      ip_requisicao: req.ip || null
    }).catch((auditErr) => console.error('Erro ao gravar auditoria de movimentação financeira:', auditErr));

    res.json({ id, message: 'Movimentação registrada com sucesso' });
  }).catch((err) => {
    res.status(500).json({ error: err.message });
  });
});

router.put('/:id', (req, res) => {
  if (!requireAdminFinanceiro(req, res)) return;

  const { id } = req.params;
  const {
    descricao,
    valor,
    data_movimento,
    categoria,
    forma_pagamento,
    documento,
    vencimento,
    observacao,
    pessoa_nome,
    status
  } = req.body;

  db.get('SELECT * FROM financeiro WHERE id = ?', [id], (findErr, row) => {
    if (findErr) {
      res.status(500).json({ error: findErr.message });
      return;
    }

    if (!row) {
      res.status(404).json({ error: 'Movimentação não encontrada.' });
      return;
    }

    const novoStatus = status || row.status || 'pendente';
    const novaDataMovimento = data_movimento || row.data_movimento;
    const novoVencimento = vencimento || novaDataMovimento;

    db.run(`
      UPDATE financeiro
      SET descricao = ?, valor = ?, data_movimento = ?, categoria = ?, forma_pagamento = ?,
          documento = ?, vencimento = ?, observacao = ?, pessoa_nome = ?, status = ?,
          baixado_em = CASE
            WHEN ? IN ('pago','recebido') THEN COALESCE(baixado_em, DATE('now'))
            ELSE NULL
          END
      WHERE id = ?
    `, [
      descricao ?? row.descricao,
      valor ?? row.valor,
      novaDataMovimento,
      categoria ?? row.categoria,
      forma_pagamento ?? row.forma_pagamento,
      documento ?? row.documento,
      novoVencimento,
      observacao ?? row.observacao,
      pessoa_nome ?? row.pessoa_nome,
      novoStatus,
      novoStatus,
      id
    ], function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }

      // gravar auditoria de atualização
      gravarAuditoria({
        usuario_id: req.user?.id || null,
        usuario_nome: req.user?.nome || req.user?.username || null,
        modulo: 'financeiro',
        acao: 'atualizar_movimentacao',
        referencia_tipo: 'financeiro',
        referencia_id: id,
        detalhes: { antes: row, depois: req.body },
        ip_requisicao: req.ip || null
      }).catch((auditErr) => console.error('Erro ao gravar auditoria de atualização financeiro:', auditErr));

      res.json({
        success: true,
        message: 'Movimentação atualizada com sucesso.'
      });
    });
  });
});

router.post('/receber/:id/baixar', validarCaixaAberto, (req, res) => {
  const { id } = req.params;
  db.get('SELECT id, tipo, status FROM financeiro WHERE id = ?', [id], (err, row) => {
    if (err) {
      res.status(500).json({ success: false, error: err.message });
      return;
    }
    if (!row) {
      res.status(404).json({ success: false, error: 'Movimentação não encontrada.' });
      return;
    }
    if (['recebido', 'pago'].includes(row.status)) {
      res.status(400).json({ success: false, error: 'Esta movimentação já foi baixada.' });
      return;
    }
    const novoStatus = row.tipo === 'receita' ? 'recebido' : 'pago';
    db.run(`UPDATE financeiro SET status = ?, baixado_em = DATE('now') WHERE id = ?`, [novoStatus, id], (upErr) => {
      if (upErr) {
        res.status(500).json({ success: false, error: upErr.message });
        return;
      }
      // auditoria de baixa/recebimento (associando sessao de caixa quando disponível)
      gravarAuditoria({
        usuario_id: req.operadorId || req.user?.id || null,
        usuario_nome: req.user?.nome || req.user?.username || null,
        modulo: 'financeiro',
        acao: 'baixar_movimentacao',
        referencia_tipo: 'financeiro',
        referencia_id: id,
        detalhes: { novo_status: novoStatus, sessao_id: req.caixaSessaoId || null },
        ip_requisicao: req.ip || null
      }).catch((auditErr) => console.error('Erro ao gravar auditoria de baixa financeiro:', auditErr));

      res.json({ success: true, message: 'Recebimento baixado com sucesso.', status: novoStatus });
    });
  });
});

router.post('/pagar/:id/baixar', (req, res) => {
  const { id } = req.params;
  const { valor, forma_pagamento } = req.body;

  db.get('SELECT id, tipo, status, valor AS valor_total FROM financeiro WHERE id = ?', [id], (err, row) => {
    if (err) {
      res.status(500).json({ success: false, error: err.message });
      return;
    }
    if (!row) {
      res.status(404).json({ success: false, error: 'Movimentação não encontrada.' });
      return;
    }
    if (['recebido', 'pago'].includes(row.status)) {
      res.status(400).json({ success: false, error: 'Esta movimentação já foi baixada.' });
      return;
    }

    const valorPago = parseNumber(valor) || parseNumber(row.valor_total);
    const valorTotal = parseNumber(row.valor_total);

    let novoStatus;
    if (valorPago >= valorTotal) {
      novoStatus = row.tipo === 'receita' ? 'recebido' : 'pago';
    } else {
      novoStatus = 'parcial';
    }

    const updates = ['status = ?', 'baixado_em = DATE(\'now\')'];
    const params = [novoStatus];

    if (forma_pagamento) {
      updates.push('forma_pagamento = ?');
      params.push(forma_pagamento);
    }

    params.push(id);

    db.run(`UPDATE financeiro SET ${updates.join(', ')} WHERE id = ?`, params, (upErr) => {
      if (upErr) {
        res.status(500).json({ success: false, error: upErr.message });
        return;
      }
      // auditoria de baixa de pagamento
      gravarAuditoria({
        usuario_id: req.user?.id || null,
        usuario_nome: req.user?.nome || req.user?.username || null,
        modulo: 'financeiro',
        acao: 'baixar_pagamento',
        referencia_tipo: 'financeiro',
        referencia_id: id,
        detalhes: { valor_pago: valorPago, forma_pagamento: forma_pagamento || null, status: novoStatus },
        ip_requisicao: req.ip || null
      }).catch((auditErr) => console.error('Erro ao gravar auditoria de baixa de pagamento financeiro:', auditErr));

      res.json({ success: true, message: 'Pagamento baixado com sucesso.', status: novoStatus });
    });
  });
});

router.get('/dashboard', async (req, res) => {
  const { dataInicio, dataFim } = req.query;
  const params = [];
  let periodoFiltro = '';

  if (dataInicio && dataFim) {
    periodoFiltro = ' AND COALESCE(vencimento, data_movimento) BETWEEN ? AND ?';
    params.push(dataInicio, dataFim);
  }

  const hoje = moment().format('YYYY-MM-DD');
  const daqui30 = moment().add(30, 'days').format('YYYY-MM-DD');

  const resumoSql = `
    SELECT
      COALESCE(SUM(CASE WHEN tipo = 'receita' AND status IN ('recebido','pago') THEN valor END), 0) AS totalRecebido,
      COALESCE(SUM(CASE WHEN tipo = 'despesa' AND status IN ('pago','recebido') THEN valor END), 0) AS totalPago
    FROM financeiro
    WHERE 1 = 1
    ${periodoFiltro}
  `;

  const pendentesSql = `
    SELECT
      COALESCE(SUM(CASE WHEN tipo = 'receita' AND status NOT IN ('recebido','pago') THEN valor END), 0) AS totalReceber,
      COALESCE(SUM(CASE WHEN tipo = 'despesa' AND status NOT IN ('pago','recebido') THEN valor END), 0) AS totalPagar
    FROM financeiro
  `;

  const proximosRecebimentosSql = `
    SELECT
      id,
      descricao,
      valor,
      vencimento,
      pessoa_nome AS cliente,
      tipo,
      status
    FROM financeiro
    WHERE tipo = 'receita'
      AND status NOT IN ('recebido','pago')
      AND vencimento IS NOT NULL
      AND vencimento BETWEEN date('now') AND date('now', '+30 days')
    ORDER BY vencimento ASC
    LIMIT 10
  `;

  const proximosPagamentosSql = `
    SELECT
      id,
      descricao,
      valor,
      vencimento,
      pessoa_nome AS fornecedor,
      tipo,
      status
    FROM financeiro
    WHERE tipo = 'despesa'
      AND status NOT IN ('recebido','pago')
      AND vencimento IS NOT NULL
      AND vencimento BETWEEN date('now') AND date('now', '+30 days')
    ORDER BY vencimento ASC
    LIMIT 10
  `;

  const alertasSql = `
    SELECT
      id,
      descricao,
      valor,
      vencimento,
      pessoa_nome AS pessoa,
      tipo,
      status,
      CASE WHEN status NOT IN ('recebido','pago') AND vencimento < date('now') THEN 'vencido' ELSE status END AS status_exibicao
    FROM financeiro
    WHERE status NOT IN ('recebido','pago')
      AND vencimento IS NOT NULL
      AND vencimento < date('now')
    ORDER BY vencimento ASC
    LIMIT 10
  `;

  const graficoSql = `
    SELECT
      COALESCE(SUM(CASE WHEN tipo = 'receita' AND status IN ('recebido','pago') THEN valor END), 0) AS recebido,
      COALESCE(SUM(CASE WHEN tipo = 'despesa' AND status IN ('pago','recebido') THEN valor END), 0) AS pago,
      COALESCE(SUM(CASE WHEN tipo = 'receita' AND status NOT IN ('recebido','pago') THEN valor END), 0) AS receber,
      COALESCE(SUM(CASE WHEN tipo = 'despesa' AND status NOT IN ('pago','recebido') THEN valor END), 0) AS pagar
    FROM financeiro
    WHERE 1 = 1
    ${periodoFiltro}
  `;

  try {
    const resumo = await dbGetAsync(resumoSql, params);
    const pendentes = await dbGetAsync(pendentesSql, []);
    const proximosRecebimentos = await dbAllAsync(proximosRecebimentosSql, []);
    const proximosPagamentos = await dbAllAsync(proximosPagamentosSql, []);
    const alertas = await dbAllAsync(alertasSql, []);
    const grafico = await dbGetAsync(graficoSql, params);

    res.json({
      success: true,
      resumo: {
        totalRecebido: parseNumber(resumo.totalRecebido),
        totalPago: parseNumber(resumo.totalPago),
        totalReceber: parseNumber(pendentes.totalReceber),
        totalPagar: parseNumber(pendentes.totalPagar)
      },
      proximos_recebimentos: proximosRecebimentos.map(row => ({
        id: row.id,
        descricao: row.descricao,
        valor: parseNumber(row.valor),
        dataVencimento: row.vencimento,
        cliente: row.cliente,
        status: row.status
      })),
      proximos_pagamentos: proximosPagamentos.map(row => ({
        id: row.id,
        descricao: row.descricao,
        valor: parseNumber(row.valor),
        dataVencimento: row.vencimento,
        fornecedor: row.fornecedor,
        status: row.status
      })),
      alertas: alertas.map(row => ({
        id: row.id,
        descricao: row.descricao,
        valor: parseNumber(row.valor),
        dataVencimento: row.vencimento,
        pessoa: row.pessoa,
        tipo: row.tipo,
        status: row.status_exibicao
      })),
      grafico: {
        recebido: parseNumber(grafico.recebido),
        pago: parseNumber(grafico.pago),
        receber: parseNumber(grafico.receber),
        pagar: parseNumber(grafico.pagar)
      }
    });
  } catch (err) {
    console.error('Erro no endpoint dashboard:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/proximos-vencimentos', (req, res) => {
  const hoje = new Date();
  const daqui7dias = new Date(hoje.getTime() + (7 * 24 * 60 * 60 * 1000));

  db.all(`
    SELECT
      id,
      descricao,
      valor,
      vencimento,
      pessoa_nome as cliente,
      tipo,
      JULIANDAY(vencimento) - JULIANDAY('now') as diasRestantes
    FROM financeiro
    WHERE vencimento IS NOT NULL
      AND status NOT IN ('recebido', 'pago')
      AND vencimento >= date('now')
      AND vencimento <= date('now', '+30 days')
    ORDER BY vencimento ASC
    LIMIT 10
  `, [], (err, rows) => {
    if (err) {
      console.error('Erro na query próximos vencimentos:', err);
      res.status(500).json({ error: err.message });
      return;
    }

    const vencimentos = rows.map(row => ({
      id: row.id,
      descricao: row.descricao,
      valor: parseNumber(row.valor),
      dataVencimento: row.vencimento,
      cliente: row.cliente,
      diasRestantes: Math.ceil(parseNumber(row.diasRestantes))
    }));

    res.json({
      success: true,
      vencimentos: vencimentos
    });
  });
});

router.get('/ultimas-movimentacoes', (req, res) => {
  db.all(`
    SELECT
      id,
      descricao,
      valor,
      data_movimento,
      pessoa_nome as cliente,
      tipo,
      status
    FROM financeiro
    ORDER BY data_movimento DESC
    LIMIT 10
  `, [], (err, rows) => {
    if (err) {
      console.error('Erro na query últimas movimentações:', err);
      res.status(500).json({ error: err.message });
      return;
    }

    const movimentacoes = rows.map(row => ({
      id: row.id,
      descricao: row.descricao,
      valor: parseNumber(row.valor),
      dataMovimento: row.data_movimento,
      cliente: row.cliente,
      tipo: row.tipo,
      status: row.status
    }));

    res.json({
      success: true,
      movimentacoes: movimentacoes
    });
  });
});

function buildReceberQueryFilters(query) {
  const { dataInicio, dataFim, status, cliente, documento } = query;

  let sql = `
    SELECT
      f.id,
      f.descricao,
      f.valor,
      f.data_movimento as dataEmissao,
      f.vencimento as dataVencimento,
      COALESCE(f.pessoa_nome, c.nome) as cliente,
      f.status,
      f.observacao,
      f.documento,
      f.numero_parcela,
      f.total_parcelas,
      f.origem
    FROM financeiro f
    LEFT JOIN clientes c
      ON (
        (f.pessoa_nome IS NOT NULL AND TRIM(f.pessoa_nome) <> '' AND c.nome = f.pessoa_nome)
        OR
        (f.documento IS NOT NULL AND c.cpf_cnpj = f.documento)
      )
    WHERE f.tipo = 'receita'
  `;

  const params = [];

  if (dataInicio && dataFim) {
    sql += ' AND COALESCE(f.vencimento, f.data_movimento) BETWEEN ? AND ?';
    params.push(dataInicio, dataFim);
  }

  if (status && status !== 'todas') {
    if (status === 'vencidas') {
      sql += " AND f.status NOT IN ('recebido','pago') AND COALESCE(f.vencimento, f.data_movimento) < date('now')";
    } else if (status === 'a_vencer') {
      sql += " AND f.status NOT IN ('recebido','pago') AND COALESCE(f.vencimento, f.data_movimento) >= date('now')";
    } else if (status === 'recebidas') {
      sql += " AND f.status IN ('recebido','pago')";
    } else {
      sql += ' AND f.status = ?';
      params.push(status);
    }
  }

  if (cliente) {
    sql += `
      AND (
        COALESCE(f.pessoa_nome, c.nome, '') LIKE ?
        OR COALESCE(c.cpf_cnpj, '') LIKE ?
      )
    `;
    params.push(`%${cliente}%`, `%${cliente}%`);
  }

  if (documento) {
    sql += ' AND COALESCE(f.documento, "") LIKE ?';
    params.push(`%${documento}%`);
  }

  sql += ' ORDER BY COALESCE(f.vencimento, f.data_movimento) DESC';

  return { sql, params };
}

router.get('/receber', (req, res) => {
  const { sql, params } = buildReceberQueryFilters(req.query);

  db.all(sql, params, (err, rows) => {
    if (err) {
      console.error('Erro na query receber:', err);
      res.status(500).json({ error: err.message });
      return;
    }

    const hoje = moment().format('YYYY-MM-DD');
    const contas = rows.map(row => {
      let status = row.status;
      if (!['recebido', 'pago'].includes(status) && row.vencimento && row.vencimento < hoje) {
        status = 'vencido';
      }
      return {
        id: row.id,
        descricao: row.descricao,
        valor: parseNumber(row.valor),
        dataEmissao: row.dataEmissao,
        dataVencimento: row.dataVencimento,
        cliente: row.cliente,
        status: status,
        observacao: row.observacao,
        documento: row.documento,
        numero_parcela: row.numero_parcela,
        total_parcelas: row.total_parcelas,
        origem: row.origem
      };
    });

    res.json({
      success: true,
      contas: contas
    });
  });
});

router.get('/contas-receber', (req, res) => {
  const { sql, params } = buildReceberQueryFilters(req.query);

  db.all(sql, params, (err, rows) => {
    if (err) {
      console.error('Erro na query contas receber:', err);
      res.status(500).json({ error: err.message });
      return;
    }

    const hoje = moment().format('YYYY-MM-DD');
    const contas = rows.map(row => {
      let status = row.status;
      if (!['recebido', 'pago'].includes(status) && row.vencimento && row.vencimento < hoje) {
        status = 'vencido';
      }
      return {
        id: row.id,
        descricao: row.descricao,
        valor: parseNumber(row.valor),
        dataEmissao: row.dataEmissao,
        dataVencimento: row.dataVencimento,
        cliente: row.cliente,
        status: status,
        observacao: row.observacao
      };
    });

    res.json({
      success: true,
      contas: contas
    });
  });
});

router.get('/receber/agrupado', async (req, res) => {
  try {
    const { cliente, status, dataInicio, dataFim } = req.query;

    let sql = `
      SELECT
        c.id as cliente_id,
        c.nome as nome_cliente,
        COALESCE(c.cpf_cnpj, '') as cpf,
        COALESCE(c.telefone, '') as telefone,
        COUNT(DISTINCT cr.venda_id) as quantidade_vendas,
        COUNT(cr.id) as quantidade_titulos,
        COALESCE(SUM(CASE WHEN cr.status IN ('aberto','parcial') THEN cr.valor_restante ELSE 0 END), 0) as total_divida,
        COALESCE(SUM(CASE WHEN cr.status = 'recebido' THEN cr.valor_parcela ELSE 0 END), 0) as total_pago,
        COALESCE(SUM(CASE WHEN cr.status IN ('aberto','parcial') AND date(cr.data_vencimento) < date('now') THEN 1 ELSE 0 END), 0) as vencidas,
        COALESCE(SUM(CASE WHEN cr.status IN ('aberto','parcial') AND date(cr.data_vencimento) >= date('now') THEN 1 ELSE 0 END), 0) as a_vencer
      FROM clientes c
      JOIN contas_receber cr ON cr.cliente_id = c.id
      WHERE cr.status IN ('aberto','parcial')
    `;

    const params = [];

    if (cliente) {
      sql += ` AND (c.nome LIKE ? OR c.cpf_cnpj LIKE ? OR c.telefone LIKE ?)`;
      params.push(`%${cliente}%`, `%${cliente}%`, `%${cliente}%`);
    }

    if (dataInicio && dataFim) {
      sql += ' AND date(cr.data_vencimento) BETWEEN ? AND ?';
      params.push(dataInicio, dataFim);
    }

    if (status && status !== 'todas') {
      if (status === 'vencidas') {
        sql += " AND date(cr.data_vencimento) < date('now')";
      } else if (status === 'a_vencer') {
        sql += " AND date(cr.data_vencimento) >= date('now')";
      }
    }

    sql += ' GROUP BY c.id, c.nome, c.cpf_cnpj, c.telefone';
    sql += ' ORDER BY c.nome ASC';

    const rows = await dbAllAsync(sql, params);

    const clientes = rows.map(row => ({
      cliente_id: row.cliente_id,
      nome_cliente: row.nome_cliente,
      cpf: row.cpf,
      telefone: row.telefone,
      quantidade_vendas: parseNumber(row.quantidade_vendas),
      quantidade_titulos: parseNumber(row.quantidade_titulos),
      total_divida: parseNumber(row.total_divida),
      total_pago: parseNumber(row.total_pago),
      saldo_atual: parseNumber(row.total_divida),
      vencidas: parseNumber(row.vencidas),
      a_vencer: parseNumber(row.a_vencer)
    }));

    res.json({ success: true, clientes });
  } catch (err) {
    console.error('Erro ao listar dívida agrupada:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/receber/agrupado/:clienteId', async (req, res) => {
  try {
    const { clienteId } = req.params;

    const cliente = await dbGetAsync(`
      SELECT
        id,
        nome,
        cpf_cnpj AS cpf,
        telefone,
        endereco,
        rua,
        numero,
        bairro,
        cidade,
        uf,
        cep
      FROM clientes
      WHERE id = ?
    `, [clienteId]);

    if (!cliente) {
      return res.status(404).json({ success: false, error: 'Cliente não encontrado' });
    }

    const endereco = cliente.endereco || [cliente.rua, cliente.numero, cliente.bairro, cliente.cidade, cliente.uf, cliente.cep]
      .filter(Boolean)
      .join(', ');

    const contas = await dbAllAsync(`
      SELECT
        cr.id AS conta_receber_id,
        cr.venda_id,
        v.codigo AS numero_venda,
        v.data_venda,
        v.total AS valor_total,
        cr.numero_parcela,
        cr.total_parcelas,
        cr.valor_parcela,
        cr.valor_restante,
        cr.data_vencimento,
        cr.status
      FROM contas_receber cr
      JOIN vendas v ON v.id = cr.venda_id
      WHERE cr.cliente_id = ? AND cr.status IN ('aberto', 'parcial')
      ORDER BY v.data_venda ASC, cr.data_vencimento ASC
    `, [clienteId]);

    const vendaIds = [...new Set(contas.map(conta => conta.venda_id))];

    let produtos = [];
    if (vendaIds.length > 0) {
      const placeholders = vendaIds.map(() => '?').join(',');
      produtos = await dbAllAsync(`
        SELECT
          vi.venda_id,
          vi.produto_id,
          p.nome AS nome_produto,
          vi.quantidade,
          vi.quantidade_fiscal,
          vi.quantidade_nao_fiscal,
          vi.valor_fiscal,
          vi.valor_nao_fiscal,
          vi.preco_unitario,
          vi.subtotal
        FROM vendas_itens vi
        LEFT JOIN produtos p ON p.id = vi.produto_id
        WHERE vi.venda_id IN (${placeholders})
      `, vendaIds);
    }

    const vendasMap = new Map();
    contas.forEach(conta => {
      if (!vendasMap.has(conta.venda_id)) {
        vendasMap.set(conta.venda_id, {
          venda_id: conta.venda_id,
          numero_venda: conta.numero_venda,
          data_venda: conta.data_venda,
          valor_total: parseNumber(conta.valor_total),
          valor_pago: 0,
          saldo_aberto: 0,
          data_vencimento: conta.data_vencimento,
          status: conta.status,
          parcelas: [],
          produtos: []
        });
      }

      const venda = vendasMap.get(conta.venda_id);
      venda.parcelas.push({
        conta_receber_id: conta.conta_receber_id,
        parcela: `${conta.numero_parcela || '-'} / ${conta.total_parcelas || '-'}`,
        valor_parcela: parseNumber(conta.valor_parcela),
        valor_restante: parseNumber(conta.valor_restante),
        vencimento: conta.data_vencimento,
        status: conta.status
      });

      venda.saldo_aberto += parseNumber(conta.valor_restante);
      venda.valor_pago += parseNumber(conta.valor_parcela) - parseNumber(conta.valor_restante);

      if (!venda.data_vencimento || (conta.data_vencimento && conta.data_vencimento < venda.data_vencimento)) {
        venda.data_vencimento = conta.data_vencimento;
      }

      if (conta.status === 'vencido') {
        venda.status = 'vencido';
      } else if (venda.status !== 'vencido' && conta.status === 'parcial') {
        venda.status = 'parcial';
      }
    });

    produtos.forEach(prod => {
      const venda = vendasMap.get(prod.venda_id);
      if (venda) {
        venda.produtos.push({
          produto_id: prod.produto_id,
          nome_produto: prod.nome_produto,
          quantidade: parseNumber(prod.quantidade),
          quantidade_fiscal: parseNumber(prod.quantidade_fiscal),
          quantidade_nao_fiscal: parseNumber(prod.quantidade_nao_fiscal),
          valor_fiscal: parseNumber(prod.valor_fiscal),
          valor_nao_fiscal: parseNumber(prod.valor_nao_fiscal),
          preco_unitario: parseNumber(prod.preco_unitario),
          subtotal: parseNumber(prod.subtotal)
        });
      }
    });

    const vendas = Array.from(vendasMap.values()).map(venda => ({
      ...venda,
      data_vencimento: venda.data_vencimento,
      status: venda.status || 'aberto'
    }));

    const totalDivida = contas.reduce((sum, conta) => sum + parseNumber(conta.valor_parcela), 0);
    const totalPago = contas.reduce((sum, conta) => sum + (parseNumber(conta.valor_parcela) - parseNumber(conta.valor_restante)), 0);
    const saldoAtual = contas.reduce((sum, conta) => sum + parseNumber(conta.valor_restante), 0);
    const quantidadeVendas = new Set(contas.map(conta => conta.venda_id)).size;
    const quantidadeTitulos = contas.length;
    const vencidas = contas.filter(conta => conta.status !== 'recebido' && conta.data_vencimento && conta.data_vencimento < moment().format('YYYY-MM-DD')).length;
    const aVencer = contas.filter(conta => conta.status !== 'recebido' && conta.data_vencimento && conta.data_vencimento >= moment().format('YYYY-MM-DD')).length;

    res.json({
      success: true,
      cliente: {
        id: cliente.id,
        nome: cliente.nome,
        cpf: cliente.cpf,
        telefone: cliente.telefone,
        endereco: endereco
      },
      resumo: {
        totalDivida: parseNumber(totalDivida),
        totalPago: parseNumber(totalPago),
        saldoAtual: parseNumber(saldoAtual),
        quantidadeVendas,
        quantidadeTitulos,
        vencidas,
        aVencer
      },
      vendas
    });
  } catch (err) {
    console.error('Erro ao buscar duplicata agrupada:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/receber/agrupado/:clienteId/extrato', async (req, res) => {
  try {
    const configuracoes = await dbAllAsync(`
      SELECT chave, valor
      FROM configuracoes
      WHERE chave IN ('nome_empresa', 'cnpj', 'telefone', 'endereco')
    `, []);

    const empresa = {
      nome: '',
      cnpj: '',
      telefone: '',
      endereco: ''
    };
    configuracoes.forEach(conf => {
      if (conf.chave === 'nome_empresa') empresa.nome = conf.valor;
      if (conf.chave === 'cnpj') empresa.cnpj = conf.valor;
      if (conf.chave === 'telefone') empresa.telefone = conf.valor;
      if (conf.chave === 'endereco') empresa.endereco = conf.valor;
    });

    const clienteId = req.params.clienteId;

    const cliente = await dbGetAsync(`
      SELECT id, nome, cpf_cnpj AS cpf, telefone, endereco, rua, numero, bairro, cidade, uf, cep
      FROM clientes
      WHERE id = ?
    `, [clienteId]);

    if (!cliente) {
      return res.status(404).json({ success: false, error: 'Cliente não encontrado' });
    }

    const endereco = cliente.endereco || [cliente.rua, cliente.numero, cliente.bairro, cliente.cidade, cliente.uf, cliente.cep]
      .filter(Boolean)
      .join(', ');

    const contas = await dbAllAsync(`
      SELECT
        cr.id AS conta_receber_id,
        cr.venda_id,
        v.codigo AS numero_venda,
        v.data_venda,
        v.total AS valor_total,
        cr.numero_parcela,
        cr.total_parcelas,
        cr.valor_parcela,
        cr.valor_restante,
        cr.data_vencimento,
        cr.status
      FROM contas_receber cr
      JOIN vendas v ON v.id = cr.venda_id
      WHERE cr.cliente_id = ?
      ORDER BY v.data_venda ASC, cr.data_vencimento ASC
    `, [clienteId]);

    const vendaIds = [...new Set(contas.map(conta => conta.venda_id))];
    let produtos = [];
    if (vendaIds.length > 0) {
      const placeholders = vendaIds.map(() => '?').join(',');
      produtos = await dbAllAsync(`
        SELECT
          vi.venda_id,
          vi.produto_id,
          p.nome AS nome_produto,
          vi.quantidade,
          vi.quantidade_fiscal,
          vi.quantidade_nao_fiscal,
          vi.valor_fiscal,
          vi.valor_nao_fiscal,
          vi.preco_unitario,
          vi.subtotal
        FROM vendas_itens vi
        LEFT JOIN produtos p ON p.id = vi.produto_id
        WHERE vi.venda_id IN (${placeholders})
      `, vendaIds);
    }

    const vendasMap = new Map();
    contas.forEach(conta => {
      if (!vendasMap.has(conta.venda_id)) {
        vendasMap.set(conta.venda_id, {
          venda_id: conta.venda_id,
          numero_venda: conta.numero_venda,
          data_venda: conta.data_venda,
          valor_total: parseNumber(conta.valor_total),
          valor_pago: 0,
          saldo_aberto: 0,
          data_vencimento: conta.data_vencimento,
          status: conta.status,
          parcelas: [],
          produtos: []
        });
      }
      const venda = vendasMap.get(conta.venda_id);
      venda.parcelas.push({
        conta_receber_id: conta.conta_receber_id,
        parcela: `${conta.numero_parcela || '-'} / ${conta.total_parcelas || '-'}`,
        valor_parcela: parseNumber(conta.valor_parcela),
        valor_restante: parseNumber(conta.valor_restante),
        vencimento: conta.data_vencimento,
        status: conta.status
      });
      venda.saldo_aberto += parseNumber(conta.valor_restante);
      venda.valor_pago += parseNumber(conta.valor_parcela) - parseNumber(conta.valor_restante);
      if (conta.status === 'vencido') {
        venda.status = 'vencido';
      } else if (venda.status !== 'vencido' && conta.status === 'parcial') {
        venda.status = 'parcial';
      }
      if (!venda.data_vencimento || (conta.data_vencimento && conta.data_vencimento < venda.data_vencimento)) {
        venda.data_vencimento = conta.data_vencimento;
      }
    });

    produtos.forEach(prod => {
      const venda = vendasMap.get(prod.venda_id);
      if (venda) {
        venda.produtos.push({
          produto_id: prod.produto_id,
          nome_produto: prod.nome_produto,
          quantidade: parseNumber(prod.quantidade),
          quantidade_fiscal: parseNumber(prod.quantidade_fiscal),
          quantidade_nao_fiscal: parseNumber(prod.quantidade_nao_fiscal),
          valor_fiscal: parseNumber(prod.valor_fiscal),
          valor_nao_fiscal: parseNumber(prod.valor_nao_fiscal),
          preco_unitario: parseNumber(prod.preco_unitario),
          subtotal: parseNumber(prod.subtotal)
        });
      }
    });

    const vendas = Array.from(vendasMap.values());
    const totalDivida = contas.reduce((sum, conta) => sum + parseNumber(conta.valor_parcela), 0);
    const totalPago = contas.reduce((sum, conta) => sum + (parseNumber(conta.valor_parcela) - parseNumber(conta.valor_restante)), 0);
    const saldoAtual = contas.reduce((sum, conta) => sum + parseNumber(conta.valor_restante), 0);
    const quantidadeVendas = new Set(contas.map(conta => conta.venda_id)).size;
    const quantidadeTitulos = contas.length;
    const vencidas = contas.filter(conta => conta.status !== 'recebido' && conta.data_vencimento && conta.data_vencimento < moment().format('YYYY-MM-DD')).length;
    const aVencer = contas.filter(conta => conta.status !== 'recebido' && conta.data_vencimento && conta.data_vencimento >= moment().format('YYYY-MM-DD')).length;

    res.json({
      success: true,
      empresa,
      cliente: {
        id: cliente.id,
        nome: cliente.nome,
        cpf: cliente.cpf,
        telefone: cliente.telefone,
        endereco: endereco
      },
      resumo: {
        totalDivida: parseNumber(totalDivida),
        totalPago: parseNumber(totalPago),
        saldoAtual: parseNumber(saldoAtual),
        quantidadeVendas,
        quantidadeTitulos,
        vencidas,
        aVencer
      },
      vendas,
      geradoEm: moment().format('YYYY-MM-DD HH:mm:ss')
    });
  } catch (err) {
    console.error('Erro ao gerar extrato de duplicata:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/receber/agrupado/:clienteId/pagamentos', async (req, res) => {
  try {
    const clienteId = req.params.clienteId;
    const rows = await dbAllAsync(`
      SELECT
        crp.id,
        crp.valor_pago,
        crp.data_pagamento,
        crp.forma_pagamento,
        crp.observacao,
        crp.created_at,
        cr.conta_receber_id,
        v.codigo as venda_codigo,
        cr.numero_parcela,
        cr.total_parcelas
      FROM contas_receber_pagamentos crp
      JOIN contas_receber cr ON cr.id = crp.conta_receber_id
      JOIN vendas v ON v.id = cr.venda_id
      WHERE crp.cliente_id = ?
      ORDER BY crp.data_pagamento DESC, crp.created_at DESC
    `, [clienteId]);

    const pagamentos = rows.map(row => ({
      id: row.id,
      valor_pago: parseNumber(row.valor_pago),
      data_pagamento: row.data_pagamento,
      forma_pagamento: row.forma_pagamento,
      observacao: row.observacao,
      created_at: row.created_at,
      conta_receber_id: row.conta_receber_id,
      venda_codigo: row.venda_codigo,
      parcela: `${row.numero_parcela}/${row.total_parcelas}`
    }));

    res.json({ success: true, pagamentos });
  } catch (err) {
    console.error('Erro ao buscar histórico de pagamentos:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/receber/agrupado/:clienteId/pagamento-parcial', async (req, res) => {
  try {
    const clienteId = req.params.clienteId;
    const { valor, data_pagamento, forma_pagamento, observacao } = req.body;
    const valorPago = arredondarCentavos(valor);

    if (valorPago <= 0) {
      return res.status(400).json({ success: false, error: 'Valor deve ser maior que zero' });
    }

    if (!data_pagamento) {
      return res.status(400).json({ success: false, error: 'Data do pagamento é obrigatória' });
    }

    const cliente = await dbGetAsync('SELECT id, nome FROM clientes WHERE id = ?', [clienteId]);
    if (!cliente) {
      return res.status(404).json({ success: false, error: 'Cliente não encontrado' });
    }

    const contas = await dbAllAsync(`
      SELECT
        cr.id,
        cr.venda_id,
        cr.valor_parcela,
        cr.valor_restante,
        cr.data_vencimento,
        cr.numero_parcela,
        cr.total_parcelas,
        v.codigo AS numero_venda
      FROM contas_receber cr
      LEFT JOIN vendas v ON v.id = cr.venda_id
      WHERE cr.cliente_id = ? AND cr.status IN ('aberto','parcial')
      ORDER BY cr.data_vencimento ASC, cr.id ASC
    `, [clienteId]);

    if (!contas.length) {
      return res.status(400).json({ success: false, error: 'Cliente não possui contas em aberto' });
    }

    const totalAberto = arredondarCentavos(
      contas.reduce((sum, conta) => sum + arredondarCentavos(conta.valor_restante), 0)
    );

    if (valorPago > totalAberto + 0.009) {
      return res.status(400).json({
        success: false,
        error: `Valor informado (${valorPago.toFixed(2)}) é maior que o total em aberto (${totalAberto.toFixed(2)})`
      });
    }

    const pagamentosRealizados = await new Promise((resolve, reject) => {
      db.serialize(() => {
        db.run('BEGIN IMMEDIATE');

        let valorRestantePagamento = arredondarCentavos(valorPago);
        const pagamentos = [];

        const processarConta = (index) => {
          if (index >= contas.length || valorRestantePagamento <= 0) {
            db.run('COMMIT', (err) => {
              if (err) {
                db.run('ROLLBACK');
                reject(err);
              } else {
                resolve(pagamentos);
              }
            });
            return;
          }

          const conta = contas[index];
          const saldoAtualConta = parseNumber(conta.valor_restante);
          const valorAbater = Math.min(saldoAtualConta, valorRestantePagamento);

          if (valorAbater <= 0) {
            processarConta(index + 1);
            return;
          }

          db.run(`
            INSERT INTO contas_receber_pagamentos (
              conta_receber_id,
              cliente_id,
              valor_pago,
              data_pagamento,
              forma_pagamento,
              observacao
            ) VALUES (?, ?, ?, ?, ?, ?)
          `, [
            conta.id,
            clienteId,
            valorAbater,
            data_pagamento,
            forma_pagamento || 'dinheiro',
            observacao || `Pagamento parcial - Venda ${conta.venda_id}`
          ], function(err) {
            if (err) {
              db.run('ROLLBACK');
              reject(err);
              return;
            }

            const novoSaldo = saldoAtualConta - valorAbater;
            const novoStatus = novoSaldo <= 0 ? 'recebido' : 'parcial';
            const dataPagamentoFinal = novoSaldo <= 0 ? data_pagamento : null;

            db.run(`
              UPDATE contas_receber
              SET valor_restante = ?, status = ?, data_pagamento = ?
              WHERE id = ?
            `, [novoSaldo, novoStatus, dataPagamentoFinal, conta.id], (err) => {
              if (err) {
                db.run('ROLLBACK');
                reject(err);
                return;
              }

              const descricaoFinanceiro = `Recebimento venda #${conta.numero_venda || conta.venda_id} - Parcela ${conta.numero_parcela || '-'} / ${conta.total_parcelas || '-'}`;

              db.get(`
                SELECT id
                FROM financeiro
                WHERE tipo = 'receita'
                  AND referencia_tipo = 'venda'
                  AND referencia_id = ?
                  AND numero_parcela = ?
                ORDER BY id DESC
                LIMIT 1
              `, [conta.venda_id, conta.numero_parcela || null], (err, movFinanceiro) => {
                if (err) {
                  db.run('ROLLBACK');
                  reject(err);
                  return;
                }

                if (movFinanceiro) {
                  db.run(`
                    UPDATE financeiro
                    SET
                      status = ?,
                      forma_pagamento = ?,
                      observacao = ?,
                      pessoa_nome = ?,
                      baixado_em = CASE WHEN ? = 'recebido' THEN ? ELSE NULL END,
                      data_movimento = CASE WHEN ? = 'recebido' THEN ? ELSE data_movimento END,
                      vencimento = CASE WHEN ? = 'recebido' THEN ? ELSE vencimento END
                    WHERE id = ?
                  `, [
                    novoStatus,
                    forma_pagamento || 'dinheiro',
                    observacao || `Pagamento parcial registrado em ${data_pagamento}`,
                    cliente.nome || null,
                    novoStatus,
                    data_pagamento,
                    novoStatus,
                    data_pagamento,
                    novoStatus,
                    data_pagamento,
                    movFinanceiro.id
                  ], (err) => {
                    if (err) {
                      db.run('ROLLBACK');
                      reject(err);
                      return;
                    }

                    pagamentos.push({
                      conta_receber_id: conta.id,
                      venda_id: conta.venda_id,
                      valor_pago: valorAbater,
                      saldo_restante: novoSaldo,
                      status: novoStatus
                    });

                    valorRestantePagamento -= valorAbater;
                    processarConta(index + 1);
                  });
                } else {
                  db.run(`
                    INSERT INTO financeiro (
                      tipo,
                      descricao,
                      valor,
                      data_movimento,
                      categoria,
                      forma_pagamento,
                      referencia_id,
                      referencia_tipo,
                      status,
                      origem,
                      documento,
                      vencimento,
                      numero_parcela,
                      total_parcelas,
                      venda_id,
                      pessoa_nome,
                      observacao,
                      baixado_em
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  `, [
                    'receita',
                    descricaoFinanceiro,
                    parseNumber(conta.valor_parcela),
                    data_pagamento,
                    'vendas',
                    forma_pagamento || 'dinheiro',
                    conta.venda_id,
                    'venda',
                    novoStatus,
                    'duplicata',
                    null,
                    novoStatus === 'recebido' ? data_pagamento : conta.data_vencimento,
                    conta.numero_parcela || null,
                    conta.total_parcelas || null,
                    conta.venda_id,
                    cliente.nome || null,
                    observacao || `Pagamento parcial registrado em ${data_pagamento}`,
                    novoStatus === 'recebido' ? data_pagamento : null
                  ], (err) => {
                    if (err) {
                      db.run('ROLLBACK');
                      reject(err);
                      return;
                    }

                    pagamentos.push({
                      conta_receber_id: conta.id,
                      venda_id: conta.venda_id,
                      valor_pago: valorAbater,
                      saldo_restante: novoSaldo,
                      status: novoStatus
                    });

                    valorRestantePagamento -= valorAbater;
                    processarConta(index + 1);
                  });
                }
              });
            });
          });
        };

        processarConta(0);
      });
    });

    res.json({
      success: true,
      message: 'Pagamento parcial realizado com sucesso',
      pagamentosRealizados
    });
  } catch (err) {
    console.error('Erro ao processar pagamento parcial:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

function buildPagarQueryFilters(query) {
  const { dataInicio, dataFim, status, fornecedor } = query;

  let sql = `
    SELECT
      f.id,
      f.descricao,
      f.valor,
      f.data_movimento AS dataEmissao,
      f.vencimento AS dataVencimento,
      COALESCE(f.pessoa_nome, forn.nome) AS fornecedor,
      COALESCE(f.documento, '') AS documento,
      f.status,
      f.observacao,
      f.categoria,
      f.origem
    FROM financeiro f
    LEFT JOIN fornecedores forn
      ON (
        (f.pessoa_nome IS NOT NULL AND TRIM(f.pessoa_nome) <> '' AND forn.nome = f.pessoa_nome)
      )
    WHERE f.tipo = 'despesa'
  `;

  const params = [];

  if (dataInicio && dataFim) {
    sql += ' AND COALESCE(f.vencimento, f.data_movimento) BETWEEN ? AND ?';
    params.push(dataInicio, dataFim);
  }

  if (status && status !== 'todos' && status !== 'todas') {
    if (status === 'vencido') {
      sql += " AND f.status NOT IN ('pago','recebido') AND COALESCE(f.vencimento, f.data_movimento) < date('now')";
    } else if (status === 'a_vencer') {
      sql += " AND f.status NOT IN ('pago','recebido') AND COALESCE(f.vencimento, f.data_movimento) >= date('now')";
    } else if (status === 'pago') {
      sql += " AND f.status IN ('pago','recebido')";
    } else if (status === 'pendente') {
      sql += " AND f.status = 'pendente' AND COALESCE(f.vencimento, f.data_movimento) >= date('now')";
    } else {
      sql += ' AND f.status = ?';
      params.push(status);
    }
  }

  if (fornecedor) {
    sql += `
      AND (
        COALESCE(f.pessoa_nome, forn.nome, '') LIKE ?
        OR COALESCE(f.documento, '') LIKE ?
        OR COALESCE(forn.cpf_cnpj, '') LIKE ?
      )
    `;
    params.push(`%${fornecedor}%`, `%${fornecedor}%`, `%${fornecedor}%`);
  }

  sql += ' ORDER BY COALESCE(f.vencimento, f.data_movimento) DESC, f.id DESC';

  return { sql, params };
}

router.get('/pagar', (req, res) => {
  const { sql, params } = buildPagarQueryFilters(req.query);

  db.all(sql, params, (err, rows) => {
    if (err) {
      console.error('Erro na query pagar:', err);
      res.status(500).json({ error: err.message });
      return;
    }

    const hoje = moment().format('YYYY-MM-DD');
    const contas = rows.map(row => {
      let status = row.status;
      if (!['recebido', 'pago'].includes(status) && row.vencimento && row.vencimento < hoje) {
        status = 'vencido';
      }
      return {
        id: row.id,
        descricao: row.descricao,
        valor: parseNumber(row.valor),
        dataEmissao: row.dataEmissao,
        dataVencimento: row.dataVencimento,
        fornecedor: row.fornecedor,
        categoria: row.categoria,
        status: status,
        observacao: row.observacao,
        documento: row.documento,
        numero_parcela: row.numero_parcela,
        total_parcelas: row.total_parcelas,
        origem: row.origem
      };
    });

    res.json({
      success: true,
      contas: contas
    });
  });
});

router.get('/contas-pagar', (req, res) => {
  const { sql, params } = buildPagarQueryFilters(req.query);

  db.all(sql, params, (err, rows) => {
    if (err) {
      console.error('Erro ao carregar contas a pagar:', err);
      return res.status(500).json({
        success: false,
        error: err.message
      });
    }

    const hoje = moment().format('YYYY-MM-DD');

    const contas = (rows || []).map(row => {
      let statusFinal = row.status || 'pendente';

      if (
        !['pago', 'recebido'].includes(statusFinal) &&
        row.dataVencimento &&
        row.dataVencimento < hoje
      ) {
        statusFinal = 'vencido';
      }

      return {
        id: row.id,
        fornecedor: row.fornecedor || '-',
        descricao: row.descricao || '',
        documento: row.documento || '',
        valor: Number(row.valor || 0),
        dataEmissao: row.dataEmissao || null,
        dataVencimento: row.dataVencimento || null,
        status: statusFinal,
        categoria: row.categoria || '',
        observacao: row.observacao || '',
        origem: row.origem || ''
      };
    });

    return res.json({
      success: true,
      contas
    });
  });
});

// ========== RELATÓRIOS ==========

// Relatório de Resumo Financeiro
router.get('/relatorios/resumo', async (req, res) => {
  const { dataInicio, dataFim, modo_fiscal } = req.query;

  let sql = `
    SELECT
      tipo,
      status,
      SUM(valor) as total,
      COUNT(*) as quantidade
    FROM financeiro
    WHERE 1=1
  `;

  const params = [];

  if (dataInicio && dataFim) {
    sql += ' AND data_movimento BETWEEN ? AND ?';
    params.push(dataInicio, dataFim);
  }

  sql += ' GROUP BY tipo, status ORDER BY tipo, status';

  try {
    const rows = await dbAllAsync(sql, params);
    const recebimentosVenda = await consultarRecebimentosVendaSplit(dataInicio, dataFim, modo_fiscal);

    const resumo = {
      receitas: {
        total: 0,
        recebidas: 0,
        pendentes: 0,
        quantidade: 0
      },
      despesas: {
        total: 0,
        pagas: 0,
        pendentes: 0,
        quantidade: 0
      }
    };

    rows.forEach(row => {
      const valor = parseNumber(row.total);
      if (row.tipo === 'receita') {
        resumo.receitas.total += valor;
        resumo.receitas.quantidade += row.quantidade;
        if (row.status === 'recebido') {
          resumo.receitas.recebidas += valor;
        } else {
          resumo.receitas.pendentes += valor;
        }
      } else if (row.tipo === 'despesa') {
        resumo.despesas.total += valor;
        resumo.despesas.quantidade += row.quantidade;
        if (row.status === 'pago') {
          resumo.despesas.pagas += valor;
        } else {
          resumo.despesas.pendentes += valor;
        }
      }
    });

    res.json({
      success: true,
      modo_fiscal_ativo: recebimentosVenda.modo_fiscal_ativo,
      resumo,
      recebimentos_venda: {
        fiscal: recebimentosVenda.fiscal,
        nao_fiscal: recebimentosVenda.nao_fiscal,
        total: recebimentosVenda.total
      },
      periodo: { dataInicio, dataFim }
    });
  } catch (err) {
    console.error('Erro no relatório resumo:', err);
    res.status(500).json({ error: err.message });
  }
});

// Relatório de Contas a Receber
router.get('/relatorios/receber', (req, res) => {
  const { dataInicio, dataFim, status, cliente, modo_fiscal } = req.query;
  const modoFiscalAtivo = isModoFiscalRelatorio(modo_fiscal);

  let sql = `
    SELECT
      f.id,
      f.descricao,
      f.documento,
      f.valor,
      f.data_movimento,
      f.vencimento,
      f.status,
      f.origem,
      f.pessoa_nome,
      f.venda_id,
      v.total AS venda_total,
      v.valor_fiscal AS venda_valor_fiscal,
      v.valor_nao_fiscal AS venda_valor_nao_fiscal
    FROM financeiro f
    LEFT JOIN vendas v ON v.id = f.venda_id
    WHERE f.tipo = 'receita'
  `;

  const params = [];

  if (dataInicio && dataFim) {
    sql += ' AND date(COALESCE(f.vencimento, f.data_movimento)) BETWEEN date(?) AND date(?)';
    params.push(dataInicio, dataFim);
  }

  if (status && status !== 'todas') {
    if (status === 'vencido') {
      sql += " AND f.status NOT IN ('recebido','pago') AND date(COALESCE(f.vencimento, f.data_movimento)) < date('now')";
    } else {
      sql += ' AND f.status = ?';
      params.push(status);
    }
  }

  if (cliente && cliente.trim() !== '') {
    sql += ' AND COALESCE(f.pessoa_nome, "") LIKE ?';
    params.push(`%${cliente.trim()}%`);
  }

  if (modoFiscalAtivo) {
    sql += ` AND (
      f.venda_id IS NULL
      OR COALESCE(v.valor_fiscal, 0) > 0
    )`;
  }

  sql += ' ORDER BY date(COALESCE(f.vencimento, f.data_movimento)) DESC, f.id DESC';

  db.all(sql, params, (err, rows) => {
    if (err) {
      console.error('Erro no relatório receber:', err);
      return res.status(500).json({ success: false, error: err.message });
    }

    const hoje = moment().format('YYYY-MM-DD');

    const contas = (rows || []).map(row => {
      let statusFinal = row.status || 'pendente';

      if (
        !['recebido', 'pago'].includes(statusFinal) &&
        row.vencimento &&
        row.vencimento < hoje
      ) {
        statusFinal = 'vencido';
      }

      const valorFiscal = calcularValorFiscalConta(row.valor, row.venda_total, row.venda_valor_fiscal);
      const valorNaoFiscal = calcularValorNaoFiscalConta(row.valor, row.venda_total, row.venda_valor_nao_fiscal);
      const valorExibido = modoFiscalAtivo ? valorFiscal : parseNumber(row.valor);

      return {
        id: row.id,
        cliente: row.pessoa_nome || '',
        descricao: row.descricao || '',
        documento: row.documento || '',
        valor: valorExibido,
        valor_fiscal: valorFiscal,
        valor_nao_fiscal: valorNaoFiscal,
        valor_total: parseNumber(row.valor),
        dataEmissao: row.data_movimento || null,
        dataVencimento: row.vencimento || null,
        status: statusFinal,
        origem: row.origem || '',
        venda_id: row.venda_id || null
      };
    }).filter((conta) => {
      if (!modoFiscalAtivo) return true;
      return parseNumber(conta.valor_fiscal) > 0;
    });

    return res.json({
      success: true,
      modo_fiscal_ativo: modoFiscalAtivo,
      contas,
      totais: {
        fiscal: contas.reduce((sum, c) => sum + parseNumber(c.valor_fiscal), 0),
        nao_fiscal: modoFiscalAtivo
          ? 0
          : contas.reduce((sum, c) => sum + parseNumber(c.valor_nao_fiscal), 0),
        total: contas.reduce((sum, c) => sum + parseNumber(modoFiscalAtivo ? c.valor_fiscal : c.valor_total), 0)
      },
      periodo: { dataInicio, dataFim }
    });
  });
});

// Relatório de Contas a Pagar
router.get('/relatorios/pagar', (req, res) => {
  const { sql, params } = buildPagarQueryFilters(req.query);

  db.all(sql, params, (err, rows) => {
    if (err) {
      console.error('Erro no relatório pagar:', err);
      return res.status(500).json({ success: false, error: err.message });
    }

    const hoje = moment().format('YYYY-MM-DD');

    const contas = (rows || []).map(row => {
      let statusFinal = row.status || 'pendente';

      if (
        !['recebido', 'pago'].includes(statusFinal) &&
        row.dataVencimento &&
        row.dataVencimento < hoje
      ) {
        statusFinal = 'vencido';
      }

      return {
        id: row.id,
        fornecedor: row.fornecedor || row.pessoa_nome || '',
        descricao: row.descricao || '',
        documento: row.documento || '',
        valor: parseNumber(row.valor),
        dataEmissao: row.dataEmissao || null,
        dataVencimento: row.dataVencimento || null,
        status: statusFinal,
        categoria: row.categoria || '',
        observacao: row.observacao || '',
        origem: row.origem || ''
      };
    });

    return res.json({
      success: true,
      contas,
      periodo: {
        dataInicio: req.query.dataInicio,
        dataFim: req.query.dataFim
      }
    });
  });
});

// Relatório de Fluxo Financeiro
router.get('/relatorios/fluxo', async (req, res) => {
  const { dataInicio, dataFim, modo_fiscal } = req.query;

  let sql = `
    SELECT
      DATE(data_movimento) as data,
      tipo,
      SUM(valor) as valor
    FROM financeiro
    WHERE 1=1
  `;

  const params = [];

  if (dataInicio && dataFim) {
    sql += ' AND data_movimento BETWEEN ? AND ?';
    params.push(dataInicio, dataFim);
  }

  sql += ' GROUP BY DATE(data_movimento), tipo ORDER BY data';

  try {
    const rows = await dbAllAsync(sql, params);
    const recebimentosVenda = await consultarRecebimentosVendaSplit(dataInicio, dataFim, modo_fiscal);

    const fluxo = {};
    rows.forEach(row => {
      if (!fluxo[row.data]) {
        fluxo[row.data] = { data: row.data, receitas: 0, despesas: 0, saldo: 0 };
      }
      if (row.tipo === 'receita') {
        fluxo[row.data].receitas = parseNumber(row.valor);
      } else if (row.tipo === 'despesa') {
        fluxo[row.data].despesas = parseNumber(row.valor);
      }
      fluxo[row.data].saldo = fluxo[row.data].receitas - fluxo[row.data].despesas;
    });

    const fluxoArray = Object.values(fluxo);
    const entradasFinanceiro = fluxoArray.reduce((sum, item) => sum + item.receitas, 0);
    const entradasVendaFiscal = recebimentosVenda.fiscal.total;
    const entradasVendaNaoFiscal = recebimentosVenda.nao_fiscal.total;
    const entradasVendaTotal = recebimentosVenda.total.total;

    res.json({
      success: true,
      modo_fiscal_ativo: recebimentosVenda.modo_fiscal_ativo,
      entradas: recebimentosVenda.modo_fiscal_ativo ? entradasVendaFiscal : entradasVendaTotal,
      entradas_financeiro: entradasFinanceiro,
      entradas_venda: {
        fiscal: entradasVendaFiscal,
        nao_fiscal: entradasVendaNaoFiscal,
        total: entradasVendaTotal
      },
      saidas: fluxoArray.reduce((sum, item) => sum + item.despesas, 0),
      periodo: { dataInicio, dataFim }
    });
  } catch (err) {
    console.error('Erro no relatório fluxo:', err);
    res.status(500).json({ error: err.message });
  }
});

// Relatório de Inadimplência
router.get('/relatorios/inadimplencia', (req, res) => {
  const { dataInicio, dataFim } = req.query;

  let sql = `
    SELECT
      f.*,
      f.pessoa_nome as pessoa_nome,
      CASE
        WHEN f.tipo = 'receita' THEN 'cliente'
        WHEN f.tipo = 'despesa' THEN 'fornecedor'
        ELSE 'outros'
      END as tipo_pessoa,
      julianday('now') - julianday(f.vencimento) as dias_atraso
    FROM financeiro f
    WHERE (f.status != 'recebido' AND f.status != 'pago') AND f.vencimento < date('now')
  `;

  const params = [];

  if (dataInicio && dataFim) {
    sql += ' AND f.data_movimento BETWEEN ? AND ?';
    params.push(dataInicio, dataFim);
  }

  sql += ' ORDER BY f.vencimento ASC';

  db.all(sql, params, (err, rows) => {
    if (err) {
      console.error('Erro no relatório inadimplência:', err);
      res.status(500).json({ error: err.message });
      return;
    }

    const inadimplentes = rows.map(row => ({
      id: row.id,
      pessoa: row.pessoa_nome,
      tipo_pessoa: row.tipo_pessoa,
      descricao: row.descricao,
      documento: row.documento,
      valor: parseNumber(row.valor),
      dataEmissao: row.data_movimento,
      dataVencimento: row.vencimento,
      status: row.status,
      dias_atraso: Math.floor(row.dias_atraso),
      tipo: row.tipo
    }));

    const vencidas = inadimplentes.filter(item => item.dias_atraso > 0).length;
    const vencer7dias = inadimplentes.filter(item => item.dias_atraso <= 7 && item.dias_atraso > 0).length;
    const valorAtraso = inadimplentes.reduce((sum, item) => sum + item.valor, 0);

    res.json({
      success: true,
      vencidas: vencidas,
      vencer7dias: vencer7dias,
      valorAtraso: valorAtraso,
      contasAtraso: inadimplentes,
      periodo: { dataInicio, dataFim }
    });
  });
});

// Nova rota para detalhes de conta a pagar com dados da compra
router.get('/contas-pagar/:id/detalhes', (req, res) => {
  const { id } = req.params;

  db.get(`SELECT * FROM financeiro WHERE id = ? AND tipo = 'despesa'`, [id], (err, conta) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!conta) return res.status(404).json({ error: 'Conta a pagar não encontrada.' });

    const compraId = conta.compra_id || conta.referencia_id;

    if (!compraId || conta.origem !== 'compra') {
      return res.json({
        ...conta,
        compra: null,
        itens_compra: []
      });
    }

    db.get(`SELECT * FROM compras WHERE id = ?`, [compraId], (compraErr, compra) => {
      if (compraErr) return res.status(500).json({ error: compraErr.message });

      db.all(`
        SELECT
          ci.*,
          COALESCE(p.nome, ci.descricao_produto) AS produto_nome,
          p.codigo AS produto_codigo
        FROM compras_itens ci
        LEFT JOIN produtos p ON p.id = ci.produto_id
        WHERE ci.compra_id = ?
        ORDER BY ci.id
      `, [compraId], (itensErr, itens) => {
        if (itensErr) return res.status(500).json({ error: itensErr.message });

        res.json({
          ...conta,
          compra: compra || null,
          itens_compra: itens || []
        });
      });
    });
  });
});

router.get('/:id(\\d+)', (req, res) => {
  const { id } = req.params;
  db.get('SELECT * FROM financeiro WHERE id = ?', [id], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (!row) {
      res.status(404).json({ error: 'Movimentação não encontrada' });
      return;
    }
    res.json(row);
  });
});

router.delete('/:id(\\d+)', (req, res) => {
  if (!requireAdminFinanceiro(req, res)) return;

  const { id } = req.params;

  db.get('SELECT * FROM financeiro WHERE id = ?', [id], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }

    if (!row) {
      res.status(404).json({ error: 'Movimentação não encontrada.' });
      return;
    }

    if (row.origem && row.origem !== 'manual') {
      res.status(400).json({
        error: 'Movimentações automáticas devem ser removidas na origem (compra/venda).'
      });
      return;
    }

    db.run('DELETE FROM financeiro WHERE id = ?', [id], function(deleteErr) {
      if (deleteErr) {
        res.status(500).json({ error: deleteErr.message });
        return;
      }

      res.json({
        success: true,
        message: 'Movimentação excluída com sucesso.'
      });
    });
  });
});

module.exports = router;



