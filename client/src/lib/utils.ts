import type { AlertDialogOptions } from "@/components/alert-dialog.tsx";
import { clsx, type ClassValue } from "clsx";
import ky from "ky";
import { toast } from "sonner";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const api = ky.extend({
  prefixUrl: import.meta.env.VITE_API_URL,
  hooks: {
    afterResponse: [
      (_, __, response) => {
        if (response.status === 401) {
          toast.error("Unauthorized");
          setTimeout(() => {
            location.href = "/login";
          }, 1000);
        }
      },
    ],
  },
  credentials: "include",
});

export const showAlertDialog = (options: AlertDialogOptions) => {
  dispatchEvent(new CustomEvent("alert-dialog:open", { detail: options }));
};
