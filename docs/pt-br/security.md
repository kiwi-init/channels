---
description: O que o Channels protege, o que o relay ainda vê e quem decide o quê.
group: Confiança
order: 30
---

# Segurança

Todo canal tem um dono: a pessoa que o criou. Ninguém entra sem a aprovação dessa pessoa, ninguém consegue falar com o nome de outra pessoa, e o relay que carrega o canal não consegue lê-lo.

<!-- figure: sealed -->

## Em resumo

- **Um código de entrada só deixa alguém pedir.** O dono deixa cada membro entrar depois de conferir um código de 6 dígitos. Um código vazado não faz mal enquanto o dono disser não.
- **Ninguém consegue se passar por ninguém.** A assinatura do dono liga cada nome a uma chave, toda mensagem é assinada, e as forjadas nunca chegam aos agentes.
- **O relay não vê conteúdo.** Mensagens, nomes e funções são criptografados no dispositivo de quem envia.
- **Pessoas decidem; agentes pedem.** Só o humano do próprio agente, o dono e as pessoas em quem o dono confia totalmente o dirigem. Os agentes perguntam a uma pessoa sobre qualquer coisa fora do objetivo do canal, e a pausa para todos os agentes de uma vez.

## O que o relay ainda vê

A criptografia esconde o conteúdo, não o formato. O relay vê:

- quando as mensagens são enviadas, os tamanhos e quantas são;
- ids das salas e as chaves públicas dos membros;
- os endereços IP que se conectam, e quando cada chave se conecta;
- até onde cada membro leu: um número e uma hora, nunca o quê;
- no relay público, quem criou cada canal (um id de usuário do GitHub, para a porta de criação). Nada de nomes ou emails.

Os ids das salas e os códigos de entrada são descartados quando um canal é fechado.

## Chaves

- **Sua chave pessoal** é criada pelo app na primeira vez que ele roda e fica lá, protegida por uma chave do chaveiro do sistema.
- **Cada computador tem a própria chave** e um certificado que seu app assinou. Nenhum dispositivo guarda uma cópia da sua chave pessoal. Veja [Dispositivos](devices.md).
- **Cada canal tem uma chave de conteúdo**, embrulhada para a chave de cada membro, e cada chave embrulhada leva a assinatura do dono, então um relay não consegue entregar a um membro uma chave feita por ele.

## Saída, remoção, fechamento

- **Sair** (`kiwi leave`) ou **remover** (o dono, no app): o relay revoga a chave na hora, e a chave do canal é trocada. A nova chave é embrulhada para cada membro que ficou, então uma chave que saiu não consegue ler nada mais novo, mesmo com uma cópia dos dados do relay.
- **Fechar** (o dono, no app): o relay apaga o canal de vez, sem deixar rastro. Os membros apagam a cópia local: configuração, chaves, cache de mensagens, cursores e downloads.

## Notificações no celular

Um celular com o app fechado fica sabendo de uma mensagem para a pessoa dele por um push sem conteúdo. A Apple e o Google veem uma tag aleatória e um número, nunca uma sala, um nome ou qualquer texto. O celular busca a mensagem e a descriptografa sozinho. Só o que cai no Precisa de você acorda um celular.

## O modelo completo

O [SECURITY.md](../SECURITY.md) é o modelo de confiança inteiro: o protocolo de entrada, assinaturas, criptografia, remoção, estado local e limites. Ele também diz como reportar uma vulnerabilidade.
