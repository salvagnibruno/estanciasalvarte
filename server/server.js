require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const SqliteStore = require('better-sqlite3-session-store')(session);
const db = require('./db/db');
const { usuarioAtual } = require('./middleware/auth');

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  store: new SqliteStore({ client: db, expired: { clear: true, intervalMs: 15 * 60 * 1000 } }),
  name: 'estancia.sid',
  secret: process.env.SESSION_SECRET || 'estancia-salvarte-troque-esta-chave',
  resave: false,
  saveUninitialized: true,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 30,
    secure: process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false',
    sameSite: 'lax'
  }
}));
app.use(usuarioAtual);

// ---------- Rotas de API ----------
const authRoutes = require('./routes/auth');
const { router: produtosRoutes } = require('./routes/produtos');
const { router: carrinhoRoutes } = require('./routes/carrinho');
const pedidosRoutes = require('./routes/pedidos');
const pagamentoRouter = require('./routes/pagamento_router');
const encomendasRoutes = require('./routes/encomendas');
const agendamentosRoutes = require('./routes/agendamentos');
const interessesRoutes = require('./routes/interesses');
const gestaoRoutes = require('./routes/gestao');
const superadminRoutes = require('./routes/superadmin');
const catalogoRoutes = require('./routes/catalogo');
const csatRoutes = require('./routes/csat');
const { router: cuponsRoutes } = require('./routes/cupons');

app.use('/api/auth', authRoutes);
app.use('/api', produtosRoutes);
app.use('/api/carrinho', carrinhoRoutes);
app.use('/api/pedidos', pedidosRoutes);
app.use('/api/pagamento', pagamentoRouter);
app.use('/api/encomendas', encomendasRoutes);
app.use('/api/agendamentos', agendamentosRoutes);
app.use('/api/interesses', interessesRoutes);
app.use('/api/gestao', gestaoRoutes);
app.use('/api/superadmin', superadminRoutes);
app.use('/api', catalogoRoutes);
app.use('/api/csat', csatRoutes);
app.use('/api/cupons', cuponsRoutes);

// ---------- Registro de acessos as paginas ----------
// Grava so a navegacao em paginas (nao arquivos estaticos nem chamadas de API),
// para analise posterior junto com pedidos e cadastros.
const registrarAcesso = db.prepare(
  `INSERT INTO acessos (usuario_id, sessao_id, caminho, referencia, user_agent) VALUES (?, ?, ?, ?, ?)`
);

app.use((req, res, next) => {
  const ehPagina = req.method === 'GET'
    && !req.path.startsWith('/api/')
    && (req.path === '/' || req.path.endsWith('.html'));
  if (ehPagina) {
    try {
      registrarAcesso.run(
        req.session.usuario ? req.session.usuario.id : null,
        req.sessionID,
        req.path,
        req.get('referer') || null,
        (req.get('user-agent') || '').slice(0, 300)
      );
    } catch (e) {
      console.error('[acessos] não foi possível registrar:', e.message);
    }
  }
  next();
});

// ---------- Frontend estatico ----------
// Paginas e scripts saem com `no-store`: o navegador nunca reaproveita uma
// versao anterior. Sem isto, depois de uma atualizacao do sistema a aba antiga
// continuava rodando o painel velho — e a selecao de categorias do catalogo
// parecia ser ignorada, porque a tela montava a URL no formato antigo.
// Imagens e CSS seguem com a validacao normal (ETag), que ja e' suficiente.
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, caminho) => {
    if (/\.(html|js)$/i.test(caminho)) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
    }
  }
}));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', '404.html'), err => {
    if (err) res.status(404).send('Página não encontrada.');
  });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ erro: 'Erro interno do servidor.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Estância Salvarte rodando em http://localhost:${PORT}`);
});
