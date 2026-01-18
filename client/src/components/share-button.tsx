import { Button } from "@/components/ui/button.tsx";
import { Share } from "lucide-react";

const ShareButton = ({ title }: { title?: string }) => {
  const onShare = async () => {
    await navigator.share({
      title: title ?? document.title,
      url: window.location.href,
    });
  };

  return (
    <Button
      size="icon-sm"
      variant="ghost"
      className="rounded-full"
      onClick={onShare}
    >
      <Share />
    </Button>
  );
};

export default ShareButton;
