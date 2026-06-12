/**
 * Script de Teste - Encerramento Automático de Promoções
 * 
 * Este script simula o comportamento do sistema de encerramento automático de promoções
 * e permite testar se as promoções expiradas estão sendo encerradas corretamente.
 */

const sqlite3 = require('sqlite3');
const path = require('path');

// Conectar ao banco de dados
const dbPath = path.join(__dirname, 'backend', 'banco', 'fiscal', 'cds_sistema.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ Erro ao conectar ao banco de dados:', err.message);
    process.exit(1);
  }
  console.log('✅ Conectado ao banco de dados');
});

// Função para exibir promoções
function exibirPromocoes(filtro = '') {
  const query = `
    SELECT 
      p.id,
      p.produto_id,
      pr.nome AS nome_produto,
      p.data_inicio,
      p.data_fim,
      p.status,
      CASE 
        WHEN p.status = 'ativa' AND date(p.data_fim) < date('now') THEN '⚠️  EXPIRADA'
        WHEN p.status = 'ativa' AND date(p.data_fim) = date('now') THEN '🟡 EXPIRA HOJE'
        WHEN p.status = 'ativa' THEN '✅ VIGENTE'
        ELSE '❌ ENCERRADA'
      END AS situacao,
      CAST(julianday(date(p.data_fim)) - julianday(date('now')) AS INTEGER) AS dias_restantes,
      p.criado_em,
      p.encerrado_em,
      p.motivo_encerramento
    FROM promocoes p
    LEFT JOIN produtos pr ON pr.id = p.produto_id
    ORDER BY p.data_fim DESC
  `;

  db.all(query, (err, rows) => {
    if (err) {
      console.error('❌ Erro ao buscar promoções:', err.message);
      return;
    }

    console.log('\n' + '='.repeat(120));
    console.log('📋 PROMOÇÕES NO SISTEMA');
    console.log('='.repeat(120));

    if (!rows || rows.length === 0) {
      console.log('Nenhuma promoção encontrada\n');
      return;
    }

    console.log(
      'ID'.padEnd(5) +
      'Produto'.padEnd(30) +
      'Data Início'.padEnd(15) +
      'Data Fim'.padEnd(15) +
      'Dias Restantes'.padEnd(15) +
      'Status'.padEnd(20) +
      'Situação'.padEnd(20)
    );
    console.log('-'.repeat(120));

    rows.forEach(row => {
      console.log(
        String(row.id).padEnd(5) +
        (row.nome_produto || 'N/A').substring(0, 28).padEnd(30) +
        row.data_inicio.padEnd(15) +
        row.data_fim.padEnd(15) +
        String(row.dias_restantes).padEnd(15) +
        row.status.padEnd(20) +
        row.situacao.padEnd(20)
      );
    });

    console.log('='.repeat(120) + '\n');

    // Resumo
    const vigentes = rows.filter(r => r.status === 'ativa' && r.dias_restantes >= 0).length;
    const expiradas = rows.filter(r => r.status === 'ativa' && r.dias_restantes < 0).length;
    const encerradas = rows.filter(r => r.status === 'encerrada').length;

    console.log('📊 RESUMO:');
    console.log(`  ✅ Promoções Vigentes: ${vigentes}`);
    console.log(`  ⚠️  Promoções Expiradas (não encerradas): ${expiradas}`);
    console.log(`  ❌ Promoções Encerradas: ${encerradas}`);
    console.log(`  📌 Total: ${rows.length}\n`);
  });
}

// Função para encerrar promoções expiradas
function encerrarExpiradas() {
  const hoje = new Date().toISOString().split('T')[0];

  console.log('🔄 Encerrando promoções expiradas...\n');

  db.run(`
    UPDATE promocoes
    SET status = 'encerrada', 
        encerrado_em = CURRENT_TIMESTAMP,
        motivo_encerramento = 'Encerrada automaticamente - data de vigência expirada (via script de teste)'
    WHERE status = 'ativa' AND date(data_fim) < date(?)
  `, [hoje], function(err) {
    if (err) {
      console.error('❌ Erro ao encerrar promoções:', err.message);
      return;
    }

    if (this.changes > 0) {
      console.log(`✅ ${this.changes} promoção(ões) expirada(s) encerrada(s) com sucesso!\n`);
    } else {
      console.log('ℹ️  Nenhuma promoção expirada encontrada para encerrar\n');
    }

    // Exibir promoções após encerramento
    exibirPromocoes();
  });
}

