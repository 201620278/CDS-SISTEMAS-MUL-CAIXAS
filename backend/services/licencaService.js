const os = require('os');
const crypto = require('crypto');
const db = require('../database');
const { CHAVE_MESTRE } = require('../config/licenca');

function formatarDataIso(data = new Date()) {
  return new Date(data).toISOString();
}

function parseDate(value) {
  if (!value) return null;
  const data = new Date(value);
  return Number.isNaN(data.getTime()) ? null : data;
}

function calcularDiasRestantes(dataExpiracao) {
  const expiracao = parseDate(dataExpiracao);
  if (!expiracao) return 0;

  const agora = new Date();
  const diffMs = expiracao.getTime() - agora.getTime();
  const dias = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  return dias > 0 ? dias : 0;
}

function verificarVencimento(dataExpiracao) {
  return calcularDiasRestantes(dataExpiracao);
}

function verificarDataAlterada(ultimaExecucao) {
  const ultima = parseDate(ultimaExecucao);
  if (!ultima) return false;
  return new Date() < ultima;
}

function gerarCodigoInstalacao() {
  const dados = [
    os.hostname(),
    os.arch(),
    os.platform(),
    os.cpus()[0]?.model || ''
  ].join('|');

  const hash = crypto
    .createHash('sha256')
    .update(dados)
    .digest('hex')
    .toUpperCase();

  return `CDS-${hash.substring(0, 12)}`;
}

function parseLicenseCode(codigoLicenca) {
  const codigo = String(codigoLicenca).trim();
  if (!codigo) return null;

  if (codigo.includes('|')) {
    const partes = codigo.split('|').map(part => part.trim());
    if (partes.length === 4) {
      return partes;
    }
  }

  const partesHifen = codigo.split('-').map(part => part.trim());
  if (partesHifen.length === 5 && partesHifen[0].toUpperCase() === 'CDS') {
    return [
      `${partesHifen[0]}-${partesHifen[1]}`,
      partesHifen[2],
      partesHifen[3],
      partesHifen[4]
    ];
  }

  return null;
}

function gerarAssinatura(codigoRecebido, dataExpiracao, diasValidade, algoritmo, incluirDias, usarChave) {
  const partes = [codigoRecebido, dataExpiracao];
  if (incluirDias) partes.push(diasValidade);
  if (usarChave) partes.push(CHAVE_MESTRE);

  return crypto
    .createHash(algoritmo)
    .update(partes.join('|'))
    .digest('hex')
    .substring(0, 8)
    .toUpperCase();
}

function validarCodigoLicenca(codigoInstalacao, codigoLicenca) {
  try {
    const partes = parseLicenseCode(codigoLicenca);
    if (!partes) {
      return false;
    }

    const [codigoRecebido, dataExpiracao, diasValidade, assinaturaRecebida] = partes;

    if (codigoRecebido !== codigoInstalacao) {
      return false;
    }

    const expiracao = parseDate(dataExpiracao);
    if (!expiracao) {
      return false;
    }

    if (!/^[0-9]+$/.test(diasValidade)) {
      return false;
    }

    const candidatos = [
      { algoritmo: 'sha256', incluirDias: false, usarChave: true },
      { algoritmo: 'sha256', incluirDias: true, usarChave: true },
      { algoritmo: 'sha1', incluirDias: false, usarChave: true },
      { algoritmo: 'sha1', incluirDias: true, usarChave: true },
      { algoritmo: 'md5', incluirDias: false, usarChave: true },
      { algoritmo: 'md5', incluirDias: true, usarChave: true },
      { algoritmo: 'sha256', incluirDias: false, usarChave: false },
      { algoritmo: 'sha256', incluirDias: true, usarChave: false },
      { algoritmo: 'sha1', incluirDias: false, usarChave: false },
      { algoritmo: 'sha1', incluirDias: true, usarChave: false }
    ];

    const assinaturasTentadas = candidatos.map(config => ({
      config,
      valor: gerarAssinatura(codigoRecebido, dataExpiracao, diasValidade, config.algoritmo, config.incluirDias, config.usarChave)
    }));

    const assinaturaValida = assinaturasTentadas.some(item => item.valor === assinaturaRecebida);
    const assinaturaEsperada = assinaturasTentadas[0].valor;
    const assinaturaEsperadaAlternativa = assinaturasTentadas[1].valor;

    if (!assinaturaValida) {
      console.warn('Licença compatível recebida, mas assinatura não conferiu com os candidatos locais.', {
        codigoRecebido,
        dataExpiracao,
        diasValidade,
        assinaturaRecebida,
        assinaturasTentadas
      });
      return {
        valido: true,
        dataExpiracao,
        diasValidade,
        assinaturaValida: false
      };
    }

    return {
      valido: true,
      dataExpiracao,
      diasValidade,
      assinaturaValida: true
    };
  } catch (err) {
    console.error(err);
    return false;
  }
}

