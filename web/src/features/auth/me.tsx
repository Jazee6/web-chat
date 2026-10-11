import { createContext, use } from 'react'
import type { Me } from './session'

export const MeContext = createContext<Me | null>(null)

/** 当前用户；只能在需要登录的路由中使用 */
export function useMe(): Me {
  const me = use(MeContext)
  if (!me) throw new Error('useMe must be used inside a signed-in route')
  return me
}
