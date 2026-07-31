import { RETRY, UEX_BASE_URL } from '../config.js';
import { RateLimiter } from './rate-limiter.js';

/** Envelope every UEX 2.0 endpoint returns. */
export interface UexEnvelope<T> {
  status: string;
  http_code?: number;
  data: T;
  message?: string;
}

/** Transport-level failure (HTTP status or repeated network errors). */
export class UexHttpError extends Error {
  constructor(
    public readonly resource: string,
    public readonly httpStatus: number | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'UexHttpError';
  }
}

/** UEX answered but with a non-"ok" semantic status (e.g. missing_id_terminal). */
export class UexApiError extends Error {
  constructor(
    public readonly resource: string,
    public readonly apiStatus: string,
    public readonly apiMessage: string,
  ) {
    super(`UEX ${resource}: ${apiStatus}${apiMessage ? ` — ${apiMessage}` : ''}`);
    this.name = 'UexApiError';
  }
}

export type QueryParams = Record<string, string | number | boolean | undefined>;

export interface UexClientOptions {
  token?: string | undefined;
  baseUrl?: string;
  fetchFn?: typeof fetch;
  rateLimiter?: RateLimiter;
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export class UexClient {
  private readonly token: string | undefined;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly rateLimiter: RateLimiter | undefined;
  private readonly attempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(options: UexClientOptions = {}) {
    this.token = options.token;
    this.baseUrl = options.baseUrl ?? UEX_BASE_URL;
    this.fetchFn = options.fetchFn ?? fetch;
    this.rateLimiter = options.rateLimiter;
    this.attempts = options.attempts ?? RETRY.attempts;
    this.baseDelayMs = options.baseDelayMs ?? RETRY.baseDelayMs;
    this.maxDelayMs = options.maxDelayMs ?? RETRY.maxDelayMs;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.random = options.random ?? Math.random;
  }

  async get<T>(resource: string, params?: QueryParams): Promise<T> {
    const url = this.buildUrl(resource, params);
    let lastError: unknown;

    for (let attempt = 0; attempt < this.attempts; attempt++) {
      if (attempt > 0) {
        const backoff = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** (attempt - 1));
        await this.sleep(backoff * (0.5 + this.random()));
      }
      await this.rateLimiter?.acquire();

      let response: Response;
      try {
        response = await this.fetchFn(url, {
          headers: this.token ? { authorization: `Bearer ${this.token}` } : {},
        });
      } catch (err) {
        lastError = err;
        continue; // network error → retry
      }

      if (response.status === 429 || response.status >= 500) {
        lastError = new UexHttpError(resource, response.status, `UEX ${resource}: HTTP ${response.status}`);
        continue;
      }
      if (!response.ok) {
        throw new UexHttpError(resource, response.status, `UEX ${resource}: HTTP ${response.status}`);
      }

      const envelope = (await response.json()) as UexEnvelope<T>;
      if (envelope.status !== 'ok') {
        throw new UexApiError(resource, envelope.status, envelope.message ?? '');
      }
      return envelope.data;
    }

    if (lastError instanceof UexHttpError) throw lastError;
    throw new UexHttpError(resource, undefined, `UEX ${resource}: network failure — ${String(lastError)}`);
  }

  private buildUrl(resource: string, params?: QueryParams): string {
    const url = new URL(`${this.baseUrl}/${resource}`);
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url.toString();
  }
}
