import React from "react";
import FeaturedRoute from "../components/featured/FeaturedRoute.jsx";

export const meta = {
  slug: "sovev-beit-hillel",
  name: "סובב בית הלל",
  summary: "מסלול קצר ונעים מסביב לבית הלל",
  route: "u2RR2EzQKyMNaQSfoLh5fhMieHKFiE8qzNLPTbbR5jf2",
  hero: null,
  difficulty: "easy",
  tags: ["family-friendly", "river"],
};

export default function SovevBeitHillel() {
  return (
    <FeaturedRoute meta={meta}>
      <p>תיאור המסלול — מתחלף בתוכן אמיתי בהמשך.</p>
    </FeaturedRoute>
  );
}
