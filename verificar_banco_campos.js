const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_DIR = process.env.DB_DIR || path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'MercantilFiscal', 'dados');
const DB_PATH = path.join(DB_DIR, 'mercadao.db');

console.log(`\n📊 VERIFICANDO BANCO DE DADOS: ${DB_PATH}\n`);

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('❌ Erro ao conectar:', err.message);
    process.exit(1);
  }
  console.log('✅ Conectado ao banco de dados\n');
  verificarTabelas();
});

function verificarTabelas() {
  console.log('='.repeat(80));
  console.log('1️⃣  VERIFICANDO TABELA: produto_atacado');
  console.log('='.repeat(80));

  db.all(`PRAGMA table_info(produto_atacado)`, [], (err, rows) => {
    if (err) {
      console.error('❌ Erro ao verificar produto_atacado:', err.message);
    } else if (!rows || rows.length === 0) {
      console.error('❌ TABELA NÃO EXISTE: produto_atacado');
    } else {
      console.log('✅ Tabela produto_atacado encontrada');
      console.log('Colunas:');
      rows.forEach(row => {
        console.log(`  - ${row.name} (${row.type}${row.notnull ? ' NOT NULL' : ''}${row.pk ? ' PRIMARY KEY' : ''})`);
      });
      
      // Contar registros
      db.get('SELECT COUNT(*) as total FROM produto_atacado', (err2, row) => {
        console.log(`\nRegistros na tabela: ${row?.total || 0}`);
      });
    }

    console.log('\n' + '='.repeat(80));
    console.log('2️⃣  VERIFICANDO TABELA: usuario_permissoes');
    console.log('='.repeat(80));

    db.all(`PRAGMA table_info(usuario_permissoes)`, [], (err, rows) => {
      if (err) {
        console.error('❌ Erro ao verificar usuario_permissoes:', err.message);
      } else if (!rows || rows.length === 0) {
        console.error('❌ TABELA NÃO EXISTE: usuario_permissoes');
      } else {
        console.log('✅ Tabela usuario_permissoes encontrada');
        console.log('Colunas:');
        rows.forEach(row => {
          console.log(`  - ${row.name} (${row.type}${row.notnull ? ' NOT NULL' : ''}${row.pk ? ' PRIMARY KEY' : ''})`);
        });
        
        // Contar registros
        db.get('SELECT COUNT(*) as total FROM usuario_permissoes', (err2, row) => {
          console.log(`\nRegistros na tabela: ${row?.total || 0}`);
        });
      }

      console.log('\n' + '='.repeat(80));
      console.log('3️⃣  VERIFICANDO COLUNA: venda_atacado em produtos');
      console.log('='.repeat(80));

      db.all(`PRAGMA table_info(produtos)`, [], (err, rows) => {
        if (err) {
          console.error('❌ Erro ao verificar colunas de produtos:', err.message);
        } else {
          const temColuna = rows.some(row => row.name === 'venda_atacado');
          if (temColuna) {
            console.log('✅ Coluna venda_atacado encontrada em produtos');
          } else {
            console.error('❌ Coluna venda_atacado NÃO EXISTE em produtos');
          }
        }

        console.log('\n' + '='.repeat(80));
        console.log('4️⃣  VERIFICANDO USUÁRIOS ADMIN');
        console.log('='.repeat(80));

        db.all(`SELECT id, nome, login, role FROM usuarios WHERE role IN ('admin', 'supervisor')`, [], (err, rows) => {
          if (err) {
            console.error('❌ Erro ao verificar usuários:', err.message);
          } else {
            if (!rows || rows.length === 0) {
              console.warn('⚠️  Nenhum usuário admin/supervisor encontrado');
            } else {
              console.log(`✅ Encontrados ${rows.length} usuário(s) admin/supervisor:`);
              rows.forEach(user => {
                console.log(`  - ID: ${user.id}, Nome: ${user.nome}, Login: ${user.login}, Role: ${user.role}`);
              });
            }
          }

          console.log('\n' + '='.repeat(80));
          console.log('5️⃣  VERIFICANDO PERMISSÕES DISPONÍVEIS NO CÓDIGO');
          console.log('='.repeat(80));

          // Ler o arquivo auth.js para ver as permissões definidas
          const fs = require('fs');
          const authFilePath = path.join(__dirname, 'backend', 'rotas', 'auth.js');
          
          try {
            const authContent = fs.readFileSync(authFilePath, 'utf8');
            const permRegex = /PERMISSOES_DISPONIVEIS\s*=\s*\[([\s\S]*?)\]/;
            const match = authContent.match(permRegex);
            
            if (match) {
              const permissoes = match[1]
                .split(',')
                .map(p => p.trim().replace(/['"]/g, ''))
                .filter(p => p.length > 0);
              
              console.log('Permissões definidas no código:');
              permissoes.forEach(perm => {
                console.log(`  - ${perm}`);
              });
            } else {
              console.warn('⚠️  Não foi possível encontrar PERMISSOES_DISPONIVEIS no auth.js');
            }
          } catch (err) {
            console.error('❌ Erro ao ler auth.js:', err.message);
          }

          console.log('\n' + '='.repeat(80));
          console.log('✅ VERIFICAÇÃO CONCLUÍDA');
          console.log('='.repeat(80) + '\n');
          
          db.close();
          process.exit(0);
        });
      });
    });
  });
}
