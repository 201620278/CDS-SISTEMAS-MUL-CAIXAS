const express = require('express');
const router = express.Router();
const configService = require('../services/configuracaoService');
const { exigirSuperAdmin } = require('./auth');

router.get('/confirmacao-fiscal', (req, res) => {
  try {
    res.json({
      modo_confirmacao_fiscal: configService.getModoConfirmacaoFiscal()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/recursos', (req, res) => {
  try {
    res.json(configService.getRecursos());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/padrao-fiscal', (req, res) => {
  try {
    res.json(configService.getPadraoFiscal());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/padrao-fiscal', exigirSuperAdmin, (req, res) => {
  try {
    const saved = configService.savePadraoFiscal(req.body || {});
    res.json({
      success: true,
      message: 'Padrão Fiscal da Empresa atualizado com sucesso.',
      padrao_fiscal: configService.getPadraoFiscal(saved)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', exigirSuperAdmin, (req, res) => {
  try {
    const cfg = configService.readConfig();
    res.json(Object.assign({}, cfg, { recursos: configService.getRecursos(cfg).recursos }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', exigirSuperAdmin, (req, res) => {
  try {
    const data = req.body || {};
    const validation = configService.validateConfig(data);

    if (!validation.valid) {
      return res.status(400).json({
        error: 'Validação falhou',
        details: validation.errors
      });
    }

    const saved = configService.saveConfig(data);

    res.json({
      success: true,
      message: 'Configurações salvas com sucesso.',
      config: saved,
      recursos: configService.getRecursos(saved).recursos
    });
  } catch (err) {
    const status = err.details ? 400 : 500;
    res.status(status).json({
      error: err.message,
      details: err.details || undefined
    });
  }
});

module.exports = router;
