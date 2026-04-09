import { Room } from "../do/room";
import { Session, User } from "./auth";

export interface HONOInstance {
  Variables: {
    user: User;
    session: Session;
  };
  Bindings: {
    web_chat: D1Database;
    ROOM: DurableObjectNamespace<Room>;
    FILE: R2Bucket;
  };
}
