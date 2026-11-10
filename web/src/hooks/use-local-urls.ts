import { useEffect, useState } from 'react'
import { readBlob } from '@/sync/blobs'

/** 读出发件箱里暂存的文件并生成 object URL（文件名 → URL）；卸载或换了文件时回收。读完之前为 null */
export function useLocalUrls(randomId: number, files: string[]): Map<string, string> | null {
  const [urls, setUrls] = useState<{ key: string; map: Map<string, string> } | null>(null)
  const names = files.join('\n')

  useEffect(() => {
    if (!names) return
    let cancelled = false
    const created: string[] = []
    void Promise.all(
      names.split('\n').map(async (name) => {
        const url = URL.createObjectURL(await readBlob(randomId, name))
        created.push(url)
        return [name, url] as const
      }),
    ).then(
      (entries) => !cancelled && setUrls({ key: `${randomId}\n${names}`, map: new Map(entries) }),
      // 已发送成功、暂存文件已删除：这一行马上会被已发送的消息替换
      () => {},
    )
    return () => {
      cancelled = true
      for (const url of created) URL.revokeObjectURL(url)
    }
  }, [randomId, names])

  // 换了文件后、新的读完之前，旧的 URL 已经回收
  return names && urls?.key === `${randomId}\n${names}` ? urls.map : null
}
