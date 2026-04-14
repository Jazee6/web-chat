interface UserStatus {
  user?: "active" | "idle";
  screen?: "locked" | "unlocked";
  typing?: boolean;
}

export interface RoomUser {
  id: string;
  status?: UserStatus;
}

export interface RoomStats {
  users: RoomUser[];
}

export interface ChatMessage {
  id: string;
  userId: string;
  type: "text" | "image";
  content: string;
  createdAt: string;
}

export interface UIChatMessage extends ChatMessage {
  localFiles?: {
    file: File;
    isUploading: boolean;
  }[];
}

export interface RealtimeStatus {
  sessionId?: string;
  audio?: {
    id: string;
    enabled?: boolean;
  };
}

export interface ServerRealtimeStatus extends RealtimeStatus {
  userId: string;
}

export interface RoomRealtime {
  total: number;
  userIds: string[];
}

export type ServerMessage =
  | {
      type: "pong";
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
    }
  | {
      type: "realtimeStatus";
      data: ServerRealtimeStatus[];
    }
  | {
      type: "roomRealtime";
      data: RoomRealtime;
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
      data: {
        type: "text" | "image";
        content: string;
      };
    }
  | {
      type: "loadHistory";
      data: {
        before: string;
      };
    }
  | {
      type: "userStatus";
      data: UserStatus;
    }
  | {
      type: "realtimeJoin";
    }
  | {
      type: "realtimeUpdate";
      data: RealtimeStatus;
    }
  | {
      type: "realtimeLeave";
    };

export type Message = ServerMessage | ClientMessage;

export const gm = (message: Message) => {
  return JSON.stringify(message);
};
