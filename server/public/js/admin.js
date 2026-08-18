let USUARIO = null;
let CATEGORIAS_CACHE = [];
let PRODUTO_EM_EDICAO = null;
// Produtos marcados na tabela para o reajuste de precos. Sobrevive a troca do
// filtro de categoria de proposito: da' para marcar itens de categorias
// diferentes e reajustar tudo de uma vez.
const PRODUTOS_MARCADOS = new Set();
// Ultima simulacao de reajuste (parametros + resultado). O "Aplicar" repete
// exatamente estes parametros; qualquer mexida nos campos zera isto.
let REAJUSTE_SIMULACAO = null;

async function iniciarPainel() {
  USUARIO = await Api.get('/api/auth/me');
  if (!USUARIO || !['admin', 'superadmin'].includes(USUARIO.papel)) {
    window.location.href = '/login.html';
    return;
  }
  CATEGORIAS_CACHE = await Api.get('/api/categorias');

  // Itens do menu que dependem de permissao concedida pelo superadmin.
  document.querySelectorAll('[data-permissao]').forEach(item => {
    if (!TEM_PERMISSAO(item.dataset.permissao)) item.remove();
  });

  document.querySelectorAll('[data-secao]').forEach(a => a.addEventListener('click', (e) => {
    e.preventDefault();
    document.querySelectorAll('[data-secao]').forEach(x => x.classList.remove('ativo'));
    a.classList.add('ativo');
    document.getElementById('titulo-secao').textContent = a.textContent.trim();
    SECOES[a.dataset.secao]();
  }));
  const inicial = document.querySelector('[data-secao].ativo');
  SECOES[inicial ? inicial.dataset.secao : 'produtos']();
}

const SECOES = {
  produtos: secaoProdutos,
  categorias: secaoCategorias,
  catalogo: secaoCatalogo,
  pedidos: secaoPedidos,
  clientes: secaoClientes,
  csat: secaoCsat,
  agendamentos: secaoAgendamentos,
  encomendas: secaoEncomendas
};

const EH_SUPERADMIN = () => USUARIO && USUARIO.papel === 'superadmin';

// Permissao concedida pelo superadmin. Superadmin tem todas por definicao.
const TEM_PERMISSAO = (chave) => !!USUARIO && (USUARIO.papel === 'superadmin'
  || (Array.isArray(USUARIO.permissoes) && USUARIO.permissoes.includes(chave)));

// ==================== PRODUTOS ====================
async function secaoProdutos() {
  const area = document.getElementById('conteudo-secao');
  const podeExportar = TEM_PERMISSAO('exportar_catalogo');
  const podeReajustar = EH_SUPERADMIN();

  area.innerHTML = `
    ${podeExportar ? faixaExportarCatalogoHtml() : ''}
    ${podeReajustar ? faixaReajusteHtml() : ''}
    <div class="flex entre mt-1" style="margin-bottom:1rem;">
      <select id="filtro-cat-admin"><option value="">Todas as categorias</option>${CATEGORIAS_CACHE.map(c => `<option value="${c.slug}">${escapeHtml(c.nome)}</option>`).join('')}</select>
      <div class="flex" style="gap:.5rem;">
        <button class="btn secundario" id="btn-publico-auto" style="border-color:var(--couro);color:var(--couro);"
                title="Relê a descrição de todos os produtos e preenche o campo Público">♂♀ Público pela descrição</button>
        <button class="btn" id="btn-novo-produto">+ Novo produto</button>
      </div>
    </div>
    <p id="publico-auto-msg" class="msg" style="display:none;"></p>
    <div id="form-produto-wrap"></div>
    <div class="tabela-wrap"><table>
      <thead><tr>
        ${podeReajustar ? '<th class="col-marcar"><input type="checkbox" id="marcar-todos" title="Marcar/desmarcar os produtos visíveis"></th>' : ''}
        <th>Foto</th><th>Código</th><th>Nome</th><th>Categoria</th>${EH_SUPERADMIN() ? '<th>Custo</th>' : ''}<th>Preço</th><th>Estoque</th><th>Status</th><th>Vitrine</th><th>Ações</th>
      </tr></thead>
      <tbody id="tbody-produtos"></tbody>
    </table></div>
  `;
  if (podeExportar) ligarExportarCatalogo();
  if (podeReajustar) ligarReajustePrecos();
  document.getElementById('btn-novo-produto').addEventListener('click', () => abrirFormProduto(null));
  document.getElementById('filtro-cat-admin').addEventListener('change', carregarTabelaProdutos);
  ligarPublicoAutomatico();
  carregarTabelaProdutos();
}

// Reaplica a regra do publico em toda a loja de uma vez. Util depois de revisar
// as descricoes — o preenchimento automatico do formulario so vale para o
// produto que esta aberto.
function ligarPublicoAutomatico() {
  const botao = document.getElementById('btn-publico-auto');
  const msg = document.getElementById('publico-auto-msg');
  botao.addEventListener('click', async () => {
    if (!confirm('Reler a descrição de todos os produtos e preencher o campo Público?\n\n'
      + 'A regra é: "masculino/masculina" → Masculino, "feminino/feminina" → Feminino, nada disso → Unissex.\n'
      + 'Isto substitui os públicos definidos à mão.')) return;
    botao.disabled = true;
    const rotulo = botao.textContent;
    botao.textContent = 'Relendo...';
    try {
      const r = await Api.post('/api/gestao/produtos/publico-automatico', {});
      msg.textContent = `Público atualizado: ${r.masculino} masculino(s), ${r.feminino} feminino(s), ${r.unissex} unissex.`;
      msg.className = 'msg sucesso';
      msg.style.display = 'block';
      carregarTabelaProdutos();
    } catch (e) {
      msg.textContent = e.message;
      msg.className = 'msg erro';
      msg.style.display = 'block';
    } finally {
      botao.disabled = false;
      botao.textContent = rotulo;
    }
  });
}

async function carregarTabelaProdutos() {
  const podeReajustar = EH_SUPERADMIN();
  const todos = await Api.get('/api/gestao/produtos');
  // Produto excluido nao pode continuar contando como marcado.
  const existentes = new Set(todos.map(p => p.id));
  [...PRODUTOS_MARCADOS].forEach(id => { if (!existentes.has(id)) PRODUTOS_MARCADOS.delete(id); });

  const catFiltro = document.getElementById('filtro-cat-admin').value;
  const lista = catFiltro ? todos.filter(p => p.categoria_slug === catFiltro) : todos;
  document.getElementById('tbody-produtos').innerHTML = lista.map(p => `
    <tr>
      ${podeReajustar ? `<td class="col-marcar"><input type="checkbox" class="marcar-produto" data-id="${p.id}" ${PRODUTOS_MARCADOS.has(p.id) ? 'checked' : ''}></td>` : ''}
      <td><span class="mini-foto ${p.imagem_url ? '' : 'vazia'}" title="${p.imagem_url ? 'Com foto' : 'Sem foto cadastrada'}">${p.imagem_url
        ? `<img src="${escapeHtml(p.imagem_url)}" alt="" loading="lazy">`
        : '📷'}</span></td>
      <td>${escapeHtml(p.codigo || '-')}</td>
      <td>${escapeHtml(p.nome)}</td>
      <td>${escapeHtml(p.categoria_nome)}
        <br><small style="color:var(--texto-suave);">${
          p.publico === 'masculino' ? '♂ Masculino' : p.publico === 'feminino' ? '♀ Feminino' : 'Unissex'}</small></td>
      ${EH_SUPERADMIN() ? `<td>${formatarMoeda(p.custo)} <small style="color:var(--texto-suave);">(${p.custo_fonte})</small></td>` : ''}
      <td>${p.em_promocao
        ? `<s style="color:var(--texto-suave);">${formatarMoeda(p.preco_venda)}</s> <strong>${formatarMoeda(p.preco_promocional)}</strong>`
        : formatarMoeda(p.preco_venda)}</td>
      <td>${p.tipo_estoque === 'sob_encomenda' ? 'Sob encomenda' : p.estoque_total}</td>
      <td>${p.ativo ? '<span class="badge ok">Ativo</span>' : '<span class="badge indisponivel">Inativo</span>'}</td>
      <td><button class="btn pequeno ${p.destaque ? '' : 'secundario'}" style="${p.destaque ? '' : 'border-color:#999;color:#666;'}" data-destaque="${p.id}" data-valor="${p.destaque ? 1 : 0}" title="Aparece no carrossel da home">${p.destaque ? '★ Em destaque' : '☆ Destacar'}</button></td>
      <td style="white-space:nowrap;">
        <button class="btn pequeno" data-editar="${p.id}">Editar</button>
        <button class="btn pequeno secundario" style="border-color:var(--couro);color:var(--couro);" data-toggle="${p.id}" data-ativo="${p.ativo ? 1 : 0}">${p.ativo ? 'Inativar' : 'Ativar'}</button>
        <button class="btn pequeno perigo" data-excluir="${p.id}">Excluir</button>
      </td>
    </tr>
  `).join('') || `<tr><td colspan="${EH_SUPERADMIN() ? 11 : 9}">Nenhum produto.</td></tr>`;

  if (podeReajustar) ligarMarcacaoProdutos();

  document.querySelectorAll('[data-destaque]').forEach(b => b.addEventListener('click', async () => {
    await Api.put(`/api/gestao/produtos/${b.dataset.destaque}/destaque`, { destaque: b.dataset.valor === '0' });
    carregarTabelaProdutos();
  }));

  document.querySelectorAll('[data-editar]').forEach(b => b.addEventListener('click', () => abrirFormProduto(b.dataset.editar)));
  document.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', async () => {
    await Api.put(`/api/gestao/produtos/${b.dataset.toggle}/ativo`, { ativo: b.dataset.ativo === '0' });
    carregarTabelaProdutos();
  }));
  document.querySelectorAll('[data-excluir]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Excluir este produto definitivamente?')) return;
    await Api.del(`/api/gestao/produtos/${b.dataset.excluir}`);
    carregarTabelaProdutos();
  }));
}

