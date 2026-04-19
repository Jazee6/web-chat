import { useSyncExternalStore } from "react";

let permissionStatus: PermissionStatus | null = null;
let initStarted = false;
const listeners = new Set<() => void>();

function subscribe(callback: () => void) {
  listeners.add(callback);

  if (
    !initStarted &&
    typeof navigator !== "undefined" &&
    navigator.permissions
  ) {
    initStarted = true;
    navigator.permissions
      .query({ name: "microphone" as PermissionName })
      .then((status) => {
        permissionStatus = status;
        status.onchange = () => {
          listeners.forEach((listener) => listener());
        };
        listeners.forEach((listener) => listener());
      })
      .catch((error) => {
        console.error("Error checking microphone permission:", error);
      });
  }

  return () => {
    listeners.delete(callback);
  };
}

function getSnapshot() {
  return permissionStatus ? permissionStatus.state : "prompt";
}

function getServerSnapshot() {
  return "prompt" as PermissionState;
}

export function useMicrophonePermission() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
