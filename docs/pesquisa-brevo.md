# Pesquisa técnica — API Brevo v3

Data da consulta: 23 de setembro de 2026.

Este documento registra as decisões tomadas antes da implementação do MCP Server. A fonte principal é a documentação oficial do Brevo; os modelos gerados nos SDKs oficiais foram usados para esclarecer campos que aparecem recolhidos na interface da referência.

## Base da API e autenticação

- Base URL: `https://api.brevo.com/v3`.
- Versão confirmada: v3.
- Autenticação: header HTTP `api-key` em todas as chamadas.
- Requisições e respostas usam JSON.
- A chave deve vir de `.env` somente no desenvolvimento local e do AWS Secrets Manager em produção.
- A chave nunca deve aparecer em logs, mensagens de erro, testes ou documentação.

Referências:

- https://developers.brevo.com/docs/how-it-works
- https://developers.brevo.com/docs/api-key-authentication

## Envio de e-mail transacional

Endpoint confirmado:

```text
POST /v3/smtp/email
```

Para envio baseado em template, os campos relevantes são:

- `templateId`: número do template.
- `to`: array de destinatários no formato `{ email, name? }`.
- `sender`: `{ email, name? }`; o remetente do template também pode ser usado pelo Brevo.
- `params`: objeto com variáveis do template.
- `tags`: array de strings.
- `headers`: mapa de headers customizados incorporados ao e-mail.

Resposta de sucesso: HTTP 201 com `messageId` e, em alguns modos de envio, `messageIds`.

Referência: https://developers.brevo.com/reference/send-transac-email

## Marcação e correlação com o Pipedrive

O envio aceita o header customizado `X-Mailin-custom`. Webhooks transacionais do Brevo podem devolver esse campo e também um array `tags`.

Entretanto, o endpoint REST usado para consultar eventos não devolve `X-Mailin-custom`; seu modelo retorna apenas um campo opcional `tag`, no singular. Por isso, somente o header customizado não atende ao fluxo de polling solicitado.

Decisão de implementação:

1. Enviar `lead_id` e `etapa` como JSON compacto em `X-Mailin-custom`.
2. Adicionar uma tag técnica determinística e codificada que contenha os mesmos dados.
3. Preservar as tags funcionais passadas pelo chamador.
4. Na consulta REST, extrair a correlação da tag técnica.
5. Documentar que webhooks conseguem usar diretamente `X-Mailin-custom`, enquanto o polling depende da tag técnica.

Risco identificado: a referência do endpoint de eventos descreve apenas `tag: string`, embora o envio aceite várias tags. Os parsers serão tolerantes a uma string isolada, lista serializada e tags concatenadas. Essa diferença deve ser validada futuramente contra uma conta Brevo real, sem colocar credenciais nos testes automatizados.

Referências:

- https://developers.brevo.com/reference/send-transac-email
- https://developers.brevo.com/docs/transactional-webhooks
- https://github.com/getbrevo/brevo-go/blob/main/docs/GetEmailEventReportEvents.md

## Envio transacional de WhatsApp

Endpoint confirmado:

```text
POST /v3/whatsapp/sendMessage
```

Campos do envio com template:

- `templateId`: identificador numérico do template aprovado.
- `senderNumber`: número do remetente com código do país, sem espaços ou símbolos.
- `contactNumbers`: array de destinatários; o MCP enviará apenas um por chamada.
- `params`: objeto de atributos do template, conforme o modelo oficial do SDK.

Resposta de sucesso: HTTP 201 com `messageId` UUID.

O número precisa ser enviado somente com dígitos e código do país. A camada MCP fará a normalização e validará o formato E.164 antes de chamar o cliente.

Referências:

- https://developers.brevo.com/reference/send-whatsapp-message
- https://developers.brevo.com/docs/whatsapp-messages
- https://github.com/getbrevo/brevo-csharp/blob/master/docs/SendWhatsappMessage.md

## Eventos transacionais de e-mail

Endpoint confirmado:

```text
GET /v3/smtp/statistics/events
```

