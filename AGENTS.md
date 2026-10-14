# AGENTS.md

Regras para todo agente neste repositório (Kiwi Channels: TypeScript com Bun e Effect; `src/` é o CLI, o relay e o núcleo; `web/` é o front em React; `desktop/` é o app Electron).

## Specs e labels

- Desenvolvimento só guiado por spec. Nenhum código sem spec acordada na descrição da issue, do PR ou da tarefa do Kiwi (`kiwi task`), com escopo, critérios de aceite e gates de CI. A implementação segue a spec; mudar o escopo exige atualizar a spec antes, com o item em `needs-triage`.
- `needs-triage`: precisa do loop humano-agente. Agentes só discutem e escrevem spec; não commitam código. Item com pergunta aberta é `needs-triage`.
- `agent-ready`: liberado para implementar. Só uma pessoa aplica esse label; o agente pode apenas propor.
- Antes de commitar, confira o label da issue ou do PR: sem `agent-ready`, não commite código.

## Código

- Comentários no código são proibidos em código novo ou alterado, inclusive diretivas de ferramenta (`@ts-expect-error`, `@ts-ignore`, `eslint-disable` etc.). Hoje o repositório não tem nenhuma diretiva, e assim fica. Os comentários que já existem saem quando a função que eles explicam é alterada. O contexto vai no commit e no PR.
- Tudo estritamente tipado. Nada de `any`, de `any` implícito ou de código sem tipo. Os `tsconfig` já usam `strict` e `noUncheckedIndexedAccess`; não os afrouxe.
- Tipos compartilhados vivem em `src/` (`protocol.ts`, `state.ts`, `membership.ts`, `scopes.ts`) e são a fonte única dos contratos. O `web/` os importa pelo alias `@mc/`. Os contratos do relay são Effect Schema em `src/relay/schema.ts`. Não duplique um tipo do núcleo no `web/` nem no `desktop/`.
- Front: lint com ESLint (`web/eslint.config.js`, job `web / lint`).
- Trabalho de UI segue o `DESIGN.md` (tema, cores, raio, tipografia, movimento). Cores e medidas vêm dos tokens; `bun scripts/ui-tokens.ts` confere.

## Tarefas, branches e CI

- Uma tarefa = uma branch = um PR contra `main`, com squash merge. O título do PR começa pelo id da tarefa (`T123: ...`).
- Cada tarefa só edita os arquivos do seu escopo. Lockfiles (`bun.lock`, `web/bun.lock`, `desktop/bun.lock`) e manifests (`package.json`) mudam só na tarefa que precisa da dependência. Lockfile em conflito não se resolve à mão: aceite o remoto e rode `bun install`.
- Commits pequenos, com o id da tarefa no título e um corpo que diz o que mudou e por quê (o corpo vira a entrada do `CHANGELOG.md`, e o `ci-ok` reprova PR sem corpo). Antes de todo push: `git pull --rebase`, rodar as checagens da área tocada (`bun run typecheck`, `bun test`, e no desktop `cd desktop && bun run typecheck`) e depois `git push` normal.
- Proibido: force-push em `main` ou na branch de outro agente, `--no-verify`, `[skip ci]` e merge com o check `ci-ok` vermelho. Única exceção: `git push --force-with-lease` na sua própria branch, depois de um rebase.
- Toda mudança chega com o seu gate de CI: um job próprio em `.github/workflows/ci.yml`, nomeado `<área> / <checagem>` (ex.: `web / lint`), incluído no `needs` do `ci-ok` e com seus arquivos de entrada registrados em `.github/jev-ci.yml`.

## Autoria

- Só agentes commitam; não há commit humano. Todo agente age em nome de uma pessoa e assina como `{model_slug} on behalf of {human_name}`:
  - commits: trailer `Agent: {model_slug} on behalf of {human_name}` obrigatório em todo commit;
  - comentários em PR: primeira linha de todo comentário, review, comentário de review (inline) e resposta em thread, e também da descrição do PR.

## Ainda falta (tarefas abertas)

Estas regras ainda não têm checagem automática:

- os labels `needs-triage` e `agent-ready` no GitHub;
- o job `repo / comments`, que reprova comentário e diretiva nas linhas novas de um PR;
- o job `repo / agent-trailer`, que reprova commit sem o trailer `Agent:`;
- `@typescript-eslint/no-explicit-any` como erro, também para `src/` e `desktop/`.
