const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'banco', 'mercadao.db');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Erro ao conectar ao banco de dados:', err);
  } else {
    console.log('Conectado ao banco de dados SQLite');
    inicializarBanco();
  }
});

function inicializarBanco() {
                // ===== CATEGORIAS =====
                db.run(`
                  CREATE TABLE IF NOT EXISTS categorias (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    nome VARCHAR(100) NOT NULL UNIQUE,
                    descricao TEXT
                  )
                `, (err) => {
                  if (err) console.error('Erro ao criar tabela categorias:', err);
                  else console.log('Tabela categorias criada/verificada');
                });

                // ===== SUBCATEGORIAS =====
                db.run(`
                  CREATE TABLE IF NOT EXISTS subcategorias (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    nome VARCHAR(100) NOT NULL,
                    descricao TEXT,
                    categoria_id INTEGER,
                    FOREIGN KEY (categoria_id) REFERENCES categorias(id)
                  )
                `, (err) => {
                  if (err) console.error('Erro ao criar tabela subcategorias:', err);
                  else console.log('Tabela subcategorias criada/verificada');
                });

                // ===== GARANTIR COLUNAS NOVAS EM PRODUTOS =====
                db.all(`PRAGMA table_info(produtos)`, [], (err, rows) => {
                  if (err) {
                    console.error('Erro ao verificar colunas da tabela produtos:', err);
                    return;
                  }

                  const colunas = rows.map(r => r.name);
                  const alteracoes = [
                    !colunas.includes('categoria_id') && `ALTER TABLE produtos ADD COLUMN categoria_id INTEGER`,
                    !colunas.includes('subcategoria_id') && `ALTER TABLE produtos ADD COLUMN subcategoria_id INTEGER`,
                    !colunas.includes('lucro_percentual') && `ALTER TABLE produtos ADD COLUMN lucro_percentual DECIMAL(10,2)`,
                    !colunas.includes('ncm') && `ALTER TABLE produtos ADD COLUMN ncm TEXT`,
                    !colunas.includes('cfop') && `ALTER TABLE produtos ADD COLUMN cfop TEXT`,
                    !colunas.includes('csosn') && `ALTER TABLE produtos ADD COLUMN csosn TEXT`,
                    !colunas.includes('origem') && `ALTER TABLE produtos ADD COLUMN origem INTEGER DEFAULT 0`,
                    !colunas.includes('cest') && `ALTER TABLE produtos ADD COLUMN cest TEXT`,
                    !colunas.includes('codigo_barras') && `ALTER TABLE produtos ADD COLUMN codigo_barras TEXT`,
                    !colunas.includes('aliquota_icms') && `ALTER TABLE produtos ADD COLUMN aliquota_icms REAL DEFAULT 0`,
                    !colunas.includes('aliquota_pis') && `ALTER TABLE produtos ADD COLUMN aliquota_pis REAL DEFAULT 0`,
                    !colunas.includes('aliquota_cofins') && `ALTER TABLE produtos ADD COLUMN aliquota_cofins REAL DEFAULT 0`
                  ].filter(Boolean);

                  alteracoes.forEach(sql => {
                    db.run(sql, (err) => {
                      if (err) {
                        console.error(`Erro ao executar alteração de produto: ${sql}`, err);
                      } else {
                        console.log(`Alteração aplicada em produtos: ${sql}`);
                      }
                    });
                  });
                });
              // Tabela de subcategorias
              db.run(`
                CREATE TABLE IF NOT EXISTS subcategorias (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  nome TEXT NOT NULL,
                  categoria_id INTEGER NOT NULL,
                  ativo INTEGER DEFAULT 1,
                  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                  FOREIGN KEY (categoria_id) REFERENCES categorias(id)
                )
              `, (err) => {
                if (err) console.error('Erro ao criar tabela subcategorias:', err);
                else console.log('Tabela subcategorias criada/verificada');
              });
          // Tabela de categorias
          db.run(`
            CREATE TABLE IF NOT EXISTS categorias (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              nome TEXT NOT NULL UNIQUE,
              descricao TEXT,
              ativo INTEGER DEFAULT 1,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
          `, (err) => {
            if (err) console.error('Erro ao criar tabela categorias:', err);
            else console.log('Tabela categorias criada/verificada');
          });
      // Tabela de fornecedores
      db.run(`
        CREATE TABLE IF NOT EXISTS fornecedores (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          nome VARCHAR(200) NOT NULL,
          razao_social VARCHAR(200),
          cpf_cnpj VARCHAR(20) UNIQUE,
          telefone VARCHAR(20),
          email VARCHAR(100),
          contato VARCHAR(100),
          cep VARCHAR(10),
          rua VARCHAR(200),
          numero VARCHAR(20),
          bairro VARCHAR(100),
          cidade VARCHAR(100),
          uf VARCHAR(2),
          observacoes TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) console.error('Erro ao criar tabela fornecedores:', err);
        else console.log('Tabela fornecedores criada/verificada');
      });
  // Criar todas as tabelas em sequência
  db.serialize(() => {
    // Tabela de produtos
    db.run(`
      CREATE TABLE IF NOT EXISTS produtos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        codigo VARCHAR(50) UNIQUE,
        nome VARCHAR(200) NOT NULL,
        categoria_id INTEGER,
        subcategoria_id INTEGER,
        unidade VARCHAR(20),
        preco_compra DECIMAL(10,2),
        preco_venda DECIMAL(10,2) NOT NULL,
        lucro_percentual DECIMAL(10,2),
        estoque_atual DECIMAL(10,2) DEFAULT 0,
        estoque_minimo DECIMAL(10,2) DEFAULT 0,
        fornecedor VARCHAR(200),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (categoria_id) REFERENCES categorias(id),
        FOREIGN KEY (subcategoria_id) REFERENCES subcategorias(id)
      )
    `, (err) => {
      if (err) console.error('Erro ao criar tabela produtos:', err);
      else console.log('Tabela produtos criada/verificada');
    });

    // Tabela de clientes
    db.run(`
      CREATE TABLE IF NOT EXISTS clientes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome VARCHAR(200) NOT NULL,
        cpf_cnpj VARCHAR(20) UNIQUE,
        telefone VARCHAR(20),
        email VARCHAR(100),
        endereco TEXT,
        limite_credito DECIMAL(10,2) DEFAULT 0,
        credito_atual DECIMAL(10,2) DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        cep VARCHAR(10),
        rua VARCHAR(200),
        numero VARCHAR(20),
        bairro VARCHAR(100),
        cidade VARCHAR(100),
        uf VARCHAR(2)
      )
    `, (err) => {
      if (err) console.error('Erro ao criar tabela clientes:', err);
      else console.log('Tabela clientes criada/verificada');
    });

    // Tabela de compras
    db.run(`
      CREATE TABLE IF NOT EXISTS compras (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        data_compra DATE NOT NULL,
        fornecedor VARCHAR(200),
        total DECIMAL(10,2) NOT NULL,
        status VARCHAR(20) DEFAULT 'pendente',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) console.error('Erro ao criar tabela compras:', err);
      else console.log('Tabela compras criada/verificada');
    });

    // Tabela de itens de compra
    db.run(`
      CREATE TABLE IF NOT EXISTS compras_itens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        compra_id INTEGER,
        produto_id INTEGER,
        quantidade DECIMAL(10,2) NOT NULL,
        preco_unitario DECIMAL(10,2) NOT NULL,
        subtotal DECIMAL(10,2) NOT NULL,
        FOREIGN KEY (compra_id) REFERENCES compras(id) ON DELETE CASCADE,
        FOREIGN KEY (produto_id) REFERENCES produtos(id)
      )
    `, (err) => {
      if (err) console.error('Erro ao criar tabela compras_itens:', err);
      else console.log('Tabela compras_itens criada/verificada');
    });

    // Tabela de vendas
    db.run(`
      CREATE TABLE IF NOT EXISTS vendas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        codigo VARCHAR(50) UNIQUE,
        data_venda DATE NOT NULL,
        cliente_id INTEGER,
        total DECIMAL(10,2) NOT NULL,
        desconto DECIMAL(10,2) DEFAULT 0,
        forma_pagamento VARCHAR(50),
        status VARCHAR(20) DEFAULT 'concluida',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (cliente_id) REFERENCES clientes(id)
      )
    `, (err) => {
      if (err) console.error('Erro ao criar tabela vendas:', err);
      else console.log('Tabela vendas criada/verificada');
    });

    // Tabela de itens de venda
    db.run(`
      CREATE TABLE IF NOT EXISTS vendas_itens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        venda_id INTEGER,
        produto_id INTEGER,
        quantidade DECIMAL(10,2) NOT NULL,
        preco_unitario DECIMAL(10,2) NOT NULL,
        subtotal DECIMAL(10,2) NOT NULL,
        FOREIGN KEY (venda_id) REFERENCES vendas(id) ON DELETE CASCADE,
        FOREIGN KEY (produto_id) REFERENCES produtos(id)
      )
    `, (err) => {
      if (err) console.error('Erro ao criar tabela vendas_itens:', err);
      else console.log('Tabela vendas_itens criada/verificada');
    });

    // Tabela de movimentações financeiras
    db.run(`
      CREATE TABLE IF NOT EXISTS financeiro (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tipo VARCHAR(20) NOT NULL,
        descricao TEXT,
        valor DECIMAL(10,2) NOT NULL,
        data_movimento DATE NOT NULL,
        categoria VARCHAR(50),
        forma_pagamento VARCHAR(50),
        referencia_id INTEGER,
        referencia_tipo VARCHAR(50),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) console.error('Erro ao criar tabela financeiro:', err);
      else console.log('Tabela financeiro criada/verificada');
    });

    // Tabela de contas a receber (parcelas de vendas a prazo)
    db.run(`
      CREATE TABLE IF NOT EXISTS contas_receber (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        venda_id INTEGER,
        cliente_id INTEGER,
        numero_parcela INTEGER,
        total_parcelas INTEGER,
        valor_parcela DECIMAL(10,2) NOT NULL,
        valor_restante DECIMAL(10,2) NOT NULL,
        data_vencimento DATE NOT NULL,
        data_pagamento DATE,
        status VARCHAR(20) DEFAULT 'aberto',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (venda_id) REFERENCES vendas(id),
        FOREIGN KEY (cliente_id) REFERENCES clientes(id)
      )
    `, (err) => {
      if (err) console.error('Erro ao criar tabela contas_receber:', err);
      else console.log('Tabela contas_receber criada/verificada');
    });

    // Histórico de alteração de preços (compra/venda)
    db.run(`
      CREATE TABLE IF NOT EXISTS produtos_preco_historico (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        produto_id INTEGER NOT NULL,
        preco_compra_anterior DECIMAL(10,2),
        preco_compra_novo DECIMAL(10,2),
        preco_venda_anterior DECIMAL(10,2),
        preco_venda_novo DECIMAL(10,2),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE CASCADE
      )
    `, (err) => {
      if (err) console.error('Erro ao criar tabela produtos_preco_historico:', err);
      else console.log('Tabela produtos_preco_historico criada/verificada');
    });

    // Usuários do sistema (login)
    db.run(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username VARCHAR(100) NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'operador',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) console.error('Erro ao criar tabela usuarios:', err);
      else {
        console.log('Tabela usuarios criada/verificada');
        seedUsuarioAdmin();
      }
    });


    // Tabela de NFC-e emitidas
    db.run(`
      CREATE TABLE IF NOT EXISTS nfce_notas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        venda_id INTEGER NOT NULL,
        numero INTEGER NOT NULL,
        serie INTEGER NOT NULL,
        chave_acesso TEXT,
        ambiente INTEGER DEFAULT 2,
        status TEXT DEFAULT 'pendente',
        xml_enviado TEXT,
        xml_retorno TEXT,
        protocolo TEXT,
        recibo TEXT,
        qr_code_url TEXT,
        danfe_html TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (venda_id) REFERENCES vendas(id)
      )
    `, (err) => {
      if (err) console.error('Erro ao criar tabela nfce_notas:', err);
      else console.log('Tabela nfce_notas criada/verificada');
    });

    // Tabela de configurações (criar por último)
    db.run(`
      CREATE TABLE IF NOT EXISTS configuracoes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chave VARCHAR(100) UNIQUE NOT NULL,
        valor TEXT,
        tipo VARCHAR(50),
        descricao TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) {
        console.error('Erro ao criar tabela configuracoes:', err);
      } else {
        console.log('Tabela configuracoes criada/verificada');
        // Inserir configurações padrão após criar a tabela
        inserirConfiguracoesPadrao();
      }
    });
  });

  garantirColunasCompras();
  garantirColunasFinanceiro();
}


