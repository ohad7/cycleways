import React from "react";
import FeaturedRoute from "../components/featured/FeaturedRoute.jsx";
import { meta } from "./sovev-beit-hillel.meta.js";

export { meta };

export default function SovevBeitHillel() {
  return (
    <FeaturedRoute meta={meta}>
      <p>תיאור המסלול — לדוגמה.</p>
      <FeaturedRoute.Map />
      <FeaturedRoute.Warnings />
      <FeaturedRoute.POIs
        extra={[{
          type: "cafe",
          id: "demo-cafe-1",
          name: "בית קפה לדוגמה",
          information: "להחליף בתוכן אמיתי",
          location: [33.21, 35.60],
        }]}
      />
      <FeaturedRoute.Gallery photos={[]} />
      <FeaturedRoute.Video src={undefined} />
    </FeaturedRoute>
  );
}
