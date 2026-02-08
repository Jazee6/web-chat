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
    return new Notification(title, {
      icon: "/icon.svg",
      ...options,
    });
  }
};
