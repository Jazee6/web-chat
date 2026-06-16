import { useCallback, useEffect, useRef } from "react";

type FaviconState = {
  hasRealtime: boolean;
  hasUnread: boolean;
};

const FAVICONS = {
  realtime: "/audio-lines.svg",
  unread: "/message-circle-more.svg",
  default: "/icon.svg",
} as const;

function resolveFavicon(state: FaviconState): string {
  if (state.hasRealtime) return FAVICONS.realtime;
  if (state.hasUnread) return FAVICONS.unread;
  return FAVICONS.default;
}

function setFaviconHref(href: string): void {
  document.head.querySelector("link[rel='icon']")?.setAttribute("href", href);
}

export function useRoomFavicon(): {
  setFaviconState: (state: Partial<FaviconState>) => void;
  clearUnread: () => void;
} {
  const stateRef = useRef<FaviconState>({
    hasRealtime: false,
    hasUnread: false,
  });

  const applyFavicon = useCallback(() => {
    setFaviconHref(resolveFavicon(stateRef.current));
  }, []);

  const setFaviconState = useCallback(
    (partial: Partial<FaviconState>) => {
      Object.assign(stateRef.current, partial);
      applyFavicon();
    },
    [applyFavicon],
  );

  const clearUnread = useCallback(() => {
    stateRef.current.hasUnread = false;
    applyFavicon();
  }, [applyFavicon]);

  useEffect(() => {
    return () => {
      setFaviconHref(FAVICONS.default);
    };
  }, []);

  return { setFaviconState, clearUnread };
}
