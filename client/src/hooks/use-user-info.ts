import { api } from "@/lib/utils.ts";
import type { User } from "better-auth";
import { useCallback, useRef, useState } from "react";

export const useUserInfo = () => {
  const [users, setUsers] = useState<Record<string, User>>({});
  const processedIds = useRef(new Set<string>());

  const fetchMissingUsers = useCallback((ids: string[]) => {
    const missingIds = [...new Set(ids)].filter(
      (id) => !processedIds.current.has(id),
    );

    if (missingIds.length === 0) return;

    missingIds.forEach((id) => processedIds.current.add(id));

    api
      .get("room/user", {
        searchParams: { ids: missingIds.join(",") },
      })
      .json<User[]>()
      .then((newUsersList) => {
        setUsers((prev) => {
          const next = { ...prev };
          newUsersList.forEach((u) => {
            next[u.id] = u;
          });
          return next;
        });
      })
      .catch((err) => {
        console.error("Failed to fetch missing users:", err);
        missingIds.forEach((id) => processedIds.current.delete(id));
      });
  }, []);

  return { users, fetchMissingUsers };
};