async function abrirFormProduto(id) {
  PRODUTO_EM_EDICAO = id ? await Api.get(`/api/gestao/produtos/${id}`) : null;
  const p = PRODUTO_EM_EDICAO;
  const wrap = document.getElementById('form-produto-wrap');
  wrap.innerHTML = `
    <div class="card">
      <h3>${p ? 'Editar produto' : 'Novo produto'}</h3>
      <div class="linha-dupla">
        <div><label>Código</label><input id="pf-codigo" value="${p ? escapeHtml(p.codigo || '') : ''}"></div>
        <div><label>Categoria</label><select id="pf-categoria">${CATEGORIAS_CACHE.map(c => `<option value="${c.id}" ${p && p.categoria_id === c.id ? 'selected' : ''}>${escapeHtml(c.nome)}</option>`).join('')}</select></div>
      </div>
      <label>Nome</label><input id="pf-nome" value="${p ? escapeHtml(p.nome) : ''}">
      <label>Descrição</label><textarea id="pf-descricao">${p ? escapeHtml(p.descricao || '') : ''}</textarea>
      <div class="linha-dupla">
        <div><label>Tipo de estoque</label>
          <select id="pf-tipo-estoque">
            <option value="estoque" ${p && p.tipo_estoque === 'estoque' ? 'selected' : ''}>Estoque próprio</option>
            <option value="sob_encomenda" ${p && p.tipo_estoque === 'sob_encomenda' ? 'selected' : ''}>Sob encomenda</option>
          </select>
        </div>
        <div><label>Público</label>
          <select id="pf-publico" title="Usado para exportar o catálogo só de peças masculinas ou femininas">
            ${['unissex', 'masculino', 'feminino'].map(v => `
              <option value="${v}" ${(p ? p.publico : 'unissex') === v ? 'selected' : ''}>${
                v === 'unissex' ? 'Unissex (serve aos dois)' : v[0].toUpperCase() + v.slice(1)}</option>`).join('')}
          </select>
          <small id="pf-publico-auto" style="color:var(--texto-suave);font-size:.75rem;">Preenchido pela descrição do produto.</small>
        </div>
      </div>
      <label>Caminho da imagem</label>
      <input id="pf-imagem" value="${p ? escapeHtml(p.imagem_url || '') : ''}" placeholder="preenchido pelo envio da foto, ou cole uma URL">

      ${blocoFotoHtml(p)}
      <label style="display:flex;align-items:center;gap:.5rem;cursor:pointer;">
        <input type="checkbox" id="pf-destaque" style="width:auto;" ${p && p.destaque ? 'checked' : ''}>
        Exibir no carrossel de destaques da página inicial
      </label>
      <label>Tamanhos (separados por vírgula)</label>
      <input id="pf-tamanhos" value="${p ? p.tamanhos.join(', ') : ''}" placeholder="P, M, G, GG">
      <label>Cores — nome:hex separados por vírgula</label>
      <input id="pf-cores" value="${p ? p.cores.map(c => `${c.cor_nome}:${c.cor_hex}`).join(', ') : ''}" placeholder="preto:#111111, bege:#d2b48c">
      ${blocoFotosCoresHtml(p)}

      ${EH_SUPERADMIN() ? `
        <hr>
        <div class="linha-dupla">
          <div><label>Custo (R$) — só superadmin vê</label><input id="pf-custo" type="number" step="0.01" value="${p ? p.custo : ''}"></div>
          <div><label>Preço de venda atual</label><input id="pf-preco" type="number" step="0.01" value="${p ? p.preco_venda : ''}"></div>
        </div>
        <div class="linha-dupla">
          <div>
            <label>Preço promocional (oferta) — deixe vazio para tirar da promoção</label>
            <input id="pf-promocao" type="number" step="0.01" value="${p && p.preco_promocional ? p.preco_promocional : ''}" placeholder="menor que o preço de venda">
          </div>
          <div style="display:flex;align-items:flex-end;">
            ${p ? '<button class="btn secundario" id="pf-salvar-promocao" style="border-color:var(--couro);color:var(--couro);">Salvar promoção</button>' : ''}
          </div>
        </div>
        <small style="color:var(--texto-suave);">O botão <strong>Salvar</strong> grava tudo desta tela, inclusive custo, preço e oferta. Mudando só o custo, o preço é recalculado pela regra de markup (55/50/45/40%); se você também digitar um preço, o preço digitado prevalece. Os botões ao lado servem para gravar um valor isolado.</small>
      ` : (p ? `<p style="margin-top:.8rem;font-size:.85rem;color:var(--texto-suave);">Preço de venda atual: <strong>${formatarMoeda(p.preco_venda)}</strong> (definido pelo superadmin)</p>` : '<p style="margin-top:.8rem;font-size:.85rem;color:var(--texto-suave);">O preço de venda será definido pelo superadmin após o cadastro.</p>')}

      <div class="flex mt-2">
        <button class="btn" id="pf-salvar">Salvar</button>
        ${EH_SUPERADMIN() && p ? '<button class="btn secundario" id="pf-salvar-custo" style="border-color:var(--couro);color:var(--couro);">Salvar custo (recalcula preço)</button><button class="btn secundario" id="pf-salvar-preco" style="border-color:var(--couro);color:var(--couro);">Salvar preço manual</button>' : ''}
        <button class="btn secundario" id="pf-cancelar" style="border-color:#999;color:#666;">Cancelar</button>
      </div>
      <p id="pf-msg" class="msg" style="display:none;"></p>

      ${p ? `<hr><h4>Estoque por tamanho/cor</h4><div id="pf-estoque"></div>` : ''}
    </div>
  `;

  document.getElementById('pf-cancelar').addEventListener('click', () => { wrap.innerHTML = ''; });
  document.getElementById('pf-salvar').addEventListener('click', () => salvarProduto(p ? p.id : null));
  if (p) ligarUploadFoto(p);
  if (p && p.cores.length) ligarFotosDasCores(p);
  if (EH_SUPERADMIN() && p) {
    document.getElementById('pf-salvar-custo').addEventListener('click', () => salvarCusto(p.id));
    document.getElementById('pf-salvar-preco').addEventListener('click', () => salvarPrecoManual(p.id));
    document.getElementById('pf-salvar-promocao').addEventListener('click', () => salvarPromocao(p.id));
  }
  if (p) montarEstoqueForm(p);
  ligarPublicoPelaDescricao(p);
  // O formulario nasce acima da tabela (e, no superadmin, abaixo da faixa de
  // reajuste): sem isto, editar um produto do fim da lista abria os campos fora
  // da area visivel e parecia que o clique nao tinha feito nada.
  focarNaTela(wrap, 'pf-nome');
}

// Traz o bloco para a area visivel e coloca o cursor no primeiro campo.
// - desconta o cabecalho do painel, que e' fixo no topo: sem isso o titulo do
//   formulario para atras dele;
// - rolagem direta (e nao `behavior: 'smooth'`): a animacao depende de o
//   navegador estar desenhando quadros e simplesmente nao acontece em algumas
//   situacoes — e aqui a rolagem e' o proprio objetivo do clique;
// - `preventScroll` no foco para o salto do cursor nao desfazer a posicao.
function focarNaTela(bloco, campoInicial, apenasSeEscondido) {
  if (!bloco) return;
  const caixa = bloco.getBoundingClientRect();
  const cabecalho = document.querySelector('.site-header');
  const folga = (cabecalho ? cabecalho.getBoundingClientRect().height : 0) + 12;
  const escondido = caixa.top < folga || caixa.top > window.innerHeight - 80;
  if (!apenasSeEscondido || escondido) {
    window.scrollTo({ top: Math.max(0, caixa.top + window.scrollY - folga) });
  }
  const campo = campoInicial && document.getElementById(campoInicial);
  if (campo) campo.focus({ preventScroll: true });
}

// ---------- Publico deduzido do texto do produto ----------
// Regra do cadastro: a descricao manda. "Masculino/Masculina" -> masculino,
// "Feminino/Feminina" -> feminino, nada disso -> unissex. Quando a descricao cita
// os dois (ex.: "masculinas e femininas"), a peca serve aos dois: unissex.
// Se a descricao nao disser nada, o nome e' consultado antes de cair em unissex —
// senao "Bombacha Pampeana Masculina" com descricao vazia sairia como unissex.
function publicoDoTexto(texto) {
  const limpo = String(texto || '').toLowerCase();
  const masculino = /masculin[oa]/.test(limpo);
  const feminino = /feminin[oa]/.test(limpo);
  if (masculino && feminino) return 'unissex';
  if (masculino) return 'masculino';
  if (feminino) return 'feminino';
  return null; // nada dito neste texto
}

// Ordem dos sinais: descricao, nome e, por fim, o nome da categoria ("Bombachas
// Femininas"). Nenhum deles dizendo nada, e' unissex.
function publicoSugerido(descricao, nome, categoria) {
  return publicoDoTexto(descricao) || publicoDoTexto(nome) || publicoDoTexto(categoria) || 'unissex';
}

// Mantem o campo Publico acompanhando o que esta escrito. O admin pode trocar a
// mao depois; a troca so e' refeita se ele mexer no texto de novo.
function ligarPublicoPelaDescricao(p) {
  const descricao = document.getElementById('pf-descricao');
  const nome = document.getElementById('pf-nome');
  const categoria = document.getElementById('pf-categoria');
  const publico = document.getElementById('pf-publico');
  const aviso = document.getElementById('pf-publico-auto');
  if (!descricao || !publico) return;

  const nomeDaCategoria = () => {
    const escolhida = CATEGORIAS_CACHE.find(c => String(c.id) === categoria.value);
    return escolhida ? escolhida.nome : '';
  };

  const aplicar = () => {
    // Qual campo decidiu — a mensagem diz de onde veio, para o preenchimento
    // automatico nao parecer arbitrario.
    const origem = publicoDoTexto(descricao.value) ? 'pela descrição'
      : publicoDoTexto(nome.value) ? 'pelo nome'
        : publicoDoTexto(nomeDaCategoria()) ? 'pela categoria' : null;
    const sugerido = publicoSugerido(descricao.value, nome.value, nomeDaCategoria());
    publico.value = sugerido;
    if (aviso) {
      aviso.textContent = origem && sugerido !== 'unissex'
        ? `Definido ${origem}: ${sugerido}. Pode trocar à mão.`
        : 'Sem "masculino/feminino" no texto: fica Unissex. Pode trocar à mão.';
    }
  };

  descricao.addEventListener('input', aplicar);
  nome.addEventListener('input', aplicar);
  categoria.addEventListener('change', aplicar);
  // Produto novo comeca em branco: ja deixa o campo coerente com o que houver.
  if (!p) aplicar();
}

