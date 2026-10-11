import { summarizeMedia, type Media } from 'shared/protocol'
import { describeMedia } from 'shared/text'

/** 从消息的 media（JSON 数组）得出摘要 */
export function describeMediaJson(json: string) {
  return describeMedia(summarizeMedia(JSON.parse(json) as Media[]))
}
