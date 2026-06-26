
const express = require('express');
const router = express.Router();
const db = require('../database');
const { gravarAuditoria } = require('../services/auditoria');
const { verificarPermissaoEspecifica, exigirPerfilAjusteEstoque } = require('./auth');
const lotesService = require('../services/lotesService');
const { recalcularEstoqueConsolidado, recalcularSaldosProduto } = require('../services/estoqueFiscalService');
const {
  produtoTemMovimentacoes,
  aplicarAjusteEstoqueProduto,
  definirSaldosIniciaisProduto
} = require('../services/ajusteEstoqueService');
const { sqlRankingProdutos, isModoFiscalRelatorio } = require('../services/reportFiscalHelpers');

function resolverItemFiscalCadastro(body, saldoFiscal, saldoNaoFiscal) {
  if (body.item_fiscal !== undefined && body.item_fiscal !== null) {
    return Number(body.item_fiscal) === 1 ? 1 : 0;
  }
  if (Number(saldoNaoFiscal) > 0 && Number(saldoFiscal) === 0) {
    return 0;
  }
  return 1;
}

function isModoFiscalQuery(valor) {
  return valor === '1' || valor === true || valor === 'true';
}

function filtroSqlModoFiscalProduto(modoFiscal, alias = 'p') {
  if (!modoFiscal) {
    return '';
  }
  return ` AND COALESCE(${alias}.item_fiscal, 1) = 1`;
}

function exprEstoqueAlerta(modoFiscal, alias = '') {
  const prefixo = alias ? `${alias}.` : '';
  return modoFiscal
    ? `COALESCE(${prefixo}saldo_fiscal, 0)`
    : `COALESCE(${prefixo}estoque_atual, 0)`;
}

const { resolverCustoUnitarioProdutoCadastro } = require('../lib/motorConversaoUnidades');

function normalizarProdutoResposta(produto, modoFiscal) {
  const saldoFiscal = Number(produto.saldo_fiscal ?? 0);
  const saldoNaoFiscal = Number(produto.saldo_nao_fiscal ?? 0);
  const estoqueAtual = saldoFiscal + saldoNaoFiscal;
  const flagFracionado = Number(produto.produto_fracionado ?? produto.vendido_por_peso ?? 0) ? 1 : 0;
  const precoCompra = flagFracionado
    ? resolverCustoUnitarioProdutoCadastro(produto)
    : Number(produto.preco_compra || 0);

  const base = {
    ...produto,
    produto_fracionado: flagFracionado,
    preco_compra: precoCompra,
    saldo_fiscal: saldoFiscal,
    saldo_nao_fiscal: saldoNaoFiscal,
    estoque_atual: estoqueAtual,
    valor_estoque: Number((estoqueAtual * precoCompra).toFixed(2))
  };

  if (modoFiscal) {
    return {
      ...base,
      estoque_exibido: saldoFiscal,
      valor_estoque: Number((saldoFiscal * precoCompra).toFixed(2))
    };
  }

  return {
    ...base,
    estoque_exibido: estoqueAtual
  };
}

function produtosTemColuna(nomeColuna, callback) {
  db.all(`PRAGMA table_info(produtos)`, [], (err, cols) => {
    if (err) return callback(err, false);
    callback(null, (cols || []).some((col) => col.name === nomeColuna));
  });
}

function resolverFlagProdutoFracionado(body = {}) {
  if (body.produto_fracionado !== undefined || body.vendido_por_peso !== undefined) {
    return Number(body.produto_fracionado ?? body.vendido_por_peso ?? 0) ? 1 : 0;
  }
  return undefined;
}

const CAMPOS_PRODUTO_IGNORADOS = new Set([
  'id',
  'created_at',
  'updated_at',
  'lote_inicial',
  'data_fabricacao_inicial',
  'data_validade_inicial',
  'atacado_faixas',
  'categoria',
  'subcategoria',
  'categoria_nome',
  'subcategoria_nome',
  'preco_atacado',
  'quantidade_minima_atacado',
  'dias_para_vencer',
  'status_validade',
  'message',
  'data_validade',
  'lote',
  'dias_alerta_validade',
  'estoque_atual',
  'saldo_fiscal',
  'saldo_nao_fiscal',
  'estoque_exibido',
  'saldo_fiscal_inicial',
  'saldo_nao_fiscal_inicial'
]);

function inserirFaixasAtacadoProduto(produtoId, faixas, callback) {
  const lista = Array.isArray(faixas) ? faixas : [];
  if (!lista.length) {
    return callback(null);
  }

  let indice = 0;

  function inserirProxima() {
    if (indice >= lista.length) {
      return callback(null);
    }

    const faixa = lista[indice];
    indice += 1;

    const quantidadeMinima = parseInt(faixa?.quantidade_minima, 10);
    const precoAtacado = parseFloat(faixa?.preco_atacado);

    if (!Number.isInteger(quantidadeMinima) || quantidadeMinima <= 0) {
      return inserirProxima();
    }

    if (Number.isNaN(precoAtacado) || precoAtacado <= 0) {
      return inserirProxima();
    }

    db.run(
      `INSERT INTO produto_atacado (produto_id, quantidade_minima, preco_atacado) VALUES (?, ?, ?)`,
      [produtoId, quantidadeMinima, precoAtacado],
      (err) => {
        if (err) {
          return callback(err);
        }
        inserirProxima();
      }
    );
  }

  inserirProxima();
}

function buscarProdutoCompleto(produtoId, callback) {
  db.get(`
    SELECT 
      p.*, 
      (SELECT preco_atacado FROM produto_atacado WHERE produto_id = p.id ORDER BY quantidade_minima ASC LIMIT 1) AS preco_atacado,
      (SELECT quantidade_minima FROM produto_atacado WHERE produto_id = p.id ORDER BY quantidade_minima ASC LIMIT 1) AS quantidade_minima_atacado,
      c.nome AS categoria_nome,
      s.nome AS subcategoria_nome
    FROM produtos p
    LEFT JOIN categorias c ON c.id = p.categoria_id
    LEFT JOIN subcategorias s ON s.id = p.subcategoria_id
    WHERE p.id = ?
  `, [produtoId], (err, row) => {
    if (err) {
      return callback(err);
    }

    if (!row) {
      return callback(null, null);
    }

    db.all(
      `SELECT * FROM produto_atacado WHERE produto_id = ? ORDER BY quantidade_minima ASC`,
      [produtoId],
      (faixaErr, faixas) => {
        if (faixaErr) {
          return callback(faixaErr);
        }

        callback(null, {
          ...row,
          categoria: row.categoria_nome || '',
          subcategoria: row.subcategoria_nome || '',
          atacado_faixas: faixas || []
        });
      }
    );
  });
}


// LISTAR PRODUTOS
router.get('/', (req, res) => {
  const modoFiscal = isModoFiscalQuery(req.query.modo_fiscal);
  const filtroFiscal = filtroSqlModoFiscalProduto(modoFiscal, 'p');

  db.all(`
    SELECT 
      p.*, 
      (SELECT preco_atacado FROM produto_atacado WHERE produto_id = p.id ORDER BY quantidade_minima ASC LIMIT 1) AS preco_atacado,
      (SELECT quantidade_minima FROM produto_atacado WHERE produto_id = p.id ORDER BY quantidade_minima ASC LIMIT 1) AS quantidade_minima_atacado,
      c.nome AS categoria_nome,
      s.nome AS subcategoria_nome,
      CAST(julianday(date(p.data_validade)) - julianday(date('now', 'localtime')) AS INTEGER) AS dias_para_vencer,
      CASE
        WHEN COALESCE(p.controlar_validade, 0) != 1 OR p.data_validade IS NULL OR p.data_validade = '' THEN NULL
        WHEN date(p.data_validade) < date('now', 'localtime') THEN 'vencido'
        WHEN date(p.data_validade) <= date('now', 'localtime', '+' || COALESCE(p.dias_alerta_validade, 30) || ' days') THEN 'proximo'
        ELSE 'ok'
      END AS status_validade
    FROM produtos p
    LEFT JOIN categorias c ON c.id = p.categoria_id
    LEFT JOIN subcategorias s ON s.id = p.subcategoria_id
    WHERE 1=1
      ${filtroFiscal}
    ORDER BY p.id DESC
  `, [], (err, rows) => {
    if (err) {
      console.error('Erro ao listar produtos:', err.message);
      return res.status(500).json({ error: err.message });
    }

    const produtos = (rows || []).map((p) => normalizarProdutoResposta({
      ...p,
      categoria: p.categoria_nome || p.categoria || '',
      subcategoria: p.subcategoria_nome || ''
    }, modoFiscal));

    res.json(produtos);
  });
});

// Buscar produto por código
router.get('/codigo/:codigo', (req, res) => {
  const { codigo } = req.params;
  db.get('SELECT * FROM produtos WHERE codigo = ?', [codigo], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(row);
  });
});


