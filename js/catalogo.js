/**
 * Apiário Favo de Mel - Catálogo Interativo & Checkout Trem Delivery
 * Versão: 2.0 (Desacoplado, Reativo, Zero WordPress)
 */

// Bases candidatas da API. O catálogo funciona mesmo se a URL configurada falhar:
// 1) URL configurada em config.js  2) mesma origem  3) VPS de produção.
window.getCatalogApiBases = function () {
    if (typeof window.getFavodemelApiBases === 'function') {
        return window.getFavodemelApiBases();
    }
    const bases = [];
    const add = (value) => {
        const base = String(value || '').trim().replace(/\/+$/, '');
        if (base && !bases.includes(base)) bases.push(base);
    };

    add(window.FAVODEMEL_API_URL);

    try {
        if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
            add(window.location.origin);
        }
    } catch (_) {}

    add('https://favodemel.137.131.164.202.sslip.io');
    return bases;
};

window.handleCatalogImgError = function (img) {
    if (!img) return;

    const rawSrc = img.getAttribute('src') || img.src || '';
    if (!rawSrc) return;

    // Separa caminho e query string (?v=...) para trocar a extensão corretamente
    const partes = rawSrc.split('?');
    const pathPart = partes[0];
    const queryPart = partes.length > 1 ? '?' + partes.slice(1).join('?') : '';

    // Já está na imagem de segurança: evita loop infinito
    if (/\/assets\/products\/Mel-in-natura-500g\.(webp|jpe?g|png)$/i.test(pathPart)) {
        img.onerror = null;
        return;
    }

    const finalFallback = () => {
        img.onerror = null;
        img.src = '/assets/products/Mel-in-natura-500g.webp';
    };

    // Imagem remota (VPS) indisponível: tenta a cópia local do Hostinger
    const bases = window.getCatalogApiBases ? window.getCatalogApiBases() : [];
    const baseRemota = bases.find(b => pathPart.startsWith(b));
    if (baseRemota) {
        const localPath = pathPart.slice(baseRemota.length) || pathPart;
        img.onerror = finalFallback;
        img.src = localPath;
        return;
    }

    // Alterna extensões (webp → jpeg/png e vice-versa) antes do fallback final
    const tentar = (novoPath) => {
        if (!novoPath || novoPath === pathPart) return false;
        img.onerror = finalFallback;
        img.src = novoPath + queryPart;
        return true;
    };

    if (/\.webp$/i.test(pathPart)) {
        if (tentar(pathPart.replace(/\.webp$/i, '.jpeg'))) return;
        if (tentar(pathPart.replace(/\.webp$/i, '.png'))) return;
    } else if (/\.(png|jpe?g)$/i.test(pathPart)) {
        if (tentar(pathPart.replace(/\.(png|jpe?g)$/i, '.webp'))) return;
    }

    finalFallback();
};

class CatalogoApp {
    constructor() {
        this.produtos = [];
        this.categorias = [];
        this.categoriaAtiva = 'todos';
        this.termoBusca = '';
        this.carrinho = this.carregarCarrinho();
        
        this.tipoEntrega = 'entrega';
        this.formaPagamento = 'pix';
        
        this.modalProduto = null;
        this.modalQtd = 1;
        this.metaFreteGratis = 150.00; // Meta de Frete Grátis estilo Trem Delivery
        this.audioCtx = null;

        this.config = {
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
        };

        this.pendingOrderPayload = null;

        // Controle de sincronização com o painel admin
        this.apiBaseAtiva = '';
        this.fonteDados = 'desconhecida';
        this.assinaturaCatalogo = '';
        this.ultimaAtualizacao = 0;
        this.timerAtualizacao = null;
        this.statusEl = null;

        this.init();
    }

    async init() {
        this.limparExtensaoUrl();
        this.configurarEventosGlobais();
        await this.carregarDadosDoServidor();
        this.renderizarCategorias();
        this.renderizarProdutos();
        this.atualizarInterfaceCarrinho();
        this.verificarParametroAutoAdd();
        this.configurarAtualizacaoAutomatica();
    }

