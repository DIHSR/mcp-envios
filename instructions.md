# Prompt para o Claude Code — MCP Server do Brevo (e-mail e WhatsApp 1 a 1)

> Copie o conteúdo abaixo da linha e cole no Claude Code, dentro da pasta vazia do projeto.

---

## Objetivo

Construa um **MCP Server** (Model Context Protocol) que permita ao Claude enviar **e-mails transacionais 1 a 1** e **mensagens de WhatsApp 1 a 1** pela **API do Brevo**, além de **consultar eventos** (entregas e cliques) para alimentar uma cadência de prospecção outbound.

O servidor será **hospedado na AWS** e versionado em um repositório **privado no GitHub**.

## Contexto de uso

O Claude (via Cowork e Claude Desktop) roda uma rotina diária que:

1. Lê o estado de cada lead no Pipedrive.
2. Consulta os eventos do Brevo para descobrir **quem clicou** no link do case.
3. Aplica um filtro anti-robô (descarta cliques ocorridos poucos segundos após a entrega).
4. Envia os toques devidos: e-mails por data e WhatsApps por gatilho de clique.

Este MCP é a camada de execução desses envios e consultas. Ele **não guarda estado de cadência** — esse papel é do Pipedrive.

## Stack obrigatória

- **Linguagem:** TypeScript (Node.js 20+).
- **SDK:** `@modelcontextprotocol/sdk`.
- **Transporte:** **Streamable HTTP** para produção na AWS, e **stdio** para desenvolvimento local. O mesmo código deve suportar os dois modos, selecionados por variável de ambiente (`MCP_TRANSPORT=http|stdio`).
- **Infra na AWS:** AWS Lambda + API Gateway (HTTP API), definida como código com **AWS SAM** ou **AWS CDK** (escolha um e justifique em uma linha no README).
- **Segredos:** **AWS Secrets Manager** em produção; arquivo `.env` local em desenvolvimento (listado no `.gitignore`).
- **Testes:** Vitest ou Jest, com as chamadas HTTP ao Brevo mockadas.

## Antes de codar

Consulte a documentação oficial em `https://developers.brevo.com` e **confirme os endpoints, os nomes dos campos e as versões da API** antes de implementar. Os caminhos indicados abaixo são uma referência de partida, não uma especificação final. Se algo divergir da documentação, siga a documentação e registre a diferença no README.

Referências relevantes:

- Send transactional email
- Send transactional WhatsApp
- Eventos / estatísticas transacionais
- Autenticação por API key (header `api-key`)

## Ferramentas (tools) do MCP

### 1. `brevo_enviar_email`

Envia um e-mail transacional individual a partir de um template do Brevo.

**Entrada:**
| Campo | Tipo | Obrigatório | Observação |
|---|---|---|---|
| `lead_id` | string | sim | Identificador do lead no Pipedrive |
| `etapa` | enum `E1..E5` | sim | Etapa da cadência |
| `template_id` | number | sim | ID do template no Brevo |
| `destinatario_email` | string | sim | Validar formato |
| `destinatario_nome` | string | sim | |
| `params` | objeto | não | Variáveis do template (ex.: `nome`, `empresa`) |
| `tags` | string[] | não | |

**Comportamento:**

- Chamar o endpoint de envio de e-mail transacional do Brevo.
- **Marcar a mensagem com `lead_id` e `etapa`**, para que os eventos posteriores possam ser correlacionados ao lead. Use o mecanismo que a documentação indicar (por exemplo, o header customizado `X-Mailin-custom` e/ou `tags`). Documente no README qual foi usado.
- Retornar `messageId`, o horário do envio em ISO 8601 e o status.

### 2. `brevo_enviar_whatsapp`

Envia uma mensagem de WhatsApp individual usando um template aprovado.

**Entrada:**
| Campo | Tipo | Obrigatório | Observação |
|---|---|---|---|
| `lead_id` | string | sim | |
| `toque` | enum `A..E` | sim | Toque da cadência |
| `template_id` | number | sim | Template de WhatsApp no Brevo |
| `destinatario_telefone` | string | sim | Normalizar para E.164 (ex.: `5586999999999`) |
| `params` | objeto | não | Variáveis do template |

**Comportamento:**

- Chamar o endpoint de envio de WhatsApp transacional do Brevo.
- Validar o telefone antes de enviar; rejeitar formato inválido com mensagem clara.
- Retornar o identificador da mensagem, o horário e o status.

### 3. `brevo_listar_eventos`

Consulta eventos transacionais de e-mail (entregas, cliques, aberturas, bounces).

**Entrada:**
| Campo | Tipo | Obrigatório | Observação |
|---|---|---|---|
| `desde` | string ISO 8601 | sim | |
| `ate` | string ISO 8601 | não | Padrão: agora |
| `eventos` | string[] | não | Padrão: `["delivered", "click"]` |
| `email` | string | não | Filtrar por destinatário |
| `message_id` | string | não | |
| `limite` | number | não | Padrão 500 |

**Comportamento:**

- Paginar automaticamente até esgotar os resultados ou atingir o limite.
- Retornar uma lista normalizada com: `email`, `message_id`, `evento`, `data_hora` (ISO 8601, UTC), `link` (quando for clique) e os dados de correlação (`lead_id` e `etapa`) extraídos da marcação feita no envio.

### 4. `brevo_cliques_validos`

