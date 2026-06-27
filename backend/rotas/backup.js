const express = require("express");
const path = require("path");
const db = require("../database");
const { fazerBackupManual, listarHistoricoBackups, aplicarRetencaoBackups } = require("../services/backupManual");
const {
  isElectronRuntime,
  selecionarPastaBackup
} = require("../services/electronDialogoService");

const router = express.Router();

router.post("/selecionar-pasta", (req, res) => {
  if (!isElectronRuntime()) {
    return res.status(501).json({
      sucesso: false,
      erro: "NOT_ELECTRON",
      mensagem: "Seletor de pasta disponível apenas no aplicativo desktop."
    });
  }

  try {
    const resultado = selecionarPastaBackup();

    if (resultado.cancelado) {
      return res.json({ sucesso: false, cancelado: true });
    }

    if (!resultado.sucesso) {
      return res.status(500).json({
        sucesso: false,
        mensagem: "Não foi possível abrir o seletor de pasta."
      });
    }

    res.json({ sucesso: true, caminho: resultado.caminho });
  } catch (error) {
    console.error("[BACKUP] Erro ao selecionar pasta:", error);
    res.status(500).json({
      sucesso: false,
      mensagem: error.message || "Erro ao selecionar pasta."
    });
  }
});

router.post("/manual", (req, res) => {
  const dbPath =
    process.env.DB_PATH ||
    path.join("C:", "projetos", "MercantilFiscal", "dados", "mercadao.db");

  db.get(
    "SELECT valor FROM configuracoes WHERE chave = 'backup_path'",
    [],
    (err, row) => {
      if (err || !row || !row.valor) {
        return res.status(400).json({
          sucesso: false,
          mensagem: "Configure a pasta de backup primeiro."
        });
      }

      try {
        const resultado = fazerBackupManual(dbPath, row.valor);

        res.json({
          sucesso: true,
          backup: resultado
        });
        aplicarRetencaoBackups(row.valor || undefined, 30);
      } catch (error) {
        res.status(500).json({
          sucesso: false,
          mensagem: error.message
        });
      }
    }
  );
});

router.get('/history', (req, res) => {
  const dbPath = process.env.DB_PATH || path.join('C:', 'projetos', 'MercantilFiscal', 'dados', 'mercadao.db');
  const pastaBackup = req.query.pasta || null;
  try {
    const historico = listarHistoricoBackups(pastaBackup, Number(req.query.limite) || 50);
    res.json({ sucesso: true, historico });
  } catch (err) {
    console.error('Erro ao listar histórico de backups:', err);
    res.status(500).json({ sucesso: false, mensagem: err.message });
  }
});

module.exports = router;
