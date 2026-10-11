import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { useBlocker } from '@tanstack/react-router'
import { ArrowUpIcon, CheckIcon, FileIcon, ImageIcon, MicIcon, PencilIcon, PlusIcon, ReplyIcon, StickerIcon, XIcon } from 'lucide-react'
import { MAX_TEXT_LENGTH, TYPING_THROTTLE_MS, parseSecretChatId, type Draft, type MessageEntity, type SavedSticker } from 'shared/protocol'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from '@/components/ui/input-group'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Spinner } from '@/components/ui/spinner'
import { toast } from '@/components/ui/toast'
import { useMe } from '@/features/auth/me'
import type { ComposeTarget } from '@/features/chat/compose'
import { opErrorMessage } from '@/features/groups/errors'
import { takePendingShare } from '@/features/share/pending'
import { useUsers } from '@/hooks/use-users'
import { useHeightMotion } from '@/hooks/use-height-motion'
import { useOpened } from '@/hooks/use-opened'
import { describeMediaJson } from '@/lib/media-text'
import { topics } from '@/sync/bridge'
import { call } from '@/sync/client'
import { useLiveQuery } from '@/sync/live-query'
import { LinkBar } from '@/features/link/link-bar'
import { useLinkPreview } from '@/features/link/use-link-preview'
import { pause as pausePlayer } from '@/features/voice/player'
import { RecordBar } from '@/features/voice/record-bar'
import { RecordError, recordingSupported, useRecorder, type VoiceTake } from '@/features/voice/recorder'
import { randomId } from '@/sync/logic'
import { AttachmentTray } from './attachment-tray'
import { composeMessages, useAttachments, type AttachAs } from './attachments'
import { MentionPicker, type MentionCandidate } from './mention-picker'
import { findMentions, mentionQuery } from './mentions'

const StickerPanel = lazy(() => import('@/features/stickers/sticker-panel').then((m) => ({ default: m.StickerPanel })))

/** 可以提及的人：群组的其他当前成员（私聊没有成员行，也就没有提及） */
const MEMBERS_SQL = `
  SELECT p.id, p.name, p.own_name, p.image FROM chat_members m JOIN people p ON p.id = m.user_id
  WHERE m.chat_id = ? AND m.user_id != ?
  ORDER BY p.name COLLATE NOCASE`

/** 录音期间多久向同步 Worker 报一次录音动作 */
const RECORDING_PING_MS = 1000

/** 候选列表最多显示几个人 */
const MAX_CANDIDATES = 6

/** 在候选列表里选过的人：文字里的 @名字 发送时据此变成提及 */
type Picked = { user_id: string; name: string }

/** 编辑消息时，原来的提及也算选过 */
const pickedOf = (text: string, entities: MessageEntity[] | undefined): Picked[] =>
  (entities ?? []).map((e) => ({ user_id: e.user_id, name: text.slice(e.offset + 1, e.offset + e.length) }))

// 打开会话时恢复的草稿，连同被回复的消息（本地没有时只恢复文字）
const DRAFT_SQL = `
  SELECT d.text, d.reply_to, m.sender_id AS reply_sender_id, m.kind AS reply_kind, m.text AS reply_text, m.media AS reply_media
  FROM drafts d LEFT JOIN messages m ON m.chat_id = d.chat_id AND m.seq = d.reply_to
  WHERE d.chat_id = ?`

const EMPTY_DRAFT: Draft = { text: '', reply_to: null }

type DraftRow = {
  text: string
  reply_to: number | null
  reply_sender_id: string | null
  reply_kind: string | null
  reply_text: string | null
  reply_media: string | null
}

/**
 * 输入框：先写发件箱并乐观渲染，由同步 Worker 负责上传、发送与重发。
 * target 为正在回复或编辑的消息；编辑时暂存原来的文字，结束后放回。
 * 附件从回形针菜单（图片 / 文件）、粘贴或拖进页面加入。
 * 语音消息：输入框为空且没有附件时，发送按钮换成麦克风，点一下开始录，录音条取代输入框；录音时离开会话先确认丢弃。
 * 贴纸：从回形针菜单打开我的贴纸，点一张立即单独发出（带上正在回复的消息），输入框里的文字与附件不动。
 * 草稿：打开时恢复一次（之后其他设备同步来的草稿不覆盖输入框），离开会话或页面转入后台时、输入框有改动才保存，
 * 回复目标经 onRestoreReply 交还给会话页
 */