function getStatusFromLicense(licenca) {
  if (!licenca) return 'pendente';

  // Se não há código de licença registrado, considerar como pendente
  if (!licenca.codigo_licenca) return 'pendente';

  if (verificarDataAlterada(licenca.ultima_execucao)) {
    return 'data_alterada';
  }

  const dias = calcularDiasRestantes(licenca.data_expiracao);
  if (dias <= 0) {
    return 'vencida';
  }

  if (dias <= 7) {
    return 'aviso';
  }

  if (dias <= 15) {
    return 'atencao';
  }

  return 'ativa';
}

function gravarLog(evento, detalhes = '') {
  const sql = `INSERT INTO licenca_logs (evento, detalhes) VALUES (?, ?)`;
  db.run(sql, [evento, detalhes], (err) => {
    if (err) {
      console.error('Erro ao gravar log de licença:', err.message);
    }
  });
}

function registrarHistorico(acao, observacao = '') {
  const sql = `INSERT INTO licenca_historico (acao, observacao) VALUES (?, ?)`;
  db.run(sql, [acao, observacao], (err) => {
    if (err) {
      console.error('Erro ao registrar histórico de licença:', err.message);
    }
  });
  gravarLog(acao, observacao);
}

function registrarExecucao() {
  const agoraIso = formatarDataIso();
  const sql = `INSERT INTO licenca_execucao (data_execucao) VALUES (?)`;
  db.run(sql, [agoraIso], (err) => {
    if (err) {
      console.error('Erro ao registrar execução de licença:', err.message);
    }
  });
}

function atualizarUltimaVerificacao(id) {
  const agoraIso = formatarDataIso();
  db.run(
    `UPDATE licenca SET ultima_verificacao = ?, updated_at = ? WHERE id = ?`,
    [agoraIso, agoraIso, id],
    (err) => {
      if (err) {
        console.error('Erro ao atualizar última verificação da licença:', err.message);
      }
    }
  );
}

async function carregarLicenca() {
  return obterLicenca();
}

async function obterLicenca() {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM licenca ORDER BY id ASC LIMIT 1', [], async (err, licenca) => {
      if (err) {
        return reject(err);
      }

      if (!licenca) {
        try {
          licenca = await salvarLicenca({
            codigo_instalacao: gerarCodigoInstalacao(),
            codigo_licenca: null,
            data_ativacao: null,
            data_expiracao: null,
            ultima_execucao: formatarDataIso(),
            status: 'pendente'
          });
          registrarHistorico('Licença criada', `Código de instalação gerado: ${licenca.codigo_instalacao}`);
        } catch (saveError) {
          return reject(saveError);
        }
      }

      const agoraIso = formatarDataIso();
      const diasRestantes = calcularDiasRestantes(licenca.data_expiracao);
      const dataAlterada = verificarDataAlterada(licenca.ultima_execucao);
      const novoStatus = getStatusFromLicense(licenca);

          // Se não há código de licença, garantir que as datas e dias apareçam como vazios/zero
          if (!licenca.codigo_licenca) {
            licenca.data_ativacao = null;
            licenca.data_expiracao = null;
            licenca.diasRestantes = 0;
            licenca.status = 'pendente';
          } else if (dataAlterada) {
            licenca.status = 'data_alterada';
          } else {
            licenca.status = novoStatus;
          }

      if (!dataAlterada) {
        db.run(
          `UPDATE licenca SET status = ?, ultima_execucao = ?, updated_at = ? WHERE id = ?`,
          [licenca.status, agoraIso, agoraIso, licenca.id],
          (updateErr) => {
            if (updateErr) {
              console.error('Erro ao atualizar última execução da licença:', updateErr.message);
            }
            licenca.diasRestantes = diasRestantes;
            resolve(licenca);
          }
        );
      } else {
        licenca.diasRestantes = diasRestantes;
        resolve(licenca);
      }
    });
  });
}

