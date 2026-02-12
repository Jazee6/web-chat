import { useEffect, useRef, useState } from "react";

type UserIdleState = "active" | "idle";
type ScreenIdleState = "locked" | "unlocked";

interface IdleDetector extends EventTarget {
  userState: UserIdleState;
  screenState: ScreenIdleState;
  start(options?: { threshold?: number; signal?: AbortSignal }): Promise<void>;
}

interface IdleDetectorConstructor {
  new (): IdleDetector;
  requestPermission(): Promise<PermissionState>;
}

declare global {
  interface Window {
    IdleDetector: IdleDetectorConstructor;
  }
}

const useIdleDetector = (threshold: number = 60000) => {
  const [userState, setUserState] = useState<UserIdleState>("active");
  const [screenState, setScreenState] = useState<ScreenIdleState>("unlocked");
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const start = async () => {
    if (typeof window === "undefined" || !("IdleDetector" in window)) {
      return;
    }

    try {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;
      const detector = new window.IdleDetector();

      const handleChange = () => {
        setUserState(detector.userState);
        setScreenState(detector.screenState);
      };
      detector.addEventListener("change", handleChange);

      await detector.start({
        threshold,
        signal: controller.signal,
      });

      // setUserState(detector.userState);
      // setScreenState(detector.screenState);
    } catch (err) {
      console.error("Error starting IdleDetector:", err);
    }
  };

  const stop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  };

  return {
    userState,
    screenState,
    start,
    stop,
  };
};

export default useIdleDetector;
