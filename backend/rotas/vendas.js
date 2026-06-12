const express = require('express');
const router = express.Router();
const db = require('../database');

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

// BLOQUEIO DEFINITIVO: não permite venda com caixa fechado
function bloquearVendaSemCaixaAberto(req, res, next) {
  db.get(`
    SELECT id
    FROM caixa
    WHERE status = 'aberto'
    ORDER BY id DESC
    LIMIT 1
  `, [], (err, caixa) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    if (!caixa) {
      return res.status(400).json({
        error: 'Caixa fechado. Abra o caixa antes de realizar uma venda.'
      });
    }

    // Armazenar caixa_id para uso nas vendas
    req.caixaId = caixa.id;
    next();
  });
}
const { emitirPorVendaId } = require('../services/fiscal/emissor');
const moment = require('moment');

function responderVendaComFiscal(res, payload) {
  if (!payload.emitirFiscal || !payload.vendaId) {
    return res.json({
      id: payload.vendaId,
      codigo: payload.codigo,
      message: payload.message
    });
  }

  emitirPorVendaId(payload.vendaId)
    .then((fiscal) => {
      res.json({
        id: payload.vendaId,
        codigo: payload.codigo,
        message: payload.message,
        fiscal
      });
    })
    .catch((error) => {
      console.error('Erro ao emitir NFC-e após venda:', error);
      res.json({
        id: payload.vendaId,
        codigo: payload.codigo,
        message: payload.message,
        fiscal: {
          success: false,
          status: 'erro_emissao',
          message: error.message
        }
      });
    });
}

// Listar vendas com busca
router.get('/', (req, res) => {
  const busca = String(req.query.busca || '').trim();
  const todas = req.query.todas === '1';
  const somenteFiscal = String(req.query.modo || '').toLowerCase() === 'fiscal';

  let where = '';
  const params = [];

  if (busca) {
    where = `
      WHERE (
        v.id LIKE ?
        OR v.codigo LIKE ?
        OR c.nome LIKE ?
        OR v.forma_pagamento LIKE ?
        OR v.status LIKE ?
      )
    `;

    const termo = `%${busca}%`;
    params.push(termo, termo, termo, termo, termo);
  }

  if (!todas) {
    const dataHoje = agoraLocalBrasil().slice(0, 10);
    where += (where ? ' AND ' : ' WHERE ');
    where += ` v.data_venda = ? `;
    params.push(dataHoje);
  }

  if (somenteFiscal) {
    where += (where ? ' AND ' : ' WHERE ');
    where += ` n.id IS NOT NULL `;
  }

  db.all(`
    SELECT
      v.id,
      v.codigo,
      v.data_venda,
      v.created_at,
      v.cliente_id,
      v.total,
      v.desconto,
      v.forma_pagamento,
      v.status,
      n.id AS nfce_id,
      n.numero AS nfce_numero,
      n.status AS nfce_status,
      n.chave_acesso AS nfce_chave,
      c.nome AS cliente_nome,
      (
        SELECT COUNT(*)
        FROM vendas_itens vi
        WHERE vi.venda_id = v.id
      ) AS total_itens
    FROM vendas v
    LEFT JOIN clientes c ON c.id = v.cliente_id
    LEFT JOIN nfce_notas n ON n.id = (
      SELECT n2.id
      FROM nfce_notas n2
      WHERE n2.venda_id = v.id
      ORDER BY n2.id DESC
      LIMIT 1
    )
    ${where}
    ORDER BY v.data_venda DESC, v.id DESC
  `, params, (err, rows) => {
    if (err) {
      console.error('Erro ao listar vendas:', err);
      return res.status(500).json({ error: err.message });
    }

    res.setHeader('Cache-Control', 'no-store');
    res.json(rows || []);
  });
});

// Buscar venda por ID
router.get('/:id', (req, res) => {
  const { id } = req.params;
  
  db.get(`
    SELECT v.*, c.nome as cliente_nome, c.cpf_cnpj as cliente_cpf
    FROM vendas v
    LEFT JOIN clientes c ON v.cliente_id = c.id
    WHERE v.id = ?
  `, [id], (err, venda) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    
    db.all(`
      SELECT vi.*, p.nome as produto_nome, p.codigo as produto_codigo, p.unidade
      FROM vendas_itens vi
      JOIN produtos p ON vi.produto_id = p.id
      WHERE vi.venda_id = ?
    `, [id], (err, itens) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json({ ...venda, itens });
    });
  });
});

