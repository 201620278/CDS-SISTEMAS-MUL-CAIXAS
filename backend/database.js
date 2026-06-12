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
    inicializarBanco();
  }
});

db.dbDir = DB_DIR;
db.dbPath = DB_PATH;

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

function aplicarAlteracoesPosCriacao() {
  aplicarAlteracaoSegura('categorias', `ALTER TABLE categorias ADD COLUMN tipo TEXT DEFAULT 'produto'`);
  aplicarAlteracaoSegura('caixa', `ALTER TABLE caixa ADD COLUMN status TEXT DEFAULT 'aberto'`);
  aplicarAlteracaoSegura('vendas', `ALTER TABLE vendas ADD COLUMN caixa_id INTEGER REFERENCES caixa(id)`);

  // Adicionar colunas faltantes na tabela vendas_itens (para suportar promoções e desconto atacado)
  aplicarAlteracaoSegura('vendas_itens', `ALTER TABLE vendas_itens ADD COLUMN desconto_percentual DECIMAL(5,2) DEFAULT 0`);
  aplicarAlteracaoSegura('vendas_itens', `ALTER TABLE vendas_itens ADD COLUMN promocao_id INTEGER`);
  aplicarAlteracaoSegura('vendas_itens', `ALTER TABLE vendas_itens ADD COLUMN desconto_atacado DECIMAL(10,2) DEFAULT 0`);
  aplicarAlteracaoSegura('vendas_itens', `ALTER TABLE vendas_itens ADD COLUMN tipo_preco TEXT DEFAULT 'varejo'`);

  // Adicionar colunas faltantes na tabela configuracoes
  aplicarAlteracaoSegura('configuracoes', `ALTER TABLE configuracoes ADD COLUMN fiscal_emitente_logradouro TEXT DEFAULT ''`);
  aplicarAlteracaoSegura('configuracoes', `ALTER TABLE configuracoes ADD COLUMN fiscal_emitente_numero TEXT DEFAULT 'S/N'`);
  aplicarAlteracaoSegura('configuracoes', `ALTER TABLE configuracoes ADD COLUMN fiscal_emitente_bairro TEXT DEFAULT ''`);

  // Adicionar colunas faltantes na tabela caixa
  aplicarAlteracaoSegura('caixa', `ALTER TABLE caixa ADD COLUMN total_sangrias DECIMAL(10,2) DEFAULT 0`);
  aplicarAlteracaoSegura('caixa', `ALTER TABLE caixa ADD COLUMN saldo_esperado DECIMAL(10,2) DEFAULT 0`);
  aplicarAlteracaoSegura('caixa', `ALTER TABLE caixa ADD COLUMN valor_fechamento DECIMAL(10,2) DEFAULT 0`);
  aplicarAlteracaoSegura('caixa', `ALTER TABLE caixa ADD COLUMN diferenca DECIMAL(10,2) DEFAULT 0`);
  aplicarAlteracaoSegura('caixa', `ALTER TABLE caixa ADD COLUMN observacao TEXT`);
  aplicarAlteracaoSegura('caixa', `ALTER TABLE caixa ADD COLUMN aberto_em DATETIME`);
  aplicarAlteracaoSegura('caixa', `ALTER TABLE caixa ADD COLUMN fechado_em DATETIME`);

  // Adicionar colunas na tabela usuarios
  aplicarAlteracaoSegura('usuarios', `ALTER TABLE usuarios ADD COLUMN ativo INTEGER DEFAULT 1`);
  aplicarAlteracaoSegura('usuarios', `ALTER TABLE usuarios ADD COLUMN nome TEXT`);
  aplicarAlteracaoSegura('usuarios', `ALTER TABLE usuarios ADD COLUMN perfil TEXT DEFAULT 'USUARIO'`);
  aplicarAlteracaoSegura('usuarios', `ALTER TABLE usuarios ADD COLUMN pode_alterar_senhas INTEGER DEFAULT 0`);

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
    `ALTER TABLE produtos ADD COLUMN lucro_percentual DECIMAL(10,2)`
    , `ALTER TABLE produtos ADD COLUMN venda_atacado INTEGER DEFAULT 0`
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
    `ALTER TABLE compras_itens ADD COLUMN atualizar_preco_venda INTEGER DEFAULT 1`
  ];

  const alteracoesVendas = [
    `ALTER TABLE vendas ADD COLUMN valor_recebido DECIMAL(10,2)`,
    `ALTER TABLE vendas ADD COLUMN status TEXT DEFAULT 'concluida'`,
    `ALTER TABLE vendas ADD COLUMN cpf_cnpj_nota TEXT`,
    `ALTER TABLE vendas ADD COLUMN cancelada INTEGER DEFAULT 0`,
    `ALTER TABLE vendas ADD COLUMN data_cancelamento DATETIME`,
    `ALTER TABLE vendas ADD COLUMN desconto_autorizado_por_id INTEGER`,
    `ALTER TABLE vendas ADD COLUMN desconto_autorizado_por TEXT`,
    `ALTER TABLE vendas ADD COLUMN desconto_autorizado_em DATETIME`
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
        comprovante_cliente TEXT,
        comprovante_estabelecimento TEXT,
        payload_retorno TEXT,
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
        atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP
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
      "ALTER TABLE produtos ADD COLUMN peso_total_compra DECIMAL(10,3) DEFAULT 0",
      "ALTER TABLE produtos ADD COLUMN valor_total_compra DECIMAL(10,2) DEFAULT 0",
      "ALTER TABLE produtos ADD COLUMN custo_por_kg DECIMAL(10,2) DEFAULT 0"
    ];

    colunasProdutoPeso.forEach(sql => {
      db.run(sql, (err) => {
        if (err && !String(err.message).includes('duplicate column name')) {
          console.error('Erro ao adicionar coluna de produto por peso:', err.message);
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

function inicializarBanco() {
  db.serialize(() => {
    criarTabelas();
    aplicarAlteracoesPosCriacao();
    inserirConfiguracoesPadrao();
    criarUsuarioAdminPadrao();
    garantirCategoriasPadraoDespesa();
    garantirColunasFinanceiro();
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
    CREATE TABLE IF NOT EXISTS caixa (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data DATE NOT NULL,
      valor_inicial DECIMAL(10,2) DEFAULT 0,
      total_sangrias DECIMAL(10,2) DEFAULT 0,
      saldo_esperado DECIMAL(10,2) DEFAULT 0,
      valor_fechamento DECIMAL(10,2) DEFAULT 0,
      diferenca DECIMAL(10,2) DEFAULT 0,
      status TEXT DEFAULT 'aberto',
      observacao TEXT,
      aberto_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      fechado_em DATETIME
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS caixa_movimentacoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      caixa_id INTEGER NOT NULL,
      tipo TEXT NOT NULL,
      valor DECIMAL(10,2) DEFAULT 0,
      motivo TEXT,
      usuario_id INTEGER,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (caixa_id) REFERENCES caixa(id),
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    )
  `);
});

module.exports = db;