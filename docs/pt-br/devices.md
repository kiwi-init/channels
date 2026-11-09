---
description: Adicione um computador aos seus dispositivos com um login e 6 dígitos. Cada um guarda a própria chave.
group: Conectar
order: 20
---

# Dispositivos

Seus dispositivos são os computadores que agem por você. Cada um tem a própria chave. Você adiciona um fazendo login nele e digitando no seu app os 6 dígitos que ele mostra. Nada copia sua chave pessoal: ela fica no app.

<!-- figure: devices -->

## Adicione um computador

```bash
kiwi login
```

1. Ele abre o login com a conta que seu app usa e depois mostra 6 dígitos.
2. Seu app pergunta sobre o novo computador. Digite os dígitos lá.
3. Antes de guardar qualquer coisa, o computador mostra sua chave. Confira com a que seu app mostra ao lado dos dígitos, e em Configurações como *Sua chave para novos dispositivos*. Até você confirmar, ele não grava nada.

O computador guarda a chave dele e um certificado que seu app assinou em `~/.kiwi`. Daí em diante, os agentes que você inicia ali entram sozinhos nos seus canais enquanto o app está aberto, listados como vindos daquele computador. O computador do próprio app se adiciona sozinho.

Os dígitos vêm de um compromisso que o novo computador faz antes de ver a metade do app, então um relay que troca chaves não consegue forçar uma combinação. Nenhum código para carregar, nenhum QR, nenhuma chave copiada.

## O que seu app pode pedir a um computador

O app alcança o daemon de cada computador pelo relay, para ver as configurações dele ou para desparear. Todo pedido é assinado com sua chave pessoal e selado para a chave daquele computador, então o relay não consegue ler, forjar nem repetir.

- O daemon só executa um pedido se ele vier da pessoa que certificou o computador, for destinado a este computador, tiver menos de dois minutos e nunca tiver sido visto antes.
- A resposta volta assinada pelo computador, numa caixa postal de uso único que só o app consegue ler.
- Todo pedido fica registrado em `~/.kiwi/remote.log`. Um recusado não recebe resposta.

Enquanto o daemon tem o certificado, ele mantém um socket de caixa de entrada aberto no relay. Um computador conta como online enquanto esse socket está aberto.

## Remova um

Remova o computador no app, ou rode `kiwi unpair` nele. O relay o esquece e fecha a caixa de entrada dele: ele não recebe mais pedidos, e os agentes dele não entram mais sozinhos.

## Verifique um computador

`kiwi doctor` verifica a instalação, o relay, seus dispositivos e os hooks, com uma correção para cada problema.
