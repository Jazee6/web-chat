import type { User } from "better-auth";
import { createContext, useContext } from "react";

type UserInfoContextType = {
  users: Record<string, User>;
  fetchMissingUsers: (ids: string[]) => void;
};

export const UserInfoContext = createContext<UserInfoContextType | null>(null);

export const useUserInfo = () => {
  const context = useContext(UserInfoContext);
  if (!context) {
    throw new Error("useUserInfo must be used within a UserInfoProvider");
  }
  return context;
};
