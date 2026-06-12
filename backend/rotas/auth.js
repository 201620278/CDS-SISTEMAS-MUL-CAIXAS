const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../database');

const JWT_SECRET = 'mercantil_do_nando_secret_key_2024';

const PERMISSOES_DISPONIVEIS = [
  'pdv',
  'vendas',
  'produtos',
  'clientes',
  'compras',
  'fornecedores',
  'financeiro',
  'caixa',
  'fiscal',
  'configuracoes',
  'usuarios',
  'relatorios',
  'categorias',
  'gerenciar_faixa_atacado'
];

function extrairToken(req) {
  const authHeader = req.headers['authorization'];
  return authHeader && authHeader.split(' ')[1];
}

function verificarToken(req, res, next) {
  const token = extrairToken(req);

  if (!token) {
    return res.status(401).json({ error: 'Acesso negado' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Token inválido ou expirado' });
    }

    req.user = user;
    next();
  });
}

function exigirAdmin(req, res, next) {
  verificarToken(req, res, () => {
    // Buscar dados completos do usuário incluindo perfil
    db.get(
      'SELECT id, username, role, COALESCE(perfil, \'USUARIO\') as perfil, pode_alterar_senhas FROM usuarios WHERE id = ?',
      [req.user?.id],
      (err, usuario) => {
        if (err || !usuario) {
          return res.status(403).json({ error: 'Erro ao verificar permissões.' });
        }

        // Atualizar req.user com dados completos
        req.user.perfil = usuario.perfil;
        req.user.pode_alterar_senhas = usuario.pode_alterar_senhas;

        // Verificar se é admin (role) ou tem perfil de ADMIN/SUPER_ADMIN
        const isAdmin = req.user?.role === 'admin' || usuario.perfil === 'ADMIN' || usuario.perfil === 'SUPER_ADMIN';

        if (!isAdmin) {
          return res.status(403).json({ error: 'Apenas administradores podem executar esta ação.' });
        }

        next();
      }
    );
  });
}

function buscarPermissoesUsuario(usuarioId, callback) {
  db.all(
    `SELECT permissao FROM usuario_permissoes WHERE usuario_id = ? AND permitido = 1`,
    [usuarioId],
    (err, rows) => {
      if (err) return callback(err);

      callback(null, (rows || []).map(r => r.permissao));
    }
  );
}

function isSupervisorPerfil(usuario) {
  const perfil = String(usuario?.perfil || '').trim().toUpperCase();
  return usuario?.role === 'admin' || ['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR'].includes(perfil);
}

function verificarSupervisorToken(token) {
  return new Promise((resolve, reject) => {
    if (!token) {
      return reject(new Error('Token de supervisor ausente.'));
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
      if (err) {
        return reject(new Error('Token de supervisor inválido ou expirado.'));
      }

      if (!isSupervisorPerfil(user)) {
        return reject(new Error('Usuário não possui permissão de supervisor.'));
      }

      resolve(user);
    });
  });
}

router.post('/supervisor/authorize', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Usuário e senha são obrigatórios' });
  }

  db.get(
    `SELECT * FROM usuarios WHERE username = ? AND COALESCE(ativo, 1) = 1`,
    [username],
    (err, usuario) => {
      if (err) {
        console.error('Erro ao consultar usuário:', err);
        return res.status(500).json({ error: 'Erro interno do servidor' });
      }

      if (!usuario) {
        return res.status(401).json({ error: 'Usuário ou senha inválidos' });
      }

      const senhaValida = bcrypt.compareSync(password, usuario.password_hash);

      if (!senhaValida) {
        return res.status(401).json({ error: 'Usuário ou senha inválidos' });
      }

      if (!isSupervisorPerfil(usuario)) {
        return res.status(403).json({ error: 'Apenas supervisor pode autorizar este desconto.' });
      }

      const token = jwt.sign(
        {
          id: usuario.id,
          username: usuario.username,
          nome: usuario.nome || usuario.username,
          role: usuario.role,
          perfil: usuario.perfil || 'USUARIO'
        },
        JWT_SECRET,
        { expiresIn: '15m' }
      );

      res.json({
        token,
        user: {
          id: usuario.id,
          username: usuario.username,
          nome: usuario.nome || usuario.username,
          role: usuario.role,
          perfil: usuario.perfil || 'USUARIO'
        }
      });
    }
  );
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Usuário e senha são obrigatórios' });
  }

  db.get(
    `SELECT * FROM usuarios WHERE username = ? AND COALESCE(ativo, 1) = 1`,
    [username],
    (err, usuario) => {
      if (err) {
        console.error('Erro ao consultar usuário:', err);
        return res.status(500).json({ error: 'Erro interno do servidor' });
      }

      if (!usuario) {
        return res.status(401).json({ error: 'Usuário ou senha inválidos' });
      }

      const senhaValida = bcrypt.compareSync(password, usuario.password_hash);

      if (!senhaValida) {
        return res.status(401).json({ error: 'Usuário ou senha inválidos' });
      }

      buscarPermissoesUsuario(usuario.id, (errPerm, permissoes) => {
        if (errPerm) {
          return res.status(500).json({ error: 'Erro ao carregar permissões.' });
        }

        if (usuario.role === 'admin') {
          permissoes = PERMISSOES_DISPONIVEIS;
        }

        const token = jwt.sign(
          {
            id: usuario.id,
            username: usuario.username,
            nome: usuario.nome || usuario.username,
            role: usuario.role,
            perfil: usuario.perfil || 'USUARIO',
            permissoes
          },
          JWT_SECRET,
          { expiresIn: '8h' }
        );

        res.json({
          token,
          user: {
            id: usuario.id,
            username: usuario.username,
            role: usuario.role,
            perfil: usuario.perfil || 'USUARIO',
            nome: usuario.nome || usuario.username,
            permissoes
          }
        });
      });
    }
  );
});

