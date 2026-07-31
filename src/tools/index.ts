import { miningTools } from './mining.js';
import { priceTools } from './prices.js';
import { routeTools } from './routes.js';
import { trustTools } from './trust.js';
import type { AnyToolDef } from './types.js';

/** Every MCP tool this server exposes, in registration order. */
export const allTools: AnyToolDef[] = [...priceTools, ...routeTools, ...miningTools, ...trustTools];
