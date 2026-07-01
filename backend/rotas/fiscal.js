const express = require('express');
const router = express.Router();
const db = require('../database');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { getFiscalConfig, setConfiguracao } = require('../services/fiscal/configService');
const { normalizarTokenCsc, normalizarIdCsc } = require('../services/fiscal/utils');
const { carregarCertificadoPfx } = require('../services/fiscal/certificateService');
const { emitirPorVendaId } = require('../services/fiscal/emissor');
const cancelarNfce = require('../services/fiscal/cancelarNfce');
const { getFiscalSubDir } = require('../services/fiscal/paths');
const {
  exportarContabilidade,
  limparExportacaoTemporaria
} = require('../services/fiscal/exportarContabilidadeService');

// Middleware para carregar perfil do usuário
function carregarPerfilUsuario(req, res, next) {
  if (!req.user || !req.user.id) {
    return next();
  }

  db.get(
    'SELECT id, username, role, COALESCE(perfil, \'USUARIO\') as perfil FROM usuarios WHERE id = ?',
    [req.user.id],
    (err, usuario) => {
      if (err || !usuario) {
        return next();
      }
      req.user.perfil = usuario.perfil;
      next();
    }
  );
}

const pastaCertificados = getFiscalSubDir('certificados');

function agoraLocalBrasil() {
  const agora = new Date();
  const dataBrasil = new Date(
    agora.toLocaleString('en-US', { timeZone: 'America/Fortaleza' })
  );
  const ano = dataBrasil.getFullYear();
  const mes = String(dataBrasil.getMonth() + 1).padStart(2, '0');
  const dia = String(dataBrasil.getDate()).padStart(2, '0');
  const hora = String(dataBrasil.getHours()).padStart(2, '0');
  const min = String(dataBrasil.getMinutes()).padStart(2, '0');
  const seg = String(dataBrasil.getSeconds()).padStart(2, '0');
  return `${ano}-${mes}-${dia} ${hora}:${min}:${seg}`;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, pastaCertificados);
  },
  filename: (req, file, cb) => {
    cb(null, 'certificado.pfx');
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();

    if (ext !== '.pfx') {
      return cb(new Error('Envie apenas arquivo .pfx'));
    }

    cb(null, true);
  }
});

