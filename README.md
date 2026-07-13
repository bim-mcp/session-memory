# session-memory

MCP Server for shared memory across AI agents (Claude, Copilot, Cursor, Windsurf, any MCP-compatible agent).

## Features

- **Conversation memory** — store/retrieve messages per session
- **Semantic memory** — vector search with embeddings (OpenAI + pgvector)
- **Dual storage** — SQLite (lightweight) or PostgreSQL (production)
- **Dual transport** — stdio for local agents, SSE for remote access

## Quick Start

```bash
cp .env.example .env
npm install
npm run build
npm start
```

## Configuration

| Env | Default | Description |
|-----|---------|-------------|
| `MEMORY_STORAGE` | `sqlite` | `sqlite` or `postgresql` |
| `MCP_TRANSPORT` | `stdio` | `stdio` or `streamable-http` |
| `MCP_PORT` | `3000` | HTTP port (streamable-http mode) |
| `MCP_MAX_REQUEST_SIZE` | `10mb` | Request body size limit |
| `SQLITE_PATH` | `./data/memory.db` | SQLite file path |
| `DATABASE_URL` | — | PostgreSQL connection string |
| `EMBEDDING_PROVIDER` | `ollama` | `ollama` (free) or `openai` |
| `EMBEDDING_DIMENSIONS` | `1024` | Vector dimensions (bge-m3=1024, nomic=768) |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama server URL |
| `OLLAMA_MODEL` | `bge-m3` | Ollama embedding model |
| `OPENAI_API_KEY` | — | Required when `EMBEDDING_PROVIDER=openai` |

## MCP Tools

### Session
- `create_session` — `{ title? }` → Create session
- `list_sessions` — `{ limit?, offset? }` → List sessions
- `get_session` — `{ sessionId }` → Get session details
- `delete_session` — `{ sessionId }` → Delete session & messages

### Conversation (all storage types)
- `store_message` — `{ sessionId, role, content, metadata? }` → Add message
- `get_conversation` — `{ sessionId }` → Get full history

### Semantic Memory (PostgreSQL only)
- `store_memory` — `{ sessionId, content, metadata? }` → Store with embedding
- `search_memory` — `{ query, limit? }` → Semantic search

## Agent Configuration

### Claude Desktop
Add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "session-memory": {
      "command": "node",
      "args": ["/path/to/session-memory/dist/index.js"]
    }
  }
}
```

### Claude Code
Add to `~/.claude/settings.json`:
```json
{
  "mcpServers": {
    "session-memory": {
      "command": "node",
      "args": ["/path/to/session-memory/dist/index.js"]
    }
  }
}
```

### VS Code / Copilot
Create `.vscode/mcp.json` in workspace:
```json
{
  "servers": {
    "session-memory": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/session-memory/dist/index.js"]
    }
  }
}
```

### Cursor
Add to `~/.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "session-memory": {
      "command": "node",
      "args": ["/path/to/session-memory/dist/index.js"]
    }
  }
}
```

### Remote (Streamable HTTP)
Any MCP client connecting via Streamable HTTP:
```
http://your-host:3000/mcp
```
