import { priceTools } from './prices.js';
import type { AnyToolDef } from './types.js';

/** Every MCP tool this server exposes, in registration order. */
export const allTools: AnyToolDef[] = [...priceTools];
