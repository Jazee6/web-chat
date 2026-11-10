// 介绍页首屏的演示：用应用里的 Message、Bubble 等组件拼出一个群组会话，消息按顺序以纯 CSS 动画出现（页面不带 JS）。
// 偏好减少动效时直接显示最终状态
import type { ReactNode } from 'react'
import { LockIcon, MicIcon, MountainIcon, PhoneIcon, PlayIcon, PlusIcon, SearchIcon } from 'lucide-react'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Bubble, BubbleContent, BubbleReactions } from '@/components/ui/bubble'
import { Message, MessageContent, MessageFooter, MessageHeader } from '@/components/ui/message'
import { Waveform } from '@/features/voice/waveform-view'
import { cn } from '@/lib/utils'
import type { Copy } from './content'

/** 语音消息的波形：固定的采样，每次构建都一样 */
const SAMPLES = Array.from({ length: 36 }, (_, i) => 0.25 + 0.75 * Math.abs(Math.sin(i * 0.9) * Math.cos(i * 0.31)))

/** 依次出场的延迟，间隔 0.8 秒（tw-animate 的 delay-* 以毫秒计） */
const DELAYS = ['delay-400', 'delay-1200', 'delay-2000', 'delay-2800', 'delay-3600', 'delay-4400']
const DOT_DELAYS = ['delay-0', 'delay-150', 'delay-300']

/** 第 step 个出场的元素 */
function Reveal({ step, className, children }: { step: number; className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        'animate-in fill-mode-both duration-500 ease-enter fade-in slide-in-from-bottom-3 motion-reduce:animate-none',
        DELAYS[step],
        className,
      )}
    >
      {children}
    </div>
  )
}

function Initial({ name, className }: { name: string; className?: string }) {
  return (
    <Avatar className={className}>
      <AvatarFallback>{name.slice(0, 1)}</AvatarFallback>
    </Avatar>
  )
}

export function DemoChat({ copy }: { copy: Copy['demo'] }) {
  const names = copy.people

  return (
    <div
      role="img"
      aria-label={copy.label}
      className="grid h-[36rem] overflow-hidden md:h-[42rem] rounded-3xl border bg-background text-left shadow-2xl md:grid-cols-[17rem_1fr]"
    >
      {/* 对话列表 */}
      <div className="hidden flex-col gap-3 border-r bg-sidebar p-3 md:flex">
        <div className="flex h-9 items-center gap-2 rounded-4xl border bg-input/30 px-3 text-sm text-muted-foreground">
          <SearchIcon className="size-4" />
          {copy.search}
        </div>
        <div className="flex flex-col gap-1">
          {copy.dialogs.map((d, i) => (
            <div key={d.name} className={cn('flex items-center gap-3 rounded-xl p-2', i === 0 && 'bg-sidebar-accent')}>
              <Initial name={d.name} className="size-10" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  {i === 1 && <LockIcon className="size-3.5 text-success" />}
                  <span className="truncate">{d.name}</span>
                  <span className="ml-auto text-xs font-normal text-muted-foreground">{d.time}</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="truncate">{d.preview}</span>
                  {i === 1 && <Badge className="ml-auto">2</Badge>}
                  {i === 2 && <Badge className="ml-auto">@</Badge>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 会话：消息多出来时像真实会话一样从顶部裁掉 */}
      <div className="flex min-h-0 min-w-0 flex-col">
        <div className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
          <Initial name={copy.group} />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium">{copy.group} 🥾</span>
            <span className="text-xs text-muted-foreground">{copy.members}</span>
          </div>
          <PhoneIcon className="ml-auto size-4 text-muted-foreground" />
          <SearchIcon className="size-4 text-muted-foreground" />
        </div>

        <div className="flex min-h-0 flex-1 flex-col justify-end gap-3 overflow-hidden p-4">
          <Reveal step={0}>
            <Message>
              <MessageContent>
                <MessageHeader>{names.carol}</MessageHeader>
                <Bubble variant="muted">
                  <BubbleContent>{copy.carol}</BubbleContent>
                </Bubble>
              </MessageContent>
            </Message>
          </Reveal>

          <Reveal step={1}>
            <Message>
              <MessageContent>
                <MessageHeader>{names.bob}</MessageHeader>
                <Bubble variant="muted">
                  <BubbleContent>
                    <div className="flex items-center gap-3">
                      <span className={buttonVariants({ size: 'icon' })}>
                        <PlayIcon />
                      </span>
                      <div className="grid gap-1">
                        <Waveform samples={SAMPLES} progress={0.35} />
                        <span className="text-xs text-muted-foreground tabular-nums">0:04 / 0:12</span>
                      </div>
                    </div>
                  </BubbleContent>
                </Bubble>
              </MessageContent>
            </Message>
          </Reveal>

          <Reveal step={2}>
            <Message align="end">
              <MessageContent>
                <Bubble reactions>
                  <BubbleContent>
                    <Item variant="quote" size="xs">
                      <ItemContent>
                        <ItemTitle>{names.carol}</ItemTitle>
                        <ItemDescription>{copy.meReplyTo}</ItemDescription>
                      </ItemContent>
                    </Item>
                    <p>{copy.me}</p>
                  </BubbleContent>
                  <BubbleReactions>❤️ 2</BubbleReactions>
                </Bubble>
              </MessageContent>
            </Message>
          </Reveal>

          <Reveal step={3}>
            <Message>
              <MessageContent>
                <MessageHeader>{names.dan}</MessageHeader>
                <Bubble variant="ghost">
                  <BubbleContent>
                    <Item variant="link" size="flush">
                      <ItemMedia variant="icon">
                        <MountainIcon />
                      </ItemMedia>
                      <ItemContent>
                        <ItemTitle>{copy.linkTitle}</ItemTitle>
                        <ItemDescription>{copy.linkDomain}</ItemDescription>
                      </ItemContent>
                    </Item>
                  </BubbleContent>
                </Bubble>
              </MessageContent>
            </Message>
          </Reveal>

          <Reveal step={4}>
            <Message>
              <MessageContent>
                <MessageHeader>{names.carol}</MessageHeader>
                <Bubble variant="ghost">
                  <BubbleContent>
                    <p className="text-5xl/tight">🏔️</p>
                  </BubbleContent>
                </Bubble>
              </MessageContent>
            </Message>
          </Reveal>

          <Reveal step={5}>
            <Message>
              <MessageContent>
                <MessageFooter>
                  <span className="flex items-center gap-1.5">
                    <span className="flex gap-0.5">
                      {DOT_DELAYS.map((delay) => (
                        <span key={delay} className={cn('size-1 animate-bounce rounded-full bg-current motion-reduce:animate-none', delay)} />
                      ))}
                    </span>
                    {copy.typing}
                  </span>
                </MessageFooter>
              </MessageContent>
            </Message>
          </Reveal>
        </div>

        <div className="p-3 pt-0">
          <div className="flex h-12 items-center gap-3 rounded-4xl border px-2 text-sm text-muted-foreground">
            <PlusIcon className="ml-1.5 size-5" />
            <span className="flex-1">{copy.composer}</span>
            <span className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <MicIcon className="size-4" />
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
