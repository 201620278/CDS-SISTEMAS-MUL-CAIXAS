const db = require('../database');

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        return reject(err);
      }
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        return reject(err);
      }
      resolve(row || null);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        return reject(err);
      }
      resolve(rows || []);
    });
  });
}

function boolToInt(valor) {
  return valor === true || valor === 'true' || valor === '1' || valor === 1 ? 1 : 0;
}

function intToBool(valor) {
  return valor === 1 || valor === '1' || valor === true;
}

function normalizarServidorPersistencia(dados = {}) {
  return {
    base_url: dados.base_url || '',
    ip: dados.ip || null,
    porta: dados.porta ?? null,
    client_id: dados.client_id || '',
    client_secret: dados.client_secret || '',
    access_token: dados.access_token || null,
    refresh_token: dados.refresh_token || null,
    chave_comunicacao: dados.chave_comunicacao || null,
    operador: dados.operador || null
  };
}

async function contarConfiguracoes() {
  const row = await get('SELECT COUNT(*) AS total FROM tef_configuracao');
  return Number(row?.total || 0);
}

async function buscarConfiguracaoPrincipal() {
  return get(`
    SELECT *
    FROM tef_configuracao
    ORDER BY id ASC
    LIMIT 1
  `);
}

async function buscarServidorPorConfigId(configId) {
  return get(`
    SELECT *
    FROM tef_servidores
    WHERE tef_configuracao_id = ?
    ORDER BY id ASC
    LIMIT 1
  `, [configId]);
}

async function buscarPinpadPorConfigId(configId) {
  return get(`
    SELECT *
    FROM tef_pinpads
    WHERE tef_configuracao_id = ?
    ORDER BY id ASC
    LIMIT 1
  `, [configId]);
}

async function buscarOperacoesPorConfigId(configId) {
  return get(`
    SELECT *
    FROM tef_operacoes
    WHERE tef_configuracao_id = ?
    ORDER BY id ASC
    LIMIT 1
  `, [configId]);
}

async function buscarConfiguracaoCompleta() {
  const principal = await buscarConfiguracaoPrincipal();
  if (!principal) {
    return null;
  }

  const [servidor, pinpad, operacoes] = await Promise.all([
    buscarServidorPorConfigId(principal.id),
    buscarPinpadPorConfigId(principal.id),
    buscarOperacoesPorConfigId(principal.id)
  ]);

  return {
    principal,
    servidor,
    pinpad,
    operacoes
  };
}

async function listarConfiguracaoLegada() {
  const rows = await all(`
    SELECT chave, valor
    FROM tef_configuracoes
    ORDER BY chave
  `);

  const config = {};
  rows.forEach((row) => {
    config[row.chave] = row.valor ?? '';
  });

  return config;
}

async function criarConfiguracaoPrincipal(dados) {
  const resultado = await run(`
    INSERT INTO tef_configuracao (
      habilitado,
      provedor,
      ambiente,
      timeout,
      tentativas,
      empresa_codigo,
      loja_codigo,
      pdv_codigo,
      terminal_codigo,
      caixa_codigo,
      atualizado_em
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `, [
    boolToInt(dados.habilitado),
    dados.provedor || null,
    dados.ambiente || null,
    dados.timeout ?? null,
    dados.tentativas ?? null,
    dados.empresa_codigo || null,
    dados.loja_codigo || null,
    dados.pdv_codigo || null,
    dados.terminal_codigo || null,
    dados.caixa_codigo || null
  ]);

  return resultado.lastID;
}

async function atualizarConfiguracaoPrincipal(id, dados) {
  await run(`
    UPDATE tef_configuracao
    SET
      habilitado = ?,
      provedor = ?,
      ambiente = ?,
      timeout = ?,
      tentativas = ?,
      empresa_codigo = ?,
      loja_codigo = ?,
      pdv_codigo = ?,
      terminal_codigo = ?,
      caixa_codigo = ?,
      atualizado_em = datetime('now')
    WHERE id = ?
  `, [
    boolToInt(dados.habilitado),
    dados.provedor || null,
    dados.ambiente || null,
    dados.timeout ?? null,
    dados.tentativas ?? null,
    dados.empresa_codigo || null,
    dados.loja_codigo || null,
    dados.pdv_codigo || null,
    dados.terminal_codigo || null,
    dados.caixa_codigo || null,
    id
  ]);
}

