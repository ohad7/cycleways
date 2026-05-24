import { useEffect, useState } from "react";

export const MOBILE_BREAKPOINT = "(max-width: 767px)";

export function useIsMobile() {
  const [match, setMatch] = useState(() =>
    typeof window !== "undefined" && window.matchMedia(MOBILE_BREAKPOINT).matches
  );
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const mq = window.matchMedia(MOBILE_BREAKPOINT);
    const onChange = (e) => setMatch(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return match;
}
