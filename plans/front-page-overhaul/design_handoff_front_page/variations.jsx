/* ===== Cycleways — three front-page variations (exported to window) ===== */
const { useState: useSt, useEffect: useEfV } = React;

function StateBar({ state, setState }) {
  return (
    <div className="statebar">
      <button className={state === "discover" ? "on" : ""} onClick={() => setState("discover")}>
        <Icon name="search" size={15} /> גילוי מסלול
      </button>
      <button className={state === "build" ? "on" : ""} onClick={() => setState("build")}>
        <Icon name="route" size={15} /> בניית מסלול
      </button>
    </div>
  );
}

function RouteHead({ big, tools }) {
  return (
    <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
      <div>
        <div className="eyebrow">המסלול שלי · טיוטה</div>
        <div className="row gap6" style={{ alignItems: "center", marginTop: 2 }}>
          <div style={{ fontSize: big ? 22 : 19, fontWeight: 800 }}>סובב עמק החולה</div>
          <Icon name="edit" size={15} color="#9aa08d" />
        </div>
      </div>
      {tools ? (
        <div className="minitools">
          <button className="minitool" title="בטל"><Icon name="undo" size={15} /></button>
          <button className="minitool" title="בצע שוב"><Icon name="redo" size={15} /></button>
          <button className="minitool" title="נקה מסלול"><Icon name="trash" size={15} /></button>
        </div>
      ) : (
        <button className="btn btn-ghost btn-sm"><Icon name="trash" size={15} />נקה</button>
      )}
    </div>
  );
}

function buildCallout() {
  return (
    <div className="map-callout" style={{ bottom: 18, right: 18 }}>
      <div className="co-ic"><Icon name="historic" size={22} color="#9a6b3a" /></div>
      <div>
        <div className="co-k">היסטוריה · ק״מ 4.1</div>
        <div className="co-t">טחנת קמח עתיקה</div>
        <div className="co-d">טחנת מים משוחזרת על גדת הנחל</div>
      </div>
    </div>
  );
}

