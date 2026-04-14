import type { UserMedia } from "@/hooks/use-user-media.ts";
import type ReconnectingWebSocket from "partysocket/ws";
import type { PartyTracks } from "partytracks/client";
import { createContext, useContext } from "react";

interface RoomContextType {
  ws?: ReconnectingWebSocket;
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
