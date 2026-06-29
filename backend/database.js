const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

// BANCO OFICIAL DEFINITIVO
// Prioridade 1: variável DB_DIR
// Prioridade 2: pasta padrão profissional do Windows
const DB_DIR = process.env.DB_DIR || path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'MercantilFiscal', 'dados');

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const DB_PATH = path.join(DB_DIR, 'mercadao.db');

console.log('======================================');
console.log('BANCO OFICIAL EM USO:');
console.log(DB_PATH);
console.log('======================================');

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Erro ao conectar ao banco:', err.message);
  } else {
    console.log('Conectado ao banco de dados SQLite');
    db.run('PRAGMA journal_mode=WAL');
    db.run('PRAGMA busy_timeout=5000');
    inicializarBanco();
  }
});

db.dbDir = DB_DIR;
db.dbPath = DB_PATH;

// Helper: insert seguro que só usa colunas existentes na tabela
db.insertSafe = function(table, data, callback) {
  const keys = Object.keys(data || {});
  if (keys.length === 0) {
    if (callback) return callback(new Error('No data provided for insert'));
    return;
  }
  db.all(`PRAGMA table_info(${table})`, [], (err, cols) => {
    if (err) return callback ? callback(err) : null;
    const colNames = (cols || []).map(c => c.name);
    const useKeys = keys.filter(k => colNames.includes(k));
    if (useKeys.length === 0) {
      return callback ? callback(new Error(`No matching columns found on table ${table}`)) : null;
    }
    const placeholders = useKeys.map(() => '?').join(', ');
    const sql = `INSERT INTO ${table} (${useKeys.join(', ')}) VALUES (${placeholders})`;
    const values = useKeys.map(k => data[k]);
    db.run(sql, values, function(runErr) {
      if (callback) callback(runErr, this);
    });
  });
};

function aplicarAlteracaoSegura(tabela, sql) {
  db.run(sql, (err) => {
    if (err) {
      const mensagem = err.message || ''
      if (
        mensagem.includes('duplicate column name') ||
        mensagem.includes('already exists')
      ) {
        return;
      }
      console.error(`Erro ao executar alteração em ${tabela}: ${sql}`, err);
      return;
    }
    console.log(`Alteração aplicada em ${tabela}: ${sql}`);
  });
}

function migrarColunaTefConfiguracaoId(tabela) {
  db.all(`PRAGMA table_info(${tabela})`, (err, cols) => {
    if (err || !Array.isArray(cols) || cols.length === 0) {
      return;
    }

    const nomes = cols.map((c) => c.name);
    const temLegado = nomes.includes('tef_config_id');
    const temAtual = nomes.includes('tef_configuracao_id');

    if (temLegado && !temAtual) {
      db.run(
        `ALTER TABLE ${tabela} RENAME COLUMN tef_config_id TO tef_configuracao_id`,
        (renameErr) => {
          if (renameErr) {
            console.error(`Erro ao renomear tef_config_id em ${tabela}:`, renameErr.message);
            return;
          }
          console.log(`Coluna tef_config_id renomeada para tef_configuracao_id em ${tabela}`);
        }
      );
      return;
    }

    if (!temAtual && !temLegado) {
      aplicarAlteracaoSegura(tabela, `ALTER TABLE ${tabela} ADD COLUMN tef_configuracao_id INTEGER`);
    }
  });
}

