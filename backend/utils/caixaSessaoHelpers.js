function obterCaixaTurnoId(sessao) {
  if (!sessao) return null;
  if (sessao.caixa_turno_id) return sessao.caixa_turno_id;
  return sessao.caixa_id || null;
}

function migrarDadosCaixaSessoes(db, callback) {
  db.run(
    `UPDATE caixa_sessoes
     SET caixa_turno_id = caixa_id
     WHERE caixa_turno_id IS NULL AND caixa_id IS NOT NULL`,
    [],
    (err1) => {
      if (err1) {
        console.error('Erro ao migrar caixa_turno_id em caixa_sessoes:', err1.message);
        return callback ? callback(err1) : null;
      }

      db.run(
        `UPDATE caixa_sessoes
         SET caixa_id = (
           SELECT t.caixa_id FROM terminais t WHERE t.id = caixa_sessoes.terminal_id
         )
         WHERE terminal_id IS NOT NULL
           AND caixa_turno_id IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM terminais t
             WHERE t.id = caixa_sessoes.terminal_id AND t.caixa_id IS NOT NULL
           )`,
        [],
        (err2) => {
          if (err2) {
            console.error('Erro ao vincular caixa_id admin em caixa_sessoes:', err2.message);
          }
          if (callback) callback(err2 || null);
        }
      );
    }
  );
}

module.exports = {
  obterCaixaTurnoId,
  migrarDadosCaixaSessoes
};