/* ============ Variation A — Classic (interactive build) ============ */
function VariationA() {
  const [state, setState] = useSt("build");
  const [frac, setFrac] = useSt(0.46);
  const [seg, setSeg] = useSt(null);
  const [playing, setPlaying] = useSt(false);
  useEfV(() => {
    if (!playing) return;
    let raf, last = performance.now();
    const tick = now => {
      const dt = (now - last) / 1000; last = now;
      setFrac(f => { const nf = f + dt / 11; if (nf >= 1) { setPlaying(false); return 1; } return nf; });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
  const isB = state === "build";
  return (
    <div className="cw-app" style={{ "--pw": "408px" }}>
      <TopNav />
      <div className="cw-main">
        <MapBackdrop img="assets/map-discover.png" search={false} showTools={false} legendLeft={true}
          routeOverlay={isB ? <RouteOverlay frac={frac} seg={seg} /> : null} />
        <aside className="cw-panel">
          <StateBar state={state} setState={setState} />
          <div className="pscroll">
            {!isB ? (
              <div className="sec">
                <div><div className="eyebrow">מצא מסלול</div>
                  <div style={{ fontSize: 19, fontWeight: 800, marginTop: 1 }}>מצאו את הרכיבה הבאה</div></div>
                <SearchForm />
                <div className="hr" />
                <ByoCta onBuild={() => setState("build")} />
                <div className="dlabel" style={{ marginTop: 4 }}>מסלולים מומלצים</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                  {RECS.map((r, i) => <RecCard key={i} r={r} />)}
                </div>
              </div>
            ) : (
              <div className="sec">
                <RouteHead tools />
                <StatStrip />
                <div className="hr" />
                <ElevationInteractive frac={frac} setFrac={setFrac} seg={seg} setSeg={setSeg}
                  playing={playing} setPlaying={setPlaying} />
                <RouteActions />
                <div className="hr" />
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div className="dlabel" style={{ flex: "0 0 auto" }}>נקודות עניין בדרך</div>
                  <span className="tag">{POIS.length} נקודות זוהו</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                  {POIS.map((p, i) => <PoiCard key={i} p={p} idx={i + 1} />)}
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ============ Variation B — Editorial ============ */
function EditorialRec({ r }) {
  return (
    <div style={{ borderRadius: 14, overflow: "hidden", border: "1px solid var(--border-soft)", background: "#fff", boxShadow: "var(--shadow-sm)" }}>
      <div style={{ height: 124, position: "relative", background: "#cdd7c2" }}>
        <img src={r.img} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        <span className="badge" style={{ position: "absolute", top: 10, right: 10 }}>{r.badge}</span>
      </div>
      <div style={{ padding: "12px 14px" }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={{ fontSize: 16.5, fontWeight: 800 }}>{r.title}</div>
          <div className="rc-dist" style={{ fontSize: 15 }}>{r.dist} <span style={{ fontSize: 12, color: "var(--text-2)" }}>ק״מ</span></div>
        </div>
        <div className="rc-desc">{r.desc}</div>
        <div className="row gap6 wrap" style={{ marginTop: 4 }}>
          <span className="tag">{r.lvl}</span>{r.tags.map(t => <span className="tag" key={t}>{t}</span>)}
        </div>
      </div>
    </div>
  );
}
function VariationB() {
  const [state, setState] = useSt("build");
  const isB = state === "build";
  return (
    <div className="cw-app" style={{ "--pw": "440px" }}>
      <TopNav />
      <div className="cw-main">
        <MapBackdrop img={isB ? "assets/map-building.png" : "assets/map-discover.png"}
          search={!isB} callout={isB ? buildCallout() : null} />
        <aside className="cw-panel">
          <StateBar state={state} setState={setState} />
          {/* green context band */}
          <div style={{ background: "linear-gradient(135deg,var(--green) 0%,var(--green-600) 100%)", color: "#fff", padding: "16px 18px" }}>
            {isB ? (
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 700, opacity: .85 }}>המסלול שלי · טיוטה</div>
                <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end", marginTop: 4 }}>
                  <div className="herostat"><span className="n">11.7</span><span className="u" style={{ color: "rgba(255,255,255,.85)" }}>ק״מ</span></div>
                  <div className="row gap12" style={{ fontSize: 13.5, fontWeight: 700 }}>
                    <span>↑ 465 מ׳</span><span>↓ 11 מ׳</span>
                  </div>
                </div>
                {/* difficulty gradient bar */}
                <div style={{ marginTop: 12, height: 8, borderRadius: 6, background: "linear-gradient(90deg,#2f9e44,#f2c037,#f08c00,#e03131)" }} />
                <div className="row" style={{ justifyContent: "space-between", fontSize: 11.5, marginTop: 4, opacity: .9 }}>
                  <span>רמת קושי: בינוני</span><span>שטח · מעגלי</span>
                </div>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, opacity: .9 }}>תכנון רכיבה</div>
                <div style={{ fontSize: 22, fontWeight: 800, margin: "2px 0 4px" }}>לאן רוכבים היום?</div>
                <div style={{ fontSize: 13.5, opacity: .9, lineHeight: 1.45 }}>חפשו מבין המסלולים המומלצים — או סמנו נקודות על המפה ובנו מסלול משלכם.</div>
              </div>
            )}
          </div>
          <div className="pscroll">
            {isB ? (
              <div className="sec">
                <RouteActions />
                <ElevationGraph showLegend />
                <div className="hr" />
                <div className="dlabel">נקודות עניין בדרך</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                  {POIS.map((p, i) => <PoiCard key={i} p={p} idx={i + 1} />)}
                </div>
              </div>
            ) : (
              <div className="sec">
                <SearchForm />
                <ByoCta onBuild={() => setState("build")} />
                <div className="dlabel" style={{ marginTop: 2 }}>מסלולים מומלצים</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
                  {RECS.map((r, i) => <EditorialRec key={i} r={r} />)}
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ============ Variation C — Tabbed app ============ */
function CompactRec({ r }) {
  return (
    <div className="row gap10" style={{ padding: "9px 4px", borderBottom: "1px solid var(--border-soft)", cursor: "pointer" }}>
      <div style={{ width: 58, height: 50, borderRadius: 9, overflow: "hidden", flex: "0 0 58px", background: "#cdd7c2" }}>
        <img src={r.img} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div style={{ fontSize: 14.5, fontWeight: 700 }}>{r.title}</div>
          <span className="rc-dist" style={{ fontSize: 13.5 }}>{r.dist} ק״מ</span>
        </div>
        <div className="rc-meta" style={{ fontSize: 12 }}><span>{r.lvl}</span><span>•</span><span>{r.via}</span></div>
      </div>
      <Icon name="chev" size={16} color="#b9bda9" />
    </div>
  );
}
function VariationC() {
  const [state, setState] = useSt("build");
  const [tab, setTab] = useSt("overview");
  const isB = state === "build";
  return (
    <div className="cw-app" style={{ "--pw": "396px" }}>
      <TopNav />
      <div className="cw-main">
        <MapBackdrop img={isB ? "assets/map-building.png" : "assets/map-discover.png"}
          search={!isB} callout={isB ? buildCallout() : null} />
        <aside className="cw-panel">
          <StateBar state={state} setState={setState} />
          {isB ? (
            <React.Fragment>
              <div style={{ padding: "13px 16px 0" }}><RouteHead /></div>
              <div className="ptabs">
                {[["overview","סקירה"],["poi","נקודות עניין"],["elev","גובה"]].map(([k, l]) => (
                  <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>
                ))}
              </div>
              <div className="pscroll">
                {tab === "overview" && (
                  <div className="sec">
                    <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
                      <div className="herostat"><span className="n" style={{ color: "var(--green-700)" }}>11.7</span><span className="u">ק״מ</span></div>
                      <div className="row gap10" style={{ fontSize: 13, fontWeight: 700, color: "var(--text-2)" }}>
                        <span>↑ 465 מ׳</span><span>↓ 11 מ׳</span>
                      </div>
                    </div>
                    <StatStrip cols={[{k:"קושי",v:"בינוני",u:" "},{k:"משטח",v:"שטח",u:" "},{k:"סוג",v:"מעגלי",u:" "},{k:"זמן",v:"~1:10",u:"שעה"}]} />
                    <ElevationGraph height={86} showAxis={false} showLegend={false} />
                    <RouteActions />
                  </div>
                )}
                {tab === "poi" && (
                  <div className="sec">
                    <span className="tag" style={{ alignSelf: "flex-start" }}>{POIS.length} נקודות זוהו לאורך המסלול</span>
                    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                      {POIS.map((p, i) => <PoiCard key={i} p={p} idx={i + 1} />)}
                    </div>
                  </div>
                )}
                {tab === "elev" && (
                  <div className="sec"><ElevationGraph height={150} /></div>
                )}
              </div>
            </React.Fragment>
          ) : (
            <div className="pscroll">
              <div className="sec">
                <div><div className="eyebrow">מצא מסלול</div>
                  <div style={{ fontSize: 18, fontWeight: 800 }}>מצאו את הרכיבה הבאה</div></div>
                <SearchForm compact />
                <ByoCta onBuild={() => { setState("build"); setTab("overview"); }} />
                <div className="dlabel">מסלולים מומלצים</div>
                <div>{RECS.map((r, i) => <CompactRec key={i} r={r} />)}</div>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

Object.assign(window, { VariationA, VariationB, VariationC });
