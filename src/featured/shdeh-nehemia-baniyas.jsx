import React from "react";
import FeaturedRoute from "../components/featured/FeaturedRoute.jsx";
import { meta } from "./shdeh-nehemia-baniyas.meta.js";

export { meta };

export default function ShdehNehemiaBaniyas() {
  return (
    <FeaturedRoute meta={meta}>
      <p>{meta.summary}</p>
      <FeaturedRoute.Map />
      <FeaturedRoute.Warnings />
      <FeaturedRoute.POIs />
    </FeaturedRoute>
  );
}
