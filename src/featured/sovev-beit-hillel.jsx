import React from "react";
import FeaturedRoute from "../components/featured/FeaturedRoute.jsx";

export const meta = {
  slug: "sovev-beit-hillel",
  name: "סובב בית הלל",
  summary: "מסלול קצר ונעים מסביב לבית הלל",
  route: "AQByAAcABAAFAFgAYABeAAoAeAAZAHIA",
  hero: null,
  difficulty: "easy",
  tags: ["family-friendly", "river"],
};

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
