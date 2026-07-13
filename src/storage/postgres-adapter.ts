import pg from 'pg';
import crypto from 'node:crypto';
import { config } from '../config.js';
import type { EmbeddingProvider } from '../embedding/types.js';
import type { StorageAdapter, Session, Message, MemoryEntry, MemorySearchResult } from './types.js';

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
          content TEXT NOT NULL,
          embedding vector(${this.embeddingProvider.dimensions}),
          metadata JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

  async createSession(id?: string, title?: string): Promise<Session> {
    const sessionId = id || crypto.randomUUID();
    const now = new Date().toISOString();

    await this.pool.query(
      'INSERT INTO sessions (id, title, created_at, updated_at) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET updated_at = $4',
      [sessionId, title || '', now, now]
    );

    return { id: sessionId, title: title || '', createdAt: now, updatedAt: now };
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
    metadata?: Record<string, unknown>
  ): Promise<Message> {
    const session = await this.getSession(sessionId);
    if (!session) {
      await this.createSession(sessionId);
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

  async storeMemory(
    sessionId: string,
    content: string,
    metadata?: Record<string, unknown>
  ): Promise<MemoryEntry> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const embedding = await this.embeddingProvider.generate(content);

    await this.pool.query(
      'INSERT INTO memory_embeddings (id, session_id, content, embedding, metadata, created_at) VALUES ($1, $2, $3, $4::vector, $5, $6)',
      [id, sessionId, content, `[${embedding.join(',')}]`, metadata ? JSON.stringify(metadata) : null, now]
    );

    return { id, sessionId, content, metadata, createdAt: now };
  }

  async searchMemory(query: string, limit = 10): Promise<MemorySearchResult[]> {
    const embedding = await this.embeddingProvider.generate(query);
    const result = await this.pool.query(
      `SELECT id, session_id, content, metadata, created_at,
              1 - (embedding <=> $1::vector) AS similarity
       FROM memory_embeddings
       ORDER BY similarity DESC
       LIMIT $2`,
      [`[${embedding.join(',')}]`, limit]
    );

    return result.rows.map(r => ({
      id: r.id,
      sessionId: r.session_id,
      content: r.content,
      similarity: parseFloat(r.similarity),
      metadata: r.metadata || undefined,
      createdAt: r.created_at.toISOString(),
    }));
  }

  private mapSession(row: Record<string, unknown>): Session {
    return {
      id: row.id as string,
      title: row.title as string,
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
