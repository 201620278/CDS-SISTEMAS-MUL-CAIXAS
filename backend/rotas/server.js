const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const jwt = require('jsonwebtoken');
const db = require('../database');

const app = express();
const PORT = process.env.PORT || 3000;

// Chave secreta (deve ser a mesma do auth.js)
const JWT_SECRET = 'mercantil_do_nando_secret_key_2024';

// ============ GERENCIAMENTO DE PROMOÇÕES AUTOMÁTICAS ============
// Função para encerrar promoções expiradas automaticamente
function encerrarPromocoesExpiradas() {
  const hoje = new Date().toISOString().split('T')[0];
  
  db.run(`
    UPDATE promocoes
    SET status = 'encerrada', 
        encerrado_em = CURRENT_TIMESTAMP,
        motivo_encerramento = 'Encerrada automaticamente - data de vigência expirada'
    WHERE status = 'ativa' AND date(data_fim) < date(?)
  `, [hoje], function(err) {
    if (err) {
      console.error('❌ Erro ao encerrar promoções expiradas:', err.message);
    } else if (this.changes > 0) {
      console.log(`✅ ${this.changes} promoção(ões) expirada(s) encerrada(s) automaticamente em ${new Date().toLocaleString('pt-BR')}`);
    }
  });
}

// Executar verificação ao iniciar o servidor
function inicializarGerenciamentoPromocoes() {
  console.log('🔄 Verificando promoções expiradas...');
  encerrarPromocoesExpiradas();
  
  // Executar verificação a cada hora
  setInterval(encerrarPromocoesExpiradas, 60 * 60 * 1000);
  console.log('✅ Sistema de encerramento automático de promoções ativado (verifica a cada hora)');
}
// ============================================================

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../frontend')));

// Função para verificar token
function verificarToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        // Se for requisição de página HTML, redirecionar para login
        if (req.accepts('html')) {
            return res.redirect('/login');
        }
        return res.status(401).json({ error: 'Acesso negado' });
    }
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            if (req.accepts('html')) {
                return res.redirect('/login');
            }
            return res.status(403).json({ error: 'Token inválido ou expirado' });
        }
        req.user = user;
        next();
    });
}

// Rotas públicas
const { router: authRouter } = require('./rotas/auth');
app.use('/api/auth', authRouter);

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
const fornecedoresRoutes = require('./rotas/fornecedores');
const contasReceberRoutes = require('./rotas/contas_receber');
const fiscalRoutes = require('./rotas/fiscal');

app.use('/api/produtos', verificarToken, produtosRoutes);
app.use('/api/clientes', verificarToken, clientesRoutes);
app.use('/api/compras', verificarToken, comprasRoutes);
app.use('/api/categorias', verificarToken, categoriasRoutes);
app.use('/api/subcategorias', verificarToken, subcategoriasRoutes);
app.use('/api/vendas', verificarToken, vendasRoutes);
app.use('/api/contas-receber', verificarToken, contasReceberRoutes);
app.use('/api/financeiro', verificarToken, financeiroRoutes);
app.use('/api/configuracoes', verificarToken, configuracoesRoutes);
app.use('/api/fornecedores', verificarToken, fornecedoresRoutes);
app.use('/api/fiscal', verificarToken, fiscalRoutes);

// Endpoint para forçar verificação manual de promoções expiradas
app.post('/api/promocoes/verificar-expiradas', verificarToken, (req, res) => {
  encerrarPromocoesExpiradas();
  res.json({ 
    success: true, 
    message: 'Verificação de promoções expiradas realizada com sucesso' 
  });
});

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
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    console.log(`Acesse: http://localhost:${PORT}/login`);
    
    // Inicializar gerenciamento automático de promoções
    inicializarGerenciamentoPromocoes();
});