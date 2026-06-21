const express = require('express');
const router = express.Router();
const db = require('../database');
const moment = require('moment');
const multer = require('multer');
const { gravarAuditoria } = require('../services/auditoria');
const { validarCaixaAberto } = require('../middleware/validarCaixaAberto');
const lotesService = require('../services/lotesService');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const { emitirNFeDevolucaoCompra } = require('../services/fiscal/nfeDevolucaoCompra');

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

function toDate(value, fallback = agoraLocalBrasil().slice(0, 10)) {
  return value ? moment(value).format('YYYY-MM-DD') : fallback;
}

function addMonths(date, months) {
  return moment(date).add(months, 'months').format('YYYY-MM-DD');
}

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

function createSlugCodigo(nome = '') {
  return String(nome)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .toUpperCase();
}

function moeda(value) {
  const numero = Number(value || 0);
  return Number.isFinite(numero) ? Math.round(numero * 100) / 100 : 0;
}

function calcularRateioItens(itens, totais = {}) {
  const valorProdutos = moeda(
    itens.reduce((sum, item) => sum + moeda(item.subtotal), 0)
  );

  const frete = moeda(totais.valor_frete);
  const desconto = moeda(totais.valor_desconto);
  const outras = moeda(totais.valor_outras_despesas);

  return itens.map((item) => {
    const subtotal = moeda(item.subtotal);
    const proporcao = valorProdutos > 0 ? subtotal / valorProdutos : 0;

    const freteRateado = moeda(frete * proporcao);
    const descontoRateado = moeda(desconto * proporcao);
    const outrasRateado = moeda(outras * proporcao);

    const quantidade = Number(item.quantidade || 0);
    const custoTotalFinal = moeda(subtotal + freteRateado + outrasRateado - descontoRateado);
    const custoUnitarioFinal = quantidade > 0 ? moeda(custoTotalFinal / quantidade) : moeda(item.preco_unitario);

    return {
      ...item,
      frete_rateado: freteRateado,
      desconto_rateado: descontoRateado,
      outras_despesas_rateado: outrasRateado,
      custo_unitario_final: custoUnitarioFinal
    };
  });
}

function garantirFornecedorCompra(dados, callback) {
  const nome = String(dados.fornecedor || '').trim();
  const cnpj = digitsOnly(dados.fornecedor_cnpj || '');

  if (!nome) return callback(null);

  if (!cnpj) return callback(null);

  db.get(`
    SELECT id FROM fornecedores 
    WHERE REPLACE(REPLACE(REPLACE(REPLACE(cpf_cnpj, '.', ''), '/', ''), '-', ''), ' ', '') = ?
    LIMIT 1
  `, [cnpj], (err, existente) => {
    if (err) return callback(err);
    if (existente) return callback(null);

    db.run(`
      INSERT INTO fornecedores (
        nome, razao_social, cpf_cnpj, rua, numero, bairro, cidade, uf, cep, observacoes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      nome,
      nome,
      cnpj,
      dados.fornecedor_rua || null,
      dados.fornecedor_numero || null,
      dados.fornecedor_bairro || null,
      dados.fornecedor_cidade || null,
      dados.fornecedor_uf || null,
      dados.fornecedor_cep || null,
      'Fornecedor cadastrado automaticamente pela importação de XML de compra.'
    ], callback);
  });
}

function criarFinanceiroCompra(compra, callback) {
  const {
    id,
    data_compra,
    fornecedor,
    total,
    condicao_pagamento,
    forma_pagamento,
    data_vencimento,
    parcelas,
    valor_entrada,
    observacao
  } = compra;

  const qtdParcelas = Math.max(1, Number(parcelas) || 1);
  const valorTotal = Number(total) || 0;
  const descricaoBase = `Compra ${id}${fornecedor ? ` - ${fornecedor}` : ''}`;
  const vencimentoBase = toDate(data_vencimento, data_compra);

  db.run('DELETE FROM financeiro WHERE compra_id = ?', [id], (deleteErr) => {
    if (deleteErr) return callback(deleteErr);

    const inserir = (payload, done) => {
      db.run(`
        INSERT INTO financeiro (
          tipo, descricao, valor, data_movimento, categoria, forma_pagamento,
          referencia_id, referencia_tipo, status, origem, documento, vencimento,
          numero_parcela, total_parcelas, compra_id, pessoa_nome, observacao, baixado_em
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        'despesa',
        payload.descricao,
        payload.valor,
        data_compra,
        'compras',
        forma_pagamento || null,
        id,
        'compra',
        payload.status,
        'compra',
        null,
        payload.vencimento,
        payload.numero_parcela,
        payload.total_parcelas,
        id,
        fornecedor || null,
        observacao || null,
        payload.status === 'pago' ? data_compra : null
      ], done);
    };

    if (condicao_pagamento === 'parcelado' && qtdParcelas > 1) {
      const valorBase = Math.floor((valorTotal / qtdParcelas) * 100) / 100;
      const resto = Math.round((valorTotal - (valorBase * qtdParcelas)) * 100) / 100;
      let pendentes = qtdParcelas;
      for (let i = 1; i <= qtdParcelas; i++) {
        const valorParcela = Number((valorBase + (i === qtdParcelas ? resto : 0)).toFixed(2));
        inserir({
          descricao: `${descricaoBase} - Parcela ${i}/${qtdParcelas}`,
          valor: valorParcela,
          vencimento: addMonths(vencimentoBase, i - 1),
          numero_parcela: i,
          total_parcelas: qtdParcelas,
          status: 'pendente'
        }, (err) => {
          if (err) return callback(err);
          pendentes -= 1;
          if (pendentes === 0) callback(null);
        });
      }
      return;
    }

    if (condicao_pagamento === 'entrada_parcelado' && qtdParcelas > 0 && valor_entrada > 0) {
      const totalParcelas = qtdParcelas + 1;
      let pendentes = totalParcelas;
      // Entrada
      inserir({
        descricao: `${descricaoBase} - Entrada`,
        valor: valor_entrada,
        vencimento: data_compra,
        numero_parcela: 1,
        total_parcelas: totalParcelas,
        status: 'pago'
      }, (err) => {
        if (err) return callback(err);
        pendentes -= 1;
        if (pendentes === 0) callback(null);
      });
      // Parcelas restantes
      const valorRestante = valorTotal - valor_entrada;
      const valorBase = Math.floor((valorRestante / qtdParcelas) * 100) / 100;
      const resto = Math.round((valorRestante - (valorBase * qtdParcelas)) * 100) / 100;
      for (let i = 1; i <= qtdParcelas; i++) {
        const valorParcela = Number((valorBase + (i === qtdParcelas ? resto : 0)).toFixed(2));
        inserir({
          descricao: `${descricaoBase} - Parcela ${i + 1}/${totalParcelas}`,
          valor: valorParcela,
          vencimento: addMonths(vencimentoBase, i - 1),
          numero_parcela: i + 1,
          total_parcelas: totalParcelas,
          status: 'pendente'
        }, (err) => {
          if (err) return callback(err);
          pendentes -= 1;
          if (pendentes === 0) callback(null);
        });
      }
      return;
    }

    const pagoNaHora = condicao_pagamento === 'avista';
    inserir({
      descricao: descricaoBase,
      valor: valorTotal,
      vencimento: pagoNaHora ? data_compra : vencimentoBase,
      numero_parcela: 1,
      total_parcelas: 1,
      status: pagoNaHora ? 'pago' : 'pendente'
    }, callback);
  });
}