function aplicarAlteracoesPosCriacao() {
  aplicarAlteracaoSegura('categorias', `ALTER TABLE categorias ADD COLUMN tipo TEXT DEFAULT 'produto'`);
  aplicarAlteracaoSegura('caixa', `ALTER TABLE caixa ADD COLUMN status TEXT DEFAULT 'aberto'`);
  aplicarAlteracaoSegura('caixa', `ALTER TABLE caixa ADD COLUMN terminal_id INTEGER REFERENCES terminais(id)`);
  aplicarAlteracaoSegura('vendas', `ALTER TABLE vendas ADD COLUMN caixa_id INTEGER REFERENCES caixa(id)`);
  aplicarAlteracaoSegura('vendas', `ALTER TABLE vendas ADD COLUMN terminal_id INTEGER REFERENCES terminais(id)`);
  aplicarAlteracaoSegura('vendas', `ALTER TABLE vendas ADD COLUMN operador_id INTEGER REFERENCES usuarios(id)`);
  aplicarAlteracaoSegura('vendas', `ALTER TABLE vendas ADD COLUMN status_pagamento TEXT DEFAULT 'pendente'`);
  aplicarAlteracaoSegura('vendas', `ALTER TABLE vendas ADD COLUMN tef_transacao_id INTEGER`);
  aplicarAlteracaoSegura('caixa_movimentacoes', `ALTER TABLE caixa_movimentacoes ADD COLUMN terminal_id INTEGER`);
  aplicarAlteracaoSegura('vendas', `ALTER TABLE vendas ADD COLUMN caixa_sessao_id INTEGER REFERENCES caixa_sessoes(id)`);
  aplicarAlteracaoSegura('caixa_movimentacoes', `ALTER TABLE caixa_movimentacoes ADD COLUMN sessao_id INTEGER REFERENCES caixa_sessoes(id)`);
  aplicarAlteracaoSegura('caixa_fechamentos', `ALTER TABLE caixa_fechamentos ADD COLUMN sessao_id INTEGER REFERENCES caixa_sessoes(id)`);
  aplicarAlteracaoSegura('auditoria_caixa', `ALTER TABLE auditoria_caixa ADD COLUMN sessao_id INTEGER REFERENCES caixa_sessoes(id)`);
  aplicarAlteracaoSegura('auditoria_caixa', `ALTER TABLE auditoria_caixa ADD COLUMN terminal_id INTEGER REFERENCES terminais(id)`);
  aplicarAlteracaoSegura('terminais', `ALTER TABLE terminais ADD COLUMN usuario_id INTEGER REFERENCES usuarios(id)`);
  aplicarAlteracaoSegura('terminais', `ALTER TABLE terminais ADD COLUMN usuario_nome TEXT`);
  aplicarAlteracaoSegura('caixa_sessoes', `ALTER TABLE caixa_sessoes ADD COLUMN caixa_turno_id INTEGER REFERENCES caixa(id)`);

  // Adicionar colunas faltantes na tabela vendas_itens (para suportar promoções e desconto atacado)
  aplicarAlteracaoSegura('vendas_itens', `ALTER TABLE vendas_itens ADD COLUMN desconto_percentual DECIMAL(5,2) DEFAULT 0`);
  aplicarAlteracaoSegura('vendas_itens', `ALTER TABLE vendas_itens ADD COLUMN promocao_id INTEGER`);
  aplicarAlteracaoSegura('vendas_itens', `ALTER TABLE vendas_itens ADD COLUMN desconto_atacado DECIMAL(10,2) DEFAULT 0`);
  aplicarAlteracaoSegura('vendas_itens', `ALTER TABLE vendas_itens ADD COLUMN tipo_preco TEXT DEFAULT 'varejo'`);
  aplicarAlteracaoSegura('vendas_itens', `ALTER TABLE vendas_itens ADD COLUMN item_fiscal INTEGER DEFAULT 0`);
  aplicarAlteracaoSegura('vendas_itens', `ALTER TABLE vendas_itens ADD COLUMN quantidade_fiscal REAL DEFAULT 0`);
  aplicarAlteracaoSegura('vendas_itens', `ALTER TABLE vendas_itens ADD COLUMN quantidade_nao_fiscal REAL DEFAULT 0`);
  aplicarAlteracaoSegura('vendas_itens', `ALTER TABLE vendas_itens ADD COLUMN valor_fiscal REAL DEFAULT 0`);
  aplicarAlteracaoSegura('vendas_itens', `ALTER TABLE vendas_itens ADD COLUMN valor_nao_fiscal REAL DEFAULT 0`);
  aplicarAlteracaoSegura('vendas_itens', `ALTER TABLE vendas_itens ADD COLUMN modo_venda TEXT DEFAULT 'peso'`);
  aplicarAlteracaoSegura('vendas_itens', `ALTER TABLE vendas_itens ADD COLUMN tipo_venda TEXT DEFAULT 'PESO'`);

  // Adicionar colunas faltantes na tabela configuracoes
  aplicarAlteracaoSegura('configuracoes', `ALTER TABLE configuracoes ADD COLUMN fiscal_emitente_logradouro TEXT DEFAULT ''`);
  aplicarAlteracaoSegura('configuracoes', `ALTER TABLE configuracoes ADD COLUMN fiscal_emitente_numero TEXT DEFAULT 'S/N'`);
  aplicarAlteracaoSegura('configuracoes', `ALTER TABLE configuracoes ADD COLUMN fiscal_emitente_bairro TEXT DEFAULT ''`);

  // Adicionar colunas faltantes na tabela caixa
  aplicarAlteracaoSegura('caixa', `ALTER TABLE caixa ADD COLUMN total_sangrias DECIMAL(10,2) DEFAULT 0`);
  aplicarAlteracaoSegura('caixa', `ALTER TABLE caixa ADD COLUMN total_suprimentos DECIMAL(10,2) DEFAULT 0`);
  aplicarAlteracaoSegura('caixa_fechamentos', `ALTER TABLE caixa_fechamentos ADD COLUMN total_suprimentos DECIMAL(10,2) DEFAULT 0`);
  aplicarAlteracaoSegura('caixa', `ALTER TABLE caixa ADD COLUMN saldo_esperado DECIMAL(10,2) DEFAULT 0`);
  aplicarAlteracaoSegura('caixa', `ALTER TABLE caixa ADD COLUMN valor_fechamento DECIMAL(10,2) DEFAULT 0`);
  aplicarAlteracaoSegura('caixa', `ALTER TABLE caixa ADD COLUMN diferenca DECIMAL(10,2) DEFAULT 0`);
  aplicarAlteracaoSegura('caixa', `ALTER TABLE caixa ADD COLUMN observacao TEXT`);
  aplicarAlteracaoSegura('caixa', `ALTER TABLE caixa ADD COLUMN aberto_em DATETIME`);
  aplicarAlteracaoSegura('caixa', `ALTER TABLE caixa ADD COLUMN fechado_em DATETIME`);
  aplicarAlteracaoSegura('caixa', `ALTER TABLE caixa ADD COLUMN fechado_por INTEGER REFERENCES usuarios(id)`);
  aplicarAlteracaoSegura('caixa', `ALTER TABLE caixa ADD COLUMN ja_reimpresso INTEGER DEFAULT 0`);
  aplicarAlteracaoSegura('caixa', `ALTER TABLE caixa ADD COLUMN reoperturas_count INTEGER DEFAULT 0`);
  aplicarAlteracaoSegura('caixas', `ALTER TABLE caixas ADD COLUMN created_at DATETIME`);
  aplicarAlteracaoSegura('caixas', `ALTER TABLE caixas ADD COLUMN updated_at DATETIME`);
  aplicarAlteracaoSegura('caixa_movimentacoes', `ALTER TABLE caixa_movimentacoes ADD COLUMN operador_nome TEXT`);

  // Adicionar colunas na tabela usuarios
  aplicarAlteracaoSegura('usuarios', `ALTER TABLE usuarios ADD COLUMN ativo INTEGER DEFAULT 1`);
  aplicarAlteracaoSegura('usuarios', `ALTER TABLE usuarios ADD COLUMN nome TEXT`);
  aplicarAlteracaoSegura('usuarios', `ALTER TABLE usuarios ADD COLUMN perfil TEXT DEFAULT 'USUARIO'`);
  aplicarAlteracaoSegura('usuarios', `ALTER TABLE usuarios ADD COLUMN pode_alterar_senhas INTEGER DEFAULT 0`);
  // Garantir coluna criado_em na tabela auditoria (compatibilidade com migrações anteriores)
  aplicarAlteracaoSegura('auditoria', `ALTER TABLE auditoria ADD COLUMN criado_em DATETIME DEFAULT CURRENT_TIMESTAMP`);

  const alteracoesProdutos = [
    `ALTER TABLE produtos ADD COLUMN categoria_id INTEGER`,
    `ALTER TABLE produtos ADD COLUMN subcategoria_id INTEGER`,
    `ALTER TABLE produtos ADD COLUMN ncm TEXT`,
    `ALTER TABLE produtos ADD COLUMN cfop TEXT`,
    `ALTER TABLE produtos ADD COLUMN csosn TEXT`,
    `ALTER TABLE produtos ADD COLUMN origem INTEGER DEFAULT 0`,
    `ALTER TABLE produtos ADD COLUMN cest TEXT`,
    `ALTER TABLE produtos ADD COLUMN codigo_barras TEXT`,
    `ALTER TABLE produtos ADD COLUMN data_validade DATE`,
    `ALTER TABLE produtos ADD COLUMN lote TEXT`,
    `ALTER TABLE produtos ADD COLUMN dias_alerta_validade INTEGER DEFAULT 30`,
    `ALTER TABLE produtos ADD COLUMN controlar_validade INTEGER DEFAULT 0`,
    `ALTER TABLE produtos ADD COLUMN aliquota_icms REAL DEFAULT 0`,
    `ALTER TABLE produtos ADD COLUMN aliquota_pis REAL DEFAULT 0`,
    `ALTER TABLE produtos ADD COLUMN aliquota_cofins REAL DEFAULT 0`,
    `ALTER TABLE produtos ADD COLUMN lucro_percentual DECIMAL(10,2)`,
    `ALTER TABLE produtos ADD COLUMN venda_atacado INTEGER DEFAULT 0`,
    `ALTER TABLE produtos ADD COLUMN ativo INTEGER DEFAULT 1`,
    `ALTER TABLE produtos ADD COLUMN item_fiscal INTEGER DEFAULT 0`,
    `ALTER TABLE produtos ADD COLUMN saldo_fiscal REAL DEFAULT 0`,
    `ALTER TABLE produtos ADD COLUMN saldo_nao_fiscal REAL DEFAULT 0`,
    `ALTER TABLE produtos ADD COLUMN permite_venda_unidade INTEGER DEFAULT 0`,
    `ALTER TABLE produtos ADD COLUMN peso_medio_unidade REAL DEFAULT 0`,
    `ALTER TABLE produtos ADD COLUMN preco_unidade REAL DEFAULT 0`
  ];

  const alteracoesCompras = [
    `ALTER TABLE compras ADD COLUMN condicao_pagamento TEXT DEFAULT 'avista'`,
    `ALTER TABLE compras ADD COLUMN forma_pagamento TEXT`,
    `ALTER TABLE compras ADD COLUMN data_vencimento DATE`,
    `ALTER TABLE compras ADD COLUMN parcelas INTEGER DEFAULT 1`,
    `ALTER TABLE compras ADD COLUMN valor_entrada DECIMAL(10,2) DEFAULT 0`,
    `ALTER TABLE compras ADD COLUMN observacao TEXT`,
    `ALTER TABLE compras ADD COLUMN numero_nf TEXT`,
    `ALTER TABLE compras ADD COLUMN serie_nf TEXT`,
    `ALTER TABLE compras ADD COLUMN modelo_nf TEXT`,
    `ALTER TABLE compras ADD COLUMN chave_acesso TEXT`,
    `ALTER TABLE compras ADD COLUMN data_emissao DATE`,
    `ALTER TABLE compras ADD COLUMN data_entrada DATE`,
    `ALTER TABLE compras ADD COLUMN valor_produtos DECIMAL(10,2) DEFAULT 0`,
    `ALTER TABLE compras ADD COLUMN valor_desconto DECIMAL(10,2) DEFAULT 0`,
    `ALTER TABLE compras ADD COLUMN valor_frete DECIMAL(10,2) DEFAULT 0`,
    `ALTER TABLE compras ADD COLUMN valor_outras_despesas DECIMAL(10,2) DEFAULT 0`,
    `ALTER TABLE compras ADD COLUMN valor_total_nota DECIMAL(10,2) DEFAULT 0`,
    `ALTER TABLE compras ADD COLUMN cancelada_em DATETIME`,
    `ALTER TABLE compras ADD COLUMN motivo_cancelamento TEXT`,
    `ALTER TABLE compras ADD COLUMN nota_fiscal_avulsa INTEGER DEFAULT 0`,
    `ALTER TABLE compras ADD COLUMN total_xml DECIMAL(10,2) DEFAULT 0`,
    `ALTER TABLE compras ADD COLUMN total_itens_calculado DECIMAL(10,2) DEFAULT 0`,
    `ALTER TABLE compras ADD COLUMN diferenca_total DECIMAL(10,2) DEFAULT 0`,
    `ALTER TABLE compras ADD COLUMN fornecedor_cnpj TEXT`
  ];

  const alteracoesFinanceiro = [
    `ALTER TABLE financeiro ADD COLUMN status TEXT DEFAULT 'pago'`,
    `ALTER TABLE financeiro ADD COLUMN origem TEXT DEFAULT 'manual'`,
    `ALTER TABLE financeiro ADD COLUMN documento TEXT`,
    `ALTER TABLE financeiro ADD COLUMN vencimento DATE`,
    `ALTER TABLE financeiro ADD COLUMN numero_parcela INTEGER`,
    `ALTER TABLE financeiro ADD COLUMN total_parcelas INTEGER`,
    `ALTER TABLE financeiro ADD COLUMN compra_id INTEGER`,
    `ALTER TABLE financeiro ADD COLUMN venda_id INTEGER`,
    `ALTER TABLE financeiro ADD COLUMN pessoa_nome TEXT`,
    `ALTER TABLE financeiro ADD COLUMN observacao TEXT`,
    `ALTER TABLE financeiro ADD COLUMN baixado_em DATE`
  ];

  const alteracoesComprasItens = [
    `ALTER TABLE compras_itens ADD COLUMN descricao_produto TEXT`,
    `ALTER TABLE compras_itens ADD COLUMN codigo_barras TEXT`,
    `ALTER TABLE compras_itens ADD COLUMN margem_lucro DECIMAL(10,2) DEFAULT 30`,
    `ALTER TABLE compras_itens ADD COLUMN preco_venda_sugerido DECIMAL(10,2)`,
    `ALTER TABLE compras_itens ADD COLUMN unidade TEXT`,
    `ALTER TABLE compras_itens ADD COLUMN ncm TEXT`,
    `ALTER TABLE compras_itens ADD COLUMN frete_rateado DECIMAL(10,2) DEFAULT 0`,
    `ALTER TABLE compras_itens ADD COLUMN desconto_rateado DECIMAL(10,2) DEFAULT 0`,
    `ALTER TABLE compras_itens ADD COLUMN outras_despesas_rateado DECIMAL(10,2) DEFAULT 0`,
    `ALTER TABLE compras_itens ADD COLUMN custo_unitario_final DECIMAL(10,2) DEFAULT 0`,
    `ALTER TABLE compras_itens ADD COLUMN vendido_por_peso INTEGER DEFAULT 0`,
    `ALTER TABLE compras_itens ADD COLUMN peso_total_compra DECIMAL(10,3) DEFAULT 0`,
    `ALTER TABLE compras_itens ADD COLUMN custo_por_kg DECIMAL(10,2) DEFAULT 0`,
    `ALTER TABLE compras_itens ADD COLUMN atualizar_preco_venda INTEGER DEFAULT 1`,
    `ALTER TABLE compras_itens ADD COLUMN item_fiscal INTEGER DEFAULT 1`,
    `ALTER TABLE compras_itens ADD COLUMN quantidade_fiscal REAL DEFAULT 0`,
    `ALTER TABLE compras_itens ADD COLUMN quantidade_nao_fiscal REAL DEFAULT 0`,
    `ALTER TABLE compras_itens ADD COLUMN compra_em TEXT`,
    `ALTER TABLE compras_itens ADD COLUMN quantidade_embalagens DECIMAL(10,3) DEFAULT 0`,
    `ALTER TABLE compras_itens ADD COLUMN quantidade_por_embalagem DECIMAL(10,3) DEFAULT 0`,
    `ALTER TABLE compras_itens ADD COLUMN valor_total_embalagem DECIMAL(10,2) DEFAULT 0`
  ];

  const alteracoesVendas = [
    `ALTER TABLE vendas ADD COLUMN valor_recebido DECIMAL(10,2)`,
    `ALTER TABLE vendas ADD COLUMN status TEXT DEFAULT 'concluida'`,
    `ALTER TABLE vendas ADD COLUMN cpf_cnpj_nota TEXT`,
    `ALTER TABLE vendas ADD COLUMN cancelada INTEGER DEFAULT 0`,
    `ALTER TABLE vendas ADD COLUMN data_cancelamento DATETIME`,
    `ALTER TABLE vendas ADD COLUMN desconto_autorizado_por_id INTEGER`,
    `ALTER TABLE vendas ADD COLUMN desconto_autorizado_por TEXT`,
    `ALTER TABLE vendas ADD COLUMN desconto_autorizado_em DATETIME`,
    `ALTER TABLE vendas ADD COLUMN valor_fiscal REAL DEFAULT 0`,
    `ALTER TABLE vendas ADD COLUMN valor_nao_fiscal REAL DEFAULT 0`
  ];

  const alteracoesContasReceber = [
    `ALTER TABLE contas_receber ADD COLUMN observacao TEXT`
  ];

  const alteracoesCaixaMovimentacoes = [
    `ALTER TABLE caixa_movimentacoes ADD COLUMN usuario_id INTEGER`
  ];

  alteracoesProdutos.forEach(sql => aplicarAlteracaoSegura('produtos', sql));
  alteracoesCompras.forEach(sql => aplicarAlteracaoSegura('compras', sql));
  alteracoesFinanceiro.forEach(sql => aplicarAlteracaoSegura('financeiro', sql));
  alteracoesComprasItens.forEach(sql => aplicarAlteracaoSegura('compras_itens', sql));
  alteracoesVendas.forEach(sql => aplicarAlteracaoSegura('vendas', sql));
  alteracoesContasReceber.forEach(sql => aplicarAlteracaoSegura('contas_receber', sql));
  alteracoesCaixaMovimentacoes.forEach(sql => aplicarAlteracaoSegura('caixa_movimentacoes', sql));

  aplicarAlteracaoSegura('tef_pinpads', `ALTER TABLE tef_pinpads ADD COLUMN codigo TEXT`);
  aplicarAlteracaoSegura('tef_pinpads', `ALTER TABLE tef_pinpads ADD COLUMN nome TEXT`);
  aplicarAlteracaoSegura('tef_pinpads', `ALTER TABLE tef_pinpads ADD COLUMN ativo INTEGER DEFAULT 1`);

  const alteracoesTefTransacoes = [
    `ALTER TABLE tef_transacoes ADD COLUMN idempotency_key TEXT`,
    `ALTER TABLE tef_transacoes ADD COLUMN payload_retorno TEXT`,
    `ALTER TABLE tef_transacoes ADD COLUMN comprovante_cliente TEXT`,
    `ALTER TABLE tef_transacoes ADD COLUMN comprovante_estabelecimento TEXT`,
    `ALTER TABLE tef_transacoes ADD COLUMN codigo_transacao TEXT`,
    `ALTER TABLE tef_transacoes ADD COLUMN codigo_resposta TEXT`,
    `ALTER TABLE tef_transacoes ADD COLUMN mensagem_resposta TEXT`,
    `ALTER TABLE tef_transacoes ADD COLUMN nfce_numero INTEGER`,
    `ALTER TABLE tef_transacoes ADD COLUMN nfce_chave TEXT`,
    `ALTER TABLE tef_transacoes ADD COLUMN criado_em DATETIME`,
    `ALTER TABLE tef_transacoes ADD COLUMN atualizado_em DATETIME`,
    `ALTER TABLE tef_transacoes ADD COLUMN created_at DATETIME`,
    `ALTER TABLE tef_transacoes ADD COLUMN updated_at DATETIME`
  ];
  alteracoesTefTransacoes.forEach((sql) => aplicarAlteracaoSegura('tef_transacoes', sql));
  aplicarAlteracaoSegura(
    'tef_transacoes',
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_tef_transacoes_idempotency_key ON tef_transacoes(idempotency_key) WHERE idempotency_key IS NOT NULL`
  );

  ['tef_pinpads', 'tef_servidores', 'tef_operacoes'].forEach(migrarColunaTefConfiguracaoId);
}

function criarTabelas() {
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS tef_transacoes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        venda_id INTEGER,
        tipo TEXT NOT NULL,
        valor DECIMAL(10,2) NOT NULL,
        parcelas INTEGER DEFAULT 1,
        status TEXT DEFAULT 'pendente',
        provedor TEXT DEFAULT 'SITEF',
        adquirente TEXT,
        bandeira TEXT,
        nsu TEXT,
        autorizacao TEXT,
        codigo_transacao TEXT,
        codigo_resposta TEXT,
        mensagem_resposta TEXT,
        nfce_numero INTEGER,
        nfce_chave TEXT,
        idempotency_key TEXT UNIQUE,
        comprovante_cliente TEXT,
        comprovante_estabelecimento TEXT,
        payload_retorno TEXT,
        data_hora DATETIME DEFAULT CURRENT_TIMESTAMP,
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
        atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS tef_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transacao_id INTEGER,
        tipo TEXT,
        mensagem TEXT,
        payload TEXT,
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS tef_configuracoes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chave TEXT UNIQUE NOT NULL,
        valor TEXT,
        descricao TEXT,
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
        atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS tef_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token TEXT UNIQUE NOT NULL,
        numero_cartao TEXT NOT NULL,
        bin TEXT NOT NULL,
        last4 TEXT NOT NULL,
        ativo INTEGER DEFAULT 1,
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
        invalidado_em DATETIME
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS tef_locks (
        chave TEXT UNIQUE NOT NULL,
        expiracao DATETIME NOT NULL,
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS tef_auditoria_acesso (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transacao_id INTEGER NOT NULL,
        usuario_id INTEGER,
        usuario_nome TEXT,
        tipo_acesso TEXT NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        dados_acesso TEXT,
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (transacao_id) REFERENCES tef_transacoes(id)
      )
    `);

    // Adicionar campo hash_integridade na tabela tef_logs
    db.run(`
      ALTER TABLE tef_logs
      ADD COLUMN hash_integridade TEXT
    `, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Erro ao adicionar coluna hash_integridade:', err);
      }
    });

    db.run(`
      CREATE TABLE IF NOT EXISTS tef_alertas_fraude (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transacao_id INTEGER,
        alertas TEXT NOT NULL,
        nivel_risco TEXT NOT NULL,
        dados_transacao TEXT,
        contexto TEXT,
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (transacao_id) REFERENCES tef_transacoes(id)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS tef_notificacoes_falha (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tipo_erro TEXT NOT NULL,
        codigo_erro TEXT,
        mensagem TEXT,
        severidade TEXT,
        dados_falha TEXT,
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS tef_tokens_cartao (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token TEXT UNIQUE NOT NULL,
        dados_criptografados TEXT NOT NULL,
        bandeira TEXT,
        ativo INTEGER DEFAULT 1,
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
        revogado_em DATETIME
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS tef_conciliacao (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        data_conciliacao DATE NOT NULL,
        transacoes_tef INTEGER NOT NULL,
        vendas_vinculadas INTEGER NOT NULL,
        vendas_nao_vinculadas INTEGER NOT NULL,
        transacoes_nao_vinculadas INTEGER NOT NULL,
        total_valor_tef REAL NOT NULL,
        total_valor_vendas REAL NOT NULL,
        divergencia_valor REAL NOT NULL,
        divergencias TEXT,
        sucesso INTEGER NOT NULL,
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS tef_backups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        arquivo TEXT NOT NULL,
        transacoes_backup INTEGER NOT NULL,
        logs_backup INTEGER NOT NULL,
        tamanho_bytes INTEGER NOT NULL,
        sucesso INTEGER NOT NULL,
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS tef_metricas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transacoes_total INTEGER NOT NULL,
        transacoes_aprovadas INTEGER NOT NULL,
        transacoes_negadas INTEGER NOT NULL,
        transacoes_erro INTEGER NOT NULL,
        valor_total REAL NOT NULL,
        tempo_medio_resposta REAL,
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS tef_alertas_monitoramento (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tipo TEXT NOT NULL,
        mensagem TEXT NOT NULL,
        severidade TEXT NOT NULL,
        dados TEXT,
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add columns to tef_configuracoes if they don't exist
    db.run(`
      ALTER TABLE tef_configuracoes
      ADD COLUMN sdk_path TEXT
    `, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Erro ao adicionar coluna sdk_path:', err);
      }
    });

    db.run(`
      ALTER TABLE tef_configuracoes
      ADD COLUMN exe_path TEXT
    `, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Erro ao adicionar coluna exe_path:', err);
      }
    });

    db.run(`
      ALTER TABLE tef_configuracoes
      ADD COLUMN ip TEXT
    `, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Erro ao adicionar coluna ip:', err);
      }
    });

    db.run(`
      ALTER TABLE tef_configuracoes
      ADD COLUMN porta INTEGER
    `, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Erro ao adicionar coluna porta:', err);
      }
    });

    db.run(`
      ALTER TABLE tef_configuracoes
      ADD COLUMN ambiente TEXT
    `, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Erro ao adicionar coluna ambiente:', err);
      }
    });

    db.run(`
      CREATE TABLE IF NOT EXISTS tef_configuracao (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        habilitado INTEGER DEFAULT 0,
        provedor TEXT,
        ambiente TEXT,
        timeout INTEGER,
        tentativas INTEGER,
        empresa_codigo TEXT,
        loja_codigo TEXT,
        pdv_codigo TEXT,
        terminal_codigo TEXT,
        caixa_codigo TEXT,
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
        atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS tef_servidores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tef_configuracao_id INTEGER,
        base_url TEXT,
        ip TEXT,
        porta INTEGER,
        client_id TEXT,
        client_secret TEXT,
        access_token TEXT,
        refresh_token TEXT,
        chave_comunicacao TEXT,
        operador TEXT,
        FOREIGN KEY (tef_configuracao_id) REFERENCES tef_configuracao(id)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS tef_pinpads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tef_configuracao_id INTEGER,
        habilitado INTEGER,
        codigo TEXT,
        nome TEXT,
        fabricante TEXT,
        modelo TEXT,
        tipo_conexao TEXT,
        porta_com TEXT,
        ip TEXT,
        porta INTEGER,
        serial TEXT,
        status TEXT,
        ultima_conexao TEXT,
        ativo INTEGER DEFAULT 1,
        FOREIGN KEY (tef_configuracao_id) REFERENCES tef_configuracao(id)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS tef_pinpad_catalogo (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        codigo TEXT UNIQUE NOT NULL,
        nome TEXT NOT NULL,
        fabricante TEXT,
        modelo TEXT,
        adquirente_sugerido TEXT,
        ativo INTEGER DEFAULT 1,
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS tef_operacoes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tef_configuracao_id INTEGER,
        debito INTEGER,
        credito_avista INTEGER,
        credito_parcelado INTEGER,
        voucher INTEGER,
        pix INTEGER,
        cancelamento INTEGER,
        reimpressao INTEGER,
        pre_autorizacao INTEGER,
        confirmacao_manual INTEGER,
        FOREIGN KEY (tef_configuracao_id) REFERENCES tef_configuracao(id)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS tef_conciliacoes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transacao_id INTEGER,
        nsu TEXT,
        autorizacao TEXT,
        adquirente TEXT,
        bandeira TEXT,
        valor DECIMAL(10,2),
        status TEXT,
        data_transacao TEXT,
        data_conciliacao TEXT,
        diferenca DECIMAL(10,2),
        observacao TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (transacao_id) REFERENCES tef_transacoes(id)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS tef_fechamentos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        data_fechamento TEXT,
        total_transacoes INTEGER,
        total_valor DECIMAL(10,2),
        total_aprovado DECIMAL(10,2),
        total_negado DECIMAL(10,2),
        total_cancelado DECIMAL(10,2),
        arquivo_conciliacao TEXT,
        status TEXT DEFAULT 'pendente',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS licenca (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        codigo_instalacao TEXT UNIQUE NOT NULL,
        codigo_licenca TEXT,
        data_ativacao DATETIME,
        data_expiracao DATETIME,
        ultima_verificacao DATETIME,
        ultima_execucao DATETIME,
        status TEXT DEFAULT 'pendente',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) console.error('Erro ao criar tabela licenca:', err);
      else console.log('Tabela licenca criada/verificada');
    });

    db.run(`
      CREATE TABLE IF NOT EXISTS licenca_historico (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        acao TEXT NOT NULL,
        observacao TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) console.error('Erro ao criar tabela licenca_historico:', err);
      else console.log('Tabela licenca_historico criada/verificada');
    });

    db.run(`
      CREATE TABLE IF NOT EXISTS licenca_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        evento TEXT NOT NULL,
        detalhes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) console.error('Erro ao criar tabela licenca_logs:', err);
      else console.log('Tabela licenca_logs criada/verificada');
    });

    db.run(`
      CREATE TABLE IF NOT EXISTS licenca_execucao (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        data_execucao DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) console.error('Erro ao criar tabela licenca_execucao:', err);
      else console.log('Tabela licenca_execucao criada/verificada');
    });

    // Tabela de sugestões de promoções (Promoções Inteligentes)
    db.run(`
      CREATE TABLE IF NOT EXISTS promocoes_sugestoes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        produto_id INTEGER NOT NULL,
        motivo TEXT NOT NULL,
        dias_para_vencer INTEGER,
        estoque_atual DECIMAL(10,2),
        preco_atual DECIMAL(10,2),
        preco_sugerido DECIMAL(10,2),
        desconto_percentual DECIMAL(5,2),
        ativo INTEGER DEFAULT 1,
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
        aceito_em DATETIME,
        rejeitado_em DATETIME,
        FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE CASCADE
      )
    `, (err) => {
      if (err) console.error('Erro ao criar tabela promocoes_sugestoes:', err);
      else console.log('Tabela promocoes_sugestoes criada/verificada');
    });

    // Tabela de promoções ativas/encerradas
    db.run(`
      CREATE TABLE IF NOT EXISTS promocoes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        produto_id INTEGER NOT NULL,
        preco_original DECIMAL(10,2),
        preco_promocional DECIMAL(10,2),
        desconto_percentual DECIMAL(5,2),
        data_inicio DATE NOT NULL,
        data_fim DATE NOT NULL,
        status TEXT DEFAULT 'ativa',
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
        encerrado_em DATETIME,
        motivo_encerramento TEXT,
        FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE CASCADE
      )
    `, (err) => {
      if (err) console.error('Erro ao criar tabela promocoes:', err);
      else console.log('Tabela promocoes criada/verificada');
    });

    // Tabela de lotes de produtos (FEFO - First Expire, First Out)
    db.run(`
      CREATE TABLE IF NOT EXISTS produtos_lotes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        produto_id INTEGER NOT NULL,
        lote TEXT NOT NULL,
        quantidade_inicial DECIMAL(10,2) NOT NULL,
        quantidade_atual DECIMAL(10,2) NOT NULL,
        data_fabricacao DATE,
        data_validade DATE NOT NULL,
        data_entrada DATE NOT NULL,
        origem TEXT NOT NULL DEFAULT 'COMPRA',
        compra_id INTEGER,
        ativo INTEGER DEFAULT 1,
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
        atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE CASCADE,
        FOREIGN KEY (compra_id) REFERENCES compras(id)
      )
    `, (err) => {
      if (err) console.error('Erro ao criar tabela produtos_lotes:', err);
      else console.log('Tabela produtos_lotes criada/verificada');
    });

    // Tabela de rastreamento de lotes em vendas
    db.run(`
      CREATE TABLE IF NOT EXISTS venda_lotes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        venda_item_id INTEGER NOT NULL,
        produto_lote_id INTEGER NOT NULL,
        quantidade DECIMAL(10,2) NOT NULL,
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (venda_item_id) REFERENCES vendas_itens(id) ON DELETE CASCADE,
        FOREIGN KEY (produto_lote_id) REFERENCES produtos_lotes(id)
      )
    `, (err) => {
      if (err) console.error('Erro ao criar tabela venda_lotes:', err);
      else console.log('Tabela venda_lotes criada/verificada');
    });

    db.run(`
      CREATE TABLE IF NOT EXISTS produtos_ajustes_estoque (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        produto_id INTEGER NOT NULL,
        usuario_id INTEGER,
        usuario_nome TEXT,
        motivo TEXT NOT NULL,
        ajuste_fiscal REAL DEFAULT 0,
        ajuste_nao_fiscal REAL DEFAULT 0,
        saldo_fiscal_antes REAL DEFAULT 0,
        saldo_fiscal_depois REAL DEFAULT 0,
        saldo_nao_fiscal_antes REAL DEFAULT 0,
        saldo_nao_fiscal_depois REAL DEFAULT 0,
        estoque_total_antes REAL DEFAULT 0,
        estoque_total_depois REAL DEFAULT 0,
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (produto_id) REFERENCES produtos(id),
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
      )
    `, (err) => {
      if (err) console.error('Erro ao criar tabela produtos_ajustes_estoque:', err);
      else console.log('Tabela produtos_ajustes_estoque criada/verificada');
    });

    // Tabela de configurações de validade
    db.run(`
      CREATE TABLE IF NOT EXISTS configuracoes_validade (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dias_aviso_vencimento INTEGER DEFAULT 30,
        bloquear_venda_vencido INTEGER DEFAULT 0,
        alertar_venda_proximo_vencimento INTEGER DEFAULT 1,
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
        atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) console.error('Erro ao criar tabela configuracoes_validade:', err);
      else console.log('Tabela configuracoes_validade criada/verificada');
      
      // Inserir configuração padrão se não existir
      if (!err) {
        db.run(`
          INSERT OR IGNORE INTO configuracoes_validade (dias_aviso_vencimento, bloquear_venda_vencido, alertar_venda_proximo_vencimento)
          VALUES (30, 0, 1)
        `, (insertErr) => {
          if (insertErr && !insertErr.message.includes('UNIQUE')) {
            console.error('Erro ao inserir configuração padrão de validade:', insertErr);
          }
        });
      }
    });

    // Adicionar colunas TEF à tabela venda_pagamentos
    db.all(`PRAGMA table_info(venda_pagamentos)`, (err, columns) => {
      if (err) return console.error('Erro ao verificar venda_pagamentos:', err.message);

      const nomes = columns.map(c => c.name);

      function addColuna(nome, tipo) {
        if (!nomes.includes(nome)) {
          db.run(`ALTER TABLE venda_pagamentos ADD COLUMN ${nome} ${tipo}`, (e) => {
            if (e) console.error(`Erro ao adicionar coluna ${nome}:`, e.message);
            else console.log(`Coluna ${nome} adicionada em venda_pagamentos`);
          });
        }
      }

      addColuna('tef_transacao_id', 'INTEGER');
      addColuna('tef_nsu', 'TEXT');
      addColuna('tef_autorizacao', 'TEXT');
      addColuna('tef_bandeira', 'TEXT');
      addColuna('tef_adquirente', 'TEXT');
      addColuna('tef_comprovante_cliente', 'TEXT');
      addColuna('tef_comprovante_estabelecimento', 'TEXT');
    });

    // Tabela de categorias
    db.run(`
      CREATE TABLE IF NOT EXISTS categorias (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL UNIQUE,
        descricao TEXT,
        tipo TEXT NOT NULL DEFAULT 'produto',
        ativo INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) console.error('Erro ao criar tabela categorias:', err);
      else console.log('Tabela categorias criada/verificada');
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

    // Tabela de fornecedores
    db.run(`
      CREATE TABLE IF NOT EXISTS fornecedores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome VARCHAR(200) NOT NULL,
        razao_social VARCHAR(200),
        cpf_cnpj VARCHAR(20) UNIQUE,
        inscricao_estadual VARCHAR(20),
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
      
      // Adicionar coluna inscricao_estadual se não existir (para tabelas existentes)
      if (!err) {
        db.run(`
          ALTER TABLE fornecedores ADD COLUMN inscricao_estadual VARCHAR(20)
        `, (alterErr) => {
          if (alterErr && !alterErr.message.includes('duplicate column name')) {
            console.error('Erro ao adicionar coluna inscricao_estadual:', alterErr);
          } else if (!alterErr) {
            console.log('Coluna inscricao_estadual adicionada/verificada na tabela fornecedores');
          }
        });
      }
    });

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
        data_validade DATE,
        lote TEXT,
        dias_alerta_validade INTEGER DEFAULT 30,
        controlar_validade INTEGER DEFAULT 0,
        permite_venda_unidade INTEGER DEFAULT 0,
        peso_medio_unidade REAL DEFAULT 0,
        preco_unidade REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (categoria_id) REFERENCES categorias(id),
        FOREIGN KEY (subcategoria_id) REFERENCES subcategorias(id)
      )
    `, (err) => {
      if (err) console.error('Erro ao criar tabela produtos:', err);
      else console.log('Tabela produtos criada/verificada');
    });

      // Tabela de faixas de atacado por produto
      db.run(`
        CREATE TABLE IF NOT EXISTS produto_atacado (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          produto_id INTEGER NOT NULL,
          quantidade_minima INTEGER NOT NULL,
          preco_atacado DECIMAL(10,2) NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE CASCADE
        )
      `, (err) => {
        if (err) console.error('Erro ao criar tabela produto_atacado:', err);
        else console.log('Tabela produto_atacado criada/verificada');
      });

    const colunasProdutoPeso = [
      "ALTER TABLE produtos ADD COLUMN vendido_por_peso INTEGER DEFAULT 0",
      "ALTER TABLE produtos ADD COLUMN produto_fracionado INTEGER DEFAULT 0",
      "ALTER TABLE produtos ADD COLUMN peso_total_compra DECIMAL(10,3) DEFAULT 0",
      "ALTER TABLE produtos ADD COLUMN valor_total_compra DECIMAL(10,2) DEFAULT 0",
      "ALTER TABLE produtos ADD COLUMN custo_por_kg DECIMAL(10,2) DEFAULT 0"
    ];

    let migracaoConversaoUnidadesPendente = colunasProdutoPeso.length;
    const dispararMigracaoConversaoUnidades = () => {
      const { executarMigracaoConversaoUnidadesCallback } = require('./services/migracaoConversaoUnidades');
      executarMigracaoConversaoUnidadesCallback(db, (err, stats) => {
        if (err) {
          console.error('Erro na migração Motor de Conversão de Unidades:', err.message);
          return;
        }
        if (stats.migradosParaFracionado > 0 || stats.sincronizadosLegado > 0) {
          console.log(
            `Migração conversão de unidades: ${stats.migradosParaFracionado} legado(s) migrado(s), ` +
            `${stats.sincronizadosLegado} flag(s) sincronizada(s).`
          );
        }
      });
    };

    colunasProdutoPeso.forEach(sql => {
      db.run(sql, (err) => {
        if (err && !String(err.message).includes('duplicate column name')) {
          console.error('Erro ao adicionar coluna de produto fracionado:', err.message);
        }
        migracaoConversaoUnidadesPendente -= 1;
        if (migracaoConversaoUnidadesPendente === 0) {
          dispararMigracaoConversaoUnidades();
        }
      });
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
        data_emissao DATE,
        data_entrada DATE,
        fornecedor VARCHAR(200),
        numero_nf TEXT,
        serie_nf TEXT,
        modelo_nf TEXT,
        chave_acesso TEXT,
        valor_produtos DECIMAL(10,2) DEFAULT 0,
        valor_desconto DECIMAL(10,2) DEFAULT 0,
        valor_frete DECIMAL(10,2) DEFAULT 0,
        valor_outras_despesas DECIMAL(10,2) DEFAULT 0,
        valor_total_nota DECIMAL(10,2) DEFAULT 0,
        total DECIMAL(10,2) NOT NULL,
        status VARCHAR(20) DEFAULT 'pendente',
        condicao_pagamento TEXT DEFAULT 'avista',
        forma_pagamento TEXT,
        data_vencimento DATE,
        parcelas INTEGER DEFAULT 1,
        valor_entrada DECIMAL(10,2) DEFAULT 0,
        observacao TEXT,
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
        item_fiscal INTEGER DEFAULT 1,
        FOREIGN KEY (compra_id) REFERENCES compras(id) ON DELETE CASCADE,
        FOREIGN KEY (produto_id) REFERENCES produtos(id)
      )
    `, (err) => {
      if (err) console.error('Erro ao criar tabela compras_itens:', err);
      else console.log('Tabela compras_itens criada/verificada');
    });

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
    `, (err) => {
      if (err) console.error('Erro ao criar tabela compras_devolucoes:', err);
      else console.log('Tabela compras_devolucoes criada/verificada');
    });

    db.run(`
      CREATE TABLE IF NOT EXISTS vendas_devolucoes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        venda_id INTEGER NOT NULL,
        venda_item_id INTEGER NOT NULL,
        produto_id INTEGER NOT NULL,
        quantidade DECIMAL(10,3) NOT NULL,
        quantidade_fiscal DECIMAL(10,3) NOT NULL DEFAULT 0,
        quantidade_nao_fiscal DECIMAL(10,3) NOT NULL DEFAULT 0,
        valor_unitario DECIMAL(10,2) NOT NULL,
        valor_total DECIMAL(10,2) NOT NULL,
        motivo TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) console.error('Erro ao criar tabela vendas_devolucoes:', err);
      else console.log('Tabela vendas_devolucoes criada/verificada');
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
        valor_recebido DECIMAL(10,2),
        caixa_id INTEGER,
        cpf_cnpj_nota TEXT,
        cancelada INTEGER DEFAULT 0,
        data_cancelamento DATETIME,
        desconto_autorizado_por_id INTEGER,
        desconto_autorizado_por TEXT,
        desconto_autorizado_em DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (cliente_id) REFERENCES clientes(id),
        FOREIGN KEY (caixa_id) REFERENCES caixa(id)
      )
    `, (err) => {
      if (err) console.error('Erro ao criar tabela vendas:', err);
      else console.log('Tabela vendas criada/verificada');
    });

    // Tabela de alertas persistentes gerados pela auditoria/deteccao de anomalias
    db.run(`
      CREATE TABLE IF NOT EXISTS auditoria_alertas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tipo TEXT NOT NULL,
        descricao TEXT,
        dados TEXT,
        resolvido INTEGER DEFAULT 0,
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
        resolvido_em DATETIME
      )
    `, (err) => {
      if (err) console.error('Erro ao criar tabela auditoria_alertas:', err);
      else console.log('Tabela auditoria_alertas criada/verificada');
    });

    // Tabela de itens de venda
    db.run(`
      CREATE TABLE IF NOT EXISTS vendas_itens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        venda_id INTEGER,
        produto_id INTEGER,
        quantidade DECIMAL(10,2) NOT NULL,
        preco_unitario DECIMAL(10,2) NOT NULL,
        desconto_percentual DECIMAL(5,2) DEFAULT 0,
        promocao_id INTEGER,
        desconto_atacado DECIMAL(10,2) DEFAULT 0,
        tipo_preco TEXT DEFAULT 'varejo',
        subtotal DECIMAL(10,2) NOT NULL,
        FOREIGN KEY (venda_id) REFERENCES vendas(id) ON DELETE CASCADE,
        FOREIGN KEY (produto_id) REFERENCES produtos(id)
      )
    `, (err) => {
      if (err) console.error('Erro ao criar tabela vendas_itens:', err);
      else console.log('Tabela vendas_itens criada/verificada');
    });

    // Tabela de pagamentos de venda (para pagamento misto)
    db.run(`
      CREATE TABLE IF NOT EXISTS venda_pagamentos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        venda_id INTEGER NOT NULL,
        forma_pagamento TEXT NOT NULL,
        valor DECIMAL(10,2) NOT NULL,
        tef_transacao_id INTEGER,
        tef_nsu TEXT,
        tef_autorizacao TEXT,
        tef_bandeira TEXT,
        tef_adquirente TEXT,
        tef_comprovante_cliente TEXT,
        tef_comprovante_estabelecimento TEXT,
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (venda_id) REFERENCES vendas(id)
      )
    `, (err) => {
      if (err) console.error('Erro ao criar tabela venda_pagamentos:', err);
      else console.log('Tabela venda_pagamentos criada/verificada');
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

    db.run(`
      CREATE TABLE IF NOT EXISTS contas_receber_pagamentos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conta_receber_id INTEGER NOT NULL,
        cliente_id INTEGER NOT NULL,
        valor_pago DECIMAL(10,2) NOT NULL,
        data_pagamento DATE NOT NULL,
        forma_pagamento VARCHAR(50),
        observacao TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (conta_receber_id) REFERENCES contas_receber(id),
        FOREIGN KEY (cliente_id) REFERENCES clientes(id)
      )
    `, (err) => {
      if (err) console.error('Erro ao criar tabela contas_receber_pagamentos:', err);
      else console.log('Tabela contas_receber_pagamentos criada/verificada');
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

    // Tabela de recebimentos de vendas
    db.run(`
      CREATE TABLE IF NOT EXISTS venda_recebimentos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        venda_id INTEGER NOT NULL,
        tipo_recebimento TEXT NOT NULL,
        forma_pagamento TEXT NOT NULL,
        valor REAL NOT NULL,
        tef_transacao_id INTEGER,
        nsu TEXT,
        autorizacao TEXT,
        status TEXT DEFAULT 'aprovado',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (venda_id) REFERENCES vendas(id) ON DELETE CASCADE
      )
    `, (err) => {
      if (err) console.error('Erro ao criar tabela venda_recebimentos:', err);
      else console.log('Tabela venda_recebimentos criada/verificada');
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
      else console.log('Tabela usuarios criada/verificada');
    });

    // Permissões por usuário
    db.run(`
      CREATE TABLE IF NOT EXISTS usuario_permissoes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_id INTEGER NOT NULL,
        permissao TEXT NOT NULL,
        permitido INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(usuario_id, permissao),
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
      )
    `, (err) => {
      if (err) console.error('Erro ao criar tabela usuario_permissoes:', err);
      else console.log('Tabela usuario_permissoes criada/verificada');
    });

    // Tabela de vendas canceladas
    db.run(`
      CREATE TABLE IF NOT EXISTS vendas_canceladas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        venda_id INTEGER NOT NULL,
        motivo TEXT,
        usuario_id INTEGER,
        data_cancelamento DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) console.error('Erro ao criar tabela vendas_canceladas:', err);
      else console.log('Tabela vendas_canceladas criada/verificada');
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

    // Tabela de notas recebidas via Distribuição DF-e
    db.run(`
      CREATE TABLE IF NOT EXISTS notas_recebidas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chave TEXT UNIQUE,
        numero_nf TEXT,
        fornecedor TEXT,
        cnpj_fornecedor TEXT,
        data_emissao TEXT,
        valor_total REAL,
        xml TEXT,
        importada INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) console.error('Erro ao criar tabela notas_recebidas:', err);
      else console.log('Tabela notas_recebidas criada/verificada');
    });

    // Tabela de notas recebidas via DF-e (nova estrutura para distribuição)
    db.run(`
      CREATE TABLE IF NOT EXISTS notas_recebidas_dfe (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chave TEXT UNIQUE,
        numero TEXT,
        serie TEXT,
        fornecedor TEXT,
        cnpj_fornecedor TEXT,
        data_emissao TEXT,
        valor_total REAL,
        xml TEXT,
        importada INTEGER DEFAULT 0,
        nsu TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) console.error('Erro ao criar tabela notas_recebidas_dfe:', err);
      else console.log('Tabela notas_recebidas_dfe criada/verificada');
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
      }
    });
  });
}

