import { useLocalStorageState } from "ahooks";

const useSettings = () => {
  return useLocalStorageState("wc_settings", {
    defaultValue: {
      showStatus: false,
    },
  });
};

export default useSettings;
