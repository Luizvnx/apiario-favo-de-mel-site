/**
 * Apiário Favo de Mel - Servidor de Desenvolvimento Local & API Administrativa
 * Suporte a .env, Gestão de Catálogo, PostgreSQL & Fallback Local Resiliente
 * Tabelas: tb_bot_config, tb_categorias, tb_produtos, tb_pedidos
 * Segurança: Rota Secreta (/admin/favodemel), Rate Limit Anti-Brute Force, E-mail + Senha
 */

require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const db = require('./db');
const whatsappService = require('./services/whatsappNotificationService');

const BASE_DIR = __dirname;
const DATA_DIR = path.join(BASE_DIR, 'data');
const PRODUCTS_ASSETS_DIR = path.join(BASE_DIR, 'assets', 'products');
const IMAGES_ASSETS_DIR = path.join(BASE_DIR, 'assets', 'images');

// Cache em memória case-insensitive de arquivos em assets/products e assets/images (imune a case-sensitivity do Linux)
let assetsLookupMap = new Map();

function indexarArquivosAssets() {
    try {
        const newMap = new Map();
        [PRODUCTS_ASSETS_DIR, IMAGES_ASSETS_DIR].forEach(dir => {
            if (fs.existsSync(dir)) {
                const files = fs.readdirSync(dir);
                for (const f of files) {
                    const full = path.join(dir, f);
                    try {
                        if (fs.statSync(full).isFile()) {
                            // Prioridade para assets/products se o arquivo existir em ambos
                            if (!newMap.has(f.toLowerCase()) || dir === PRODUCTS_ASSETS_DIR) {
                                newMap.set(f.toLowerCase(), full);
                            }
                        }
                    } catch (_) {}
                }
            }
        });
        assetsLookupMap = newMap;
    } catch (err) {
        console.error('[Assets] Erro ao indexar arquivos estáticos:', err.message);
    }
}
indexarArquivosAssets();

function resolverArquivoAsset(safePath) {
    const baseFileName = path.basename(safePath);
    const lowerName = baseFileName.toLowerCase();

    // 1. Correspondência direta case-insensitive pelo nome do arquivo
    if (assetsLookupMap.has(lowerName)) {
        return assetsLookupMap.get(lowerName);
    }

    const ext = path.extname(baseFileName).toLowerCase();
    const semExt = baseFileName.slice(0, -ext.length).toLowerCase();

    // 2. Se requisitou .webp e não encontrou pelo nome exato, busca equivalentes .png, .jpeg ou .jpg
    if (ext === '.webp') {
        const altPng = `${semExt}.png`;
        const altJpeg = `${semExt}.jpeg`;
        const altJpg = `${semExt}.jpg`;
        if (assetsLookupMap.has(altPng)) return assetsLookupMap.get(altPng);
        if (assetsLookupMap.has(altJpeg)) return assetsLookupMap.get(altJpeg);
        if (assetsLookupMap.has(altJpg)) return assetsLookupMap.get(altJpg);
    }

    // 3. Se requisitou .png, .jpg ou .jpeg, busca se existe versão .webp
    if (['.png', '.jpg', '.jpeg'].includes(ext)) {
        const altWebp = `${semExt}.webp`;
        if (assetsLookupMap.has(altWebp)) return assetsLookupMap.get(altWebp);
    }

    // 4. Se a rota pertence a /assets/ ou a extensões de imagem, previne 404 entregando Mel-in-natura-500g.webp
    if (safePath.includes('/assets/') || ['.webp', '.png', '.jpg', '.jpeg'].includes(ext)) {
        const fallbackGuaranteed = assetsLookupMap.get('mel-in-natura-500g.webp') || path.join(PRODUCTS_ASSETS_DIR, 'Mel-in-natura-500g.webp');
        if (fs.existsSync(fallbackGuaranteed)) {
            return fallbackGuaranteed;
        }
    }

    return null;
}

// Inicializa o adaptador do Banco de Dados PostgreSQL
db.init();

let PORT = parseInt(process.env.PORT, 10) || 3300;
const API_URL = process.env.API_URL || 'http://localhost:8080';

// =========================================================================
// RATE LIMITER ANTI-BRUTE FORCE PARA LOGIN ADMINISTRATIVO
// =========================================================================
const loginAttempts = new Map(); // ip -> { count: number, blockedUntil: number }
const MAX_FAILED_ATTEMPTS = 5;
const BLOCK_DURATION_MS = 15 * 60 * 1000; // Bloqueio temporário de 15 minutos

function getClientIp(req) {
    const xForwardedFor = req.headers['x-forwarded-for'];
    if (xForwardedFor) {
        return xForwardedFor.split(',')[0].trim();
    }
    return req.socket.remoteAddress || '127.0.0.1';
}

function checkRateLimit(ip) {
    const now = Date.now();
    const record = loginAttempts.get(ip);
    if (!record) return { allowed: true, remaining: MAX_FAILED_ATTEMPTS };

    if (record.blockedUntil && record.blockedUntil > now) {
        const minutesLeft = Math.ceil((record.blockedUntil - now) / 60000);
        return { allowed: false, blockedUntil: record.blockedUntil, minutesLeft };
    }

    if (record.blockedUntil && record.blockedUntil <= now) {
        loginAttempts.delete(ip);
        return { allowed: true, remaining: MAX_FAILED_ATTEMPTS };
    }

    const remaining = Math.max(0, MAX_FAILED_ATTEMPTS - record.count);
    return { allowed: true, remaining };
}