function recuperarItemFiscalComprasItens() {
  db.all(`PRAGMA table_info(compras_itens)`, [], (err, rows) => {
    if (err) {
      console.error('Erro ao verificar coluna item_fiscal em compras_itens:', err.message);
      return;
    }
    if (!(rows || []).some((col) => col.name === 'item_fiscal')) {
      return;
    }

    db.get(`SELECT valor FROM configuracoes WHERE chave = ?`, ['migracao_item_fiscal_compras_itens'], (cfgErr, cfg) => {
      if (cfgErr) {
        console.error('Erro ao verificar migração item_fiscal compras_itens:', cfgErr.message);
        return;
      }

      const sqlRecuperacao = `
        UPDATE compras_itens
        SET item_fiscal = (
          SELECT COALESCE(p.item_fiscal, 0)
          FROM produtos p
          WHERE p.id = compras_itens.produto_id
        )
      `;
      const whereClause = cfg && cfg.valor === '1' ? ' WHERE item_fiscal IS NULL' : '';

      db.run(sqlRecuperacao + whereClause, (updateErr) => {
        if (updateErr) {
          console.error('Erro ao recuperar item_fiscal em compras_itens:', updateErr.message);
          return;
        }

        if (cfg && cfg.valor === '1') {
          console.log('Recuperação item_fiscal compras_itens (pendentes) concluída');
          return;
        }

        db.run(`
          INSERT INTO configuracoes (chave, valor, tipo, descricao)
          VALUES ('migracao_item_fiscal_compras_itens', '1', 'migracao', 'Recuperação item_fiscal compras_itens')
          ON CONFLICT(chave) DO UPDATE SET valor = '1', updated_at = CURRENT_TIMESTAMP
        `, (flagErr) => {
          if (flagErr) {
            console.error('Erro ao marcar migração item_fiscal compras_itens:', flagErr.message);
            return;
          }
          console.log('Recuperação item_fiscal compras_itens concluída');
        });
      });
    });
  });
}

