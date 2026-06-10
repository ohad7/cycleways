/* ===== Cycleways — interactive route explorer for Option A (build state) ===== */
const { useRef: useRf, useEffect: useEf, useState: useStE } = React;

/* a believable loop drawn over the clean map (viewBox = image natural size) */
const ROUTE_D =
  "M 1044,612 C 1112,584 1192,598 1248,640 C 1304,680 1334,722 1322,778 " +
  "C 1311,824 1262,846 1200,842 C 1126,838 1058,834 1004,804 C 952,775 932,718 956,666 " +
  "C 972,628 1004,612 1044,612 Z";

/* 4 surface/road segments along the route */
const SEGS = [
  { a: 0.00, b: 0.30, label: "שביל עפר · שדה נחמיה", surf: "עפר", km: "3.5", climb: "+18", color: "#2f9e44" },
  { a: 0.30, b: 0.52, label: "כביש 977",              surf: "כביש", km: "2.6", climb: "+96", color: "#f2c037" },
  { a: 0.52, b: 0.76, label: "שביל סלול · שמיר",       surf: "סלול", km: "2.8", climb: "+210", color: "#f08c00" },
  { a: 0.76, b: 1.00, label: "עלייה לרכס",             surf: "עפר", km: "2.8", climb: "+141", color: "#e03131" },
];

/* POI pins anchored near the route (image-space coords) */
const PIN_POS = [
  { x: 1052, y: 616, cat: "water" },
  { x: 1252, y: 648, cat: "historic" },
  { x: 1320, y: 778, cat: "view" },
  { x: 1120, y: 842, cat: "food" },
  { x: 958,  y: 700, cat: "gate" },
];

function RouteOverlay({ frac, seg }) {
  const ref = useRf(null);
  const [L, setL] = useStE(0);
  useEf(() => { if (ref.current) setL(ref.current.getTotalLength()); }, []);
  let pos = null;
  if (ref.current && L) pos = ref.current.getPointAtLength(Math.max(0, Math.min(1, frac)) * L);
  const start = ref.current && L ? ref.current.getPointAtLength(0) : null;
  return (
    <svg viewBox="0 0 1450 880" preserveAspectRatio="xMidYMid slice"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
      <path d={ROUTE_D} fill="none" stroke="#fff" strokeWidth="8.5" strokeLinecap="round" strokeLinejoin="round" opacity=".55" />
      <path ref={ref} d={ROUTE_D} fill="none" stroke="#1c6fb0" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      {seg != null && L > 0 && (
        <path d={ROUTE_D} fill="none" stroke={SEGS[seg].color} strokeWidth="9" strokeLinecap="round"
          strokeDasharray={`${(SEGS[seg].b - SEGS[seg].a) * L} ${L}`} strokeDashoffset={`${-SEGS[seg].a * L}`} />
      )}
      {PIN_POS.map((p, i) => {
        const c = CAT[p.cat].c;
        return (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r="11" fill="#fff" stroke={c} strokeWidth="2.5" />
            <circle cx={p.x} cy={p.y} r="4.5" fill={c} />
          </g>
        );
      })}
      {start && <circle cx={start.x} cy={start.y} r="8" fill="#2f9e44" stroke="#fff" strokeWidth="3" />}
      {pos && (
        <g>
          <circle cx={pos.x} cy={pos.y} r="15" fill="#1c6fb0" opacity="0.18" />
          <circle cx={pos.x} cy={pos.y} r="9.5" fill="#fff" />
          <circle cx={pos.x} cy={pos.y} r="6" fill="#1c6fb0" />
        </g>
      )}
    </svg>
  );
}

