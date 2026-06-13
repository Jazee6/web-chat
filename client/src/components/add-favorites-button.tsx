import { Button } from "@/components/ui/button.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { api } from "@/lib/utils.ts";
import { useQueryClient } from "@tanstack/react-query";
import { Heart, HeartPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const AddFavoritesButton = ({
  id,
  added,
  disabled,
}: {
  id: string;
  added: boolean;
  disabled?: boolean;
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const queryClient = useQueryClient();

  const onFavorite = async () => {
    setIsLoading(true);
    try {
      if (added) {
        await api.delete(`room/${id}/favorite`);
        toast.success("Favorite removed successfully.");
      } else {
        await api.post(`room/${id}/favorite`);
        toast.success("Favorite added successfully.");
      }
      await queryClient.invalidateQueries({
        queryKey: ["roomInfo", id],
      });
      await queryClient.invalidateQueries({
        queryKey: ["favoriteRoom"],
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Button
      size="icon-sm"
      className="rounded-full"
      variant="ghost"
      onClick={onFavorite}
      disabled={isLoading || disabled}
    >
      {isLoading ? (
        <Spinner />
      ) : added ? (
        <Heart className="fill-primary" />
      ) : (
        <HeartPlus />
      )}
    </Button>
  );
};

export default AddFavoritesButton;
