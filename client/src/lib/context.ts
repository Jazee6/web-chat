import type { UserMedia } from "@/hooks/use-user-media.ts";
import type { PartyTracks } from "partytracks/client";
import { createContext, useContext } from "react";
import type { RoomRealtime, ServerRealtimeStatus } from "web-chat-share";

export interface RoomContextType {
  ws?: WebSocket;
  uid: string;
  roomRealtime?: RoomRealtime;
  realtimeStatus?: ServerRealtimeStatus[];
}

export const RoomContext = createContext<RoomContextType | undefined>(
  undefined,
);

export const useRoomContext = () => {
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

export const useRealtimeContext = () => {
  const context = useContext(RealtimeContext);
  if (!context) {
    throw new Error("useRealtime must be used within a RealtimeProvider");
  }
  return context;
};
