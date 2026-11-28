# Casa das Amêndoas

## Estado em 28/11/2026

O cliente está validando a primeira miniversão em HML. A rodada cobre o pedido offline, a fila comum, o estoque por lote, o despacho, a entrega e a devolução. O aceite no aparelho e os resultados por cenário ainda estão pendentes.

| Acompanhar | Issues |
| --- | --- |
| Decisões e próximas miniversões | [Mapa do Essentials](https://github.com/ismaelsouza/amendoas-adm/issues/1) |
| Painel e API | [Especificação e subtarefas do ADM](https://github.com/ismaelsouza/amendoas-adm/issues/12) |
| PWA e APK | [Especificação e subtarefas do App](https://github.com/ismaelsouza/amendoas-app/issues/1) |
| CI/CD | [Fluxo de publicação](https://github.com/ismaelsouza/amendoas-adm/issues/11) |

Os novos repositórios concentram as Issues e o histórico de decisões. `awaiting-homologation` identifica as entregas publicadas que aguardam aceite. Registre resultados nas Issues correspondentes, usando dados fictícios. Em paralelo, o trabalho novo segue em `feature/*` e `develop`, com deploy automático em DSV. A primeira promoção automatizada para HML passa por `release` após o aceite funcional em DSV.

<details>
<summary>Registro histórico de 24/11/2026</summary>

As seções abaixo registram a etapa de especificação. Para decisões atualizadas e próximas ações, consulte as Issues acima.

## Objetivo e repositórios

O cliente quer acompanhar cada pedido desde a venda até a entrega. O app de campo registra pedidos em Android e iOS, inclusive sem internet. O administrativo centraliza a fila dos vendedores e do balcão, o acompanhamento de entregas, os usuários, o estoque e as consultas financeiras do piloto.

- [amendoas-adm](https://github.com/ismaelsouza/amendoas-adm) guarda o administrativo e a API.
- [amendoas-app](https://github.com/ismaelsouza/amendoas-app) guarda o app do vendedor. O [mapa de decisões](https://github.com/prpaulocesarneves-crypto/amendoas--adm/issues/1) e as discussões anteriores continuam nos repositórios de origem.
- ReactJS para a interface e MySQL ou MariaDB para a base central foram sugeridos. A tecnologia do app, a escolha do banco e a tecnologia, localização e contrato da API compartilhada estão em aberto. A API deverá receber pedidos sincronizados e aplicar as regras comuns aos canais.

## Regras confirmadas

| Assunto | Regra em vigor para o piloto | Evidência |
| --- | --- | --- |
| Pedidos e fila | O vendedor registra pedidos mesmo com estoque zerado ou insuficiente e consulta apenas as próprias vendas. O app salva pedidos sem conexão e os sincroniza quando ela voltar. Pedidos dos vendedores e do balcão entram na mesma fila para usuários autorizados. O balcão registra retirada imediata quando o cliente leva a mercadoria na hora. | [Mapa #1](https://github.com/prpaulocesarneves-crypto/amendoas--adm/issues/1) · [Fila e retirada #2](https://github.com/prpaulocesarneves-crypto/amendoas--adm/issues/2#issuecomment-7130835236) |
| Estoque e reserva | A entrada do produto aumenta o saldo. A baixa ocorre na saída física, para entrega ou retirada, pela quantidade que sai e dentro do saldo disponível por item. A logística prioriza e pode liberar uma saída parcial. Os itens ficam disponíveis até a saída, inclusive após a priorização. A reserva antecipada fica para avaliação futura. | [Estoque #6, 24/11](https://github.com/prpaulocesarneves-crypto/amendoas--adm/issues/6#issuecomment-7141298985) |
| Devolução | Itens devolvidos em condições de venda entram como retorno e voltam ao saldo disponível. A operação descarta os avariados. O registro sistêmico da avaria ainda precisa de definição. A logística usa o perfil de estoque para lançar devoluções. | [Questionário](https://github.com/prpaulocesarneves-crypto/amendoas--adm/issues/1#issuecomment-7140936481) · [Perfil #9, 24/11](https://github.com/prpaulocesarneves-crypto/amendoas--adm/issues/9#issuecomment-7141103846) |
| Entregas e cancelamento | Um pedido pode ter várias entregas, com quantidades por item. O saldo fica aberto para nova entrega até ser atendido ou cancelado. A revisão ocorre na data combinada ou, se não houver data, o sistema gera um lembrete após cinco dias úteis da entrega parcial. O gerente ou administrador autoriza expressamente o cancelamento. Se já houve entrega, o pedido termina como **Finalizado com entrega parcial**. O histórico registra entregas, quantidade cancelada, motivo, data e autorização. Cancelar saldo que ainda não saiu preserva o estoque. | [Entrega parcial #3, 24/11](https://github.com/prpaulocesarneves-crypto/amendoas--adm/issues/3#issuecomment-7141935180) |
| Preço | O preço é por cliente. A administração cadastra os preços e apenas gerência e administração podem alterá-los. O vendedor informa a quantidade. O pedido offline conserva o preço que foi registrado para o cliente. A venda fracionada usa preço por kg e segue sem peso mínimo comercial. | [Questionário](https://github.com/prpaulocesarneves-crypto/amendoas--adm/issues/1#issuecomment-7140936481) · [Sincronização #7](https://github.com/prpaulocesarneves-crypto/amendoas--adm/issues/7) |
| Acesso administrativo | O sistema usa login e senha. O administrador tem acesso integral e é o único que gerencia usuários. O gerente e a equipe de estoque também podem registrar entradas, baixas na saída e devoluções. | [Permissões #9](https://github.com/prpaulocesarneves-crypto/amendoas--adm/issues/9#issuecomment-7132686942) |
| Faturamento | Cada entrega confirmada é faturada uma única vez. Por item, a base é a quantidade confirmada como recebida multiplicada pelo preço unitário do pedido. O gerente pode cobrar os faturamentos de um mesmo cliente separadamente ou agrupá-los, preservando o vínculo com cada entrega e pedido de origem. | [Faturamento #10, 24/11](https://github.com/prpaulocesarneves-crypto/amendoas--adm/issues/10#issuecomment-7142106223) |
| Comissão e boletos | A comissão varia por vendedor. No questionário, o cliente indicou que a comissão é devida após o faturamento sobre o que foi entregue. A base da comissão em caso de recusa parcial no ato da entrega ainda precisa de validação. O financeiro precisa consultar os boletos desde o primeiro dia. O prazo depende do cliente. | [Questionário](https://github.com/prpaulocesarneves-crypto/amendoas--adm/issues/1#issuecomment-7140936481) · [Comissão e recusa parcial #10](https://github.com/prpaulocesarneves-crypto/amendoas--adm/issues/10#issuecomment-7142323976) |
| Reembolso após o faturamento | Na devolução, a empresa assume a comissão já devida ao vendedor, inclusive se o pagamento ainda estiver pendente. O financeiro registra na entrega de origem o motivo da devolução e o valor devido ao cliente. O cliente recebe esse valor integral, sem desconto da comissão. | [Decisão de reembolso #10, 24/11](https://github.com/prpaulocesarneves-crypto/amendoas--adm/issues/10#issuecomment-7142424670) |
| Produção | A operação compra produtos prontos e também fabrica. O cliente indicou a validade como informação indispensável desde o início. | [Questionário](https://github.com/prpaulocesarneves-crypto/amendoas--adm/issues/1#issuecomment-7140936481) · [Produção #8](https://github.com/prpaulocesarneves-crypto/amendoas--adm/issues/8) |
| Entregas de software | O Essentials será entregue em miniversões. O responsável pelo desenvolvimento provisiona a VPS de homologação, onde as miniversões da branch `release` serão publicadas com Docker. O cliente provisiona a própria VPS de produção. Após validar em homologação, o cliente pode aprovar e publicar a mesma miniversão em produção. | [Publicação #11](https://github.com/prpaulocesarneves-crypto/amendoas--adm/issues/11#issuecomment-7132059112) |

## Contexto da operação e do levantamento

- No levantamento inicial, o cliente informou três vendedores, um local de operação e cerca de 7 a 10 vendas por dia, principalmente para supermercados. Parte dos pedidos chega por foto no WhatsApp porque o sistema atual é complexo. O vendedor de campo visita o supermercado e envia o pedido para a fábrica. A empresa usa frota própria em Belém e Ananindeua e transportadora para o interior. Também recebe encomendas por WhatsApp para retirada na fábrica.
- O cliente quer que novos pedidos apareçam para produção e logística. O entregador precisa consultar rota e agendamento. O financeiro acompanha pedidos, comissões a pagar e boletos a receber. Hoje há Pix, cartão e boleto faturado parcelado. O cliente pediu relatórios de vendas por período, vendedor e cliente, contas vencidas, estoque, entregas e margem. A seleção dos relatórios do Essentials ainda está pendente.
- A produção relatou como exemplo castanha caramelizada com gergelim e caramelo de açúcar e água. Hoje a equipe confere o saldo de produtos prontos. O cliente descreveu a contagem de caixas, embalagens, adesivos e rótulos antes da produção como necessidade futura. A preferência é começar com base nova e alimentar os dados durante a operação. A planilha de produtos e preços foi prometida.
- O cadastro solicitado contempla tipo de pessoa, cartão CNPJ, inscrição estadual, nome fantasia, contatos do cliente e do comprador, endereço, data e responsável pelo cadastro, limite de crédito e percentual de desconto. Os campos obrigatórios e o momento de cadastrar ainda precisam de validação.
- O cliente indicou participantes de balcão, estoque, logística, produção, administração e financeiro. O registro de origem tem os nomes. Falta indicar o vendedor de campo do teste e os responsáveis pela conferência de saldos e pelo aceite de ponta a ponta.
- O [questionário aplicado](to-questionnaire-casa-das-amendoas.md) cobre pedido, entrega, produção, cadastro, estoque, financeiro e validação. Em 24/11/2026, foram lidas 17 respostas de um envio, já sintetizadas no planejamento. [Síntese do questionário](https://github.com/prpaulocesarneves-crypto/amendoas--adm/issues/1#issuecomment-7140936481)

## Protótipo anterior e requisitos offline

O levantamento inicial analisou `Casa-das-Amendoas.html` e `Texto colado.txt`. O HTML demonstra catálogo pesquisável, pedido com quantidades e observações, dados do cliente, opções de entrega, histórico do vendedor e acompanhamento administrativo. O fluxo demonstrado passa por recebido, em separação, separado, em entrega e entregue, com cancelamento. O catálogo simulado tinha 56 itens, dos quais 24 sem SKU, com apresentações como 250 g e 500 g. Os dados do HTML se perdem ao recarregar. O texto trata de outra versão em React e traz propostas como PWA, Firebase, carteira de clientes, descontos, crédito, produção, comissões, notificações e auditoria. Use o material como referência de descoberta. Os originais estavam na conversa inicial.

`RF-OFF-001` cobre montar e salvar o pedido no celular sem conexão. `RF-OFF-002` cobre sincronizá-lo quando a conexão voltar. Para o desenho da sincronização, foram propostos cache de catálogo, preços e clientes, persistência após fechar o app, estado de envio, repetição sem duplicar o pedido e tratamento visível de divergências. A regra aprovada de manter o preço registrado e permitir pedido com estoque insuficiente orienta esse desenho. [Sincronização #7](https://github.com/prpaulocesarneves-crypto/amendoas--adm/issues/7)

## Pendências para retomar

| Issue | O que falta fechar |
| --- | --- |
| [#2 – Fluxo do pedido](https://github.com/prpaulocesarneves-crypto/amendoas--adm/issues/2) | Definir as etapas, quem as confirma e como registrar entrega por transportadora e retirada encomendada. |
| [#4 – Produtos, unidades e preços](https://github.com/prpaulocesarneves-crypto/amendoas--adm/issues/4) | Obter exemplos de kg, pacote e caixa, precisão de pesagem, arredondamento e regras de apresentação dos preços por cliente. |
| [#5 – Cadastros e saldos](https://github.com/prpaulocesarneves-crypto/amendoas--adm/issues/5) | Obter a planilha de produtos e preços, definir campos obrigatórios por tipo de pessoa, decidir quando cadastrar e confirmar carga inicial, saldo e responsáveis pelo aceite. |
| [#6 – Estoque](https://github.com/prpaulocesarneves-crypto/amendoas--adm/issues/6) | Definir como registrar quantidade avariada e descarte. |
| [#7 – Pedido offline](https://github.com/prpaulocesarneves-crypto/amendoas--adm/issues/7) | Fechar falhas, novas tentativas, prevenção de duplicidade, conflitos de cadastro e eventual fluxo de revisão. |
| [#8 – Produção](https://github.com/prpaulocesarneves-crypto/amendoas--adm/issues/8) | Definir onde registrar validade, como distinguir validades do mesmo produto, e o mínimo de lote, insumos e rendimento. |
| [#9 – Acessos, filas e avisos](https://github.com/prpaulocesarneves-crypto/amendoas--adm/issues/9) | Completar a matriz de acesso, confirmadores por etapa e destinatários dos avisos. |
| [#10 – Financeiro](https://github.com/prpaulocesarneves-crypto/amendoas--adm/issues/10) | Validar a base da comissão nas recusas parciais no ato da entrega. Fechar consulta ou emissão de boletos, exemplos de prazo e parcelamento, forma de efetivar o reembolso e relatórios mínimos. |
| [#11 – Publicação](https://github.com/prpaulocesarneves-crypto/amendoas--adm/issues/11) | Na implementação, conferir o provisionamento das VPS e definir os procedimentos de publicação e validação das miniversões. |

O próximo ponto é validar com a assessoria trabalhista em que momento a empresa aceita o pedido e qual quantidade conta para a comissão dos três vendedores empregados quando o cliente recusa parte da mercadoria no ato da entrega. A quantidade recebida é a base do faturamento. [Comissão e recusa parcial #10](https://github.com/prpaulocesarneves-crypto/amendoas--adm/issues/10#issuecomment-7142323976)

## Como continuar de outra máquina ou conta

Abra um clone atualizado do `amendoas--adm` com uma conta GitHub que tenha acesso. Comece pelo `AGENTS.md` e por este arquivo. Para trabalhar no aplicativo, abra também o `amendoas-app`. Em outra conta do ChatGPT ou do Codex, aponte o agente para o clone ou conecte uma conta GitHub autorizada e peça que leia esses dois arquivos. O mapa no GitHub contém as discussões e pendências vinculadas.

O [AGENTS.md](AGENTS.md) descreve como manter as decisões e pendências atualizadas a cada sessão.

### Histórico de alterações das regras

- **24/11/2026.** O responsável pelo projeto confirmou que a empresa assume a comissão nas devoluções após o faturamento. Essa decisão encerra a proposta de estornar a comissão já devida. O financeiro registra o motivo da devolução e o valor devido ao cliente, que recebe o reembolso sem dedução da comissão. [Confirmação no financeiro #10](https://github.com/prpaulocesarneves-crypto/amendoas--adm/issues/10#issuecomment-7142424670)
- **24/11/2026.** Consolidação inicial das decisões, do questionário e das pendências dos dois canais. A escolha de manter os itens disponíveis até a saída encerrou a discussão sobre reserva antecipada para o piloto. A regra aprovada de manter o preço registrado resolveu a possibilidade de substituição automática do preço na sincronização. [Estoque #6](https://github.com/prpaulocesarneves-crypto/amendoas--adm/issues/6#issuecomment-7141298985) · [Questionário](https://github.com/prpaulocesarneves-crypto/amendoas--adm/issues/1#issuecomment-7140936481)

</details>
