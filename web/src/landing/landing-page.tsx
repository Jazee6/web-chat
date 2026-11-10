// 介绍页（ADR-0015）：构建时渲染成静态 HTML，不带 JS。交互只有链接与 <details>
import type { ReactNode } from 'react'
import {
  ArrowDownIcon,
  ArrowRightIcon,
  BookOpenIcon,
  CheckIcon,
  ChevronDownIcon,
  CloudIcon,
  DatabaseIcon,
  GlobeIcon,
  HardDriveIcon,
  ImageIcon,
  KeyRoundIcon,
  LockIcon,
  MessageCircleIcon,
  MonitorSmartphoneIcon,
  ServerIcon,
  UsersIcon,
  VideoIcon,
  WifiOffIcon,
} from 'lucide-react'

import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { COPY, DEPLOY_URL, PATHS, REPO, type Lang } from './content'
import { DemoChat } from './demo-chat'

const FEATURE_ICONS = [UsersIcon, LockIcon, VideoIcon, ImageIcon, WifiOffIcon, MonitorSmartphoneIcon, KeyRoundIcon]
/** 功能网格的跨度：两大、三小、两大 */
const FEATURE_SPANS = ['md:col-span-3', 'md:col-span-3', 'md:col-span-2', 'md:col-span-2', 'md:col-span-2', 'md:col-span-3', 'md:col-span-3']

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.25 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  )
}

/** 群组卡片的配图：一排成员头像与固定的 8 个回应 */
function GroupArt() {
  return (
    <div aria-hidden className="mt-auto flex flex-wrap items-center gap-4 pt-2">
      <div className="flex *:ring-2 *:ring-card *:not-first:-ml-2">
        {['A', 'B', 'C', 'D', 'E'].map((c) => (
          <span key={c} className="flex size-8 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground">
            {c}
          </span>
        ))}
        <span className="flex size-8 items-center justify-center rounded-full bg-secondary text-xs">+15</span>
      </div>
      <div className="flex gap-1 rounded-4xl bg-muted px-2 py-1 text-sm">
        {['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '👎'].map((e) => (
          <span key={e}>{e}</span>
        ))}
      </div>
    </div>
  )
}

/** 秘密聊天卡片的配图：60 位安全码，12 组、每组 5 位 */
function SafetyCodeArt() {
  const digits = '384920175563018472910384752019348576120938475601928374650192'
  return (
    <div aria-hidden className="mt-auto grid grid-cols-6 gap-x-3 gap-y-1 pt-2 font-mono text-sm text-muted-foreground tabular-nums">
      {Array.from({ length: 12 }, (_, i) => (
        <span key={i}>{digits.slice(i * 5, i * 5 + 5)}</span>
      ))}
    </div>
  )
}

function Section({ id, title, lead, children }: { id: string; title: string; lead?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mx-auto flex w-full max-w-6xl scroll-mt-14 flex-col gap-10 px-6 py-16 md:py-20">
      <div className="flex max-w-2xl flex-col gap-3">
        <h2 id={`${id}-title`} className="text-3xl font-semibold tracking-tight text-balance md:text-4xl">
          {title}
        </h2>
        {lead && <p className="text-lg text-pretty text-muted-foreground">{lead}</p>}
      </div>
      {children}
    </section>
  )
}

