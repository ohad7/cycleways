/* ===== Cycleways — panel content blocks (exported to window) ===== */
const { useState: useS } = React;

/* ---- shared: discover search form ---- */
function SearchForm({ compact }) {
  const [lvl, setLvl] = useS("קל");
  const [surf, setSurf] = useS("סלול");
  const [len, setLen] = useS("10-25 ק״מ");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="field">
        <label>נקודת התחלה</label>
        <div className="inp"><Icon name="pin" size={17} color="#9aa08d" /><span className="ph">בחרו יישוב התחלה</span></div>
      </div>
      <div className="field">
        <label>עובר דרך</label>
        <div className="inp"><Icon name="route" size={17} color="#9aa08d" /><span className="ph">בחרו מקום לאורך המסלול</span></div>
      </div>
      <div className="field">
        <label>רמת קושי</label>
        <div className="row gap6 wrap">{["קל","בינוני","קשה"].map(o =>
          <button key={o} className={"pill" + (lvl === o ? " on" : "")} onClick={() => setLvl(o)}>{o}</button>)}</div>
      </div>
      <div className="field">
        <label>משטח</label>
        <div className="row gap6 wrap">{["סלול","שטח/סלול","שטח"].map(o =>
          <button key={o} className={"pill" + (surf === o ? " on" : "")} onClick={() => setSurf(o)}>{o}</button>)}</div>
      </div>
      <div className="field">
        <label>אורך</label>
        <div className="row gap6 wrap">{["עד 10 ק״מ","10-25 ק״מ","25 ק״מ ומעלה"].map(o =>
          <button key={o} className={"pill" + (len === o ? " on" : "")} onClick={() => setLen(o)}>{o}</button>)}</div>
      </div>
      <button className="btn btn-primary" style={{ marginTop: 2 }}><Icon name="search" size={17} color="#fff" />חיפוש מסלולים</button>
    </div>
  );
}

/* ---- shared: recommended card ---- */
function RecCard({ r }) {
  return (
    <div className="reccard">
      <div className="thumb"><img src={r.img} alt="" /></div>
      <div className="rc-body">
        <div className="rc-top">
          <div className="rc-title">{r.title}</div>
          <span className="badge">{r.badge}</span>
        </div>
        <div className="rc-desc">{r.desc}</div>
        <div className="rc-meta">
          <span className="rc-dist">{r.dist} ק״מ</span>
          <span>•</span><span>{r.lvl}</span>
          <span>•</span><span>{r.via}</span>
        </div>
      </div>
    </div>
  );
}

/* ---- shared: build-your-own CTA ---- */
function ByoCta({ onBuild }) {
  return (
    <div className="byo">
      <h4>בנו מסלול משלכם</h4>
      <p>סמנו נקודות על המפה והמסלול ייבנה אוטומטית — עם פרופיל גובה ונקודות עניין בדרך.</p>
      <button className="byo-btn" onClick={onBuild}><Icon name="plus" size={16} color="var(--green-700)" />התחילו לתכנן</button>
    </div>
  );
}

/* ---- shared: route action buttons ---- */
function RouteActions({ stacked }) {
  return (
    <div className="row gap8" style={{ flexWrap: stacked ? "wrap" : "nowrap" }}>
      <button className="btn btn-primary" style={{ flex: 1 }}><Icon name="save" size={16} color="#fff" />שמירת מסלול</button>
      <button className="btn btn-ghost btn-sm"><Icon name="download" size={16} />GPX</button>
      <button className="btn btn-ghost btn-sm"><Icon name="play" size={15} />ניווט</button>
    </div>
  );
}

/* ---- shared: stat strip ---- */
function StatStrip({ cols }) {
  const data = cols || [
    { k:"אורך", v:"11.7", u:"ק״מ" }, { k:"טיפוס", v:"465", u:"מ׳" },
    { k:"ירידה", v:"11", u:"מ׳" }, { k:"משטח", v:"שטח", u:" " }, { k:"קושי", v:"בינוני", u:" " },
  ];
  return (
    <div className="statstrip" style={{ gridTemplateColumns: `repeat(${data.length},1fr)` }}>
      {data.map((c, i) => (
        <div className="cell" key={i}><div className="ck">{c.k}</div><div className="cv">{c.v}</div><div className="cu">{c.u}</div></div>
      ))}
    </div>
  );
}

/* ---- shared: POI card ---- */
function PoiCard({ p, idx, withImg }) {
  const cat = CAT[p.cat];
  return (
    <div className="poicard">
      <div className="num">{idx}</div>
      <div className="pic" style={{ color: cat.c }}><Icon name={cat.ic} size={22} color={cat.c} /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="p-k">{cat.label}</div>
        <div className="p-t">{p.title}</div>
        <div className="p-d">{p.desc}</div>
        <div className="p-at">{p.at}</div>
      </div>
    </div>
  );
}

Object.assign(window, { SearchForm, RecCard, ByoCta, RouteActions, StatStrip, PoiCard });
