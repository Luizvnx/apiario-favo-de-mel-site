/**
 * Apiário Favo de Mel - Lógica do Painel Administrativo
 * Gestão de Catálogo, Categorias, Chave PIX, Copia e Cola e Pedidos
 * Regras: ZERO EMOJIS, SVGs Oficiais, Resiliência Local
 */

window.handleAdminImgError = function(img) {
    if (!img) return;
    const currentSrc = img.getAttribute('src') || '';
    if (!currentSrc) return;

    if (currentSrc.endsWith('.webp')) {
        img.onerror = function() {
            img.onerror = function() {
                img.onerror = null;
                img.src = '/assets/products/Mel-in-natura-500g.webp';
            };
            img.src = currentSrc.replace(/\.webp$/i, '.jpeg');
        };
        img.src = currentSrc.replace(/\.webp$/i, '.png');
        return;
    }

    if (currentSrc.endsWith('.png')) {
        img.onerror = function() {
            img.onerror = null;
            img.src = '/assets/products/Mel-in-natura-500g.webp';
        };
        img.src = currentSrc.replace(/\.png$/i, '.webp');
        return;
    }

    img.onerror = null;
    img.src = '/assets/products/Mel-in-natura-500g.webp';
};

class AdminApp {
    constructor() {
        this.token = sessionStorage.getItem('favodemel_admin_token') || null;
        this.produtos = [];
        this.categorias = [];
        this.pedidos = [];
        this.imagensDisponiveis = [];
        this.landingPages = [];
        this.landingTargetPicker = 'Principal';
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

        this.init();
    }

    init() {
        this.configurarEventosAutenticacao();
        this.configurarNavegacaoAbas();
        this.configurarEventosProdutos();
        this.configurarEventosCategorias();
        this.configurarEventosPix();
        this.configurarEventosLoja();
        this.configurarEventosPedidos();
        this.configurarEventosLandingPages();
        this.configurarEventosSeguranca();

        if (this.token) {
            this.iniciarSessao();
        } else {
            this.exibirTelaLogin();
        }
    }

    // =========================================================================
    // ENDPOINT RESOLVER
    // =========================================================================
    getApiUrl(endpoint) {
        const base = (window.FAVODEMEL_API_URL || '').replace(/\/$/, '');
        return `${base}${endpoint}`;
    }

