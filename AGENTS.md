# AGENTS.md

## Código

- Comentários no código são proibidos, inclusive diretivas de ferramenta (`@ts-expect-error`, `@ts-ignore`, `oxlint-disable`, `eslint-disable`, `type: ignore`, `noqa`, `pragma` etc.). Única exceção: docstring Python estritamente necessária em tempo de execução, registrada na lista `ALLOWED_DOCSTRINGS` de `scripts/ci/no_comments.py` (hoje vazia) e justificada no PR; fora dela, o guard `repo / comments` reprova. O contexto vai no commit e no PR.
- Tudo estritamente tipado. Nada de `any`, de `any` implícito ou de código sem tipo, em TypeScript e em Python. Em Python, toda função tem tipos de parâmetro e de retorno, sem `Any`.
- Front: lint com oxlint e formatação com oxfmt (sem Biome nem Prettier).
- Trabalho de UI segue o `DESIGN.md` (tema, cores, raio, tipografia, movimento).

## Branches e CI

- Uma issue = uma branch = um PR.
- Lockfile em conflito não se resolve à mão: aceite o remoto e regenere.
- Commits pequenos. Antes de todo push: `git pull --rebase`, rodar as checagens da área tocada e depois `git push` normal.
- Proibido: force-push manual, `--no-verify`, `[skip ci]` e merge com o check `ci-ok` vermelho.
- Processo longo (CI, checagens, testes, build, servidor, espera por run de CI) roda destacado, em background, para que a interrupção do turno não o mate: dispare em background (ou com `nohup`/`setsid`), mande a saída para um arquivo de log e acompanhe pelo log ou pelo aviso de término, sem bloquear o turno esperando.
- Toda mudança chega com o seu gate de CI: um job próprio no `ci.yml`, nomeado `<área> / <checagem>` (ex.: `web / lint`) e incluído no `needs` do `ci-ok`.

## Autoria

- Só agentes commitam; não há commit humano. Todo agente age em nome de uma pessoa e assina como `{model_slug} on behalf of {human_name}`:
  - commits: trailer `Agent: {model_slug} on behalf of {human_name}` obrigatório em todo commit (a CI rejeita commit sem ele);
  - comentários em PR: primeira linha de todo comentário, review, comentário de review (inline) e resposta em thread, e também da descrição do PR.
