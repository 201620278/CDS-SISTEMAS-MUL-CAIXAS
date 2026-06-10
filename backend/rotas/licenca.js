const express = require('express');
const router = express.Router();
const db = require('../database');
const licencaService = require('../services/licencaService');
const verificarLicenca = require('../services/verificarLicenca');

router.get('/', async (req, res) => {
  try {
    const resultado = await verificarLicenca();
    const licenca = await licencaService.obterLicenca();

    // Se resultado indica pendente, forçar datas nulas e dias = 0 no retorno
    if (resultado && resultado.status === 'pendente') {
      return res.json({
        codigo_instalacao: resultado.codigo_instalacao || (licenca && licenca.codigo_instalacao),
        status: 'pendente',
        valido: false,
        motivo: resultado.motivo || 'PENDENTE',
        data_ativacao: null,
        data_expiracao: null,
        dias_restantes: 0
      });
    }

    res.json({
      codigo_instalacao: licenca.codigo_instalacao,
      status: resultado.status,
      valido: resultado.valido,
      motivo: resultado.motivo,
      data_ativacao: licenca.data_ativacao,
      data_expiracao: licenca.data_expiracao,
      dias_restantes: licenca.diasRestantes || 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/historico', async (req, res) => {
  try {
    db.all('SELECT acao, observacao, created_at FROM licenca_historico ORDER BY id DESC', [], (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message || 'Erro ao ler histórico de licença' });
      }
      res.json(rows || []);
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Erro ao ler histórico de licença' });
  }
});

router.post('/ativar', async (req, res) => {
  try {
    const { codigoLicenca } = req.body;

    if (!codigoLicenca || !String(codigoLicenca).trim()) {
      return res.status(400).json({ error: 'Informe o código de licença.' });
    }

    const licenca = await licencaService.atualizarLicenca(String(codigoLicenca).trim());

    return res.json({
      sucesso: true,
      codigo_instalacao: licenca.codigo_instalacao,
      status: licenca.status,
      data_ativacao: licenca.data_ativacao,
      data_expiracao: licenca.data_expiracao,
      dias_restantes: licenca.diasRestantes,
      ultima_verificacao: licenca.ultima_verificacao || null,
      ultima_execucao: licenca.ultima_execucao
    });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Código de licença inválido.' });
  }
});

module.exports = router;
