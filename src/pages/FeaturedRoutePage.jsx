import React from "react";
import { useParams } from "react-router-dom";
export default function FeaturedRoutePage() {
  const { slug } = useParams();
  return <div className="featured-route-placeholder">Featured route: {slug}</div>;
}
