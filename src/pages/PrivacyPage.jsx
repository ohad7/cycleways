import React from "react";
import LegalPage from "./legal/LegalPage.jsx";
import {
  FEEDBACK_FORM_URL,
  SUPPORT_EMAIL,
} from "@cycleways/core/config/appLinks.js";

export default function PrivacyPage() {
  return (
    <LegalPage title="מדיניות פרטיות" updated="5 ביולי 2026">
      <h2>מי אנחנו</h2>
      <p>
        CycleWays ("אנחנו") מפעילה את האתר www.cycleways.app ואת אפליקציית
        CycleWays לתכנון וניווט מסלולי רכיבה על אופניים. מדיניות זו מסבירה איזה
        מידע מעובד בעת השימוש באתר ובאפליקציה, והיכן.
      </p>

      <h2>העיקרון: המידע שלכם נשאר אצלכם</h2>
      <p>
        אין באתר ובאפליקציה חשבונות משתמש, ואין לנו שרתים שאוספים מידע אישי.
        מסלולים שתכננתם, טיוטות והעדפות נשמרים במכשיר שלכם בלבד, ואפשר למחוק
        אותם בכל רגע על ידי מחיקת נתוני האתר בדפדפן או הסרת האפליקציה.
      </p>

      <h2>מיקום</h2>
      <p>
        האפליקציה משתמשת במיקום המכשיר כדי להציג אתכם על המפה, למיין מסלולים
        לפי קרבה, ולהפעיל הנחיות ניווט קוליות — כולל כשהמסך נעול, אם בחרתם
        בכך. נתוני המיקום מעובדים במכשיר בלבד: הם אינם נשלחים אלינו ואינם
        נשמרים לאחר הרכיבה. אפשר לבטל את הרשאת המיקום בכל עת בהגדרות המכשיר;
        האפליקציה תמשיך לעבוד לתכנון מסלולים גם בלי מיקום.
      </p>

      <h2>ספקי צד שלישי</h2>
      <ul>
        <li>
          <strong>Mapbox</strong> — אריחי המפה נטענים משרתי Mapbox, שמקבלים
          בקשות טכניות סטנדרטיות (כגון כתובת IP ואזור המפה המבוקש) בהתאם
          למדיניות הפרטיות של Mapbox. איסוף הטלמטריה של Mapbox באפליקציה
          כבוי.
        </li>
        <li>
          <strong>YouTube</strong> — עמודי מסלול מסוימים כוללים סרטונים
          מוטמעים. בעת ניגון סרטון חלים תנאי השימוש ומדיניות הפרטיות של
          Google/YouTube.
        </li>
        <li>
          <strong>GitHub Pages</strong> — האתר מתארח ב-GitHub Pages, השומרת
          רישומי גישה טכניים סטנדרטיים.
        </li>
      </ul>

      <h2>שיתוף מסלולים</h2>
      <p>
        שיתוף מסלול או ייצוא קובץ GPX נעשה דרך מנגנון השיתוף של המכשיר, לפי
        בחירתכם בלבד, אל היעד שבחרתם.
      </p>

      <h2>אנליטיקה ודיווחי קריסה</h2>
      <p>
        האפליקציה והאתר אינם כוללים כלי אנליטיקה, פרסום או דיווחי קריסה של צד
        שלישי, ואיננו עוקבים אחריכם בין אפליקציות. אם אישרתם ל-Apple לשתף
        נתוני אבחון עם מפתחים, נקבל דוחות קריסה אנונימיים דרך App Store
        Connect.
      </p>

      <h2>ילדים</h2>
      <p>
        איננו אוספים ביודעין מידע אישי מאף אחד, ובכלל זה מילדים.
      </p>

      <h2>שינויים במדיניות</h2>
      <p>
        אם המדיניות תשתנה (למשל אם נוסיף כלי לדיווח קריסות), נעדכן עמוד זה ואת
        תאריך העדכון שבראשו לפני שהשינוי ייכנס לתוקף.
      </p>

      <h2>יצירת קשר</h2>
      <p>
        לשאלות פרטיות ולכל בקשה אחרת:{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> או{" "}
        <a href={FEEDBACK_FORM_URL} target="_blank" rel="noreferrer">
          טופס המשוב שלנו
        </a>
        .
      </p>

      <section className="legal-page__english">
        <h2>English summary</h2>
        <p>
          CycleWays (web and iOS app) has no user accounts and no first-party
          data collection: planned routes and preferences stay on your device.
          Device location powers on-map positioning, nearby sorting, and
          turn-by-turn guidance (including with a locked screen, if enabled);
          it is processed on-device only and never sent to us. Third parties:
          Mapbox serves map tiles (standard technical requests; SDK telemetry
          disabled), YouTube plays embedded route videos under Google's
          policies, and GitHub Pages hosts the website. No analytics, ads,
          tracking, or third-party crash reporting. Contact: {SUPPORT_EMAIL}.
        </p>
      </section>
    </LegalPage>
  );
}
