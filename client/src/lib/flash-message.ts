export const flashMessage = (id: string) => {
  const element = document.getElementById(id);
  if (!element) return;

  element.scrollIntoView({ behavior: "smooth", block: "center" });
  element.classList.add("reply-flash");
  const cleanup = () => {
    element.classList.remove("reply-flash");
    clearTimeout(timer);
  };
  const timer = setTimeout(cleanup, 1600);
  element.addEventListener("animationend", cleanup, { once: true });
};
