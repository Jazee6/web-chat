import type { AlertDialogOptions } from "@/components/alert-dialog.tsx";
import { clsx, type ClassValue } from "clsx";
import dayjs from "dayjs";
import ky from "ky";
import { toast } from "sonner";
import { twMerge } from "tailwind-merge";

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

  const target = dayjs(dateStr);
  const now = dayjs();

  if (target.isSame(now, "day")) {
    return target.format("HH:mm");
  }

  if (target.isSame(now.subtract(1, "day"), "day")) {
    return "Yesterday " + target.format("HH:mm");
  }

  const diffDays = now.diff(target, "day");
  if (diffDays < 7 && target.isAfter(now.subtract(7, "day"))) {
    return target.format("dddd HH:mm");
  }

  if (target.isSame(now, "year")) {
    return target.format("MM-DD HH:mm");
  }

  return target.format("YYYY-MM-DD HH:mm");
};
