import React from "react";

function ContentSections({ onFocusSegment }) {
  const focusSegment = (segmentName) => {
    onFocusSegment?.(segmentName);
    document.querySelector(".map-container")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  return (
    <>
      <main>
        <section className="content-section" id="trails">
          <header>
            <h1 className="section-title">שבילים ומסלולים</h1>
          </header>
          <div className="section-content">
            <p>
              הגליל העליון והגולן הם גן עדן לרוכבי אופניים, והמפה הזו מרכזת
              עבורכם את המסלולים והשבילים הכי יפים ונוחים באזור. תוכלו להשתמש
              בה כדי להכיר את הרשת הענפה של השבילים, לתכנן את הרכיבה הבאה
              שלכם, או פשוט לקבל השראה.
            </p>
            <p>
              במפה תמצאו שילוב של דרכים חקלאיות, שבילי טיול שמתאימים גם
              לאופניים ושבילי אופניים ייעודיים. שבילים שנסללו או הותאמו במיוחד
              לאופניים מסומנים על המפה בכחול כהה.
            </p>

            <div className="update-box">
              <h3>עדכון חשוב (אוגוסט 2025)</h3>
              <p>
                בעקבות המצב הביטחוני, ייתכנו שבילים ושטחים שנסגרו למעבר על
                ידי הצבא או חקלאים. אנחנו משתדלים לעקוב אחרי השינויים ולעדכן
                את המפה באופן שוטף כדי שתהיה הכי מדויקת שאפשר.
              </p>
            </div>

            <h2>איך בחרנו מה להכניס למפה?</h2>
            <ul>
              <li>
                <strong>מסלולי אופניים יעודיים:</strong> שבילים שנסללו
                לאופניים או דרכים סלולות עם מעט תנועה, מסומנים בכחול כהה.
              </li>
              <li>
                <strong>שבילים:</strong> שבילי טיול ודרכים חקלאיות פתוחות
                שנוחים לרכיבה ברוב ימות השנה, מסומנים בירוק.
              </li>
              <li>
                <strong>כבישים:</strong> כבישים שמחברים בין קטעי שטח ומסומנים
                באפור. כמו תמיד, רכבו בזהירות יתרה כשאתם על הכביש.
              </li>
            </ul>

            <h2>כמה כללי ברזל לרכיבה בגליל</h2>
            <ul>
              <li>שמרו על הטבע נקי. מה שהבאתם איתכם, חוזר איתכם.</li>
              <li>
                עוברים בשטח חקלאי? אתם אורחים. היצמדו לשביל ותנו כבוד
                לחקלאים שעובדים בשטח.
              </li>
              <li>
                רכבו בזהירות ושימו לב לאזהרות שמופיעות לגבי קטעים ספציפיים
                במפה.
              </li>
            </ul>
          </div>
        </section>

        <section className="content-section" id="reccomendations">
          <header>
            <h1 className="section-title">המומלצים שלנו</h1>
          </header>
          <div className="section-content">
            <h2>קטעים מומלצים לרכיבה</h2>
            <p>
              כל השבילים על המפה יפים, אבל יש כמה קטעים יפים במיוחד ומומלצים.
            </p>
            <ul>
              <li>
                <RecommendationButton
                  label="בניאס שדה נחמיה"
                  onClick={() => focusSegment("בניאס שדה נחמיה")}
                />
                : אחד המסלולים היפים בארץ, מוצל ברובו ועמוס בפינות מנוחה ליד
                הנחל.
              </li>
              <li>
                <RecommendationButton
                  label="שדות עמיר ירדן"
                  onClick={() => focusSegment("שדות עמיר ירדן")}
                />
                : שביל חקלאי עם נוף לגולן ולהר החרמון, מומלץ במיוחד בחורף.
              </li>
              <li>
                <RecommendationButton
                  label="ציר הנפט"
                  onClick={() => focusSegment("ציר הנפט")}
                />
                : דרך נוחה יחסית לעלות לרמת הגולן באופניים, עם תנועה מועטה
                ונוף פתוח.
              </li>
              <li>
                <RecommendationButton
                  label="נחל דישון תחתון"
                  onClick={() => focusSegment("נחל דישון תחתון")}
                />
                : עליה מתונה ומהנה מאיילת השחר עד קיבוץ דישון.
              </li>
            </ul>

            <h2>מסלולים שלמים מומלצים</h2>
            <p>
              רשימת המסלולים המומלצים תמשיך להתרחב ככל שהמפה והמידע בשטח
              יתעדכנו.
            </p>
          </div>
        </section>

        <section className="content-section" id="contact">
          <header>
            <h1 className="section-title">איך אפשר לעזור</h1>
          </header>
          <div className="section-content">
            <h2>עזרו לנו לשמור על המפה עדכנית</h2>
            <p>
              המציאות בשטח דינמית, והדיווח שלכם עוזר לכל קהילת הרוכבים.
              במיוחד נשמח אם תעדכנו אותנו על שערים, גדרות, שבילים לא עבירים
              או שבילים חדשים.
            </p>
            <p>
              אפשר ליצור איתנו קשר דרך{" "}
              <strong>
                <a
                  href="https://forms.gle/k1k432YKW1Tw16TE7"
                  target="_blank"
                  rel="noreferrer"
                >
                  טופס המשוב שלנו
                </a>
              </strong>
              .
            </p>
            <p className="about-code">
              אפליקציית תכנון רכיבה פתוחה וזמינה ב-
              <a
                href="https://github.com/ohad7/isravelo"
                target="_blank"
                rel="noreferrer"
              >
                GitHub
              </a>
              .
            </p>
          </div>
        </section>
      </main>

      <footer>
        <div className="footer-content">
          <p>&copy; 2025 CycleWays.app - מפת שבילי אופניים.</p>
          <p>פותח לקהילת רוכבי האופניים בישראל</p>
        </div>
      </footer>
    </>
  );
}

function RecommendationButton({ label, onClick }) {
  return (
    <button className="react-recommendation-link" type="button" onClick={onClick}>
      {label}
    </button>
  );
}

export default ContentSections;
