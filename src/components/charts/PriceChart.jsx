// Price chart (candlestick + volume) — fed by the IMPERSONAL /api/market/candles
// endpoint. Decoupled from MizanApp like PerformancePanel/Goals: it re-derives
// theme tokens from CSS custom properties and takes everything as props.
//
// COMPLIANCE (see docs/COMPLIANCE.md): the chart renders IMPERSONAL market data
// only. There are deliberately NO buy/sell signal markers, NO target/entry/exit
// price lines, and NO "annotations" of any kind that could read as a
// recommendation. SMA/EMA/volume are neutral DATA overlays, labeled as data.
// The optional cost-basis line + trade markers (costBasis/trades props) show the
// user's OWN executed transactions — that is ACCOUNT_SERVICING (a statement of
// fact about their account), never a judgment or suggestion.
import { useEffect, useRef, useState, useCallback } from "react";
import { apiFetch } from "../../lib/apiFetch.js";

const T = {
  card: "var(--mz-card)", surface: "var(--mz-surface)",
  border: "var(--mz-border)", borderHi: "var(--mz-borderHi)",
  text: "var(--mz-text)", textHi: "var(--mz-textHi)", muted: "var(--mz-muted)",
  blue: "#1e4e8c", gain: "#117a52", loss: "#b23a3d", slate: "#6b7b88",
  s1: "var(--s-1)", s2: "var(--s-2)", s3: "var(--s-3)", s4: "var(--s-4)", s5: "var(--s-5)",
  rSm: "var(--r-sm)", rMd: "var(--r-md)",
};
const FP = "'IBM Plex Sans',system-ui,-apple-system,BlinkMacSystemFont,sans-serif";
const FM = "'IBM Plex Mono','JetBrains Mono','Menlo','Monaco',monospace";

const CHART_HEIGHT = 320;
const LIVE_POLL_MS = 12_000;
const DEBOUNCE_MS  = 220;

// Timeframe → (resolution, lookback days). Resolutions match the server's
// whitelist. Intraday spans get a few extra days of slack so a weekend/holiday
// never yields an empty chart.
const TIMEFRAMES = [
  { key: "1D", resolution: "15", days: 4 },
  { key: "1W", resolution: "60", days: 9 },
  { key: "1M", resolution: "D",  days: 32 },
  { key: "3M", resolution: "D",  days: 95 },
  { key: "6M", resolution: "D",  days: 190 },
  { key: "1Y", resolution: "D",  days: 370 },
  { key: "5Y", resolution: "W",  days: 5 * 366 },
];
const DEFAULT_TF = "3M";
const isIntraday = (res) => ["1", "5", "15", "30", "60"].includes(res);

const isoDaysAgo = (days) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
};
const todayIso = () => new Date().toISOString().slice(0, 10);

// ── Neutral indicator math (client-side, pure) ──────────────────────────────
function sma(candles, period) {
  const out = [];
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= period) sum -= candles[i - period].close;
    if (i >= period - 1) out.push({ time: candles[i].time, value: sum / period });
  }
  return out;
}
function ema(candles, period) {
  if (candles.length === 0) return [];
  const k = 2 / (period + 1);
  const out = [];
  let prev = candles[0].close;
  for (let i = 0; i < candles.length; i++) {
    prev = i === 0 ? candles[i].close : candles[i].close * k + prev * (1 - k);
    if (i >= period - 1) out.push({ time: candles[i].time, value: prev });
  }
  return out;
}

// Resolve the CSS custom properties the canvas needs to concrete color strings
// (lightweight-charts draws to <canvas>, which can't read `var(--x)`).
function themeColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name, fb) => (cs.getPropertyValue(name).trim() || fb);
  return {
    text:   v("--mz-textHi", "#1c1b19"),
    muted:  v("--mz-muted", "#6b7b88"),
    border: v("--mz-border", "#e7e2d8"),
  };
}

