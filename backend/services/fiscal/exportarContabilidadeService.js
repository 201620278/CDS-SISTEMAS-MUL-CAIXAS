const fs = require('fs');
const path = require('path');
const os = require('os');
const archiver = require('archiver');
const db = require('../../database');
const { getFiscalDir, getFiscalSubDir } = require('./paths');

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row || null);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

function normalizarData(valor) {
  const texto = String(valor || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
    return null;
  }
  return texto;
}

function csvEscape(valor) {
  const texto = String(valor ?? '');
  if (/[;"\n\r]/.test(texto)) {
    return `"${texto.replace(/"/g, '""')}"`;
  }
  return texto;
}

function linhaCsv(campos) {
  return `${campos.map(csvEscape).join(';')}\n`;
}

function agoraLocalBrasil() {
  const agora = new Date();
  const dataBrasil = new Date(agora.toLocaleString('en-US', { timeZone: 'America/Fortaleza' }));
  const ano = dataBrasil.getFullYear();
  const mes = String(dataBrasil.getMonth() + 1).padStart(2, '0');
  const dia = String(dataBrasil.getDate()).padStart(2, '0');
  const hora = String(dataBrasil.getHours()).padStart(2, '0');
  const min = String(dataBrasil.getMinutes()).padStart(2, '0');
  const seg = String(dataBrasil.getSeconds()).padStart(2, '0');
  return `${ano}-${mes}-${dia} ${hora}:${min}:${seg}`;
}

function extrairXmlNfceAutorizado(nota) {
  const xmlEnviado = String(nota?.xml_enviado || '').trim();
  if (xmlEnviado && xmlEnviado.includes('<NFe')) {
    return xmlEnviado.startsWith('<?xml')
      ? xmlEnviado
      : `<?xml version="1.0" encoding="UTF-8"?>\n${xmlEnviado}`;
  }

  const retorno = String(nota?.xml_retorno || '');
  const nfeProc = retorno.match(/<nfeProc[\s\S]*?<\/nfeProc>/i);
  if (nfeProc) {
    return nfeProc[0];
  }

  const nfe = retorno.match(/<NFe[\s\S]*?<\/NFe>/i);
  if (nfe) {
    return nfe[0];
  }

  return null;
}

function nomeArquivoNfce(nota) {
  const chave = String(nota.chave_acesso || '').replace(/\D/g, '');
  if (chave.length === 44) {
    return `${chave}.xml`;
  }
  const numero = nota.numero || nota.venda_codigo || nota.id;
  const serie = nota.serie || 1;
  return `NFCE_${serie}_${numero}.xml`;
}

function nomeArquivoEntrada(compra) {
  const chave = String(compra.chave_acesso || '').replace(/\D/g, '');
  if (chave.length === 44) {
    return `${chave}.xml`;
  }
  const numero = compra.numero_nf || compra.id;
  return `ENTRADA_${numero}.xml`;
}

async function buscarXmlEntrada(compra) {
  const chave = String(compra.chave_acesso || '').replace(/\D/g, '');

  if (chave.length === 44) {
    const dfe = await dbGet('SELECT xml FROM notas_recebidas_dfe WHERE chave = ? LIMIT 1', [chave]);
    if (dfe?.xml) {
      return dfe.xml;
    }

    const recebida = await dbGet('SELECT xml FROM notas_recebidas WHERE chave = ? LIMIT 1', [chave]);
    if (recebida?.xml) {
      return recebida.xml;
    }
  }

  const pastasBusca = [
    getFiscalSubDir('xml/entradas'),
    getFiscalSubDir('xml'),
    getFiscalSubDir('entradas'),
    path.join(getFiscalDir(), 'entradas')
  ];

  const candidatos = [];
  if (chave.length === 44) {
    candidatos.push(`${chave}.xml`, `NFe${chave}.xml`);
  }
  if (compra.numero_nf) {
    candidatos.push(`ENTRADA_${compra.numero_nf}.xml`, `${compra.numero_nf}.xml`);
  }
  candidatos.push(`compra_${compra.id}.xml`);

  for (const pasta of pastasBusca) {
    if (!fs.existsSync(pasta)) continue;
    for (const nome of candidatos) {
      const caminho = path.join(pasta, nome);
      if (fs.existsSync(caminho)) {
        return fs.readFileSync(caminho, 'utf8');
      }
    }
  }

  return null;
}

function garantirPasta(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function escreverArquivo(caminho, conteudo) {
  garantirPasta(path.dirname(caminho));
  fs.writeFileSync(caminho, conteudo, 'utf8');
  return caminho;
}

async function buscarNfceAutorizadas(dataInicial, dataFinal) {
  return dbAll(`
    SELECT
      n.*,
      v.codigo AS venda_codigo,
      v.data_venda,
      v.total AS venda_total,
      v.forma_pagamento,
      v.status AS venda_status,
      c.nome AS cliente_nome,
      c.cpf_cnpj AS cliente_cpf
    FROM nfce_notas n
    INNER JOIN vendas v ON v.id = n.venda_id
    LEFT JOIN clientes c ON c.id = v.cliente_id
    WHERE DATE(COALESCE(n.created_at, v.data_venda)) >= ?
      AND DATE(COALESCE(n.created_at, v.data_venda)) <= ?
      AND (
        LOWER(TRIM(COALESCE(n.status, ''))) = 'autorizada'
        OR (
          n.xml_retorno IS NOT NULL
          AND n.xml_retorno LIKE '%<cStat>100</cStat>%'
          AND LOWER(TRIM(COALESCE(n.status, ''))) NOT IN ('cancelada', 'rejeitada', 'erro')
        )
      )
    ORDER BY n.created_at ASC, n.id ASC
  `, [dataInicial, dataFinal]);
}

async function buscarComprasEntrada(dataInicial, dataFinal) {
  return dbAll(`
    SELECT *
    FROM compras
    WHERE DATE(COALESCE(data_emissao, data_entrada, data_compra)) >= ?
      AND DATE(COALESCE(data_emissao, data_entrada, data_compra)) <= ?
      AND LOWER(TRIM(COALESCE(status, 'concluida'))) NOT IN ('cancelada')
      AND (
        (chave_acesso IS NOT NULL AND TRIM(chave_acesso) <> '')
        OR (numero_nf IS NOT NULL AND TRIM(numero_nf) <> '')
      )
    ORDER BY COALESCE(data_emissao, data_entrada, data_compra) ASC, id ASC
  `, [dataInicial, dataFinal]);
}

function gerarCsvVendas(notas) {
  let csv = linhaCsv(['Data', 'Número', 'Cliente', 'CPF/CNPJ', 'Valor', 'Forma Pagamento', 'Situação']);
  for (const nota of notas) {
    csv += linhaCsv([
      (nota.data_venda || nota.created_at || '').toString().slice(0, 10),
      nota.numero || nota.venda_codigo || '',
      nota.cliente_nome || 'Consumidor',
      nota.cliente_cpf || '',
      Number(nota.venda_total || 0).toFixed(2).replace('.', ','),
      nota.forma_pagamento || '',
      nota.status || nota.venda_status || ''
    ]);
  }
  return csv;
}

function gerarCsvCompras(compras) {
  let csv = linhaCsv(['Data', 'Fornecedor', 'CNPJ', 'Número NF', 'Valor Total']);
  for (const compra of compras) {
    csv += linhaCsv([
      (compra.data_emissao || compra.data_entrada || compra.data_compra || '').toString().slice(0, 10),
      compra.fornecedor || '',
      compra.fornecedor_cnpj || '',
      compra.numero_nf || '',
      Number(compra.valor_total_nota || compra.total || 0).toFixed(2).replace('.', ',')
    ]);
  }
  return csv;
}

function gerarCsvResumo({
  dataInicial,
  dataFinal,
  qtdNfce,
  totalVendas,
  qtdEntradas,
  totalCompras,
  dataGeracao
}) {
  let csv = linhaCsv(['Campo', 'Valor']);
  csv += linhaCsv(['Período', `${dataInicial} a ${dataFinal}`]);
  csv += linhaCsv(['Quantidade NFC-e', qtdNfce]);
  csv += linhaCsv(['Valor Total Vendas', totalVendas.toFixed(2).replace('.', ',')]);
  csv += linhaCsv(['Quantidade NF Entrada', qtdEntradas]);
  csv += linhaCsv(['Valor Total Compras', totalCompras.toFixed(2).replace('.', ',')]);
  csv += linhaCsv(['Data de Geração', dataGeracao]);
  return csv;
}

function criarZipAPartirDaPasta(origem, destinoZip, nomePastaNoZip) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destinoZip);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve(destinoZip));
    output.on('error', reject);
    archive.on('error', reject);

    archive.pipe(output);
    archive.directory(origem, nomePastaNoZip || false);
    archive.finalize();
  });
}

