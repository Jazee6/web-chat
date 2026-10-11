import type { MouseEvent } from 'react'
import { useRouter } from '@tanstack/react-router'

import { inPip } from '@/features/pip/pip'

/** 卡片上显示的域名：从链接本身算出（非 ASCII 域名保持 punycode，防止仿冒），去掉 www. */
export function displayHost(url: URL) {
  return url.hostname.replace(/^www\./, '')
}

/**
 * 打开链接：本站的地址在应用内跳转（画中画里在新标签页打开），其他的在新标签页打开、不带 Referer 与 opener。
 * 打开的总是链接本身，不是卡片上的说法
 */
export function useOpenLink(url: URL) {
  const router = useRouter()
  if (url.origin !== location.origin || inPip) return { href: url.href, target: '_blank', rel: 'noopener noreferrer' }
  return {
    href: url.href,
    onClick: (e: MouseEvent) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
      e.preventDefault()
      router.history.push(url.pathname + url.search + url.hash)
    },
  }
}
