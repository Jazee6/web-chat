import { getCamera, getMic, getScreenshare } from "partytracks/client";
import { useObservable, useObservableAsValue } from "partytracks/react";
import { useCallback, useEffect, useState } from "react";

export const errorMessageMap = {
  NotAllowedError:
    "Permission was denied. Grant permission and reload to enable.",
  NotFoundError: "No device was found.",
  NotReadableError: "Device is already in use.",
  OverconstrainedError: "No device was found that meets constraints.",
  DevicesExhaustedError: "All devices failed to initialize.",
  UnknownError: "An unknown error occurred.",
};

type UserMediaError = keyof typeof errorMessageMap;

export const mic = getMic({
  broadcasting: true,
  constraints: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
});
export const camera = getCamera();
export const screenShare = getScreenshare({ audio: false });

function useScreenShare() {
  const screenShareIsBroadcasting = useObservableAsValue(
    screenShare.video.isBroadcasting$,
    false,
  );
  const startScreenShare = useCallback(() => {
    screenShare.startBroadcasting();
  }, []);
  const endScreenShare = useCallback(() => {
    screenShare.stopBroadcasting();
  }, []);

  return {
    screenShareEnabled: screenShareIsBroadcasting,
    startScreenShare,
    endScreenShare,
    screenShareVideoTrack$: screenShare.video.broadcastTrack$,
    screenShareVideoTrack: useObservableAsValue(
      screenShare.video.broadcastTrack$,
    ),
  };
}

export default function useUserMedia(options?: {
  micDeviceId?: string;
  cameraDeviceId?: string;
}) {
  useEffect(() => {
    if (!options?.micDeviceId) return;
    navigator.mediaDevices
      .enumerateDevices()
      .then((ds) => ds.find((d) => d.deviceId === options.micDeviceId))
      .then((d) => {
        if (d) {
          mic.setPreferredDevice(d);
        }
      });
  }, [options?.micDeviceId]);
  useEffect(() => {
    if (!options?.cameraDeviceId) return;
    navigator.mediaDevices
      .enumerateDevices()
      .then((ds) => ds.find((d) => d.deviceId === options.cameraDeviceId))
      .then((d) => {
        if (d) {
          camera.setPreferredDevice(d);
        }
      });
  }, [options?.cameraDeviceId]);

  const [videoUnavailableReason, setVideoUnavailableReason] =
    useState<UserMediaError>();
  const [audioUnavailableReason, setAudioUnavailableReason] =
    useState<UserMediaError>();

  const {
    endScreenShare,
    startScreenShare,
    screenShareEnabled,
    screenShareVideoTrack,
    screenShareVideoTrack$,
  } = useScreenShare();

  const micDevices = useObservableAsValue(mic.devices$, []);
  const cameraDevices = useObservableAsValue(camera.devices$, []);

  useObservable(mic.error$, (e) => {
    const reason =
      e.name in errorMessageMap ? (e.name as UserMediaError) : "UnknownError";
    if (reason === "UnknownError") {
      console.error("Unknown error getting audio track: ", e);
    }
    setAudioUnavailableReason(reason);
    mic.stopBroadcasting();
  });

  useObservable(camera.error$, (e) => {
    const reason =
      e.name in errorMessageMap ? (e.name as UserMediaError) : "UnknownError";
    if (reason === "UnknownError") {
      console.error("Unknown error getting video track: ", e);
    }
    setVideoUnavailableReason(reason);
    camera.stopBroadcasting();
  });

  return {
    turnMicOn: mic.startBroadcasting,
    turnMicOff: mic.stopBroadcasting,
    audioStreamTrack: useObservableAsValue(mic.broadcastTrack$),
    audioMonitorStreamTrack: useObservableAsValue(mic.localMonitorTrack$),
    audioEnabled: useObservableAsValue(mic.isBroadcasting$),
    audioUnavailableReason,
    publicAudioTrack$: mic.broadcastTrack$,
    privateAudioTrack$: mic.localMonitorTrack$,
    audioDeviceId: useObservableAsValue(mic.activeDevice$)?.deviceId,
    setAudioDeviceId: (deviceId: string) => {
      const found = micDevices.find((d) => d.deviceId === deviceId);
      if (found) mic.setPreferredDevice(found);
    },

    setVideoDeviceId: (deviceId: string) => {
      const found = cameraDevices.find((d) => d.deviceId === deviceId);
      if (found) camera.setPreferredDevice(found);
    },
    videoDeviceId: useObservableAsValue(camera.activeDevice$)?.deviceId,
    turnCameraOn: camera.startBroadcasting,
    turnCameraOff: camera.stopBroadcasting,
    videoEnabled: useObservableAsValue(camera.isBroadcasting$, true),
    videoUnavailableReason,
    videoTrack$: camera.broadcastTrack$,
    videoStreamTrack: useObservableAsValue(camera.broadcastTrack$),

    startScreenShare,
    endScreenShare,
    screenShareVideoTrack,
    screenShareEnabled,
    screenShareVideoTrack$,
  };
}

export type UserMedia = ReturnType<typeof useUserMedia>;
