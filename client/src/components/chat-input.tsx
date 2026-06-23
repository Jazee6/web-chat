import Footer from "@/components/footer.tsx";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { cn } from "@/lib/utils.ts";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowUpIcon, ImagePlus, PhoneCall, X } from "lucide-react";
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
import { sendMessageSchema } from "web-chat-share";
import { z } from "zod";

const ChatInput = ({
  onSend,
  onCall,
  isLoading,
  className,
  onTypingChange,
}: {
  onSend: (
    data: z.infer<typeof sendMessageSchema> & {
      images: File[];
    },
  ) => Promise<void>;
  onCall?: () => void;
  isLoading: boolean;
  className?: string;
  onTypingChange?: (typing: boolean) => void;
}) => {
  const [images, setImages] = useState<File[]>([]);
  const [isSending, setIsSending] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
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

  const onSubmit = async (data: z.infer<typeof sendMessageSchema>) => {
    stopTyping();
    setIsSending(true);
    imagePreviewUrls.current.forEach((url) => URL.revokeObjectURL(url));
    imagePreviewUrls.current.clear();
    form.reset();
    setImages([]);

    await onSend({
      message: data.message,
      images: images,
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
      <InputGroup className="max-w-3xl mx-auto max-h-64">
        <Controller
          name="message"
          control={form.control}
          render={({ field }) => (
            <>
              <InputGroupTextarea
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
