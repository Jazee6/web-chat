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
import { ArrowUpIcon } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { sendMessageSchema } from "web-chat-share";
import { z } from "zod";

const ChatInput = ({
  onSend,
  isLoading,
  className,
}: {
  onSend: (data: z.infer<typeof sendMessageSchema>) => Promise<void>;
  isLoading: boolean;
  className?: string;
}) => {
  const form = useForm<z.infer<typeof sendMessageSchema>>({
    resolver: zodResolver(sendMessageSchema),
    defaultValues: {
      message: "",
    },
  });

  const onSubmit = async (data: z.infer<typeof sendMessageSchema>) => {
    if ("Notification" in window && Notification.permission === "default") {
      await Notification.requestPermission();
    }

    form.reset();
    await onSend(data);
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
                    if (isLoading) {
                      return;
                    }
                    form.handleSubmit(onSubmit)();
                  }
                }}
                {...field}
              />
              <InputGroupAddon align="block-end">
                <InputGroupButton
                  variant="default"
                  className="rounded-full ml-auto"
                  size="icon-xs"
                  type="submit"
                  disabled={isLoading}
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
