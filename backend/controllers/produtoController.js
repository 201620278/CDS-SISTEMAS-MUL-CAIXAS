const db = require('../database');
const { buscarPermissoesUsuario } = require('../rotas/auth');

// Função para verificar permissão de gerenciar faixas de atacado
function podeGerenciarFaixaAtacado(req) {
  const role = req.user?.role || 'operador';
  // Admin e supervisor têm acesso automático
  if (['admin', 'supervisor'].includes(role)) {
    return Promise.resolve(true);
  }
  // Operadores precisam ter a permissão específica
  return new Promise((resolve) => {
    buscarPermissoesUsuario(req.user?.id, (err, permissoes) => {
      if (err) {
        resolve(false);
        return;
      }
      resolve(Array.isArray(permissoes) && permissoes.includes('gerenciar_faixa_atacado'));
    });
  });
}

// Função para calcular valor por KG
const calcularValorKg = (preco, unidade, vendido_por_peso) => {
  if (vendido_por_peso === 1 && preco && unidade === 'kg') {
    return parseFloat(preco);
  }
  return null;
};

// LISTAR PRODUTOS
exports.listarProdutos = (req, res) => {
  db.all(`
    SELECT 
      p.*,
      c.nome AS categoria_nome,
      s.nome AS subcategoria_nome
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
};

// Buscar produto por código
exports.buscarProdutoPorCodigo = (req, res) => {
  const { codigo } = req.params;
  db.get('SELECT * FROM produtos WHERE codigo = ?', [codigo], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(row);
  });
};

// Histórico de preços do produto
exports.historicoPrecos = (req, res) => {
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
};

// Relatório de estoque de produtos com data de compra
exports.relatorioEstoque = (req, res) => {
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
      ) AS ultima_compra_data
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
};

// Buscar produto por ID trazendo o nome da categoria e subcategoria
exports.buscarProdutoPorId = (req, res) => {
  db.get(`
    SELECT 
      p.*, 
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
};

// Criar produto
exports.criarProduto = (req, res) => {
  const {
    codigo, nome, categoria_id, subcategoria_id, unidade, preco_compra,
    lucro_percentual, preco_venda, estoque_atual, estoque_minimo, fornecedor,
    ncm, cfop, csosn, origem, cest, codigo_barras,
    aliquota_icms, aliquota_pis, aliquota_cofins, vendido_por_peso, unidade_venda, peso_peca, preco_kg
  } = req.body;

  // Calcular valor por KG
  const valor_por_kg = calcularValorKg(preco_compra, unidade, vendido_por_peso);

  db.run(`
    INSERT INTO produtos (
      codigo, nome, categoria_id, subcategoria_id, unidade,
      preco_compra, lucro_percentual, preco_venda,
      estoque_atual, estoque_minimo, fornecedor,
      ncm, cfop, csosn, origem, cest, codigo_barras,
      aliquota_icms, aliquota_pis, aliquota_cofins, vendido_por_peso, unidade_venda, valor_por_kg, peso_peca, preco_kg
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    codigo, nome, categoria_id, subcategoria_id, unidade,
    preco_compra, lucro_percentual, preco_venda,
    estoque_atual || 0, estoque_minimo || 0, fornecedor,
    ncm, cfop, csosn, origem, cest, codigo_barras,
    aliquota_icms, aliquota_pis, aliquota_cofins, vendido_por_peso || 0, unidade_venda || 'UN', valor_por_kg, peso_peca || 0, preco_kg || 0
  ],
    function(err) {
      if (err) {
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
        // Se vierem faixas de atacado no payload, persistir
        const faixas = req.body.atacado_faixas;
        if (Array.isArray(faixas) && faixas.length > 0) {
          // Verificar permissão: admin/supervisor OU tendo a permissão específica
          podeGerenciarFaixaAtacado(req).then((podeGerir) => {
            if (!podeGerir) {
              return res.status(403).json({ error: 'Você não tem permissão para gerenciar faixas de atacado.' });
            }

            const produtoId = this.lastID;
            // inserir faixas
            const stmt = db.prepare('INSERT INTO produto_atacado (produto_id, quantidade_minima, preco_atacado) VALUES (?, ?, ?)');
            faixas.forEach(f => {
              const q = parseInt(f.quantidade_minima, 10) || 0;
              const p = parseFloat(f.preco_atacado) || 0;
              if (q > 0 && p > 0) {
                stmt.run(produtoId, q, p);
              }
            });
            stmt.finalize(() => {
              db.get(`
                SELECT 
                  p.*, 
                  c.nome AS categoria_nome, 
                  s.nome AS subcategoria_nome
                FROM produtos p
                LEFT JOIN categorias c ON c.id = p.categoria_id
                LEFT JOIN subcategorias s ON s.id = p.subcategoria_id
                WHERE p.id = ?
              `, [produtoId], (err3, row2) => {
                if (err3) return res.status(500).json({ error: err3.message });
                res.json({
                  ...row2,
                  categoria: row2.categoria_nome || '',
                  subcategoria: row2.subcategoria_nome || '',
                  message: 'Produto criado com sucesso'
                });
              });
            });
          }).catch(() => {
            res.status(500).json({ error: 'Erro ao verificar permissões' });
          });
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
};

// Atualizar produto
exports.atualizarProduto = (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  // Calcular valor por KG se for atualização de campos relevantes
  if (updates.preco_compra !== undefined || updates.unidade !== undefined || updates.vendido_por_peso !== undefined) {
    const preco_compra = updates.preco_compra !== undefined ? updates.preco_compra : (req.body.preco_compra || 0);
    const unidade = updates.unidade !== undefined ? updates.unidade : (req.body.unidade || '');
    const vendido_por_peso = updates.vendido_por_peso !== undefined ? updates.vendido_por_peso : (req.body.vendido_por_peso || 0);
    
    updates.valor_por_kg = calcularValorKg(preco_compra, unidade, vendido_por_peso);
  }

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
          // após registrar histórico, tratar faixas (se houver) e então responder
          const faixas = req.body.atacado_faixas;
          function handleFaixasThenRespond(done) {
            if (!Array.isArray(faixas)) return done();
            podeGerenciarFaixaAtacado(req).then((podeGerir) => {
              if (!podeGerir) return done();
              db.run('DELETE FROM produto_atacado WHERE produto_id = ?', [id], (delErr) => {
                if (delErr) console.error('Erro ao deletar faixas antigas:', delErr);
                const stmt = db.prepare('INSERT INTO produto_atacado (produto_id, quantidade_minima, preco_atacado) VALUES (?, ?, ?)');
                faixas.forEach(f => {
                  const q = parseInt(f.quantidade_minima, 10) || 0;
                  const p = parseFloat(f.preco_atacado) || 0;
                  if (q > 0 && p > 0) stmt.run(id, q, p);
                });
                stmt.finalize(done);
              });
            }).catch(() => done());
          }

          handleFaixasThenRespond(responderComProdutoAtualizado);
        });
      } else {
        const faixas = req.body.atacado_faixas;
        function handleFaixasThenRespond(done) {
          if (!Array.isArray(faixas)) return done();
          podeGerenciarFaixaAtacado(req).then((podeGerir) => {
            if (!podeGerir) return done();
            db.run('DELETE FROM produto_atacado WHERE produto_id = ?', [id], (delErr) => {
              if (delErr) console.error('Erro ao deletar faixas antigas:', delErr);
              const stmt = db.prepare('INSERT INTO produto_atacado (produto_id, quantidade_minima, preco_atacado) VALUES (?, ?, ?)');
              faixas.forEach(f => {
                const q = parseInt(f.quantidade_minima, 10) || 0;
                const p = parseFloat(f.preco_atacado) || 0;
                if (q > 0 && p > 0) stmt.run(id, q, p);
              });
              stmt.finalize(done);
            });
          }).catch(() => done());
        }

        handleFaixasThenRespond(responderComProdutoAtualizado);
      }
    });
  });
};

// Deletar produto
exports.deletarProduto = (req, res) => {
  const { id } = req.params;
  db.run('DELETE FROM produtos WHERE id = ?', [id], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ message: 'Produto deletado com sucesso' });
  });
};

// Buscar produtos com estoque baixo
exports.buscarEstoqueBaixo = (req, res) => {
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
};
