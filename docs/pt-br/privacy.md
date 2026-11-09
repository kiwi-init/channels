---
description: O que o Channels coleta, o que ele não consegue ver e quem mais mexe nos seus dados.
group: Confiança
order: 32
---

# Privacidade

O Channels foi feito para que as pessoas que o operam não consigam ler o que você escreve. Esta página cobre os apps (Mac, Linux, iPhone, Android), a CLI e o relay público em `channels.kiwiinit.com`.

## O que não conseguimos ver

- **Suas mensagens, arquivos, nomes, funções e nomes de canais.** Eles são criptografados no seu dispositivo antes de sair dele, e só os membros do canal conseguem abri-los.
- **Suas chaves.** Sua chave pessoal é criada no seu dispositivo e fica lá.

## O que o relay vê

Para carregar mensagens criptografadas, o relay vê o formato delas, não o conteúdo:

- quando as mensagens são enviadas, os tamanhos e quantas são;
- ids das salas e as chaves públicas dos membros;
- os endereços IP que se conectam, e quando cada chave se conecta;
- até onde cada membro leu: um número e uma hora, nunca o quê;
- seu id de usuário do GitHub quando você faz login. Nada de nomes ou emails.

Quando um canal é fechado, o relay o apaga, e com ele os ids das salas e os códigos de entrada.

## Outros que mexem nos seus dados

- **GitHub**, quando você faz login ou conecta um repo. Recebemos seu id de usuário do GitHub e os eventos dos repos que você conecta.
- **Apple e Google**, para as notificações no celular. Um push leva uma tag aleatória e um número, nunca uma sala, um nome ou qualquer texto.
- **Stripe**, se você paga um plano. A Stripe cuida dos seus dados de pagamento; só ficamos sabendo que seu id do GitHub está no plano pago.
- **Cloudflare**, que hospeda o relay público.

## O que não fazemos

- Nada de anúncios, rastreamento ou analytics nos apps.
- Não vendemos nem compartilhamos seus dados.

## Suas escolhas

- **Saia de um canal** e sua chave é revogada na hora.
- **Feche um canal** (donos) e o relay o apaga de vez. Os dispositivos dos membros apagam a cópia deles.
- **Rode seu próprio relay** e nada passa pelo nosso. Veja [Self-hosting](self-hosting.md).

## Contato

Dúvidas sobre privacidade: abra uma issue em [github.com/kiwi-init/channels](https://github.com/kiwi-init/channels/issues). O modelo de confiança completo está em [Segurança](security.md).
