import React from "react";
import FeaturedRoute from "../components/featured/FeaturedRoute.jsx";

export default function SovevBeitHillel() {
  return (
    <FeaturedRoute
      slug="sovev-beit-hillel"
      layout="video-first"
      desktopMap="manual"
      kicker="גליל עליון · רכיבה רגועה"
    >
      <section className="sbh-playback" aria-label="סרטון, תיאור ומפת המסלול">
        <div className="sbh-video-stage">
          <div className="sbh-video-shell">
            <FeaturedRoute.Video title="" className="sbh-video" />
            <FeaturedRoute.POIVideoPreview />
          </div>
          <FeaturedRoute.Map className="sbh-mobile-map" />
        </div>

        <aside className="sbh-side-rail" aria-label="תיאור ומפת המסלול">
          <section className="sbh-route-panel" aria-label="תקציר המסלול">
            <span className="sbh-route-panel-kicker">רכיבה רגועה בגליל העליון</span>
            <h2>מה מחכה בדרך</h2>
            <p>
              לולאה קצרה ונוחה סביב בית הלל: דרכים חקלאיות שטוחות, חופי רחצה
              על נחל שניר ומבטים אל החרמון — רכיבה משפחתית רגועה בלב הגליל העליון.
            </p>
          </section>

          <div className="sbh-side-map-wrap">
            <div className="sbh-side-heading">
              <span>מרחק מההתחלה</span>
              <FeaturedRoute.ProgressDistance />
            </div>
            <FeaturedRoute.Map
              variant="desktop"
              className="sbh-side-map"
              allowFullscreen
              autoResetAfterInteraction
              routeFitPadding={22}
            />
          </div>
        </aside>
      </section>

      <section id="sbh-about" className="sbh-route-about" aria-label="על המסלול">
        <div className="sbh-route-about-heading">
          <span>על המסלול</span>
          <h2>לולאה רגועה בלב הגליל העליון</h2>
        </div>
        <div className="sbh-route-about-body">
          <p>
            סובב בית הלל הוא לולאה קצרה ונינוחה בלב הגליל העליון, מהסוג שמתאים
            כמעט לכולם — משפחות עם ילדים, רוכבים מתחילים, או כל מי שמחפש רכיבה
            יפה בלי מאמץ טכני. הדרך עוברת ברובה על שבילים חקלאיים שטוחים ונוחים,
            בין שדות פתוחים ומטעים, עם מבטים אל הרי החרמון והגולן באופק.
          </p>
          <p>
            לאורכו מלווה אתכם נחל שניר (החצבני) על שלל חופי הרחצה שלו — נקודות
            כניסה מסומנות בשערים ממוספרים, מים קרירים וזורמים גם בלב הקיץ, וגדות
            מוצלות תחת עצי דולב, אקליפטוס ותות. קל לשלב את הרכיבה עם עצירת רחצה,
            פיקניק על הגדה, או סתם רגע של שקט ליד המים.
          </p>
          <p>
            הנוף מתחלף עם העונה: בחורף ובאביב הכול ירוק ופורח, ובקיץ עדיף לצאת
            בבוקר המוקדם או לקראת שקיעה, כשהאור רך והחום נסוג. בדרך אפשר לעצור
            לקפה ולמאפה באחד מבתי הקפה שבכפר, ולסיים את הרכיבה רעננים ומרוצים.
          </p>
        </div>
      </section>

      <FeaturedRoute.POIStories />
    </FeaturedRoute>
  );
}
