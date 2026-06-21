const db = require('../database');

/**
 * Service para controle de lotes e validade (FEFO - First Expire, First Out)
 */

// Gerar próximo número de lote automaticamente
function gerarProximoLote(callback) {
  const sql = `
    SELECT lote
    FROM produtos_lotes
    WHERE lote LIKE 'LT%'
    ORDER BY CAST(SUBSTR(lote, 3) AS INTEGER) DESC
    LIMIT 1
  `;

  db.get(sql, [], (err, row) => {
    if (err) return callback(err);

    let proximoNumero = 1;
    if (row && row.lote) {
      const numeroAtual = parseInt(row.lote.replace('LT', ''), 10);
      proximoNumero = numeroAtual + 1;
    }

    const loteGerado = 'LT' + String(proximoNumero).padStart(6, '0');
    callback(null, loteGerado);
  });
}

// Criar um novo lote para um produto
function criarLote(dados, callback) {
  const {
    produto_id,
    lote,
    quantidade_inicial,
    data_fabricacao,
    data_validade,
    data_entrada,
    origem = 'COMPRA',
    compra_id = null
  } = dados;

  // Se lote não fornecido, gerar automaticamente
  if (!lote) {
    return gerarProximoLote((err, loteGerado) => {
      if (err) return callback(err);
      criarLoteComLoteGerado({ ...dados, lote: loteGerado }, callback);
    });
  }

  criarLoteComLoteGerado(dados, callback);
}

function criarLoteComLoteGerado(dados, callback) {
  const {
    produto_id,
    lote,
    quantidade_inicial,
    data_fabricacao,
    data_validade,
    data_entrada,
    origem = 'COMPRA',
    compra_id = null
  } = dados;

  if (!produto_id || !lote || !quantidade_inicial || !data_validade || !data_entrada) {
    return callback(new Error('Campos obrigatórios: produto_id, lote, quantidade_inicial, data_validade, data_entrada'));
  }

  const sql = `
    INSERT INTO produtos_lotes (
      produto_id, lote, quantidade_inicial, quantidade_atual,
      data_fabricacao, data_validade, data_entrada, origem, compra_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.run(sql, [
    produto_id,
    lote,
    quantidade_inicial,
    quantidade_inicial,
    data_fabricacao || null,
    data_validade,
    data_entrada,
    origem,
    compra_id
  ], function(err) {
    if (err) return callback(err);
    callback(null, { id: this.lastID, ...dados });
  });
}

// Buscar lotes ativos de um produto, ordenados por validade (FEFO)
function buscarLotesProduto(produtoId, callback) {
  const sql = `
    SELECT 
      pl.*,
      p.nome as produto_nome,
      CAST(julianday(date(pl.data_validade)) - julianday(date('now', 'localtime')) AS INTEGER) AS dias_para_vencer,
      CASE
        WHEN date(pl.data_validade) < date('now', 'localtime') THEN 'vencido'
        WHEN date(pl.data_validade) <= date('now', 'localtime', '+30 days') THEN 'proximo'
        ELSE 'ok'
      END AS status_validade
    FROM produtos_lotes pl
    INNER JOIN produtos p ON p.id = pl.produto_id
    WHERE pl.produto_id = ? 
      AND pl.ativo = 1 
      AND pl.quantidade_atual > 0
    ORDER BY pl.data_validade ASC
  `;

  db.all(sql, [produtoId], (err, rows) => {
    if (err) return callback(err);
    callback(null, rows || []);
  });
}

// Consumir lotes usando FEFO (First Expire, First Out)
function consumirLotesFEFO(produtoId, quantidade, callback) {
  buscarLotesProduto(produtoId, (err, lotes) => {
    if (err) return callback(err);

    if (!lotes || lotes.length === 0) {
      return callback(new Error('Não há lotes disponíveis para este produto'));
    }

    const totalDisponivel = lotes.reduce((sum, l) => sum + l.quantidade_atual, 0);

    if (totalDisponivel < quantidade) {
      return callback(new Error(`Estoque insuficiente. Disponível: ${totalDisponivel}, Solicitado: ${quantidade}`));
    }

    const consumo = [];
    let quantidadeRestante = quantidade;
    let indice = 0;

    function consumirProximo() {
      if (quantidadeRestante <= 0 || indice >= lotes.length) {
        return callback(null, consumo);
      }

      const lote = lotes[indice];
      const quantidadeConsumir = Math.min(quantidadeRestante, lote.quantidade_atual);

      db.run(`
        UPDATE produtos_lotes
        SET quantidade_atual = quantidade_atual - ?,
            atualizado_em = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [quantidadeConsumir, lote.id], (err) => {
        if (err) return callback(err);

        consumo.push({
          produto_lote_id: lote.id,
          lote: lote.lote,
          quantidade: quantidadeConsumir,
          data_validade: lote.data_validade
        });

        quantidadeRestante -= quantidadeConsumir;
        indice++;
        consumirProximo();
      });
    }

    consumirProximo();
  });
}

