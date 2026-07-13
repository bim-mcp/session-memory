import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getCurrentUserId } from '../context.js';
import type { StorageAdapter, Session, Message, MemoryEntry, MemorySearchResult, StorageStats } from './types.js';

export class SqliteAdapter implements StorageAdapter {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        user_id TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
      CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
    `);
  }

  isAvailable(): boolean {
    try {
      this.db.prepare('SELECT 1').get();
      return true;
    } catch {
      return false;
    }
  }

  async createSession(id?: string, title?: string, tags?: string[]): Promise<Session> {
    const sessionId = id || crypto.randomUUID();
    const userId = getCurrentUserId();
    const now = new Date().toISOString();
    const tagsJson = JSON.stringify(tags || []);

    this.db.prepare(`
      INSERT INTO sessions (id, title, user_id, tags, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at
    `).run(sessionId, title || '', userId, tagsJson, now, now);

    return { id: sessionId, title: title || '', userId, tags: tags || [], createdAt: now, updatedAt: now };
  }

  async getSession(sessionId: string): Promise<Session | null> {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapSession(row);
  }

  async listSessions(limit = 50, offset = 0): Promise<Session[]> {
    const rows = this.db.prepare(
      'SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ? OFFSET ?'
    ).all(limit, offset) as Record<string, unknown>[];
    return rows.map(r => this.mapSession(r));
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
      this.db.prepare(
        "UPDATE sessions SET tags = ?, updated_at = ? WHERE id = ?"
      ).run(JSON.stringify(merged), new Date().toISOString(), sessionId);
    }

    const metaStr = metadata ? JSON.stringify(metadata) : null;
    const now = new Date().toISOString();
    const result = this.db.prepare(
      'INSERT INTO messages (session_id, role, content, metadata, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(sessionId, role, content, metaStr, now);

    this.db.prepare(
      "UPDATE sessions SET updated_at = ? WHERE id = ?"
    ).run(now, sessionId);

    return {
      id: result.lastInsertRowid as number,
      sessionId,
      role,
      content,
      metadata,
      createdAt: now,
    };
  }

  async getConversation(sessionId: string): Promise<Message[]> {
    const rows = this.db.prepare(
      'SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC, id ASC'
    ).all(sessionId) as Record<string, unknown>[];
    return rows.map(r => this.mapMessage(r));
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
  }

  async getStats(): Promise<StorageStats> {
    const sessionCount = (this.db.prepare('SELECT COUNT(*) as count FROM sessions').get() as Record<string, unknown>).count as number;
    const messageCount = (this.db.prepare('SELECT COUNT(*) as count FROM messages').get() as Record<string, unknown>).count as number;
    return { sessionCount, messageCount, memoryCount: 0, uptime: Math.floor(process.uptime()) };
  }

  async storeMemory(_sessionId: string, _content: string, _tags?: string[], _metadata?: Record<string, unknown>): Promise<MemoryEntry> {
    throw new Error('Semantic memory requires PostgreSQL storage (MEMORY_STORAGE=postgresql)');
  }

  async searchMemory(_query: string, _limit?: number, _filterUserId?: string, _filterTags?: string[]): Promise<MemorySearchResult[]> {
    throw new Error('Semantic search requires PostgreSQL storage (MEMORY_STORAGE=postgresql)');
  }

  private mapSession(row: Record<string, unknown>): Session {
    let tags: string[] = [];
    try {
      tags = JSON.parse(row.tags as string);
    } catch { /* ignore */ }
    return {
      id: row.id as string,
      title: row.title as string,
      userId: row.user_id as string,
      tags,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  private mapMessage(row: Record<string, unknown>): Message {
    let metadata: Record<string, unknown> | undefined;
    if (row.metadata) {
      try {
        metadata = JSON.parse(row.metadata as string);
      } catch {
        metadata = { _raw: row.metadata };
      }
    }
    return {
      id: row.id as number,
      sessionId: row.session_id as string,
      role: row.role as string,
      content: row.content as string,
      metadata,
      createdAt: row.created_at as string,
    };
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
