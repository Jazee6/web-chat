import { useEffect, useState } from "react";

let sharedAudioContext: AudioContext | null = null;

const getSharedAudioContext = () => {
  if (!sharedAudioContext || sharedAudioContext.state === "closed") {
    sharedAudioContext = new AudioContext();
  }
  if (sharedAudioContext.state === "suspended") {
    void sharedAudioContext.resume();
  }
  return sharedAudioContext;
};

const useAudioLevel = (track?: MediaStreamTrack) => {
  const [level, setLevel] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);

  useEffect(() => {
    if (!track) {
      return;
    }

    const audioContext = getSharedAudioContext();
    const mediaStream = new MediaStream([track]);
    const source = audioContext.createMediaStreamSource(mediaStream);
    const analyser = audioContext.createAnalyser();

    analyser.fftSize = 256;
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    let animationFrameId: number;

    const updateLevel = () => {
      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const averageVolume = sum / dataArray.length;
      const currentLevel = averageVolume / 255;
      setLevel(currentLevel);
      setIsSpeaking(currentLevel > 0.05);
      animationFrameId = requestAnimationFrame(updateLevel);
    };

    updateLevel();

    return () => {
      cancelAnimationFrame(animationFrameId);
      source.disconnect();
    };
  }, [track]);

  return { level: track ? level : 0, isSpeaking: track ? isSpeaking : false };
};

export default useAudioLevel;