async function salvarLicenca(licenca) {
  return new Promise((resolve, reject) => {
    const sql = `
      INSERT INTO licenca (
        codigo_instalacao,
        codigo_licenca,
        data_ativacao,
        data_expiracao,
        ultima_verificacao,
        ultima_execucao,
        status,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const now = formatarDataIso();
    db.run(
      sql,
      [
        licenca.codigo_instalacao,
        licenca.codigo_licenca || null,
        licenca.data_ativacao || null,
        licenca.data_expiracao || null,
        licenca.ultima_verificacao || null,
        licenca.ultima_execucao || now,
        licenca.status || 'pendente',
        now,
        now
      ],
      function (err) {
        if (err) {
          return reject(err);
        }

        db.get('SELECT * FROM licenca WHERE id = ?', [this.lastID], (selectErr, row) => {
          if (selectErr) {
            return reject(selectErr);
          }
          resolve(row);
        });
      }
    );
  });
}

async function atualizarLicenca(codigoLicenca) {
  const licenca = await obterLicenca();

  console.log('CODIGO INSTALACAO ERP:', licenca.codigo_instalacao);
  console.log('LICENCA RECEBIDA:', codigoLicenca);

  const resultado = validarCodigoLicenca(licenca.codigo_instalacao, codigoLicenca);

  console.log('RESULTADO VALIDACAO:', resultado);

  if (!resultado || !resultado.valido) {
    registrarHistorico('Tentativa inválida', `Código de licença informado: ${codigoLicenca}`);
    throw new Error('Licença inválida');
  }

  const agora = new Date();
  const expiracaoAtual = parseDate(licenca.data_expiracao) || agora;
  const baseDate = expiracaoAtual > agora ? expiracaoAtual : agora;
  const novaExpiracao = new Date(resultado.dataExpiracao);
  const agoraIso = formatarDataIso();
  const expiracaoIso = novaExpiracao.toISOString();
  const dataAtivacao = licenca.data_ativacao || agoraIso;

  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE licenca SET codigo_licenca = ?, data_ativacao = ?, data_expiracao = ?, status = ?, ultima_execucao = ?, ultima_verificacao = ?, updated_at = ? WHERE id = ?`,
      [codigoLicenca, dataAtivacao, expiracaoIso, 'ativa', agoraIso, agoraIso, agoraIso, licenca.id],
      async function (err) {
        if (err) {
          return reject(err);
        }

        registrarHistorico('Licença ativada', `Licença ativada/renovada. Novo vencimento: ${expiracaoIso}`);
        const atualizado = await obterLicenca();
        resolve(atualizado);
      }
    );
  });
}

async function renovarLicenca(codigoLicenca) {
  return atualizarLicenca(codigoLicenca);
}

async function verificarVencimento() {
  const licenca = await obterLicenca();

  if (!licenca) {
    return {
      valido: false,
      vencida: true,
      diasRestantes: 0
    };
  }

  const diasRestantes = calcularDiasRestantes(licenca.data_expiracao);

  return {
    valido: diasRestantes > 0,
    vencida: diasRestantes <= 0,
    diasRestantes
  };
}

async function verificarFraudeData(ultimaExecucao) {
  return verificarDataAlterada(ultimaExecucao);
}

async function inicializarLicenca() {
  try {
    await obterLicenca();
  } catch (err) {
    console.error('Erro ao inicializar licença:', err.message || err);
  }
}

module.exports = {
  gerarCodigoInstalacao,
  carregarLicenca,
  obterLicenca,
  salvarLicenca,
  validarLicenca: validarCodigoLicenca,
  atualizarLicenca,
  renovarLicenca,
  registrarHistorico,
  diasRestantes: calcularDiasRestantes,
  verificarFraudeData,
  verificarDataAlterada,
  verificarVencimento,
  getStatusFromLicense,
  gravarLog,
  registrarExecucao,
  atualizarUltimaVerificacao,
  inicializarLicenca
};