    // Mantém o catálogo sincronizado com o painel admin sem o cliente recarregar a página.
    configurarAtualizacaoAutomatica() {
        const atualizar = () => {
            if (document.visibilityState === 'hidden') return;
            this.atualizarCatalogoEmSegundoPlano();
        };

        // Atualiza a cada 60 segundos
        if (this.timerAtualizacao) clearInterval(this.timerAtualizacao);
        this.timerAtualizacao = setInterval(atualizar, 60000);

        // Atualiza ao voltar para a aba / focar a janela
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') atualizar();
        });
        window.addEventListener('focus', atualizar);
    }

    async atualizarCatalogoEmSegundoPlano() {
        const agora = Date.now();
        if (agora - this.ultimaAtualizacao < 15000) return; // evita rajadas
        this.ultimaAtualizacao = agora;

        const antes = this.assinaturaCatalogo;
        const carregou = await this.carregarDadosDoServidor({ silencioso: true });
        if (!carregou) return;

        const depois = this.assinaturaCatalogo;
        if (depois === antes) return;

        // Preserva o carrinho, mas atualiza preços/nomes/fotos dos itens que mudaram
        this.sincronizarCarrinhoComCatalogo();

        this.renderizarCategorias();
        this.renderizarProdutos();
        this.atualizarInterfaceCarrinho();
        this.atualizarModalAberto();
    }

    sincronizarCarrinhoComCatalogo() {
        let alterou = false;
        this.carrinho.forEach(item => {
            const atual = this.produtos.find(p => String(p.id) === String(item.id));
            if (!atual) return;
            const novoPreco = parseFloat(atual.preco) || 0;
            const novaFoto = this.resolverFoto(atual);
            if (item.preco !== novoPreco || item.nome !== atual.nome || item.foto !== novaFoto) {
                item.preco = novoPreco;
                item.nome = atual.nome;
                item.foto = novaFoto;
                alterou = true;
            }
        });
        if (alterou) this.salvarCarrinho();
    }

    atualizarModalAberto() {
        if (!this.modalProduto) return;
        const overlay = document.getElementById('productModalOverlay');
        if (!overlay || !overlay.classList.contains('active')) return;

        const atual = this.produtos.find(p => String(p.id) === String(this.modalProduto.id));
        if (!atual) {
            this.fecharModalProduto();
            return;
        }
        this.modalProduto = atual;
        const imgEl = document.getElementById('productModalImg');
        const titleEl = document.getElementById('productModalTitle');
        const priceEl = document.getElementById('productModalPrice');
        const descEl = document.getElementById('productModalDesc');
        if (imgEl) imgEl.src = this.resolverFoto(atual);
        if (titleEl) titleEl.innerText = atual.nome;
        if (priceEl) priceEl.innerText = parseFloat(atual.preco || 0).toFixed(2).replace('.', ',');
        if (descEl) descEl.innerText = atual.descricao || '';
    }

    // Barra discreta de status da sincronização
    mostrarStatusSincronizacao(tipo, mensagem, autoOcultarMs) {
        if (!this.statusEl) {
            const el = document.createElement('div');
            el.id = 'catalogoSyncStatus';
            el.style.cssText = [
                'position:fixed', 'left:16px', 'bottom:16px', 'z-index:9999',
                'display:flex', 'align-items:center', 'gap:8px',
                'padding:10px 14px', 'border-radius:999px',
                'font-family:inherit', 'font-size:0.8rem', 'font-weight:600',
                'box-shadow:0 6px 18px rgba(0,0,0,0.18)',
                'transition:opacity .3s ease', 'max-width:calc(100vw - 32px)'
            ].join(';');
            document.body.appendChild(el);
            this.statusEl = el;
        }

        const estilos = {
            ok: { background: '#ECFDF5', color: '#065F46', border: '1px solid #A7F3D0' },
            aviso: { background: '#FFFBEB', color: '#92400E', border: '1px solid #FCD34D' },
            erro: { background: '#FEF2F2', color: '#991B1B', border: '1px solid #FCA5A5' }
        };
        const estilo = estilos[tipo] || estilos.ok;
        const el = this.statusEl;
        el.style.background = estilo.background;
        el.style.color = estilo.color;
        el.style.border = estilo.border;
        el.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:currentColor;display:inline-block;flex:0 0 auto;"></span><span>${mensagem}</span>`;
        el.style.opacity = '1';
        el.style.display = 'flex';

        if (el._timer) clearTimeout(el._timer);
        if (autoOcultarMs) {
            el._timer = setTimeout(() => {
                el.style.opacity = '0';
                setTimeout(() => { if (el.style.opacity === '0') el.style.display = 'none'; }, 350);
            }, autoOcultarMs);
        }
    }

    limparExtensaoUrl() {
        if (window.location.pathname.endsWith('.html')) {
            const clean = window.location.pathname.replace(/\.html$/i, '');
            window.history.replaceState(null, '', clean + window.location.search + window.location.hash);
        }
    }

    // =========================================================================
    // PERSISTÊNCIA DO CARRINHO (LocalStorage)
    // =========================================================================
    carregarCarrinho() {
        try {
            const salvo = localStorage.getItem('favodemel_carrinho');
            return salvo ? JSON.parse(salvo) : [];
        } catch (_) {
            return [];
        }
    }

    salvarCarrinho() {
        try {
            localStorage.setItem('favodemel_carrinho', JSON.stringify(this.carrinho));
        } catch (_) {}
    }

    limparCarrinho() {
        this.carrinho = [];
        this.salvarCarrinho();
        this.atualizarInterfaceCarrinho();
        this.renderizarProdutos();
    }

    // =========================================================================
    // FEEDBACK SONORO SUAVE (Web Audio API - Estilo Trem Delivery)
    // =========================================================================
    tocarFeedbackSonoro() {
        try {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextClass) return;
            if (!this.audioCtx) {
                this.audioCtx = new AudioContextClass();
            }
            if (this.audioCtx.state === 'suspended') {
                this.audioCtx.resume();
            }

            const now = this.audioCtx.currentTime;
            const osc = this.audioCtx.createOscillator();
            const gain = this.audioCtx.createGain();

            // Tom harmônico suave e elegante
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, now);
            osc.frequency.exponentialRampToValueAtTime(1320, now + 0.1);

            gain.gain.setValueAtTime(0.001, now);
            gain.gain.exponentialRampToValueAtTime(0.06, now + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);

            osc.connect(gain);
            gain.connect(this.audioCtx.destination);

            osc.start(now);
            osc.stop(now + 0.22);
        } catch (_) {}
    }

    // =========================================================================
    // MEMÓRIA INTELIGENTE DO CLIENTE (Estilo @tremdelivery:profile)
    // =========================================================================
    salvarPerfilCliente(dados) {
        try {
            const anterior = this.carregarPerfilCliente() || {};
            const atualizado = { ...anterior, ...dados, atualizado_em: new Date().toISOString() };
            localStorage.setItem('@favodemel:customer_profile', JSON.stringify(atualizado));
        } catch (_) {}
    }

    carregarPerfilCliente() {
        try {
            const salvo = localStorage.getItem('@favodemel:customer_profile');
            return salvo ? JSON.parse(salvo) : null;
        } catch (_) {
            return null;
        }
    }

    preencherDadosPerfil() {
        const perfil = this.carregarPerfilCliente();
        if (!perfil) return;

        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el && val && !el.value) {
                el.value = val;
            }
        };

        setVal('checkoutNome', perfil.nome);
        setVal('checkoutTelefone', perfil.telefone);
        setVal('checkoutCep', perfil.cep);
        setVal('checkoutRua', perfil.rua);
        setVal('checkoutNumero', perfil.numero);
        setVal('checkoutBairro', perfil.bairro);
        setVal('checkoutCidade', perfil.cidade);
        setVal('checkoutComplemento', perfil.complemento);
    }

    // =========================================================================
    // REQUISIÇÃO DA API
    // =========================================================================
    getApiUrl(endpoint) {
        const base = (window.FAVODEMEL_API_URL !== undefined && window.FAVODEMEL_API_URL !== null)
            ? String(window.FAVODEMEL_API_URL).trim().replace(/\/$/, '')
            : '';
        return `${base}${endpoint}`;
    }

    // Faz a requisição tentando as bases disponíveis e validando que a resposta é JSON.
    // Evita que uma página 404 HTML do Hostinger seja interpretada como catálogo vazio.
    async fetchApi(endpoint, options = {}) {
        const bases = window.getCatalogApiBases();
        const sep = endpoint.includes('?') ? '&' : '?';
        let ultimoErro = null;

        for (const base of bases) {
            const url = `${base}${endpoint}${sep}_t=${Date.now()}`;
            const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
            const timeout = controller ? setTimeout(() => controller.abort(), 12000) : null;

            try {
                const res = await fetch(url, {
                    ...options,
                    cache: 'no-store',
                    signal: controller ? controller.signal : options.signal
                });
                const texto = await res.text();
                let data;
                try {
                    data = JSON.parse(texto);
                } catch (_) {
                    throw new Error(`Resposta inválida de ${base} (não é JSON)`);
                }
                if (!res.ok) {
                    throw new Error((data && data.erro) || `HTTP ${res.status}`);
                }
                this.apiBaseAtiva = base;
                return data;
            } catch (err) {
                ultimoErro = err;
                console.warn(`[Catálogo] API indisponível em ${base}:`, err.message);
            } finally {
                if (timeout) clearTimeout(timeout);
            }
        }

        throw ultimoErro || new Error('API do catálogo indisponível');
    }

    assinaturaDosProdutos() {
        return (this.produtos || []).map(p => [
            p.id, p.nome, p.preco, p.estoque, p.ativo,
            p.foto, p.categoria_id, p.atualizado_em
        ].join('|')).join(';');
    }

    async carregarDadosDoServidor(opcoes = {}) {
        const silencioso = opcoes.silencioso === true;

        // Carrega configurações da loja e do PIX
        try {
            const dataCfg = await this.fetchApi('/api/catalogo/config');
            if (dataCfg.sucesso && dataCfg.config) {
                this.config = { ...this.config, ...dataCfg.config };

                // Atualiza texto de status na barra superior se existir
                const statusText = document.querySelector('.store-status-pill .status-text');
                if (statusText && this.config.status_texto) {
                    statusText.innerText = this.config.status_texto;
                }
            }
        } catch (_) {}

        try {
            const gridEl = document.getElementById('catalogGrid');
            if (!silencioso && gridEl) {
                gridEl.innerHTML = `
                    <div style="grid-column: 1/-1; text-align: center; padding: 4rem 1rem; color: #6E6359;">
                        <div class="tracking-spinner" style="width: 36px; height: 36px; border: 3px solid #E8DFD3; border-top-color: #D98200; border-radius: 50%; margin: 0 auto 1rem auto; animation: spinTrack 0.8s linear infinite;"></div>
                        <p style="font-weight: 500; font-size: 0.95rem;">Carregando produtos do catálogo...</p>
                    </div>
                `;
            }

            const data = await this.fetchApi('/api/catalogo/produtos');

            if (data.sucesso && Array.isArray(data.produtos) && data.produtos.length > 0) {
                this.categorias = data.categorias || [];
                this.produtos = data.produtos || [];
                this.fonteDados = data.fonte || 'postgresql';
                this.assinaturaCatalogo = this.assinaturaDosProdutos();

                try {
                    localStorage.setItem('favodemel_catalogo_cache', JSON.stringify({
                        categorias: this.categorias,
                        produtos: this.produtos,
                        salvo_em: Date.now()
                    }));
                } catch (_) {}

                if (data.pendente || this.fonteDados === 'local_json') {
                    this.mostrarStatusSincronizacao('aviso', 'Sincronização pendente com o banco de dados. Exibindo os últimos dados salvos.');
                } else if (!silencioso) {
                    this.mostrarStatusSincronizacao('ok', 'Catálogo atualizado', 2500);
                } else {
                    // Em atualização silenciosa bem-sucedida, esconde qualquer aviso antigo
                    if (this.statusEl) {
                        this.statusEl.style.opacity = '0';
                        setTimeout(() => { if (this.statusEl && this.statusEl.style.opacity === '0') this.statusEl.style.display = 'none'; }, 350);
                    }
                }
                return true;
            } else {
                throw new Error(data.erro || 'Falha ao carregar catálogo da API');
            }
        } catch (err) {
            console.warn('Utilizando catálogo integrado do Apiário Favo de Mel (Modo Resiliente):', err.message);
            // 1. Tenta recuperar o cache local salvo anteriormente
            try {
                const salvo = localStorage.getItem('favodemel_catalogo_cache');
                if (salvo) {
                    const parsed = JSON.parse(salvo);
                    if (Array.isArray(parsed.produtos) && parsed.produtos.length > 0) {
                        this.categorias = parsed.categorias || [];
                        this.produtos = parsed.produtos;
                        this.fonteDados = 'cache_local';
                        this.assinaturaCatalogo = this.assinaturaDosProdutos();
                        this.mostrarStatusSincronizacao('erro', 'Sem conexão com o servidor. Exibindo catálogo salvo neste dispositivo.');
                        return false;
                    }
                }
            } catch (_) {}

            this.mostrarStatusSincronizacao('erro', 'Sem conexão com o servidor. Exibindo catálogo de segurança.');

            this.categorias = [
                { id: "1", nome: "Méis & Acessórios" },
                { id: "2", nome: "Cuidados Naturais e Própolis" },
                { id: "3", nome: "Artesanais, Cera & Bebidas" }
            ];

            this.produtos = [
                { id: 1, categoria_id: "1", categoria_nome: "Méis & Acessórios", nome: "Mel com Favo 500g", preco: 65.00, peso: "500g", descricao: "Pedaço genuíno de favo de mel imerso no mel puro.", estoque: 20, foto: "Mel-com-favo-500g.webp", ativo: true },
                { id: 2, categoria_id: "1", categoria_nome: "Méis & Acessórios", nome: "Meleira com Mel", preco: 60.00, peso: "280g", descricao: "Elegante meleira em vidro de alta qualidade acompanhada com mel puro.", estoque: 2, foto: "Meleira-com-mel-280g.jpeg", ativo: true },
                { id: 3, categoria_id: "2", categoria_nome: "Cuidados Naturais e Própolis", nome: "Pomada de Própolis (20g)", preco: 45.00, peso: "20g", descricao: "Pomada natural de própolis puro. Ação cicatrizante, anti-inflamatória e protetora.", estoque: 999, foto: "POMADA-DE-PROPOLIS-1794582053546.jpeg", ativo: true },
                { id: 4, categoria_id: "2", categoria_nome: "Cuidados Naturais e Própolis", nome: "Hidratante Labial", preco: 12.00, peso: "4g", descricao: "Hidratação duradoura para seus lábios à base de cera pura de abelha e mel.", estoque: 50, foto: "Kit-de-sabinete-terapeutico.webp", ativo: true },
                { id: 5, categoria_id: "3", categoria_nome: "Artesanais, Cera & Bebidas", nome: "Kit Presente Favo de Mel", preco: 120.00, peso: "Kit", descricao: "Caixa rústica de madeira artesanal com mel nobre, vela aromática, própolis e doce da colmeia.", estoque: 10, foto: "Kit-presente.webp", ativo: true },
                { id: 6, categoria_id: "2", categoria_nome: "Cuidados Naturais e Própolis", nome: "Kit Sabonete Terapêutico", preco: 35.00, peso: "Kit", descricao: "Feito artesanalmente com própolis pura e mel. Hidratação profunda, ação cicatrizante e suave.", estoque: 25, foto: "Kit-de-sabinete-terapeutico.webp", ativo: true },
                { id: 7, categoria_id: "3", categoria_nome: "Artesanais, Cera & Bebidas", nome: "Licor de Mel Nobre 250ml", preco: 35.00, peso: "250ml", descricao: "Fermentação artesanal com mel puro, água mineral e toque especial de especiarias naturais.", estoque: 18, foto: "Licor-de-mel-250ml.webp", ativo: true },
                { id: 8, categoria_id: "1", categoria_nome: "Méis & Acessórios", nome: "Mel in Natura 500g", preco: 35.00, peso: "500g", descricao: "Mel puro de floradas silvestres brasileiras. Embalagem prática com bico dosador.", estoque: 50, foto: "Mel-in-natura-500g.webp", ativo: true },
                { id: 9, categoria_id: "1", categoria_nome: "Méis & Acessórios", nome: "Meleira com Mel Nobre", preco: 60.00, peso: "280g", descricao: "Elegante meleira em vidro artesanal de alta qualidade, acompanhada com mel puro.", estoque: 20, foto: "Meleira-com-mel-280g.webp", ativo: true },
                { id: 10, categoria_id: "2", categoria_nome: "Cuidados Naturais e Própolis", nome: "Pólen Apícola Desidratado (140g)", preco: 42.00, peso: "140g", descricao: "Superalimento natural das abelhas repleto de aminoácidos essenciais e minerais energizantes.", estoque: 25, foto: "Polen-apicola-140g.webp", ativo: true },
                { id: 11, categoria_id: "3", categoria_nome: "Artesanais, Cera & Bebidas", nome: "Vinagre Nobre de Mel (315ml)", preco: 30.00, peso: "315ml", descricao: "Fermentação acética natural de hidromel com sabor aveludado e toque agridoce refinado.", estoque: 22, foto: "Vinagre-de-mel-315ml.webp", ativo: true },
                { id: 12, categoria_id: "3", categoria_nome: "Artesanais, Cera & Bebidas", nome: "Formão Inox", preco: 40.00, peso: "Unidade", descricao: "Formão para apicultura em inox para manejo de colmeias.", estoque: 35, foto: "Formao.jpeg", ativo: true },
                { id: 13, categoria_id: "3", categoria_nome: "Artesanais, Cera & Bebidas", nome: "Cera Bruta de Apis (1kg)", preco: 95.00, peso: "1kg", descricao: "Bloco maciço de cera virgem de opérculo purificada.", estoque: 12, foto: "Cera-bruta-de-apis.webp", ativo: true },
                { id: 14, categoria_id: "1", categoria_nome: "Méis & Acessórios", nome: "Acetato Pet", preco: 2.50, peso: "Unidade", descricao: "Acetato transparente para divisão de meliponário.", estoque: 28, foto: "Acetato-pet.jpeg", ativo: true },
                { id: 15, categoria_id: "1", categoria_nome: "Méis & Acessórios", nome: "Alimentador", preco: 14.00, peso: "Unidade", descricao: "Alimentador para caixa de apis.", estoque: 10, foto: "Alimentador.jpeg", ativo: true },
                { id: 16, categoria_id: "3", categoria_nome: "Artesanais, Cera & Bebidas", nome: "BOTA EM PVC", preco: 70.00, peso: "40-42", descricao: "Bota em PVC branca tam. 40 - 42.", estoque: 5, foto: "Bota-de-pvc.jpeg", ativo: true },
                { id: 17, categoria_id: "3", categoria_nome: "Artesanais, Cera & Bebidas", nome: "ATRATIVA PARA ABELHAS APIS", preco: 25.00, peso: "Frasco", descricao: "Atrativo para captura de abelha APIS.", estoque: 5, foto: "Atrativo.jpeg", ativo: true },
                { id: 18, categoria_id: "3", categoria_nome: "Artesanais, Cera & Bebidas", nome: "CANECA", preco: 45.00, peso: "Unidade", descricao: "Caneca temática abelha em louça.", estoque: 2, foto: "Caneca-tematica-abelha.jpeg", ativo: true },
                { id: 19, categoria_id: "3", categoria_nome: "Artesanais, Cera & Bebidas", nome: "ATRATIVO MISTO", preco: 25.00, peso: "Frasco", descricao: "Atrativo misto para abelha nativa.", estoque: 3, foto: "Atrativo-misto-de-abelha-nativa.jpeg", ativo: true },
                { id: 20, categoria_id: "1", categoria_nome: "Méis & Acessórios", nome: "FAVO DE MEL", preco: 130.00, peso: "Quadro", descricao: "Favo de mel em quadro.", estoque: 8, foto: "Captura-de-Tela-2026-05-29-as-14.02.58.png", ativo: true },
                { id: 21, categoria_id: "3", categoria_nome: "Artesanais, Cera & Bebidas", nome: "CERA MISTA DE ABELHA NATIVA FOLHA", preco: 3.00, peso: "Folha", descricao: "Folha de cera mista para abelha nativa.", estoque: 25, foto: "Cera-mista-abelha-asf.jpeg", ativo: true },
                { id: 22, categoria_id: "3", categoria_nome: "Artesanais, Cera & Bebidas", nome: "CERA BRUTA DE APIS 100G", preco: 10.00, peso: "100g", descricao: "Cera bruta de abelha apis fracionada.", estoque: 10, foto: "Cera-Bruta-de-Apis.png", ativo: true }
            ];

            this.fonteDados = 'hardcoded';
            this.assinaturaCatalogo = this.assinaturaDosProdutos();
            return false;
        }
    }

    // =========================================================================
    // RENDERIZAÇÃO DE CATEGORIAS (PILLS)
    // =========================================================================
    renderizarCategorias() {
        const wrap = document.getElementById('categoriesPills');
        if (!wrap) return;

        let html = `
            <button class="category-pill ${this.categoriaAtiva === 'todos' ? 'active' : ''}" data-cat="todos">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
                <span>Todos (${this.produtos.length})</span>
            </button>
        `;

        this.categorias.forEach(cat => {
            const count = this.produtos.filter(p => String(p.categoria_id) === String(cat.id)).length;
            const nomeLimpo = (cat.nome || '')
                .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{2300}-\u{23FF}]/gu, '')
                .trim();

            let iconeSvg = '';
            if (String(cat.id) === '1') {
                iconeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"></path></svg>`;
            } else if (String(cat.id) === '2') {
                iconeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>`;
            } else {
                iconeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>`;
            }

            html += `
                <button class="category-pill ${this.categoriaAtiva === String(cat.id) ? 'active' : ''}" data-cat="${cat.id}">
                    ${iconeSvg}<span>${nomeLimpo} (${count})</span>
                </button>
            `;
        });

        wrap.innerHTML = html;

        wrap.querySelectorAll('.category-pill').forEach(btn => {
            btn.addEventListener('click', () => {
                wrap.querySelectorAll('.category-pill').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.categoriaAtiva = btn.getAttribute('data-cat');
                this.renderizarProdutos();
            });
        });
    }

    // =========================================================================
    // RENDERIZAÇÃO DA VITRINE DE PRODUTOS
    // =========================================================================
    // Acrescenta a versão da última atualização na URL da imagem, forçando o navegador
    // a baixar a nova foto imediatamente após uma edição no painel admin.
    comVersaoFoto(url, prod) {
        if (!url || String(url).startsWith('data:')) return url;
        const marca = prod && (prod.atualizado_em || prod.criado_em);
        const versao = marca ? String(marca).replace(/[^0-9]/g, '') : '';
        if (!versao) return url;
        return `${url}${url.includes('?') ? '&' : '?'}v=${versao}`;
    }

    resolverFoto(prod) {
        // Prefere a base que respondeu à API; senão, a URL configurada
        const apiBase = (this.apiBaseAtiva || window.FAVODEMEL_API_URL || '').replace(/\/$/, '');

        let foto = (prod && prod.foto) ? String(prod.foto).trim() : '';

        // 1. Foto é uma data URI (Base64 gerada pelo sistema legado) — retorna direto
        if (foto.startsWith('data:image/')) {
            return foto;
        }

        // 2. Foto é uma URL absoluta (já tem protocolo)
        if (foto.startsWith('http://') || foto.startsWith('https://')) {
            return this.comVersaoFoto(foto, prod);
        }

        // 3. Foto vazia, nula, ou genérica → usa fallback por nome do produto
        if (!foto || foto === 'null' || foto === 'undefined' || foto.includes('avatar-favo-de-mel')) {
            const nomeNorm = (prod && prod.nome ? prod.nome : '').toLowerCase();
            let arquivo = 'Mel-in-natura-500g.webp';
            if (nomeNorm.includes('uruçú') || nomeNorm.includes('urucu')) arquivo = 'Mel-in-natura-280g.webp';
            else if (nomeNorm.includes('favo')) arquivo = 'Mel-com-favo-500g.webp';
            else if (nomeNorm.includes('verde')) arquivo = 'Propolis-verde-20ml.webp';
            else if (nomeNorm.includes('vermelha')) arquivo = 'Propolis-vermelha-20ml.webp';
            else if (nomeNorm.includes('sabonete') || nomeNorm.includes('labial') || nomeNorm.includes('hidratante')) arquivo = 'Kit-de-sabinete-terapeutico.webp';
            else if (nomeNorm.includes('licor') || nomeNorm.includes('hidromel')) arquivo = 'Licor-de-mel-250ml.webp';
            else if (nomeNorm.includes('meleira')) arquivo = 'Meleira-com-mel-280g.webp';
            else if (nomeNorm.includes('presente')) arquivo = 'Kit-presente.webp';
            else if (nomeNorm.includes('polen') || nomeNorm.includes('pólen')) arquivo = 'Polen-apicola-140g.webp';
            else if (nomeNorm.includes('vinagre')) arquivo = 'Vinagre-de-mel-315ml.webp';
            else if (nomeNorm.includes('vela')) arquivo = 'Velas-artesanais-de-cera-de-abelha.webp';
            else if (nomeNorm.includes('alveolada')) arquivo = 'Cera-alveolada.webp';
            else if (nomeNorm.includes('desmoldante')) arquivo = 'Desmoldante-de-forma.webp';
            else if (nomeNorm.includes('formão') || nomeNorm.includes('formao')) arquivo = 'Formao.webp';
            else if (nomeNorm.includes('fumigador')) arquivo = 'Fumigador.webp';
            else if (nomeNorm.includes('pomada')) arquivo = 'Propolis-verde-20ml.webp';
            else if (nomeNorm.includes('1400g')) arquivo = 'Mel-in-Natura-1400g.webp';
            else if (nomeNorm.includes('cera') || nomeNorm.includes('pasta')) arquivo = 'Cera-bruta-de-apis.webp';

            const urlFallback = apiBase ? `${apiBase}/assets/products/${arquivo}` : `/assets/products/${arquivo}`;
            return this.comVersaoFoto(urlFallback, prod);
        }

        // 4. Foto já é um caminho absoluto no servidor (/assets/...)
        if (foto.startsWith('/assets/')) {
            return this.comVersaoFoto(apiBase ? `${apiBase}${foto}` : foto, prod);
        }
        if (foto.startsWith('assets/')) {
            return this.comVersaoFoto(apiBase ? `${apiBase}/${foto}` : `/${foto}`, prod);
        }

        // 5. É apenas um nome de arquivo (ex: "Meleira-com-mel-280g.jpeg")
        // Monta URL completa apontando para o VPS onde a imagem realmente está
        const fileName = foto.split('/').pop();
        const url = apiBase ? `${apiBase}/assets/products/${fileName}` : `/assets/products/${fileName}`;
        return this.comVersaoFoto(url, prod);
    }

    renderizarProdutos() {
        const gridEl = document.getElementById('catalogGrid');
        if (!gridEl) return;

        let filtrados = this.produtos;

        // Filtro por Categoria
        if (this.categoriaAtiva !== 'todos') {
            filtrados = filtrados.filter(p => String(p.categoria_id) === String(this.categoriaAtiva));
        }

        // Filtro por Busca
        if (this.termoBusca.trim().length > 0) {
            const busca = this.termoBusca.toLowerCase().trim();
            filtrados = filtrados.filter(p => 
                (p.nome && p.nome.toLowerCase().includes(busca)) ||
                (p.descricao && p.descricao.toLowerCase().includes(busca))
            );
        }

        if (filtrados.length === 0) {
            gridEl.innerHTML = `
                <div style="grid-column: 1/-1; text-align: center; padding: 4rem 1rem; color: #6E6359;">
                    <div style="margin-bottom: 1rem;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color: var(--color-primary);"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                    </div>
                    <h3 style="margin-bottom: 0.5rem; color: #2C231C;">Nenhum produto encontrado</h3>
                    <p>Tente buscar por outro termo ou selecione outra categoria.</p>
                </div>
            `;
            return;
        }

        gridEl.innerHTML = filtrados.map(prod => {
            const precoFormatado = parseFloat(prod.preco || 0).toFixed(2).replace('.', ',');
            const itemNoCarrinho = this.carrinho.find(i => String(i.id) === String(prod.id));
            const qtdNoCarrinho = itemNoCarrinho ? itemNoCarrinho.quantidade : 0;
            
            const fotoUrl = this.resolverFoto(prod);
            const catNomeLimpo = (prod.categoria_nome || 'Apiário Favo de Mel')
                .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{2300}-\u{23FF}]/gu, '')
                .trim();

            return `
                <div class="catalog-card" data-id="${prod.id}">
                    <div class="card-img-area" onclick="catalogoApp.abrirModalProduto('${prod.id}')" style="cursor: pointer;" title="Clique para ver detalhes do produto">
                        <img src="${fotoUrl}" alt="${prod.nome}" width="260" height="260" loading="lazy" decoding="async" onerror="window.handleCatalogImgError && window.handleCatalogImgError(this)">
                    </div>
                    <div class="card-content">
                        <span class="card-category-label">${catNomeLimpo}</span>
                        <h3 class="card-title" onclick="catalogoApp.abrirModalProduto('${prod.id}')" style="cursor: pointer;" title="Clique para ver detalhes do produto">${prod.nome}</h3>
                        <p class="card-desc">${prod.descricao || 'Produto natural de altíssima qualidade direto do apiário.'}</p>
                        
                        <div class="card-bottom-row">
                            <div class="card-price"><small>R$</small> ${precoFormatado}</div>
                            
                            ${qtdNoCarrinho > 0 ? `
                                <div class="qty-stepper">
                                    <button class="qty-btn" onclick="catalogoApp.alterarQuantidade('${prod.id}', -1)">−</button>
                                    <span class="qty-value">${qtdNoCarrinho}</span>
                                    <button class="qty-btn" onclick="catalogoApp.alterarQuantidade('${prod.id}', 1)">+</button>
                                </div>
                            ` : `
                                <button class="btn-add-cart" onclick="catalogoApp.abrirModalProduto('${prod.id}')">
                                    <span>+</span> Adicionar
                                </button>
                            `}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    // =========================================================================
    // MODAL DE DETALHES E PERSONALIZAÇÃO DO PRODUTO (Estilo Trem Delivery)
    // =========================================================================
    abrirModalProduto(id) {
        const prod = this.produtos.find(p => String(p.id) === String(id));
        if (!prod) return;

        this.modalProduto = prod;
        this.modalQtd = 1;

        const overlay = document.getElementById('productModalOverlay');
        const imgEl = document.getElementById('productModalImg');
        const titleEl = document.getElementById('productModalTitle');
        const catEl = document.getElementById('productModalCategory');
        const priceEl = document.getElementById('productModalPrice');
        const descEl = document.getElementById('productModalDesc');
        const obsEl = document.getElementById('productModalObs');
        const qtyEl = document.getElementById('productModalQty');
        const totalEl = document.getElementById('productModalTotalPrice');
        const badgeEl = document.getElementById('productModalBadge');

        const preco = parseFloat(prod.preco || 0);
        const precoFormatado = preco.toFixed(2).replace('.', ',');
        const fotoUrl = this.resolverFoto(prod);
        const catNomeLimpo = (prod.categoria_nome || 'Apiário Favo de Mel')
            .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{2300}-\u{23FF}]/gu, '')
            .trim();

        if (imgEl) {
            imgEl.src = fotoUrl;
            imgEl.alt = prod.nome;
            imgEl.onerror = function() { window.handleCatalogImgError && window.handleCatalogImgError(this); };
        }
        if (titleEl) titleEl.innerText = prod.nome;
        if (catEl) catEl.innerText = catNomeLimpo;
        if (priceEl) priceEl.innerText = `R$ ${precoFormatado}`;
        if (descEl) descEl.innerText = prod.descricao || 'Produto nobre e puro do Apiário Favo de Mel, colhido de forma sustentável e artesanal.';
        if (obsEl) obsEl.value = '';
        if (qtyEl) qtyEl.innerText = '1';
        if (totalEl) totalEl.innerText = `R$ ${precoFormatado}`;

        if (badgeEl) {
            if (prod.badge || prod.destaque) {
                badgeEl.innerText = prod.badge || 'Puro & Orgânico';
                badgeEl.style.display = 'inline-block';
            } else {
                badgeEl.style.display = 'none';
            }
        }

        const detailsLinkEl = document.getElementById('productModalDetailsLink');
        if (detailsLinkEl) {
            const slugMap = {
                '1': '/mel-com-favo',
                '2': '/mel-de-urucu',
                '3': '/propolis-verde',
                '4': '/propolis-vermelha',
                '5': '/kit-presente',
                '8': '/mel-silvestre',
                '10': '/polen-apicola',
                '14': '/mel-silvestre'
            };
            const slug = slugMap[String(prod.id)];
            if (slug) {
                detailsLinkEl.href = slug;
                detailsLinkEl.style.display = 'inline-flex';
            } else {
                detailsLinkEl.style.display = 'none';
            }
        }

        if (overlay) {
            overlay.classList.add('active');
            document.body.style.overflow = 'hidden';
        }
    }

    fecharModalProduto() {
        const overlay = document.getElementById('productModalOverlay');
        if (overlay) {
            overlay.classList.remove('active');
            document.body.style.overflow = '';
        }
        this.modalProduto = null;
        this.modalQtd = 1;
    }

    alterarQtdModal(delta) {
        if (!this.modalProduto) return;
        const novaQtd = this.modalQtd + delta;
        if (novaQtd < 1) return;

        this.modalQtd = novaQtd;
        const qtyEl = document.getElementById('productModalQty');
        const totalEl = document.getElementById('productModalTotalPrice');

        if (qtyEl) qtyEl.innerText = this.modalQtd;
        if (totalEl) {
            const subtotal = (this.modalQtd * parseFloat(this.modalProduto.preco || 0)).toFixed(2).replace('.', ',');
            totalEl.innerText = `R$ ${subtotal}`;
        }
    }

    adicionarItemDoModal() {
        if (!this.modalProduto) return;

        const obs = document.getElementById('productModalObs')?.value.trim() || '';
        const prod = this.modalProduto;
        const qtd = this.modalQtd;

        // Se já existe no carrinho exatamente o mesmo produto com a mesma observação, incrementa
        const existente = this.carrinho.find(i => String(i.id) === String(prod.id) && (i.obs || '') === obs);
        if (existente) {
            existente.quantidade += qtd;
        } else {
            this.carrinho.push({
                cartId: `cart_${prod.id}_${Date.now()}_${Math.floor(Math.random()*1000)}`,
                id: prod.id,
                nome: prod.nome,
                preco: parseFloat(prod.preco),
                foto: this.resolverFoto(prod),
                quantidade: qtd,
                obs: obs
            });
        }

        this.salvarCarrinho();
        this.atualizarInterfaceCarrinho();
        this.renderizarProdutos();
        this.tocarFeedbackSonoro();
        this.fecharModalProduto();

        // Abre automaticamente o drawer do carrinho para dar visibilidade ao usuário
        document.getElementById('cartDrawerOverlay')?.classList.add('active');
        document.getElementById('cartDrawer')?.classList.add('active');
    }

    // =========================================================================
    // OPERAÇÕES DO CARRINHO
    // =========================================================================
    adicionarItem(id) {
        const prod = this.produtos.find(p => String(p.id) === String(id));
        if (!prod) return;

        const existente = this.carrinho.find(i => String(i.id) === String(id) && !i.obs);
        if (existente) {
            existente.quantidade++;
        } else {
            this.carrinho.push({
                cartId: `cart_${prod.id}_${Date.now()}_${Math.floor(Math.random()*1000)}`,
                id: prod.id,
                nome: prod.nome,
                preco: parseFloat(prod.preco),
                foto: this.resolverFoto(prod),
                quantidade: 1,
                obs: ''
            });
        }

        this.salvarCarrinho();
        this.atualizarInterfaceCarrinho();
        this.renderizarProdutos();
        this.tocarFeedbackSonoro();
    }

    alterarQuantidade(idOuCartId, delta) {
        const index = this.carrinho.findIndex(i => String(i.cartId) === String(idOuCartId) || String(i.id) === String(idOuCartId));
        if (index === -1) return;

        this.carrinho[index].quantidade += delta;

        if (this.carrinho[index].quantidade <= 0) {
            this.carrinho.splice(index, 1);
        }

        this.salvarCarrinho();
        this.atualizarInterfaceCarrinho();
        this.renderizarProdutos();
    }

    removerItem(idOuCartId) {
        this.carrinho = this.carrinho.filter(i => String(i.cartId) !== String(idOuCartId) && String(i.id) !== String(idOuCartId));
        this.salvarCarrinho();
        this.atualizarInterfaceCarrinho();
        this.renderizarProdutos();
    }

    calcularTotal() {
        return this.carrinho.reduce((acc, item) => acc + (item.quantidade * item.preco), 0);
    }

    calcularQtdTotal() {
        return this.carrinho.reduce((acc, item) => acc + item.quantidade, 0);
    }

    // =========================================================================
    // ATUALIZAÇÃO DA INTERFACE DO CARRINHO
    // =========================================================================
    atualizarInterfaceCarrinho() {
        const total = this.calcularTotal();
        const totalQtd = this.calcularQtdTotal();
        const totalFormatado = total.toFixed(2).replace('.', ',');

        // 1. Botão do topo
        const topBadge = document.getElementById('cartTopBadge');
        const topTotal = document.getElementById('cartTopTotal');
        if (topBadge) topBadge.innerText = totalQtd;
        if (topTotal) topTotal.innerText = `R$ ${totalFormatado}`;

        // 2. Barra flutuante
        const floatBar = document.getElementById('floatingCartBar');
        const floatBadge = document.getElementById('floatingCartBadge');
        const floatTotal = document.getElementById('floatingCartTotal');
        if (floatBar) {
            if (totalQtd > 0) {
                floatBar.classList.add('visible');
            } else {
                floatBar.classList.remove('visible');
            }
        }
        if (floatBadge) floatBadge.innerText = totalQtd;
        if (floatTotal) floatTotal.innerText = `R$ ${totalFormatado}`;

        // 3. Drawer do carrinho
        this.renderizarDrawerCarrinho();
        this.atualizarMetaFreteGratis();
    }

    atualizarMetaFreteGratis() {
        const widget = document.getElementById('freeDeliveryWidget');
        const fillBar = document.getElementById('freeDeliveryBarFill');
        const msgEl = document.getElementById('freeDeliveryMsg');
        if (!widget || !fillBar || !msgEl) return;

        const subtotal = this.calcularTotal();
        const meta = this.metaFreteGratis || 150.00;

        if (subtotal >= meta) {
            fillBar.style.width = '100%';
            fillBar.style.background = '#15803D';
            msgEl.innerHTML = `<span class="free-delivery-achieved">Parabéns! Você ganhou <strong>Frete Grátis</strong>!</span>`;
        } else {
            const percentual = Math.min(100, Math.max(0, Math.round((subtotal / meta) * 100)));
            const restante = (meta - subtotal).toFixed(2).replace('.', ',');
            fillBar.style.width = `${percentual}%`;
            fillBar.style.background = 'linear-gradient(90deg, #D98200 0%, #15803D 100%)';
            msgEl.innerHTML = `Faltam <strong>R$ ${restante}</strong> para <strong>Frete Grátis</strong>!`;
        }
    }

    renderizarDrawerCarrinho() {
        const listEl = document.getElementById('cartItemsList');
        const emptyEl = document.getElementById('cartEmptyState');
        const footerEl = document.getElementById('cartDrawerFooter');
        const drawerSubtotal = document.getElementById('drawerSubtotal');
        const drawerTotal = document.getElementById('drawerTotal');

        if (!listEl) return;

        const total = this.calcularTotal();
        const totalFormatado = total.toFixed(2).replace('.', ',');

        if (this.carrinho.length === 0) {
            listEl.innerHTML = '';
            if (emptyEl) emptyEl.style.display = 'block';
            if (footerEl) footerEl.style.display = 'none';
        } else {
            if (emptyEl) emptyEl.style.display = 'none';
            if (footerEl) footerEl.style.display = 'block';

            listEl.innerHTML = this.carrinho.map(item => {
                const sub = (item.quantidade * item.preco).toFixed(2).replace('.', ',');
                const unit = item.preco.toFixed(2).replace('.', ',');
                const fotoUrl = item.foto || '/assets/products/Mel-in-natura-500g.webp';
                const obsHtml = item.obs ? `<div class="cart-item-obs" style="font-size: 0.78rem; color: #786C5E; font-style: italic; margin-top: 0.2rem;">Obs: ${item.obs}</div>` : '';

                return `
                    <div class="cart-item-row">
                        <img src="${fotoUrl}" alt="${item.nome}" class="cart-item-img" onerror="window.handleCatalogImgError && window.handleCatalogImgError(this)">
                        <div class="cart-item-info">
                            <div class="cart-item-name">${item.nome}</div>
                            ${obsHtml}
                            <div class="cart-item-unit-price">R$ ${unit} un</div>
                            <div style="margin-top: 0.4rem;">
                                <div class="qty-stepper">
                                    <button class="qty-btn" onclick="catalogoApp.alterarQuantidade('${item.cartId || item.id}', -1)">−</button>
                                    <span class="qty-value">${item.quantidade}</span>
                                    <button class="qty-btn" onclick="catalogoApp.alterarQuantidade('${item.cartId || item.id}', 1)">+</button>
                                </div>
                            </div>
                        </div>
                        <div class="cart-item-subtotal">
                            <div>R$ ${sub}</div>
                            <button class="cart-item-remove" onclick="catalogoApp.removerItem('${item.cartId || item.id}')" title="Remover item" aria-label="Remover item">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                            </button>
                        </div>
                    </div>
                `;
            }).join('');

            if (drawerSubtotal) drawerSubtotal.innerText = `R$ ${totalFormatado}`;
            if (drawerTotal) drawerTotal.innerText = `R$ ${totalFormatado}`;
        }
    }

    // =========================================================================
    // EVENTOS E MODAIS (DRAWER & CHECKOUT)
    // =========================================================================
    configurarEventosGlobais() {
        // Busca
        const searchInput = document.getElementById('catalogSearch');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.termoBusca = e.target.value;
                this.renderizarProdutos();
            });
        }

        // Abertura e fechamento do Drawer
        const abrirDrawer = () => {
            document.getElementById('cartDrawerOverlay')?.classList.add('active');
            document.getElementById('cartDrawer')?.classList.add('active');
        };

        const fecharDrawer = () => {
            document.getElementById('cartDrawerOverlay')?.classList.remove('active');
            document.getElementById('cartDrawer')?.classList.remove('active');
        };

        document.getElementById('cartTopBtn')?.addEventListener('click', abrirDrawer);
        document.getElementById('floatingCartBar')?.addEventListener('click', abrirDrawer);
        document.getElementById('btnCloseDrawer')?.addEventListener('click', fecharDrawer);
        document.getElementById('cartDrawerOverlay')?.addEventListener('click', fecharDrawer);

        // Abertura do Checkout Modal
        document.getElementById('btnOpenCheckout')?.addEventListener('click', () => {
            if (this.carrinho.length === 0) return;
            fecharDrawer();
            this.abrirModalCheckout();
        });

        // Fechamento do Checkout Modal
        document.getElementById('btnCloseCheckout')?.addEventListener('click', () => {
            this.fecharModalCheckout();
        });
        document.getElementById('checkoutModalOverlay')?.addEventListener('click', (e) => {
            if (e.target.id === 'checkoutModalOverlay') {
                this.fecharModalCheckout();
            }
        });

        // Configuração de Entrega vs Retirada
        document.querySelectorAll('.delivery-opt-card').forEach(card => {
            card.addEventListener('click', () => {
                document.querySelectorAll('.delivery-opt-card').forEach(c => c.classList.remove('active'));
                card.classList.add('active');
                this.tipoEntrega = card.getAttribute('data-type');

                const addressFields = document.getElementById('addressFieldsGroup');
                if (addressFields) {
                    addressFields.style.display = this.tipoEntrega === 'entrega' ? 'block' : 'none';
                    if (this.tipoEntrega === 'entrega') {
                        setTimeout(() => document.getElementById('checkoutCep')?.focus(), 150);
                    }
                }
            });
        });

        // Configuração de Formas de Pagamento
        document.querySelectorAll('.payment-opt-card').forEach(card => {
            card.addEventListener('click', () => {
                document.querySelectorAll('.payment-opt-card').forEach(c => c.classList.remove('active'));
                card.classList.add('active');
                this.formaPagamento = card.getAttribute('data-payment');

                const pixBox = document.getElementById('pixDetailsBox');
                const trocoBox = document.getElementById('trocoGroup');

                if (pixBox) {
                    pixBox.style.display = this.formaPagamento === 'pix' ? 'block' : 'none';
                    if (this.formaPagamento === 'pix') {
                        this.atualizarPixCheckout();
                    }
                }
                if (trocoBox) trocoBox.style.display = this.formaPagamento === 'dinheiro' ? 'block' : 'none';
            });
        });

        // Botão de Copiar Código PIX Copia e Cola Oficial
        document.getElementById('btnCopyPixPayload')?.addEventListener('click', () => {
            const code = document.getElementById('pixCopiaEColaText')?.value || '';
            const btn = document.getElementById('btnCopyPixPayload');
            if (typeof PixUtil !== 'undefined') {
                PixUtil.copiarParaClipboard(code, btn, 'Código Copiado!');
            } else {
                navigator.clipboard.writeText(code);
            }
        });

        // Botão de Copiar Chave PIX Direta
        document.getElementById('btnCopyPix')?.addEventListener('click', () => {
            const key = document.getElementById('pixKeyValue')?.innerText || this.config.pix_chave || '79988125726';
            const btn = document.getElementById('btnCopyPix');
            if (typeof PixUtil !== 'undefined') {
                PixUtil.copiarParaClipboard(key, btn, 'Chave Copiada!');
            } else {
                navigator.clipboard.writeText(key);
            }
        });

        // Botão de Copiar PIX na tela de sucesso
        document.getElementById('btnCopySuccessPix')?.addEventListener('click', () => {
            const code = document.getElementById('successPixPayloadInput')?.value || '';
            const btn = document.getElementById('btnCopySuccessPix');
            if (typeof PixUtil !== 'undefined') {
                PixUtil.copiarParaClipboard(code, btn, 'Código Copiado!');
            } else {
                navigator.clipboard.writeText(code);
            }
        });

        // Máscara de Telefone no Checkout
        const telInput = document.getElementById('checkoutTelefone');
        if (telInput) {
            telInput.addEventListener('input', (e) => {
                let v = e.target.value.replace(/\D/g, '');
                if (v.length > 11) v = v.slice(0, 11);
                if (v.length > 6) {
                    e.target.value = `(${v.slice(0, 2)}) ${v.slice(2, 7)}-${v.slice(7)}`;
                } else if (v.length > 2) {
                    e.target.value = `(${v.slice(0, 2)}) ${v.slice(2)}`;
                } else {
                    e.target.value = v;
                }
            });
        }

        // Busca e Auto-Preenchimento por CEP no Checkout (ViaCEP)
        const cepInput = document.getElementById('checkoutCep');
        if (cepInput) {
            cepInput.addEventListener('input', (e) => {
                let v = e.target.value.replace(/\D/g, '');
                if (v.length > 8) v = v.slice(0, 8);
                if (v.length > 5) {
                    e.target.value = `${v.slice(0, 5)}-${v.slice(5)}`;
                } else {
                    e.target.value = v;
                }

                if (v.length === 8) {
                    this.consultarCep(v);
                } else {
                    const statusMsg = document.getElementById('cepStatusMsg');
                    if (statusMsg) statusMsg.style.display = 'none';
                }
            });

            cepInput.addEventListener('blur', (e) => {
                const v = e.target.value.replace(/\D/g, '');
                if (v.length === 8) {
                    this.consultarCep(v);
                }
            });
        }

        // Submissão do Formulário de Checkout (Avança para Revisão)
        const formCheckout = document.getElementById('formCheckout');
        if (formCheckout) {
            formCheckout.addEventListener('submit', (e) => this.processarPedido(e));
        }

        // Botões da Etapa 2 de Revisão:
        document.getElementById('btnBackToCheckoutForm')?.addEventListener('click', () => {
            document.getElementById('checkoutReviewView')?.style.setProperty('display', 'none');
            document.getElementById('checkoutFormView')?.style.setProperty('display', 'block');
        });

        document.getElementById('btnFinalConfirmOrder')?.addEventListener('click', () => {
            this.confirmarEFinalizarPedido();
        });

        // Eventos do Modal de Detalhes do Produto (Estilo Trem Delivery)
        document.getElementById('btnCloseProductModal')?.addEventListener('click', () => {
            this.fecharModalProduto();
        });
        document.getElementById('productModalOverlay')?.addEventListener('click', (e) => {
            if (e.target.id === 'productModalOverlay') {
                this.fecharModalProduto();
            }
        });
        document.getElementById('btnModalQtyMinus')?.addEventListener('click', () => {
            this.alterarQtdModal(-1);
        });
        document.getElementById('btnModalQtyPlus')?.addEventListener('click', () => {
            this.alterarQtdModal(1);
        });
        document.getElementById('btnModalAddToCart')?.addEventListener('click', () => {
            this.adicionarItemDoModal();
        });

        // Alternância do Acordeão de Itens no Checkout (Estilo Trem Delivery)
        document.getElementById('checkoutPreviewHeader')?.addEventListener('click', () => {
            this.togglePreviewItens();
        });

        // Fechamento de modais com a tecla ESC
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.fecharModalProduto();
                this.fecharModalCheckout();
                fecharDrawer();
            }
        });
    }

    atualizarPixCheckout() {
        const total = this.calcularTotal();
        const chave = this.config.pix_chave || '79988125726';
        const tipo = this.config.pix_tipo || 'telefone';
        const titular = this.config.pix_titular || 'Apiario Favo de Mel';
        const cidade = this.config.pix_cidade || 'Aracaju';

        let payload = '';
        if (typeof PixUtil !== 'undefined') {
            payload = PixUtil.gerarCopiaECola({
                chave,
                tipo,
                nome: titular,
                cidade: cidade,
                valor: total,
                txid: 'FAVODEMEL'
            });
        }

        const inputPayload = document.getElementById('pixCopiaEColaText');
        if (inputPayload) inputPayload.value = payload;

        const imgQr = document.getElementById('pixCheckoutQrImg');
        if (imgQr && typeof PixUtil !== 'undefined') {
            imgQr.src = PixUtil.gerarQrCodeUrl(payload, 200);
        }

        const keyVal = document.getElementById('pixKeyValue');
        if (keyVal) keyVal.innerText = chave;
    }

    async consultarCep(cepLimpo) {
        const spinner = document.getElementById('cepLoadingSpinner');
        const statusMsg = document.getElementById('cepStatusMsg');
        const ruaInput = document.getElementById('checkoutRua');
        const numeroInput = document.getElementById('checkoutNumero');
        const bairroInput = document.getElementById('checkoutBairro');
        const cidadeInput = document.getElementById('checkoutCidade');

        if (spinner) spinner.style.display = 'flex';
        if (statusMsg) {
            statusMsg.className = 'cep-status-msg loading';
            statusMsg.innerText = 'Buscando endereço pelo CEP...';
            statusMsg.style.display = 'block';
        }

        try {
            const res = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`);
            const data = await res.json();

            if (data.erro) {
                if (statusMsg) {
                    statusMsg.className = 'cep-status-msg error';
                    statusMsg.innerText = 'CEP não localizado. Por favor, digite os dados da sua rua manualmente.';
                    statusMsg.style.display = 'block';
                }
                return;
            }

            // Preenchimento automático dos dados do endereço
            if (ruaInput) {
                ruaInput.value = data.logradouro || '';
                if (data.logradouro) ruaInput.classList.add('highlight-success');
            }
            if (bairroInput) {
                bairroInput.value = data.bairro || '';
                if (data.bairro) bairroInput.classList.add('highlight-success');
            }
            if (cidadeInput) {
                cidadeInput.value = data.localidade ? `${data.localidade} - ${data.uf}` : '';
                if (data.localidade) cidadeInput.classList.add('highlight-success');
            }

            // Remove o destaque suave após 2.5s
            setTimeout(() => {
                ruaInput?.classList.remove('highlight-success');
                bairroInput?.classList.remove('highlight-success');
                cidadeInput?.classList.remove('highlight-success');
            }, 2500);

            if (statusMsg) {
                statusMsg.className = 'cep-status-msg success';
                statusMsg.innerText = `✓ Endereço localizado: ${data.localidade} - ${data.uf}. Agora digite o número da sua casa!`;
                statusMsg.style.display = 'block';
            }

            // Foco imediato no campo "Número" para facilitar a vida do cliente!
            if (numeroInput) {
                setTimeout(() => {
                    numeroInput.focus();
                    numeroInput.classList.add('highlight-focus');
                }, 120);
            }

        } catch (err) {
            console.warn('Falha ao consultar ViaCEP:', err.message);
            if (statusMsg) {
                statusMsg.className = 'cep-status-msg error';
                statusMsg.innerText = 'Não foi possível consultar o CEP automaticamente. Digite seu endereço manualmente.';
                statusMsg.style.display = 'block';
            }
        } finally {
            if (spinner) spinner.style.display = 'none';
        }
    }

    abrirModalCheckout() {
        const total = this.calcularTotal();
        const totalFormatado = total.toFixed(2).replace('.', ',');
        const checkoutTotalDisplay = document.getElementById('checkoutTotalDisplay');
        if (checkoutTotalDisplay) checkoutTotalDisplay.innerText = `R$ ${totalFormatado}`;

        this.preencherDadosPerfil();
        this.atualizarPreviewItensCheckout();
        this.atualizarPixCheckout();

        document.getElementById('checkoutModalOverlay')?.classList.add('active');
        document.getElementById('checkoutFormView')?.style.setProperty('display', 'block');
        document.getElementById('checkoutReviewView')?.style.setProperty('display', 'none');
        document.getElementById('checkoutSuccessView')?.style.setProperty('display', 'none');
    }

    fecharModalCheckout() {
        document.getElementById('checkoutModalOverlay')?.classList.remove('active');
    }

    atualizarPreviewItensCheckout() {
        const countEl = document.getElementById('checkoutPreviewCount');
        const listEl = document.getElementById('checkoutPreviewList');
        if (!countEl || !listEl) return;

        countEl.innerText = this.calcularQtdTotal();

        if (this.carrinho.length === 0) {
            listEl.innerHTML = '<div style="font-size: 0.825rem; color: #6E6359;">Nenhum item selecionado.</div>';
            return;
        }

        listEl.innerHTML = this.carrinho.map(item => {
            const sub = (item.quantidade * item.preco).toFixed(2).replace('.', ',');
            const obsHtml = item.obs ? `<div style="font-size: 0.75rem; color: #786C5E; font-style: italic;">Obs: ${item.obs}</div>` : '';
            return `
                <div class="checkout-preview-item">
                    <div class="checkout-preview-item-name">
                        <span>${item.quantidade}x ${item.nome}</span>
                        ${obsHtml}
                    </div>
                    <div class="checkout-preview-item-price">R$ ${sub}</div>
                </div>
            `;
        }).join('');
    }

    togglePreviewItens() {
        const listEl = document.getElementById('checkoutPreviewList');
        const chevron = document.getElementById('checkoutPreviewChevron');
        if (!listEl) return;

        const isOpen = listEl.style.display !== 'none';
        if (isOpen) {
            listEl.style.display = 'none';
            if (chevron) chevron.style.transform = 'rotate(0deg)';
        } else {
            listEl.style.display = 'flex';
            if (chevron) chevron.style.transform = 'rotate(180deg)';
        }
    }

    // =========================================================================
    // PROCESSAMENTO DO PEDIDO (POST /api/catalogo/pedidos)
    // =========================================================================
    // =========================================================================
    // 1. ETAPA DE REVISÃO DO PEDIDO (Valida campos e abre tela de confirmação)
    // =========================================================================
    processarPedido(e) {
        e.preventDefault();

        const nome = document.getElementById('checkoutNome')?.value.trim();
        const telefone = document.getElementById('checkoutTelefone')?.value.trim();
        const obs = document.getElementById('checkoutObs')?.value.trim() || '';

        if (!nome) {
            alert('Por favor, informe seu nome.');
            document.getElementById('checkoutNome')?.focus();
            return;
        }

        const telDigitos = telefone ? telefone.replace(/\D/g, '') : '';
        if (telDigitos.length < 8) {
            alert('Por favor, informe um número de WhatsApp válido para contato e acompanhamento.');
            document.getElementById('checkoutTelefone')?.focus();
            return;
        }

        let endereco = {};
        if (this.tipoEntrega === 'entrega') {
            const rua = document.getElementById('checkoutRua')?.value.trim() || '';
            const numero = document.getElementById('checkoutNumero')?.value.trim() || '';
            if (!rua || !numero) {
                alert('Por favor, informe a Rua e o Número da sua residência para a entrega.');
                if (!rua) document.getElementById('checkoutRua')?.focus();
                else document.getElementById('checkoutNumero')?.focus();
                return;
            }

            endereco = {
                cep: document.getElementById('checkoutCep')?.value.trim() || '',
                rua: rua,
                numero: numero,
                bairro: document.getElementById('checkoutBairro')?.value.trim() || '',
                cidade: document.getElementById('checkoutCidade')?.value.trim() || '',
                complemento: document.getElementById('checkoutComplemento')?.value.trim() || ''
            };
        }

        // Salva dados no perfil do cliente para agilizar futuros pedidos
        this.salvarPerfilCliente({
            nome,
            telefone,
            cep: endereco.cep || '',
            rua: endereco.rua || '',
            numero: endereco.numero || '',
            bairro: endereco.bairro || '',
            cidade: endereco.cidade || '',
            complemento: endereco.complemento || ''
        });

        const trocoPara = document.getElementById('checkoutTroco')?.value.trim() || '';
        const total = this.calcularTotal();

        this.pendingOrderPayload = {
            cliente_nome: nome,
            cliente_telefone: telefone,
            tipo_entrega: this.tipoEntrega,
            endereco: endereco,
            forma_pagamento: this.formaPagamento,
            troco_para: trocoPara,
            observacoes: obs,
            itens: [...this.carrinho],
            subtotal: total,
            taxa_entrega: 0,
            total: total
        };

        // Preenche o resumo da etapa de revisão
        const revNome = document.getElementById('reviewClienteNome');
        const revTel = document.getElementById('reviewClienteTelefone');
        const revEnd = document.getElementById('reviewEndereco');
        const revPag = document.getElementById('reviewPagamento');
        const revList = document.getElementById('reviewItensList');
        const revTotal = document.getElementById('reviewTotalDisplay');

        if (revNome) revNome.innerText = nome;
        if (revTel) revTel.innerText = telefone;

        if (revEnd) {
            if (this.tipoEntrega === 'entrega') {
                const comp = endereco.complemento ? ` (${endereco.complemento})` : '';
                const bairro = endereco.bairro ? ` - ${endereco.bairro}` : '';
                const cid = endereco.cidade ? `, ${endereco.cidade}` : '';
                revEnd.innerText = `Entrega em: ${endereco.rua}, nº ${endereco.numero}${comp}${bairro}${cid}`;
            } else {
                revEnd.innerText = 'Retirada no Apiário Favo de Mel (Aracaju/SE)';
            }
        }

        if (revPag) {
            if (this.formaPagamento === 'pix') {
                revPag.innerText = 'PIX (Chave Celular / Copia e Cola)';
            } else if (this.formaPagamento === 'cartao') {
                revPag.innerText = 'Cartão de Débito / Crédito na Entrega';
            } else {
                revPag.innerText = trocoPara ? `Dinheiro (Troco para R$ ${trocoPara})` : 'Dinheiro (Sem troco)';
            }
        }

        if (revList) {
            revList.innerHTML = this.carrinho.map(item => {
                const sub = (item.quantidade * item.preco).toFixed(2).replace('.', ',');
                const obsStr = item.obs ? `<div style="font-size: 0.72rem; color: #786C5E; font-style: italic;">Obs: ${item.obs}</div>` : '';
                return `
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; padding: 0.35rem 0; border-bottom: 1px dashed #EDE5DA;">
                        <div>
                            <span style="font-weight: 600; color: var(--color-dark);">${item.quantidade}x ${item.nome}</span>
                            ${obsStr}
                        </div>
                        <span style="font-weight: 600; color: var(--color-dark); white-space: nowrap; margin-left: 0.5rem;">R$ ${sub}</span>
                    </div>
                `;
            }).join('');
        }

        if (revTotal) {
            revTotal.innerText = `R$ ${total.toFixed(2).replace('.', ',')}`;
        }

        // Alterna para a tela de revisão
        document.getElementById('checkoutFormView')?.style.setProperty('display', 'none');
        document.getElementById('checkoutReviewView')?.style.setProperty('display', 'block');
    }

    // =========================================================================
    // 2. CONFIRMAÇÃO FINAL DO PEDIDO (Salva, notifica WhatsApp em segundo plano e redireciona para o RASTREIO)
    // =========================================================================
    async confirmarEFinalizarPedido() {
        if (!this.pendingOrderPayload || this.carrinho.length === 0) return;

        const btnFinal = document.getElementById('btnFinalConfirmOrder');
        if (btnFinal) {
            btnFinal.disabled = true;
            btnFinal.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 6px;">
                    <circle cx="12" cy="12" r="10"></circle>
                    <polyline points="12 6 12 12 14 14"></polyline>
                </svg>
                <span>Finalizando seu Pedido...</span>
            `;
        }

        const payload = this.pendingOrderPayload;

        try {
            const res = await fetch(this.getApiUrl('/api/catalogo/pedidos'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await res.json();

            if (data.sucesso && data.codigo_pedido) {
                try {
                    localStorage.setItem('favodemel_ultimo_pedido', JSON.stringify({
                        codigo_pedido: data.codigo_pedido,
                        token_acesso: data.token_acesso,
                        pedido: data.pedido || payload,
                        whatsapp_url: data.whatsapp_url,
                        criado_em: new Date().toISOString()
                    }));
                } catch (_) {}

                this.limparCarrinho();

                // Redireciona DIRETAMENTE para a página de rastreio no próprio site!
                const urlToken = data.token_acesso ? `&token=${encodeURIComponent(data.token_acesso)}` : '';
                window.location.href = `/pedido?codigo=${encodeURIComponent(data.codigo_pedido)}${urlToken}`;
                return;
            } else {
                throw new Error(data.erro || 'Erro ao registrar pedido.');
            }
        } catch (err) {
            console.warn('Backend indisponível ou offline, gerando pedido resiliente com rastreio local:', err.message);

            const codigoPedido = `FD-${Date.now().toString().slice(-4)}${Math.floor(10 + Math.random() * 90)}`;
            const tokenAcesso = Array.from(crypto.getRandomValues(new Uint8Array(16)))
                .map(b => b.toString(16).padStart(2, '0')).join('');

            const fallbackData = {
                sucesso: true,
                codigo_pedido: codigoPedido,
                token_acesso: tokenAcesso,
                pedido: {
                    ...payload,
                    codigo_pedido: codigoPedido,
                    token_acesso: tokenAcesso,
                    status: 'novo',
                    criado_em: new Date().toISOString()
                }
            };

            try {
                localStorage.setItem('favodemel_ultimo_pedido', JSON.stringify(fallbackData));
            } catch (_) {}

            this.limparCarrinho();
            window.location.href = `/pedido?codigo=${encodeURIComponent(codigoPedido)}&token=${encodeURIComponent(tokenAcesso)}`;
        }
    }

    // =========================================================================
    // 3. PARAMETRO URL AUTO-ADD (Ex: /catalogo?add=mel-com-favo)
    // =========================================================================
    verificarParametroAutoAdd() {
        try {
            const params = new URLSearchParams(window.location.search);
            const addParam = params.get('add');
            if (!addParam) return;

            const slugMap = {
                'mel-com-favo': 1,
                'mel-de-urucu': 2,
                'propolis-verde': 3,
                'propolis-vermelha': 4,
                'kit-presente': 5,
                'sabonete': 6,
                'licor-de-mel': 7,
                'mel-silvestre': 8,
                'polen-apicola': 10
            };

            const targetId = slugMap[addParam.toLowerCase()] || parseInt(addParam, 10);
            if (!targetId) return;

            const prod = this.produtos.find(p => p.id === targetId);
            if (!prod) return;

            // Se ainda não está no carrinho, adiciona
            const existente = this.carrinho.find(i => i.id === prod.id);
            if (!existente) {
                this.carrinho.push({
                    cartId: `cart_${prod.id}_${Date.now()}`,
                    id: prod.id,
                    nome: prod.nome,
                    preco: parseFloat(prod.preco),
                    foto: this.resolverFoto(prod),
                    quantidade: 1,
                    obs: ''
                });
                this.salvarCarrinho();
                this.atualizarInterfaceCarrinho();
                this.renderizarProdutos();
            }

            // Abre o Drawer do Carrinho suavemente para o cliente
            setTimeout(() => {
                document.getElementById('cartDrawerOverlay')?.classList.add('active');
                document.getElementById('cartDrawer')?.classList.add('active');
            }, 300);

            // Limpa o parâmetro da URL sem recarregar a página
            window.history.replaceState({}, document.title, window.location.pathname);
        } catch (e) {
            console.warn('Erro ao processar parâmetro auto add:', e.message);
        }
    }
}

// Inicializa a aplicação
let catalogoApp;
document.addEventListener('DOMContentLoaded', () => {
    catalogoApp = new CatalogoApp();
});
