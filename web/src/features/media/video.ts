// 标签页这一侧的视频处理：每个视频开一个 Web Worker 转码，按加入的顺序一个一个来。
// 见 docs/architecture/05-media.md § 视频
import type { VideoMessage, VideoRequest, VideoResult } from './video-worker'

export type { VideoResult } from './video-worker'

/** 按视频处理的文件；浏览器处理不了的再改为按文件发送 */
export function isVideoCandidate(file: File) {
  return file.type.startsWith('video/')
}

/** 上一个视频处理完才开始下一个：同时转码只会互相拖慢，还会占满内存 */
let queue: Promise<unknown> = Promise.resolve()

/**
 * 处理一个视频：转码（或只重新封装）并生成封面。onProgress 的参数为 0–1；
 * signal 中止时结束 Worker，返回的 Promise 以 AbortError 拒绝
 */
export function prepareVideo(file: File, onProgress: (progress: number) => void, signal: AbortSignal): Promise<VideoResult> {
  const run = queue.then(() => (signal.aborted ? Promise.reject(aborted()) : runWorker(file, onProgress, signal)))
  queue = run.catch(() => {})
  return run
}

function runWorker(file: File, onProgress: (progress: number) => void, signal: AbortSignal) {
  return new Promise<VideoResult>((resolve, reject) => {
    const worker = new Worker(new URL('./video-worker.ts', import.meta.url), { type: 'module', name: 'video' })
    const finish = () => {
      signal.removeEventListener('abort', abort)
      worker.terminate()
    }
    const abort = () => {
      finish()
      reject(aborted())
    }
    signal.addEventListener('abort', abort, { once: true })
    worker.onmessage = (e: MessageEvent<VideoMessage>) => {
      if (e.data.type === 'progress') return onProgress(e.data.progress)
      finish()
      resolve(e.data.result)
    }
    // Worker 自己加载失败（例如脚本被拦）：当作处理不了
    worker.onerror = (e) => {
      console.error('video worker failed', e)
      finish()
      resolve({ ok: false, reason: 'unsupported' })
    }
    worker.postMessage({ file } satisfies VideoRequest)
  })
}

const aborted = () => new DOMException('Video processing aborted', 'AbortError')