function recuperarQuantidadesFiscaisComprasItens() {
  db.all(`PRAGMA table_info(compras_itens)`, [], (err, rows) => {
    if (err) {
      console.error('Erro ao verificar colunas de quantidade fiscal em compras_itens:', err.message);
      return;
    }
    const colunas = (rows || []).map((col) => col.name);
    if (!colunas.includes('quantidade_fiscal') || !colunas.includes('quantidade_nao_fiscal')) {
      return;
    }

    db.run(`
      UPDATE compras_itens
      SET
        quantidade_fiscal = CASE
          WHEN quantidade_fiscal IS NOT NULL THEN quantidade_fiscal
          WHEN COALESCE(item_fiscal, 1) = 0 THEN 0
          ELSE quantidade
        END,
        quantidade_nao_fiscal = CASE
          WHEN quantidade_nao_fiscal IS NOT NULL THEN quantidade_nao_fiscal
          WHEN COALESCE(item_fiscal, 1) = 0 THEN quantidade
          ELSE 0
        END
      WHERE quantidade_fiscal IS NULL OR quantidade_nao_fiscal IS NULL
    `, (updateErr) => {
      if (updateErr) {
        console.error('Erro ao recuperar quantidades fiscais em compras_itens:', updateErr.message);
        return;
      }
      console.log('Recuperação quantidade_fiscal/nao_fiscal compras_itens concluída');
      corrigirQuantidadesFiscaisComprasItensLegacy();
    });
  });
}

