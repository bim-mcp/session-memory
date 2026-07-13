import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { config } from './config.js';
import { createStorageAdapter } from './storage/factory.js';
import type { StorageAdapter } from './storage/types.js';
import { createServer } from './server.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`session-memory v${pkg.version} - MCP Server for shared memory across AI agents

Usage:
  node dist/index.js

Environment variables:
  MEMORY_STORAGE           Storage backend (sqlite | postgresql) [default: sqlite]
  MCP_TRANSPORT            Transport (stdio | streamable-http) [default: stdio]
  MCP_PORT                 HTTP port for streamable-http [default: 3000]
  MCP_MAX_REQUEST_SIZE     Body size limit [default: 10mb]
  SQLITE_PATH              SQLite path [default: ./data/memory.db]
  DATABASE_URL             PostgreSQL connection string
  EMBEDDING_PROVIDER       Embedding provider (ollama | openai) [default: ollama]
  EMBEDDING_DIMENSIONS     Vector dimensions [default: 1024]
  OLLAMA_URL               Ollama server [default: http://localhost:11434]
  OLLAMA_MODEL             Ollama model [default: bge-m3]
  OPENAI_API_KEY           OpenAI API key (for openai provider)
  PG_POOL_MIN              PostgreSQL min pool connections [default: 0]
  PG_POOL_MAX              PostgreSQL max pool connections [default: 10]
  PG_IDLE_TIMEOUT          PostgreSQL idle timeout ms [default: 10000]
`);
    process.exit(0);
  }

  let adapter: StorageAdapter;

  try {
    adapter = await createStorageAdapter();
  } catch (err) {
    console.error('Failed to create storage adapter:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  if (!adapter.isAvailable()) {
    console.error('Storage adapter is not available. Check your configuration.');
    process.exit(1);
  }

  const server: McpServer = createServer(adapter, pkg.version);

  async function shutdown() {
    console.error('Shutting down...');
    try {
      await server.close();
    } catch { /* ignore */ }
    try {
      await adapter.close();
    } catch { /* ignore */ }
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  if (config.transport === 'stdio') {
    const transport = new StdioServerTransport();
    console.error(`Starting session-memory MCP server v${pkg.version} (stdio)...`);
    await server.connect(transport);
  } else {
    const app = express();
    app.use(express.json({ limit: config.maxRequestSize }));

    app.use((_req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      if (_req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
      next();
    });

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    });

    await server.connect(transport);

    app.all('/mcp', async (req, res) => {
      await transport.handleRequest(req, res, req.body);
    });

    app.listen(config.port, () => {
      console.error(`session-memory MCP server v${pkg.version} running at http://localhost:${config.port}/mcp`);
    });
  }
}

main().catch((err) => {
  console.error('Fatal error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
