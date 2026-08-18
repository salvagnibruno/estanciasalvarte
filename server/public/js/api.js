// Mensagem para resposta de erro SEM corpo JSON — ou seja, quando nenhuma rota
// tratou a chamada. Num 404 de /api/ isso quase sempre significa que o processo
// do Node esta' rodando o codigo anterior: a rota so passa a existir depois de
// reiniciar o servidor. Dizer isso evita o "ocorreu um erro" que nao ajuda em nada.
function mensagemSemCorpo(status, url) {
  if (status === 404 && String(url).startsWith('/api/')) {
    return 'Esta função ainda não existe no servidor que está rodando. '
      + 'Reinicie o servidor da loja (npm start, na pasta server) e tente de novo.';
  }
  if (status === 401) return 'Sua sessão expirou. Entre novamente.';
  return 'Ocorreu um erro. Tente novamente.';
}

// Wrapper simples para chamadas a API (usa cookies de sessao automaticamente)
async function api(metodo, url, corpo) {
  const resposta = await fetch(url, {
    method: metodo,
    headers: corpo ? { 'Content-Type': 'application/json' } : undefined,
    credentials: 'same-origin',
    body: corpo ? JSON.stringify(corpo) : undefined
  });
  let dados = null;
  try { dados = await resposta.json(); } catch (e) { /* sem corpo */ }
  if (!resposta.ok) {
    const erro = new Error((dados && dados.erro) || mensagemSemCorpo(resposta.status, url));
    erro.status = resposta.status;
    erro.dados = dados;
    throw erro;
  }
  return dados;
}

// Envio de arquivo (multipart). Sem Content-Type manual: o navegador precisa
// montar o boundary sozinho, senao o servidor nao consegue ler o formulario.
async function apiUpload(url, formData) {
  const resposta = await fetch(url, { method: 'POST', credentials: 'same-origin', body: formData });
  let dados = null;
  try { dados = await resposta.json(); } catch (e) { /* sem corpo */ }
  if (!resposta.ok) {
    const erro = new Error((dados && dados.erro)
      || (resposta.status === 404 ? mensagemSemCorpo(404, url) : 'Não foi possível enviar o arquivo.'));
    erro.status = resposta.status;
    throw erro;
  }
  return dados;
}

const Api = {
  get: (url) => api('GET', url),
  post: (url, corpo) => api('POST', url, corpo || {}),
  put: (url, corpo) => api('PUT', url, corpo || {}),
  del: (url) => api('DELETE', url),
  upload: (url, formData) => apiUpload(url, formData)
};

function formatarMoeda(valor) {
  return (valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarData(iso) {
  if (!iso) return '';
  const partes = iso.split('-');
  if (partes.length === 3) return `${partes[2]}/${partes[1]}/${partes[0]}`;
  return iso;
}

function escapeHtml(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
