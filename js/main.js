/**
 * Apiário Favo de Mel - Main Institutional Script
 * Zero dependências / Vanilla JS / Sincronizado com o Admin (/api/catalogo/produtos)
 */

(function () {
    'use strict';

    function escaparHtml(valor) {
        return String(valor == null ? '' : valor)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function obterBasesApi() {
        if (typeof window.getFavodemelApiBases === 'function') {
            return window.getFavodemelApiBases();
        }
        const lista = [];
        const vista = new Set();
        const adicionar = (b) => {
            const limpo = String(b || '').trim().replace(/\/$/, '');
            if (!vista.has(limpo)) {
                vista.add(limpo);
                lista.push(limpo);
            }
        };
        if (window.FAVODEMEL_API_URL) adicionar(window.FAVODEMEL_API_URL);
        const host = window.location && window.location.hostname ? window.location.hostname : '';
        if (host === 'localhost' || host === '127.0.0.1' || host.includes('sslip.io')) {
            adicionar('');
        }
        adicionar('https://favodemel.137.131.164.202.sslip.io');
        adicionar('');
        return lista;
    }

    function comVersaoFoto(url, prod) {
        if (!url || String(url).startsWith('data:')) return url;
        const marca = prod && (prod.atualizado_em || prod.criado_em);
        const versao = marca ? String(marca).replace(/[^0-9]/g, '') : '';
        if (!versao) return url;
        return `${url}${url.includes('?') ? '&' : '?'}v=${versao}`;
    }

    function resolverFotoHome(prod, apiBase) {
        const base = String(apiBase || '').replace(/\/$/, '');
        const foto = prod && prod.foto ? String(prod.foto).trim() : '';

        if (foto.startsWith('data:image/')) return foto;
        if (foto.startsWith('http://') || foto.startsWith('https://')) {
            return comVersaoFoto(foto, prod);
        }

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
            else if (nomeNorm.includes('1400g')) arquivo = 'Mel-in-Natura-1400g.webp';
            else if (nomeNorm.includes('cera') || nomeNorm.includes('pasta')) arquivo = 'Cera-bruta-de-apis.webp';
            const fallbackUrl = base ? `${base}/assets/products/${arquivo}` : `/assets/products/${arquivo}`;
            return comVersaoFoto(fallbackUrl, prod);
        }

        if (foto.startsWith('/assets/')) {
            return comVersaoFoto(base ? `${base}${foto}` : foto, prod);
        }
        if (foto.startsWith('assets/')) {
            return comVersaoFoto(base ? `${base}/${foto}` : `/${foto}`, prod);
        }

        const fileName = foto.split('/').pop();
        const url = base ? `${base}/assets/products/${fileName}` : `/assets/products/${fileName}`;
        return comVersaoFoto(url, prod);
    }

    function atualizarJsonLdHome(produtos, apiBase) {
        if (!Array.isArray(produtos) || produtos.length === 0) return;
        const scripts = document.querySelectorAll('script[type="application/ld+json"]');
        scripts.forEach(script => {
            try {
                const json = JSON.parse(script.textContent);
                const grafo = Array.isArray(json['@graph']) ? json['@graph'] : [json];
                let alterou = false;

                grafo.forEach(no => {
                    if (no && no.hasOfferCatalog && Array.isArray(no.hasOfferCatalog.itemListElement)) {
                        no.hasOfferCatalog.itemListElement = produtos.slice(0, 8).map(p => {
                            const preco = Number(p.preco || 0).toFixed(2);
                            const estoque = p.estoque === undefined || p.estoque === null || p.estoque === '' ? null : parseInt(p.estoque, 10);
                            const disponivel = estoque === null || Number.isNaN(estoque) || estoque > 0;
                            const img = resolverFotoHome(p, apiBase);
                            const imgAbs = img.startsWith('http') ? img : `https://www.apiariofavodemel.com.br${img.startsWith('/') ? '' : '/'}${img}`;
                            return {
                                '@type': 'Offer',
                                itemOffered: {
                                    '@type': 'Product',
                                    name: p.nome,
                                    description: p.descricao || 'Produto natural do Apiário Favo de Mel.',
                                    image: imgAbs,
                                    offers: {
                                        '@type': 'Offer',
                                        price: preco,
                                        priceCurrency: 'BRL',
                                        availability: disponivel ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock'
                                    }
                                }
                            };
                        });
                        alterou = true;
                    }
                });

                if (alterou) {
                    script.textContent = JSON.stringify(json);
                }
            } catch (_) {}
        });
    }

    function renderizarDestaquesHome(produtos, apiBase) {
        const grid = document.querySelector('#produtos .products-grid');
        if (!grid || !Array.isArray(produtos) || produtos.length === 0) return;

        // Ordena priorizando produtos em estoque, com destaque ou página dedicada
        const ordenados = [...produtos].sort((a, b) => {
            const estA = a.estoque === undefined || a.estoque === null || a.estoque === '' ? 99 : parseInt(a.estoque, 10);
            const estB = b.estoque === undefined || b.estoque === null || b.estoque === '' ? 99 : parseInt(b.estoque, 10);
            const dispA = Number.isNaN(estA) || estA > 0 ? 1 : 0;
            const dispB = Number.isNaN(estB) || estB > 0 ? 1 : 0;
            if (dispA !== dispB) return dispB - dispA;

            const destA = (a.destaque ? 2 : 0) + (a.landing_slug ? 1 : 0);
            const destB = (b.destaque ? 2 : 0) + (b.landing_slug ? 1 : 0);
            if (destA !== destB) return destB - destA;
            return (Number(a.id) || 0) - (Number(b.id) || 0);
        });

        const destaques = ordenados.slice(0, 8);

        grid.innerHTML = destaques.map(prod => {
            const precoFormatado = Number(prod.preco || 0).toFixed(2).replace('.', ',');
            const fotoUrl = resolverFotoHome(prod, apiBase);
            const nomeSeguro = escaparHtml(prod.nome);
            const descSegura = escaparHtml(prod.descricao || 'Produto natural de altíssima qualidade direto do Apiário Favo de Mel.');
            const catLimpa = escaparHtml(
                String(prod.categoria_nome || 'Apiário Favo de Mel')
                    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{2300}-\u{23FF}]/gu, '')
                    .trim() || 'Apiário Favo de Mel'
            );

            const estoque = prod.estoque === undefined || prod.estoque === null || prod.estoque === '' ? null : parseInt(prod.estoque, 10);
            const esgotado = estoque !== null && !Number.isNaN(estoque) && estoque <= 0;
            const baixo = estoque !== null && !Number.isNaN(estoque) && estoque > 0 && estoque <= 5;

            const badgeTexto = escaparHtml(prod.badge || (prod.landing_slug ? 'Destaque' : 'Artesanal'));
            let stockBadgeHtml = '';
            if (esgotado) {
                stockBadgeHtml = '<span class="product-stock-badge esgotado">Esgotado</span>';
            } else if (baixo) {
                stockBadgeHtml = `<span class="product-stock-badge baixo">Últimas ${estoque} un.</span>`;
            }

            const slugLanding = prod.landing_slug ? String(prod.landing_slug).trim().replace(/^\/+/, '') : '';
            const hrefDestino = slugLanding
                ? `/${slugLanding}`
                : (esgotado ? '/catalogo' : `/catalogo?add=${encodeURIComponent(prod.id)}`);
            const labelBotao = slugLanding
                ? 'Ver Detalhes'
                : (esgotado ? 'Ver no Catálogo' : 'Comprar');

            return `
                <div class="product-card" data-product-id="${escaparHtml(prod.id)}">
                    <div class="product-img-box">
                        <span class="product-badge">${badgeTexto}</span>
                        ${stockBadgeHtml}
                        <a href="${escaparHtml(hrefDestino)}" style="display:contents;">
                            <img src="${escaparHtml(fotoUrl)}" alt="${nomeSeguro}" width="300" height="300" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='/assets/products/Mel-in-natura-500g.webp';">
                        </a>
                    </div>
                    <div class="product-info">
                        <span class="product-category">${catLimpa}</span>
                        <h3 class="product-title"><a href="${escaparHtml(hrefDestino)}">${nomeSeguro}</a></h3>
                        <p class="product-desc">${descSegura}</p>
                        <div class="product-footer">
                            <div class="product-price"><small>R$</small> ${precoFormatado}</div>
                            <a href="${escaparHtml(hrefDestino)}" class="btn-card">${labelBotao}</a>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        const ctaTitle = document.getElementById('homeCatalogCtaTitle');
        if (ctaTitle) {
            ctaTitle.textContent = `Deseja conferir todos os ${produtos.length} produtos disponíveis no nosso catálogo?`;
        }
    }

    async function sincronizarHomeComCatalogo() {
        const bases = obterBasesApi();
        for (const base of bases) {
            const url = `${base}/api/catalogo/produtos?_t=${Date.now()}`;
            try {
                const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
                const timer = controller ? setTimeout(() => controller.abort(), 6000) : null;
                const res = await fetch(url, {
                    cache: 'no-store',
                    headers: { Accept: 'application/json' },
                    signal: controller ? controller.signal : undefined
                });
                if (timer) clearTimeout(timer);
                if (!res.ok) continue;

                const data = await res.json();
                if (data && data.sucesso && Array.isArray(data.produtos) && data.produtos.length > 0) {
                    const ativos = data.produtos.filter(p => p && p.ativo !== false);
                    if (ativos.length > 0) {
                        renderizarDestaquesHome(ativos, base);
                        atualizarJsonLdHome(ativos, base);
                        return;
                    }
                }
            } catch (_) {
                // Tenta a próxima base configurada
            }
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        // 1. Navbar Scroll State (Passive listener para rolagem fluida a 60fps)
        const header = document.querySelector('.site-header');
        if (header) {
            window.addEventListener('scroll', () => {
                if (window.scrollY > 40) {
                    header.classList.add('scrolled');
                } else {
                    header.classList.remove('scrolled');
                }
            }, { passive: true });
        }

        // 2. Mobile Menu Toggle (com aria-expanded e suporte a Escape)
        const mobileBtn = document.querySelector('.mobile-toggle');
        const navLinks = document.querySelector('.nav-links');
        const iconMenu = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>`;
        const iconClose = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;

        if (mobileBtn && navLinks) {
            const definirEstadoMenu = (aberto) => {
                navLinks.classList.toggle('active', aberto);
                mobileBtn.setAttribute('aria-expanded', aberto ? 'true' : 'false');
                mobileBtn.setAttribute('aria-label', aberto ? 'Fechar Menu' : 'Abrir Menu');
                mobileBtn.innerHTML = aberto ? iconClose : iconMenu;
            };

            mobileBtn.addEventListener('click', () => {
                const abrir = !navLinks.classList.contains('active');
                definirEstadoMenu(abrir);
            });

            navLinks.querySelectorAll('a').forEach(link => {
                link.addEventListener('click', () => definirEstadoMenu(false));
            });

            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && navLinks.classList.contains('active')) {
                    definirEstadoMenu(false);
                    mobileBtn.focus();
                }
            });
        }

        // 3. Contadores Numéricos Animados (respeitando prefers-reduced-motion)
        const statNumbers = document.querySelectorAll('.stat-number');
        const statsSection = document.querySelector('.stats-section');
        const prefereMovimentoReduzido = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        if (statsSection && statNumbers.length > 0) {
            const startCounterAnimation = () => {
                statNumbers.forEach(el => {
                    const targetText = el.getAttribute('data-target') || el.innerText;
                    const targetNum = parseInt(targetText.replace(/\D/g, ''), 10);
                    const prefix = targetText.startsWith('+') ? '+' : '';
                    const suffix = targetText.endsWith('%') ? '%' : '';

                    if (prefereMovimentoReduzido || Number.isNaN(targetNum)) {
                        el.innerText = `${prefix}${Number.isNaN(targetNum) ? targetText : targetNum.toLocaleString('pt-BR')}${suffix}`;
                        return;
                    }

                    let current = 0;
                    const duration = 1400;
                    const stepTime = 25;
                    const totalSteps = duration / stepTime;
                    const increment = Math.ceil(targetNum / totalSteps);

                    const timer = setInterval(() => {
                        current += increment;
                        if (current >= targetNum) {
                            current = targetNum;
                            clearInterval(timer);
                        }
                        el.innerText = `${prefix}${current.toLocaleString('pt-BR')}${suffix}`;
                    }, stepTime);
                });
            };

            if ('IntersectionObserver' in window && !prefereMovimentoReduzido) {
                const observer = new IntersectionObserver((entries, obs) => {
                    entries.forEach(entry => {
                        if (entry.isIntersecting) {
                            startCounterAnimation();
                            obs.disconnect();
                        }
                    });
                }, { threshold: 0.25 });
                observer.observe(statsSection);
            } else {
                startCounterAnimation();
            }
        }

        // 4. Máscara de Telefone e Formulário de Contato Direto para WhatsApp
        const cfTel = document.getElementById('cfTelefone');
        if (cfTel) {
            cfTel.addEventListener('input', (e) => {
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

        const contactForm = document.getElementById('contactForm');
        if (contactForm) {
            contactForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const nome = document.getElementById('cfNome').value.trim();
                const tel = document.getElementById('cfTelefone').value.trim();
                const assunto = document.getElementById('cfAssunto').value;
                const mensagem = document.getElementById('cfMensagem').value.trim();

                const textoMsg =
`*CONTATO VIA SITE - APIÁRIO FAVO DE MEL*
*Nome:* ${nome}
*Telefone:* ${tel}
*Assunto:* ${assunto}
*Mensagem:* ${mensagem}`;

                const numeroLoja = '557988125726';
                const url = `https://wa.me/${numeroLoja}?text=${encodeURIComponent(textoMsg)}`;
                const win = window.open(url, '_blank', 'noopener,noreferrer');
                if (!win) {
                    window.location.href = url;
                }
            });
        }

        // 5. Sincroniza a vitrine de destaques da Home com o catálogo real do Admin
        sincronizarHomeComCatalogo();
    });
})();
