# Como dar acesso administrativo ao Ismael no GitHub

Este guia é para quem entra no GitHub como **`prpaulocesarneves-crypto`**. Você vai manter os dois repositórios privados sob controle da Casa das Amêndoas e dar à conta **`ismaelsouza`** acesso para configurar as publicações do painel e do app.

Hoje os repositórios estão na sua conta pessoal. Nesse tipo de conta, o GitHub permite convidar colaboradores, mas não oferece a opção `Admin` para eles. Para dar esse acesso sem entregar a sua conta, transfira os repositórios para uma organização do GitHub que você controla.

## 1. Crie a organização da Casa das Amêndoas

1. No computador, entre no [GitHub](https://github.com/) com a conta `prpaulocesarneves-crypto`. Clique na foto no canto superior direito e confira o nome da conta.
2. Abra [Settings → Organizations](https://github.com/settings/organizations) e clique em **New organization**. Se a Casa das Amêndoas já tem uma organização da qual você é proprietário, use-a e pule para o passo 2.
3. Escolha um nome livre para a organização. Use um e-mail da empresa que você monitora. Se o GitHub perguntar a quem a organização pertence, escolha a opção para empresa e informe `Casa das Amêndoas`.
4. Siga as instruções até abrir a página da organização. Sua conta deve aparecer com a função **Owner** na aba **People**. Guarde o nome que o GitHub mostra logo após `github.com/`.

O plano gratuito permite criar a organização e dar acesso `Admin` aos repositórios. Para configurar ambientes e credenciais de publicação em repositórios privados da organização, o GitHub exige Team ou Enterprise. A aprovação manual de deploy em repositórios privados pelo recurso **Required reviewers** exige Enterprise. Combine o plano com o Ismael antes de contratar. A produção fica desativada até a aprovação do cliente estar configurada.

## 2. Mova os dois repositórios para a organização

Faça primeiro no [painel e API](https://github.com/prpaulocesarneves-crypto/amendoas--adm/settings) e repita no [app do vendedor](https://github.com/prpaulocesarneves-crypto/amendoas-app/settings).

1. Em **Settings** → **General**, role até o final da página, na seção **Danger Zone**.
2. Na linha **Transfer ownership**, clique em **Transfer**. Escolha **Select one of my organizations** e selecione a organização da Casa das Amêndoas.
3. Mantenha o nome do repositório. Quando o GitHub pedir para confirmar, digite o nome mostrado na tela: `amendoas--adm` para o painel, com dois hífens, ou `amendoas-app` para o app.
4. Clique em **I understand, transfer this repository**. Quando abrir o novo endereço, confira o nome da organização antes da barra e a etiqueta **Private** ao lado do nome do repositório.
5. Repita no outro repositório.

Use **Transfer**, o que mantém o histórico, as Issues e os pull requests. O GitHub passa a redirecionar os endereços antigos para os novos. Não recrie repositórios com os mesmos nomes na conta pessoal, pois isso remove os redirecionamentos.

## 3. Dê o papel `Admin` ao Ismael nos dois repositórios

1. Abra um dos repositórios pelo novo endereço e clique em **Settings**.
2. No menu à esquerda, na seção **Access**, clique em **Collaborators and teams**. O GitHub também pode exibir **Manage access**.
3. Procure `ismaelsouza` na lista. Como ele já tem acesso de escrita, deve aparecer como colaborador. Na linha do usuário, abra o menu da função atual (**Write**), selecione **Admin** e confirme se o GitHub pedir.
4. Se `ismaelsouza` não estiver na lista, clique em **Add people**, procure pelo usuário exato **`ismaelsouza`**, selecione **Admin** e envie o convite. Ismael precisa aceitá-lo.
5. Repita para o outro repositório. O papel **Admin** deve aparecer ao lado de `ismaelsouza` nos dois. Sua conta continua como **Owner** da organização.

## 4. Avise o Ismael

Envie os dois novos endereços pelo canal de contato do projeto. Se houver um convite pendente, diga em qual repositório. Não envie senha, código de autenticação nem chave.

Se você preferir manter os repositórios na conta pessoal, avise o Ismael. Ele continua com acesso de escrita, e você faz as configurações de publicação na sua conta com a ajuda dele.

### Ajuda do GitHub

- [Permissões de repositórios de conta pessoal](https://docs.github.com/en/account-and-profile/reference/permission-levels-for-a-personal-account-repository)
- [Criar uma organização](https://docs.github.com/en/organizations/collaborating-with-groups-in-organizations/creating-a-new-organization-from-scratch)
- [Transferir um repositório](https://docs.github.com/en/repositories/creating-and-managing-repositories/transferring-a-repository)
- [Alterar o acesso de uma pessoa a um repositório de organização](https://docs.github.com/en/organizations/managing-user-access-to-your-organizations-repositories/managing-repository-roles/managing-an-individuals-access-to-an-organization-repository)
- [Planos e regras para os ambientes de publicação](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments#required-reviewers)
