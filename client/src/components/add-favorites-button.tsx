import { Button } from "@/components/ui/button.tsx";
import { HeartPlus } from "lucide-react";

const AddFavoritesButton = () => {
  return (
    <Button size="icon-sm" className="rounded-full" variant="ghost" disabled>
      <HeartPlus />
    </Button>
  );
};

export default AddFavoritesButton;
