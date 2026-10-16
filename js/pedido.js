/**
 * Acompanhamento de Pedido em Tempo Real (Anti-IDOR & Trem Delivery)
 * Apiário Favo de Mel
 */

class PedidoTrackingApp {
    constructor() {
        this.codigo = '';
        this.token = '';
        this.pedido = null;
        this.pollingInterval = null;

        this.init();
    }

    getApiUrl(endpoint) {
        const base = (window.FAVODEMEL_API_URL || '').replace(/\/$/, '');
        if (!base && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
            if (window.location.port !== '8080') {
                return `http://localhost:8080${endpoint}`;
            }
        }
        return `${base}${endpoint}`;
    }

    init() {
        const params = new URLSearchParams(window.location.search);
        this.codigo = (params.get('codigo') || params.get('id') || '').trim();
        this.token = (params.get('token') || '').trim();

        if (!this.codigo) {
            this.exibirErro(
                'Código de Pedido Ausente',
                'Não foi possível identificar o pedido. Verifique o link recebido no WhatsApp da loja.'
            );
            return;
        }

        this.carregarPedido();
        
        // Polling para atualização de status em tempo real a cada 12 segundos
        this.pollingInterval = setInterval(() => {
            this.carregarPedido(true);
        }, 12000);
    }

    async carregarPedido(isSilent = false) {
        try {
            const endpoint = `/api/catalogo/pedidos/${encodeURIComponent(this.codigo)}?token=${encodeURIComponent(this.token)}`;
            const res = await fetch(this.getApiUrl(endpoint));
            const data = await res.json();

            if (res.status === 403) {
                this.exibirErro(
                    'Acesso Não Autorizado',
                    'Este link de acompanhamento é exclusivo e seguro para o comprador deste pedido.'
                );
                if (this.pollingInterval) clearInterval(this.pollingInterval);
                return;
            }

            if (!res.ok || !data.sucesso || !data.pedido) {
                this.exibirErro(
                    'Pedido Não Encontrado',
                    data.erro || 'O pedido informado não foi localizado no nosso sistema.'
                );
                if (this.pollingInterval) clearInterval(this.pollingInterval);
                return;
            }

            this.pedido = data.pedido;
            this.renderizarPedido();

        } catch (err) {
            console.warn('Servidor offline ou inacessível, checando cache local:', err.message);
            // Verifica se temos cache local do pedido
            try {
                const salvoStr = localStorage.getItem('favodemel_ultimo_pedido');
                if (salvoStr) {
                    const salvo = JSON.parse(salvoStr);
                    const pedidoLocal = salvo.pedido || salvo;
                    if (pedidoLocal && (pedidoLocal.codigo_pedido === this.codigo || `#${pedidoLocal.codigo_pedido}` === this.codigo)) {
                        if (pedidoLocal.token_acesso && this.token && pedidoLocal.token_acesso !== this.token) {
                            this.exibirErro(
                                'Acesso Não Autorizado',
                                'Este link de acompanhamento é exclusivo e seguro para o comprador deste pedido.'
                            );
                            if (this.pollingInterval) clearInterval(this.pollingInterval);
                            return;
                        }
                        this.pedido = pedidoLocal;
                        this.renderizarPedido();
                        return;
                    }
                }
            } catch (_) {}

            if (!isSilent) {
                this.exibirErro(
                    'Falha na Conexão',
                    'Não foi possível conectar ao servidor do Apiário no momento. Tente novamente em instantes.'
                );
            }
        }
    }

    exibirErro(titulo, desc) {
        document.getElementById('trackingLoading')?.classList.add('hidden');
        document.getElementById('trackingContent')?.classList.add('hidden');
        const errBox = document.getElementById('trackingError');
        if (errBox) {
            errBox.classList.remove('hidden');
            document.getElementById('trackingErrorTitle').innerText = titulo;
            document.getElementById('trackingErrorDesc').innerText = desc;
        }
    }

