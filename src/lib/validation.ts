const ISO_WITH_TIMEZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;
const PHONE_CHARACTERS = /^[+\d\s().-]+$/u;

export function isIsoDateTime(value: string): boolean {
  return ISO_WITH_TIMEZONE.test(value) && !Number.isNaN(Date.parse(value));
}

export function toUtcIso(value: string): string {
  return new Date(value).toISOString();
}

export function normalizePhone(value: string): string {
  const trimmed = value.trim();
  if (!PHONE_CHARACTERS.test(trimmed)) {
    throw new TypeError(
      "Telefone inválido. Informe um número E.164 com código do país, sem ramal ou letras.",
    );
  }

  const digits = trimmed.replace(/\D/gu, "");
  if (!/^[1-9]\d{7,14}$/u.test(digits)) {
    throw new TypeError(
      "Telefone inválido. O número deve conter de 8 a 15 dígitos, incluindo o código do país.",
    );
  }

  return digits;
}
