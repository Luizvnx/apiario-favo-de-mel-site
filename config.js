/**
 * Apiário Favo de Mel - Configuração Global de API
 * Para hospedagem estática (Hostinger), aponte FAVODEMEL_API_URL para a URL pública do seu backend/VPS.
 * Se vazio (""), utiliza a mesma origem da página (modo integrado).
 */
window.FAVODEMEL_API_URL = window.FAVODEMEL_API_URL || "https://favodemel.137.131.164.202.sslip.io";
console.log("[Config] Apiário Favo de Mel inicializado. API:", window.FAVODEMEL_API_URL || "Mesma Origem");
