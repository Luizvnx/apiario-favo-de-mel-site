# Diretrizes de Design & Regras Estritas do Projeto
**Apiário Favo de Mel**

> Este arquivo deve ser consultado e seguido rigorosamente antes de qualquer alteração de código ou interface.

---

## 1. Regra Absoluta: ZERO EMOJIS
- **É estritamente proibido o uso de emojis** em qualquer parte do projeto (código HTML, CSS, arquivos JavaScript, templates dinâmicos, textos de botões, modais ou mensagens de status).
- **Substitutos Permitidos**: Utilize exclusivamente ícones SVG inline dos repositórios oficiais aprovados:
  - **Feather Icons**: [feathericons/feather](https://github.com/feathericons/feather) (stroke elegante, traço limpo 2px).
  - **Bootstrap Icons**: [twbs/icons](https://github.com/twbs/icons).
  - **Simple Icons**: [simpleicons.org](https://simpleicons.org/) (marcas oficiais como PIX, WhatsApp, Instagram).
  - **Nerd Fonts**.

---

## 2. Regra Anti-Padrão de IA: PROIBIDO "Pills" / Retângulos Clichês
- **O que NÃO fazer**:
  - Criar retângulos ou pílulas arredondadas com fundo de cor clara, texto da mesma cor mais escuro e borda de cor intermediária (ex: fundo `#F0FDF4`, borda `#BBF7D0`, texto `#166534` para "Aberto para Pedidos" ou "Nossos Serviços").
  - Esse padrão deixa o design com aspecto genérico e cara de template gerado por IA.
- **O que fazer**:
  - Utilizar tipografia refinada, elegante e artesanal.
  - Indicadores discretos: pequenos pontos circulares (`6px`) acompanhados de texto elegante em cor neutra (`var(--color-text-muted)` ou `var(--color-text)`).
  - Bordas sutis em tons terrosos/neutros (`#E8DFD3`), sem contrastes artificiais de saturação.

---

## 3. Tipografia & Identidade Visual
- O Apiário Favo de Mel possui uma identidade artesanal, nobre e autêntica.
- **Títulos & Seções Nobres**: `'Lora', Georgia, serif` (`--font-heading`).
- **Textos, Botões, Categorias & UI**: `'Inter', -apple-system, sans-serif` (`--font-body`).
- As abas e filtros de categorias devem ter tipografia limpa (`font-size: 0.82rem`, `font-weight: 500` a `600`, `letter-spacing: 0.01em`), sem elementos caricatos ou fontes desproporcionais.

---

## 4. Ícones Vetoriais Oficiais & Proporções
- Ícones de marcas e pagamentos (ex: **PIX**, **WhatsApp**, **Cartão**) devem usar o SVG oficial (ex: Simple Icons), sempre com `viewBox` correto, sem distorção, sem esticar e com dimensões balanceadas (`width: 18px` a `22px`).
- Alinhamento vertical perfeito com textos via `display: inline-flex; align-items: center;`.