/* interactive elevation graph = scrubber + segment inspector + transport */
function ElevationInteractive({ frac, setFrac, seg, setSeg, playing, setPlaying }) {
  const W = 1000, H = 100, pad = 6, total = 11.7;
  const pts = ELEV_PTS;
  const stepX = W / (pts.length - 1);
  const y = v => H - pad - (v / 100) * (H - pad * 2);
  let d = `M0,${y(pts[0])}`;
  pts.forEach((v, i) => { if (i) d += ` L${(i * stepX).toFixed(1)},${y(v).toFixed(1)}`; });
  const area = `${d} L${W},${H} L0,${H} Z`;

  // value at cursor
  const fp = frac * (pts.length - 1), i0 = Math.floor(fp), tt = fp - i0;
  const pv = pts[i0] + (pts[Math.min(i0 + 1, pts.length - 1)] - pts[i0]) * tt;
  const elevM = Math.round(70 + pv * 2.8);
  const distKm = (frac * total).toFixed(1);
  const grade = (((pts[Math.min(i0 + 1, pts.length - 1)] - pts[i0]) * 2.8) / (total / pts.length * 10)).toFixed(0);

  const onMove = e => {
    const r = e.currentTarget.getBoundingClientRect();
    let f = (e.clientX - r.left) / r.width;       // chart is LTR (0 at left)
    setFrac(Math.max(0, Math.min(1, f)));
  };

  const segInfo = seg != null ? SEGS[seg] : null;

  return (
    <div>
      {/* header: default totals OR hovered-segment stats */}
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 7, minHeight: 22 }}>
        {segInfo ? (
          <React.Fragment>
            <div className="dlabel" style={{ flex: "0 0 auto", color: segInfo.color }}>
              <span style={{ width: 9, height: 9, borderRadius: 3, background: segInfo.color, display: "inline-block" }} />
              {segInfo.label}
            </div>
            <div className="row gap10" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-2)" }}>
              <span>{segInfo.surf}</span><span>{segInfo.km} ק״מ</span><span>{segInfo.climb} מ׳</span>
            </div>
          </React.Fragment>
        ) : (
          <React.Fragment>
            <div className="dlabel" style={{ flex: "0 0 auto" }}>פרופיל גובה</div>
            <div className="row gap10" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-2)" }}>
              <span>↑ 465 מ׳</span><span>↓ 11 מ׳</span><span className="rc-dist" style={{ color: "var(--text)" }}>{total} ק״מ</span>
            </div>
          </React.Fragment>
        )}
      </div>

      {/* chart with live cursor */}
      <div style={{ position: "relative", border: "1px solid var(--border-soft)", borderRadius: 12, overflow: "hidden", background: "#fff" }}>
        <div style={{ position: "relative", cursor: "ew-resize" }} onMouseMove={onMove}>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={120} preserveAspectRatio="none" style={{ display: "block" }}>
            <defs>
              <linearGradient id="elevgi" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#9bbf6e" stopOpacity="0.85" />
                <stop offset="1" stopColor="#cfe0b0" stopOpacity="0.35" />
              </linearGradient>
            </defs>
            {[25, 50, 75].map(g => <line key={g} x1="0" y1={H * g / 100} x2={W} y2={H * g / 100} stroke="#eef0e8" strokeWidth="1" />)}
            <path d={area} fill="url(#elevgi)" />
            <path d={d} fill="none" stroke="#5e8c43" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </svg>
          {/* live cursor */}
          <div style={{ position: "absolute", top: 0, bottom: 0, left: `${frac * 100}%`, width: 0, borderInlineStart: "2px solid #1c6fb0", pointerEvents: "none" }} />
          <div style={{ position: "absolute", top: `calc(${100 - (pv / 100) * 88}% - 7px)`, left: `${frac * 100}%`,
            width: 11, height: 11, borderRadius: "50%", background: "#1c6fb0", border: "2px solid #fff",
            boxShadow: "0 1px 4px rgba(0,0,0,.3)", transform: "translateX(-50%)", pointerEvents: "none" }} />
          {/* readout chip */}
          <div className="elev-chip" style={{ left: `${frac * 100}%`, transform: `translateX(${frac > 0.7 ? "-100%" : frac < 0.3 ? "0" : "-50%"})` }}>
            <b>{distKm} ק״מ</b><span>{elevM} מ׳</span><span style={{ color: grade > 0 ? "#e8590c" : "#2b7fb5" }}>{grade > 0 ? "↗" : "↘"} {Math.abs(grade)}%</span>
          </div>
        </div>
        {/* hoverable difficulty segments */}
        <div style={{ display: "flex", height: 8 }}>
          {SEGS.map((s, i) => (
            <div key={i} onMouseEnter={() => setSeg(i)} onMouseLeave={() => setSeg(null)} onClick={() => setFrac((s.a + s.b) / 2)}
              style={{ width: `${(s.b - s.a) * 100}%`, background: s.color, opacity: seg === i ? 1 : 0.75, cursor: "pointer",
                borderInlineEnd: i < SEGS.length - 1 ? "1px solid rgba(255,255,255,.6)" : "none" }} />
          ))}
        </div>
      </div>

      {/* transport: play + scrub */}
      <div className="row gap10" style={{ marginTop: 10 }}>
        <button className="play-btn" onClick={() => setPlaying(!playing)} aria-label="play">
          {playing ? <Icon name="pause" size={16} color="#fff" /> : <Icon name="play" size={16} color="#fff" />}
        </button>
        <input className="scrub" type="range" min="0" max="1" step="0.001" value={frac}
          onChange={e => setFrac(parseFloat(e.target.value))} />
        <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-2)", minWidth: 78, textAlign: "left", direction: "ltr" }}>
          {distKm} / {total} km
        </div>
      </div>

      <div className="elegend" style={{ marginTop: 9 }}>
        <span><i style={{ background: "var(--d-easy)" }} />עפר קל</span>
        <span><i style={{ background: "var(--d-mod)" }} />כביש</span>
        <span><i style={{ background: "var(--d-firm)" }} />עלייה</span>
        <span><i style={{ background: "var(--d-hard)" }} />תלול</span>
      </div>
    </div>
  );
}

Object.assign(window, { RouteOverlay, ElevationInteractive, SEGS });
