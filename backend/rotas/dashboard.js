const express = require('express');
const router = express.Router();
const db = require('../database');
const { listarHistoricoBackups } = require('../services/backupManual');
const { verificarPermissaoEspecifica } = require('./auth');
const {
  FILTRO_VENDA_VALIDA,
  isModoFiscalRelatorio,
  getExprValorVenda,
  getExprValorVendaFiscal,
  getExprValorVendaNaoFiscal,
  getExprQuantidadeItem,
  getFiltroItensFiscal,
  getExprLucroItem,
  sqlRankingProdutos
} = require('../services/reportFiscalHelpers');

function parseNumber(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

function agoraLocalBrasil() {
  const agora = new Date();
  const dataBrasil = new Date(
    agora.toLocaleString('en-US', { timeZone: 'America/Fortaleza' })
  );
  const ano = dataBrasil.getFullYear();
  const mes = String(dataBrasil.getMonth() + 1).padStart(2, '0');
  const dia = String(dataBrasil.getDate()).padStart(2, '0');
  const hora = String(dataBrasil.getHours()).padStart(2, '0');
  const min = String(dataBrasil.getMinutes()).padStart(2, '0');
  const seg = String(dataBrasil.getSeconds()).padStart(2, '0');
  return `${ano}-${mes}-${dia} ${hora}:${min}:${seg}`;
}

function dataHojeBrasil() {
  return agoraLocalBrasil().slice(0, 10);
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || {})));
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function exprEstoqueDashboard(modoFiscal) {
  return isModoFiscalRelatorio(modoFiscal)
    ? 'COALESCE(saldo_fiscal, 0)'
    : 'COALESCE(estoque_atual, 0)';
}

function filtroProdutoFiscalDashboard(modoFiscal) {
  return isModoFiscalRelatorio(modoFiscal)
    ? ' AND COALESCE(item_fiscal, 1) = 1'
    : '';
}

