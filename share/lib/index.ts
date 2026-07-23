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

// A denormalized snapshot of a message being replied to. The id is for
// click-Quote-to-jump; the rest renders the Quote even when the antecedent
// isn't in the local paginated history. See ADR 0003 and CONTEXT.md "Reply".
export interface ReplyRef {
  id: string;
  authorType: "user" | "ai";
  userId?: string;
  type: "text" | "image";
  // text message → its content truncated; image message → the literal
  // "[图片]" label (image `content` is a JSON id-array with no usable text).
  snippet: string;
}

export interface ChatMessage {
  id: string;
  authorType: "user" | "ai" | "system";
  userId?: string;
  type: "text" | "image";
  content: string;
  createdAt: string;
  replyTo?: ReplyRef;
}

export interface UIChatMessage extends ChatMessage {
  localFiles?: {
    file: File;
    isUploading: boolean;
    // Per-file: WebP conversion or the PUT to object storage failed. The rest
    // of the batch may still succeed. Distinct from `sendFailed` (per-message).
    // See CONTEXT.md "Upload Failed" vs "Send Failed".
    uploadFailed?: boolean;
    // The storage key (sha256) once the upload has landed. Present only after a
    // successful PUT — lets the sender favorite/copy their own just-sent image
    // even though the optimistic message's `content` stays empty (the server
    // doesn't echo back to the sender). See ADR 0004.
    key?: string;
  }[];
  sendFailed?: boolean;
}

// A Sticker is an image a user has favorited from chat for quick reuse. It
// references the same storage key as its source image message — the bytes live
// in object storage once and are sent by key reference, never re-uploaded. See
// CONTEXT.md "Stickers" and ADR 0004.
export interface Sticker {
  id: string;
  key: string;
  createdAt: string;
}

export type LinkPreviewContentType =
  | "html"
  | "image"
  | "video"
  | "pdf"
  | "unknown";

export interface LinkPreview {
  title: string;
  description: string;
  image: string | null;
  contentType: LinkPreviewContentType;
  url: string;
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
      type: "aiTyping";
      data: { active: boolean };
    }
  | {
      type: "aiError";
      data: {
        code: "disabled" | "rate_limited" | "queue_full" | "unavailable";
      };
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
        replyTo?: ReplyRef;
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
