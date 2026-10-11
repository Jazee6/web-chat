## Agent skills

### Domain docs

Single-context layout: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## 项目规则

- 功能尽量满足Cloudflare Free Tier使用
- 1.0起数据只做前向迁移：改表时在`MIGRATIONS`末尾追加一步（D1新增迁移文件），不改已有步骤；协议不兼容时`PROTOCOL_VERSION`加1。见[ADR-0013](docs/adr/0013-forward-only-migrations-after-1-0.md)