    renderizarPedido() {
        const p = this.pedido;
        document.getElementById('trackingLoading')?.classList.add('hidden');
        document.getElementById('trackingError')?.classList.add('hidden');
        document.getElementById('trackingContent')?.classList.remove('hidden');

        // Código e Data
        document.getElementById('displayCodigoPedido').innerText = `#${p.codigo_pedido}`;
        const dataObj = new Date(p.criado_em || Date.now());
        const dataFormatada = dataObj.toLocaleDateString('pt-BR');
        const horaFormatada = dataObj.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        document.getElementById('displayDataPedido').innerText = `Realizado em ${dataFormatada} às ${horaFormatada}`;

        // Status & Stepper
        this.renderizarStatusEStepper(p.status, p.tipo_entrega);

        // Itens
        this.renderizarItens(p.itens || []);

        // Totais
        const subtotalNum = parseFloat(p.subtotal || 0);
        const taxaNum = parseFloat(p.taxa_entrega || 0);
        const totalNum = parseFloat(p.total || 0);

        document.getElementById('displaySubtotal').innerText = `R$ ${subtotalNum.toFixed(2).replace('.', ',')}`;
        document.getElementById('displayTaxaEntrega').innerText = taxaNum > 0 
            ? `R$ ${taxaNum.toFixed(2).replace('.', ',')}` 
            : (p.tipo_entrega === 'entrega' ? 'A combinar' : 'Grátis (Retirada)');
        document.getElementById('displayTotal').innerText = `R$ ${totalNum.toFixed(2).replace('.', ',')}`;

        // Pagamento
        this.renderizarPagamento(p.forma_pagamento, p.troco_para, totalNum);

        // Entrega
        this.renderizarEntrega(p.tipo_entrega, p.endereco);

        // Cliente
        document.getElementById('displayClienteNome').innerText = p.cliente_nome || '--';
        document.getElementById('displayClienteTelefone').innerText = p.cliente_telefone || '--';

        // Observações
        const boxObs = document.getElementById('boxObservacoes');
        if (p.observacoes && p.observacoes.trim()) {
            boxObs?.classList.remove('hidden');
            document.getElementById('displayObservacoes').innerText = p.observacoes.trim();
        } else {
            boxObs?.classList.add('hidden');
        }

        // WhatsApp CTA
        const btnZap = document.getElementById('btnFalarWhatsAppPedido');
        if (btnZap) {
            const zapMsg = `Olá! Gostaria de falar sobre o meu pedido *#${p.codigo_pedido}* do Apiário Favo de Mel.`;
            btnZap.href = `https://wa.me/557988125726?text=${encodeURIComponent(zapMsg)}`;
        }
    }

    renderizarStatusEStepper(status, tipoEntrega) {
        const badge = document.getElementById('displayStatusBadge');
        const fill = document.getElementById('stepperProgressFill');
        const bannerText = document.getElementById('statusLiveText');
        const step1 = document.getElementById('step1');
        const step2 = document.getElementById('step2');
        const step3 = document.getElementById('step3');
        const step4 = document.getElementById('step4');
        const step3Label = document.getElementById('step3Label');

        const isEntrega = tipoEntrega === 'entrega';
        if (step3Label) {
            step3Label.innerText = isEntrega ? 'A Caminho' : 'Pronto p/ Retirada';
        }

        // Reset steps
        [step1, step2, step3, step4].forEach(s => {
            s?.classList.remove('active', 'completed');
        });

        if (status === 'novo') {
            badge.className = 'status-badge status-novo';
            badge.innerText = 'Pedido Recebido';
            fill.style.width = '15%';
            step1?.classList.add('active');
            bannerText.innerText = 'Seu pedido foi registrado e está aguardando confirmação do vendedor.';
        } else if (status === 'em_preparo') {
            badge.className = 'status-badge status-preparo';
            badge.innerText = 'Em Preparação';
            fill.style.width = '48%';
            step1?.classList.add('completed');
            step2?.classList.add('active');
            bannerText.innerText = 'Seu pedido foi aceito! Nossos apicultores estão separando os produtos com todo o cuidado.';
        } else if (status === 'saiu_entrega') {
            badge.className = 'status-badge status-rota';
            badge.innerText = 'Saiu para Entrega';
            fill.style.width = '80%';
            step1?.classList.add('completed');
            step2?.classList.add('completed');
            step3?.classList.add('active');
            bannerText.innerText = 'Pedido em rota de entrega! Nosso entregador está a caminho do seu endereço.';
        } else if (status === 'pronto') {
            badge.className = 'status-badge status-rota';
            badge.innerText = 'Pronto para Retirada';
            fill.style.width = '80%';
            step1?.classList.add('completed');
            step2?.classList.add('completed');
            step3?.classList.add('active');
            bannerText.innerText = 'Seu pedido está pronto e embalado aguardando sua retirada no Apiário Favo de Mel.';
        } else if (status === 'entregue') {
            badge.className = 'status-badge status-entregue';
            badge.innerText = 'Pedido Concluído';
            fill.style.width = '100%';
            step1?.classList.add('completed');
            step2?.classList.add('completed');
            step3?.classList.add('completed');
            step4?.classList.add('completed');
            bannerText.innerText = 'Pedido entregue com sucesso! Esperamos que aprecie a pureza dos nossos produtos.';
        } else if (status === 'cancelado') {
            badge.className = 'status-badge status-cancelado';
            badge.innerText = 'Pedido Cancelado';
            fill.style.width = '0%';
            bannerText.innerText = 'Este pedido foi cancelado no sistema.';
        } else {
            badge.className = 'status-badge status-novo';
            badge.innerText = status || 'Em Processamento';
            fill.style.width = '15%';
            step1?.classList.add('active');
            bannerText.innerText = 'Acompanhe as atualizações do seu pedido por aqui.';
        }
    }

