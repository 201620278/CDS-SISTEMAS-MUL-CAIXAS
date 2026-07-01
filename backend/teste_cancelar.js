const db = require('./database');
const config = require('./services/configuracaoService');

db.get('SELECT * FROM vendas WHERE id = 138', [], (e, v) => {
  console.log('venda:', v);
  db.get('SELECT * FROM nfce_notas WHERE venda_id = 138 ORDER BY id DESC LIMIT 1', [], (e2, n) => {
    console.log('nfce:', n);
    db.get("SELECT * FROM caixa_sessoes WHERE status = 'aberto' ORDER BY id DESC LIMIT 1", [], (e3, c) => {
      console.log('caixa aberto:', c);
      console.log('multiCaixa:', config.getRecursos().recursos.multiCaixa);
      process.exit();
    });
  });
});
