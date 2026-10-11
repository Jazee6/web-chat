import { useEffect, useState } from 'react'

/** 值停止变化 delay 毫秒后才更新；变成空字符串时立即更新 */
export function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return value === '' ? value : debounced
}
