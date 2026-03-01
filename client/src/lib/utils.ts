import type { AlertDialogOptions } from "@/components/alert-dialog.tsx";
import { clsx, type ClassValue } from "clsx";
import ky from "ky";
import { toast } from "sonner";
import { twMerge } from "tailwind-merge";
import type { ChatMessage } from "web-chat-share";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const appName = "Web Chat";

export const api = ky.extend({
  prefixUrl: import.meta.env.VITE_API_URL,
  hooks: {
    afterResponse: [
      async (_, __, response) => {
        if (response.status === 401) {
          location.href = "/login";
          return;
        }

        if (!response.ok) {
          toast.error(await response.text());
        }
      },
    ],
  },
  credentials: "include",
});

export const showAlertDialog = (options: AlertDialogOptions) => {
  dispatchEvent(new CustomEvent("alert-dialog:open", { detail: options }));
};

export const pushNotification = (
  title: string,
  options?: NotificationOptions,
) => {
  if (!("Notification" in window)) {
    return;
  }

  if (Notification.permission === "granted") {
    const n = new Notification(title, {
      icon: "/icon.svg",
      ...options,
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
    return n;
  }
};

export const formatChatListTime = (dateStr: string) => {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const diffDays = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  if (diffDays === 1) {
    return (
      "Yesterday " +
      date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    );
  }

  return (
    date.toLocaleDateString() +
    " " +
    date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  );
};

export const getNotificationBody = (data: ChatMessage) => {
  switch (data.type) {
    case "text":
      return data.content;
    case "image": {
      const length = (JSON.parse(data.content) as string[]).length;
      return "🖼️(" + length + ")";
    }
    default:
      return data.content;
  }
};

export const convertImageToWebP = async (image: File): Promise<File> => {
  return new Promise<File>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Could not get canvas context"));
        return;
      }
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(
              new File([blob], image.name.replace(/\.[^/.]+$/, "") + ".webp", {
                type: "image/webp",
              }),
            );
          } else {
            reject(new Error("Canvas toBlob returned null"));
          }
        },
        "image/webp",
        0.9,
      );
    };
    img.src = URL.createObjectURL(image);
  });
};
