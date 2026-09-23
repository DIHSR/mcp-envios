import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { ToolDependencies } from "./dependencies.js";
import { cliquesValidosSchema, createCliquesValidosHandler } from "./cliques-validos.js";
import { createEnviarEmailHandler, enviarEmailSchema } from "./enviar-email.js";
import { createEnviarWhatsAppHandler, enviarWhatsAppSchema } from "./enviar-whatsapp.js";
import { createListarEventosHandler, listarEventosSchema } from "./listar-eventos.js";
import { toMcpToolResult } from "./result.js";
import { createStatusEnvioHandler, statusEnvioSchema } from "./status-envio.js";

export function registerBrevoTools(server: McpServer, dependencies: ToolDependencies): void {
  const sendEmail = createEnviarEmailHandler(dependencies);
  const sendWhatsApp = createEnviarWhatsAppHandler(dependencies);
  const listEvents = createListarEventosHandler(dependencies);
  const validClicks = createCliquesValidosHandler(dependencies);
  const getStatus = createStatusEnvioHandler(dependencies);

  server.registerTool(
    "brevo_enviar_email",
    {
      title: "Enviar e-mail transacional pelo Brevo",
      description:
        "Envia um e-mail individual a partir de um template Brevo e o correlaciona com lead e etapa.",
      inputSchema: enviarEmailSchema,
    },
    async (input) => toMcpToolResult(await sendEmail(input)),
  );

  server.registerTool(
    "brevo_enviar_whatsapp",
    {
      title: "Enviar WhatsApp transacional pelo Brevo",
      description: "Envia uma mensagem individual usando um template de WhatsApp aprovado.",
      inputSchema: enviarWhatsAppSchema,
    },
    async (input) => toMcpToolResult(await sendWhatsApp(input)),
  );

  server.registerTool(
    "brevo_listar_eventos",
    {
      title: "Listar eventos transacionais do Brevo",
      description: "Lista e normaliza entregas, cliques, aberturas e falhas de e-mails.",
      inputSchema: listarEventosSchema,
    },
    async (input) => toMcpToolResult(await listEvents(input)),
  );

  server.registerTool(
    "brevo_cliques_validos",
    {
      title: "Classificar cliques válidos",
      description: "Separa cliques humanos prováveis de cliques rápidos suspeitos de automação.",
      inputSchema: cliquesValidosSchema,
    },
    async (input) => toMcpToolResult(await validClicks(input)),
  );

  server.registerTool(
    "brevo_status_envio",
    {
      title: "Consultar status de envio",
      description: "Consulta o histórico e o status mais recente de um message_id de e-mail.",
      inputSchema: statusEnvioSchema,
    },
    async (input) => toMcpToolResult(await getStatus(input)),
  );
}