// Histórico de preços do produto
router.get('/:id/historico-precos', (req, res) => {
  const { id } = req.params;
  db.all(`
    SELECT * FROM produtos_preco_historico
    WHERE produto_id = ?
    ORDER BY created_at DESC
  `, [id], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

// Histórico de ajustes de estoque do produto
router.get('/:id/historico-estoque', (req, res) => {
  const { id } = req.params;
  db.all(`
    SELECT *
    FROM produtos_ajustes_estoque
    WHERE produto_id = ?
    ORDER BY criado_em DESC, id DESC
  `, [id], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows || []);
  });
});

// Relatório de estoque de produtos com data de compra
router.get('/relatorio-estoque', (req, res) => {
  const { inicio, fim } = req.query;
  const modoFiscal = isModoFiscalQuery(req.query.modo_fiscal);
  const filtroFiscal = filtroSqlModoFiscalProduto(modoFiscal, 'p');

  const filtrosSubconsulta = [];
  const paramsSubconsulta = [];
  const filtrosExists = [];
  const paramsExists = [];

  if (inicio) {
    filtrosSubconsulta.push('c2.data_compra >= ?');
    paramsSubconsulta.push(inicio);

    filtrosExists.push('c3.data_compra >= ?');
    paramsExists.push(inicio);
  }

  if (fim) {
    filtrosSubconsulta.push('c2.data_compra <= ?');
    paramsSubconsulta.push(fim);

    filtrosExists.push('c3.data_compra <= ?');
    paramsExists.push(fim);
  }

  const andExists = filtrosExists.length
    ? `
      AND EXISTS (
        SELECT 1
        FROM compras c3
        INNER JOIN compras_itens ci3 ON ci3.compra_id = c3.id
        WHERE ci3.produto_id = p.id
          AND ${filtrosExists.join(' AND ')}
      )
    `
    : '';

  const filtrosUltimaCompra = filtrosSubconsulta.length
    ? ` AND ${filtrosSubconsulta.join(' AND ')}`
    : '';

  const sql = `
    SELECT
      p.*,
      c.nome AS categoria_nome,
      s.nome AS subcategoria_nome,
      (
        SELECT MAX(c2.data_compra)
        FROM compras c2
        INNER JOIN compras_itens ci2 ON ci2.compra_id = c2.id
        WHERE ci2.produto_id = p.id
        ${filtrosUltimaCompra}
      ) AS ultima_compra_data,
      CAST(julianday(date(p.data_validade)) - julianday(date('now', 'localtime')) AS INTEGER) AS dias_para_vencer,
      CASE
        WHEN COALESCE(p.controlar_validade, 0) != 1 OR p.data_validade IS NULL OR p.data_validade = '' THEN NULL
        WHEN date(p.data_validade) < date('now', 'localtime') THEN 'vencido'
        WHEN date(p.data_validade) <= date('now', 'localtime', '+' || COALESCE(p.dias_alerta_validade, 30) || ' days') THEN 'proximo'
        ELSE 'ok'
      END AS status_validade
    FROM produtos p
    LEFT JOIN categorias c ON c.id = p.categoria_id
    LEFT JOIN subcategorias s ON s.id = p.subcategoria_id
    WHERE 1=1
      ${filtroFiscal}
      ${andExists}
    ORDER BY p.nome ASC
  `;

  const params = [...paramsSubconsulta, ...paramsExists];

  db.all(sql, params, (err, rows) => {
    if (err) {
      console.error('Erro ao gerar relatório de estoque:', err.message);
      return res.status(500).json({ error: err.message });
    }

    const produtos = (rows || []).map((p) => normalizarProdutoResposta({
      ...p,
      categoria: p.categoria_nome || p.categoria || '',
      subcategoria: p.subcategoria_nome || p.subcategoria || '',
      ultima_compra_data: p.ultima_compra_data || null
    }, modoFiscal));

    res.json(produtos);
  });
});

// CONSULTA DE PRODUTOS NO PDV - F1
router.get('/consulta-pdv/buscar', (req, res) => {
  const termo = String(req.query.q || '').trim();
  const modoFiscal = isModoFiscalQuery(req.query.modo_fiscal);
  const filtroFiscal = filtroSqlModoFiscalProduto(modoFiscal, 'p');

  if (!termo) {
    return res.json([]);
  }
  // Normalizar termo (remover acentos) para busca sem acento
  function removeDiacritics(str) {
    if (!str) return '';
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  const termoNormalized = removeDiacritics(termo.toLowerCase());
  const buscaLike = `%${termo}%`;
  const buscaLikeNormalized = `%${termoNormalized}%`;
  const buscaNumero = termo.replace(/\D/g, '') || termo;
  const hoje = new Date().toISOString().split('T')[0];
  // Construir cadeia de REPLACE para remover acentos no campo p.nome dentro do SQL
  const replacements = {
    'á':'a','à':'a','â':'a','ã':'a','ä':'a',
    'é':'e','è':'e','ê':'e','ë':'e',
    'í':'i','ì':'i','î':'i','ï':'i',
    'ó':'o','ò':'o','ô':'o','õ':'o','ö':'o',
    'ú':'u','ù':'u','û':'u','ü':'u',
    'ç':'c','ñ':'n'
  };

  const replaceChain = Object.keys(replacements).reduce((acc, ch) => {
    const to = replacements[ch];
    return `REPLACE(${acc}, '${ch}', '${to}')`;
  }, 'LOWER(p.nome)');

  db.all(`
    SELECT
      p.id,
      p.codigo,
      p.codigo_barras,
      p.nome,
      p.unidade,
      p.preco_venda,
      (SELECT preco_atacado FROM produto_atacado WHERE produto_id = p.id ORDER BY quantidade_minima ASC LIMIT 1) AS preco_atacado,
      (SELECT quantidade_minima FROM produto_atacado WHERE produto_id = p.id ORDER BY quantidade_minima ASC LIMIT 1) AS quantidade_minima_atacado,
      p.estoque_atual,
      COALESCE(p.saldo_fiscal, 0) AS saldo_fiscal,
      COALESCE(p.saldo_nao_fiscal, 0) AS saldo_nao_fiscal,
      COALESCE(p.item_fiscal, 1) AS item_fiscal,
      p.estoque_minimo,
      p.vendido_por_peso,
      COALESCE(p.produto_fracionado, p.vendido_por_peso, 0) AS produto_fracionado,
      CASE 
        WHEN promo.id IS NOT NULL THEN 1 
        ELSE 0 
      END AS tem_promocao,
      CASE 
        WHEN promo.id IS NOT NULL THEN promo.preco_promocional 
        ELSE NULL 
      END AS preco_promocional,
      CASE 
        WHEN promo.id IS NOT NULL THEN promo.desconto_percentual 
        ELSE NULL 
      END AS desconto_percentual
    FROM produtos p
    LEFT JOIN promocoes promo ON promo.produto_id = p.id 
      AND promo.status = 'ativa'
      AND date(promo.data_inicio) <= date(?)
      AND date(promo.data_fim) >= date(?)
    WHERE
      (
        CAST(p.id AS TEXT) = ?
        OR p.codigo LIKE ?
        OR p.codigo_barras LIKE ?
        OR (${replaceChain}) LIKE ?
      )
      ${filtroFiscal}
    ORDER BY p.nome ASC
    LIMIT 30
  `, [
    hoje,
    hoje,
    buscaNumero,
    buscaLike,
    buscaLike,
    buscaLikeNormalized
  ], (err, rows) => {
    if (err) {
      console.error('Erro na consulta de produtos PDV:', err.message);
      return res.status(500).json({ error: err.message });
    }

    res.json((rows || []).map((row) => normalizarProdutoResposta(row, modoFiscal)));
  });
});

router.get('/ranking-vendas', (req, res) => {
  const hoje = new Date();
  const seteDiasAtras = new Date();
  seteDiasAtras.setDate(hoje.getDate() - 7);

  const dataInicio = req.query.inicio || seteDiasAtras.toISOString().slice(0, 10);
  const dataFim = req.query.fim || hoje.toISOString().slice(0, 10);
  const modoFiscal = isModoFiscalRelatorio(req.query.modo_fiscal);

  const sqlBase = sqlRankingProdutos(modoFiscal);

  db.all(`
    ${sqlBase}
    HAVING quantidade_vendida > 0
    ORDER BY quantidade_vendida DESC
    LIMIT 3
  `, [dataInicio, dataFim], (errMais, maisVendidos) => {
    if (errMais) {
      return res.status(500).json({ error: errMais.message });
    }

    db.all(`
      ${sqlBase}
      HAVING quantidade_vendida > 0
      ORDER BY quantidade_vendida ASC
      LIMIT 3
    `, [dataInicio, dataFim], (errMenos, menosVendidos) => {
      if (errMenos) {
        return res.status(500).json({ error: errMenos.message });
      }

      res.json({
        periodo: {
          inicio: dataInicio,
          fim: dataFim
        },
        mais_vendidos: maisVendidos || [],
        menos_vendidos: menosVendidos || []
      });
    });
  });
});

// Acompanhamento de vencimentos de produtos
router.get('/vencimentos/alertas', (req, res) => {
  const diasPadrao = Math.max(parseInt(req.query.dias || '30', 10) || 30, 0);
  const modoFiscal = isModoFiscalQuery(req.query.modo_fiscal);
  const exprEstoque = exprEstoqueAlerta(modoFiscal);
  const filtroFiscal = modoFiscal ? ' AND COALESCE(item_fiscal, 1) = 1' : '';

  db.all(`
    SELECT
      id,
      codigo,
      codigo_barras,
      nome,
      unidade,
      estoque_atual,
      COALESCE(saldo_fiscal, 0) AS saldo_fiscal,
      COALESCE(saldo_nao_fiscal, 0) AS saldo_nao_fiscal,
      fornecedor,
      lote,
      data_validade,
      controlar_validade,
      COALESCE(dias_alerta_validade, ?) AS dias_alerta_validade,
      CAST(julianday(date(data_validade)) - julianday(date('now', 'localtime')) AS INTEGER) AS dias_para_vencer,
      CASE
        WHEN date(data_validade) < date('now', 'localtime') THEN 'vencido'
        WHEN date(data_validade) <= date('now', 'localtime', '+' || COALESCE(dias_alerta_validade, ?) || ' days') THEN 'proximo'
        ELSE 'ok'
      END AS status_validade
    FROM produtos
    WHERE COALESCE(controlar_validade, 0) = 1
      AND data_validade IS NOT NULL
      AND data_validade != ''
      AND ${exprEstoque} > 0
      ${filtroFiscal}
      AND date(data_validade) <= date('now', 'localtime', '+' || COALESCE(dias_alerta_validade, ?) || ' days')
    ORDER BY date(data_validade) ASC, nome ASC
  `, [diasPadrao, diasPadrao, diasPadrao], (err, rows) => {
    if (err) {
      console.error('Erro ao buscar vencimentos de produtos:', err.message);
      return res.status(500).json({ error: err.message });
    }

    const lista = (rows || []).map((row) => normalizarProdutoResposta(row, modoFiscal));

    res.json({
      dias_padrao: diasPadrao,
      total: lista.length,
      vencidos: lista.filter(p => p.status_validade === 'vencido').length,
      proximos: lista.filter(p => p.status_validade === 'proximo').length,
      produtos: lista
    });
  });
});

// ============================================
// ENDPOINTS DE PROMOÇÕES INTELIGENTES
// ============================================

// Obter sugestões de promoções
router.get('/promocoes/sugestoes', (req, res) => {
  const descontoPercentual = Number(req.query.desconto_percentual) || 15;

  revalidarSugestoesPendentes(descontoPercentual, (revalErr) => {
    if (revalErr) {
      console.error('Erro na revalidação ao listar sugestões:', revalErr.message);
    }
    listarSugestoesPromocoes(res);
  });
});

// Obter sugestões com contagem para o card e estatísticas de promoções
router.get('/promocoes/dashboard', (req, res) => {
  db.serialize(() => {
    // Sugestões pendentes
    db.get(`
      SELECT COUNT(*) as total
      FROM promocoes_sugestoes
      WHERE ativo = 1 AND aceito_em IS NULL AND rejeitado_em IS NULL
    `, (err, sugestoes) => {
      if (err) {
        console.error('Erro ao contar sugestões:', err.message);
        return res.status(500).json({ error: err.message });
      }

      // Promoções ativas (realmente vigentes: iniciadas e não expiradas)
      db.get(`
        SELECT COUNT(*) as total
        FROM promocoes
        WHERE status = 'ativa' AND date(data_inicio) <= date('now') AND date(data_fim) > date('now')
      `, (err2, ativas) => {
        if (err2) {
          console.error('Erro ao contar promoções ativas:', err2.message);
          return res.status(500).json({ error: err2.message });
        }

        // Promoções encerradas (manualmente OU expiradas)
        db.get(`
          SELECT COUNT(*) as total
          FROM promocoes
          WHERE status = 'encerrada' OR (status = 'ativa' AND date(data_fim) <= date('now'))
        `, (err3, encerradas) => {
          if (err3) {
            console.error('Erro ao contar promoções encerradas:', err3.message);
            return res.status(500).json({ error: err3.message });
          }

          // Total de promoções criadas
          db.get(`
            SELECT COUNT(*) as total
            FROM promocoes
          `, (err4, criadas) => {
            if (err4) {
              console.error('Erro ao contar promoções criadas:', err4.message);
              return res.status(500).json({ error: err4.message });
            }

            // Produtos salvos do vencimento
            db.get(`
              SELECT COUNT(DISTINCT produto_id) as total
              FROM promocoes_sugestoes
              WHERE aceito_em IS NOT NULL
            `, (err5, salvos) => {
              if (err5) {
                console.error('Erro ao contar produtos salvos:', err5.message);
                return res.status(500).json({ error: err5.message });
              }

              // Receita gerada por promoções
              db.get(`
                SELECT COALESCE(SUM(quantidade * preco_unitario), 0) as total
                FROM vendas_itens
                WHERE promocao_id IS NOT NULL
              `, (err6, receita) => {
                if (err6) {
                  console.error('Erro ao calcular receita de promoções:', err6.message);
                  return res.status(500).json({ error: err6.message });
                }

                // Perdas evitadas por promoções
                db.get(`
                  SELECT COALESCE(SUM(
                    MAX(0, COALESCE(p.preco_original, vi.preco_unitario) - vi.preco_unitario)
                    * vi.quantidade
                  ), 0) as total
                  FROM vendas_itens vi
                  LEFT JOIN promocoes p ON p.id = vi.promocao_id
                  WHERE vi.promocao_id IS NOT NULL
                `, (err7, perdas) => {
                  if (err7) {
                    console.error('Erro ao calcular perdas evitadas:', err7.message);
                    return res.status(500).json({ error: err7.message });
                  }

                  res.json({
                    sugestoes_pendentes: sugestoes?.total || 0,
                    promocoes_ativas: ativas?.total || 0,
                    promocoes_encerradas: encerradas?.total || 0,
                    promocoes_criadas: criadas?.total || 0,
                    produtos_salvos_vencimento: salvos?.total || 0,
                    receita_gerada: receita?.total || 0,
                    perdas_evitadas: perdas?.total || 0
                  });
                });
              });
            });
          });
        });
      });
    });
  });
});

// Obter promoções (ativas e encerradas)
router.get('/promocoes', (req, res) => {
  const { status } = req.query;
  
  let query = `
    SELECT 
      p.*,
      pr.nome AS nome_produto,
      pr.codigo,
      pr.preco_venda,
      CASE 
        WHEN date(p.data_fim) < date('now') THEN 'expirada'
        WHEN date(p.data_inicio) > date('now') THEN 'nao_iniciada'
        WHEN p.status = 'ativa' THEN 'vigente'
        ELSE p.status
      END AS status_real
    FROM promocoes p
    LEFT JOIN produtos pr ON pr.id = p.produto_id
  `;

  const params = [];

  if (status === 'ativas') {
    // Mostra apenas promoções que estão realmente vigentes (iniciadas e não expiradas)
    query += ` WHERE p.status = 'ativa' AND date(p.data_inicio) <= date('now') AND date(p.data_fim) > date('now')`;
  } else if (status === 'encerradas') {
    // Mostra promoções encerradas manualmente OU expiradas
    query += ` WHERE p.status = 'encerrada' OR (p.status = 'ativa' AND date(p.data_fim) <= date('now'))`;
  }

  query += ` ORDER BY p.criado_em DESC`;

  db.all(query, params, (err, rows) => {
    if (err) {
      console.error('Erro ao listar promoções:', err.message);
      return res.status(500).json({ error: err.message });
    }
    res.json(rows || []);
  });
});

// Aceitar ou rejeitar sugestão
router.post('/promocoes/sugestoes/:id/processar', (req, res) => {
  const { id } = req.params;
  const { acao } = req.body; // 'aceitar' ou 'rejeitar'

  if (!['aceitar', 'rejeitar'].includes(acao)) {
    return res.status(400).json({ error: 'Ação inválida' });
  }

  const campoData = acao === 'aceitar' ? 'aceito_em' : 'rejeitado_em';

  db.run(`
    UPDATE promocoes_sugestoes
    SET ${campoData} = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [id], function(err) {
    if (err) {
      console.error(`Erro ao ${acao} sugestão:`, err.message);
      return res.status(500).json({ error: err.message });
    }

    res.json({ 
      success: true, 
      message: `Sugestão ${acao === 'aceitar' ? 'aceita' : 'rejeitada'} com sucesso` 
    });
  });
});

// Criar promoção
router.post('/promocoes', (req, res) => {
  const { 
    produto_id, 
    preco_original, 
    preco_promocional, 
    data_inicio, 
    data_fim 
  } = req.body;

  if (!produto_id || !preco_promocional || !data_inicio || !data_fim) {
    return res.status(400).json({ error: 'Campos obrigatórios: produto_id, preco_promocional, data_inicio, data_fim' });
  }

  const desconto_percentual = preco_original 
    ? ((preco_original - preco_promocional) / preco_original * 100).toFixed(2)
    : 0;

  db.run(`
    INSERT INTO promocoes (
      produto_id, 
      preco_original, 
      preco_promocional, 
      desconto_percentual, 
      data_inicio, 
      data_fim, 
      status
    ) VALUES (?, ?, ?, ?, ?, ?, 'ativa')
  `, [produto_id, preco_original, preco_promocional, desconto_percentual, data_inicio, data_fim], function(err) {
    if (err) {
      console.error('Erro ao criar promoção:', err.message);
      return res.status(500).json({ error: err.message });
    }

    res.status(201).json({ 
      id: this.lastID, 
      message: 'Promoção criada com sucesso' 
    });
  });
});

// Encerrar promoção
router.put('/promocoes/:id/encerrar', (req, res) => {
  const { id } = req.params;
  const { motivo_encerramento } = req.body;

  db.run(`
    UPDATE promocoes
    SET status = 'encerrada', 
        encerrado_em = CURRENT_TIMESTAMP,
        motivo_encerramento = ?
    WHERE id = ?
  `, [motivo_encerramento || '', id], function(err) {
    if (err) {
      console.error('Erro ao encerrar promoção:', err.message);
      return res.status(500).json({ error: err.message });
    }

    res.json({ 
      success: true, 
      message: 'Promoção encerrada com sucesso' 
    });
  });
});

// Gerar sugestões de promoções automaticamente
function produtoControlaValidade(produto) {
  return Number(produto?.controlar_validade) === 1;
}

function ehTipoValidade(tipo) {
  return ['vencido', 'vence_hoje', 'vence_3', 'vence_7'].includes(tipo);
}

function classificarProduto(produto) {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  let sugestao = null;

  if (
    produtoControlaValidade(produto) &&
    produto.data_validade &&
    produto.data_validade !== '0000-00-00'
  ) {
    const validade = new Date(produto.data_validade);
    validade.setHours(0, 0, 0, 0);

    const dias = Math.floor((validade - hoje) / 86400000);

    if (dias < 0) {
      sugestao = {
        tipo: 'vencido',
        texto: '🔴 Produto Vencido',
        prioridade: 100
      };
    } else if (dias === 0) {
      sugestao = {
        tipo: 'vence_hoje',
        texto: '🔴 Vence Hoje',
        prioridade: 90
      };
    } else if (dias <= 3) {
      sugestao = {
        tipo: 'vence_3',
        texto: '🔴 Vence em até 3 dias',
        prioridade: 80
      };
    } else if (dias <= 7) {
      sugestao = {
        tipo: 'vence_7',
        texto: '🟠 Vence em até 7 dias',
        prioridade: 70
      };
    }
  }

  if (!sugestao) {
    if (produto.ultima_venda) {
      const ultimaVenda = new Date(produto.ultima_venda);
      ultimaVenda.setHours(0, 0, 0, 0);

      const diasSemVenda = Math.floor((hoje - ultimaVenda) / 86400000);

      if (diasSemVenda >= 60) {
        sugestao = {
          tipo: 'encalhado',
          texto: '🔴 Produto Encalhado',
          prioridade: 60
        };
      } else if (diasSemVenda >= 30) {
        sugestao = {
          tipo: 'parado',
          texto: '⚫ Produto Parado',
          prioridade: 50
        };
      } else if (diasSemVenda >= 15) {
        sugestao = {
          tipo: 'giro_baixo',
          texto: '🟡 Giro Baixo',
          prioridade: 40
        };
      }
    } else {
      sugestao = {
        tipo: 'sem_vendas',
        texto: '🔴 Nunca Vendeu',
        prioridade: 65
      };
    }
  }

  return sugestao;
}

function calcularDiasParaVencer(dataValidade, controlarValidade) {
  if (!controlarValidade || !dataValidade || dataValidade === '0000-00-00') return null;

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const validade = new Date(dataValidade);
  validade.setHours(0, 0, 0, 0);

  return Math.floor((validade - hoje) / 86400000);
}

function calcularDiasSemVenda(ultimaVenda) {
  if (!ultimaVenda) return null;

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const ultima = new Date(ultimaVenda);
  ultima.setHours(0, 0, 0, 0);

  return Math.floor((hoje - ultima) / 86400000);
}

const SQL_ULTIMA_VENDA_PRODUTO = `
  (
    SELECT MAX(v.data_venda)
    FROM vendas_itens vi
    INNER JOIN vendas v ON v.id = vi.venda_id
    WHERE vi.produto_id = p.id
      AND (v.status IS NULL OR v.status != 'cancelada')
  )
`;

function revalidarSugestoesPendentes(descontoPercentual, callback) {
  db.all(`
    SELECT
      ps.id AS sugestao_id,
      p.id,
      p.nome,
      p.estoque_atual,
      p.controlar_validade,
      p.data_validade,
      p.preco_venda,
      ${SQL_ULTIMA_VENDA_PRODUTO} AS ultima_venda
    FROM promocoes_sugestoes ps
    INNER JOIN produtos p ON p.id = ps.produto_id
    WHERE ps.ativo = 1
      AND ps.aceito_em IS NULL
      AND ps.rejeitado_em IS NULL
  `, [], (err, rows) => {
    if (err) {
      console.error('Erro ao revalidar sugestões pendentes:', err.message);
      return callback(err);
    }

    const lista = rows || [];
    if (!lista.length) return callback(null, 0);

    let indice = 0;
    let atualizadas = 0;

    function processarProxima() {
      if (indice >= lista.length) {
        return callback(null, atualizadas);
      }

      const row = lista[indice];
      indice += 1;
      const classificacao = classificarProduto(row);

      if (!classificacao) {
        db.run('DELETE FROM promocoes_sugestoes WHERE id = ?', [row.sugestao_id], () => {
          processarProxima();
        });
        return;
      }

      const diasParaVencer = ehTipoValidade(classificacao.tipo)
        ? calcularDiasParaVencer(row.data_validade, true)
        : null;
      const precoSugerido = Number((row.preco_venda * (1 - descontoPercentual / 100)).toFixed(2));

      db.run(`
        UPDATE promocoes_sugestoes
        SET motivo = ?,
            dias_para_vencer = ?,
            estoque_atual = ?,
            preco_atual = ?,
            preco_sugerido = ?,
            desconto_percentual = ?
        WHERE id = ?
      `, [
        classificacao.texto,
        diasParaVencer,
        row.estoque_atual,
        row.preco_venda,
        precoSugerido,
        descontoPercentual,
        row.sugestao_id
      ], (updateErr) => {
        if (!updateErr) atualizadas += 1;
        processarProxima();
      });
    }

    processarProxima();
  });
}

function listarSugestoesPromocoes(res) {
  db.all(`
    SELECT 
      ps.*,
      p.nome AS nome_produto,
      p.codigo,
      p.estoque_atual,
      p.controlar_validade,
      p.data_validade,
      p.dias_alerta_validade,
      ${SQL_ULTIMA_VENDA_PRODUTO} AS ultima_venda,
      CASE
        WHEN COALESCE(p.controlar_validade, 0) = 1
          AND p.data_validade IS NOT NULL
          AND p.data_validade != ''
          AND p.data_validade != '0000-00-00'
        THEN CAST(julianday(date(p.data_validade)) - julianday(date('now', 'localtime')) AS INTEGER)
        ELSE NULL
      END AS dias_para_vencer
    FROM promocoes_sugestoes ps
    LEFT JOIN produtos p ON p.id = ps.produto_id
    WHERE ps.ativo = 1 AND ps.aceito_em IS NULL AND ps.rejeitado_em IS NULL
    ORDER BY
      CASE ps.motivo
        WHEN '🔴 Produto Vencido' THEN 100
        WHEN '🔴 Vence Hoje' THEN 90
        WHEN '🔴 Vence em até 3 dias' THEN 80
        WHEN '🟠 Vence em até 7 dias' THEN 70
        WHEN '🔴 Nunca Vendeu' THEN 65
        WHEN '🔴 Produto Encalhado' THEN 60
        WHEN '⚫ Produto Parado' THEN 50
        WHEN '🟡 Giro Baixo' THEN 40
        ELSE 0
      END DESC,
      ps.criado_em DESC
  `, [], (err, rows) => {
    if (err) {
      console.error('Erro ao listar sugestões de promoções:', err.message);
      return res.status(500).json({ error: err.message });
    }

    const sugestoes = (rows || []).map((row) => {
      const diasSemVenda = calcularDiasSemVenda(row.ultima_venda);
      return {
        ...row,
        dias_sem_venda: diasSemVenda
      };
    });

    res.json(sugestoes);
  });
}

function inserirSugestoesPromocoes(sugestoes, indice, inseridas, callback) {
  if (indice >= sugestoes.length) {
    return callback(inseridas);
  }

  const sugestao = sugestoes[indice];
  const diasParaVencer = ehTipoValidade(sugestao.tipo)
    ? calcularDiasParaVencer(sugestao.data_validade, true)
    : null;

  db.run(`
    INSERT INTO promocoes_sugestoes (
      produto_id,
      motivo,
      dias_para_vencer,
      estoque_atual,
      preco_atual,
      preco_sugerido,
      desconto_percentual,
      ativo
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `, [
    sugestao.produto_id,
    sugestao.motivo,
    diasParaVencer,
    sugestao.estoque,
    sugestao.preco_atual,
    sugestao.preco_sugerido,
    sugestao.desconto_percentual
  ], (insertErr) => {
    if (insertErr) {
      console.error('Erro ao inserir sugestão de promoção:', insertErr.message);
    }

    inserirSugestoesPromocoes(
      sugestoes,
      indice + 1,
      inseridas + (insertErr ? 0 : 1),
      callback
    );
  });
}

router.post('/promocoes/gerar-sugestoes', (req, res) => {
  const { produto_ids = [], desconto_percentual = 15 } = req.body;

  // Validar desconto percentual
  if (desconto_percentual < 1 || desconto_percentual > 100) {
    return res.status(400).json({ error: 'Desconto deve estar entre 1% e 100%' });
  }

  // Limpar sugestões antigas (mais de 30 dias) e formato legado
  db.run(`
    DELETE FROM promocoes_sugestoes 
    WHERE ativo = 1 
      AND aceito_em IS NULL 
      AND rejeitado_em IS NULL 
      AND (
        julianday('now') - julianday(criado_em) > 30
        OR motivo = 'vencimento_proximo'
      )
  `, (deleteErr) => {
    if (deleteErr) {
      console.error('Erro ao limpar sugestões antigas:', deleteErr.message);
    }
  });

  revalidarSugestoesPendentes(desconto_percentual, (revalErr) => {
    if (revalErr) {
      console.error('Erro na revalidação de sugestões:', revalErr.message);
    }

  let query = `
    SELECT
      p.id,
      p.nome,
      p.codigo,
      p.estoque_atual,
      p.controlar_validade,
      p.data_validade,
      p.preco_venda,
      ${SQL_ULTIMA_VENDA_PRODUTO} AS ultima_venda
    FROM produtos p
    WHERE
      __FILTRO_ATIVO__
      p.estoque_atual > 0
      AND p.id NOT IN (
        SELECT produto_id FROM promocoes_sugestoes
        WHERE ativo = 1
          AND aceito_em IS NULL
          AND rejeitado_em IS NULL
      )
  `;

  const params = [];

  if (Array.isArray(produto_ids) && produto_ids.length > 0) {
    const placeholders = produto_ids.map(() => '?').join(',');
    query += ` AND p.id IN (${placeholders})`;
    params.push(...produto_ids);
  }

  produtosTemColuna('ativo', (colErr, temColunaAtivo) => {
    if (colErr) {
      console.error('Erro ao verificar coluna ativo em produtos:', colErr.message);
      return res.status(500).json({ error: colErr.message });
    }

    const filtroAtivo = temColunaAtivo ? 'COALESCE(p.ativo, 1) = 1 AND' : '';
    query = query.replace('__FILTRO_ATIVO__', filtroAtivo);

    db.all(query, params, (err, produtos) => {
      if (err) {
        console.error('Erro ao buscar produtos para sugestão:', err.message);
        return res.status(500).json({ error: err.message });
      }

      const sugestoes = [];

      for (const produto of produtos || []) {
        const sugestao = classificarProduto(produto);

        if (sugestao) {
          sugestoes.push({
            produto_id: produto.id,
            nome: produto.nome,
            estoque: produto.estoque_atual,
            tipo: sugestao.tipo,
            motivo: sugestao.texto,
            prioridade: sugestao.prioridade,
            data_validade: produto.data_validade,
            preco_atual: produto.preco_venda,
            preco_sugerido: Number((produto.preco_venda * (1 - desconto_percentual / 100)).toFixed(2)),
            desconto_percentual
          });
        }
      }

      sugestoes.sort((a, b) => b.prioridade - a.prioridade);

      if (sugestoes.length === 0) {
        const mensagem = (produtos || []).length > 0
          ? 'Nenhuma sugestão necessária: os produtos analisados estão dentro dos critérios de validade e giro.'
          : 'Nenhuma sugestão gerada. Todos os produtos com estoque já possuem sugestão pendente ou não há produtos elegíveis.';

        return res.json({
          message: mensagem,
          total: 0,
          sugestoes: []
        });
      }

      inserirSugestoesPromocoes(sugestoes, 0, 0, (inseridas) => {
        res.json({
          message: `Sugestões geradas com sucesso. Total: ${inseridas}`,
          total: inseridas,
          sugestoes
        });
      });
    });
  });
  });
});

router.get('/promocoes/produtos-elegiveis', (req, res) => {
  let query = `
    SELECT
      p.id,
      p.nome,
      p.codigo,
      p.estoque_atual,
      p.controlar_validade,
      p.data_validade,
      p.preco_venda,
      ${SQL_ULTIMA_VENDA_PRODUTO} AS ultima_venda
    FROM produtos p
    WHERE
      __FILTRO_ATIVO__
      p.estoque_atual > 0
  `;

  produtosTemColuna('ativo', (colErr, temColunaAtivo) => {
    if (colErr) {
      console.error('Erro ao verificar coluna ativo em produtos:', colErr.message);
      return res.status(500).json({ error: colErr.message });
    }

    query = query.replace(
      '__FILTRO_ATIVO__',
      temColunaAtivo ? 'COALESCE(p.ativo, 1) = 1 AND' : ''
    );

    db.all(query, [], (err, produtos) => {
      if (err) {
        console.error('Erro ao buscar produtos elegíveis:', err.message);
        return res.status(500).json({ error: err.message });
      }

      const elegiveis = [];

      for (const produto of produtos || []) {
        const sugestao = classificarProduto(produto);
        if (!sugestao) continue;

        elegiveis.push({
          id: produto.id,
          nome: produto.nome,
          codigo: produto.codigo,
          estoque_atual: produto.estoque_atual,
          preco_venda: produto.preco_venda,
          controlar_validade: produto.controlar_validade,
          data_validade: produto.data_validade,
          ultima_venda: produto.ultima_venda,
          dias_sem_venda: calcularDiasSemVenda(produto.ultima_venda),
          dias_para_vencer: produtoControlaValidade(produto)
            ? calcularDiasParaVencer(produto.data_validade, true)
            : null,
          tipo: sugestao.tipo,
          motivo: sugestao.texto,
          prioridade: sugestao.prioridade
        });
      }

      elegiveis.sort((a, b) => b.prioridade - a.prioridade);
      res.json(elegiveis);
    });
  });
});

// Recalcular saldos fiscal/não fiscal a partir do histórico de compras e vendas
router.post('/recalcular-saldos', verificarPermissaoEspecifica('produtos', 'editar'), (req, res) => {
  const { recalcularSaldosTodosProdutos } = require('../services/estoqueFiscalService');
  recalcularSaldosTodosProdutos(db, (err, result) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({
      message: 'Saldos recalculados com sucesso',
      atualizados: result?.atualizados || 0,
      erros: result?.erros || []
    });
  });
});

router.post('/:id/recalcular-saldos', verificarPermissaoEspecifica('produtos', 'editar'), (req, res) => {
  recalcularSaldosProduto(db, req.params.id, (err, result) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({
      message: 'Saldos recalculados com sucesso',
      ...result
    });
  });
});

function executarAjusteEstoque(req, res) {
  const { id } = req.params;
  const {
    ajuste_fiscal,
    ajuste_nao_fiscal,
    motivo,
    lote,
    data_fabricacao,
    data_validade,
    quantidade,
    modo_fiscal
  } = req.body;

  let ajusteFiscal = Number(ajuste_fiscal ?? 0);
  let ajusteNaoFiscal = Number(ajuste_nao_fiscal ?? 0);

  if (quantidade !== undefined && quantidade !== null && ajuste_fiscal === undefined && ajuste_nao_fiscal === undefined) {
    const qtd = Number(quantidade) || 0;
    const modoFiscalAtivo = modo_fiscal === 1 || modo_fiscal === true || modo_fiscal === '1';
    if (modoFiscalAtivo) {
      ajusteFiscal = qtd;
    } else {
      ajusteNaoFiscal = qtd;
    }
  }

  aplicarAjusteEstoqueProduto(db, {
    produtoId: id,
    ajusteFiscal,
    ajusteNaoFiscal,
    motivo,
    usuarioId: req.user?.id,
    usuarioNome: req.user?.username || req.user?.nome,
    lote,
    dataFabricacao: data_fabricacao,
    dataValidade: data_validade,
    lotesService
  }, (err, resultado) => {
    if (err) {
      const status = err.message.includes('não encontrado') ? 404 : 400;
      return res.status(status).json({ error: err.message });
    }

    gravarAuditoria({
      usuario_id: req.user?.id || null,
      usuario_nome: req.user?.username || req.user?.nome || null,
      modulo: 'produtos',
      acao: 'ajustar_estoque',
      referencia_tipo: 'produto',
      referencia_id: id,
      detalhes: {
        ajuste_fiscal: ajusteFiscal,
        ajuste_nao_fiscal: ajusteNaoFiscal,
        motivo,
        resultado
      },
      ip_requisicao: req.ip || null
    }).catch(() => {});

    res.json({
      message: 'Estoque ajustado com sucesso',
      ...resultado
    });
  });
}

router.get('/:id/tem-movimentacoes', exigirPerfilAjusteEstoque(), (req, res) => {
  produtoTemMovimentacoes(db, req.params.id, (err, tem) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ produto_id: Number(req.params.id), tem_movimentacoes: tem });
  });
});

router.post('/:id/ajustar-estoque', exigirPerfilAjusteEstoque(), executarAjusteEstoque);

// Buscar produto por ID trazendo o nome da categoria
router.get('/:id', (req, res) => {
  const modoFiscal = isModoFiscalQuery(req.query.modo_fiscal);

  db.get(`
    SELECT 
      p.*, 
      (SELECT preco_atacado FROM produto_atacado WHERE produto_id = p.id ORDER BY quantidade_minima ASC LIMIT 1) AS preco_atacado,
      (SELECT quantidade_minima FROM produto_atacado WHERE produto_id = p.id ORDER BY quantidade_minima ASC LIMIT 1) AS quantidade_minima_atacado,
      c.nome AS categoria_nome,
      s.nome AS subcategoria_nome
    FROM produtos p
    LEFT JOIN categorias c ON c.id = p.categoria_id
    LEFT JOIN subcategorias s ON s.id = p.subcategoria_id
    WHERE p.id = ?
  `, [req.params.id], (err, row) => {
    if (err) {
      console.error(err.message);
      return res.status(500).json({ error: err.message });
    }
    if (!row) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }

    db.all(
      `SELECT * FROM produto_atacado WHERE produto_id = ? ORDER BY quantidade_minima ASC`,
      [req.params.id],
      (faixaErr, faixas) => {
        if (faixaErr) {
          return res.status(500).json({ error: faixaErr.message });
        }

        produtoTemMovimentacoes(db, req.params.id, (movErr, temMovimentacoes) => {
          if (movErr) {
            return res.status(500).json({ error: movErr.message });
          }

          const produto = normalizarProdutoResposta({
            ...row,
            categoria: row.categoria_nome || '',
            subcategoria: row.subcategoria_nome || '',
            atacado_faixas: faixas || [],
            tem_movimentacoes: temMovimentacoes
          }, modoFiscal);

          res.json(produto);
        });
      }
    );
  });
});

// Criar produto
router.post('/', (req, res) => {
  const {
    codigo, nome, categoria_id, subcategoria_id, unidade, preco_compra,
    lucro_percentual, preco_venda, estoque_atual, estoque_minimo, fornecedor,
    ncm, cfop, csosn, origem, cest, codigo_barras,
    aliquota_icms, aliquota_pis, aliquota_cofins,
    controlar_validade,
    produto_fracionado, vendido_por_peso, peso_total_compra, valor_total_compra, custo_por_kg,
    venda_atacado,
    atacado_faixas,
    saldo_fiscal_inicial,
    saldo_nao_fiscal_inicial,
    item_fiscal,
    // Campos adicionais para lote inicial
    lote_inicial,
    data_fabricacao_inicial,
    data_validade_inicial
  } = req.body;

  const controlarValidade = controlar_validade ? 1 : 0;
  const flagFracionado = resolverFlagProdutoFracionado({ produto_fracionado, vendido_por_peso }) ?? 0;

  let saldoFiscalInicial;
  let saldoNaoFiscalInicial;
  try {
    if (saldo_fiscal_inicial !== undefined || saldo_nao_fiscal_inicial !== undefined) {
      saldoFiscalInicial = Number(saldo_fiscal_inicial ?? 0);
      saldoNaoFiscalInicial = Number(saldo_nao_fiscal_inicial ?? 0);
    } else {
      const estoqueLegado = Number(estoque_atual || 0);
      saldoFiscalInicial = estoqueLegado;
      saldoNaoFiscalInicial = 0;
    }
    const saldos = definirSaldosIniciaisProduto(saldoFiscalInicial, saldoNaoFiscalInicial);
    saldoFiscalInicial = saldos.saldo_fiscal;
    saldoNaoFiscalInicial = saldos.saldo_nao_fiscal;
    var estoqueInicial = saldos.estoque_atual;
  } catch (saldosErr) {
    return res.status(400).json({ error: saldosErr.message });
  }

  const itemFiscalGravar = resolverItemFiscalCadastro(req.body, saldoFiscalInicial, saldoNaoFiscalInicial);
  console.log('[AUDIT PRODUTO POST] req.body.item_fiscal:', req.body.item_fiscal);
  console.log('[AUDIT PRODUTO POST] item_fiscal gravar INSERT:', itemFiscalGravar);

  db.run(`
    INSERT INTO produtos (
      codigo, nome, categoria_id, subcategoria_id, unidade,
      preco_compra, lucro_percentual, preco_venda,
      estoque_atual, estoque_minimo, fornecedor,
      ncm, cfop, csosn, origem, cest, codigo_barras,
      aliquota_icms, aliquota_pis, aliquota_cofins,
      controlar_validade,
      vendido_por_peso, produto_fracionado, peso_total_compra, valor_total_compra, custo_por_kg,
      venda_atacado,
      saldo_fiscal, saldo_nao_fiscal, item_fiscal
    )
    VALUES (${Array(30).fill('?').join(', ')})
  `, [
    codigo, nome, categoria_id, subcategoria_id, unidade,
    preco_compra, lucro_percentual, preco_venda,
    estoqueInicial, estoque_minimo || 0, fornecedor,
    ncm, cfop, csosn, origem, cest, codigo_barras,
    aliquota_icms, aliquota_pis, aliquota_cofins,
    controlarValidade,
    flagFracionado,
    flagFracionado,
    peso_total_compra || 0,
    valor_total_compra || 0,
    custo_por_kg || 0,
    venda_atacado ? 1 : 0,
    saldoFiscalInicial,
    saldoNaoFiscalInicial,
    itemFiscalGravar
  ],
    function(err) {
      if (err) {
        console.error('Erro ao criar produto:', err.message);
        res.status(500).json({ error: err.message });
        return;
      }

      const produtoId = this.lastID;
      db.get(
        'SELECT id, nome, item_fiscal, saldo_fiscal, saldo_nao_fiscal FROM produtos WHERE id = ?',
        [produtoId],
        (auditErr, auditRow) => {
          if (!auditErr && auditRow) {
            console.log('[AUDIT PRODUTO POST] gravado no banco:', auditRow);
          }
        }
      );

      // Se controlar validade e tiver estoque inicial, criar lote inicial
      if (controlarValidade && estoqueInicial > 0) {
        if (!data_validade_inicial) {
          return res.status(400).json({
            error: 'Data de validade é obrigatória para o estoque inicial.'
          });
        }

        const hoje = new Date().toISOString().split('T')[0];

        // Lote gerado automaticamente pelo serviço
        lotesService.criarLote({
          produto_id: produtoId,
          quantidade_inicial: estoqueInicial,
          data_validade: data_validade_inicial,
          data_entrada: hoje,
          origem: 'ESTOQUE_INICIAL',
          compra_id: null
        }, (loteErr) => {
          if (loteErr) {
            console.error('Erro ao criar lote inicial:', loteErr.message);
            // Não falhar a criação do produto se o lote falhar, mas logar o erro
          }

          continuarCriacaoProduto();
        });
      } else {
        continuarCriacaoProduto();
      }

      function continuarCriacaoProduto() {
        inserirFaixasAtacadoProduto(produtoId, atacado_faixas, (faixaErr) => {
          if (faixaErr) {
            console.error('Erro ao salvar faixas de atacado do produto:', faixaErr.message);
            return res.status(500).json({ error: 'Produto criado, mas houve erro ao salvar faixas de atacado.' });
          }

          buscarProdutoCompleto(produtoId, (err2, row) => {
            if (err2 || !row) {
              return res.status(500).json({ error: err2?.message || 'Erro ao buscar produto criado' });
            }

            res.json({
              ...row,
              message: 'Produto criado com sucesso'
            });

            gravarAuditoria({
              usuario_id: req.user?.id || null,
              usuario_nome: req.user?.username || req.user?.nome || null,
              modulo: 'produtos',
              acao: 'criar_produto',
              referencia_tipo: 'produto',
              referencia_id: produtoId,
              detalhes: { nome, codigo, categoria_id, estoque_atual, preco_venda, controlar_validade, faixas_atacado: (atacado_faixas || []).length },
              ip_requisicao: req.ip || null
            }).catch((auditErr) => console.error('Erro ao gravar auditoria de criação de produto:', auditErr));
          });
        });
      }
    });
});

// Obter estatísticas de vencimentos para o dashboard
router.get('/vencimentos/estatisticas', (req, res) => {
  lotesService.obterEstatisticasVencimentos((err, stats) => {
    if (err) {
      console.error('Erro ao obter estatísticas de vencimentos:', err);
      return res.status(500).json({ error: err.message });
    }
    res.json(stats);
  });
});

// Obter configurações de validade
router.get('/validade/configuracoes', (req, res) => {
  lotesService.obterConfiguracoesValidade((err, config) => {
    if (err) {
      console.error('Erro ao obter configurações de validade:', err);
      return res.status(500).json({ error: err.message });
    }
    res.json(config);
  });
});

// Atualizar configurações de validade
router.put('/validade/configuracoes', (req, res) => {
  const { dias_aviso_vencimento, bloquear_venda_vencido, alertar_venda_proximo_vencimento } = req.body;
  
  lotesService.atualizarConfiguracoesValidade({
    dias_aviso_vencimento,
    bloquear_venda_vencido,
    alertar_venda_proximo_vencimento
  }, (err) => {
    if (err) {
      console.error('Erro ao atualizar configurações de validade:', err);
      return res.status(500).json({ error: err.message });
    }
    res.json({ message: 'Configurações atualizadas com sucesso' });
  });
});

// Ajustar estoque — legado PUT (use POST preferencialmente)
router.put('/:id/ajustar-estoque', exigirPerfilAjusteEstoque(), executarAjusteEstoque);

// Atualizar produto
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const { atacado_faixas, saldo_fiscal_inicial, saldo_nao_fiscal_inicial, ...bodyUpdates } = req.body;

  console.log('[AUDIT PRODUTO PUT] id:', id, 'req.body.item_fiscal:', req.body.item_fiscal);

  db.get('SELECT * FROM produtos WHERE id = ?', [id], (err, old) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (!old) {
      res.status(404).json({ error: 'Produto não encontrado' });
      return;
    }

    const aplicarSaldosIniciaisSePermitido = (callback) => {
      if (saldo_fiscal_inicial === undefined && saldo_nao_fiscal_inicial === undefined) {
        return callback(null);
      }

      produtoTemMovimentacoes(db, id, (movErr, tem) => {
        if (movErr) return callback(movErr);
        if (tem) {
          return callback(new Error('Produto com movimentações não permite alterar saldos iniciais.'));
        }

        try {
          const saldos = definirSaldosIniciaisProduto(
            saldo_fiscal_inicial ?? old.saldo_fiscal,
            saldo_nao_fiscal_inicial ?? old.saldo_nao_fiscal
          );
          db.run(`
            UPDATE produtos
            SET saldo_fiscal = ?,
                saldo_nao_fiscal = ?,
                estoque_atual = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `, [saldos.saldo_fiscal, saldos.saldo_nao_fiscal, saldos.estoque_atual, id], callback);
        } catch (saldosErr) {
          callback(saldosErr);
        }
      });
    };

    const fields = [];
    const values = [];

    const flagFracionado = resolverFlagProdutoFracionado(bodyUpdates);
    if (flagFracionado !== undefined) {
      bodyUpdates.produto_fracionado = flagFracionado;
      bodyUpdates.vendido_por_peso = flagFracionado;
    }

    Object.keys(bodyUpdates).forEach(key => {
      if (!CAMPOS_PRODUTO_IGNORADOS.has(key)) {
        fields.push(`${key} = ?`);
        values.push(bodyUpdates[key]);
      }
    });

    const temSaldosIniciais = saldo_fiscal_inicial !== undefined || saldo_nao_fiscal_inicial !== undefined;
    if (fields.length === 0 && !Array.isArray(atacado_faixas) && !temSaldosIniciais) {
      return res.status(400).json({ error: 'Nenhum campo válido para atualizar.' });
    }

    if (bodyUpdates.item_fiscal !== undefined) {
      console.log('[AUDIT PRODUTO PUT] item_fiscal no UPDATE:', bodyUpdates.item_fiscal);
    }

    values.push(id);

    const finalizarAtualizacao = () => {
      const novoPc = bodyUpdates.preco_compra !== undefined ? bodyUpdates.preco_compra : old.preco_compra;
      const novoPv = bodyUpdates.preco_venda !== undefined ? bodyUpdates.preco_venda : old.preco_venda;
      const mudouCompra = Number(novoPc) !== Number(old.preco_compra);
      const mudouVenda = Number(novoPv) !== Number(old.preco_venda);

      function responderComProdutoAtualizado() {
        buscarProdutoCompleto(id, (err2, row) => {
          if (err2 || !row) {
            return res.status(500).json({ error: err2?.message || 'Erro ao buscar produto atualizado' });
          }
          res.json(row);
        });
      }

      if (mudouCompra || mudouVenda) {
        db.run(`
          INSERT INTO produtos_preco_historico (
            produto_id, preco_compra_anterior, preco_compra_novo, preco_venda_anterior, preco_venda_novo
          ) VALUES (?, ?, ?, ?, ?)
        `, [id, old.preco_compra, novoPc, old.preco_venda, novoPv], (histErr) => {
          if (histErr) {
            console.error('Erro ao registrar histórico de preços:', histErr);
          }
          responderComProdutoAtualizado();
        });
      } else {
        responderComProdutoAtualizado();
      }

      gravarAuditoria({
        usuario_id: req.user?.id || null,
        usuario_nome: req.user?.username || req.user?.nome || null,
        modulo: 'produtos',
        acao: 'atualizar_produto',
        referencia_tipo: 'produto',
        referencia_id: id,
        detalhes: { antes: old, depois: bodyUpdates },
        ip_requisicao: req.ip || null
      }).catch((auditErr) => console.error('Erro ao gravar auditoria de atualização de produto:', auditErr));
    };

    const salvarFaixasTemporarias = (callback) => {
      if (!Array.isArray(atacado_faixas) || atacado_faixas.length === 0) {
        return callback(null);
      }

      db.run(`DELETE FROM produto_atacado WHERE produto_id = ?`, [id], (deleteErr) => {
        if (deleteErr) {
          return callback(deleteErr);
        }
        inserirFaixasAtacadoProduto(id, atacado_faixas, callback);
      });
    };

    const concluirAtualizacao = (callback) => {
      salvarFaixasTemporarias((faixaErr) => {
        if (faixaErr) return callback(faixaErr);
        aplicarSaldosIniciaisSePermitido((saldosErr) => {
          if (saldosErr) return callback(saldosErr);
          finalizarAtualizacao();
        });
      });
    };

    if (fields.length === 0) {
      return concluirAtualizacao((errFinal) => {
        if (errFinal) {
          return res.status(400).json({ error: errFinal.message });
        }
      });
    }

    db.run(`
      UPDATE produtos
      SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, values, function(updateErr) {
      if (updateErr) {
        res.status(500).json({ error: updateErr.message });
        return;
      }

      db.get(
        'SELECT id, nome, item_fiscal, saldo_fiscal, saldo_nao_fiscal FROM produtos WHERE id = ?',
        [id],
        (auditErr, auditRow) => {
          if (!auditErr && auditRow) {
            console.log('[AUDIT PRODUTO PUT] gravado no banco:', auditRow);
          }
        }
      );

      concluirAtualizacao((errFinal) => {
        if (errFinal) {
          return res.status(400).json({ error: errFinal.message });
        }
      });
    });
  });
});

// Deletar produto
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  db.run('DELETE FROM produtos WHERE id = ?', [id], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    gravarAuditoria({
      usuario_id: req.user?.id || null,
      usuario_nome: req.user?.username || req.user?.nome || null,
      modulo: 'produtos',
      acao: 'deletar_produto',
      referencia_tipo: 'produto',
      referencia_id: id,
      detalhes: { id },
      ip_requisicao: req.ip || null
    }).catch((auditErr) => console.error('Erro ao gravar auditoria de exclusão de produto:', auditErr));
    res.json({ message: 'Produto deletado com sucesso' });
  });
});

