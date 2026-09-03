import { api } from "./utils";

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    Boolean(
      "standalone" in navigator &&
      (navigator as Navigator & { standalone?: boolean }).standalone,
    ) || window.matchMedia("(display-mode: standalone)").matches
  );
}

export async function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!isPushSupported()) return null;
  try {
    const apiUrl = encodeURIComponent(import.meta.env.VITE_API_URL);
    return await navigator.serviceWorker.register(`/sw.js?api=${apiUrl}`, {
      scope: "/",
    });
  } catch (err) {
    console.error("Failed to register service worker", err);
    return null;
  }
}

export async function getCurrentPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    return (await registration?.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

export async function getCurrentPushDestinationId(
  subscription: PushSubscription | null,
): Promise<string | null> {
  if (!subscription) return null;
  try {
    const result = await api
      .post("notification/destinations/current", {
        json: { endpoint: subscription.endpoint },
      })
      .json<{ id: string | null }>();
    return result.id;
  } catch {
    return null;
  }
}

export async function clearRoomNotifications(roomId: string): Promise<void> {
  if (!isPushSupported()) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return;
    const notifications = await registration.getNotifications({
      tag: `room:${roomId}`,
    });
    for (const n of notifications) {
      n.close();
    }
  } catch (err) {
    console.error("Failed to clear room notifications", err);
  }
}

export async function fetchVapidPublicKey(): Promise<string | null> {
  try {
    const res = await api.get("notification/config").json<{
      vapidPublicKey: string | null;
    }>();
    return res.vapidPublicKey;
  } catch {
    return null;
  }
}

/**
 * Registers push destination for current browser.
 * Must be triggered by direct user action for Notification.requestPermission.
 */
export async function registerCurrentBrowserPush(): Promise<{
  success: boolean;
  permissionDenied?: boolean;
  unavailable?: boolean;
}> {
  if (!isPushSupported()) {
    return { success: false, unavailable: true };
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { success: false, permissionDenied: true };
  }

  const vapidKey = await fetchVapidPublicKey();
  if (!vapidKey) {
    return { success: false, unavailable: true };
  }

  const reg = await getServiceWorkerRegistration();
  if (!reg) {
    return { success: false };
  }

  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    }));

  const json = sub.toJSON();
  const endpoint = sub.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;

  if (!endpoint || !p256dh || !auth) {
    return { success: false };
  }

  await api.post("notification/destinations", {
    json: {
      endpoint,
      p256dh,
      auth,
    },
  });

  return { success: true };
}

export async function clearAllNotifications(): Promise<void> {
  if (!isPushSupported()) return;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return;
  for (const notification of await registration.getNotifications()) {
    notification.close();
  }
}

export async function unregisterCurrentBrowserPush(): Promise<void> {
  if (!isPushSupported()) return;
  const subscription = await getCurrentPushSubscription();
  if (!subscription) {
    await clearAllNotifications();
    return;
  }

  const [serverResult, browserResult] = await Promise.allSettled([
    api.post("notification/destinations/unregister", {
      json: { endpoint: subscription.endpoint },
    }),
    subscription.unsubscribe(),
    clearAllNotifications(),
  ]);
  const browserUnsubscribed =
    browserResult.status === "fulfilled" && browserResult.value;
  if (serverResult.status === "rejected" && !browserUnsubscribed) {
    throw new Error("Could not unregister this push destination");
  }
}
