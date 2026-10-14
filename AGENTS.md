# AGENTS.md

## Specs e labels

- Desenvolvimento só guiado por spec. Nenhum código sem spec acordada na descrição da issue ou do PR, com escopo, critérios de aceite e gates de CI. A implementação segue a spec; mudar o escopo exige atualizar a spec antes, com o item em `needs-triage`.
- `needs-triage`: precisa do loop humano-agente. Agentes só discutem e escrevem spec; não commitam código. Item com pergunta aberta é `needs-triage`.
- `agent-ready`: liberado para implementar. Só uma pessoa aplica esse label; o agente pode apenas propor.
- Antes de commitar, confira o label da issue ou do PR: sem `agent-ready`, não commite código.

## Código

- Comentários no código são proibidos, inclusive diretivas de ferramenta (`@ts-expect-error`, `@ts-ignore`, `oxlint-disable`, `eslint-disable`, `type: ignore`, `noqa`, `pragma` etc.). Única exceção: docstring Python estritamente necessária em tempo de execução, registrada na lista `ALLOWED_DOCSTRINGS` de `scripts/ci/no_comments.py` (hoje vazia) e justificada no PR; fora dela, o guard `repo / comments` reprova. O contexto vai no commit e no PR.
- Tudo estritamente tipado. Nada de `any`, de `any` implícito ou de código sem tipo, em TypeScript e em Python. Em Python, toda função tem tipos de parâmetro e de retorno, sem `Any`.
- Tipos compartilhados em `/shared`. Modelos Pydantic em `/shared` são a fonte única dos contratos; JSON Schema e os tipos TS/Effect Schema são gerados a partir deles. Código gerado não se edita à mão; a CI falha se estiver defasado.
- Front: lint com oxlint e formatação com oxfmt (sem Biome nem Prettier).
- Trabalho de UI segue o `DESIGN.md` (tema, cores, raio, tipografia, movimento).

## Streams, branches e CI

- Um stream = uma branch = um PR, empilhados com `gh stack`. O plano, a ordem e os donos estão na checklist da descrição do PR #4.
- Cada stream só edita os arquivos que possui. Lockfiles e manifests têm um único dono (S0 para o front, S9 para Python). Lockfile em conflito não se resolve à mão: aceite o remoto e regenere.
- Commits pequenos com o prefixo do stream (`[S4-toast] ...`). Antes de todo push: `git pull --rebase`, rodar as checagens da área tocada e depois `git push` normal.
- Proibido: force-push manual, `--no-verify`, `[skip ci]` e merge com o check `ci-ok` vermelho. Única exceção: o `--force-with-lease` que o próprio `gh stack sync`/`gh stack push` faz num restack.
- Toda mudança chega com o seu gate de CI: um job próprio no `ci.yml`, nomeado `<área> / <checagem>` (ex.: `web / lint`), incluído no `needs` do `ci-ok` e registrado na checklist.

## Autoria

- Só agentes commitam; não há commit humano. Todo agente age em nome de uma pessoa e assina como `{model_slug} on behalf of {human_name}`:
  - commits: trailer `Agent: {model_slug} on behalf of {human_name}` obrigatório em todo commit (a CI rejeita commit sem ele);
  - comentários em PR: primeira linha de todo comentário, review, comentário de review (inline) e resposta em thread, e também da descrição do PR.