export default function PriceChart({ symbol, costBasis = null, trades = null }) {
  const wrapRef      = useRef(null);
  const chartRef     = useRef(null);
  const libRef       = useRef(null);   // the lightweight-charts module
  const candleRef    = useRef(null);
  const volumeRef    = useRef(null);
  const smaRef        = useRef(null);
  const emaRef        = useRef(null);
  const costLineRef  = useRef(null);
  const liveLineRef  = useRef(null);
  const markersRef   = useRef(null);
  const roRef        = useRef(null);
  const themeObsRef  = useRef(null);
  const reqIdRef     = useRef(0);
  const debounceRef  = useRef(null);

  const [tfKey, setTfKey]   = useState(DEFAULT_TF);
  const [status, setStatus] = useState("loading"); // loading | ready | empty | error
  const [candles, setCandles] = useState([]);
  const [live, setLive]     = useState(null);       // { price, changePct }
  const [chartReady, setChartReady] = useState(false);
  const [showVolume, setShowVolume] = useState(true);
  const [showSMA, setShowSMA] = useState(false);
  const [showEMA, setShowEMA] = useState(false);

  const tf = TIMEFRAMES.find(t => t.key === tfKey) || TIMEFRAMES[3];

  // ── Build the chart once (dynamic import keeps the lib out of the main bundle) ──
  useEffect(() => {
    let disposed = false;
    (async () => {
      const el = wrapRef.current;
      if (!el) return;
      const LWC = await import("lightweight-charts");
      if (disposed || !wrapRef.current) return;
      libRef.current = LWC;
      const c = themeColors();
      const chart = LWC.createChart(el, {
        width: el.clientWidth || 600,
        height: CHART_HEIGHT,
        layout: { background: { color: "transparent" }, textColor: c.muted, fontFamily: FM, fontSize: 11 },
        grid: { vertLines: { color: c.border }, horzLines: { color: c.border } },
        rightPriceScale: { borderColor: c.border },
        timeScale: { borderColor: c.border, timeVisible: isIntraday(tf.resolution), secondsVisible: false },
        crosshair: { mode: LWC.CrosshairMode?.Normal ?? 0 },
        autoSize: false,
      });
      chartRef.current = chart;
      candleRef.current = chart.addSeries(LWC.CandlestickSeries, {
        upColor: T.gain, downColor: T.loss, borderVisible: false,
        wickUpColor: T.gain, wickDownColor: T.loss,
      });
      volumeRef.current = chart.addSeries(LWC.HistogramSeries, {
        priceFormat: { type: "volume" }, priceScaleId: "vol",
      });
      chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

      // Responsive width via ResizeObserver (no scroll-handler churn).
      roRef.current = new ResizeObserver(() => {
        if (chartRef.current && wrapRef.current) {
          chartRef.current.applyOptions({ width: wrapRef.current.clientWidth || 600 });
        }
      });
      roRef.current.observe(el);

      // Re-theme on light/dark toggle.
      themeObsRef.current = new MutationObserver(() => {
        if (!chartRef.current) return;
        const t = themeColors();
        chartRef.current.applyOptions({
          layout: { textColor: t.muted }, grid: { vertLines: { color: t.border }, horzLines: { color: t.border } },
          rightPriceScale: { borderColor: t.border }, timeScale: { borderColor: t.border },
        });
      });
      themeObsRef.current.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

      setChartReady(true);
    })();

    return () => {
      disposed = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      roRef.current?.disconnect();
      themeObsRef.current?.disconnect();
      chartRef.current?.remove?.();
      chartRef.current = null;
      candleRef.current = null; volumeRef.current = null;
      smaRef.current = null; emaRef.current = null;
      costLineRef.current = null; liveLineRef.current = null; markersRef.current = null;
      setChartReady(false);
    };
    // Build once per mounted symbol; timeframe changes re-fetch, not rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Fetch candles (debounced) on symbol / timeframe change ──────────────
  const load = useCallback(async () => {
    if (!symbol) return;
    const reqId = ++reqIdRef.current;
    setStatus("loading");
    try {
      const params = new URLSearchParams({
        symbol, resolution: tf.resolution, from: isoDaysAgo(tf.days), to: todayIso(),
      });
      const r = await apiFetch(`/api/market/candles?${params.toString()}`);
      if (reqId !== reqIdRef.current) return;      // a newer request superseded this one
      if (!r.ok) { setStatus("error"); return; }
      const data = await r.json().catch(() => ({}));
      if (reqId !== reqIdRef.current) return;
      const rows = Array.isArray(data.candles) ? data.candles : [];
      setCandles(rows);
      setStatus(rows.length ? "ready" : "empty");
    } catch {
      if (reqId === reqIdRef.current) setStatus("error");
    }
  }, [symbol, tf.resolution, tf.days]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(load, DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [load]);

  // ── Push data into the series when candles or chart readiness change ─────
  useEffect(() => {
    if (!chartReady || !candleRef.current) return;
    candleRef.current.setData(candles.map(c => ({
      time: c.time, open: c.open, high: c.high, low: c.low, close: c.close,
    })));
    if (volumeRef.current) {
      volumeRef.current.setData(showVolume ? candles.map(c => ({
        time: c.time, value: c.volume,
        color: (c.close >= c.open ? T.gain : T.loss) + "40",
      })) : []);
    }
    chartRef.current?.applyOptions({
      timeScale: { timeVisible: isIntraday(tf.resolution), secondsVisible: false },
    });
    chartRef.current?.timeScale().fitContent();
  }, [candles, chartReady, showVolume, tf.resolution]);

  // ── Neutral indicator overlays (data, not signals) ──────────────────────
  useEffect(() => {
    const LWC = libRef.current, chart = chartRef.current;
    if (!chartReady || !LWC || !chart) return;
    // SMA
    if (showSMA && candles.length) {
      if (!smaRef.current) smaRef.current = chart.addSeries(LWC.LineSeries, { color: T.blue, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      smaRef.current.setData(sma(candles, 50));
    } else if (smaRef.current) { chart.removeSeries(smaRef.current); smaRef.current = null; }
    // EMA
    if (showEMA && candles.length) {
      if (!emaRef.current) emaRef.current = chart.addSeries(LWC.LineSeries, { color: T.slate, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      emaRef.current.setData(ema(candles, 20));
    } else if (emaRef.current) { chart.removeSeries(emaRef.current); emaRef.current = null; }
  }, [showSMA, showEMA, candles, chartReady]);

  // ── ACCOUNT_SERVICING overlay: the user's own cost basis + executed trades ──
  useEffect(() => {
    const LWC = libRef.current, series = candleRef.current;
    if (!chartReady || !LWC || !series) return;

    // "Your average cost" — a factual line, not a target. Rebuild on change.
    if (costLineRef.current) { series.removePriceLine(costLineRef.current); costLineRef.current = null; }
    if (Number.isFinite(costBasis) && costBasis > 0) {
      costLineRef.current = series.createPriceLine({
        price: costBasis, color: T.slate, lineWidth: 1,
        lineStyle: LWC.LineStyle?.Dashed ?? 2, axisLabelVisible: true, title: "Your average cost",
      });
    }

    // Executed-trade markers (neutral, factual). Uses a single neutral color and
    // plain "Bought/Sold" text so nothing reads as a buy/sell signal.
    if (LWC.createSeriesMarkers) {
      if (!markersRef.current) markersRef.current = LWC.createSeriesMarkers(series, []);
      const ms = Array.isArray(trades) ? trades
        .filter(t => t && Number.isFinite(t.time) && (t.side === "BUY" || t.side === "SELL"))
        .map(t => ({
          time: t.time,
          position: t.side === "BUY" ? "belowBar" : "aboveBar",
          color: T.slate, shape: "circle",
          text: `${t.side === "BUY" ? "Bought" : "Sold"}${Number.isFinite(t.units) ? " " + t.units : ""}`,
        })) : [];
      markersRef.current.setMarkers(ms);
    }
  }, [costBasis, trades, chartReady]);

  // ── Optional live last-price line — polls only while the tab is visible ──
  useEffect(() => {
    if (!chartReady || !symbol) return;
    let stopped = false;
    let timer = null;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const r = await apiFetch(`/api/market/quote?symbol=${encodeURIComponent(symbol)}`);
        if (stopped || !r.ok) return;
        const d = await r.json().catch(() => ({}));
        const price = d?.quote?.price;
        if (!Number.isFinite(price)) return;
        setLive({ price, changePct: d.quote.changePct });
        const series = candleRef.current, LWC = libRef.current;
        if (series && LWC) {
          if (liveLineRef.current) series.removePriceLine(liveLineRef.current);
          liveLineRef.current = series.createPriceLine({
            price, color: T.blue, lineWidth: 1,
            lineStyle: LWC.LineStyle?.Dotted ?? 1, axisLabelVisible: true, title: "Last",
          });
        }
      } catch { /* transient — next tick retries */ }
    };
    tick();
    timer = setInterval(tick, LIVE_POLL_MS);
    const onVis = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { stopped = true; if (timer) clearInterval(timer); document.removeEventListener("visibilitychange", onVis); };
  }, [symbol, chartReady]);

  // ── Render ──────────────────────────────────────────────────────────────
  const lastClose = candles.length ? candles[candles.length - 1].close : null;
  const srSummary = status === "ready" && lastClose != null
    ? `Price chart for ${symbol}, ${tfKey}. Latest close ${lastClose.toFixed(2)}${live ? `, last ${live.price.toFixed(2)}` : ""}. ${candles.length} data points.`
    : `Price chart for ${symbol}, ${tfKey}.`;

  const toggleBtn = (label, on, onClick, title) => (
    <button type="button" onClick={onClick} aria-pressed={on} title={title} style={{
      fontFamily: FM, fontSize: 10, letterSpacing: "0.08em", fontWeight: 600,
      padding: `3px ${T.s2}`, borderRadius: T.rSm, cursor: "pointer",
      color: on ? T.textHi : T.muted, background: on ? `${T.blue}14` : "transparent",
      border: `1px solid ${on ? `${T.blue}44` : "var(--mz-border)"}`,
    }}>{label}</button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: T.s3 }}>
      {/* Toolbar: timeframe + neutral data toggles */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: T.s2 }}>
        <div role="tablist" aria-label={`Timeframe for ${symbol}`} style={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
          {TIMEFRAMES.map(t => (
            <button key={t.key} role="tab" aria-selected={t.key === tfKey} onClick={() => setTfKey(t.key)} style={{
              fontFamily: FM, fontSize: 11, fontWeight: 600, letterSpacing: "0.04em",
              padding: `4px ${T.s3}`, borderRadius: T.rSm, cursor: "pointer",
              color: t.key === tfKey ? "#fff" : T.muted,
              background: t.key === tfKey ? T.blue : "transparent",
              border: `1px solid ${t.key === tfKey ? T.blue : "var(--mz-border)"}`,
            }}>{t.key}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
          <span style={{ fontFamily: FM, fontSize: 9, color: T.muted, letterSpacing: "0.14em", fontWeight: 600, marginRight: 4 }}>DATA</span>
          {toggleBtn("VOL", showVolume, () => setShowVolume(v => !v), "Toggle volume")}
          {toggleBtn("SMA 50", showSMA, () => setShowSMA(v => !v), "50-period simple moving average (data, not a signal)")}
          {toggleBtn("EMA 20", showEMA, () => setShowEMA(v => !v), "20-period exponential moving average (data, not a signal)")}
        </div>
      </div>

      {/* Chart canvas host — always mounted so the chart instance is stable;
          overlays sit on top for loading / empty / error. */}
      <div style={{ position: "relative", width: "100%", minHeight: CHART_HEIGHT }}>
        <div ref={wrapRef} role="img" aria-label={srSummary} style={{ width: "100%", height: CHART_HEIGHT }} />

        {status === "loading" && (
          <div style={overlayStyle} aria-hidden="true">
            <div style={{ fontFamily: FM, fontSize: 11, color: T.muted, letterSpacing: "0.12em" }}>LOADING CHART…</div>
          </div>
        )}
        {status === "empty" && (
          <div style={overlayStyle}>
            <div style={{ fontFamily: FP, fontSize: 13, color: T.muted, textAlign: "center" }}>
              No chart data for {symbol}.
            </div>
          </div>
        )}
        {status === "error" && (
          <div style={overlayStyle}>
            <div style={{ fontFamily: FP, fontSize: 13, color: T.muted, textAlign: "center", display: "flex", flexDirection: "column", gap: T.s3, alignItems: "center" }}>
              Couldn’t load the chart.
              <button type="button" onClick={load} style={{
                fontFamily: FM, fontSize: 11, fontWeight: 600, letterSpacing: "0.06em",
                padding: `5px ${T.s4}`, borderRadius: T.rSm, cursor: "pointer",
                color: "#fff", background: T.blue, border: "none",
              }}>Retry</button>
            </div>
          </div>
        )}
      </div>

      {/* Screen-reader table fallback — the same data, non-visually. */}
      <table style={srOnly} aria-label={`Recent prices for ${symbol}`}>
        <caption>{srSummary}</caption>
        <thead><tr><th>Time</th><th>Close</th></tr></thead>
        <tbody>
          {candles.slice(-12).map((c, i) => (
            <tr key={i}><td>{new Date(c.time * 1000).toISOString().slice(0, 10)}</td><td>{c.close.toFixed(2)}</td></tr>
          ))}
        </tbody>
      </table>

      <div style={{ fontFamily: FM, fontSize: 9, color: T.muted, letterSpacing: "0.1em" }}>
        MARKET DATA · POLYGON · MOVING AVERAGES ARE DATA, NOT SIGNALS
      </div>
    </div>
  );
}

const overlayStyle = {
  position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
  background: "var(--mz-card)", pointerEvents: "auto",
};
const srOnly = {
  position: "absolute", width: 1, height: 1, padding: 0, margin: -1,
  overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap", border: 0,
};
