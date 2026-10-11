import { useSyncExternalStore } from 'react'

const MOBILE_QUERY = '(max-width: 767px)'

function subscribe(listener: () => void) {
  const query = matchMedia(MOBILE_QUERY)
  query.addEventListener('change', listener)
  return () => query.removeEventListener('change', listener)
}

/** 视口是否窄于 768px（移动端布局） */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, () => matchMedia(MOBILE_QUERY).matches)
}
