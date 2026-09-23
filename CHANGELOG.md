# Changelog

Todas as mudanças relevantes deste projeto serão registradas neste arquivo.

## [0.1.0] - 2026-09-23

### Adicionado

- Cliente tipado para a API Brevo v3.
- Envio transacional individual de e-mail e WhatsApp.
- Consulta paginada e normalização de eventos de e-mail.
- Correlação por `X-Mailin-custom` e tag técnica.
- Filtro anti-robô para cliques.
- Consulta de status por `message_id`.
- Idempotência em memória com TTL e detecção de conflito.
- Retry exponencial para 429, 5xx e erros transitórios.
- Modo `DRY_RUN`.
- Logs JSON sanitizados.
- Transportes stdio e Streamable HTTP stateless.
- Autenticação Bearer com comparação em tempo constante.
- Leitura de segredos pelo AWS Secrets Manager.
- Infraestrutura AWS SAM para Lambda e API Gateway HTTP API.
- Testes unitários e integração MCP em memória.
- Documentação da pesquisa, execução local e deploy.
