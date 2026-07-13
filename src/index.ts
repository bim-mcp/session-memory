import express from 'express';
import type { Server as HttpServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { config } from './config.js';
import { createStorageAdapter } from './storage/factory.js';
import type { StorageAdapter } from './storage/types.js';
import { createServer } from './server.js';
import { runWithContext } from './context.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));

function printHelp(): void {
  console.log(`session-memory v${pkg.version} - MCP Server for shared memory across AI agents

Usage:
  node dist/index.js

Environment variables:
  MEMORY_STORAGE           Storage backend (sqlite | postgresql) [default: sqlite]
  MCP_TRANSPORT            Transport (stdio | streamable-http) [default: stdio]
  MCP_PORT                 HTTP port for streamable-http [default: 3000]
  MCP_MAX_REQUEST_SIZE     Body size limit [default: 10mb]
  MCP_API_KEY              API key for HTTP auth (empty = no auth)

  DEFAULT_USER_ID          Default user identity [default: default]
  SQLITE_PATH              SQLite path [default: ./data/memory.db]
  DATABASE_URL             PostgreSQL connection string
  EMBEDDING_PROVIDER       Embedding provider (ollama | openai) [default: ollama]
  EMBEDDING_DIMENSIONS     Vector dimensions [default: 1024]
  EMBEDDING_TIMEOUT        Embedding request timeout ms [default: 30000]
  DEDUP_THRESHOLD          Semantic dedup threshold (0 = off) [default: 0.95]
  SEARCH_SELF_BOOST        Score boost for own memories [default: 0.2]
  SEARCH_TAG_BOOST         Score boost for tag match [default: 0.1]
  OLLAMA_URL               Ollama server [default: http://localhost:11434]
  OLLAMA_MODEL             Ollama model [default: bge-m3]
  OPENAI_API_KEY           OpenAI API key (for openai provider)
  PG_POOL_MIN              PostgreSQL min pool connections [default: 0]
  PG_POOL_MAX              PostgreSQL max pool connections [default: 10]
  PG_IDLE_TIMEOUT          PostgreSQL idle timeout ms [default: 10000]
`);
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp();
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

  let httpServer: HttpServer | undefined;

  async function shutdown() {
    console.error('Shutting down...');
    try {
      await server.close();
    } catch { /* ignore */ }
    try {
      await adapter.close();
    } catch { /* ignore */ }
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
    }
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

    app.use((req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        const duration = Date.now() - start;
        const userId = (req.headers['x-user-id'] as string) || '-';
        console.error(`[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} ${duration}ms user:${userId}`);
      });
      next();
    });

    app.use((_req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-User-Id');
      if (_req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
      next();
    });

    app.get('/health', async (_req, res) => {
      const stats = await adapter.getStats();
      res.json({
        status: 'ok',
        version: pkg.version,
        storage: config.storage,
        adapter: adapter.isAvailable() ? 'available' : 'unavailable',
        uptime: stats.uptime,
        sessionCount: stats.sessionCount,
        messageCount: stats.messageCount,
        memoryCount: stats.memoryCount,
      });
    });

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    });

    await server.connect(transport);

    app.all('/mcp', async (req, res) => {
      const authHeader = req.headers.authorization;
      if (config.authApiKey) {
        if (!authHeader || authHeader !== `Bearer ${config.authApiKey}`) {
          res.status(401).json({ error: 'Unauthorized. Provide MCP_API_KEY in Authorization header.' });
          return;
        }
      }

      const userId = (req.headers['x-user-id'] as string) || config.defaultUserId;

      await runWithContext({ userId }, async () => {
        await transport.handleRequest(req, res, req.body);
      });
    });

    httpServer = app.listen(config.port, () => {
      console.error(`session-memory MCP server v${pkg.version} running at http://localhost:${config.port}/mcp`);
    });
  }
}

main().catch((err) => {
  console.error('Fatal error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
