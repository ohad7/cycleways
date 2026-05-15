import React from "react";
import FeaturedRoute from "../components/featured/FeaturedRoute.jsx";

export const meta = {
  slug: "shdeh-nehemia-baniyas",
  name: "שדה נחמיה → בניאס → גן הצפון → שדה נחמיה",
  summary: "מסלול קצר ונוח, מומלץ במיוחד לחובבי רכיבה ראשונית, עם פינות מנוחה רבות.",
  route: "AQByAAcABAAFAFgAYABeAAoAeAAZAHIA",
  hero: null,
  difficulty: "easy",
  tags: ["beginner-friendly"],
};

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
