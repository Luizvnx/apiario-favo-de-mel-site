/**
 * Apiário Favo de Mel - Servidor de Desenvolvimento Local & API Administrativa
 * Suporte a .env, Gestão de Catálogo, PostgreSQL & Fallback Local Resiliente
 * Tabelas: tb_bot_config, tb_categorias, tb_produtos, tb_pedidos
 */

require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const BASE_DIR = __dirname;
const DATA_DIR = path.join(BASE_DIR, 'data');
const PRODUCTS_ASSETS_DIR = path.join(BASE_DIR, 'assets', 'products');

// Inicializa o adaptador do Banco de Dados PostgreSQL
db.init();

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
        return res.end(`window.FAVODEMEL_API_URL = "";\nconsole.log("[Config] Modo Integrado Ativo - API Favo de Mel");`);
    }

    // Atalho amigável para o painel administrativo
    if (safePath === '/admin' || safePath === '/admin/') {
        safePath = '/admin.html';
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
                pedido: pedidoSalvo,
                fonte
            });
        } catch (err) {
            return sendJson(res, 400, { sucesso: false, erro: 'Erro ao processar pedido: ' + err.message });
        }
    }

    // Consulta de Pedido para a página pedido.html
    if (safePath.startsWith('/api/pedido/') && req.method === 'GET') {
        try {
            const queryId = safePath.replace('/api/pedido/', '').trim();
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
                return sendJson(res, 200, { sucesso: true, codigo: pedidoCodigo, status, fonte });
            } catch (err) {
                return sendJson(res, 400, { sucesso: false, erro: err.message });
            }
        }
    }

    // 7. Autenticação Administrativa
    if (safePath === '/api/admin/login' && req.method === 'POST') {
        try {
            const body = await parseBody(req);
            const { dados: config } = await db.obterConfigLoja();
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
        console.log('🐝 Apiário Favo de Mel - Servidor & Painel Administrativo');
        console.log(`Catálogo:     http://localhost:${porta}/catalogo.html`);
        console.log(`Painel Admin: http://localhost:${porta}/admin.html`);
        console.log(`Site Oficial: http://localhost:${porta}/`);
        console.log(`Banco:        PostgreSQL (${process.env.DB_NAME || 'evolution_db'}) c/ Fallback Resiliente`);
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
