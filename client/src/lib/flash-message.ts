type FlashMessageOptions = {
  block?: ScrollLogicalPosition;
  behavior?: ScrollBehavior;
  scrollMarginTop?: number;
};

export const flashMessage = (
  id: string,
  options?: FlashMessageOptions,
) => {
  const element = document.getElementById(id);
  if (!element) return;

  const scrollMarginTop = options?.scrollMarginTop;
  const prevScrollMarginTop = element.style.scrollMarginTop;
  if (scrollMarginTop != null) {
    element.style.scrollMarginTop = `${scrollMarginTop}px`;
  }

  element.scrollIntoView({
    behavior: options?.behavior ?? "smooth",
    block: options?.block ?? "center",
  });
  element.classList.add("reply-flash");
  const cleanup = () => {
    element.classList.remove("reply-flash");
    element.style.scrollMarginTop = prevScrollMarginTop;
    clearTimeout(timer);
  };
  const timer = setTimeout(cleanup, 1600);
  element.addEventListener("animationend", cleanup, { once: true });
};
