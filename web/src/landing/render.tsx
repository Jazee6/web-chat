// 把介绍页渲染成完整的 HTML 文档。vite.config.ts 的 landing 插件在构建时调用（开发时每次请求调用），不进浏览器的包
import { renderToStaticMarkup } from 'react-dom/server'

import { COPY, DEPLOY_URL, HTML_LANG, OG_LOCALE, PATHS, REPO, SITE, type Lang } from './content'
import { LandingPage } from './landing-page'

export const LANGS: Lang[] = ['en', 'zh']

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
/** JSON-LD 放在 <script> 里：只需防止提前结束标签 */
const jsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, '\\u003c')

function structuredData(lang: Lang) {
  const t = COPY[lang]
  const url = SITE + PATHS[lang]
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${SITE}/#website`,
        url: `${SITE}/`,
        name: 'Web Chat',
        inLanguage: ['en', 'zh-Hans'],
      },
      {
        '@type': 'WebPage',
        '@id': `${url}#webpage`,
        url,
        name: t.title,
        description: t.description,
        inLanguage: HTML_LANG[lang],
        isPartOf: { '@id': `${SITE}/#website` },
        about: { '@id': `${SITE}/#app` },
      },
      {
        '@type': 'SoftwareApplication',
        '@id': `${SITE}/#app`,
        name: 'Web Chat',
        url: `${SITE}/`,
        description: t.description,
        applicationCategory: 'CommunicationApplication',
        operatingSystem: 'Web',
        browserRequirements: 'Requires JavaScript, WebAssembly and the Origin Private File System',
        isAccessibleForFree: true,
        license: 'https://www.apache.org/licenses/LICENSE-2.0',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        image: `${SITE}/og-${lang}.png`,
        screenshot: `${SITE}/og-${lang}.png`,
        featureList: t.features.items.map((f) => f.title),
        sameAs: REPO,
      },
      {
        '@type': 'SoftwareSourceCode',
        '@id': `${REPO}#code`,
        name: 'web-chat',
        codeRepository: REPO,
        programmingLanguage: 'TypeScript',
        runtimePlatform: 'Cloudflare Workers',
        license: 'https://www.apache.org/licenses/LICENSE-2.0',
        targetProduct: { '@id': `${SITE}/#app` },
      },
      {
        '@type': 'FAQPage',
        '@id': `${url}#faq`,
        inLanguage: HTML_LANG[lang],
        mainEntity: t.faq.items.map((item) => ({
          '@type': 'Question',
          name: item.q,
          acceptedAnswer: { '@type': 'Answer', text: item.a },
        })),
      },
    ],
  }
}

/** css：样式表地址（构建产物里带哈希的应用样式表，开发时是源文件） */
export function renderLanding(lang: Lang, css: string[]): string {
  const t = COPY[lang]
  const url = SITE + PATHS[lang]
  const image = `${SITE}/og-${lang}.png`
  const head = [
    '<meta charset="UTF-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    '<meta name="color-scheme" content="dark" />',
    '<meta name="theme-color" content="#0a0a0a" />',
    `<title>${esc(t.title)}</title>`,
    `<meta name="description" content="${esc(t.description)}" />`,
    `<link rel="canonical" href="${url}" />`,
    ...LANGS.map((l) => `<link rel="alternate" hreflang="${HTML_LANG[l]}" href="${SITE + PATHS[l]}" />`),
    `<link rel="alternate" hreflang="x-default" href="${SITE}/" />`,
    '<link rel="icon" href="/favicon.svg" type="image/svg+xml" />',
    '<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />',
    '<link rel="manifest" href="/manifest.webmanifest" />',
    ...css.map((href) => `<link rel="stylesheet" crossorigin href="${href}" />`),
    '<meta property="og:type" content="website" />',
    '<meta property="og:site_name" content="Web Chat" />',
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:title" content="${esc(t.ogTitle)}" />`,
    `<meta property="og:description" content="${esc(t.description)}" />`,
    `<meta property="og:locale" content="${OG_LOCALE[lang]}" />`,
    ...LANGS.filter((l) => l !== lang).map((l) => `<meta property="og:locale:alternate" content="${OG_LOCALE[l]}" />`),
    `<meta property="og:image" content="${image}" />`,
    '<meta property="og:image:width" content="1200" />',
    '<meta property="og:image:height" content="630" />',
    `<meta property="og:image:alt" content="${esc(t.ogImageAlt)}" />`,
    '<meta name="twitter:card" content="summary_large_image" />',
    `<script type="application/ld+json">${jsonLd(structuredData(lang))}</script>`,
  ]
  const body = renderToStaticMarkup(<LandingPage lang={lang} />)
  return `<!doctype html>\n<html lang="${HTML_LANG[lang]}" class="dark">\n<head>\n${head.join('\n')}\n</head>\n<body>${body}</body>\n</html>\n`
}

/** llms-full.txt：llms.txt 加上介绍页的全部文字（英文为主，常见问题另附中文），与页面同源，不会说法不一 */
export function renderLlmsFull(llms: string): string {
  const en = COPY.en
  const zh = COPY.zh
  const list = (items: { title: string; body: string }[]) => items.map((i) => `- **${i.title}**: ${i.body}`).join('\n')
  const faq = (items: { q: string; a: string }[]) => items.map((i) => `### ${i.q}\n\n${i.a}`).join('\n\n')
  return [
    llms.trimEnd(),
    `## Features in detail\n\n${list(en.features.items)}`,
    `## Architecture\n\n${en.architecture.lead}\n\n${list(en.architecture.notes)}`,
    `## Free plan\n\n${en.budget.lead}\n\n${en.budget.items.map((i) => `- ${i.value} ${i.label}`).join('\n')}`,
    `## Deploying your own\n\n${en.deploy.lead}\n\n${en.deploy.steps.map((s, i) => `${i + 1}. **${s.title}**: ${s.body}`).join('\n')}\n\nDeploy button: ${DEPLOY_URL}\nDeployment guide: ${REPO}#deployment`,
    `## FAQ\n\n${faq(en.faq.items)}`,
    `## 常见问题（中文）\n\n${faq(zh.faq.items)}`,
  ].join('\n\n') + '\n'
}
