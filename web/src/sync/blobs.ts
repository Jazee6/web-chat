// 发件箱里待上传的媒体：暂存在 OPFS 的 outbox/{random_id}/ 下，刷新或换 Leader 后接着上传。
// 同步 Worker 负责写入与删除；标签页只读，用来在上传完成前显示本地的图。
// 见 docs/architecture/05-media.md § 上传

const ROOT = 'outbox'

async function root(create: boolean) {
  const dir = await navigator.storage.getDirectory()
  return dir.getDirectoryHandle(ROOT, { create })
}

async function messageDir(randomId: number, create: boolean) {
  return (await root(create)).getDirectoryHandle(String(randomId), { create })
}

/** 同步 Worker：写入一条消息的所有文件。重放时覆盖同名文件，结果相同 */
export async function saveBlobs(randomId: number, files: Map<string, Blob>) {
  const dir = await messageDir(randomId, true)
  for (const [name, blob] of files) {
    const writable = await (await dir.getFileHandle(name, { create: true })).createWritable()
    await writable.write(blob)
    await writable.close()
  }
}

export async function readBlob(randomId: number, name: string): Promise<File> {
  const dir = await messageDir(randomId, false)
  return (await dir.getFileHandle(name)).getFile()
}

export async function deleteBlobs(randomId: number) {
  try {
    await (await root(false)).removeEntry(String(randomId), { recursive: true })
  } catch {
    // 不存在
  }
}

/** 删除没有对应发件箱条目的目录（写入文件之后、入队之前崩溃留下的），keep 为仍在发件箱里的 random_id */
export async function sweepBlobs(keep: Set<number>) {
  let dir: FileSystemDirectoryHandle
  try {
    dir = await root(false)
  } catch {
    return
  }
  for await (const name of dir.keys()) {
    if (!keep.has(Number(name))) await dir.removeEntry(name, { recursive: true })
  }
}

export async function wipeBlobs() {
  try {
    await (await navigator.storage.getDirectory()).removeEntry(ROOT, { recursive: true })
  } catch {
    // 不存在
  }
}
