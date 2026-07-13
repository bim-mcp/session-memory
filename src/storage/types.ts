export interface Session {
  id: string;
  title: string;
  userId: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string | number;
  sessionId: string;
  role: string;
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface MemoryEntry {
  id: string;
  sessionId: string;
  userId: string;
  content: string;
  tags: string[];
  metadata?: Record<string, unknown>;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface MemorySearchResult extends MemoryEntry {
  similarity: number;
}

export interface StorageStats {
  sessionCount: number;
  messageCount: number;
  memoryCount: number;
  uptime: number;
}

export interface StorageAdapter {
  createSession(id?: string, title?: string, tags?: string[]): Promise<Session>;
  getSession(sessionId: string): Promise<Session | null>;
  listSessions(limit?: number, offset?: number): Promise<Session[]>;
  addMessage(sessionId: string, role: string, content: string, tags?: string[], metadata?: Record<string, unknown>): Promise<Message>;
  getConversation(sessionId: string): Promise<Message[]>;
  deleteSession(sessionId: string): Promise<void>;
  storeMemory(sessionId: string, content: string, tags?: string[], metadata?: Record<string, unknown>): Promise<MemoryEntry>;
  searchMemory(query: string, limit?: number, userId?: string, tags?: string[]): Promise<MemorySearchResult[]>;
  getStats(): Promise<StorageStats>;
  isAvailable(): boolean;
  close(): Promise<void>;
}
