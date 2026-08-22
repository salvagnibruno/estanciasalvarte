require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const compression = require('compression');
const cookieSession = require('cookie-session');
const db = require('./db/db');
const { usuarioAtual } = require('./middleware/auth');

// Rede de segurança: o Express 4 (usado aqui) NÃO encaminha sozinho um erro
// vindo de dentro de uma rota "async" para o middleware de erro (app.use((err,
// req, res, next)=>... lá embaixo) — isso só existe a partir do Express 5. Uma
// Promise rejeitada sem tratamento vira um "unhandledRejection" do processo
// Node, que por padrão (desde o Node 15) DERRUBA O SERVIDOR INTEIRO — ou seja,
// um erro de rede pontual numa única requisição podia tirar a loja do ar pra
// todo mundo. Isso aqui evita o pior caso: loga o erro (pra investigar) e
// mantém o processo no ar. O ideal a longo prazo é colocar try/catch em cada
// rota async (feito nas mais críticas, como o checkout — ver routes/pedidos.js).
process.on('unhandledRejection', (motivo) => {
  console.error('[server] Erro não tratado numa requisição (o servidor continua no ar):', motivo);
});

const app = express();
app.set('trust proxy', 1);
// Comprime HTML/CSS/JS/JSON antes de sair — sem isto nada tinha compressao
// (nem o Express nem o proxy da hospedagem fazem isso sozinhos), o que pesa
// bastante em conexao movel: o catalogo de produtos, por exemplo, sai a mais
// de 30KB em JSON puro.
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Sessão guardada inteira num cookie assinado (sem tabela de sessão no banco):
// funciona sem nenhuma mudança em hospedagem com disco efêmero (Render free,
// por exemplo) — a sessão não some quando a instância reinicia.
app.use(cookieSession({
  name: 'estancia.sid',
  keys: [process.env.SESSION_SECRET || 'estancia-salvarte-troque-esta-chave'],
  maxAge: 1000 * 60 * 60 * 24 * 30,
  secure: process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false',
  sameSite: 'lax'
}));
// cookie-session não tem req.sessionID (não existe um registro no servidor) —
// esse identificador próprio substitui, para carrinho de visitante e analytics.
app.use((req, res, next) => {
  if (req.session && !req.session.sid) req.session.sid = crypto.randomUUID();
  next();
});
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
const gestaoPedidosRoutes = require('./routes/gestao_pedidos');
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
// Prefixo mais especifico primeiro: /api/gestao/pedidos precisa ser
// resolvido pelo router novo antes de cair no /api/gestao generico.
app.use('/api/gestao/pedidos', gestaoPedidosRoutes);
app.use('/api/gestao', gestaoRoutes);
app.use('/api/superadmin', superadminRoutes);
app.use('/api', catalogoRoutes);
app.use('/api/csat', csatRoutes);
app.use('/api/cupons', cuponsRoutes);

// ---------- Registro de acessos as paginas ----------
// Grava so a navegacao em paginas (nao arquivos estaticos nem chamadas de API),
// para analise posterior junto com pedidos e cadastros. Sem aguardar: não
// atrasa a resposta da página por causa de um insert de log.
app.use((req, res, next) => {
  const ehPagina = req.method === 'GET'
    && !req.path.startsWith('/api/')
    && (req.path === '/' || req.path.endsWith('.html'));
  if (ehPagina) {
    db.prepare(
      `INSERT INTO acessos (usuario_id, sessao_id, caminho, referencia, user_agent) VALUES (?, ?, ?, ?, ?)`
    ).run(
      req.session.usuario ? req.session.usuario.id : null,
      req.session.sid,
      req.path,
      req.get('referer') || null,
      (req.get('user-agent') || '').slice(0, 300)
    ).catch(e => console.error('[acessos] não foi possível registrar:', e.message));
  }
  next();
});

// ---------- Frontend estatico ----------
// Paginas e scripts saem com `no-cache`: o navegador SEMPRE revalida com o
// servidor antes de usar uma copia (nunca roda painel velho depois de um
// deploy), mas pode reaproveitar o arquivo via ETag quando ele nao mudou —
// vira um 304 pequeno em vez de rebaixar o JS/HTML inteiro de novo a cada
// pagina. `no-store` (removido) impedia esse cache condicional por completo,
// o que pesava na navegacao entre paginas (varios .html, cada um puxando
// api.js/layout.js do zero). Imagens e CSS seguem com a validacao normal
// (ETag), que ja e' suficiente.
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, caminho) => {
    if (/\.(html|js)$/i.test(caminho)) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
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

// O banco (schema, migrações, seed, superadmin de bootstrap) é assíncrono
// agora (driver do Turso/libsql) — o servidor só aceita requisições depois
// que tudo isso terminar.
db.iniciar()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Estância Salvarte rodando em http://localhost:${PORT}`);
    });

    // Varre pedidos vencidos a cada 5 minutos e marca como Desistência (ver
    // server/utils/expiracao.js). So' comeca depois que o banco esta pronto.
    const { flipPedidosExpirados } = require('./utils/expiracao');
    setInterval(() => {
      flipPedidosExpirados().catch(e => console.error('[expiracao] erro:', e.message));
    }, 5 * 60 * 1000);
  })
  .catch(e => {
    console.error('[startup] não foi possível iniciar o banco de dados:', e);
    process.exit(1);
  });
