import { Button } from "@/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { useSession } from "@/lib/auth-client.ts";
import {
  AudioLines,
  Check,
  Clock,
  Cloud,
  Code,
  Database,
  EyeOff,
  MessageCircle,
  MessageSquareText,
  Rocket,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  Star,
} from "lucide-react";
import { useEffect } from "react";
import { useNavigate } from "react-router";

export const GITHUB_URL = "https://github.com/Jazee6/web-chat";
const SCREENSHOT_URL = "/web-chat-screenshot.png";

const features = [
  {
    icon: MessageSquareText,
    title: "Real-time text & images",
    description:
      "Send text and images instantly in shared rooms. Reliable, idempotent delivery - no duplicate messages, no lost images after a refresh.",
  },
  {
    icon: AudioLines,
    title: "Browser voice calls",
    description:
      "Join multi-party voice calls right in the browser. No installs, no plugins - powered by WebRTC and a managed SFU.",
  },
  {
    icon: Search,
    title: "Full room history search",
    description:
      "Search the complete text history of a room with stable snapshots and context windows around older matches.",
  },
  {
    icon: Server,
    title: "Stickers & replies",
    description:
      "Save any image as a sticker for quick reuse, quote earlier messages with reply snapshots that render on every device.",
  },
  {
    icon: Cloud,
    title: "Serverless & self-hostable",
    description:
      "Runs on Cloudflare Workers, Durable Objects, D1 and R2. Fully open-source - deploy your own instance in minutes.",
  },
  {
    icon: Clock,
    title: "Automatic data cleanup",
    description:
      "Inactive rooms expire after 30 days and unreferenced images are reclaimed after a safety window, keeping storage lean.",
  },
];

const stack = [
  {
    icon: Cloud,
    title: "Edge compute",
    description:
      "Requests are handled at the Cloudflare edge closest to the user, cutting round-trip latency versus a single-region origin.",
  },
  {
    icon: Database,
    title: "Durable Objects",
    description:
      "Each room is a strongly-consistent Durable Object holding its live state and SQLite history - no separate state server.",
  },
  {
    icon: ShieldCheck,
    title: "Built for reliability",
    description:
      "Idempotent message acceptance and image-reference protection mean retries and refreshes stay consistent end to end.",
  },
];

const typicalPain = [
  "Runs in one or two cloud regions",
  "Needs a long-running state server",
  "History search limited or missing",
  "Closed-source, hard to self-host",
];

const ourStrengths = [
  "Served from the Cloudflare edge worldwide",
  "State co-located in Durable Objects",
  "Full room history search built in",
  "Open-source and self-hostable",
];

const faqs = [
  {
    question: "What is Web Chat?",
    answer:
      "Web Chat is a free, open-source real-time chat and calling app. You create shared rooms, exchange text and images, and join browser-based voice calls - no app install required beyond a quick sign-in.",
  },
  {
    question: "Do I need to install anything?",
    answer:
      "No. Web Chat runs entirely in your browser. Voice calls use WebRTC and a managed SFU, so you join a room and start talking without plugins or desktop software.",
  },
  {
    question: "How do I get started?",
    answer:
      'Click "Get Started" to sign in, then create a room and share its link. Anyone with the link can join the same room from any device.',
  },
  {
    question: "Why is it fast?",
    answer:
      "It runs on Cloudflare Workers, so traffic is served from the edge location nearest each user. Room state lives in a Durable Object with co-located SQLite, avoiding a separate database round trip for every message.",
  },
  {
    question: "Where is my data stored?",
    answer:
      "Room metadata lives in Cloudflare D1, room state and history in Durable Object SQLite, and images in Cloudflare R2 (or any S3-compatible store). Everything stays inside the Cloudflare ecosystem you deploy to.",
  },
  {
    question: "Can I self-host it?",
    answer:
      "Yes. Web Chat is fully open-source and ships with deployment scripts for Cloudflare Workers, D1, R2 and Durable Objects. Clone the repository and follow the README to run your own instance.",
  },
  {
    question: "How long are messages and images kept?",
    answer:
      "Messages remain for as long as their room exists. Rooms with no user activity for 30 consecutive days are deleted, and images no longer referenced by any message are reclaimed after a 24-hour safety window.",
  },
  {
    question: "Can I search old messages?",
    answer:
      "Yes. Each room has full text-history search with stable result snapshots and context windows around older matches, so you can find and reopen past conversations in place.",
  },
];

function Logo() {
  return (
    <div className="flex items-center gap-2 font-mono font-semibold">
      <MessageCircle className="size-5" aria-hidden />
      <span>Web Chat</span>
    </div>
  );
}

function GetStartedButton({ size = "lg" }: { size?: "sm" | "lg" }) {
  return (
    <Button size={size} render={<a href="/login" />}>
      <Rocket aria-hidden />
      Get Started
    </Button>
  );
}

function StarButton({ size = "lg" }: { size?: "sm" | "lg" }) {
  return (
    <Button
      size={size}
      variant="outline"
      render={<a href={GITHUB_URL} target="_blank" rel="noopener" />}
    >
      <Star aria-hidden />
      Star on GitHub
    </Button>
  );
}

function Header() {
  return (
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
      <Logo />
      <nav className="flex items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          render={<a href={GITHUB_URL} target="_blank" rel="noopener" />}
        >
          <Star aria-hidden />
          Star
        </Button>
        <Button size="sm" render={<a href="/login" />}>
          Get Started
        </Button>
      </nav>
    </header>
  );
}

