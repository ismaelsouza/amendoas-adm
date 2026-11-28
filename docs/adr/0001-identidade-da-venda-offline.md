# Manter a identidade da venda até confirmar o número do pedido

Quando a rede cai depois do envio, o app não sabe se o administrativo gravou a venda. Reenviar com uma nova identidade pode duplicar a venda; tentar deduplicar pelo conteúdo pode descartar uma segunda venda legítima. O app mantém a identidade e os dados originais de cada venda fechada, e o administrativo devolve o número já atribuído quando a mesma venda volta a chegar.

Decisão confirmada em 25/11/2026 no [fluxo de pedido offline](https://github.com/ismaelsouza/amendoas-adm/issues/7), com critérios nas entregas [App #2](https://github.com/ismaelsouza/amendoas-app/issues/2) e [ADM #13](https://github.com/ismaelsouza/amendoas-adm/issues/13).