/** 架构图里的一个方框 */
function Node({ icon, title, items, className }: { icon: ReactNode; title: string; items?: string[]; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-3 rounded-2xl border bg-card p-4', className)}>
      <div className="flex items-center gap-2 text-sm font-medium [&_svg]:size-4 [&_svg]:text-muted-foreground">
        {icon}
        {title}
      </div>
      {items && (
        <ul className="flex flex-wrap gap-1.5">
          {items.map((item) => (
            <li key={item} className="rounded-4xl bg-muted px-2.5 py-1 text-xs text-muted-foreground">
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function LandingPage({ lang }: { lang: Lang }) {
  const t = COPY[lang]
  const other: Lang = lang === 'en' ? 'zh' : 'en'
  const a = t.architecture

  return (
    <div className="flex min-h-svh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50">
        {t.nav.skip}
      </a>
      <header className="sticky top-0 z-40 border-b app-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-6 px-6">
          <a href={PATHS[lang]} className="flex shrink-0 items-center gap-2 font-semibold whitespace-nowrap">
            <MessageCircleIcon className="size-5" />
            Web Chat
          </a>
          <nav aria-label="Primary" className="hidden items-center gap-5 text-sm text-muted-foreground md:flex">
            <a href="#features" className="hover:text-foreground">
              {t.nav.features}
            </a>
            <a href="#architecture" className="hover:text-foreground">
              {t.nav.architecture}
            </a>
            <a href="#deploy" className="hover:text-foreground">
              {t.nav.deploy}
            </a>
            <a href="#faq" className="hover:text-foreground">
              {t.nav.faq}
            </a>
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <a href={PATHS[other]} hrefLang={other === 'zh' ? 'zh-Hans' : 'en'} lang={other === 'zh' ? 'zh-Hans' : 'en'} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
              <GlobeIcon data-icon="inline-start" />
              {t.nav.switchLang}
            </a>
            <a href={REPO} aria-label="GitHub" className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'max-sm:hidden')}>
              <GitHubIcon className="size-4" />
            </a>
            <a href="/login" className={cn(buttonVariants({ size: 'sm' }), 'ml-1 max-sm:hidden')}>
              {t.nav.signIn}
            </a>
          </div>
        </div>
      </header>

      <main id="main" className="flex flex-col">
        {/* 首屏 */}
        <section className="relative isolate overflow-hidden">
          {/* 背景：淡网格加一团主色光晕 */}
          <div
            aria-hidden
            className="absolute inset-0 -z-10 bg-grid"
          />
          <div aria-hidden className="absolute top-[28rem] left-1/2 -z-10 size-[40rem] -translate-x-1/2 rounded-full bg-sidebar-primary/25 blur-3xl" />

          <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-14 px-6 pt-16 pb-24 md:pt-20">
            <div className="flex max-w-3xl flex-col items-center gap-6 text-center">
              <a
                href={REPO}
                className="flex items-center gap-2 rounded-4xl border bg-input/30 px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                <GitHubIcon className="size-3.5" />
                {t.hero.eyebrow}
                <ArrowRightIcon className="size-3.5" />
              </a>
              <h1 className="text-4xl font-semibold tracking-tight text-balance md:text-6xl">{t.hero.title}</h1>
              <p className="max-w-2xl text-lg text-pretty text-muted-foreground md:text-xl">{t.hero.lead}</p>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <a href="/login" className={buttonVariants({ size: 'lg' })}>
                  {t.hero.open}
                  <ArrowRightIcon data-icon="inline-end" />
                </a>
                <a href={DEPLOY_URL} className={buttonVariants({ variant: 'outline', size: 'lg' })}>
                  <CloudIcon data-icon="inline-start" />
                  {t.hero.deploy}
                </a>
              </div>
              <ul className="flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
                {t.hero.facts.map((fact) => (
                  <li key={fact} className="flex items-center gap-1.5">
                    <CheckIcon className="size-4 text-success" />
                    {fact}
                  </li>
                ))}
              </ul>
            </div>
            <div className="w-full max-w-5xl">
              <DemoChat copy={t.demo} />
            </div>
          </div>
        </section>

        <Section id="features" title={t.features.title} lead={t.features.lead}>
          <ul className="grid gap-4 md:grid-cols-6">
            {t.features.items.map((f, i) => {
              const Icon = FEATURE_ICONS[i]!
              return (
                <li key={f.title} className={cn('flex flex-col gap-4 rounded-3xl border bg-card/50 p-6', FEATURE_SPANS[i])}>
                  <span className="flex size-10 items-center justify-center rounded-xl bg-muted">
                    <Icon className="size-5" />
                  </span>
                  <div className="flex flex-col gap-2">
                    <h3 className="font-semibold">{f.title}</h3>
                    <p className="text-sm text-pretty text-muted-foreground">{f.body}</p>
                  </div>
                  {i === 0 && <GroupArt />}
                  {i === 1 && <SafetyCodeArt />}
                </li>
              )
            })}
          </ul>
        </Section>

        <Section id="architecture" title={a.title} lead={a.lead}>
          <figure className="grid items-center gap-4 md:grid-cols-[1fr_auto_1.2fr_auto_1.4fr]">
            <Node icon={<MonitorSmartphoneIcon />} title={a.browser} items={a.browserItems} />
            <div className="flex flex-col items-center gap-1 text-xs text-muted-foreground">
              <ArrowRightIcon className="hidden size-4 md:block" />
              <ArrowDownIcon className="size-4 md:hidden" />
              WebSocket
            </div>
            <Node icon={<ServerIcon />} title={a.worker} items={a.workerItems} className="border-sidebar-primary/50" />
            <div className="flex flex-col items-center text-muted-foreground">
              <ArrowRightIcon className="hidden size-4 md:block" />
              <ArrowDownIcon className="size-4 md:hidden" />
            </div>
            <div className="flex flex-col gap-3">
              <Node icon={<UsersIcon />} title={a.userDo} />
              <Node icon={<MessageCircleIcon />} title={a.chatDo} />
              <Node icon={<DatabaseIcon />} title={a.d1} />
            </div>
            <Node icon={<HardDriveIcon />} title={a.r2} items={a.r2Items} className="border-dashed md:col-span-5" />
          </figure>
          <ul className="grid gap-6 md:grid-cols-3">
            {a.notes.map((n) => (
              <li key={n.title} className="flex flex-col gap-2">
                <h3 className="font-semibold">{n.title}</h3>
                <p className="text-sm text-pretty text-muted-foreground">{n.body}</p>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="free-plan" title={t.budget.title} lead={t.budget.lead}>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {t.budget.items.map((s) => (
              <div key={s.label} className="flex flex-col-reverse gap-2 rounded-3xl border bg-card/50 p-6">
                <dt className="text-sm text-pretty text-muted-foreground">{s.label}</dt>
                <dd className="text-5xl font-semibold tracking-tight tabular-nums">{s.value}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section id="deploy" title={t.deploy.title} lead={t.deploy.lead}>
          <ol className="grid gap-4 md:grid-cols-3">
            {t.deploy.steps.map((step, i) => (
              <li key={step.title} className="flex flex-col gap-4 rounded-3xl border bg-card/50 p-6">
                <span className="flex size-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                  {i + 1}
                </span>
                <div className="flex flex-col gap-2">
                  <h3 className="font-semibold">{step.title}</h3>
                  <p className="text-sm text-pretty text-muted-foreground">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-3">
            <a href={DEPLOY_URL} className={buttonVariants({ size: 'lg' })}>
              <CloudIcon data-icon="inline-start" />
              {t.deploy.button}
            </a>
            <a href={`${REPO}#deployment`} className={buttonVariants({ variant: 'outline', size: 'lg' })}>
              <BookOpenIcon data-icon="inline-start" />
              {t.deploy.manual}
            </a>
          </div>
        </Section>

        <Section id="faq" title={t.faq.title}>
          <div className="flex flex-col divide-y border-y">
            {t.faq.items.map((item) => (
              <details key={item.q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">
                  <h3>{item.q}</h3>
                  <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>
                <p className="max-w-3xl pt-3 text-pretty text-muted-foreground">{item.a}</p>
              </details>
            ))}
          </div>
        </Section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-10 text-sm text-muted-foreground md:flex-row md:items-center">
          <div className="flex items-center gap-2">
            <MessageCircleIcon className="size-4 text-foreground" />
            {t.footer.tagline}
          </div>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2 md:ml-auto">
            <a href={REPO} className="hover:text-foreground">
              {t.footer.source}
            </a>
            <a href={`${REPO}/tree/main/docs/architecture`} className="hover:text-foreground">
              {t.footer.docs}
            </a>
            <a href={`${REPO}/blob/main/LICENSE`} className="hover:text-foreground">
              {t.footer.license}
            </a>
            <a href="/llms.txt" className="hover:text-foreground">
              llms.txt
            </a>
          </nav>
        </div>
      </footer>
    </div>
  )
}
