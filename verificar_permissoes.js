const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_DIR = process.env.DB_DIR || path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'MercantilFiscal', 'dados');
const DB_PATH = path.join(DB_DIR, 'mercadao.db');

console.log(`\n🔐 VERIFICANDO CONFIGURAÇÃO DE PERMISSÕES: ${DB_PATH}\n`);

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('❌ Erro ao conectar:', err.message);
    process.exit(1);
  }
  
  verificarUsuariosEPermissoes();
});

function verificarUsuariosEPermissoes() {
  console.log('='.repeat(80));
  console.log('1️⃣  LISTANDO TODOS OS USUÁRIOS');
  console.log('='.repeat(80));

  // Tentar diferentes nomes de coluna para login
  db.all(`SELECT id, nome, role, ativo FROM usuarios LIMIT 10`, [], (err, rows) => {
    if (err) {
      console.error('❌ Erro ao buscar usuários:', err.message);
    } else if (!rows || rows.length === 0) {
      console.warn('⚠️  Nenhum usuário encontrado');
    } else {
      console.log(`✅ ${rows.length} usuário(s) encontrado(s):\n`);
      rows.forEach((user, idx) => {
        console.log(`${idx + 1}. ID: ${user.id} | Nome: ${user.nome} | Role: ${user.role} | Ativo: ${user.ativo}`);
      });
    }

    console.log('\n' + '='.repeat(80));
    console.log('2️⃣  LISTANDO PERMISSÕES DO SISTEMA');
    console.log('='.repeat(80));

    db.all(`SELECT DISTINCT permissao FROM usuario_permissoes ORDER BY permissao`, [], (err, rows) => {
      if (err) {
        console.error('❌ Erro ao buscar permissões:', err.message);
      } else {
        if (!rows || rows.length === 0) {
          console.warn('⚠️  Nenhuma permissão encontrada na tabela usuario_permissoes');
        } else {
          console.log(`✅ Permissões no banco (${rows.length}):\n`);
          rows.forEach(row => {
            console.log(`  - ${row.permissao}`);
          });
        }
      }

      console.log('\n' + '='.repeat(80));
      console.log('3️⃣  VERIFICANDO PERMISSÕES DO USUÁRIO');
      console.log('='.repeat(80));

      db.all(`
        SELECT 
          u.id,
          u.nome,
          u.role,
          up.permissao,
          up.permitido
        FROM usuarios u
        LEFT JOIN usuario_permissoes up ON u.id = up.usuario_id
        ORDER BY u.id, up.permissao
      `, [], (err, rows) => {
        if (err) {
          console.error('❌ Erro ao buscar permissões de usuários:', err.message);
        } else {
          if (!rows || rows.length === 0) {
            console.warn('⚠️  Nenhuma associação de usuário/permissão encontrada');
          } else {
            const usuariosAgrupados = {};
            
            rows.forEach(row => {
              if (!usuariosAgrupados[row.id]) {
                usuariosAgrupados[row.id] = {
                  id: row.id,
                  nome: row.nome,
                  role: row.role,
                  permissoes: []
                };
              }
              if (row.permissao) {
                usuariosAgrupados[row.id].permissoes.push({
                  nome: row.permissao,
                  permitido: row.permitido
                });
              }
            });

            console.log(`\nUsuários e suas permissões:\n`);
            Object.values(usuariosAgrupados).forEach(usuario => {
              console.log(`👤 ${usuario.nome} (ID: ${usuario.id}, Role: ${usuario.role})`);
              
              if (usuario.permissoes.length === 0) {
                console.log(`   └─ Nenhuma permissão específica atribuída`);
              } else {
                usuario.permissoes.forEach((perm, idx) => {
                  const isLast = idx === usuario.permissoes.length - 1;
                  const permitidoSymbol = perm.permitido === 1 ? '✅' : '❌';
                  console.log(`   ${isLast ? '└─' : '├─'} ${permitidoSymbol} ${perm.nome}`);
                });
              }
              console.log('');
            });
          }
        }

        console.log('='.repeat(80));
        console.log('4️⃣  VERIFICANDO FAIXAS DE ATACADO EXISTENTES');
        console.log('='.repeat(80));

        db.all(`
          SELECT 
            pa.id,
            pa.produto_id,
            p.nome as produto_nome,
            pa.quantidade_minima,
            pa.preco_atacado,
            pa.created_at
          FROM produto_atacado pa
          LEFT JOIN produtos p ON pa.produto_id = p.id
          ORDER BY pa.produto_id, pa.quantidade_minima
        `, [], (err, rows) => {
          if (err) {
            console.error('❌ Erro ao buscar faixas de atacado:', err.message);
          } else {
            if (!rows || rows.length === 0) {
              console.warn('⚠️  Nenhuma faixa de atacado cadastrada ainda');
            } else {
              console.log(`✅ ${rows.length} faixa(s) de atacado encontrada(s):\n`);
              rows.forEach((faixa, idx) => {
                console.log(`${idx + 1}. Produto: ${faixa.produto_nome} (ID: ${faixa.produto_id})`);
                console.log(`   Qtd Mínima: ${faixa.quantidade_minima} | Preço: R$ ${parseFloat(faixa.preco_atacado).toFixed(2)}`);
                console.log(`   Criado em: ${faixa.created_at}`);
                console.log('');
              });
            }
          }

          console.log('='.repeat(80));
          console.log('✅ VERIFICAÇÃO CONCLUÍDA');
          console.log('='.repeat(80) + '\n');
          
          db.close();
          process.exit(0);
        });
      });
    });
  });
}