async function salvarServidor(configId, dados) {
  const servidor = normalizarServidorPersistencia(dados);
  const existente = await buscarServidorPorConfigId(configId);

  if (existente) {
    await run(`
      UPDATE tef_servidores
      SET
        base_url = ?,
        ip = ?,
        porta = ?,
        client_id = ?,
        client_secret = ?,
        access_token = ?,
        refresh_token = ?,
        chave_comunicacao = ?,
        operador = ?
      WHERE id = ?
    `, [
      servidor.base_url,
      servidor.ip,
      servidor.porta,
      servidor.client_id,
      servidor.client_secret,
      servidor.access_token,
      servidor.refresh_token,
      servidor.chave_comunicacao,
      servidor.operador,
      existente.id
    ]);
    return existente.id;
  }

  const resultado = await run(`
    INSERT INTO tef_servidores (
      tef_configuracao_id,
      base_url,
      ip,
      porta,
      client_id,
      client_secret,
      access_token,
      refresh_token,
      chave_comunicacao,
      operador
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    configId,
    servidor.base_url,
    servidor.ip,
    servidor.porta,
    servidor.client_id,
    servidor.client_secret,
    servidor.access_token,
    servidor.refresh_token,
    servidor.chave_comunicacao,
    servidor.operador
  ]);

  return resultado.lastID;
}

async function salvarPinpad(configId, dados) {
  const existente = await buscarPinpadPorConfigId(configId);

  if (existente) {
    await run(`
      UPDATE tef_pinpads
      SET
        habilitado = ?,
        codigo = ?,
        nome = ?,
        fabricante = ?,
        modelo = ?,
        tipo_conexao = ?,
        porta_com = ?,
        ip = ?,
        porta = ?,
        serial = ?,
        ativo = ?,
        status = COALESCE(?, status),
        ultima_conexao = COALESCE(?, ultima_conexao)
      WHERE id = ?
    `, [
      boolToInt(dados.habilitado),
      dados.codigo || null,
      dados.nome || null,
      dados.fabricante || null,
      dados.modelo || null,
      dados.tipo_conexao || null,
      dados.porta_com || null,
      dados.ip || null,
      dados.porta ?? null,
      dados.serial || null,
      dados.ativo != null ? boolToInt(dados.ativo) : 1,
      dados.status || null,
      dados.ultima_conexao || null,
      existente.id
    ]);
    return existente.id;
  }

  const resultado = await run(`
    INSERT INTO tef_pinpads (
      tef_configuracao_id,
      habilitado,
      codigo,
      nome,
      fabricante,
      modelo,
      tipo_conexao,
      porta_com,
      ip,
      porta,
      serial,
      ativo,
      status,
      ultima_conexao
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    configId,
    boolToInt(dados.habilitado),
    dados.codigo || null,
    dados.nome || null,
    dados.fabricante || null,
    dados.modelo || null,
    dados.tipo_conexao || null,
    dados.porta_com || null,
    dados.ip || null,
    dados.porta ?? null,
    dados.serial || null,
    dados.ativo != null ? boolToInt(dados.ativo) : 1,
    dados.status || 'desconhecido',
    dados.ultima_conexao || null
  ]);

  return resultado.lastID;
}

async function salvarOperacoes(configId, dados) {
  const existente = await buscarOperacoesPorConfigId(configId);

  if (existente) {
    await run(`
      UPDATE tef_operacoes
      SET
        debito = ?,
        credito_avista = ?,
        credito_parcelado = ?,
        voucher = ?,
        pix = ?,
        cancelamento = ?,
        reimpressao = ?,
        pre_autorizacao = ?,
        confirmacao_manual = ?
      WHERE id = ?
    `, [
      boolToInt(dados.debito),
      boolToInt(dados.credito_avista),
      boolToInt(dados.credito_parcelado),
      boolToInt(dados.voucher),
      boolToInt(dados.pix),
      boolToInt(dados.cancelamento),
      boolToInt(dados.reimpressao),
      boolToInt(dados.pre_autorizacao),
      boolToInt(dados.confirmacao_manual),
      existente.id
    ]);
    return existente.id;
  }

  const resultado = await run(`
    INSERT INTO tef_operacoes (
      tef_configuracao_id,
      debito,
      credito_avista,
      credito_parcelado,
      voucher,
      pix,
      cancelamento,
      reimpressao,
      pre_autorizacao,
      confirmacao_manual
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    configId,
    boolToInt(dados.debito),
    boolToInt(dados.credito_avista),
    boolToInt(dados.credito_parcelado),
    boolToInt(dados.voucher),
    boolToInt(dados.pix),
    boolToInt(dados.cancelamento),
    boolToInt(dados.reimpressao),
    boolToInt(dados.pre_autorizacao),
    boolToInt(dados.confirmacao_manual)
  ]);

  return resultado.lastID;
}

async function salvarConfiguracaoCompleta(dados, { atualizar = false } = {}) {
  const existente = await buscarConfiguracaoPrincipal();

  if (atualizar && !existente) {
    const erro = new Error('Configuração TEF não encontrada.');
    erro.statusCode = 404;
    throw erro;
  }

  let configId = existente?.id;

  if (!configId) {
    configId = await criarConfiguracaoPrincipal(dados.principal);
  } else {
    await atualizarConfiguracaoPrincipal(configId, dados.principal);
  }

  await Promise.all([
    salvarServidor(configId, dados.servidor),
    salvarPinpad(configId, dados.pinpad),
    salvarOperacoes(configId, dados.operacoes)
  ]);

  return buscarConfiguracaoCompleta();
}

async function atualizarStatusPinpad(configId, status, ultimaConexao = null) {
  const pinpad = await buscarPinpadPorConfigId(configId);
  if (!pinpad) {
    return null;
  }

  await run(`
    UPDATE tef_pinpads
    SET
      status = ?,
      ultima_conexao = COALESCE(?, datetime('now'))
    WHERE id = ?
  `, [status, ultimaConexao, pinpad.id]);

  return buscarPinpadPorConfigId(configId);
}

module.exports = {
  boolToInt,
  intToBool,
  contarConfiguracoes,
  buscarConfiguracaoPrincipal,
  buscarConfiguracaoCompleta,
  listarConfiguracaoLegada,
  salvarConfiguracaoCompleta,
  atualizarStatusPinpad
};
