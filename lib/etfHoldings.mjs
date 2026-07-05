// lib/etfHoldings.mjs
//
// Halal ETF / fund universe, curated bootstrap holdings, and the pure overlap
// engine behind the ETF Overlap Analyzer. Kept framework-free so it can be
// unit-tested in isolation and imported by lib/handlers.mjs.
//
// Weights are stored as 0..1 FRACTIONS everywhere (Alpha Vantage's ETF_PROFILE
// returns fractions like "0.0762"; curated percentages below are divided by 100
// at definition time via pct()). Overlap % = Σ min(weightA, weightB) over the
// shared tickers — the standard portfolio-overlap metric, itself a 0..1 fraction.

// ── Universe ────────────────────────────────────────────────────────────────
// vehicle: etf → served live by Alpha Vantage (daily). mutual_fund → Amana,
// curated-only (AV is ETF-only; MFs report holdings quarterly anyway).
// assetClass: equity vs sukuk — equity-vs-sukuk overlap is meaningless, the UI
// flags it instead of showing a misleading 0%.
export const ETF_UNIVERSE = [
  { symbol: "SPUS", name: "SP Funds S&P 500 Sharia",            vehicle: "etf",         assetClass: "equity" },
  { symbol: "HLAL", name: "Wahed FTSE USA Shariah",             vehicle: "etf",         assetClass: "equity" },
  { symbol: "UMMA", name: "Wahed Dow Jones Islamic World",      vehicle: "etf",         assetClass: "equity" },
  { symbol: "SPWO", name: "SP Funds S&P World (ex-US)",         vehicle: "etf",         assetClass: "equity" },
  { symbol: "SPTE", name: "SP Funds S&P Global Technology",     vehicle: "etf",         assetClass: "equity" },
  { symbol: "SPRE", name: "SP Funds S&P Global REIT Sharia",    vehicle: "etf",         assetClass: "equity" },
  { symbol: "SPSK", name: "SP Funds Dow Jones Global Sukuk",    vehicle: "etf",         assetClass: "sukuk"  },
  { symbol: "AMANX", name: "Amana Income Fund",                 vehicle: "mutual_fund", assetClass: "equity" },
  { symbol: "AMAGX", name: "Amana Growth Fund",                 vehicle: "mutual_fund", assetClass: "equity" },
  { symbol: "AMDWX", name: "Amana Developing World Fund",       vehicle: "mutual_fund", assetClass: "equity" },
  { symbol: "AMAPX", name: "Amana Participation Fund (Sukuk)",  vehicle: "mutual_fund", assetClass: "sukuk"  },
];

export const UNIVERSE_SYMBOLS = ETF_UNIVERSE.map((e) => e.symbol);

export function universeMeta(symbol) {
  return ETF_UNIVERSE.find((e) => e.symbol === String(symbol || "").toUpperCase()) || null;
}

// pct("NVDA", 12.72) → { symbol:"NVDA", weight:0.1272 }
const pct = (symbol, p) => ({ symbol, weight: Math.round(p * 1e6) / 1e8 });

// Normalize a ticker for cross-fund matching. International holdings come with
// an exchange prefix ("AMS: ASML", "KRX: 005930", "LON: AZN") while the same
// name in a US-listed fund is bare ("ASML"); stripping the "XX:" prefix + spaces
// lets those legitimately match. Does NOT reconcile ADR-vs-local line pairs
// (e.g. TSM vs 2330, ASML-US vs ASML-AMS) — that's a deeper mapping left as a
// known limitation; the curated data is a bootstrap that Alpha Vantage (clean US
// tickers) overwrites for ETFs anyway.
export function normTicker(s) {
  return String(s || "").toUpperCase().trim().replace(/^[A-Z]{2,4}:\s*/, "").replace(/\s+/g, "");
}

