SECOES.usuarios = secaoUsuarios;
SECOES.relatorios = secaoRelatorios;
SECOES.cupons = secaoCupons;
SECOES.site = secaoSite;

// Permissoes que podem ser concedidas — vem de server/permissoes.js.
let PERMISSOES_DISPONIVEIS = [];

// Checkboxes de permissao de um usuario ja existente. Salvam na hora.
function permissoesDoUsuarioHtml(usuario) {
  if (usuario.papel === 'superadmin') {
    return '<small style="color:var(--texto-suave);">Superadmin: todas as permissões, sempre.</small>';
  }
  return `<div class="grade-permissoes">
    ${PERMISSOES_DISPONIVEIS.map(p => `
      <label class="permissao-item" title="${escapeHtml(p.descricao)}">
        <input type="checkbox" data-perm-usuario="${usuario.id}" value="${escapeHtml(p.chave)}"
               ${usuario.permissoes && usuario.permissoes.includes(p.chave) ? 'checked' : ''}>
        <span>${escapeHtml(p.nome)}</span>
      </label>
    `).join('')}
  </div>`;
}

async function secaoUsuarios() {
  const [usuarios, permissoes] = await Promise.all([
    Api.get('/api/superadmin/usuarios'),
    Api.get('/api/superadmin/permissoes')
  ]);
  PERMISSOES_DISPONIVEIS = permissoes;

  document.getElementById('conteudo-secao').innerHTML = `
    <div class="card">
      <h3>Liberar novo usuário admin</h3>
      <div class="linha-dupla">
        <div><label>Nome</label><input id="u-nome"></div>
        <div><label>E-mail</label><input id="u-email" type="email"></div>
      </div>
      <div class="linha-dupla">
        <div><label>Telefone</label><input id="u-telefone"></div>
        <div><label>Senha provisória</label><input id="u-senha" type="text"></div>
      </div>

      <label>Permissões deste acesso</label>
      <div class="grade-permissoes">
        ${PERMISSOES_DISPONIVEIS.map(p => `
          <label class="permissao-item">
            <input type="checkbox" data-perm-nova value="${escapeHtml(p.chave)}">
            <span>${escapeHtml(p.nome)}</span>
            <small>${escapeHtml(p.descricao)}</small>
          </label>
        `).join('')}
      </div>

      <button class="btn mt-1" id="u-criar">Criar acesso admin</button>
      <p id="u-msg" class="msg" style="display:none;"></p>
    </div>

    <div class="tabela-wrap"><table>
      <thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Permissões</th><th>Status</th><th>Criado em</th><th></th></tr></thead>
      <tbody>${usuarios.map(u => `
        <tr>
          <td>${escapeHtml(u.nome)}</td><td>${escapeHtml(u.email)}</td><td>${u.papel}</td>
          <td>${permissoesDoUsuarioHtml(u)}</td>
          <td>${u.ativo ? '<span class="badge ok">Ativo</span>' : '<span class="badge indisponivel">Inativo</span>'}</td>
          <td>${escapeHtml(u.criado_em)}</td>
          <td>${u.papel !== 'superadmin' ? `<button class="btn pequeno secundario" style="border-color:var(--couro);color:var(--couro);" data-user-toggle="${u.id}" data-ativo="${u.ativo ? 1 : 0}">${u.ativo ? 'Desativar' : 'Ativar'}</button>` : '—'}</td>
        </tr>
      `).join('')}</tbody>
    </table></div>
    <p id="perm-msg" class="msg" style="display:none;"></p>
  `;

  document.getElementById('u-criar').addEventListener('click', async () => {
    const msg = document.getElementById('u-msg');
    try {
      await Api.post('/api/superadmin/usuarios', {
        nome: document.getElementById('u-nome').value,
        email: document.getElementById('u-email').value,
        telefone: document.getElementById('u-telefone').value,
        senha: document.getElementById('u-senha').value,
        permissoes: [...document.querySelectorAll('[data-perm-nova]:checked')].map(c => c.value)
      });
      msg.textContent = 'Usuário admin criado!'; msg.className = 'msg sucesso'; msg.style.display = 'block';
      secaoUsuarios();
    } catch (e) { msg.textContent = e.message; msg.className = 'msg erro'; msg.style.display = 'block'; }
  });

  // Cada clique manda o conjunto completo de permissoes daquele usuario.
  document.querySelectorAll('[data-perm-usuario]').forEach(caixa => caixa.addEventListener('change', async () => {
    const id = caixa.dataset.permUsuario;
    const msg = document.getElementById('perm-msg');
    const marcadas = [...document.querySelectorAll(`[data-perm-usuario="${id}"]:checked`)].map(c => c.value);
    try {
      await Api.put(`/api/superadmin/usuarios/${id}/permissoes`, { permissoes: marcadas });
      msg.textContent = `Permissões atualizadas (${marcadas.length ? marcadas.length + ' liberada[s]' : 'nenhuma liberada'}).`;
      msg.className = 'msg sucesso'; msg.style.display = 'block';
    } catch (e) {
      caixa.checked = !caixa.checked; // desfaz na tela se o servidor recusou
      msg.textContent = e.message; msg.className = 'msg erro'; msg.style.display = 'block';
    }
  }));

  document.querySelectorAll('[data-user-toggle]').forEach(b => b.addEventListener('click', async () => {
    await Api.put(`/api/superadmin/usuarios/${b.dataset.userToggle}/ativo`, { ativo: b.dataset.ativo === '0' });
    secaoUsuarios();
  }));
}