router.post('/verificar', verificarToken, (req, res) => {
  res.json({ valid: true, user: req.user });
});

router.post('/logout', (req, res) => {
  res.json({ message: 'Logout realizado com sucesso' });
});

router.get('/permissoes-disponiveis', exigirAdmin, (req, res) => {
  res.json(PERMISSOES_DISPONIVEIS);
});

function filtroStatusUsuarios(status) {
  const s = String(status || 'ativos').toLowerCase();
  if (s === 'inativos') return 'WHERE COALESCE(ativo, 1) = 0';
  if (s === 'todos') return '';
  return 'WHERE COALESCE(ativo, 1) = 1';
}

function exigirSuperAdmin(req, res, next) {
  const perfilLogado = String(req.user?.perfil || '').toUpperCase();
  if (perfilLogado !== 'SUPER_ADMIN') {
    return res.status(403).json({
      erro: 'Apenas SUPER_ADMIN pode gerenciar usuários.'
    });
  }
  next();
}

router.get('/usuarios', verificarToken, (req, res) => {
  const filtro = filtroStatusUsuarios(req.query.status);

  db.all(
    `SELECT id, username, role, COALESCE(perfil, 'USUARIO') as perfil,
            COALESCE(pode_alterar_senhas, 0) as pode_alterar_senhas,
            COALESCE(ativo, 1) AS ativo, created_at
     FROM usuarios
     ${filtro}
     ORDER BY username`,
    [],
    (err, usuarios) => {
      if (err) {
        return res.status(500).json({ error: 'Erro ao listar usuários.' });
      }

      res.json(usuarios || []);
    }
  );
});

