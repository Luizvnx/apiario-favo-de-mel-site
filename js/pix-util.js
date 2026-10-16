/**
 * Apiário Favo de Mel - Utilitário Oficial de PIX e BR Code (EMV)
 * Padrão Banco Central do Brasil (BCB)
 * Gera Chave PIX, Payload Copia e Cola e QR Code
 */

const PixUtil = {
    /**
     * Calcula o CRC16-CCITT (0x1021) padrão Banco Central
     */
    calcularCRC16(str) {
        let crc = 0xFFFF;
        for (let c = 0; c < str.length; c++) {
            crc ^= str.charCodeAt(c) << 8;
            for (let i = 0; i < 8; i++) {
                if ((crc & 0x8000) !== 0) {
                    crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
                } else {
                    crc = (crc << 1) & 0xFFFF;
                }
            }
        }
        return crc.toString(16).toUpperCase().padStart(4, '0');
    },

    /**
     * Formata um campo no padrão TLV (Tag-Length-Value)
     */
    tlv(id, valor) {
        const strVal = String(valor || '');
        const len = String(strVal.length).padStart(2, '0');
        return `${id}${len}${strVal}`;
    },

    /**
     * Normaliza a chave Pix dependendo do tipo
     */
    normalizarChave(chave, tipo) {
        if (!chave) return '';
        const apenasDigitos = chave.replace(/\D/g, '');
        
        if (tipo === 'telefone') {
            if (apenasDigitos.startsWith('55')) {
                return `+${apenasDigitos}`;
            }
            return `+55${apenasDigitos}`;
        }
        if (tipo === 'cpf' || tipo === 'cnpj') {
            return apenasDigitos;
        }
        return chave.trim();
    },

    /**
     * Gera o código PIX Copia e Cola oficial (BR Code EMV)
     * @param {Object} params
     * @param {string} params.chave - Chave Pix
     * @param {string} [params.tipo='telefone'] - Tipo de chave (telefone, cpf, cnpj, email, aleatoria)
     * @param {string} [params.nome='Apiario Favo de Mel'] - Nome do beneficiário (máx 25)
     * @param {string} [params.cidade='Aracaju'] - Cidade do beneficiário (máx 15)
     * @param {number|string} [params.valor] - Valor da cobrança (ex: 85.50)
     * @param {string} [params.txid='***'] - Identificador da transação (máx 25 chars alfanuméricos)
     * @returns {string} Código PIX Copia e Cola
     */
    gerarCopiaECola({ chave, tipo = 'telefone', nome = 'Apiario Favo de Mel', cidade = 'Aracaju', valor = 0, txid = '***' }) {
        const chaveNormalizada = this.normalizarChave(chave, tipo);
        
        // Remove acentos e caracteres especiais para compatibilidade com o padrão EMV
        const nomeClean = (nome || 'Apiario Favo de Mel')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-zA-Z0-9 ]/g, '')
            .trim()
            .slice(0, 25);

        const cidadeClean = (cidade || 'Aracaju')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-zA-Z0-9 ]/g, '')
            .trim()
            .slice(0, 15);

        const txidClean = (txid || '***')
            .replace(/[^a-zA-Z0-9]/g, '')
            .slice(0, 25) || '***';

        // 00 - Payload Format Indicator
        const f00 = this.tlv('00', '01');

        // 26 - Merchant Account Information (GUI + Chave)
        const gui = this.tlv('00', 'br.gov.bcb.pix');
        const keyField = this.tlv('01', chaveNormalizada);
        const f26 = this.tlv('26', gui + keyField);

        // 52 - Merchant Category Code
        const f52 = this.tlv('52', '0000');

        // 53 - Transaction Currency (986 = Real brasileiro BRL)
        const f53 = this.tlv('53', '986');

        // 54 - Transaction Amount (se houver valor)
        let f54 = '';
        const numValor = parseFloat(valor);
        if (!isNaN(numValor) && numValor > 0) {
            f54 = this.tlv('54', numValor.toFixed(2));
        }

        // 58 - Country Code (BR)
        const f58 = this.tlv('58', 'BR');

        // 59 - Merchant Name
        const f59 = this.tlv('59', nomeClean);

        // 60 - Merchant City
        const f60 = this.tlv('60', cidadeClean);

        // 62 - Additional Data Field Template (TXID)
        const subTxid = this.tlv('05', txidClean);
        const f62 = this.tlv('62', subTxid);

        // Monta carga sem o CRC
        const payloadSemCrc = f00 + f26 + f52 + f53 + f54 + f58 + f59 + f60 + f62 + '6304';

        // Calcula CRC16
        const crc = this.calcularCRC16(payloadSemCrc);

        return payloadSemCrc + crc;
    },

    /**
     * Gera URL de QR Code para o payload informado
     */
    gerarQrCodeUrl(payload, tamanho = 240) {
        return `https://api.qrserver.com/v1/create-qr-code/?size=${tamanho}x${tamanho}&data=${encodeURIComponent(payload)}&margin=1`;
    },

    /**
     * Copia texto para o clipboard com feedback visual elegante
     */
    async copiarParaClipboard(texto, botaoElement, textoSucesso = 'Copiado!') {
        try {
            await navigator.clipboard.writeText(texto);
            if (botaoElement) {
                const htmlAntigo = botaoElement.innerHTML;
                botaoElement.classList.add('copied');
                botaoElement.innerHTML = `
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 4px;"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    <span>${textoSucesso}</span>
                `;
                setTimeout(() => {
                    botaoElement.classList.remove('copied');
                    botaoElement.innerHTML = htmlAntigo;
                }, 2200);
            }
            return true;
        } catch (err) {
            console.error('Falha ao copiar:', err);
            // Fallback manual
            const inputTemp = document.createElement('textarea');
            inputTemp.value = texto;
            document.body.appendChild(inputTemp);
            inputTemp.select();
            document.execCommand('copy');
            document.body.removeChild(inputTemp);
            if (botaoElement) {
                botaoElement.innerText = textoSucesso;
                setTimeout(() => { botaoElement.innerText = 'Copiar'; }, 2000);
            }
            return true;
        }
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = PixUtil;
}
