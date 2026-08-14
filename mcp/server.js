// The stdio MCP server. It declares tools and forwards them down the socket —
// it decides nothing, because nothing under mcp/ is covered by the test suite
// (see vitest.config.ts). Any branch worth testing belongs in src/lib.

import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const SOCKET = path.join(
  os.homedir(),
  'Library/Application Support/Phase/agent.sock',
);

function ask(request) {
  return new Promise((resolve) => {
    const conn = net.connect(SOCKET);
    let buffer = '';
    conn.setEncoding('utf8');
    conn.on('connect', () => conn.write(`${JSON.stringify(request)}\n`));
    conn.on('data', (chunk) => {
      buffer += chunk;
      const cut = buffer.indexOf('\n');
      if (cut === -1) return;
      conn.end();
      resolve(buffer.slice(0, cut));
    });
    conn.on('error', () => resolve(JSON.stringify({
      ok: false,
      error: 'Phase is not running. Open Phase and try again.',
    })));
  });
}

const server = new McpServer({ name: 'phase', version: '0.1.0' });

const READS = {
  today: 'What to work on now, what slipped, and what was finished today.',
  week: 'Planned, committed-but-unplaced, and free minutes for the week.',
  backlog: 'Queued work, grouped by project.',
  list_projects: 'Every project with its percentage, remaining minutes and health.',
};

for (const [tool, description] of Object.entries(READS)) {
  server.tool(tool, description, {}, async () => ({
    content: [{ type: 'text', text: await ask({ tool }) }],
  }));
}

await server.connect(new StdioServerTransport());
