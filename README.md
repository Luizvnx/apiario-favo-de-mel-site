# Apiário Favo de Mel - Website Oficial & Catálogo Digital

Repositório exclusivo do site institucional e catálogo de produtos do **Apiário Favo de Mel**, desenvolvido em HTML5, CSS3 e JavaScript puro (Vanilla), sem dependência de WordPress ou frameworks pesados.

---

## 🚀 Deploy Automático na Hostinger

Este repositório foi estruturado especialmente para a raiz da hospedagem (`public_html`) da Hostinger com deploy automático via Git.

### Estrutura de Pastas:
```text
apiario-favo-de-mel-site/
├── index.html         # Página inicial institucional
├── catalogo.html      # Vitrine de produtos & checkout Trem Delivery
├── .htaccess          # Regras de rota limpa e compressão Apache
├── css/
│   ├── style.css      # Estilos gerais institucionais
│   └── catalogo.css   # Estilos do catálogo e carrinho
├── js/
│   ├── main.js        # Scripts institucionais
│   └── catalogo.js    # Lógica do carrinho, filtros e API
└── assets/
    ├── images/        # Fotos institucionais
    └── products/      # Fotos reais dos produtos
```

---

## ⚙️ Conexão com o Backend / Bot (Railway / VPS)

No arquivo `catalogo.html`, se desejar conectar com a API do seu bot/CRM hospedado em outro servidor, basta configurar a URL da API:
```html
<script>
  window.FAVODEMEL_API_URL = 'https://seu-bot.up.railway.app';
</script>
```

---

## 📞 Suporte
Apiário Favo de Mel • Sergipe, Brasil.