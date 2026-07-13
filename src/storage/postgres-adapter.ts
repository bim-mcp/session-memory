import pg from 'pg';
import crypto from 'node:crypto';
import { getCurrentUserId } from '../context.js';
import { config } from '../config.js';
import type { EmbeddingProvider } from '../embedding/types.js';
import type { StorageAdapter, Session, Message, MemoryEntry, MemorySearchResult, StorageStats } from './types.js';

const { Pool } = pg;

export class PostgresAdapter implements StorageAdapter {
  private pool: pg.Pool;
  private embeddingProvider: EmbeddingProvider;
  private initialized = false;

  constructor(databaseUrl: string, embeddingProvider: EmbeddingProvider) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      min: config.pgPoolMin,
      max: config.pgPoolMax,
      idleTimeoutMillis: config.pgIdleTimeout,
    });
    this.embeddingProvider = embeddingProvider;
  }

  async initialize(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('CREATE EXTENSION IF NOT EXISTS vector');

      await client.query(`
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL DEFAULT '',
          user_id TEXT NOT NULL DEFAULT '',
          tags TEXT[] NOT NULL DEFAULT '{}',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS messages (
          id SERIAL PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          metadata JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS memory_embeddings (
          id UUID PRIMARY KEY,
          session_id TEXT NOT NULL,
          user_id TEXT NOT NULL DEFAULT '',
          content TEXT NOT NULL,
          tags TEXT[] NOT NULL DEFAULT '{}',
          embedding vector(${this.embeddingProvider.dimensions}),
          metadata JSONB,
          version INT NOT NULL DEFAULT 1,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_memory_embeddings_session_id ON memory_embeddings(session_id)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_memory_embeddings_embedding ON memory_embeddings USING ivfflat (embedding vector_cosine_ops)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id)
      `);
      this.initialized = true;
    } finally {
      client.release();
    }
  }

  isAvailable(): boolean {
    return this.initialized;
  }

  async createSession(id?: string, title?: string, tags?: string[]): Promise<Session> {
    const sessionId = id || crypto.randomUUID();
    const userId = getCurrentUserId();
    const now = new Date().toISOString();

    await this.pool.query(
      `INSERT INTO sessions (id, title, user_id, tags, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET updated_at = $6`,
      [sessionId, title || '', userId, tags || [], now, now]
    );

    return { id: sessionId, title: title || '', userId, tags: tags || [], createdAt: now, updatedAt: now };
  }

  async getSession(sessionId: string): Promise<Session | null> {
    const result = await this.pool.query('SELECT * FROM sessions WHERE id = $1', [sessionId]);
    if (result.rows.length === 0) return null;
    return this.mapSession(result.rows[0]);
  }

  async listSessions(limit = 50, offset = 0): Promise<Session[]> {
    const result = await this.pool.query(
      'SELECT * FROM sessions ORDER BY updated_at DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    );
    return result.rows.map(r => this.mapSession(r));
  }

  async addMessage(
    sessionId: string,
    role: string,
    content: string,
    tags?: string[],
    metadata?: Record<string, unknown>
  ): Promise<Message> {
    const session = await this.getSession(sessionId);
    if (!session) {
      await this.createSession(sessionId, '', tags);
    } else if (tags && tags.length > 0) {
      const merged = [...new Set([...session.tags, ...tags])];
      await this.pool.query(
        'UPDATE sessions SET tags = $1, updated_at = $2 WHERE id = $3',
        [merged, new Date().toISOString(), sessionId]
      );
    }

    const now = new Date().toISOString();
    const result = await this.pool.query(
      'INSERT INTO messages (session_id, role, content, metadata, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [sessionId, role, content, metadata ? JSON.stringify(metadata) : null, now]
    );

    await this.pool.query(
      'UPDATE sessions SET updated_at = $1 WHERE id = $2',
      [now, sessionId]
    );

    return this.mapMessage(result.rows[0]);
  }

  async getConversation(sessionId: string): Promise<Message[]> {
    const result = await this.pool.query(
      'SELECT * FROM messages WHERE session_id = $1 ORDER BY created_at ASC, id ASC',
      [sessionId]
    );
    return result.rows.map(r => this.mapMessage(r));
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.pool.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
  }

  async getStats(): Promise<StorageStats> {
    const sessions = await this.pool.query('SELECT COUNT(*) as count FROM sessions');
    const messages = await this.pool.query('SELECT COUNT(*) as count FROM messages');
    const memories = await this.pool.query('SELECT COUNT(*) as count FROM memory_embeddings');
    return {
      sessionCount: parseInt(sessions.rows[0].count, 10),
      messageCount: parseInt(messages.rows[0].count, 10),
      memoryCount: parseInt(memories.rows[0].count, 10),
      uptime: Math.floor(process.uptime()),
    };
  }

  async storeMemory(
    sessionId: string,
    content: string,
    tags?: string[],
    metadata?: Record<string, unknown>
  ): Promise<MemoryEntry> {
    const userId = getCurrentUserId();
    const now = new Date().toISOString();
    const embedding = await this.embeddingProvider.generate(content);

    if (config.dedupThreshold > 0) {
      const dup = await this.pool.query(
        `SELECT id, session_id, user_id, content, tags, metadata, version, created_at,
                1 - (embedding <=> $1::vector) AS similarity
         FROM memory_embeddings
         WHERE 1 - (embedding <=> $1::vector) > $2
         ORDER BY similarity DESC
         LIMIT 1`,
        [`[${embedding.join(',')}]`, config.dedupThreshold]
      );

      if (dup.rows.length > 0) {
        const existing = dup.rows[0];
        const existingContent = existing.content as string;
        const existingTags = (existing.tags as string[]) || [];
        const existingMetadata = existing.metadata as Record<string, unknown> | null;

        const mergedContent = content.length >= existingContent.length ? content : existingContent;
        const mergedTags = [...new Set([...existingTags, ...(tags || [])])];
        const mergedMetadata = { ...(existingMetadata || {}), ...(metadata || {}) };
        const newVersion = (existing.version as number) + 1;

        await this.pool.query(
          `UPDATE memory_embeddings
           SET content = $1, tags = $2, metadata = $3, embedding = $4::vector,
               version = $5, updated_at = $6
           WHERE id = $7`,
          [mergedContent, mergedTags, Object.keys(mergedMetadata).length > 0 ? JSON.stringify(mergedMetadata) : null, `[${embedding.join(',')}]`, newVersion, now, existing.id]
        );

        return {
          id: existing.id as string,
          sessionId,
          userId,
          content: mergedContent,
          tags: mergedTags,
          metadata: mergedMetadata,
          version: newVersion,
          createdAt: (existing.created_at as Date).toISOString(),
          updatedAt: now,
        };
      }
    }

    const id = crypto.randomUUID();
    await this.pool.query(
      `INSERT INTO memory_embeddings (id, session_id, user_id, content, tags, embedding, metadata, version, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::vector, $7, 1, $8, $8)`,
      [id, sessionId, userId, content, tags || [], `[${embedding.join(',')}]`, metadata ? JSON.stringify(metadata) : null, now]
    );

    return { id, sessionId, userId, content, tags: tags || [], metadata, version: 1, createdAt: now, updatedAt: now };
  }

  async searchMemory(query: string, limit = 10, filterUserId?: string, filterTags?: string[]): Promise<MemorySearchResult[]> {
    const embedding = await this.embeddingProvider.generate(query);
    const currentUserId = getCurrentUserId();
    const tagFilter = (filterTags && filterTags.length > 0) ? filterTags : null;

    const result = await this.pool.query(
      `SELECT id, session_id, user_id, content, tags, metadata, version, created_at, updated_at,
              (1 - (embedding <=> $1::vector))
              + CASE WHEN user_id = $2 THEN ${config.searchSelfBoost} ELSE 0 END
              + CASE WHEN $3 IS NOT NULL AND tags && $3 THEN ${config.searchTagBoost} ELSE 0 END
              AS similarity
       FROM memory_embeddings
       WHERE ($4 IS NULL OR user_id = $4)
         AND ($5 IS NULL OR tags && $5)
       ORDER BY similarity DESC
       LIMIT $6`,
      [`[${embedding.join(',')}]`, currentUserId, tagFilter, filterUserId || null, tagFilter, limit]
    );

    return result.rows.map(r => ({
      id: r.id,
      sessionId: r.session_id,
      userId: r.user_id,
      content: r.content,
      tags: r.tags || [],
      similarity: parseFloat(r.similarity),
      metadata: r.metadata || undefined,
      version: r.version,
      createdAt: r.created_at.toISOString(),
      updatedAt: (r.updated_at as Date).toISOString(),
    }));
  }

  private mapSession(row: Record<string, unknown>): Session {
    return {
      id: row.id as string,
      title: row.title as string,
      userId: row.user_id as string,
      tags: (row.tags as string[]) || [],
      createdAt: (row.created_at as Date).toISOString(),
      updatedAt: (row.updated_at as Date).toISOString(),
    };
  }

  private mapMessage(row: Record<string, unknown>): Message {
    return {
      id: row.id as number,
      sessionId: row.session_id as string,
      role: row.role as string,
      content: row.content as string,
      metadata: row.metadata ? row.metadata as Record<string, unknown> : undefined,
      createdAt: (row.created_at as Date).toISOString(),
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