function removerPastaRecursiva(dir) {
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

async function exportarContabilidade({ dataInicial, dataFinal }) {
  const inicio = normalizarData(dataInicial);
  const fim = normalizarData(dataFinal);

  if (!inicio || !fim) {
    const erro = new Error('Informe data inicial e data final válidas (AAAA-MM-DD).');
    erro.statusCode = 400;
    throw erro;
  }

  if (inicio > fim) {
    const erro = new Error('A data inicial não pode ser maior que a data final.');
    erro.statusCode = 400;
    throw erro;
  }

  const notas = await buscarNfceAutorizadas(inicio, fim);
  const compras = await buscarComprasEntrada(inicio, fim);

  if (notas.length === 0 && compras.length === 0) {
    const erro = new Error('Nenhum documento encontrado para o período informado.');
    erro.statusCode = 404;
    throw erro;
  }

  const [anoRef, mesRef] = fim.split('-');
  const nomePasta = `CONTABILIDADE_${anoRef}-${mesRef}`;
  const nomeZip = `CONTABILIDADE_${anoRef}_${mesRef}.zip`;
  const baseTemp = garantirPasta(path.join(os.tmpdir(), 'cds-contabilidade'));
  const raizExportacao = path.join(baseTemp, `${nomePasta}_${Date.now()}`);
  const pastaXmlNfce = garantirPasta(path.join(raizExportacao, 'XML_NFCE'));
  const pastaXmlEntradas = garantirPasta(path.join(raizExportacao, 'XML_ENTRADAS'));
  const pastaRelatorios = garantirPasta(path.join(raizExportacao, 'RELATORIOS'));
  const arquivosGerados = [];
  const xmlAusentes = [];

  for (const nota of notas) {
    const xml = extrairXmlNfceAutorizado(nota);
    const nomeArquivo = nomeArquivoNfce(nota);
    const caminhoDestino = path.join(pastaXmlNfce, nomeArquivo);

    if (!xml) {
      xmlAusentes.push({
        tipo: 'NFCE',
        referencia: nota.chave_acesso || `venda_${nota.venda_id}`,
        caminhoEsperado: caminhoDestino
      });
      console.warn(`[CONTABILIDADE] XML NFC-e ausente: nota ${nota.id} / venda ${nota.venda_id}`);
      continue;
    }

    escreverArquivo(caminhoDestino, xml);
    arquivosGerados.push(`XML_NFCE/${nomeArquivo}`);
  }

  for (const compra of compras) {
    const xml = await buscarXmlEntrada(compra);
    const nomeArquivo = nomeArquivoEntrada(compra);
    const caminhoDestino = path.join(pastaXmlEntradas, nomeArquivo);

    if (!xml) {
      xmlAusentes.push({
        tipo: 'ENTRADA',
        referencia: compra.chave_acesso || `compra_${compra.id}`,
        caminhoEsperado: caminhoDestino
      });
      console.warn(`[CONTABILIDADE] XML de entrada ausente: compra ${compra.id}`);
      continue;
    }

    escreverArquivo(caminhoDestino, xml);
    arquivosGerados.push(`XML_ENTRADAS/${nomeArquivo}`);
  }

  const totalVendas = notas.reduce((sum, nota) => sum + Number(nota.venda_total || 0), 0);
  const totalCompras = compras.reduce(
    (sum, compra) => sum + Number(compra.valor_total_nota || compra.total || 0),
    0
  );
  const dataGeracao = agoraLocalBrasil();

  const caminhoVendas = escreverArquivo(
    path.join(pastaRelatorios, 'vendas.csv'),
    gerarCsvVendas(notas)
  );
  arquivosGerados.push('RELATORIOS/vendas.csv');

  const caminhoCompras = escreverArquivo(
    path.join(pastaRelatorios, 'compras.csv'),
    gerarCsvCompras(compras)
  );
  arquivosGerados.push('RELATORIOS/compras.csv');

  const caminhoResumo = escreverArquivo(
    path.join(pastaRelatorios, 'resumo.csv'),
    gerarCsvResumo({
      dataInicial: inicio,
      dataFinal: fim,
      qtdNfce: notas.length,
      totalVendas,
      qtdEntradas: compras.length,
      totalCompras,
      dataGeracao
    })
  );
  arquivosGerados.push('RELATORIOS/resumo.csv');

  const manifestoLinhas = [
    `Exportação para contabilidade - ${dataGeracao}`,
    `Período: ${inicio} a ${fim}`,
    `Pasta raiz: ${nomePasta}/`,
    '',
    'Arquivos gerados:'
  ];

  arquivosGerados.forEach((item) => {
    manifestoLinhas.push(`- ${nomePasta}/${item}`);
  });

  if (xmlAusentes.length > 0) {
    manifestoLinhas.push('', 'XML ausentes (registrados no log):');
    xmlAusentes.forEach((item) => {
      manifestoLinhas.push(`- ${item.tipo} ${item.referencia} (esperado em ${item.caminhoEsperado})`);
    });
  }

  const caminhoManifesto = escreverArquivo(
    path.join(pastaRelatorios, 'manifesto_exportacao.txt'),
    `${manifestoLinhas.join('\n')}\n`
  );
  arquivosGerados.push('RELATORIOS/manifesto_exportacao.txt');

  const caminhoZip = path.join(baseTemp, nomeZip);
  await criarZipAPartirDaPasta(raizExportacao, caminhoZip, nomePasta);

  return {
    nomeZip,
    nomePasta,
    caminhoZip,
    raizExportacao,
    arquivosGerados: arquivosGerados.map((item) => `${nomePasta}/${item}`),
    caminhosAbsolutos: {
      raiz: raizExportacao,
      zip: caminhoZip,
      vendasCsv: caminhoVendas,
      comprasCsv: caminhoCompras,
      resumoCsv: caminhoResumo,
      manifesto: caminhoManifesto
    },
    resumo: {
      periodo: `${inicio} a ${fim}`,
      quantidadeNfce: notas.length,
      valorTotalVendas: totalVendas,
      quantidadeEntradas: compras.length,
      valorTotalCompras: totalCompras,
      dataGeracao,
      xmlAusentes: xmlAusentes.length
    }
  };
}

function limparExportacaoTemporaria(resultado) {
  if (!resultado) return;
  removerPastaRecursiva(resultado.raizExportacao);
  if (resultado.caminhoZip && fs.existsSync(resultado.caminhoZip)) {
    fs.unlinkSync(resultado.caminhoZip);
  }
}

module.exports = {
  exportarContabilidade,
  limparExportacaoTemporaria
};
