/**
 * Apiário Favo de Mel - Adaptador de Banco de Dados PostgreSQL Resiliente
 * Conexão com tb_bot_config, tb_categorias, tb_produtos e tb_pedidos
 * Se o PostgreSQL estiver offline (ex: Docker parado), opera com fallback local (data/*.json)
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');

// Fotos canônicas usadas APENAS como fallback quando o produto não tem nenhuma foto cadastrada
const CANONICAL_PHOTOS_FALLBACK = {
    1: 'Mel-com-favo-500g.webp',
    2: 'Mel-in-natura-280g.webp',
    3: 'Propolis-verde-20ml.webp',
    4: 'Propolis-vermelha-20ml.webp',
    5: 'Kit-presente.webp',
    6: 'Kit-de-sabinete-terapeutico.webp',
    7: 'Licor-de-mel-250ml.webp',
    8: 'Mel-in-natura-500g.webp',
    9: 'Meleira-com-mel-280g.webp',
    10: 'Polen-apicola-140g.webp',
    11: 'Vinagre-de-mel-315ml.webp',
    12: 'Velas-artesanais-de-cera-de-abelha.webp',
    13: 'Cera-bruta-de-apis.webp',
    14: 'Mel-in-Natura-1400g.webp'
};

// Erros de indisponibilidade da conexão: nesses casos o sistema aceita gravação
// local e enfileira a operação para sincronizar quando o PostgreSQL voltar.
const CONNECTION_ERROR_CODES = new Set([
    'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH',
    'ENETUNREACH', 'EPIPE', '57P01', '57P02', '57P03', '08000', '08001',
    '08003', '08006', '08004', '53300', '53400'
]);

function ehErroDeConexao(err) {
    if (!err) return false;
    if (CONNECTION_ERROR_CODES.has(err.code)) return true;
    const msg = String(err.message || '').toLowerCase();
    return msg.includes('connection terminated') ||
           msg.includes('connection refused') ||
           msg.includes('timeout exceeded') ||
           msg.includes('postgresql desconectado') ||
           msg.includes('client has encountered a connection error') ||
           msg.includes('terminating connection');
}

function normalizarFotoProduto(id, foto) {
    // Se há foto cadastrada (não vazia, não nula) → respeita exatamente o que o admin salvou
    if (foto && String(foto).trim() !== '' && String(foto).trim() !== 'null' && String(foto).trim() !== 'undefined') {
        return String(foto).trim();
    }
    // Sem foto: usa a canônica de fallback só se não houver foto real
    if (id && CANONICAL_PHOTOS_FALLBACK[id]) return CANONICAL_PHOTOS_FALLBACK[id];
    return 'Mel-in-natura-500g.webp';
}

class DatabaseAdapter {
    constructor() {
        this.pool = null;
        this.isConnected = false;
        this.hasCheckedInitial = false;
        this.reconnectTimer = null;

        // Fila de operações feitas enquanto o PostgreSQL estava indisponível.
        // Garante que nenhuma edição do painel admin seja perdida.
        this.pendingSync = [];
        this.syncingPending = false;
    }

    // Leitura e escrita de JSON como fallback resiliente e cache
    readJson(filename, defaultValue) {
        const p = path.join(DATA_DIR, filename);
        if (!fs.existsSync(p)) return defaultValue;
        try {
            return JSON.parse(fs.readFileSync(p, 'utf8'));
        } catch (err) {
            console.error(`[Fallback] Erro ao ler JSON ${filename}:`, err.message);
            return defaultValue;
        }
    }

    writeJson(filename, data) {
        try {
            if (!fs.existsSync(DATA_DIR)) {
                fs.mkdirSync(DATA_DIR, { recursive: true });
            }
            const p = path.join(DATA_DIR, filename);
            fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
            return true;
        } catch (err) {
            console.error(`[Fallback] Erro ao salvar JSON ${filename}:`, err.message);
            return false;
        }
    }

    // =========================================================================
    // FILA DE SINCRONIZAÇÃO (gravações feitas com PostgreSQL offline)
    // =========================================================================
    temPendencias() {
        return Array.isArray(this.pendingSync) && this.pendingSync.length > 0;
    }

    enfileirarSincronizacao(operacao) {
        this.pendingSync.push({ ...operacao, criado_em: new Date().toISOString() });
        this.writeJson('pending_sync.json', this.pendingSync);
        console.warn(`[Sync] Operação "${operacao.tipo}" salva localmente e enfileirada para sincronizar com o PostgreSQL.`);
    }

    gravarFilaSincronizacao() {
        this.writeJson('pending_sync.json', this.pendingSync);
    }

    formatarProduto(row) {
        return {
            id: row.id,
            categoria_id: row.categoria_id,
            nome: row.nome,
            preco: parseFloat(row.preco),
            descricao: row.descricao || '',
            foto: normalizarFotoProduto(row.id, row.foto),
            peso: row.peso || '',
            estoque: parseInt(row.estoque, 10),
            ativo: row.ativo !== false,
            criado_em: row.criado_em,
            atualizado_em: row.atualizado_em
        };
    }

    async processarFilaSincronizacao() {
        if (!this.isConnected || this.syncingPending || !this.temPendencias()) return;

        this.syncingPending = true;
        const fila = [...this.pendingSync];
        let enviadas = 0;

        try {
            while (fila.length > 0) {
                const op = fila[0];
                try {
                    if (op.tipo === 'produto_criar') {
                        const d = op.dados || {};
                        const res = await this.query(`
                            INSERT INTO tb_produtos (categoria_id, nome, preco, descricao, foto, peso, estoque, ativo, criado_em, atualizado_em)
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                            RETURNING *;
                        `, [
                            String(d.categoria_id || '1'),
                            (d.nome || 'Novo Produto').trim(),
                            parseFloat(d.preco) || 0,
                            d.descricao ? String(d.descricao).trim() : '',
                            d.foto || 'Mel-in-natura-500g.webp',
                            d.peso || '',
                            parseInt(d.estoque, 10) || 0,
                            d.ativo !== false
                        ]);
                        const novo = this.formatarProduto(res.rows[0]);

                        // Atualiza o cache local trocando o id local pelo id real do banco
                        const cache = this.readJson('produtos.json', []);
                        const ix = cache.findIndex(p => String(p.id) === String(op.local_id));
                        if (ix !== -1) cache[ix] = novo; else cache.unshift(novo);
                        this.writeJson('produtos.json', cache);

                        // Demais operações pendentes passam a usar o id real
                        for (const restante of fila) {
                            if (restante.tipo && restante.tipo.startsWith('produto_') && String(restante.id) === String(op.local_id)) {
                                restante.id = novo.id;
                            }
                        }
                        console.log(`[Sync] ✓ Produto "${novo.nome}" criado no PostgreSQL (id ${novo.id}).`);
                    } else if (op.tipo === 'produto_atualizar') {
                        const d = op.dados || {};
                        const res = await this.query(`
                            UPDATE tb_produtos
                            SET categoria_id = COALESCE($1, categoria_id),
                                nome = COALESCE($2, nome),
                                preco = COALESCE($3, preco),
                                descricao = COALESCE($4, descricao),
                                foto = COALESCE($5, foto),
                                peso = COALESCE($6, peso),
                                estoque = COALESCE($7, estoque),
                                ativo = COALESCE($8, ativo),
                                atualizado_em = CURRENT_TIMESTAMP
                            WHERE id = $9
                            RETURNING *;
                        `, [
                            d.categoria_id !== undefined ? String(d.categoria_id) : null,
                            d.nome !== undefined ? String(d.nome).trim() : null,
                            d.preco !== undefined ? parseFloat(d.preco) : null,
                            d.descricao !== undefined ? String(d.descricao).trim() : null,
                            d.foto !== undefined ? d.foto : null,
                            d.peso !== undefined ? d.peso : null,
                            d.estoque !== undefined ? parseInt(d.estoque, 10) : null,
                            d.ativo !== undefined ? (d.ativo !== false) : null,
                            parseInt(op.id, 10)
                        ]);
                        if (res.rows.length > 0) {
                            const atualizado = this.formatarProduto(res.rows[0]);
                            const cache = this.readJson('produtos.json', []);
                            const ix = cache.findIndex(p => String(p.id) === String(atualizado.id));
                            if (ix !== -1) cache[ix] = atualizado; else cache.unshift(atualizado);
                            this.writeJson('produtos.json', cache);
                            console.log(`[Sync] ✓ Produto id ${atualizado.id} atualizado no PostgreSQL.`);
                        }
                    } else if (op.tipo === 'produto_excluir') {
                        await this.query('DELETE FROM tb_produtos WHERE id = $1', [parseInt(op.id, 10)]);
                        console.log(`[Sync] ✓ Produto id ${op.id} excluído no PostgreSQL.`);
                    } else if (op.tipo === 'categoria_salvar') {
                        const d = op.dados || {};
                        await this.query(`
                            INSERT INTO tb_categorias (id, nome, descricao, icone, ordem, ativo)
                            VALUES ($1, $2, $3, $4, $5, $6)
                            ON CONFLICT (id) DO UPDATE SET
                                nome = EXCLUDED.nome,
                                descricao = EXCLUDED.descricao,
                                icone = EXCLUDED.icone,
                                ordem = EXCLUDED.ordem,
                                ativo = EXCLUDED.ativo;
                        `, [
                            String(d.id),
                            d.nome || 'Categoria',
                            d.descricao || '',
                            d.icone || 'droplet',
                            parseInt(d.ordem, 10) || 1,
                            d.ativo !== false
                        ]);
                        console.log(`[Sync] ✓ Categoria "${d.nome}" sincronizada no PostgreSQL.`);
                    } else if (op.tipo === 'categoria_excluir') {
                        await this.query('DELETE FROM tb_categorias WHERE id = $1', [String(op.id)]);
                        console.log(`[Sync] ✓ Categoria id ${op.id} excluída no PostgreSQL.`);
                    }

                    enviadas += 1;
                    fila.shift();
                    this.pendingSync = [...fila];
                    this.gravarFilaSincronizacao();
                } catch (err) {
                    console.warn(`[Sync] Falha ao sincronizar "${op.tipo}":`, err.message);
                    if (ehErroDeConexao(err)) {
                        this.isConnected = false;
                        break;
                    }
                    // Erro definitivo (ex.: FK inválida): descarta para não travar a fila,
                    // mas mantém o dado local para o admin corrigir.
                    console.error(`[Sync] Operação "${op.tipo}" descartada após erro definitivo.`);
                    fila.shift();
                    this.pendingSync = [...fila];
                    this.gravarFilaSincronizacao();
                }
            }
        } finally {
            this.syncingPending = false;
        }

        if (enviadas > 0) {
            console.log(`[Sync] ✓ ${enviadas} operação(ões) pendente(s) sincronizada(s).`);
            try {
                await this.listarProdutos(false);
                await this.listarCategorias(false);
            } catch (_) {}
        }
    }

    init() {
        // Recupera fila de sincronização pendente de execuções anteriores
        try {
            const fila = this.readJson('pending_sync.json', []);
            this.pendingSync = Array.isArray(fila) ? fila : [];
        } catch (_) {
            this.pendingSync = [];
        }

        const config = {
            host: process.env.DB_HOST || 'localhost',
            port: parseInt(process.env.DB_PORT, 10) || 5432,
            user: process.env.DB_USER || 'postgres',
            password: process.env.DB_PASSWORD || 'typebot',
            database: process.env.DB_NAME || 'evolution_db',
            connectionTimeoutMillis: 2500,
            idleTimeoutMillis: 10000
        };

        if (process.env.DATABASE_URL) {
            this.pool = new Pool({
                connectionString: process.env.DATABASE_URL,
                connectionTimeoutMillis: 2500,
                idleTimeoutMillis: 10000
            });
        } else {
            this.pool = new Pool(config);
        }

        // Trata erros globais do pool para não derrubar o processo
        this.pool.on('error', (err) => {
            console.warn('[PostgreSQL Pool] Aviso:', err.message);
            this.isConnected = false;
        });

        this.checkConnectionAndInitTables();

        // Tentativa de reconexão automática periódica (a cada 20s)
        if (!this.reconnectTimer) {
            this.reconnectTimer = setInterval(() => {
                if (!this.isConnected) {
                    this.checkConnectionAndInitTables(true);
                }
            }, 20000);
        }
    }

    async query(text, params = []) {
        if (!this.isConnected || !this.pool) {
            throw new Error('PostgreSQL desconectado');
        }
        return await this.pool.query(text, params);
    }

    async checkConnectionAndInitTables(isRetry = false) {
        try {
            const client = await this.pool.connect();
            try {
                await client.query('SELECT 1');
                const wasConnected = this.isConnected;
                this.isConnected = true;

                if (!wasConnected) {
                    console.log('✅ [Banco de Dados] Conexão com PostgreSQL estabelecida com sucesso!');
                    console.log(`   Host: ${process.env.DB_HOST || 'localhost'} | Base: ${process.env.DB_NAME || 'evolution_db'}`);
                    await this.initTables(client);
                    await this.seedInitialData(client);
                }

                // Assim que a conexão é restabelecida, envia ao banco tudo o que
                // foi editado no painel admin durante a indisponibilidade.
                if (this.temPendencias()) {
                    await this.processarFilaSincronizacao();
                }
            } finally {
                client.release();
            }
        } catch (err) {
            if (!this.hasCheckedInitial || !isRetry) {
                console.warn(`⚠️ [Banco de Dados] PostgreSQL offline (${err.code || err.message}).`);
                console.warn('   Operando em MODO RESILIENTE com persistência local em /data/*.json.');
                console.warn('   Assim que o Docker/PostgreSQL iniciar, a sincronização será ativada automaticamente.\n');
            }
            this.isConnected = false;
            this.hasCheckedInitial = true;
        }
    }

    async initTables(client) {
        try {
            // 1. Configurações da Loja / Bot
            await client.query(`
                CREATE TABLE IF NOT EXISTS tb_bot_config (
                    chave VARCHAR(50) PRIMARY KEY,
                    valor JSONB,
                    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);

            // 2. Categorias de Produtos
            await client.query(`
                CREATE TABLE IF NOT EXISTS tb_categorias (
                    id VARCHAR(50) PRIMARY KEY,
                    nome VARCHAR(150) NOT NULL,
                    descricao TEXT,
                    icone VARCHAR(50) DEFAULT 'droplet',
                    ordem INT DEFAULT 1,
                    ativo BOOLEAN DEFAULT TRUE,
                    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);

            // 3. Produtos
            await client.query(`
                CREATE TABLE IF NOT EXISTS tb_produtos (
                    id SERIAL PRIMARY KEY,
                    categoria_id VARCHAR(50) NOT NULL REFERENCES tb_categorias(id) ON DELETE CASCADE,
                    nome VARCHAR(150) NOT NULL,
                    preco NUMERIC(10,2) NOT NULL,
                    descricao TEXT,
                    foto TEXT,
                    peso VARCHAR(50) DEFAULT '',
                    estoque INT DEFAULT 999,
                    ativo BOOLEAN DEFAULT TRUE,
                    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);

            // Migração idempotente para bancos criados antes do campo "peso"
            await client.query(`
                ALTER TABLE tb_produtos ADD COLUMN IF NOT EXISTS peso VARCHAR(50) DEFAULT '';
            `);

            // 4. Pedidos
            await client.query(`
                CREATE TABLE IF NOT EXISTS tb_pedidos (
                    id SERIAL PRIMARY KEY,
                    codigo_pedido VARCHAR(50) UNIQUE NOT NULL,
                    token_acesso VARCHAR(100),
                    cliente_nome VARCHAR(150) NOT NULL,
                    cliente_telefone VARCHAR(50) NOT NULL,
                    tipo_entrega VARCHAR(50) DEFAULT 'entrega',
                    endereco JSONB DEFAULT '{}',
                    forma_pagamento VARCHAR(50) DEFAULT 'pix',
                    troco_para VARCHAR(50),
                    observacoes TEXT,
                    itens JSONB NOT NULL,
                    subtotal NUMERIC(10, 2) NOT NULL,
                    taxa_entrega NUMERIC(10, 2) DEFAULT 0.00,
                    total NUMERIC(10, 2) NOT NULL,
                    status VARCHAR(50) DEFAULT 'novo',
                    origem VARCHAR(50) DEFAULT 'catalogo_web',
                    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);
            console.log('📦 [Banco de Dados] Tabelas verificadas (tb_bot_config, tb_categorias, tb_produtos, tb_pedidos).');
        } catch (err) {
            console.error('[Banco de Dados] Erro ao criar tabelas no PostgreSQL:', err.message);
        }
    }

    async seedInitialData(client) {
        try {
            // Seed de Categorias se vazio
            const catRes = await client.query('SELECT COUNT(*) FROM tb_categorias');
            if (parseInt(catRes.rows[0].count, 10) === 0) {
                const categoriasIniciais = this.readJson('categorias.json', [
                    { id: '1', nome: 'Méiss Especiais', icone: 'droplet', ordem: 1, ativo: true },
                    { id: '2', nome: 'Kits & Presentes', icone: 'gift', ordem: 2, ativo: true },
                    { id: '3', nome: 'Própolis & Saúde', icone: 'shield', ordem: 3, ativo: true },
                    { id: '4', nome: 'Acessórios & Outros', icone: 'package', ordem: 4, ativo: true }
                ]);
                for (let i = 0; i < categoriasIniciais.length; i++) {
                    const c = categoriasIniciais[i];
                    await client.query(`
                        INSERT INTO tb_categorias (id, nome, icone, ordem, ativo)
                        VALUES ($1, $2, $3, $4, $5)
                        ON CONFLICT (id) DO NOTHING;
                    `, [String(c.id), c.nome, c.icone || 'droplet', c.ordem || (i + 1), c.ativo !== false]);
                }
                console.log(`🌱 [Banco de Dados] ${categoriasIniciais.length} categorias migradas para o PostgreSQL.`);
            }

            // Seed de Produtos se vazio
            const prodRes = await client.query('SELECT COUNT(*) FROM tb_produtos');
            if (parseInt(prodRes.rows[0].count, 10) === 0) {
                const produtosIniciais = this.readJson('produtos.json', []);
                for (const p of produtosIniciais) {
                    await client.query(`
                        INSERT INTO tb_produtos (categoria_id, nome, preco, descricao, foto, peso, estoque, ativo)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    `, [
                        String(p.categoria_id || '1'),
                        p.nome,
                        parseFloat(p.preco) || 0,
                        p.descricao || '',
                        p.foto || 'Mel-in-Natura-500g.png',
                        p.peso || '',
                        parseInt(p.estoque, 10) || 50,
                        p.ativo !== false
                    ]);
                }
                console.log(`🌱 [Banco de Dados] ${produtosIniciais.length} produtos migrados para o PostgreSQL.`);
            }

            // Sincronização automática contínua das fotos dos produtos para formato WebP canônico
            try {
                for (const [idStr, fotoWebp] of Object.entries(CANONICAL_PHOTOS_FALLBACK)) {
                    await client.query('UPDATE tb_produtos SET foto = $1 WHERE id = $2 AND (foto IS NULL OR foto = \'\')', [fotoWebp, parseInt(idStr, 10)]);
                }
            } catch (errFoto) {
                console.warn('[DB] Aviso ao sincronizar fotos canônicas no PostgreSQL:', errFoto.message);
            }

            // Seed de Configurações da Loja se não existir
            const cfgRes = await client.query("SELECT chave FROM tb_bot_config WHERE chave = 'store_config'");
            if (cfgRes.rows.length === 0) {
                const configPadrao = this.readJson('store_config.json', {
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
                await client.query(`
                    INSERT INTO tb_bot_config (chave, valor, atualizado_em)
                    VALUES ('store_config', $1, CURRENT_TIMESTAMP)
                `, [JSON.stringify(configPadrao)]);
                console.log('🌱 [Banco de Dados] Configurações da loja inseridas em tb_bot_config.');
            }
        } catch (err) {
            console.error('[Banco de Dados] Erro no seed de dados iniciais:', err.message);
        }
    }

    // =========================================================================
    // CREDENCIAIS ADMINISTRATIVAS (tb_bot_config)
    // =========================================================================
    async obterCredenciaisAdmin() {
        const fallback = this.readJson('admin_credentials.json', {
            email: 'admin@admin.com',
            senha: process.env.ADMIN_PASSWORD || 'admin'
        });

        if (!this.isConnected) {
            return { credenciais: fallback, fonte: 'local_json' };
        }

        try {
            const res = await this.query("SELECT valor FROM tb_bot_config WHERE chave = 'admin_credentials'");
            if (res.rows.length > 0 && res.rows[0].valor) {
                const creds = res.rows[0].valor;
                this.writeJson('admin_credentials.json', creds);
                return { credenciais: creds, fonte: 'postgresql' };
            }
            await this.query(`
                INSERT INTO tb_bot_config (chave, valor, atualizado_em)
                VALUES ('admin_credentials', $1, CURRENT_TIMESTAMP)
                ON CONFLICT (chave) DO NOTHING;
            `, [JSON.stringify(fallback)]);
            return { credenciais: fallback, fonte: 'postgresql' };
        } catch (err) {
            console.warn('[DB] Erro ao obter credenciais no PostgreSQL, usando cache local:', err.message);
            return { credenciais: fallback, fonte: 'local_json' };
        }
    }

    async salvarCredenciaisAdmin(email, senha) {
        const dados = { email: email.trim().toLowerCase(), senha: senha.trim() };
        this.writeJson('admin_credentials.json', dados);

        if (!this.isConnected) {
            return { sucesso: true, credenciais: dados, fonte: 'local_json' };
        }

        try {
            await this.query(`
                INSERT INTO tb_bot_config (chave, valor, atualizado_em)
                VALUES ('admin_credentials', $1, CURRENT_TIMESTAMP)
                ON CONFLICT (chave)
                DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = CURRENT_TIMESTAMP;
            `, [JSON.stringify(dados)]);
            return { sucesso: true, credenciais: dados, fonte: 'postgresql' };
        } catch (err) {
            console.error('[DB] Erro ao salvar credenciais no PostgreSQL:', err.message);
            return { sucesso: true, credenciais: dados, fonte: 'local_json' };
        }
    }

    // =========================================================================
    // CONFIGURAÇÕES DA LOJA (tb_bot_config)
    // =========================================================================
    async obterConfigLoja() {
        const fallback = this.readJson('store_config.json', {
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

        if (!this.isConnected) {
            return { dados: fallback, fonte: 'local_json' };
        }

        try {
            const res = await this.query("SELECT valor FROM tb_bot_config WHERE chave = 'store_config'");
            if (res.rows.length > 0 && res.rows[0].valor) {
                const configDb = res.rows[0].valor;
                // Atualiza cache local
                this.writeJson('store_config.json', configDb);
                return { dados: configDb, fonte: 'postgresql' };
            }
            return { dados: fallback, fonte: 'local_json' };
        } catch (err) {
            console.warn('[DB] Erro ao obter config no PostgreSQL, usando cache local:', err.message);
            return { dados: fallback, fonte: 'local_json' };
        }
    }

    async salvarConfigLoja(novasConfigs) {
        // Sempre salva no cache local para resiliência
        const atualLocal = this.readJson('store_config.json', {});
        const mesclado = { ...atualLocal, ...novasConfigs };
        this.writeJson('store_config.json', mesclado);

        if (!this.isConnected) {
            return { dados: mesclado, fonte: 'local_json' };
        }

        try {
            await this.query(`
                INSERT INTO tb_bot_config (chave, valor, atualizado_em)
                VALUES ('store_config', $1, CURRENT_TIMESTAMP)
                ON CONFLICT (chave)
                DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = CURRENT_TIMESTAMP;
            `, [JSON.stringify(mesclado)]);

            return { dados: mesclado, fonte: 'postgresql' };
        } catch (err) {
            console.error('[DB] Erro ao salvar config no PostgreSQL:', err.message);
            return { dados: mesclado, fonte: 'local_json' };
        }
    }

    // =========================================================================
    // CATEGORIAS (tb_categorias)
    // =========================================================================
    async listarCategorias(apenasAtivas = false) {
        const fallback = this.readJson('categorias.json', []);
        const listarLocal = () => {
            const list = apenasAtivas ? fallback.filter(c => c.ativo !== false) : fallback;
            return { categorias: list, fonte: 'local_json' };
        };

        if (!this.isConnected || this.temPendencias()) {
            return listarLocal();
        }

        try {
            const sql = apenasAtivas
                ? "SELECT id, nome, descricao, icone, ordem, ativo FROM tb_categorias WHERE ativo = true ORDER BY ordem ASC, id ASC"
                : "SELECT id, nome, descricao, icone, ordem, ativo FROM tb_categorias ORDER BY ordem ASC, id ASC";
            const res = await this.query(sql);
            const categorias = res.rows;
            // Atualiza cache
            this.writeJson('categorias.json', categorias);
            return { categorias, fonte: 'postgresql' };
        } catch (err) {
            console.warn('[DB] Erro ao listar categorias no PostgreSQL:', err.message);
            if (ehErroDeConexao(err)) this.isConnected = false;
            return listarLocal();
        }
    }

    async salvarCategoria(dados) {
        const fallback = this.readJson('categorias.json', []);
        let categoriaAtualizada = null;

        if (dados.id) {
            const idx = fallback.findIndex(c => String(c.id) === String(dados.id));
            if (idx !== -1) {
                fallback[idx] = { ...fallback[idx], ...dados };
                categoriaAtualizada = fallback[idx];
            } else {
                categoriaAtualizada = { ...dados };
                fallback.push(categoriaAtualizada);
            }
        } else {
            const novoId = String(fallback.length > 0 ? Math.max(...fallback.map(c => parseInt(c.id, 10) || 0)) + 1 : 1);
            categoriaAtualizada = {
                id: novoId,
                nome: dados.nome || 'Nova Categoria',
                icone: dados.icone || 'droplet',
                ordem: parseInt(dados.ordem, 10) || fallback.length + 1,
                ativo: dados.ativo !== false
            };
            fallback.push(categoriaAtualizada);
        }
        this.writeJson('categorias.json', fallback);

        if (!this.isConnected) {
            this.enfileirarSincronizacao({ tipo: 'categoria_salvar', dados: categoriaAtualizada });
            return { categoria: categoriaAtualizada, categorias: fallback, fonte: 'local_json', pendente: true };
        }

        try {
            const sql = `
                INSERT INTO tb_categorias (id, nome, descricao, icone, ordem, ativo)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (id)
                DO UPDATE SET
                    nome = EXCLUDED.nome,
                    descricao = EXCLUDED.descricao,
                    icone = EXCLUDED.icone,
                    ordem = EXCLUDED.ordem,
                    ativo = EXCLUDED.ativo
                RETURNING *;
            `;
            const res = await this.query(sql, [
                String(categoriaAtualizada.id),
                categoriaAtualizada.nome,
                categoriaAtualizada.descricao || '',
                categoriaAtualizada.icone || 'droplet',
                parseInt(categoriaAtualizada.ordem, 10) || 1,
                categoriaAtualizada.ativo !== false
            ]);

            const listaCompleta = await this.listarCategorias(false);
            return { categoria: res.rows[0], categorias: listaCompleta.categorias, fonte: 'postgresql' };
        } catch (err) {
            if (ehErroDeConexao(err)) {
                this.isConnected = false;
                this.enfileirarSincronizacao({ tipo: 'categoria_salvar', dados: categoriaAtualizada });
                return { categoria: categoriaAtualizada, categorias: fallback, fonte: 'local_json', pendente: true };
            }
            console.error('[DB] Erro ao salvar categoria no PostgreSQL:', err.message);
            throw new Error('Não foi possível salvar a categoria no banco de dados: ' + err.message);
        }
    }

    async deletarCategoria(id) {
        let fallback = this.readJson('categorias.json', []);
        fallback = fallback.filter(c => String(c.id) !== String(id));
        this.writeJson('categorias.json', fallback);

        // Categoria criada/alterada durante uma queda do banco: remove da fila em vez
        // de agendar uma exclusão (a criação nunca chegou ao PostgreSQL).
        const antes = this.pendingSync.length;
        this.pendingSync = this.pendingSync.filter(
            op => !(op.tipo === 'categoria_salvar' && String(op.dados && op.dados.id) === String(id))
        );
        if (this.pendingSync.length !== antes) {
            this.gravarFilaSincronizacao();
            return { sucesso: true, categorias: fallback, fonte: 'local_json', pendente: true };
        }

        if (!this.isConnected) {
            this.enfileirarSincronizacao({ tipo: 'categoria_excluir', id: String(id) });
            return { sucesso: true, categorias: fallback, fonte: 'local_json', pendente: true };
        }

        try {
            await this.query("DELETE FROM tb_categorias WHERE id = $1", [String(id)]);
            const listaCompleta = await this.listarCategorias(false);
            return { sucesso: true, categorias: listaCompleta.categorias, fonte: 'postgresql' };
        } catch (err) {
            if (ehErroDeConexao(err)) {
                this.isConnected = false;
                this.enfileirarSincronizacao({ tipo: 'categoria_excluir', id: String(id) });
                return { sucesso: true, categorias: fallback, fonte: 'local_json', pendente: true };
            }
            console.error('[DB] Erro ao deletar categoria no PostgreSQL:', err.message);
            throw new Error('Não foi possível excluir a categoria no banco de dados: ' + err.message);
        }
    }

    // =========================================================================
    // PRODUTOS (tb_produtos)
    // =========================================================================
    async listarProdutos(apenasAtivos = false) {
        const fallback = this.readJson('produtos.json', []);
        const listarLocal = () => {
            const list = (apenasAtivos ? fallback.filter(p => p.ativo !== false) : fallback).map(p => ({
                ...p,
                foto: normalizarFotoProduto(p.id, p.foto)
            }));
            return { produtos: list, fonte: 'local_json' };
        };

        // Enquanto existir edição local esperando sincronização, ela é a fonte da verdade.
        // Isso evita que o catálogo mostre dados antigos do banco e "engula" as alterações.
        if (!this.isConnected || this.temPendencias()) {
            return listarLocal();
        }

        try {
            const sql = apenasAtivos
                ? `SELECT p.id, p.categoria_id, c.nome as categoria_nome, p.nome, p.preco, p.descricao, p.foto, p.peso, p.estoque, p.ativo, p.criado_em, p.atualizado_em
                   FROM tb_produtos p
                   LEFT JOIN tb_categorias c ON p.categoria_id = c.id
                   WHERE p.ativo = true
                   ORDER BY p.id ASC`
                : `SELECT p.id, p.categoria_id, c.nome as categoria_nome, p.nome, p.preco, p.descricao, p.foto, p.peso, p.estoque, p.ativo, p.criado_em, p.atualizado_em
                   FROM tb_produtos p
                   LEFT JOIN tb_categorias c ON p.categoria_id = c.id
                   ORDER BY p.id ASC`;
            const res = await this.query(sql);
            const produtosFormatados = res.rows.map(p => ({
                ...this.formatarProduto(p),
                categoria_nome: p.categoria_nome || ''
            }));

            // Atualiza cache local com os dados confirmados pelo PostgreSQL
            this.writeJson('produtos.json', produtosFormatados);
            return { produtos: produtosFormatados, fonte: 'postgresql' };
        } catch (err) {
            console.warn('[DB] Erro ao listar produtos no PostgreSQL:', err.message);
            if (ehErroDeConexao(err)) this.isConnected = false;
            return listarLocal();
        }
    }

    async criarProduto(dados) {
        let produtos = this.readJson('produtos.json', []);
        const novoIdLocal = produtos.length > 0 ? Math.max(...produtos.map(p => parseInt(p.id, 10) || 0)) + 1 : 1;

        const novoProduto = {
            id: novoIdLocal,
            categoria_id: String(dados.categoria_id || '1'),
            categoria_nome: '',
            nome: (dados.nome || 'Novo Produto').trim(),
            preco: parseFloat(dados.preco) || 0,
            descricao: dados.descricao || '',
            foto: dados.foto || 'Mel-in-natura-500g.webp',
            peso: dados.peso || '',
            estoque: parseInt(dados.estoque, 10) || 0,
            ativo: dados.ativo !== false,
            criado_em: new Date().toISOString(),
            atualizado_em: new Date().toISOString()
        };

        if (!this.isConnected) {
            produtos.unshift(novoProduto);
            this.writeJson('produtos.json', produtos);
            this.enfileirarSincronizacao({ tipo: 'produto_criar', local_id: novoProduto.id, dados: novoProduto });
            return { produto: novoProduto, fonte: 'local_json', pendente: true };
        }

        try {
            const sql = `
                INSERT INTO tb_produtos (categoria_id, nome, preco, descricao, foto, peso, estoque, ativo, criado_em, atualizado_em)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                RETURNING *;
            `;
            const res = await this.query(sql, [
                String(dados.categoria_id || '1'),
                (dados.nome || 'Novo Produto').trim(),
                parseFloat(dados.preco) || 0,
                dados.descricao ? String(dados.descricao).trim() : '',
                dados.foto || 'Mel-in-natura-500g.webp',
                dados.peso || '',
                parseInt(dados.estoque, 10) || 0,
                dados.ativo !== false
            ]);

            const formatado = this.formatarProduto(res.rows[0]);

            // Atualiza cache local (remove eventual duplicata de mesmo id/nome)
            produtos = produtos.filter(p => String(p.id) !== String(formatado.id));
            produtos.unshift(formatado);
            this.writeJson('produtos.json', produtos);

            return { produto: formatado, fonte: 'postgresql' };
        } catch (err) {
            if (ehErroDeConexao(err)) {
                this.isConnected = false;
                produtos.unshift(novoProduto);
                this.writeJson('produtos.json', produtos);
                this.enfileirarSincronizacao({ tipo: 'produto_criar', local_id: novoProduto.id, dados: novoProduto });
                console.warn('[DB] PostgreSQL caiu ao criar produto. Salvo localmente e enfileirado para sincronizar.');
                return { produto: novoProduto, fonte: 'local_json', pendente: true };
            }
            console.error('[DB] Erro ao criar produto no PostgreSQL:', err.message);
            throw new Error('Não foi possível cadastrar o produto no banco de dados: ' + err.message);
        }
    }

    async atualizarProduto(id, dados) {
        let produtos = this.readJson('produtos.json', []);
        const idx = produtos.findIndex(p => String(p.id) === String(id));

        const aplicarAtualizacaoLocal = () => {
            if (idx === -1) return null;
            produtos[idx] = {
                ...produtos[idx],
                ...dados,
                id: parseInt(id, 10) || id,
                preco: dados.preco !== undefined ? parseFloat(dados.preco) : produtos[idx].preco,
                categoria_id: dados.categoria_id !== undefined ? String(dados.categoria_id) : produtos[idx].categoria_id,
                estoque: dados.estoque !== undefined ? parseInt(dados.estoque, 10) : produtos[idx].estoque,
                peso: dados.peso !== undefined ? dados.peso : produtos[idx].peso,
                atualizado_em: new Date().toISOString()
            };
            this.writeJson('produtos.json', produtos);
            return produtos[idx];
        };

        // Produto criado durante uma queda do banco: atualiza a própria criação pendente
        const pendenteCriacao = this.pendingSync.find(
            op => op.tipo === 'produto_criar' && String(op.local_id) === String(id)
        );
        if (pendenteCriacao) {
            const atualizadoLocal = aplicarAtualizacaoLocal();
            pendenteCriacao.dados = { ...pendenteCriacao.dados, ...dados };
            this.gravarFilaSincronizacao();
            return { produto: atualizadoLocal, fonte: 'local_json', pendente: true };
        }

        if (!this.isConnected) {
            const atualizadoLocal = aplicarAtualizacaoLocal();
            if (!atualizadoLocal) throw new Error('Produto não encontrado para atualização.');
            this.enfileirarSincronizacao({ tipo: 'produto_atualizar', id: parseInt(id, 10) || id, dados });
            return { produto: atualizadoLocal, fonte: 'local_json', pendente: true };
        }

        try {
            const sql = `
                UPDATE tb_produtos
                SET 
                    categoria_id = COALESCE($1, categoria_id),
                    nome = COALESCE($2, nome),
                    preco = COALESCE($3, preco),
                    descricao = COALESCE($4, descricao),
                    foto = COALESCE($5, foto),
                    peso = COALESCE($6, peso),
                    estoque = COALESCE($7, estoque),
                    ativo = COALESCE($8, ativo),
                    atualizado_em = CURRENT_TIMESTAMP
                WHERE id = $9
                RETURNING *;
            `;
            const res = await this.query(sql, [
                dados.categoria_id !== undefined ? String(dados.categoria_id) : null,
                dados.nome !== undefined ? String(dados.nome).trim() : null,
                dados.preco !== undefined ? parseFloat(dados.preco) : null,
                dados.descricao !== undefined ? String(dados.descricao).trim() : null,
                dados.foto !== undefined ? dados.foto : null,
                dados.peso !== undefined ? dados.peso : null,
                dados.estoque !== undefined ? parseInt(dados.estoque, 10) : null,
                dados.ativo !== undefined ? (dados.ativo !== false) : null,
                parseInt(id, 10)
            ]);

            let formatado = null;

            if (res.rows.length > 0) {
                formatado = this.formatarProduto(res.rows[0]);
            } else {
                // O produto não existia no PostgreSQL (ex.: criado durante indisponibilidade
                // do banco). Recria para que o catálogo nunca fique sem ele.
                const base = idx !== -1 ? produtos[idx] : {};
                const merged = { ...base, ...dados };
                const inserido = await this.query(`
                    INSERT INTO tb_produtos (categoria_id, nome, preco, descricao, foto, peso, estoque, ativo, criado_em, atualizado_em)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    RETURNING *;
                `, [
                    String(merged.categoria_id || '1'),
                    String(merged.nome || 'Produto').trim(),
                    parseFloat(merged.preco) || 0,
                    merged.descricao ? String(merged.descricao).trim() : '',
                    merged.foto || 'Mel-in-natura-500g.webp',
                    merged.peso || '',
                    parseInt(merged.estoque, 10) || 0,
                    merged.ativo !== false
                ]);
                formatado = this.formatarProduto(inserido.rows[0]);
                console.log(`[DB] Produto id ${id} não existia no PostgreSQL e foi recriado como id ${formatado.id}.`);
            }

            // Sincroniza o cache local com os dados confirmados pelo PostgreSQL
            let produtosCache = this.readJson('produtos.json', []);
            produtosCache = produtosCache.filter(p => String(p.id) !== String(id) && String(p.id) !== String(formatado.id));
            produtosCache.unshift(formatado);
            this.writeJson('produtos.json', produtosCache);

            return { produto: formatado, fonte: 'postgresql' };
        } catch (err) {
            if (ehErroDeConexao(err)) {
                this.isConnected = false;
                const atualizadoLocal = aplicarAtualizacaoLocal();
                if (!atualizadoLocal) throw new Error('Produto não encontrado para atualização.');
                this.enfileirarSincronizacao({ tipo: 'produto_atualizar', id: parseInt(id, 10) || id, dados });
                console.warn('[DB] PostgreSQL caiu ao atualizar produto. Salvo localmente e enfileirado para sincronizar.');
                return { produto: atualizadoLocal, fonte: 'local_json', pendente: true };
            }
            console.error('[DB] Erro ao atualizar produto no PostgreSQL:', err.message);
            throw new Error('Não foi possível atualizar o produto no banco de dados: ' + err.message);
        }
    }

    async deletarProduto(id) {
        let produtos = this.readJson('produtos.json', []);
        produtos = produtos.filter(p => String(p.id) !== String(id));
        this.writeJson('produtos.json', produtos);

        // Se havia uma criação pendente ainda não enviada ao banco, basta removê-la da fila.
        const antes = this.pendingSync.length;
        this.pendingSync = this.pendingSync.filter(
            op => !(op.tipo === 'produto_criar' && String(op.local_id) === String(id))
        );
        if (this.pendingSync.length !== antes) {
            this.gravarFilaSincronizacao();
            return { sucesso: true, fonte: 'local_json', pendente: true };
        }

        if (!this.isConnected) {
            this.enfileirarSincronizacao({ tipo: 'produto_excluir', id: parseInt(id, 10) || id });
            return { sucesso: true, fonte: 'local_json', pendente: true };
        }

        try {
            await this.query("DELETE FROM tb_produtos WHERE id = $1", [parseInt(id, 10)]);
            return { sucesso: true, fonte: 'postgresql' };
        } catch (err) {
            if (ehErroDeConexao(err)) {
                this.isConnected = false;
                this.enfileirarSincronizacao({ tipo: 'produto_excluir', id: parseInt(id, 10) || id });
                return { sucesso: true, fonte: 'local_json', pendente: true };
            }
            console.error('[DB] Erro ao deletar produto no PostgreSQL:', err.message);
            throw new Error('Não foi possível excluir o produto no banco de dados: ' + err.message);
        }
    }

    // =========================================================================
    // PEDIDOS (tb_pedidos)
    // =========================================================================
    async salvarPedido(novoPedido) {
        let pedidos = this.readJson('pedidos.json', []);
        pedidos.unshift(novoPedido);
        this.writeJson('pedidos.json', pedidos);

        if (!this.isConnected) {
            return { sucesso: true, pedido: novoPedido, fonte: 'local_json' };
        }

        try {
            const sql = `
                INSERT INTO tb_pedidos (
                    codigo_pedido, token_acesso, cliente_nome, cliente_telefone,
                    tipo_entrega, endereco, forma_pagamento, troco_para,
                    observacoes, itens, subtotal, taxa_entrega, total,
                    status, origem, criado_em, atualizado_em
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                RETURNING *;
            `;
            const res = await this.query(sql, [
                novoPedido.codigo_pedido,
                novoPedido.token_acesso,
                novoPedido.cliente_nome,
                novoPedido.cliente_telefone,
                novoPedido.tipo_entrega,
                JSON.stringify(novoPedido.endereco || {}),
                novoPedido.forma_pagamento,
                novoPedido.troco_para || '',
                novoPedido.observacoes || '',
                JSON.stringify(novoPedido.itens || []),
                parseFloat(novoPedido.subtotal) || 0,
                parseFloat(novoPedido.taxa_entrega) || 0,
                parseFloat(novoPedido.total) || 0,
                novoPedido.status || 'novo',
                'catalogo_web'
            ]);

            return { sucesso: true, pedido: res.rows[0], fonte: 'postgresql' };
        } catch (err) {
            console.error('[DB] Erro ao salvar pedido no PostgreSQL:', err.message);
            return { sucesso: true, pedido: novoPedido, fonte: 'local_json' };
        }
    }

    async listarPedidos() {
        const fallback = this.readJson('pedidos.json', []);

        if (!this.isConnected) {
            return { pedidos: fallback, fonte: 'local_json' };
        }

        try {
            const res = await this.query("SELECT * FROM tb_pedidos ORDER BY criado_em DESC");
            const pedidos = res.rows.map(p => ({
                id: p.id,
                codigo_pedido: p.codigo_pedido,
                token_acesso: p.token_acesso,
                cliente_nome: p.cliente_nome,
                cliente_telefone: p.cliente_telefone,
                tipo_entrega: p.tipo_entrega,
                endereco: typeof p.endereco === 'string' ? JSON.parse(p.endereco) : p.endereco,
                forma_pagamento: p.forma_pagamento,
                troco_para: p.troco_para,
                observacoes: p.observacoes,
                itens: typeof p.itens === 'string' ? JSON.parse(p.itens) : p.itens,
                subtotal: parseFloat(p.subtotal),
                taxa_entrega: parseFloat(p.taxa_entrega),
                total: parseFloat(p.total),
                status: p.status,
                criado_em: p.criado_em,
                atualizado_em: p.atualizado_em
            }));
            this.writeJson('pedidos.json', pedidos);
            return { pedidos, fonte: 'postgresql' };
        } catch (err) {
            console.warn('[DB] Erro ao listar pedidos no PostgreSQL:', err.message);
            return { pedidos: fallback, fonte: 'local_json' };
        }
    }

    async atualizarStatusPedido(codigoPedido, novoStatus) {
        let pedidos = this.readJson('pedidos.json', []);
        const idx = pedidos.findIndex(p => p.codigo_pedido === codigoPedido);
        if (idx !== -1) {
            pedidos[idx].status = novoStatus;
            pedidos[idx].atualizado_em = new Date().toISOString();
            this.writeJson('pedidos.json', pedidos);
        }

        if (!this.isConnected) {
            return { sucesso: true, status: novoStatus, fonte: 'local_json' };
        }

        try {
            await this.query(`
                UPDATE tb_pedidos
                SET status = $1, atualizado_em = CURRENT_TIMESTAMP
                WHERE codigo_pedido = $2
            `, [novoStatus, codigoPedido]);
            return { sucesso: true, status: novoStatus, fonte: 'postgresql' };
        } catch (err) {
            console.error('[DB] Erro ao atualizar status do pedido no PostgreSQL:', err.message);
            return { sucesso: true, status: novoStatus, fonte: 'local_json' };
        }
    }

    async obterPedidoPorCodigo(codigoOuToken) {
        const fallback = this.readJson('pedidos.json', []);
        const local = fallback.find(p => p.codigo_pedido === codigoOuToken || p.token_acesso === codigoOuToken);

        if (!this.isConnected) {
            return local || null;
        }

        try {
            const res = await this.query(`
                SELECT * FROM tb_pedidos
                WHERE codigo_pedido = $1 OR token_acesso = $1
                LIMIT 1
            `, [codigoOuToken]);

            if (res.rows.length === 0) return local || null;

            const p = res.rows[0];
            return {
                id: p.id,
                codigo_pedido: p.codigo_pedido,
                token_acesso: p.token_acesso,
                cliente_nome: p.cliente_nome,
                cliente_telefone: p.cliente_telefone,
                tipo_entrega: p.tipo_entrega,
                endereco: typeof p.endereco === 'string' ? JSON.parse(p.endereco) : p.endereco,
                forma_pagamento: p.forma_pagamento,
                troco_para: p.troco_para,
                observacoes: p.observacoes,
                itens: typeof p.itens === 'string' ? JSON.parse(p.itens) : p.itens,
                subtotal: parseFloat(p.subtotal),
                taxa_entrega: parseFloat(p.taxa_entrega),
                total: parseFloat(p.total),
                status: p.status,
                criado_em: p.criado_em,
                atualizado_em: p.atualizado_em
            };
        } catch (err) {
            return local || null;
        }
    }

    // 5. Landing Pages dos Produtos
    async listarLandingPages() {
        const defaultList = [
            {
                slug: "mel-com-favo",
                titulo: "Mel com Favo Nobre 500g",
                categoria: "Méis Nobres",
                arquivo_html: "mel-com-favo.html",
                url: "/mel-com-favo",
                foto_principal: "/assets/products/Mel-com-favo-500g.webp",
                foto_thumb1: "/assets/products/Mel-com-favo-500g.webp",
                foto_thumb2: "/assets/products/Favo-de-mel-em-quadro.webp",
                foto_thumb3: "/assets/images/kit-presente-500w.webp"
            },
            {
                slug: "propolis-vermelha",
                titulo: "Própolis Vermelha Nobre 20ml",
                categoria: "Própolis & Saúde",
                arquivo_html: "propolis-vermelha.html",
                url: "/propolis-vermelha",
                foto_principal: "/assets/products/Propolis-vermelha-20ml.webp",
                foto_thumb1: "/assets/products/Propolis-vermelha-20ml.webp",
                foto_thumb2: "/assets/products/Propolis-verde-20ml.webp",
                foto_thumb3: "/assets/images/kit-presente-500w.webp"
            },
            {
                slug: "propolis-verde",
                titulo: "Própolis Verde Pura 20ml",
                categoria: "Própolis & Saúde",
                arquivo_html: "propolis-verde.html",
                url: "/propolis-verde",
                foto_principal: "/assets/products/Propolis-verde-20ml.webp",
                foto_thumb1: "/assets/products/Propolis-verde-20ml.webp",
                foto_thumb2: "/assets/products/Propolis-vermelha-20ml.webp",
                foto_thumb3: "/assets/products/Mel-in-natura-500g.webp"
            },
            {
                slug: "mel-de-urucu",
                titulo: "Mel de Abelha Uruçu 280g (Nativa)",
                categoria: "Méis Nobres",
                arquivo_html: "mel-de-urucu.html",
                url: "/mel-de-urucu",
                foto_principal: "/assets/products/Mel-in-natura-280g.webp",
                foto_thumb1: "/assets/products/Mel-in-natura-280g.webp",
                foto_thumb2: "/assets/products/Mel-com-favo-500g.webp",
                foto_thumb3: "/assets/products/Polen-apicola-140g.webp"
            },
            {
                slug: "mel-silvestre",
                titulo: "Mel Silvestre in Natura 500g",
                categoria: "Méis Nobres",
                arquivo_html: "mel-silvestre.html",
                url: "/mel-silvestre",
                foto_principal: "/assets/products/Mel-in-natura-500g.webp",
                foto_thumb1: "/assets/products/Mel-in-natura-500g.webp",
                foto_thumb2: "/assets/products/Mel-in-Natura-1400g.webp",
                foto_thumb3: "/assets/products/Mel-cristalizado.webp"
            },
            {
                slug: "polen-apicola",
                titulo: "Pólen Apícola Desidratado 140g",
                categoria: "Superalimentos",
                arquivo_html: "polen-apicola.html",
                url: "/polen-apicola",
                foto_principal: "/assets/products/Polen-apicola-140g.webp",
                foto_thumb1: "/assets/products/Polen-apicola-140g.webp",
                foto_thumb2: "/assets/products/Mel-in-natura-500g.webp",
                foto_thumb3: "/assets/products/Mel-com-favo-500g.webp"
            },
            {
                slug: "kit-presente",
                titulo: "Kit Presente Degustação & Madeira Artesanal",
                categoria: "Kits & Especiais",
                arquivo_html: "kit-presente.html",
                url: "/kit-presente",
                foto_principal: "/assets/products/Kit-presente.webp",
                foto_thumb1: "/assets/products/Kit-presente.webp",
                foto_thumb2: "/assets/products/Mel-com-favo-500g.webp",
                foto_thumb3: "/assets/products/Kit-de-sabinete-terapeutico.webp"
            },
            {
                slug: "resgate-de-abelhas",
                titulo: "Resgate e Captura Ecológica de Abelhas",
                categoria: "Serviços Especializados",
                arquivo_html: "resgate-de-abelhas.html",
                url: "/resgate-de-abelhas",
                foto_principal: "/assets/products/Foto-no-apiario-1.webp",
                foto_thumb1: "/assets/products/Foto-no-apiario-1.webp",
                foto_thumb2: "/assets/products/Fumigador.webp",
                foto_thumb3: "/assets/products/Caixa-de-abelha-nativa-urucu.webp"
            },
            {
                slug: "consultoria-apicola",
                titulo: "Consultoria Apícola & Implantação de Apiários",
                categoria: "Serviços Especializados",
                arquivo_html: "consultoria-apicola.html",
                url: "/consultoria-apicola",
                foto_principal: "/assets/products/Foto-no-apiario.webp",
                foto_thumb1: "/assets/products/Foto-no-apiario.webp",
                foto_thumb2: "/assets/products/Caixa-de-abelha-nativa-urucu.webp",
                foto_thumb3: "/assets/products/Fumigador.webp"
            }
        ];

        let pages = this.readJson('landing_pages.json', null);
        if (!pages || !Array.isArray(pages) || pages.length === 0) {
            this.writeJson('landing_pages.json', defaultList);
            pages = defaultList;
        }
        return { paginas: pages, fonte: 'local_json' };
    }

    async obterLandingPage(slug) {
        const { paginas } = await this.listarLandingPages();
        return paginas.find(p => p.slug === slug) || null;
    }

    async salvarLandingPage(slug, novosDados) {
        const { paginas } = await this.listarLandingPages();
        const idx = paginas.findIndex(p => p.slug === slug);
        if (idx === -1) {
            throw new Error(`Página com slug "${slug}" não encontrada.`);
        }

        const atual = paginas[idx];
        const atualizado = {
            ...atual,
            ...novosDados,
            slug: atual.slug,
            arquivo_html: atual.arquivo_html,
            url: atual.url,
            atualizado_em: new Date().toISOString()
        };

        paginas[idx] = atualizado;
        this.writeJson('landing_pages.json', paginas);
        return { pagina: atualizado, fonte: 'local_json' };
    }

    getStatus() {
        return {
            conectado: this.isConnected,
            driver: 'PostgreSQL',
            host: process.env.DB_HOST || 'localhost',
            banco: process.env.DB_NAME || 'evolution_db',
            porta: parseInt(process.env.DB_PORT, 10) || 5432
        };
    }
}

module.exports = new DatabaseAdapter();
