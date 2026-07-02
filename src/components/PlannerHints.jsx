import React, { useEffect, useState } from "react";
import { getStoredItem, setStoredItem } from "@cycleways/core/platform/storage.js";

// Three one-time hints that replace the old tutorial modal. Each fires off
// the user's actual progress and is dismissed forever once acknowledged
// (or once the user progresses past it, which marks it as seen implicitly).
const HINTS = [
  {
    key: "cycleways:hint-build-start",
    text: "לחצו על המפה ליד שביל כדי להתחיל מסלול",
    active: ({ panelState, pointCount }) => panelState === "build" && pointCount === 0,
  },
  {
    key: "cycleways:hint-add-second",
    text: "הוסיפו נקודה נוספת כדי לחשב מסלול",
    active: ({ pointCount, routeReady }) => pointCount === 1 && !routeReady,
  },
  {
    key: "cycleways:hint-edit-route",
    text: "גררו את הקו או הנקודות כדי לשנות; הקישו על נקודה כדי להסיר אותה",
    active: ({ routeReady }) => routeReady,
  },
];

export default function PlannerHints({ panelState, pointCount, routeReady }) {
  const [, forceRender] = useState(0);
  const [sessionHiddenKeys, setSessionHiddenKeys] = useState(() => new Set());
  const [isMobileHint, setIsMobileHint] = useState(() =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(max-width: 860px)").matches,
  );
  const progress = { panelState, pointCount, routeReady };

  // Progressing past a hint marks it seen even without an explicit dismiss,
  // so returning users don't get stale earlier-stage hints.
  useEffect(() => {
    const activeIndex = HINTS.findIndex((h) => h.active(progress));
    HINTS.forEach((h, i) => {
      if (activeIndex > i || (activeIndex === -1 && pointCount > 0)) {
        if (!getStoredItem(h.key)) setStoredItem(h.key, "seen");
      }
    });
  }, [panelState, pointCount, routeReady]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return undefined;
    }
    const query = window.matchMedia("(max-width: 860px)");
    const update = () => setIsMobileHint(query.matches);
    update();
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", update);
      return () => query.removeEventListener("change", update);
    }
    query.addListener?.(update);
    return () => query.removeListener?.(update);
  }, []);

  const hint = HINTS.find((h) =>
    h.active(progress) &&
    !getStoredItem(h.key) &&
    !sessionHiddenKeys.has(h.key)
  );

  useEffect(() => {
    if (!hint || !isMobileHint) return undefined;
    const timer = window.setTimeout(() => {
      setSessionHiddenKeys((prev) => new Set(prev).add(hint.key));
    }, 4500);
    return () => window.clearTimeout(timer);
  }, [hint, isMobileHint]);

  if (!hint) return null;
  return (
    <div className="planner-hint" role="status">
      <span>{hint.text}</span>
      <button
        type="button"
        onClick={() => {
          setStoredItem(hint.key, "seen");
          setSessionHiddenKeys((prev) => new Set(prev).add(hint.key));
          forceRender((n) => n + 1);
        }}
      >
        הבנתי
      </button>
    </div>
  );
}
