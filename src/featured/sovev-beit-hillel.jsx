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
            <FeaturedRoute.Map
              className="sbh-mobile-map"
              autoResetAfterInteraction
              autoResetDelayMs={5000}
              routeFitPadding={12}
            />
          </div>
        </div>

        <aside className="sbh-side-rail" aria-label="תיאור ומפת המסלול">
          <section className="sbh-route-panel" aria-label="תקציר המסלול">
            <span className="sbh-route-panel-kicker">רכיבה רגועה בגליל העליון</span>
            <h2>מה מחכה בדרך</h2>
            <p>
              רכיבה קצרה ונעימה בגדר ההיקפית ובשביל האופניים של בית בית הלל: 
              חופי רחצה על נחל שניר, שדות חקלאיים, חוות סוסים קטנות 
              ונוף לחרמון ולהרי נפתלי. 
              <br></br><br></br>
              מתאים למשפחות: רוב המסלול עובר בדרכים שקטות או מופרדות ממכוניות
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
            סובב בית הלל הוא מסלול קצר ונעים בלב הגליל העליון, מהסוג שמתאים
            כמעט לכולם - משפחות עם ילדים, רוכבים מתחילים, או כל מי שמחפש רכיבה
            יפה בלי מאמץ טכני. הדרך עוברת ברובה על כביש המערכת של בית הלל ושביל האופניים
            שצמוד לנחל שניר
          </p>
          <p>
            בנחל שניר (החצבאני) תוכלו להנות מרכיבה נעימה, חלק ניכר מוצל ומתאים גם לקיץ. 
            הכניסות לחופים מסומנות בשערים ממוספרים, יש מים קרירים וזורמים גם בלב הקיץ, וגדות
            מוצלות תחת עצי דולב, אקליפטוס ותות. קל לשלב את הרכיבה עם עצירת רחצה,
            פיקניק על הגדה, או סתם רגע של שקט ליד המים.
          </p>
          <p>
            לקראת אמצע המסלול אפשר לעצור בקפה פקישטיק שהוא ממש על המסלול או 
            באחד מהמסעדות ובתי הקפה שמצויים בישוב (צ׳יז, תאי גארדן, לה קוסטיקה)
            יש גם חנות אופניים נהדרת, מפגש האופניים במרחק הליכה מרוב המסלול, במידה ונתקעתם
            עם פנצ׳ר 
          </p>
          <p>
            מקווים שתהנו!
          </p>
        </div>
      </section>

      <FeaturedRoute.POIStories />
    </FeaturedRoute>
  );
}