// Buscar produtos com estoque baixo
router.get('/estoque/baixo', (req, res) => {
  const modoFiscal = isModoFiscalQuery(req.query.modo_fiscal);
  const exprEstoque = exprEstoqueAlerta(modoFiscal);
  const filtroFiscal = modoFiscal ? ' AND COALESCE(item_fiscal, 1) = 1' : '';

  db.all(`
    SELECT * FROM produtos 
    WHERE ${exprEstoque} <= estoque_minimo 
      ${filtroFiscal}
    ORDER BY (${exprEstoque} / NULLIF(estoque_minimo, 0)) ASC
  `, (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json((rows || []).map((row) => normalizarProdutoResposta(row, modoFiscal)));
  });
});

// Buscar promoção ativa de um produto específico
router.get('/:id/promocao-ativa', (req, res) => {
  const { id } = req.params;
  
  db.get(`
    SELECT 
      p.id,
      p.produto_id,
      p.preco_original,
      p.preco_promocional,
      p.desconto_percentual,
      p.data_inicio,
      p.data_fim,
      p.status
    FROM promocoes p
    WHERE p.produto_id = ?
      AND p.status = 'ativa'
      AND date(p.data_inicio) <= date('now')
      AND date(p.data_fim) > date('now')
    LIMIT 1
  `, [id], (err, row) => {
    if (err) {
      console.error('Erro ao buscar promoção ativa:', err.message);
      res.status(500).json({ error: err.message });
      return;
    }
    
    if (row) {
      res.json(row);
    } else {
      res.json(null);
    }
  });
});