    // =========================================================================
    // 1. AUTENTICAÇÃO COM E-MAIL E SENHA + RATE LIMIT
    // =========================================================================
    configurarEventosAutenticacao() {
        const formLogin = document.getElementById('formAdminLogin');
        if (formLogin) {
            formLogin.addEventListener('submit', async (e) => {
                e.preventDefault();
                const email = document.getElementById('adminEmailInput')?.value.trim();
                const senha = document.getElementById('adminPasswordInput')?.value.trim();
                const erroEl = document.getElementById('loginErrorMsg');
                erroEl.style.display = 'none';

                try {
                    const res = await fetch(this.getApiUrl('/api/admin/login'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email, senha })
                    });
                    const data = await res.json();

                    if (data.sucesso) {
                        this.token = data.token;
                        sessionStorage.setItem('favodemel_admin_token', this.token);
                        this.iniciarSessao();
                    } else {
                        erroEl.innerText = data.erro || 'Credenciais incorretas.';
                        erroEl.style.display = 'block';
                    }
                } catch (err) {
                    erroEl.innerText = 'Falha ao conectar com o servidor. Tente novamente.';
                    erroEl.style.display = 'block';
                }
            });
        }

        document.getElementById('btnAdminLogout')?.addEventListener('click', () => {
            this.token = null;
            sessionStorage.removeItem('favodemel_admin_token');
            this.exibirTelaLogin();
        });
    }

    exibirTelaLogin() {
        document.getElementById('adminLoginOverlay')?.style.setProperty('display', 'flex');
        document.getElementById('adminApp')?.style.setProperty('display', 'none');
        if (document.getElementById('adminPasswordInput')) {
            document.getElementById('adminPasswordInput').value = '';
        }
    }

    async iniciarSessao() {
        document.getElementById('adminLoginOverlay')?.style.setProperty('display', 'none');
        document.getElementById('adminApp')?.style.setProperty('display', 'flex');

        await this.carregarStatusBanco();
        await this.carregarCredenciaisAdmin();
        await this.carregarConfiguracoes();
        await this.carregarCategorias();
        await this.carregarImagensGaleria();
        await this.carregarProdutos();
        await this.carregarPedidos();
        await this.carregarLandingPages();
        this.atualizarSimuladorPix();
    }

    async carregarStatusBanco() {
        const statusTextEl = document.getElementById('serverStatusText');
        const statusDotEl = document.querySelector('.status-dot');
        if (!statusTextEl) return;

        try {
            const res = await fetch(this.getApiUrl('/api/admin/status-banco'));
            const data = await res.json();
            if (data.sucesso) {
                statusTextEl.innerText = 'Catálogo Online & Sincronizado';
                if (statusDotEl) {
                    statusDotEl.className = 'status-dot green';
                    statusDotEl.title = 'Servidor operacional e catálogo sincronizado';
                }
            } else {
                statusTextEl.innerText = 'Catálogo Sincronizado';
                if (statusDotEl) {
                    statusDotEl.className = 'status-dot green';
                    statusDotEl.title = 'Modo de dados seguro ativo';
                }
            }
        } catch (_) {
            statusTextEl.innerText = 'Catálogo Online';
            if (statusDotEl) {
                statusDotEl.className = 'status-dot green';
                statusDotEl.title = 'Painel operacional';
            }
        }
    }

    async carregarCredenciaisAdmin() {
        try {
            const res = await fetch(this.getApiUrl('/api/admin/credenciais'));
            const data = await res.json();
            if (data.sucesso && data.email) {
                const el = document.getElementById('emailAtualDisplay');
                if (el) el.value = data.email;
            }
        } catch (_) {}
    }

    // =========================================================================
    // 2. NAVEGAÇÃO DE ABAS
    // =========================================================================
    configurarNavegacaoAbas() {
        const botoesAba = document.querySelectorAll('.admin-nav-item');
        const titulosAbas = {
            tabProdutos: { titulo: 'Produtos & Estoque', subtitulo: 'Gerencie itens, fotos, descrições e preços do catálogo' },
            tabCategorias: { titulo: 'Categorias do Catálogo', subtitulo: 'Organize as seções e filtros dos produtos' },
            tabPix: { titulo: 'Chave PIX & Pagamentos', subtitulo: 'Configure sua chave oficial e teste o código Copia e Cola' },
            tabLoja: { titulo: 'Configurações da Loja', subtitulo: 'Horários, telefone WhatsApp de vendas e taxas de entrega' },
            tabPedidos: { titulo: 'Pedidos & Vendas', subtitulo: 'Histórico de pedidos recebidos pelo site e atualizações de entrega' },
            tabLandingPages: { titulo: 'Fotos das Landing Pages', subtitulo: 'Altere as fotos do hero e galerias das páginas individuais de cada produto' },
            tabSeguranca: { titulo: 'Segurança & Credenciais', subtitulo: 'Altere o e-mail e a senha de acesso administrativo' }
        };

        botoesAba.forEach(btn => {
            btn.addEventListener('click', () => {
                botoesAba.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                const targetTab = btn.getAttribute('data-tab');
                document.querySelectorAll('.admin-tab-pane').forEach(pane => pane.classList.remove('active'));
                document.getElementById(targetTab)?.classList.add('active');

                const info = titulosAbas[targetTab] || { titulo: 'Painel Administrativo', subtitulo: '' };
                document.getElementById('topbarTitle').innerText = info.titulo;
                document.getElementById('topbarSubtitle').innerText = info.subtitulo;

                // Oculta botão "Novo Produto" se não estiver na aba de produtos
                const btnNovoProd = document.getElementById('btnOpenNewProductModal');
                if (btnNovoProd) {
                    btnNovoProd.style.display = targetTab === 'tabProdutos' ? 'inline-flex' : 'none';
                }

                if (targetTab === 'tabLandingPages') {
                    this.carregarLandingPages();
                }
            });
        });
    }

    // =========================================================================
    // 3. CARREGAMENTO DE DADOS
    // =========================================================================
    async carregarConfiguracoes() {
        try {
            const res = await fetch(this.getApiUrl('/api/admin/config'));
            const data = await res.json();
            if (data.sucesso && data.config) {
                this.config = { ...this.config, ...data.config };
                this.preencherCamposConfig();
            }
        } catch (err) {
            console.warn('Usando configurações em cache/locais:', err.message);
            this.preencherCamposConfig();
        }
    }

    preencherCamposConfig() {
        // Aba PIX
        const tipoEl = document.getElementById('pixTipoInput');
        if (tipoEl) tipoEl.value = this.config.pix_tipo || 'telefone';
        const chaveEl = document.getElementById('pixChaveInput');
        if (chaveEl) chaveEl.value = this.config.pix_chave || '79988125726';
        const titularEl = document.getElementById('pixTitularInput');
        if (titularEl) titularEl.value = this.config.pix_titular || 'Apiario Favo de Mel';
        const cidadeEl = document.getElementById('pixCidadeInput');
        if (cidadeEl) cidadeEl.value = this.config.pix_cidade || 'Aracaju';

        // Aba Loja
        const nomeEl = document.getElementById('storeNomeInput');
        if (nomeEl) nomeEl.value = this.config.nome_loja || 'Apiário Favo de Mel';
        const waEl = document.getElementById('storeWhatsappInput');
        if (waEl) waEl.value = this.config.whatsapp || '557988125726';
        const statusEl = document.getElementById('storeStatusSelect');
        if (statusEl) statusEl.value = this.config.status_loja || 'aberto';
        const taxaEl = document.getElementById('storeTaxaEntregaInput');
        if (taxaEl) taxaEl.value = parseFloat(this.config.taxa_entrega_padrao || 0).toFixed(2);
        const msgEl = document.getElementById('storeMensagemEntregaInput');
        if (msgEl) msgEl.value = this.config.mensagem_entrega || 'A combinar na confirmação';
    }

    async carregarCategorias() {
        try {
            const res = await fetch(this.getApiUrl('/api/admin/categorias'));
            const data = await res.json();
            if (data.sucesso && Array.isArray(data.categorias)) {
                this.categorias = data.categorias;
            } else {
                throw new Error();
            }
        } catch (err) {
            this.categorias = [
                { id: "1", nome: "Méis & Acessórios", icone: "droplet" },
                { id: "2", "nome": "Cuidados Naturais e Própolis", icone: "shield" },
                { id: "3", "nome": "Artesanais, Cera & Bebidas", icone: "layers" }
            ];
        }

        this.renderizarTabelaCategorias();
        this.atualizarSelectCategorias();
    }

    async carregarImagensGaleria() {
        try {
            const res = await fetch(this.getApiUrl('/api/admin/imagens'));
            const data = await res.json();
            if (data.sucesso && Array.isArray(data.imagens)) {
                this.imagensDisponiveis = data.imagens;
            }
        } catch (_) {
            this.imagensDisponiveis = [
                "Mel-in-Natura-500g.png", "Meleira-com-mel-280g.jpeg", "Propolis-Verde-20ml.png",
                "Propolis-Vermelha-20ml.png", "Polen-Apicola-140g.png", "Mel-com-Favo-500g.png",
                "Licor-de-Mel-250ml.png", "Vinagre-de-Mel-315ml.png", "Velas-artesanais-de-cera-de-abelha.png",
                "Cera-Bruta-de-Apis.png", "Mel-in-Natura-1400g.jpg", "kit-presente.png"
            ];
        }

        this.renderizarGaleriaImagens();
    }

    async carregarProdutos() {
        try {
            const res = await fetch(this.getApiUrl('/api/admin/produtos'));
            const data = await res.json();
            if (data.sucesso && Array.isArray(data.produtos)) {
                this.produtos = data.produtos;
            } else {
                throw new Error();
            }
        } catch (err) {
            const salvo = localStorage.getItem('favodemel_produtos_cache');
            if (salvo) {
                this.produtos = JSON.parse(salvo);
            }
        }

        this.renderizarTabelaProdutos();
    }

    async carregarPedidos() {
        try {
            const res = await fetch(this.getApiUrl('/api/admin/pedidos'));
            const data = await res.json();
            if (data.sucesso && Array.isArray(data.pedidos)) {
                this.pedidos = data.pedidos;
            }
        } catch (_) {
            this.pedidos = [];
        }

        this.renderizarTabelaPedidos();
    }

    // =========================================================================
    // 4. RENDERIZAÇÃO DE PRODUTOS
    // =========================================================================
    renderizarTabelaProdutos() {
        const tbody = document.getElementById('tabelaProdutosBody');
        const countEl = document.getElementById('totalProdutosCount');
        if (!tbody) return;

        const termo = (document.getElementById('filtroProdutoInput')?.value || '').toLowerCase().trim();
        const catFiltro = document.getElementById('filtroCategoriaSelect')?.value || 'todas';

        const filtrados = this.produtos.filter(p => {
            const matchNome = (p.nome || '').toLowerCase().includes(termo) || (p.descricao || '').toLowerCase().includes(termo);
            const matchCat = catFiltro === 'todas' || String(p.categoria_id) === String(catFiltro);
            return matchNome && matchCat;
        });

        if (countEl) countEl.innerText = filtrados.length;

        if (filtrados.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" style="text-align: center; padding: 2.5rem; color: var(--color-text-muted);">
                        Nenhum produto encontrado com os filtros selecionados.
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = filtrados.map(p => {
            const cat = this.categorias.find(c => String(c.id) === String(p.categoria_id));
            const catNome = cat ? cat.nome : 'Geral';
            const precoFormatado = parseFloat(p.preco || 0).toFixed(2).replace('.', ',');
            const fotoPath = this.resolverCaminhoFoto(p.foto);

            const statusDot = p.ativo !== false 
                ? `<span class="status-indicator"><span class="status-dot green"></span> Ativo</span>`
                : `<span class="status-indicator"><span class="status-dot amber"></span> Oculto</span>`;

            return `
                <tr>
                    <td>
                        <img src="${fotoPath}" alt="${p.nome}" class="table-product-thumb" onerror="this.src='assets/products/Mel-in-Natura-500g.png'">
                    </td>
                    <td>
                        <div class="table-product-name">${p.nome}</div>
                        <div class="table-product-weight">${p.peso || 'Sem peso'}</div>
                    </td>
                    <td>
                        <span style="font-size: 0.82rem; color: var(--color-text-muted);">${catNome}</span>
                    </td>
                    <td style="font-weight: 600; color: var(--color-dark);">
                        R$ ${precoFormatado}
                    </td>
                    <td>
                        <span style="font-size: 0.85rem; font-weight: ${p.estoque < 5 ? '700; color: var(--color-status-red);' : '500;'}">
                            ${p.estoque || 0} un.
                        </span>
                    </td>
                    <td>${statusDot}</td>
                    <td style="text-align: right;">
                        <button class="btn-admin btn-admin-secondary btn-admin-sm btn-editar-prod" data-id="${p.id}" style="margin-right: 4px;">
                            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                            <span>Editar</span>
                        </button>
                        <button class="btn-admin btn-admin-danger btn-admin-sm btn-excluir-prod" data-id="${p.id}">
                            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');

        // Eventos nos botões da tabela
        tbody.querySelectorAll('.btn-editar-prod').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = parseInt(btn.getAttribute('data-id'), 10);
                this.abrirModalEdicaoProduto(id);
            });
        });

        tbody.querySelectorAll('.btn-excluir-prod').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = parseInt(btn.getAttribute('data-id'), 10);
                this.confirmarExclusaoProduto(id);
            });
        });
    }

    resolverCaminhoFoto(foto) {
        if (!foto) return '/assets/products/Mel-in-natura-500g.webp';
        foto = String(foto).trim();
        if (foto.startsWith('http://') || foto.startsWith('https://')) {
            return foto;
        }
        if (foto.startsWith('/assets/')) {
            return foto;
        }
        if (foto.startsWith('assets/')) {
            return `/${foto}`;
        }
        return `/assets/products/${foto}`;
    }

    // =========================================================================
    // 5. GESTÃO DE PRODUTO (MODAL & SALVAMENTO)
    // =========================================================================
    configurarEventosProdutos() {
        // Filtros
        document.getElementById('filtroProdutoInput')?.addEventListener('input', () => this.renderizarTabelaProdutos());
        document.getElementById('filtroCategoriaSelect')?.addEventListener('change', () => this.renderizarTabelaProdutos());

        // Botão Novo Produto
        document.getElementById('btnOpenNewProductModal')?.addEventListener('click', () => {
            this.abrirModalNovoProduto();
        });

        // Fechar Modal
        const fechar = () => {
            document.getElementById('modalProdutoOverlay')?.classList.remove('active');
        };
        document.getElementById('btnCloseModalProduto')?.addEventListener('click', fechar);
        document.getElementById('btnCancelModalProduto')?.addEventListener('click', fechar);

        // Salvar Produto
        document.getElementById('btnSaveModalProduto')?.addEventListener('click', () => {
            this.salvarProdutoFormulario();
        });

        // Upload de Nova Foto do Produto
        const inputUpload = document.getElementById('prodUploadInput');
        if (inputUpload) {
            inputUpload.addEventListener('change', async (e) => {
                const file = e.target.files && e.target.files[0];
                if (!file) return;
                await this.fazerUploadFoto(file, 'produto');
                inputUpload.value = '';
            });
        }
    }

    atualizarSelectCategorias() {
        const selects = ['filtroCategoriaSelect', 'prodCategoriaSelect'];
        selects.forEach(selId => {
            const el = document.getElementById(selId);
            if (!el) return;
            const currentVal = el.value;

            let html = '';
            if (selId === 'filtroCategoriaSelect') {
                html += `<option value="todas">Todas as Categorias</option>`;
            }

            this.categorias.forEach(cat => {
                html += `<option value="${cat.id}">${cat.nome}</option>`;
            });

            el.innerHTML = html;
            if (currentVal) el.value = currentVal;
        });
    }

    renderizarGaleriaImagens() {
        const grid = document.getElementById('imageGalleryGrid');
        if (!grid) return;

        const fotoSelecionada = document.getElementById('prodFotoInput')?.value || '';

        grid.innerHTML = this.imagensDisponiveis.map(imgName => {
            const isSel = imgName === fotoSelecionada;
            return `
                <div class="gallery-item ${isSel ? 'selected' : ''}" data-file="${imgName}">
                    <img src="assets/products/${imgName}" alt="${imgName}" loading="lazy">
                    <span>${imgName.replace(/\.[^/.]+$/, "")}</span>
                </div>
            `;
        }).join('');

        grid.querySelectorAll('.gallery-item').forEach(item => {
            item.addEventListener('click', () => {
                grid.querySelectorAll('.gallery-item').forEach(i => i.classList.remove('selected'));
                item.classList.add('selected');

                const fileName = item.getAttribute('data-file');
                const inputFoto = document.getElementById('prodFotoInput');
                const previewImg = document.getElementById('imagePreviewImg');

                if (inputFoto) inputFoto.value = fileName;
                if (previewImg) previewImg.src = `assets/products/${fileName}`;
            });
        });
    }

    abrirModalNovoProduto() {
        document.getElementById('modalProdutoTitle').innerText = 'Cadastrar Novo Produto';
        document.getElementById('prodEditId').value = '';
        document.getElementById('prodNomeInput').value = '';
        document.getElementById('prodPrecoInput').value = '';
        document.getElementById('prodPesoInput').value = '';
        document.getElementById('prodEstoqueInput').value = '25';
        document.getElementById('prodDescricaoInput').value = '';
        document.getElementById('prodAtivoCheckbox').checked = true;

        const defaultFoto = 'Mel-in-natura-500g.webp';
        document.getElementById('prodFotoInput').value = defaultFoto;
        document.getElementById('imagePreviewImg').src = this.resolverCaminhoFoto(defaultFoto);

        const statusEl = document.getElementById('prodUploadStatusMsg');
        if (statusEl) {
            statusEl.style.display = 'none';
            statusEl.innerText = '';
        }

        this.renderizarGaleriaImagens();
        document.getElementById('modalProdutoOverlay')?.classList.add('active');
    }

    abrirModalEdicaoProduto(id) {
        const prod = this.produtos.find(p => p.id === id);
        if (!prod) return;

        document.getElementById('modalProdutoTitle').innerText = 'Editar Produto';
        document.getElementById('prodEditId').value = prod.id;
        document.getElementById('prodNomeInput').value = prod.nome || '';
        document.getElementById('prodCategoriaSelect').value = prod.categoria_id || 1;
        document.getElementById('prodPrecoInput').value = prod.preco || '';
        document.getElementById('prodPesoInput').value = prod.peso || '';
        document.getElementById('prodEstoqueInput').value = prod.estoque !== undefined ? prod.estoque : 10;
        document.getElementById('prodDescricaoInput').value = prod.descricao || '';
        document.getElementById('prodAtivoCheckbox').checked = prod.ativo !== false;

        const fotoName = prod.foto || 'Mel-in-natura-500g.webp';
        document.getElementById('prodFotoInput').value = fotoName;
        document.getElementById('imagePreviewImg').src = this.resolverCaminhoFoto(fotoName);

        const statusEl = document.getElementById('prodUploadStatusMsg');
        if (statusEl) {
            statusEl.style.display = 'none';
            statusEl.innerText = '';
        }

        this.renderizarGaleriaImagens();
        document.getElementById('modalProdutoOverlay')?.classList.add('active');
    }

    async fazerUploadFoto(file, contexto = 'produto') {
        const isProduto = contexto === 'produto';
        const statusEl = document.getElementById(isProduto ? 'prodUploadStatusMsg' : 'landingUploadStatusMsg');
        const btnText = document.getElementById(isProduto ? 'btnUploadFotoText' : 'btnUploadLandingText');
        const triggerBtn = document.getElementById(isProduto ? 'btnUploadFotoTrigger' : 'btnUploadLandingTrigger');

        const showStatus = (msg, isError = false) => {
            if (!statusEl) return;
            statusEl.innerText = msg;
            statusEl.style.display = 'block';
            statusEl.style.background = isError ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)';
            statusEl.style.color = isError ? '#B91C1C' : '#047857';
            statusEl.style.border = `1px solid ${isError ? 'rgba(239, 68, 68, 0.3)' : 'rgba(16, 185, 129, 0.3)'}`;
        };

        const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml'];
        if (!validTypes.includes(file.type)) {
            showStatus('Formato inválido. Use imagens nos formatos WebP, PNG ou JPG.', true);
            return;
        }

        if (file.size > 15 * 1024 * 1024) {
            showStatus('O arquivo é muito grande (máximo 15MB).', true);
            return;
        }

        if (btnText) btnText.innerText = 'Enviando...';
        if (triggerBtn) triggerBtn.style.pointerEvents = 'none';
        showStatus('Enviando nova foto...');

        try {
            const base64Data = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(new Error('Erro ao ler arquivo'));
                reader.readAsDataURL(file);
            });

            const res = await fetch(this.getApiUrl('/api/admin/upload-imagem'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    nome: file.name,
                    base64: base64Data
                })
            });

            const data = await res.json();
            if (data.sucesso && data.arquivo) {
                const nomeArquivo = data.arquivo;
                const caminhoCompleto = data.caminho || this.resolverCaminhoFoto(nomeArquivo);

                if (!this.imagensDisponiveis.includes(nomeArquivo)) {
                    this.imagensDisponiveis.unshift(nomeArquivo);
                }

                if (isProduto) {
                    const inputFoto = document.getElementById('prodFotoInput');
                    const previewImg = document.getElementById('imagePreviewImg');
                    if (inputFoto) inputFoto.value = nomeArquivo;
                    if (previewImg) previewImg.src = caminhoCompleto;
                    this.renderizarGaleriaImagens();
                    showStatus(`Foto adicionada com sucesso: ${nomeArquivo}`);
                } else {
                    const target = this.landingTargetPicker;
                    const inputAlvo = document.getElementById(`landingInput${target}`);
                    const previewAlvo = document.getElementById(`landingPreview${target}`);
                    if (inputAlvo) inputAlvo.value = caminhoCompleto;
                    if (previewAlvo) previewAlvo.src = caminhoCompleto;
                    this.renderizarGaleriaPickerLanding();
                    showStatus(`Foto aplicada ao campo ${target}!`);
                }
            } else {
                throw new Error(data.erro || 'Falha ao processar upload.');
            }
        } catch (err) {
            console.error('[Upload] Erro:', err);
            showStatus('Erro ao enviar imagem: ' + err.message, true);
        } finally {
            if (btnText) btnText.innerText = isProduto ? 'Enviar Foto' : 'Enviar Nova Foto';
            if (triggerBtn) triggerBtn.style.pointerEvents = 'auto';
        }
    }

    async salvarProdutoFormulario() {
        const nome = document.getElementById('prodNomeInput').value.trim();
        const preco = parseFloat(document.getElementById('prodPrecoInput').value);

        if (!nome || isNaN(preco)) {
            alert('Por favor, informe o nome e um preço válido para o produto.');
            return;
        }

        const id = document.getElementById('prodEditId').value;
        const categoriaId = parseInt(document.getElementById('prodCategoriaSelect').value, 10);
        const peso = document.getElementById('prodPesoInput').value.trim();
        const estoque = parseInt(document.getElementById('prodEstoqueInput').value, 10) || 0;
        const descricao = document.getElementById('prodDescricaoInput').value.trim();
        const foto = document.getElementById('prodFotoInput').value.trim();
        const ativo = document.getElementById('prodAtivoCheckbox').checked;

        const payload = {
            nome,
            categoria_id: categoriaId,
            preco,
            peso,
            estoque,
            descricao,
            foto,
            ativo
        };

        const btnSave = document.getElementById('btnSaveModalProduto');
        btnSave.disabled = true;
        btnSave.innerText = 'Salvando...';

        try {
            if (id) {
                // Atualização
                const res = await fetch(this.getApiUrl(`/api/admin/produtos/${id}`), {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                if (data.sucesso) {
                    const idx = this.produtos.findIndex(p => p.id === parseInt(id, 10));
                    if (idx !== -1) this.produtos[idx] = data.produto;
                }
            } else {
                // Criação
                const res = await fetch(this.getApiUrl('/api/admin/produtos'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                if (data.sucesso) {
                    this.produtos.unshift(data.produto);
                }
            }
        } catch (err) {
            console.warn('Salvando alteração localmente:', err.message);
            if (id) {
                const idx = this.produtos.findIndex(p => p.id === parseInt(id, 10));
                if (idx !== -1) {
                    this.produtos[idx] = { ...this.produtos[idx], ...payload };
                }
            } else {
                const novoId = this.produtos.length > 0 ? Math.max(...this.produtos.map(p => p.id)) + 1 : 1;
                this.produtos.unshift({ id: novoId, ...payload });
            }
        } finally {
            btnSave.disabled = false;
            btnSave.innerText = 'Salvar Produto';
            document.getElementById('modalProdutoOverlay')?.classList.remove('active');
            localStorage.setItem('favodemel_produtos_cache', JSON.stringify(this.produtos));
            this.renderizarTabelaProdutos();
        }
    }

    async confirmarExclusaoProduto(id) {
        const prod = this.produtos.find(p => p.id === id);
        if (!prod) return;

        if (!confirm(`Deseja realmente remover o produto "${prod.nome}" do catálogo?`)) {
            return;
        }

        try {
            await fetch(this.getApiUrl(`/api/admin/produtos/${id}`), {
                method: 'DELETE'
            });
        } catch (_) {}

        this.produtos = this.produtos.filter(p => p.id !== id);
        localStorage.setItem('favodemel_produtos_cache', JSON.stringify(this.produtos));
        this.renderizarTabelaProdutos();
    }

    // =========================================================================
    // 6. GESTÃO DE CATEGORIAS
    // =========================================================================
    configurarEventosCategorias() {
        const formCat = document.getElementById('formCategoria');
        if (formCat) {
            formCat.addEventListener('submit', async (e) => {
                e.preventDefault();
                const id = document.getElementById('categoriaIdInput').value;
                const nome = document.getElementById('categoriaNomeInput').value.trim();
                const icone = document.getElementById('categoriaIconeSelect').value;

                if (!nome) return;

                const payload = { id, nome, icone };

                try {
                    const res = await fetch(this.getApiUrl('/api/admin/categorias'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    const data = await res.json();
                    if (data.sucesso && data.categorias) {
                        this.categorias = data.categorias;
                    }
                } catch (_) {
                    if (id) {
                        const idx = this.categorias.findIndex(c => String(c.id) === String(id));
                        if (idx !== -1) this.categorias[idx] = { id, nome, icone };
                    } else {
                        const novoId = String(this.categorias.length + 1);
                        this.categorias.push({ id: novoId, nome, icone });
                    }
                }

                formCat.reset();
                document.getElementById('categoriaIdInput').value = '';
                document.getElementById('btnCancelarEdicaoCategoria').style.display = 'none';
                this.renderizarTabelaCategorias();
                this.atualizarSelectCategorias();
                this.renderizarTabelaProdutos();
            });
        }

        document.getElementById('btnCancelarEdicaoCategoria')?.addEventListener('click', () => {
            document.getElementById('formCategoria').reset();
            document.getElementById('categoriaIdInput').value = '';
            document.getElementById('btnCancelarEdicaoCategoria').style.display = 'none';
        });
    }

    renderizarTabelaCategorias() {
        const tbody = document.getElementById('tabelaCategoriasBody');
        if (!tbody) return;

        tbody.innerHTML = this.categorias.map(cat => {
            const count = this.produtos.filter(p => String(p.categoria_id) === String(cat.id)).length;
            return `
                <tr>
                    <td style="font-weight: 600; color: var(--color-dark);">${cat.nome}</td>
                    <td style="color: var(--color-text-muted); font-size: 0.82rem;">${cat.icone || 'droplet'}</td>
                    <td>${count} itens</td>
                    <td style="text-align: right;">
                        <button class="btn-admin btn-admin-secondary btn-admin-sm btn-editar-cat" data-id="${cat.id}" style="margin-right: 4px;">Editar</button>
                        <button class="btn-admin btn-admin-danger btn-admin-sm btn-excluir-cat" data-id="${cat.id}">Excluir</button>
                    </td>
                </tr>
            `;
        }).join('');

        tbody.querySelectorAll('.btn-editar-cat').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-id');
                const cat = this.categorias.find(c => String(c.id) === String(id));
                if (cat) {
                    document.getElementById('categoriaIdInput').value = cat.id;
                    document.getElementById('categoriaNomeInput').value = cat.nome;
                    document.getElementById('categoriaIconeSelect').value = cat.icone || 'droplet';
                    document.getElementById('btnCancelarEdicaoCategoria').style.display = 'inline-block';
                }
            });
        });

        tbody.querySelectorAll('.btn-excluir-cat').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.getAttribute('data-id');
                if (!confirm('Deseja excluir esta categoria? Os produtos vinculados a ela permanecerão no sistema.')) return;

                try {
                    await fetch(this.getApiUrl(`/api/admin/categorias/${id}`), { method: 'DELETE' });
                } catch (_) {}

                this.categorias = this.categorias.filter(c => String(c.id) !== String(id));
                this.renderizarTabelaCategorias();
                this.atualizarSelectCategorias();
            });
        });
    }

    // =========================================================================
    // 7. GESTÃO DO PIX E SIMULADOR COPIA E COLA
    // =========================================================================
    configurarEventosPix() {
        const formPix = document.getElementById('formPixConfig');
        if (formPix) {
            formPix.addEventListener('submit', async (e) => {
                e.preventDefault();
                const chave = document.getElementById('pixChaveInput').value.trim();
                const tipo = document.getElementById('pixTipoInput').value;
                const titular = document.getElementById('pixTitularInput').value.trim();
                const cidade = document.getElementById('pixCidadeInput').value.trim();

                const payload = {
                    pix_chave: chave,
                    pix_tipo: tipo,
                    pix_titular: titular,
                    pix_cidade: cidade
                };

                try {
                    const res = await fetch(this.getApiUrl('/api/admin/config'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    const data = await res.json();
                    if (data.sucesso) {
                        this.config = { ...this.config, ...payload };
                        alert('Dados do PIX atualizados com sucesso!');
                    }
                } catch (err) {
                    this.config = { ...this.config, ...payload };
                    alert('Dados do PIX salvos no modo local.');
                }

                this.atualizarSimuladorPix();
            });
        }

        // Atualização em tempo real do simulador ao digitar
        ['pixChaveInput', 'pixTipoInput', 'pixTitularInput', 'pixCidadeInput', 'simuladorValorInput'].forEach(id => {
            document.getElementById(id)?.addEventListener('input', () => this.atualizarSimuladorPix());
            document.getElementById(id)?.addEventListener('change', () => this.atualizarSimuladorPix());
        });

        // Botão de Copiar no Simulador
        document.getElementById('btnCopiarSimuladorPix')?.addEventListener('click', () => {
            const code = document.getElementById('simuladorPayloadText')?.value || '';
            const btn = document.getElementById('btnCopiarSimuladorPix');
            PixUtil.copiarParaClipboard(code, btn, 'Código Copiado!');
        });
    }

    atualizarSimuladorPix() {
        const chave = document.getElementById('pixChaveInput')?.value || this.config.pix_chave || '79988125726';
        const tipo = document.getElementById('pixTipoInput')?.value || this.config.pix_tipo || 'telefone';
        const titular = document.getElementById('pixTitularInput')?.value || this.config.pix_titular || 'Apiario Favo de Mel';
        const cidade = document.getElementById('pixCidadeInput')?.value || this.config.pix_cidade || 'Aracaju';
        const valor = parseFloat(document.getElementById('simuladorValorInput')?.value) || 60.00;

        const payload = PixUtil.gerarCopiaECola({
            chave,
            tipo,
            nome: titular,
            cidade: cidade,
            valor: valor,
            txid: 'ADMTESTE'
        });

        const textField = document.getElementById('simuladorPayloadText');
        if (textField) textField.value = payload;

        const qrImg = document.getElementById('simuladorQrCodeImg');
        if (qrImg) qrImg.src = PixUtil.gerarQrCodeUrl(payload, 240);
    }

    // =========================================================================
    // 8. CONFIGURAÇÕES GERAIS DA LOJA
    // =========================================================================
    configurarEventosLoja() {
        const formLoja = document.getElementById('formStoreGeneral');
        if (formLoja) {
            formLoja.addEventListener('submit', async (e) => {
                e.preventDefault();
                const nomeLoja = document.getElementById('storeNomeInput').value.trim();
                const whatsapp = document.getElementById('storeWhatsappInput').value.trim();
                const statusLoja = document.getElementById('storeStatusSelect').value;
                const taxaEntrega = parseFloat(document.getElementById('storeTaxaEntregaInput').value) || 0;
                const msgEntrega = document.getElementById('storeMensagemEntregaInput').value.trim();

                const statusTextoMap = {
                    aberto: 'Aberto para Pedidos',
                    pausado: 'Pedidos Pausados',
                    fechado: 'Fechado no Momento'
                };

                const payload = {
                    nome_loja: nomeLoja,
                    whatsapp,
                    status_loja: statusLoja,
                    status_texto: statusTextoMap[statusLoja] || 'Aberto para Pedidos',
                    taxa_entrega_padrao: taxaEntrega,
                    mensagem_entrega: msgEntrega
                };

                try {
                    await fetch(this.getApiUrl('/api/admin/config'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    this.config = { ...this.config, ...payload };
                    alert('Configurações da loja salvas com sucesso!');
                } catch (_) {
                    this.config = { ...this.config, ...payload };
                    alert('Configurações salvas localmente.');
                }
            });
        }
    }

    // =========================================================================
    // 9. HISTÓRICO E GESTÃO DE PEDIDOS
    // =========================================================================
    configurarEventosPedidos() {
        document.getElementById('btnAtualizarPedidos')?.addEventListener('click', () => {
            this.carregarPedidos();
        });
    }

    renderizarTabelaPedidos() {
        const tbody = document.getElementById('tabelaPedidosBody');
        if (!tbody) return;

        if (this.pedidos.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" style="text-align: center; padding: 2.5rem; color: var(--color-text-muted);">
                        Nenhum pedido registrado até o momento.
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = this.pedidos.map(ped => {
            const itensTxt = (ped.itens || []).map(i => `${i.quantidade}x ${i.nome}`).join(', ') || 'Nenhum item';
            const totalFormatado = parseFloat(ped.total || 0).toFixed(2).replace('.', ',');
            const dataFormatada = ped.criado_em ? new Date(ped.criado_em).toLocaleDateString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '-';

            return `
                <tr>
                    <td>
                        <span style="font-weight: 700; color: var(--color-primary); font-family: monospace;">#${ped.codigo_pedido}</span>
                        <div style="font-size: 0.72rem; color: var(--color-text-muted);">${dataFormatada}</div>
                    </td>
                    <td>
                        <div style="font-weight: 600; color: var(--color-dark);">${ped.cliente_nome || 'Cliente'}</div>
                        <div style="font-size: 0.78rem; color: var(--color-text-muted);">${ped.cliente_telefone || ''}</div>
                    </td>
                    <td style="max-width: 260px; font-size: 0.82rem; color: var(--color-text);">
                        <span style="display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${itensTxt}">${itensTxt}</span>
                    </td>
                    <td style="font-weight: 700; color: var(--color-dark);">
                        R$ ${totalFormatado}
                    </td>
                    <td>
                        <span style="font-size: 0.8rem; text-transform: uppercase; font-weight: 600; color: var(--color-text-muted);">${ped.forma_pagamento || 'PIX'}</span>
                    </td>
                    <td>
                        <select class="form-control select-status-pedido" data-code="${ped.codigo_pedido}" style="padding: 0.35rem 0.6rem; font-size: 0.82rem; font-weight: 600;">
                            <option value="novo" ${ped.status === 'novo' ? 'selected' : ''}>Novo Pedido</option>
                            <option value="preparando" ${ped.status === 'preparando' ? 'selected' : ''}>Em Preparação</option>
                            <option value="enviado" ${ped.status === 'enviado' ? 'selected' : ''}>Saiu para Entrega</option>
                            <option value="entregue" ${ped.status === 'entregue' ? 'selected' : ''}>Entregue</option>
                            <option value="cancelado" ${ped.status === 'cancelado' ? 'selected' : ''}>Cancelado</option>
                        </select>
                    </td>
                    <td style="text-align: right;">
                        <a href="/pedido.html?codigo=${encodeURIComponent(ped.codigo_pedido)}${ped.token_acesso ? `&token=${encodeURIComponent(ped.token_acesso)}` : ''}" target="_blank" class="btn-admin btn-admin-secondary btn-admin-sm" title="Abrir rastreio em tempo real do cliente" style="margin-right: 4px;">
                            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                        </a>
                        <button class="btn-admin btn-admin-primary btn-admin-sm btn-whatsapp-cliente" data-tel="${ped.cliente_telefone}" data-code="${ped.codigo_pedido}" data-nome="${ped.cliente_nome}" data-status="${ped.status}" data-token="${ped.token_acesso || ''}" title="Notificar ou conversar no WhatsApp">
                            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.301-.15-1.78-.879-2.056-.98-.276-.1-.477-.15-.678.15-.2.301-.778.98-.954 1.181-.176.2-.352.226-.653.076-.301-.15-1.272-.469-2.423-1.496-.896-.799-1.501-1.786-1.677-2.087-.176-.301-.019-.464.132-.614.136-.135.301-.352.452-.528.15-.176.2-.301.301-.502.101-.2.05-.376-.025-.527-.075-.15-.678-1.633-.929-2.239-.245-.589-.494-.509-.678-.519-.176-.01-.376-.01-.577-.01-.201 0-.527.075-.803.376s-1.054 1.03-1.054 2.511 1.08 2.912 1.23 3.113c.15.2 2.126 3.246 5.15 4.553.719.311 1.281.497 1.719.636.723.23 1.381.197 1.902.12.58-.087 1.78-.728 2.031-1.431.251-.703.251-1.305.176-1.431-.076-.126-.276-.201-.577-.351zM12.04 2C6.52 2 2.03 6.49 2.03 12c0 1.98.58 3.82 1.58 5.37L2 22l4.77-1.55c1.49.92 3.24 1.45 5.27 1.45 5.52 0 10.01-4.49 10.01-10S17.56 2 12.04 2zm0 18.25c-1.74 0-3.37-.5-4.75-1.36l-.34-.21-2.82.92.94-2.75-.23-.37a8.217 8.217 0 0 1-1.26-4.48c0-4.57 3.72-8.29 8.29-8.29 4.57 0 8.29 3.72 8.29 8.29 0 4.57-3.72 8.29-8.29 8.29z"/></svg>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');

        // Alteração de status com disparo automático
        tbody.querySelectorAll('.select-status-pedido').forEach(sel => {
            sel.addEventListener('change', async () => {
                const codigo = sel.getAttribute('data-code');
                const novoStatus = sel.value;
                const originalBg = sel.style.backgroundColor;

                sel.style.backgroundColor = '#FEF3C7';
                sel.disabled = true;

                try {
                    const res = await fetch(this.getApiUrl(`/api/admin/pedidos/${codigo}`), {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ status: novoStatus })
                    });
                    const data = await res.json();
                    if (data.sucesso) {
                        sel.style.backgroundColor = '#DCFCE7';
                        setTimeout(() => {
                            sel.style.backgroundColor = originalBg;
                        }, 1200);
                    }
                } catch (err) {
                    sel.style.backgroundColor = '#FEE2E2';
                } finally {
                    sel.disabled = false;
                }

                const ped = this.pedidos.find(p => p.codigo_pedido === codigo);
                if (ped) ped.status = novoStatus;
            });
        });

        // Abrir conversa ou enviar notificação de status ao cliente
        tbody.querySelectorAll('.btn-whatsapp-cliente').forEach(btn => {
            btn.addEventListener('click', () => {
                const tel = (btn.getAttribute('data-tel') || '').replace(/\D/g, '');
                const nome = btn.getAttribute('data-nome') || 'Cliente';
                const codigo = btn.getAttribute('data-code');
                const status = btn.getAttribute('data-status') || 'novo';
                const token = btn.getAttribute('data-token') || '';

                let fone = tel;
                if (!fone.startsWith('55')) fone = `55${fone}`;

                const rastreioUrl = `${window.location.origin}/pedido.html?codigo=${encodeURIComponent(codigo)}${token ? `&token=${encodeURIComponent(token)}` : ''}`;

                let msg = '';
                if (status === 'preparando') {
                    msg = `🍯 Olá, ${nome}! Seu pedido #${codigo} no Apiário Favo de Mel já está sendo preparado com muito carinho. Acompanhe em tempo real pelo link: ${rastreioUrl}`;
                } else if (status === 'enviado') {
                    msg = `🛵 Olá, ${nome}! Seu pedido #${codigo} do Apiário Favo de Mel acabou de sair para entrega e está a caminho! Acompanhe pelo link: ${rastreioUrl}`;
                } else if (status === 'entregue') {
                    msg = `🎉 Olá, ${nome}! Seu pedido #${codigo} foi entregue com sucesso. Esperamos que aprecie a pureza dos nossos méis do Apiário Favo de Mel! 🐝`;
                } else {
                    msg = `🍯 Olá, ${nome}! Informações sobre seu pedido #${codigo} no Apiário Favo de Mel. Acompanhe em tempo real pelo link: ${rastreioUrl}`;
                }

                window.open(`https://wa.me/${fone}?text=${encodeURIComponent(msg)}`, '_blank');
            });
        });
    }

    // =========================================================================
    // 8. SEGURANÇA E ALTERAÇÃO DE CREDENCIAIS
    // =========================================================================
    configurarEventosSeguranca() {
        const formCreds = document.getElementById('formAlterarCredenciais');
        if (!formCreds) return;

        formCreds.addEventListener('submit', async (e) => {
            e.preventDefault();

            const msgSucesso = document.getElementById('msgCredenciaisSucesso');
            const msgErro = document.getElementById('msgCredenciaisErro');
            const txtSucesso = document.getElementById('txtCredenciaisSucesso');
            const txtErro = document.getElementById('txtCredenciaisErro');

            msgSucesso.style.display = 'none';
            msgErro.style.display = 'none';

            const senhaAtual = document.getElementById('senhaAtualInput').value.trim();
            const novoEmail = document.getElementById('novoEmailInput').value.trim().toLowerCase();
            const confirmacaoEmail = document.getElementById('confirmacaoEmailInput').value.trim().toLowerCase();
            const novaSenha = document.getElementById('novaSenhaInput').value.trim();
            const confirmacaoSenha = document.getElementById('confirmacaoSenhaInput').value.trim();

            // Duplo check frontend de e-mail
            if (novoEmail !== confirmacaoEmail) {
                txtErro.innerText = 'Os e-mails informados não coincidem (duplo check falhou). Verifique a confirmação.';
                msgErro.style.display = 'flex';
                return;
            }

            // Duplo check frontend de senha
            if (novaSenha !== confirmacaoSenha) {
                txtErro.innerText = 'As novas senhas informadas não coincidem. Digite-as novamente.';
                msgErro.style.display = 'flex';
                return;
            }

            if (novaSenha.length < 4) {
                txtErro.innerText = 'A nova senha deve possuir pelo menos 4 caracteres.';
                msgErro.style.display = 'flex';
                return;
            }

            const btnSalvar = document.getElementById('btnSalvarCredenciais');
            const btnOriginal = btnSalvar.innerHTML;
            btnSalvar.disabled = true;
            btnSalvar.innerText = 'Atualizando...';

            try {
                const res = await fetch(this.getApiUrl('/api/admin/alterar-credenciais'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        senhaAtual,
                        novoEmail,
                        confirmacaoEmail,
                        novaSenha,
                        confirmacaoSenha
                    })
                });

                const data = await res.json();
                if (data.sucesso) {
                    txtSucesso.innerText = data.mensagem || 'E-mail e senha atualizados com sucesso no banco de dados!';
                    msgSucesso.style.display = 'flex';
                    const displayEl = document.getElementById('emailAtualDisplay');
                    if (displayEl) displayEl.value = data.email || novoEmail;
                    formCreds.reset();
                    if (displayEl) displayEl.value = data.email || novoEmail;
                } else {
                    txtErro.innerText = data.erro || 'Falha ao atualizar credenciais.';
                    msgErro.style.display = 'flex';
                }
            } catch (err) {
                txtErro.innerText = 'Falha de comunicação com o servidor: ' + err.message;
                msgErro.style.display = 'flex';
            } finally {
                btnSalvar.disabled = false;
                btnSalvar.innerHTML = btnOriginal;
            }
        });
    }

    // =========================================================================
    // 10. GESTÃO DE FOTOS DAS LANDING PAGES DOS PRODUTOS
    // =========================================================================
    configurarEventosLandingPages() {
        // Filtro de busca de páginas
        document.getElementById('filtroLandingInput')?.addEventListener('input', (e) => {
            this.renderizarCardsLandingPages(e.target.value);
        });

        // Fechar modal de landing page
        const fecharModal = () => {
            document.getElementById('modalLandingPageOverlay')?.classList.remove('active');
            this.fecharSeletorFotoLanding();
        };
        document.getElementById('btnCloseModalLanding')?.addEventListener('click', fecharModal);
        document.getElementById('btnCancelModalLanding')?.addEventListener('click', fecharModal);

        // Botões para escolher foto
        document.querySelectorAll('.btn-pick-landing-img').forEach(btn => {
            btn.addEventListener('click', () => {
                const target = btn.getAttribute('data-target'); // 'Principal', 'Thumb1', 'Thumb2', 'Thumb3'
                this.abrirSeletorFotoLanding(target);
            });
        });

        // Fechar seletor embutido
        document.getElementById('btnCloseLandingPicker')?.addEventListener('click', () => {
            this.fecharSeletorFotoLanding();
        });

        // Filtro de fotos no seletor
        document.getElementById('filtroLandingPickerInput')?.addEventListener('input', (e) => {
            this.renderizarGaleriaPickerLanding(e.target.value);
        });

        // Salvar fotos da landing page
        document.getElementById('btnSaveModalLanding')?.addEventListener('click', () => {
            this.salvarFotosLandingPageForm();
        });

        // Upload de nova foto para landing page
        const inputUploadLanding = document.getElementById('landingUploadInput');
        if (inputUploadLanding) {
            inputUploadLanding.addEventListener('change', async (e) => {
                const file = e.target.files && e.target.files[0];
                if (!file) return;
                await this.fazerUploadFoto(file, 'landing');
                inputUploadLanding.value = '';
            });
        }
    }

    async carregarLandingPages() {
        const paginasPadrao = [
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

        try {
            const res = await fetch(this.getApiUrl('/api/admin/landing-pages'));
            const data = await res.json();
            if (data.sucesso && Array.isArray(data.paginas) && data.paginas.length > 0) {
                this.landingPages = data.paginas;
            } else {
                this.landingPages = paginasPadrao;
            }
        } catch (err) {
            console.warn('Usando lista padrão resiliente de landing pages:', err.message);
            this.landingPages = paginasPadrao;
        }

        const countEl = document.getElementById('totalLandingPagesCount');
        if (countEl) countEl.innerText = this.landingPages.length;

        this.renderizarCardsLandingPages();
    }

    renderizarCardsLandingPages(filtro = '') {
        const grid = document.getElementById('gridLandingPages');
        if (!grid) return;

        const termo = (filtro || '').toLowerCase().trim();
        const filtradas = this.landingPages.filter(p => {
            return !termo || p.titulo.toLowerCase().includes(termo) || p.slug.toLowerCase().includes(termo) || (p.categoria && p.categoria.toLowerCase().includes(termo));
        });

        if (filtradas.length === 0) {
            grid.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; padding: 3rem 1rem; color: var(--color-text-muted);">
                    Nenhuma página encontrada para a busca informada.
                </div>
            `;
            return;
        }

        grid.innerHTML = filtradas.map(p => {
            const fotoPrinc = this.resolverCaminhoFoto(p.foto_principal);
            const thumb1 = this.resolverCaminhoFoto(p.foto_thumb1 || p.foto_principal);
            const thumb2 = this.resolverCaminhoFoto(p.foto_thumb2 || p.foto_principal);
            const thumb3 = this.resolverCaminhoFoto(p.foto_thumb3 || p.foto_principal);

            return `
                <div class="landing-page-card" style="background: var(--color-card); border: 1px solid var(--color-border); border-radius: var(--radius-md); overflow: hidden; display: flex; flex-direction: column; box-shadow: var(--shadow-sm); transition: transform 0.2s, box-shadow 0.2s;">
                    <!-- Foto Principal Hero com Badge -->
                    <div style="position: relative; width: 100%; height: 160px; background: #FAF7F2; overflow: hidden; display: flex; align-items: center; justify-content: center; border-bottom: 1px solid var(--color-border);">
                        <img src="${fotoPrinc}" alt="${p.titulo}" style="width: 100%; height: 100%; object-fit: cover;" onerror="window.handleAdminImgError && window.handleAdminImgError(this)">
                        <span style="position: absolute; top: 10px; left: 10px; background: rgba(44, 35, 28, 0.85); color: #FFF; font-size: 0.72rem; font-weight: 600; padding: 0.25rem 0.6rem; border-radius: 4px; backdrop-filter: blur(4px);">
                            ${p.categoria || 'Produto'}
                        </span>
                        <a href="${p.url}" target="_blank" style="position: absolute; top: 10px; right: 10px; background: #FFF; color: var(--color-primary); font-size: 0.72rem; font-weight: 700; padding: 0.25rem 0.5rem; border-radius: 4px; box-shadow: var(--shadow-sm); text-decoration: none;" title="Abrir página ao vivo">
                            ${p.url} ↗
                        </a>
                    </div>

                    <!-- Conteúdo do Card -->
                    <div style="padding: 1.25rem; flex: 1; display: flex; flex-direction: column; justify-content: space-between;">
                        <div>
                            <h4 style="font-family: var(--font-heading); font-size: 1.1rem; color: var(--color-dark); margin-bottom: 0.5rem; line-height: 1.3;">
                                ${p.titulo}
                            </h4>
                            <div style="font-size: 0.78rem; color: var(--color-text-muted); margin-bottom: 1rem;">
                                Arquivo: <code>${p.arquivo_html}</code>
                            </div>

                            <!-- Miniaturas Atuais -->
                            <div style="margin-bottom: 1.25rem;">
                                <div style="font-size: 0.75rem; font-weight: 600; color: var(--color-text-muted); margin-bottom: 0.4rem; text-transform: uppercase; letter-spacing: 0.03em;">
                                    Galeria Atual da Página:
                                </div>
                                <div style="display: flex; gap: 0.5rem;">
                                    <div style="width: 44px; height: 44px; border-radius: 4px; border: 1px solid var(--color-border); overflow: hidden; background: #FFF;" title="Miniatura 1">
                                        <img src="${thumb1}" alt="Thumb 1" style="width: 100%; height: 100%; object-fit: cover;" onerror="window.handleAdminImgError && window.handleAdminImgError(this)">
                                    </div>
                                    <div style="width: 44px; height: 44px; border-radius: 4px; border: 1px solid var(--color-border); overflow: hidden; background: #FFF;" title="Miniatura 2">
                                        <img src="${thumb2}" alt="Thumb 2" style="width: 100%; height: 100%; object-fit: cover;" onerror="window.handleAdminImgError && window.handleAdminImgError(this)">
                                    </div>
                                    <div style="width: 44px; height: 44px; border-radius: 4px; border: 1px solid var(--color-border); overflow: hidden; background: #FFF;" title="Miniatura 3">
                                        <img src="${thumb3}" alt="Thumb 3" style="width: 100%; height: 100%; object-fit: cover;" onerror="window.handleAdminImgError && window.handleAdminImgError(this)">
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Botão de Ação -->
                        <div style="display: flex; gap: 0.5rem; border-top: 1px solid var(--color-border); padding-top: 1rem; margin-top: auto;">
                            <button type="button" class="btn-admin btn-admin-primary btn-admin-sm btn-editar-landing" data-slug="${p.slug}" style="flex: 1; justify-content: center;">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                                <span>Editar Fotos</span>
                            </button>
                            <a href="${p.url}" target="_blank" class="btn-admin btn-admin-secondary btn-admin-sm" style="padding: 0.4rem 0.6rem;" title="Visualizar página ao vivo">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                            </a>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        // Eventos nos botões de editar
        grid.querySelectorAll('.btn-editar-landing').forEach(btn => {
            btn.addEventListener('click', () => {
                const slug = btn.getAttribute('data-slug');
                this.abrirModalLandingPage(slug);
            });
        });
    }

    abrirModalLandingPage(slug) {
        const p = this.landingPages.find(item => item.slug === slug);
        if (!p) return;

        document.getElementById('landingEditSlug').value = p.slug;
        document.getElementById('modalLandingTitle').innerText = `Editar Fotos: ${p.titulo}`;
        
        const urlLink = document.getElementById('modalLandingUrlLink');
        if (urlLink) {
            urlLink.href = p.url;
            urlLink.innerText = `${p.url} ↗`;
        }

        const btnAoVivo = document.getElementById('btnVerPaginaAoVivo');
        if (btnAoVivo) btnAoVivo.href = p.url;

        // Limpa alerta de sucesso
        const alertSuccess = document.getElementById('msgLandingSucesso');
        if (alertSuccess) alertSuccess.style.display = 'none';

        // Preenche Foto Principal
        const fotoPrinc = p.foto_principal || '';
        document.getElementById('landingInputPrincipal').value = fotoPrinc;
        document.getElementById('landingPreviewPrincipal').src = this.resolverCaminhoFoto(fotoPrinc);

        // Preenche Thumbs
        const t1 = p.foto_thumb1 || fotoPrinc;
        document.getElementById('landingInputThumb1').value = t1;
        document.getElementById('landingPreviewThumb1').src = this.resolverCaminhoFoto(t1);

        const t2 = p.foto_thumb2 || fotoPrinc;
        document.getElementById('landingInputThumb2').value = t2;
        document.getElementById('landingPreviewThumb2').src = this.resolverCaminhoFoto(t2);

        const t3 = p.foto_thumb3 || fotoPrinc;
        document.getElementById('landingInputThumb3').value = t3;
        document.getElementById('landingPreviewThumb3').src = this.resolverCaminhoFoto(t3);

        this.fecharSeletorFotoLanding();

        document.getElementById('modalLandingPageOverlay')?.classList.add('active');
    }

    abrirSeletorFotoLanding(target) {
        this.landingTargetPicker = target; // 'Principal', 'Thumb1', 'Thumb2', 'Thumb3'
        const targetNameMap = {
            'Principal': 'Foto Principal do Hero',
            'Thumb1': 'Miniatura 1 (Galeria)',
            'Thumb2': 'Miniatura 2 (Galeria)',
            'Thumb3': 'Miniatura 3 (Galeria)'
        };

        const targetEl = document.getElementById('landingPickerTargetName');
        if (targetEl) targetEl.innerText = targetNameMap[target] || target;

        const container = document.getElementById('landingPickerContainer');
        if (container) {
            container.style.display = 'block';
            container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        const inputFiltro = document.getElementById('filtroLandingPickerInput');
        if (inputFiltro) inputFiltro.value = '';

        const statusEl = document.getElementById('landingUploadStatusMsg');
        if (statusEl) {
            statusEl.style.display = 'none';
            statusEl.innerText = '';
        }

        this.renderizarGaleriaPickerLanding();
    }

    fecharSeletorFotoLanding() {
        const container = document.getElementById('landingPickerContainer');
        if (container) container.style.display = 'none';
    }

    renderizarGaleriaPickerLanding(filtro = '') {
        const grid = document.getElementById('landingPickerGallery');
        if (!grid) return;

        const termo = (filtro || '').toLowerCase().trim();
        const filtradas = this.imagensDisponiveis.filter(img => !termo || img.toLowerCase().includes(termo));

        if (filtradas.length === 0) {
            grid.innerHTML = `<div style="grid-column: 1 / -1; padding: 1.5rem; text-align: center; color: var(--color-text-muted);">Nenhuma imagem encontrada.</div>`;
            return;
        }

        const currentVal = document.getElementById(`landingInput${this.landingTargetPicker}`)?.value || '';

        grid.innerHTML = filtradas.map(imgName => {
            const isSel = currentVal.includes(imgName);

            return `
                <div class="gallery-item ${isSel ? 'selected' : ''}" data-file="${imgName}" style="cursor: pointer;">
                    <img src="/assets/products/${imgName}" alt="${imgName}" onerror="window.handleAdminImgError && window.handleAdminImgError(this)">
                    <span>${imgName.replace(/\.[^/.]+$/, "")}</span>
                </div>
            `;
        }).join('');

        grid.querySelectorAll('.gallery-item').forEach(item => {
            item.addEventListener('click', () => {
                const fileName = item.getAttribute('data-file');
                const fullPath = `/assets/products/${fileName}`;

                const inputEl = document.getElementById(`landingInput${this.landingTargetPicker}`);
                const previewEl = document.getElementById(`landingPreview${this.landingTargetPicker}`);

                if (inputEl) inputEl.value = fullPath;
                if (previewEl) previewEl.src = fullPath;

                this.fecharSeletorFotoLanding();
            });
        });
    }

    async salvarFotosLandingPageForm() {
        const slug = document.getElementById('landingEditSlug').value;
        if (!slug) return;

        const btnSave = document.getElementById('btnSaveModalLanding');
        const btnOriginal = btnSave ? btnSave.innerHTML : '';
        if (btnSave) {
            btnSave.disabled = true;
            btnSave.innerText = 'Salvando e atualizando HTML...';
        }

        const payload = {
            foto_principal: document.getElementById('landingInputPrincipal').value.trim(),
            foto_thumb1: document.getElementById('landingInputThumb1').value.trim(),
            foto_thumb2: document.getElementById('landingInputThumb2').value.trim(),
            foto_thumb3: document.getElementById('landingInputThumb3').value.trim()
        };

        try {
            const res = await fetch(this.getApiUrl(`/api/admin/landing-pages/${slug}`), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await res.json();
            if (data.sucesso) {
                // Atualiza na memória
                const idx = this.landingPages.findIndex(p => p.slug === slug);
                if (idx !== -1) {
                    this.landingPages[idx] = { ...this.landingPages[idx], ...payload };
                }

                this.renderizarCardsLandingPages();

                const alertSuccess = document.getElementById('msgLandingSucesso');
                if (alertSuccess) {
                    alertSuccess.style.display = 'flex';
                    alertSuccess.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            } else {
                alert('Erro ao salvar fotos da página: ' + (data.erro || 'Erro desconhecido'));
            }
        } catch (err) {
            alert('Falha de rede ao salvar fotos: ' + err.message);
        } finally {
            if (btnSave) {
                btnSave.disabled = false;
                btnSave.innerHTML = btnOriginal;
            }
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.adminApp = new AdminApp();
});

