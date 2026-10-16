/**
 * Apiário Favo de Mel - Servidor de Desenvolvimento Local & API Administrativa
 * Suporte a .env, Gestão de Catálogo, Configurações de PIX e Pedidos
 * Zero dependências externas (Usa apenas módulos nativos do Node.js)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE_DIR = __dirname;
const DATA_DIR = path.join(BASE_DIR, 'data');
const PRODUCTS_ASSETS_DIR = path.join(BASE_DIR, 'assets', 'products');

// Garante que o diretório data exista
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 1. Carrega variáveis de ambiente do arquivo .env automaticamente (se existir)
const envPath = path.join(BASE_DIR, '.env');
if (fs.existsSync(envPath)) {
    try {
        const envContent = fs.readFileSync(envPath, 'utf8');
        envContent.split(/\r?\n/).forEach(line => {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#')) {
                const idx = trimmed.indexOf('=');
                if (idx > 0) {
                    const key = trimmed.slice(0, idx).trim();
                    const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
                    if (!process.env[key]) {
                        process.env[key] = val;
                    }
                }
            }
        });
    } catch (e) {
        console.warn('Aviso: Falha ao ler .env:', e.message);
    }
}

let PORT = parseInt(process.env.PORT, 10) || 3300;
const API_URL = process.env.API_URL || 'http://localhost:8080';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';

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
    '.pdf': 'application/pdf'
};

// =========================================================================
// HELPERS DE ARMAZENAMENTO JSON
// =========================================================================
function readJson(filename, defaultValue) {
    const p = path.join(DATA_DIR, filename);
    if (!fs.existsSync(p)) return defaultValue;
    try {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (err) {
        console.error(`Erro ao ler JSON ${filename}:`, err);
        return defaultValue;
    }
}

function writeJson(filename, data) {
    const p = path.join(DATA_DIR, filename);
    try {
        fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (err) {
        console.error(`Erro ao salvar JSON ${filename}:`, err);
        return false;
    }
}

function sendJson(res, statusCode, data) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
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

// =========================================================================
// SERVIDOR HTTP
// =========================================================================
const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        return res.end();
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    let safePath = decodeURIComponent(parsedUrl.pathname);

    // Endpoint dinâmico de configuração para frontend
    if (safePath === '/config.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
        return res.end(`window.FAVODEMEL_API_URL = "";\nconsole.log("[Config] Modo Local Ativo - Servidor Favo de Mel Integrado");`);
    }

    // Atalho amigável para o painel administrativo
    if (safePath === '/admin' || safePath === '/admin/') {
        safePath = '/admin.html';
    }

    // =========================================================================
    // ROTAS DE API
    // =========================================================================

    // 1. Configurações da Loja e PIX
    if (safePath === '/api/catalogo/config' || safePath === '/api/admin/config') {
        if (req.method === 'GET') {
            const config = readJson('store_config.json', {
                nome_loja: 'Apiário Favo de Mel',
                whatsapp: '557988125726',
                status_loja: 'aberto',
                status_texto: 'Aberto para Pedidos',
                taxa_entrega_padrao: 0,
                mensagem_entrega: 'A combinar na confirmação',
                pix_chave: '79988125726',
                pix_tipo: 'telefone',
                pix_titular: 'Apiario Favo de Mel',
                pix_cidade: 'Aracaju'
            });
            // Oculta a senha em chamadas públicas
            const safeConfig = { ...config };
            delete safeConfig.admin_senha;
            return sendJson(res, 200, { sucesso: true, config: safeConfig });
        }

        if (req.method === 'POST') {
            try {
                const body = await parseBody(req);
                const current = readJson('store_config.json', {});
                const updated = {
                    ...current,
                    ...body
                };
                writeJson('store_config.json', updated);
                const safeConfig = { ...updated };
                delete safeConfig.admin_senha;
                return sendJson(res, 200, { sucesso: true, mensagem: 'Configurações atualizadas com sucesso', config: safeConfig });
            } catch (err) {
                return sendJson(res, 400, { sucesso: false, erro: 'Dados inválidos: ' + err.message });
            }
        }
    }

    // 2. Catálogo de Produtos e Categorias
    if (safePath === '/api/catalogo/produtos') {
        if (req.method === 'GET') {
            const produtos = readJson('produtos.json', []);
            const categorias = readJson('categorias.json', []);
            return sendJson(res, 200, { sucesso: true, produtos, categorias });
        }
    }

    // 3. Gestão de Produtos (Admin)
    if (safePath.startsWith('/api/admin/produtos')) {
        const idMatch = safePath.match(/\/api\/admin\/produtos\/(\d+)/);
        const produtoId = idMatch ? parseInt(idMatch[1], 10) : null;

        if (req.method === 'GET') {
            const produtos = readJson('produtos.json', []);
            return sendJson(res, 200, { sucesso: true, produtos });
        }

        if (req.method === 'POST') {
            try {
                const body = await parseBody(req);
                const produtos = readJson('produtos.json', []);
                const novoId = produtos.length > 0 ? Math.max(...produtos.map(p => p.id || 0)) + 1 : 1;
                const novoProduto = {
                    id: novoId,
                    categoria_id: parseInt(body.categoria_id, 10) || 1,
                    nome: body.nome || 'Novo Produto',
                    preco: parseFloat(body.preco) || 0,
                    peso: body.peso || '',
                    descricao: body.descricao || '',
                    estoque: parseInt(body.estoque, 10) || 0,
                    foto: body.foto || 'Mel-in-Natura-500g.png',
                    ativo: body.ativo !== false
                };
                produtos.unshift(novoProduto);
                writeJson('produtos.json', produtos);
                return sendJson(res, 201, { sucesso: true, produto: novoProduto });
            } catch (err) {
                return sendJson(res, 400, { sucesso: false, erro: 'Erro ao criar produto: ' + err.message });
            }
        }

        if (req.method === 'PUT' && produtoId) {
            try {
                const body = await parseBody(req);
                let produtos = readJson('produtos.json', []);
                const idx = produtos.findIndex(p => p.id === produtoId);
                if (idx === -1) {
                    return sendJson(res, 404, { sucesso: false, erro: 'Produto não encontrado' });
                }
                produtos[idx] = {
                    ...produtos[idx],
                    ...body,
                    id: produtoId,
                    preco: parseFloat(body.preco !== undefined ? body.preco : produtos[idx].preco),
                    categoria_id: parseInt(body.categoria_id !== undefined ? body.categoria_id : produtos[idx].categoria_id, 10),
                    estoque: parseInt(body.estoque !== undefined ? body.estoque : produtos[idx].estoque, 10)
                };
                writeJson('produtos.json', produtos);
                return sendJson(res, 200, { sucesso: true, produto: produtos[idx] });
            } catch (err) {
                return sendJson(res, 400, { sucesso: false, erro: 'Erro ao atualizar produto: ' + err.message });
            }
        }

        if (req.method === 'DELETE' && produtoId) {
            let produtos = readJson('produtos.json', []);
            const filtered = produtos.filter(p => p.id !== produtoId);
            writeJson('produtos.json', filtered);
            return sendJson(res, 200, { sucesso: true, mensagem: 'Produto excluído com sucesso' });
        }
    }

    // 4. Gestão de Categorias (Admin)
    if (safePath.startsWith('/api/admin/categorias')) {
        const idMatch = safePath.match(/\/api\/admin\/categorias\/(\d+)/);
        const catId = idMatch ? idMatch[1] : null;

        if (req.method === 'GET') {
            const categorias = readJson('categorias.json', []);
            return sendJson(res, 200, { sucesso: true, categorias });
        }

        if (req.method === 'POST') {
            try {
                const body = await parseBody(req);
                let categorias = readJson('categorias.json', []);
                if (body.id) {
                    // Atualiza
                    const idx = categorias.findIndex(c => String(c.id) === String(body.id));
                    if (idx !== -1) {
                        categorias[idx] = { ...categorias[idx], ...body };
                    }
                } else {
                    // Cria
                    const novoId = String(categorias.length > 0 ? Math.max(...categorias.map(c => parseInt(c.id, 10) || 0)) + 1 : 1);
                    categorias.push({
                        id: novoId,
                        nome: body.nome || 'Nova Categoria',
                        icone: body.icone || 'droplet'
                    });
                }
                writeJson('categorias.json', categorias);
                return sendJson(res, 200, { sucesso: true, categorias });
            } catch (err) {
                return sendJson(res, 400, { sucesso: false, erro: err.message });
            }
        }

        if (req.method === 'DELETE' && catId) {
            let categorias = readJson('categorias.json', []);
            const filtered = categorias.filter(c => String(c.id) !== String(catId));
            writeJson('categorias.json', filtered);
            return sendJson(res, 200, { sucesso: true, categorias: filtered });
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

    // 6. Registro e Consulta de Pedidos
    if (safePath === '/api/catalogo/pedidos' && req.method === 'POST') {
        try {
            const body = await parseBody(req);
            const pedidos = readJson('pedidos.json', []);
            const config = readJson('store_config.json', { whatsapp: '557988125726' });

            const codigoPedido = `FD-${Date.now().toString().slice(-4)}${Math.floor(10 + Math.random() * 90)}`;
            const tokenAcesso = Array.from(crypto.getRandomValues(new Uint8Array(16)))
                .map(b => b.toString(16).padStart(2, '0')).join('');

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

            pedidos.unshift(novoPedido);
            writeJson('pedidos.json', pedidos);

            // Monta mensagem WhatsApp
            const linhasItens = novoPedido.itens.map(i => {
                const sub = ((i.quantidade || 1) * parseFloat(i.preco || 0)).toFixed(2).replace('.', ',');
                return `• ${i.quantidade}x *${i.nome}* = R$ ${sub}`;
            }).join('\n');

            let txtEnd = novoPedido.tipo_entrega === 'entrega'
                ? `*Endereço:* ${novoPedido.endereco.rua || ''}, ${novoPedido.endereco.numero || ''} - ${novoPedido.endereco.bairro || ''}, ${novoPedido.endereco.cidade || ''}`
                : `*Modalidade:* Retirada no Apiário`;

            let txtPag = novoPedido.forma_pagamento === 'pix' ? `PIX (Chave: ${config.pix_chave || '79988125726'})` : (novoPedido.forma_pagamento === 'cartao' ? 'Cartão' : `Dinheiro (Troco: ${novoPedido.troco_para || 'Não'})`);

            const msgWa = `*NOVO PEDIDO DO SITE - APIÁRIO FAVO DE MEL*\n*Pedido:* #${codigoPedido}\n*Cliente:* ${novoPedido.cliente_nome}\n*WhatsApp:* ${novoPedido.cliente_telefone}\n\n${txtEnd}\n*Pagamento:* ${txtPag}\n\n*Itens:*\n${linhasItens}\n\n*TOTAL:* R$ ${novoPedido.total.toFixed(2).replace('.', ',')}`;

            const numeroVendedor = (config.whatsapp || '557988125726').replace(/\D/g, '');
            const waUrl = `https://wa.me/${numeroVendedor}?text=${encodeURIComponent(msgWa)}`;

            return sendJson(res, 201, {
                sucesso: true,
                codigo_pedido: codigoPedido,
                token_acesso: tokenAcesso,
                whatsapp_url: waUrl,
                pedido: novoPedido
            });
        } catch (err) {
            return sendJson(res, 400, { sucesso: false, erro: 'Erro ao processar pedido: ' + err.message });
        }
    }

    // Consulta de Pedido para a página pedido.html
    if (safePath.startsWith('/api/pedido/') && req.method === 'GET') {
        const queryId = safePath.replace('/api/pedido/', '').trim();
        const pedidos = readJson('pedidos.json', []);
        const pedido = pedidos.find(p => p.codigo_pedido === queryId || p.token_acesso === queryId);
        if (pedido) {
            return sendJson(res, 200, { sucesso: true, pedido });
        }
        return sendJson(res, 404, { sucesso: false, erro: 'Pedido não localizado' });
    }

    // Gestão de Pedidos (Admin)
    if (safePath.startsWith('/api/admin/pedidos')) {
        const idMatch = safePath.match(/\/api\/admin\/pedidos\/(.+)/);
        const pedidoCodigo = idMatch ? idMatch[1] : null;

        if (req.method === 'GET') {
            const pedidos = readJson('pedidos.json', []);
            return sendJson(res, 200, { sucesso: true, pedidos });
        }

        if (req.method === 'PATCH' && pedidoCodigo) {
            try {
                const body = await parseBody(req);
                let pedidos = readJson('pedidos.json', []);
                const idx = pedidos.findIndex(p => p.codigo_pedido === pedidoCodigo);
                if (idx === -1) {
                    return sendJson(res, 404, { sucesso: false, erro: 'Pedido não encontrado' });
                }
                pedidos[idx] = {
                    ...pedidos[idx],
                    status: body.status || pedidos[idx].status,
                    atualizado_em: new Date().toISOString()
                };
                writeJson('pedidos.json', pedidos);
                return sendJson(res, 200, { sucesso: true, pedido: pedidos[idx] });
            } catch (err) {
                return sendJson(res, 400, { sucesso: false, erro: err.message });
            }
        }
    }

    // 7. Autenticação Administrativa
    if (safePath === '/api/admin/login' && req.method === 'POST') {
        try {
            const body = await parseBody(req);
            const config = readJson('store_config.json', {});
            const validPassword = config.admin_senha || ADMIN_PASSWORD;

            if (body.senha === validPassword) {
                const token = 'adm_' + Date.now() + '_' + Math.random().toString(36).substring(2, 10);
                return sendJson(res, 200, { sucesso: true, token, nome: 'Administrador Favo de Mel' });
            } else {
                return sendJson(res, 401, { sucesso: false, erro: 'Senha administrativa incorreta' });
            }
        } catch (err) {
            return sendJson(res, 400, { sucesso: false, erro: err.message });
        }
    }

    // =========================================================================
    // SERVIÇO DE ARQUIVOS ESTÁTICOS
    // =========================================================================
    if (safePath === '/') {
        safePath = '/index.html';
    }

    let filePath = path.join(BASE_DIR, safePath);

    if (!filePath.startsWith(BASE_DIR)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('403 - Acesso Negado');
    }

    const serveFile = (targetFile) => {
        fs.readFile(targetFile, (err, data) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                return res.end(`500 - Erro interno ao ler arquivo: ${err.message}`);
            }

            const ext = path.extname(targetFile).toLowerCase();
            const contentType = MIME_TYPES[ext] || 'application/octet-stream';

            res.writeHead(200, { 'Content-Type': contentType });
            res.end(data);
        });
    };

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

        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
            <!DOCTYPE html>
            <html lang="pt-BR">
            <head>
                <meta charset="UTF-8">
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
                <p>O arquivo ou página <strong>${safePath}</strong> não foi encontrado.</p>
                <a href="/">Voltar ao Início</a>
            </body>
            </html>
        `);
    });
});

// Tratamento inteligente de portas
function iniciarServidor(porta) {
    server.listen(porta, '0.0.0.0', () => {
        console.log('\n======================================================');
        console.log('Apiário Favo de Mel - Servidor com Painel Administrativo');
        console.log(`Catálogo:     http://localhost:${porta}/catalogo.html`);
        console.log(`Painel Admin: http://localhost:${porta}/admin.html`);
        console.log(`Site Oficial: http://localhost:${porta}/`);
        console.log(`API Local:    Ativa com armazenamento em /data`);
        console.log('Pressione Ctrl+C para encerrar o servidor');
        console.log('======================================================\n');
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

iniciarServidor(PORT);
