import React from "react";
import LegalPage from "./legal/LegalPage.jsx";
import {
  FEEDBACK_FORM_URL,
  SUPPORT_EMAIL,
} from "@cycleways/core/config/appLinks.js";

export default function SupportPage() {
  return (
    <LegalPage title="תמיכה ויצירת קשר" updated="13 ביולי 2026">
      <h2>איך יוצרים קשר</h2>
      <ul>
        <li>
          בדוא"ל: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> —
          נשתדל לענות תוך כמה ימים.
        </li>
        <li>
          דרך{" "}
          <a href={FEEDBACK_FORM_URL} target="_blank" rel="noreferrer">
            טופס המשוב
          </a>{" "}
          — הדרך המהירה לדווח על בעיה במפה או במסלול.
        </li>
      </ul>

      <h2>דיווח על בעיה במפה</h2>
      <p>נשמח במיוחד לדיווחים על:</p>
      <ul>
        <li>שערים או גדרות שחוסמים מעבר ולא מסומנים במפה.</li>
        <li>שבילים שהפכו ללא עבירים (בוץ, צמחייה, סחף).</li>
        <li>שבילים חדשים או מסלולים שכדאי להוסיף.</li>
      </ul>

      <h2>בעיה באפליקציה?</h2>
      <p>
        כשמדווחים על תקלה באפליקציה, ציינו בבקשה את גרסת האפליקציה ומספר
        הבנייה — שניהם מופיעים במסך "אודות" באפליקציה — ואת דגם המכשיר. זה
        עוזר לנו לאתר את הבעיה מהר.
      </p>

      <h2>בעיית נגישות או צורך בחלופה</h2>
      <p>
        ציינו את כתובת העמוד, תיאור הקושי, סוג המכשיר והדפדפן וטכנולוגיה
        מסייעת אם רלוונטי. אפשר לקרוא על החלופות הזמינות ב<a href="/accessibility">הצהרת הנגישות</a>.
      </p>

      <h2>קרדיטים ומקורות נתונים</h2>
      <ul>
        <li>נתוני מפה: © Mapbox, © OpenStreetMap contributors.</li>
        <li>
          רשת הניווט של CycleWays מבוססת על נתוני OpenStreetMap ברישיון ODbL.
        </li>
        <li>המסלולים, הצילומים והתיאורים: © CycleWays.</li>
      </ul>

      <h2>מסמכים נוספים</h2>
      <ul>
        <li>
          <a href="/privacy">מדיניות פרטיות</a>
        </li>
        <li>
          <a href="/terms">תנאי שימוש</a>
        </li>
        <li>
          <a href="/accessibility">הצהרת נגישות</a>
        </li>
      </ul>

      <section className="legal-page__english">
        <h2>English summary</h2>
        <p>
          Support for the CycleWays app and website: email {SUPPORT_EMAIL} or
          use our feedback form. When reporting an app issue, include the app
          version and build number shown on the in-app About screen. Map data
          © Mapbox © OpenStreetMap contributors; the routing network is
          derived from OpenStreetMap data under ODbL. Accessibility assistance
          and practical alternatives are available by email.
        </p>
      </section>
    </LegalPage>
  );
}