    renderizarItens(itens) {
        const listEl = document.getElementById('orderItemsList');
        const badgeQtd = document.getElementById('displayQtdItens');
        if (!listEl) return;

        const itensArr = Array.isArray(itens) ? itens : (typeof itens === 'string' ? JSON.parse(itens || '[]') : []);
        badgeQtd.innerText = `${itensArr.length} item(ns)`;

        if (itensArr.length === 0) {
            listEl.innerHTML = '<p style="color: #6E6359; font-size: 0.9rem;">Nenhum item registrado.</p>';
            return;
        }

        listEl.innerHTML = itensArr.map(item => {
            const qtd = item.quantidade || 1;
            const precoUnit = parseFloat(item.preco || 0);
            const subtotalItem = (qtd * precoUnit).toFixed(2).replace('.', ',');

            return `
                <div class="order-item-row">
                    <div class="item-main-info">
                        <div class="item-qty-badge">${qtd}x</div>
                        <div>
                            <div class="item-name">${item.nome || 'Produto'}</div>
                            <div class="item-unit-price">R$ ${precoUnit.toFixed(2).replace('.', ',')} un</div>
                        </div>
                    </div>
                    <div class="item-total-price">R$ ${subtotalItem}</div>
                </div>
            `;
        }).join('');
    }

    renderizarPagamento(forma, trocoPara, total) {
        const badge = document.getElementById('displayFormaPagamentoBadge');
        const box = document.getElementById('detalhesPagamentoBox');
        if (!box) return;

        const f = (forma || 'pix').toLowerCase();

        if (f === 'pix') {
            badge.innerText = 'PIX';
            
            let payload = '';
            const chave = '79988125726';
            const codigoTxid = (this.codigoPedido || 'FAVODEMEL').replace(/[^a-zA-Z0-9]/g, '');
            const valNum = parseFloat(total) || 0;

            if (typeof PixUtil !== 'undefined') {
                payload = PixUtil.gerarCopiaECola({
                    chave: chave,
                    tipo: 'telefone',
                    nome: 'Apiario Favo de Mel',
                    cidade: 'Aracaju',
                    valor: valNum,
                    txid: codigoTxid
                });
            }

            const qrUrl = typeof PixUtil !== 'undefined' ? PixUtil.gerarQrCodeUrl(payload, 180) : '';

            box.innerHTML = `
                <div style="font-size: 0.85rem; color: #2C231C; margin-bottom: 0.85rem;">
                    Pagamento via PIX instantâneo. Use o código Copia e Cola oficial ou escaneie o QR Code:
                </div>
                <div style="display: flex; gap: 1rem; align-items: center; background: #FAF7F2; padding: 1rem; border-radius: 8px; border: 1px solid #E8DFD3; margin-bottom: 0.85rem;">
                    ${qrUrl ? `<img src="${qrUrl}" alt="QR Code PIX" style="width: 100px; height: 100px; background: white; padding: 4px; border-radius: 4px; border: 1px solid #E8DFD3; flex-shrink: 0;">` : ''}
                    <div style="flex: 1; min-width: 0;">
                        <div style="font-size: 0.75rem; font-weight: 700; color: #8C5905; text-transform: uppercase; margin-bottom: 0.25rem;">PIX Copia e Cola:</div>
                        <input type="text" id="pixTrackingPayload" value="${payload}" class="form-control" style="font-family: monospace; font-size: 0.72rem; padding: 0.4rem; margin-bottom: 0.4rem;" readonly>
                        <button class="btn-copy-pix" id="btnCopyPixPayloadTracking" onclick="copiarPixPayloadTracking()" style="background: #D98200; color: white; border: none; padding: 0.4rem 0.8rem; font-size: 0.78rem; font-weight: 600; border-radius: 4px; cursor: pointer;">
                            Copiar Código Copia e Cola
                        </button>
                    </div>
                </div>
                <div style="display: flex; align-items: center; justify-content: space-between; padding-top: 0.5rem; border-top: 1px dashed #E8DFD3; font-size: 0.82rem;">
                    <span>Chave Telefone: <strong>${chave}</strong></span>
                    <button class="btn-copy-pix" id="btnCopyPixTracking" onclick="copiarChavePixTracking()" style="background: white; border: 1px solid #E8DFD3; padding: 0.3rem 0.6rem; font-size: 0.78rem; border-radius: 4px; cursor: pointer;">Copiar Chave</button>
                </div>
            `;
        } else if (f === 'dinheiro') {
            badge.innerText = 'Dinheiro';
            const trocoStr = trocoPara ? `Troco para: <strong>R$ ${trocoPara}</strong>` : 'Não precisa de troco';
            box.innerHTML = `
                <p>Pagamento em dinheiro na entrega/retirada.</p>
                <div style="background: #F5EFE6; padding: 0.75rem 1rem; border-radius: 6px; font-size: 0.88rem;">
                    ${trocoStr}
                </div>
            `;
        } else if (f === 'cartao') {
            badge.innerText = 'Cartão';
            box.innerHTML = `
                <p>Pagamento com cartão (débito ou crédito) na maquininha na entrega ou retirada.</p>
            `;
        } else {
            badge.innerText = forma || 'A Combinar';
            box.innerHTML = `<p>${forma || 'Pagamento a combinar com a loja.'}</p>`;
        }
    }