// ---------- Foto do produto ----------
// A foto enviada aqui e' a mesma que aparece na vitrine, no carrossel da home,
// na pagina do produto e no catalogo em PDF.
function blocoFotoHtml(p) {
  if (!p) {
    return `<p class="msg" style="display:block;background:#fbf3e0;color:#6b5a48;font-size:.84rem;">
      Salve o produto primeiro — depois o campo de envio da foto aparece aqui.
      Enquanto não houver foto, a vitrine mostra o ícone da categoria.
    </p>`;
  }
  return `
    <div class="bloco-foto">
      <div class="previa" id="pf-previa">${p.imagem_url
        ? `<img src="${escapeHtml(p.imagem_url)}" alt="${escapeHtml(p.nome)}">`
        : '<span class="sem-foto">sem foto</span>'}</div>
      <div class="acoes-foto">
        <label style="margin-top:0;">Foto do produto (JPG, PNG, WEBP ou AVIF — até 5 MB)</label>
        <input type="file" id="pf-arquivo" accept="image/jpeg,image/png,image/webp,image/gif,image/avif">
        <div class="flex mt-1">
          <button class="btn pequeno" id="pf-enviar-foto">⬆️ Enviar foto</button>
          <button class="btn pequeno perigo" id="pf-remover-foto" ${p.imagem_url ? '' : 'disabled'}>Remover foto</button>
        </div>
        <small style="color:var(--texto-suave);display:block;margin-top:.5rem;">
          Fotos na proporção retrato (3:4) e com fundo claro ficam melhores no carrossel.
        </small>
        <p id="pf-foto-msg" class="msg" style="display:none;"></p>
      </div>
    </div>
  `;
}

function ligarUploadFoto(p) {
  const msg = document.getElementById('pf-foto-msg');
  const previa = document.getElementById('pf-previa');
  const campoUrl = document.getElementById('pf-imagem');
  const botaoRemover = document.getElementById('pf-remover-foto');

  const avisar = (texto, tipo) => {
    msg.textContent = texto;
    msg.className = 'msg ' + tipo;
    msg.style.display = 'block';
  };

  // Previa local antes de subir, para conferir a foto escolhida.
  document.getElementById('pf-arquivo').addEventListener('change', (e) => {
    const arquivo = e.target.files[0];
    if (arquivo) previa.innerHTML = `<img src="${URL.createObjectURL(arquivo)}" alt="">`;
  });

  document.getElementById('pf-enviar-foto').addEventListener('click', async () => {
    const arquivo = document.getElementById('pf-arquivo').files[0];
    if (!arquivo) return avisar('Escolha um arquivo de imagem primeiro.', 'erro');

    const botao = document.getElementById('pf-enviar-foto');
    botao.disabled = true; botao.textContent = 'Enviando...';
    try {
      const formulario = new FormData();
      formulario.append('imagem', arquivo);
      const resposta = await Api.upload(`/api/gestao/produtos/${p.id}/imagem`, formulario);
      // O campo de caminho acompanha o upload: salvar o produto depois nao apaga a foto.
      campoUrl.value = resposta.imagem_url;
      p.imagem_url = resposta.imagem_url;
      previa.innerHTML = `<img src="${escapeHtml(resposta.imagem_url)}" alt="">`;
      botaoRemover.disabled = false;
      avisar('Foto enviada! Já aparece na vitrine, no carrossel e no catálogo.', 'sucesso');
      carregarTabelaProdutos();
    } catch (e) {
      avisar(e.message, 'erro');
    } finally {
      botao.disabled = false; botao.textContent = '⬆️ Enviar foto';
    }
  });

  botaoRemover.addEventListener('click', async () => {
    if (!confirm('Remover a foto deste produto?')) return;
    try {
      await Api.del(`/api/gestao/produtos/${p.id}/imagem`);
      campoUrl.value = '';
      p.imagem_url = null;
      previa.innerHTML = '<span class="sem-foto">sem foto</span>';
      botaoRemover.disabled = true;
      document.getElementById('pf-arquivo').value = '';
      avisar('Foto removida.', 'sucesso');
      carregarTabelaProdutos();
    } catch (e) { avisar(e.message, 'erro'); }
  });
}

// ---------- Foto por cor ----------
// Cada cor cadastrada pode ter a sua propria foto. Na pagina do produto, o
// cliente escolhe a cor e a imagem principal troca para a foto daquela cor.
// Cor sem foto propria continua mostrando a foto do produto.
function blocoFotosCoresHtml(p) {
  if (!p || !p.cores.length) return '';
  return `
    <div class="fotos-cores">
      <label style="margin-top:0;">Foto de cada cor (opcional)</label>
      <p style="font-size:.82rem;color:var(--texto-suave);margin:.2rem 0 .7rem;">
        A página do produto troca a imagem assim que o cliente escolhe uma cor que tenha foto própria.
        Se você mexeu na lista de cores acima, clique em <strong>Salvar</strong> antes de enviar as fotos.
      </p>
      <div class="grade-cores-foto">
        ${p.cores.map(c => `
          <div class="cor-foto">
            <div class="previa" data-previa-cor="${c.id}">${c.imagem_url
              ? `<img src="${escapeHtml(c.imagem_url)}" alt="${escapeHtml(c.cor_nome)}">`
              : '<span class="sem-foto">sem foto</span>'}</div>
            <div class="cor-nome"><i style="background:${escapeHtml(c.cor_hex)}"></i>${escapeHtml(c.cor_nome)}</div>
            <input type="file" data-arquivo-cor="${c.id}" accept="image/jpeg,image/png,image/webp,image/gif,image/avif">
            <div class="flex">
              <button class="btn pequeno" data-enviar-cor="${c.id}">⬆️ Enviar</button>
              <button class="btn pequeno perigo" data-remover-cor="${c.id}" ${c.imagem_url ? '' : 'disabled'}>Remover</button>
            </div>
          </div>
        `).join('')}
      </div>
      <p id="pf-cores-msg" class="msg" style="display:none;"></p>
    </div>
  `;
}

function ligarFotosDasCores(p) {
  const msg = document.getElementById('pf-cores-msg');
  const avisar = (texto, tipo) => { msg.textContent = texto; msg.className = 'msg ' + tipo; msg.style.display = 'block'; };
  const previaDe = (id) => document.querySelector(`[data-previa-cor="${id}"]`);
  const corDe = (id) => p.cores.find(c => String(c.id) === String(id));

  document.querySelectorAll('[data-arquivo-cor]').forEach(campo => campo.addEventListener('change', (e) => {
    const arquivo = e.target.files[0];
    if (arquivo) previaDe(campo.dataset.arquivoCor).innerHTML = `<img src="${URL.createObjectURL(arquivo)}" alt="">`;
  }));

  document.querySelectorAll('[data-enviar-cor]').forEach(botao => botao.addEventListener('click', async () => {
    const corId = botao.dataset.enviarCor;
    const arquivo = document.querySelector(`[data-arquivo-cor="${corId}"]`).files[0];
    if (!arquivo) return avisar('Escolha a imagem desta cor primeiro.', 'erro');

    botao.disabled = true; botao.textContent = 'Enviando...';
    try {
      const formulario = new FormData();
      formulario.append('imagem', arquivo);
      const resposta = await Api.upload(`/api/gestao/produtos/${p.id}/cores/${corId}/imagem`, formulario);
      const cor = corDe(corId);
      if (cor) cor.imagem_url = resposta.imagem_url;
      previaDe(corId).innerHTML = `<img src="${escapeHtml(resposta.imagem_url)}" alt="">`;
      document.querySelector(`[data-remover-cor="${corId}"]`).disabled = false;
      avisar(`Foto da cor ${cor ? cor.cor_nome : ''} enviada. A página do produto já troca a imagem nesta cor.`, 'sucesso');
    } catch (e) {
      avisar(e.message, 'erro');
    } finally {
      botao.disabled = false; botao.textContent = '⬆️ Enviar';
    }
  }));

  document.querySelectorAll('[data-remover-cor]').forEach(botao => botao.addEventListener('click', async () => {
    const corId = botao.dataset.removerCor;
    if (!confirm('Remover a foto desta cor? Ela volta a mostrar a foto do produto.')) return;
    try {
      await Api.del(`/api/gestao/produtos/${p.id}/cores/${corId}/imagem`);
      const cor = corDe(corId);
      if (cor) cor.imagem_url = null;
      previaDe(corId).innerHTML = '<span class="sem-foto">sem foto</span>';
      document.querySelector(`[data-arquivo-cor="${corId}"]`).value = '';
      botao.disabled = true;
      avisar('Foto da cor removida.', 'sucesso');
    } catch (e) { avisar(e.message, 'erro'); }
  }));
}

