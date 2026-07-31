import { describe, expect, it } from 'vitest';
import { UexApiError, UexClient, UexHttpError } from '../src/uex/client.js';

type FetchCall = { url: string; headers: Record<string, string> };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeClient(responses: Array<Response | Error>, opts: { token?: string } = {}) {
  const calls: FetchCall[] = [];
  const sleeps: number[] = [];
  const client = new UexClient({
    token: opts.token ?? 'test-token',
    fetchFn: async (url, init) => {
      calls.push({
        url: String(url),
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
      });
      const next = responses.shift();
      if (!next) throw new Error('unexpected extra fetch call');
      if (next instanceof Error) throw next;
      return next;
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 0.5,
  });
  return { client, calls, sleeps };
}

describe('UexClient', () => {
  it('sends bearer auth and builds the URL with query params', async () => {
    const { client, calls } = makeClient([jsonResponse({ status: 'ok', data: [1] })]);
    const data = await client.get<number[]>('commodities_prices', { id_commodity: 47 });
    expect(data).toEqual([1]);
    expect(calls[0]?.url).toBe('https://api.uexcorp.uk/2.0/commodities_prices?id_commodity=47');
    expect(calls[0]?.headers['authorization']).toBe('Bearer test-token');
  });

  it('retries on 5xx with exponential backoff, then succeeds', async () => {
    const { client, calls, sleeps } = makeClient([
      jsonResponse({}, 500),
      jsonResponse({}, 502),
      jsonResponse({ status: 'ok', data: 'fine' }),
    ]);
    const data = await client.get<string>('game_versions');
    expect(data).toBe('fine');
    expect(calls).toHaveLength(3);
    // base 500ms * 2^n, jitter factor fixed at 1.0 via random()=0.5
    expect(sleeps).toEqual([500, 1000]);
  });

  it('retries on network errors', async () => {
    const { client } = makeClient([
      new TypeError('fetch failed'),
      jsonResponse({ status: 'ok', data: 42 }),
    ]);
    await expect(client.get<number>('game_versions')).resolves.toBe(42);
  });

  it('gives up after the configured attempts', async () => {
    const { client, calls } = makeClient([
      jsonResponse({}, 500),
      jsonResponse({}, 500),
      jsonResponse({}, 500),
    ]);
    await expect(client.get('game_versions')).rejects.toBeInstanceOf(UexHttpError);
    expect(calls).toHaveLength(3);
  });

  it('does not retry on 4xx client errors', async () => {
    const { client, calls } = makeClient([jsonResponse({}, 400)]);
    await expect(client.get('game_versions')).rejects.toBeInstanceOf(UexHttpError);
    expect(calls).toHaveLength(1);
  });

  it('throws UexApiError with the API status when status is not ok', async () => {
    const { client } = makeClient([
      jsonResponse({ status: 'missing_id_terminal', data: null, message: '' }),
    ]);
    const err = await client.get('commodities_prices_history').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UexApiError);
    expect((err as UexApiError).apiStatus).toBe('missing_id_terminal');
  });

  it('omits undefined params from the query string', async () => {
    const { client, calls } = makeClient([jsonResponse({ status: 'ok', data: [] })]);
    await client.get('terminals', { id_star_system: 68, type: undefined });
    expect(calls[0]?.url).toBe('https://api.uexcorp.uk/2.0/terminals?id_star_system=68');
  });
});
