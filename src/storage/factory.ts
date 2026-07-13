import { config } from '../config.js';
import { createEmbeddingProvider } from '../embedding/factory.js';
import type { StorageAdapter } from './types.js';

export async function createStorageAdapter(): Promise<StorageAdapter> {
  switch (config.storage) {
    case 'sqlite': {
      const { SqliteAdapter } = await import('./sqlite-adapter.js');
      return new SqliteAdapter(config.sqlitePath);
    }
    case 'postgresql': {
      const { PostgresAdapter } = await import('./postgres-adapter.js');
      const embeddingProvider = await createEmbeddingProvider();
      const adapter = new PostgresAdapter(config.databaseUrl, embeddingProvider);

      try {
        await adapter.initialize();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Failed to initialize PostgreSQL adapter: ${message}. ` +
          'Check DATABASE_URL and ensure PostgreSQL is running with pgvector extension enabled.'
        );
      }

      return adapter;
    }
    default:
      throw new Error(`Unknown storage type: ${config.storage}. Use 'sqlite' or 'postgresql'.`);
  }
}
