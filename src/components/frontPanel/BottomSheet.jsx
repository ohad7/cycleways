import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  offsetsForHeight,
  resolveSnap,
  nextSnap,
} from "./sheetSnap.js";

// Mobile bottom sheet around the front panel. On desktop (>860px) the CSS
// neutralizes it into the plain 408px side column — this component then only
// adds an inert wrapper div. On mobile it is absolutely positioned over the
// map and translateY-driven between peek / half / full snap points. Dragging
// happens ONLY on the handle strip, so the panel body keeps native scrolling.
export default function BottomSheet({ snap, onSnapChange, peekContent, children }) {
  const sheetRef = useRef(null);
  const [shellHeight, setShellHeight] = useState(0);
  const dragRef = useRef(null); // { startY, startOffset, lastY, lastT, velocity }
  const [dragOffset, setDragOffset] = useState(null);

  // Track the shell's height (the sheet's positioning parent) for offsets.
  useEffect(() => {
    const shell = sheetRef.current?.parentElement;
    if (!shell || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => setShellHeight(shell.clientHeight));
    ro.observe(shell);
    setShellHeight(shell.clientHeight);
    return () => ro.disconnect();
  }, []);

  const offsets = offsetsForHeight(shellHeight);

  const handleTouchStart = useCallback(
    (event) => {
      const y = event.touches[0].clientY;
      dragRef.current = {
        startY: y,
        startOffset: offsets[snap] ?? 0,
        lastY: y,
        lastT: performance.now(),
        velocity: 0,
      };
    },
    [offsets, snap],
  );

  const handleTouchMove = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag) return;
    const y = event.touches[0].clientY;
    const now = performance.now();
    const dt = Math.max(now - drag.lastT, 1);
    drag.velocity = (y - drag.lastY) / dt;
    drag.lastY = y;
    drag.lastT = now;
    const offset = Math.max(drag.startOffset + (y - drag.startY), 0);
    setDragOffset(offset);
  }, []);

  const handleTouchEnd = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDragOffset((current) => {
      if (current !== null && drag) {
        onSnapChange(resolveSnap(current, drag.velocity, offsetsForHeight(
          sheetRef.current?.parentElement?.clientHeight ?? 0,
        )));
      }
      return null;
    });
  }, [onSnapChange]);

  const dragging = dragOffset !== null;
  const offset = dragging ? dragOffset : offsets[snap] ?? 0;

  return (
    <div
      ref={sheetRef}
      className={`front-sheet front-sheet--${snap}${dragging ? " front-sheet--dragging" : ""}`}
      data-snap={snap}
      style={{ "--sheet-offset": `${offset}px` }}
    >
      <div
        className="front-sheet__handle"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        <button
          type="button"
          className="front-sheet__grip"
          aria-label="שנה גודל פאנל"
          onClick={() => onSnapChange(nextSnap(snap))}
        />
      </div>
      {peekContent ? <div className="front-sheet__peek">{peekContent}</div> : null}
      {children}
    </div>
  );
}
