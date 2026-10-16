/**
 * Apiário Favo de Mel - Catálogo Interativo & Checkout Trem Delivery
 * Versão: 2.0 (Desacoplado, Reativo, Zero WordPress)
 */

class CatalogoApp {
    constructor() {
        this.produtos = [];
        this.categorias = [];
        this.categoriaAtiva = 'todos';
        this.termoBusca = '';
        this.carrinho = this.carregarCarrinho();
        
        this.tipoEntrega = 'entrega';
        this.formaPagamento = 'pix';
        
        this.init();
    }

    async init() {
        this.configurarEventosGlobais();
        await this.carregarDadosDoServidor();
        this.renderizarCategorias();
        this.renderizarProdutos();
        this.atualizarInterfaceCarrinho();
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
    // REQUISIÇÃO DA API
    // =========================================================================
    getApiUrl(endpoint) {
        const base = (window.FAVODEMEL_API_URL || '').replace(/\/$/, '');
        if (!base && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
            if (window.location.port !== '8080') {
                return `http://localhost:8080${endpoint}`;
            }
        }
        return `${base}${endpoint}`;
    }

    async carregarDadosDoServidor() {
        try {
            const gridEl = document.getElementById('catalogGrid');
            if (gridEl) {
                gridEl.innerHTML = `
                    <div style="grid-column: 1/-1; text-align: center; padding: 4rem 1rem; color: #6E6359;">
                        <div style="font-size: 2.5rem; margin-bottom: 0.5rem; animation: pulseDot 1.5s infinite;">🍯</div>
                        <p style="font-weight: 600;">Carregando produtos direto da colmeia...</p>
                    </div>
                `;
            }

            const res = await fetch(this.getApiUrl('/api/catalogo/produtos'));
            const data = await res.json();

            if (data.sucesso && Array.isArray(data.produtos) && data.produtos.length > 0) {
                this.categorias = data.categorias || [];
                this.produtos = data.produtos || [];
                return;
            } else {
                throw new Error(data.erro || 'Falha ao carregar catálogo da API');
            }
        } catch (err) {
            console.warn('Utilizando catálogo integrado do Apiário Favo de Mel (Modo Resiliente):', err.message);
            // Fallback com catálogo 100% autêntico do Apiário Favo de Mel
            this.categorias = [
                { id: 1, nome: "Méis & Acessórios", icone: "🍯" },
                { id: 2, nome: "Cuidados Naturais e Própolis", icone: "🌿" },
                { id: 3, nome: "Artesanais, Cera & Bebidas", icone: "🕯️" }
            ];

            this.produtos = [
                { id: 1, categoria_id: 1, nome: "Mel de Uruçú (Nativa)", preco: 85.00, descricao: "Mel nobre e medicinal de abelha nativa sem ferrão Uruçu. Acidez equilibrada e propriedades bioativas excepcionais.", estoque: 15, foto: "/img/mel-silvestre.jpg" },
                { id: 2, categoria_id: 1, nome: "Meleira com Mel Nobre", preco: 60.00, descricao: "Elegante meleira em vidro artesanal de alta qualidade, acompanhada com mel puro de florada silvestre.", estoque: 20, foto: "/img/mel-laranjeira.jpg" },
                { id: 3, categoria_id: 2, nome: "Pomada de Própolis Pura (20g)", preco: 45.00, descricao: "Pomada natural de própolis puro e cera de abelha. Potente ação cicatrizante, regeneradora e anti-inflamatória.", estoque: 30, foto: "/img/propolis-verde.jpg" },
                { id: 4, categoria_id: 2, nome: "Hidratante Labial Mel & Cera", preco: 12.00, descricao: "Hidratação nutritiva e duradoura para os lábios à base de pura cera de opérculo e mel cru.", estoque: 50, foto: "/img/sabonete-mel.jpg" },
                { id: 5, categoria_id: 2, nome: "Cone Hindu Terapêutico", preco: 15.00, descricao: "Confeccionado artesanalmente com algodão nobre e cera virgem de abelhas para desobstrução e alívio das vias aéreas.", estoque: 40, foto: "/img/favo-mel.jpg" },
                { id: 6, categoria_id: 2, nome: "Pasta Nutritiva de Cera de Abelha", preco: 19.00, descricao: "Tratamento hidratante natural intenso para peles ressecadas à base de cera pura e óleos botânicos.", estoque: 25, foto: "/img/mel-pimenta.jpg" },
                { id: 7, categoria_id: 3, nome: "Hidromel Tradicional (250ml)", preco: 25.00, descricao: "A lendária bebida artesanal dos deuses, fermentada lentamente a partir de puro mel silvestre e leveduras nobres.", estoque: 18, foto: "/img/hero.jpg" },
                { id: 8, categoria_id: 3, nome: "Vela Artesanal de Cera Pura", preco: 12.00, descricao: "Vela 100% natural de pura cera de abelhas sem parafina. Aroma suave de mel e queima limpa e aromática.", estoque: 35, foto: "/img/historia.jpg" },
                { id: 9, categoria_id: 3, nome: "Aromatizador Colmeia", preco: 10.00, descricao: "Difusor de aroma artesanal que traz o aconchego aromático da natureza e das floradas para seu ambiente.", estoque: 40, foto: "/img/selo-qualidade.jpg" },
                { id: 10, categoria_id: 3, nome: "Desmoldante Culinário Natural", preco: 15.00, descricao: "Desmoldante culinário natural e atóxico à base de cera de abelhas, ideal para formas de bolos e pães.", estoque: 30, foto: "/img/mel-laranjeira.jpg" },
                { id: 11, categoria_id: 3, nome: "Cera Alveolada Pura (kg)", preco: 100.00, descricao: "Lâminas de cera pura de abelhas alveolada para manejo apícola nobre, artesanato e cosméticos.", estoque: 10, foto: "/img/favo-mel.jpg" },
                { id: 12, categoria_id: 3, nome: "Formão Reforçado para Apicultura", preco: 85.00, descricao: "Ferramenta essencial e robusta em aço forjado para abertura e manejo seguro de colmeias.", estoque: 8, foto: "/img/mel-silvestre.jpg" }
            ];
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
                🌟 Todos os Produtos (${this.produtos.length})
            </button>
        `;

        this.categorias.forEach(cat => {
            const count = this.produtos.filter(p => String(p.categoria_id) === String(cat.id)).length;
            const icone = cat.icone || '🍯';
            html += `
                <button class="category-pill ${this.categoriaAtiva === String(cat.id) ? 'active' : ''}" data-cat="${cat.id}">
                    ${icone} ${cat.nome} (${count})
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
            
            // Foto do produto com fallback
            const fotoUrl = prod.foto || '/site-assets/avatar-favo-de-mel.png';
            const catNome = prod.categoria_nome || 'Apiário Favo de Mel';

            return `
                <div class="catalog-card" data-id="${prod.id}">
                    <div class="card-img-area" onclick="catalogoApp.adicionarItem(${prod.id})">
                        <span class="card-category-tag">${catNome}</span>
                        <img src="${fotoUrl}" alt="${prod.nome}" loading="lazy">
                    </div>
                    <div class="card-content">
                        <h3 class="card-title">${prod.nome}</h3>
                        <p class="card-desc">${prod.descricao || 'Produto natural de altíssima qualidade direto do apiário.'}</p>
                        
                        <div class="card-bottom-row">
                            <div class="card-price"><small>R$</small> ${precoFormatado}</div>
                            
                            ${qtdNoCarrinho > 0 ? `
                                <div class="qty-stepper">
                                    <button class="qty-btn" onclick="catalogoApp.alterarQuantidade(${prod.id}, -1)">−</button>
                                    <span class="qty-value">${qtdNoCarrinho}</span>
                                    <button class="qty-btn" onclick="catalogoApp.alterarQuantidade(${prod.id}, 1)">+</button>
                                </div>
                            ` : `
                                <button class="btn-add-cart" onclick="catalogoApp.adicionarItem(${prod.id})">
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
    // OPERAÇÕES DO CARRINHO
    // =========================================================================
    adicionarItem(id) {
        const prod = this.produtos.find(p => String(p.id) === String(id));
        if (!prod) return;

        const existente = this.carrinho.find(i => String(i.id) === String(id));
        if (existente) {
            existente.quantidade++;
        } else {
            this.carrinho.push({
                id: prod.id,
                nome: prod.nome,
                preco: parseFloat(prod.preco),
                foto: prod.foto,
                quantidade: 1
            });
        }

        this.salvarCarrinho();
        this.atualizarInterfaceCarrinho();
        this.renderizarProdutos();
    }

    alterarQuantidade(id, delta) {
        const index = this.carrinho.findIndex(i => String(i.id) === String(id));
        if (index === -1) return;

        this.carrinho[index].quantidade += delta;

        if (this.carrinho[index].quantidade <= 0) {
            this.carrinho.splice(index, 1);
        }

        this.salvarCarrinho();
        this.atualizarInterfaceCarrinho();
        this.renderizarProdutos();
    }

    removerItem(id) {
        this.carrinho = this.carrinho.filter(i => String(i.id) !== String(id));
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
                const fotoUrl = item.foto || '/site-assets/avatar-favo-de-mel.png';

                return `
                    <div class="cart-item-row">
                        <img src="${fotoUrl}" alt="${item.nome}" class="cart-item-img">
                        <div class="cart-item-info">
                            <div class="cart-item-name">${item.nome}</div>
                            <div class="cart-item-unit-price">R$ ${unit} un</div>
                            <div style="margin-top: 0.4rem;">
                                <div class="qty-stepper">
                                    <button class="qty-btn" onclick="catalogoApp.alterarQuantidade(${item.id}, -1)">−</button>
                                    <span class="qty-value">${item.quantidade}</span>
                                    <button class="qty-btn" onclick="catalogoApp.alterarQuantidade(${item.id}, 1)">+</button>
                                </div>
                            </div>
                        </div>
                        <div class="cart-item-subtotal">
                            <div>R$ ${sub}</div>
                            <button class="cart-item-remove" onclick="catalogoApp.removerItem(${item.id})" title="Remover item" aria-label="Remover item">
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

                if (pixBox) pixBox.style.display = this.formaPagamento === 'pix' ? 'block' : 'none';
                if (trocoBox) trocoBox.style.display = this.formaPagamento === 'dinheiro' ? 'block' : 'none';
            });
        });

        // Botão de Copiar Chave PIX
        document.getElementById('btnCopyPix')?.addEventListener('click', () => {
            const key = document.getElementById('pixKeyValue')?.innerText || '79988125726';
            navigator.clipboard.writeText(key).then(() => {
                const btn = document.getElementById('btnCopyPix');
                const orig = btn.innerText;
                btn.innerText = 'Copiado!';
                btn.style.background = '#15803D';
                setTimeout(() => {
                    btn.innerText = orig;
                    btn.style.background = '';
                }, 2500);
            });
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

        // Submissão do Formulário de Checkout
        const formCheckout = document.getElementById('formCheckout');
        if (formCheckout) {
            formCheckout.addEventListener('submit', (e) => this.processarPedido(e));
        }
    }

    abrirModalCheckout() {
        const total = this.calcularTotal();
        const totalFormatado = total.toFixed(2).replace('.', ',');
        const checkoutTotalDisplay = document.getElementById('checkoutTotalDisplay');
        if (checkoutTotalDisplay) checkoutTotalDisplay.innerText = `R$ ${totalFormatado}`;

        document.getElementById('checkoutModalOverlay')?.classList.add('active');
        document.getElementById('checkoutFormView')?.style.setProperty('display', 'block');
        document.getElementById('checkoutSuccessView')?.style.setProperty('display', 'none');
    }

    fecharModalCheckout() {
        document.getElementById('checkoutModalOverlay')?.classList.remove('active');
    }

    // =========================================================================
    // PROCESSAMENTO DO PEDIDO (POST /api/catalogo/pedidos)
    // =========================================================================
    async processarPedido(e) {
        e.preventDefault();

        const submitBtn = document.getElementById('btnSubmitOrder');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = `Processando Pedido...`;
        }

        const nome = document.getElementById('checkoutNome').value.trim();
        const telefone = document.getElementById('checkoutTelefone').value.trim();
        const obs = document.getElementById('checkoutObs').value.trim();

        let endereco = {};
        if (this.tipoEntrega === 'entrega') {
            endereco = {
                rua: document.getElementById('checkoutRua')?.value.trim() || '',
                numero: document.getElementById('checkoutNumero')?.value.trim() || '',
                bairro: document.getElementById('checkoutBairro')?.value.trim() || '',
                cidade: document.getElementById('checkoutCidade')?.value.trim() || '',
                complemento: document.getElementById('checkoutComplemento')?.value.trim() || ''
            };
        }

        const trocoPara = document.getElementById('checkoutTroco')?.value.trim() || '';
        const total = this.calcularTotal();

        const payload = {
            cliente_nome: nome,
            cliente_telefone: telefone,
            tipo_entrega: this.tipoEntrega,
            endereco: endereco,
            forma_pagamento: this.formaPagamento,
            troco_para: trocoPara,
            observacoes: obs,
            itens: this.carrinho,
            subtotal: total,
            taxa_entrega: 0,
            total: total
        };

        try {
            const res = await fetch(this.getApiUrl('/api/catalogo/pedidos'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await res.json();

            if (data.sucesso) {
                try {
                    localStorage.setItem('favodemel_ultimo_pedido', JSON.stringify({
                        codigo_pedido: data.codigo_pedido,
                        token_acesso: data.token_acesso,
                        pedido: data.pedido || payload,
                        whatsapp_url: data.whatsapp_url,
                        criado_em: new Date().toISOString()
                    }));
                } catch (_) {}

                this.exibirSucessoPedido(data);
                this.limparCarrinho();
                return;
            } else {
                throw new Error(data.erro || 'Erro ao registrar pedido.');
            }
        } catch (err) {
            console.warn('Backend indisponível, gerando pedido com despacho direto via WhatsApp:', err.message);
            // Fallback Resiliente Direto para WhatsApp do Vendedor
            const codigoPedido = `FD-${Date.now().toString().slice(-4)}${Math.floor(10 + Math.random() * 90)}`;
            const tokenAcesso = Array.from(crypto.getRandomValues(new Uint8Array(16)))
                .map(b => b.toString(16).padStart(2, '0')).join('');

            const linhasItens = this.carrinho.map(i => {
                const sub = ((i.quantidade || 1) * parseFloat(i.preco || 0)).toFixed(2).replace('.', ',');
                return `🍯 ${i.quantidade}x *${i.nome}* = R$ ${sub}`;
            }).join('\n');

            let txtEnd = this.tipoEntrega === 'entrega' 
                ? `📍 *Endereço:* ${endereco.rua || ''}, ${endereco.numero || ''} - ${endereco.bairro || ''}, ${endereco.cidade || ''} (${endereco.complemento || ''})`
                : `🏪 *Modalidade:* Retirada no Apiário`;

            let txtPag = this.formaPagamento === 'pix' ? 'PIX (Chave: 79988125726)' : (this.formaPagamento === 'cartao' ? 'Cartão' : `Dinheiro (Troco: ${trocoPara || 'Não'})`);

            const msgWa = `🍯 *NOVO PEDIDO DO SITE - APIÁRIO FAVO DE MEL* 🐝\n📦 *Pedido:* #${codigoPedido}\n👤 *Cliente:* ${nome}\n📱 *WhatsApp:* ${telefone}\n\n${txtEnd}\n💳 *Pagamento:* ${txtPag}\n\n🛒 *Itens:*\n${linhasItens}\n\n⭐ *TOTAL:* R$ ${total.toFixed(2).replace('.', ',')}`;

            const numeroVendedor = '557988125726';
            const waUrl = `https://wa.me/${numeroVendedor}?text=${encodeURIComponent(msgWa)}`;

            const fallbackData = {
                sucesso: true,
                codigo_pedido: codigoPedido,
                token_acesso: tokenAcesso,
                whatsapp_url: waUrl,
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

            this.exibirSucessoPedido(fallbackData);
            this.limparCarrinho();
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="vertical-align: middle; margin-right: 6px;"><path d="M17.472 14.382c-.301-.15-1.78-.879-2.056-.98-.276-.1-.477-.15-.678.15-.2.301-.778.98-.954 1.181-.176.2-.352.226-.653.076-.301-.15-1.272-.469-2.423-1.496-.896-.799-1.501-1.786-1.677-2.087-.176-.301-.019-.464.132-.614.136-.135.301-.352.452-.528.15-.176.2-.301.301-.502.101-.2.05-.376-.025-.527-.075-.15-.678-1.633-.929-2.239-.245-.589-.494-.509-.678-.519-.176-.01-.376-.01-.577-.01-.201 0-.527.075-.803.376s-1.054 1.03-1.054 2.511 1.08 2.912 1.23 3.113c.15.2 2.126 3.246 5.15 4.553.719.311 1.281.497 1.719.636.723.23 1.381.197 1.902.12.58-.087 1.78-.728 2.031-1.431.251-.703.251-1.305.176-1.431-.076-.126-.276-.201-.577-.351zM12.04 2C6.52 2 2.03 6.49 2.03 12c0 1.98.58 3.82 1.58 5.37L2 22l4.77-1.55c1.49.92 3.24 1.45 5.27 1.45 5.52 0 10.01-4.49 10.01-10S17.56 2 12.04 2zm0 18.25c-1.74 0-3.37-.5-4.75-1.36l-.34-.21-2.82.92.94-2.75-.23-.37a8.217 8.217 0 0 1-1.26-4.48c0-4.57 3.72-8.29 8.29-8.29 4.57 0 8.29 3.72 8.29 8.29 0 4.57-3.72 8.29-8.29 8.29z"/></svg> <span>Confirmar Pedido no WhatsApp</span>`;
            }
        }
    }

    exibirSucessoPedido(dados) {
        document.getElementById('checkoutFormView')?.style.setProperty('display', 'none');
        const successView = document.getElementById('checkoutSuccessView');
        if (successView) {
            successView.style.setProperty('display', 'block');
            document.getElementById('successOrderCode').innerText = `#${dados.codigo_pedido}`;
            
            const btnWa = document.getElementById('btnOpenWhatsAppOrder');
            if (btnWa && dados.whatsapp_url) {
                btnWa.href = dados.whatsapp_url;
            }

            const btnTrack = document.getElementById('btnTrackOrder');
            if (btnTrack) {
                const urlToken = dados.token_acesso ? `&token=${encodeURIComponent(dados.token_acesso)}` : '';
                btnTrack.href = `/pedido.html?codigo=${encodeURIComponent(dados.codigo_pedido)}${urlToken}`;
            }

            // Abre o WhatsApp automaticamente após 1.2 segundos
            if (dados.whatsapp_url) {
                setTimeout(() => {
                    window.open(dados.whatsapp_url, '_blank');
                }, 1200);
            }
        }
    }
}

// Inicializa a aplicação
let catalogoApp;
document.addEventListener('DOMContentLoaded', () => {
    catalogoApp = new CatalogoApp();
});