// ==========================
// ENDPOINTS VENDA ATACADO
// ==========================

// Listar faixas de atacado de um produto
router.get('/:id/atacado', (req, res) => {
  const { id } = req.params;
  db.all(`
    SELECT * FROM produto_atacado
    WHERE produto_id = ?
    ORDER BY quantidade_minima ASC
  `, [id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

// Criar faixa de atacado para um produto
router.post('/:id/atacado', verificarPermissaoEspecifica('gerenciar_faixa_atacado'), (req, res) => {
  const { id } = req.params;
  const quantidade_minima = parseInt(req.body.quantidade_minima, 10);
  const preco_atacado = parseFloat(req.body.preco_atacado);

  if (!quantidade_minima || quantidade_minima <= 0) {
    return res.status(400).json({ error: 'Quantidade mínima deve ser maior que zero' });
  }
  if (isNaN(preco_atacado) || preco_atacado <= 0) {
    return res.status(400).json({ error: 'Preço atacado inválido' });
  }

  // Verificar duplicata
  db.get('SELECT COUNT(*) AS total FROM produto_atacado WHERE produto_id = ? AND quantidade_minima = ?', [id, quantidade_minima], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (row && row.total > 0) return res.status(400).json({ error: 'Já existe uma faixa com essa quantidade' });

    // Buscar faixa inferior e superior para validar preços
    db.get('SELECT * FROM produto_atacado WHERE produto_id = ? AND quantidade_minima < ? ORDER BY quantidade_minima DESC LIMIT 1', [id, quantidade_minima], (err2, lower) => {
      if (err2) return res.status(500).json({ error: err2.message });
      db.get('SELECT * FROM produto_atacado WHERE produto_id = ? AND quantidade_minima > ? ORDER BY quantidade_minima ASC LIMIT 1', [id, quantidade_minima], (err3, higher) => {
        if (err3) return res.status(500).json({ error: err3.message });

        if (lower && preco_atacado > lower.preco_atacado) {
          return res.status(400).json({ error: 'Preço da faixa não pode ser maior que a faixa inferior' });
        }
        if (higher && preco_atacado < higher.preco_atacado) {
          return res.status(400).json({ error: 'Preço da faixa não pode ser menor que a faixa superior' });
        }

        db.run('INSERT INTO produto_atacado (produto_id, quantidade_minima, preco_atacado) VALUES (?, ?, ?)', [id, quantidade_minima, preco_atacado], function(insertErr) {
          if (insertErr) return res.status(500).json({ error: insertErr.message });
          db.get('SELECT * FROM produto_atacado WHERE id = ?', [this.lastID], (e, created) => {
            if (e) return res.status(500).json({ error: e.message });
            res.json(created);
          });
        });
      });
    });
  });
});

// Atualizar faixa de atacado
router.put('/atacado/:faixaId', verificarPermissaoEspecifica('gerenciar_faixa_atacado'), (req, res) => {
  const { faixaId } = req.params;
  const quantidade_minima = parseInt(req.body.quantidade_minima, 10);
  const preco_atacado = parseFloat(req.body.preco_atacado);

  if (!quantidade_minima || quantidade_minima <= 0) {
    return res.status(400).json({ error: 'Quantidade mínima deve ser maior que zero' });
  }
  if (isNaN(preco_atacado) || preco_atacado <= 0) {
    return res.status(400).json({ error: 'Preço atacado inválido' });
  }

  db.get('SELECT * FROM produto_atacado WHERE id = ?', [faixaId], (err, faixa) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!faixa) return res.status(404).json({ error: 'Faixa não encontrada' });

    const produtoId = faixa.produto_id;

    // Verificar duplicata em outra faixa
    db.get('SELECT COUNT(*) AS total FROM produto_atacado WHERE produto_id = ? AND quantidade_minima = ? AND id != ?', [produtoId, quantidade_minima, faixaId], (err2, row) => {
      if (err2) return res.status(500).json({ error: err2.message });
      if (row && row.total > 0) return res.status(400).json({ error: 'Já existe outra faixa com essa quantidade' });

      // Buscar faixa inferior e superior para validar preços
      db.get('SELECT * FROM produto_atacado WHERE produto_id = ? AND quantidade_minima < ? ORDER BY quantidade_minima DESC LIMIT 1', [produtoId, quantidade_minima], (err3, lower) => {
        if (err3) return res.status(500).json({ error: err3.message });
        db.get('SELECT * FROM produto_atacado WHERE produto_id = ? AND quantidade_minima > ? ORDER BY quantidade_minima ASC LIMIT 1', [produtoId, quantidade_minima], (err4, higher) => {
          if (err4) return res.status(500).json({ error: err4.message });

          if (lower && preco_atacado > lower.preco_atacado) {
            return res.status(400).json({ error: 'Preço da faixa não pode ser maior que a faixa inferior' });
          }
          if (higher && preco_atacado < higher.preco_atacado) {
            return res.status(400).json({ error: 'Preço da faixa não pode ser menor que a faixa superior' });
          }

          db.run('UPDATE produto_atacado SET quantidade_minima = ?, preco_atacado = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [quantidade_minima, preco_atacado, faixaId], function(updateErr) {
            if (updateErr) return res.status(500).json({ error: updateErr.message });
            db.get('SELECT * FROM produto_atacado WHERE id = ?', [faixaId], (e, updated) => {
              if (e) return res.status(500).json({ error: e.message });
              res.json(updated);
            });
          });
        });
      });
    });
  });
});

