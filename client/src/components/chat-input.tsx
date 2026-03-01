import Footer from "@/components/footer.tsx";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { cn, convertImageToWebP } from "@/lib/utils.ts";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowUpIcon, ImagePlus, X } from "lucide-react";
import { type ChangeEvent, type ClipboardEvent, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { sendMessageSchema } from "web-chat-share";
import { z } from "zod";

const ChatInput = ({
  onSend,
  isLoading,
  className,
}: {
  onSend: (
    data: z.infer<typeof sendMessageSchema> & {
      images: File[];
    },
  ) => Promise<void>;
  isLoading: boolean;
  className?: string;
}) => {
  const [images, setImages] = useState<File[]>([]);
  const [isSending, setIsSending] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<z.infer<typeof sendMessageSchema>>({
    resolver: zodResolver(sendMessageSchema),
    defaultValues: {
      message: "",
    },
  });

  const onSubmit = async (data: z.infer<typeof sendMessageSchema>) => {
    setIsSending(true);
    form.reset();
    setImages([]);

    const convertedImages = await Promise.all(
      images.map((image) => convertImageToWebP(image)),
    );
    await onSend({
      message: data.message,
      images: convertedImages,
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
              />
              {images.length > 0 && (
                <InputGroupAddon align="block-start">
                  <div className="flex gap-2 overflow-x-auto scrollbar">
                    {images.map((image, index) => {
                      const src = URL.createObjectURL(image);

                      return (
                        <div
                          key={`${image.name}_${index}`}
                          className="relative shrink-0 group"
                        >
                          <img
                            src={src}
                            alt={image.name}
                            className="h-16 rounded object-cover cursor-zoom-in"
                          />

                          <X
                            className="size-4 cursor-pointer absolute top-px right-px max-md:opacity-100 opacity-0 group-hover:opacity-100 transition-opacity rounded-full bg-destructive/80 text-destructive-foreground hover:bg-destructive/60"
                            onClick={() => {
                              URL.revokeObjectURL(src);
                              setImages((p) => p.filter((_, i) => i !== index));
                            }}
                          />
                        </div>
                      );
                    })}
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