// Registrar quais lotes foram consumidos em uma venda
function registrarConsumoVenda(vendaItemId, consumoLotes, callback) {
  if (!consumoLotes || consumoLotes.length === 0) {
    return callback(null);
  }

  let indice = 0;

  function inserirProximo() {
    if (indice >= consumoLotes.length) {
      return callback(null);
    }

    const consumo = consumoLotes[indice];
    indice++;

    db.run(`
      INSERT INTO venda_lotes (venda_item_id, produto_lote_id, quantidade)
      VALUES (?, ?, ?)
    `, [vendaItemId, consumo.produto_lote_id, consumo.quantidade], (err) => {
      if (err) return callback(err);
      inserirProximo();
    });
  }

  inserirProximo();
}

// Restaurar lotes ao cancelar uma venda
function restaurarLotesVenda(vendaItemId, callback) {
  db.all(`
    SELECT produto_lote_id, quantidade
    FROM venda_lotes
    WHERE venda_item_id = ?
  `, [vendaItemId], (err, lotesConsumidos) => {
    if (err) return callback(err);

    if (!lotesConsumidos || lotesConsumidos.length === 0) {
      return callback(null);
    }

    let indice = 0;

    function restaurarProximo() {
      if (indice >= lotesConsumidos.length) {
        // Remover registros de venda_lotes
        db.run(`
          DELETE FROM venda_lotes WHERE venda_item_id = ?
        `, [vendaItemId], (deleteErr) => {
          if (deleteErr) return callback(deleteErr);
          callback(null);
        });
        return;
      }

      const consumo = lotesConsumidos[indice];
      indice++;

      db.run(`
        UPDATE produtos_lotes
        SET quantidade_atual = quantidade_atual + ?,
            atualizado_em = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [consumo.quantidade, consumo.produto_lote_id], (err) => {
        if (err) return callback(err);
        restaurarProximo();
      });
    }

    restaurarProximo();
  });
}

// Buscar lotes vencidos ou próximos do vencimento
function buscarLotesVencendo(diasAviso = 30, callback) {
  const sql = `
    SELECT 
      pl.*,
      p.nome as produto_nome,
      p.codigo as produto_codigo,
      CAST(julianday(date(pl.data_validade)) - julianday(date('now', 'localtime')) AS INTEGER) AS dias_para_vencer,
      CASE
        WHEN date(pl.data_validade) < date('now', 'localtime') THEN 'vencido'
        WHEN date(pl.data_validade) <= date('now', 'localtime', '+' || ? || ' days') THEN 'proximo'
        ELSE 'ok'
      END AS status_validade
    FROM produtos_lotes pl
    INNER JOIN produtos p ON p.id = pl.produto_id
    WHERE pl.ativo = 1 
      AND pl.quantidade_atual > 0
      AND date(pl.data_validade) <= date('now', 'localtime', '+' || ? || ' days')
    ORDER BY pl.data_validade ASC
  `;

  db.all(sql, [diasAviso, diasAviso], (err, rows) => {
    if (err) return callback(err);
    
    const vencidos = (rows || []).filter(r => r.status_validade === 'vencido');
    const proximos = (rows || []).filter(r => r.status_validade === 'proximo');

    callback(null, {
      total: (rows || []).length,
      vencidos: vencidos.length,
      proximos: proximos.length,
      lotes: rows || []
    });
  });
}

// Obter estatísticas de vencimentos para o dashboard
function obterEstatisticasVencimentos(callback) {
  buscarLotesVencendo(30, (err, dados30) => {
    if (err) return callback(err);

    buscarLotesVencendo(7, (err2, dados7) => {
      if (err2) return callback(err2);

      buscarLotesVencendo(0, (err3, dadosVencidos) => {
        if (err3) return callback(err3);

        // Calcular valor financeiro dos produtos vencidos
        const sqlValor = `
          SELECT 
            SUM(pl.quantidade_atual * p.preco_venda) as valor_total
          FROM produtos_lotes pl
          INNER JOIN produtos p ON p.id = pl.produto_id
          WHERE pl.ativo = 1 
            AND pl.quantidade_atual > 0
            AND date(pl.data_validade) < date('now', 'localtime')
        `;

        db.get(sqlValor, [], (err4, valorRow) => {
          if (err4) return callback(err4);

          callback(null, {
            vencendo_30_dias: dados30.total,
            vencendo_7_dias: dados7.total,
            vencidos: dadosVencidos.vencidos,
            valor_vencidos: valorRow?.valor_total || 0
          });
        });
      });
    });
  });
}

// Verificar se produto controla validade
function produtoControlaValidade(produtoId, callback) {
  db.get(`
    SELECT controlar_validade FROM produtos WHERE id = ?
  `, [produtoId], (err, row) => {
    if (err) return callback(err);
    if (!row) return callback(new Error('Produto não encontrado'));
    callback(null, row.controlar_validade === 1);
  });
}

// Atualizar estoque consolidado do produto baseado nos lotes
function atualizarEstoqueConsolidado(produtoId, callback) {
  const sql = `
    UPDATE produtos
    SET estoque_atual = (
      SELECT COALESCE(SUM(quantidade_atual), 0)
      FROM produtos_lotes
      WHERE produto_id = ? AND ativo = 1
    ),
    updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `;

  db.run(sql, [produtoId, produtoId], callback);
}

// Obter configurações de validade
function obterConfiguracoesValidade(callback) {
  db.get(`
    SELECT * FROM configuracoes_validade LIMIT 1
  `, [], (err, row) => {
    if (err) return callback(err);
    callback(null, row || {
      dias_aviso_vencimento: 30,
      bloquear_venda_vencido: 0,
      alertar_venda_proximo_vencimento: 1
    });
  });
}

// Atualizar configurações de validade
function atualizarConfiguracoesValidade(dados, callback) {
  const { dias_aviso_vencimento, bloquear_venda_vencido, alertar_venda_proximo_vencimento } = dados;

  db.run(`
    UPDATE configuracoes_validade
    SET dias_aviso_vencimento = ?,
        bloquear_venda_vencido = ?,
        alertar_venda_proximo_vencimento = ?,
        atualizado_em = CURRENT_TIMESTAMP
    WHERE id = 1
  `, [dias_aviso_vencimento, bloquear_venda_vencido, alertar_venda_proximo_vencimento], callback);
}

module.exports = {
  gerarProximoLote,
  criarLote,
  buscarLotesProduto,
  consumirLotesFEFO,
  registrarConsumoVenda,
  restaurarLotesVenda,
  buscarLotesVencendo,
  obterEstatisticasVencimentos,
  produtoControlaValidade,
  atualizarEstoqueConsolidado,
  obterConfiguracoesValidade,
  atualizarConfiguracoesValidade
};
