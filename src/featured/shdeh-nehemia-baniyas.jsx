import React from "react";
import FeaturedRoute from "../components/featured/FeaturedRoute.jsx";

export default function ShdehNehemiaBaniyas() {
  return (
    <FeaturedRoute slug="shdeh-nehemia-baniyas">
      <p>מסלול קצר ונוח, מומלץ במיוחד לחובבי רכיבה ראשונית, עם פינות מנוחה רבות.</p>
      <FeaturedRoute.Map />
      <FeaturedRoute.Warnings />
      <FeaturedRoute.POIs />
    </FeaturedRoute>
  );
}
