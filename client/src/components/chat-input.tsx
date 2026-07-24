import Footer from "@/components/footer.tsx";
import StickerPicker from "@/components/sticker-picker.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import type { User } from "@/lib/auth-client.ts";
import { insertMention } from "@/lib/mentions.ts";
import { cn } from "@/lib/utils.ts";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowUpIcon, ImagePlus, PhoneCall, Reply, X } from "lucide-react";
import {
  type ChangeEvent,
  type ClipboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { Controller, useForm } from "react-hook-form";
import Zoom from "react-medium-image-zoom";
import { toast } from "sonner";
import { type ReplyRef, sendMessageSchema } from "web-chat-share";
import { z } from "zod";

export type MentionRequest = {
  id: number;
  name: string;
};

const ChatInput = ({
  onSend,
  onCall,
  isLoading,
  className,
  onTypingChange,
  onSendSticker,
  replyTarget,
  users,
  onCancelReply,
  mentionRequest,
}: {
  onSend: (
    data: z.infer<typeof sendMessageSchema> & {
      images: File[];
      replyTo?: ReplyRef;
    },
  ) => Promise<void>;
  onCall?: () => void;
  isLoading: boolean;
  className?: string;
  onTypingChange?: (typing: boolean) => void;
  onSendSticker: (key: string) => void;
  replyTarget: ReplyRef | null;
  users: Record<string, User>;
  onCancelReply: () => void;
  mentionRequest: MentionRequest | null;
}) => {
  const [images, setImages] = useState<File[]>([]);
  const [isSending, setIsSending] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const handledMentionRequestRef = useRef(0);
  const imagePreviewUrls = useRef(new Map<File, string>());

  // Edge-triggered typing: fire onTypingChange only on true↔false transitions,
  // so a typing session is at most two broadcasts. 2s of inactivity ⇒ stop.
  // See ADR 0002.
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);

  const updateTyping = (next: boolean) => {
    if (isTypingRef.current === next) return;
    isTypingRef.current = next;
    onTypingChange?.(next);
  };

  const stopTyping = () => {
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current);
      typingTimerRef.current = null;
    }
    updateTyping(false);
  };

  const handleTypingKeystroke = () => {
    if (!onTypingChange) return;
    updateTyping(true);
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      updateTyping(false);
      typingTimerRef.current = null;
    }, 2000);
  };

  useEffect(() => {
    const urls = imagePreviewUrls.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    };
  }, []);

  const getImagePreviewUrl = (file: File) => {
    const existing = imagePreviewUrls.current.get(file);
    if (existing) return existing;
    const url = URL.createObjectURL(file);
    imagePreviewUrls.current.set(file, url);
    return url;
  };

  const removeImage = (index: number) => {
    setImages((prev) => {
      const file = prev[index];
      if (file) {
        const url = imagePreviewUrls.current.get(file);
        if (url) {
          URL.revokeObjectURL(url);
          imagePreviewUrls.current.delete(file);
        }
      }
      return prev.filter((_, i) => i !== index);
    });
  };

  const form = useForm<z.infer<typeof sendMessageSchema>>({
    resolver: zodResolver(sendMessageSchema),
    defaultValues: {
      message: "",
    },
  });

  useEffect(() => {
    if (
      !mentionRequest ||
      handledMentionRequestRef.current === mentionRequest.id
    ) {
      return;
    }
    handledMentionRequestRef.current = mentionRequest.id;

    const textarea = textareaRef.current;
    const current = form.getValues("message");
    const hasFocus = document.activeElement === textarea;
    const start = hasFocus
      ? (textarea?.selectionStart ?? current.length)
      : current.length;
    const end = hasFocus
      ? (textarea?.selectionEnd ?? current.length)
      : current.length;
    const { value: next, caret } = insertMention(
      current,
      mentionRequest.name,
      start,
      end,
    );

    if (next.length > 2048) {
      toast.warning("Message is too long to add this mention.");
      textarea?.focus();
      return;
    }

    form.setValue("message", next, {
      shouldDirty: true,
      shouldValidate: true,
    });
    requestAnimationFrame(() => {
      if (!textarea?.isConnected) return;
      textarea.focus();
      textarea.setSelectionRange(caret, caret);
    });
  }, [form, mentionRequest]);

  const onSubmit = async (data: z.infer<typeof sendMessageSchema>) => {
    // Capture before clearing — onCancelReply runs before the await, matching
    // how images/input are reset pre-send (a failed send doesn't restore them).
    const replyTo = replyTarget ?? undefined;
    stopTyping();
    setIsSending(true);
    imagePreviewUrls.current.forEach((url) => URL.revokeObjectURL(url));
    imagePreviewUrls.current.clear();
    form.reset();
    setImages([]);
    onCancelReply();

    await onSend({
      message: data.message,
      images: images,
      replyTo,
    });

    setIsSending(false);
  };

  const onImageSelect = () => {
    if (imageInputRef.current) {
      imageInputRef.current.click();
    }
  };

  const onImageChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const images = Array.from(files).filter((file) =>
        file.type.startsWith("image/"),
      );
      if (images.length > 0) {
        setImages((p) => {
          const newImages = [...p, ...images];
          if (newImages.length > 5) {
            toast.warning("You can only send up to 5 images.");
            return newImages.slice(0, 5);
          }
          return newImages;
        });
      }
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData.items;
    const pastedImages: File[] = [];

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf("image") !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          pastedImages.push(file);
        }
      }
    }

    if (pastedImages.length > 0) {
      setImages((p) => {
        const newImages = [...p, ...pastedImages];
        if (newImages.length > 5) {
          toast.warning("You can only send up to 5 images.");
          return newImages.slice(0, 5);
        }
        return newImages;
      });
    }
  };

  return (
    <form
      className={cn(
        "w-full max-md:px-2 bg-linear-to-t from-background to-transparent rounded-b-xl",
        className,
      )}
      onSubmit={(e) => form.handleSubmit(onSubmit)(e)}
    >
      {replyTarget && (
        <div className="max-w-3xl mx-auto mb-1 flex items-center gap-2 rounded-md border border-border bg-secondary/60 px-2 py-1">
          <Reply className="size-3.5 shrink-0 text-muted-foreground" />
          <div className="flex min-w-0 flex-col">
            <span className="text-xs font-medium text-primary line-clamp-1">
              {replyTarget.authorType === "ai"
                ? "AI"
                : replyTarget.userId
                  ? users[replyTarget.userId]?.name ||
                    replyTarget.userId.slice(0, 2)
                  : "Unknown user"}
            </span>
            <span className="text-xs text-muted-foreground line-clamp-1 wrap-anywhere">
              {replyTarget.snippet}
            </span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={onCancelReply}
            className="ml-auto shrink-0 text-muted-foreground"
          >
            <X className="size-4" />
            <span className="sr-only">取消回复</span>
          </Button>
        </div>
      )}
      <InputGroup className="max-w-3xl mx-auto max-h-64">
        <Controller
          name="message"
          control={form.control}
          render={({ field: { ref, ...field } }) => (
            <>
              <InputGroupTextarea
                ref={(element) => {
                  ref(element);
                  textareaRef.current = element;
                }}
                className="scrollbar"
                placeholder="Text here..."
                autoFocus
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    if (
                      isLoading ||
                      isSending ||
                      (field.value.trim().length === 0 && images.length === 0)
                    ) {
                      return;
                    }
                    form.handleSubmit(onSubmit)();
                  }
                }}
                onPaste={onPaste}
                maxLength={2048}
                minLength={1}
                {...field}
                onChange={(e) => {
                  field.onChange(e);
                  handleTypingKeystroke();
                }}
                onBlur={() => {
                  field.onBlur();
                  stopTyping();
                }}
              />
              {images.length > 0 && (
                <InputGroupAddon align="block-start">
                  <div className="flex gap-2 overflow-x-auto scrollbar">
                    {images.map((image, index) => (
                      <div
                        key={`${image.name}_${index}`}
                        className="relative shrink-0 group"
                      >
                        <Zoom
                          classDialog='[&_[data-rmiz-modal-overlay="visible"]]:bg-background/80!
      [&_[data-rmiz-modal-overlay="visible"]]:backdrop-blur-md
      [&_[data-rmiz-modal-img]]:rounded'
                        >
                          <img
                            src={getImagePreviewUrl(image)}
                            alt={image.name}
                            className="h-16 rounded object-cover cursor-zoom-in"
                          />
                        </Zoom>
                        <X
                          className="size-4 cursor-pointer absolute top-px right-px max-md:opacity-100 opacity-0 group-hover:opacity-100 transition-opacity rounded-full bg-destructive/80 text-secondary-foreground hover:bg-destructive/60"
                          onClick={() => removeImage(index)}
                        />
                      </div>
                    ))}
                  </div>
                </InputGroupAddon>
              )}

              <InputGroupAddon align="block-end">
                <StickerPicker
                  onSendSticker={onSendSticker}
                  disabled={isLoading || isSending}
                />

                <InputGroupButton size="icon-xs" onClick={onImageSelect}>
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={onImageChange}
                  />

                  <ImagePlus />
                  <span className="sr-only">Image</span>
                </InputGroupButton>

                {onCall && (
                  <InputGroupButton size="icon-xs" onClick={onCall}>
                    <PhoneCall />
                    <span className="sr-only">Call</span>
                  </InputGroupButton>
                )}

                <InputGroupButton
                  className="ml-auto rounded-full"
                  variant="default"
                  size="icon-xs"
                  type="submit"
                  disabled={
                    isLoading ||
                    isSending ||
                    (field.value.trim().length === 0 && images.length === 0)
                  }
                >
                  {isLoading ? <Spinner /> : <ArrowUpIcon />}
                  <span className="sr-only">Send</span>
                </InputGroupButton>
              </InputGroupAddon>
            </>
          )}
        />
      </InputGroup>

      <Footer classname="my-2" />
    </form>
  );
};

export default ChatInput;
