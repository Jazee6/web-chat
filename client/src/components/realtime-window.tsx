import DeviceDropdown from "@/components/device-dropdown.tsx";
import EnsureOnline from "@/components/ensure-online.tsx";
import EnsurePermissions from "@/components/ensure-permissions.tsx";
import { LiveWaveform } from "@/components/ui/live-waveform.tsx";
import { errorMessageMap } from "@/hooks/use-user-media.ts";
import { useRealtimeContext } from "@/lib/context.ts";
import { Ban, CircleAlert, GlobeX, Mic, MicOff, PhoneOff } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Button } from "./ui/button";

const PhoneOffButton = ({ onClick }: { onClick?: () => void }) => {
  return (
    <Button
      variant="destructive"
      size="icon"
      className="rounded-full"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <PhoneOff />
    </Button>
  );
};

const Content = ({
  onOpenChange,
}: {
  onOpenChange: (open: boolean) => void;
}) => {
  const { iceConnectionState, userMedia } = useRealtimeContext();
  const [duration, setDuration] = useState(0);
  const {
    audioMonitorStreamTrack,
    audioEnabled,
    turnMicOn,
    turnMicOff,
    audioUnavailableReason,
  } = userMedia;

  useEffect(() => {
    let interval: number;
    if (iceConnectionState === "connected") {
      interval = window.setInterval(() => {
        setDuration((prev) => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [iceConnectionState]);

  return (
    <EnsureOnline
      fallback={
        <>
          <div className="flex gap-2 text-sm items-center">
            <GlobeX />
            <div>You are offline</div>
          </div>

          <div className="flex justify-end mt-4.5">
            <PhoneOffButton onClick={() => onOpenChange(false)} />
          </div>
        </>
      }
    >
      <EnsurePermissions
        fallback={
          <>
            <div className="flex gap-2 text-sm items-center">
              <Ban />
              <div>Permission denied</div>
            </div>

            <div className="flex justify-end mt-4.5">
              <PhoneOffButton onClick={() => onOpenChange(false)} />
            </div>
          </>
        }
      >
        {audioUnavailableReason ? (
          <>
            <div className="flex gap-2 text-sm items-center">
              <CircleAlert />
              <div>{errorMessageMap[audioUnavailableReason]}</div>
            </div>

            <div className="flex justify-end mt-4.5 gap-1">
              <DeviceDropdown />
              <PhoneOffButton onClick={() => onOpenChange(false)} />
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-1.5">
              <div>
                <div className="text-sm">Call</div>

                <div className="text-xs text-secondary">
                  {iceConnectionState !== "connected"
                    ? iceConnectionState
                    : `${Math.floor(duration / 60)
                        .toString()
                        .padStart(
                          2,
                          "0",
                        )}:${(duration % 60).toString().padStart(2, "0")}`}
                </div>
              </div>

              <div className="w-28 ml-auto">
                <LiveWaveform
                  mode="scrolling"
                  height={36}
                  active
                  audioStreamTrack={audioMonitorStreamTrack}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-1">
              <Button
                size="icon"
                variant={audioEnabled ? "default" : "secondary"}
                className="rounded-full"
                onClick={(e) => {
                  e.stopPropagation();
                  if (audioEnabled) {
                    turnMicOff();
                  } else {
                    turnMicOn();
                  }
                }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {audioEnabled ? <Mic /> : <MicOff />}
              </Button>

              <DeviceDropdown />

              <PhoneOffButton onClick={() => onOpenChange(false)} />
            </div>
          </>
        )}
      </EnsurePermissions>
    </EnsureOnline>
  );
};

const RealtimeWindow = ({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const startPosition = useRef({ x: 0, y: 0 });
  const elementRef = useRef<HTMLDivElement>(null);
  const constraints = useRef({
    minX: -Infinity,
    maxX: Infinity,
    minY: -Infinity,
    maxY: Infinity,
  });

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;

      const nextX = startPosition.current.x + dx;
      const nextY = startPosition.current.y + dy;

      const clampedX = Math.min(
        Math.max(nextX, constraints.current.minX),
        constraints.current.maxX,
      );
      const clampedY = Math.min(
        Math.max(nextY, constraints.current.minY),
        constraints.current.maxY,
      );

      setPosition({
        x: clampedX,
        y: clampedY,
      });
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const handleMouseDown = (e: ReactMouseEvent) => {
    if (elementRef.current) {
      const rect = elementRef.current.getBoundingClientRect();
      const nominalLeft = rect.left - position.x;
      const nominalTop = rect.top - position.y;
      constraints.current = {
        minX: -nominalLeft,
        maxX: window.innerWidth - rect.width - nominalLeft,
        minY: -nominalTop,
        maxY: window.innerHeight - rect.height - nominalTop,
      };
    }

    isDragging.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY };
    startPosition.current = { ...position };
    document.body.style.userSelect = "none";
  };

  if (!open) return null;

  return (
    <div
      ref={elementRef}
      className="fixed top-20 right-16 w-64 h-24 bg-background/80 backdrop-blur border rounded-lg shadow-lg z-50 cursor-move p-2"
      style={{
        transform: `translate(${position.x}px, ${position.y}px)`,
      }}
      onMouseDown={handleMouseDown}
    >
      <Content onOpenChange={onOpenChange} />
    </div>
  );
};

export default RealtimeWindow;
