// Monta cabecalho e rodape em todas as paginas publicas, e mantem
// o estado de login / contador do carrinho sincronizado.
const LINKS_NAV = [
  { href: '/index.html', label: 'Início' },
  { href: '/catalogo.html', label: 'Catálogo' },
  { href: '/agendar.html', label: 'Agendar serviço' },
  { href: '/sobre.html', label: 'Quem somos' }
];

// Espelho dos dados de server/loja.js (fonte unica). Ficam aqui como valor
// inicial para o cabecalho nao piscar; /api/loja atualiza se algo mudar la
// (inclusive depois que o superadmin personalizar contato/logo pelo painel).
const CONTATO = {
  telefone: '(54) 99931-5550',
  telefoneLink: 'tel:+5554999315550',
  whatsapp: 'https://wa.me/5554999315550',
  whatsappLabel: '(54) 99931-5550',
  instagram: 'https://instagram.com/estanciasalvarte',
  instagramLabel: '@estanciasalvarte',
  email: null,
  logo: '/img/logo-oficial.jpg'
};

async function sincronizarContato() {
  try {
    const loja = await Api.get('/api/loja');
    Object.assign(CONTATO, loja);
  } catch (e) { /* mantem os valores locais */ }
}

function caminhoAtual() {
  const p = window.location.pathname;
  return p.endsWith('/') ? '/index.html' : p;
}

// Avisos ativos (dentro da janela de datas cadastrada pelo superadmin) —
// cadastro completo em /superadmin/index.html, seção "Site".
async function avisosAtivosHtml() {
  try {
    const avisos = await Api.get('/api/avisos/ativos');
    if (!avisos.length) return '';
    return `<div class="avisos-topo">${avisos.map(a => `
      <div class="aviso-item">
        <strong>${escapeHtml(a.titulo)}</strong>${a.mensagem ? ' — ' + escapeHtml(a.mensagem) : ''}
      </div>
    `).join('')}</div>`;
  } catch (e) {
    return '';
  }
}

async function montarHeader(avisosHtml) {
  const alvo = document.getElementById('app-header');
  if (!alvo) return;
  const atual = caminhoAtual();

  alvo.innerHTML = `
    ${avisosHtml}
    <header class="site-header">
      <div class="bar">
        <a class="brand" href="/index.html">
          <img src="${CONTATO.logo || '/img/logo-oficial.jpg'}" alt="Estância Salvarte">
          <span>ESTÂNCIA <em>SALVARTE</em></span>
        </a>
        <nav class="nav-links" id="nav-links">
          ${LINKS_NAV.map(l => `<a href="${l.href}" class="${atual === l.href ? 'ativo' : ''}">${l.label}</a>`).join('')}
        </nav>
        <div class="nav-actions">
          <a href="${CONTATO.telefoneLink}" title="Ligar para a loja" class="tel-header">📞 ${escapeHtml(CONTATO.telefone || '')}</a>
          <a href="${CONTATO.instagram}" title="Instagram: ${escapeHtml(CONTATO.instagramLabel || '')}" target="_blank" rel="noopener">📷</a>
          <a href="${CONTATO.whatsapp}" title="Falar no WhatsApp" target="_blank" rel="noopener" class="btn-whatsapp">🟢 WhatsApp</a>
          <a href="/carrinho.html" title="Carrinho">🛒 <span id="contador-carrinho" class="cart-count">0</span></a>
          <span id="area-usuario"></span>
        </div>
        <button class="menu-toggle" id="menu-toggle" aria-label="Abrir menu">☰</button>
      </div>
    </header>
  `;

  document.getElementById('menu-toggle').addEventListener('click', () => {
    document.getElementById('nav-links').classList.toggle('aberto');
  });

  // Independentes uma da outra — rodam em paralelo em vez de uma esperar a
  // outra, o que so' atrasava o preenchimento do cabecalho sem necessidade.
  await Promise.all([atualizarAreaUsuario(), atualizarContadorCarrinho()]);
}

async function atualizarAreaUsuario() {
  const area = document.getElementById('area-usuario');
  if (!area) return;
  try {
    const usuario = await Api.get('/api/auth/me');
    if (usuario) {
      let painelLink = '';
      if (usuario.papel === 'superadmin') painelLink = '<a href="/superadmin/index.html">Painel</a>';
      else if (usuario.papel === 'admin') painelLink = '<a href="/admin/index.html">Painel</a>';
      area.innerHTML = `<a href="/conta/index.html">Olá, ${escapeHtml(usuario.nome.split(' ')[0])}</a> ${painelLink} <a href="#" id="btn-sair">Sair</a>`;
      document.getElementById('btn-sair').addEventListener('click', async (e) => {
        e.preventDefault();
        await Api.post('/api/auth/logout');
        window.location.href = '/index.html';
      });
    } else {
      area.innerHTML = `<a href="/login.html">Entrar</a>`;
    }
  } catch (e) { area.innerHTML = `<a href="/login.html">Entrar</a>`; }
}

async function atualizarContadorCarrinho() {
  const contador = document.getElementById('contador-carrinho');
  if (!contador) return;
  try {
    const carrinho = await Api.get('/api/carrinho');
    const total = carrinho.itens.reduce((s, i) => s + i.quantidade, 0);
    contador.textContent = total;
  } catch (e) { contador.textContent = '0'; }
}

function montarFooter() {
  const alvo = document.getElementById('app-footer');
  if (!alvo) return;
  alvo.innerHTML = `
    <footer class="site-footer">
      <div class="container">
        <div>
          <h4>Estância Salvarte</h4>
          <p style="max-width:260px;color:#cddac5;font-size:.85rem;">Artigos gaúchos, confecção e serviços — tradição que se veste, qualidade que se leva.</p>
        </div>
        <div>
          <h4>Navegue</h4>
          <a href="/catalogo.html">Catálogo</a>
          <a href="/agendar.html">Agendar serviço</a>
          <a href="/conta/index.html">Minha conta</a>
        </div>
        <div>
          <h4>Atendimento</h4>
          <a href="${CONTATO.telefoneLink}">Telefone: ${CONTATO.telefone}</a>
          <a href="${CONTATO.whatsapp}" target="_blank" rel="noopener">WhatsApp: ${CONTATO.whatsappLabel}</a>
          <a href="${CONTATO.instagram}" target="_blank" rel="noopener">Instagram: ${CONTATO.instagramLabel}</a>
          ${CONTATO.email ? `<a href="mailto:${CONTATO.email}">E-mail: ${CONTATO.email}</a>` : ''}
        </div>
      </div>
      <p class="copy">© ${new Date().getFullYear() || '2026'} Estância Salvarte — Todos os direitos reservados.</p>
    </footer>
  `;
}

document.addEventListener('DOMContentLoaded', async () => {
  // Contato e avisos são independentes — buscados em paralelo em vez de um
  // atrás do outro, o que só atrasava a primeira pintura do cabeçalho.
  // Os dois precisam terminar antes do header (e o rodapé precisa do
  // CONTATO já sincronizado, por isso os dois vêm depois do await).
  const [, avisosHtml] = await Promise.all([sincronizarContato(), avisosAtivosHtml()]);
  montarHeader(avisosHtml);
  montarFooter();
});
