import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { StorageAdapter } from './storage/types.js';
import { getCurrentUserId } from './context.js';

export function createServer(adapter: StorageAdapter, version = '0.0.0'): McpServer {
  const server = new McpServer(
    { name: 'session-memory', version },
    { capabilities: { tools: {} } }
  );

  server.registerTool('create_session', {
    description: 'Create a new conversation session (auto-tagged with current user)',
    inputSchema: {
      title: z.string().optional().describe('Optional session title'),
      tags: z.array(z.string()).optional().describe('Tags to categorize session (e.g. ["project:alpha", "bug"])'),
    },
  }, async (args) => {
    const session = await adapter.createSession(undefined, args.title, args.tags);
    return { content: [{ type: 'text', text: JSON.stringify(session) }] };
  });

  server.registerTool('list_sessions', {
    description: 'List all sessions ordered by most recent activity',
    inputSchema: {
      limit: z.number().min(1).max(100).optional().default(50).describe('Max results'),
      offset: z.number().min(0).optional().default(0).describe('Offset for pagination'),
    },
  }, async (args) => {
    const sessions = await adapter.listSessions(args.limit, args.offset);
    return { content: [{ type: 'text', text: JSON.stringify(sessions) }] };
  });

  server.registerTool('get_session', {
    description: 'Get a session by ID',
    inputSchema: {
      sessionId: z.string().describe('Session ID'),
    },
  }, async (args) => {
    const session = await adapter.getSession(args.sessionId);
    if (!session) throw new Error(`Session not found: ${args.sessionId}`);
    return { content: [{ type: 'text', text: JSON.stringify(session) }] };
  });

  server.registerTool('delete_session', {
    description: 'Delete a session and all its messages',
    inputSchema: {
      sessionId: z.string().describe('Session ID'),
    },
  }, async (args) => {
    await adapter.deleteSession(args.sessionId);
    return { content: [{ type: 'text', text: JSON.stringify({ deleted: true, sessionId: args.sessionId }) }] };
  });

  server.registerTool('store_message', {
    description: 'Store a message in a session (creates session if not exists, tagged with current user)',
    inputSchema: {
      sessionId: z.string().describe('Session ID'),
      role: z.string().describe('Message role (user, assistant, system, tool)'),
      content: z.string().describe('Message content'),
      tags: z.array(z.string()).optional().describe('Tags to add to session'),
      metadata: z.record(z.string(), z.unknown()).optional().describe('Optional metadata'),
    },
  }, async (args) => {
    const message = await adapter.addMessage(args.sessionId, args.role, args.content, args.tags, args.metadata);
    return { content: [{ type: 'text', text: JSON.stringify(message) }] };
  });

  server.registerTool('get_conversation', {
    description: 'Get full conversation history for a session',
    inputSchema: {
      sessionId: z.string().describe('Session ID'),
    },
  }, async (args) => {
    const messages = await adapter.getConversation(args.sessionId);
    return { content: [{ type: 'text', text: JSON.stringify(messages) }] };
  });

  server.registerTool('store_memory', {
    description: 'Store a semantic memory entry (auto-tagged with current user; auto-dedup if similar content exists)',
    inputSchema: {
      sessionId: z.string().describe('Session ID'),
      content: z.string().describe('Content to store'),
      tags: z.array(z.string()).optional().describe('Tags to categorize memory'),
      metadata: z.record(z.string(), z.unknown()).optional().describe('Optional metadata'),
    },
  }, async (args) => {
    const entry = await adapter.storeMemory(args.sessionId, args.content, args.tags, args.metadata);
    return { content: [{ type: 'text', text: JSON.stringify(entry) }] };
  });

  server.registerTool('search_memory', {
    description: 'Semantic search across stored memories (own memories ranked higher)',
    inputSchema: {
      query: z.string().describe('Search query'),
      limit: z.number().min(1).max(100).optional().default(10).describe('Max results (1-100)'),
      tags: z.array(z.string()).optional().describe('Filter by tags + boost matching entries'),
      userId: z.string().optional().describe('Filter by specific user'),
    },
  }, async (args) => {
    const results = await adapter.searchMemory(args.query, args.limit, args.userId, args.tags);
    return { content: [{ type: 'text', text: JSON.stringify(results) }] };
  });

  return server;
}
