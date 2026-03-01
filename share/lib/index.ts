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
    };

export type Message = ServerMessage | ClientMessage;

export const gm = (message: Message) => {
  return JSON.stringify(message);
};
