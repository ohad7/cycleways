import { createContext, useContext } from "react";

export const FeaturedRouteContext = createContext(null);

export function useFeaturedRoute() {
  const ctx = useContext(FeaturedRouteContext);
  if (!ctx) {
    throw new Error("useFeaturedRoute must be used inside <FeaturedRoute>");
  }
  return ctx;
}
