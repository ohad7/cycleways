import React from "react";
import LegalPage from "./legal/LegalPage.jsx";
import {
  FEEDBACK_FORM_URL,
  SITE_OPERATOR_DESCRIPTION,
  SUPPORT_EMAIL,
} from "@cycleways/core/config/appLinks.js";

export default function PrivacyPage() {
  return (
    <LegalPage title="מדיניות פרטיות" updated="13 ביולי 2026">
      <h2>מי מפעיל את השירות</h2>
      <p>
        {SITE_OPERATOR_DESCRIPTION}, ללא חברה או עמותה נפרדת. המדיניות חלה על
        האתר www.cycleways.app ועל אפליקציית CycleWays. לפניות פרטיות אפשר
        לכתוב אל <a href={"mailto:" + SUPPORT_EMAIL}>{SUPPORT_EMAIL}</a>.
      </p>

      <h2>Google Analytics באתר</h2>
      <p>
        אתר הווב משתמש ב־Google Analytics 4 למדידה מצרפית של שימוש באתר.
        הכלי נטען אוטומטית באתר הייצור, ללא חלון הסכמה באתר, ועשוי להשתמש
        בעוגיות או במזהים דומים. Google מקבלת מידע טכני כגון כתובת IP, סוג
        מכשיר ודפדפן, זמן ביקור, נתיב העמוד ואירועי שימוש מצרפיים, בהתאם
        למדיניות שלה. קוד האתר מבקש להשבית Google Signals, התאמה אישית של
        פרסום ושיווק מחדש; יש לאמת בנפרד שגם הגדרות נכס GA4 תואמות לכך.
      </p>
      <p>
        הקוד מוגדר לשלוח רק את מקור האתר ונתיב העמוד, בלי מחרוזת שאילתה או
        מקטע URL. בפרט, מסלול המקודד בפרמטר <code>route</code> אינו נשלח
        כחלק מכתובת העמוד. אירועים מותאמים אינם שולחים טקסט חיפוש, קואורדינטות
        מדויקות, מיקום מכשיר, גאומטריית מסלול, שם, דוא״ל או תוכן פנייה.
      </p>
      <p>
        אפשר לחסום Analytics בהגדרות הדפדפן או באמצעות{" "}
        <a href="https://tools.google.com/dlpage/gaoptout" target="_blank" rel="noreferrer">
          תוסף ההשבתה של Google
        </a>. הגישה לחשבון מוגבלת, והכוונה היא להשתמש בתקופת השמירה המעשית
        הקצרה ביותר. המשך שימוש באתר כפוף למדיניות זו; משפט זה אינו מחליף
        דרישת הסכמה ככל שהדין מחייב אותה.
      </p>

      <h2>מידע במכשיר ומיקום</h2>
      <p>
        אין חשבונות משתמש ואין שרת יישומי של CycleWays השומר מסלולים אישיים.
        טיוטות, מסלולים אחרונים, העדפות ומנגנוני התאוששות נשמרים באחסון
        הדפדפן או המכשיר. באפליקציה, מיקום משמש להצגה על המפה ולניווט ומעובד
        במכשיר; הוא אינו נשלח ל־CycleWays. אפשר לבטל הרשאות ולמחוק אחסון מקומי
        דרך הגדרות המכשיר או הדפדפן.
      </p>

      <h2>ספקים חיצוניים</h2>
      <ul>
        <li><strong>Mapbox</strong> מספקת מפה ואריחים ומקבלת בקשות טכניות, כתובת IP ואזור מפה מבוקש.</li>
        <li><strong>YouTube/Google</strong> עשויה לקבל בקשות כאשר עמוד מסלול וידאו טוען את ממשק הנגן או תמונת התצוגה, גם לפני הפעלה.</li>
        <li><strong>GitHub Pages</strong> מארחת את האתר ועשויה לשמור רישומי גישה טכניים.</li>
        <li><strong>Google Fonts</strong> מספקת את גופן האתר ומקבלת בקשות רשת טכניות.</li>
      </ul>

      <h2>טופס משוב</h2>
      <p>
        שליחת <a href={FEEDBACK_FORM_URL} target="_blank" rel="noreferrer">טופס המשוב</a> היא
        מרצון. Google מספקת את הטופס והאחסון. כתובת דוא״ל, שם אם נמסר ותוכן
        הפנייה משמשים לטיפול בתמיכה ובמשוב על המפה והמסלולים. ללא כתובת דוא״ל
        ותוכן פנייה ייתכן שלא נוכל לטפל בפנייה או להשיב. פרטים מזהים יימחקו או
        יעברו אנונימיזציה לא יאוחר מ־12 חודשים לאחר סיום הטיפול, בעוד שעובדת
        מפה שאינה אישית עשויה להישמר.
      </p>

      <h2>עיון, תיקון ופנייה</h2>
      <p>
        לבקשה לעיין במידע אישי שנשמר בעקבות פנייה, לתקנו או למחוק אותו, כתבו
        אל <a href={"mailto:" + SUPPORT_EMAIL}>{SUPPORT_EMAIL}</a>. יש לציין
        מספיק פרטים לזיהוי הפנייה, בלי לשלוח מידע רגיש שאינו נחוץ.
      </p>

      <h2>שינויים</h2>
      <p>נעדכן עמוד זה ואת תאריך העדכון לפני שינוי מהותי באופן האיסוף או השימוש במידע.</p>

      <section className="legal-page__english">
        <h2>English summary</h2>
        <p>
          CycleWays is a privately owned project operated by one person, with
          no separate legal entity. The production website uses GA4 for
          aggregate measurement without an on-site consent prompt. Page views
          exclude query strings, fragments and encoded routes; custom events
          exclude search text, precise coordinates, device location, route
          geometry and contact content. Mapbox, YouTube, GitHub Pages, Google
          Fonts and Google Forms receive the technical or submitted data needed
          for their services. Feedback is voluntary. Contact and data-rights
          requests: {SUPPORT_EMAIL}.
        </p>
      </section>
    </LegalPage>
  );
}
