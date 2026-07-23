import React, { useState, useEffect, useRef, useCallback } from "react";

/* ─── GUIDED SPOTLIGHT TOUR ──────────────────────────────────────────────
   An interactive product walk-through that takes the user on a guided lap
   through all six primary tabs. For each tab the tour:
     1. spotlights that tab's NAV BUTTON in the dock,
     2. navigates to the tab via onNav,
     3. then spotlights a key real element ON the tab.
   The spotlight is a fixed box that cuts a "hole" out of a dimming scrim via a
   very large box-shadow spread — motion stays on transform/opacity only (never
   animating width/height/top/left). Targets resolve against `data-tour="…"`
   anchors placed on real elements in MizanApp.jsx; a target that isn't in the
   DOM yet is polled for briefly, then the step falls back to its nav button.

   Launch offers two modes — "sample data" (reuses demo mode so a fresh,
   connection-less account still sees a populated app) or "my account". The
   host (MizanApp) owns turning demo on for the sample run and restoring the
   prior state on close, so the tour never persists a demo-on state.
──────────────────────────────────────────────────────────────────────────── */

const REVEAL_MS = 460;        // beat on the nav button before moving to the element
const RESOLVE_TIMEOUT = 1100; // how long to poll for an on-tab element to mount
const HOLE_PAD = 8;           // breathing room around the spotlit element
const SCRIM = "rgba(9,13,20,0.60)"; // dimming scrim (chrome, not a brand color)

// The six-tab lap. `nav` = the persistent dock button (always present);
// `el` = a real element that mounts with the tab. Copy describes the tab.
export const TOUR_STEPS = [
  { key:"overview",  to:"overview",  nav:'[data-tour="nav-overview"]',  el:'[data-tour="net-worth"]',
    eyebrow:"1 · OVERVIEW",  title:"Your money at a glance",
    body:"Net worth, performance, allocation, and top holdings — brokerage and bank unified in one dashboard." },
  { key:"finances",  to:"finances",  nav:'[data-tour="nav-finances"]',  el:'[data-tour="finances"]',
    eyebrow:"2 · FINANCES",  title:"Banking & spending",
    body:"Link a bank via Plaid to track balances, transactions, budgets, and bills right beside your portfolio." },
  { key:"portfolio", to:"portfolio", nav:'[data-tour="nav-portfolio"]', el:'[data-tour="tab-screener"]',
    eyebrow:"3 · PORTFOLIO", title:"Holdings & Sharia screening",
    body:"Live positions and activity — plus the Screener, which checks any ticker against AAOIFI rules with no connection required." },
  { key:"goals",     to:"goals",     nav:'[data-tour="nav-goals"]',     el:'[data-tour="tab-zakat"]',
    eyebrow:"4 · PLAN",      title:"Zakat, Sadaqah & goals",
    body:"Live nisab from real gold and silver prices, dividend purification, and goal templates for Hajj, Mahr, Waqf, and FIRE." },
  { key:"advisor",   to:"advisor",   nav:'[data-tour="nav-advisor"]',   el:'[data-tour="advisor"]',
    eyebrow:"5 · AI ADVISOR", title:"Ask anything",
    body:"A Sharia-aware advisor grounded in your real account context — it explains your own data and never invents a number." },
  { key:"settings",  to:"settings",  nav:'[data-tour="nav-settings"]',  el:'[data-tour="connect"]',
    eyebrow:"6 · SETTINGS",  title:"Connect your accounts",
    body:"Link brokerages and banks, manage security and privacy, and replay this tour any time from here." },
];

// Measure a selector's viewport rect. Returns null when the element is missing
// or has no box (e.g. its tab hasn't mounted yet).
function measure(sel){
  try{
    const el=document.querySelector(sel);
    if(!el)return null;
    const b=el.getBoundingClientRect();
    if(b.width===0&&b.height===0)return null;
    return { el, top:b.top, left:b.left, width:b.width, height:b.height };
  }catch{ return null; }
}