// Função para criar promoção de teste (expirada)
function criarPromocaoTesteTeste(diasAtras = 5) {
  const dataInicio = new Date();
  dataInicio.setDate(dataInicio.getDate() - 30);
  const dataInicioStr = dataInicio.toISOString().split('T')[0];

  const dataFim = new Date();
  dataFim.setDate(dataFim.getDate() - diasAtras);
  const dataFimStr = dataFim.toISOString().split('T')[0];

  console.log(`\n🆕 Criando promoção de teste (expirada há ${diasAtras} dias)...\n`);

  // Buscar um produto para usar na promoção
  db.get('SELECT id, preco FROM produtos LIMIT 1', (err, produto) => {
    if (err || !produto) {
      console.error('❌ Erro ao buscar produto:', err?.message || 'Nenhum produto encontrado');
      return;
    }

    const precoOriginal = produto.preco;
    const precoPromocional = (precoOriginal * 0.85).toFixed(2);
    const desconto = ((precoOriginal - precoPromocional) / precoOriginal * 100).toFixed(2);

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
    `, [produto.id, precoOriginal, precoPromocional, desconto, dataInicioStr, dataFimStr], function(err) {
      if (err) {
        console.error('❌ Erro ao criar promoção:', err.message);
        return;
      }

      console.log(`✅ Promoção de teste criada com sucesso! (ID: ${this.lastID})`);
      console.log(`   Produto ID: ${produto.id}`);
      console.log(`   Data Início: ${dataInicioStr}`);
      console.log(`   Data Fim: ${dataFimStr} (expirada)`);
      console.log(`   Preço Original: R$ ${precoOriginal}`);
      console.log(`   Preço Promocional: R$ ${precoPromocional}`);
      console.log(`   Desconto: ${desconto}%\n`);

      // Exibir promoções
      exibirPromocoes();
    });
  });
}

// Menu de opções
function mostrarMenu() {
  console.log('\n' + '='.repeat(60));
  console.log('🧪 TESTE DE ENCERRAMENTO AUTOMÁTICO DE PROMOÇÕES');
  console.log('='.repeat(60));
  console.log('\nOpções:');
  console.log('  1 - Listar promoções');
  console.log('  2 - Encerrar promoções expiradas');
  console.log('  3 - Criar promoção de teste (expirada)');
  console.log('  4 - Sair\n');
}

// Processar argumentos da linha de comando
const argumento = process.argv[2];

if (argumento === '1' || argumento === 'listar') {
  exibirPromocoes();
} else if (argumento === '2' || argumento === 'encerrar') {
  encerrarExpiradas();
} else if (argumento === '3' || argumento === 'criar') {
  const dias = parseInt(process.argv[3]) || 5;
  criarPromocaoTesteTeste(dias);
} else if (argumento === '-h' || argumento === '--help') {
  console.log('\n📖 AJUDA - Script de Teste de Encerramento Automático de Promoções\n');
  console.log('Uso: node testar_encerramento_automatico.js [opção] [argumentos]\n');
  console.log('Opções:');
  console.log('  listar                  - Lista todas as promoções');
  console.log('  encerrar                - Encerra promoções expiradas');
  console.log('  criar [dias]            - Cria promoção de teste expirada há N dias');
  console.log('  -h, --help              - Mostra esta ajuda\n');
  console.log('Exemplos:');
  console.log('  node testar_encerramento_automatico.js listar');
  console.log('  node testar_encerramento_automatico.js encerrar');
  console.log('  node testar_encerramento_automatico.js criar 10\n');
} else {
  exibirPromocoes();
}

// Fechar conexão ao terminar
process.on('exit', () => {
  db.close();
});
