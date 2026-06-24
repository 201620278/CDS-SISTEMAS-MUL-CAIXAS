const path = require('path');

console.log('SERVER RODANDO DE:', process.cwd());
console.log('SERVER FILE:', __filename);

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3001;

// Chave secreta (deve ser a mesma do auth.js)
const JWT_SECRET = 'mercantil_do_nando_secret_key_2024';

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.get('/ping', (req, res) => {
    res.json({ status: 'ok' });
});

app.get('/api/ping', (req, res) => {
    res.json({ status: 'ok' });
});

app.use(express.static(path.join(__dirname, '../frontend')));
function getWritableStoragePath() {
    if (process.platform === 'win32') {
      return path.join(
        process.env.PROGRAMDATA || 'C:\\ProgramData',
        'CDS Sistemas',
        'CDS Sistemas'
      );
    }
  
    return path.join(process.cwd(), 'dados-app');
  }
  
  // primeiro tenta no local correto (produção)
  app.use('/storage', express.static(path.join(getWritableStoragePath(), 'storage')));
  
  // fallback (para desenvolvimento)
  app.use('/storage', express.static(path.join(__dirname, '../storage')));

// Função para verificar token
function verificarToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    const isApiRequest = req.originalUrl.startsWith('/api');

    if (!token) {
        // Redireciona somente páginas HTML; API deve sempre retornar JSON
        if (!isApiRequest && req.accepts('html')) {
            return res.redirect('/login');
        }
        return res.status(401).json({ error: 'Acesso negado' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            if (!isApiRequest && req.accepts('html')) {
                return res.redirect('/login');
            }
            return res.status(403).json({ error: 'Token inválido ou expirado' });
        }

        // Usar dados do token diretamente para evitar consulta ao banco
        req.user = user;
        next();

        // Se precisar do perfil, consulte na rota específica
        // db.get(
        //     'SELECT id, username, nome, role, COALESCE(perfil, \'USUARIO\') as perfil FROM usuarios WHERE id = ?',
        //     [user.id],
        //     (err, usuario) => {
        //         if (err || !usuario) {
        //             req.user = user;
        //             return next();
        //         }

        //         req.user = {
        //             id: usuario.id,
        //             username: usuario.username,
        //             nome: usuario.nome,
        //             role: usuario.role,
        //             perfil: usuario.perfil
        //         };

        //         next();
        //     }
        // );
    });
}

// Rotas públicas
const { router: authRouter } = require('./rotas/auth');
app.use('/api/auth', authRouter);

// Rota pública para configuração de fundo do login
const db = require('./database');
app.get('/api/configuracoes/login_background', (req, res) => {
    db.get("SELECT valor FROM configuracoes WHERE chave = 'login_background'", [], (err, row) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ valor: row ? row.valor : null });
    });
});

// Rota de login (página pública)
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/login.html'));
});


// Rotas protegidas (API)
const produtosRoutes = require('./rotas/produtos');
const clientesRoutes = require('./rotas/clientes');
const comprasRoutes = require('./rotas/compras');
const categoriasRoutes = require('./rotas/categorias');
const subcategoriasRoutes = require('./rotas/subcategorias');
const vendasRoutes = require('./rotas/vendas');
const financeiroRoutes = require('./rotas/financeiro');
const configuracoesRoutes = require('./rotas/configuracoes');
const configuracaoRedeRoutes = require('./rotas/configuracao_rede');
const fiscalRoutes = require('./rotas/fiscal');
const fornecedoresRoutes = require('./rotas/fornecedores');
const impressaoRoutes = require('./rotas/impressao');
const caixaRoutes = require('./rotas/caixa');
const caixasRoutes = require('./rotas/caixas');
const terminaisRoutes = require('./rotas/terminais');
const backupRoutes = require('./rotas/backup');
const tefRoutes = require('./rotas/tef');
const pixRoutes = require('./rotas/pix');
const dashboardRoutes = require('./rotas/dashboard');
const contasReceberRoutes = require('./rotas/contas_receber');
const alertasRoutes = require('./rotas/alertas');
const auditoriaRoutes = require('./rotas/auditoria');
const licencaRoutes = require('./rotas/licenca');
const dfeRoutes = require('./rotas/dfe');
const licencaMiddleware = require('./middleware/licencaMiddleware');
const configuracoesAvancadasRoutes = require('./rotas/configuracoes_avancadas');
const { exigirRecurso } = require('./middleware/validarRecursoImplantacao');
const configService = require('./services/configuracaoService');
// const usuariosRoutes = require('./rotas/usuarios');

configService.ensureConfigFile();
configService.reloadGlobalConfig();

app.use('/api/produtos', verificarToken, produtosRoutes);
app.use('/api/clientes', verificarToken, clientesRoutes);
app.use('/api/compras', verificarToken, comprasRoutes);
app.use('/api/categorias', verificarToken, categoriasRoutes);
app.use('/api/subcategorias', verificarToken, subcategoriasRoutes);
app.use('/api/vendas', verificarToken, vendasRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/financeiro', verificarToken, financeiroRoutes);
app.use('/api/contas-receber', verificarToken, contasReceberRoutes);
app.use('/api/configuracoes', verificarToken, configuracoesRoutes);
app.use('/api/configuracao-rede', verificarToken, configuracaoRedeRoutes);
app.use('/api/configuracoes-avancadas', verificarToken, configuracoesAvancadasRoutes);
app.use('/api/fiscal', verificarToken, fiscalRoutes);
app.use('/api/fornecedores', verificarToken, fornecedoresRoutes);
app.use('/api/impressao', verificarToken, impressaoRoutes);
app.use('/api/caixa', verificarToken, caixaRoutes);
app.use('/api/caixas', verificarToken, exigirRecurso('multiCaixa'), caixasRoutes);
app.use('/api/terminais', verificarToken, terminaisRoutes);
app.use('/api/backup', verificarToken, backupRoutes);
app.use('/api/tef', tefRoutes);
app.use('/api/pix', verificarToken, pixRoutes);
app.use('/api/alertas', verificarToken, alertasRoutes);
app.use('/api/auditoria', verificarToken, auditoriaRoutes);
app.use('/api/dfe', verificarToken, exigirRecurso('fiscal'), dfeRoutes);
// app.use('/api/usuarios', verificarToken, usuariosRoutes);

// Rotas de licença (públicas)
app.use('/api/licenca', licencaRoutes);

// Middleware de licença para todas as APIs exceto auth e licença
app.use('/api', licencaMiddleware);

// Rota principal (protegida)
app.get('/', verificarToken, (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Rota para arquivos estáticos (não proteger)
app.get('*.js', (req, res, next) => {
    next();
});
app.get('*.css', (req, res, next) => {
    next();
});
app.get('*.png', (req, res, next) => {
    next();
});
app.get('*.jpg', (req, res, next) => {
    next();
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Erro:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
});

// Iniciar servidor
const server = app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    console.log(`Acesse: http://localhost:${PORT}/login`);
    console.log('Configuração avançada:', configService.getRecursos());
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`Porta ${PORT} já está em uso. Pare o processo que usa a porta ou escolha outra porta.`);
        console.error(`No Windows, use: set PORT=3001 && npm start`);
        process.exit(1);
    }
    console.error('Erro ao iniciar o servidor:', err);
    process.exit(1);
});

module.exports = server;