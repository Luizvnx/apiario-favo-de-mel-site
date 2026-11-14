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
        this.ordenacao = 'relevancia';
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
        const carregou = await this.carregarDadosDoServidor();

        // Só reconcilia o carrinho quando o catálogo veio da API (PostgreSQL ou
        // cache do servidor). Em modo offline/cache do navegador os dados podem
        // estar velhos, então não removemos itens por conta própria.
        if (carregou) this.sincronizarCarrinhoComCatalogo();

        this.carregarEstadoUrl();
        this.renderizarCategorias();
        this.renderizarProdutos();
        this.atualizarInterfaceCarrinho();
        this.verificarParametroAutoAdd();
        this.configurarAtualizacaoAutomatica();
    }

    formatarTituloExibicao(nome) {
        const texto = String(nome || '').trim();
        if (!texto) return '';

        const letras = texto.replace(/[^a-zA-ZÀ-ÿ]/g, '');
        if (!letras) return texto;

        const normalizarUnidades = (str) => str.replace(/\b(\d+)\s*(G|KG|ML)\b/gi, (_, num, unit) => `${num}${unit.toLowerCase()}`);

        const maiusculas = (letras.match(/[A-ZÀ-Ý]/g) || []).length;
        if (maiusculas / letras.length < 0.65) {
            return normalizarUnidades(texto);
        }

        const conectivos = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'com', 'para', 'no', 'na', 'nos', 'nas', 'por', 'a', 'o']);
        const siglas = new Set(['PVC', 'INPA', 'PET', 'PIX']);

        return texto
            .split(/\s+/)
            .map((palavra, indice) => {
                const limpa = palavra.replace(/[^\wÀ-ÿ]/g, '').toUpperCase();
                if (siglas.has(limpa)) return palavra.toUpperCase();
                if (/^\d+(G|KG|ML|L)$/i.test(palavra)) return palavra.toLowerCase();
                const lower = palavra.toLowerCase();
                if (indice > 0 && conectivos.has(lower)) return lower;
                return lower.charAt(0).toUpperCase() + lower.slice(1);
            })
            .join(' ');
    }

    carregarEstadoUrl() {
        try {
            const params = new URLSearchParams(window.location.search);
            const q = params.get('q');
            if (q) {
                this.termoBusca = q;
                const searchInput = document.getElementById('catalogSearch');
                if (searchInput) searchInput.value = q;
            }

            const sortVal = params.get('sort');
            const sortsValidos = new Set(['relevancia', 'disponiveis', 'menor-preco', 'maior-preco', 'nome-az']);
            if (sortVal && sortsValidos.has(sortVal)) {
                this.ordenacao = sortVal;
                const sortEl = document.getElementById('catalogSort');
                if (sortEl) sortEl.value = sortVal;
            }

            const catParam = params.get('cat');
            if (catParam && catParam !== 'todos') {
                const catNorm = catParam.toLowerCase().trim();
                const match = this.categorias.find(c =>
                    String(c.id) === catParam.trim() ||
                    String(c.nome || '').toLowerCase().includes(catNorm)
                );
                if (match) {
                    this.categoriaAtiva = String(match.id);
                }
            }
        } catch (_) {}
    }

    atualizarEstadoUrl() {
        try {
            const url = new URL(window.location.href);
            if (this.categoriaAtiva && this.categoriaAtiva !== 'todos') {
                url.searchParams.set('cat', this.categoriaAtiva);
            } else {
                url.searchParams.delete('cat');
            }

            const q = this.termoBusca.trim();
            if (q) {
                url.searchParams.set('q', q);
            } else {
                url.searchParams.delete('q');
            }

            if (this.ordenacao && this.ordenacao !== 'relevancia') {
                url.searchParams.set('sort', this.ordenacao);
            } else {
                url.searchParams.delete('sort');
            }

            const novaUrl = url.pathname + (url.search ? url.search : '') + url.hash;
            window.history.replaceState({}, document.title, novaUrl);
        } catch (_) {}
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

        // Preserva o carrinho, mas reconcilia preços, estoque e itens removidos
        this.sincronizarCarrinhoComCatalogo();

        this.renderizarCategorias();
        this.renderizarProdutos();
        this.atualizarInterfaceCarrinho();
        this.atualizarModalAberto();
    }

    // =========================================================================
    // ESTOQUE E VÍNCULO COM AS LANDING PAGES
    // =========================================================================
    normalizarEstoque(valor) {
        if (valor === null || valor === undefined || valor === '') return null;
        const numero = parseInt(valor, 10);
        return Number.isFinite(numero) ? numero : null;
    }

    escaparHtml(valor) {
        return String(valor === null || valor === undefined ? '' : valor)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    estaEsgotado(prod) {
        const estoque = this.normalizarEstoque(prod && prod.estoque);
        return estoque !== null && estoque <= 0;
    }

    estoqueBaixo(prod) {
        const estoque = this.normalizarEstoque(prod && prod.estoque);
        return estoque !== null && estoque > 0 && estoque <= 5;
    }

    normalizarSlug(valor) {
        return String(valor || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    // Resolve um produto por id, slug de landing page ou nome. Nunca usa
    // tabelas fixas de IDs: se o produto não existir, retorna null.
    encontrarProdutoPorReferencia(referencia) {
        const chave = String(referencia || '').trim();
        if (!chave) return null;

        const porId = this.produtos.find(p => String(p.id) === chave);
        if (porId) return porId;

        const chaveSlug = this.normalizarSlug(chave);
        if (!chaveSlug) return null;

        return this.produtos.find(prod => {
            const slugs = [
                prod.landing_slug,
                prod.slug,
                this.normalizarSlug(prod.nome)
            ].filter(Boolean).map(s => this.normalizarSlug(s));
            return slugs.includes(chaveSlug);
        }) || null;
    }

    encontrarProdutoAtual(item) {
        if (!item) return null;
        return this.produtos.find(p => String(p.id) === String(item.id)) || null;
    }

    // Reconcilia o carrinho com o catálogo atual: preço, nome, foto, estoque,
    // quantidade máxima e remoção de itens que saíram do catálogo/estoque.
    sincronizarCarrinhoComCatalogo(opcoes = {}) {
        if (!Array.isArray(this.produtos) || this.produtos.length === 0) return;

        const podeRemover = opcoes.removerIndisponiveis !== false;
        const avisos = [];
        let alterou = false;

        this.carrinho = this.carrinho.filter(item => {
            const atual = this.encontrarProdutoAtual(item);

            if (!atual) {
                if (podeRemover) {
                    avisos.push(`"${item.nome}" saiu do catálogo e foi removido do carrinho.`);
                    alterou = true;
                    return false;
                }
                return true;
            }

            if (atual.ativo === false) {
                if (podeRemover) {
                    avisos.push(`"${atual.nome}" não está mais disponível e foi removido do carrinho.`);
                    alterou = true;
                    return false;
                }
                return true;
            }

            const estoque = this.normalizarEstoque(atual.estoque);

            if (podeRemover && estoque !== null && estoque <= 0) {
                avisos.push(`"${atual.nome}" está esgotado e foi removido do carrinho.`);
                alterou = true;
                return false;
            }

            let quantidade = Math.max(1, parseInt(item.quantidade, 10) || 1);
            if (estoque !== null && quantidade > estoque) {
                if (estoque <= 0 && podeRemover) {
                    avisos.push(`"${atual.nome}" está esgotado e foi removido do carrinho.`);
                    alterou = true;
                    return false;
                }
                quantidade = estoque;
                avisos.push(`Ajustamos "${atual.nome}" para ${quantidade} unidade(s) disponível(is).`);
                alterou = true;
            }

            const novoPreco = parseFloat(atual.preco) || 0;
            const novaFoto = this.resolverFoto(atual);

            if (item.preco !== novoPreco || item.nome !== atual.nome || item.foto !== novaFoto ||
                item.estoque !== estoque || item.quantidade !== quantidade) {
                item.preco = novoPreco;
                item.nome = atual.nome;
                item.foto = novaFoto;
                item.estoque = estoque;
                item.quantidade = quantidade;
                alterou = true;
            }

            return true;
        });

        if (alterou) this.salvarCarrinho();

        if (avisos.length > 0 && opcoes.notificar !== false) {
            this.mostrarStatusSincronizacao('aviso', avisos.join(' '), 9000);
        }
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
        const badgeEl = document.getElementById('productModalBadge');
        const btnAdd = document.getElementById('btnModalAddToCart');
        const btnMais = document.getElementById('btnModalQtyPlus');

        const preco = parseFloat(atual.preco || 0);
        const precoFormatado = preco.toFixed(2).replace('.', ',');
        const totalModal = (preco * Math.max(1, this.modalQtd)).toFixed(2).replace('.', ',');
        const estoque = this.normalizarEstoque(atual.estoque);
        const esgotado = this.estaEsgotado(atual);

        if (imgEl) imgEl.src = this.resolverFoto(atual);
        if (titleEl) titleEl.innerText = atual.nome;
        if (priceEl) priceEl.innerText = precoFormatado;
        if (descEl) descEl.innerText = atual.descricao || '';

        if (badgeEl) {
            badgeEl.classList.toggle('is-out', esgotado);
            if (esgotado) {
                badgeEl.innerText = 'Esgotado';
                badgeEl.style.display = 'inline-block';
            } else if (estoque !== null && estoque > 0 && estoque <= 5) {
                badgeEl.innerText = `Últimas ${estoque} un.`;
                badgeEl.style.display = 'inline-block';
            } else if (atual.badge || atual.destaque) {
                badgeEl.innerText = atual.badge || 'Puro & Orgânico';
                badgeEl.style.display = 'inline-block';
            } else {
                badgeEl.style.display = 'none';
            }
        }

        if (btnAdd) {
            btnAdd.disabled = esgotado;
            btnAdd.classList.toggle('btn-add-cart--disabled', esgotado);
            btnAdd.innerHTML = esgotado
                ? '<span>Produto esgotado</span>'
                : `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path><line x1="3" y1="6" x2="21" y2="6"></line><path d="M16 10a4 4 0 0 1-8 0"></path></svg>
                   <span>Adicionar • <strong id="productModalTotalPrice">R$ ${totalModal}</strong></span>`;
        }

        if (btnMais) btnMais.disabled = esgotado || (estoque !== null && this.modalQtd >= estoque);
        if (esgotado) this.modalQtd = 1;
    }

    // Barra discreta de status da sincronização
    mostrarStatusSincronizacao(tipo, mensagem, autoOcultarMs) {
        if (!this.statusEl) {
            const el = document.createElement('div');
            el.id = 'catalogoSyncStatus';
            el.style.cssText = [
                'position:fixed', 'right:16px', 'top:84px', 'z-index:999',
                'display:flex', 'align-items:center', 'gap:8px',
                'padding:9px 14px', 'border-radius:10px',
                'background:#FFFFFF', 'color:#1A130D', 'border:1px solid #E8DFD3',
                'font-family:inherit', 'font-size:0.8rem', 'font-weight:600',
                'box-shadow:0 8px 24px rgba(26,19,13,0.1)',
                'transition:opacity .3s ease', 'max-width:calc(100vw - 32px)'
            ].join(';');
            document.body.appendChild(el);
            this.statusEl = el;
        }

        const pontos = {
            ok: '#15803D',
            aviso: '#A35A00',
            erro: '#B91C1C'
        };
        const dotColor = pontos[tipo] || pontos.ok;
        const el = this.statusEl;
        el.innerHTML = `<span style="width:6px;height:6px;border-radius:50%;background:${dotColor};display:inline-block;flex:0 0 auto;"></span><span>${mensagem}</span>`;
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
        const base = (this.apiBaseAtiva || window.FAVODEMEL_API_URL || '')
            .toString()
            .trim()
            .replace(/\/$/, '');
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
                    const erroHttp = new Error((data && data.erro) || `HTTP ${res.status}`);
                    erroHttp.status = res.status;
                    erroHttp.data = data;
                    throw erroHttp;
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

            if (data.sucesso && Array.isArray(data.produtos)) {
                this.categorias = Array.isArray(data.categorias) ? data.categorias : [];
                this.produtos = data.produtos;
                this.fonteDados = data.fonte || 'postgresql';
                this.assinaturaCatalogo = this.assinaturaDosProdutos();

                try {
                    localStorage.setItem('favodemel_catalogo_cache', JSON.stringify({
                        categorias: this.categorias,
                        produtos: this.produtos,
                        salvo_em: Date.now()
                    }));
                } catch (_) {}

                const catalogoVazio = this.produtos.length === 0;

                if (data.pendente || this.fonteDados === 'local_json') {
                    this.mostrarStatusSincronizacao('aviso', 'Sincronização pendente com o banco de dados. Exibindo os últimos dados salvos.');
                } else if (catalogoVazio) {
                    if (!silencioso) {
                        this.mostrarStatusSincronizacao('aviso', 'Nenhum produto publicado no catálogo no momento.', 6000);
                    }
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
            console.warn('[Catálogo] API indisponível:', err.message);

            // Já existe catálogo carregado nesta sessão: mantém os dados atuais
            // em vez de apagar a vitrine por causa de uma falha temporária.
            if (this.produtos.length > 0 && this.fonteDados !== 'indisponivel') {
                if (!silencioso) {
                    this.mostrarStatusSincronizacao('erro', 'Sem conexão com o servidor. Exibindo o catálogo já carregado.', 6000);
                }
                return false;
            }

            // Tenta recuperar o último catálogo bom salvo neste dispositivo
            try {
                const salvo = localStorage.getItem('favodemel_catalogo_cache');
                if (salvo) {
                    const parsed = JSON.parse(salvo);
                    if (Array.isArray(parsed.produtos) && parsed.produtos.length > 0) {
                        this.categorias = parsed.categorias || [];
                        this.produtos = parsed.produtos;
                        this.fonteDados = 'cache_local';
                        this.assinaturaCatalogo = this.assinaturaDosProdutos();
                        this.mostrarStatusSincronizacao('erro', 'Sem conexão com o servidor. Exibindo o último catálogo salvo neste dispositivo.');
                        return false;
                    }
                }
            } catch (_) {}

            // Sem dados reais disponíveis: estado offline explícito, sem produtos fictícios.
            this.categorias = [];
            this.produtos = [];
            this.fonteDados = 'indisponivel';
            this.assinaturaCatalogo = '';
            this.mostrarStatusSincronizacao('erro', 'Sem conexão com o servidor e sem catálogo salvo. Verifique sua internet e tente novamente.');
            return false;
        }
    }

    async tentarNovamente() {
        const gridEl = document.getElementById('catalogGrid');
        if (gridEl) {
            gridEl.innerHTML = `
                <div style="grid-column: 1/-1; text-align: center; padding: 4rem 1rem; color: #6E6359;">
                    <div class="tracking-spinner" style="width: 36px; height: 36px; border: 3px solid #E8DFD3; border-top-color: #D98200; border-radius: 50%; margin: 0 auto 1rem auto; animation: spinTrack 0.8s linear infinite;"></div>
                    <p style="font-weight: 500; font-size: 0.95rem;">Tentando reconectar ao catálogo...</p>
                </div>
            `;
        }

        const carregou = await this.carregarDadosDoServidor();
        if (carregou) this.sincronizarCarrinhoComCatalogo();
        this.renderizarCategorias();
        this.renderizarProdutos();
        this.atualizarInterfaceCarrinho();
    }

    // =========================================================================
    // RENDERIZAÇÃO DE CATEGORIAS (PILLS)
    // =========================================================================
    renderizarCategorias() {
        const wrap = document.getElementById('categoriesPills');
        if (!wrap) return;

        if (this.categorias.length === 0 && this.produtos.length === 0) {
            wrap.innerHTML = '';
            return;
        }

        let html = `
            <button class="category-pill ${this.categoriaAtiva === 'todos' ? 'active' : ''}" data-cat="todos" role="tab" aria-selected="${this.categoriaAtiva === 'todos' ? 'true' : 'false'}">
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

            const isActive = this.categoriaAtiva === String(cat.id);
            html += `
                <button class="category-pill ${isActive ? 'active' : ''}" data-cat="${cat.id}" role="tab" aria-selected="${isActive ? 'true' : 'false'}">
                    ${iconeSvg}<span>${nomeLimpo} (${count})</span>
                </button>
            `;
        });

        wrap.innerHTML = html;

        wrap.querySelectorAll('.category-pill').forEach(btn => {
            btn.addEventListener('click', () => {
                wrap.querySelectorAll('.category-pill').forEach(b => {
                    b.classList.remove('active');
                    b.setAttribute('aria-selected', 'false');
                });
                btn.classList.add('active');
                btn.setAttribute('aria-selected', 'true');
                this.categoriaAtiva = btn.getAttribute('data-cat');
                this.atualizarEstadoUrl();
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

    limparFiltros() {
        this.categoriaAtiva = 'todos';
        this.termoBusca = '';
        this.ordenacao = 'relevancia';
        const searchInput = document.getElementById('catalogSearch');
        if (searchInput) searchInput.value = '';
        const sortSelect = document.getElementById('catalogSort');
        if (sortSelect) sortSelect.value = 'relevancia';
        this.atualizarEstadoUrl();
        this.renderizarCategorias();
        this.renderizarProdutos();
    }

    atualizarBarraResultados(filtradosCount) {
        const statusEl = document.getElementById('catalogResultsStatus');
        if (!statusEl) return;

        const temBusca = this.termoBusca.trim().length > 0;
        const temCategoria = this.categoriaAtiva !== 'todos';
        const temOrdenacao = this.ordenacao && this.ordenacao !== 'relevancia';

        if (!temBusca && !temCategoria && !temOrdenacao) {
            statusEl.innerHTML = '';
            return;
        }

        const partes = [];
        if (temCategoria) {
            const cat = this.categorias.find(c => String(c.id) === String(this.categoriaAtiva));
            if (cat && cat.nome) {
                const nomeCat = cat.nome.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{2300}-\u{23FF}]/gu, '').trim();
                partes.push(`categoria <strong>${this.escaparHtml(nomeCat)}</strong>`);
            }
        }
        if (temBusca) {
            partes.push(`busca por <strong>"${this.escaparHtml(this.termoBusca.trim())}"</strong>`);
        }
        if (temOrdenacao && partes.length === 0) {
            const rotulos = {
                'disponiveis': 'em estoque primeiro',
                'menor-preco': 'menor preço',
                'maior-preco': 'maior preço',
                'nome-az': 'ordem alfabética (A–Z)'
            };
            partes.push(`ordenação por <strong>${rotulos[this.ordenacao] || 'destaques'}</strong>`);
        }

        const labelQtd = filtradosCount === 1 ? '1 produto' : `${filtradosCount} produtos`;
        statusEl.innerHTML = `
            <span><strong>${labelQtd}</strong> em ${partes.join(' e ')}</span>
            <button type="button" class="btn-clear-catalog-filter" onclick="catalogoApp.limparFiltros()">Limpar filtros</button>
        `;
    }

    renderizarProdutos() {
        const gridEl = document.getElementById('catalogGrid');
        if (!gridEl) return;

        let filtrados = [...this.produtos];

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

        // Ordenação
        if (this.ordenacao === 'menor-preco') {
            filtrados.sort((a, b) => (parseFloat(a.preco) || 0) - (parseFloat(b.preco) || 0));
        } else if (this.ordenacao === 'maior-preco') {
            filtrados.sort((a, b) => (parseFloat(b.preco) || 0) - (parseFloat(a.preco) || 0));
        } else if (this.ordenacao === 'nome-az') {
            filtrados.sort((a, b) =>
                this.formatarTituloExibicao(a.nome).localeCompare(this.formatarTituloExibicao(b.nome), 'pt-BR')
            );
        } else if (this.ordenacao === 'disponiveis') {
            filtrados.sort((a, b) => {
                const dispA = this.estaEsgotado(a) ? 1 : 0;
                const dispB = this.estaEsgotado(b) ? 1 : 0;
                if (dispA !== dispB) return dispA - dispB;
                return (Number(a.id) || 0) - (Number(b.id) || 0);
            });
        }

        this.atualizarBarraResultados(filtrados.length);

        if (this.produtos.length === 0) {
            if (this.fonteDados === 'indisponivel') {
                gridEl.innerHTML = `
                    <div class="catalog-offline-state" role="status">
                        <div style="margin-bottom: 1rem;">
                            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color: var(--color-primary);"><path d="M1 1l22 22"></path><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"></path><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"></path><path d="M10.71 5.05A16 16 0 0 1 22.58 9"></path><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"></path><path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path><line x1="12" y1="20" x2="12.01" y2="20"></line></svg>
                        </div>
                        <h3 style="margin-bottom: 0.5rem; color: #2C231C;">Catálogo indisponível no momento</h3>
                        <p style="margin-bottom: 1.25rem;">Não foi possível conectar ao servidor e não há catálogo salvo neste dispositivo.</p>
                        <button type="button" class="btn-add-cart" style="margin: 0 auto;" onclick="catalogoApp.tentarNovamente()">Tentar novamente</button>
                    </div>
                `;
                return;
            }

            gridEl.innerHTML = `
                <div style="grid-column: 1/-1; text-align: center; padding: 4rem 1rem; color: #6E6359;">
                    <div style="margin-bottom: 1rem;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color: var(--color-primary);"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path><line x1="3" y1="6" x2="21" y2="6"></line><path d="M16 10a4 4 0 0 1-8 0"></path></svg>
                    </div>
                    <h3 style="margin-bottom: 0.5rem; color: #2C231C;">Nenhum produto publicado</h3>
                    <p>O catálogo está sendo atualizado. Volte em instantes.</p>
                </div>
            `;
            return;
        }

        if (filtrados.length === 0) {
            gridEl.innerHTML = `
                <div style="grid-column: 1/-1; text-align: center; padding: 4rem 1rem; color: #6E6359;">
                    <div style="margin-bottom: 1rem;">
                        <svg width="48" height="48" style="color: var(--color-primary);" aria-hidden="true"><use href="/assets/icons/sprite.svg#icon-search"></use></svg>
                    </div>
                    <h3 style="margin-bottom: 0.5rem; color: #2C231C;">Nenhum produto encontrado</h3>
                    <p style="margin-bottom: 1.25rem;">Tente buscar por outro termo ou selecione outra categoria.</p>
                    <button type="button" class="btn-add-cart" style="margin: 0 auto;" onclick="catalogoApp.limparFiltros()">Limpar filtros e mostrar todos</button>
                </div>
            `;
            return;
        }

        gridEl.innerHTML = filtrados.map(prod => {
            const precoFormatado = parseFloat(prod.preco || 0).toFixed(2).replace('.', ',');
            const itemNoCarrinho = this.carrinho.find(i => String(i.id) === String(prod.id));
            const qtdNoCarrinho = itemNoCarrinho ? itemNoCarrinho.quantidade : 0;

            const estoque = this.normalizarEstoque(prod.estoque);
            const esgotado = this.estaEsgotado(prod);
            const estoqueBaixo = this.estoqueBaixo(prod);
            const limiteAtingido = estoque !== null && qtdNoCarrinho >= estoque;

            const fotoUrl = this.resolverFoto(prod);
            const nomeExibicao = this.formatarTituloExibicao(prod.nome);
            const nomeSeguro = this.escaparHtml(nomeExibicao);
            const descricaoSegura = this.escaparHtml(prod.descricao || 'Produto natural de altíssima qualidade direto do apiário.');
            const catNomeLimpo = (prod.categoria_nome || 'Apiário Favo de Mel')
                .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{2300}-\u{23FF}]/gu, '')
                .trim();

            let estoqueBadge = '';
            if (esgotado) {
                estoqueBadge = '<span class="card-stock-badge esgotado">Esgotado</span>';
            } else if (estoqueBaixo) {
                estoqueBadge = `<span class="card-stock-badge baixo">Últimas ${estoque} un.</span>`;
            } else if (prod.destaque) {
                estoqueBadge = '<span class="card-stock-badge destaque">Destaque</span>';
            }

            let acaoHtml;
            if (esgotado) {
                acaoHtml = '<button class="btn-add-cart btn-add-cart--disabled" type="button" disabled aria-disabled="true">Esgotado</button>';
            } else if (qtdNoCarrinho > 0) {
                acaoHtml = `
                    <div class="qty-stepper">
                        <button class="qty-btn" type="button" aria-label="Diminuir quantidade de ${nomeSeguro}" onclick="catalogoApp.alterarQuantidade('${prod.id}', -1)">−</button>
                        <span class="qty-value">${qtdNoCarrinho}</span>
                        <button class="qty-btn" type="button" aria-label="Aumentar quantidade de ${nomeSeguro}" onclick="catalogoApp.alterarQuantidade('${prod.id}', 1)" ${limiteAtingido ? 'disabled aria-disabled="true"' : ''}>+</button>
                    </div>
                `;
            } else {
                acaoHtml = `
                    <button class="btn-add-cart" type="button" aria-label="Adicionar ${nomeSeguro} ao carrinho" onclick="catalogoApp.adicionarItem('${prod.id}')">
                        <span>+</span> Adicionar
                    </button>
                `;
            }

            return `
                <div class="catalog-card${esgotado ? ' catalog-card--esgotado' : ''}" data-id="${prod.id}">
                    <div class="card-img-area" role="button" tabindex="0" aria-label="Ver detalhes e observações de ${nomeSeguro}" onclick="catalogoApp.abrirModalProduto('${prod.id}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();catalogoApp.abrirModalProduto('${prod.id}');}" title="Clique para ver detalhes e observações">
                        <img src="${this.escaparHtml(fotoUrl)}" alt="${nomeSeguro}" width="260" height="260" loading="lazy" decoding="async" onerror="window.handleCatalogImgError && window.handleCatalogImgError(this)">
                        ${estoqueBadge}
                    </div>
                    <div class="card-content">
                        <span class="card-category-label">${this.escaparHtml(catNomeLimpo)}</span>
                        <h3 class="card-title" role="button" tabindex="0" onclick="catalogoApp.abrirModalProduto('${prod.id}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();catalogoApp.abrirModalProduto('${prod.id}');}" title="Clique para ver detalhes">${nomeSeguro}</h3>
                        <p class="card-desc">${descricaoSegura}</p>
                        
                        <div class="card-bottom-row">
                            <div class="card-price"><small>R$</small> ${precoFormatado}</div>
                            ${acaoHtml}
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
        const estoque = this.normalizarEstoque(prod.estoque);
        const esgotado = this.estaEsgotado(prod);
        const catNomeLimpo = (prod.categoria_nome || 'Apiário Favo de Mel')
            .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{2300}-\u{23FF}]/gu, '')
            .trim();

        const nomeExibicao = this.formatarTituloExibicao(prod.nome);
        if (imgEl) {
            imgEl.src = fotoUrl;
            imgEl.alt = nomeExibicao;
            imgEl.onerror = function() { window.handleCatalogImgError && window.handleCatalogImgError(this); };
        }
        if (titleEl) titleEl.innerText = nomeExibicao;
        if (catEl) catEl.innerText = catNomeLimpo;
        if (priceEl) priceEl.innerText = `R$ ${precoFormatado}`;
        if (descEl) descEl.innerText = prod.descricao || 'Produto nobre e puro do Apiário Favo de Mel, colhido de forma sustentável e artesanal.';
        if (obsEl) obsEl.value = '';
        if (qtyEl) qtyEl.innerText = esgotado ? '0' : '1';
        if (totalEl) totalEl.innerText = `R$ ${precoFormatado}`;

        if (badgeEl) {
            badgeEl.classList.toggle('is-out', esgotado);
            if (esgotado) {
                badgeEl.innerText = 'Esgotado';
                badgeEl.style.display = 'inline-block';
            } else if (estoque !== null && estoque > 0 && estoque <= 5) {
                badgeEl.innerText = `Últimas ${estoque} un.`;
                badgeEl.style.display = 'inline-block';
            } else if (prod.badge || prod.destaque) {
                badgeEl.innerText = prod.badge || 'Puro & Orgânico';
                badgeEl.style.display = 'inline-block';
            } else {
                badgeEl.style.display = 'none';
            }
        }

        const btnAdd = document.getElementById('btnModalAddToCart');
        if (btnAdd) {
            btnAdd.disabled = esgotado;
            btnAdd.classList.toggle('btn-add-cart--disabled', esgotado);
            btnAdd.innerHTML = esgotado
                ? '<span>Produto esgotado</span>'
                : `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path><line x1="3" y1="6" x2="21" y2="6"></line><path d="M16 10a4 4 0 0 1-8 0"></path></svg>
                   <span>Adicionar • <strong id="productModalTotalPrice">R$ ${precoFormatado}</strong></span>`;
        }

        const btnMais = document.getElementById('btnModalQtyPlus');
        if (btnMais) {
            const limite = estoque !== null ? estoque : Infinity;
            btnMais.disabled = esgotado || 1 >= limite;
        }

        const detailsLinkEl = document.getElementById('productModalDetailsLink');
        if (detailsLinkEl) {
            const slug = prod.landing_slug ? String(prod.landing_slug).trim().replace(/^\/+/, '') : '';
            if (slug) {
                detailsLinkEl.href = `/${slug}`;
                detailsLinkEl.style.display = 'inline-flex';
            } else {
                detailsLinkEl.removeAttribute('href');
                detailsLinkEl.style.display = 'none';
            }
        }

        if (overlay) {
            this.ultimoElementoFocado = document.activeElement;
            overlay.classList.add('active');
            overlay.setAttribute('aria-hidden', 'false');
            document.body.style.overflow = 'hidden';
            setTimeout(() => document.getElementById('btnCloseProductModal')?.focus(), 50);
        }
    }

    fecharModalProduto() {
        const overlay = document.getElementById('productModalOverlay');
        if (overlay) {
            const estavaAtivo = overlay.classList.contains('active');
            overlay.classList.remove('active');
            overlay.setAttribute('aria-hidden', 'true');
            document.body.style.overflow = '';
            if (estavaAtivo && this.ultimoElementoFocado && typeof this.ultimoElementoFocado.focus === 'function') {
                this.ultimoElementoFocado.focus();
            }
        }
        this.modalProduto = null;
        this.modalQtd = 1;
    }

    alterarQtdModal(delta) {
        if (!this.modalProduto || this.estaEsgotado(this.modalProduto)) return;

        const estoque = this.normalizarEstoque(this.modalProduto.estoque);
        const novaQtd = this.modalQtd + delta;
        if (novaQtd < 1) return;

        if (estoque !== null && novaQtd > estoque) {
            this.mostrarStatusSincronizacao('aviso', `Este produto tem apenas ${estoque} unidade(s) em estoque.`, 5000);
            return;
        }

        this.modalQtd = novaQtd;
        const qtyEl = document.getElementById('productModalQty');
        const totalEl = document.getElementById('productModalTotalPrice');
        const btnMais = document.getElementById('btnModalQtyPlus');

        if (qtyEl) qtyEl.innerText = this.modalQtd;
        if (totalEl) {
            const subtotal = (this.modalQtd * parseFloat(this.modalProduto.preco || 0)).toFixed(2).replace('.', ',');
            totalEl.innerText = `R$ ${subtotal}`;
        }
        if (btnMais && estoque !== null) btnMais.disabled = this.modalQtd >= estoque;
    }

    adicionarItemDoModal() {
        if (!this.modalProduto) return;

        const prod = this.modalProduto;

        if (this.estaEsgotado(prod)) {
            this.mostrarStatusSincronizacao('aviso', 'Este produto está esgotado no momento.', 5000);
            return;
        }

        const obs = document.getElementById('productModalObs')?.value.trim() || '';
        const estoque = this.normalizarEstoque(prod.estoque);
        const jaNoCarrinho = this.carrinho
            .filter(i => String(i.id) === String(prod.id))
            .reduce((soma, i) => soma + (parseInt(i.quantidade, 10) || 0), 0);
        const disponivel = estoque === null ? Infinity : Math.max(0, estoque - jaNoCarrinho);

        if (disponivel <= 0) {
            this.mostrarStatusSincronizacao('aviso', `Você já adicionou todo o estoque disponível de "${prod.nome}".`, 6000);
            return;
        }

        const qtd = Math.max(1, Math.min(this.modalQtd, disponivel));
        if (qtd < this.modalQtd) {
            this.mostrarStatusSincronizacao('aviso', `Ajustamos a quantidade para ${qtd} unidade(s) disponível(is).`, 6000);
        }

        // Se já existe no carrinho exatamente o mesmo produto com a mesma observação, incrementa
        const existente = this.carrinho.find(i => String(i.id) === String(prod.id) && (i.obs || '') === obs);
        if (existente) {
            existente.quantidade += qtd;
            existente.estoque = estoque;
        } else {
            this.carrinho.push({
                cartId: `cart_${prod.id}_${Date.now()}_${Math.floor(Math.random()*1000)}`,
                id: prod.id,
                nome: prod.nome,
                preco: parseFloat(prod.preco),
                foto: this.resolverFoto(prod),
                quantidade: qtd,
                estoque,
                obs: obs
            });
        }

        this.salvarCarrinho();
        this.atualizarInterfaceCarrinho();
        this.renderizarProdutos();
        this.tocarFeedbackSonoro();
        this.fecharModalProduto();

        // Abre automaticamente o drawer do carrinho para dar visibilidade ao usuário
        this.abrirDrawerCarrinho();
    }

    abrirDrawerCarrinho() {
        this.ultimoElementoFocado = document.activeElement;
        const overlay = document.getElementById('cartDrawerOverlay');
        const drawer = document.getElementById('cartDrawer');
        overlay?.classList.add('active');
        overlay?.setAttribute('aria-hidden', 'false');
        drawer?.classList.add('active');
        drawer?.setAttribute('aria-hidden', 'false');
        setTimeout(() => document.getElementById('btnCloseDrawer')?.focus(), 50);
    }

    fecharDrawerCarrinho() {
        const overlay = document.getElementById('cartDrawerOverlay');
        const drawer = document.getElementById('cartDrawer');
        const estavaAtivo = drawer?.classList.contains('active');
        overlay?.classList.remove('active');
        overlay?.setAttribute('aria-hidden', 'true');
        drawer?.classList.remove('active');
        drawer?.setAttribute('aria-hidden', 'true');
        if (estavaAtivo && this.ultimoElementoFocado && typeof this.ultimoElementoFocado.focus === 'function') {
            this.ultimoElementoFocado.focus();
        }
    }

    // =========================================================================
    // OPERAÇÕES DO CARRINHO
    // =========================================================================
    adicionarItem(id) {
        const prod = this.produtos.find(p => String(p.id) === String(id));
        if (!prod) return;

        if (this.estaEsgotado(prod)) {
            this.mostrarStatusSincronizacao('aviso', 'Este produto está esgotado no momento.', 5000);
            return;
        }

        const estoque = this.normalizarEstoque(prod.estoque);
        const existente = this.carrinho.find(i => String(i.id) === String(id) && !i.obs);
        const jaNoCarrinho = this.carrinho
            .filter(i => String(i.id) === String(prod.id))
            .reduce((soma, i) => soma + (parseInt(i.quantidade, 10) || 0), 0);

        if (estoque !== null && jaNoCarrinho >= estoque) {
            this.mostrarStatusSincronizacao('aviso', `Você já adicionou todo o estoque disponível de "${prod.nome}".`, 6000);
            return;
        }

        if (existente) {
            existente.quantidade++;
            existente.estoque = estoque;
        } else {
            this.carrinho.push({
                cartId: `cart_${prod.id}_${Date.now()}_${Math.floor(Math.random()*1000)}`,
                id: prod.id,
                nome: prod.nome,
                preco: parseFloat(prod.preco),
                foto: this.resolverFoto(prod),
                quantidade: 1,
                estoque,
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

        const item = this.carrinho[index];
        const prodAtual = this.encontrarProdutoAtual(item);
        const estoque = this.normalizarEstoque(prodAtual ? prodAtual.estoque : item.estoque);

        if (delta > 0 && estoque !== null) {
            const quantidadeNoCarrinho = this.carrinho
                .filter(i => String(i.id) === String(item.id))
                .reduce((soma, i) => soma + (parseInt(i.quantidade, 10) || 0), 0);
            if (quantidadeNoCarrinho + delta > estoque) {
                this.mostrarStatusSincronizacao('aviso', `Estoque máximo de "${item.nome}": ${estoque} unidade(s).`, 5000);
                return;
            }
        }

        item.quantidade += delta;

        if (item.quantidade <= 0) {
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
                const precoUnitario = parseFloat(item.preco) || 0;
                const sub = (item.quantidade * precoUnitario).toFixed(2).replace('.', ',');
                const unit = precoUnitario.toFixed(2).replace('.', ',');
                const fotoUrl = item.foto || '/assets/products/Mel-in-natura-500g.webp';
                const obsHtml = item.obs ? `<div class="cart-item-obs" style="font-size: 0.78rem; color: #786C5E; font-style: italic; margin-top: 0.2rem;">Obs: ${this.escaparHtml(item.obs)}</div>` : '';

                const prodAtual = this.encontrarProdutoAtual(item);
                const estoque = this.normalizarEstoque(prodAtual ? prodAtual.estoque : item.estoque);
                const esgotado = prodAtual ? this.estaEsgotado(prodAtual) : (estoque !== null && estoque <= 0);
                const atingiuLimite = estoque !== null && item.quantidade >= estoque;

                let estoqueNota = '';
                if (esgotado) {
                    estoqueNota = '<div class="cart-item-stock esgotado">Esgotado — remova este item</div>';
                } else if (atingiuLimite) {
                    estoqueNota = `<div class="cart-item-stock">Limite de ${estoque} unidade(s) em estoque</div>`;
                } else if (estoque !== null && estoque <= 5) {
                    estoqueNota = `<div class="cart-item-stock">Restam ${estoque} unidade(s)</div>`;
                }

                return `
                    <div class="cart-item-row">
                        <img src="${this.escaparHtml(fotoUrl)}" alt="${this.escaparHtml(item.nome)}" class="cart-item-img" onerror="window.handleCatalogImgError && window.handleCatalogImgError(this)">
                        <div class="cart-item-info">
                            <div class="cart-item-name">${this.escaparHtml(item.nome)}</div>
                            ${obsHtml}
                            <div class="cart-item-unit-price">R$ ${unit} un</div>
                            ${estoqueNota}
                            <div style="margin-top: 0.4rem;">
                                <div class="qty-stepper">
                                    <button class="qty-btn" type="button" aria-label="Diminuir quantidade" onclick="catalogoApp.alterarQuantidade('${item.cartId || item.id}', -1)">−</button>
                                    <span class="qty-value">${item.quantidade}</span>
                                    <button class="qty-btn" type="button" aria-label="Aumentar quantidade" onclick="catalogoApp.alterarQuantidade('${item.cartId || item.id}', 1)" ${(esgotado || atingiuLimite) ? 'disabled aria-disabled="true"' : ''}>+</button>
                                </div>
                            </div>
                        </div>
                        <div class="cart-item-subtotal">
                            <div>R$ ${sub}</div>
                            <button class="cart-item-remove" type="button" onclick="catalogoApp.removerItem('${item.cartId || item.id}')" title="Remover item" aria-label="Remover item">
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
                this.atualizarEstadoUrl();
                this.renderizarProdutos();
            });
        }

        // Ordenação
        const sortSelect = document.getElementById('catalogSort');
        if (sortSelect) {
            sortSelect.addEventListener('change', (e) => {
                this.ordenacao = e.target.value || 'relevancia';
                this.atualizarEstadoUrl();
                this.renderizarProdutos();
            });
        }

        // Abertura e fechamento do Drawer
        const abrirDrawer = () => this.abrirDrawerCarrinho();
        const fecharDrawer = () => this.fecharDrawerCarrinho();

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

        // Configuração de Entrega vs Retirada (radios nativos dentro dos cards)
        const aplicarEntrega = (tipo) => {
            this.tipoEntrega = tipo || 'entrega';
            document.querySelectorAll('.delivery-opt-card').forEach(c => {
                const match = c.getAttribute('data-type') === this.tipoEntrega;
                c.classList.toggle('active', match);
                const radio = c.querySelector('input[type="radio"]');
                if (radio) radio.checked = match;
            });

            const addressFields = document.getElementById('addressFieldsGroup');
            if (addressFields) {
                addressFields.style.display = this.tipoEntrega === 'entrega' ? 'block' : 'none';
                if (this.tipoEntrega === 'entrega') {
                    setTimeout(() => document.getElementById('checkoutCep')?.focus(), 150);
                }
            }
        };

        document.querySelectorAll('input[name="tipoEntrega"]').forEach(radio => {
            radio.addEventListener('change', () => aplicarEntrega(radio.value));
        });

        // Configuração de Formas de Pagamento (radios nativos dentro dos cards)
        const aplicarPagamento = (pagamento) => {
            this.formaPagamento = pagamento || 'pix';
            document.querySelectorAll('.payment-opt-card').forEach(c => {
                const match = c.getAttribute('data-payment') === this.formaPagamento;
                c.classList.toggle('active', match);
                const radio = c.querySelector('input[type="radio"]');
                if (radio) radio.checked = match;
            });

            const pixBox = document.getElementById('pixDetailsBox');
            const trocoBox = document.getElementById('trocoGroup');

            if (pixBox) {
                pixBox.style.display = this.formaPagamento === 'pix' ? 'block' : 'none';
                if (this.formaPagamento === 'pix') {
                    this.atualizarPixCheckout();
                }
            }
            if (trocoBox) trocoBox.style.display = this.formaPagamento === 'dinheiro' ? 'block' : 'none';
        };

        document.querySelectorAll('input[name="formaPagamento"]').forEach(radio => {
            radio.addEventListener('change', () => aplicarPagamento(radio.value));
        });

        ['checkoutNome', 'checkoutTelefone', 'checkoutRua', 'checkoutNumero'].forEach(id => {
            document.getElementById(id)?.addEventListener('input', () => this.limparErrosCheckout());
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
        const previewHeader = document.getElementById('checkoutPreviewHeader');
        previewHeader?.addEventListener('click', () => {
            this.togglePreviewItens();
        });
        previewHeader?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.togglePreviewItens();
            }
        });

        // Fechamento de modais com a tecla ESC e Focus Trap com Tab
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.fecharModalProduto();
                this.fecharModalCheckout();
                fecharDrawer();
                return;
            }
            if (e.key === 'Tab') {
                const containerAtivo =
                    document.querySelector('#productModalOverlay.active .product-modal-box') ||
                    document.querySelector('#checkoutModalOverlay.active .checkout-modal-box') ||
                    document.querySelector('#cartDrawer.active');
                if (!containerAtivo) return;

                const focaveis = Array.from(containerAtivo.querySelectorAll(
                    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
                )).filter(el => el.offsetParent !== null);

                if (focaveis.length === 0) return;
                const primeiro = focaveis[0];
                const ultimo = focaveis[focaveis.length - 1];

                if (e.shiftKey && document.activeElement === primeiro) {
                    e.preventDefault();
                    ultimo.focus();
                } else if (!e.shiftKey && document.activeElement === ultimo) {
                    e.preventDefault();
                    primeiro.focus();
                }
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
                statusMsg.innerText = `Endereço localizado: ${data.localidade} - ${data.uf}. Agora digite o número da sua casa.`;
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
        this.limparErrosCheckout();

        const total = this.calcularTotal();
        const totalFormatado = total.toFixed(2).replace('.', ',');
        const checkoutTotalDisplay = document.getElementById('checkoutTotalDisplay');
        if (checkoutTotalDisplay) checkoutTotalDisplay.innerText = `R$ ${totalFormatado}`;

        this.preencherDadosPerfil();
        this.atualizarPreviewItensCheckout();
        this.atualizarPixCheckout();

        this.ultimoElementoFocado = document.activeElement;
        const overlay = document.getElementById('checkoutModalOverlay');
        overlay?.classList.add('active');
        overlay?.setAttribute('aria-hidden', 'false');
        document.getElementById('checkoutFormView')?.style.setProperty('display', 'block');
        document.getElementById('checkoutReviewView')?.style.setProperty('display', 'none');
        document.getElementById('checkoutSuccessView')?.style.setProperty('display', 'none');
        setTimeout(() => document.getElementById('checkoutNome')?.focus(), 50);
    }

    fecharModalCheckout() {
        const overlay = document.getElementById('checkoutModalOverlay');
        const estavaAtivo = overlay?.classList.contains('active');
        overlay?.classList.remove('active');
        overlay?.setAttribute('aria-hidden', 'true');
        if (estavaAtivo && this.ultimoElementoFocado && typeof this.ultimoElementoFocado.focus === 'function') {
            this.ultimoElementoFocado.focus();
        }
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
            const sub = (item.quantidade * (parseFloat(item.preco) || 0)).toFixed(2).replace('.', ',');
            const obsHtml = item.obs ? `<div style="font-size: 0.75rem; color: #786C5E; font-style: italic;">Obs: ${this.escaparHtml(item.obs)}</div>` : '';
            return `
                <div class="checkout-preview-item">
                    <div class="checkout-preview-item-name">
                        <span>${item.quantidade}x ${this.escaparHtml(item.nome)}</span>
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
        const headerEl = document.getElementById('checkoutPreviewHeader');
        if (!listEl) return;

        const isOpen = listEl.style.display !== 'none';
        if (isOpen) {
            listEl.style.display = 'none';
            if (chevron) chevron.style.transform = 'rotate(0deg)';
            headerEl?.setAttribute('aria-expanded', 'false');
        } else {
            listEl.style.display = 'flex';
            if (chevron) chevron.style.transform = 'rotate(180deg)';
            headerEl?.setAttribute('aria-expanded', 'true');
        }
    }

    // Valida o carrinho contra o catálogo carregado antes de avançar/confirmar.
    validarCarrinhoComEstoqueAtual() {
        const erros = [];
        if (this.carrinho.length === 0) {
            erros.push('Seu carrinho está vazio.');
            return erros;
        }

        // Sem catálogo carregado (offline), não bloqueia: o backend/fallback
        // ainda fará a validação quando houver conexão.
        if (!Array.isArray(this.produtos) || this.produtos.length === 0) return erros;

        for (const item of this.carrinho) {
            const prod = this.encontrarProdutoAtual(item);

            if (!prod) {
                erros.push(`"${item.nome}" não está mais no catálogo.`);
                continue;
            }
            if (prod.ativo === false) {
                erros.push(`"${prod.nome}" não está mais disponível.`);
                continue;
            }

            const estoque = this.normalizarEstoque(prod.estoque);
            if (estoque !== null && estoque <= 0) {
                erros.push(`"${prod.nome}" está esgotado.`);
                continue;
            }
            if (estoque !== null && item.quantidade > estoque) {
                erros.push(`"${prod.nome}" tem apenas ${estoque} unidade(s) em estoque (você escolheu ${item.quantidade}).`);
            }
        }

        return erros;
    }

    // =========================================================================
    // PROCESSAMENTO DO PEDIDO (POST /api/catalogo/pedidos)
    // =========================================================================
    limparErrosCheckout() {
        const banner = document.getElementById('checkoutFormError');
        if (banner) {
            banner.textContent = '';
            banner.classList.remove('visible');
        }
        ['checkoutNome', 'checkoutTelefone', 'checkoutRua', 'checkoutNumero'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.classList.remove('is-invalid');
                el.removeAttribute('aria-invalid');
            }
        });
        ['checkoutNomeErr', 'checkoutTelefoneErr'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.textContent = '';
                el.classList.remove('visible');
            }
        });
    }

    exibirErroCheckout(mensagem, campoId, fieldErrId) {
        const banner = document.getElementById('checkoutFormError');
        if (banner) {
            banner.textContent = mensagem;
            banner.classList.add('visible');
        }
        if (fieldErrId) {
            const fieldErr = document.getElementById(fieldErrId);
            if (fieldErr) {
                fieldErr.textContent = mensagem;
                fieldErr.classList.add('visible');
            }
        }
        const campo = campoId ? document.getElementById(campoId) : null;
        if (campo) {
            campo.classList.add('is-invalid');
            campo.setAttribute('aria-invalid', 'true');
            campo.focus();
            campo.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else if (banner) {
            banner.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    // =========================================================================
    // 1. ETAPA DE REVISÃO DO PEDIDO (Valida campos e abre tela de confirmação)
    // =========================================================================
    async processarPedido(e) {
        e.preventDefault();
        this.limparErrosCheckout();

        const errosCatalogo = this.validarCarrinhoComEstoqueAtual();
        if (errosCatalogo.length > 0) {
            this.exibirErroCheckout(`Revise os itens do carrinho: ${errosCatalogo.join(' ')}`);
            await this.tentarNovamente();
            return;
        }

        const nome = document.getElementById('checkoutNome')?.value.trim();
        const telefone = document.getElementById('checkoutTelefone')?.value.trim();
        const obs = document.getElementById('checkoutObs')?.value.trim() || '';

        if (!nome || nome.length < 2) {
            this.exibirErroCheckout('Por favor, informe seu nome completo.', 'checkoutNome', 'checkoutNomeErr');
            return;
        }

        const telDigitos = telefone ? telefone.replace(/\D/g, '') : '';
        if (telDigitos.length < 10) {
            this.exibirErroCheckout('Informe um número de WhatsApp válido com DDD para contato e rastreio.', 'checkoutTelefone', 'checkoutTelefoneErr');
            return;
        }

        let endereco = {};
        if (this.tipoEntrega === 'entrega') {
            const rua = document.getElementById('checkoutRua')?.value.trim() || '';
            const numero = document.getElementById('checkoutNumero')?.value.trim() || '';
            if (!rua || !numero) {
                const alvo = !rua ? 'checkoutRua' : 'checkoutNumero';
                this.exibirErroCheckout('Informe a Rua e o Número do seu endereço para entrega.', alvo);
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
                const sub = (item.quantidade * (parseFloat(item.preco) || 0)).toFixed(2).replace('.', ',');
                const obsStr = item.obs ? `<div style="font-size: 0.72rem; color: #786C5E; font-style: italic;">Obs: ${this.escaparHtml(item.obs)}</div>` : '';
                return `
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; padding: 0.35rem 0; border-bottom: 1px dashed #EDE5DA;">
                        <div>
                            <span style="font-weight: 600; color: var(--color-dark);">${item.quantidade}x ${this.escaparHtml(item.nome)}</span>
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

        const errosCatalogo = this.validarCarrinhoComEstoqueAtual();
        if (errosCatalogo.length > 0) {
            alert(`Não foi possível concluir o pedido:\n\n${errosCatalogo.join('\n')}\n\nO catálogo será atualizado agora.`);
            await this.tentarNovamente();
            return;
        }

        const btnFinal = document.getElementById('btnFinalConfirmOrder');
        const restaurarBotaoFinal = () => {
            if (!btnFinal) return;
            btnFinal.disabled = false;
            btnFinal.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 6px;">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                <span>Confirmar e Finalizar Pedido</span>
            `;
        };

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

        // Reenvia os dados atuais do carrinho (preço/estoque podem ter mudado).
        const totalAtual = this.calcularTotal();
        const payload = {
            ...this.pendingOrderPayload,
            itens: this.carrinho.map(item => ({
                id: item.id,
                nome: item.nome,
                preco: parseFloat(item.preco) || 0,
                quantidade: parseInt(item.quantidade, 10) || 1,
                obs: item.obs || '',
                foto: item.foto || ''
            })),
            subtotal: totalAtual,
            total: totalAtual
        };
        this.pendingOrderPayload = payload;

        try {
            const res = await fetch(this.getApiUrl('/api/catalogo/pedidos'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const texto = await res.text();
            let data = {};
            try {
                data = texto ? JSON.parse(texto) : {};
            } catch (_) {
                throw new Error('O servidor retornou uma resposta inválida.');
            }

            if (!res.ok) {
                const erroHttp = new Error(data.erro || `HTTP ${res.status}`);
                erroHttp.status = res.status;
                erroHttp.data = data;
                throw erroHttp;
            }

            if (!data.sucesso || !data.codigo_pedido) {
                throw new Error(data.erro || 'Erro ao registrar pedido.');
            }

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
        } catch (err) {
            // Erro de validação do catálogo (produto inativo, esgotado, preço ou
            // estoque divergente): NÃO cria pedido local. Atualiza e pede revisão.
            if (err.status >= 400 && err.status < 500) {
                restaurarBotaoFinal();
                this.pendingOrderPayload = null;
                this.fecharModalCheckout();

                const detalhes = err.data && Array.isArray(err.data.erros) && err.data.erros.length > 0
                    ? err.data.erros.join('\n')
                    : err.message;
                alert(`Não foi possível concluir o pedido:\n\n${detalhes}\n\nO catálogo foi atualizado. Revise seu carrinho e tente novamente.`);
                await this.tentarNovamente();
                return;
            }

            console.warn('Backend indisponível ou offline, gerando pedido resiliente com rastreio local:', err.message);

            const codigoPedido = `FD-${Date.now().toString().slice(-4)}${Math.floor(10 + Math.random() * 90)}`;
            const tokenAcesso = Array.from(crypto.getRandomValues(new Uint8Array(16)))
                .map(b => b.toString(16).padStart(2, '0')).join('');

            const fallbackData = {
                sucesso: true,
                offline: true,
                codigo_pedido: codigoPedido,
                token_acesso: tokenAcesso,
                pedido: {
                    ...payload,
                    codigo_pedido: codigoPedido,
                    token_acesso: tokenAcesso,
                    status: 'novo',
                    offline: true,
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
            const url = new URL(window.location.href);
            const addParam = url.searchParams.get('add');
            if (!addParam) return;

            const limparParametro = () => {
                url.searchParams.delete('add');
                window.history.replaceState({}, document.title, url.pathname + (url.search ? url.search : '') + url.hash);
            };

            if (!Array.isArray(this.produtos) || this.produtos.length === 0) {
                this.mostrarStatusSincronizacao('aviso', 'O catálogo ainda não foi carregado. Tente novamente em instantes.', 6000);
                limparParametro();
                return;
            }

            // Aceita id, slug da landing page ou nome do produto — sempre
            // resolvido contra o catálogo real, nunca por tabela fixa de IDs.
            const prod = this.encontrarProdutoPorReferencia(addParam);
            if (!prod) {
                this.mostrarStatusSincronizacao('aviso', `O produto do link "${addParam}" não está disponível no catálogo.`, 8000);
                limparParametro();
                return;
            }

            if (this.estaEsgotado(prod)) {
                this.mostrarStatusSincronizacao('aviso', `"${prod.nome}" está esgotado no momento.`, 7000);
                limparParametro();
                return;
            }

            const estoque = this.normalizarEstoque(prod.estoque);
            const jaNoCarrinho = this.carrinho
                .filter(i => String(i.id) === String(prod.id))
                .reduce((soma, i) => soma + (parseInt(i.quantidade, 10) || 0), 0);

            if (estoque !== null && jaNoCarrinho >= estoque) {
                this.mostrarStatusSincronizacao('aviso', `Você já adicionou todo o estoque disponível de "${prod.nome}".`, 6000);
                limparParametro();
                return;
            }

            const existente = this.carrinho.find(i => String(i.id) === String(prod.id) && !i.obs);
            if (existente) {
                existente.quantidade += 1;
                existente.estoque = estoque;
            } else {
                this.carrinho.push({
                    cartId: `cart_${prod.id}_${Date.now()}_${Math.floor(Math.random()*1000)}`,
                    id: prod.id,
                    nome: prod.nome,
                    preco: parseFloat(prod.preco),
                    foto: this.resolverFoto(prod),
                    quantidade: 1,
                    estoque,
                    obs: ''
                });
            }

            this.salvarCarrinho();
            this.atualizarInterfaceCarrinho();
            this.renderizarProdutos();

            // Abre o Drawer do Carrinho suavemente para o cliente
            setTimeout(() => {
                document.getElementById('cartDrawerOverlay')?.classList.add('active');
                document.getElementById('cartDrawer')?.classList.add('active');
            }, 300);

            limparParametro();
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
