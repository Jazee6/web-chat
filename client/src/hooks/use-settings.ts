import { useLocalStorageState } from "ahooks";

const useSettings = () => {
  return useLocalStorageState("wc_settings", {
    defaultValue: {
      showStatus: false,
      // Default on: typing carries no device state and needs no permission,
      // unlike showStatus (idle/locked). Existing users whose stored settings
      // predate this field see `undefined` — treat that as on (see ADR 0002).
      showTyping: true,
    },
  });
};

export default useSettings;
