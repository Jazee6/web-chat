# ADR-0004：本地优先客户端（SQLite WASM + OPFS）

- 状态：已接受
- 日期：2026-09-28

## 背景

- Telegram 的体验核心是秒开和离线可用。
- 服务端全文搜索需要 FTS 影子表，会显著放大行写入，而免费额度中最紧的就是写入。
- 项目不考虑浏览器兼容性。

## 决策

- 客户端使用官方 SQLite WASM + `opfs-sahpool` VFS，运行在 Leader 标签页的 Dedicated Worker 中。Leader 通过 Web Locks 选举，其他标签页经 BroadcastChannel 通信。
- UI 只读本地库（`useLiveQuery` 按主题订阅变更）；网络层只负责把服务端数据同步进本地库。
- 发送走 outbox，支持乐观渲染与离线发送，服务端用 `random_id` 保证幂等。
- 全文搜索在本地用 FTS5 `trigram` 分词器完成（支持中文子串搜索）；服务端不做全文搜索。

## 后果

- 首屏和会话切换不等待网络；服务端读取压力也更小。
- 客户端复杂度更高：需要维护同步状态机、缺口检测、Leader 交接。
- 本地库的 schema 在 1.0 之前可以随时推翻：版本不匹配时直接清空并重新同步。从 1.0 起改为增量迁移，见 [ADR-0013](./0013-forward-only-migrations-after-1-0.md)。
- 依赖 `@sqlite.org/sqlite-wasm`，已确认引入。

## 考虑过的其他方案

- **IndexedDB（如 Dexie）**：没有 SQL 和 FTS，复杂查询需要手写。
- **SharedWorker**：无法使用 OPFS 同步访问句柄。
- **纯内存 + TanStack Query**：不能离线，也不能秒开。