function barraHtml(rotulo, valor, maximo, sufixo, dourada) {
  const pct = maximo > 0 ? Math.max(3, Math.round((valor / maximo) * 100)) : 0;
  return `<div class="barra-linha">
    <span>${escapeHtml(rotulo)}</span>
    <div class="barra-fundo"><div class="barra-preenchida ${dourada ? 'dourada' : ''}" style="width:${pct}%"></div></div>
    <strong>${sufixo}</strong>
  </div>`;
}

async function secaoRelatorios() {
  const area = document.getElementById('conteudo-secao');
  area.innerHTML = '<p class="vazio">Carregando relatórios...</p>';

  const [resumo, abandonado, maisVendidos, maisRentaveis, funil] = await Promise.all([
    Api.get('/api/superadmin/relatorios/resumo'),
    Api.get('/api/superadmin/relatorios/carrinho-abandonado'),
    Api.get('/api/superadmin/relatorios/mais-vendidos'),
    Api.get('/api/superadmin/relatorios/mais-rentaveis'),
    Api.get('/api/superadmin/relatorios/funil-produtos')
  ]);

  const maxCarrinho = Math.max(1, ...abandonado.map(a => a.vezes_no_carrinho));
  const maxVendidos = Math.max(1, ...maisVendidos.map(a => a.unidades_vendidas));
  const maxLucro = Math.max(1, ...maisRentaveis.map(a => a.lucro_total));
  const maxViews = Math.max(1, ...funil.map(f => f.visualizacoes));

  area.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card"><div class="valor">${formatarMoeda(resumo.faturamento)}</div><div class="label">Faturamento (pedidos pagos+)</div></div>
      <div class="kpi-card"><div class="valor">${formatarMoeda(resumo.lucro_bruto)}</div><div class="label">Lucro bruto estimado</div></div>
      <div class="kpi-card"><div class="valor">${resumo.total_pedidos}</div><div class="label">Pedidos totais</div></div>
      <div class="kpi-card"><div class="valor">${resumo.total_produtos}</div><div class="label">Produtos ativos</div></div>
      <div class="kpi-card"><div class="valor">${resumo.carrinhos_abertos}</div><div class="label">Carrinhos em aberto</div></div>
      <div class="kpi-card"><div class="valor">${resumo.agendamentos_pendentes}</div><div class="label">Agendamentos pendentes</div></div>
      <div class="kpi-card"><div class="valor">${resumo.encomendas_abertas}</div><div class="label">Encomendas/avisos em aberto</div></div>
    </div>

    <div class="card">
      <h3>🛒 Produtos mais colocados no carrinho e não finalizados</h3>
      ${abandonado.length ? abandonado.map(a => barraHtml(a.nome, a.vezes_no_carrinho, maxCarrinho, `${a.vezes_no_carrinho}x`)).join('') : '<p class="vazio">Sem dados suficientes ainda.</p>'}
    </div>

    <div class="card">
      <h3>🏆 Produtos mais vendidos</h3>
      ${maisVendidos.length ? maisVendidos.map(a => barraHtml(a.nome, a.unidades_vendidas, maxVendidos, `${a.unidades_vendidas} un.`, true)).join('') : '<p class="vazio">Nenhuma venda concluída ainda.</p>'}
    </div>

    <div class="card">
      <h3>💰 Produtos mais rentáveis (lucro total)</h3>
      ${maisRentaveis.length ? maisRentaveis.map(a => barraHtml(a.nome, a.lucro_total, maxLucro, formatarMoeda(a.lucro_total))).join('') : '<p class="vazio">Nenhuma venda concluída ainda.</p>'}
    </div>

    <div class="card">
      <h3>📈 Funil por produto — visualizações → carrinho → venda</h3>
      <div class="tabela-wrap"><table>
        <thead><tr><th>Produto</th><th>Visualizações</th><th>Adições ao carrinho</th><th>Unidades vendidas</th></tr></thead>
        <tbody>${funil.map(f => `<tr><td>${escapeHtml(f.nome)}</td><td>${f.visualizacoes}</td><td>${f.adicoes_carrinho}</td><td>${f.unidades_vendidas}</td></tr>`).join('') || '<tr><td colspan="4">Sem dados.</td></tr>'}</tbody>
      </table></div>
    </div>
  `;
}

// ==================== CUPONS ====================
// Cadastro exclusivo do superadmin (routes/superadmin.js). Sem nenhum produto
// marcado, o cupom vale para o carrinho inteiro — é o que "aplicar a todos os
// produtos" (marcado por padrão) representa: não grava restrição nenhuma.
let PRODUTOS_CUPOM_CACHE = [];

function statusCupom(c) {
  const hoje = new Date().toISOString().slice(0, 10);
  if (!c.ativo) return '<span class="badge indisponivel">Inativo</span>';
  if (c.validade_inicio && hoje < c.validade_inicio) return '<span class="badge alerta">Agenda para o futuro</span>';
  if (c.validade && hoje > c.validade) return '<span class="badge indisponivel">Vencido</span>';
  if (c.limite_usos !== null && c.usos_atuais >= c.limite_usos) return '<span class="badge indisponivel">Esgotado</span>';
  return '<span class="badge ok">Ativo</span>';
}

function validadeCupomTexto(c) {
  if (!c.validade_inicio && !c.validade) return 'Sem prazo';
  if (c.validade_inicio && c.validade) return `${formatarData(c.validade_inicio)} até ${formatarData(c.validade)}`;
  if (c.validade_inicio) return `A partir de ${formatarData(c.validade_inicio)}`;
  return `Até ${formatarData(c.validade)}`;
}

function usosCupomTexto(c) {
  return c.limite_usos !== null ? `${c.usos_atuais} / ${c.limite_usos}` : `${c.usos_atuais} (sem limite)`;
}

function produtosCupomTexto(c) {
  if (!c.produtos.length) return 'Todos os produtos';
  if (c.produtos.length <= 3) return c.produtos.map(p => p.nome).join(', ');
  return `${c.produtos.length} produtos selecionados`;
}

function checkboxesProdutosHtml(produtosSelecionadosIds) {
  const porCategoria = new Map();
  PRODUTOS_CUPOM_CACHE.forEach(p => {
    if (!porCategoria.has(p.categoria_nome)) porCategoria.set(p.categoria_nome, []);
    porCategoria.get(p.categoria_nome).push(p);
  });
  return [...porCategoria.entries()].map(([categoria, produtos]) => `
    <strong style="display:block;margin:.4rem 0 .2rem;font-size:.85rem;">${escapeHtml(categoria)}</strong>
    <div class="grade-permissoes">
      ${produtos.map(p => `
        <label class="permissao-item">
          <input type="checkbox" data-cp-produto value="${p.id}" ${produtosSelecionadosIds.includes(p.id) ? 'checked' : ''}>
          <span>${escapeHtml(p.nome)}</span>
        </label>
      `).join('')}
    </div>
  `).join('');
}

function formularioCupomHtml(cupom) {
  const c = cupom || { codigo: '', tipo: 'percentual', valor: '', validade_inicio: '', validade: '', limite_usos: '', produtos: [] };
  const produtosIds = (c.produtos || []).map(p => p.id);
  const todosProdutos = produtosIds.length === 0;
  return `
    <input type="hidden" id="cp-id" value="${c.id || ''}">
    <div class="linha-dupla">
      <div><label>Código</label><input id="cp-codigo" placeholder="BEMVINDO10" value="${escapeHtml(c.codigo)}"></div>
      <div><label>Tipo</label>
        <select id="cp-tipo">
          <option value="percentual" ${c.tipo === 'percentual' ? 'selected' : ''}>Percentual (%)</option>
          <option value="valor" ${c.tipo === 'valor' ? 'selected' : ''}>Valor fixo (R$)</option>
        </select>
      </div>
    </div>
    <div class="linha-dupla">
      <div><label>Valor do desconto</label><input id="cp-valor" type="number" step="0.01" placeholder="10" value="${c.valor}"></div>
      <div><label>Limite de usos (opcional)</label><input id="cp-limite" type="number" step="1" min="1" placeholder="Ex.: 5 = só nos 5 primeiros pedidos" value="${c.limite_usos ?? ''}"></div>
    </div>
    <div class="linha-dupla">
      <div><label>Válido a partir de (opcional)</label><input id="cp-inicio" type="date" value="${c.validade_inicio || ''}"></div>
      <div><label>Válido até (opcional)</label><input id="cp-fim" type="date" value="${c.validade || ''}"></div>
    </div>

    <label style="margin-top:.6rem;"><input type="checkbox" id="cp-todos-produtos" ${todosProdutos ? 'checked' : ''}> Aplicar a todos os produtos</label>
    <div id="cp-lista-produtos" style="display:${todosProdutos ? 'none' : 'block'};max-height:220px;overflow:auto;border:1px solid var(--creme-escuro);border-radius:8px;padding:.5rem;margin-top:.3rem;">
      ${checkboxesProdutosHtml(produtosIds)}
    </div>

    <button class="btn mt-1" id="cp-salvar">${c.id ? 'Salvar alterações' : 'Criar cupom'}</button>
    ${c.id ? '<button class="btn pequeno secundario" id="cp-cancelar-edicao" style="margin-left:.5rem;">Cancelar edição</button>' : ''}
    <p id="cp-msg" class="msg" style="display:none;"></p>
  `;
}

async function secaoCupons(cupomEmEdicao) {
  const [cupons, produtos] = await Promise.all([
    Api.get('/api/superadmin/cupons'),
    PRODUTOS_CUPOM_CACHE.length ? Promise.resolve(PRODUTOS_CUPOM_CACHE) : Api.get('/api/gestao/produtos')
  ]);
  PRODUTOS_CUPOM_CACHE = produtos;

  document.getElementById('conteudo-secao').innerHTML = `
    <div class="card">
      <h3>${cupomEmEdicao ? 'Editar cupom' : 'Novo cupom'}</h3>
      ${formularioCupomHtml(cupomEmEdicao)}
    </div>
    <div class="tabela-wrap"><table>
      <thead><tr><th>Código</th><th>Desconto</th><th>Produtos</th><th>Validade</th><th>Usos</th><th>Status</th><th>Ações</th></tr></thead>
      <tbody>${cupons.map(c => `
        <tr>
          <td><strong>${escapeHtml(c.codigo)}</strong></td>
          <td>${c.tipo === 'percentual' ? c.valor + '%' : formatarMoeda(c.valor)}</td>
          <td>${escapeHtml(produtosCupomTexto(c))}</td>
          <td>${validadeCupomTexto(c)}</td>
          <td>${usosCupomTexto(c)}</td>
          <td>${statusCupom(c)}</td>
          <td>
            <button class="btn pequeno secundario" style="border-color:var(--couro);color:var(--couro);" data-cupom-editar="${c.id}">Editar</button>
            <button class="btn pequeno secundario" style="border-color:var(--couro);color:var(--couro);" data-cupom="${c.id}" data-ativo="${c.ativo ? 1 : 0}">${c.ativo ? 'Desativar' : 'Ativar'}</button>
          </td>
        </tr>
      `).join('') || '<tr><td colspan="7">Nenhum cupom criado.</td></tr>'}</tbody>
    </table></div>
  `;

  document.getElementById('cp-todos-produtos').addEventListener('change', (e) => {
    document.getElementById('cp-lista-produtos').style.display = e.target.checked ? 'none' : 'block';
  });

  document.getElementById('cp-salvar').addEventListener('click', async () => {
    const msg = document.getElementById('cp-msg');
    const id = document.getElementById('cp-id').value;
    const todosProdutos = document.getElementById('cp-todos-produtos').checked;
    const corpo = {
      codigo: document.getElementById('cp-codigo').value,
      tipo: document.getElementById('cp-tipo').value,
      valor: document.getElementById('cp-valor').value,
      validade_inicio: document.getElementById('cp-inicio').value,
      validade_fim: document.getElementById('cp-fim').value,
      limite_usos: document.getElementById('cp-limite').value,
      produtos_ids: todosProdutos ? [] : [...document.querySelectorAll('[data-cp-produto]:checked')].map(c => parseInt(c.value, 10))
    };
    try {
      if (id) await Api.put(`/api/superadmin/cupons/${id}`, corpo);
      else await Api.post('/api/superadmin/cupons', corpo);
      secaoCupons();
    } catch (e) { msg.textContent = e.message; msg.className = 'msg erro'; msg.style.display = 'block'; }
  });

  const btnCancelar = document.getElementById('cp-cancelar-edicao');
  if (btnCancelar) btnCancelar.addEventListener('click', () => secaoCupons());

  document.querySelectorAll('[data-cupom-editar]').forEach(b => b.addEventListener('click', () => {
    const cupom = cupons.find(c => c.id === parseInt(b.dataset.cupomEditar, 10));
    secaoCupons(cupom);
  }));

  document.querySelectorAll('[data-cupom]').forEach(b => b.addEventListener('click', async () => {
    await Api.put(`/api/superadmin/cupons/${b.dataset.cupom}/ativo`, { ativo: b.dataset.ativo === '0' });
    secaoCupons();
  }));
}

// ==================== SITE (contato, logo, avisos) ====================
function formularioAvisoHtml(aviso) {
  const a = aviso || { titulo: '', mensagem: '', data_inicio: '', data_fim: '' };
  return `
    <input type="hidden" id="av-id" value="${a.id || ''}">
    <label>Título</label><input id="av-titulo" placeholder="Loja fechada no feriado" value="${escapeHtml(a.titulo)}">
    <label>Mensagem (opcional)</label><input id="av-mensagem" value="${escapeHtml(a.mensagem || '')}">
    <div class="linha-dupla">
      <div><label>Exibir a partir de (opcional)</label><input id="av-inicio" type="date" value="${a.data_inicio || ''}"></div>
      <div><label>Exibir até (opcional)</label><input id="av-fim" type="date" value="${a.data_fim || ''}"></div>
    </div>
    <button class="btn mt-1" id="av-salvar">${a.id ? 'Salvar alterações' : 'Criar aviso'}</button>
    ${a.id ? '<button class="btn pequeno secundario" id="av-cancelar-edicao" style="margin-left:.5rem;">Cancelar edição</button>' : ''}
    <p id="av-msg" class="msg" style="display:none;"></p>
  `;
}

function statusAviso(a) {
  const hoje = new Date().toISOString().slice(0, 10);
  if (!a.ativo) return '<span class="badge indisponivel">Inativo</span>';
  if (a.data_inicio && hoje < a.data_inicio) return '<span class="badge alerta">Agendado</span>';
  if (a.data_fim && hoje > a.data_fim) return '<span class="badge indisponivel">Encerrado</span>';
  return '<span class="badge ok">Exibindo agora</span>';
}

function periodoAvisoTexto(a) {
  if (!a.data_inicio && !a.data_fim) return 'Sem prazo';
  if (a.data_inicio && a.data_fim) return `${formatarData(a.data_inicio)} até ${formatarData(a.data_fim)}`;
  if (a.data_inicio) return `A partir de ${formatarData(a.data_inicio)}`;
  return `Até ${formatarData(a.data_fim)}`;
}

async function secaoSite(avisoEmEdicao) {
  const [loja, avisos] = await Promise.all([
    Api.get('/api/superadmin/site'),
    Api.get('/api/superadmin/avisos')
  ]);

  document.getElementById('conteudo-secao').innerHTML = `
    <div class="card">
      <h3>Contato e redes sociais</h3>
      <div class="linha-dupla">
        <div><label>Telefone</label><input id="st-telefone" placeholder="(54) 99931-5550" value="${escapeHtml(loja.telefone || '')}"></div>
        <div><label>WhatsApp</label><input id="st-whatsapp" placeholder="(54) 99931-5550" value="${escapeHtml(loja.whatsappLabel || '')}"></div>
      </div>
      <div class="linha-dupla">
        <div><label>Instagram</label><input id="st-instagram" placeholder="@estanciasalvarte" value="${escapeHtml(loja.instagramLabel || '')}"></div>
        <div><label>E-mail</label><input id="st-email" type="email" value="${escapeHtml(loja.email || '')}"></div>
      </div>
      <button class="btn mt-1" id="st-salvar">Salvar contato</button>
      <p id="st-msg" class="msg" style="display:none;"></p>
    </div>

    <div class="card">
      <h3>Logomarca</h3>
      <div class="flex" style="align-items:center;gap:1rem;">
        <img src="${loja.logo || ''}" alt="Logomarca atual" style="height:60px;width:auto;border-radius:6px;box-shadow:0 1px 4px rgba(0,0,0,.28);">
        <div>
          <input type="file" id="st-logo-arquivo" accept="image/png,image/jpeg,image/webp,image/gif,image/avif">
          <button class="btn pequeno mt-1" id="st-logo-enviar">Trocar logomarca</button>
        </div>
      </div>
      <p id="st-logo-msg" class="msg" style="display:none;"></p>
    </div>

    <div class="card">
      <h3>${avisoEmEdicao ? 'Editar aviso' : 'Novo aviso'}</h3>
      ${formularioAvisoHtml(avisoEmEdicao)}
    </div>
    <div class="tabela-wrap"><table>
      <thead><tr><th>Título</th><th>Mensagem</th><th>Período</th><th>Status</th><th>Ações</th></tr></thead>
      <tbody>${avisos.map(a => `
        <tr>
          <td><strong>${escapeHtml(a.titulo)}</strong></td>
          <td>${escapeHtml(a.mensagem || '-')}</td>
          <td>${periodoAvisoTexto(a)}</td>
          <td>${statusAviso(a)}</td>
          <td>
            <button class="btn pequeno secundario" style="border-color:var(--couro);color:var(--couro);" data-aviso-editar="${a.id}">Editar</button>
            <button class="btn pequeno secundario" style="border-color:var(--couro);color:var(--couro);" data-aviso-toggle="${a.id}" data-ativo="${a.ativo ? 1 : 0}">${a.ativo ? 'Desativar' : 'Ativar'}</button>
            <button class="btn pequeno secundario" style="border-color:var(--vermelho);color:var(--vermelho);" data-aviso-excluir="${a.id}">Excluir</button>
          </td>
        </tr>
      `).join('') || '<tr><td colspan="5">Nenhum aviso cadastrado.</td></tr>'}</tbody>
    </table></div>
  `;

  // ---- Contato ----
  document.getElementById('st-salvar').addEventListener('click', async () => {
    const msg = document.getElementById('st-msg');
    try {
      await Api.put('/api/superadmin/site', {
        telefone: document.getElementById('st-telefone').value,
        whatsapp: document.getElementById('st-whatsapp').value,
        instagram: document.getElementById('st-instagram').value,
        email: document.getElementById('st-email').value
      });
      msg.textContent = 'Contato atualizado!'; msg.className = 'msg sucesso'; msg.style.display = 'block';
    } catch (e) { msg.textContent = e.message; msg.className = 'msg erro'; msg.style.display = 'block'; }
  });

  // ---- Logomarca ----
  document.getElementById('st-logo-enviar').addEventListener('click', async () => {
    const msg = document.getElementById('st-logo-msg');
    msg.style.display = 'block';
    const arquivo = document.getElementById('st-logo-arquivo').files[0];
    if (!arquivo) { msg.textContent = 'Escolha um arquivo de imagem primeiro.'; msg.className = 'msg erro'; return; }
    const formData = new FormData();
    formData.append('imagem', arquivo);
    try {
      await Api.upload('/api/superadmin/site/logo', formData);
      msg.textContent = 'Logomarca atualizada!'; msg.className = 'msg sucesso';
      secaoSite();
    } catch (e) { msg.textContent = e.message; msg.className = 'msg erro'; }
  });

  // ---- Avisos ----
  document.getElementById('av-salvar').addEventListener('click', async () => {
    const msg = document.getElementById('av-msg');
    const id = document.getElementById('av-id').value;
    const corpo = {
      titulo: document.getElementById('av-titulo').value,
      mensagem: document.getElementById('av-mensagem').value,
      data_inicio: document.getElementById('av-inicio').value,
      data_fim: document.getElementById('av-fim').value
    };
    try {
      if (id) await Api.put(`/api/superadmin/avisos/${id}`, corpo);
      else await Api.post('/api/superadmin/avisos', corpo);
      secaoSite();
    } catch (e) { msg.textContent = e.message; msg.className = 'msg erro'; msg.style.display = 'block'; }
  });

  const btnCancelar = document.getElementById('av-cancelar-edicao');
  if (btnCancelar) btnCancelar.addEventListener('click', () => secaoSite());

  document.querySelectorAll('[data-aviso-editar]').forEach(b => b.addEventListener('click', () => {
    const aviso = avisos.find(a => a.id === parseInt(b.dataset.avisoEditar, 10));
    secaoSite(aviso);
  }));

  document.querySelectorAll('[data-aviso-toggle]').forEach(b => b.addEventListener('click', async () => {
    await Api.put(`/api/superadmin/avisos/${b.dataset.avisoToggle}/ativo`, { ativo: b.dataset.ativo === '0' });
    secaoSite();
  }));

  document.querySelectorAll('[data-aviso-excluir]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Excluir este aviso? Não é possível desfazer.')) return;
    await Api.del(`/api/superadmin/avisos/${b.dataset.avisoExcluir}`);
    secaoSite();
  }));
}

iniciarPainel();
