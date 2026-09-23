import { createHash } from "node:crypto";

interface CacheEntry<T> {
  fingerprint: string;
  expiresAt: number;
  value: T;
}

export type CacheLookup<T> =
  | { status: "miss" }
  | { status: "conflict" }
  | { status: "hit"; value: T };

export interface IdempotencyCacheOptions {
  ttlMs?: number;
  now?: () => number;
}

export class IdempotencyCache {
  private readonly entries = new Map<string, CacheEntry<unknown>>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: IdempotencyCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1_000;
    this.now = options.now ?? Date.now;

    if (!Number.isFinite(this.ttlMs) || this.ttlMs <= 0) {
      throw new RangeError("O TTL de idempotência deve ser maior que zero.");
    }
  }

  get<T>(scope: string, key: string, fingerprint: string): CacheLookup<T> {
    const cacheKey = createCacheKey(scope, key);
    const entry = this.entries.get(cacheKey);
    if (entry === undefined) {
      return { status: "miss" };
    }

    if (entry.expiresAt <= this.now()) {
      this.entries.delete(cacheKey);
      return { status: "miss" };
    }

    if (entry.fingerprint !== fingerprint) {
      return { status: "conflict" };
    }

    return { status: "hit", value: entry.value as T };
  }

  set<T>(scope: string, key: string, fingerprint: string, value: T): void {
    this.removeExpired();
    this.entries.set(createCacheKey(scope, key), {
      fingerprint,
      expiresAt: this.now() + this.ttlMs,
      value,
    });
  }

  removeExpired(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    }
  }
}

export function fingerprint(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function createCacheKey(scope: string, key: string): string {
  return `${scope}\u0000${key}`;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }

  if (typeof value === "object" && value !== null) {
    const sortedEntries = Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortValue(child)]);
    return Object.fromEntries(sortedEntries);
  }

  return value;
}
