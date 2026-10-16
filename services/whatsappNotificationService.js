/**
 * Apiário Favo de Mel - Serviço de Notificações WhatsApp (Estilo Trem Delivery)
 * Integração com Evolution API & Fallback Click-to-Chat
 */

class WhatsAppNotificationService {
    constructor() {
        this.baseUrl = (process.env.EVOLUTION_URL || 'http://137.131.164.202:8081').replace(/\/$/, '');
        this.instance = (process.env.EVOLUTION_INSTANCE || 'FavoDeMel').trim();
        this.apiKey = (process.env.EVOLUTION_API_KEY || '429683C4C977415CAAFCCE10F7D57E11').trim();
        this.storePhone = (process.env.NUMERO_DA_LOJA || '557988125726').replace(/\D/g, '');
    }

    /**
     * Formata o telefone para o padrão internacional (ex: 5579999999999)
     */
    formatPhone(phone) {
        if (!phone) return '';
        let clean = String(phone).replace(/\D/g, '');
        if (clean.startsWith('0')) {
            clean = clean.substring(1);
        }
        if (clean.length === 10 || clean.length === 11) {
            clean = `55${clean}`;
        }
        return clean;
    }

    /**
     * Envia mensagem direta via Evolution API
     */
    async sendEvolutionMessage(phone, text) {
        const formattedPhone = this.formatPhone(phone);
        if (!formattedPhone) {
            console.warn('[WhatsApp] Telefone de destino inválido ou vazio.');
            return { sucesso: false, erro: 'Telefone inválido' };
        }

        const targetUrl = `${this.baseUrl}/message/sendText/${this.instance}`;

        try {
            console.log(`[WhatsApp Evolution] Enviando mensagem para ${formattedPhone}...`);
            const response = await fetch(targetUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': this.apiKey
                },
                body: JSON.stringify({
                    number: formattedPhone,
                    text: text
                })
            });

            const data = await response.json();

            if (!response.ok) {
                console.warn(`[WhatsApp Evolution] Resposta de erro (${response.status}):`, data);
                return { sucesso: false, erro: data?.message || response.statusText, data };
            }