// ── Curated bootstrap holdings ───────────────────────────────────────────────
// Top-25 constituents (covers ~all of a 30-holding fund; the tail is negligible
// for overlap). SPUS/HLAL are seeded so the analyzer works before the AV key is
// live — AV overwrites them daily. The four Amana funds are curated-permanent.
// Foreign tickers (e.g. "5803.JP") are kept verbatim; they simply never match a
// US-listed ETF constituent, which is the correct behavior.
// Sources: stockanalysis.com holdings pages, as of 2026-07-01.
export const CURATED_HOLDINGS = {
  SPUS: { asOf: "2026-07-01", holdings: [
    pct("NVDA",12.72), pct("AAPL",11.50), pct("MSFT",7.59), pct("GOOGL",5.63), pct("AVGO",4.65),
    pct("TSLA",3.18), pct("MU",3.09), pct("LLY",2.51), pct("AMD",2.34), pct("JNJ",1.65),
    pct("XOM",1.50), pct("AMAT",1.39), pct("LRCX",1.31), pct("CSCO",1.24), pct("ABBV",1.19),
    pct("HD",0.94), pct("KLAC",0.92), pct("PG",0.92), pct("MRK",0.84), pct("GEV",0.81),
    pct("SNDK",0.80), pct("PANW",0.76), pct("TXN",0.72), pct("IBM",0.72), pct("LIN",0.66),
  ]},
  HLAL: { asOf: "2026-07-01", holdings: [
    pct("NVDA",11.73), pct("AAPL",11.05), pct("MSFT",7.41), pct("GOOGL",5.46), pct("AVGO",4.46),
    pct("GOOG",4.42), pct("META",3.50), pct("TSLA",3.23), pct("MU",3.02), pct("LLY",2.47),
    pct("AMD",2.28), pct("JNJ",1.59), pct("XOM",1.47), pct("INTC",1.45), pct("AMAT",1.34),
    pct("LRCX",1.27), pct("CSCO",1.20), pct("PG",0.89), pct("KLAC",0.89), pct("KO",0.82),
    pct("MRK",0.81), pct("CVX",0.80), pct("GEV",0.78), pct("SNDK",0.77), pct("PANW",0.74),
  ]},
  AMAGX: { asOf: "2026-07-01", holdings: [
    pct("TSM",7.33), pct("ASML",7.24), pct("AAPL",7.10), pct("GOOGL",6.85), pct("NVDA",6.08),
    pct("AVGO",5.93), pct("LLY",4.99), pct("JCI",4.72), pct("MSFT",4.24), pct("5803.JP",3.07),
    pct("TJX",3.04), pct("TT",2.99), pct("AZN",2.71), pct("AZO",2.46), pct("PRY.IM",2.28),
    pct("ABBV",2.28), pct("SYK",2.22), pct("SU.FP",2.13), pct("SN",2.03), pct("CHD",2.01),
    pct("NOW",1.99), pct("TRMB",1.82), pct("LOW",1.73), pct("6702.JP",1.71), pct("ORCL",1.42),
  ]},
  AMANX: { asOf: "2026-07-01", holdings: [
    pct("LLY",12.14), pct("TSM",11.97), pct("MSFT",5.98), pct("ROK",5.40), pct("AVGO",4.24),
    pct("GWW",4.05), pct("ITW",3.85), pct("JCI",3.51), pct("LIN",2.92), pct("CSCO",2.81),
    pct("TXN",2.34), pct("FERG",2.30), pct("NVS",2.20), pct("GPC",2.01), pct("CNI",1.98),
    pct("CL",1.97), pct("7974.JP",1.88), pct("ETN",1.83), pct("JNJ",1.81), pct("ABT",1.80),
    pct("UL",1.63), pct("ABBV",1.59), pct("UPS",1.54), pct("KMB",1.48), pct("KVUE",1.42),
  ]},
  AMDWX: { asOf: "2026-07-01", holdings: [
    pct("B",5.48), pct("KRX:005930",5.38), pct("2308.TT",5.10), pct("SCCO",4.55), pct("TSM",4.44),
    pct("SQM",4.31), pct("JBL",3.89), pct("RIO",3.83), pct("ASML",3.50), pct("WEGE3.BZ",3.49),
    pct("KIMBERA",3.03), pct("UL",2.97), pct("MPWR",2.94), pct("UTCEM.IN",2.87), pct("BIMAS.TI",2.82),
    pct("APAT.IN",2.78), pct("CLS",2.78), pct("MER",2.72), pct("IHH",2.64), pct("QCOM",2.56),
    pct("STC.AB",2.52), pct("2395",2.46), pct("BDMS-R",2.15), pct("DABUR.IN",1.93), pct("ALINMA.AB",1.91),
  ]},
  AMAPX: { asOf: "2026-07-01", holdings: [
    pct("EQPCKW",3.40), pct("ENEDEV",3.13), pct("TURKSK",2.93), pct("AERCAP",2.81), pct("TABRED",2.57),
    pct("AL",2.56), pct("ALMARA",2.52), pct("DARALA",2.44), pct("ARAMCO",2.30), pct("DAMACR",2.25),
    pct("MAFUAE",2.23), pct("TNBMK",2.15), pct("DPWDU",2.08), pct("ALDAR",1.96), pct("EMAAR",1.95),
    pct("AXIATA",1.84), pct("OMANGS",1.75), pct("DIBUH",1.71), pct("KNBZMK",1.69), pct("AJMNSS",1.69),
    pct("STCAB",1.65), pct("MAADEN",1.64), pct("BOUSUK",1.52), pct("BSFR",1.34),
  ]},
  // Wahed Dow Jones Islamic World (ex-US developed) — foreign lines; normTicker
  // strips the exchange prefix so Samsung/SK hynix/ASML/TSM match SPWO & AMDWX.
  UMMA: { asOf: "2026-07-01", holdings: [
    pct("KRX:005930",8.10), pct("KRX:000660",7.16), pct("TSM",5.55), pct("AMS:ASML",4.72), pct("ETR:IFX",3.98),
    pct("TYO:6981",3.49), pct("TSX:CSU",3.26), pct("TYO:8035",3.09), pct("LON:AZN",3.01), pct("SWX:ROP",3.00),
    pct("SWX:NOVN",2.74), pct("LON:ULVR",2.56), pct("SWX:NESN",2.42), pct("ASX:BHP",1.95), pct("EPA:SU",1.58),
    pct("SWX:ABBN",1.53), pct("ETR:SAP",1.49), pct("CPH:NOVO.B",1.42), pct("TYO:6857",1.29), pct("ETR:ENR",1.29),
    pct("TYO:6501",1.24), pct("EPA:AI",1.20), pct("SWX:CFR",1.13), pct("LON:GSK",1.09), pct("TYO:6098",1.04),
  ]},
  // SP Funds S&P World (ex-US) — heavy TSM/Samsung/ASML concentration.
  SPWO: { asOf: "2026-07-01", holdings: [
    pct("TSM",20.59), pct("KRX:005930",4.80), pct("KRX:000660",4.28), pct("AMS:ASML",3.50), pct("BABA",2.53),
    pct("TPE:2454",2.37), pct("RHHBY",1.37), pct("LON:AZN",1.37), pct("NVSN.MX",1.36), pct("TPE:2308",1.32),
    pct("NSRGY",1.28), pct("TOELY",1.03), pct("BHP",0.99), pct("SBGSY",0.82), pct("SWX:ABBN",0.79),
    pct("SAP",0.78), pct("NVO",0.73), pct("PDD",0.71), pct("UMC",0.69), pct("SMERY",0.65),
    pct("ATEYY",0.65), pct("MRAAY",0.64), pct("UL",0.64), pct("AIQUY",0.62),
  ]},
  // SP Funds S&P Global Technology — a tech tilt, heavy overlap with SPUS's tech.
  SPTE: { asOf: "2026-07-01", holdings: [
    pct("TSM",12.72), pct("NVDA",11.24), pct("AAPL",10.99), pct("MSFT",7.25), pct("ASML",6.61),
    pct("AVGO",4.44), pct("2454",4.39), pct("MU",2.95), pct("2308",2.41), pct("AMD",2.24),
    pct("TOELY",1.95), pct("SAP",1.48), pct("AMAT",1.31), pct("SHOP",1.27), pct("UMC",1.26),
    pct("ATEYY",1.26), pct("LRCX",1.24), pct("MRAAY",1.21), pct("CSCO",1.17), pct("IFNNY",1.08),
    pct("6861",0.91), pct("KLAC",0.88), pct("SNDK",0.76), pct("PANW",0.72), pct("TXN",0.69),
  ]},
  // SP Funds S&P Global REIT (Sharia) — real estate; distinct from the equity ETFs.
  SPRE: { asOf: "2026-07-01", holdings: [
    pct("WELL",13.66), pct("EQIX",11.88), pct("ASX:GMG",11.84), pct("PLD",11.69), pct("EGP",5.15),
    pct("MAA",5.15), pct("ELS",5.09), pct("TRNO",5.08), pct("SUI",4.89), pct("WY",4.71),
    pct("ASX:CHC",4.58), pct("KLSE:IGBREIT",2.76), pct("PEKGY.E.IS",2.69), pct("KLSE:AXREIT",2.27), pct("SGX:8C8U",2.14),
    pct("RCR.PM",1.74), pct("DUBAIRESI.DB",1.74), pct("FRMI",0.65), pct("SITC",0.60), pct("BKK:IMPACT",0.55),
  ]},
  // SP Funds Dow Jones Global Sukuk — bond-level sukuk aggregated by ISSUER (the
  // raw holdings are per-tranche CUSIPs that never cross-match; issuer buckets let
  // it partially compare to AMAPX on ARAMCO/OMANGS). Sukuk vs equity = not comparable.
  SPSK: { asOf: "2026-07-02", holdings: [
    pct("KSA",12.82), pct("ISDB",4.59), pct("PIFKSA",3.64), pct("QATAR",1.70), pct("ARAMCO",1.56),
    pct("INDOIS",1.02), pct("OMANGS",0.99),
  ]},
};