function Hero() {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 pt-12 pb-16 text-center sm:pt-20">
      <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs text-muted-foreground">
        <Sparkles className="size-3.5" aria-hidden />
        Open-source · Cloudflare-powered
      </div>
      <h1 className="mx-auto max-w-3xl text-balance text-4xl font-semibold tracking-tight sm:text-6xl">
        Real-time chat rooms, running at the edge
      </h1>
      <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg text-muted-foreground">
        A serverless web chat and calling app. Share text and images, search
        full room history, and join browser voice calls - all with low latency
        from the Cloudflare edge. Self-hostable and free.
      </p>
      <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <GetStartedButton />
        <StarButton />
      </div>
      <div className="mt-14 overflow-hidden rounded-xl shadow-sm ring-1 ring-foreground/10">
        <img
          src={SCREENSHOT_URL}
          alt="Web Chat screenshot showing real-time chat rooms, voice calls and room history search"
          width={3588}
          height={1867}
          loading="eager"
          className="w-full"
        />
      </div>
    </section>
  );
}

function Features() {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-16">
      <h2 className="text-center text-3xl font-semibold tracking-tight sm:text-4xl">
        Everything a chat room needs
      </h2>
      <p className="mx-auto mt-3 max-w-2xl text-center text-muted-foreground">
        Built for fast, reliable conversations - from quick text to
        multi-party voice, with the durability you&apos;d expect from a hosted
        product.
      </p>
      <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((feature) => (
          <Card key={feature.title} size="sm">
            <CardHeader>
              <div className="mb-2 flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <feature.icon className="size-5" aria-hidden />
              </div>
              <CardTitle>{feature.title}</CardTitle>
              <CardDescription>{feature.description}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
    </section>
  );
}

function TechStack() {
  return (
    <section className="border-y bg-muted/30 py-16">
      <div className="mx-auto w-full max-w-6xl px-6">
        <h2 className="text-center text-3xl font-semibold tracking-tight sm:text-4xl">
          Powered by an edge-native stack
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-muted-foreground">
          No single-region origin server to warm up. State, storage and compute
          sit together on Cloudflare&apos;s global network.
        </p>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {stack.map((item) => (
            <Card key={item.title} size="sm" className="bg-background">
              <CardHeader>
                <div className="mb-2 flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <item.icon className="size-5" aria-hidden />
                </div>
                <CardTitle>{item.title}</CardTitle>
                <CardDescription>{item.description}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

function Comparison() {
  return (
    <section className="mx-auto w-full max-w-4xl px-6 py-16">
      <h2 className="text-center text-3xl font-semibold tracking-tight sm:text-4xl">
        A different kind of chat app
      </h2>
      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        <Card size="sm">
          <CardHeader>
            <CardTitle>Typical hosted chat</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2">
              {typicalPain.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm">
                  <EyeOff
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground/60"
                    aria-hidden
                  />
                  <span className="text-muted-foreground">{item}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-primary">
              <Sparkles className="size-4" aria-hidden />
              Web Chat
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2">
              {ourStrengths.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm">
                  <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

function Faq() {
  return (
    <section className="border-t bg-muted/30 py-16">
      <div className="mx-auto w-full max-w-3xl px-6">
        <h2 className="text-center text-3xl font-semibold tracking-tight sm:text-4xl">
          Frequently asked questions
        </h2>
        <div className="mt-8 flex flex-col gap-3">
          {faqs.map((faq) => (
            // Native <details> keeps every answer in the prerendered HTML and
            // works without JavaScript - better for crawlers than a JS accordion.
            <details
              key={faq.question}
              open
              className="group rounded-lg bg-background px-4 ring-1 ring-foreground/10 [&_p]:m-0"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-sm font-medium">
                {faq.question}
                <span className="text-muted-foreground transition-transform group-open:rotate-180">
                  ▾
                </span>
              </summary>
              <p className="pb-4 text-sm text-muted-foreground">{faq.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-16 text-center">
      <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
        Start chatting in seconds
      </h2>
      <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
        Free, open-source, and running at the edge. Create your first room now.
      </p>
      <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <GetStartedButton />
        <Button
          size="lg"
          variant="outline"
          render={<a href={GITHUB_URL} target="_blank" rel="noopener" />}
        >
          <Code aria-hidden />
          View source
        </Button>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-muted-foreground sm:flex-row">
        <div className="flex items-center gap-2 font-mono">
          <MessageCircle className="size-4" aria-hidden /> Web Chat
        </div>
        <div className="flex items-center gap-4">
          <a href="/login" className="underline underline-offset-4 hover:text-primary">
            Get Started
          </a>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener"
            className="underline underline-offset-4 hover:text-primary"
          >
            GitHub
          </a>
          <a
            href={`${GITHUB_URL}#部署`}
            target="_blank"
            rel="noopener"
            className="underline underline-offset-4 hover:text-primary"
          >
            Self-host
          </a>
        </div>
      </div>
    </footer>
  );
}

/** Pure presentational landing page - no hooks, no router context.
 * Safe to prerender to static HTML at build time. */
export function LandingPage() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <Header />
      <main>
        <Hero />
        <Features />
        <TechStack />
        <Comparison />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}

export function Landing() {
  const navigate = useNavigate();
  const { data: session } = useSession();

  // Signed-in visitors skip the marketing page and go straight to the
  // room catalogue. A tiny inline script in the built index.html covers
  // the common case before the bundle loads; this is the in-app fallback.
  useEffect(() => {
    if (session?.user) navigate("/rooms", { replace: true });
  }, [session, navigate]);

  return <LandingPage />;
}

export default Landing;
