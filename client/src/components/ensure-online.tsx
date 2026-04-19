import useIsOnline from "@/hooks/use-is-online.ts";
import type { ReactNode } from "react";

const EnsureOnline = ({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) => {
  const isOnline = useIsOnline();

  if (!isOnline) {
    return fallback;
  }

  return children;
};

export default EnsureOnline;
