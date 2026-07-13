# session-memory — Development Plan

## 1. Authentication & Access Control

### Vấn đề
Server HTTP mở trần, ai trong mạng cũng call được `/mcp`. Không có cơ chế xác thực.

### Đề xuất
- **Option A: API Key** — Mỗi member cấp 1 API key. Server check header `Authorization: Bearer <key>`.
- **Option B: Basic Auth** — Dùng username/password đơn giản, config qua env.
- **Option C: JWT** — Nếu đã có hệ thống auth riêng, dùng JWT verify.
- **Recommend: Option A** — Đơn giản, đủ cho use case 10 member.

### Thay đổi cần làm
- `src/config.ts`: Thêm `MCP_API_KEY` env
- `src/index.ts`: Middleware check bearer token cho `/mcp` endpoint
- Agent config docs: Hướng dẫn thêm header vào MCP client config (nếu MCP client support custom headers)

---

## 2. User Identity

### Status: ✅ DONE

### Vấn đề
Session và memory không gắn với user nào. Không biết ai tạo, không filter được theo user.

### Giải pháp đã implement
- `src/context.ts`: AsyncLocalStorage lưu `userId` theo request scope
- `src/config.ts`: Thêm `MCP_API_KEY` (auth), `DEFAULT_USER_ID` (fallback)
- `src/storage/types.ts`: Thêm `userId` vào `Session`, `MemoryEntry`
- `src/storage/sqlite-adapter.ts`: Thêm cột `user_id` vào `sessions`
- `src/storage/postgres-adapter.ts`: Thêm cột `user_id` vào `sessions`, `memory_embeddings`
- `src/index.ts`: Auth middleware check `Authorization: Bearer <key>`, extract `X-User-Id` header
- `src/server.ts`: Tool handlers gắn userId tự động qua context
- Client gửi: `X-User-Id: alice` header + `Authorization: Bearer <API_KEY>`

---

## 3. Session Privacy / Scope

### Vấn đề
Mọi session đều public. Member A không thể có session riêng.

### Đề xuất
Thêm `scope` field vào sessions: `private` (chủ sở hữu), `team` (cả team, default).

- `list_sessions`: Chỉ trả về sessions thuộc scope user có quyền xem.
- `create_session`: Thêm param `scope` (default: `team`).
- `search_memory`: Kết quả ưu tiên memory của user hiện tại + team shared.
- Tương lai: `public` scope — ai cũng đọc được.

### Thay đổi cần làm
- Thêm `scope` enum `private | team` vào schema & types
- Thêm filter logic trong `listSessions`, `getConversation`, `searchMemory`
- Tool `create_session`: Thêm `scope` param
- Tool `list_sessions`: Thêm `scope` filter param

---

## 4. Tag / Label System

### Status: ✅ DONE

### Vấn đề
Không có cách gán nhãn cho memory để filter theo ngữ cảnh dự án, module, feature.

### Giải pháp đã implement
- `src/storage/types.ts`: Thêm `tags: string[]` vào `Session`, `MemoryEntry`
- SQLite: `sessions.tags TEXT DEFAULT '[]'` (JSON array string)
- PostgreSQL: `sessions.tags TEXT[]`, `memory_embeddings.tags TEXT[]`
- Tool `create_session`: Thêm param `tags: string[]`
- Tool `store_message`: Thêm param `tags: string[]` (gộp vào session tags)
- Tool `store_memory`: Thêm param `tags: string[]`
- Tags merge khi `addMessage` vào session đã có tags

---

## 5. Search Scope & Ranking

### Status: ✅ DONE

### Vấn đề
`search_memory` search toàn bộ memory của cả team → kết quả loãng.

### Giải pháp đã implement
- Weighted scoring trong PostgreSQL query:
  ```
  similarity = base_cosine_similarity
               + (user_id = current_user ? SELF_BOOST : 0)
               + (tags && filter_tags ? TAG_BOOST : 0)
  ```
