/**
 * Apiário Favo de Mel - Sincronização das Landing Pages
 *
 * As landing pages são HTML estáticos servidos pelo Hostinger, enquanto o painel
 * admin grava fotos/preços no backend (VPS). Este script busca os dados atuais
 * da página e aplica em tempo de execução, sem precisar republicar o site.
 */
(function () {
    'use strict';

    var SLUGS_CONHECIDOS = [
        'mel-com-favo',
        'mel-de-urucu',
        'mel-silvestre',
        'polen-apicola',
        'propolis-verde',
        'propolis-vermelha',
        'kit-presente',
        'resgate-de-abelhas',
        'consultoria-apicola'
    ];

    var apiBaseAtiva = '';
    var ultimaAtualizacao = 0;
    var timer = null;

    function slugDaPagina() {
        var caminho = (window.location.pathname || '').replace(/\/+$/, '');
        var arquivo = caminho.split('/').pop() || '';
        var slug = arquivo.replace(/\.html?$/i, '').toLowerCase();
        if (!slug) return '';
        return SLUGS_CONHECIDOS.indexOf(slug) !== -1 ? slug : '';
    }

    function basesDaApi() {
        if (typeof window.getFavodemelApiBases === 'function') {
            return window.getFavodemelApiBases();
        }
        var bases = [];
        var adicionar = function (valor) {
            var base = String(valor || '').trim().replace(/\/+$/, '');
            if (base && bases.indexOf(base) === -1) bases.push(base);
        };
        adicionar(window.FAVODEMEL_API_URL);
        try {
            if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
                adicionar(window.location.origin);
            }
        } catch (_) {}
        adicionar('https://favodemel.137.131.164.202.sslip.io');
        return bases;
    }

    function buscarJson(endpoint) {
        var bases = basesDaApi();
        var tentativa = 0;

        function proxima() {
            if (tentativa >= bases.length) {
                return Promise.reject(new Error('API de landing pages indisponível.'));
            }
            var base = bases[tentativa++];
            var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
            var timeout = controller ? setTimeout(function () { controller.abort(); }, 10000) : null;

            return fetch(base + endpoint + (endpoint.indexOf('?') === -1 ? '?' : '&') + '_t=' + Date.now(), {
                cache: 'no-store',
                signal: controller ? controller.signal : undefined
            }).then(function (res) {
                return res.text().then(function (texto) {
                    var data;
                    try {
                        data = JSON.parse(texto);
                    } catch (_) {
                        throw new Error('Resposta inválida de ' + base);
                    }
                    if (!res.ok) {
                        throw new Error((data && data.erro) || ('HTTP ' + res.status));
                    }
                    apiBaseAtiva = base;
                    return data;
                });
            }).catch(function (err) {
                console.warn('[Landing] API indisponível em ' + base + ':', err.message);
                return proxima();
            }).then(function (data) {
                if (timeout) clearTimeout(timeout);
                return data;
            }, function (err) {
                if (timeout) clearTimeout(timeout);
                throw err;
            });
        }

        return proxima();
    }

    function normalizarUrlFoto(foto, versao) {
        if (!foto) return '';
        var valor = String(foto).trim();
        if (!valor || valor === 'null' || valor === 'undefined') return '';
        if (valor.indexOf('data:image/') === 0) return valor;

        var base = (apiBaseAtiva || window.FAVODEMEL_API_URL || '').replace(/\/+$/, '');

        if (/^https?:\/\//i.test(valor)) {
            return comVersao(valor, versao);
        }
        if (valor.charAt(0) === '/') {
            return comVersao(base ? base + valor : valor, versao);
        }
        if (/^assets\//i.test(valor)) {
            return comVersao(base ? base + '/' + valor : '/' + valor, versao);
        }
        var arquivo = valor.split('/').pop();
        return comVersao(base ? base + '/assets/products/' + arquivo : '/assets/products/' + arquivo, versao);
    }

    function comVersao(url, versao) {
        if (!url || !versao) return url;
        var marca = String(versao).replace(/[^0-9]/g, '');
        if (!marca) return url;
        return url + (url.indexOf('?') === -1 ? '?' : '&') + 'v=' + marca;
    }

    // Se a imagem remota falhar, tenta a cópia local e, por fim, troca a extensão.
    function aplicarImagem(img, url) {
        if (!img || !url) return;
        img.onerror = function () {
            var atual = img.getAttribute('src') || '';
            var partes = atual.split('?');
            var caminho = partes[0];
            var query = partes.length > 1 ? '?' + partes.slice(1).join('?') : '';
            if (apiBaseAtiva && caminho.indexOf(apiBaseAtiva) === 0) {
                img.onerror = function () {
                    img.onerror = null;
                };
                img.src = caminho.slice(apiBaseAtiva.length) || caminho;
                return;
            }
            if (/\.webp$/i.test(caminho)) {
                img.src = caminho.replace(/\.webp$/i, '.jpeg') + query;
            } else if (/\.(png|jpe?g)$/i.test(caminho)) {
                img.src = caminho.replace(/\.(png|jpe?g)$/i, '.webp') + query;
            } else {
                img.onerror = null;
            }
        };
        img.src = url;
    }

    function formatarPreco(valor) {
        var numero = parseFloat(String(valor).replace(',', '.'));
        if (!isFinite(numero)) return '';
        return numero.toFixed(2).replace('.', ',');
    }

    function atualizarPreco(preco) {
        var elementos = document.querySelectorAll('.price-val');
        if (!elementos.length) return;
        var formatado = formatarPreco(preco);
        if (!formatado) return;

        Array.prototype.forEach.call(elementos, function (el) {
            // Só substitui preços numéricos ("Sob Medida" permanece intacto).
            if (!/^[\d.,]+$/.test((el.textContent || '').trim())) return;
            el.textContent = formatado;
        });
    }

    function atualizarTitulo(titulo) {
        if (!titulo) return;
        var el = document.querySelector('.product-title-h1');
        if (el && el.textContent !== titulo) el.textContent = titulo;
    }

    function atualizarGaleria(mainUrl, thumbs, versao) {
        var mainImg = document.getElementById('mainProductImg');
        if (mainImg && mainUrl) aplicarImagem(mainImg, mainUrl);

        var container = document.querySelector('.product-thumbs');
        if (!container) return;

        var lista = [];
        if (mainUrl) lista.push(mainUrl);
        (thumbs || []).forEach(function (url) {
            if (url && lista.indexOf(url) === -1) lista.push(url);
        });
        if (!lista.length) return;

        container.innerHTML = '';
        lista.forEach(function (url, indice) {
            var item = document.createElement('div');
            item.className = 'product-thumb-item' + (indice === 0 ? ' active' : '');

            var img = document.createElement('img');
            img.alt = 'Visualização ' + (indice + 1);
            aplicarImagem(img, url);

            item.appendChild(img);
            item.addEventListener('click', function () {
                var principal = document.getElementById('mainProductImg');
                if (principal) aplicarImagem(principal, url);
                var itens = container.querySelectorAll('.product-thumb-item');
                Array.prototype.forEach.call(itens, function (i) { i.classList.remove('active'); });
                item.classList.add('active');
            });

            container.appendChild(item);
        });

        // Mantém a versão usada nas miniaturas para futuras re-renderizações.
        container.setAttribute('data-versao', versao ? String(versao) : '');
    }

    function atualizarWhatsApp(preco) {
        var formatado = formatarPreco(preco);
        if (!formatado) return;

        var links = document.querySelectorAll('a[href*="wa.me/"]');
        Array.prototype.forEach.call(links, function (link) {
            try {
                var url = new URL(link.getAttribute('href'), window.location.href);
                var texto = url.searchParams.get('text');
                if (!texto) return;
                var novo = texto
                    .replace(/R\$\s*[\d.,]+/g, 'R$ ' + formatado)
                    .replace(/R\$\s*$/, 'R$ ' + formatado);
                if (novo !== texto) {
                    url.searchParams.set('text', novo);
                    link.setAttribute('href', url.toString());
                }
            } catch (_) {}
        });
    }

    function atualizarSchemaPreco(preco) {
        var formatado = formatarPreco(preco);
        if (!formatado) return;
        var schemaPreco = formatado.replace(',', '.');

        var scripts = document.querySelectorAll('script[type="application/ld+json"]');
        Array.prototype.forEach.call(scripts, function (script) {
            try {
                var texto = script.textContent || '';
                var atualizado = texto.replace(/("price"\s*:\s*")[\d.,]+(")/g, '$1' + schemaPreco + '$2');
                if (atualizado !== texto) script.textContent = atualizado;
            } catch (_) {}
        });
    }

    function atualizarEstoque(produto) {
        if (!produto || produto.estoque === undefined || produto.estoque === null) return;
        var estoque = parseInt(produto.estoque, 10);
        if (!isFinite(estoque)) return;

        var alvo = document.querySelector('.product-price-box');
        if (!alvo) return;

        var status = document.getElementById('landingStockStatus');
        if (!status) {
            status = document.createElement('div');
            status.id = 'landingStockStatus';
            status.style.cssText = 'margin-top:10px;font-size:0.82rem;font-weight:600;display:flex;align-items:center;gap:6px;';
            alvo.appendChild(status);
        }

        if (estoque > 0) {
            status.style.color = '#047857';
            status.innerHTML = '<span style="width:8px;height:8px;border-radius:50%;background:currentColor;display:inline-block;"></span>' +
                (estoque <= 5 ? 'Últimas unidades em estoque' : 'Disponível em estoque');
        } else {
            status.style.color = '#B91C1C';
            status.innerHTML = '<span style="width:8px;height:8px;border-radius:50%;background:currentColor;display:inline-block;"></span>' +
                'Temporariamente esgotado - fale conosco no WhatsApp';
        }
    }

    function aplicarDados(data) {
        if (!data || !data.sucesso) return;
        var pagina = data.pagina || {};
        var produto = data.produto || null;

        var versaoPagina = pagina.atualizado_em || '';
        var versaoProduto = produto ? (produto.atualizado_em || produto.criado_em || '') : '';

        // Foto principal: usa a foto escolhida no editor da landing page.
        // Se o produto vinculado tiver uma foto mais recente, ela tem prioridade.
        var principal = '';
        var versaoPrincipal = '';
        if (produto && produto.foto && String(produto.foto).indexOf('data:image/') !== 0) {
            principal = produto.foto;
            versaoPrincipal = versaoProduto;
        }
        if (pagina.foto_principal) {
            var paginaMaisRecente = !principal || !versaoProduto ||
                (versaoPagina && new Date(versaoPagina) >= new Date(versaoProduto));
            if (paginaMaisRecente) {
                principal = pagina.foto_principal;
                versaoPrincipal = versaoPagina;
            }
        }

        var mainUrl = normalizarUrlFoto(principal, versaoPrincipal);
        var thumbs = [pagina.foto_thumb1, pagina.foto_thumb2, pagina.foto_thumb3]
            .filter(function (foto) { return !!foto; })
            .map(function (foto) { return normalizarUrlFoto(foto, versaoPagina); });

        atualizarTitulo(pagina.titulo);
        atualizarGaleria(mainUrl, thumbs, versaoPrincipal);

        if (produto) {
            var preco = parseFloat(produto.preco);
            if (isFinite(preco) && preco > 0) {
                atualizarPreco(preco);
                atualizarWhatsApp(preco);
                atualizarSchemaPreco(preco);
            }
            atualizarEstoque(produto);
        }
    }

    function sincronizar(silencioso) {
        var slug = slugDaPagina();
        if (!slug) return Promise.resolve();

        return buscarJson('/api/catalogo/landing-pages/' + encodeURIComponent(slug))
            .then(function (data) {
                aplicarDados(data);
                if (!silencioso) {
                    console.log('[Landing] Dados sincronizados:', slug);
                }
            })
            .catch(function (err) {
                // Endpoint novo pode ainda não estar publicado no VPS: mantém a página estática.
                console.warn('[Landing] Não foi possível sincronizar "' + slug + '":', err.message);
            });
    }

    function sincronizarEmSegundoPlano() {
        if (document.visibilityState === 'hidden') return;
        var agora = Date.now();
        if (agora - ultimaAtualizacao < 20000) return;
        ultimaAtualizacao = agora;
        sincronizar(true);
    }

    function iniciar() {
        if (!slugDaPagina()) return;

        sincronizar(false);
        ultimaAtualizacao = Date.now();

        if (timer) clearInterval(timer);
        timer = setInterval(sincronizarEmSegundoPlano, 90000);

        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'visible') sincronizarEmSegundoPlano();
        });
        window.addEventListener('focus', sincronizarEmSegundoPlano);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }
})();