export function Composer({
  chatId,
  target,
  onCancel,
  onRestoreReply,
}: {
  chatId: string
  target: ComposeTarget | null
  onCancel: () => void
  onRestoreReply: (target: ComposeTarget) => void
}) {
  const me = useMe()
  const [text, setText] = useState('')
  const [picked, setPicked] = useState<Picked[]>([])
  // 编辑消息时暂存原来的文字与选过的人，结束后放回
  const [stash, setStash] = useState<{ text: string; picked: Picked[] } | null>(null)
  const [saving, setSaving] = useState(false)
  const [stickersOpen, setStickersOpen] = useState(false)
  const stickersOpened = useOpened(stickersOpen)
  const [shownTarget, setShownTarget] = useState(target)
  const trimmed = text.trim()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const groupRef = useRef<HTMLDivElement>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const typedAt = useRef(0)
  const editing = target?.mode === 'edit'
  const attachments = useAttachments()
  const hasAttachments = attachments.items.length > 0 && !editing
  const canSend = editing ? trimmed.length > 0 : (trimmed.length > 0 || hasAttachments) && attachments.ready
  const secret = parseSecretChatId(chatId) !== null
  // 编辑消息不重新生成卡片；秘密聊天不生成（抓取会把链接告诉服务端）
  const link = useLinkPreview(text, !editing && !secret)
  const textOnly = editing

  const sendVoice = (take: VoiceTake | null) => {
    if (!take) return
    // 录音期间仍可能从菜单里选了编辑：只有回复目标才带上
    const replyTo = target?.mode === 'reply' ? target.seq : undefined
    call('send', { chatId, replyTo, messages: [{ randomId: randomId(), media: [take] }] }).catch((e: unknown) =>
      toast.add({ type: 'error', title: "Couldn't send the voice message", description: opErrorMessage(e, 'Try again.') }),
    )
    onCancel()
  }
  const sendSticker = (sticker: SavedSticker) => {
    setStickersOpen(false)
    // 编辑时菜单里没有贴纸，这里只会是回复
    const replyTo = target?.mode === 'reply' ? target.seq : undefined
    call('send', { chatId, replyTo, messages: [{ randomId: randomId(), sticker }] }).catch((e: unknown) =>
      toast.add({ type: 'error', title: "Couldn't send the sticker", description: opErrorMessage(e, 'Try again.') }),
    )
    if (target) onCancel()
  }
  const recorder = useRecorder({
    onLimit: sendVoice,
    onLost: () => toast.add({ type: 'error', title: 'Recording stopped', description: 'Nothing was recorded.' }),
  })
  const recordState = recorder.state
  const recording = recordState.status === 'recording'
  // 录音中：输入中换成录音动作；没有按键，所以定时重报，接收方才不会让它过期。
  // 比节流间隔报得勤，由同步 Worker 按 TYPING_THROTTLE_MS 节流：间隔恰好相等时，转发的延迟抖动会让一次上报被节流掉
  useEffect(() => {
    if (!recording) return
    const ping = () => void call('typing', { chatId, action: 'recording' })
    ping()
    const timer = setInterval(ping, RECORDING_PING_MS)
    return () => clearInterval(timer)
  }, [recording, chatId])

  const startRecording = () => {
    pausePlayer()
    recorder.start().catch((e: unknown) => {
      const denied = e instanceof RecordError && e.reason === 'denied'
      toast.add({
        type: 'error',
        title: denied ? 'Microphone access is blocked' : "Couldn't start recording",
        description: denied ? 'Allow microphone access in your browser settings and try again.' : 'Check that a microphone is connected.',
      })
    })
  }

  // 录音时（含被打断后等待选择）离开会话：先确认丢弃；刷新或关闭页面时由浏览器询问
  const recordActive = recordState.status !== 'idle'
  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) => recordActive && current.pathname !== next.pathname,
    enableBeforeUnload: recordActive,
    withResolver: true,
  })

  if (target !== shownTarget) {
    setShownTarget(target)
    if (target?.mode === 'edit') {
      setStash((d) => d ?? { text, picked })
      setText(target.text)
      setPicked(pickedOf(target.text, target.entities))
    } else if (stash !== null) {
      setText(stash.text)
      setPicked(stash.picked)
      setStash(null)
    }
  }

  // 提及：光标前正在输入 @ 时，在群组的其他成员里找候选；Esc 关掉的那个 @ 不再弹出
  const members = useLiveQuery<MentionCandidate>(MEMBERS_SQL, [chatId, me.id], [topics.members(chatId), topics.users]) ?? []
  const [caret, setCaret] = useState(0)
  const [dismissed, setDismissed] = useState<number | null>(null)
  const [active, setActive] = useState(0)
  const query = members.length > 0 ? mentionQuery(text, caret) : null
  const candidates =
    query && query.start !== dismissed
      ? members
          .filter((m) => [m.name, m.own_name].some((n) => n.toLowerCase().includes(query.query.toLowerCase())))
          .slice(0, MAX_CANDIDATES)
      : []
  const activeIndex = Math.min(active, candidates.length - 1)

  const pickMention = (c: MentionCandidate) => {
    if (!query) return
    const insert = `@${c.own_name} `
    const pos = query.start + insert.length
    setText(text.slice(0, query.start) + insert + text.slice(caret))
    setPicked((p) => [...p, { user_id: c.id, name: c.own_name }])
    setCaret(pos)
    setActive(0)
    requestAnimationFrame(() => textareaRef.current?.setSelectionRange(pos, pos))
  }

  // 要保存的草稿：编辑消息时是暂存的文字；只有空白不算。草稿只存文字，提及不随草稿保存
  const draftText = editing ? (stash?.text ?? '') : text
  const draft: Draft = { text: draftText.trim() ? draftText : '', reply_to: target?.mode === 'reply' ? target.seq : null }
  const latestDraft = useRef(draft)
  // 恢复回复目标的回调经 ref 读取：草稿的恢复与保存只随会话变化，不随会话页重渲染
  const restoreReply = useRef(onRestoreReply)
  useEffect(() => {
    latestDraft.current = draft
    restoreReply.current = onRestoreReply
  })
  // 输入框里原有的草稿（恢复出来的或上次保存的）。只有本次打开期间改过才保存：
  // 恢复之前就离开不会用空草稿覆盖它，没动过输入框也不会覆盖其他设备在此期间改的草稿
  const saved = useRef<Draft>(EMPTY_DRAFT)

  useEffect(() => {
    let cancelled = false
    void call('query', { sql: DRAFT_SQL, params: [chatId] }).then((rows) => {
      if (cancelled) return
      const row = rows[0] as DraftRow | undefined
      if (!row) return
      if (row.text) setText((t) => t || row.text)
      // 被回复的消息本地没有时不恢复回复目标，也就不把它算作原有的草稿，离开时不会因此清掉
      const replyShown = row.reply_to !== null && row.reply_sender_id !== null
      saved.current = { text: row.text, reply_to: replyShown ? row.reply_to : null }
      if (replyShown) {
        const summary = row.reply_media
          ? describeMediaJson(row.reply_media)
          : row.reply_kind === 'recalled'
            ? 'Recalled message'
            : (row.reply_text ?? '')
        restoreReply.current({ mode: 'reply', seq: row.reply_to!, senderId: row.reply_sender_id!, text: summary })
      }
    })
    const save = () => {
      const draft = latestDraft.current
      if (draft.text === saved.current.text && draft.reply_to === saved.current.reply_to) return
      saved.current = draft
      void call('saveDraft', { chatId, draft })
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') save()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      save()
      saved.current = EMPTY_DRAFT
    }
  }, [chatId])

  // 打开会话就可以直接打字；触屏上不自动聚焦，免得一进来就弹出键盘
  useEffect(() => {
    if (matchMedia('(pointer: fine)').matches) textareaRef.current?.focus()
  }, [chatId])

  useEffect(() => {
    if (target) textareaRef.current?.focus()
  }, [target])

  // 把文件拖进页面任意位置即加入附件栏；编辑消息时不接收
  const addFiles = attachments.add

  // 从系统分享面板进来并选中了这个会话：预填分享的文字与文件
  useEffect(() => {
    const shared = takePendingShare()
    if (!shared) return
    // 分享内容只能取一次（取走即清除），不能放进 useState 的初始化（StrictMode 会执行两次）
    // oxlint-disable-next-line react/set-state-in-effect
    if (shared.text) setText((t) => (t ? `${t}\n${shared.text}` : shared.text))
    if (shared.files.length > 0) addFiles(shared.files, 'auto')
    textareaRef.current?.focus()
  }, [chatId, addFiles])
  useEffect(() => {
    if (textOnly) return
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') === true
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault()
    }
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      addFiles([...e.dataTransfer!.files], 'auto')
      textareaRef.current?.focus()
    }
    addEventListener('dragover', over)
    addEventListener('drop', drop)
    return () => {
      removeEventListener('dragover', over)
      removeEventListener('drop', drop)
    }
  }, [textOnly, addFiles])

  const pick = (e: React.ChangeEvent<HTMLInputElement>, as: AttachAs) => {
    attachments.add([...(e.target.files ?? [])], as)
    e.target.value = ''
    textareaRef.current?.focus()
  }

  const saveEdit = async (seq: number) => {
    const entities = findMentions(trimmed, picked)
    if (trimmed === target?.text && JSON.stringify(entities) === JSON.stringify(target.entities ?? [])) {
      onCancel()
      return
    }
    setSaving(true)
    try {
      await call('editMessage', { chatId, seq, text: trimmed, entities })
      onCancel()
    } catch (e) {
      toast.add({ type: 'error', title: "Couldn't edit the message", description: opErrorMessage(e, 'Try again.') })
    } finally {
      setSaving(false)
    }
  }

  const send = () => {
    if (!canSend || saving) return
    if (target?.mode === 'edit') {
      void saveEdit(target.seq)
      return
    }
    const entities = findMentions(trimmed, picked)
    const sent = { text, picked, items: attachments.take(), reply: target }
    call('send', { chatId, replyTo: target?.seq, messages: composeMessages(sent.items, trimmed, entities, link.outgoing) }).then(
      () => attachments.discard(sent.items),
      (e: unknown) => {
        toast.add({ type: 'error', title: "Couldn't send the message", description: opErrorMessage(e, 'Try again.') })
        // 本地写入失败：输入框还空着就把发出的内容放回，免得白打
        const empty = latestDraft.current.text === '' && latestDraft.current.reply_to === null
        if (!attachments.putBack(sent.items, empty)) return
        setText(sent.text)
        setPicked(sent.picked)
        if (sent.reply) restoreReply.current(sent.reply)
      },
    )
    setText('')
    setPicked([])
    onCancel()
  }

  const block = target !== null || hasAttachments || link.url !== null
  // 输入框上方多了或少了一条（回复、编辑、链接预览、附件），或换成录音条时，高度平滑过渡；消息列表随之贴底
  const [heightRef, heightLocked] = useHeightMotion<HTMLFormElement>(
    [recordState.status !== 'idle', target?.mode, link.url !== null, hasAttachments].join(),
  )
  const canRecord = recordingSupported && !textOnly && !trimmed && !hasAttachments
  const attach = !textOnly && (
    <AttachMenu
      onPhoto={() => photoInputRef.current?.click()}
      onFile={() => fileInputRef.current?.click()}
      onSticker={() => setStickersOpen(true)}
    />
  )
  const submit = canRecord ? (
    <InputGroupButton variant="default" size="icon-sm" className="ml-auto" aria-label="Record voice message" onClick={startRecording}>
      <MicIcon />
    </InputGroupButton>
  ) : (
    <InputGroupButton
      type="submit"
      variant="default"
      size="icon-sm"
      className="ml-auto"
      disabled={!canSend || saving}
      aria-label={editing ? 'Save' : 'Send'}
    >
      {saving ? <Spinner /> : editing ? <CheckIcon /> : <ArrowUpIcon />}
    </InputGroupButton>
  )

  return (
    <form
      ref={heightRef}
      data-height-locked={heightLocked || undefined}
      className="mx-auto w-full max-w-3xl p-3 data-height-locked:h-(--height-motion-last)"
      onSubmit={(e) => {
        e.preventDefault()
        send()
      }}
    >
      <MentionPicker
        anchor={groupRef}
        candidates={candidates}
        active={activeIndex}
        onPick={pickMention}
        onHover={setActive}
        onDismiss={() => query && setDismissed(query.start)}
      />
      <input ref={photoInputRef} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => pick(e, 'photo')} />
      <input ref={fileInputRef} type="file" multiple hidden onChange={(e) => pick(e, 'file')} />
      {stickersOpened && (
        <Suspense>
          <StickerPanel anchor={groupRef} open={stickersOpen} onOpenChange={setStickersOpen} onSend={sendSticker} />
        </Suspense>
      )}
      <AlertDialog open={blocker.status === 'blocked'} onOpenChange={(open) => !open && blocker.reset?.()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard voice message?</AlertDialogTitle>
            <AlertDialogDescription>You’re recording a voice message. If you leave, it won’t be sent.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep recording</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                recorder.cancel()
                blocker.proceed?.()
              }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {recordState.status !== 'idle' ? (
        <RecordBar
          state={recordState}
          top={target && <TargetBar target={target} onCancel={onCancel} />}
          onDelete={recorder.cancel}
          onSend={() => void recorder.finish().then(sendVoice)}
        />
      ) : (
        <InputGroup ref={groupRef}>
          {block && (
            <InputGroupAddon align="block-start" className="flex-col items-stretch">
              {target && <TargetBar target={target} onCancel={onCancel} />}
              {link.url && <LinkBar url={link.url} resolved={link.resolved} onDismiss={link.dismiss} />}
              {hasAttachments && <AttachmentTray items={attachments.items} onRemove={attachments.remove} />}
            </InputGroupAddon>
          )}
          <InputGroupTextarea
            ref={textareaRef}
            aria-label="Message"
            placeholder="Message"
            rows={1}
            maxLength={MAX_TEXT_LENGTH}
            className="max-h-40 min-h-0"
            value={text}
            aria-controls={candidates.length > 0 ? 'mention-picker' : undefined}
            aria-activedescendant={candidates.length > 0 ? `mention-${candidates[activeIndex]!.id}` : undefined}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onChange={(e) => {
              setText(e.target.value)
              setCaret(e.target.selectionStart)
              setActive(0)
              // 输入中：编辑消息不算；同步 Worker 还会再节流一次（多个标签页）
              const now = Date.now()
              if (!editing && e.target.value.trim() && now - typedAt.current >= TYPING_THROTTLE_MS) {
                typedAt.current = now
                void call('typing', { chatId, action: 'typing' })
              }
            }}
            onPaste={(e) => {
              if (textOnly || e.clipboardData.files.length === 0) return
              e.preventDefault()
              attachments.add([...e.clipboardData.files], 'auto')
            }}
            onKeyDown={(e) => {
              // 候选列表打开时：上下键选择，Enter / Tab 选中，Esc 关闭
              if (candidates.length > 0 && !e.nativeEvent.isComposing) {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault()
                  const step = e.key === 'ArrowDown' ? 1 : -1
                  setActive((activeIndex + step + candidates.length) % candidates.length)
                  return
                }
                if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
                  e.preventDefault()
                  pickMention(candidates[activeIndex]!)
                  return
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setDismissed(query!.start)
                  return
                }
              }
              // Enter 发送，Shift+Enter 换行；输入法组字时不拦截
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                send()
              }
              if (e.key === 'Escape' && target) {
                e.preventDefault()
                onCancel()
              }
            }}
          />
          {/* 有目标条或附件时输入组变为纵向排列，按钮改放到底部一行：附件在左，发送在右；
              否则按钮在两侧，输入多行时贴底 */}
          {block ? (
            <InputGroupAddon align="block-end">
              {attach}
              {submit}
            </InputGroupAddon>
          ) : (
            <>
              <InputGroupAddon align="inline-start" className="self-end">
                {attach}
              </InputGroupAddon>
              <InputGroupAddon align="inline-end" className="self-end">
                {submit}
              </InputGroupAddon>
            </>
          )}
        </InputGroup>
      )}
    </form>
  )
}

