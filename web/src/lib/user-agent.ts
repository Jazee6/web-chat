// 从 User-Agent 得出设备名称，用于设备列表。只识别常见浏览器与系统，不追求精确版本。

export type DeviceDescription = { browser: string | null; os: string | null; mobile: boolean }

const BROWSERS: [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\bOPR\//, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\b(?:Firefox|FxiOS)\//, 'Firefox'],
  [/\b(?:Chrome|CriOS)\//, 'Chrome'],
  [/\bVersion\/[\d.]+.*\bSafari\//, 'Safari'],
]

const SYSTEMS: [RegExp, string][] = [
  [/\biPad\b/, 'iPadOS'],
  [/\b(?:iPhone|iPod)\b/, 'iOS'],
  [/\bAndroid\b/, 'Android'],
  [/\bWindows\b/, 'Windows'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bLinux\b/, 'Linux'],
]

const match = (ua: string, table: [RegExp, string][]) => table.find(([re]) => re.test(ua))?.[1] ?? null

export function describeUserAgent(ua: string | null): DeviceDescription {
  if (!ua) return { browser: null, os: null, mobile: false }
  const os = match(ua, SYSTEMS)
  return { browser: match(ua, BROWSERS), os, mobile: os === 'iOS' || os === 'iPadOS' || os === 'Android' || /\bMobi/.test(ua) }
}

/** 例如 "Chrome · macOS"；都认不出时为 "Unknown device" */
export function deviceName({ browser, os }: DeviceDescription): string {
  return [browser, os].filter(Boolean).join(' · ') || 'Unknown device'
}