function ensureProductForItem(item, callback) {
  if (item.produto_id) {
    return callback(null, Number(item.produto_id));
  }

  const codigo = item.codigo_barras || createSlugCodigo(item.produto_nome || 'PRODUTO-IMPORTADO');
  const nome = item.produto_nome || `Produto ${codigo}`;

  db.get(
    'SELECT id FROM produtos WHERE codigo = ? OR codigo_barras = ? OR nome = ? LIMIT 1',
    [codigo, codigo, nome],
    (findErr, existente) => {
      if (findErr) return callback(findErr);
      if (existente) return callback(null, existente.id);

      db.run(`
        INSERT INTO produtos (
          codigo, codigo_barras, nome, unidade, preco_compra, preco_venda,
          lucro_percentual, estoque_atual, estoque_minimo, fornecedor, ncm, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, CURRENT_TIMESTAMP)
      `, [
        codigo,
        item.codigo_barras || codigo,
        nome,
        item.unidade || 'UN',
        Number(item.preco_unitario || 0),
        Number(item.preco_venda_sugerido || item.preco_unitario || 0),
        Number(item.margem_lucro || 30),
        item.fornecedor || null,
        item.ncm || null
      ], function(insertErr) {
        if (insertErr) return callback(insertErr);
        callback(null, this.lastID);
      });
    }
  );
}

