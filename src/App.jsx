import { useCallback, useEffect } from 'react';
import {
  initializeApp,
  focusOnSegment,
  scrollToSection,
  returnToStartingPosition,
} from './mapApp.js';
import '../styles.css';
import '../tutorial.css';

function App() {
  useEffect(() => {
    initializeApp();
  }, []);

  const handleNavClick = useCallback(
    (sectionId) => (event) => {
      event.preventDefault();
      scrollToSection(sectionId);
    },
    [],
  );

  const handleSegmentFocus = useCallback(
    (segmentName) => (event) => {
      event.preventDefault();
      focusOnSegment(segmentName);
    },
    [],
  );

  const handleTitleClick = useCallback(() => {
    returnToStartingPosition();
  }, []);

  const handleTitleKeyDown = useCallback((event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      returnToStartingPosition();
    }
  }, []);

  const searchErrorStyle = {
    color: 'red',
    fontSize: '12px',
    marginTop: '5px',
    display: 'none',
    position: 'absolute',
    top: '70px',
    left: '20px',
    zIndex: 1001,
    background: 'white',
    padding: '5px',
    borderRadius: '4px',
  };

  return (
    <>
      <header className="header">
        <div className="logo-section">
          <h1
            className="site-title"
            role="button"
            tabIndex={0}
            onClick={handleTitleClick}
            onKeyDown={handleTitleKeyDown}
          >
            מפת שבילי אופניים - גליל עליון וגולן
          </h1>
        </div>
        <button className="mobile-menu-btn" id="mobile-menu-btn" type="button">
          <ion-icon name="menu-outline"></ion-icon>
        </button>
        <nav className="nav-links" id="nav-links">
          <a className="nav-link" href="#trails" onClick={handleNavClick('trails')}>
            שבילים
          </a>
          <a
            className="nav-link"
            href="#reccomendations"
            onClick={handleNavClick('reccomendations')}
          >
            המלצות
          </a>
          <a className="nav-link" href="#contact" onClick={handleNavClick('contact')}>
            צרו קשר
          </a>
          <a id="help-tutorial-btn" className="nav-link help-tutorial-btn" title="הדרכה אינטראקטיבית">
            מדריך
          </a>
        </nav>
      </header>

      <div className="main-container">
        <div id="error-message"></div>

        <div className="container">
          <div className="map-container">
            <div className="search-container">
              <div className="search-input-group">
                <button id="search-btn" type="button">
                  <ion-icon name="search-outline"></ion-icon>
                </button>
                <input type="text" id="location-search" placeholder="ישוב/עיר, לדוגמא: דפנה" />
              </div>
              <div className="top-controls">
                <div className="control-buttons">
                  <button id="undo-btn" className="control-btn" disabled title="ביטול (Ctrl+Z)" type="button">
                    <ion-icon name="arrow-undo-outline"></ion-icon>
                  </button>
                  <button id="redo-btn" className="control-btn" disabled title="חזרה (Ctrl+Shift+Z)" type="button">
                    <ion-icon name="arrow-redo-outline"></ion-icon>
                  </button>
                  <button id="reset-btn" className="control-btn" disabled title="איפוס מסלול" type="button">
                    <ion-icon name="trash-outline"></ion-icon>
                  </button>
                  <button
                    id="download-gpx"
                    className="control-btn gpx-download-button"
                    disabled
                    title="סיכום, GPX, ושיתוף המסלול"
                    type="button"
                  >
                    סיכום
                  </button>
                </div>
              </div>
            </div>

            <div className="legend-container">
              <div className="legend-box open" id="legend-box">
                <div className="legend-title">סוגי דרכים</div>
                <div className="legend-item">
                  <div className="legend-color paved-trail"></div>
                  <div className="legend-label">שביל סלול</div>
                </div>
                <div className="legend-item">
                  <div className="legend-color dirt-trail"></div>
                  <div className="legend-label">שביל עפר</div>
                </div>
                <div className="legend-item">
                  <div className="legend-color road"></div>
                  <div className="legend-label">כביש</div>
                </div>
              </div>
              <div className="route-warning issue-warning" id="route-warning" style={{ display: 'none' }}>
                ⚠️ מסלול שבור
              </div>
              <div className="segment-warning issue-warning" id="segment-warning" style={{ display: 'none' }}>
                ⚠️ אזהרות
              </div>
              <div className="individual-warnings-container" id="individual-warnings-container" style={{ display: 'none' }}>
              </div>
            </div>

            <div id="search-error" style={searchErrorStyle}></div>

            <div id="map"></div>

            <div className="route-description-panel empty" id="route-description-panel">
              <div id="route-description">לחץ על קטעי מפה כדי לבנות את המסלול שלך.</div>
            </div>

            <div className="segment-name-display" id="segment-name-display">
              No segment selected
            </div>
          </div>
        </div>

        <main>
          <section className="content-section" id="trails">
            <header>
              <h1 className="section-title">שבילים ומסלולים</h1>
            </header>
            <div className="section-content">
              <p>
                הגליל העליון והגולן הם גן עדן לרוכבי אופניים, והמפה הזו מרכזת עבורכם את המסלולים והשבילים הכי יפים ונוחים באזור. תוכלו להשתמש בה כדי להכיר את הרשת הענפה של השבילים, לתכנן את הרכיבה הבאה שלכם, או פשוט לקבל השראה.
              </p>
              <p>
                 נכון, יש כלים מעולים כמו <a href="https://www.strava.com" target="_blank" rel="noreferrer">Strava</a> ו-<a href="https://www.komoot.com" target="_blank" rel="noreferrer">Komoot</a>, אבל המטרה שלנו היא להציג גם את השבילים הנסתרים והדרכים החקלאיות שלא תמיד מופיעים שם, כדי לתת לכם את התמונה המלאה.
              </p>
              <p>
                במפה תמצאו שילוב של דרכים חקלאיות, שבילי טיול (שמתאימים גם לאופניים) ושבילי אופניים ייעודיים. כדי להקל עליכם, <strong>שבילים שנסללו או הותאמו במיוחד לאופניים מסומנים על המפה בכחול כהה.</strong>
              </p>

              <div className="update-box">
                <h3>עדכון חשוב (אוגוסט 2025)</h3>
                <p>
                    בעקבות המצב הביטחוני, ייתכנו שבילים ושטחים שנסגרו למעבר על ידי הצבא או חקלאים. אנחנו משתדלים לעקוב אחרי השינויים ולעדכן את המפה באופן שוטף כדי שתהיה הכי מדויקת שאפשר.
                </p>
              </div>

              <h2>איך בחרנו מה להכניס למפה?</h2>
              <ul>
                <li><strong>מסלולי אופניים יעודיים:</strong> שבילים שנסללו לאופניים או דרכים סלולות עם מעט תנועה, מסומנים בכחול כהה.</li>
                <li><strong>שבילים:</strong>התמקדנו בשבילי טיול ודרים חקלאיות פתוחות שנוחים לרכיבה ברוב ימות השנה, גם בחורף, מסומנים בירוק</li>
                <li><strong>כבישים:</strong> המפה כוללת רק כבישים שהכרחיים כדי לחבר בין קטעי שטח. בחרנו כאלו עם שוליים רחבים יחסית או תנועה דלילה, אבל כמו תמיד, רכבו בזהירות יתרה כשאתם על הכביש. קטעים אלה מסומנים באפור</li>
              </ul>

              <h2>כמה כללי ברזל לרכיבה בגליל</h2>
              <ul>
                <li><strong>שמרו על הטבע נקי.</strong> מה שהבאתם איתכם, חוזר איתכם.</li>
                <li><strong>עוברים בשטח חקלאי?</strong> אתם אורחים. היצמדו לשביל, אל תפגעו בגידולים ותנו כבוד לחקלאים שעובדים בשטח. בואו נשמור יחד על השטחים פתוחים לכולנו.</li>
                <li><strong>רכבו בזהירות,</strong> ברוב השנה השבילים אינם עמוסים, שימו לב לאזהרות שיש לגבי קטעים ספציפיים במפה </li>
              </ul>
              <p>
                המפה זמינה גם בפורמט גוגל מפות <a
                  target="_blank"
                  rel="noopener noreferrer"
                  href="https://www.google.com/maps/d/u/0/edit?mid=13DwSv6hvABgm8TYwovTqCWsOg5HBcIk&ll=33.164430856234475%2C35.590197252552954&z=12"
                >בקישור הזה</a>
              </p>
            </div>
          </section>

          <section className="content-section" id="reccomendations">
            <header>
              <h1 className="section-title">המומלצים שלנו</h1>
            </header>
            <div className="section-content">
              <h2>קטעים מומלצים לרכיבה</h2>
              <p>
                כל השבילים על המפה שלנו יפים, אבל יש כמה שבילים יפים במיוחד ומומלצים. להלן רשימה של השבילים היפים ביותר באיזור:
              </p>
              <ul>
                <li>
                  <a href="#" onClick={handleSegmentFocus('בניאס שדה נחמיה')}>
                    בניאס שדה נחמיה
                  </a>
                  <ul>
                    בקלות אחד המסלולים היפים בארץ אם לא היפה שבהם, מוצל ברובו ועמוס בפינות מנוחה נחמדות ליד הנחל. בקצה הצפוני השביל מתחבר לכביש לנבי יהודה ולשביל האופניים לכיוון דפנה, בקצה הדרומי השביל מסתיים במפגש הנחלים בניאס וחצבאני סמוך לשדה נחמיה, ומשם מתחבר למסלולים רבים.
                  </ul>
                  <ul>
                    אורך: כ 5 ק״מ משדה נחמיה ועד שאר ישוב, שטוח ברובו, מוצל ברובו
                  </ul>
                </li>
                <li>
                  <a href="#" onClick={handleSegmentFocus('שדות עמיר ירדן')}>
                    שדות עמיר ירדן
                  </a>
                  <ul>
                    בין הירדן לקיבוץ עמיר עובר שביל חקלאי עם נוף משגע לגולן ולהר החרמון, מומלץ במיוחד בחורף כשהכל ירוק והחרמון מושלג. הכניסה לקיבוץ עמיר מכיוון השדות פתוחה בשעות היום אך זה כמו הכל בארצנו נתון לשינוי וכפוף למציאות הבטחונית
                  </ul>
                  <ul>
                    אורך: כ 4 ק״מ מפארק גשר להבות עד קיבוץ עמיר, שטוח ברובו
                  </ul>
                </li>
                <li>
                  <a href="#" onClick={handleSegmentFocus('ציר הנפט')}>
                    ציר הנפט
                  </a>
                  <ul>
                    כביש העובר ממקורות הבניאס בצפון עד צומת רוויה בצפון רמת הגולן על בסיס ציר הנפט הישן, הכביש שופץ לפני כ 20 שנים והוא מאוד נוח לרכיבת אופניים, התנועה עליו מועטה מאוד, מה שהופך אותו לדרך אידיאלית לעלות לרמת הגולן באופניים בדרך נוחה יחסית. תוך כדי הרכיבה תוכלו להנות מתצפית לעמק החולה ומנופי רמת הגולן.
                  </ul>
                  <ul>
                    אורך: כ 15 ק״מ מהבניאס עד צומת רוויה, כ 430 מטר עליות
                  </ul>
                </li>
                <li>
                  <a href="#" onClick={handleSegmentFocus('שדות הגושרים')}>
                    שדות הגושרים
                  </a>
                  <ul>
                    כביש סלול העובר בין השדות של קיבוץ הגושרים, תחילתו במתחם גן הצפון וסופו בנקודה הסופית של קייאקי הגושרים. בעבר נסעו שם האוטובוסים של קיאקי הגושרים אבל מאז המלחמה והבצורת המקום נסגר זמנית, לרוכבי אופניים ניתן להנות מהנוף המקיף ומדרך נוחה לרכיבה. מכיוון גן הצפון הכניסה היא דרך שער הולכי רגל שלרוב פתוח, ובקצה הדרומי של הדרך יש גישה לטיילת מפגש הנחלים ושדה נחמיה.
                  </ul>
                  <ul>
                    אורך: כ 4 ק״מ מגן הצפון עד קייאקי הגושרים, שטוח ברובו
                  </ul>
                </li>
                <li>
                  <a href="#" onClick={handleSegmentFocus('נחל דישון תחתון')}>
                    נחל דישון תחתון
                  </a>
                  <ul>
                    עליה מתונה ומהנה מאיילת השחר עד קיבוץ דישון, שביל נעים עם נוף ייחודי ואפילו נקודת מים ליד בריכת אביב.
                  </ul>
                  <ul>
                    אורך: כ 9 ק״מ בשיפוע מתון, כ 400 מטר עליות
                  </ul>
                </li>
              </ul>

              <h2>מסלולים שלמים מומלצים</h2>
              <p>
                רשימת מסלולים שלמים מומלצים ברמות שונות, לחצו על הקישור כדי לראות את המסלול במפה
              </p>
              <ul>
                <li>
                  <a href="/?route=AQByAAcABAAFAFgAYABeAAoAeAAZAHIA">שדה נחמיה -&gt; בניאס -&gt; גן הצפון -&gt; שדה נחמיה</a>
                  <ul>
                    מסלול קצר ונוח, מומלץ במיוחד לחובבי רכיבה ראשונית, עם פינות מנוחה רבות
                  </ul>
                </li>
              </ul>
            </div>
          </section>

          <section className="content-section" id="contact">
            <header>
              <h1 className="section-title">איך אפשר לעזור</h1>
            </header>
            <div className="section-content">
              <h2>עזרו לנו לשמור על המפה עדכנית</h2>
              <p>
                  המטרה שלנו היא להפוך את הרכיבה בגליל לחוויה צפויה ומהנה, לא נעים להתקל בגדר או בשער סגור באמצע הדרך. המציאות בשטח דינמית, וכאן אתם נכנסים לתמונה! הדיווח שלכם עוזר לכל קהילת הרוכבים.
              </p>
              <p>
                  <strong>במיוחד נשמח אם תעדכנו אותנו על:</strong>
              </p>
              <ul>
                  <li>שערים או גדרות שחוסמים מעבר ולא מסומנים במפה.</li>
                  <li>שבילים שהפכו ללא עבירים (בגלל בוץ, צמחייה שגדלה, וכו').</li>
                  <li>שבילים חדשים או פנינות נסתרות שאתם חושבים שחייבים להיות כאן.</li>
              </ul>
              <p>
                  על כל נושא, קטן כגדול, אפשר ורצוי ליצור איתנו קשר דרך <strong><a href="https://forms.gle/k1k432YKW1Tw16TE7" target="_blank" rel="noreferrer">טופס המשוב שלנו</a></strong>. אנחנו קוראים הכל ומעדכנים בהתאם.
              </p>
              <p>רכיבה מהנה ובטוחה!</p>
              <p className="about-code">
                אפליקציית תכנון רכיבה פותחה בעזרת <a href="http://www.replit.com">Replit</a>, כל הקוד והמפה פתוחים וזמינים להורדה, ניתן לראות את הקוד <a href="https://github.com/ohad7/isravelo" target="_blank" rel="noreferrer">בקישור הזה</a>
              </p>
            </div>
          </section>
        </main>

        <footer>
          <div className="footer-content">
            <p>&copy; 2025 CycleWays.app - מפת שבילי אופניים. כל הזכויות שמורות.</p>
            <p>פותח עם ❤️ לקהילת רוכבי האופניים בישראל</p>
          </div>
        </footer>
      </div>
    </>
  );
}

export default App;
