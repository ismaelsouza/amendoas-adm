# Issue tracker: GitHub

As Issues do ADM e da API ficam em [`ismaelsouza/amendoas-adm`](https://github.com/ismaelsouza/amendoas-adm/issues). Para mudanças no app, use [`ismaelsouza/amendoas-app`](https://github.com/ismaelsouza/amendoas-app/issues) e vincule as Issues dos dois canais pelo URL. O [mapa de decisões](https://github.com/ismaelsouza/amendoas-adm/issues/1) reúne as regras em discussão.

## Comandos

Confirme o destino com `gh repo view --json nameWithOwner`. Fora do clone, inclua `-R ismaelsouza/amendoas-adm` nos comandos `gh issue`.

| Tarefa | Comando |
| --- | --- |
| Listar | `gh issue list --state all --limit 100 --json number,title,state,labels,url` |
| Ler | `gh issue view <n> --json number,title,body,labels,comments,parent,blockedBy` |
| Publicar Issue ou spec | `gh issue create --title "..." --body-file -` |
| Comentar | `gh issue comment <n> --body-file -` |
| Alterar rótulos | `gh issue edit <n> --add-label "..." --remove-label "..."` |
| Vincular subtarefa | `gh issue edit <pai> --add-sub-issue <filha>` |
| Vincular dependência | `gh issue edit <n> --add-blocked-by <n-ou-url>` |
| Encerrar após registrar o resultado | `gh issue close <n> --reason completed` |

`--body-file -` lê Markdown da entrada padrão. Para buscar todas as páginas, use `gh api --paginate 'repos/ismaelsouza/amendoas-adm/issues?state=all&per_page=100' --jq '.[] | select(has("pull_request") | not)'`.

`awaiting-homologation` indica que a entrega está em HML e precisa do aceite do cliente. Registre o resultado na Issue antes de fechar. O mapa usa `wayfinder:map`; consulte suas subtarefas abertas e as dependências nativas antes de assumir uma delas.

## Pull requests as a triage surface

**PRs as a request surface: no.**