function montarEstoqueForm(p) {
  const area = document.getElementById('pf-estoque');
  const linhas = p.estoque.length ? p.estoque : [{ tamanho: p.tamanhos[0] || '', cor: (p.cores[0] || {}).cor_nome || '', quantidade: 0 }];
  area.innerHTML = `
    <div class="tabela-wrap"><table>
      <thead><tr><th>Tamanho</th><th>Cor</th><th>Quantidade</th><th></th></tr></thead>
      <tbody>${linhas.map(e => `
        <tr>
          <td><input value="${escapeHtml(e.tamanho || '')}" data-est-tam style="width:90px;"></td>
          <td><input value="${escapeHtml(e.cor || '')}" data-est-cor style="width:110px;"></td>
          <td><input type="number" value="${e.quantidade}" data-est-qtd style="width:90px;"></td>
          <td><button class="btn pequeno" data-est-salvar>Salvar</button></td>
        </tr>
      `).join('')}</tbody>
    </table></div>
    <button class="btn pequeno secundario mt-1" id="pf-add-estoque" style="border-color:var(--couro);color:var(--couro);">+ linha de estoque</button>
  `;
  const ligarBotoesSalvar = () => document.querySelectorAll('[data-est-salvar]').forEach(btn => {
    btn.onclick = async () => {
      const tr = btn.closest('tr');
      await Api.put(`/api/gestao/produtos/${p.id}/estoque`, {
        tamanho: tr.querySelector('[data-est-tam]').value,
        cor: tr.querySelector('[data-est-cor]').value,
        quantidade: tr.querySelector('[data-est-qtd]').value
      });
      alert('Estoque atualizado.');
      carregarTabelaProdutos();
    };
  });
  ligarBotoesSalvar();
  document.getElementById('pf-add-estoque').addEventListener('click', () => {
    const tbody = area.querySelector('tbody');
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><input data-est-tam style="width:90px;"></td><td><input data-est-cor style="width:110px;"></td><td><input type="number" value="0" data-est-qtd style="width:90px;"></td><td><button class="btn pequeno" data-est-salvar>Salvar</button></td>`;
    tbody.appendChild(tr);
    ligarBotoesSalvar();
  });
}

function parseTamanhos() { return document.getElementById('pf-tamanhos').value.split(',').map(s => s.trim()).filter(Boolean); }
function parseCores() {
  return document.getElementById('pf-cores').value.split(',').map(s => s.trim()).filter(Boolean).map(par => {
    const [nome, hex] = par.split(':').map(s => (s || '').trim());
    return { cor_nome: nome, cor_hex: hex || '#333333' };
  });
}

async function salvarProduto(id) {
  const msg = document.getElementById('pf-msg');
  const corpo = {
    categoria_id: parseInt(document.getElementById('pf-categoria').value, 10),
    codigo: document.getElementById('pf-codigo').value,
    nome: document.getElementById('pf-nome').value,
    descricao: document.getElementById('pf-descricao').value,
    tipo_estoque: document.getElementById('pf-tipo-estoque').value,
    publico: document.getElementById('pf-publico').value,
    imagem_url: document.getElementById('pf-imagem').value,
    destaque: document.getElementById('pf-destaque').checked,
    tamanhos: parseTamanhos(),
    cores: parseCores()
  };
  const botao = document.getElementById('pf-salvar');
  botao.disabled = true;
  try {
    let produtoId = id;
    if (id) {
      await Api.put(`/api/gestao/produtos/${id}`, corpo);
    } else {
      const resp = await Api.post('/api/gestao/produtos', corpo);
      produtoId = resp.id;
    }
    await Api.put(`/api/gestao/produtos/${produtoId}/tamanhos-cores`, { tamanhos: corpo.tamanhos, cores: corpo.cores });
    // Custo, preco e promocao NAO passam pelo PUT acima: a rota de gestao ignora
    // esses campos de proposito (so o superadmin mexe em valor, por rotas
    // proprias). Antes disso, quem editava o preco e clicava em "Salvar" via a
    // mensagem de sucesso e a lista continuar com o preco velho — porque o preco
    // digitado nunca chegava a ser gravado.
    const extras = await salvarValoresDoProduto(produtoId, id ? PRODUTO_EM_EDICAO : null);
    await recarregarProdutoNaTela(produtoId, ['Produto salvo com sucesso!', ...extras].join(' '));
  } catch (e) {
    msg.textContent = e.message; msg.className = 'msg erro'; msg.style.display = 'block';
    botao.disabled = false;
  }
}

// Grava custo/preco/promocao pelas rotas de superadmin, so o que mudou.
// Devolve avisos para compor a mensagem final.
async function salvarValoresDoProduto(produtoId, anterior) {
  const campoCusto = document.getElementById('pf-custo');
  const campoPreco = document.getElementById('pf-preco');
  const campoPromo = document.getElementById('pf-promocao');
  if (!EH_SUPERADMIN() || !campoCusto || !campoPreco) return [];

  const numero = (campo) => {
    const valor = String(campo.value).trim();
    if (valor === '') return null;
    const n = parseFloat(valor);
    return Number.isFinite(n) ? n : null;
  };
  const avisos = [];

  const custo = numero(campoCusto);
  const custoMudou = custo !== null && (!anterior || custo !== anterior.custo);
  if (custoMudou) {
    await Api.put(`/api/superadmin/produtos/${produtoId}/custo`, { custo, custo_fonte: 'tabela' });
  }

  const preco = numero(campoPreco);
  const precoMudou = preco !== null && (!anterior || preco !== anterior.preco_venda);
  if (precoMudou) {
    // Preco digitado ganha do recalculo pela regra de markup — foi uma escolha
    // explicita de quem estava na tela.
    await Api.put(`/api/superadmin/produtos/${produtoId}/preco`, { preco_venda: preco });
    if (custoMudou) avisos.push('Custo e preço manual gravados.');
    else avisos.push('Preço manual gravado.');
  } else if (custoMudou) {
    avisos.push('Custo gravado e preço recalculado pela regra de markup.');
  }

  if (campoPromo) {
    const promo = numero(campoPromo);
    const promoAnterior = anterior ? (anterior.preco_promocional || null) : null;
    if (promo !== promoAnterior) {
      try {
        const resposta = await Api.put(`/api/superadmin/produtos/${produtoId}/promocao`, { preco_promocional: campoPromo.value });
        avisos.push(resposta.preco_promocional ? `Oferta em ${formatarMoeda(resposta.preco_promocional)}.` : 'Oferta removida.');
      } catch (e) {
        // Promocao invalida (>= preco de venda) nao pode derrubar o resto do que
        // ja foi gravado: vira aviso, nao erro da tela inteira.
        avisos.push(`A oferta não foi salva: ${e.message}`);
      }
    }
  }
  return avisos;
}

// Refaz a lista e o formulario com o que ficou gravado no banco, e reescreve a
// mensagem depois (abrirFormProduto remonta o HTML e levaria o <p> junto).
async function recarregarProdutoNaTela(id, texto, tipo) {
  await carregarTabelaProdutos();
  if (id) await abrirFormProduto(id);
  const msg = document.getElementById('pf-msg');
  if (msg) {
    msg.textContent = texto;
    msg.className = 'msg ' + (tipo || 'sucesso');
    msg.style.display = 'block';
  }
}

async function salvarCusto(id) {
  const msg = document.getElementById('pf-msg');
  try {
    await Api.put(`/api/superadmin/produtos/${id}/custo`, { custo: parseFloat(document.getElementById('pf-custo').value), custo_fonte: 'tabela' });
    await recarregarProdutoNaTela(id, 'Custo atualizado e preço recalculado!');
  } catch (e) { msg.textContent = e.message; msg.className = 'msg erro'; msg.style.display = 'block'; }
}

async function salvarPrecoManual(id) {
  const msg = document.getElementById('pf-msg');
  try {
    await Api.put(`/api/superadmin/produtos/${id}/preco`, { preco_venda: parseFloat(document.getElementById('pf-preco').value) });
    await recarregarProdutoNaTela(id, 'Preço manual salvo!');
  } catch (e) { msg.textContent = e.message; msg.className = 'msg erro'; msg.style.display = 'block'; }
}

async function salvarPromocao(id) {
  const msg = document.getElementById('pf-msg');
  try {
    const valor = document.getElementById('pf-promocao').value;
    const resposta = await Api.put(`/api/superadmin/produtos/${id}/promocao`, { preco_promocional: valor });
    await recarregarProdutoNaTela(id, resposta.preco_promocional
      ? `Promoção ativa: ${formatarMoeda(resposta.preco_promocional)}`
      : 'Promoção removida.');
  } catch (e) { msg.textContent = e.message; msg.className = 'msg erro'; msg.style.display = 'block'; }
}

// ==================== EXPORTAR CATALOGO ====================
// O exportador aparece em dois lugares, com os mesmos controles e a mesma
// logica: a faixa no topo de "Produtos" (onde o operador procura por ele) e a
// seccao dedicada da barra lateral. Ambas exigem a permissao exportar_catalogo.
// Escolha por marcacao: da' para exportar uma categoria, algumas ou todas.
// Nenhuma marcada (ou todas marcadas) = catalogo completo.
function escopoCategoriasHtml() {
  return `
    <div class="escopo-categorias">
      <label class="todas"><input type="checkbox" id="cat-todas" checked> Todas as categorias</label>
      <div class="grade-categorias" id="cat-lista">
        ${CATEGORIAS_CACHE.map(c => `
          <label><input type="checkbox" class="cat-op" value="${escapeHtml(c.slug)}" checked>
            ${escapeHtml(c.nome)} <span>(${c.total_produtos})</span></label>
        `).join('')}
      </div>
    </div>
  `;
}

function opcoesPrecosHtml() {
  return `<option value="1">Incluir os preços</option>
    <option value="0">Sem preços (valor sob consulta)</option>`;
}

function faixaExportarCatalogoHtml() {
  return `
    <section class="faixa-exportar">
      <h3>📄 Catálogo comercial em PDF</h3>
      <p class="ajuda">Produtos ativos com foto, tamanhos, cores e preços, em folhas A4 prontas para enviar por WhatsApp ou e-mail.</p>
      <div class="controles">
        <select id="cat-publico" title="Recorte por público">
          <option value="">Todas as peças</option>
          <option value="masculino">Somente masculinas</option>
          <option value="feminino">Somente femininas</option>
        </select>
        <label class="opcao-unissex" id="cat-unissex-area" hidden>
          <input type="checkbox" id="cat-unissex" checked> incluir as unissex
        </label>
        <select id="cat-precos" title="Exibir valores">${opcoesPrecosHtml()}</select>
        <button class="btn" id="cat-gerar">Gerar PDF</button>
        <button class="btn secundario" id="cat-visualizar">👁️ Visualizar</button>
      </div>
      ${escopoCategoriasHtml()}
      <p class="resumo" id="cat-resumo">Calculando o que entra na exportação...</p>
    </section>
  `;
}

// Liga os controles do exportador (serve para a faixa e para a seccao).
function ligarExportarCatalogo() {
  const marcadas = () => [...document.querySelectorAll('.cat-op:checked')].map(c => c.value);

  // Todas marcadas = catalogo completo: nao vale a pena listar 12 slugs na URL.
  const escolhidas = () => {
    const lista = marcadas();
    return lista.length === document.querySelectorAll('.cat-op').length ? [] : lista;
  };

  // Parametros do recorte, compartilhados pela URL do PDF e pela previa do resumo.
  const parametrosDoRecorte = () => {
    const consulta = new URLSearchParams();
    const lista = escolhidas();
    if (lista.length) consulta.set('categorias', lista.join(','));
    const publico = document.getElementById('cat-publico').value;
    if (publico) {
      consulta.set('publico', publico);
      if (!document.getElementById('cat-unissex').checked) consulta.set('unissex', '0');
    }
    return consulta;
  };

  const montarUrl = (imprimir) => {
    const consulta = parametrosDoRecorte();
    if (document.getElementById('cat-precos').value === '0') consulta.set('precos', '0');
    if (imprimir) consulta.set('imprimir', '1');
    const query = consulta.toString();
    return '/catalogo-pdf.html' + (query ? '?' + query : '');
  };

  const abrir = (imprimir) => {
    if (!marcadas().length) {
      document.getElementById('cat-resumo').textContent = 'Marque ao menos uma categoria para exportar.';
      return;
    }
    const aba = window.open(montarUrl(imprimir), '_blank');
    if (!aba) alert('Libere as janelas pop-up para este site para abrir o catálogo.');
  };

  const atualizarResumo = async () => {
    const alvo = document.getElementById('cat-resumo');
    if (!marcadas().length) {
      alvo.textContent = 'Nenhuma categoria marcada — marque ao menos uma para exportar.';
      return;
    }
    try {
      const dados = await Api.get('/api/catalogo?' + parametrosDoRecorte().toString());
      const comFoto = dados.categorias.reduce((s, c) => s + c.produtos.filter(p => p.imagem_url).length, 0);
      alvo.textContent = `${dados.escopo}: ${dados.total_produtos} produto(s) ativo(s) em `
        + `${dados.categorias.length} categoria(s) — ${comFoto} com foto cadastrada.`;
    } catch (e) {
      alvo.textContent = e.message;
    }
  };

  const todas = document.getElementById('cat-todas');
  const sincronizarTodas = () => {
    const caixas = [...document.querySelectorAll('.cat-op')];
    const marcadasAgora = caixas.filter(c => c.checked).length;
    todas.checked = marcadasAgora === caixas.length;
    todas.indeterminate = marcadasAgora > 0 && marcadasAgora < caixas.length;
  };

  todas.addEventListener('change', () => {
    document.querySelectorAll('.cat-op').forEach(c => { c.checked = todas.checked; });
    todas.indeterminate = false;
    atualizarResumo();
  });
  document.querySelectorAll('.cat-op').forEach(caixa => caixa.addEventListener('change', () => {
    sincronizarTodas();
    atualizarResumo();
  }));

  // "incluir as unissex" so faz sentido quando ha' um recorte por publico.
  const publico = document.getElementById('cat-publico');
  const areaUnissex = document.getElementById('cat-unissex-area');
  const sincronizarPublico = () => { areaUnissex.hidden = !publico.value; };
  publico.addEventListener('change', () => { sincronizarPublico(); atualizarResumo(); });
  document.getElementById('cat-unissex').addEventListener('change', atualizarResumo);

  document.getElementById('cat-gerar').addEventListener('click', () => abrir(true));
  document.getElementById('cat-visualizar').addEventListener('click', () => abrir(false));
  sincronizarPublico();
  sincronizarTodas();
  atualizarResumo();
}

async function secaoCatalogo() {
  if (!TEM_PERMISSAO('exportar_catalogo')) {
    document.getElementById('conteudo-secao').innerHTML =
      '<p class="vazio">Seu acesso não tem permissão para exportar o catálogo. Solicite a liberação ao superadmin.</p>';
    return;
  }

  document.getElementById('conteudo-secao').innerHTML = `
    ${faixaExportarCatalogoHtml()}
    <div class="card">
      <h3>Como salvar em PDF</h3>
      <p style="font-size:.88rem;color:var(--texto-suave);">
        O catálogo abre em uma nova aba já paginado em A4, com capa, páginas de produtos e página de
        contatos. Clique em <em>Salvar como PDF</em> e, na janela de impressão, escolha o destino
        <em>"Salvar como PDF"</em>. Mantenha "Gráficos de fundo" ligado para sair com as cores da marca.
      </p>
      <p style="font-size:.88rem;color:var(--texto-suave);">
        Produtos sem foto cadastrada saem com o ícone da categoria no lugar da imagem. Para trocar por
        uma foto real, abra o produto em <strong>Produtos → Editar</strong> e envie a imagem.
      </p>
    </div>
  `;
  ligarExportarCatalogo();
}

// ==================== CATEGORIAS ====================
// Cadastro, edicao e exclusao das categorias que organizam a loja. O select do
// formulario de produto, o filtro da tabela e o alvo do reajuste leem de
// CATEGORIAS_CACHE, entao toda alteracao aqui recarrega esse cache.
//
// Os ids usam o prefixo `ctg-` porque `cat-` ja e' da faixa de exportar catalogo.
let CATEGORIA_EM_EDICAO = null;

async function recarregarCategoriasCache() {
  CATEGORIAS_CACHE = await Api.get('/api/categorias');
}

async function secaoCategorias(aviso) {
  const categorias = await Api.get('/api/gestao/categorias');
  const emEdicao = categorias.find(c => c.id === CATEGORIA_EM_EDICAO) || null;

  document.getElementById('conteudo-secao').innerHTML = `
    <div class="card">
      <h3>${emEdicao ? `✏️ Editando “${escapeHtml(emEdicao.nome)}”` : '+ Nova categoria'}</h3>
      <div class="linha-dupla">
        <div>
          <label>Nome</label>
          <input id="ctg-nome" placeholder="Ex.: Linha Inverno" value="${emEdicao ? escapeHtml(emEdicao.nome) : ''}">
        </div>
        <div>
          <label>Endereço na loja</label>
          <input id="ctg-slug" placeholder="gerado a partir do nome" value="${emEdicao ? escapeHtml(emEdicao.slug) : ''}">
        </div>
      </div>
      <div class="linha-dupla">
        <div>
          <label>Descrição (opcional)</label>
          <input id="ctg-descricao" placeholder="Aparece na vitrine da categoria" value="${emEdicao && emEdicao.descricao ? escapeHtml(emEdicao.descricao) : ''}">
        </div>
        <div>
          <label>Ordem no menu</label>
          <input id="ctg-ordem" type="number" step="1" placeholder="fim da lista" value="${emEdicao ? emEdicao.ordem : ''}">
        </div>
      </div>
      <p style="font-size:.82rem;color:var(--texto-suave);margin:.6rem 0 0;">
        O endereço é o que vai para o link da loja (<code>/catalogo.html?categoria=botas</code>). Deixe em
        branco para gerar a partir do nome — acentos e espaços são convertidos automaticamente.
      </p>
      <div class="flex mt-1" style="gap:.5rem;">
        <button class="btn" id="ctg-salvar">${emEdicao ? 'Salvar alterações' : 'Criar categoria'}</button>
        ${emEdicao ? '<button class="btn secundario" id="ctg-cancelar" style="border-color:var(--couro);color:var(--couro);">Cancelar edição</button>' : ''}
      </div>
      <p id="ctg-msg" class="msg" style="display:none;"></p>
    </div>
    <div class="tabela-wrap"><table>
      <thead><tr><th>Ordem</th><th>Nome</th><th>Endereço</th><th>Descrição</th><th>Produtos</th><th>Ações</th></tr></thead>
      <tbody>${categorias.map(c => `
        <tr data-linha-categoria="${c.id}" ${c.id === CATEGORIA_EM_EDICAO ? 'style="background:var(--creme);"' : ''}>
          <td>${c.ordem}</td>
          <td><strong>${escapeHtml(c.nome)}</strong></td>
          <td><code style="font-size:.82rem;">${escapeHtml(c.slug)}</code></td>
          <td>${escapeHtml(c.descricao || '—')}</td>
          <td>${c.total_produtos}${c.total_produtos !== c.total_ativos
            ? ` <small style="color:var(--texto-suave);">(${c.total_ativos} ativo[s])</small>` : ''}</td>
          <td style="white-space:nowrap;">
            <button class="btn pequeno" data-editar-categoria="${c.id}">Editar</button>
            <button class="btn pequeno perigo" data-excluir-categoria="${c.id}">Excluir</button>
          </td>
        </tr>
      `).join('') || '<tr><td colspan="6">Nenhuma categoria cadastrada.</td></tr>'}
      </tbody>
    </table></div>
  `;

  ligarCategorias(categorias);
  if (aviso) avisoCategoria(aviso, false);
}

function avisoCategoria(texto, erro) {
  const alvo = document.getElementById('ctg-msg');
  if (!alvo) return;
  alvo.textContent = texto;
  alvo.className = `msg ${erro ? 'erro' : 'sucesso'}`;
  alvo.style.display = 'block';
}

function ligarCategorias(categorias) {
  document.getElementById('ctg-salvar').addEventListener('click', async () => {
    const ordem = document.getElementById('ctg-ordem').value;
    const corpo = {
      nome: document.getElementById('ctg-nome').value,
      slug: document.getElementById('ctg-slug').value,
      descricao: document.getElementById('ctg-descricao').value,
      ordem: ordem === '' ? null : ordem
    };
    try {
      if (CATEGORIA_EM_EDICAO) {
        await Api.put(`/api/gestao/categorias/${CATEGORIA_EM_EDICAO}`, corpo);
      } else {
        await Api.post('/api/gestao/categorias', corpo);
      }
      const salva = CATEGORIA_EM_EDICAO;
      CATEGORIA_EM_EDICAO = null;
      await recarregarCategoriasCache();
      secaoCategorias(salva ? 'Categoria atualizada.' : 'Categoria criada.');
    } catch (e) {
      avisoCategoria(e.message, true);
    }
  });

  const cancelar = document.getElementById('ctg-cancelar');
  if (cancelar) cancelar.addEventListener('click', () => { CATEGORIA_EM_EDICAO = null; secaoCategorias(); });

  document.querySelectorAll('[data-editar-categoria]').forEach(b => b.addEventListener('click', async () => {
    CATEGORIA_EM_EDICAO = Number(b.dataset.editarCategoria);
    await secaoCategorias();
    focarNaTela(document.querySelector('#conteudo-secao .card'), 'ctg-nome');
  }));

  document.querySelectorAll('[data-excluir-categoria]').forEach(b => b.addEventListener('click', () => {
    const categoria = categorias.find(c => c.id === Number(b.dataset.excluirCategoria));
    if (!categoria) return;
    // Categoria vazia sai direto; com produtos, a linha vira o painel de destino
    // (produtos.categoria_id e' obrigatorio — ninguem fica sem categoria).
    if (!categoria.total_produtos) {
      if (!confirm(`Excluir a categoria "${categoria.nome}"?`)) return;
      excluirCategoria(categoria, null);
      return;
    }
    abrirDestinoDosProdutos(categoria, categorias);
  }));
}

function abrirDestinoDosProdutos(categoria, categorias) {
  const outras = categorias.filter(c => c.id !== categoria.id);
  if (!outras.length) {
    avisoCategoria('Esta é a única categoria da loja. Crie outra antes de excluir esta, para os produtos terem para onde ir.', true);
    return;
  }
  const celula = document.querySelector(`[data-linha-categoria="${categoria.id}"]`).lastElementChild;
  celula.innerHTML = `
    <div style="display:flex;align-items:center;gap:.4rem;flex-wrap:wrap;">
      <span style="font-size:.82rem;">${categoria.total_produtos} produto(s) vão para:</span>
      <select id="ctg-destino">${outras.map(c => `<option value="${c.id}">${escapeHtml(c.nome)}</option>`).join('')}</select>
      <button class="btn pequeno perigo" id="ctg-confirmar-exclusao">Mover e excluir</button>
      <button class="btn pequeno secundario" id="ctg-cancelar-exclusao" style="border-color:var(--couro);color:var(--couro);">Cancelar</button>
    </div>
  `;
  document.getElementById('ctg-cancelar-exclusao').addEventListener('click', () => secaoCategorias());
  document.getElementById('ctg-confirmar-exclusao').addEventListener('click', () =>
    excluirCategoria(categoria, document.getElementById('ctg-destino').value));
}

async function excluirCategoria(categoria, destinoId) {
  try {
    await Api.del(`/api/gestao/categorias/${categoria.id}${destinoId ? `?mover_para=${destinoId}` : ''}`);
    if (CATEGORIA_EM_EDICAO === categoria.id) CATEGORIA_EM_EDICAO = null;
    await recarregarCategoriasCache();
    const destino = destinoId && CATEGORIAS_CACHE.find(c => c.id === Number(destinoId));
    secaoCategorias(destino
      ? `Categoria "${categoria.nome}" excluída. ${categoria.total_produtos} produto(s) foram para "${destino.nome}".`
      : `Categoria "${categoria.nome}" excluída.`);
  } catch (e) {
    avisoCategoria(e.message, true);
  }
}

// ==================== REAJUSTE DE PRECOS ====================
// Exclusivo do superadmin, pela mesma razao das demais rotas de preco: e' o
// unico perfil que mexe em custo e valor de venda.
//
// A tela tem duas etapas, e a classe `etapa-previa` na secao diz em qual delas
// esta: "parametros" (campos abertos, botao Simular) e "conferencia" (campos
// travados, tabela antes x depois, e so dois caminhos — Confirmar ou Voltar).
// Travar os campos na conferencia e' o que garante que o que sera' gravado e'
// exatamente o que esta na tela.
function faixaReajusteHtml() {
  return `
    <section class="faixa-reajuste" id="rea-faixa">
      <h3>💲 Reajuste de preços por percentual</h3>
      <p class="ajuda">
        Percentual positivo aumenta, negativo reduz (ex.: <strong>10</strong> = +10%, <strong>-5</strong> = −5%).
        Vale para um produto, vários marcados na tabela, uma categoria inteira ou toda a loja.
      </p>
      <div class="controles">
        <select id="rea-base" title="Sobre qual valor o percentual é aplicado">
          <option value="venda">Sobre o preço de venda atual</option>
          <option value="custo">Sobre o custo (define o markup)</option>
        </select>
        <select id="rea-escopo" title="Quais produtos entram no reajuste">
          <option value="todos">Todos os produtos (loja inteira)</option>
          <option value="categoria">Somente uma categoria</option>
          <option value="selecao">Somente os marcados na tabela</option>
        </select>
        <select id="rea-categoria" title="Categoria do reajuste" hidden>
          ${CATEGORIAS_CACHE.map(c => `<option value="${c.id}">${escapeHtml(c.nome)} (${c.total_produtos} produto[s])</option>`).join('')}
        </select>
        <div class="campo-percentual">
          <input type="number" id="rea-percentual" step="0.1" placeholder="Ex.: 10 ou -5" aria-label="Percentual de reajuste">
          <span>%</span>
        </div>
        <select id="rea-arredondamento" title="Como arredondar o novo preço">
          <option value="centavo">Arredondar nos centavos</option>
          <option value="noventa">Terminar em ,90</option>
          <option value="inteiro">Valor inteiro (sem centavos)</option>
        </select>
        <label class="opcao"><input type="checkbox" id="rea-promocional" checked> Reajustar também os preços promocionais</label>
        <button class="btn" id="rea-simular">Simular novos preços</button>
      </div>
      <p class="base-explicada" id="rea-base-ajuda"></p>
      <p class="resumo" id="rea-resumo">Nenhum produto marcado na tabela.</p>
      <p class="passo" id="rea-passo">${PASSO_PARAMETROS}</p>
      <div class="previa-reajuste" id="rea-previa"></div>
    </section>
  `;
}

// Liga as caixas de marcacao da tabela (redesenhadas a cada carregamento).
function ligarMarcacaoProdutos() {
  const caixas = [...document.querySelectorAll('.marcar-produto')];
  const marcarTodos = document.getElementById('marcar-todos');

  const sincronizarCabecalho = () => {
    if (!marcarTodos) return;
    const marcadas = caixas.filter(c => c.checked).length;
    marcarTodos.checked = caixas.length > 0 && marcadas === caixas.length;
    marcarTodos.indeterminate = marcadas > 0 && marcadas < caixas.length;
  };

  caixas.forEach(caixa => caixa.addEventListener('change', () => {
    const id = Number(caixa.dataset.id);
    if (caixa.checked) PRODUTOS_MARCADOS.add(id); else PRODUTOS_MARCADOS.delete(id);
    sincronizarCabecalho();
    atualizarResumoReajuste();
  }));

  if (marcarTodos) {
    marcarTodos.addEventListener('change', () => {
      caixas.forEach(caixa => {
        caixa.checked = marcarTodos.checked;
        const id = Number(caixa.dataset.id);
        if (caixa.checked) PRODUTOS_MARCADOS.add(id); else PRODUTOS_MARCADOS.delete(id);
      });
      sincronizarCabecalho();
      atualizarResumoReajuste();
    });
  }

  sincronizarCabecalho();
  atualizarResumoReajuste();
}

// Explica em uma linha o que o percentual significa na base escolhida.
function atualizarAjudaBase() {
  const base = document.getElementById('rea-base');
  const alvo = document.getElementById('rea-base-ajuda');
  const campo = document.getElementById('rea-percentual');
  if (!base || !alvo) return;
  if (base.value === 'custo') {
    alvo.textContent = 'Novo preço = custo × (1 + percentual). Ex.: custo R$ 84,00 com 55% → R$ 130,20. '
      + 'Produto sem custo cadastrado fica de fora; produto ainda sem preço de venda é precificado.';
    campo.placeholder = 'Ex.: 55 (markup)';
  } else {
    alvo.textContent = 'Novo preço = preço de venda atual × (1 + percentual). O custo não entra na conta.';
    campo.placeholder = 'Ex.: 10 ou -5';
  }
}

// Texto de apoio do painel. Some quando ha' uma previa simulada na tela.
function atualizarResumoReajuste() {
  const alvo = document.getElementById('rea-resumo');
  const escopo = document.getElementById('rea-escopo');
  if (!alvo || !escopo) return;
  if (escopo.value === 'selecao') {
    alvo.textContent = PRODUTOS_MARCADOS.size
      ? `${PRODUTOS_MARCADOS.size} produto(s) marcado(s) na tabela.`
      : 'Marque na tabela os produtos que devem ser reajustados.';
  } else if (escopo.value === 'categoria') {
    const select = document.getElementById('rea-categoria');
    const categoria = CATEGORIAS_CACHE.find(c => String(c.id) === select.value);
    alvo.textContent = categoria
      ? `Reajuste em todos os produtos de "${categoria.nome}".`
      : 'Escolha a categoria do reajuste.';
  } else {
    alvo.textContent = 'Reajuste em todos os produtos cadastrados na loja.';
  }
}

const PASSO_PARAMETROS = 'Preencha os campos e clique em "Simular novos preços". Nada é gravado nesta etapa.';

const CAMPOS_REAJUSTE = ['rea-base', 'rea-escopo', 'rea-categoria', 'rea-percentual', 'rea-arredondamento', 'rea-promocional'];

function campoReajuste(id) { return document.getElementById(id); }

// Trava/destrava os parametros. Na etapa de conferencia eles ficam desabilitados
// para nao "escorregarem" em relacao aos numeros que estao sendo conferidos.
function travarParametrosReajuste(travado) {
  const faixa = document.getElementById('rea-faixa');
  if (!faixa) return;
  faixa.classList.toggle('etapa-previa', travado);
  CAMPOS_REAJUSTE.forEach(id => { const c = campoReajuste(id); if (c) c.disabled = travado; });
  const simular = campoReajuste('rea-simular');
  if (simular) simular.disabled = travado;
}

function parametrosReajuste(simular) {
  const categoria = campoReajuste('rea-categoria').value;
  return {
    percentual: parseFloat(campoReajuste('rea-percentual').value),
    base: campoReajuste('rea-base').value,
    escopo: campoReajuste('rea-escopo').value,
    categoria_id: categoria ? Number(categoria) : null,
    ids: [...PRODUTOS_MARCADOS],
    arredondamento: campoReajuste('rea-arredondamento').value,
    ajustar_promocional: campoReajuste('rea-promocional').checked,
    simular
  };
}

// Devolve o painel ao estado de tela recem-aberta: campos nos valores padrao,
// nenhuma marcacao herdada, previa limpa. Usado depois de gravar um reajuste —
// os valores que acabaram de ser aplicados nao podem ficar no formulario, senao
// um "Simular" seguinte repetiria o percentual sem querer.
function reiniciarPainelReajuste(mensagem) {
  REAJUSTE_SIMULACAO = null;
  const faixa = document.getElementById('rea-faixa');
  if (!faixa) return;

  campoReajuste('rea-base').value = 'venda';
  campoReajuste('rea-escopo').value = 'todos';
  campoReajuste('rea-percentual').value = '';
  campoReajuste('rea-arredondamento').value = 'centavo';
  campoReajuste('rea-promocional').checked = true;
  const categoria = campoReajuste('rea-categoria');
  categoria.selectedIndex = 0;
  categoria.hidden = true;

  travarParametrosReajuste(false);
  document.getElementById('rea-previa').innerHTML = '';
  document.getElementById('rea-passo').textContent = mensagem || PASSO_PARAMETROS;
  atualizarAjudaBase();
  atualizarResumoReajuste();
}

// Volta para a etapa de parametros mantendo tudo o que foi preenchido — serve
// tanto para o botao "Voltar e alterar" quanto para descartar uma simulacao
// que ficou velha porque algum campo mudou.
function voltarParaParametrosReajuste(mensagem) {
  REAJUSTE_SIMULACAO = null;
  const previa = document.getElementById('rea-previa');
  if (previa) previa.innerHTML = '';
  travarParametrosReajuste(false);
  const passo = document.getElementById('rea-passo');
  if (passo) passo.textContent = mensagem || PASSO_PARAMETROS;
  atualizarAjudaBase();
  atualizarResumoReajuste();
}

async function simularReajuste() {
  const botaoSimular = campoReajuste('rea-simular');
  const previa = document.getElementById('rea-previa');
  const resumo = document.getElementById('rea-resumo');
  botaoSimular.disabled = true;
  botaoSimular.textContent = 'Simulando...';
  try {
    const parametros = parametrosReajuste(true);
    const resultado = await Api.post('/api/superadmin/produtos/reajuste', parametros);
    if (resultado.total_alterados) {
      // Guarda os parametros junto com o resultado: o "Confirmar" repete exatamente
      // o que foi simulado, e nao o que estiver nos campos naquele instante.
      REAJUSTE_SIMULACAO = { parametros, resultado };
      previa.innerHTML = previaReajusteHtml(resultado, true);
      travarParametrosReajuste(true);
      ligarAcoesPrevia();
      // A conferencia e' o proximo passo do operador: traz a tabela para a tela
      // se ela nasceu abaixo da dobra (se ja estiver visivel, nao mexe).
      focarNaTela(previa, null, true);
    } else {
      // Simulacao vazia: segue na etapa de parametros, mas a previa fica na tela
      // mostrando por que nenhum produto entrou.
      REAJUSTE_SIMULACAO = null;
      travarParametrosReajuste(false);
      previa.innerHTML = previaReajusteHtml(resultado, false);
      document.getElementById('rea-passo').textContent =
        'Nenhum produto entrou na simulação. Ajuste o escopo ou o percentual e simule de novo.';
    }
    resumo.textContent = resumoReajuste(resultado);
  } catch (e) {
    // Voltar primeiro, mensagem depois: voltar reescreve o resumo.
    voltarParaParametrosReajuste('Corrija o que está apontado acima e simule de novo.');
    resumo.textContent = e.message;
  } finally {
    botaoSimular.textContent = 'Simular novos preços';
    botaoSimular.disabled = document.getElementById('rea-faixa').classList.contains('etapa-previa');
  }
}

async function confirmarReajuste() {
  if (!REAJUSTE_SIMULACAO) return;
  const ids = idsMarcadosNaPrevia();
  if (!ids.length) return;
  const { parametros } = REAJUSTE_SIMULACAO;
  const pct = parametros.percentual;
  const botao = document.getElementById('rea-confirmar');
  const resumo = document.getElementById('rea-resumo');

  botao.disabled = true;
  botao.textContent = 'Gravando...';
  try {
    // Escopo 'selecao' com os ids da previa: grava exatamente as linhas que
    // ficaram marcadas, mesmo que a simulacao tenha sido "loja inteira".
    const resultado = await Api.post('/api/superadmin/produtos/reajuste',
      { ...parametros, escopo: 'selecao', ids, simular: false });
    REAJUSTE_SIMULACAO = null;
    // As marcacoes foram consumidas por este reajuste: limpar antes de recarregar
    // a tabela, senao as caixas voltam marcadas e o painel nao fica "como aberto".
    PRODUTOS_MARCADOS.clear();
    await carregarTabelaProdutos();
    reiniciarPainelReajuste(
      `✔ ${resultado.total_alterados} produto(s) reajustado(s) — os novos preços já estão na tabela abaixo. ${PASSO_PARAMETROS}`);
  } catch (e) {
    resumo.textContent = e.message;
    botao.disabled = false;
    botao.textContent = '✔ Confirmar reajuste';
  }
}

function ligarReajustePrecos() {
  const escopo = campoReajuste('rea-escopo');
  const selectCategoria = campoReajuste('rea-categoria');
  const campoPercentual = campoReajuste('rea-percentual');

  // Qualquer mudanca nos parametros descarta a simulacao: o que se confirma e'
  // sempre o que se acabou de ver na tela.
  const aoMudar = () => voltarParaParametrosReajuste();

  escopo.addEventListener('change', () => {
    selectCategoria.hidden = escopo.value !== 'categoria';
    aoMudar();
  });
  CAMPOS_REAJUSTE.filter(id => id !== 'rea-escopo')
    .forEach(id => campoReajuste(id).addEventListener('change', aoMudar));
  campoPercentual.addEventListener('input', aoMudar);
  campoReajuste('rea-simular').addEventListener('click', simularReajuste);

  selectCategoria.hidden = escopo.value !== 'categoria';
  atualizarAjudaBase();
  atualizarResumoReajuste();
}

function resumoReajuste(r) {
  const partes = [
    r.simulado ? 'Simulação:' : 'Reajuste aplicado:',
    `${r.total_alterados} produto(s) ${r.simulado ? 'seriam alterados' : 'alterados'}`,
    `(${r.percentual > 0 ? '+' : ''}${r.percentual}% ${r.base === 'custo' ? 'sobre o custo' : 'sobre a venda'})`
  ];
  if (r.total_ignorados) partes.push(`· ${r.total_ignorados} sem alteração`);
  if (r.simulado && r.total_alterados) partes.push('— nada foi gravado ainda.');
  return partes.join(' ');
}

// `selecionavel` liga a coluna de marcacao: na simulacao o operador escolhe
// linha a linha o que vai ser gravado; depois de aplicado a tabela vira so o
// comprovante do que foi feito.
function previaReajusteHtml(r, selecionavel) {
  if (!r.total_alterados) {
    return `<p class="vazio-previa">Nenhum produto entra neste reajuste.${r.total_ignorados
      ? ` ${r.total_ignorados} produto(s) ficaram de fora — veja os motivos: ${
        [...new Set(r.ignorados.map(i => i.motivo))].map(escapeHtml).join(' ')}`
      : ''}</p>`;
  }
  const linhas = r.itens.map(it => `
    <tr class="${it.abaixo_do_custo ? 'alerta-custo' : ''}">
      ${selecionavel ? `<td class="col-marcar"><input type="checkbox" class="marcar-previa" data-id="${it.id}" checked></td>` : ''}
      <td>${escapeHtml(it.nome)}<br><small>${escapeHtml(it.categoria_nome)}</small></td>
      <td>${it.custo > 0 ? formatarMoeda(it.custo) : '—'}</td>
      <td class="antes">${it.preco_anterior > 0 ? formatarMoeda(it.preco_anterior) : '—'}</td>
      <td class="depois">${formatarMoeda(it.preco_novo)}
        <small class="${it.diferenca >= 0 ? 'sobe' : 'desce'}">${it.diferenca >= 0 ? '+' : ''}${formatarMoeda(it.diferenca)}</small>
        ${it.abaixo_do_custo ? '<small class="desce">abaixo do custo</small>' : ''}</td>
      <td>${it.promocional_anterior ? formatarMoeda(it.promocional_anterior) : '—'}</td>
      <td>${it.promocao_removida
        ? '<span class="chip cancelado">oferta desfeita</span>'
        : (it.promocional_novo ? formatarMoeda(it.promocional_novo) : '—')}</td>
    </tr>`).join('');

  const abaixoDoCusto = r.itens.filter(it => it.abaixo_do_custo).length;

  return `
    ${abaixoDoCusto ? `<p class="alerta-previa">⚠️ ${abaixoDoCusto} produto(s) ficariam com o preço abaixo do custo (linhas em vermelho).</p>` : ''}
    ${selecionavel ? `
      <div class="previa-topo">
        <span id="rea-contagem"></span>
        <div class="previa-acoes">
          <button type="button" class="btn pequeno secundario" id="rea-marcar-todos">Marcar todos</button>
          <button type="button" class="btn pequeno secundario" id="rea-desmarcar-todos">Desmarcar todos</button>
        </div>
      </div>` : ''}
    <div class="previa-rolagem">
      <table class="tabela-previa">
        <thead><tr>
          ${selecionavel ? '<th class="col-marcar"><input type="checkbox" id="rea-previa-todos" checked title="Marcar/desmarcar todos"></th>' : ''}
          <th>Produto</th><th>Custo</th><th>Preço atual</th><th>${r.simulado ? 'Novo preço' : 'Preço aplicado'}</th><th>Oferta atual</th><th>Nova oferta</th>
        </tr></thead>
        <tbody>${linhas}</tbody>
      </table>
    </div>
    ${r.ignorados.length ? `<p class="ignorados-previa">Fora do reajuste: ${r.ignorados.map(i => escapeHtml(i.nome)).join(', ')}.</p>` : ''}
    ${selecionavel ? `
      <div class="previa-decisao">
        <button type="button" class="btn secundario" id="rea-voltar">← Voltar e alterar</button>
        <button type="button" class="btn" id="rea-confirmar">✔ Confirmar reajuste</button>
      </div>` : `
      <div class="previa-decisao">
        <button type="button" class="btn secundario" id="rea-fechar-previa">Fechar comprovante</button>
      </div>`}
  `;
}

function idsMarcadosNaPrevia() {
  return [...document.querySelectorAll('.marcar-previa')].filter(c => c.checked).map(c => Number(c.dataset.id));
}

// Etapa de conferencia: a marcacao decide o que sera' gravado, e os dois unicos
// caminhos daqui sao confirmar ou voltar para os parametros.
function ligarAcoesPrevia() {
  const fechar = document.getElementById('rea-fechar-previa');
  if (fechar) {
    fechar.addEventListener('click', () => voltarParaParametrosReajuste());
    return;
  }

  const caixas = [...document.querySelectorAll('.marcar-previa')];
  if (!caixas.length) return;
  const cabecalho = document.getElementById('rea-previa-todos');
  const contagem = document.getElementById('rea-contagem');
  const botaoConfirmar = document.getElementById('rea-confirmar');
  const passo = document.getElementById('rea-passo');

  const atualizar = () => {
    const marcadas = caixas.filter(c => c.checked).length;
    contagem.textContent = `${marcadas} de ${caixas.length} produto(s) selecionado(s) para gravar`;
    if (cabecalho) {
      cabecalho.checked = marcadas === caixas.length;
      cabecalho.indeterminate = marcadas > 0 && marcadas < caixas.length;
    }
    botaoConfirmar.disabled = marcadas === 0;
    botaoConfirmar.textContent = marcadas
      ? `✔ Confirmar reajuste de ${marcadas} produto(s)`
      : '✔ Confirmar reajuste';
    passo.textContent = marcadas
      ? 'Confira os valores. "Confirmar" grava só os produtos marcados; "Voltar e alterar" devolve os campos sem gravar nada.'
      : 'Marque pelo menos um produto da prévia — ou use "Voltar e alterar" para refazer a simulação.';
  };

  const definirTodas = (valor) => { caixas.forEach(c => { c.checked = valor; }); atualizar(); };

  caixas.forEach(c => c.addEventListener('change', atualizar));
  if (cabecalho) cabecalho.addEventListener('change', () => definirTodas(cabecalho.checked));
  document.getElementById('rea-marcar-todos').addEventListener('click', () => definirTodas(true));
  document.getElementById('rea-desmarcar-todos').addEventListener('click', () => definirTodas(false));
  document.getElementById('rea-voltar').addEventListener('click', () => voltarParaParametrosReajuste());
  botaoConfirmar.addEventListener('click', confirmarReajuste);
  atualizar();
}

// ==================== CLIENTES ====================
async function secaoClientes() {
  const clientes = await Api.get('/api/gestao/clientes');
  document.getElementById('conteudo-secao').innerHTML = `
    <div class="tabela-wrap"><table>
      <thead><tr><th>#</th><th>Nome</th><th>E-mail</th><th>Telefone</th><th>Pedidos</th><th>Total gasto</th><th>Última compra</th></tr></thead>
      <tbody>${clientes.map(c => `
        <tr>
          <td>${c.id}</td>
          <td>${escapeHtml(c.nome)}</td>
          <td>${escapeHtml(c.email || '-')}</td>
          <td>${escapeHtml(c.telefone || '-')}</td>
          <td>${c.total_pedidos}</td>
          <td>${formatarMoeda(c.total_gasto)}</td>
          <td>${escapeHtml(c.ultima_compra || '-')}</td>
        </tr>
      `).join('') || '<tr><td colspan="7">Nenhum cliente cadastrado ainda.</td></tr>'}</tbody>
    </table></div>
  `;
}

// ==================== PESQUISA DE SATISFACAO ====================
function estrelas(nota) {
  if (!nota) return '-';
  return '★'.repeat(nota) + '☆'.repeat(5 - nota);
}

async function secaoCsat() {
  const { resumo, respostas } = await Api.get('/api/gestao/csat');
  document.getElementById('conteudo-secao').innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card"><div class="label">Avaliações</div><div class="valor">${resumo.total || 0}</div></div>
      <div class="kpi-card"><div class="label">Preços</div><div class="valor">${resumo.media_precos || '-'}</div></div>
      <div class="kpi-card"><div class="label">Site (usabilidade)</div><div class="valor">${resumo.media_site || '-'}</div></div>
      <div class="kpi-card"><div class="label">Experiência geral</div><div class="valor">${resumo.media_geral || '-'}</div></div>
      <div class="kpi-card"><div class="label">Primeira compra</div><div class="valor">${resumo.primeiras_compras || 0}</div></div>
      <div class="kpi-card"><div class="label">Recomendariam</div><div class="valor">${resumo.recomendariam || 0}</div></div>
    </div>
    <div class="tabela-wrap"><table>
      <thead><tr><th>Pedido</th><th>Cliente</th><th>Preços</th><th>Site</th><th>Geral</th><th>1ª compra</th><th>Recomenda</th><th>Comentário</th><th>Enviado em</th></tr></thead>
      <tbody>${respostas.map(r => `
        <tr>
          <td>${escapeHtml(r.pedido_codigo || r.pedido_id)}</td>
          <td>${escapeHtml(r.nome_cliente || '-')}</td>
          <td title="${r.nota_precos}">${estrelas(r.nota_precos)}</td>
          <td title="${r.nota_site}">${estrelas(r.nota_site)}</td>
          <td title="${r.nota_geral}">${estrelas(r.nota_geral)}</td>
          <td>${r.primeira_compra === 1 ? 'Sim' : r.primeira_compra === 0 ? 'Não' : '-'}</td>
          <td>${r.recomendaria === 1 ? 'Sim' : r.recomendaria === 0 ? 'Não' : '-'}</td>
          <td>${escapeHtml(r.comentario || '-')}</td>
          <td>${escapeHtml(r.criado_em)}</td>
        </tr>
      `).join('') || '<tr><td colspan="9">Nenhuma avaliação recebida ainda.</td></tr>'}</tbody>
    </table></div>
  `;
}

// ==================== PEDIDOS ====================
// CPF e enderecos (residencial + entrega) sao os dados que a loja precisa
// para emitir a nota fiscal — ver routes/pedidos.js. Cadastro de cupom agora
// e' so' no painel superadmin (routes/superadmin.js).
function formatarCpfExibicao(cpf) {
  const d = String(cpf || '').replace(/\D/g, '');
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : (cpf || '-');
}

function enderecoResidencialTexto(p) {
  if (!p.endereco_resid_logradouro) return '-';
  return `${p.endereco_resid_logradouro}, ${p.endereco_resid_numero}` +
    `${p.endereco_resid_complemento ? ' - ' + p.endereco_resid_complemento : ''} - ${p.endereco_resid_bairro} - ` +
    `${p.endereco_resid_cidade}/${p.endereco_resid_uf} - CEP ${p.endereco_resid_cep}`;
}

function enderecoEntregaTexto(p) {
  if (p.entrega_igual_residencial) return 'Igual ao residencial';
  return p.endereco_entrega || '-';
}

async function secaoPedidos() {
  const pedidos = await Api.get('/api/gestao/pedidos');
  const STATUS = {
    aguardando_pagamento: 'Aguardando pagamento',
    pago: 'Pago',
    enviado: 'Enviado',
    recebido: 'Recebido',
    finalizado: 'Finalizado',
    cancelado: 'Cancelado'
  };
  document.getElementById('conteudo-secao').innerHTML = `
    <div class="tabela-wrap"><table>
      <thead><tr><th>Código</th><th>Cliente</th><th>CPF</th><th>Telefone</th><th>Endereço residencial</th><th>Entrega</th><th>Total</th><th>Desconto</th><th>Cupom</th><th>Valor final</th><th>Pagamento</th><th>Status</th><th>Data</th></tr></thead>
      <tbody>${pedidos.map(p => `
        <tr>
          <td><strong>${escapeHtml(p.codigo || p.id)}</strong></td>
          <td>${escapeHtml(p.nome_cliente)}<br><span style="font-size:.78rem;color:var(--texto-suave);">${escapeHtml(p.email_cliente || '-')}</span></td>
          <td>${escapeHtml(formatarCpfExibicao(p.cpf_cliente))}</td>
          <td>${escapeHtml(p.telefone_cliente || '-')}</td>
          <td style="max-width:220px;">${escapeHtml(enderecoResidencialTexto(p))}</td>
          <td style="max-width:220px;">${escapeHtml(enderecoEntregaTexto(p))}</td>
          <td>${formatarMoeda(p.total)}</td>
          <td>${p.valor_desconto > 0 ? '− ' + formatarMoeda(p.valor_desconto) : '-'}</td>
          <td>${escapeHtml(p.cupom || '-')}</td>
          <td><strong>${formatarMoeda(p.valor_final)}</strong></td>
          <td>${escapeHtml(p.forma_pagamento || '-')}</td>
          <td><select data-pedido-status="${p.id}">${Object.entries(STATUS).map(([valor, rotulo]) => `<option value="${valor}" ${valor === p.status ? 'selected' : ''}>${rotulo}</option>`).join('')}</select></td>
          <td>${escapeHtml(p.criado_em)}</td>
        </tr>
      `).join('') || '<tr><td colspan="13">Nenhum pedido ainda.</td></tr>'}</tbody>
    </table></div>
  `;
  document.querySelectorAll('[data-pedido-status]').forEach(sel => sel.addEventListener('change', async () => {
    await Api.put(`/api/gestao/pedidos/${sel.dataset.pedidoStatus}/status`, { status: sel.value });
  }));
}

// ==================== AGENDAMENTOS ====================
async function secaoAgendamentos() {
  const agendamentos = await Api.get('/api/agendamentos');
  document.getElementById('conteudo-secao').innerHTML = agendamentos.map(a => `
    <div class="card">
      <div class="flex entre">
        <strong>${escapeHtml(a.servico_nome)}</strong>
        <span class="chip ${a.status}">${a.status}</span>
      </div>
      <p style="font-size:.85rem;">📅 ${formatarData(a.data_servico)} às ${a.horario} — 📍 ${escapeHtml(a.local)}</p>
      <p style="font-size:.85rem;">Responsável: ${escapeHtml(a.responsavel)} · Tel.: ${escapeHtml(a.telefone_contato)}</p>
      ${a.observacoes ? `<p style="font-size:.85rem;color:var(--texto-suave);">${escapeHtml(a.observacoes)}</p>` : ''}
      ${a.status === 'pendente' ? `
        <div class="flex mt-1">
          <button class="btn pequeno" data-deferir="${a.id}">Deferir</button>
          <button class="btn pequeno perigo" data-indeferir="${a.id}">Indeferir</button>
        </div>` : ''}
      ${a.status === 'aprovado' ? `<button class="btn pequeno mt-1" data-concluir="${a.id}">Marcar como concluído</button>` : ''}
    </div>
  `).join('') || '<p class="vazio">Nenhuma solicitação de agendamento.</p>';

  document.querySelectorAll('[data-deferir]').forEach(b => b.addEventListener('click', async () => { await Api.put(`/api/agendamentos/${b.dataset.deferir}/deferir`); secaoAgendamentos(); }));
  document.querySelectorAll('[data-indeferir]').forEach(b => b.addEventListener('click', async () => {
    const motivo = prompt('Motivo da recusa (opcional):') || '';
    await Api.put(`/api/agendamentos/${b.dataset.indeferir}/indeferir`, { motivo });
    secaoAgendamentos();
  }));
  document.querySelectorAll('[data-concluir]').forEach(b => b.addEventListener('click', async () => { await Api.put(`/api/agendamentos/${b.dataset.concluir}/concluir`); secaoAgendamentos(); }));
}

// ==================== ENCOMENDAS / AVISOS ====================
async function secaoEncomendas() {
  const encomendas = await Api.get('/api/gestao/encomendas');
  const STATUS = ['aguardando', 'avisado', 'atendido', 'cancelado'];
  document.getElementById('conteudo-secao').innerHTML = `
    <div class="tabela-wrap"><table>
      <thead><tr><th>Produto</th><th>Tipo</th><th>Cliente</th><th>Telefone</th><th>Tam./Cor</th><th>Status</th><th>Data</th></tr></thead>
      <tbody>${encomendas.map(e => `
        <tr>
          <td>${escapeHtml(e.produto_nome)}</td>
          <td>${e.tipo === 'encomenda' ? 'Encomenda' : 'Avisar estoque'}</td>
          <td>${escapeHtml(e.nome)}</td><td>${escapeHtml(e.telefone || '-')}</td>
          <td>${escapeHtml(e.tamanho || '-')} / ${escapeHtml(e.cor || '-')}</td>
          <td><select data-enc-status="${e.id}">${STATUS.map(s => `<option value="${s}" ${s === e.status ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
          <td>${escapeHtml(e.criado_em)}</td>
        </tr>
      `).join('') || '<tr><td colspan="7">Nada por aqui.</td></tr>'}</tbody>
    </table></div>
  `;
  document.querySelectorAll('[data-enc-status]').forEach(sel => sel.addEventListener('change', async () => {
    await Api.put(`/api/gestao/encomendas/${sel.dataset.encStatus}/status`, { status: sel.value });
  }));
}

if (typeof NAO_AUTOINICIAR === 'undefined') iniciarPainel();
