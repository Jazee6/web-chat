# ADR-0006：媒体由客户端处理，预签名直传 R2，通过自定义域名公开分发

- 状态：已接受
- 日期：2026-09-28

## 背景

- Cloudflare Images 免费额度只有 5,000 次唯一转换/月，而且不提供存储。
- Worker 免费额度是 10 万次请求/天，单次调用 10ms CPU。
- R2 出站流量免费。

## 决策

- 压缩、缩略图、ThumbHash、视频转码、语音波形全部在客户端完成（OffscreenCanvas、WebCodecs、Web Audio）。
- Worker 只签发 R2 预签名 PUT URL（支持 multipart）；文件字节不经过 Worker。
- 媒体通过绑定到 R2 的自定义域名公开读取；对象键为 128bit 随机值，不可变，设置 `immutable` 长缓存。

## 后果

- 查看媒体不消耗 Worker 请求，CDN 缓存命中时也不产生 R2 B 类操作。
- 访问控制模型是 capability URL：拿到 URL 的人都能访问。需要保密的内容走秘密聊天（第三阶段）。
- 需要一个托管在 Cloudflare 的域名，并为 R2 配置 CORS 与生命周期规则。