    renderizarEntrega(tipo, endereco) {
        const titulo = document.getElementById('tituloModalidadeEntrega');
        const badge = document.getElementById('badgeModalidadeEntrega');
        const body = document.getElementById('deliveryDetailsBody');
        if (!body) return;

        const isEntrega = tipo === 'entrega';

        if (isEntrega) {
            titulo.innerText = 'Endereço de Entrega';
            badge.className = 'card-count-badge';
            badge.innerText = 'Entrega';

            const end = typeof endereco === 'string' ? JSON.parse(endereco || '{}') : (endereco || {});
            const rua = end.rua ? `${end.rua}` : '';
            const num = end.numero ? `, nº ${end.numero}` : '';
            const bairro = end.bairro ? ` - ${end.bairro}` : '';
            const cidade = end.cidade ? ` - ${end.cidade}` : '';
            const comp = end.complemento ? ` (${end.complemento})` : '';

            const endFormatado = `${rua}${num}${bairro}${cidade}${comp}`;

            body.innerHTML = `
                <p><strong>Destino:</strong> ${endFormatado || 'Endereço informado no checkout'}</p>
                <p style="font-size: 0.82rem; color: #6E6359; margin-top: 0.4rem;">
                    Nosso entregador informará via WhatsApp assim que estiver a caminho.
                </p>
            `;
        } else {
            titulo.innerText = 'Retirada no Apiário';
            badge.className = 'card-count-badge';
            badge.innerText = 'Retirada no Local';

            body.innerHTML = `
                <p><strong>Local de Retirada:</strong> Apiário Favo de Mel</p>
                <p><strong>Horário de Atendimento:</strong> Segunda a Sábado, das 08h às 18h</p>
                <p style="font-size: 0.82rem; color: #6E6359; margin-top: 0.4rem;">
                    Aguarde o status mudar para "Pronto para Retirada" antes de comparecer.
                </p>
            `;
        }
    }
}

function copiarChavePixTracking() {
    const key = document.getElementById('pixKeyTracking')?.innerText || '79988125726';
    const btn = document.getElementById('btnCopyPixTracking');
    if (typeof PixUtil !== 'undefined') {
        PixUtil.copiarParaClipboard(key, btn, 'Copiado!');
    } else {
        navigator.clipboard.writeText(key);
    }
}

function copiarPixPayloadTracking() {
    const code = document.getElementById('pixTrackingPayload')?.value || '';
    const btn = document.getElementById('btnCopyPixPayloadTracking');
    if (typeof PixUtil !== 'undefined') {
        PixUtil.copiarParaClipboard(code, btn, 'Código Copiado!');
    } else {
        navigator.clipboard.writeText(code);
    }
}

// Inicializa a aplicação ao carregar
document.addEventListener('DOMContentLoaded', () => {
    new PedidoTrackingApp();
});