function recordFailedAttempt(ip) {
    const now = Date.now();
    let record = loginAttempts.get(ip);
    if (!record) {
        record = { count: 0, blockedUntil: 0 };
    }
    record.count += 1;
    if (record.count >= MAX_FAILED_ATTEMPTS) {
        record.blockedUntil = now + BLOCK_DURATION_MS;
        console.warn(`[Segurança] IP ${ip} bloqueado por ${BLOCK_DURATION_MS / 60000} minutos após ${record.count} tentativas incorretas.`);
    }
    loginAttempts.set(ip, record);
    return record;
}

function resetLoginAttempts(ip) {
    loginAttempts.delete(ip);
}

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8'
};

function sendJson(res, statusCode, data) {
    res.writeHead(statusCode, { 
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Robots-Tag': 'noindex, nofollow'
    });
    res.end(JSON.stringify(data));
}

function getPublicBaseUrl(req) {
    if (req.headers.origin && !req.headers.origin.includes('localhost') && !req.headers.origin.includes('127.0.0.1')) {
        return req.headers.origin.replace(/^http:\/\//i, 'https://');
    }
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    if (host && !host.includes('localhost') && !host.includes('127.0.0.1')) {
        return `https://${host}`;
    }
    return req.headers.origin || (req.headers.host ? `http://${req.headers.host}` : 'http://localhost:3300');
}

function getCacheControl(ext, safePath) {
    if (safePath.startsWith('/api/') || safePath.startsWith('/admin')) {
        return 'no-store, no-cache, must-revalidate';
    }
    if (['.webp', '.png', '.jpg', '.jpeg', '.svg', '.gif', '.ico', '.woff', '.woff2', '.ttf'].includes(ext)) {
        return 'public, max-age=31536000, immutable';
    }
    if (['.css', '.js'].includes(ext)) {
        return 'public, max-age=86400, stale-while-revalidate=604800';
    }
    if (['.xml', '.txt'].includes(ext)) {
        return 'public, max-age=86400, stale-while-revalidate=604800';
    }
    if (['.html'].includes(ext) || safePath === '/' || safePath === '/catalogo') {
        return 'public, max-age=3600, must-revalidate';
    }
    return 'public, max-age=3600';
}

function normalizarCaminhoFoto(foto) {
    if (!foto) return '';
    foto = String(foto).trim();
    if (foto.startsWith('http://') || foto.startsWith('https://')) return foto;
    if (foto.startsWith('/assets/')) return foto;
    if (foto.startsWith('assets/')) return `/${foto}`;
    return `/assets/products/${foto}`;
}

function atualizarHtmlLandingPage(arquivoHtml, novosDados) {
    const filePath = path.join(BASE_DIR, arquivoHtml);
    if (!fs.existsSync(filePath)) {
        console.warn(`[LandingPages] Arquivo HTML não encontrado para atualização: ${arquivoHtml}`);
        return false;
    }

    try {
        let content = fs.readFileSync(filePath, 'utf8');

        // 1. Atualiza Foto Principal do Hero se fornecida
        let fotoPrincipal = '';
        if (novosDados.foto_principal && String(novosDados.foto_principal).trim() !== '') {
            fotoPrincipal = normalizarCaminhoFoto(novosDados.foto_principal);
            content = content.replace(/(<img\s+id=["']mainProductImg["'][^>]*\ssrc=["'])[^"']+(["'])/i, `$1${fotoPrincipal}$2`);
        }

        // 2. Atualiza Miniaturas da Galeria (suporta remoção: omite thumbs vazios)
        const thumbs = [];
        const f1 = novosDados.foto_thumb1 !== undefined ? novosDados.foto_thumb1 : novosDados.foto_principal;
        const f2 = novosDados.foto_thumb2;
        const f3 = novosDados.foto_thumb3;

        if (f1 && String(f1).trim() !== '') {
            thumbs.push({ src: normalizarCaminhoFoto(f1), label: 'Visualização 1' });
        } else if (fotoPrincipal) {
            thumbs.push({ src: fotoPrincipal, label: 'Visualização 1' });
        }

        if (f2 && String(f2).trim() !== '') {
            thumbs.push({ src: normalizarCaminhoFoto(f2), label: 'Visualização 2' });
        }

        if (f3 && String(f3).trim() !== '') {
            thumbs.push({ src: normalizarCaminhoFoto(f3), label: 'Visualização 3' });
        }

        const thumbsRegex = /<div class="product-thumbs">[\s\S]*?<\/div>(?=\s*<\/div>\s*(?:<!--[\s\S]*?-->\s*)?<div class="product-info-box">)/i;
        if (thumbsRegex.test(content)) {
            let thumbsItemsHtml = '';
            if (thumbs.length > 0) {
                thumbsItemsHtml = thumbs.map((t, idx) => `
                        <div class="product-thumb-item ${idx === 0 ? 'active' : ''}" onclick="changeThumb('${t.src}', this)">
                            <img src="${t.src}" alt="${t.label}">
                        </div>`).join('');
            }
            const newThumbsHtml = `<div class="product-thumbs">${thumbsItemsHtml}
                    </div>`;
            content = content.replace(thumbsRegex, newThumbsHtml);
        }

        // 3. Atualiza Schema.org JSON-LD image se existir
        if (fotoPrincipal) {
            const thumbRef = thumbs.length > 1 ? thumbs[1].src : fotoPrincipal;
            const schemaImgRegex = /"image":\s*\[\s*"[^"]*",\s*"[^"]*"\s*\]/i;
            if (schemaImgRegex.test(content)) {
                content = content.replace(schemaImgRegex, `"image": [\n            "${fotoPrincipal}",\n            "${thumbRef}"\n          ]`);
            }
        }

        // 4. Atualiza Preço Visual, Link WhatsApp e Schema.org se preço for fornecido
        if (novosDados.preco !== undefined && novosDados.preco !== null && !isNaN(parseFloat(novosDados.preco))) {
            const precoNum = parseFloat(novosDados.preco);
            const precoFormatado = precoNum.toFixed(2).replace('.', ',');
            const precoSchema = precoNum.toFixed(2);

            // A) Tag visual de preço no hero: <span class="price-val">65,00</span>
            content = content.replace(/(<span\s+class=["']price-val["'][^>]*>)[^<]+(<\/span>)/gi, `$1${precoFormatado}$2`);

            // B) Schema.org JSON-LD "price": "65.00"
            content = content.replace(/("price":\s*")[\d.,]+(")/gi, `$1${precoSchema}$2`);

            // C) Link WhatsApp codificado: text=...R%24%2065%2C00... ou R$ 65,00
            content = content.replace(/(text=[^"']*?R%24%20)(?:\d+(?:%2C\d+)?|\d+(?:\.\d+)?)/gi, `$1${encodeURIComponent(precoFormatado)}`);
            content = content.replace(/(text=[^"']*?R\$\s*)(?:\d+(?:,\d+)?|\d+(?:\.\d+)?)/gi, `$1${precoFormatado}`);
        }

        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`[LandingPages] ✓ HTML ${arquivoHtml} atualizado com sucesso!`);
        return true;
    } catch (err) {
        console.error(`[LandingPages] Erro ao atualizar HTML ${arquivoHtml}:`, err.message);
        return false;
    }
}

function sincronizarTodasLandingPages() {
    try {
        const landingPagesPath = path.join(DATA_DIR, 'landing_pages.json');
        const produtosPath = path.join(DATA_DIR, 'produtos.json');
        if (!fs.existsSync(landingPagesPath) || !fs.existsSync(produtosPath)) return;

        const paginas = JSON.parse(fs.readFileSync(landingPagesPath, 'utf8'));
        const produtos = JSON.parse(fs.readFileSync(produtosPath, 'utf8'));

        for (const pag of paginas) {
            if (!pag.arquivo_html) continue;
            let prod = null;
            if (pag.produto_id) {
                prod = produtos.find(p => String(p.id) === String(pag.produto_id));
            }
            if (!prod) {
                prod = produtos.find(p => (p.nome || '').toLowerCase().includes((pag.slug || '').replace(/-/g, ' ')));
            }

            if (prod && prod.preco) {
                atualizarHtmlLandingPage(pag.arquivo_html, {
                    ...pag,
                    preco: prod.preco
                });
            } else {
                atualizarHtmlLandingPage(pag.arquivo_html, pag);
            }
        }
        console.log('[LandingPages] ✓ Sincronização inicial de todas as landing pages concluída!');
    } catch (err) {
        console.error('[LandingPages] Erro ao sincronizar landing pages:', err.message);
    }
}

function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            if (!body) return resolve({});
            try {
                resolve(JSON.parse(body));
            } catch (err) {
                reject(err);
            }
        });
        req.on('error', reject);
    });
}

function render404(pathName) {
    return `
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>404 - Página Não Encontrada</title>
            <style>
                body { font-family: sans-serif; text-align: center; padding: 4rem 1rem; background: #FAF7F2; color: #2C231C; }
                h1 { color: #D97706; font-size: 3rem; margin-bottom: 0.5rem; }
                p { color: #6E6359; font-size: 1.1rem; }
                a { display: inline-block; margin-top: 1.5rem; padding: 0.75rem 1.5rem; background: #D97706; color: #fff; text-decoration: none; border-radius: 8px; font-weight: bold; }
            </style>
        </head>
        <body>
            <h1>404</h1>
            <p>O arquivo ou página <strong>${pathName}</strong> não foi encontrado.</p>
            <a href="/">Voltar ao Início</a>
        </body>
        </html>
    `;
}

// =========================================================================
// SERVIDOR HTTP
// =========================================================================
const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        return res.end();
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    let safePath = decodeURIComponent(parsedUrl.pathname);

    // Aliases e normalização de caminhos estáticos quando acessado via sub-rotas (/admin/... ou /favodemel/...)
    if (/^\/(admin|favodemel)\/(css|js|assets|data)\//.test(safePath)) {
        safePath = safePath.replace(/^\/(admin|favodemel)/, '');
    }

    // Endpoint dinâmico de configuração para frontend
    if (safePath === '/config.js') {
        res.writeHead(200, { 
            'Content-Type': 'text/javascript; charset=utf-8',
            'Cache-Control': 'public, max-age=86400'
        });
        return res.end(`window.FAVODEMEL_API_URL = "";\nconsole.log("[Config] Modo Integrado Ativo - API Favo de Mel");`);
    }

    const serveFile = (targetFile) => {
        let finalPath = targetFile;
        let ext = path.extname(finalPath).toLowerCase();

        // Negociação transparente para WebP se o cliente suporta e o arquivo WebP existe
        if (['.png', '.jpg', '.jpeg'].includes(ext)) {
            const acceptHeader = req.headers['accept'] || '';
            const webpCandidate = `${finalPath.slice(0, -ext.length)}.webp`;
            if (acceptHeader.includes('image/webp') && fs.existsSync(webpCandidate)) {
                finalPath = webpCandidate;
                ext = '.webp';
            }
        }

        fs.stat(finalPath, (err, stats) => {
            if (err || !stats.isFile()) {
                res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
                return res.end(render404(safePath));
            }

            const contentType = MIME_TYPES[ext] || 'application/octet-stream';
            const etag = `W/"${stats.size.toString(16)}-${stats.mtime.getTime().toString(16)}"`;
            const cacheControl = getCacheControl(ext, safePath);

            // Resposta 304 (Not Modified) para requisições em cache válido
            if (req.headers['if-none-match'] === etag) {
                res.writeHead(304, {
                    'ETag': etag,
                    'Cache-Control': cacheControl
                });
                return res.end();
            }

            const headers = {
                'Content-Type': contentType,
                'ETag': etag,
                'Cache-Control': cacheControl,
                'Vary': 'Accept-Encoding, Accept'
            };

            if (safePath.includes('admin') || safePath.includes('pedido') || safePath.startsWith('/data')) {
                headers['X-Robots-Tag'] = 'noindex, nofollow';
            }

            const acceptEncoding = req.headers['accept-encoding'] || '';
            const isCompressible = /^(text\/|application\/javascript|application\/json|application\/xml|image\/svg\+xml)/.test(contentType);

            if (isCompressible && acceptEncoding.includes('gzip')) {
                headers['Content-Encoding'] = 'gzip';
                res.writeHead(200, headers);
                fs.createReadStream(finalPath).pipe(zlib.createGzip()).pipe(res);
            } else if (isCompressible && acceptEncoding.includes('deflate')) {
                headers['Content-Encoding'] = 'deflate';
                res.writeHead(200, headers);
                fs.createReadStream(finalPath).pipe(zlib.createDeflate()).pipe(res);
            } else {
                headers['Content-Length'] = stats.size;
                res.writeHead(200, headers);
                fs.createReadStream(finalPath).pipe(res);
            }
        });
    };

    // ROTA DO PAINEL ADMINISTRATIVO (Suporta /admin.html, /admin e a rota segura /admin/favodemel)
    const isAdminRoute = safePath === '/admin' || 
                         safePath === '/admin/' || 
                         safePath === '/admin.html' || 
                         safePath === '/admin/favodemel' || 
                         safePath === '/admin/favodemel/' || 
                         safePath === '/favodemel/admin' || 
                         safePath === '/favodemel/admin/';

    if (isAdminRoute) {
        return serveFile(path.join(BASE_DIR, 'admin.html'));
    }

    // =========================================================================
    // ROTAS DE API
    // =========================================================================

    // 0. Status do Banco de Dados
    if (safePath === '/api/admin/status-banco' && req.method === 'GET') {
        return sendJson(res, 200, {
            sucesso: true,
            status: db.getStatus()
        });
    }

    // 1. Configurações da Loja e PIX (tb_bot_config)
    if (safePath === '/api/catalogo/config' || safePath === '/api/admin/config') {
        if (req.method === 'GET') {
            try {
                const { dados, fonte } = await db.obterConfigLoja();
                const safeConfig = { ...dados };
                delete safeConfig.admin_senha;
                return sendJson(res, 200, { sucesso: true, config: safeConfig, fonte });
            } catch (err) {
                return sendJson(res, 500, { sucesso: false, erro: err.message });
            }
        }

        if (req.method === 'POST') {
            try {
                const body = await parseBody(req);
                const { dados, fonte } = await db.salvarConfigLoja(body);
                const safeConfig = { ...dados };
                delete safeConfig.admin_senha;
                return sendJson(res, 200, {
                    sucesso: true,
                    mensagem: 'Configurações atualizadas com sucesso',
                    config: safeConfig,
                    fonte
                });
            } catch (err) {
                return sendJson(res, 400, { sucesso: false, erro: 'Dados inválidos: ' + err.message });
            }
        }
    }

    // 2. Catálogo de Produtos e Categorias (tb_produtos e tb_categorias)
    if (safePath === '/api/catalogo/produtos') {
        if (req.method === 'GET') {
            try {
                const { produtos, fonte: fonteP } = await db.listarProdutos(true);
                const { categorias, fonte: fonteC } = await db.listarCategorias(true);
                return sendJson(res, 200, {
                    sucesso: true,
                    produtos,
                    categorias,
                    fonte: fonteP === 'postgresql' || fonteC === 'postgresql' ? 'postgresql' : 'local_json'
                });
            } catch (err) {
                return sendJson(res, 500, { sucesso: false, erro: err.message });
            }
        }
    }

    // 3. Gestão de Produtos (Admin)
    if (safePath.startsWith('/api/admin/produtos')) {
        const idMatch = safePath.match(/\/api\/admin\/produtos\/(\d+)/);
        const produtoId = idMatch ? parseInt(idMatch[1], 10) : null;

        if (req.method === 'GET') {
            try {
                const { produtos, fonte } = await db.listarProdutos(false);
                return sendJson(res, 200, { sucesso: true, produtos, fonte });
            } catch (err) {
                return sendJson(res, 500, { sucesso: false, erro: err.message });
            }
        }

        if (req.method === 'POST') {
            try {
                const body = await parseBody(req);
                const { produto, fonte } = await db.criarProduto(body);
                return sendJson(res, 201, { sucesso: true, produto, fonte });
            } catch (err) {
                return sendJson(res, 400, { sucesso: false, erro: 'Erro ao criar produto: ' + err.message });
            }
        }

        if (req.method === 'PUT' && produtoId) {
            try {
                const body = await parseBody(req);
                const { produto, fonte } = await db.atualizarProduto(produtoId, body);

                // Sincroniza automaticamente a landing page vinculada se o preço mudar
                try {
                    const landingPagesPath = path.join(DATA_DIR, 'landing_pages.json');
                    if (fs.existsSync(landingPagesPath)) {
                        const paginas = JSON.parse(fs.readFileSync(landingPagesPath, 'utf8'));
                        const paginaVinculada = paginas.find(p => String(p.produto_id) === String(produtoId));
                        if (paginaVinculada && paginaVinculada.arquivo_html) {
                            atualizarHtmlLandingPage(paginaVinculada.arquivo_html, {
                                ...paginaVinculada,
                                preco: produto.preco
                            });
                        }
                    }
                } catch (errSync) {
                    console.warn('[Sync Landing] Erro ao sincronizar landing page com produto:', errSync.message);
                }

                return sendJson(res, 200, { sucesso: true, produto, fonte });
            } catch (err) {
                return sendJson(res, 400, { sucesso: false, erro: 'Erro ao atualizar produto: ' + err.message });
            }
        }

        if (req.method === 'DELETE' && produtoId) {
            try {
                const { fonte } = await db.deletarProduto(produtoId);
                return sendJson(res, 200, { sucesso: true, mensagem: 'Produto excluído com sucesso', fonte });
            } catch (err) {
                return sendJson(res, 500, { sucesso: false, erro: err.message });
            }
        }
    }

    // 4. Gestão de Categorias (Admin)
    if (safePath.startsWith('/api/admin/categorias')) {
        const idMatch = safePath.match(/\/api\/admin\/categorias\/(\d+)/);
        const catId = idMatch ? idMatch[1] : null;

        if (req.method === 'GET') {
            try {
                const { categorias, fonte } = await db.listarCategorias(false);
                return sendJson(res, 200, { sucesso: true, categorias, fonte });
            } catch (err) {
                return sendJson(res, 500, { sucesso: false, erro: err.message });
            }
        }

        if (req.method === 'POST') {
            try {
                const body = await parseBody(req);
                const { categoria, categorias, fonte } = await db.salvarCategoria(body);
                return sendJson(res, 200, { sucesso: true, categoria, categorias, fonte });
            } catch (err) {
                return sendJson(res, 400, { sucesso: false, erro: err.message });
            }
        }

        if (req.method === 'DELETE' && catId) {
            try {
                const { categorias, fonte } = await db.deletarCategoria(catId);
                return sendJson(res, 200, { sucesso: true, categorias, fonte });
            } catch (err) {
                return sendJson(res, 500, { sucesso: false, erro: err.message });
            }
        }
    }

    // 5. Lista de Imagens Disponíveis no Diretório assets/products
    if (safePath === '/api/admin/imagens' && req.method === 'GET') {
        try {
            if (fs.existsSync(PRODUCTS_ASSETS_DIR)) {
                const files = fs.readdirSync(PRODUCTS_ASSETS_DIR)
                    .filter(f => /\.(png|jpe?g|webp|svg)$/i.test(f))
                    .sort();
                return sendJson(res, 200, { sucesso: true, imagens: files });
            }
            return sendJson(res, 200, { sucesso: true, imagens: [] });
        } catch (err) {
            return sendJson(res, 500, { sucesso: false, erro: 'Falha ao listar imagens: ' + err.message });
        }
    }

    // 5.1. Upload de Nova Foto de Produto / Landing Pages
    if (safePath === '/api/admin/upload-imagem' && req.method === 'POST') {
        try {
            const body = await parseBody(req);
            if (!body || !body.base64) {
                return sendJson(res, 400, { sucesso: false, erro: 'Nenhuma imagem enviada.' });
            }

            const rawName = body.nome || 'produto.jpg';
            const ext = path.extname(rawName).toLowerCase() || '.jpg';
            const allowedExts = ['.png', '.jpg', '.jpeg', '.webp', '.svg'];
            if (!allowedExts.includes(ext)) {
                return sendJson(res, 400, { sucesso: false, erro: 'Formato inválido. Use WebP, PNG, JPG ou SVG.' });
            }

            const base64Data = body.base64;
            const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
            const base64Content = matches ? matches[2] : base64Data;
            const buffer = Buffer.from(base64Content, 'base64');

            if (buffer.length > 15 * 1024 * 1024) {
                return sendJson(res, 400, { sucesso: false, erro: 'A imagem deve ter no máximo 15MB.' });
            }

            let baseName = path.basename(rawName, ext)
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-zA-Z0-9_-]/g, '-')
                .replace(/-+/g, '-')
                .replace(/^-|-$/g, '');
            if (!baseName) baseName = 'produto';

            if (!fs.existsSync(PRODUCTS_ASSETS_DIR)) {
                fs.mkdirSync(PRODUCTS_ASSETS_DIR, { recursive: true });
            }

            const fileName = `${baseName}-${Date.now()}${ext}`;
            const targetPath = path.join(PRODUCTS_ASSETS_DIR, fileName);
            fs.writeFileSync(targetPath, buffer);

            // Reindexar mapa em memória
            indexarArquivosAssets();

            console.log(`[Upload] ✓ Nova foto salva com sucesso: ${fileName} (${(buffer.length / 1024).toFixed(1)} KB)`);

            return sendJson(res, 200, {
                sucesso: true,
                arquivo: fileName,
                caminho: `/assets/products/${fileName}`,
                mensagem: 'Foto enviada e salva com sucesso!'
            });
        } catch (err) {
            console.error('[Upload] Erro ao processar upload de imagem:', err.message);
            return sendJson(res, 500, { sucesso: false, erro: 'Falha ao processar upload: ' + err.message });
        }
    }

    // 5.2. Excluir Foto do Acervo (assets/products)
    if ((safePath.startsWith('/api/admin/imagens/') && req.method === 'DELETE') || 
        (safePath === '/api/admin/deletar-imagem' && req.method === 'POST')) {
        try {
            let nomeArquivo = '';
            if (req.method === 'DELETE') {
                nomeArquivo = decodeURIComponent(safePath.replace('/api/admin/imagens/', '')).trim();
            } else {
                const body = await parseBody(req);
                nomeArquivo = (body.nome || body.arquivo || '').trim();
            }

            if (!nomeArquivo) {
                return sendJson(res, 400, { sucesso: false, erro: 'Nome de arquivo não especificado.' });
            }

            const baseName = path.basename(nomeArquivo);
            const targetPath = path.join(PRODUCTS_ASSETS_DIR, baseName);

            if (!fs.existsSync(targetPath)) {
                return sendJson(res, 404, { sucesso: false, erro: 'Arquivo não encontrado no acervo.' });
            }

            fs.unlinkSync(targetPath);
            indexarArquivosAssets();

            console.log(`[Imagens] ✓ Foto excluída com sucesso: ${baseName}`);

            return sendJson(res, 200, {
                sucesso: true,
                mensagem: `Foto "${baseName}" excluída do acervo com sucesso.`
            });
        } catch (err) {
            console.error('[Imagens] Erro ao excluir imagem:', err.message);
            return sendJson(res, 500, { sucesso: false, erro: 'Falha ao excluir imagem: ' + err.message });
        }
    }

    // 5.3. Gestão das Fotos das Landing Pages dos Produtos
    if (safePath === '/api/admin/landing-pages' && req.method === 'GET') {
        try {
            const { paginas, fonte } = await db.listarLandingPages();
            return sendJson(res, 200, { sucesso: true, paginas, fonte });
        } catch (err) {
            return sendJson(res, 500, { sucesso: false, erro: err.message });
        }
    }

    if (safePath.startsWith('/api/admin/landing-pages/')) {
        const slug = safePath.replace('/api/admin/landing-pages/', '').trim();

        if (req.method === 'GET' && slug) {
            try {
                const pagina = await db.obterLandingPage(slug);
                if (!pagina) {
                    return sendJson(res, 404, { sucesso: false, erro: 'Página não encontrada' });
                }
                return sendJson(res, 200, { sucesso: true, pagina });
            } catch (err) {
                return sendJson(res, 500, { sucesso: false, erro: err.message });
            }
        }

        if (req.method === 'POST' && slug) {
            try {
                const body = await parseBody(req);
                const { pagina, fonte } = await db.salvarLandingPage(slug, body);
                if (pagina && pagina.arquivo_html) {
                    atualizarHtmlLandingPage(pagina.arquivo_html, pagina);
                }
                return sendJson(res, 200, { 
                    sucesso: true, 
                    mensagem: 'Fotos da página atualizadas com sucesso!',
                    pagina, 
                    fonte 
                });
            } catch (err) {
                return sendJson(res, 400, { sucesso: false, erro: err.message });
            }
        }
    }

    // 6. Registro e Consulta de Pedidos
    if (safePath === '/api/catalogo/pedidos' && req.method === 'POST') {
        try {
            const body = await parseBody(req);
            const { dados: config } = await db.obterConfigLoja();

            const codigoPedido = `FD-${Date.now().toString().slice(-4)}${Math.floor(10 + Math.random() * 90)}`;
            const tokenAcesso = crypto.randomBytes(16).toString('hex');

            const novoPedido = {
                codigo_pedido: codigoPedido,
                token_acesso: tokenAcesso,
                cliente_nome: body.cliente_nome || 'Cliente',
                cliente_telefone: body.cliente_telefone || '',
                tipo_entrega: body.tipo_entrega || 'entrega',
                endereco: body.endereco || {},
                forma_pagamento: body.forma_pagamento || 'pix',
                troco_para: body.troco_para || '',
                observacoes: body.observacoes || '',
                itens: body.itens || [],
                subtotal: parseFloat(body.subtotal) || 0,
                taxa_entrega: parseFloat(body.taxa_entrega) || 0,
                total: parseFloat(body.total) || 0,
                status: 'novo',
                criado_em: new Date().toISOString()
            };

            const { pedido: pedidoSalvo, fonte } = await db.salvarPedido(novoPedido);

            // Monta mensagem WhatsApp
            const linhasItens = novoPedido.itens.map(i => {
                const sub = ((i.quantidade || 1) * parseFloat(i.preco || 0)).toFixed(2).replace('.', ',');
                const obsTxt = i.obs ? ` _(Obs: ${i.obs})_` : '';
                return `• ${i.quantidade}x *${i.nome}*${obsTxt} = R$ ${sub}`;
            }).join('\n');

            const end = novoPedido.endereco || {};
            const cepStr = end.cep ? ` (CEP: ${end.cep})` : '';
            const compStr = end.complemento ? ` [${end.complemento}]` : '';
            let txtEnd = novoPedido.tipo_entrega === 'entrega'
                ? `*Endereço:* ${end.rua || ''}, ${end.numero || ''} - ${end.bairro || ''}, ${end.cidade || ''}${compStr}${cepStr}`
                : `*Modalidade:* Retirada no Apiário`;

            let txtPag = novoPedido.forma_pagamento === 'pix' ? `PIX (Chave: ${config.pix_chave || '79988125726'})` : (novoPedido.forma_pagamento === 'cartao' ? 'Cartão' : `Dinheiro (Troco: ${novoPedido.troco_para || 'Não'})`);

            const msgWa = `*NOVO PEDIDO DO SITE - APIÁRIO FAVO DE MEL*\n*Pedido:* #${codigoPedido}\n*Cliente:* ${novoPedido.cliente_nome}\n*WhatsApp:* ${novoPedido.cliente_telefone}\n\n${txtEnd}\n*Pagamento:* ${txtPag}\n\n*Itens:*\n${linhasItens}\n\n*TOTAL:* R$ ${novoPedido.total.toFixed(2).replace('.', ',')}`;

            const numeroVendedor = (config.whatsapp || '557988125726').replace(/\D/g, '');
            const waUrl = `https://wa.me/${numeroVendedor}?text=${encodeURIComponent(msgWa)}`;

            // Disparo assíncrono das notificações via Evolution API (Estilo Trem Delivery)
            const originUrl = getPublicBaseUrl(req);
            whatsappService.notifyStoreNewOrder(novoPedido, originUrl).catch(err => {
                console.error('[WhatsApp Loja] Erro assíncrono ao notificar vendedor:', err.message);
            });
            whatsappService.notifyCustomerNewOrder(novoPedido, originUrl).catch(err => {
                console.error('[WhatsApp Cliente] Erro assíncrono ao notificar cliente:', err.message);
            });

            return sendJson(res, 201, {
                sucesso: true,
                codigo_pedido: codigoPedido,
                token_acesso: tokenAcesso,
                whatsapp_url: waUrl,
                pedido: pedidoSalvo,
                fonte
            });
        } catch (err) {
            return sendJson(res, 400, { sucesso: false, erro: 'Erro ao processar pedido: ' + err.message });
        }
    }

    // Consulta de Pedido para a página pedido.html (Suporta /api/pedido/:id e /api/catalogo/pedidos/:id)
    const isPedidoQuery = safePath.startsWith('/api/pedido/') || safePath.startsWith('/api/catalogo/pedidos/');
    if (isPedidoQuery && req.method === 'GET') {
        try {
            const queryId = safePath.replace('/api/pedido/', '').replace('/api/catalogo/pedidos/', '').trim();
            const pedido = await db.obterPedidoPorCodigo(queryId);
            if (pedido) {
                return sendJson(res, 200, { sucesso: true, pedido });
            }
            return sendJson(res, 404, { sucesso: false, erro: 'Pedido não localizado' });
        } catch (err) {
            return sendJson(res, 500, { sucesso: false, erro: err.message });
        }
    }

    // Gestão de Pedidos (Admin)
    if (safePath.startsWith('/api/admin/pedidos')) {
        const idMatch = safePath.match(/\/api\/admin\/pedidos\/(.+)/);
        const pedidoCodigo = idMatch ? idMatch[1] : null;

        if (req.method === 'GET') {
            try {
                const { pedidos, fonte } = await db.listarPedidos();
                return sendJson(res, 200, { sucesso: true, pedidos, fonte });
            } catch (err) {
                return sendJson(res, 500, { sucesso: false, erro: err.message });
            }
        }

        if (req.method === 'PATCH' && pedidoCodigo) {
            try {
                const body = await parseBody(req);
                const { status, fonte } = await db.atualizarStatusPedido(pedidoCodigo, body.status);
                
                // Dispara notificação de mudança de status para o cliente via WhatsApp (Estilo Trem Delivery)
                const pedidoCompleto = await db.obterPedidoPorCodigo(pedidoCodigo);
                if (pedidoCompleto) {
                    const originUrl = getPublicBaseUrl(req);
                    whatsappService.notifyCustomerStatusUpdate(pedidoCompleto, body.status, originUrl).catch(err => {
                        console.error('[WhatsApp Status] Erro assíncrono ao notificar cliente:', err.message);
                    });
                }

                return sendJson(res, 200, { sucesso: true, codigo: pedidoCodigo, status, fonte });
            } catch (err) {
                return sendJson(res, 400, { sucesso: false, erro: err.message });
            }
        }
    }

    // 7. Autenticação Administrativa com Rate Limit Anti-Brute Force e E-mail + Senha
    if (safePath === '/api/admin/login' && req.method === 'POST') {
        const clientIp = getClientIp(req);
        const rateCheck = checkRateLimit(clientIp);

        if (!rateCheck.allowed) {
            return sendJson(res, 429, {
                sucesso: false,
                erro: `Muitas tentativas incorretas. Acesso bloqueado temporariamente por ${rateCheck.minutesLeft} minuto(s).`
            });
        }

        try {
            const body = await parseBody(req);
            const { credenciais } = await db.obterCredenciaisAdmin();

            const inputEmail = (body.email || '').trim().toLowerCase();
            const inputSenha = (body.senha || '').trim();

            const emailCorreto = (credenciais.email || 'admin@admin.com').trim().toLowerCase();
            const senhaCorreta = credenciais.senha || 'admin';

            // Permite o e-mail cadastrado ou 'admin'/'admin@favodemel.com' no caso de credenciais default
            const emailValido = inputEmail === emailCorreto || 
                                (emailCorreto === 'admin@admin.com' && (inputEmail === 'admin' || inputEmail === 'admin@favodemel.com'));
            const senhaValida = inputSenha === senhaCorreta;

            if (emailValido && senhaValida) {
                resetLoginAttempts(clientIp);
                const token = 'adm_' + Date.now() + '_' + crypto.randomBytes(12).toString('hex');
                return sendJson(res, 200, {
                    sucesso: true,
                    token,
                    email: emailCorreto,
                    nome: 'Administrador Favo de Mel'
                });
            } else {
                const record = recordFailedAttempt(clientIp);
                const remaining = Math.max(0, MAX_FAILED_ATTEMPTS - record.count);

                if (record.blockedUntil > 0) {
                    return sendJson(res, 429, {
                        sucesso: false,
                        erro: 'Limite de 5 tentativas excedido! Acesso temporariamente bloqueado por 15 minutos.'
                    });
                }

                return sendJson(res, 401, {
                    sucesso: false,
                    erro: `E-mail ou senha incorretos. Tentativas restantes: ${remaining}.`
                });
            }
        } catch (err) {
            return sendJson(res, 400, { sucesso: false, erro: err.message });
        }
    }

    // 8. Consulta do E-mail Atual do Administrador (Não expõe a senha)
    if (safePath === '/api/admin/credenciais' && req.method === 'GET') {
        try {
            const { credenciais } = await db.obterCredenciaisAdmin();
            return sendJson(res, 200, {
                sucesso: true,
                email: credenciais.email || 'admin@admin.com'
            });
        } catch (err) {
            return sendJson(res, 500, { sucesso: false, erro: err.message });
        }
    }

    // 9. Alteração de Credenciais (E-mail e Senha) com Duplo Check
    if (safePath === '/api/admin/alterar-credenciais' && req.method === 'POST') {
        try {
            const body = await parseBody(req);
            const { credenciais } = await db.obterCredenciaisAdmin();

            const senhaAtual = (body.senhaAtual || '').trim();
            const novoEmail = (body.novoEmail || '').trim().toLowerCase();
            const confirmacaoEmail = (body.confirmacaoEmail || '').trim().toLowerCase();
            const novaSenha = (body.novaSenha || '').trim();
            const confirmacaoSenha = (body.confirmacaoSenha || '').trim();

            // Validação de segurança: a senha atual precisa estar correta
            if (senhaAtual !== credenciais.senha) {
                return sendJson(res, 401, {
                    sucesso: false,
                    erro: 'A senha atual informada está incorreta. Digite sua senha atual para autorizar a troca.'
                });
            }

            // Duplo check de e-mail
            if (!novoEmail || !novoEmail.includes('@') || novoEmail.length < 5) {
                return sendJson(res, 400, {
                    sucesso: false,
                    erro: 'Por favor, informe um endereço de e-mail válido.'
                });
            }
            if (novoEmail !== confirmacaoEmail) {
                return sendJson(res, 400, {
                    sucesso: false,
                    erro: 'Os e-mails informados não coincidem. Verifique a confirmação de e-mail.'
                });
            }

            // Duplo check de confirmação de senha
            if (!novaSenha || novaSenha.length < 4) {
                return sendJson(res, 400, {
                    sucesso: false,
                    erro: 'A nova senha deve ter no mínimo 4 caracteres.'
                });
            }
            if (novaSenha !== confirmacaoSenha) {
                return sendJson(res, 400, {
                    sucesso: false,
                    erro: 'A confirmação de senha não confere com a nova senha digitada.'
                });
            }

            // Salva as novas credenciais diretamente no PostgreSQL (tb_bot_config) e no fallback local
            const { credenciais: salvas, fonte } = await db.salvarCredenciaisAdmin(novoEmail, novaSenha);

            return sendJson(res, 200, {
                sucesso: true,
                mensagem: 'E-mail e senha atualizados com sucesso no banco de dados!',
                email: salvas.email,
                fonte
            });
        } catch (err) {
            return sendJson(res, 400, { sucesso: false, erro: 'Erro ao alterar credenciais: ' + err.message });
        }
    }

    // =========================================================================
    // SERVIÇO DE ARQUIVOS ESTÁTICOS
    // =========================================================================
    if (safePath === '/') {
        safePath = '/index.html';
    }

    // Redirecionamento 301 Canônico de URLs com .html para URLs limpas (SEO & UX)
    if (safePath.endsWith('.html') && safePath !== '/index.html') {
        const cleanPath = safePath.replace(/\.html$/, '');
        const queryStr = parsedUrl.search || '';
        res.writeHead(301, {
            'Location': cleanPath + queryStr,
            'Cache-Control': 'public, max-age=3600'
        });
        return res.end();
    }

    let filePath = path.join(BASE_DIR, safePath);

    if (!filePath.startsWith(BASE_DIR)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('403 - Acesso Negado');
    }

    fs.stat(filePath, (err, stats) => {
        if (!err && stats.isFile()) {
            return serveFile(filePath);
        }

        if (!err && stats.isDirectory()) {
            const indexPath = path.join(filePath, 'index.html');
            if (fs.existsSync(indexPath)) {
                return serveFile(indexPath);
            }
        }

        const htmlFallback = `${filePath}.html`;
        if (fs.existsSync(htmlFallback)) {
            return serveFile(htmlFallback);
        }

        // Resolução inteligente e case-insensitive para assets e fotos de produtos (resolve diferenças Linux/ext4)
        const resolvedAsset = resolverArquivoAsset(safePath);
        if (resolvedAsset && fs.existsSync(resolvedAsset)) {
            return serveFile(resolvedAsset);
        }

        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(render404(safePath));
    });
});

// Tratamento inteligente de portas
function iniciarServidor(porta) {
    server.listen(porta, '0.0.0.0', () => {
        console.log('\n======================================================');
        console.log('🐝 Apiário Favo de Mel - Servidor & Painel Administrativo');
        console.log(`Catálogo:       http://localhost:${porta}/catalogo.html`);
        console.log(`Site Oficial:   http://localhost:${porta}/`);
        console.log(`Painel Seguro:  http://localhost:${porta}/admin/favodemel`);
        console.log(`Banco:          PostgreSQL (${process.env.DB_NAME || 'evolution_db'}) c/ Fallback Resiliente`);
        console.log('======================================================\n');

        // Sincroniza todas as landing pages de produtos com o banco
        sincronizarTodasLandingPages();
    });
}

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.warn(`[Aviso] Porta ${PORT} já está em uso! Tentando porta alternativa ${PORT + 1}...`);
        PORT += 1;
        setTimeout(() => iniciarServidor(PORT), 200);
    } else {
        console.error('Erro no servidor:', err);
    }
});

if (require.main === module) {
    iniciarServidor(PORT);
}

module.exports = { server, iniciarServidor, sincronizarTodasLandingPages };