function corrigirQuantidadesFiscaisComprasItensLegacy() {
  db.run(`
    UPDATE compras_itens
    SET
      quantidade_fiscal = CASE
        WHEN COALESCE(item_fiscal, 1) = 0 THEN 0
        ELSE quantidade
      END,
      quantidade_nao_fiscal = CASE
        WHEN COALESCE(item_fiscal, 1) = 0 THEN quantidade
        ELSE 0
      END
    WHERE quantidade > 0
      AND COALESCE(quantidade_fiscal, 0) = 0
      AND COALESCE(quantidade_nao_fiscal, 0) = 0
  `, (updateErr) => {
    if (updateErr) {
      console.error('Erro ao corrigir quantidades fiscais legadas em compras_itens:', updateErr.message);
      return;
    }
    console.log('Correção quantidades fiscais legadas compras_itens concluída');
    migrarRecalcularSaldosEstoque();
  });
}

function migrarRecalcularSaldosEstoque() {
  db.get(`SELECT valor FROM configuracoes WHERE chave = ?`, ['migracao_recalc_saldos_estoque_v1'], (cfgErr, cfg) => {
    if (cfgErr) {
      console.error('Erro ao verificar migração recalc saldos:', cfgErr.message);
      return;
    }
    if (cfg && cfg.valor === '1') {
      return;
    }

    const { recalcularSaldosTodosProdutos } = require('./services/estoqueFiscalService');
    recalcularSaldosTodosProdutos(db, (recErr, result) => {
      if (recErr) {
        console.error('Erro ao recalcular saldos de estoque:', recErr.message);
        return;
      }

      db.run(`
        INSERT INTO configuracoes (chave, valor, tipo, descricao)
        VALUES ('migracao_recalc_saldos_estoque_v1', '1', 'migracao', 'Recálculo saldos fiscal/não fiscal')
        ON CONFLICT(chave) DO UPDATE SET valor = '1', updated_at = CURRENT_TIMESTAMP
      `, (flagErr) => {
        if (flagErr) {
          console.error('Erro ao marcar migração recalc saldos:', flagErr.message);
          return;
        }
        console.log(`Recálculo saldos estoque concluído (${result?.atualizados || 0} produtos)`);
      });
    });
  });
}

