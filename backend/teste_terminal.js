const db = require('./database');

console.log('=== ESTRUTURA terminais ===');
db.all("PRAGMA table_info(terminais)", (err, cols) => {
  if (err) console.error(err);
  else console.table(cols);

  console.log('\n=== TERMINAIS EXISTENTES ===');
  db.all("SELECT * FROM terminais", (err2, rows) => {
    if (err2) console.error(err2);
    else console.table(rows);

    console.log('\n=== TESTE INSERT/UPDATE (simula heartbeat) ===');
    const hostname = 'TESTE-DIAGNOSTICO';
    const agora = new Date().toISOString();
    db.run(
      `INSERT INTO terminais (nome, hostname, usuario_id, usuario_nome, ativo, ultima_conexao, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
      [hostname, hostname, 1, 'Diego', agora, agora, agora],
      function(insertErr) {
        if (insertErr) {
          console.error('ERRO INSERT:', insertErr.message);
        } else {
          console.log('INSERT OK, id:', this.lastID);
          db.run(`DELETE FROM terminais WHERE id = ?`, [this.lastID]);
        }

        console.log('\n=== TESTE usuario_permissoes (Diego id=1) ===');
        db.all("SELECT permissao FROM usuario_permissoes WHERE usuario_id = 1 AND permitido = 1", (err3, perms) => {
          if (err3) console.error('ERRO PERMISSÕES:', err3.message);
          else console.log('Permissões:', perms);

          process.exit();
        });
      }
    );
  });
});