// Buscar faixa por id
router.get('/atacado/:faixaId', (req, res) => {
  const { faixaId } = req.params;
  db.get('SELECT * FROM produto_atacado WHERE id = ?', [faixaId], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(row || null);
  });
});

// Excluir faixa de atacado
router.delete('/atacado/:faixaId', verificarPermissaoEspecifica('gerenciar_faixa_atacado'), (req, res) => {
  const { faixaId } = req.params;
  db.run('DELETE FROM produto_atacado WHERE id = ?', [faixaId], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Faixa excluída com sucesso' });
  });
});

// Listar todas as promoções com informações de status
router.get('/listar-todas-promocoes', (req, res) => {
  db.all(`
    SELECT 
      p.id,
      p.produto_id,
      pr.codigo,
      pr.nome,
      p.preco_original,
      p.preco_promocional,
      p.desconto_percentual,
      p.data_inicio,
      p.data_fim,
      p.status,
      p.criado_em,
      p.encerrado_em,
      p.motivo_encerramento,
      CASE 
        WHEN p.status = 'ativa' AND date(p.data_fim) <= date('now') THEN 'expirada'
        WHEN p.status = 'ativa' AND date(p.data_inicio) > date('now') THEN 'nao_iniciada'
        WHEN p.status = 'ativa' THEN 'vigente'
        ELSE p.status
      END AS status_real,
      CAST(julianday(date(p.data_fim)) - julianday(date('now')) AS INTEGER) AS dias_restantes
    FROM promocoes p
    LEFT JOIN produtos pr ON pr.id = p.produto_id
    ORDER BY p.data_fim DESC
  `, [], (err, rows) => {
    if (err) {
      console.error('Erro ao listar promoções:', err.message);
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

// Endpoint para verificar e encerrar promoções expiradas (chamável da interface)
router.post('/verificar-expiradas-agora', (req, res) => {
  const hoje = new Date().toISOString().split('T')[0];
  
  db.run(`
    UPDATE promocoes
    SET status = 'encerrada', 
        encerrado_em = CURRENT_TIMESTAMP,
        motivo_encerramento = 'Encerrada automaticamente - data de vigência expirada'
    WHERE status = 'ativa' AND date(data_fim) < date(?)
  `, [hoje], function(err) {
    if (err) {
      console.error('Erro ao encerrar promoções expiradas:', err.message);
      return res.status(500).json({ error: err.message });
    }
    
    res.json({
      success: true,
      message: `${this.changes} promoção(ões) expirada(s) encerrada(s)`,
      quantidade_encerrada: this.changes
    });
  });
});

module.exports = router;