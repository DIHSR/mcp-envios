export interface BrevoErrorDetails {
  status: number;
  code?: string;
  response?: unknown;
  retryable: boolean;
}

export class BrevoApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly response: unknown;
  readonly retryable: boolean;

  constructor(message: string, details: BrevoErrorDetails) {
    super(message);
    this.name = "BrevoApiError";
    this.status = details.status;
    this.code = details.code;
    this.response = details.response;
    this.retryable = details.retryable;
  }
}

export class BrevoTransportError extends Error {
  readonly retryable: boolean;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BrevoTransportError";
    this.retryable = true;
  }
}
