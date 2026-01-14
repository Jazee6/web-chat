import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field.tsx";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { api } from "@/lib/utils.ts";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { createRoomSchema } from "web-chat-share";
import { z } from "zod";

export function RoomCreateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const nameId = useId();
  const typeId = useId();
  const formId = useId();
  const [isLoading, setIsLoading] = useState(false);
  const queryClient = useQueryClient();
  const nav = useNavigate();

  const form = useForm<z.infer<typeof createRoomSchema>>({
    resolver: zodResolver(createRoomSchema),
    defaultValues: {
      name: "",
      type: "private",
    },
  });

  const onSubmit = async (data: z.infer<typeof createRoomSchema>) => {
    setIsLoading(true);
    const { id } = await api
      .post<{ id: string }>("room", { json: data })
      .json()
      .finally(() => setIsLoading(false));
    queryClient.refetchQueries({ queryKey: ["room"] });
    toast.success("Room created");
    nav("/room/" + id);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Room</DialogTitle>
          <DialogDescription></DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} id={formId}>
          <FieldSet>
            <FieldGroup>
              <Controller
                name="name"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor={nameId}>Name</FieldLabel>
                    <Input
                      {...field}
                      id={nameId}
                      aria-invalid={fieldState.invalid}
                      placeholder="Enter room name"
                    />
                    {fieldState.invalid && (
                      <FieldError errors={[fieldState.error]} />
                    )}
                  </Field>
                )}
              />

              <Controller
                name="type"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field
                    orientation="horizontal"
                    data-invalid={fieldState.invalid}
                  >
                    <FieldContent>
                      <FieldLabel htmlFor={typeId}>Public Room</FieldLabel>
                      <FieldDescription>
                        Enable this to display the room in the public rooms
                        list.
                      </FieldDescription>
                      {fieldState.invalid && (
                        <FieldError errors={[fieldState.error]} />
                      )}
                    </FieldContent>
                    <Switch
                      id={typeId}
                      name={field.name}
                      checked={field.value === "public"}
                      onCheckedChange={(checked) => {
                        field.onChange(checked ? "public" : "private");
                      }}
                      aria-invalid={fieldState.invalid}
                    />
                  </Field>
                )}
              />
            </FieldGroup>
          </FieldSet>
        </form>

        <DialogFooter className="mt-4">
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button type="submit" form={formId} disabled={isLoading}>
            {isLoading && <Spinner />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
