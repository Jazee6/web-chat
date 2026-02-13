import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Switch } from "@/components/ui/switch.tsx";
import useSettings from "@/hooks/use-settings.ts";
import { toast } from "sonner";

const Settings = () => {
  const [settings, setSettings] = useSettings();

  const setNewSettings = (newSettings: Partial<typeof settings>) => {
    setSettings({
      ...settings,
      ...newSettings,
    });
  };

  return (
    <div className="max-w-3xl w-full mx-auto pt-16 px-4">
      <FieldSet>
        <FieldLegend>Settings</FieldLegend>
        <FieldDescription></FieldDescription>

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="status">Show my status</FieldLabel>

            <FieldDescription>
              When enabled, room members will be able to see your status.
            </FieldDescription>

            <Switch
              id="status"
              checked={settings?.showStatus}
              disabled={!("IdleDetector" in window)}
              onCheckedChange={async (checked) => {
                if (checked) {
                  const permission =
                    await window.IdleDetector.requestPermission();
                  if (permission === "denied") {
                    toast.warning("Idle Detection permission denied.");
                    return;
                  }
                }

                setNewSettings({
                  showStatus: checked,
                });
              }}
            />
          </Field>
        </FieldGroup>
      </FieldSet>
    </div>
  );
};

export default Settings;
