import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { BrevoApiError, BrevoTransportError } from "../brevo/errors.js";
import type { Logger } from "../lib/logger.js";

export interface ToolFailure {
  ok: false;
  codigo: string;
  mensagem: string;
  resposta_brevo?: unknown;
}

export type ToolSuccess<T extends object> = { ok: true } & T;
export type ToolOutcome<T extends object> = ToolSuccess<T> | ToolFailure;

export async function executeTool<T extends object>(
  toolName: string,
  logger: Logger,
  operation: () => Promise<ToolSuccess<T>>,
  leadId?: string,
): Promise<ToolOutcome<T>> {
  const startedAt = performance.now();
  try {
    const result = await operation();
    logger.log("info", "ferramenta_concluida", {
      ferramenta: toolName,
      lead_id: leadId,
      duracao_ms: Math.round(performance.now() - startedAt),
      resultado: "sucesso",
    });
    return result;
  } catch (error: unknown) {
    const failure = toToolFailure(error);
    logger.log("error", "ferramenta_concluida", {
      ferramenta: toolName,
      lead_id: leadId,
      duracao_ms: Math.round(performance.now() - startedAt),
      resultado: "erro",
      codigo: failure.codigo,
    });
    return failure;
  }
}

export function toMcpToolResult(outcome: ToolOutcome<object>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(outcome) }],
    structuredContent: { ...outcome },
    ...(outcome.ok ? {} : { isError: true }),
  };
}

function toToolFailure(error: unknown): ToolFailure {
  if (error instanceof BrevoApiError) {
    return {
      ok: false,
      codigo: error.code === undefined ? `BREVO_HTTP_${error.status}` : `BREVO_${error.code}`,
      mensagem: error.message,
      ...(error.response === undefined ? {} : { resposta_brevo: sanitize(error.response) }),
    };
  }

  if (error instanceof BrevoTransportError) {
    return {
      ok: false,
      codigo: "BREVO_INDISPONIVEL",
      mensagem: "Não foi possível comunicar com a API do Brevo após as tentativas previstas.",
    };
  }

  if (error instanceof RangeError || error instanceof TypeError) {
    return { ok: false, codigo: "ENTRADA_INVALIDA", mensagem: error.message };
  }

  return {
    ok: false,
    codigo: "ERRO_INTERNO",
    mensagem: "Não foi possível concluir a operação.",
  };
}

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitize);
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !/api[-_]?key|authorization|token|secret/iu.test(key))
        .map(([key, child]) => [key, sanitize(child)]),
    );
  }

  return value;
}
