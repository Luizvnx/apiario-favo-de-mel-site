/**
 * Apiário Favo de Mel - Configuração Global de API
 * Para hospedagem estática (Hostinger), aponte FAVODEMEL_API_URL para a URL pública do seu backend/VPS.
 * Se vazio (""), utiliza a mesma origem da página (modo integrado).
 */
window.FAVODEMEL_API_URL = window.FAVODEMEL_API_URL || "https://favodemel.137.131.164.202.sslip.io";

// Bases candidatas da API, compartilhadas entre catálogo e painel admin.
// A ordem é: URL configurada → mesma origem → VPS de produção.
window.getFavodemelApiBases = function () {
    const bases = [];
    const add = (valor) => {
        const base = String(valor || '').trim().replace(/\/+$/, '');
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

console.log("[Config] Apiário Favo de Mel inicializado. API:", window.FAVODEMEL_API_URL || "Mesma Origem");
