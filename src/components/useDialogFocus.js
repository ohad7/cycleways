import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function useDialogFocus(onClose, activeKey = "dialog") {
  const dialogRef = useRef(null);
  const openerRef = useRef(null);

  useEffect(() => {
    openerRef.current = document.activeElement;
    const dialog = dialogRef.current;
    if (!dialog) return undefined;

    const background = Array.from(
      document.querySelectorAll(".header, .react-main-container, body > footer"),
    ).filter((element) => !dialog.contains(element));
    const previousInert = background.map((element) => [element, element.inert]);
    for (const element of background) element.inert = true;

    const focusables = () =>
      Array.from(dialog.querySelectorAll(FOCUSABLE)).filter(
        (element) => !element.hidden && element.getAttribute("aria-hidden") !== "true",
      );
    window.requestAnimationFrame(() => focusables()[0]?.focus());

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose?.();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    dialog.addEventListener("keydown", onKeyDown);
    return () => {
      dialog.removeEventListener("keydown", onKeyDown);
      for (const [element, inert] of previousInert) element.inert = inert;
      const opener = openerRef.current;
      window.requestAnimationFrame(() => {
        if (opener?.isConnected && typeof opener.focus === "function") opener.focus();
      });
    };
  }, [activeKey, onClose]);

  return dialogRef;
}
