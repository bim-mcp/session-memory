import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env') });

export const config = {
  storage: (process.env.MEMORY_STORAGE || 'sqlite') as 'sqlite' | 'postgresql',
  transport: (process.env.MCP_TRANSPORT || 'stdio') as 'stdio' | 'streamable-http',
  port: parseInt(process.env.MCP_PORT || '3000', 10),
  sqlitePath: process.env.SQLITE_PATH || './data/memory.db',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://localhost:5432/memory',

  authApiKey: process.env.MCP_API_KEY || '',
  defaultUserId: process.env.DEFAULT_USER_ID || 'default',

  embeddingProvider: (process.env.EMBEDDING_PROVIDER || 'ollama') as 'ollama' | 'openai',
  embeddingDimensions: parseInt(process.env.EMBEDDING_DIMENSIONS || '1024', 10),

  ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
  ollamaModel: process.env.OLLAMA_MODEL || 'bge-m3',

  openaiApiKey: process.env.OPENAI_API_KEY || '',
  embeddingModel: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',

  maxRequestSize: process.env.MCP_MAX_REQUEST_SIZE || '10mb',

  pgPoolMin: parseInt(process.env.PG_POOL_MIN || '0', 10),
  pgPoolMax: parseInt(process.env.PG_POOL_MAX || '10', 10),
  pgIdleTimeout: parseInt(process.env.PG_IDLE_TIMEOUT || '10000', 10),

  embeddingTimeout: parseInt(process.env.EMBEDDING_TIMEOUT || '30000', 10),

  dedupThreshold: parseFloat(process.env.DEDUP_THRESHOLD || '0.95'),

  searchSelfBoost: parseFloat(process.env.SEARCH_SELF_BOOST || '0.2'),
  searchTagBoost: parseFloat(process.env.SEARCH_TAG_BOOST || '0.1'),
};
