import React from "react";
import FeaturedRoute from "../components/featured/FeaturedRoute.jsx";

export default function SovevBeitHillel() {
  return (
    <FeaturedRoute
      slug="sovev-beit-hillel"
      layout="video-first"
      desktopMap="manual"
    >
      <section className="sbh-playback" aria-label="סרטון ומפת המסלול">
        <div className="sbh-video-stage">
          <FeaturedRoute.Video title="" className="sbh-video" />
          <FeaturedRoute.Map className="sbh-mobile-map" />
        </div>

        <aside className="sbh-side-rail" aria-label="מפה ונקודות בדרך">
          <div className="sbh-side-map-wrap">
            <div className="sbh-side-heading">
              <span>מיקום במסלול</span>
              <strong>מפה חיה</strong>
            </div>
            <FeaturedRoute.Map
              variant="desktop"
              className="sbh-side-map"
              allowFullscreen
              routeFitPadding={28}
            />
          </div>

          <FeaturedRoute.POIGallery />
        </aside>
      </section>

      <section className="sbh-route-notes">
        <div>
          <h2>על המסלול</h2>
          <p>
            הסובב סביב בית הלל הוא טעימה מהיופי הצנוע של הגליל העליון: דרכים
            חקלאיות נוחות, מבטים פתוחים אל החרמון וקרבה לנחלים של עמק החולה.
            המסלול קצר, נוח, ומתאים לרכיבה משפחתית רגועה.
          </p>
        </div>
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
    </FeaturedRoute>
  );
}
