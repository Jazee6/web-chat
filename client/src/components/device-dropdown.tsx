import { Button } from "@/components/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { mic } from "@/hooks/use-user-media.ts";
import { Settings2 } from "lucide-react";
import { useObservableAsValue } from "partytracks/react";

const DeviceDropdown = () => {
  const audioDevices = useObservableAsValue(mic.devices$);
  const activeAudioDevice = useObservableAsValue(mic.activeDevice$);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button size="icon" variant="secondary" className="rounded-full">
            <Settings2 />
          </Button>
        }
      />
      <DropdownMenuContent className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Audio Input</DropdownMenuLabel>

          <DropdownMenuRadioGroup
            value={activeAudioDevice?.deviceId}
            onValueChange={(value) => {
              const d = audioDevices?.find((i) => i.deviceId === value);
              if (d) {
                mic.setPreferredDevice(d);
              }
            }}
          >
            {audioDevices?.map((d) => (
              <DropdownMenuRadioItem value={d.deviceId} key={d.deviceId}>
                {d.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default DeviceDropdown;