Ferramenta de conveniência que aplica o **filtro anti-robô** e devolve apenas cliques humanos prováveis.

**Entrada:**
| Campo | Tipo | Obrigatório | Padrão |
|---|---|---|---|
| `desde` | string ISO 8601 | sim | |
| `ate` | string ISO 8601 | não | agora |
| `limite_segundos` | number | não | valor de `CLICK_FILTER_SECONDS` (padrão 60) |
| `link_contem` | string | não | filtra só os cliques em links que contenham este trecho (ex.: o link do case) |

**Regra do filtro:**

```
para cada clique:
    entrega = evento "delivered" do mesmo message_id
    se entrega existe e (clique.data_hora - entrega.data_hora) < limite_segundos:
        classificar como "suspeito"   → não retornar em validos
    senão:
        classificar como "valido"
```

**Saída:** dois arrays, `validos` e `suspeitos`, cada item com `lead_id`, `etapa`, `email`, `message_id`, `link`, `data_hora_clique`, `data_hora_entrega` e `delta_segundos`. Se não houver evento de entrega correspondente, marque `delta_segundos: null` e trate como **válido**, registrando o caso em log.

### 5. `brevo_status_envio`

Consulta o status de uma mensagem específica por `message_id`, útil para auditoria e reprocessamento.

## Requisitos transversais

- **Idempotência:** aceite um `idempotency_key` opcional nas ferramentas de envio. Mantenha um cache em memória com TTL (padrão 24h) para evitar envio duplicado na mesma execução; deixe documentado que a garantia definitiva contra duplicidade é do Pipedrive.
- **Rate limit:** respeite os limites da API do Brevo. Implemente retry com backoff exponencial para HTTP 429 e erros 5xx, com no máximo 3 tentativas.
- **Erros:** nunca lance exceção crua para o cliente MCP. Retorne um objeto com `ok: false`, `codigo`, `mensagem` legível e, quando houver, a resposta do Brevo. Não inclua a API key em nenhuma mensagem ou log.
- **Logs:** estruturados em JSON, com `lead_id`, ferramenta, duração e resultado. **Nunca** logar segredos nem o corpo completo das mensagens.
- **Fusos:** todas as datas em UTC, ISO 8601, na entrada e na saída.
- **Modo de teste:** variável `DRY_RUN=true` que valida tudo e registra o que seria enviado, sem chamar a API de envio do Brevo.

## Autenticação do próprio MCP (produção)

Como o servidor ficará exposto na internet:

- Exigir um header `Authorization: Bearer <MCP_AUTH_TOKEN>` em todas as requisições.
- Comparar o token com **comparação de tempo constante**.
- Responder 401 sem detalhes em caso de falha.
- Opcional, mas recomendado: restringir por IP de origem na API Gateway.

## Variáveis de ambiente

| Variável                | Descrição                                       |
| ----------------------- | ----------------------------------------------- |
| `BREVO_API_KEY`         | Chave v3 do Brevo (Secrets Manager em produção) |
| `BREVO_SENDER_EMAIL`    | E-mail remetente verificado                     |
| `BREVO_SENDER_NAME`     | Nome do remetente                               |
| `BREVO_WHATSAPP_SENDER` | Número remetente do WhatsApp                    |
| `MCP_AUTH_TOKEN`        | Token de acesso ao MCP                          |
| `MCP_TRANSPORT`         | `http` ou `stdio`                               |
| `CLICK_FILTER_SECONDS`  | Limite do filtro anti-robô (padrão 60)          |
| `DRY_RUN`               | `true` ou `false`                               |
| `LOG_LEVEL`             | `info`, `debug`, `error`                        |

## Estrutura de pastas sugerida

```
/src
  /tools          uma ferramenta por arquivo
  /brevo          cliente HTTP da API do Brevo
  /lib            filtro de cliques, retry, logger, validação
  server.ts       registro das tools e seleção de transporte
/infra            SAM ou CDK
/tests
.env.example
.gitignore
README.md
```

## Entregáveis

1. Código completo, compilando sem erros, com tipos explícitos.
2. Testes das ferramentas e, em especial, do **filtro de cliques**, cobrindo: clique abaixo do limite, acima do limite, sem entrega correspondente e clique em link que não é o do case.
3. `infra/` com o deploy na AWS pronto para `sam deploy` ou `cdk deploy`.
4. `.env.example` preenchido, com valores fictícios.
5. `.gitignore` cobrindo `.env`, `node_modules` e artefatos de build.
6. `README.md` com: o que o servidor faz, como rodar local em stdio, como fazer deploy na AWS, como configurar no `claude_desktop_config.json` (nos dois modos) e a tabela de variáveis de ambiente.
7. Um `CHANGELOG.md` inicial.

## Como proceder

1. Leia a documentação do Brevo e **me mostre um plano curto** antes de escrever o código: endpoints confirmados, formato da marcação de `lead_id` e pontos que divergirem desta especificação.
2. Aguarde meu OK.
3. Implemente em etapas: cliente do Brevo → ferramentas → transporte → infra → testes → README.
4. Ao final, rode os testes e o build, e mostre um resumo do que foi criado.

**Regras de segurança:** nunca escreva a API key real no código, em testes ou no README. Nunca faça commit do `.env`. Se precisar de um valor real para testar, peça que eu coloque no `.env` eu mesmo.