function garantirColunasCompras() {
  db.all(`PRAGMA table_info(compras)`, [], (err, rows) => {
    if (err) {
      console.error('Erro ao verificar colunas da tabela compras:', err);
      return;
    }

    const colunas = rows.map(r => r.name);
    const alteracoes = [
      !colunas.includes('condicao_pagamento') && `ALTER TABLE compras ADD COLUMN condicao_pagamento TEXT DEFAULT 'avista'`,
      !colunas.includes('forma_pagamento') && `ALTER TABLE compras ADD COLUMN forma_pagamento TEXT`,
      !colunas.includes('data_vencimento') && `ALTER TABLE compras ADD COLUMN data_vencimento DATE`,
      !colunas.includes('parcelas') && `ALTER TABLE compras ADD COLUMN parcelas INTEGER DEFAULT 1`,
      !colunas.includes('valor_entrada') && `ALTER TABLE compras ADD COLUMN valor_entrada DECIMAL(10,2) DEFAULT 0`,
      !colunas.includes('observacao') && `ALTER TABLE compras ADD COLUMN observacao TEXT`
    ].filter(Boolean);

    db.serialize(() => {
      alteracoes.forEach(sql => {
        db.run(sql, (alterErr) => {
          if (alterErr) {
            console.error(`Erro ao executar alteração em compras: ${sql}`, alterErr);
          } else {
            console.log(`Alteração aplicada em compras: ${sql}`);
          }
        });
      });
    });
  });

  db.all(`PRAGMA table_info(compras_itens)`, [], (err, rows) => {
    if (err) {
      console.error('Erro ao verificar colunas da tabela compras_itens:', err);
      return;
    }

    const colunas = rows.map(r => r.name);
    const alteracoes = [
      !colunas.includes('descricao_produto') && `ALTER TABLE compras_itens ADD COLUMN descricao_produto TEXT`,
      !colunas.includes('codigo_barras') && `ALTER TABLE compras_itens ADD COLUMN codigo_barras TEXT`,
      !colunas.includes('margem_lucro') && `ALTER TABLE compras_itens ADD COLUMN margem_lucro DECIMAL(10,2) DEFAULT 30`,
      !colunas.includes('preco_venda_sugerido') && `ALTER TABLE compras_itens ADD COLUMN preco_venda_sugerido DECIMAL(10,2)`,
      !colunas.includes('unidade') && `ALTER TABLE compras_itens ADD COLUMN unidade TEXT`,
      !colunas.includes('ncm') && `ALTER TABLE compras_itens ADD COLUMN ncm TEXT`
    ].filter(Boolean);

    db.serialize(() => {
      alteracoes.forEach(sql => {
        db.run(sql, (alterErr) => {
          if (alterErr) {
            console.error(`Erro ao executar alteração em compras_itens: ${sql}`, alterErr);
          } else {
            console.log(`Alteração aplicada em compras_itens: ${sql}`);
          }
        });
      });
    });
  });
}

