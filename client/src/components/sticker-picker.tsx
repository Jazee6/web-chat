import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu.tsx";
import { InputGroupButton } from "@/components/ui/input-group.tsx";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover.tsx";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { useIsMobile } from "@/hooks/use-mobile.ts";
import { stickerImageUrl, useStickers } from "@/hooks/use-stickers.ts";
import { SmilePlus, Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

// The sticker picker: a button in the input area that opens the user's Sticker
// Library. Desktop renders a Popover, mobile a bottom Sheet. Clicking a sticker
// sends it immediately via the key-only fast path (no re-upload); right-click /
// long-press removes it from the library. See CONTEXT.md "Stickers" and ADR 0004.
const StickerGrid = ({
  onSendSticker,
}: {
  onSendSticker: (key: string) => void;
}) => {
  const { listQuery, removeSticker } = useStickers();
  const sentinelRef = useRef<HTMLDivElement>(null);
  const { fetchNextPage, isFetchingNextPage, hasNextPage } = listQuery;

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
        void fetchNextPage();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const stickers = listQuery.data?.pages.flat() ?? [];
  const isEmpty = !listQuery.isLoading && stickers.length === 0;

  if (isEmpty) {
    return (
      <div className="flex h-40 items-center justify-center px-4 text-center text-xs text-muted-foreground">
        No stickers yet. Right-click an image to save one.
      </div>
    );
  }

  return (
    <div className="flex max-h-72 flex-col">
      <div className="grid grid-cols-4 gap-1 overflow-y-auto scrollbar p-1 sm:grid-cols-5">
        {listQuery.isLoading
          ? Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square rounded" />
            ))
          : stickers.map((s) => (
              <ContextMenu key={s.id}>
                <ContextMenuTrigger
                  render={
                    <button
                      type="button"
                      className="group relative aspect-square rounded hover:brightness-90 transition"
                    />
                  }
                >
                  <img
                    src={stickerImageUrl(s.key)}
                    alt="sticker"
                    loading="lazy"
                    className="size-full rounded object-contain"
                    onClick={() => onSendSticker(s.key)}
                  />
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem
                    variant="destructive"
                    onClick={() => {
                      removeSticker(s.id);
                      toast.success("Removed from stickers");
                    }}
                  >
                    <Trash2 />
                    <span>删除</span>
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}
      </div>
      <div ref={sentinelRef} className="h-1 shrink-0" />
      {isFetchingNextPage && (
        <div className="flex justify-center py-1">
          <Skeleton className="h-4 w-16" />
        </div>
      )}
    </div>
  );
};

const StickerPicker = ({
  onSendSticker,
  disabled,
}: {
  onSendSticker: (key: string) => void;
  disabled?: boolean;
}) => {
  const isMobile = useIsMobile();
  const trigger = (
    <InputGroupButton size="icon-xs" disabled={disabled}>
      <SmilePlus />
      <span className="sr-only">Sticker</span>
    </InputGroupButton>
  );

  if (isMobile) {
    return (
      <Sheet>
        <SheetTrigger render={trigger} />
        <SheetContent side="bottom" className="p-2" showCloseButton={false}>
          <SheetHeader className="px-2">
            <SheetTitle className="text-sm">Stickers</SheetTitle>
          </SheetHeader>
          <StickerGrid onSendSticker={onSendSticker} />
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover>
      <PopoverTrigger render={trigger} />
      <PopoverContent
        align="start"
        side="top"
        sideOffset={8}
        className="w-80 p-1"
      >
        <StickerGrid onSendSticker={onSendSticker} />
      </PopoverContent>
    </Popover>
  );
};

export default StickerPicker;
