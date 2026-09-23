# MCP Brevo — e-mail e WhatsApp 1 a 1

Servidor MCP em TypeScript para enviar e-mails transacionais e mensagens de WhatsApp individuais pelo Brevo, consultar eventos de e-mail e separar cliques humanos prováveis de cliques automáticos.

O servidor não guarda o estado da cadência. O Pipedrive continua sendo a fonte de verdade para lead, etapa, datas e garantia definitiva contra duplicidade.

## Funcionalidades

| Ferramenta | Finalidade |
| --- | --- |
| `brevo_enviar_email` | Envia um e-mail individual usando template e marca `lead_id`/`etapa`. |
| `brevo_enviar_whatsapp` | Envia um WhatsApp individual usando template aprovado. |
| `brevo_listar_eventos` | Lista eventos paginados e normalizados em UTC. |
| `brevo_cliques_validos` | Separa cliques válidos de cliques suspeitos pelo tempo após a entrega. |
| `brevo_status_envio` | Retorna o histórico e o status mais recente de um `message_id` de e-mail. |

Recursos transversais:

- `stdio` para desenvolvimento local e Streamable HTTP stateless para AWS.
- Bearer token obrigatório no endpoint HTTP.
- Cache de idempotência em memória com TTL de 24 horas.
- Retry exponencial para HTTP 429, 5xx e falhas transitórias, com três tentativas no total.
- `DRY_RUN=true` para validar envios sem chamar os endpoints de envio.
- Logs JSON em `stderr`, sem chave da API nem conteúdo completo das mensagens.
- Intervalos de eventos maiores que 90 dias divididos automaticamente.

## Decisões da API Brevo

A API usada é a v3, com base `https://api.brevo.com/v3` e autenticação pelo header `api-key`.

Endpoints:

```text
POST /v3/smtp/email
POST /v3/whatsapp/sendMessage
GET  /v3/smtp/statistics/events
GET  /v3/smtp/emails
GET  /v3/smtp/emails/{uuid}
```

Os detalhes da pesquisa, diferenças da especificação inicial e referências oficiais estão em [docs/pesquisa-brevo.md](docs/pesquisa-brevo.md).

### Correlação

Os e-mails recebem a correlação de duas formas:

- `X-Mailin-custom` com um JSON compacto contendo `lead_id` e `etapa`.
- Uma tag técnica `mcp_corr_v1_<base64url>` com os mesmos dados.

O header customizado aparece em webhooks, mas não no relatório REST. A tag técnica permite reconstruir a correlação durante o polling de eventos. As tags fornecidas pelo chamador também são preservadas.

### Eventos

O Brevo recebe `startDate` e `endDate` apenas como `YYYY-MM-DD`. O MCP aceita ISO 8601 completo, busca os dias inclusivos e aplica o recorte exato em memória.

O nome `clicks` usado pela API é normalizado para `click`. O mesmo ocorre com `hardBounces`, `softBounces`, `requests` e `loadedByProxy`.

## Requisitos

- Node.js 20 ou superior.
- npm.
- Para deploy: AWS CLI, AWS SAM CLI e credenciais AWS configuradas.

O projeto usa AWS SAM porque ele oferece uma definição pequena e direta para Lambda, HTTP API, IAM e build TypeScript com esbuild.

## Instalação e validação

```bash
npm install
cp .env.example .env
npm run build
npm test
```

Nunca coloque `.env` no Git. O arquivo já está coberto pelo `.gitignore`.

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
| --- | --- | --- |
| `BREVO_API_KEY` | Sim | Chave v3 do Brevo. Em produção, vem do Secrets Manager. |
| `BREVO_SENDER_EMAIL` | Sim | Remetente verificado. |
| `BREVO_SENDER_NAME` | Sim | Nome exibido do remetente. |
| `BREVO_WHATSAPP_SENDER` | Sim | Número remetente com código do país e somente dígitos. |
| `MCP_AUTH_TOKEN` | Em HTTP | Token Bearer do próprio MCP, com pelo menos 16 caracteres. |
| `MCP_TRANSPORT` | Não | `stdio` por padrão; `http` na Lambda. |
| `CLICK_FILTER_SECONDS` | Não | Limite anti-robô, padrão `60`. |
| `DRY_RUN` | Não | `true` ou `false`; padrão `false`. |
| `LOG_LEVEL` | Não | `debug`, `info` ou `error`; padrão `info`. |
| `BREVO_SECRET_ARN` | Em produção | ARN ou nome do segredo JSON no Secrets Manager. |

O segredo de produção deve ser um objeto JSON. No mínimo:

```json
{
  "BREVO_API_KEY": "xkeysib-substitua-pela-chave-real",
  "MCP_AUTH_TOKEN": "substitua-por-um-token-longo-e-aleatorio"
}
```

Também é possível manter todas as variáveis no segredo; valores do Secrets Manager têm precedência sobre variáveis da Lambda.

## Execução local em stdio

Preencha `.env`, mantendo:

```dotenv
MCP_TRANSPORT=stdio
DRY_RUN=true
```

Depois:

```bash
npm run build
npm start
```

O processo aguardará mensagens MCP em `stdin`. Logs são enviados somente para `stderr`, pois qualquer saída comum em `stdout` corromperia o protocolo.

### Claude Desktop local

Depois de executar `npm run build`, adicione ao `claude_desktop_config.json`, substituindo os caminhos absolutos:

```json
{
  "mcpServers": {
    "brevo-envio-local": {
      "command": "/usr/bin/node",
      "args": [
        "--env-file=/caminho/absoluto/mcp-brevo-envio/.env",
        "/caminho/absoluto/mcp-brevo-envio/dist/server.js"
      ]
    }
  }
}
```

