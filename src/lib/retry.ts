export interface RetryOptions {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  jitterRatio: number;
}

export const DEFAULT_RETRY_OPTIONS: Readonly<RetryOptions> = {
  maxAttempts: 3,
  initialDelayMs: 250,
  maxDelayMs: 5_000,
  jitterRatio: 0.2,
};

export type Sleep = (milliseconds: number) => Promise<void>;

export const sleep: Sleep = async (milliseconds) => {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
};

export function calculateBackoffMs(
  failedAttempt: number,
  options: RetryOptions,
  random: () => number = Math.random,
): number {
  const exponential = Math.min(
    options.maxDelayMs,
    options.initialDelayMs * 2 ** (failedAttempt - 1),
  );
  const jitter = exponential * options.jitterRatio * random();
  return Math.round(Math.min(options.maxDelayMs, exponential + jitter));
}

export function parseRetryAfterMs(
  value: string | null,
  now: () => number = Date.now,
): number | undefined {
  if (value === null) {
    return undefined;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1_000);
  }

  const date = Date.parse(value);
  if (Number.isNaN(date)) {
    return undefined;
  }

  return Math.max(0, date - now());
}
