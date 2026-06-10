import { useCallback, useEffect, useRef, useState } from "react";
import { deriveViewportSets } from "./discoverViewport.js";

const EMPTY = { visibleSlugs: [], ghostSlugs: [], prefetchSlugs: [] };

// Observe the Discover cards against their scrolling ancestor and report the
// bright / ghost / prefetch slug sets. `orderedSlugs` is the catalog-ordered
// list of every card's slug.
//
// Returns:
//   containerRef – attach to the element that wraps the cards; the observer
//                  root is resolved by climbing to the scrolling
//                  `.front-panel__body` ancestor (falls back to the viewport).
//   registerCard – `registerCard(slug)` returns a ref callback for that card.
//   sets         – { visibleSlugs, ghostSlugs, prefetchSlugs }, recomputed on scroll.
export function useCardViewport(orderedSlugs) {
  const containerRef = useRef(null);
  const cardEls = useRef(new Map());       // slug -> element
  const intersecting = useRef(new Set());  // slugs currently intersecting
  const observerRef = useRef(null);
  const rafRef = useRef(0);
  const [sets, setSets] = useState(EMPTY);

  const recompute = useCallback(() => {
    setSets(deriveViewportSets(orderedSlugs, intersecting.current));
  }, [orderedSlugs]);

  // Coalesce bursts of observer callbacks into one recompute per frame.
  const schedule = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = 0;
      recompute();
    });
  }, [recompute]);

  // (Re)build the observer whenever the slug list changes.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof IntersectionObserver === "undefined") return undefined;
    const root = container.closest(".front-panel__body") || null;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const slug = entry.target.dataset.discoverSlug;
          if (!slug) continue;
          if (entry.isIntersecting) intersecting.current.add(slug);
          else intersecting.current.delete(slug);
        }
        schedule();
      },
      { root, threshold: 0 },
    );
    observerRef.current = observer;
    for (const el of cardEls.current.values()) observer.observe(el);
    schedule();
    return () => {
      observer.disconnect();
      observerRef.current = null;
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [orderedSlugs, schedule]);

  // Ref-callback factory: registers/unregisters a card element by slug.
  const registerCard = useCallback(
    (slug) => (el) => {
      const prev = cardEls.current.get(slug);
      if (prev && observerRef.current) observerRef.current.unobserve(prev);
      if (el) {
        el.dataset.discoverSlug = slug;
        cardEls.current.set(slug, el);
        if (observerRef.current) observerRef.current.observe(el);
      } else {
        cardEls.current.delete(slug);
        intersecting.current.delete(slug);
      }
    },
    [],
  );

  return { containerRef, registerCard, sets };
}