export default function GuidedTour({ open, onNav, onClose, onPickSample, onPickOwn, steps=TOUR_STEPS, T, FU, FP, FM }){
  const [phase, setPhase] = useState("intro");   // "intro" (mode choice) | "walk"
  const [i, setI] = useState(0);
  const [rect, setRect] = useState(null);
  const [activeSel, setActiveSel] = useState(null);
  const [reduced, setReduced] = useState(false);
  const calloutRef = useRef(null);
  const introRef = useRef(null);

  const last = i === steps.length - 1;
  const step = steps[i];

  // onNav is an unmemoized closure in the host (recreated every render). Keep it
  // in a ref so the step-driver effect doesn't re-fire — and re-navigate — on
  // every host re-render (live prices tick the host constantly).
  const onNavRef = useRef(onNav);
  useEffect(()=>{ onNavRef.current = onNav; },[onNav]);

  // Reset to the intro choice each time the tour opens.
  useEffect(()=>{ if(open){ setPhase("intro"); setI(0); setRect(null); setActiveSel(null); } },[open]);

  // Respect prefers-reduced-motion (no slide/spotlight animation when set).
  useEffect(()=>{
    if(typeof window==="undefined"||!window.matchMedia)return;
    const mq=window.matchMedia("(prefers-reduced-motion: reduce)");
    const on=()=>setReduced(!!mq.matches); on();
    mq.addEventListener?.("change",on);
    return()=>mq.removeEventListener?.("change",on);
  },[]);

  const close = useCallback((reason)=>{ onClose?.(reason); },[onClose]);

  const goStart = useCallback((mode)=>{
    if(mode==="sample") onPickSample?.(); else onPickOwn?.();
    setPhase("walk");
    setI(0);
  },[onPickSample,onPickOwn]);

  // Drive each walk step: light the nav button, navigate, then resolve + light
  // the on-tab element (polling briefly for it to mount). Cleans up its timers.
  useEffect(()=>{
    if(!open||phase!=="walk")return;
    const s=steps[i];
    if(!s)return;
    let timer=null, raf=null, done=false;

    // Phase A — spotlight the nav button (always in the DOM), then navigate.
    const navRect=measure(s.nav);
    if(navRect){ setRect(navRect); setActiveSel(s.nav); }
    onNavRef.current?.(s.to);

    // Phase B — after a short beat, poll for the on-tab element and move to it.
    const beat = reduced ? 0 : REVEAL_MS;
    timer=setTimeout(()=>{
      const started=Date.now();
      const poll=()=>{
        if(done)return;
        const r=measure(s.el);
        if(r){
          try{ r.el.scrollIntoView({ block:"center", inline:"center", behavior:"auto" }); }catch{}
          const r2=measure(s.el)||r;
          setRect(r2); setActiveSel(s.el);
          return;
        }
        if(Date.now()-started<RESOLVE_TIMEOUT){ raf=requestAnimationFrame(poll); }
        // else: element never mounted — gracefully stay on the nav button.
      };
      raf=requestAnimationFrame(poll);
    }, beat);

    return()=>{ done=true; if(timer)clearTimeout(timer); if(raf)cancelAnimationFrame(raf); };
  },[open,phase,i,steps,reduced]);

  // Keep the hole locked to its target while the page scrolls or resizes.
  useEffect(()=>{
    if(!open||phase!=="walk"||!activeSel)return;
    const sync=()=>{ const r=measure(activeSel); if(r)setRect(r); };
    window.addEventListener("scroll",sync,true);
    window.addEventListener("resize",sync);
    return()=>{ window.removeEventListener("scroll",sync,true); window.removeEventListener("resize",sync); };
  },[open,phase,activeSel]);

  // Focus the active surface for screen readers + keyboard, on open / step change.
  useEffect(()=>{
    if(!open)return;
    const t=setTimeout(()=>{
      if(phase==="intro") introRef.current?.focus();
      else calloutRef.current?.focus();
    }, 30);
    return()=>clearTimeout(t);
  },[open,phase,i]);

  const next=useCallback(()=>{ if(last)close("done"); else setI(n=>Math.min(n+1,steps.length-1)); },[last,close,steps.length]);
  const back=useCallback(()=>setI(n=>Math.max(n-1,0)),[]);

  // Global keys: Esc closes; Left/Right walk the steps.
  useEffect(()=>{
    if(!open)return;
    const onKey=(e)=>{
      if(e.key==="Escape"){ e.preventDefault(); close("esc"); return; }
      if(phase!=="walk")return;
      if(e.key==="ArrowRight"){ e.preventDefault(); next(); }
      else if(e.key==="ArrowLeft"){ e.preventDefault(); back(); }
    };
    window.addEventListener("keydown",onKey);
    return()=>window.removeEventListener("keydown",onKey);
  },[open,phase,next,back,close]);

  if(!open)return null;

  const rootBase={ position:"fixed", inset:0, zIndex:1002 };

  // ── INTRO — pick sample data or your own account ─────────────────────────
  if(phase==="intro"){
    const choice=(mode,accent,label,sub)=>(
      <button onClick={()=>goStart(mode)} className="btn-ghost" style={{
        display:"flex",flexDirection:"column",alignItems:"flex-start",gap:6,textAlign:"left",
        width:"100%",padding:`14px 16px`,borderColor:accent+"55",background:accent+"0F",
      }}>
        <span style={{fontFamily:FM,fontSize:10,color:accent,letterSpacing:"0.14em",fontWeight:600}}>{label}</span>
        <span style={{fontFamily:FP,fontSize:12.5,color:T.muted,lineHeight:1.5,fontWeight:400,letterSpacing:0,textTransform:"none"}}>{sub}</span>
      </button>
    );
    return<div className="mz-tour-root" role="dialog" aria-modal="true" aria-label="Start the MĪZAN tour" style={{
      ...rootBase, background:SCRIM, backdropFilter:"blur(18px) saturate(150%)", WebkitBackdropFilter:"blur(18px) saturate(150%)",
      display:"flex", alignItems:"center", justifyContent:"center", padding:16,
    }}>
      <div ref={introRef} tabIndex={-1} style={{
        width:"100%", maxWidth:420, background:"var(--mz-glass-strong)",
        backdropFilter:"blur(40px) saturate(180%)", WebkitBackdropFilter:"blur(40px) saturate(180%)",
        border:"1px solid var(--mz-glass-border)", borderRadius:16, boxShadow:"var(--mz-glass-shadow-lg)",
        padding:`${T.s6} ${T.s6} ${T.s5}`, outline:"none",
        animation:reduced?undefined:"glassFadeUp 0.22s cubic-bezier(.34,1.56,.64,1)",
      }}>
        <div style={{fontFamily:FM,fontSize:10,color:T.blue,letterSpacing:"0.2em",fontWeight:600,marginBottom:T.s2}}>60-SECOND TOUR</div>
        <div style={{fontFamily:FU,fontSize:23,fontWeight:700,color:T.textHi,letterSpacing:"-0.02em",marginBottom:T.s2}}>Take a guided lap</div>
        <p style={{fontFamily:FP,fontSize:13.5,color:T.muted,lineHeight:1.6,margin:`0 0 ${T.s5}`}}>
          A quick walk through all six tabs — Overview, Finances, Portfolio, Plan, Advisor, and Settings. Explore it with sample data, or use your own account.
        </p>
        <div style={{display:"flex",flexDirection:"column",gap:T.s2,marginBottom:T.s4}}>
          {choice("sample",T.blue,"TOUR WITH SAMPLE DATA","See a fully populated example portfolio — nothing is saved to your account.")}
          {choice("own",T.gold,"TOUR MY ACCOUNT","Walk through the tabs using your own (or empty) data.")}
        </div>
        <div style={{textAlign:"center"}}>
          <button onClick={()=>close("skip")} style={{background:"none",border:"none",color:T.muted,fontFamily:FM,fontSize:11,letterSpacing:"0.04em",cursor:"pointer",padding:6}}>Maybe later</button>
        </div>
      </div>
    </div>;
  }

  // ── WALK — spotlight + callout ───────────────────────────────────────────
  const spot = rect ? {
    position:"fixed", top:0, left:0,
    width: rect.width + HOLE_PAD*2,
    height: rect.height + HOLE_PAD*2,
    transform:`translate(${rect.left-HOLE_PAD}px, ${rect.top-HOLE_PAD}px)`,
    borderRadius:14,
    boxShadow:`0 0 0 9999px ${SCRIM}, 0 0 0 2px ${T.blue}, 0 0 26px 6px ${T.blue}55`,
    transition: reduced ? "none" : "transform 0.4s cubic-bezier(.34,1.56,.64,1), opacity 0.2s",
    pointerEvents:"none",
  } : null;

  // Place the callout near the target: below when the target sits in the upper
  // half of the viewport, otherwise above. Horizontally centered over it, clamped.
  const vw=typeof window!=="undefined"?window.innerWidth:1024;
  const vh=typeof window!=="undefined"?window.innerHeight:768;
  const cw=Math.min(360, vw-32);
  let calloutPos={ left:16, top:vh/2-120 };
  if(rect){
    const below = rect.top < vh*0.5;
    const left = Math.max(16, Math.min(rect.left + rect.width/2 - cw/2, vw-cw-16));
    calloutPos = below
      ? { left, top: Math.min(rect.top+rect.height+HOLE_PAD+14, vh-16) }
      : { left, bottom: Math.max(vh - rect.top + HOLE_PAD + 14, 16) };
  }

  return<div className="mz-tour-root" role="dialog" aria-modal="true" aria-label="MĪZAN product tour" style={{ ...rootBase, background:"transparent" }}>
    {spot&&<div style={spot} aria-hidden="true"/>}
    <div ref={calloutRef} tabIndex={-1} style={{
      position:"fixed", ...calloutPos, width:cw,
      background:"var(--mz-glass-strong)", backdropFilter:"blur(40px) saturate(180%)", WebkitBackdropFilter:"blur(40px) saturate(180%)",
      border:"1px solid var(--mz-glass-border)", borderRadius:14, boxShadow:"var(--mz-glass-shadow-lg)",
      padding:`${T.s5} ${T.s5} ${T.s4}`, outline:"none",
      animation:reduced?undefined:"glassFadeUp 0.2s cubic-bezier(.34,1.56,.64,1)",
    }}>
      <div style={{fontFamily:FM,fontSize:9.5,color:T.blue,letterSpacing:"0.18em",fontWeight:600,marginBottom:T.s2}}>{step.eyebrow}</div>
      <div style={{fontFamily:FU,fontSize:19,fontWeight:700,color:T.textHi,letterSpacing:"-0.015em",marginBottom:T.s2}}>{step.title}</div>
      <p style={{fontFamily:FP,fontSize:13,color:T.muted,lineHeight:1.55,margin:`0 0 ${T.s4}`}}>{step.body}</p>
      <div style={{display:"flex",gap:5,marginBottom:T.s4}}>
        {steps.map((s,k)=><span key={s.key} aria-hidden="true" style={{width:k===i?16:6,height:6,borderRadius:999,background:k===i?T.blue:T.border,transition:reduced?"none":"width 0.2s, background 0.2s"}}/>)}
      </div>
      <div style={{display:"flex",alignItems:"center",gap:T.s2}}>
        {i>0&&<button onClick={back} className="btn-ghost" style={{fontSize:12,padding:`8px ${T.s3}`}}>← Back</button>}
        <button onClick={next} className="btn-primary" style={{flex:1,fontSize:12.5,padding:`9px ${T.s4}`}}>{last?"Done":"Next →"}</button>
        <button onClick={()=>close("skip")} className="btn-ghost" style={{fontSize:11.5,padding:`8px ${T.s3}`,whiteSpace:"nowrap"}}>Skip</button>
      </div>
      <div style={{fontFamily:FM,fontSize:9.5,color:T.muted,textAlign:"center",marginTop:T.s3,letterSpacing:"0.06em"}}>
        Step {i+1} of {steps.length} · use ← → keys
      </div>
    </div>
  </div>;
}