function processarItensCompra(compraId, itens, fornecedor, done) {
  let index = 0;

  function next() {
    if (index >= itens.length) {
      done(null);
      return;
    }

    const item = itens[index++];
    ensureProductForItem(item, (prodErr, produtoId) => {
      if (prodErr) return done(prodErr);

      db.get('SELECT preco_compra, preco_venda, controlar_validade FROM produtos WHERE id = ?', [produtoId], (getErr, produto) => {
        if (getErr) return done(getErr);

        const antigo = { preco_compra: produto?.preco_compra, preco_venda: produto?.preco_venda };
        const controlarValidade = produto?.controlar_validade === 1;

        db.run(`
          INSERT INTO compras_itens (
            compra_id, produto_id, quantidade, preco_unitario, subtotal,
            descricao_produto, codigo_barras, margem_lucro, preco_venda_sugerido, unidade, ncm,
            frete_rateado, desconto_rateado, outras_despesas_rateado, custo_unitario_final,
            vendido_por_peso, peso_total_compra, custo_por_kg, atualizar_preco_venda
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          compraId,
          produtoId,
          Number(item.quantidade || 0),
          Number(item.preco_unitario || 0),
          Number(item.subtotal || 0),
          item.produto_nome || null,
          item.codigo_barras || null,
          Number(item.margem_lucro || 30),
          Number(item.preco_venda_sugerido || 0),
          item.unidade || 'UN',
          item.ncm || null,
          Number(item.frete_rateado || 0),
          Number(item.desconto_rateado || 0),
          Number(item.outras_despesas_rateado || 0),
          Number(item.custo_unitario_final || item.preco_unitario || 0),
          Number(item.vendido_por_peso || 0),
          Number(item.peso_total_compra || 0),
          Number(item.custo_por_kg || 0),
          Number(item.atualizar_preco_venda ?? 1)
        ], (insertErr) => {
          if (insertErr) return done(insertErr);

          db.run(`
            UPDATE produtos
            SET estoque_atual = estoque_atual + ?,
                preco_compra = ?,
                preco_venda = CASE WHEN ? = 1 THEN ? ELSE preco_venda END,
                lucro_percentual = CASE WHEN ? = 1 THEN ? ELSE lucro_percentual END,
                fornecedor = COALESCE(?, fornecedor),
                ncm = COALESCE(?, ncm),
                codigo_barras = COALESCE(?, codigo_barras),
                unidade = COALESCE(?, unidade),
                vendido_por_peso = CASE WHEN ? = 1 THEN 1 ELSE COALESCE(vendido_por_peso, 0) END,
                peso_total_compra = CASE WHEN ? = 1 THEN ? ELSE COALESCE(peso_total_compra, 0) END,
                valor_total_compra = CASE WHEN ? = 1 THEN ? ELSE COALESCE(valor_total_compra, 0) END,
                custo_por_kg = CASE WHEN ? = 1 THEN ? ELSE COALESCE(custo_por_kg, 0) END,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `, [
            Number(item.quantidade || 0),
            Number(item.custo_unitario_final || item.preco_unitario || 0),

            Number(item.atualizar_preco_venda ?? 1),
            Number(item.preco_venda_sugerido || 0),

            Number(item.atualizar_preco_venda ?? 1),
            Number(item.margem_lucro || 30),

            fornecedor || null,
            item.ncm || null,
            item.codigo_barras || null,
            item.unidade || 'UN',

            Number(item.vendido_por_peso || 0),

            Number(item.vendido_por_peso || 0),
            Number(item.peso_total_compra || item.quantidade || 0),

            Number(item.vendido_por_peso || 0),
            Number(item.subtotal || 0),

            Number(item.vendido_por_peso || 0),
            Number(item.custo_por_kg || item.custo_unitario_final || item.preco_unitario || 0),

            produtoId
          ], (upErr) => {
            if (upErr) return done(upErr);

            // Se o produto controla validade, criar lote
            if (controlarValidade) {
              if (!item.data_validade) {
                return done(new Error(`Produto "${item.produto_nome || produtoId}" controla validade. Informe a data de validade.`));
              }

              const hoje = new Date().toISOString().split('T')[0];

              // Lote gerado automaticamente pelo serviço
              lotesService.criarLote({
                produto_id: produtoId,
                quantidade_inicial: Number(item.quantidade || 0),
                data_validade: item.data_validade,
                data_entrada: hoje,
                origem: 'COMPRA',
                compra_id: compraId
              }, (loteErr) => {
                if (loteErr) {
                  console.error('Erro ao criar lote para compra:', loteErr.message);
                  // Continuar mesmo se o lote falhar, mas logar o erro
                }

                continuarProcessamento();
              });
            } else {
              continuarProcessamento();
            }

            function continuarProcessamento() {
              if (antigo && (Number(antigo.preco_compra) !== Number(item.preco_unitario) || Number(antigo.preco_venda) !== Number(item.preco_venda_sugerido || 0))) {
                db.run(`
                  INSERT INTO produtos_preco_historico (
                    produto_id, preco_compra_anterior, preco_compra_novo, preco_venda_anterior, preco_venda_novo
                  ) VALUES (?, ?, ?, ?, ?)
                `, [produtoId, antigo.preco_compra, item.preco_unitario, antigo.preco_venda, item.preco_venda_sugerido || 0], () => next());
              } else {
                next();
              }
            }
          });
        });
      });
    });
  }

  next();
}

function garantirTabelaDevolucoesCompra(callback) {
  db.run(`
    CREATE TABLE IF NOT EXISTS compras_devolucoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      compra_id INTEGER NOT NULL,
      compra_item_id INTEGER NOT NULL,
      produto_id INTEGER NOT NULL,
      quantidade DECIMAL(10,3) NOT NULL,
      valor_unitario DECIMAL(10,2) NOT NULL,
      valor_total DECIMAL(10,2) NOT NULL,
      motivo TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, callback);
}

router.post('/:id/devolver', validarCaixaAberto, (req, res) => {
  const compraId = Number(req.params.id);
  const motivo = String(req.body?.motivo || '').trim();
  const itens = Array.isArray(req.body?.itens) ? req.body.itens : [];

  if (!motivo || motivo.length < 10) {
    return res.status(400).json({ error: 'Informe um motivo com no mínimo 10 caracteres.' });
  }

  const itensValidos = itens
    .map(i => ({
      compra_item_id: Number(i.compra_item_id),
      quantidade: Number(i.quantidade)
    }))
    .filter(i => i.compra_item_id > 0 && i.quantidade > 0);

  if (!itensValidos.length) {
    return res.status(400).json({ error: 'Informe ao menos um item para devolução.' });
  }

  garantirTabelaDevolucoesCompra((tableErr) => {
    if (tableErr) return res.status(500).json({ error: tableErr.message });

    db.serialize(() => {
      db.run('BEGIN IMMEDIATE');

      db.get('SELECT * FROM compras WHERE id = ?', [compraId], (compraErr, compra) => {
        if (compraErr) {
          db.run('ROLLBACK');
          return res.status(500).json({ error: compraErr.message });
        }

        if (!compra) {
          db.run('ROLLBACK');
          return res.status(404).json({ error: 'Compra não encontrada.' });
        }

        if (String(compra.status || '').toLowerCase() === 'cancelada') {
          db.run('ROLLBACK');
          return res.status(400).json({ error: 'Compra cancelada não pode receber devolução.' });
        }

        let index = 0;
        let valorTotalDevolvido = 0;

        function processarProximo() {
          if (index >= itensValidos.length) return finalizar();

          const itemReq = itensValidos[index++];

          db.get(`
            SELECT
              ci.*,
              COALESCE(p.nome, ci.descricao_produto) AS produto_nome,
              COALESCE(p.estoque_atual, 0) AS estoque_atual,
              COALESCE((
                SELECT SUM(cd.quantidade)
                FROM compras_devolucoes cd
                WHERE cd.compra_item_id = ci.id
              ), 0) AS quantidade_ja_devolvida
            FROM compras_itens ci
            LEFT JOIN produtos p ON p.id = ci.produto_id
            WHERE ci.id = ? AND ci.compra_id = ?
          `, [itemReq.compra_item_id, compraId], (itemErr, item) => {
            if (itemErr) {
              db.run('ROLLBACK');
              return res.status(500).json({ error: itemErr.message });
            }

            if (!item) {
              db.run('ROLLBACK');
              return res.status(404).json({ error: 'Item da compra não encontrado.' });
            }

            const qtdComprada = Number(item.quantidade || 0);
            const qtdJaDevolvida = Number(item.quantidade_ja_devolvida || 0);
            const qtdDisponivel = qtdComprada - qtdJaDevolvida;
            const qtdDevolver = Number(itemReq.quantidade || 0);
            const estoqueAtual = Number(item.estoque_atual || 0);

            if (qtdDevolver > qtdDisponivel) {
              db.run('ROLLBACK');
              return res.status(400).json({
                error: `Produto "${item.produto_nome}" permite devolver no máximo ${qtdDisponivel}.`
              });
            }

            if (estoqueAtual < qtdDevolver) {
              db.run('ROLLBACK');
              return res.status(400).json({
                error: `Estoque insuficiente para devolver "${item.produto_nome}". Estoque atual: ${estoqueAtual}.`
              });
            }

            const valorUnitario = Number(item.custo_unitario_final || item.preco_unitario || 0);
            const valorTotal = Number((qtdDevolver * valorUnitario).toFixed(2));
            valorTotalDevolvido += valorTotal;

            db.run(`
              INSERT INTO compras_devolucoes (
                compra_id, compra_item_id, produto_id, quantidade,
                valor_unitario, valor_total, motivo
              ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [
              compraId,
              item.id,
              item.produto_id,
              qtdDevolver,
              valorUnitario,
              valorTotal,
              motivo
            ], (insertErr) => {
              if (insertErr) {
                db.run('ROLLBACK');
                return res.status(500).json({ error: insertErr.message });
              }

              db.run(`
                UPDATE produtos
                SET estoque_atual = estoque_atual - ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
              `, [qtdDevolver, item.produto_id], (estoqueErr) => {
                if (estoqueErr) {
                  db.run('ROLLBACK');
                  return res.status(500).json({ error: estoqueErr.message });
                }

                processarProximo();
              });
            });
          });
        }

        function finalizar() {
          db.get(`
            SELECT COUNT(*) AS itens_pendentes
            FROM compras_itens ci
            WHERE ci.compra_id = ?
              AND ci.quantidade > COALESCE((
                SELECT SUM(cd.quantidade)
                FROM compras_devolucoes cd
                WHERE cd.compra_item_id = ci.id
              ), 0)
          `, [compraId], (sumErr, sum) => {
            if (sumErr) {
              db.run('ROLLBACK');
              return res.status(500).json({ error: sumErr.message });
            }

            const statusNovo = Number(sum.itens_pendentes || 0) === 0
              ? 'devolvida'
              : 'devolvida_parcial';

            db.run(`
              INSERT INTO financeiro (
                tipo, descricao, valor, data_movimento, categoria, forma_pagamento,
                referencia_id, referencia_tipo, status, origem, documento,
                vencimento, compra_id, pessoa_nome, observacao
              ) VALUES (?, ?, ?, DATE('now','localtime'), ?, ?, ?, ?, ?, ?, ?, DATE('now','localtime'), ?, ?, ?)
            `, [
              'receita',
              `Crédito de devolução da compra ${compraId}`,
              Number(valorTotalDevolvido.toFixed(2)),
              'devolucao_compra',
              null,
              compraId,
              'devolucao_compra',
              'pendente',
              'devolucao_compra',
              null,
              compraId,
              compra.fornecedor || null,
              motivo
            ], (finErr) => {
              if (finErr) {
                db.run('ROLLBACK');
                return res.status(500).json({ error: finErr.message });
              }

              db.run(`
                UPDATE compras
                SET status = ?,
                    observacao = COALESCE(observacao, '') || ?
                WHERE id = ?
              `, [
                statusNovo,
                ` | Devolução: ${motivo}`,
                compraId
              ], (upErr) => {
                if (upErr) {
                  db.run('ROLLBACK');
                  return res.status(500).json({ error: upErr.message });
                }

                db.run('COMMIT');
                // auditoria de devolução (associando sessao de caixa quando aplicável)
                gravarAuditoria({
                  usuario_id: req.operadorId || req.user?.id || null,
                  usuario_nome: req.user?.nome || req.user?.username || null,
                  modulo: 'compras',
                  acao: 'devolucao_compra',
                  referencia_tipo: 'compra',
                  referencia_id: compraId,
                  detalhes: { status_compra: statusNovo, valor_devolvido: Number(valorTotalDevolvido.toFixed(2)), motivo, sessao_id: req.caixaSessaoId || null },
                  ip_requisicao: req.ip || null
                }).catch((auditErr) => console.error('Erro ao gravar auditoria de devolução de compra:', auditErr));

                res.json({
                  success: true,
                  message: statusNovo === 'devolvida'
                    ? 'Compra devolvida totalmente.'
                    : 'Devolução parcial registrada com sucesso.',
                  status_compra: statusNovo,
                  valor_devolvido: Number(valorTotalDevolvido.toFixed(2))
                });
              });
            });
          });
        }

        processarProximo();
      });
    });
  });
});

router.get('/', (req, res) => {
  db.all(`
    SELECT c.*, 
      (SELECT COUNT(*) FROM compras_itens WHERE compra_id = c.id) as total_itens,
      (SELECT COUNT(*) FROM financeiro f WHERE f.compra_id = c.id AND f.status = 'pendente') as parcelas_pendentes
    FROM compras c 
    ORDER BY c.data_compra DESC, c.id DESC
  `, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

router.get('/:id', (req, res) => {
  const { id } = req.params;

  garantirTabelaDevolucoesCompra((tableErr) => {
    if (tableErr) return res.status(500).json({ error: tableErr.message });

    db.get('SELECT * FROM compras WHERE id = ?', [id], (err, compra) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!compra) return res.status(404).json({ error: 'Compra não encontrada.' });

      db.all(`
        SELECT
          ci.*,
          COALESCE(p.nome, ci.descricao_produto) AS produto_nome,
          p.codigo AS produto_codigo,
          COALESCE((
            SELECT SUM(cd.quantidade)
            FROM compras_devolucoes cd
            WHERE cd.compra_item_id = ci.id
          ), 0) AS quantidade_devolvida
        FROM compras_itens ci
        LEFT JOIN produtos p ON ci.produto_id = p.id
        WHERE ci.compra_id = ?
        ORDER BY ci.id
      `, [id], (itErr, itens) => {
        if (itErr) return res.status(500).json({ error: itErr.message });
        db.all('SELECT * FROM financeiro WHERE compra_id = ? ORDER BY numero_parcela, vencimento', [id], (finErr, financeiro) => {
          if (finErr) return res.status(500).json({ error: finErr.message });
          res.json({ ...compra, itens, financeiro });
        });
      });
    });
  });
});

router.post('/', (req, res) => {
  const {
    data_compra,
    data_emissao,
    data_entrada,
    fornecedor,
    fornecedor_cnpj,
    fornecedor_rua,
    fornecedor_numero,
    fornecedor_bairro,
    fornecedor_cidade,
    fornecedor_uf,
    fornecedor_cep,
    numero_nf,
    serie_nf,
    modelo_nf,
    chave_acesso,
    valor_produtos,
    valor_desconto,
    valor_frete,
    valor_outras_despesas,
    valor_total_nota,
    total,
    itens,
    condicao_pagamento,
    forma_pagamento,
    data_vencimento,
    parcelas,
    valor_entrada,
    observacao,
    nota_fiscal_avulsa
  } = req.body;

  const isNotaAvulsa = Number(nota_fiscal_avulsa) === 1;

  if (!isNotaAvulsa) {
    if (!Array.isArray(itens) || itens.length === 0) {
      return res.status(400).json({ error: 'Informe ao menos um item para a compra.' });
    }
  }

  const totalNum = Number(total);
  if (!Number.isFinite(totalNum) || totalNum <= 0) {
    return res.status(400).json({ error: 'Total da compra inválido.' });
  }

  const chaveLimpa = digitsOnly(chave_acesso || '');
  if (chaveLimpa && chaveLimpa.length !== 44) {
    return res.status(400).json({ error: 'A chave de acesso da NF deve ter 44 dígitos.' });
  }

  let totalItensCalculado;
  let totalCalculadoComAjustes;
  let diferencaTotal;
  let itensComRateio;

  if (isNotaAvulsa) {
    totalItensCalculado = moeda(valor_total_nota || totalNum);
    totalCalculadoComAjustes = moeda(valor_total_nota || totalNum);
    diferencaTotal = 0;
    itensComRateio = [];
  } else {
    totalItensCalculado = moeda(
      itens.reduce((sum, item) => sum + moeda(item.subtotal), 0)
    );

    totalCalculadoComAjustes = moeda(
      totalItensCalculado - Number(valor_desconto || 0) + Number(valor_frete || 0) + Number(valor_outras_despesas || 0)
    );

    const totalXml = moeda(valor_total_nota || totalNum);
    diferencaTotal = moeda(totalXml - totalCalculadoComAjustes);

    itensComRateio = calcularRateioItens(itens, {
      valor_frete,
      valor_desconto,
      valor_outras_despesas
    });
  }

  const condicao = condicao_pagamento || 'avista';
  const qtdParcelas = Math.max(1, Number(parcelas) || 1);

  const continuarGravacao = () => {
    db.serialize(() => {
      db.run('BEGIN IMMEDIATE');

      db.run(`
        INSERT INTO compras (
          data_compra, data_emissao, data_entrada, fornecedor, fornecedor_cnpj,
          numero_nf, serie_nf, modelo_nf, chave_acesso,
          valor_produtos, valor_desconto, valor_frete, valor_outras_despesas,
          valor_total_nota, total, total_xml, total_itens_calculado, diferenca_total,
          status, condicao_pagamento, forma_pagamento, data_vencimento,
          parcelas, valor_entrada, observacao, nota_fiscal_avulsa
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'concluida', ?, ?, ?, ?, ?, ?, ?)
      `, [
        data_compra,
        data_emissao || null,
        data_entrada || null,
        fornecedor || null,
        fornecedor_cnpj || null,
        numero_nf || null,
        serie_nf || null,
        modelo_nf || null,
        chaveLimpa || null,
        Number(valor_produtos) || 0,
        Number(valor_desconto) || 0,
        Number(valor_frete) || 0,
        Number(valor_outras_despesas) || 0,
        totalCalculadoComAjustes,
        totalCalculadoComAjustes,
        totalCalculadoComAjustes,
        totalItensCalculado,
        diferencaTotal,
        forma_pagamento || null,
        data_vencimento || (condicao === 'avista' ? data_compra : null),
        condicao === 'parcelado' || condicao === 'entrada_parcelado' ? qtdParcelas : 1,
        Number(valor_entrada) || 0,
        observacao || null,
        isNotaAvulsa ? 1 : 0
      ], function(err) {
        if (err) {
          db.run('ROLLBACK');

          if (String(err.message || '').includes('UNIQUE') || String(err.message || '').includes('compras.chave_acesso')) {
            return res.status(400).json({ error: 'Esta nota já foi lançada. A chave de acesso já existe no sistema.' });
          }

          return res.status(500).json({ error: err.message });
        }

        const compraId = this.lastID;

        if (isNotaAvulsa) {
          // Nota Fiscal Avulsa: skip item processing, only create financial records
          criarFinanceiroCompra({
            id: compraId,
            data_compra,
            fornecedor,
            total: totalCalculadoComAjustes,
            condicao_pagamento: condicao,
            forma_pagamento,
            data_vencimento: data_vencimento || (condicao === 'avista' ? data_compra : null),
            parcelas: (condicao === 'parcelado' || condicao === 'entrada_parcelado') ? qtdParcelas : 1,
            valor_entrada: Number(valor_entrada) || 0,
            observacao
          }, (finErr) => {
            if (finErr) {
              db.run('ROLLBACK');
              return res.status(500).json({ error: finErr.message });
            }

            db.run('COMMIT');

            gravarAuditoria({
              usuario_id: req.user?.id || null,
              usuario_nome: req.user?.nome || req.user?.username || null,
              modulo: 'compras',
              acao: 'criar_nota_fiscal_avulsa',
              referencia_tipo: 'compra',
              referencia_id: compraId,
              detalhes: { total: totalCalculadoComAjustes, fornecedor, nota_fiscal_avulsa: true },
              ip_requisicao: req.ip || null
            }).catch((auditErr) => console.error('Erro ao gravar auditoria de nota fiscal avulsa:', auditErr));

            res.json({
              id: compraId,
              message: 'Nota Fiscal Avulsa registrada com sucesso.',
              nota_fiscal_avulsa: true
            });
          });
        } else {
          // Compra Normal: process items and create financial records
          console.log('Processando itens da compra:', compraId, itensComRateio);
          processarItensCompra(compraId, itensComRateio, fornecedor, (itensErr) => {
            if (itensErr) {
              console.error('Erro ao processar itens da compra:', itensErr);
              db.run('ROLLBACK');
              return res.status(500).json({ error: itensErr.message });
            }

            criarFinanceiroCompra({
              id: compraId,
              data_compra,
              fornecedor,
              total: totalCalculadoComAjustes,
              condicao_pagamento: condicao,
              forma_pagamento,
              data_vencimento: data_vencimento || (condicao === 'avista' ? data_compra : null),
              parcelas: (condicao === 'parcelado' || condicao === 'entrada_parcelado') ? qtdParcelas : 1,
              valor_entrada: Number(valor_entrada) || 0,
              observacao
            }, (finErr) => {
              if (finErr) {
                db.run('ROLLBACK');
                return res.status(500).json({ error: finErr.message });
              }

              db.run('COMMIT');

              gravarAuditoria({
                usuario_id: req.user?.id || null,
                usuario_nome: req.user?.nome || req.user?.username || null,
                modulo: 'compras',
                acao: 'criar_compra',
                referencia_tipo: 'compra',
                referencia_id: compraId,
                detalhes: { total: totalCalculadoComAjustes, fornecedor },
                ip_requisicao: req.ip || null
              }).catch((auditErr) => console.error('Erro ao gravar auditoria de criação de compra:', auditErr));

              res.json({
                id: compraId,
                message: 'Compra registrada com sucesso e integrada ao estoque/financeiro.',
                conferencia: {
                  total_xml: totalCalculadoComAjustes,
                  total_itens_calculado: totalItensCalculado,
                  diferenca_total: diferencaTotal
                }
              });
            });
          });
        }
      });
    });
  }

  if (chaveLimpa) {
    db.get('SELECT id, status FROM compras WHERE chave_acesso = ? LIMIT 1', [chaveLimpa], (dupErr, existente) => {
      if (dupErr) return res.status(500).json({ error: dupErr.message });

      if (existente) {
        return res.status(400).json({
          error: `Esta nota já foi lançada na compra #${existente.id}. Não é permitido lançar a mesma chave de acesso duas vezes.` 
        });
      }

      garantirFornecedorCompra({
        fornecedor,
        fornecedor_cnpj,
        fornecedor_rua,
        fornecedor_numero,
        fornecedor_bairro,
        fornecedor_cidade,
        fornecedor_uf,
        fornecedor_cep
      }, (fornErr) => {
        if (fornErr) return res.status(500).json({ error: fornErr.message });
        continuarGravacao();
      });
    });
  } else {
    garantirFornecedorCompra({
      fornecedor,
      fornecedor_cnpj,
      fornecedor_rua,
      fornecedor_numero,
      fornecedor_bairro,
      fornecedor_cidade,
      fornecedor_uf,
      fornecedor_cep
    }, (fornErr) => {
      if (fornErr) return res.status(500).json({ error: fornErr.message });
      continuarGravacao();
    });
  }
});

router.post('/:id/cancelar', (req, res) => {
  const { id } = req.params;
  const motivo = String(req.body?.motivo || 'Cancelamento manual da compra').trim();

  db.serialize(() => {
    db.run('BEGIN IMMEDIATE');

    db.get('SELECT * FROM compras WHERE id = ?', [id], (compraErr, compra) => {
      if (compraErr) {
        db.run('ROLLBACK');
        return res.status(500).json({ error: compraErr.message });
      }

      if (!compra) {
        db.run('ROLLBACK');
        return res.status(404).json({ error: 'Compra não encontrada.' });
      }

      if (compra.status === 'cancelada') {
        db.run('ROLLBACK');
        return res.status(400).json({ error: 'Esta compra já está cancelada.' });
      }

      db.all('SELECT * FROM compras_itens WHERE compra_id = ?', [id], (itensErr, itens) => {
        if (itensErr) {
          db.run('ROLLBACK');
          return res.status(500).json({ error: itensErr.message });
        }

        const validarEstoque = (index = 0) => {
          if (index >= itens.length) return baixarEstoque();

          const item = itens[index];

          db.get('SELECT nome, estoque_atual FROM produtos WHERE id = ?', [item.produto_id], (prodErr, produto) => {
            if (prodErr) {
              db.run('ROLLBACK');
              return res.status(500).json({ error: prodErr.message });
            }

            const estoqueAtual = Number(produto?.estoque_atual || 0);
            const quantidadeBaixar = Number(item.quantidade || 0);

            if (estoqueAtual < quantidadeBaixar) {
              db.run('ROLLBACK');
              return res.status(400).json({
                error: `Não é possível cancelar. O produto "${produto?.nome || item.descricao_produto}" tem estoque atual ${estoqueAtual}, mas a compra adicionou ${quantidadeBaixar}.` 
              });
            }

            validarEstoque(index + 1);
          });
        };

        const baixarEstoque = (index = 0) => {
          if (index >= itens.length) return finalizarCancelamento();

          const item = itens[index];

          db.run(`
            UPDATE produtos
            SET estoque_atual = estoque_atual - ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `, [Number(item.quantidade || 0), item.produto_id], (upErr) => {
            if (upErr) {
              db.run('ROLLBACK');
              return res.status(500).json({ error: upErr.message });
            }

            baixarEstoque(index + 1);
          });
        };

        const finalizarCancelamento = () => {
          db.run(`
            UPDATE financeiro
            SET status = 'cancelado',
                observacao = COALESCE(observacao, '') || ' | Cancelado junto com a compra.'
            WHERE compra_id = ?
          `, [id], (finErr) => {
            if (finErr) {
              db.run('ROLLBACK');
              return res.status(500).json({ error: finErr.message });
            }

            db.run(`
              UPDATE compras
              SET status = 'cancelada',
                  cancelada_em = CURRENT_TIMESTAMP,
                  motivo_cancelamento = ?
              WHERE id = ?
            `, [motivo, id], (compraUpErr) => {
              if (compraUpErr) {
                db.run('ROLLBACK');
                return res.status(500).json({ error: compraUpErr.message });
              }

              db.run('COMMIT');
              // gravar auditoria do cancelamento
              gravarAuditoria({
                usuario_id: req.user?.id || null,
                usuario_nome: req.user?.nome || req.user?.username || null,
                modulo: 'compras',
                acao: 'cancelar_compra',
                referencia_tipo: 'compra',
                referencia_id: id,
                detalhes: { motivo },
                ip_requisicao: req.ip || null
              }).catch((auditErr) => console.error('Erro ao gravar auditoria de cancelamento de compra:', auditErr));

              res.json({ message: 'Compra cancelada com segurança. Estoque e financeiro foram ajustados.' });
            });
          });
        };

        validarEstoque();
      });
    });
  });
});

router.post('/parse-xml', upload.single('xml'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Arquivo XML não enviado.' });
  }

  const xmlContent = req.file.buffer.toString('utf8');
  const xml2js = require('xml2js');

  xml2js.parseString(xmlContent, { explicitArray: false, ignoreAttrs: false }, (err, result) => {
    if (err) {
      return res.status(400).json({ error: 'Erro ao parsear XML: ' + err.message });
    }

    try {
      const nfe = result.nfeProc?.NFe?.infNFe || result.NFe?.infNFe;
      if (!nfe) {
        return res.status(400).json({ error: 'XML não contém uma NF-e válida.' });
      }

      const ide = nfe.ide;
      const emit = nfe.emit;
      const dest = nfe.dest;
      const transp = nfe.transp;
      const infIntermed = nfe.infIntermed;
      const infRespTec = nfe.infRespTec;
      const det = Array.isArray(nfe.det) ? nfe.det : [nfe.det].filter(Boolean);
      const total = nfe.total?.ICMSTot;
      const transpInfo = nfe.transp;
      const cobr = nfe.cobr;
      const pag = nfe.pag;
      const infAdic = nfe.infAdic;
      const infNFeSupl = nfe.infNFeSupl;

      const chaveAcesso = nfe.$?.Id?.replace('NFe', '') || '';

      const parsed = {
        chave_acesso: chaveAcesso,
        numero_nf: ide?.nNF || '',
        serie_nf: ide?.serie || '',
        modelo_nf: ide?.mod || '55',
        data_emissao: ide?.dhEmi ? moment(ide.dhEmi).format('YYYY-MM-DD') : '',
        data_entrada: ide?.dhSaiEnt ? moment(ide.dhSaiEnt).format('YYYY-MM-DD') : '',
        fornecedor: emit?.xNome || '',
        fornecedor_cnpj: emit?.CNPJ || '',
        fornecedor_rua: emit?.enderEmit?.xLgr || '',
        fornecedor_numero: emit?.enderEmit?.nro || '',
        fornecedor_bairro: emit?.enderEmit?.xBairro || '',
        fornecedor_cidade: emit?.enderEmit?.xMun || '',
        fornecedor_uf: emit?.enderEmit?.UF || '',
        fornecedor_cep: emit?.enderEmit?.CEP || '',
        fornecedor_endereco: [
          emit?.enderEmit?.xLgr,
          emit?.enderEmit?.nro,
          emit?.enderEmit?.xBairro,
          emit?.enderEmit?.xMun,
          emit?.enderEmit?.UF,
          emit?.enderEmit?.CEP
        ].filter(Boolean).join(', '),
        valor_produtos: parseFloat(total?.vProd || 0),
        valor_desconto: parseFloat(total?.vDesc || 0),
        valor_frete: parseFloat(total?.vFrete || 0),
        valor_outras_despesas: parseFloat(total?.vOutro || 0),
        valor_total_nota: parseFloat(total?.vNF || 0),
        observacao: infAdic?.infCpl || '',
        itens: det.map(d => {
          const prod = d.prod;
          const imposto = d.imposto;
          return {
            produto_nome: prod?.xProd || '',
            codigo_barras: prod?.cEAN || prod?.cEANTrib || '',
            ncm: prod?.NCM || '',
            unidade: prod?.uCom || 'UN',
            quantidade: parseFloat(prod?.qCom || 0),
            preco_unitario: parseFloat(prod?.vUnCom || 0),
            subtotal: parseFloat(prod?.vProd || 0),
            margem_lucro: 30, // padrão
            preco_venda_sugerido: parseFloat(prod?.vUnCom || 0) * 1.3
          };
        })
      };

      res.json(parsed);
    } catch (parseErr) {
      res.status(400).json({ error: 'Erro ao extrair dados do XML: ' + parseErr.message });
    }
  });
});

router.post('/:id/emitir-nfe-devolucao', async (req, res) => {
  try {
    const compraId = Number(req.params.id);

    const resultado = await emitirNFeDevolucaoCompra(compraId);

    if (!resultado.success && resultado.status === 'rejeitada') {
      return res.status(400).json({
        sucesso: false,
        autorizado: false,
        mensagem: 'NF-e de devolução rejeitada pela SEFAZ.',
        cStat: resultado.cStat,
        xMotivo: resultado.xMotivo,
        retornoSefaz: resultado.retorno,
        resultado
      });
    }

    res.json({
      message: resultado.success
        ? 'NF-e de devolução autorizada com sucesso.'
        : 'NF-e de devolução enviada/processada.',
      resultado
    });
  } catch (error) {
    console.error('Erro ao emitir NF-e de devolução:', error);
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id/chave-nfe-fornecedor', (req, res) => {
  const id = Number(req.params.id);
  const chave = String(req.body?.chave || '').replace(/\D/g, '');

  if (chave.length !== 44) {
    return res.status(400).json({ error: 'A chave da NF-e deve ter 44 dígitos.' });
  }

  db.run(`
    UPDATE compras
    SET chave_acesso = ?
    WHERE id = ?
  `, [chave, id], function(err) {
    if (err) return res.status(500).json({ error: err.message });

    res.json({
      success: true,
      message: 'Chave da NF-e original salva com sucesso.'
    });
  });
});

module.exports = router;
