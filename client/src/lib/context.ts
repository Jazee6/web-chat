import type { UserMedia } from "@/hooks/use-user-media.ts";
import type { PartyTracks } from "partytracks/client";
import { createContext, useContext } from "react";
import type { RoomRealtime, ServerRealtimeStatus } from "web-chat-share";

interface RoomContextType {
  ws?: WebSocket;
}

export const RoomContext = createContext<RoomContextType | undefined>(
  undefined,
);

export const useRoom = () => {
  const context = useContext(RoomContext);
  if (!context) {
    throw new Error("useRoom must be used within a RoomProvider");
  }
  return context;
};

export interface RealtimeContextType {
  partyTracks: PartyTracks;
  session?: {
    peerConnection: RTCPeerConnection;
    sessionId: string;
  };
  iceConnectionState: RTCPeerConnectionState;
  userMedia: UserMedia;
}

export const RealtimeContext = createContext<RealtimeContextType | undefined>(
  undefined,
);

export const useRealtime = () => {
  const context = useContext(RealtimeContext);
  if (!context) {
    throw new Error("useRealtime must be used within a RealtimeProvider");
  }
  return context;
};

export interface RealtimeSidebarContextType {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  roomRealtime?: RoomRealtime;
  setRoomRealtime: (roomRealtime: RoomRealtime) => void;
  realtimeStatus?: ServerRealtimeStatus[];
  setRealtimeStatus: (realtimeStatus?: ServerRealtimeStatus[]) => void;
}

export const RealtimeSidebarContext = createContext<
  RealtimeSidebarContextType | undefined
>(undefined);

export const useRealtimeSidebar = () => {
  const context = useContext(RealtimeSidebarContext);
  if (!context) {
    throw new Error(
      "useRealtimeSidebar must be used within a RealtimeSidebarContext",
    );
  }
  return context;
};
