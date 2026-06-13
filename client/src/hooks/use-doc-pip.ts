import { useEffect, useState } from "react";

declare global {
  interface Window {
    documentPictureInPicture: {
      window: Window | null;
      requestWindow: {
        (options: { width: number; height: number }): Promise<Window>;
      };
    };
  }
}

export const useDocPip = () => {
  const [pipWindow, setPipWindow] = useState<Window | null>(null);

  const closePip = () => {
    if (pipWindow) {
      pipWindow.close();
      setPipWindow(null);
    }
  };

  const openPip = async (width = 375, height = 1024) => {
    if (pipWindow) {
      return;
    }

    const win = await window.documentPictureInPicture.requestWindow({
      width,
      height,
    });

    document
      .querySelectorAll<HTMLStyleElement | HTMLLinkElement>(
        "style, link[rel='stylesheet']",
      )
      .forEach((el) => {
        win.document.head.appendChild(el.cloneNode(true));
      });
    win.document.documentElement.classList.add("dark");

    win.addEventListener("pagehide", () => {
      setPipWindow(null);
    });

    setPipWindow(win);
  };

  useEffect(() => {
    return () => {
      if (pipWindow) {
        pipWindow.close();
      }
    };
  }, [pipWindow]);

  return {
    pipWindow,
    openPip,
    closePip,
    isActive: !!pipWindow,
  };
};