// ── Alpha Vantage ETF_PROFILE parser ─────────────────────────────────────────
// Response shape (verified against QQQ): { holdings:[{symbol,description,weight}],
// sectors:[{sector,weight}], net_expense_ratio, ... } with weight as a fraction
// string. Returns null on an unrecognized / empty payload so the caller can fall
// back to curated data.
export function parseAlphaVantageProfile(raw) {
  if (!raw || typeof raw !== "object") return null;
  const list = Array.isArray(raw.holdings) ? raw.holdings : null;
  if (!list || list.length === 0) return null;
  const holdings = list
    .map((h) => ({
      symbol: normTicker(h.symbol),
      weight: Number(h.weight),
      description: h.description || "",
    }))
    .filter((h) => h.symbol && Number.isFinite(h.weight) && h.weight > 0);
  if (holdings.length === 0) return null;
  const sectors = Array.isArray(raw.sectors)
    ? raw.sectors
        .map((s) => ({ sector: s.sector || "", weight: Number(s.weight) }))
        .filter((s) => s.sector && Number.isFinite(s.weight))
    : null;
  return { holdings, sectors, expenseRatio: Number(raw.net_expense_ratio) || null };
}

// ── Overlap engine (pure) ────────────────────────────────────────────────────
// Given two { symbol, holdings:[{symbol,weight}] } records, returns the shared
// tickers and the weight-overlap metric. overlapPct is Σ min(wA, wB) — the share
// of each portfolio that is effectively duplicated by the other.
export function overlapPair(a, b) {
  const mapB = new Map((b.holdings || []).map((h) => [normTicker(h.symbol), h.weight]));
  const shared = [];
  let overlapWeight = 0;
  for (const h of a.holdings || []) {
    const key = normTicker(h.symbol);
    if (mapB.has(key)) {
      const wB = mapB.get(key);
      const m = Math.min(h.weight, wB);
      overlapWeight += m;
      shared.push({ symbol: key, weightA: h.weight, weightB: wB, min: m });
    }
  }
  shared.sort((x, y) => y.min - x.min);
  const sumA = (a.holdings || []).reduce((s, h) => s + h.weight, 0) || 1;
  const sumB = (b.holdings || []).reduce((s, h) => s + h.weight, 0) || 1;
  return {
    a: a.symbol,
    b: b.symbol,
    overlapPct: overlapWeight,            // 0..1
    sharedCount: shared.length,
    shared,                               // sorted by shared weight desc
    uniquePctA: Math.max(0, 1 - overlapWeight / sumA),
    uniquePctB: Math.max(0, 1 - overlapWeight / sumB),
    comparable: a.assetClass === b.assetClass, // equity vs sukuk → not comparable
  };
}

// All pairwise overlaps for a selection of 2+ holdings records.
export function overlapMatrix(records) {
  const pairs = [];
  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      pairs.push(overlapPair(records[i], records[j]));
    }
  }
  return pairs;
}
