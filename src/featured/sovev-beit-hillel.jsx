import React from "react";
import FeaturedRoute from "../components/featured/FeaturedRoute.jsx";

export default function SovevBeitHillel() {
  return (
    <FeaturedRoute
      slug="sovev-beit-hillel"
      layout="video-first"
      desktopMap="manual"
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
          <section className="sbh-route-panel" aria-label="על המסלול">
            <span className="sbh-route-panel-kicker">רכיבה רגועה בגליל העליון</span>
            <h2>מה מחכה בדרך</h2>
            <p>
              הסובב סביב בית הלל הוא טעימה מהיופי הצנוע של הגליל העליון:
              דרכים חקלאיות נוחות, מבטים פתוחים אל החרמון וקרבה לנחלים של
              עמק החולה. המסלול קצר, נוח, ומתאים לרכיבה משפחתית רגועה.
            </p>
            <dl>
              <div>
                <dt>אופי רכיבה</dt>
                <dd>לולאה קצרה, שטוחה ברובה, ללא קטעים טכניים.</dd>
              </div>
              <div>
                <dt>מתי להגיע</dt>
                <dd>חורף ואביב יפים במיוחד; בקיץ עדיף בוקר מוקדם או שקיעה.</dd>
              </div>
              <div>
                <dt>עצירות</dt>
                <dd>צל ליד הנחל, שדות פתוחים, ואפשרות לקפה או אוכל בבית הלל.</dd>
              </div>
            </dl>
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

      <FeaturedRoute.POIStories />
    </FeaturedRoute>
  );
}
