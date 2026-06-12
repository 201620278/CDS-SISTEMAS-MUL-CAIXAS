
const express = require('express');
const router = express.Router();
const db = require('../database');
const { verificarPermissaoEspecifica } = require('./auth');


// LISTAR PRODUTOS
router.get('/', (req, res) => {
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
    ORDER BY p.id DESC
  `, [], (err, rows) => {
    if (err) {
      console.error('Erro ao listar produtos:', err.message);
      return res.status(500).json({ error: err.message });
    }

    const produtos = rows.map(p => ({
      ...p,
      categoria: p.categoria_nome || p.categoria || '',
      subcategoria: p.subcategoria_nome || ''
    }));

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

// Relatório de estoque de produtos com data de compra
router.get('/relatorio-estoque', (req, res) => {
  const { inicio, fim } = req.query;

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

  const whereExists = filtrosExists.length
    ? `
      WHERE EXISTS (
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
    ${whereExists}
    ORDER BY p.nome ASC
  `;

  const params = [...paramsSubconsulta, ...paramsExists];

  db.all(sql, params, (err, rows) => {
    if (err) {
      console.error('Erro ao gerar relatório de estoque:', err.message);
      return res.status(500).json({ error: err.message });
    }

    const produtos = (rows || []).map(p => ({
      ...p,
      categoria: p.categoria_nome || p.categoria || '',
      subcategoria: p.subcategoria_nome || p.subcategoria || '',
      ultima_compra_data: p.ultima_compra_data || null
    }));

    res.json(produtos);
  });
});

// CONSULTA DE PRODUTOS NO PDV - F1
router.get('/consulta-pdv/buscar', (req, res) => {
  const termo = String(req.query.q || '').trim();

  if (!termo) {
    return res.json([]);
  }

  const buscaLike = `%${termo}%`;
  const buscaNumero = termo.replace(/\D/g, '') || termo;
  const hoje = new Date().toISOString().split('T')[0];

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
      p.estoque_minimo,
      p.vendido_por_peso,
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
      CAST(p.id AS TEXT) = ?
      OR p.codigo LIKE ?
      OR p.codigo_barras LIKE ?
      OR p.nome LIKE ?
    ORDER BY p.nome ASC
    LIMIT 30
  `, [
    hoje,
    hoje,
    buscaNumero,
    buscaLike,
    buscaLike,
    buscaLike
  ], (err, rows) => {
    if (err) {
      console.error('Erro na consulta de produtos PDV:', err.message);
      return res.status(500).json({ error: err.message });
    }

    res.json(rows || []);
  });
});