// Buscar detalhes completos da venda para emissão de NFC-e
router.get('/:id/detalhes', (req, res) => {
  const vendaId = req.params.id;

  db.get(`
    SELECT v.*, c.nome as cliente_nome
    FROM vendas v
    LEFT JOIN clientes c ON c.id = v.cliente_id
    WHERE v.id = ?
  `, [vendaId], (err, venda) => {
    if (err) return res.status(500).json({ error: err.message });

    if (!venda) {
      return res.status(404).json({ error: 'Venda não encontrada' });
    }

    db.all(`
      SELECT vi.*, p.nome as produto_nome
      FROM vendas_itens vi
      JOIN produtos p ON p.id = vi.produto_id
      WHERE vi.venda_id = ?
    `, [vendaId], (errItens, itens) => {
      if (errItens) return res.status(500).json({ error: errItens.message });

      res.json({
        venda,
        itens
      });
    });
  });
});

// Criar nova venda

// NOVA LÓGICA: Suporte a venda a prazo
router.post('/', bloquearVendaSemCaixaAberto, (req, res) => {
  console.log('ENTROU NA ROTA DE EMISSAO NFC-E');
  console.log('DADOS RECEBIDOS PARA EMISSAO:', req.body);

  const {
    cliente_id,
    total,
    desconto,
    forma_pagamento,
    itens,
    parcelas,
    primeiro_vencimento,
    forcar,
    emitir_fiscal,
    valor_recebido,
    cpf_cnpj_nota,
    pagamentos,
    tef
  } = req.body;

  const cpfCnpjNotaLimpo = String(cpf_cnpj_nota || '').replace(/\D/g, '');

  if (cpfCnpjNotaLimpo && ![11, 14].includes(cpfCnpjNotaLimpo.length)) {
    return res.status(400).json({
      error: 'CPF/CNPJ informado na nota é inválido.'
    });
  }

  const pagamentosVenda = Array.isArray(pagamentos) ? pagamentos : [];

  let formaPagamentoFinal = forma_pagamento;

  if (pagamentosVenda.length > 1) {
    formaPagamentoFinal = "misto";
  }

  if (pagamentosVenda.length > 0) {
    const totalPagamentos = pagamentosVenda.reduce((soma, p) => {
      return soma + Number(p.valor || 0);
    }, 0);

    if (Math.abs(totalPagamentos - Number(total || 0)) > 0.01) {
      return res.status(400).json({
        error: "A soma dos pagamentos precisa ser igual ao total da venda."
      });
    }
  }
  const totalNum = Number(total);
  const formasPendentes = ['prazo'];
  const formaPagamentoNormalizada = String(forma_pagamento || '').toLowerCase().trim();
  const vendaFicaPendente = formasPendentes.includes(formaPagamentoNormalizada);

  const buscarNomeCliente = (callback) => {
    if (!cliente_id) {
      callback(null, null, null);
      return;
    }

    db.get(
      'SELECT nome, cpf_cnpj FROM clientes WHERE id = ?',
      [cliente_id],
      (err, cliente) => {
        if (err) {
          callback(err);
          return;
        }

        callback(null, cliente ? cliente.nome : null, cliente ? cliente.cpf_cnpj : null);
      }
    );
  };

  if (!itens || !Array.isArray(itens) || itens.length === 0) {
    res.status(400).json({ error: 'Informe ao menos um item na venda.' });
    return;
  }
  if (Number.isNaN(totalNum) || totalNum <= 0) {
    res.status(400).json({ error: 'Total inválido.' });
    return;
  }

  if (forma_pagamento === 'prazo' && !cliente_id) {
    return res.status(400).json({
      error: 'Cliente é obrigatório para venda a prazo.'
    });
  }

  const produtoIds = Array.from(new Set(itens.map(item => item.produto_id).filter(id => id !== undefined && id !== null)));

  if (itens.some(item => item.produto_id === undefined || item.produto_id === null)) {
    res.status(400).json({ error: 'Um ou mais itens da venda não possuem produto vinculado.' });
    return;
  }

  db.all(`SELECT id, nome FROM produtos WHERE id IN (${produtoIds.map(() => '?').join(',')})`, produtoIds, (err, produtos) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }

    const produtoMap = produtos.reduce((map, produto) => {
      map[produto.id] = produto;
      return map;
    }, {});

    const faltantes = itens.reduce((acumulador, item) => {
      const produto = produtoMap[item.produto_id];
      if (!produto) {
        acumulador.push(`Produto ID ${item.produto_id} não encontrado`);
      }
      return acumulador;
    }, []);

    if (faltantes.length > 0) {
      res.status(400).json({ error: 'Erro na venda: ' + faltantes.join('; ') });
      return;
    }

    // Venda a prazo exige cliente
    if (forma_pagamento === 'prazo') {
    if (!cliente_id) {
      res.status(400).json({ error: 'Cliente obrigatório para venda a prazo.' });
      return;
    }
    // Validar débitos e parcelas vencidas, a menos que forçar esteja ativo
    if (!forcar) {
      const hoje = agoraLocalBrasil().slice(0, 10);
      db.get(`
        SELECT 
          SUM(CASE WHEN status = 'aberto' THEN valor_restante ELSE 0 END) as total_em_aberto,
          COUNT(CASE WHEN status = 'aberto' AND data_vencimento < ? THEN 1 END) as parcelas_vencidas
        FROM contas_receber
        WHERE cliente_id = ?
      `, [hoje, cliente_id], (err, row) => {
        if (err) {
          res.status(500).json({ error: err.message });
          return;
        }
        const totalEmAberto = Number(row?.total_em_aberto || 0);
        const parcelasVencidas = Number(row?.parcelas_vencidas || 0);
        if (totalEmAberto > 0 || parcelasVencidas > 0) {
          // Avisar operador e pedir confirmação
          res.status(409).json({
            aviso: 'Cliente possui débitos em aberto.',
            total_em_aberto: totalEmAberto,
            parcelas_vencidas: parcelasVencidas,
            pode_continuar: true
          });
          return;
        }
        executarVendaPrazo();
      });
      return;
    }
    // Função para executar venda a prazo
    executarVendaPrazo();
    function executarVendaPrazo() {
      const codigo = `VND-${agoraLocalBrasil().replace(/[- :]/g, '').slice(0, 14)}`;
      const data_venda = agoraLocalBrasil().slice(0, 10);
      db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        db.run(`
          INSERT INTO vendas (codigo, data_venda, cliente_id, total, desconto, forma_pagamento, status, caixa_id)
          VALUES (?, ?, ?, ?, ?, ?, 'concluida', ?)
        `, [codigo, data_venda, cliente_id, totalNum, desconto || 0, formaPagamentoFinal, req.caixaId], function(err) {
          if (err) {
            db.run('ROLLBACK');
            res.status(500).json({ error: err.message });
            return;
          }
          const vendaId = this.lastID;

          const transacoesTefParaVincular = [];

          if (tef && tef.transacao_id) {
            transacoesTefParaVincular.push(tef.transacao_id);
          }

          pagamentosVenda.forEach((p) => {
            const idTef = p.tef_transacao_id || p.tef?.transacao_id;
            if (idTef) {
              transacoesTefParaVincular.push(idTef);
            }
          });

          [...new Set(transacoesTefParaVincular)].forEach((transacaoId) => {
            db.run(`
              UPDATE tef_transacoes
              SET venda_id = ?
              WHERE id = ?
            `, [
              vendaId,
              transacaoId
            ], (tefErr) => {
              if (tefErr) {
                console.error('Erro ao vincular TEF à venda:', tefErr);
              }
            });
          });

          let itensProcessados = 0;
          itens.forEach(item => {
            db.run(`
              INSERT INTO vendas_itens (venda_id, produto_id, quantidade, preco_unitario, desconto_percentual, promocao_id, desconto_atacado, tipo_preco, subtotal)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [vendaId, item.produto_id, item.quantidade, item.preco_unitario, item.desconto_percentual || 0, item.promocao_id || null, item.desconto_atacado || 0, item.tipo_preco || 'varejo', item.subtotal], (itemErr) => {
              if (itemErr) {
                db.run('ROLLBACK');
                res.status(500).json({ error: itemErr.message });
                return;
              }
              db.run(`
                UPDATE produtos
                SET estoque_atual = estoque_atual - ?
                WHERE id = ?
              `, [item.quantidade, item.produto_id], (estErr) => {
                if (estErr) {
                  db.run('ROLLBACK');
                  res.status(500).json({ error: estErr.message });
                  return;
                }
                itensProcessados++;
                if (itensProcessados === itens.length) {
                  if (pagamentosVenda.length > 0) {
                    const stmtPagamentos = db.prepare(`
                      INSERT INTO venda_pagamentos (
                        venda_id, forma_pagamento, valor,
                        tef_transacao_id, tef_nsu, tef_autorizacao,
                        tef_bandeira, tef_adquirente,
                        tef_comprovante_cliente, tef_comprovante_estabelecimento
                      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `);

                    pagamentosVenda.forEach((p) => {
                      stmtPagamentos.run(
                        vendaId,
                        p.forma_pagamento,
                        Number(p.valor || 0),
                        p.tef_transacao_id || p.tef?.transacao_id || null,
                        p.nsu || p.tef?.nsu || null,
                        p.autorizacao || p.tef?.autorizacao || null,
                        p.bandeira || p.tef?.bandeira || null,
                        p.adquirente || p.tef?.adquirente || null,
                        p.tef?.comprovante_cliente || null,
                        p.tef?.comprovante_estabelecimento || null
                      );
                    });

                    stmtPagamentos.finalize();
                  } else {
                    db.run(
                      `
                      INSERT INTO venda_pagamentos (
                        venda_id, forma_pagamento, valor,
                        tef_transacao_id, tef_nsu, tef_autorizacao,
                        tef_bandeira, tef_adquirente,
                        tef_comprovante_cliente, tef_comprovante_estabelecimento
                      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                      `,
                      [
                        vendaId,
                        formaPagamentoFinal,
                        Number(total || 0),
                        tef?.transacao_id || null,
                        tef?.nsu || null,
                        tef?.autorizacao || null,
                        tef?.bandeira || null,
                        tef?.adquirente || null,
                        tef?.comprovante_cliente || null,
                        tef?.comprovante_estabelecimento || null
                      ]
                    );
                  }

                  // Gerar parcelas
                  const qtdParcelas = Number(parcelas) || 1;
                  const valorParcela = Math.round((totalNum / qtdParcelas) * 100) / 100;
                  let vencimento = moment(primeiro_vencimento, 'YYYY-MM-DD');
                  for (let i = 1; i <= qtdParcelas; i++) {
                    db.run(`
                      INSERT INTO contas_receber (venda_id, cliente_id, numero_parcela, total_parcelas, valor_parcela, valor_restante, data_vencimento, status)
                      VALUES (?, ?, ?, ?, ?, ?, ?, 'aberto')
                    `, [vendaId, cliente_id, i, qtdParcelas, valorParcela, valorParcela, vencimento.format('YYYY-MM-DD')]);
                    vencimento = vencimento.add(1, 'months');
                  }
                  buscarNomeCliente((clienteErr, clienteNome, clienteCpf) => {
                    if (clienteErr) {
                      db.run('ROLLBACK');
                      res.status(500).json({ error: clienteErr.message });
                      return;
                    }

                    const inserirFinanceiroPrazo = (indice = 1, venc = moment(primeiro_vencimento, 'YYYY-MM-DD')) => {
                      if (indice > qtdParcelas) {
                        db.run('COMMIT');
                        responderVendaComFiscal(res, {
                          vendaId,
                          codigo,
                          message: 'Venda a prazo registrada com sucesso',
                          emitirFiscal: !!emitir_fiscal
                        });
                        return;
                      }

                      db.run(`
                        INSERT INTO financeiro (
                          tipo, descricao, valor, data_movimento, categoria, forma_pagamento,
                          referencia_id, referencia_tipo, status, origem, documento, vencimento,
                          numero_parcela, total_parcelas, venda_id, pessoa_nome, baixado_em
                        ) VALUES ('receita', ?, ?, ?, 'vendas', ?, ?, 'venda', 'pendente', 'venda', ?, ?, ?, ?, ?, ?, NULL)
                      `, [
                        `Venda ${codigo} - Parcela ${indice}/${qtdParcelas}`,
                        valorParcela,
                        data_venda,
                        forma_pagamento,
                        vendaId,
                        clienteCpf,
                        venc.format('YYYY-MM-DD'),
                        indice,
                        qtdParcelas,
                        vendaId,
                        clienteNome
                      ], (finErr) => {
                        if (finErr) {
                          db.run('ROLLBACK');
                          res.status(500).json({ error: finErr.message });
                          return;
                        }

                        inserirFinanceiroPrazo(indice + 1, moment(venc).add(1, 'months'));
                      });
                    };

                    inserirFinanceiroPrazo();
                  });
                }
              });
            });
          });
        });
      });
    }
    return;
  }

  // Venda à vista ou crédito antigo
  const executarVenda = () => {
    const codigo = `VND-${agoraLocalBrasil().replace(/[- :]/g, '').slice(0, 14)}`;
    const data_venda = agoraLocalBrasil().slice(0, 10);
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      db.run(`
        INSERT INTO vendas (
          codigo,
          data_venda,
          cliente_id,
          total,
          desconto,
          forma_pagamento,
          status,
          valor_recebido,
          caixa_id,
          cpf_cnpj_nota
        )
        VALUES (?, ?, ?, ?, ?, ?, 'concluida', ?, ?, ?)
      `, [
        codigo,
        data_venda,
        cliente_id || null,
        totalNum,
        desconto || 0,
        formaPagamentoFinal,
        valor_recebido || null,
        req.caixaId,
        emitir_fiscal ? cpfCnpjNotaLimpo || null : null
      ], function(err) {
        if (err) {
          db.run('ROLLBACK');
          res.status(500).json({ error: err.message });
          return;
        }
        const vendaId = this.lastID;

        const transacoesTefParaVincular = [];

        if (tef && tef.transacao_id) {
          transacoesTefParaVincular.push(tef.transacao_id);
        }

        pagamentosVenda.forEach((p) => {
          const idTef = p.tef_transacao_id || p.tef?.transacao_id;
          if (idTef) {
            transacoesTefParaVincular.push(idTef);
          }
        });

        [...new Set(transacoesTefParaVincular)].forEach((transacaoId) => {
          db.run(`
            UPDATE tef_transacoes
            SET venda_id = ?
            WHERE id = ?
          `, [
            vendaId,
            transacaoId
          ], (tefErr) => {
            if (tefErr) {
              console.error('Erro ao vincular TEF à venda:', tefErr);
            }
          });
        });

        let itensProcessados = 0;
        itens.forEach(item => {
          db.run(`
            INSERT INTO vendas_itens (venda_id, produto_id, quantidade, preco_unitario, desconto_percentual, promocao_id, desconto_atacado, tipo_preco, subtotal)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [vendaId, item.produto_id, item.quantidade, item.preco_unitario, item.desconto_percentual || 0, item.promocao_id || null, item.desconto_atacado || 0, item.tipo_preco || 'varejo', item.subtotal], (itemErr) => {
            if (itemErr) {
              db.run('ROLLBACK');
              res.status(500).json({ error: itemErr.message });
              return;
            }
            db.run(`
              UPDATE produtos
              SET estoque_atual = estoque_atual - ?
              WHERE id = ?
            `, [item.quantidade, item.produto_id], (estErr) => {
              if (estErr) {
                db.run('ROLLBACK');
                res.status(500).json({ error: estErr.message });
                return;
              }
              itensProcessados++;
              if (itensProcessados === itens.length) {
                if (pagamentosVenda.length > 0) {
                  const stmtPagamentos = db.prepare(`
                    INSERT INTO venda_pagamentos (
                      venda_id, forma_pagamento, valor,
                      tef_transacao_id, tef_nsu, tef_autorizacao,
                      tef_bandeira, tef_adquirente,
                      tef_comprovante_cliente, tef_comprovante_estabelecimento
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  `);

                  pagamentosVenda.forEach((p) => {
                    stmtPagamentos.run(
                      vendaId,
                      p.forma_pagamento,
                      Number(p.valor || 0),
                      p.tef_transacao_id || p.tef?.transacao_id || null,
                      p.nsu || p.tef?.nsu || null,
                      p.autorizacao || p.tef?.autorizacao || null,
                      p.bandeira || p.tef?.bandeira || null,
                      p.adquirente || p.tef?.adquirente || null,
                      p.tef?.comprovante_cliente || null,
                      p.tef?.comprovante_estabelecimento || null
                    );
                  });

                  stmtPagamentos.finalize();
                } else {
                  db.run(
                    `
                    INSERT INTO venda_pagamentos (
                      venda_id, forma_pagamento, valor,
                      tef_transacao_id, tef_nsu, tef_autorizacao,
                      tef_bandeira, tef_adquirente,
                      tef_comprovante_cliente, tef_comprovante_estabelecimento
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `,
                    [
                      vendaId,
                      formaPagamentoFinal,
                      Number(total || 0),
                      tef?.transacao_id || null,
                      tef?.nsu || null,
                      tef?.autorizacao || null,
                      tef?.bandeira || null,
                      tef?.adquirente || null,
                      tef?.comprovante_cliente || null,
                      tef?.comprovante_estabelecimento || null
                    ]
                  );
                }

                const statusFinanceiro = vendaFicaPendente ? 'pendente' : 'recebido';
                const baixadoEm = statusFinanceiro === 'recebido' ? data_venda : null;
                const finalizarResposta = () => {
                  db.run('COMMIT');
                  responderVendaComFiscal(res, {
                    vendaId,
                    codigo,
                    message: 'Venda registrada com sucesso',
                    emitirFiscal: !!emitir_fiscal
                  });
                };

                const inserirContasReceberSeNecessario = (callback) => {
                  if (forma_pagamento === 'prazo' && cliente_id) {
                    const valorParcela = totalNum;
                    db.run(`
                      INSERT INTO contas_receber (
                        venda_id, cliente_id, numero_parcela, total_parcelas, valor_parcela,
                        valor_restante, data_vencimento, status
                      ) VALUES (?, ?, ?, ?, ?, ?, date('now', '+30 day'), 'aberto')
                    `, [vendaId, cliente_id, 1, 1, valorParcela, valorParcela], (crErr) => {
                      if (crErr) {
                        db.run('ROLLBACK');
                        res.status(500).json({ error: crErr.message });
                        return;
                      }
                      callback();
                    });
                  } else {
                    callback();
                  }
                };

                buscarNomeCliente((clienteErr, clienteNome, clienteCpf) => {
                  if (clienteErr) {
                    db.run('ROLLBACK');
                    res.status(500).json({ error: clienteErr.message });
                    return;
                  }

                  db.run(`
                    INSERT INTO financeiro (
                      tipo, descricao, valor, data_movimento, categoria, forma_pagamento,
                      referencia_id, referencia_tipo, status, origem, documento, vencimento,
                      numero_parcela, total_parcelas, venda_id, pessoa_nome, baixado_em
                    ) VALUES ('receita', ?, ?, ?, 'vendas', ?, ?, 'venda', ?, 'venda', ?, ?, 1, 1, ?, ?, ?)
                  `, [
                    `Venda ${codigo}`,
                    totalNum,
                    data_venda,
                    forma_pagamento,
                    vendaId,
                    statusFinanceiro,
                    clienteCpf,
                    data_venda,
                    vendaId,
                    clienteNome,
                    baixadoEm
                  ], (finErr) => {
                    if (finErr) {
                      db.run('ROLLBACK');
                      res.status(500).json({ error: finErr.message });
                      return;
                    }

                    const aposFinanceiro = () => {
                      if (forma_pagamento === 'prazo' && cliente_id) {
                        db.run(`
                          UPDATE clientes
                          SET credito_atual = COALESCE(credito_atual, 0) + ?
                          WHERE id = ?
                        `, [totalNum, cliente_id], (credErr) => {
                          if (credErr) {
                            db.run('ROLLBACK');
                            res.status(500).json({ error: credErr.message });
                            return;
                          }

                          finalizarResposta();
                        });
                      } else {
                        finalizarResposta();
                      }
                    };

                    inserirContasReceberSeNecessario(aposFinanceiro);
                  });
                });
              }
            });
          });
        });
      });
    });
  };

  // Venda à vista pode ser sem cliente
  if (forma_pagamento === 'credito') {
    if (!cliente_id) {
      res.status(400).json({ error: 'Cliente obrigatório para venda a crédito.' });
      return;
    }
    db.get(
      'SELECT credito_atual, limite_credito FROM clientes WHERE id = ?',
      [cliente_id],
      (err, cliente) => {
        if (err) {
          res.status(500).json({ error: err.message });
          return;
        }
        if (!cliente) {
          res.status(400).json({ error: 'Cliente não encontrado.' });
          return;
        }
        if (Number(cliente.limite_credito) <= 0) {
          res.status(400).json({ error: 'Configure um limite de crédito maior que zero para este cliente.' });
          return;
        }
        if (Number(cliente.credito_atual) + totalNum > Number(cliente.limite_credito)) {
          res.status(400).json({ error: 'Limite de crédito excedido.' });
          return;
        }
        executarVenda();
      }
    );
  } else {
    executarVenda();
  }
});
});

