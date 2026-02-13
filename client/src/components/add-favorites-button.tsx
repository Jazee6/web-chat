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
    if (!added) {
      await api.post(`room/${id}/favorite`).finally(() => setIsLoading(false));
      await Promise.all([
        queryClient.refetchQueries({
          queryKey: ["roomInfo", id],
        }),
        queryClient.refetchQueries({
          queryKey: ["favoriteRoom"],
        }),
      ]);
      toast.success("Favorite added successfully.");
      return;
    }

    await api.delete(`room/${id}/favorite`).finally(() => setIsLoading(false));
    await Promise.all([
      queryClient.refetchQueries({
        queryKey: ["roomInfo", id],
      }),
      queryClient.refetchQueries({
        queryKey: ["favoriteRoom"],
      }),
    ]);
    toast.success("Favorite removed successfully.");
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
