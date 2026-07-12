import React from "react";
import LegalPage from "./legal/LegalPage.jsx";
import { SUPPORT_EMAIL } from "@cycleways/core/config/appLinks.js";

export default function AccessibilityPage() {
  return (
    <LegalPage title="נגישות באתר CycleWays" updated="13 ביולי 2026">
      <h2>הצהרת נגישות ופטור</h2>
      <p>
        CycleWays הוא מיזם פרטי וחינמי המופעל בידי אדם יחיד. על בסיס העובדות
        הנוכחיות, ובהן מחזור שנתי הנמוך מ־100,000 ש״ח, המפעיל מסתמך על הפטור
        להתאמות נגישות בשירותי אינטרנט לפי תקנה 35ו(ז). העובדות והפטור נבדקים
        מחדש לפחות פעם בשנה ובכל שינוי מהותי בפעילות.
      </p>
      <p>
        למרות הפטור, אנו פועלים מרצון לשיפור השימוש באתר באמצעות מקלדת,
        קוראי מסך, הגדלת טקסט והפחתת תנועה, בלי להוסיף שכבת נגישות חיצונית.
      </p>

      <h2>אמצעים וחלופות זמינים</h2>
      <ul>
        <li>עמודי מסלולים טקסטואליים הכוללים מרחק, טיפוס, אזהרות ופרטי דרך.</li>
        <li>חיפוש וסינון מסלולים באמצעות בקרות שאינן תלויות בלחיצה על המפה.</li>
        <li>הורדת קובץ GPX ושיתוף קישור למסלול.</li>
        <li>סיוע והנגשת מידע מעשית בדוא״ל לפי בקשה.</li>
      </ul>

      <h2>מגבלות ידועות</h2>
      <p>
        המפה האינטראקטיבית ובנייה חופשית של מסלול על גבי המפה הן ממשקים
        חזותיים מורכבים, ולא כל חקירה מרחבית ניתנת כיום לביצוע באופן שווה ללא
        מצביע. רכיבי Mapbox, סרטוני YouTube ותוכן צד שלישי עשויים לכלול מגבלות
        שאינן בשליטתנו. עמודי המסלול והסיוע בדוא״ל הם החלופה המעשית הזמינה.
      </p>

      <h2>דיווח על בעיית נגישות</h2>
      <p>
        אפשר לפנות אל <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
        כדי שנוכל לעזור, מומלץ לצרף את כתובת העמוד, תיאור הקושי, סוג המכשיר
        והדפדפן, וטכנולוגיה מסייעת אם נעשה בה שימוש. ננסה לספק פתרון או חלופה
        מעשית בהקדם האפשרי.
      </p>

      <section className="legal-page__english">
        <h2>English summary</h2>
        <p>
          CycleWays is a free, privately owned project operated by one person.
          Based on the currently confirmed turnover facts, the operator relies
          on the Israeli low-turnover web-accessibility exemption while making
          voluntary accessibility improvements. Known limitations include the
          interactive map, free-form map route building, Mapbox, YouTube, and
          third-party content. Textual route pages, GPX downloads, and practical
          assistance by email are available. Contact: {SUPPORT_EMAIL}.
        </p>
      </section>
    </LegalPage>
  );
}
