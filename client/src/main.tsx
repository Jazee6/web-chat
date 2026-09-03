import AlertDialog from "@/components/alert-dialog.tsx";
import { TooltipProvider } from "@/components/ui/tooltip.tsx";
import { getServiceWorkerRegistration } from "@/lib/push.ts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import App from "./App.tsx";
import "./index.css";

void getServiceWorkerRegistration();
navigator.serviceWorker?.addEventListener("message", (event) => {
  if (
    event.data?.type === "roomNotificationOpen" &&
    typeof event.data.roomId === "string"
  ) {
    dispatchEvent(
      new CustomEvent("room-notification:open", {
        detail: { roomId: event.data.roomId },
      }),
    );
  }
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </QueryClientProvider>

    <Toaster position="top-center" richColors theme="dark" />
    <AlertDialog />
  </>,
);