router.get('/resumo', verificarPermissaoEspecifica('relatorios'), async (req, res) => {
  try {
    const hoje = new Date();
    const seteDiasAtras = new Date();
    seteDiasAtras.setDate(hoje.getDate() - 7);

    const dataInicio = req.query.inicio || seteDiasAtras.toISOString().slice(0, 10);
    const dataFim = req.query.fim || hoje.toISOString().slice(0, 10);
    const dataHoje = dataHojeBrasil();
    const modoFiscal = req.query.modo_fiscal || '0';
    const modoFiscalAtivo = isModoFiscalRelatorio(modoFiscal);

    const exprValor = getExprValorVenda(modoFiscal);
    const exprValorFiscal = getExprValorVendaFiscal();
    const exprValorNaoFiscal = getExprValorVendaNaoFiscal();
    const exprQuantidade = getExprQuantidadeItem(modoFiscal);
    const filtroItensFiscal = getFiltroItensFiscal(modoFiscal);
    const exprLucro = getExprLucroItem(modoFiscal);
    const exprEstoque = exprEstoqueDashboard(modoFiscal);
    const filtroProdutoFiscal = filtroProdutoFiscalDashboard(modoFiscal);
    const sqlRanking = sqlRankingProdutos(modoFiscal);

    const [
      resumoPeriodo,
      resumoPeriodoSplit,
      resumoHoje,
      resumoHojeSplit,
      lucroPeriodo,
      lucroHoje,
      produtosVendidos,
      maisVendidos,
      estoqueBaixo,
      contasReceberCr,
      contasReceberFin,
      contasPagar,
      vendasPorForma,
      recebimentosVenda,
      produtosVencidos,
      produtosProximoVencimento
    ] = await Promise.all([
      dbGet(`
        SELECT
          COALESCE(SUM(${exprValor}), 0) AS faturamento,
          COUNT(id) AS total_vendas,
          COALESCE(AVG(${exprValor}), 0) AS ticket_medio
        FROM vendas v
        WHERE date(v.data_venda) BETWEEN date(?) AND date(?)
          AND ${FILTRO_VENDA_VALIDA}
      `, [dataInicio, dataFim]),

      dbGet(`
        SELECT
          COALESCE(SUM(${exprValorFiscal}), 0) AS faturamento_fiscal,
          COALESCE(SUM(${exprValorNaoFiscal}), 0) AS faturamento_nao_fiscal
        FROM vendas v
        WHERE date(v.data_venda) BETWEEN date(?) AND date(?)
          AND ${FILTRO_VENDA_VALIDA}
      `, [dataInicio, dataFim]),

      dbGet(`
        SELECT
          COALESCE(SUM(${exprValor}), 0) AS faturamento_hoje,
          COUNT(id) AS vendas_hoje,
          COALESCE(AVG(${exprValor}), 0) AS ticket_medio_hoje
        FROM vendas v
        WHERE date(v.data_venda) = date(?)
          AND ${FILTRO_VENDA_VALIDA}
      `, [dataHoje]),

      dbGet(`
        SELECT
          COALESCE(SUM(${exprValorFiscal}), 0) AS faturamento_fiscal,
          COALESCE(SUM(${exprValorNaoFiscal}), 0) AS faturamento_nao_fiscal
        FROM vendas v
        WHERE date(v.data_venda) = date(?)
          AND ${FILTRO_VENDA_VALIDA}
      `, [dataHoje]),

      dbGet(`
        SELECT COALESCE(SUM(${exprLucro}), 0) AS lucro_estimado
        FROM vendas_itens vi
        INNER JOIN vendas v ON v.id = vi.venda_id
        INNER JOIN produtos p ON p.id = vi.produto_id
        WHERE date(v.data_venda) BETWEEN date(?) AND date(?)
          AND ${FILTRO_VENDA_VALIDA}
          ${filtroItensFiscal}
      `, [dataInicio, dataFim]),

      dbGet(`
        SELECT COALESCE(SUM(${exprLucro}), 0) AS lucro_estimado
        FROM vendas_itens vi
        INNER JOIN vendas v ON v.id = vi.venda_id
        INNER JOIN produtos p ON p.id = vi.produto_id
        WHERE date(v.data_venda) = date(?)
          AND ${FILTRO_VENDA_VALIDA}
          ${filtroItensFiscal}
      `, [dataHoje]),

      dbGet(`
        SELECT COALESCE(SUM(${exprQuantidade}), 0) AS produtos_vendidos
        FROM vendas_itens vi
        INNER JOIN vendas v ON v.id = vi.venda_id
        WHERE date(v.data_venda) BETWEEN date(?) AND date(?)
          AND ${FILTRO_VENDA_VALIDA}
          ${filtroItensFiscal}
      `, [dataInicio, dataFim]),

      dbAll(`
        ${sqlRanking}
        HAVING quantidade_vendida > 0
        ORDER BY quantidade_vendida DESC
        LIMIT 3
      `, [dataInicio, dataFim]),

      dbAll(`
        SELECT
          id,
          nome,
          ${exprEstoque} AS estoque_atual,
          COALESCE(saldo_fiscal, 0) AS saldo_fiscal,
          COALESCE(saldo_nao_fiscal, 0) AS saldo_nao_fiscal,
          estoque_minimo,
          unidade
        FROM produtos
        WHERE ${exprEstoque} <= estoque_minimo
          ${filtroProdutoFiscal}
        ORDER BY ${exprEstoque} ASC, nome ASC
        LIMIT 10
      `),

      dbGet(`
        SELECT
          COALESCE(SUM(valor_restante), 0) AS total,
          COUNT(*) AS quantidade
        FROM contas_receber
        WHERE status IN ('aberto', 'parcial')
      `),

      dbGet(`
        SELECT
          COALESCE(SUM(valor), 0) AS total,
          COUNT(*) AS quantidade
        FROM financeiro
        WHERE tipo = 'receita'
          AND status NOT IN ('recebido', 'pago', 'cancelado')
      `),

      dbGet(`
        SELECT
          COALESCE(SUM(valor), 0) AS total,
          COUNT(*) AS quantidade
        FROM financeiro
        WHERE tipo = 'despesa'
          AND status NOT IN ('pago', 'recebido', 'cancelado')
      `),

      dbAll(`
        SELECT
          COALESCE(NULLIF(TRIM(LOWER(forma_pagamento)), ''), 'nao_informado') AS forma_pagamento,
          COUNT(*) AS quantidade,
          COALESCE(SUM(${exprValor}), 0) AS total
        FROM vendas v
        WHERE date(v.data_venda) BETWEEN date(?) AND date(?)
          AND ${FILTRO_VENDA_VALIDA}
        GROUP BY COALESCE(NULLIF(TRIM(LOWER(forma_pagamento)), ''), 'nao_informado')
        ORDER BY total DESC
      `, [dataInicio, dataFim]),

      dbAll(`
        SELECT
          vr.tipo_recebimento,
          COALESCE(SUM(vr.valor), 0) AS total,
          COUNT(*) AS quantidade
        FROM venda_recebimentos vr
        INNER JOIN vendas v ON v.id = vr.venda_id
        WHERE date(v.data_venda) BETWEEN date(?) AND date(?)
          AND ${FILTRO_VENDA_VALIDA}
          AND COALESCE(vr.status, 'aprovado') != 'cancelado'
          ${modoFiscalAtivo ? "AND vr.tipo_recebimento = 'fiscal'" : ''}
        GROUP BY vr.tipo_recebimento
      `, [dataInicio, dataFim]),

      dbAll(`
        SELECT id, nome, ${exprEstoque} AS estoque_atual, data_validade
        FROM produtos
        WHERE data_validade IS NOT NULL
          AND data_validade <> ''
          AND ${exprEstoque} > 0
          ${filtroProdutoFiscal}
          AND date(data_validade) < date('now', 'localtime')
        ORDER BY date(data_validade) ASC
        LIMIT 10
      `),

      dbAll(`
        SELECT id, nome, ${exprEstoque} AS estoque_atual, data_validade
        FROM produtos
        WHERE data_validade IS NOT NULL
          AND data_validade <> ''
          AND ${exprEstoque} > 0
          ${filtroProdutoFiscal}
          AND date(data_validade) >= date('now', 'localtime')
          AND date(data_validade) <= date('now', 'localtime', '+30 days')
        ORDER BY date(data_validade) ASC
        LIMIT 10
      `)
    ]);

    const auditoriaUltimos7 = await dbGet(
      `SELECT COUNT(*) AS total FROM auditoria WHERE date(criado_em) >= date(?)`,
      [seteDiasAtras.toISOString().slice(0, 10)]
    );

    let historicoBackups = [];
    try {
      historicoBackups = listarHistoricoBackups(null, 1000);
    } catch (e) {
      console.error('Erro ao listar backups no dashboard:', e);
      historicoBackups = [];
    }

    const delecoes24 = await dbGet(`
      SELECT COUNT(*) AS total FROM auditoria
      WHERE date(criado_em) >= date('now','-1 day')
      AND (
        acao LIKE '%excluir%' OR acao LIKE '%delete%' OR acao LIKE '%remover%' OR acao LIKE '%cancel%'
      )
    `);

    const usuariosAltamenteAtivos = await dbAll(`
      SELECT usuario_nome, COUNT(*) AS total FROM auditoria
      WHERE datetime(criado_em) >= datetime('now','localtime','-1 hour')
      GROUP BY usuario_nome
      HAVING total > ?
      ORDER BY total DESC
    `, [20]);

    let ultimoBackupHoras = null;
    if (historicoBackups.length > 0) {
      try {
        const iso = historicoBackups[0].modificado_em;
        const diffMs = new Date() - new Date(iso);
        ultimoBackupHoras = Math.floor(diffMs / (1000 * 60 * 60));
      } catch (e) {
        ultimoBackupHoras = null;
      }
    }

    const alertaBackupAtrasado = ultimoBackupHoras !== null && ultimoBackupHoras > 24;

    try {
      if (parseNumber(delecoes24.total) > 0) {
        const existente = await dbGet(
          `SELECT id FROM auditoria_alertas WHERE tipo = ? AND resolvido = 0 LIMIT 1`,
          ['delecoes_24h']
        );
        if (!existente || !existente.id) {
          db.run(
            `INSERT INTO auditoria_alertas (tipo, descricao, dados) VALUES (?, ?, ?)`,
            ['delecoes_24h', 'Deleções detectadas nas últimas 24 horas', JSON.stringify({ quantidade: delecoes24.total })]
          );
        }
      }

      if (alertaBackupAtrasado) {
        const existenteB = await dbGet(
          `SELECT id FROM auditoria_alertas WHERE tipo = ? AND resolvido = 0 LIMIT 1`,
          ['backup_atrasado']
        );
        if (!existenteB || !existenteB.id) {
          db.run(
            `INSERT INTO auditoria_alertas (tipo, descricao, dados) VALUES (?, ?, ?)`,
            ['backup_atrasado', 'Último backup com mais de 24 horas', JSON.stringify({ horas: ultimoBackupHoras })]
          );
        }
      }
    } catch (e) {
      console.error('Erro ao persistir alertas:', e);
    }

    const alertasNaoResolvidos = await dbAll(
      `SELECT id, tipo, descricao, dados, criado_em FROM auditoria_alertas WHERE resolvido = 0 ORDER BY criado_em DESC LIMIT 50`
    );

    const idsMais = maisVendidos.map((p) => p.id);
    const filtroExcluirMais = idsMais.length
      ? `AND p.id NOT IN (${idsMais.map(() => '?').join(',')})`
      : '';
    const menosVendidos = await dbAll(`
      ${sqlRanking}
      HAVING quantidade_vendida > 0 ${idsMais.length ? `AND p.id NOT IN (${idsMais.map(() => '?').join(',')})` : ''}
      ORDER BY quantidade_vendida ASC, p.nome ASC
      LIMIT 3
    `, [dataInicio, dataFim, ...idsMais]);

    const totalReceberCr = parseNumber(contasReceberCr.total);
    const totalReceberFin = parseNumber(contasReceberFin.total);
    const qtdReceberCr = parseNumber(contasReceberCr.quantidade);
    const qtdReceberFin = parseNumber(contasReceberFin.quantidade);

    const faturamentoFiscalPeriodo = parseNumber(resumoPeriodoSplit.faturamento_fiscal);
    const faturamentoNaoFiscalPeriodo = parseNumber(resumoPeriodoSplit.faturamento_nao_fiscal);
    const faturamentoFiscalHoje = parseNumber(resumoHojeSplit.faturamento_fiscal);
    const faturamentoNaoFiscalHoje = parseNumber(resumoHojeSplit.faturamento_nao_fiscal);

    const recebimentosMap = (recebimentosVenda || []).reduce((acc, row) => {
      acc[row.tipo_recebimento || 'fiscal'] = {
        total: parseNumber(row.total),
        quantidade: parseNumber(row.quantidade)
      };
      return acc;
    }, {});

    res.json({
      periodo: {
        inicio: dataInicio,
        fim: dataFim
      },
      data_hoje: dataHoje,
      modo_fiscal_ativo: modoFiscalAtivo,

      faturamento: parseNumber(resumoPeriodo.faturamento),
      faturamento_fiscal: faturamentoFiscalPeriodo,
      faturamento_nao_fiscal: faturamentoNaoFiscalPeriodo,
      total_vendas: parseNumber(resumoPeriodo.total_vendas),
      ticket_medio: parseNumber(resumoPeriodo.ticket_medio),
      produtos_vendidos: parseNumber(produtosVendidos.produtos_vendidos),
      lucro_estimado: parseNumber(lucroPeriodo.lucro_estimado),

      vendas_hoje: parseNumber(resumoHoje.vendas_hoje),
      faturamento_hoje: parseNumber(resumoHoje.faturamento_hoje),
      faturamento_hoje_fiscal: faturamentoFiscalHoje,
      faturamento_hoje_nao_fiscal: faturamentoNaoFiscalHoje,
      ticket_medio_hoje: parseNumber(resumoHoje.ticket_medio_hoje),
      lucro_estimado_hoje: parseNumber(lucroHoje.lucro_estimado),

      mais_vendidos: maisVendidos,
      menos_vendidos: menosVendidos,
      produtos_mais_vendidos: maisVendidos,
      produtos_menos_vendidos: menosVendidos,

      estoque_baixo: estoqueBaixo.map((p) => ({
        id: p.id,
        nome: p.nome,
        estoque_atual: parseNumber(p.estoque_atual),
        saldo_fiscal: parseNumber(p.saldo_fiscal),
        saldo_nao_fiscal: parseNumber(p.saldo_nao_fiscal),
        estoque_minimo: parseNumber(p.estoque_minimo),
        unidade: p.unidade || ''
      })),

      contas_receber: {
        total: totalReceberCr + totalReceberFin,
        quantidade: qtdReceberCr + qtdReceberFin,
        parcelas_clientes: {
          total: totalReceberCr,
          quantidade: qtdReceberCr
        },
        financeiro: {
          total: totalReceberFin,
          quantidade: qtdReceberFin
        }
      },
      contas_pagar: {
        total: parseNumber(contasPagar.total),
        quantidade: parseNumber(contasPagar.quantidade)
      },

      recebimentos_venda: {
        fiscal: recebimentosMap.fiscal || { total: 0, quantidade: 0 },
        nao_fiscal: recebimentosMap.nao_fiscal || { total: 0, quantidade: 0 }
      },

      vendas_por_forma_pagamento: vendasPorForma.map((row) => ({
        forma_pagamento: row.forma_pagamento,
        quantidade: parseNumber(row.quantidade),
        total: parseNumber(row.total)
      })),

      produtos_vencidos: produtosVencidos,
      produtos_proximo_vencimento: produtosProximoVencimento,
      auditoria: {
        ultimos_7_dias: parseNumber(auditoriaUltimos7.total)
      },
      backups: {
        total: historicoBackups.length,
        recentes: historicoBackups.slice(0, 10)
      },
      alerts: {
        delecoes_24h: parseNumber(delecoes24.total),
        usuarios_ativos_ultima_hora: usuariosAltamenteAtivos,
        ultimo_backup_horas: ultimoBackupHoras,
        backup_atrasado: !!alertaBackupAtrasado,
        persistentes: alertasNaoResolvidos
      }
    });
  } catch (err) {
    console.error('Erro no dashboard /resumo:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