router.post('/usuarios', exigirAdmin, (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const role = req.body?.role === 'admin' ? 'admin' : 'operador';
  const perfil = ['SUPER_ADMIN', 'ADMIN', 'USUARIO'].includes(req.body?.perfil) ? req.body.perfil : 'USUARIO';
  const podeAlterarSenhas = req.body?.pode_alterar_senhas === 1 || req.body?.pode_alterar_senhas === true ? 1 : 0;
  const permissoes = Array.isArray(req.body?.permissoes) ? req.body.permissoes : [];

  if (!username || !password) {
    return res.status(400).json({ error: 'Usuário e senha são obrigatórios.' });
  }

  if (password.length < 4) {
    return res.status(400).json({ error: 'A senha deve ter pelo menos 4 caracteres.' });
  }

  // Verificar se o usuário logado pode criar este perfil
  const perfilLogado = req.user?.perfil || 'USUARIO';
  if (perfil === 'SUPER_ADMIN' && perfilLogado !== 'SUPER_ADMIN') {
    return res.status(403).json({ error: 'Apenas SUPER_ADMIN pode criar outros SUPER_ADMINs.' });
  }

  db.get(
    'SELECT id, COALESCE(ativo, 1) AS ativo FROM usuarios WHERE username = ?',
    [username],
    (errBusca, existente) => {
    if (errBusca) {
      return res.status(500).json({ error: 'Erro ao validar usuário.' });
    }

    if (existente && existente.ativo === 1) {
      return res.status(409).json({ error: 'Já existe um usuário ativo com esse login.' });
    }

    const hash = bcrypt.hashSync(password, 10);

    const finalizarCadastro = (usuarioId) => {

      if (role === 'admin') {
        return res.json({
          id: usuarioId,
          username,
          role,
          perfil,
          pode_alterar_senhas: podeAlterarSenhas,
          permissoes: PERMISSOES_DISPONIVEIS,
          message: existente
            ? 'Usuário reativado com sucesso.'
            : 'Usuário administrador cadastrado com sucesso.'
        });
      }

      salvarPermissoes(usuarioId, permissoes, () => {
        res.json({
          id: usuarioId,
          username,
          role,
          perfil,
          pode_alterar_senhas: podeAlterarSenhas,
          permissoes,
          message: existente
            ? 'Usuário reativado com sucesso.'
            : 'Usuário cadastrado com sucesso.'
        });
      });
    };

    if (existente && existente.ativo === 0) {
      return db.run(
        `UPDATE usuarios
         SET password_hash = ?, role = ?, nome = ?, perfil = ?, pode_alterar_senhas = ?, ativo = 1
         WHERE id = ?`,
        [hash, role, username, perfil, podeAlterarSenhas, existente.id],
        function (errUpdate) {
          if (errUpdate) {
            return res.status(500).json({ error: 'Erro ao reativar usuário.' });
          }
          finalizarCadastro(existente.id);
        }
      );
    }

    db.run(
      `INSERT INTO usuarios (username, password_hash, role, nome, perfil, pode_alterar_senhas, ativo) VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [username, hash, role, username, perfil, podeAlterarSenhas],
      function (errInsert) {
        if (errInsert) {
          return res.status(500).json({ error: 'Erro ao cadastrar usuário.' });
        }

        finalizarCadastro(this.lastID);
      }
    );
  });
});

router.put('/usuarios/:id', exigirAdmin, (req, res) => {
  const id = Number(req.params.id);
  const role = req.body?.role === 'admin' ? 'admin' : 'operador';
  const perfil = ['SUPER_ADMIN', 'ADMIN', 'USUARIO'].includes(req.body?.perfil) ? req.body.perfil : 'USUARIO';
  const podeAlterarSenhas = req.body?.pode_alterar_senhas === 1 || req.body?.pode_alterar_senhas === true ? 1 : 0;
  const permissoes = Array.isArray(req.body?.permissoes) ? req.body.permissoes : [];
  const password = String(req.body?.password || '');

  if (!id) {
    return res.status(400).json({ error: 'ID inválido.' });
  }

  // Verificar se o usuário logado pode alterar para este perfil
  const perfilLogado = req.user?.perfil || 'USUARIO';
  if (perfil === 'SUPER_ADMIN' && perfilLogado !== 'SUPER_ADMIN') {
    return res.status(403).json({ error: 'Apenas SUPER_ADMIN pode definir perfil SUPER_ADMIN.' });
  }

  db.get('SELECT * FROM usuarios WHERE id = ?', [id], (errBusca, usuario) => {
    if (errBusca) {
      return res.status(500).json({ error: 'Erro ao localizar usuário.' });
    }

    if (!usuario) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    // Impedir que um ADMIN altere um SUPER_ADMIN
    if (usuario.perfil === 'SUPER_ADMIN' && perfilLogado !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Apenas SUPER_ADMIN pode alterar outro SUPER_ADMIN.' });
    }

    const finalizar = () => {
      if (role === 'admin') {
        return res.json({
          message: 'Usuário atualizado com sucesso.',
          perfil,
          pode_alterar_senhas: podeAlterarSenhas
        });
      }

      salvarPermissoes(id, permissoes, () => {
        res.json({
          message: 'Usuário atualizado com sucesso.',
          perfil,
          pode_alterar_senhas: podeAlterarSenhas
        });
      });
    };

    if (password && password.length < 4) {
      return res.status(400).json({ error: 'A senha deve ter pelo menos 4 caracteres.' });
    }

    if (password) {
      const hash = bcrypt.hashSync(password, 10);

      db.run(
        `UPDATE usuarios SET role = ?, perfil = ?, pode_alterar_senhas = ?, password_hash = ? WHERE id = ?`,
        [role, perfil, podeAlterarSenhas, hash, id],
        (errUpdate) => {
          if (errUpdate) {
            return res.status(500).json({ error: 'Erro ao atualizar usuário.' });
          }

          finalizar();
        }
      );
    } else {
      db.run(
        `UPDATE usuarios SET role = ?, perfil = ?, pode_alterar_senhas = ? WHERE id = ?`,
        [role, perfil, podeAlterarSenhas, id],
        (errUpdate) => {
          if (errUpdate) {
            return res.status(500).json({ error: 'Erro ao atualizar usuário.' });
          }

          finalizar();
        }
      );
    }
  });
});

router.patch('/usuarios/:id/desativar', verificarToken, exigirSuperAdmin, (req, res) => {
  const idUsuario = req.params.id;
  const perfilLogado = String(req.user?.perfil || '').toUpperCase();

  if (String(req.user.id) === String(idUsuario)) {
    return res.status(400).json({
      erro: 'Você não pode desativar seu próprio usuário.'
    });
  }

  db.run(
    `UPDATE usuarios SET ativo = 0 WHERE id = ?`,
    [idUsuario],
    function (err) {
      if (err) {
        console.error('Erro ao desativar usuário:', err);
        return res.status(500).json({ erro: 'Erro ao desativar usuário.' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ erro: 'Usuário não encontrado.' });
      }

      console.log(
        `[AUDITORIA] Usuário ${req.user.username} (perfil: ${perfilLogado}) desativou usuário ID ${idUsuario}`
      );

      res.json({
        sucesso: true,
        mensagem: 'Usuário desativado com sucesso.'
      });
    }
  );
});

router.patch('/usuarios/:id/ativar', verificarToken, exigirSuperAdmin, (req, res) => {
  const idUsuario = req.params.id;
  const perfilLogado = String(req.user?.perfil || '').toUpperCase();

  db.run(
    `UPDATE usuarios SET ativo = 1 WHERE id = ?`,
    [idUsuario],
    function (err) {
      if (err) {
        console.error('Erro ao reativar usuário:', err);
        return res.status(500).json({ erro: 'Erro ao reativar usuário.' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ erro: 'Usuário não encontrado.' });
      }

      console.log(
        `[AUDITORIA] Usuário ${req.user.username} (perfil: ${perfilLogado}) reativou usuário ID ${idUsuario}`
      );

      res.json({
        sucesso: true,
        mensagem: 'Usuário reativado com sucesso.'
      });
    }
  );
});

router.delete('/usuarios/:id', verificarToken, exigirSuperAdmin, (req, res) => {
  const idUsuario = req.params.id;
  const perfilLogado = String(req.user?.perfil || '').toUpperCase();

  if (String(req.user.id) === String(idUsuario)) {
    return res.status(400).json({
      erro: 'Você não pode excluir seu próprio usuário.'
    });
  }

  db.serialize(() => {
    db.run(`DELETE FROM usuario_permissoes WHERE usuario_id = ?`, [idUsuario]);
    db.run(`UPDATE caixa_movimentacoes SET usuario_id = NULL WHERE usuario_id = ?`, [idUsuario]);
    db.run(`UPDATE vendas_canceladas SET usuario_id = NULL WHERE usuario_id = ?`, [idUsuario]);

    db.run(`DELETE FROM usuarios WHERE id = ?`, [idUsuario], function (err) {
      if (err) {
        console.error('Erro ao excluir usuário:', err);
        return res.status(500).json({ erro: 'Erro ao excluir usuário.' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ erro: 'Usuário não encontrado.' });
      }

      console.log(
        `[AUDITORIA] Usuário ${req.user.username} (perfil: ${perfilLogado}) excluiu permanentemente usuário ID ${idUsuario}`
      );

      res.json({
        sucesso: true,
        mensagem: 'Usuário excluído permanentemente.'
      });
    });
  });
});

// Rota para alterar senha com verificação de permissões de perfil
router.post('/usuarios/alterar-senha', verificarToken, async (req, res) => {
  const { usuarioAlvoId, novaSenha } = req.body;
  const usuarioLogadoId = req.user?.id;

  if (!usuarioAlvoId || !novaSenha) {
    return res.status(400).json({ sucesso: false, mensagem: 'Dados incompletos.' });
  }

  if (novaSenha.length < 4) {
    return res.status(400).json({ sucesso: false, mensagem: 'A senha deve ter pelo menos 4 caracteres.' });
  }

  try {
    // Buscar dados do usuário logado
    const logado = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM usuarios WHERE id = ?', [usuarioLogadoId], (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });

    if (!logado) {
      return res.status(401).json({ sucesso: false, mensagem: 'Usuário logado inválido.' });
    }

    // Buscar dados do usuário alvo
    const alvo = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM usuarios WHERE id = ?', [usuarioAlvoId], (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });

    if (!alvo) {
      return res.status(404).json({ sucesso: false, mensagem: 'Usuário não encontrado.' });
    }

    // Verificar permissões
    const perfilLogado = logado.perfil || 'USUARIO';
    const perfilAlvo = alvo.perfil || 'USUARIO';
    const podeAlterarSenhas = logado.pode_alterar_senhas === 1;

    let podeAlterar = false;

    if (perfilLogado === 'SUPER_ADMIN') {
      // SUPER_ADMIN pode alterar qualquer usuário
      podeAlterar = true;
    } else if (perfilLogado === 'ADMIN' && podeAlterarSenhas) {
      // ADMIN com permissão pode alterar USUARIO comum
      if (perfilAlvo === 'USUARIO') {
        podeAlterar = true;
      }
    }

    // Usuário pode alterar sua própria senha
    if (usuarioLogadoId === usuarioAlvoId) {
      podeAlterar = true;
    }

    if (!podeAlterar) {
      return res.status(403).json({
        sucesso: false,
        mensagem: 'Você não tem permissão para alterar esta senha.'
      });
    }

    // Criptografar nova senha
    const senhaHash = bcrypt.hashSync(novaSenha, 10);

    // Atualizar senha
    await new Promise((resolve, reject) => {
      db.run('UPDATE usuarios SET password_hash = ? WHERE id = ?', [senhaHash, usuarioAlvoId], function(err) {
        if (err) return reject(err);
        resolve(this.changes);
      });
    });

    res.json({ sucesso: true, mensagem: 'Senha alterada com sucesso.' });

  } catch (error) {
    console.error('Erro ao alterar senha:', error);
    res.status(500).json({ sucesso: false, mensagem: 'Erro interno do servidor.' });
  }
});

// Rota para obter perfil do usuário logado
router.get('/meu-perfil', verificarToken, (req, res) => {
  const usuarioId = req.user?.id;

  db.get(
    'SELECT id, username, nome, role, perfil, pode_alterar_senhas FROM usuarios WHERE id = ?',
    [usuarioId],
    (err, usuario) => {
      if (err || !usuario) {
        return res.status(404).json({ sucesso: false, mensagem: 'Usuário não encontrado.' });
      }

      res.json({
        sucesso: true,
        perfil: usuario.perfil || 'USUARIO',
        podeAlterarSenhas: usuario.pode_alterar_senhas === 1,
        usuario: {
          id: usuario.id,
          username: usuario.username,
          nome: usuario.nome,
          role: usuario.role
        }
      });
    }
  );
});

function salvarPermissoes(usuarioId, permissoes, callback) {
  const permissoesValidas = permissoes.filter(p => PERMISSOES_DISPONIVEIS.includes(p));

  db.serialize(() => {
    db.run(`DELETE FROM usuario_permissoes WHERE usuario_id = ?`, [usuarioId]);

    const stmt = db.prepare(`
      INSERT OR REPLACE INTO usuario_permissoes 
      (usuario_id, permissao, permitido) 
      VALUES (?, ?, 1)
    `);

    permissoesValidas.forEach(p => {
      stmt.run(usuarioId, p);
    });

    stmt.finalize(() => callback && callback());
  });
}

// Função para verificar se o usuário tem uma permissão específica
// Retorna um middleware que verifica: admin/supervisor role OU permissão específica
function verificarPermissaoEspecifica(nomeDaPermissao) {
  return (req, res, next) => {
    verificarToken(req, res, () => {
      // Admin e supervisor sempre têm acesso
      if (req.user?.role === 'admin' || req.user?.role === 'supervisor') {
        return next();
      }

      // Verificar permissão específica para operadores
      buscarPermissoesUsuario(req.user?.id, (err, permissoes) => {
        if (err) {
          return res.status(500).json({ error: 'Erro ao verificar permissões' });
        }

        if (Array.isArray(permissoes) && permissoes.includes(nomeDaPermissao)) {
          return next();
        }

        return res.status(403).json({
          error: `Acesso restrito: permissão "${nomeDaPermissao}" necessária.`
        });
      });
    });
  };
}

module.exports = {
  router,
  verificarToken,
  exigirAdmin,
  verificarSupervisorToken,
  isSupervisorPerfil,
  PERMISSOES_DISPONIVEIS,
  buscarPermissoesUsuario,
  verificarPermissaoEspecifica
};
