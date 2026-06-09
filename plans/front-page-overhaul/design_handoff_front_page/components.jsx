/* ===== Cycleways — shared components (exported to window) ===== */
const { useState } = React;

/* ---------- tiny icon set (simple, on-brand) ---------- */
function Icon({ name, size = 22, stroke = 1.8, color = "currentColor" }) {
  const p = {
    water:   <path d="M12 3c3 4 5 6.5 5 9a5 5 0 1 1-10 0c0-2.5 2-5 5-9z"/>,
    tree:    <g><path d="M12 21v-5"/><path d="M12 16c-3 0-5-2-5-4 0-1 .5-2 1.4-2.6C8 7.6 8.2 5 12 4c3.8 1 4 3.6 3.6 5.4C16.5 10 17 11 17 12c0 2-2 4-5 4z"/></g>,
    view:    <g><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.5"/></g>,
    historic:<g><path d="M4 9h16"/><path d="M5 9v8M9 9v8M15 9v8M19 9v8"/><path d="M3 20h18"/><path d="M12 3 5 6.5h14L12 3z"/></g>,
    coffee:  <g><path d="M5 8h11v4a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V8z"/><path d="M16 9h2a2 2 0 0 1 0 4h-2"/><path d="M8 3v2M11 3v2"/></g>,
    gate:    <g><path d="M3 21V6l9-3 9 3v15"/><path d="M3 14h18M9 21V9M15 21V9"/></g>,
    bridge:  <g><path d="M3 9c4 0 4 3 9 3s5-3 9-3"/><path d="M3 9v8M21 9v8M9 12v5M15 12v5"/></g>,
    flag:    <g><path d="M5 21V4M5 4h11l-2 3 2 3H5"/></g>,
    pin:     <g><path d="M12 21s7-6.4 7-11a7 7 0 1 0-14 0c0 4.6 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/></g>,
    edit:    <path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3z"/>,
    download:<g><path d="M12 3v12M7 11l5 5 5-5"/><path d="M5 20h14"/></g>,
    save:    <g><path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 14h8"/></g>,
    play:    <path d="M8 5v14l11-7z"/>,
    pause:   <g><path d="M8 5v14M16 5v14"/></g>,
    trash:   <g><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></g>,
    undo:    <path d="M9 7 4 12l5 5M4 12h11a5 5 0 0 1 0 10h-1"/>,
    redo:    <path d="m15 7 5 5-5 5M20 12H9a5 5 0 0 0 0 10h1"/>,
    search:  <g><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></g>,
    route:   <g><circle cx="6" cy="19" r="2.4"/><circle cx="18" cy="6" r="2.4"/><path d="M8 18h6a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6"/></g>,
    plus:    <g><path d="M12 5v14M5 12h14"/></g>,
    chev:    <path d="m10 6 6 6-6 6"/>,
  }[name] || <circle cx="12" cy="12" r="8"/>;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">{p}</svg>
  );
}

/* category → icon + color */
const CAT = {
  water:    { ic:"water",    label:"מים",      c:"#2b7fb5" },
  nature:   { ic:"tree",     label:"טבע",      c:"#2f9e44" },
  view:     { ic:"view",     label:"תצפית",    c:"#b5742e" },
  historic: { ic:"historic", label:"היסטוריה", c:"#9a6b3a" },
  food:     { ic:"coffee",   label:"כיבוד",    c:"#c2410c" },
  gate:     { ic:"gate",     label:"שער",      c:"#7c6f57" },
  bridge:   { ic:"bridge",   label:"גשר",      c:"#2b7fb5" },
};

/* ---------- header ---------- */
function TopNav() {
  const links = ["מדריך", "מצא מסלול", "צרו קשר", "על המפה", "מסלולים", "מפה"];
  return (
    <header className="cw-header">
      <nav className="cw-nav">
        {links.map((l, i) => (
          <a key={l} href="#" className={l === "מפה" ? "active" : (l === "מצא מסלול" ? "nav-cta" : "")}>{l}</a>
        ))}
      </nav>
      <div className="cw-title">מפת שבילי אופניים — גליל עליון וגולן</div>
    </header>
  );
}

/* ---------- map backdrop ---------- */
function MapBackdrop({ img, children, search, callout, legendLeft = true, showTools = true, routeOverlay }) {
  return (
    <div className="cw-map">
      <img className="map-img" src={img} alt="" />
      <div className="map-fade" />
      {routeOverlay}
      <div className="map-legend" style={legendLeft ? { left: 14, right: "auto" } : { right: 14, left: "auto" }}>
        <h5>סוגי דרכים</h5>
        <div className="lg-row"><span className="lg-line" style={{ borderColor: "#3fae9f" }} />שביל סלול</div>
        <div className="lg-row"><span className="lg-line" style={{ borderColor: "#b08355" }} />שביל עפר</div>
        <div className="lg-row"><span className="lg-line" style={{ borderColor: "#8a93a3" }} />כביש</div>
      </div>
      {showTools && (
        <div className="map-tools">
          <div className="map-tool"><Icon name="undo" size={18} /></div>
          <div className="map-tool"><Icon name="redo" size={18} /></div>
          <div className="map-tool" style={{ marginTop: 4 }}><Icon name="trash" size={18} /></div>
        </div>
      )}
      {search && (
        <div className="map-search">
          <input placeholder="יישוב/עיר, לדוגמא: דפנה" />
          <button><Icon name="search" size={17} color="#fff" /></button>
        </div>
      )}
      {callout}
      {children}
    </div>
  );
}