function inicializarBanco() {
  const { migrarDadosCaixaSessoes } = require('./utils/caixaSessaoHelpers');

  db.serialize(() => {
    criarTabelas();
    aplicarAlteracoesPosCriacao();
    migrarDadosCaixaSessoes(db);
    inserirConfiguracoesPadrao();
    seedPinpadCatalogoTEF();
    criarUsuarioAdminPadrao();
    garantirCategoriasPadraoDespesa();
    garantirColunasCaixa();
    garantirColunasFinanceiro();
    recuperarItemFiscalComprasItens();
    recuperarQuantidadesFiscaisComprasItens();
  });
}

function criarUsuarioAdminPadrao() {
  seedUsuarioAdmin();
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
      !colunas.includes('observacao') && `ALTER TABLE compras ADD COLUMN observacao TEXT`,
      !colunas.includes('numero_nf') && `ALTER TABLE compras ADD COLUMN numero_nf TEXT`,
      !colunas.includes('serie_nf') && `ALTER TABLE compras ADD COLUMN serie_nf TEXT`,
      !colunas.includes('modelo_nf') && `ALTER TABLE compras ADD COLUMN modelo_nf TEXT`,
      !colunas.includes('chave_acesso') && `ALTER TABLE compras ADD COLUMN chave_acesso TEXT`,
      !colunas.includes('data_emissao') && `ALTER TABLE compras ADD COLUMN data_emissao DATE`,
      !colunas.includes('data_entrada') && `ALTER TABLE compras ADD COLUMN data_entrada DATE`,
      !colunas.includes('valor_produtos') && `ALTER TABLE compras ADD COLUMN valor_produtos DECIMAL(10,2) DEFAULT 0`,
      !colunas.includes('valor_desconto') && `ALTER TABLE compras ADD COLUMN valor_desconto DECIMAL(10,2) DEFAULT 0`,
      !colunas.includes('valor_frete') && `ALTER TABLE compras ADD COLUMN valor_frete DECIMAL(10,2) DEFAULT 0`,
      !colunas.includes('valor_outras_despesas') && `ALTER TABLE compras ADD COLUMN valor_outras_despesas DECIMAL(10,2) DEFAULT 0`,
      !colunas.includes('valor_total_nota') && `ALTER TABLE compras ADD COLUMN valor_total_nota DECIMAL(10,2) DEFAULT 0`
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

function garantirColunasCaixa() {
  const colunasCaixa = [
    ['total_sangrias', `ALTER TABLE caixa ADD COLUMN total_sangrias DECIMAL(10,2) DEFAULT 0`],
    ['total_suprimentos', `ALTER TABLE caixa ADD COLUMN total_suprimentos DECIMAL(10,2) DEFAULT 0`],
    ['saldo_esperado', `ALTER TABLE caixa ADD COLUMN saldo_esperado DECIMAL(10,2) DEFAULT 0`],
    ['valor_fechamento', `ALTER TABLE caixa ADD COLUMN valor_fechamento DECIMAL(10,2) DEFAULT 0`],
    ['diferenca', `ALTER TABLE caixa ADD COLUMN diferenca DECIMAL(10,2) DEFAULT 0`],
    ['observacao', `ALTER TABLE caixa ADD COLUMN observacao TEXT`],
    ['aberto_em', `ALTER TABLE caixa ADD COLUMN aberto_em DATETIME`],
    ['fechado_em', `ALTER TABLE caixa ADD COLUMN fechado_em DATETIME`],
    ['fechado_por', `ALTER TABLE caixa ADD COLUMN fechado_por INTEGER REFERENCES usuarios(id)`],
    ['ja_reimpresso', `ALTER TABLE caixa ADD COLUMN ja_reimpresso INTEGER DEFAULT 0`],
    ['reoperturas_count', `ALTER TABLE caixa ADD COLUMN reoperturas_count INTEGER DEFAULT 0`],
    ['status', `ALTER TABLE caixa ADD COLUMN status TEXT DEFAULT 'aberto'`],
    ['terminal_id', `ALTER TABLE caixa ADD COLUMN terminal_id INTEGER REFERENCES terminais(id)`]
  ];

  const colunasFechamentos = [
    ['sessao_id', `ALTER TABLE caixa_fechamentos ADD COLUMN sessao_id INTEGER REFERENCES caixa_sessoes(id)`],
    ['total_sangrias', `ALTER TABLE caixa_fechamentos ADD COLUMN total_sangrias DECIMAL(10,2) DEFAULT 0`],
    ['total_suprimentos', `ALTER TABLE caixa_fechamentos ADD COLUMN total_suprimentos DECIMAL(10,2) DEFAULT 0`]
  ];

  function aplicarFaltantes(tabela, definicoes) {
    db.all(`PRAGMA table_info(${tabela})`, [], (err, rows) => {
      if (err) {
        console.error(`Erro ao verificar colunas da tabela ${tabela}:`, err.message);
        return;
      }
      const existentes = (rows || []).map((r) => r.name);
      definicoes
        .filter(([nome]) => !existentes.includes(nome))
        .forEach(([, sql]) => {
          db.run(sql, (alterErr) => {
            if (alterErr) {
              console.error(`Erro ao executar alteração em ${tabela}: ${sql}`, alterErr.message);
            } else {
              console.log(`Alteração aplicada em ${tabela}: ${sql}`);
            }
          });
        });
    });
  }

  aplicarFaltantes('caixa', colunasCaixa);
  aplicarFaltantes('caixa_fechamentos', colunasFechamentos);
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
      !colunas.includes('pessoa_id') && `ALTER TABLE financeiro ADD COLUMN pessoa_id INTEGER`,
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

function garantirCategoriasPadraoDespesa() {
  const categoriasPadrao = [
    'Aluguel',
    'Água',
    'Luz',
    'Internet',
    'Impostos e Taxas',
    'Material de Uso Interno',
    'Outras Despesas'
  ];

  categoriasPadrao.forEach((nome) => {
    db.get('SELECT id FROM categorias WHERE LOWER(nome) = LOWER(?)', [nome], (err, row) => {
      if (err) {
        console.error('Erro ao verificar categoria padrão de despesa:', err.message);
        return;
      }

      if (!row) {
        db.run(
          'INSERT INTO categorias (nome, descricao, tipo) VALUES (?, ?, ?)',
          [nome, `Categoria padrão de despesa: ${nome}`, 'despesa'],
          (insertErr) => {
            if (insertErr) {
              console.error(`Erro ao inserir categoria padrão "${nome}":`, insertErr.message);
            }
          }
        );
      } else {
        db.run(
          'UPDATE categorias SET tipo = ? WHERE id = ? AND (tipo IS NULL OR tipo = "")',
          ['despesa', row.id],
          (updateErr) => {
            if (updateErr) {
              console.error(`Erro ao ajustar tipo da categoria "${nome}":`, updateErr.message);
            }
          }
        );
      }
    });
  });
}

// Função separada para inserir configurações padrão
function inserirConfiguracoesPadrao() {
  const configs = [
    ['nome_empresa', 'Mercadão da Economia', 'string', 'Nome da empresa'],
    ['nome_fantasia', '', 'string', 'Nome fantasia'],
    ['razao_social', '', 'string', 'Razão social'],
    ['cnpj', '', 'string', 'CNPJ da empresa'],
    ['ie', '', 'string', 'Inscrição estadual'],
    ['im', '', 'string', 'Inscrição municipal'],
    ['telefone', '', 'string', 'Telefone para contato'],
    ['whatsapp', '', 'string', 'WhatsApp'],
    ['email', '', 'string', 'Email para contato'],
    ['cep', '', 'string', 'CEP'],
    ['logradouro', '', 'string', 'Logradouro'],
    ['numero', '', 'string', 'Número'],
    ['complemento', '', 'string', 'Complemento'],
    ['bairro', '', 'string', 'Bairro'],
    ['cidade', '', 'string', 'Cidade'],
    ['uf', 'CE', 'string', 'UF'],
    ['endereco', '', 'text', 'Endereço da empresa'],
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
    ['fiscal_csc_qrcode_url_homologacao', 'https://nfceh.sefaz.ce.gov.br/pages/ShowNFCe.html', 'string', 'Base QR Code homologação CE'],
    ['fiscal_consulta_chave_url_homologacao', 'https://nfceh.sefaz.ce.gov.br/pages/ShowNFCe.html', 'string', 'Consulta chave homologação CE'],
    ['fiscal_tp_imp', '4', 'number', 'Tipo impressão DANFE NFC-e'],
    ['fiscal_municipio_codigo', '2307304', 'string', 'Código município emitente'],
    ['fiscal_municipio_nome', 'Juazeiro do Norte', 'string', 'Nome município emitente'],
    ['fiscal_emitente_cep', '', 'string', 'CEP emitente'],
    ['fiscal_emitente_logradouro', '', 'string', 'Logradouro emitente'],
    ['fiscal_emitente_numero', 'S/N', 'string', 'Número emitente'],
    ['fiscal_emitente_bairro', '', 'string', 'Bairro emitente'],
    ['logo', '', 'text', 'URL da logo'],
    ['imprimir_cupom', 'true', 'boolean', 'Imprimir cupom fiscal'],
    ['juros_mora', '1.0', 'decimal', 'Juros de mora por dia (%)'],
    ['backup_google_enabled', 'false', 'boolean', 'Backup automático para Google Drive habilitado'],
    ['backup_google_frequency', '0 2 * * *', 'string', 'Frequência de backup para Google Drive'],
    ['backup_google_client_id', '', 'string', 'Google Client ID para backup'],
    ['backup_google_client_secret', '', 'string', 'Google Client Secret para backup'],
    ['backup_google_redirect_uris', '[]', 'text', 'Google Redirect URIs para OAuth'],
    ['backup_google_refresh_token', '', 'text', 'Google Refresh Token para backup']
    ,['tef_ativo', 'true', 'boolean', 'TEF habilitado']
    ,['modo_dashboard_fiscal', '1', 'boolean', 'Modo fiscal ativo por padrão (F12) — ERP e PDV']
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

  db.get(
    `SELECT valor FROM configuracoes WHERE chave = 'migracao_modo_fiscal_padrao_ativo'`,
    [],
    (migErr, migRow) => {
      if (migErr || migRow) return;

      db.run(
        `UPDATE configuracoes SET valor = '1', updated_at = datetime('now', 'localtime') WHERE chave = 'modo_dashboard_fiscal'`,
        [],
        () => {
          db.run(
            `INSERT INTO configuracoes (chave, valor, tipo, descricao) VALUES ('migracao_modo_fiscal_padrao_ativo', '1', 'boolean', 'Migração: F12 ativo por padrão')`
          );
          console.log('Migração: modo_dashboard_fiscal definido como ativo (F12) por padrão');
        }
      );
    }
  );
}

function seedPinpadCatalogoTEF() {
  const modelos = [
    ['GERTEC_PPC930', 'Gertec PPC930', 'Gertec', 'PPC930', 'Rede', 1]
  ];

  modelos.forEach((row) => {
    db.run(`
      INSERT OR IGNORE INTO tef_pinpad_catalogo (codigo, nome, fabricante, modelo, adquirente_sugerido, ativo)
      VALUES (?, ?, ?, ?, ?, ?)
    `, row, (err) => {
      if (err) {
        console.error('Erro ao inserir catálogo PinPad TEF:', err.message);
      }
    });
  });
}

function seedUsuarioAdmin() {
  const hash = bcrypt.hashSync('pdb100623', 10);

  // Inserir ou ignorar se já existe
  db.run(`
    INSERT OR IGNORE INTO usuarios (username, password_hash, role, nome, perfil, pode_alterar_senhas)
    VALUES ('Diego', ?, 'admin', 'Diego', 'SUPER_ADMIN', 1)
  `, [hash], (err) => {
    if (err) console.error('Erro ao criar usuário administrador padrão:', err);
    else console.log('Usuário administrador padrão verificado (Diego)');
  });

  // Atualizar usuário existente para SUPER_ADMIN (caso já exista)
  db.run(`
    UPDATE usuarios
    SET perfil = 'SUPER_ADMIN',
        pode_alterar_senhas = 1,
        nome = 'Diego'
    WHERE username = 'Diego'
  `, (err) => {
    if (err) console.error('Erro ao atualizar perfil do administrador:', err);
    else console.log('Perfil SUPER_ADMIN garantido para Diego');
  });
}


db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS caixas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      descricao TEXT,
      ativo INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS terminais (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      hostname TEXT NOT NULL UNIQUE,
      caixa_id INTEGER,
      ativo INTEGER DEFAULT 1,
      ultima_conexao DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (caixa_id) REFERENCES caixas(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS caixa (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data DATE NOT NULL,
      valor_inicial DECIMAL(10,2) DEFAULT 0,
      total_sangrias DECIMAL(10,2) DEFAULT 0,
      total_suprimentos DECIMAL(10,2) DEFAULT 0,
      saldo_esperado DECIMAL(10,2) DEFAULT 0,
      valor_fechamento DECIMAL(10,2) DEFAULT 0,
      diferenca DECIMAL(10,2) DEFAULT 0,
      status TEXT DEFAULT 'aberto',
      observacao TEXT,
      aberto_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      fechado_em DATETIME,
      aberto_por INTEGER REFERENCES usuarios(id),
      fechado_por INTEGER REFERENCES usuarios(id),
      ja_reimpresso INTEGER DEFAULT 0,
      terminal_id INTEGER REFERENCES terminais(id)
    )
  `);

  // Nova tabela de sessões de caixa (multi-caixa profissional)
  db.run(`
    CREATE TABLE IF NOT EXISTS caixa_sessoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      caixa_id INTEGER,
      caixa_turno_id INTEGER,
      terminal_id INTEGER,
      operador_id INTEGER,
      valor_abertura DECIMAL(10,2) DEFAULT 0,
      valor_fechamento DECIMAL(10,2) DEFAULT 0,
      aberto_em DATETIME,
      fechado_em DATETIME,
      status TEXT DEFAULT 'aberto',
      observacoes TEXT,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (caixa_id) REFERENCES caixas(id),
      FOREIGN KEY (caixa_turno_id) REFERENCES caixa(id),
      FOREIGN KEY (terminal_id) REFERENCES terminais(id),
      FOREIGN KEY (operador_id) REFERENCES usuarios(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS caixa_movimentacoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      caixa_id INTEGER NOT NULL,
      sessao_id INTEGER,
      tipo TEXT NOT NULL,
      valor DECIMAL(10,2) DEFAULT 0,
      motivo TEXT,
      usuario_id INTEGER,
      operador_nome TEXT,
      terminal_id INTEGER,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (caixa_id) REFERENCES caixa(id),
      FOREIGN KEY (sessao_id) REFERENCES caixa_sessoes(id),
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
      FOREIGN KEY (terminal_id) REFERENCES terminais(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS caixa_fechamentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sessao_id INTEGER,
      caixa_id INTEGER NOT NULL,
      operador_id INTEGER,
      terminal_id INTEGER,
      data_fechamento DATETIME NOT NULL,
      valor_inicial DECIMAL(10,2) DEFAULT 0,
      vendas_dinheiro DECIMAL(10,2) DEFAULT 0,
      vendas_pix DECIMAL(10,2) DEFAULT 0,
      vendas_debito DECIMAL(10,2) DEFAULT 0,
      vendas_credito DECIMAL(10,2) DEFAULT 0,
      vendas_prazo DECIMAL(10,2) DEFAULT 0,
      vendas_tef DECIMAL(10,2) DEFAULT 0,
      total_sangrias DECIMAL(10,2) DEFAULT 0,
      total_suprimentos DECIMAL(10,2) DEFAULT 0,
      total_vendido DECIMAL(10,2) DEFAULT 0,
      total_esperado DECIMAL(10,2) DEFAULT 0,
      total_informado DECIMAL(10,2) DEFAULT 0,
      diferenca DECIMAL(10,2) DEFAULT 0,
      observacao TEXT,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (caixa_id) REFERENCES caixa(id),
      FOREIGN KEY (operador_id) REFERENCES usuarios(id),
      FOREIGN KEY (terminal_id) REFERENCES terminais(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS auditoria_caixa (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sessao_id INTEGER,
      caixa_id INTEGER,
      operador_id INTEGER,
      terminal_id INTEGER,
      acao TEXT NOT NULL,
      tipo_movimentacao TEXT,
      valor DECIMAL(10,2),
      detalhes TEXT,
      ip_requisicao TEXT,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (sessao_id) REFERENCES caixa_sessoes(id),
      FOREIGN KEY (caixa_id) REFERENCES caixa(id),
      FOREIGN KEY (operador_id) REFERENCES usuarios(id),
      FOREIGN KEY (terminal_id) REFERENCES terminais(id)
    )
  `);

    db.run(`
      CREATE TABLE IF NOT EXISTS auditoria (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_id INTEGER,
        usuario_nome TEXT,
        modulo TEXT,
        acao TEXT NOT NULL,
        referencia_tipo TEXT,
        referencia_id INTEGER,
        detalhes TEXT,
        ip_requisicao TEXT,
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
      )
    `);
});

module.exports = db;