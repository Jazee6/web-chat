// Service Worker for Web Chat Room Notifications
// Only handles Web Push notifications and notification click actions.
// No offline caching or offline message sending.

const apiBaseUrl = new URL(self.location.href).searchParams.get("api");

const DEDUPLICATION_WINDOW_MS = 10 * 60 * 1000;

const rememberMessage = (roomId, messageId) =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open("web-chat-notifications", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("rooms", { keyPath: "roomId" });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("rooms", "readwrite");
      const store = transaction.objectStore("rooms");
      const existing = store.get(roomId);
      let isNewMessage = true;

      existing.onsuccess = () => {
        const now = Date.now();
        const recentMessages = Array.isArray(existing.result?.messages)
          ? existing.result.messages.filter(
              (entry) => now - entry.seenAt <= DEDUPLICATION_WINDOW_MS,
            )
          : [];

        // Preserve compatibility with the original one-message record shape.
        if (existing.result?.messageId === messageId) {
          isNewMessage = false;
          return;
        }
        if (recentMessages.some((entry) => entry.id === messageId)) {
          isNewMessage = false;
          return;
        }

        recentMessages.push({ id: messageId, seenAt: now });
        store.put({ roomId, messages: recentMessages });
      };
      transaction.oncomplete = () => {
        database.close();
        resolve(isNewMessage);
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error);
      };
      transaction.onabort = () => {
        database.close();
        reject(transaction.error);
      };
    };
  });

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("pushsubscriptionchange", (event) => {
  if (!apiBaseUrl || !event.oldSubscription?.options) return;

  event.waitUntil(
    self.registration.pushManager
      .subscribe(event.oldSubscription.options)
      .then(async (subscription) => {
        const json = subscription.toJSON();
        if (!json.keys?.p256dh || !json.keys?.auth) return;
        const response = await fetch(
          `${apiBaseUrl}/notification/destinations`,
          {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              endpoint: subscription.endpoint,
              p256dh: json.keys.p256dh,
              auth: json.keys.auth,
            }),
          },
        );
        if (!response.ok) throw new Error("Failed to refresh push destination");
        if (subscription.endpoint !== event.oldSubscription.endpoint) {
          await fetch(`${apiBaseUrl}/notification/destinations/unregister`, {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ endpoint: event.oldSubscription.endpoint }),
          });
        }
      }),
  );
});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = {
      title: "Web Chat",
      body: event.data.text(),
    };
  }

  const title = payload.title || "Web Chat";
  const options = {
    body: payload.body || "New message",
    icon: payload.icon || "/icon-192.png",
    badge: payload.badge || "/icon.svg",
    tag:
      payload.tag ||
      (payload.data?.roomId
        ? `room:${payload.data.roomId}`
        : "web-chat-notification"),
    renotify: true,
    timestamp: payload.timestamp,
    data: payload.data || {},
  };

  event.waitUntil(
    (async () => {
      if (
        payload.data?.roomId &&
        payload.data?.messageId &&
        !(await rememberMessage(
          payload.data.roomId,
          payload.data.messageId,
        ).catch(() => true))
      ) {
        return;
      }
      await self.registration.showNotification(title, options);
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const roomId = event.notification.data?.roomId;
  const targetPath = roomId ? `/room/${roomId}` : "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // If a window is already showing this room, focus it
        for (const client of clientList) {
          if (
            new URL(client.url).pathname === targetPath &&
            "focus" in client
          ) {
            client.postMessage({ type: "roomNotificationOpen", roomId });
            return client.focus();
          }
        }
        // If another client window is open, navigate and focus
        for (const client of clientList) {
          if ("focus" in client && "navigate" in client) {
            return client.focus().then(() => client.navigate(targetPath));
          }
        }
        // Otherwise open a new window
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetPath);
        }
      }),
  );
});