// Cancelar venda
router.put('/:id/cancelar', (req, res) => {
  const { id } = req.params;

  db.get('SELECT * FROM vendas WHERE id = ?', [id], (err, venda) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (!venda) {
      res.status(404).json({ error: 'Venda não encontrada.' });
      return;
    }
    if (venda.status !== 'concluida') {
      res.status(400).json({ error: 'Apenas vendas concluídas podem ser canceladas.' });
      return;
    }

    db.serialize(() => {
      db.run('BEGIN TRANSACTION');

      db.all('SELECT * FROM vendas_itens WHERE venda_id = ?', [id], (itErr, itens) => {
        if (itErr) {
          db.run('ROLLBACK');
          res.status(500).json({ error: itErr.message });
          return;
        }

        const finalizarCancelamento = () => {
          db.run(`
            UPDATE vendas
            SET status = 'cancelada'
            WHERE id = ?
          `, [id], (upErr) => {
            if (upErr) {
              db.run('ROLLBACK');
              res.status(500).json({ error: upErr.message });
              return;
            }

            db.run(`
              INSERT INTO financeiro (
                tipo, descricao, valor, data_movimento, categoria, forma_pagamento,
                referencia_id, referencia_tipo, status, origem, documento, vencimento,
                venda_id, baixado_em
              ) VALUES ('despesa', ?, ?, ?, 'estorno_venda', 'estorno', ?, 'estorno_venda', 'pago', 'cancelamento_venda', ?, ?, ?, ?)
            `, [
              `Estorno cancelamento ${venda.codigo}`,
              venda.total,
              venda.data_venda,
              id,
              venda.codigo,
              venda.data_venda,
              id,
              venda.data_venda
            ], (finErr) => {
              if (finErr) {
                db.run('ROLLBACK');
                res.status(500).json({ error: finErr.message });
                return;
              }

              if (venda.forma_pagamento === 'credito' && venda.cliente_id) {
                db.run(`
                  UPDATE clientes
                  SET credito_atual = CASE
                    WHEN (credito_atual - ?) < 0 THEN 0
                    ELSE credito_atual - ?
                  END
                  WHERE id = ?
                `, [venda.total, venda.total, venda.cliente_id], (credErr) => {
                  if (credErr) {
                    db.run('ROLLBACK');
                    res.status(500).json({ error: credErr.message });
                    return;
                  }
                  db.run('COMMIT');
                  res.json({ message: 'Venda cancelada com sucesso' });
                });
              } else {
                db.run('COMMIT');
                res.json({ message: 'Venda cancelada com sucesso' });
              }
            });
          });
        };

        if (!itens || itens.length === 0) {
          finalizarCancelamento();
          return;
        }

        let itensProcessados = 0;

        itens.forEach(item => {
          db.run(`
            UPDATE produtos
            SET estoque_atual = estoque_atual + ?
            WHERE id = ?
          `, [item.quantidade, item.produto_id], (estErr) => {
            if (estErr) {
              db.run('ROLLBACK');
              res.status(500).json({ error: estErr.message });
              return;
            }

            itensProcessados++;
            if (itensProcessados === itens.length) {
              finalizarCancelamento();
            }
          });
        });
      });
    });
  });
});

