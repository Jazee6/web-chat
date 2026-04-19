import { type ReactNode } from "react";
import { useMicrophonePermission } from "../hooks/use-microphone-permission";

const EnsurePermissions = ({
  children,
  fallback,
}: {
  children?: ReactNode;
  fallback?: ReactNode;
}) => {
  const permissionState = useMicrophonePermission();

  if (permissionState === "denied") {
    return fallback;
  }

  return children;
};

export default EnsurePermissions;
