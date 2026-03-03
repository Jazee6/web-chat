import type { AlertDialogOptions } from "@/components/alert-dialog.tsx";
import { type ClassValue, clsx } from "clsx";
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
  if (!dateStr) return "";

  const target = new Date(dateStr);
  const now = new Date();

  const isSameDay = (d1: Date, d2: Date) =>
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate();

  const isSameYear = (d1: Date, d2: Date) =>
    d1.getFullYear() === d2.getFullYear();

  const pad = (n: number) => n.toString().padStart(2, "0");
  const formatHHmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

  if (isSameDay(target, now)) {
    return formatHHmm(target);
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(target, yesterday)) {
    return "Yesterday " + formatHHmm(target);
  }

  const oneWeekAgo = new Date(now);
  oneWeekAgo.setDate(now.getDate() - 7);

  if (target > oneWeekAgo) {
    const dayName = target.toLocaleDateString("en-US", { weekday: "long" });
    return `${dayName} ${formatHHmm(target)}`;
  }

  if (isSameYear(target, now)) {
    return `${pad(target.getMonth() + 1)}-${pad(target.getDate())} ${formatHHmm(target)}`;
  }

  return `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())} ${formatHHmm(target)}`;
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

export const calculateSHA256 = async (file: File) => {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
};
