#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createContext } from './context.js';
import { allTools } from './tools/index.js';
import { runTool } from './tools/types.js';

async function main(): Promise<void> {
  const ctx = createContext();
  const server = new McpServer({ name: 'sc-trade-intel', version: '0.1.0' });

  for (const tool of allTools) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      async (args: Record<string, unknown>) => {
        const result = await runTool(tool, ctx, args as never);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          isError: !result.ok,
        };
      },
    );
  }

  await server.connect(new StdioServerTransport());
  // stdout belongs to the MCP transport; log to stderr only.
  console.error(`sc-trade-intel: ${allTools.length} tools registered`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
