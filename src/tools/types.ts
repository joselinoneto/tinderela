import { z } from 'zod';
import type { AppContext } from '../domain/data.js';
import { QuotaExceededError } from '../uex/rate-limiter.js';
import { UexApiError, UexHttpError } from '../uex/client.js';

export type ToolErrorCode =
  | 'INVALID_INPUT'
  | 'ENTITY_NOT_FOUND'
  | 'AMBIGUOUS_ENTITY'
  | 'UEX_API_ERROR'
  | 'UEX_HTTP_ERROR'
  | 'QUOTA_EXCEEDED'
  | 'NO_DATA'
  | 'INTERNAL';

export interface ToolMeta {
  source: 'UEX';
  /** Game version the underlying records report, when they carry one. */
  game_version: string | null;
  /** Seconds since this server fetched the data from UEX (cache age). */
  data_age_seconds: number | null;
  /** ISO timestamp of that fetch. */
  fetched_at: string | null;
  /** True when UEX was unreachable and an expired cache entry was served. */
  stale: boolean;
  notes: string[];
}

export type ToolResult<T> =
  | { ok: true; data: T; meta: ToolMeta }
  | { ok: false; error: { code: ToolErrorCode; message: string; details?: unknown } };

export interface ToolDef<Shape extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  /** One-liner written for an LLM caller. */
  description: string;
  inputSchema: Shape;
  handler: (
    ctx: AppContext,
    input: z.objectOutputType<Shape, z.ZodTypeAny>,
  ) => Promise<ToolResult<unknown>>;
}

/** Type-erased ToolDef so heterogeneous tools can live in one registry. */
export interface AnyToolDef {
  name: string;
  description: string;
  inputSchema: z.ZodRawShape;
  handler: (ctx: AppContext, input: never) => Promise<ToolResult<unknown>>;
}

export function defineTool<Shape extends z.ZodRawShape>(def: ToolDef<Shape>): ToolDef<Shape> {
  return def;
}

export function ok<T>(data: T, meta: Partial<ToolMeta>): ToolResult<T> {
  return {
    ok: true,
    data,
    meta: {
      source: 'UEX',
      game_version: meta.game_version ?? null,
      data_age_seconds: meta.data_age_seconds ?? null,
      fetched_at: meta.fetched_at ?? null,
      stale: meta.stale ?? false,
      notes: meta.notes ?? [],
    },
  };
}

export function fail(code: ToolErrorCode, message: string, details?: unknown): ToolResult<never> {
  return details === undefined
    ? { ok: false, error: { code, message } }
    : { ok: false, error: { code, message, details } };
}

export function metaFromCache(cached: { fetchedAt: number; ageSeconds: number; stale: boolean }): {
  data_age_seconds: number;
  fetched_at: string;
  stale: boolean;
} {
  return {
    data_age_seconds: cached.ageSeconds,
    fetched_at: new Date(cached.fetchedAt * 1000).toISOString(),
    stale: cached.stale,
  };
}

/** Runs a tool handler, mapping known failures to explicit error objects. */
export async function runTool(
  tool: AnyToolDef,
  ctx: AppContext,
  input: unknown,
): Promise<ToolResult<unknown>> {
  try {
    const parsed = z.object(tool.inputSchema).parse(input);
    return await tool.handler(ctx, parsed as never);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return fail('INVALID_INPUT', `invalid input for ${tool.name}`, err.issues);
    }
    if (err instanceof QuotaExceededError) {
      return fail('QUOTA_EXCEEDED', err.message);
    }
    if (err instanceof UexApiError) {
      return fail('UEX_API_ERROR', err.message, { apiStatus: err.apiStatus, resource: err.resource });
    }
    if (err instanceof UexHttpError) {
      return fail('UEX_HTTP_ERROR', err.message, { httpStatus: err.httpStatus, resource: err.resource });
    }
    return fail('INTERNAL', err instanceof Error ? err.message : String(err));
  }
}
