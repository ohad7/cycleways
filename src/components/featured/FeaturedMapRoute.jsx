import React from "react";
import FeaturedVideoRoute from "./FeaturedVideoRoute.jsx";

export default function FeaturedMapRoute(props) {
  return (
    <FeaturedVideoRoute
      {...props}
      media="map"
      videoCursorVariant="progress-head-pulse"
    />
  );
}