router.post('/certificado/upload', upload.single('certificado'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum certificado enviado.' });
    }

    const caminhoCompleto = path.resolve(pastaCertificados, 'certificado.pfx');

    await setConfiguracao(
      'fiscal_certificado_path',
      caminhoCompleto,
      'string',
      'Caminho interno do certificado A1'
    );

    res.json({
      success: true,
      message: 'Certificado enviado com sucesso.',
      path: caminhoCompleto
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/config', async (req, res) => {
  try {
    const config = await getFiscalConfig({ validarUrls: false });
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/config', carregarPerfilUsuario, async (req, res) => {
  try {
    const payload = req.body || {};

    // Validação do número NFC-e
    if (payload.fiscal_numero_atual !== undefined) {
      const numeroAtual = parseInt(payload.fiscal_numero_atual);

      if (numeroAtual < 0) {
        return res.status(400).json({
          error: 'Número NFC-e inválido'
        });
      }

      // Proteção: apenas SUPER_ADMIN pode alterar numeração NFC-e
      const usuario = req.user || {};
      if (usuario.perfil !== 'SUPER_ADMIN') {
        console.log(`[AUDITORIA] Tentativa não autorizada de alterar numeração NFC-e por usuário: ${usuario.username || 'desconhecido'} (perfil: ${usuario.perfil || 'desconhecido'})`);
        return res.status(403).json({
          error: 'Apenas SUPER ADMIN pode alterar a numeração NFC-e.'
        });
      }

      // Log de auditoria
      console.log(`[AUDITORIA] SUPER ADMIN ${usuario.username || 'desconhecido'} alterou numeração NFC-e para: ${numeroAtual}`);
    }

    const entries = Object.entries(payload);
    console.log(`[FISCAL CONFIG PUT] Salvando ${entries.length} configurações`);

    for (const [chave, valor] of entries) {
      let valorFinal = valor;

      if (chave === 'fiscal_token_csc') {
        valorFinal = normalizarTokenCsc(valor);
      }

      if (chave === 'fiscal_id_csc') {
        const digits = String(valor || '1').replace(/\D/g, '') || '1';
        valorFinal = String(Number(digits)).padStart(6, '0');
      }

      console.log(`[FISCAL CONFIG PUT] Salvando: ${chave}`);
      await setConfiguracao(chave, String(valorFinal ?? ''), 'string', `Configuração fiscal: ${chave}`);
    }
    console.log('[FISCAL CONFIG PUT] Todas as configurações salvas com sucesso');
    res.json({ message: 'Configurações fiscais atualizadas com sucesso.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/config/certificado/testar', async (req, res) => {
  try {
    const { certificadoPath, senha } = req.body;
    const certificado = carregarCertificadoPfx(certificadoPath, senha);
    res.json({
      success: true,
      certBase64Length: certificado.certBase64.length
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/emitir/venda/:vendaId', async (req, res) => {
  try {
    const vendaId = Number(req.params.vendaId);
    const resultado = await emitirPorVendaId(vendaId);
    res.json(resultado);
  } catch (error) {
    console.error('Erro ao emitir NFC-e:', error);
    res.json({
      success: false,
      status: 'erro_emissao',
      message: error?.message || 'Erro ao emitir NFC-e.'
    });
  }
});

router.get('/danfe/venda/:vendaId', (req, res) => {
  const vendaId = Number(req.params.vendaId);

  db.get(`
    SELECT n.danfe_html, n.chave_acesso, n.protocolo, n.status, n.numero, n.serie
    FROM nfce_notas n
    WHERE n.venda_id = ?
    ORDER BY n.id DESC
    LIMIT 1
  `, [vendaId], (err, nota) => {
    if (err) {
      console.error('Erro ao buscar DANFE:', err);
      return res.status(500).send('Erro interno ao buscar DANFE.');
    }

    if (!nota) {
      return res.status(404).send('NFC-e não encontrada para esta venda.');
    }

    if (!nota.danfe_html) {
      return res.status(404).send('DANFE não gerado para esta NFC-e.');
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(nota.danfe_html);
  });
});

function extrairTagXml(xml, tag) {
  const regex = new RegExp(`<${tag}>(.*?)</${tag}>`, 'i');
  const match = String(xml || '').match(regex);
  return match ? match[1] : null;
}

function extrairCancelamentoSefaz(xml) {
  const texto = String(xml || '');

  const blocoEventoMatch = texto.match(/<retEvento[\s\S]*?<\/retEvento>/i);
  const blocoEvento = blocoEventoMatch ? blocoEventoMatch[0] : texto;

  return {
    cStatLote: extrairTagXml(texto, 'cStat'),
    xMotivoLote: extrairTagXml(texto, 'xMotivo'),
    cStatEvento: extrairTagXml(blocoEvento, 'cStat'),
    xMotivoEvento: extrairTagXml(blocoEvento, 'xMotivo'),
    protocoloCancelamento: extrairTagXml(blocoEvento, 'nProt'),
    dataCancelamento: extrairTagXml(blocoEvento, 'dhRegEvento')
  };
}

router.post('/notas/:id/cancelar', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { justificativa } = req.body || {};

    if (!justificativa || justificativa.trim().length < 15) {
      return res.status(400).json({
        error: 'A justificativa deve ter no mínimo 15 caracteres.'
      });
    }

    db.get(`
      SELECT *
      FROM nfce_notas
      WHERE id = ?
    `, [id], async (err, nota) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      if (!nota) {
        return res.status(404).json({ error: 'NFC-e não encontrada.' });
      }

      if (!nota.venda_id) {
        return res.status(400).json({
          error: 'NFC-e sem venda vinculada. Não é possível cancelar.'
        });
      }

      db.get(`
        SELECT id, status
        FROM nfce_notas
        WHERE venda_id = ?
          AND status IN ('autorizada', 'cancelamento_rejeitado')
          AND (
            (chave_acesso IS NOT NULL AND chave_acesso <> '')
            OR (xml_retorno IS NOT NULL AND xml_retorno LIKE '%<cStat>100</cStat>%')
          )
        ORDER BY id DESC
        LIMIT 1
      `, [nota.venda_id], async (authErr, notaAutorizada) => {
        if (authErr) {
          return res.status(500).json({ error: authErr.message });
        }

        if (!notaAutorizada) {
          return res.status(400).json({
            error: 'Nenhuma NFC-e autorizada encontrada para esta venda.'
          });
        }

        try {
          const cancelamento = await cancelarNfce(nota.venda_id, justificativa.trim());
          const notaIdAutorizada = cancelamento.notaId;

          const retornoTexto = typeof cancelamento.sefaz === 'string'
            ? cancelamento.sefaz
            : JSON.stringify(cancelamento.sefaz);

          const dadosCancelamento = extrairCancelamentoSefaz(retornoTexto);

          const canceladoComSucesso =
            String(dadosCancelamento.cStatEvento) === '135' ||
            String(dadosCancelamento.cStatEvento) === '136' ||
            String(dadosCancelamento.cStatEvento) === '155';

          const novoStatus = canceladoComSucesso ? 'cancelada' : 'autorizada';

          const resumoCancelamento = `
STATUS CANCELAMENTO: ${novoStatus}
cStatEvento: ${dadosCancelamento.cStatEvento || ''}
xMotivoEvento: ${dadosCancelamento.xMotivoEvento || ''}
protocoloCancelamento: ${dadosCancelamento.protocoloCancelamento || ''}
dataCancelamento: ${dadosCancelamento.dataCancelamento || ''}
justificativa: ${justificativa.trim()}
`;

          db.run(`
            UPDATE nfce_notas
            SET status = ?,
                xml_retorno = COALESCE(xml_retorno, '') || char(10) || ? || char(10) || ?,
                updated_at = datetime('now', 'localtime')
            WHERE id = ?
          `, [novoStatus, resumoCancelamento, retornoTexto, notaIdAutorizada], (updErr) => {
            if (updErr) {
              return res.status(500).json({ error: updErr.message });
            }

            if (!canceladoComSucesso) {
              const motivoRejeicao = dadosCancelamento.xMotivoEvento || 'Cancelamento rejeitado pela SEFAZ.';
              return res.status(400).json({
                success: false,
                error: motivoRejeicao,
                message: motivoRejeicao,
                status: novoStatus,
                chaveAcesso: cancelamento.chaveAcesso,
                retorno: cancelamento.sefaz,
                dadosCancelamento
              });
            }

            res.json({
              success: true,
              message: 'NFC-e cancelada com sucesso.',
              status: novoStatus,
              notaId: notaIdAutorizada,
              chaveAcesso: cancelamento.chaveAcesso,
              protocoloCancelamento: dadosCancelamento.protocoloCancelamento,
              dataCancelamento: dadosCancelamento.dataCancelamento,
              retorno: cancelamento.sefaz,
              dadosCancelamento
            });
          });
        } catch (cancelErr) {
          res.status(500).json({
            error: cancelErr.message
          });
        }
      });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/notas', (req, res) => {
  const todas = req.query.todas === '1';
  const params = [];
  let where = '';

  if (!todas) {
    const dataHoje = agoraLocalBrasil().split(' ')[0];
    where = ' WHERE DATE(n.created_at) = ? ';
    params.push(dataHoje);
  }

  db.all(`
    SELECT n.*, v.codigo as venda_codigo, v.total as venda_total
    FROM nfce_notas n
    LEFT JOIN vendas v ON v.id = n.venda_id
    ${where}
    ORDER BY n.id DESC
  `, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

router.get('/notas/:id', (req, res) => {
  db.get(`
    SELECT n.*, v.codigo as venda_codigo, v.total as venda_total
    FROM nfce_notas n
    LEFT JOIN vendas v ON v.id = n.venda_id
    WHERE n.id = ?
  `, [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'NFC-e não encontrada.' });
    res.json(row);
  });
});

router.post('/exportar-contabilidade', async (req, res) => {
  let resultado = null;

  try {
    const { dataInicial, dataFinal } = req.body || {};
    resultado = await exportarContabilidade({ dataInicial, dataFinal });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${resultado.nomeZip}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Export-Filename, X-Export-Arquivos, X-Export-Resumo');
    res.setHeader('X-Export-Filename', resultado.nomeZip);
    res.setHeader('X-Export-Arquivos', JSON.stringify(resultado.arquivosGerados));
    res.setHeader('X-Export-Resumo', JSON.stringify(resultado.resumo));

    const stream = fs.createReadStream(resultado.caminhoZip);
    stream.on('close', () => limparExportacaoTemporaria(resultado));
    stream.on('error', () => limparExportacaoTemporaria(resultado));
    res.on('close', () => limparExportacaoTemporaria(resultado));
    stream.pipe(res);
  } catch (error) {
    if (resultado) {
      limparExportacaoTemporaria(resultado);
    }

    const status = error.statusCode || 500;
    res.status(status).json({
      error: error.message || 'Erro ao exportar documentos para contabilidade.'
    });
  }
});

module.exports = router;
