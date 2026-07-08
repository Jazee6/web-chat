import { Skeleton } from "@/components/ui/skeleton.tsx";
import { useLinkPreview } from "@/hooks/use-link-preview.ts";
import { cn } from "@/lib/utils.ts";
import { FileText, ImageOff } from "lucide-react";
import { useState } from "react";

const CARD_WIDTH = "w-80 max-w-full";
const SHELL =
  "block rounded-lg overflow-hidden border bg-secondary hover:brightness-75 transition";

const getDomain = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

const PlainLink = ({ url }: { url: string }) => (
  <a
    href={url}
    target="_blank"
    rel="noopener noreferrer"
    className="bg-secondary px-2 py-1 rounded-md underline underline-offset-4 wrap-anywhere hover:brightness-75 transition peer"
  >
    {url}
  </a>
);

const LinkCardSkeleton = () => (
  <div
    className={cn(
      "rounded-lg overflow-hidden border bg-secondary peer",
      CARD_WIDTH,
    )}
  >
    <Skeleton className="aspect-[1.91/1] w-full rounded-none" />
    <div className="px-2.5 py-1.5 space-y-1.5">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  </div>
);

const Thumbnail = ({ src, alt }: { src: string | null; alt: string }) => {
  const [failed, setFailed] = useState(false);
  if (failed || !src) {
    return (
      <div className="aspect-[1.91/1] w-full flex items-center justify-center bg-muted">
        <ImageOff className="size-12 text-muted-foreground" strokeWidth={1.5} />
      </div>
    );
  }
  return (
    <div className="aspect-[1.91/1] w-full bg-muted">
      <img
        src={src}
        alt={alt}
        className="w-full h-full object-cover"
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </div>
  );
};

export const LinkCard = ({ url }: { url: string }) => {
  const { data, isLoading, isError } = useLinkPreview(url);

  if (isLoading) return <LinkCardSkeleton />;
  if (isError || !data) return <PlainLink url={url} />;

  const domain = getDomain(url);

  // Video direct link — inline playback, domain shown below.
  if (data.contentType === "video") {
    return (
      <div className={cn(SHELL, CARD_WIDTH, "peer")}>
        <video
          src={url}
          controls
          preload="metadata"
          className="w-full aspect-video bg-black"
        />
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="block px-2.5 py-1.5"
        >
          <div className="text-sm truncate">{data.title}</div>
          <div className="text-xs text-muted-foreground">{domain}</div>
        </a>
      </div>
    );
  }

  // PDF direct link — icon + title + domain.
  if (data.contentType === "pdf") {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(SHELL, CARD_WIDTH, "peer")}
      >
        <div className="aspect-[1.91/1] w-full flex items-center justify-center bg-muted">
          <FileText
            className="size-12 text-muted-foreground"
            strokeWidth={1.5}
          />
        </div>
        <div className="px-2.5 py-1.5">
          <div className="text-sm truncate">{data.title}</div>
          <div className="text-xs text-muted-foreground">{domain}</div>
        </div>
      </a>
    );
  }

  // Unknown content type that we couldn't parse — fall back to a plain link.
  if (data.contentType === "unknown") {
    return <PlainLink url={url} />;
  }

  // HTML page or image direct link — same card style with optional thumbnail.
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(SHELL, CARD_WIDTH, "peer")}
    >
      <Thumbnail src={data.image} alt={data.title} />
      <div className="px-2.5 py-1.5">
        <div className="text-sm truncate">{data.title || domain}</div>
        <div className="text-xs text-muted-foreground">{domain}</div>
      </div>
    </a>
  );
};