// Cancelar venda não fiscal
router.post('/cancelar/:id', (req, res) => {
  const vendaId = req.params.id;
  const { motivo } = req.body;

  db.get(
    'SELECT * FROM vendas WHERE id = ?',
    [vendaId],
    (err, venda) => {
      if (err || !venda) {
        return res.status(404).json({
          sucesso: false,
          mensagem: 'Venda não encontrada.'
        });
      }

      if (venda.cancelada === 1) {
        return res.status(400).json({
          sucesso: false,
          mensagem: 'Venda já cancelada.'
        });
      }

      // Verificar se a venda é fiscal (tem NFC-e emitida)
      db.get(
        'SELECT id FROM nfce_notas WHERE venda_id = ? LIMIT 1',
        [vendaId],
        (errNfce, nfce) => {
          if (errNfce) {
            return res.status(500).json({
              sucesso: false,
              mensagem: 'Erro ao verificar NFC-e.'
            });
          }

          if (nfce) {
            return res.status(400).json({
              sucesso: false,
              mensagem: 'Venda fiscal deve ser cancelada pela NFC-e.'
            });
          }

          db.all(
            'SELECT * FROM vendas_itens WHERE venda_id = ?',
            [vendaId],
            (errItens, itens) => {
              if (errItens) {
                return res.status(500).json({
                  sucesso: false,
                  mensagem: 'Erro ao buscar itens.'
                });
              }

              // Devolver estoque
              const stmt = db.prepare(`
                UPDATE produtos
                SET estoque_atual = estoque_atual + ?
                WHERE id = ?
              `);

              itens.forEach(item => {
                stmt.run(
                  Number(item.quantidade || 0),
                  item.produto_id
                );
              });

              stmt.finalize();

              // Marcar venda como cancelada
              db.run(
                `
                UPDATE vendas
                SET
                  cancelada = 1,
                  status = 'cancelada',
                  data_cancelamento = CURRENT_TIMESTAMP
                WHERE id = ?
                `,
                [vendaId],
                function (errUpdate) {
                  if (errUpdate) {
                    return res.status(500).json({
                      sucesso: false,
                      mensagem: errUpdate.message
                    });
                  }

                  // Registrar no histórico
                  db.run(
                    `
                    INSERT INTO vendas_canceladas (
                      venda_id,
                      motivo,
                      usuario_id
                    )
                    VALUES (?, ?, ?)
                    `,
                    [
                      vendaId,
                      motivo || 'Não informado',
                      req.usuario?.id || null
                    ]
                  );

                  // Cancelar/estornar financeiro gerado pela venda
                  db.run(
                    `
                    UPDATE financeiro
                    SET
                      status = 'cancelado',
                      observacao = COALESCE(observacao, '') || ' | Cancelado automaticamente pela venda #' || ?
                    WHERE venda_id = ?
                    `,
                    [vendaId, vendaId],
                    function (errFinanceiro) {
                      if (errFinanceiro) {
                        console.error('Erro ao cancelar financeiro da venda:', errFinanceiro.message);
                      }
                    }
                  );

                  // Cancelar contas a receber da venda
                  db.run(
                    `
                    UPDATE contas_receber
                    SET
                      status = 'cancelado',
                      observacao = COALESCE(observacao, '') || ' | Cancelado automaticamente pela venda #' || ?
                    WHERE venda_id = ?
                    `,
                    [vendaId, vendaId]
                  );

                  res.json({
                    sucesso: true,
                    mensagem: 'Venda cancelada com sucesso.'
                  });
                }
              );
            }
          );
        }
      );
    }
  );
});

