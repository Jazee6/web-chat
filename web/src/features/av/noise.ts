// AI 降噪：RNNoise（wasm）跑在 AudioWorklet 里，麦克风 → 降噪节点 → MediaStreamDestination，输出一条新的音轨。
// 库与 wasm 只在第一次用到时加载；加载或建图失败由调用方退回浏览器自带的降噪
import workletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url'
import wasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url'
import simdUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url'

/** RNNoise 只处理 48kHz */
export const DENOISE_SAMPLE_RATE = 48_000
/** 等 AudioContext 开始运行的上限：没有用户操作时可能一直停着，停着输出的是静音 */
const RESUME_TIMEOUT_MS = 1000

export const aiNoiseSupported = typeof AudioWorkletNode !== 'undefined' && typeof WebAssembly !== 'undefined'

type Loaded = { lib: typeof import('@sapphi-red/web-noise-suppressor'); wasm: ArrayBuffer }
let loading: Promise<Loaded> | null = null

function load(): Promise<Loaded> {
  loading ??= (async () => {
    const lib = await import('@sapphi-red/web-noise-suppressor')
    return { lib, wasm: await lib.loadRnnoise({ url: wasmUrl, simdUrl }) }
  })().catch((e: unknown) => {
    // 下次再试（可能只是一时离线）
    loading = null
    throw e
  })
  return loading
}

const prepared = new WeakSet<AudioContext>()

/** 加载库与 wasm，并在这个 AudioContext 上注册处理器；取麦克风之前调用，失败就不开 AI 降噪 */
export async function prepareDenoiser(context: AudioContext): Promise<void> {
  await load()
  if (prepared.has(context)) return
  await context.audioWorklet.addModule(workletUrl)
  prepared.add(context)
}

export type Denoiser = { track: MediaStreamTrack; close: () => void }

/** 给麦克风的原始音轨接上降噪，返回降噪后的音轨；context 须已 prepareDenoiser */
export async function denoise(raw: MediaStreamTrack, context: AudioContext): Promise<Denoiser> {
  const { lib, wasm } = await load()
  const source = context.createMediaStreamSource(new MediaStream([raw]))
  const node = new lib.RnnoiseWorkletNode(context, { maxChannels: 1, wasmBinary: wasm })
  const destination = context.createMediaStreamDestination()
  source.connect(node).connect(destination)
  const close = () => {
    source.disconnect()
    node.disconnect()
    node.destroy()
  }
  if (context.state !== 'running') {
    await Promise.race([context.resume(), new Promise((resolve) => setTimeout(resolve, RESUME_TIMEOUT_MS))])
    if ((context.state as AudioContextState) !== 'running') {
      close()
      throw new Error('audio context is not running')
    }
  }
  return { track: destination.stream.getAudioTracks()[0]!, close }
}
