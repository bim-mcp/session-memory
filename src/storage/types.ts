export interface Session {
  id: string;
  title: string;
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
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface MemorySearchResult extends MemoryEntry {
  similarity: number;
}

export interface StorageAdapter {
  createSession(id?: string, title?: string): Promise<Session>;
  getSession(sessionId: string): Promise<Session | null>;
  listSessions(limit?: number, offset?: number): Promise<Session[]>;
  addMessage(sessionId: string, role: string, content: string, metadata?: Record<string, unknown>): Promise<Message>;
  getConversation(sessionId: string): Promise<Message[]>;
  deleteSession(sessionId: string): Promise<void>;
  storeMemory(sessionId: string, content: string, metadata?: Record<string, unknown>): Promise<MemoryEntry>;
  searchMemory(query: string, limit?: number): Promise<MemorySearchResult[]>;
  isAvailable(): boolean;
  close(): Promise<void>;
}