            console.log(`[WhatsApp Evolution] ✓ Mensagem enviada com sucesso para ${formattedPhone}!`);
            return { sucesso: true, messageId: data?.key?.id, data };
        } catch (err) {
            console.warn('[WhatsApp Evolution] Falha de conexão ou rede:', err.message);
            return { sucesso: false, erro: err.message };
        }
    }

    /**
     * Monta o link do rastreador do pedido
     */
    buildTrackingUrl(order, originUrl) {
        let base = originUrl || 'http://localhost:3300';
        base = base.replace(/\/$/, '');
        const codigo = encodeURIComponent(order.codigo_pedido || order.id || '');
        const token = order.token_acesso ? `&token=${encodeURIComponent(order.token_acesso)}` : '';
        return `${base}/pedido.html?codigo=${codigo}${token}`;
    }

    /**
     * Formata os itens do pedido em texto amigável
     */
    formatItemsList(itens) {
        if (!itens || !Array.isArray(itens) || itens.length === 0) {
            return '• Nenhum item especificado';
        }

        return itens.map(item => {
            const qtd = item.quantidade || 1;
            const nome = item.nome || item.name || 'Produto Favo de Mel';
            const unit = parseFloat(item.preco || item.price || 0).toFixed(2).replace('.', ',');
            const sub = (qtd * parseFloat(item.preco || item.price || 0)).toFixed(2).replace('.', ',');
            const obs = item.obs ? ` _(Obs: ${item.obs})_` : '';
            return `• *${qtd}x* ${nome}${obs} (R$ ${unit} un) = R$ ${sub}`;
        }).join('\n');
    }

    /**
     * 1. Notificação Imediata para o WhatsApp do Vendedor/Loja (Novo Pedido)
     */
    async notifyStoreNewOrder(order, originUrl) {
        const end = order.endereco || {};
        const compStr = end.complemento ? ` [${end.complemento}]` : '';
        const cepStr = end.cep ? ` (CEP: ${end.cep})` : '';
        
        let txtEnd = order.tipo_entrega === 'entrega'
            ? `${end.rua || 'Rua não informada'}, ${end.numero || 'S/N'} - ${end.bairro || ''}, ${end.cidade || ''}${compStr}${cepStr}`
            : `Retirada Direta no Apiário`;

        const totalStr = parseFloat(order.total || 0).toFixed(2).replace('.', ',');
        const subtotalStr = parseFloat(order.subtotal || order.total || 0).toFixed(2).replace('.', ',');
        const taxaStr = parseFloat(order.taxa_entrega || 0).toFixed(2).replace('.', ',');
        
        let txtPag = order.forma_pagamento === 'pix' 
            ? 'PIX' 
            : (order.forma_pagamento === 'cartao' ? 'Cartão' : `Dinheiro (Troco para: ${order.troco_para || 'Não informado'})`);

        const itensFormatados = this.formatItemsList(order.itens);
        const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
        const painelUrl = `${(originUrl || 'http://localhost:3300').replace(/\/$/, '')}/admin.html`;
        const rastreioUrl = this.buildTrackingUrl(order, originUrl);

        const mensagem = 
`🔔 *NOVO PEDIDO RECEBIDO - APIÁRIO FAVO DE MEL!*
*Pedido:* #${order.codigo_pedido}
*Data/Hora:* ${agora}

👤 *Cliente:* ${order.cliente_nome || 'Cliente'}
📱 *WhatsApp:* ${order.cliente_telefone || 'Não informado'}

📍 *Modalidade / Endereço:*
${txtEnd}

💳 *Forma de Pagamento:* ${txtPag}

🛒 *Itens do Pedido:*
${itensFormatados}

💵 *Subtotal:* R$ ${subtotalStr}
🛵 *Taxa de Entrega:* ${parseFloat(order.taxa_entrega) > 0 ? `R$ ${taxaStr}` : 'A combinar'}
💰 *TOTAL:* R$ ${totalStr}

📝 *Observações:* ${order.observacoes?.trim() || 'Nenhuma'}

🔍 *Link de Rastreio do Cliente:*
${rastreioUrl}

⚙️ *Painel de Gestão:*
${painelUrl}`;

        return await this.sendEvolutionMessage(this.storePhone, mensagem);
    }

    /**
     * 2. Notificação Imediata para o Cliente (Pedido Recebido com Código de Rastreio)
     */
    async notifyCustomerNewOrder(order, originUrl) {
        if (!order.cliente_telefone) return { sucesso: false, erro: 'Telefone do cliente não informado' };

        const itensFormatados = this.formatItemsList(order.itens);
        const totalStr = parseFloat(order.total || 0).toFixed(2).replace('.', ',');
        const rastreioUrl = this.buildTrackingUrl(order, originUrl);

        let txtPag = order.forma_pagamento === 'pix' 
            ? 'PIX' 
            : (order.forma_pagamento === 'cartao' ? 'Cartão' : 'Dinheiro');

        const mensagem = 
`🍯 *Olá, ${order.cliente_nome || 'Cliente'}!*
Seu pedido foi recebido com sucesso no *Apiário Favo de Mel*! 🐝✨

*Pedido:* #${order.codigo_pedido}
*Itens:*
${itensFormatados}

*Total:* R$ ${totalStr}
*Pagamento:* ${txtPag}

Nossa equipe já foi notificada e está revisando os detalhes. Você será avisado por aqui a cada atualização!

🔍 *Acompanhe seu pedido em tempo real pelo link exclusivo:*
${rastreioUrl}

Se tiver dúvidas, basta nos responder nesta conversa. Agradecemos pela preferência! 💛`;

        return await this.sendEvolutionMessage(order.cliente_telefone, mensagem);
    }

    /**
     * 3. Notificação de Atualização de Status (Preparando, Enviado, Entregue, Cancelado)
     */
    async notifyCustomerStatusUpdate(order, newStatus, originUrl) {
        if (!order || !order.cliente_telefone) {
            return { sucesso: false, erro: 'Telefone do cliente não informado' };
        }

        const nome = order.cliente_nome || 'Cliente';
        const codigo = order.codigo_pedido;
        const rastreioUrl = this.buildTrackingUrl(order, originUrl);

        let mensagem = '';

        switch (newStatus) {
            case 'preparando':
            case 'em_preparo':
                mensagem = 
`🍯 *Olá, ${nome}!*
Boas notícias: seu pedido *#${codigo}* no *Apiário Favo de Mel* começou a ser *preparado*! 📦🐝

Estamos embalando seus produtos artesanais com todo o carinho e cuidado com a pureza da natureza.

🔍 *Acompanhe em tempo real:*
${rastreioUrl}`;
                break;

            case 'enviado':
            case 'saiu_para_entrega':
            case 'a_caminho':
                mensagem = 
`🛵 *Olá, ${nome}!*
Seu pedido *#${codigo}* do *Apiário Favo de Mel* acabou de sair para *entrega* e está a caminho! 🍯💨

Fique atento(a) ao seu endereço ou interfone para receber seus méis nobres.

🔍 *Acompanhe a entrega:*
${rastreioUrl}`;
                break;

            case 'entregue':
            case 'finalizado':
            case 'concluido':
                mensagem = 
`🎉 *Pedido Entregue com Sucesso!*
Olá, ${nome}! Seu pedido *#${codigo}* foi entregue.

Esperamos que aprecie muito a pureza, o aroma e a riqueza dos nossos méis e própolis do *Apiário Favo de Mel*! 🐝💛

Muito obrigado por valorizar a apicultura artesanal brasileira!`;
                break;

            case 'cancelado':
                mensagem = 
`Olá, ${nome}. Informamos que o seu pedido *#${codigo}* no *Apiário Favo de Mel* foi cancelado.

Se tiver qualquer dúvida ou desejar alterar os itens, por favor entre em contato conosco por aqui. Estamos à disposição!`;
                break;

            default:
                mensagem = 
`Olá, ${nome}! O status do seu pedido *#${codigo}* no *Apiário Favo de Mel* foi atualizado para: *${newStatus}*.

🔍 *Acompanhe em tempo real:*
${rastreioUrl}`;
                break;
        }

        return await this.sendEvolutionMessage(order.cliente_telefone, mensagem);
    }

    /**
     * Gerador de Link Direto wa.me para abertura manual pelo vendedor no Painel Admin
     */
    buildManualStatusWhatsAppUrl(order, newStatus, originUrl) {
        const phone = this.formatPhone(order.cliente_telefone);
        if (!phone) return '#';

        const nome = order.cliente_nome || 'Cliente';
        const codigo = order.codigo_pedido;
        const rastreioUrl = this.buildTrackingUrl(order, originUrl);

        let msg = '';
        if (newStatus === 'preparando') {
            msg = `Olá, ${nome}! Seu pedido #${codigo} no Apiário Favo de Mel já está sendo preparado com muito carinho. Acompanhe: ${rastreioUrl}`;
        } else if (newStatus === 'enviado') {
            msg = `Olá, ${nome}! Seu pedido #${codigo} do Apiário Favo de Mel acabou de sair para entrega e está a caminho! Acompanhe: ${rastreioUrl}`;
        } else if (newStatus === 'entregue') {
            msg = `Olá, ${nome}! Seu pedido #${codigo} foi entregue com sucesso. Esperamos que aprecie a pureza dos nossos produtos do Apiário Favo de Mel!`;
        } else {
            msg = `Olá, ${nome}! Informações sobre seu pedido #${codigo} no Apiário Favo de Mel. Acompanhe em tempo real: ${rastreioUrl}`;
        }

        return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
    }
}

module.exports = new WhatsAppNotificationService();
