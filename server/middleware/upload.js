// Recebimento de fotos de produto. As imagens ficam em public/img/produtos e
// sao servidas como arquivo estatico — o banco guarda so o caminho publico.
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const PASTA_PRODUTOS = path.join(__dirname, '..', 'public', 'img', 'produtos');
const URL_BASE = '/img/produtos';
const TAMANHO_MAXIMO = 5 * 1024 * 1024; // 5 MB por foto

// Extensao a partir do mimetype: nao confiamos no nome do arquivo enviado.
const EXTENSAO_POR_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif'
};

fs.mkdirSync(PASTA_PRODUTOS, { recursive: true });

const armazenamento = multer.diskStorage({
  destination: (req, file, cb) => cb(null, PASTA_PRODUTOS),
  filename: (req, file, cb) => {
    // produtoId-timestamp-aleatorio.ext — nome previsivel e sem colisao.
    const id = String(req.params.id || 'novo').replace(/[^0-9a-z]/gi, '');
    const sufixo = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    cb(null, `${id}-${sufixo}${EXTENSAO_POR_MIME[file.mimetype]}`);
  }
});

const uploadImagemProduto = multer({
  storage: armazenamento,
  limits: { fileSize: TAMANHO_MAXIMO, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!EXTENSAO_POR_MIME[file.mimetype]) {
      return cb(new Error('Formato não aceito. Envie JPG, PNG, WEBP, GIF ou AVIF.'));
    }
    cb(null, true);
  }
}).single('imagem');

// Apaga um arquivo que nos pertence (só dentro de public/img/produtos).
// URLs externas cadastradas na mão passam batido, e é o que queremos.
function removerArquivoLocal(urlPublica) {
  if (!urlPublica || !urlPublica.startsWith(URL_BASE + '/')) return false;
  const nome = path.basename(urlPublica);
  const caminho = path.join(PASTA_PRODUTOS, nome);
  if (path.dirname(caminho) !== PASTA_PRODUTOS) return false; // barra ../ no nome
  try {
    fs.unlinkSync(caminho);
    return true;
  } catch (e) {
    return false; // arquivo já não existia: nada a fazer
  }
}

// Envolve o multer para devolver erro em JSON no formato do resto da API.
function receberImagemProduto(req, res, next) {
  uploadImagemProduto(req, res, (erro) => {
    if (!erro) return next();
    const mensagem = erro.code === 'LIMIT_FILE_SIZE'
      ? 'Imagem muito grande. O limite é 5 MB.'
      : erro.message || 'Não foi possível receber a imagem.';
    res.status(400).json({ erro: mensagem });
  });
}

// ---------- Logomarca do site (uma imagem só, trocada pelo superadmin) ----------
const PASTA_SITE = path.join(__dirname, '..', 'public', 'img', 'site');
const URL_BASE_SITE = '/img/site';
fs.mkdirSync(PASTA_SITE, { recursive: true });

const uploadImagemSite = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, PASTA_SITE),
    filename: (req, file, cb) => cb(null, `logo-${Date.now()}${EXTENSAO_POR_MIME[file.mimetype]}`)
  }),
  limits: { fileSize: TAMANHO_MAXIMO, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!EXTENSAO_POR_MIME[file.mimetype]) {
      return cb(new Error('Formato não aceito. Envie JPG, PNG, WEBP, GIF ou AVIF.'));
    }
    cb(null, true);
  }
}).single('imagem');

function receberImagemSite(req, res, next) {
  uploadImagemSite(req, res, (erro) => {
    if (!erro) return next();
    const mensagem = erro.code === 'LIMIT_FILE_SIZE'
      ? 'Imagem muito grande. O limite é 5 MB.'
      : erro.message || 'Não foi possível receber a imagem.';
    res.status(400).json({ erro: mensagem });
  });
}

// ---------- Nota fiscal (PDF anexado pelo admin após emitir no Sebrae) ----------
// Fica FORA de public/ de propósito: a nota tem CPF e endereço do cliente, e
// public/ é servido como arquivo estático sem autenticação nenhuma. O arquivo
// só é acessível pela rota autenticada GET /api/gestao/pedidos/:id/nota-fiscal
// (ver routes/gestao_pedidos.js) — nunca por URL direta e adivinhável.
const PASTA_NOTAS = path.join(__dirname, '..', 'uploads', 'notas');
const TAMANHO_MAXIMO_NOTA = 10 * 1024 * 1024; // 10 MB
fs.mkdirSync(PASTA_NOTAS, { recursive: true });

const uploadNotaFiscal = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, PASTA_NOTAS),
    filename: (req, file, cb) => {
      const pedidoId = String(req.params.id || 'pedido').replace(/[^0-9a-z]/gi, '');
      cb(null, `nota-${pedidoId}-${Date.now()}.pdf`);
    }
  }),
  limits: { fileSize: TAMANHO_MAXIMO_NOTA, files: 1 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') return cb(new Error('Formato não aceito. Envie um arquivo PDF.'));
    cb(null, true);
  }
}).single('nota');

function receberNotaFiscal(req, res, next) {
  uploadNotaFiscal(req, res, (erro) => {
    if (!erro) return next();
    const mensagem = erro.code === 'LIMIT_FILE_SIZE'
      ? 'Arquivo muito grande. O limite é 10 MB.'
      : erro.message || 'Não foi possível receber o arquivo.';
    res.status(400).json({ erro: mensagem });
  });
}

module.exports = {
  receberImagemProduto, removerArquivoLocal, URL_BASE, TAMANHO_MAXIMO,
  receberImagemSite, URL_BASE_SITE,
  receberNotaFiscal, PASTA_NOTAS
};
