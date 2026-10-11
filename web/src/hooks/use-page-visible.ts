import { useSyncExternalStore } from 'react'

function subscribe(listener: () => void) {
  document.addEventListener('visibilitychange', listener)
  return () => document.removeEventListener('visibilitychange', listener)
}

/** 页面是否在前台（document.visibilityState） */
export function usePageVisible(): boolean {
  return useSyncExternalStore(subscribe, () => document.visibilityState === 'visible')
}
