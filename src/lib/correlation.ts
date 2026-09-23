export interface EmailCorrelation {
  lead_id: string;
  etapa: `E${1 | 2 | 3 | 4 | 5}`;
}

const CORRELATION_TAG_PREFIX = "mcp_corr_v1_";

export function createCorrelationHeader(correlation: EmailCorrelation): string {
  return JSON.stringify(correlation);
}

export function createCorrelationTag(correlation: EmailCorrelation): string {
  const encoded = Buffer.from(JSON.stringify(correlation), "utf8").toString("base64url");
  return `${CORRELATION_TAG_PREFIX}${encoded}`;
}

export function extractCorrelation(tag: string | undefined): EmailCorrelation | undefined {
  if (tag === undefined) {
    return undefined;
  }

  for (const candidate of getTagCandidates(tag)) {
    if (!candidate.startsWith(CORRELATION_TAG_PREFIX)) {
      continue;
    }

    try {
      const encoded = candidate.slice(CORRELATION_TAG_PREFIX.length);
      const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as unknown;
      if (isCorrelation(parsed)) {
        return parsed;
      }
    } catch {
      // Uma tag externa malformada não deve interromper a consulta de eventos.
    }
  }

  return undefined;
}

function getTagCandidates(tag: string): string[] {
  const trimmed = tag.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
        return parsed;
      }
    } catch {
      // Continua com os formatos separados por delimitadores.
    }
  }

  return trimmed.split(/[;,\s]+/u).filter(Boolean);
}

function isCorrelation(value: unknown): value is EmailCorrelation {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.lead_id === "string" &&
    /^E[1-5]$/u.test(typeof record.etapa === "string" ? record.etapa : "")
  );
}
