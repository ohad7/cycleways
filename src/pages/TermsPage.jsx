import React from "react";
import LegalPage from "./legal/LegalPage.jsx";
import {
  FEEDBACK_FORM_URL,
  SUPPORT_EMAIL,
} from "@cycleways/core/config/appLinks.js";

export default function TermsPage() {
  return (
    <LegalPage title="תנאי שימוש" updated="5 ביולי 2026">
      <h2>הסכמה לתנאים</h2>
      <p>
        השימוש באתר www.cycleways.app ובאפליקציית CycleWays ("השירות") מהווה
        הסכמה לתנאים אלה. אם אינכם מסכימים להם, אנא הימנעו משימוש בשירות.
      </p>

      <h2>מהות השירות</h2>
      <p>
        השירות מציע מידע על מסלולי רכיבה, כלי תכנון מסלולים והנחיות ניווט.
        המידע והמסלולים מסופקים כפי שהם (AS IS), ללא התחייבות לזמינות, לדיוק
        או להתאמה למטרה מסוימת.
      </p>

      <h2>בטיחות ואחריות</h2>
      <p>
        רכיבה על אופניים כרוכה בסיכון. השימוש במסלולים ובהנחיות הניווט הוא
        באחריותכם הבלעדית:
      </p>
      <ul>
        <li>
          תנאי השטח משתנים — שערים ננעלים, שבילים נחסמים, מזג האוויר משפיע.
          מה שמופיע במפה אינו תחליף למה שרואים בשטח.
        </li>
        <li>
          חובה לציית לתמרורים, לחוקי התנועה ולתנאי הדרך בפועל — הם קודמים לכל
          הנחיה מהאפליקציה.
        </li>
        <li>
          ההנחיות הקוליות והמפה הן עזר לתכנון והתמצאות, לא תחליף לשיקול דעת.
          התאימו את הרכיבה ליכולתכם, לציוד ולתנאים.
        </li>
        <li>מומלץ לרכוב עם קסדה, ציוד תקין, מים ואמצעי קשר טעון.</li>
      </ul>
      <p>
        לא נהיה אחראים לכל נזק, ישיר או עקיף, שייגרם כתוצאה מהסתמכות על
        השירות, ככל שהדין מתיר זאת.
      </p>

      <h2>דיוק הנתונים ודיווחים</h2>
      <p>
        אנו משתדלים לשמור על המפה מעודכנת, אך ייתכנו אי-דיוקים. נשמח לדיווחים
        על שערים חסומים, שבילים שאינם עבירים או כל טעות אחרת דרך{" "}
        <a href={FEEDBACK_FORM_URL} target="_blank" rel="noreferrer">
          טופס המשוב
        </a>
        .
      </p>

      <h2>קניין רוחני</h2>
      <p>
        תכני השירות — המסלולים, התיאורים, הצילומים והעיצוב — שייכים ל-CycleWays
        אלא אם צוין אחרת. נתוני המפה מסופקים על ידי Mapbox ועל בסיס נתוני
        OpenStreetMap ברישיון ODbL, וסרטונים מוטמעים כפופים לתנאי YouTube.
        השימוש בתכנים מותר לצרכים אישיים ולא מסחריים.
      </p>

      <h2>שימוש הוגן</h2>
      <p>
        אין להשתמש בשירות באופן שפוגע בזמינותו או בזכויות של אחרים, ואין
        להעתיק את מסד הנתונים של השירות בהיקף מסחרי ללא הסכמה בכתב.
      </p>

      <h2>שינויים ודין חל</h2>
      <p>
        התנאים עשויים להתעדכן מעת לעת; תאריך העדכון מופיע בראש העמוד. על תנאים
        אלה חלים דיני מדינת ישראל.
      </p>

      <h2>יצירת קשר</h2>
      <p>
        שאלות על התנאים: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>

      <section className="legal-page__english">
        <h2>English summary</h2>
        <p>
          CycleWays provides route information, planning tools, and ride
          guidance AS IS. Cycling is inherently risky: field conditions change,
          and posted signs, traffic law, and actual trail conditions always
          take precedence over app guidance. You ride at your own
          responsibility. Content is owned by CycleWays; map data by Mapbox and
          OpenStreetMap contributors (ODbL). Personal, non-commercial use only.
          Israeli law applies. Contact: {SUPPORT_EMAIL}.
        </p>
      </section>
    </LegalPage>
  );
}
