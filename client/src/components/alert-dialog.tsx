"use client";

import {
  AlertDialogCancel,
  AlertDialog as AlertDialogComponent,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export type AlertDialogOptions = {
  title?: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  onConfirmAction?: () => Promise<unknown>;
};

const BUS_EVENT = "alert-dialog:open";

export const AlertDialog = () => {
  const [options, setOptions] = useState<AlertDialogOptions>();
  const [isPending, setIsPending] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<AlertDialogOptions>;
      setOptions(customEvent.detail);
      setOpen(true);
    };

    addEventListener(BUS_EVENT, handler);
    return () => removeEventListener(BUS_EVENT, handler);
  }, []);

  if (!options) return null;

  const {
    title = "Are you sure?",
    description,
    confirmText = "Confirm",
    cancelText = "Cancel",
    onConfirmAction,
  } = options;

  const handleConfirm = async () => {
    setIsPending(true);
    await onConfirmAction?.().finally(() => setIsPending(false));
    setOpen(false);
  };

  return createPortal(
    <AlertDialogComponent open={open} onOpenChange={setOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelText}</AlertDialogCancel>
          <Button onClick={handleConfirm} disabled={isPending}>
            {isPending && <Spinner />}
            {confirmText}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialogComponent>,
    document.body,
  );
};

export default AlertDialog;