/* ---------- elevation graph (SVG) ---------- */
const ELEV_PTS = [18,20,24,30,38,52,60,55,48,40,46,58,72,80,86,78,66,58,64,76,88,92,84,72,64,70];
function ElevationGraph({ height = 116, showAxis = true, showLegend = true, dist = "11.7", gain = "465", loss = "11" }) {
  const W = 1000, H = 100, pad = 6;
  const max = 100, min = 0;
  const pts = ELEV_PTS;
  const stepX = (W) / (pts.length - 1);
  const y = v => H - pad - ((v - min) / (max - min)) * (H - pad * 2);
  let d = `M0,${y(pts[0])}`;
  pts.forEach((v, i) => { if (i) d += ` L${(i * stepX).toFixed(1)},${y(v).toFixed(1)}`; });
  const area = `${d} L${W},${H} L0,${H} Z`;
  // difficulty bands along bottom
  const bands = ["#2f9e44","#2f9e44","#f2c037","#f2c037","#f08c00","#2f9e44","#2f9e44","#f2c037","#f08c00","#e03131","#f2c037","#2f9e44"];
  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 7 }}>
        <div className="dlabel" style={{ flex: "0 0 auto" }}>פרופיל גובה</div>
        <div className="row gap10" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-2)" }}>
          <span>↑ {gain} מ׳</span><span>↓ {loss} מ׳</span><span className="rc-dist" style={{ color: "var(--text)" }}>{dist} ק״מ</span>
        </div>
      </div>
      <div style={{ position: "relative", border: "1px solid var(--border-soft)", borderRadius: 12, overflow: "hidden", background: "#fff" }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={height} preserveAspectRatio="none" style={{ display: "block" }}>
          <defs>
            <linearGradient id="elevg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#9bbf6e" stopOpacity="0.85" />
              <stop offset="1" stopColor="#cfe0b0" stopOpacity="0.35" />
            </linearGradient>
          </defs>
          {[25,50,75].map(g => <line key={g} x1="0" y1={H*g/100} x2={W} y2={H*g/100} stroke="#eef0e8" strokeWidth="1" />)}
          <path d={area} fill="url(#elevg)" />
          <path d={d} fill="none" stroke="#5e8c43" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
        <div style={{ display: "flex", height: 6 }}>
          {bands.map((c, i) => <div key={i} style={{ flex: 1, background: c, opacity: .85 }} />)}
        </div>
        {showAxis && (
          <div className="row" style={{ justifyContent: "space-between", padding: "4px 9px", fontSize: 10.5, color: "var(--muted)", fontWeight: 600 }}>
            <span>0 ק״מ</span><span>{dist} ק״מ</span>
          </div>
        )}
      </div>
      {showLegend && (
        <div className="elegend" style={{ marginTop: 8 }}>
          <span><i style={{ background: "var(--d-down)" }} />ירידה</span>
          <span><i style={{ background: "var(--d-easy)" }} />קל</span>
          <span><i style={{ background: "var(--d-mod)" }} />יציב</span>
          <span><i style={{ background: "var(--d-firm)" }} />קשיח</span>
          <span><i style={{ background: "var(--d-hard)" }} />קשה</span>
        </div>
      )}
    </div>
  );
}

/* ---------- recommended route data ---------- */
const RECS = [
  { title:"סובב בית הלל", desc:"מסלול קצר ונעים מסביב לבית הלל, בלב הגליל העליון", dist:"6.5", lvl:"קל", via:"בית הלל · שדה נחמיה", badge:"מומלץ במיוחד", tags:["סלול","משפחתי"], img:"assets/map-discover.png" },
  { title:"סובב דפנה", desc:"רכיבה סביב נחל דן וקיבוץ דפנה", dist:"7.0", lvl:"קל", via:"דפנה · הגושרים", badge:"מומלץ במיוחד", tags:["קל","סלול/שטח"], img:"assets/map-building.png" },
  { title:"בניאס וגן הצפון", desc:"מסלול שעובר בשבילי האופניים היפים ביותר בארץ", dist:"14.8", lvl:"בינוני", via:"הגושרים · בית הלל", badge:"מסלול נופי", tags:["נוף","סלול/שטח"], img:"assets/map-discover.png" },
];

/* ---------- POI data (auto-detected along built route) ---------- */
const POIS = [
  { cat:"water",    title:"מעיין עין דן",        desc:"מי מעיין צוננים, נקודת עצירה מצוינת ברבע הראשון", at:"ק״מ 2.4" },
  { cat:"historic", title:"טחנת קמח עתיקה",       desc:"טחנת מים משוחזרת מהמאה ה‑19 על גדת הנחל", at:"ק״מ 4.1" },
  { cat:"view",     title:"תצפית עמק החולה",      desc:"מבט פתוח אל אגמון החולה ושדות הבקעה", at:"ק״מ 6.8" },
  { cat:"food",     title:"בית קפה שמיר",         desc:"פינת רענון עם מאפים וקפה לצד השביל", at:"ק״מ 8.3" },
  { cat:"gate",     title:"שער חקלאי",            desc:"שער שנסגר לעיתים — אפשר לעקוף בהליכה ליד הנחל", at:"ק״מ 9.6" },
];

Object.assign(window, { Icon, CAT, TopNav, MapBackdrop, ElevationGraph, RECS, POIS, useState });
