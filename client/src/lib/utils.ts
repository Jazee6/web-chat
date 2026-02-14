import type { AlertDialogOptions } from "@/components/alert-dialog.tsx";
import { clsx, type ClassValue } from "clsx";
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