function AttachMenu({ onPhoto, onFile, onSticker }: { onPhoto: () => void; onFile: () => void; onSticker: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<InputGroupButton size="icon-sm" aria-label="Attach" />}>
        <PlusIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top">
        <DropdownMenuItem onClick={onPhoto}>
          <ImageIcon />
          Photo or Video
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onFile}>
          <FileIcon />
          File
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onSticker}>
          <StickerIcon />
          Sticker
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function TargetBar({ target, onCancel }: { target: ComposeTarget; onCancel: () => void }) {
  const me = useMe()
  const users = useUsers()
  const name = target.senderId === me.id ? 'yourself' : (users.get(target.senderId)?.name ?? 'Someone')
  const editing = target.mode === 'edit'

  return (
    <Item variant="quote" size="xs">
      <ItemMedia variant="icon">{editing ? <PencilIcon /> : <ReplyIcon />}</ItemMedia>
      <ItemContent>
        <ItemTitle>{editing ? 'Edit message' : `Reply to ${name}`}</ItemTitle>
        <ItemDescription>{target.text}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <InputGroupButton size="icon-xs" aria-label={editing ? 'Cancel editing' : 'Cancel reply'} onClick={onCancel}>
          <XIcon />
        </InputGroupButton>
      </ItemActions>
    </Item>
  )
}
