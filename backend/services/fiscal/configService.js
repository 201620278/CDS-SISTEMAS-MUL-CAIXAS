const db = require('../../database');

function getConfiguracoes(chaves) {
  return new Promise((resolve, reject) => {
    const placeholders = chaves.map(() => '?').join(',');

    db.all(
      `SELECT chave, valor FROM configuracoes WHERE chave IN (${placeholders})`,
      chaves,
      (err, rows) => {
        if (err) return reject(err);

        const map = {};
        rows.forEach((row) => {
          map[row.chave] = row.valor;
        });

        resolve(map);
      }
    );
  });
}

async function getFiscalConfig({ validarUrls = true } = {}) {
  const cfg = await getConfiguracoes([
    'nome_empresa',
    'cnpj',
    'telefone',
    'email',
    'endereco',
    'fiscal_ambiente',
    'fiscal_uf',
    'fiscal_codigo_uf',
    'fiscal_serie',
    'fiscal_numero_atual',
    'fiscal_token_csc',
    'fiscal_id_csc',
    'fiscal_certificado_path',
    'fiscal_certificado_senha',
    'fiscal_regime_tributario',
    'fiscal_ie',
    'fiscal_im',
    'fiscal_cnae',

    'fiscal_csc_qrcode_url_homologacao',
    'fiscal_consulta_chave_url_homologacao',
    'fiscal_ws_autorizacao_homologacao',
    'fiscal_ws_retorno_homologacao',
    'fiscal_ws_status_homologacao',

    'fiscal_csc_qrcode_url_producao',
    'fiscal_consulta_chave_url_producao',
    'fiscal_ws_autorizacao_producao',
    'fiscal_ws_retorno_producao',
    'fiscal_ws_status_producao',

    'fiscal_tp_imp',
    'fiscal_municipio_codigo',
    'fiscal_municipio_nome',
    'fiscal_uf_sigla',
    'fiscal_emitente_cep',
    'fiscal_emitente_logradouro',
    'fiscal_emitente_numero',
    'fiscal_emitente_bairro'
  ]);

  console.log('[FISCAL CONFIG] Configurações carregadas:', JSON.stringify(cfg, null, 2));

  if (!cfg.fiscal_ambiente) {
    throw new Error('Ambiente fiscal não configurado. Selecione Produção ou Homologação.');
  }

  const ambienteFiscal = Number(cfg.fiscal_ambiente);

  console.log('[FISCAL CONFIG] Ambiente fiscal:', ambienteFiscal);

  if (![1, 2].includes(ambienteFiscal)) {
    throw new Error('Ambiente fiscal inválido. Escolha 1 Produção ou 2 Homologação.');
  }

  const urlsHomologacao = {
    autorizacao: cfg.fiscal_ws_autorizacao_homologacao || '',
    retorno: cfg.fiscal_ws_retorno_homologacao || '',
    status: cfg.fiscal_ws_status_homologacao || '',
    consultaQr: cfg.fiscal_csc_qrcode_url_homologacao || '',
    consultaChave: cfg.fiscal_consulta_chave_url_homologacao || ''
  };

  const urlsProducao = {
    autorizacao: cfg.fiscal_ws_autorizacao_producao || '',
    retorno: cfg.fiscal_ws_retorno_producao || '',
    status: cfg.fiscal_ws_status_producao || '',
    consultaQr: cfg.fiscal_csc_qrcode_url_producao || '',
    consultaChave: cfg.fiscal_consulta_chave_url_producao || ''
  };

  const urlsSelecionadas = ambienteFiscal === 1 ? urlsProducao : urlsHomologacao;

  if (validarUrls && !urlsSelecionadas.autorizacao) {
    throw new Error(
      ambienteFiscal === 1
        ? 'URL de autorização em PRODUÇÃO não configurada.'
        : 'URL de autorização em HOMOLOGAÇÃO não configurada.'
    );
  }

  return {
    ambiente: ambienteFiscal,
    uf: cfg.fiscal_uf_sigla || cfg.fiscal_uf || 'CE',
    codigoUf: String(cfg.fiscal_codigo_uf || '23'),
    serie: Number(cfg.fiscal_serie || 1),
    numeroAtual: Number(cfg.fiscal_numero_atual || 1),
    tokenCSC: cfg.fiscal_token_csc || '',
    idCSC: cfg.fiscal_id_csc || '',
    certificadoPath: cfg.fiscal_certificado_path || '',
    certificadoSenha: cfg.fiscal_certificado_senha || '',
    crt: String(cfg.fiscal_regime_tributario || '1'),
    ie: cfg.fiscal_ie || '',
    im: cfg.fiscal_im || '',
    cnae: cfg.fiscal_cnae || '',
    nomeEmpresa: cfg.nome_empresa || '',
    cnpj: cfg.cnpj || '',
    telefone: cfg.telefone || '',
    email: cfg.email || '',
    endereco: cfg.endereco || '',
    municipioCodigo: String(cfg.fiscal_municipio_codigo || '2307304'),
    municipioNome: cfg.fiscal_municipio_nome || 'Juazeiro do Norte',
    cep: cfg.fiscal_emitente_cep || '',
    logradouro: cfg.fiscal_emitente_logradouro || '',
    numeroEndereco: cfg.fiscal_emitente_numero || 'S/N',
    bairro: cfg.fiscal_emitente_bairro || '',
    tpImp: Number(cfg.fiscal_tp_imp || 4),

    urls: urlsSelecionadas,
    urlsHomologacao,
    urlsProducao
  };
}

function setConfiguracao(chave, valor, tipo = 'string', descricao = '') {
  return new Promise((resolve, reject) => {
    db.run(`
      INSERT INTO configuracoes (chave, valor, tipo, descricao, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(chave) DO UPDATE SET
        valor = excluded.valor,
        tipo = excluded.tipo,
        descricao = excluded.descricao,
        updated_at = CURRENT_TIMESTAMP
    `, [chave, valor, tipo, descricao], (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

async function incrementaNumeroFiscal() {
  const cfg = await getConfiguracoes([
    'fiscal_numero_atual',
    'fiscal_serie',
    'fiscal_ambiente'
  ]);

  const numeroConfig = Number(cfg.fiscal_numero_atual || 1);
  const serie = Number(cfg.fiscal_serie || 1);
  const ambiente = Number(cfg.fiscal_ambiente || 2);

  return new Promise((resolve, reject) => {
    db.get(`
      SELECT MAX(CAST(numero AS INTEGER)) AS maior
      FROM nfce_notas
      WHERE CAST(serie AS INTEGER) = ?
        AND CAST(ambiente AS INTEGER) = ?
    `, [serie, ambiente], async (err, row) => {
      if (err) return reject(err);

      const maiorBanco = Number(row?.maior || 0);

      const numeroSeguro = Math.max(
        numeroConfig,
        maiorBanco + 1
      );

      try {
        await setConfiguracao(
          'fiscal_numero_atual',
          String(numeroSeguro + 1),
          'number',
          'Próximo número NFC-e'
        );

        console.log(`[FISCAL] Número usado: ${numeroSeguro}`);
        console.log(`[FISCAL] Próximo número salvo: ${numeroSeguro + 1}`);

        resolve(numeroSeguro);
      } catch (e) {
        reject(e);
      }
    });
  });
}

module.exports = {
  getFiscalConfig,
  setConfiguracao,
  incrementaNumeroFiscal
};