# Casa das Amêndoas · Administrativo

O administrativo do Essentials reúne pedidos do app e do balcão, registra movimentações por lote e acompanha entregas e devoluções por remessa. A API também autentica usuários, gerencia perfis e permite ao vendedor consultar os próprios pedidos.

Consulte o [estado do Essentials](ESSENTIALS.md) e o [mapa de decisões](https://github.com/ismaelsouza/amendoas-adm/issues/1). O [app do vendedor](https://github.com/ismaelsouza/amendoas-app) fica em outro repositório.

## Executar o piloto local

Pré-requisitos: Node.js 24 e uma instância MariaDB 11.4. Crie dois bancos vazios chamados `amendoas_piloto` e `amendoas_test` e configure o acesso de cada um. Copie [`.env.example`](.env.example) para `.env` e preencha as senhas somente no arquivo local. Use `SECURE_COOKIE=false` para testar em HTTP pelo endereço local. Para uma implantação com HTTPS, mantenha o padrão `true`.

```sh
npm ci
npm run build
npm run db:init
npm run db:pilot
npm start
```

Abra `http://localhost:3000`. Entre com `admin.piloto` e a senha que você definiu em `PILOT_PASSWORD`. A carga fictícia inclui `vendedor.piloto`, `estoque.piloto` e `balcao.piloto`, o Supermercado Ipê e duas apresentações de castanha. O piloto começa sem movimentações de estoque.

`npm test` usa exclusivamente `TEST_DATABASE_URL`, valida o nome `amendoas_test`, aplica o esquema e grava pedidos e contas fictícios. Execute `npm run build` antes dos testes.

O Dockerfile empacota a interface e a API. Após criar o banco, execute `docker build -t amendoas-adm .`. Use a mesma rede privada do MariaDB ao executar a imagem e passe a configuração por variáveis de ambiente. Execute `node dist/server/db/init.js` na imagem antes de iniciar o serviço. A carga fictícia pode ser executada com `node dist/server/db/pilot.js` no banco do piloto. A configuração da VPS e a publicação pela branch `release` seguem o fluxo aprovado. [ADM #11](https://github.com/prpaulocesarneves-crypto/amendoas--adm/issues/11)

Ao atualizar uma base que já recebe pedidos, execute `db:init` antes de iniciar a nova imagem. Use uma conta de manutenção autorizada a criar tabelas. O esquema acrescenta as tabelas de estoque, entregas, devoluções, correções, CNPJ e preços negociados sem regravar pedidos, usuários ou cadastros. A conta da aplicação em execução não precisa da permissão `CREATE`.

## Envio pelo app

1. `POST /api/v1/sessao/app` recebe JSON com `login` e `senha`. Retorna `token` e `usuario`. Envie `Authorization: Bearer <token>` nas chamadas do app.
2. `POST /api/v1/pedidos/campo` recebe JSON como o exemplo abaixo. Gere `vendaId` uma vez por venda e salve todo o conteúdo antes da primeira tentativa de envio.
3. A recepção retorna `201` ao criar o pedido e `200` ao recuperar a confirmação. As duas respostas têm os mesmos campos `vendaId` e `numero`. O app conserva a venda e reenvia o mesmo conteúdo caso perca a resposta. Um conteúdo diferente para o mesmo ID e vendedor recebe `409`.
4. `GET /api/v1/pedidos/campo/{numero}` devolve os dados da venda ao seu vendedor. Pedidos de outro vendedor ou inexistentes retornam `404`.
5. `DELETE /api/v1/sessao/app` encerra a sessão.
6. `GET /api/v1/pedidos/campo` lista somente os pedidos do vendedor autenticado. Use `antesDe` para continuar a partir de `proximoAntesDe`.
7. `GET /api/v1/pedidos/campo/{numero}/entregas` retorna situação, quantidades e remessas da venda. A API retorna `404` para pedido alheio, de balcão ou inexistente. Não inclui dados do operador administrativo.
8. `GET /api/v1/cadastros/campo/cliente?cnpj=...` consulta um cadastro local. Aceita CNPJ numérico ou [alfanumérico](https://www.gov.br/receitafederal/pt-br/assuntos/noticias/2024/outubro/cnpj-tera-letras-e-numeros-a-partir-de-julho-de-2026). Retorna o cliente e o catálogo com preço padrão e preço negociado, quando houver. Se o CNPJ não estiver cadastrado no Essentials, retorna `404`. Não consulta um serviço da Receita.
9. `GET /api/v1/cadastros/campo/catalogo` baixa as apresentações para preparar rascunhos offline. Não retorna clientes ou preços negociados.
10. `GET /api/v1/pedidos/campo/{numero}/correcoes` consulta itens vigentes, solicitações e situação. Para solicitar, envie `POST` na mesma rota com `{ correcaoId, motivo, itens: [{ apresentacaoId, quantidade, precoUnitarioCentavos }] }`. A operação só aceita pedidos de campo do vendedor autenticado e devolve a mesma confirmação para o mesmo UUID e conteúdo.
11. `POST /api/v1/cadastros/campo/cliente` cadastra `{ cnpj, nome, telefone, endereco: { cep, logradouro, numero, bairro, municipio, uf, complemento? } }`. Use `numero: null` quando não houver número. Retorna o cliente e o catálogo para montar a venda. Se o CNPJ já existir, retorna `409` sem sobrescrever o cadastro.

### Conferência de cadastros de campo · APP #3 / ADM #5

O contador em **Cadastros** aparece para o administrador e é atualizado ao abrir ou voltar ao ADM e a cada 30 segundos. Abra a ficha para conferir o CNPJ, telefone e endereço. **Marcar como conferido** retira a ficha da fila e registra o responsável e a data. Enviar o primeiro pedido não conclui a conferência.

| API web (`/api/v1`) | Operação |
| --- | --- |
| `GET /cadastros/conferencia/total` | Retorna `{ total }` de cadastros pendentes. |
| `GET /cadastros/conferencia` | Lista as fichas pendentes. Use `antesDe` para continuar a partir de `proximoAntesDe`. |
| `POST /cadastros/conferencia/:cliente/conferir` | Registra a conferência sem remover o cadastro. Repetir retorna `204` e mantém o registro da primeira conferência. |

### Correção antes do despacho · APP #2 / ADM #7

Em **Pedidos**, gerente ou administrador vê a marca **Correção pendente** e pode abrir **Correções** para comparar quantidades e preços unitários das apresentações do pedido. A logística continua usando os itens vigentes até a aprovação. O número da venda e a confirmação original do app não mudam. O histórico registra valores antes e depois, motivo, solicitante, data e responsável pela aprovação.

| API web (`/api/v1`) | Operação |
| --- | --- |
| `GET /pedidos/:numero/correcoes` | Consulta os itens vigentes e o histórico. |
| `POST /pedidos/:numero/correcoes/:correcao/aprovacao` | Autoriza e aplica a proposta ao mesmo pedido. |

A aprovação bloqueia a mesma linha que a saída física. Se a primeira saída já ocorreu ou se a nova quantidade é menor que o saldo já cancelado, a autorização não altera o pedido. A correção ajusta apenas quantidades e preços das apresentações já vendidas, sem trocar cliente ou apresentações. Para aumento depois de saída parcial, lance o acréscimo em outro pedido.

```json
{
  "vendaId": "accc5de0-511a-4e62-b288-4a1d14956047",
  "clienteId": 1,
  "fechadoEm": "2026-11-25T18:00:00.000Z",
  "itens": [
    { "apresentacaoId": 1, "quantidade": "10", "precoUnitarioCentavos": 1875 }
  ]
}
```

Use quantidades inteiras para pacotes e caixas e até três casas decimais para kg, com ponto como separador no JSON. Envie `fechadoEm` em UTC com milissegundos, conforme o exemplo. A API conserva o preço registrado no pedido de campo. Para o balcão, valida o preço exibido contra a tabela padrão vigente no primeiro envio. O número é inteiro e exclusivo no administrativo. O servidor identifica o vendedor pela sessão.

## Entrada de estoque · ADM #16

Em **Estoque**, selecione o produto e a apresentação uma vez, informe o código da etiqueta, validade e quantidade de cada lote e confirme a entrada. Pacotes e caixas usam quantidades inteiras; kg aceita até três casas decimais. Lotes do mesmo vencimento continuam separados no histórico, mesmo quando o saldo aparece agrupado por validade. Guarde o número confirmado para consultar o detalhe da entrada.

O saldo físico inclui os lotes vencidos. O saldo disponível deixa de contar o lote a partir do dia seguinte à data da etiqueta, no horário de Belém. O descarte de um lote que já está no estoque não faz parte desta entrega. Na devolução, o descarte do produto que retornou fica no histórico e não volta ao saldo.

| API web (`/api/v1`) | Operação |
| --- | --- |
| `GET /estoque/apresentacoes` | Consulta as apresentações cadastradas. |
| `POST /estoque/entradas` | Recebe `{ entradaId, apresentacaoId, lotes: [{ codigo, validade, quantidade }] }`; devolve número e UUID. |
| `GET /estoque/entradas/:numero` | Consulta operador, data, apresentação e quantidades por lote da entrada. |
| `GET /estoque/saldos/:apresentacaoId` | Consulta totais físico e disponível e o detalhamento por validade. |

Envie validade como `AAAA-MM-DD` e quantidade como texto com ponto no JSON. A entrada e o saldo são gravados juntos. Se a confirmação se perder, a interface recupera o mesmo envio nesta aba. Reenviar o mesmo UUID e conteúdo pelo mesmo usuário devolve o número original sem aumentar o saldo novamente.

## Saída física · ADM #17

Em **Pedidos**, abra o pedido e escolha **Saída física**. A tela mostra o que foi pedido, despachado, o que ainda falta despachar e o estoque disponível. Os primeiros lotes sugeridos são os da apresentação pedida com vencimento mais próximo. Consultar ou ajustar a sugestão não reserva mercadoria.

Confira as etiquetas, informe a modalidade e confirme as quantidades que efetivamente saíram por lote. A baixa e a remessa são gravadas juntas. O sistema confere novamente a validade, o saldo de cada lote e a quantidade pendente; se um item não puder sair como informado, nenhuma baixa daquela confirmação é aplicada. A saída parcial mantém o restante no pedido original e não confirma o recebimento pelo cliente.

| API web (`/api/v1`) | Operação |
| --- | --- |
| `GET /pedidos/:numero/saidas` | Consulta quantidades por item, lotes disponíveis, sugestão e histórico das remessas. |
| `POST /pedidos/:numero/saidas` | Registra `{ saidaId, modalidade, lotes: [{ loteId, quantidade }] }`; devolve número da remessa e UUID. |

Use `frota_propria`, `transportadora` ou `retirada` para `modalidade`. Um pedido marcado como retirada imediata exige `retirada`. Se a confirmação se perder, a mesma aba preserva o envio. O mesmo UUID e conteúdo para o mesmo usuário devolvem a confirmação original sem repetir a baixa.

## Recebimento por remessa · ADM #18

Em **Pedidos → Entregas**, o resumo distingue o que saiu, o que foi recebido ou recusado, o que saiu sem confirmação e o que ainda falta despachar ou receber. Para uma remessa sem confirmação, use **Conferir recebimento**. Informe a recusa e o motivo por apresentação, se houver. Na transportadora, indique se o comprovante está sem ressalvas ou se a divergência já foi esclarecida com o cliente.

O recebimento registra o operador, a data e as quantidades por apresentação. O valor mostrado considera apenas o que foi recebido, com o preço do pedido e arredondamento de meio centavo para cima em cada item. Confirmar não movimenta o estoque, não fatura e não cancela o saldo. Se o cliente pedir reposição, a quantidade recusada volta a ficar disponível para **novo despacho no mesmo pedido**, sem retorno automático ao estoque. A nova saída dá baixa normalmente. Devoluções físicas são tratadas na ADM #19.

| API web (`/api/v1`) | Operação |
| --- | --- |
| `GET /pedidos/:numero/entregas` | Consulta situação, balanço por apresentação, remessas, confirmações e histórico dos cancelamentos. |
| `POST /pedidos/:numero/saidas/:saida/recebimento` | Registra `{ recebimentoId, conferencia?, itens: [{ apresentacaoId, recebida, recusada, motivo?, repor? }] }`. Retorna número e UUID. |
| `POST /pedidos/:numero/cancelamentos` | Autoriza `{ cancelamentoId, motivo, itens: [{ apresentacaoId, quantidade }] }`. Retorna número e UUID. |

Informe todas as apresentações despachadas uma vez. Para cada uma, `recebida + recusada` deve igualar a quantidade despachada naquela remessa; use textos decimais, inclusive `"0"`. Com recusa, `motivo` é obrigatório. `repor: true` indica que o cliente pediu reposição daquele recusado. Para transportadora, envie `sem_ressalvas` ou `divergencia_esclarecida` em `conferencia`; as outras modalidades omitem o campo. Cada remessa tem uma confirmação. O reenvio do mesmo UUID e conteúdo pelo mesmo usuário retorna a confirmação original.

Com **Cancelar saldo pendente**, o gerente ou o administrador informa quanto o cliente dispensou e o motivo. A API impede cancelar acima do saldo a despachar, inclusive se outra pessoa confirmar uma saída ao mesmo tempo. O histórico preserva as quantidades originais, o saldo cancelado, o motivo, a data e o responsável. Se houve recebimento e não resta saldo a receber, o pedido fica **Finalizado com entrega parcial**. O cancelamento não altera o estoque. A mesma aba pode recuperar a autorização pelo UUID se a resposta se perder.

## Devolução por remessa · ADM #19

Em **Pedidos → Entregas → Devoluções**, escolha se a mercadoria voltou por recusa na entrega ou depois do aceite. Confira a etiqueta dos lotes originais e informe as quantidades aptas e descartadas. O motivo é obrigatório para descarte. A soma das devoluções não pode exceder o que saiu daquele lote nem o que foi recusado ou recebido naquela apresentação, conforme a origem selecionada.

Só a quantidade apta e dentro da validade é acrescida ao mesmo lote. O histórico preserva quantidades, lotes, motivo, operador e vínculo com o recebimento original. O recebimento confirmado não muda. Em caso de perda da resposta, a aba permite recuperar a mesma devolução sem repor estoque novamente. Não há reembolso, abatimento ou troca financeira neste piloto.

| API web (`/api/v1`) | Operação |
| --- | --- |
| `GET /pedidos/:numero/saidas/:saida/devolucoes` | Consulta o recebimento original, os limites por lote e origem e o histórico. |
| `POST /pedidos/:numero/saidas/:saida/devolucoes` | Registra `{ devolucaoId, origem, lotes: [{ loteId, apta, descartada, motivo? }] }`. Use `recusa` ou `apos_recebimento` como origem. |

## Acessos do piloto

| Acesso | Perfil |
| --- | --- |
| Consultar a fila administrativa | Administrador, gerente, estoque e balcão |
| Criar pedido de balcão | Administrador, gerente e balcão |
| Registrar entradas, consultar estoque e confirmar saída física | Administrador, gerente e estoque |
| Consultar entregas | Administrador, gerente, estoque e balcão |
| Confirmar recebimento | Administrador, gerente e estoque; balcão somente em retiradas |
| Autorizar cancelamento de saldo pendente | Administrador e gerente |
| Autorizar correção antes da primeira saída | Administrador e gerente |
| Registrar e consultar devoluções | Administrador, gerente e estoque |
| Gerenciar contas | Administrador |
| Conferir novos cadastros de campo | Administrador |
| Cadastrar supermercado pelo app | Vendedor |
| Enviar e consultar as próprias vendas | Vendedor |

O perfil específico de entregador e os lembretes ainda não estão disponíveis. O faturamento fica para outra miniversão.
