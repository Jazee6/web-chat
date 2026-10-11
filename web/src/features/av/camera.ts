// 摄像头：按本机偏好取选定的摄像头，没选过时用前置。开着时跟着走：换了选择、选定的摄像头插回来、当前的被拔掉，
// 都换成新的流交给 onStream。换之前先关掉旧的（手机上同时只能开一个摄像头）
import { avPreferences, onAvPreferences, setAvPreference } from './preferences'
import { avDevices, deviceConstraint, deviceKey, deviceKeyPresent, isMirrored, onAvDevices, refreshAvDevices, trackIsOn, wantedDevice } from './devices'

/** 因为轨道结束而连续重取的上限，与取到后用满多久算稳定 */
const MAX_ENDED_RETRIES = 3
const STABLE_MS = 5000

const SIZE = { width: { ideal: 1280 }, height: { ideal: 720 } }

export class Camera {
  /** 只有一条视频轨道 */
  stream: MediaStream
  /** 换了摄像头 */
  onStream: ((stream: MediaStream) => void) | null = null
  private closed = false
  private switching: Promise<void> = Promise.resolve()
  /** 为之换过的目标设备：换过之后仍对不上时不再为它换 */
  private target: string | null = null
  /** 连续因为轨道结束而重取的次数：取到的总是马上又结束（被别处占用）时停下，不来回抢 */
  private endedRetries = 0
  private readonly unsubscribe: (() => void)[]

  constructor(stream: MediaStream) {
    this.stream = stream
    this.watch(stream)
    let last = avPreferences().camera
    this.unsubscribe = [
      onAvPreferences(() => {
        const next = avPreferences().camera
        if (next === last) return
        last = next
        const wanted = wantedDevice('camera')
        this.target = wanted && deviceKey(wanted)
        if (next === null || (wanted && !trackIsOn(this.track, wanted))) this.replace(() => getCamera())
      }),
      onAvDevices(() => {
        if (avDevices().devices.camera.length === 0) return
        if (this.target && !deviceKeyPresent('camera', this.target)) this.target = null
        const wanted = wantedDevice('camera')
        if (!wanted || trackIsOn(this.track, wanted) || deviceKey(wanted) === this.target) return
        this.target = deviceKey(wanted)
        this.replace(() => getCamera())
      }),
    ]
  }

  get track(): MediaStreamTrack {
    return this.stream.getVideoTracks()[0]!
  }


  /** 前后摄像头互换（手机），换到的那个记为选定的摄像头 */
  flip() {
    const target = isMirrored(this.stream) ? 'environment' : 'user'
    this.replace(() => navigator.mediaDevices.getUserMedia({ video: { ...SIZE, facingMode: { exact: target } } }))
    void this.switching.then(() => {
      const id = this.track.getSettings().deviceId
      if (!this.closed && id) setAvPreference({ camera: id })
    })
  }

  close() {
    if (this.closed) return
    this.closed = true
    for (const off of this.unsubscribe) off()
    stop(this.stream)
  }

  private watch(stream: MediaStream) {
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      if (!this.closed && stream === this.stream && this.endedRetries++ < MAX_ENDED_RETRIES) this.replace(() => getCamera())
    })
  }

  /** 一次只换一个；新的取不到时退回按偏好取 */
  private replace(open: () => Promise<MediaStream>) {
    this.switching = this.switching.then(async () => {
      if (this.closed) return
      stop(this.stream)
      try {
        const stream = await open().catch(() => getCamera())
        if (this.closed) return stop(stream)
        this.stream = stream
        this.watch(stream)
        // 用了一会儿才结束的不算连续
        setTimeout(() => {
          if (this.stream === stream && this.track.readyState === 'live') this.endedRetries = 0
        }, STABLE_MS)
        this.onStream?.(stream)
      } catch (e) {
        console.warn("couldn't switch the camera", e)
      }
    })
  }
}

/** 取摄像头；须在用户操作里调用 */
export async function openCamera(): Promise<Camera> {
  const stream = await getCamera()
  void refreshAvDevices()
  return new Camera(stream)
}

function getCamera(): Promise<MediaStream> {
  const deviceId = deviceConstraint('camera')
  // 选过摄像头时不再带 facingMode：两个都是 ideal，浏览器可能为了前置舍弃选定的
  return navigator.mediaDevices.getUserMedia({ video: deviceId ? { ...SIZE, deviceId } : { ...SIZE, facingMode: 'user' } })
}

function stop(stream: MediaStream) {
  for (const track of stream.getTracks()) track.stop()
}