function garantirColunasFinanceiro() {
  db.all(`PRAGMA table_info(financeiro)`, [], (err, rows) => {
    if (err) {
      console.error('Erro ao verificar colunas da tabela financeiro:', err);
      return;
    }

    const colunas = rows.map(r => r.name);
    const alteracoes = [
      !colunas.includes('status') && `ALTER TABLE financeiro ADD COLUMN status TEXT DEFAULT 'pago'`,
      !colunas.includes('origem') && `ALTER TABLE financeiro ADD COLUMN origem TEXT DEFAULT 'manual'`,
      !colunas.includes('documento') && `ALTER TABLE financeiro ADD COLUMN documento TEXT`,
      !colunas.includes('vencimento') && `ALTER TABLE financeiro ADD COLUMN vencimento DATE`,
      !colunas.includes('numero_parcela') && `ALTER TABLE financeiro ADD COLUMN numero_parcela INTEGER`,
      !colunas.includes('total_parcelas') && `ALTER TABLE financeiro ADD COLUMN total_parcelas INTEGER`,
      !colunas.includes('compra_id') && `ALTER TABLE financeiro ADD COLUMN compra_id INTEGER`,
      !colunas.includes('venda_id') && `ALTER TABLE financeiro ADD COLUMN venda_id INTEGER`,
      !colunas.includes('pessoa_nome') && `ALTER TABLE financeiro ADD COLUMN pessoa_nome TEXT`,
      !colunas.includes('observacao') && `ALTER TABLE financeiro ADD COLUMN observacao TEXT`,
      !colunas.includes('baixado_em') && `ALTER TABLE financeiro ADD COLUMN baixado_em DATE`
    ].filter(Boolean);

    db.serialize(() => {
      alteracoes.forEach(sql => {
        db.run(sql, (alterErr) => {
          if (alterErr) {
            console.error(`Erro ao executar alteração em financeiro: ${sql}`, alterErr);
          } else {
            console.log(`Alteração aplicada em financeiro: ${sql}`);
          }
        });
      });

      db.run(`
        UPDATE financeiro
        SET origem = COALESCE(origem, referencia_tipo, 'manual')
        WHERE origem IS NULL OR origem = ''
      `);

      db.run(`
        UPDATE financeiro
        SET status = CASE
          WHEN tipo IN ('despesa', 'pagar') THEN 'pendente'
          WHEN tipo IN ('receita', 'receber') THEN 'recebido'
          ELSE COALESCE(status, 'pendente')
        END
        WHERE status IS NULL OR status = ''
      `);

      db.run(`
        UPDATE financeiro
        SET vencimento = COALESCE(vencimento, data_movimento)
        WHERE vencimento IS NULL
      `);
    });
  });
}