router.get('/ranking-vendas', (req, res) => {
  const hoje = new Date();
  const seteDiasAtras = new Date();
  seteDiasAtras.setDate(hoje.getDate() - 7);

  const dataInicio = req.query.inicio || seteDiasAtras.toISOString().slice(0, 10);
  const dataFim = req.query.fim || hoje.toISOString().slice(0, 10);

  const sqlBase = `
    SELECT 
      p.id,
      p.nome,
      COALESCE(SUM(vi.quantidade), 0) AS quantidade_vendida,
      COALESCE(COUNT(DISTINCT v.id), 0) AS total_vendas
    FROM produtos p
    LEFT JOIN vendas_itens vi ON vi.produto_id = p.id
    LEFT JOIN vendas v ON v.id = vi.venda_id
      AND date(v.data_venda) BETWEEN date(?) AND date(?)
      AND (v.status IS NULL OR v.status != 'cancelada')
    GROUP BY p.id, p.nome
  `;

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

  db.all(`
    SELECT
      id,
      codigo,
      codigo_barras,
      nome,
      unidade,
      estoque_atual,
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
      AND estoque_atual > 0
      AND date(data_validade) <= date('now', 'localtime', '+' || COALESCE(dias_alerta_validade, ?) || ' days')
    ORDER BY date(data_validade) ASC, nome ASC
  `, [diasPadrao, diasPadrao, diasPadrao], (err, rows) => {
    if (err) {
      console.error('Erro ao buscar vencimentos de produtos:', err.message);
      return res.status(500).json({ error: err.message });
    }

    const lista = rows || [];

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
  db.all(`
    SELECT 
      ps.*,
      p.nome AS nome_produto,
      p.codigo,
      p.estoque_atual,
      p.data_validade,
      p.dias_alerta_validade,
      CAST(julianday(date(p.data_validade)) - julianday(date('now', 'localtime')) AS INTEGER) AS dias_para_vencer
    FROM promocoes_sugestoes ps
    LEFT JOIN produtos p ON p.id = ps.produto_id
    WHERE ps.ativo = 1 AND ps.aceito_em IS NULL AND ps.rejeitado_em IS NULL
    ORDER BY ps.criado_em DESC
  `, [], (err, rows) => {
    if (err) {
      console.error('Erro ao listar sugestões de promoções:', err.message);
      return res.status(500).json({ error: err.message });
    }
    res.json(rows || []);
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
router.post('/promocoes/gerar-sugestoes', (req, res) => {
  const { produto_ids = [], desconto_percentual = 15 } = req.body;

  // Validar desconto percentual
  if (desconto_percentual < 1 || desconto_percentual > 100) {
    return res.status(400).json({ error: 'Desconto deve estar entre 1% e 100%' });
  }

  // Limpar sugestões antigas (mais de 30 dias)
  db.run(`
    DELETE FROM promocoes_sugestoes 
    WHERE ativo = 1 
      AND aceito_em IS NULL 
      AND rejeitado_em IS NULL 
      AND julianday('now') - julianday(criado_em) > 30
  `, (deleteErr) => {
    if (deleteErr) {
      console.error('Erro ao limpar sugestões antigas:', deleteErr.message);
    }
  });

  // Determinar quais produtos processar
  let query = `
    SELECT DISTINCT p.id
    FROM produtos p
    WHERE 
      p.controlar_validade = 1 
      AND p.data_validade IS NOT NULL 
      AND p.data_validade != ''
      AND date(p.data_validade) >= date('now', 'localtime')
      AND CAST(julianday(date(p.data_validade)) - julianday(date('now', 'localtime')) AS INTEGER) <= COALESCE(NULLIF(p.dias_alerta_validade, 0), 30)
      AND p.id NOT IN (
        SELECT produto_id FROM promocoes_sugestoes 
        WHERE motivo = 'vencimento_proximo' 
          AND ativo = 1 
          AND aceito_em IS NULL 
          AND rejeitado_em IS NULL
      )
  `;

  // Se foram selecionados produtos específicos, filtrar apenas eles
  if (Array.isArray(produto_ids) && produto_ids.length > 0) {
    const placeholders = produto_ids.map(() => '?').join(',');
    query += ` AND p.id IN (${placeholders})`;
  }

  db.all(query, produto_ids, (err, produtos) => {
    if (err) {
      console.error('Erro ao buscar produtos para sugestão:', err.message);
      return res.status(500).json({ error: err.message });
    }

    if (!produtos || produtos.length === 0) {
      return res.json({ 
        message: 'Nenhuma sugestão gerada. Nenhum produto com validade próxima encontrado.',
        total: 0 
      });
    }

    let inseridas = 0;
    const totalProdutos = produtos.length;
    let processados = 0;

    produtos.forEach(p => {
      db.all(`
        SELECT 
          id,
          nome,
          preco_venda,
          estoque_atual,
          data_validade,
          dias_alerta_validade
        FROM produtos 
        WHERE id = ?
      `, [p.id], (err2, rows) => {
        processados++;

        if (err2 || !rows || rows.length === 0) {
          if (processados === totalProdutos) {
            res.json({ 
              message: `Sugestões geradas com sucesso. Total: ${inseridas}`,
              total: inseridas 
            });
          }
          return;
        }

        const prod = rows[0];
        const diasParaVencer = Math.floor(
          (new Date(prod.data_validade) - new Date()) / (1000 * 60 * 60 * 24)
        );

        const preco_sugerido = (prod.preco_venda * (1 - desconto_percentual / 100)).toFixed(2);

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
        `, [p.id, 'vencimento_proximo', diasParaVencer, prod.estoque_atual, prod.preco_venda, preco_sugerido, desconto_percentual], (insertErr) => {
          if (!insertErr) inseridas++;

          // Se é o último produto, enviar resposta
          if (processados === totalProdutos) {
            res.json({ 
              message: `Sugestões geradas com sucesso. Total: ${inseridas}`,
              total: inseridas 
            });
          }
        });
      });
    });
  });
});

// Buscar produto por ID trazendo o nome da categoria
// Buscar produto por ID trazendo o nome da categoria e subcategoria
router.get('/:id', (req, res) => {
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
    res.json({
      ...row,
      categoria: row.categoria_nome || '',
      subcategoria: row.subcategoria_nome || ''
    });
  });
});

// Criar produto
router.post('/', (req, res) => {
  const {
    codigo, nome, categoria_id, subcategoria_id, unidade, preco_compra,
    lucro_percentual, preco_venda, estoque_atual, estoque_minimo, fornecedor,
    ncm, cfop, csosn, origem, cest, codigo_barras,
    aliquota_icms, aliquota_pis, aliquota_cofins,
    data_validade, lote, dias_alerta_validade, controlar_validade,
    vendido_por_peso, peso_total_compra, valor_total_compra, custo_por_kg,
    venda_atacado
  } = req.body;

  db.run(`
    INSERT INTO produtos (
      codigo, nome, categoria_id, subcategoria_id, unidade,
      preco_compra, lucro_percentual, preco_venda,
      estoque_atual, estoque_minimo, fornecedor,
      ncm, cfop, csosn, origem, cest, codigo_barras,
      aliquota_icms, aliquota_pis, aliquota_cofins,
      data_validade, lote, dias_alerta_validade, controlar_validade,
      vendido_por_peso, peso_total_compra, valor_total_compra, custo_por_kg,
      venda_atacado
    )
    VALUES (${Array(29).fill('?').join(', ')})
  `, [
    codigo, nome, categoria_id, subcategoria_id, unidade,
    preco_compra, lucro_percentual, preco_venda,
    estoque_atual || 0, estoque_minimo || 0, fornecedor,
    ncm, cfop, csosn, origem, cest, codigo_barras,
    aliquota_icms, aliquota_pis, aliquota_cofins,
    data_validade || null,
    lote || '',
    dias_alerta_validade || 30,
    controlar_validade ? 1 : 0,
    vendido_por_peso || 0,
    peso_total_compra || 0,
    valor_total_compra || 0,
    custo_por_kg || 0,
    venda_atacado ? 1 : 0
  ],
    function(err) {
      if (err) {
        console.error('Erro ao criar produto:', err.message);
        res.status(500).json({ error: err.message });
        return;
      }
      // Buscar o produto recém-criado já com nomes de categoria e subcategoria
      db.get(`
        SELECT 
          p.*, 
          c.nome AS categoria_nome, 
          s.nome AS subcategoria_nome
        FROM produtos p
        LEFT JOIN categorias c ON c.id = p.categoria_id
        LEFT JOIN subcategorias s ON s.id = p.subcategoria_id
        WHERE p.id = ?
      `, [this.lastID], (err2, row) => {
        if (err2) {
          res.status(500).json({ error: err2.message });
          return;
        }
        res.json({
          ...row,
          categoria: row.categoria_nome || '',
          subcategoria: row.subcategoria_nome || '',
          message: 'Produto criado com sucesso'
        });
      });
    });
});

// Atualizar produto
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  db.get('SELECT * FROM produtos WHERE id = ?', [id], (err, old) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (!old) {
      res.status(404).json({ error: 'Produto não encontrado' });
      return;
    }

    const fields = [];
    const values = [];

    Object.keys(updates).forEach(key => {
      if (key !== 'id' && key !== 'created_at') {
        fields.push(`${key} = ?`);
        values.push(updates[key]);
      }
    });

    values.push(id);

    db.run(`
      UPDATE produtos
      SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, values, function(updateErr) {
      if (updateErr) {
        res.status(500).json({ error: updateErr.message });
        return;
      }

      const novoPc = updates.preco_compra !== undefined ? updates.preco_compra : old.preco_compra;
      const novoPv = updates.preco_venda !== undefined ? updates.preco_venda : old.preco_venda;
      const mudouCompra = Number(novoPc) !== Number(old.preco_compra);
      const mudouVenda = Number(novoPv) !== Number(old.preco_venda);

      function responderComProdutoAtualizado() {
        db.get(`
          SELECT 
            p.*,
            c.nome AS categoria_nome,
            s.nome AS subcategoria_nome
          FROM produtos p
          LEFT JOIN categorias c ON c.id = p.categoria_id
          LEFT JOIN subcategorias s ON s.id = p.subcategoria_id
          WHERE p.id = ?
        `, [id], (err2, row) => {
          if (err2) {
            return res.status(500).json({ error: err2.message });
          }
          res.json({
            ...row,
            categoria: row.categoria_nome || '',
            subcategoria: row.subcategoria_nome || ''
          });
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
    res.json({ message: 'Produto deletado com sucesso' });
  });
});

// Buscar produtos com estoque baixo
router.get('/estoque/baixo', (req, res) => {
  db.all(`
    SELECT * FROM produtos 
    WHERE estoque_atual <= estoque_minimo 
    ORDER BY (estoque_atual / NULLIF(estoque_minimo, 0)) ASC
  `, (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
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