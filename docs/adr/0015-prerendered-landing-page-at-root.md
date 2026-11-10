# ADR-0015：根地址按 cookie 分流到预渲染的介绍页，canonical 一律指向官网

- 状态：已接受
- 日期：2026-11-10

## 背景

未登录的人打开 `/` 会被直接送到 IdP，搜索引擎与 AI 爬虫只能看到 `index.html` 里的几行 meta 与 `<noscript>`，项目在搜索与大模型回答里几乎不存在。要在根地址放一个介绍页，同时：

- 多数 AI 爬虫不执行 JS，介绍页必须是完整的 HTML；
- 已登录的人打开 `/` 仍然是对话列表，PWA 的 `start_url` 不变；
- 所有部署都来自同一个仓库，介绍页内容完全相同。

## 决策

- **构建时预渲染**。介绍页用 React 与应用的组件、主题写成（`web/src/landing`），`vite.config.ts` 的插件在构建后用 `react-dom/server` 输出 `en.html` 与 `zh.html`，样式表沿用应用那份，页面不带 JS。不引入 SSR 框架或新依赖。
- **Worker 按 cookie 分流 `/`**。`/` 加入 `run_worker_first`：有会话 cookie 或 `signed_in` 标记就从 `ASSETS` 取 `index.html`，否则取 `en.html`；响应带 `Vary: Cookie` 与 `Cache-Control: private, no-cache`。只看 cookie 在不在，不校验：不读 D1、几乎不花 CPU；cookie 过期时外壳照常发现未登录、去登录。`/zh` 是静态资源，不经 Worker；`/en` 跳回 `/`，免得同一内容有两个地址。
- **另设 `Lax` 的 `signed_in` 标记**。会话 cookie 是 `SameSite=Strict`（防 CSRF，见 06），从搜索结果、聊天软件里的链接或跨站 IdP 的回调跳转进来时不会发出，只看它会把已登录的人送到介绍页。better-auth 的响应设置或清除会话 cookie 时，Worker 同时设置或清除标记。标记不是凭据，只决定发哪份静态 HTML。
- **canonical、hreflang、sitemap 与 OG 图写死官网** `https://chat.jaze.top`。介绍页讲的是开源项目而不是某个部署，别人的部署是重复内容，排名应当集中到官网；不为此加 var。
- **外壳 `index.html` 带 `noindex`**，供搜索与 AI 读的内容只在介绍页。Service Worker 从 `/?shell` 预缓存外壳（`?shell` 总是外壳），未登录时安装也不会把介绍页当成离线外壳。

## 后果

- 打开 `/` 多一次 Worker 调用（静态资源本来不计），其他页面不变。
- 改介绍页文案只改 `web/src/landing/content.ts`，`llms-full.txt` 由它生成；功能变化时要一起更新。
- 自部署的实例首页也是介绍页，登录按钮进入的是那个部署本身；它们的 canonical 指向官网，不会被单独收录。
- 介绍页的路由注册在必填配置检查之前，按钮部署后、补完配置前首页也能显示。

## 考虑过的方案

- **客户端渲染**（介绍页作为 SPA 的一个路由）：最简单，但爬虫看不到内容，GEO 几乎无效。
- **把介绍页 HTML 写进 `index.html`，登录后由 SPA 替换**：不需要 Worker 分流，但所有 SPA 路由都带着这份 HTML，已登录的人还会先闪一下介绍页。
- **介绍页放在 `/about`，`/` 不变**：根地址仍然没有内容，搜索与链接预览都弱。
- **会话 cookie 改为 `Lax`**：分流就只需看它一个，但放宽了现有的 CSRF 防护。
- **新增 var 控制是否可索引**（模板部署 `noindex`）：多一项两处都要改的配置，效果与 canonical 指向官网相近。