- `SEARCH_SELF_BOOST` (default 0.2): Boost khi memory thuộc user hiện tại
- `SEARCH_TAG_BOOST` (default 0.1): Boost khi tags match với filter
- Tool `search_memory`: Thêm params `tags` (filter + boost) và `userId` (filter)
- WHERE clause dùng pattern `$x IS NULL OR condition` — bỏ qua filter nếu không cung cấp

---

## 6. Memory Cleanup / TTL

### Vấn đề
Memory tích tữ mãi, không có cơ chế cleanup.

### Đề xuất
- Thêm `ttl` field (optional, seconds) vào `store_memory`.
- Background job (CRON hoặc check trên mỗi request) xóa expired entries.
- Hoặc đơn giản hơn: config `MEMORY_MAX_AGE_DAYS` — cleanup khi server start.

### Thay đổi cần làm
- Schema: Thêm `expires_at` nullable
- Cleanup function chạy định kỳ hoặc ở `initialize()`
- Tool `store_memory`: Thêm `ttl` param

---

## 7. HTTPS / TLS

### Vấn đề
HTTP trần trong LAN chấp nhận được, nhưng nếu có member từ VPN ngoài thì không an toàn.

### Đề xuất
- Option A: Đứng sau reverse proxy (Nginx/Caddy) handle TLS — không cần sửa code.
- Option B: Tích hợp `https` module trong Node — cần cert path config.
- **Recommend: Option A** — Nginx/Caddy là best practice, dễ maintain.

### Thay đổi cần làm
- `README.md`: Hướng dẫn setup Nginx reverse proxy

---

## 8. Deduplication

### Status: ✅ DONE

### Vấn đề
Nhiều member cùng hỏi về 1 vấn đề → memory bị duplicate.

### Giải pháp đã implement
- `DEDUP_THRESHOLD` env var (default: 0.95, set 0 để tắt)
- Trong `postgres-adapter.storeMemory()`: Trước khi insert, search `WHERE 1 - (embedding <=> $1::vector) > threshold`
- Khi phát hiện duplicate, thực hiện merge thông minh:
  - **Content**: Giữ content dài hơn (thường chi tiết hơn)
  - **Tags**: Gộp union tags cũ + mới
  - **Metadata**: Shallow merge, mới ghi đè cũ
  - **Version**: Increment version counter
  - **Embedding**: Update vector theo content mới
- Schema: Thêm `version INT`, `updated_at TIMESTAMPTZ` vào `memory_embeddings`
- `MemoryEntry` type: Thêm `version`, `updatedAt` fields
- `searchMemory` cũng trả về `version` + `updatedAt`

---

## 9. Observability

### Status: ✅ DONE

### Vấn đề
Không biết ai đang dùng, có bao nhiêu request, memory stats.

### Giải pháp đã implement
- Logging middleware: Mỗi request ghi `[timestamp] METHOD path STATUS durationMs user:userId`
- `GET /health` mở rộng: Trả về `{ uptime, sessionCount, messageCount, memoryCount }`
- `StorageAdapter.getStats()`: Interface mới, implement ở cả SQLite và PostgreSQL

---

## 10. Remaining Low Priority (từ các phase trước)

| Issue | Status |
|-------|--------|
| Tests | Chưa implement |
| No rate limit cho embedding | Chưa implement |
| PG pool sizing auto-tune | Optional |

---

## Thứ tự ưu tiên đề xuất

```
Phase 1 — Must have cho shared team use case
├── 1. Auth (API Key)
├── 2. User identity
├── 3. Session privacy (scope)
└── 5. Search ranking theo user

Phase 2 — Quality of life
├── 4. Tag system
├── 9. Observability
└── 7. HTTPS guide

Phase 3 — Optimization
├── 6. TTL cleanup
├── 8. Deduplication
└── 10. Tests
```