// Excluir venda
router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);

  db.get(`
    SELECT *
    FROM vendas
    WHERE id = ?
  `, [id], (err, venda) => {

    if (err) {
      return res.status(500).json({ error: err.message });
    }

    if (!venda) {
      return res.status(404).json({ error: 'Venda não encontrada' });
    }

    if (venda.nfce_id) {
      return res.status(400).json({
        error: 'Venda fiscal não pode ser excluída. Cancele a NFC-e primeiro.'
      });
    }

    db.run(`
      DELETE FROM vendas_itens WHERE venda_id = ?
    `, [id], (errItens) => {

      if (errItens) {
        return res.status(500).json({ error: errItens.message });
      }

      db.run(`
        DELETE FROM vendas WHERE id = ?
      `, [id], (errVenda) => {

        if (errVenda) {
          return res.status(500).json({ error: errVenda.message });
        }

        res.json({
          success: true,
          message: 'Venda excluída com sucesso'
        });
      });
    });
  });
});

// Relatório de vendas por período
router.get('/relatorio/periodo', (req, res) => {
  const { data_inicio, data_fim } = req.query;
  
  db.all(`
    SELECT 
      DATE(data_venda) as data,
      COUNT(*) as total_vendas,
      SUM(total) as valor_total,
      AVG(total) as valor_medio,
      SUM(CASE WHEN cliente_id IS NOT NULL THEN 1 ELSE 0 END) as vendas_com_cliente
    FROM vendas
    WHERE status = 'concluida'
      AND data_venda BETWEEN ? AND ?
    GROUP BY DATE(data_venda)
    ORDER BY data DESC
  `, [data_inicio, data_fim], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

module.exports = router;
