# Essentials da Casa das Amêndoas

Vocabulário da venda ao supermercado, do controle de mercadoria e da entrega. Vale para o administrativo e para o [app do vendedor](https://github.com/ismaelsouza/amendoas-app/blob/develop/GLOSSARY.md).

## Linguagem

### Venda e pedidos

**Cliente**:
Supermercado que compra a mercadoria. Seu cadastro é distinto da conta de quem opera o Essentials.

**Conferência cadastral**:
Revisão, pelo administrador, do cadastro criado pelo vendedor. É independente da conferência de preços e do envio do primeiro pedido.

**Rascunho**:
Registro editável de uma venda em preparação, salvo no aparelho. Pode conter itens anotados antes de identificar o cadastro do cliente.

**Fechamento da venda**:
Aceite comercial do cliente, com data, apresentação, quantidade e preço combinado por item.
_Evite_: Confirmação de entrega, confirmação do ADM.

**Aguardando confirmação**:
Estado do pedido fechado e salvo no aparelho cujo número o vendedor ainda não recebeu. O administrativo pode já ter registrado o pedido.
_Evite_: Rascunho, pedido recusado.

**Pedido confirmado**:
Pedido que já tem número atribuído pelo administrativo. O número identifica a mesma venda na fila e no acompanhamento de todas as suas remessas.
_Evite_: Pedido entregue.

**Fila de pedidos**:
Lista comum de pedidos registrados pelo app do vendedor (origem Campo) e pelo atendimento presencial (origem Balcão).

**Correção de pedido**:
Alteração autorizada dos dados vigentes do mesmo pedido antes da primeira saída física, com motivo e histórico. Um acréscimo depois da saída parcial é uma nova venda.

**Cancelamento de saldo**:
Encerramento autorizado da quantidade que o cliente dispensou e ainda aguarda despacho.
_Evite_: Devolução, baixa de estoque.

### Catálogo, preços e estoque

**Produto**:
Mercadoria que pode ser vendida em mais de uma apresentação, como castanha vendida a granel e em pacote de 250 g.

**Apresentação**:
Forma em que o produto é vendido e tem saldo próprio, como granel, pacote de 250 g ou caixa. Granel é medido em kg com precisão de 1 g; pacotes e caixas são contados em unidades inteiras.
_Evite_: Produto, lote.

**Preço padrão**:
Preço da apresentação quando o cliente não tem um preço negociado para ela.

**Preço negociado**:
Preço específico de uma apresentação para determinado cliente. Prevalece sobre o padrão enquanto estiver vigente.

**Preço combinado**:
Preço unitário aceito no fechamento da venda. Permanece no pedido mesmo que a tabela mude entre o fechamento e a sincronização.

**Lote**:
Grupo rastreável de mercadoria identificado pelo código da etiqueta. Lotes da mesma apresentação podem ter a mesma validade.
_Evite_: Vencimento.

**Validade**:
Última data, indicada na etiqueta, em que a mercadoria pode sair. No dia seguinte, ela continua no saldo físico até o descarte, fora do saldo disponível.

**Entrada de estoque**:
Registro de mercadoria recebida, com apresentação e quantidades por lote e validade.

**Saldo físico**:
Quantidade presente no estoque, incluindo a mercadoria vencida ainda não descartada.

**Saldo disponível**:
Quantidade em estoque apta para despacho de uma apresentação. O pedido e a prioridade de despacho não reservam mercadoria.
_Evite_: Saldo pendente do pedido, saldo reservado.

**Falta para despacho**:
Quantidade pela qual a demanda que ainda aguarda despacho supera o saldo disponível da apresentação.

### Saída, entrega e retorno

**Saída física**:
Confirmação da mercadoria que efetivamente deixou o estoque, por lote, para entrega ou retirada. É o momento da baixa.
_Evite_: Separação, reserva, recebimento.

**Remessa**:
Conjunto de itens e lotes que saíram de uma vez para atender a um pedido. Um pedido pode gerar várias remessas.
_Evite_: Pedido, entrega confirmada.

**Retirada imediata**:
Modalidade de balcão em que o cliente leva a mercadoria na hora. A saída e o recebimento registram fatos distintos, mesmo ocorrendo no balcão.

**Confirmação de recebimento**:
Conferência, por remessa e apresentação, das quantidades que o cliente recebeu ou recusou. Não repete a baixa de estoque da saída.
_Evite_: Confirmação do pedido.

**Pendente de despacho**:
Quantidade do pedido que ainda pode sair para atender ao cliente, incluindo reposição solicitada após recusa e descontando os cancelamentos.

**Pendente de recebimento**:
Quantidade pedida que o cliente ainda não aceitou e não dispensou por cancelamento. Pode incluir mercadoria em trânsito.
_Evite_: Pendente de despacho como sinônimo.

**Entrega parcial**:
Situação do pedido em que o cliente recebeu parte da quantidade acordada e ainda há quantidade a receber. Se o cancelamento autorizado encerra o restante, o pedido fica **Finalizado com entrega parcial**.

**Recusa**:
Quantidade da remessa que o cliente não aceitou, com o motivo informado na conferência. A mercadoria pode ainda estar fora do estoque.
_Evite_: Devolução física.

**Devolução**:
Retorno físico conferido e vinculado à entrega de origem, após recusa ou aceite anterior. Somente a quantidade apta e dentro da validade volta ao saldo disponível.

**Descarte**:
Destino da mercadoria inapta para venda. Pode constar na conferência de uma devolução ou na baixa física de itens vencidos em estoque.

### Termos das miniversões seguintes

**Conversão de granel**:
Registro do granel retirado para formar pacotes prontos, com origem por lote, validade dos pacotes e eventual perda.

**Perda no empacotamento**:
Peso descartado durante a conversão, com motivo. Está incluído no total retirado do granel.

**Limite de reposição**:
Quantidade de referência aprovada pelo gerente para sinalizar estoque baixo de um produto.

**Faturamento de entrega**:
Valor apurado uma vez por entrega confirmada, pelas quantidades recebidas e pelos preços do pedido.
_Evite_: Valor integral do pedido, parcela, boleto.

**Comissão**:
Valor devido ao vendedor pelo percentual sobre a venda aceita, mesmo se o cliente recusar parte da remessa no recebimento.

**Cobrança agrupada**:
Cobrança de um mesmo cliente que reúne faturamentos elegíveis e preserva a origem de cada entrega.

**Parcela**:
Valor a pagar com vencimento próprio em uma cobrança. O boleto bancário é emitido fora do Essentials e registrado na parcela.

**Abatimento**:
Redução do valor a cobrar vinculada a uma devolução ainda passível de ajuste na cobrança.
_Evite_: Reembolso.

**Reembolso**:
Valor a pagar ao cliente pela devolução, como quando o boleto já foi pago pelo valor original.

**Troca**:
Reposição do mesmo produto após o faturamento, vinculada à entrega original e acompanhada do recolhimento das unidades que o cliente apresentar. Não gera nova cobrança ou reembolso pelas unidades trocadas.
_Evite_: Reposição de itens recusados na entrega.
