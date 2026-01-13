export interface RoomUser {
  id: string;
}

export interface RoomStats {
  users: RoomUser[];
}

export interface ChatMessage {
  id: string;
  userId: string;
  content: string;
  createdAt: string;
}

export type ServerMessage =
  | {
      type: "pong";
    }
  | {
      type: "received";
    }
  | {
      type: "roomStats";
      data: RoomStats;
    }
  | {
      type: "initHistory";
      data: ChatMessage[];
    }
  | {
      type: "history";
      data: ChatMessage[];
    }
  | {
      type: "message";
      data: ChatMessage;
    };

export type ClientMessage =
  | {
      type: "ping";
    }
  | {
      type: "join";
    }
  | {
      type: "send";
      data: string;
    }
  | {
      type: "loadHistory";
      data: {
        before: string;
      };
    };

export type Message = ServerMessage | ClientMessage;

export const gm = (message: Message) => {
  return JSON.stringify(message);
};
