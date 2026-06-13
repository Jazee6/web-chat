import { Room } from "../do/room";
import { Session, User } from "./auth";

export interface HONOInstance {
  Variables: {
    user: User;
    session: Session;
  };
  Bindings: CloudflareBindings;
}
