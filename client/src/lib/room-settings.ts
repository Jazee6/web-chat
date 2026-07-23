export const openRoomSettings = (id: string) => {
  dispatchEvent(new CustomEvent("room-settings:open", { detail: { id } }));
};