Parâmetros relevantes:

- `limit`: de 0 a 5.000, padrão do Brevo 2.500.
- `offset`: início da página.
- `startDate` e `endDate`: datas no formato `YYYY-MM-DD`.
- `days`: alternativa ao intervalo de datas, máximo de 90 dias.
- `email`, `event`, `tags`, `messageId`, `templateId` e `sort`.

Campos relevantes dos eventos:

- `email`, `date`, `messageId` e `event`.
- `subject`, `reason`, `tag`, `ip`, `link`, `from` e `templateId` opcionais.

Valores documentados para o filtro `event`:

```text
bounces, hardBounces, softBounces, delivered, spam, requests,
opened, clicks, invalid, deferred, blocked, unsubscribed, error,
loadedByProxy
```

Diferença importante: a ferramenta MCP usa nomes amigáveis como `click` no singular, mas a API de relatório usa `clicks`. A camada de ferramenta fará essa tradução e normalizará o valor devolvido para `click`.

Diferenças adicionais em relação à especificação do projeto:

- O MCP recebe instantes ISO 8601 completos; o Brevo aceita somente datas neste endpoint. O cliente consultará dias inclusivos, e a ferramenta filtrará o intervalo exato em memória.
- O MCP aceita vários eventos por chamada; o Brevo aceita um único filtro `event`. Para evitar duplicidade e várias paginações, a ferramenta buscará o período e filtrará os tipos localmente.
- A API limita cada intervalo a 90 dias. Intervalos maiores precisarão ser divididos em janelas de até 90 dias.

Referência: https://developers.brevo.com/reference/get-email-event-report

## Consulta de mensagem e status

Há três recursos relevantes:

```text
GET /v3/smtp/statistics/events?messageId=...
GET /v3/smtp/emails?messageId=...
GET /v3/smtp/emails/{uuid}
```

O primeiro devolve os eventos de um `messageId` e será a fonte principal para `brevo_status_envio`. O segundo resolve um `messageId` para o UUID interno. O terceiro devolve conteúdo e histórico detalhado do e-mail pelo UUID.

O status de WhatsApp não será inferido pelo endpoint de e-mail. O relatório de WhatsApp disponível em `GET /v3/whatsapp/statistics/events` não documenta filtro por `messageId`; uma ampliação futura pode paginar e filtrar localmente.

Referências:

- https://developers.brevo.com/reference/get-email-event-report
- https://developers.brevo.com/reference/get-transac-emails-list
- https://developers.brevo.com/reference/get-transac-email-content
- https://developers.brevo.com/reference/get-whatsapp-event-report

## Rate limit, retry e erros

O cliente implementará até três tentativas no total para:

- HTTP 429.
- HTTP 5xx.
- falhas transitórias de transporte, exceto cancelamento explícito.

O atraso será exponencial, respeitando `Retry-After` quando presente, com limite máximo configurável. Erros 4xx, exceto 429, não serão repetidos.

As respostas de erro do Brevo variam, mas normalmente incluem `code` e `message`. O cliente preservará detalhes seguros em um erro tipado sem incluir headers de autenticação nem o corpo da requisição.

## Idempotência

O requisito do projeto é um cache em memória com TTL padrão de 24 horas nas ferramentas de envio. Essa proteção funciona durante a vida da instância, mas não é garantia global em AWS Lambda e não substitui o estado definitivo no Pipedrive.

O Brevo documenta `Idempotency-Key` entre os headers customizados do e-mail, mas isso representa um header do e-mail, não uma garantia suficiente para o fluxo MCP. A implementação não dependerá desse comportamento para impedir duplicidade.

## Plano de implementação aprovado

1. Cliente HTTP tipado do Brevo, retry e erros seguros.
2. Validação, correlação, idempotência, filtro de cliques e ferramentas MCP.
3. Transporte stdio e Streamable HTTP com autenticação Bearer.
4. AWS SAM, Lambda, HTTP API e Secrets Manager.
5. Testes completos, build, README e CHANGELOG.