Reinicie o Claude Desktop após alterar o arquivo. Para desenvolvimento seguro, mantenha `DRY_RUN=true` até validar templates e remetentes.

## Deploy na AWS

### 1. Criar o segredo

Crie o arquivo temporário fora do repositório ou use a entrada interativa da AWS. Exemplo ilustrativo:

```bash
aws secretsmanager create-secret \
  --name mcp-brevo-envio/production \
  --secret-string '{"BREVO_API_KEY":"SUBSTITUA","MCP_AUTH_TOKEN":"SUBSTITUA_POR_TOKEN_LONGO"}'
```

Não coloque esse comando com valores reais no histórico do shell. Em produção, prefira `file://` apontando para um arquivo temporário protegido ou a interface da AWS.

### 2. Build SAM

```bash
sam build --template-file infra/template.yaml
```

O SAM usa esbuild para empacotar [src/http/lambda.ts](src/http/lambda.ts), incluindo as dependências necessárias.

### 3. Deploy

```bash
sam deploy --guided --template-file .aws-sam/build/template.yaml
```

Informe durante o assistente:

- ARN do segredo.
- E-mail e nome do remetente.
- Número remetente do WhatsApp.
- `DryRun=true` no primeiro deploy.

Um exemplo versionável está em [infra/samconfig.toml.example](infra/samconfig.toml.example). Copie-o para `infra/samconfig.toml`, ajuste os valores e não versione o arquivo resultante.

O template cria:

- Lambda ARM64 em Node.js 22.
- API Gateway HTTP API com rota `ANY /mcp`.
- Throttling de 10 requisições por segundo e burst 20.
- Permissão IAM restrita a `secretsmanager:GetSecretValue` no segredo informado.
- X-Ray ativo.

Se o segredo usar uma chave KMS gerenciada pelo cliente, acrescente `kms:Decrypt` para essa chave à role da Lambda.

### Teste HTTP

O endpoint exige Bearer token em todas as requisições:

```bash
curl -i https://SEU_API_ID.execute-api.REGIAO.amazonaws.com/mcp \
  -H 'Authorization: Bearer SEU_MCP_AUTH_TOKEN' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"teste","version":"1.0.0"}}}'
```

## Cliente remoto

Clientes MCP que aceitam Streamable HTTP e headers estáticos podem usar:

```json
{
  "mcpServers": {
    "brevo-envio-aws": {
      "type": "http",
      "url": "https://SEU_API_ID.execute-api.REGIAO.amazonaws.com/mcp",
      "headers": {
        "Authorization": "Bearer SEU_MCP_AUTH_TOKEN"
      }
    }
  }
}
```

No Claude Code, o equivalente é:

```bash
claude mcp add --transport http brevo-envio-aws \
  https://SEU_API_ID.execute-api.REGIAO.amazonaws.com/mcp \
  --header "Authorization: Bearer SEU_MCP_AUTH_TOKEN"
```

### Claude Desktop e Cowork remotos

Na experiência atual do Claude, conectores remotos são adicionados em **Customize → Connectors → Add custom connector** e são acessados pela infraestrutura da Anthropic, não pela máquina local. O endpoint deve estar publicamente acessível.

O fluxo visual de conectores remotos prioriza OAuth. Este projeto implementa o Bearer token estático exigido pela especificação original; portanto, use um cliente que permita configurar o header `Authorization`, ou adicione uma camada OAuth/gateway antes de disponibilizá-lo como conector remoto no Cowork. O modo local por `claude_desktop_config.json` não fica disponível no Cowork.

## Segurança operacional

- Gere `MCP_AUTH_TOKEN` com alta entropia e rotacione-o periodicamente.
- Não use a chave Brevo como token do MCP.
- A comparação do Bearer token usa SHA-256 e `timingSafeEqual`.
- Considere AWS WAF e allowlist dos IPs publicados pela Anthropic.
- Restrinja quem pode invocar ferramentas de envio no cliente MCP.
- Comece com `DRY_RUN=true`.
- Não registre destinatários, parâmetros de template, conteúdo ou credenciais.

O cache de idempotência é local a cada processo/contêiner Lambda. Reinícios e múltiplas instâncias não compartilham esse cache; o Pipedrive deve continuar impedindo duplicidade global.

## Estrutura

```text
src/
  brevo/       cliente HTTP, tipos e normalização de eventos
  http/        handler Lambda/API Gateway
  lib/         retry, logger, idempotência, auth e validação
  tools/       uma implementação por ferramenta e registro MCP
  app.ts       composição das dependências
  config.ts    .env e AWS Secrets Manager
  server.ts    entrada stdio
infra/         AWS SAM
tests/         testes unitários e integração MCP em memória
```

## Limitações conhecidas

- `brevo_status_envio` consulta status de e-mail. O endpoint de eventos WhatsApp não oferece filtro documentado por `messageId`.
- O relatório REST retorna `tag` no singular, embora o envio aceite várias tags. O parser tolera os formatos conhecidos, mas o comportamento deve ser confirmado com uma conta Brevo real.
- Streamable HTTP está configurado como stateless e resposta JSON, adequado a Lambda. Não há retomada de sessão nem notificações server-to-client.
- O template não cria regra WAF/IP automaticamente.

## Comandos

```bash
npm run build          # Compila src/ para dist/
npm run build:lambda   # Valida o bundle usado pela Lambda
npm test               # Executa a suíte Vitest
npm run test:watch     # Modo interativo
npm run typecheck      # Verifica também os tipos dos testes
npm start              # Inicia stdio usando o .env
```