// Função separada para inserir configurações padrão
function inserirConfiguracoesPadrao() {
  const configs = [
    ['nome_empresa', 'Mercadão da Economia', 'string', 'Nome da empresa'],
    ['cnpj', '', 'string', 'CNPJ da empresa'],
    ['telefone', '', 'string', 'Telefone para contato'],
    ['email', '', 'string', 'Email para contato'],
    ['endereco', '', 'text', 'Endereço da empresa'],
    ['logo', '', 'text', 'URL da logo'],
    ['imprimir_cupom', 'true', 'boolean', 'Imprimir cupom fiscal'],
    ['juros_mora', '1.0', 'decimal', 'Juros de mora por dia (%)'],
    ['backup_google_enabled', 'false', 'boolean', 'Backup automático para Google Drive habilitado'],
    ['backup_google_frequency', '0 2 * * *', 'string', 'Frequência de backup para Google Drive'],
    ['backup_google_client_id', '', 'string', 'Google Client ID para backup'],
    ['backup_google_client_secret', '', 'string', 'Google Client Secret para backup'],
    ['backup_google_redirect_uris', '[]', 'text', 'Google Redirect URIs para OAuth'],
    ['backup_google_refresh_token', '', 'text', 'Google Refresh Token para backup'],
    ['fiscal_ambiente', '2', 'number', '1=produção, 2=homologação'],
    ['fiscal_uf_sigla', 'CE', 'string', 'UF emitente'],
    ['fiscal_codigo_uf', '23', 'string', 'Código IBGE da UF emitente'],
    ['fiscal_serie', '1', 'number', 'Série da NFC-e'],
    ['fiscal_numero_atual', '1', 'number', 'Próximo número da NFC-e'],
    ['fiscal_regime_tributario', '1', 'string', 'CRT do emitente'],
    ['fiscal_ie', '', 'string', 'Inscrição estadual'],
    ['fiscal_im', '', 'string', 'Inscrição municipal'],
    ['fiscal_cnae', '', 'string', 'CNAE fiscal'],
    ['fiscal_certificado_path', '', 'string', 'Caminho do certificado A1/PFX'],
    ['fiscal_certificado_senha', '', 'string', 'Senha do certificado A1/PFX'],
    ['fiscal_id_csc', '', 'string', 'Identificador CSC'],
    ['fiscal_token_csc', '', 'string', 'Token CSC'],
    ['fiscal_ws_autorizacao_homologacao', 'https://nfce-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx', 'string', 'WS autorização homologação'],
    ['fiscal_ws_retorno_homologacao', 'https://nfce-homologacao.svrs.rs.gov.br/ws/NFeRetAutorizacao/NFeRetAutorizacao4.asmx', 'string', 'WS retorno homologação'],
    ['fiscal_ws_status_homologacao', 'https://nfce-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NFeStatusServico4.asmx', 'string', 'WS status homologação'],
    ['fiscal_csc_qrcode_url_homologacao', 'http://nfceh.sefaz.ce.gov.br/pages/ShowNFCe.html', 'string', 'Base QR Code homologação CE'],
    ['fiscal_consulta_chave_url_homologacao', 'http://nfceh.sefaz.ce.gov.br/pages/ShowNFCe.html', 'string', 'Consulta chave homologação CE'],
    ['fiscal_ws_autorizacao_producao', 'https://nfce.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx', 'string', 'WS autorização produção'],
    ['fiscal_ws_retorno_producao', 'https://nfce.svrs.rs.gov.br/ws/NFeRetAutorizacao/NFeRetAutorizacao4.asmx', 'string', 'WS retorno produção'],
    ['fiscal_ws_status_producao', 'https://nfce.svrs.rs.gov.br/ws/NfeStatusServico/NFeStatusServico4.asmx', 'string', 'WS status produção'],
    ['fiscal_csc_qrcode_url_producao', 'https://nfce.sefaz.ce.gov.br/pages/ShowNFCe.html', 'string', 'Base QR Code produção CE'],
    ['fiscal_consulta_chave_url_producao', 'https://nfce.sefaz.ce.gov.br/pages/ShowNFCe.html', 'string', 'Consulta chave produção CE'],
    ['fiscal_tp_imp', '4', 'number', 'Tipo impressão DANFE NFC-e'],
    ['fiscal_municipio_codigo', '2307304', 'string', 'Código município emitente'],
    ['fiscal_municipio_nome', 'Juazeiro do Norte', 'string', 'Nome município emitente'],
    ['fiscal_emitente_cep', '', 'string', 'CEP emitente'],
    ['fiscal_emitente_logradouro', '', 'string', 'Logradouro emitente'],
    ['fiscal_emitente_numero', 'S/N', 'string', 'Número emitente'],
    ['fiscal_emitente_bairro', '', 'string', 'Bairro emitente']
  ];

  configs.forEach(config => {
    db.run(`
      INSERT OR IGNORE INTO configuracoes (chave, valor, tipo, descricao)
      VALUES (?, ?, ?, ?)
    `, config, (err) => {
      if (err) {
        console.error(`Erro ao inserir configuração ${config[0]}:`, err);
      }
    });
  });
  
  console.log('Configurações padrão inseridas/verificadas');
}

function seedUsuarioAdmin() {
  db.get('SELECT COUNT(*) AS total FROM usuarios', [], (countErr, countRow) => {
    if (countErr || (countRow?.total || 0) > 0) return;

    const crypto = require('crypto');
    const senhaInicial = process.env.ADMIN_SEED_PASSWORD || crypto.randomBytes(12).toString('base64url');
    const hash = bcrypt.hashSync(senhaInicial, 10);
    db.run(`
      INSERT INTO usuarios (username, password_hash, role)
      VALUES ('Diego', ?, 'admin')
    `, [hash], (err) => {
      if (err) console.error('Erro ao criar usuário administrador padrão:', err);
      else if (!process.env.ADMIN_SEED_PASSWORD) {
        console.warn('[SEGURANÇA] Admin inicial Diego — senha temporária:', senhaInicial);
      }
    });
  });
}

module.exports = db;