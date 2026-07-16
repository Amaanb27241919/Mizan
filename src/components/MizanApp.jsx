import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { AreaChart, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useAuth } from "../lib/auth.jsx";
import { apiFetch, recordAudit } from "../lib/apiFetch.js";
import { persistUserState } from "../lib/userState.js";
import { downloadCSV } from "../lib/exportCSV.js";
import {
  computeZakatWorksheet, nisabValueFor,
  NISAB_GOLD_USD, NISAB_SILVER_USD, DEFAULT_ZAKAT_SETTINGS,
  DEFAULT_ZAKAT_WORKSHEET, ZAKAT_ASSET_FIELDS, ZAKAT_LIABILITY_FIELDS,
} from "../lib/zakat.js";
import { isSubscriptionCandidate, isRecurringActive, detectFixedPriceSubscriptions, detectUsageBasedSpend, normalizeMerchant } from "../lib/recurring.js";
import { useKeyboard, ShortcutHelp } from "../lib/useKeyboard.js";
import { CommandPalette, useCommandPalette } from "./CommandPalette.jsx";
import { Icon, ICONS } from "./Icon.jsx";
import { Skeleton, SkeletonCard, SkeletonTable } from "./Skeleton.jsx";
import Goals, { GoalsOverviewWidget } from "./Goals.jsx";
import PerformancePanel from "./PerformancePanel.jsx";
import ComingSoon from "./ComingSoon.jsx";
import ConnectionHealth from "./ConnectionHealth.jsx";
import BugReportButton from "./BugReportButton.jsx";
import PriceChart from "./charts/PriceChart.jsx";
import { tradesForSymbol } from "./charts/holdingsOverlay.js";

/* ─── DESIGN TOKENS ──────────────────────────────────── */
// Editorial-finance palette: dark forest base, gold primary, warm paper text.
// Halal-screened status colors follow Islamic jurisprudence conventions:
//   jade → compliant, rust → non-compliant, amber → verify/warn,
//   slate → unscreened, violet → crypto.
const T = {
  bg:"var(--mz-bg)", surface:"var(--mz-surface)", card:"var(--mz-card)",
  tileFill:"var(--mz-tile-fill)",   // translucent bento fill — lets the canvas watermark read through
  border:"var(--mz-border)", borderHi:"var(--mz-borderHi)",
  blue:"#1e4e8c",  blueDim:"#15396b",    // navy — primary accent, active chips, links, CTAs
  gold:"#b8842a",  goldDim:"#8a6218",    // amber — zakat, warnings, secondary
  gain:"#117a52",  gainBg:"var(--mz-gainBg)",  // green — compliant / up
  loss:"#b23a3d",  lossBg:"var(--mz-lossBg)",  // red — non-compliant / loss
  slate:"#6b7b88",   // unscreened holdings
  violet:"#7e6ba8",  // crypto holdings
  text:"var(--mz-text)", textHi:"var(--mz-textHi)",
  muted:"var(--mz-muted)", dim:"var(--mz-dim)",
  shadow:"var(--mz-shadow)", glass:"var(--mz-glass)",
  s1:"var(--s-1)", s2:"var(--s-2)", s3:"var(--s-3)", s4:"var(--s-4)",
  s5:"var(--s-5)", s6:"var(--s-6)", s8:"var(--s-8)", s10:"var(--s-10)",
  s12:"var(--s-12)",
  rSm:"var(--r-sm)", rMd:"var(--r-md)", rLg:"var(--r-lg)",
};
const THEME_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;1,9..144,300;1,9..144,400&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@300;400;500&display=swap');

  :root, :root[data-theme="light"] {
    /* Paper-canvas light theme — primary brand face */
    --mz-bg: #faf8f4; --mz-surface: #ffffff; --mz-card: #ffffff;
    --mz-border: #e8e2d6; --mz-borderHi: #d2cabb;
    --mz-text: #44413b; --mz-textHi: #1c1b19;
    --mz-muted: #87827a; --mz-dim: #efebe3;
    --mz-gainBg: #e7f3ec; --mz-lossBg: #fbeceb;
    --mz-shadow: 0 1px 0 rgba(255,255,255,0.8) inset, 0 6px 20px rgba(28,27,25,0.06);
    /* Glass material — light theme variants */
    --mz-glass: rgba(250,248,244,0.72);
    --mz-glass-strong: rgba(255,253,250,0.93);
    --mz-glass-border: rgba(210,202,187,0.60);
    --mz-glass-shadow: inset 0 1px 0 0 rgba(255,255,255,0.75), inset 0 -1px 0 0 rgba(0,0,0,0.04), 0 8px 32px rgba(0,0,0,0.09);
    --mz-glass-shadow-lg: inset 0 1px 0 0 rgba(255,255,255,0.75), inset 0 -1px 0 0 rgba(0,0,0,0.04), 0 20px 60px rgba(0,0,0,0.14);
    /* Bento tile depth — soft, layered (light theme tuned: gentle, not harsh) */
    --mz-tile: 0 1px 2px rgba(28,27,25,0.04), 0 6px 20px rgba(28,27,25,0.06);
    --mz-tile-hover: 0 4px 10px rgba(30,78,140,0.07), 0 16px 40px rgba(28,27,25,0.10);
    /* Translucent bento fill — slightly see-through so the ميزان watermark reads behind */
    --mz-tile-fill: rgba(255,255,255,0.74);
    color-scheme: light;
  }
  :root[data-theme="dark"] {
    /* Midnight-navy dark theme — the cool inverse of the warm paper light face,
       built on the brand navy accent (not the old warm "ink" brown). */
    --mz-bg: #0e1626; --mz-surface: #16213a; --mz-card: #1c2945;
    --mz-border: #2b3a57; --mz-borderHi: #3d4f70;
    --mz-text: #bcc4d4; --mz-textHi: #f4f2ec;
    --mz-muted: #828ca0; --mz-dim: #2b3a57;
    --mz-gainBg: #0f2b1e; --mz-lossBg: #2c1622;
    --mz-shadow: 0 1px 0 rgba(255,255,255,0.05) inset, 0 8px 28px rgba(0,0,0,0.55);
    /* Glass material — chrome elements only (nav, modals, overlays) */
    --mz-glass: rgba(14,22,38,0.68);
    --mz-glass-strong: rgba(14,22,38,0.92);
    --mz-glass-border: rgba(61,79,112,0.60);
    --mz-glass-shadow: inset 0 1px 0 0 rgba(255,255,255,0.06), inset 0 -1px 0 0 rgba(0,0,0,0.28), 0 8px 32px rgba(0,0,0,0.45);
    --mz-glass-shadow-lg: inset 0 1px 0 0 rgba(255,255,255,0.06), inset 0 -1px 0 0 rgba(0,0,0,0.28), 0 20px 60px rgba(0,0,0,0.60);
    /* Bento tile depth — layered, deeper for the navy theme */
    --mz-tile: 0 1px 2px rgba(0,0,0,0.32), 0 8px 28px rgba(0,0,0,0.48);
    --mz-tile-hover: 0 6px 16px rgba(0,0,0,0.52), 0 22px 50px rgba(0,0,0,0.62);
    /* Translucent bento fill — slightly see-through so the ميزان watermark reads behind */
    --mz-tile-fill: rgba(28,41,69,0.72);
    color-scheme: dark;
  }
  :root {
    --s-1: 4px;  --s-2: 8px;  --s-3: 12px; --s-4: 16px;
    --s-5: 20px; --s-6: 24px; --s-8: 32px; --s-10: 40px;
    --s-12: 48px;
    --r-sm: 6px; --r-md: 10px; --r-lg: 14px;
    --sh-sm: 0 1px 2px rgba(0,0,0,0.08);
    --sh-md: 0 4px 14px rgba(0,0,0,0.18);
    --sh-lg: 0 12px 36px rgba(0,0,0,0.32);
  }
  /* Ambient glows — navy top-right, green bottom-left — subtle depth on canvas/ink */
  body::before{content:"";position:fixed;top:-30%;right:-20%;width:60%;height:60%;
    background:radial-gradient(ellipse,#1e4e8c0a 0%,transparent 65%);
    pointer-events:none;z-index:0;}
  body::after{content:"";position:fixed;bottom:-20%;left:-15%;width:50%;height:50%;
    background:radial-gradient(ellipse,#117a5208 0%,transparent 65%);
    pointer-events:none;z-index:0;}
  /* Film grain — sits in the canvas behind all content (same z-layer as the
     glows above), pointer-events none. Subtle (3%) so dashboard numbers stay
     crisp. Uses html::before since body::before/::after are the glows. */
  html::before{content:"";position:fixed;inset:0;pointer-events:none;z-index:0;opacity:0.03;
    background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    background-size:140px 140px;}
  @media (prefers-reduced-motion: reduce){ html::before{display:none;} }
  /* Base body font — elements without explicit fontFamily inherit IBM Plex Sans */
  body{font-family:'IBM Plex Sans',system-ui,-apple-system,sans-serif;}

  /* ─── LIQUID GLASS UTILITIES ──────────────────────────────────────────────
     Apply ONLY to chrome: nav bars, modals, overlays, tooltips, input bars.
     NEVER on data tables, charts, or stat cards — glass kills legibility. */

  /* Base glass — nav bars, tab bars, floating chrome */
  .glass {
    background: var(--mz-glass);
    backdrop-filter: blur(24px) saturate(180%);
    -webkit-backdrop-filter: blur(24px) saturate(180%);
    border: 1px solid var(--mz-glass-border);
    box-shadow: var(--mz-glass-shadow);
  }
  /* Strong glass — modals and sheets where background must be obscured */
  .glass-strong {
    background: var(--mz-glass-strong);
    backdrop-filter: blur(40px) saturate(180%);
    -webkit-backdrop-filter: blur(40px) saturate(180%);
    border: 1px solid var(--mz-glass-border);
    box-shadow: var(--mz-glass-shadow-lg);
  }
  /* Graceful degradation when backdrop-filter is unsupported */
  @supports not (backdrop-filter: blur(1px)) {
    .glass { background: var(--mz-surface); border-color: var(--mz-border); box-shadow: var(--sh-md); }
    .glass-strong { background: var(--mz-card); border-color: var(--mz-borderHi); box-shadow: var(--sh-lg); }
  }

  /* Dock inactive tab: subtle glass brightening + gentle lift on hover */
  .dock-off:hover {
    background: rgba(255,255,255,0.07) !important;
    transform: scale(1.05) !important;
    color: var(--mz-textHi) !important;
  }
  :root[data-theme="light"] .dock-off:hover {
    background: rgba(0,0,0,0.06) !important;
  }

  /* Modal entry animation — blur-in from 0→40px, card slides up */
  @keyframes glassOverlayIn {
    from { opacity: 0; backdrop-filter: blur(0px); -webkit-backdrop-filter: blur(0px); }
    to   { opacity: 1; backdrop-filter: blur(24px) saturate(160%); -webkit-backdrop-filter: blur(24px) saturate(160%); }
  }
  @keyframes glassFadeUp {
    from { opacity: 0; transform: translateY(16px) scale(0.97); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }

  /* Reduced-motion: disable transforms and animations */
  @media (prefers-reduced-motion: reduce) {
    .dock-off:hover { transform: none !important; }
    .glass, .glass-strong { transition: none !important; }
    * { animation-duration: 0.01ms !important; }
  }
`;
// Fraunces (serif display) — big titles, section headings, card titles, stat numbers
const FU = "'Fraunces','Georgia','Times New Roman',serif";
// IBM Plex Sans — all paragraph / description / body text
const FP = "'IBM Plex Sans',system-ui,-apple-system,BlinkMacSystemFont,sans-serif";
// IBM Plex Mono — every label, ticker symbol, chip, eyebrow, meta tag, number
const FM = "'IBM Plex Mono','JetBrains Mono','Menlo','Monaco',monospace";
const GF = ""; // unused shim

/* ─── DATA ───────────────────────────────────────────── */
const HOLDINGS = [
  {tk:"SPUS", nm:"SP Funds S&P 500 Sharia",  sh:62.398,ac:44.20,px:55.57, ty:"ETF",  sh_:"halal", ac_:"Roth IRA",  br:"Fidelity"},
  {tk:"UMMA", nm:"Wahed Islamic World ETF",   sh:72.263,ac:28.50,px:35.78, ty:"ETF",  sh_:"halal", ac_:"Roth IRA",  br:"Fidelity"},
  {tk:"AMAGX",nm:"Amana Growth Fund",         sh:54.753,ac:88.00,px:105.60,ty:"Fund", sh_:"halal", ac_:"Roth IRA",  br:"Fidelity"},
  {tk:"SPRE", nm:"SP Funds REIT Sharia",      sh:32.457,ac:19.80,px:21.25, ty:"ETF",  sh_:"halal", ac_:"Roth IRA",  br:"Fidelity"},
  {tk:"SPSK", nm:"SP Funds Global Sukuk",     sh:41.695,ac:17.20,px:18.07, ty:"ETF",  sh_:"halal", ac_:"Roth IRA",  br:"Fidelity"},
  {tk:"HLAL", nm:"Wahed FTSE USA Shariah",    sh:19.456,ac:58.00,px:68.93, ty:"ETF",  sh_:"halal", ac_:"Roth IRA",  br:"Fidelity"},
  {tk:"NVDA", nm:"Nvidia Corp.",              sh:13.02, ac:142.0,px:213.00,ty:"Stock",sh_:"halal", ac_:"Robinhood", br:"Robinhood"},
  {tk:"TSLA", nm:"Tesla Inc.",                sh:4.80,  ac:310.0,px:406.01,ty:"Stock",sh_:"halal", ac_:"Robinhood", br:"Robinhood"},
  {tk:"AAPL", nm:"Apple Inc.",                sh:3.60,  ac:195.0,px:289.48,ty:"Stock",sh_:"halal", ac_:"Robinhood", br:"Robinhood"},
  {tk:"MSFT", nm:"Microsoft Corp.",           sh:1.79,  ac:380.0,px:424.00,ty:"Stock",sh_:"halal", ac_:"Robinhood", br:"Robinhood"},
  {tk:"AMD",  nm:"Advanced Micro Devices",    sh:1.59,  ac:280.0,px:405.93,ty:"Stock",sh_:"halal", ac_:"Robinhood", br:"Robinhood"},
  {tk:"AMZN", nm:"Amazon.com Inc.",           sh:1.10,  ac:220.0,px:271.52,ty:"Stock",sh_:"halal", ac_:"Robinhood", br:"Robinhood"},
  {tk:"ARM",  nm:"Arm Holdings",              sh:2.04,  ac:185.0,px:212.69,ty:"Stock",sh_:"halal", ac_:"Robinhood", br:"Robinhood"},
  {tk:"AVGO", nm:"Broadcom Inc.",             sh:1.00,  ac:380.0,px:419.02,ty:"Stock",sh_:"halal", ac_:"Robinhood", br:"Robinhood"},
  {tk:"DELL", nm:"Dell Technologies",         sh:1.01,  ac:195.0,px:230.32,ty:"Stock",sh_:"halal", ac_:"Robinhood", br:"Robinhood"},
  {tk:"TSM",  nm:"Taiwan Semiconductor",      sh:2.14,  ac:185.0,px:411.86,ty:"Stock",sh_:"review",ac_:"Robinhood", br:"Robinhood"},
  {tk:"PLTR", nm:"Palantir Technologies",     sh:1.76,  ac:95.0, px:138.23,ty:"Stock",sh_:"review",ac_:"Robinhood", br:"Robinhood"},
  {tk:"ORCL", nm:"Oracle Corp.",              sh:1.64,  ac:160.0,px:194.26,ty:"Stock",sh_:"review",ac_:"Robinhood", br:"Robinhood"},
  {tk:"INTC", nm:"Intel Corp.",               sh:5.67,  ac:42.0, px:111.14,ty:"Stock",sh_:"review",ac_:"Robinhood", br:"Robinhood"},
  {tk:"SMCI", nm:"Super Micro Computer",      sh:14.23, ac:38.0, px:34.14, ty:"Stock",sh_:"review",ac_:"Robinhood", br:"Robinhood"},
  {tk:"LCID", nm:"Lucid Motors",              sh:10.33, ac:12.0, px:6.06,  ty:"Stock",sh_:"haram", ac_:"Robinhood", br:"Robinhood"},
  {tk:"RIVN", nm:"Rivian Automotive",         sh:27.54, ac:18.0, px:14.37, ty:"Stock",sh_:"haram", ac_:"Robinhood", br:"Robinhood"},
  {tk:"VLXVX",nm:"Vanguard Target 2065",      sh:10.969,ac:40.00,px:43.82, ty:"Fund", sh_:"review",ac_:"401(k)",    br:"Empower"},
];

const ACCOUNTS=[
  {id:"fid-roth", nm:"Fidelity — Roth IRA",  val:15372.64,type:"Roth IRA",color:T.blue},
  {id:"robinhood",nm:"Robinhood — Taxable",   val:12816.32,type:"Taxable", color:T.gain},
  {id:"coinbase", nm:"Coinbase — Crypto",     val:1455.43, type:"Crypto",  color:T.gold},
  {id:"gmf",      nm:"GMF 401(k)",            val:480.66,  type:"401(k)",  color:"#7C3AED"},
  {id:"schwab",   nm:"Charles Schwab",         val:0,       type:"Taxable", color:T.muted,note:"Opens 5/15"},
];

const SADAQAH=[
  {dt:"2022-04-29",org:"Islamic Foundation",  amt:500,   done:true},
  {dt:"2023-12-11",org:"ISNS",                amt:2000,  done:true},
  {dt:"2024-04-08",org:"Masjid An-Noor",      amt:1000,  done:true},
  {dt:"2024-04-09",org:"Muhsen",              amt:250,   done:true},
  {dt:"2025-05-30",org:"Qalam",               amt:52,    done:true},
  {dt:"2026-02-23",org:"ISNS",                amt:1000,  done:true},
  {dt:"2026-03-19",org:"Masjid Uthman",       amt:500,   done:true},
  {dt:"Pledge",    org:"Helping Hand",         amt:1300,  done:false},
  {dt:"Pledge",    org:"ISNS",                 amt:2000,  done:false},
  {dt:"Pledge",    org:"Masjid Uthman",        amt:5000,  done:false},
];

const ETF_LIST=[
  {tk:"SPUS", nm:"SP Funds S&P 500 Sharia",   cat:"U.S. Equity", exp:"0.49%",div:"~0.9%", freq:"Quarterly",min:"$1",    avail:true},
  {tk:"HLAL", nm:"Wahed FTSE USA Shariah",     cat:"U.S. Equity", exp:"0.50%",div:"~1.0%", freq:"Quarterly",min:"$1",    avail:true},
  {tk:"UMMA", nm:"Wahed Islamic World",        cat:"Global",       exp:"0.65%",div:"~0.7%", freq:"Semi-Ann.",min:"$1",    avail:true},
  {tk:"SPSK", nm:"SP Funds Global Sukuk",      cat:"Sukuk",        exp:"0.55%",div:"~4.0%", freq:"Monthly",  min:"$1",    avail:true},
  {tk:"SPRE", nm:"SP Funds REIT Sharia",       cat:"Real Estate",  exp:"0.55%",div:"~1.7%", freq:"Quarterly",min:"$1",    avail:true},
  {tk:"SPTE", nm:"SP Funds Global Tech",       cat:"Technology",   exp:"0.55%",div:"~0.4%", freq:"Quarterly",min:"$1",    avail:true},
  {tk:"AMAGX",nm:"Amana Growth Fund",          cat:"Mutual Fund",  exp:"1.02%",div:"~0.7%", freq:"Annual",   min:"$2,500",avail:false},
  {tk:"AMANX",nm:"Amana Income Fund",          cat:"Mutual Fund",  exp:"1.12%",div:"~2.1%", freq:"Quarterly",min:"$2,500",avail:false},
  {tk:"AMAPX",nm:"Amana Participation",        cat:"Mutual Fund",  exp:"0.89%",div:"~3.8%", freq:"Monthly",  min:"$2,500",avail:false},
];

// Generic broker catalog. NO `mine:true` flags or owner-specific descriptions
// — every user sees the same neutral list, and `Connected` status is derived
// from their own SnapTrade `mizan_brokers` localStorage entry.
const BROKERS=[
  {id:"FIDELITY", nm:"Fidelity",     desc:"Brokerage & retirement"},
  {id:"ROBINHOOD",nm:"Robinhood",    desc:"Commission-free brokerage"},
  {id:"SCHWAB",   nm:"Schwab",       desc:"Brokerage & retirement"},
  {id:"EMPOWER",  nm:"Empower",      desc:"401(k) & retirement"},
  {id:"COINBASE", nm:"Coinbase",     desc:"Crypto wallet"},
  {id:"CHASE",    nm:"Chase",        desc:"J.P. Morgan Self-Directed"},
  {id:"ETRADE",   nm:"E*Trade",      desc:"Commission-free"},
  {id:"VANGUARD", nm:"Vanguard",     desc:"Index funds"},
  {id:"ALPACA",   nm:"Alpaca",       desc:"Algo trading"},
  {id:"WEBULL",   nm:"Webull",       desc:"Fractional shares"},
];

/* ─── DEMO ACCOUNTS (real tickers, real brokers, expanded book) ─── */
// 8-figure persona. Real tickers and real broker names so prices/news look
// natural, but the *combination* of accounts and positions is invented and
// expanded — not a mirror of any one user's actual portfolio.
const _pos = (tk,nm,sh,ac,px,ty="Stock") => ({
  symbol: { symbol: tk, description: nm, type: ty },
  units: sh, price: px, average_purchase_price: ac,
});
const DEMO_ACCOUNTS = [
  // A believable mid-career Muslim professional (~$264k invested across
  // retirement + taxable + crypto). Share counts are realistic for this net-worth
  // band; the mix intentionally spans halal / review / haram so the screener,
  // purification, and rebalancer all have something to show.
  { accountId:"d-empower-401k", accountName:"401(k) Plan", brokerage:"Empower Retirement", brokerageSlug:"EMPOWER",
    balance:113_506.40, cash:1_400.00, positions:[
      _pos("VLXVX","Vanguard Target 2065",         1_320.0,  28.00,  43.82,"Fund"),
      _pos("VTSAX","Vanguard Total Stock Mkt Adm",   380.0,  92.00, 142.80,"Fund"),
    ] },
  { accountId:"d-vg-roth", accountName:"Roth IRA", brokerage:"Vanguard", brokerageSlug:"VANGUARD",
    balance:44_150.10, cash:900.00, positions:[
      _pos("VTI",  "Vanguard Total Stock Mkt ETF",     42.0, 180.00, 295.40,"ETF"),
      _pos("HLAL", "Wahed FTSE USA Shariah",          210.0,  58.00,  68.93,"ETF"),
      _pos("AMAGX","Amana Growth Fund",               155.0,  88.00, 105.60,"Fund"),
    ] },
  { accountId:"d-fid-taxable", accountName:"Individual Brokerage", brokerage:"Fidelity", brokerageSlug:"FIDELITY",
    balance:58_011.12, cash:1_100.00, positions:[
      _pos("VOO",  "Vanguard S&P 500 ETF",             38.0, 340.00, 522.40,"ETF"),
      _pos("SPUS", "SP Funds S&P 500 Sharia",         240.0,  44.20,  55.57,"ETF"),
      _pos("AAPL", "Apple Inc.",                        34.0, 142.00, 289.48),
      _pos("MSFT", "Microsoft Corp.",                   18.0, 275.00, 424.00),
      _pos("NVDA", "Nvidia Corp.",                      14.0,  88.00, 213.00),
      // Mixed compliance — non-halal positions surface in the screener
      _pos("JPM",  "JPMorgan Chase & Co.",               8.0, 165.00, 248.30),
      _pos("MO",   "Altria Group Inc.",                 22.0,  42.00,  58.20),
    ] },
  { accountId:"d-rh-active", accountName:"Active Brokerage", brokerage:"Robinhood", brokerageSlug:"ROBINHOOD",
    balance:15_686.54, cash:700.00, positions:[
      _pos("TSLA", "Tesla Inc.",                        12.0, 210.00, 406.01),
      _pos("AMD",  "Advanced Micro Devices",             8.0, 140.00, 405.93),
      _pos("PLTR", "Palantir Technologies",             26.0,  38.00, 138.23),
      _pos("NVDA", "Nvidia Corp.",                       6.0,  88.00, 213.00),
      _pos("WYNN", "Wynn Resorts Ltd.",                 14.0, 110.00, 142.50),
    ] },
  { accountId:"d-cb-prime", accountName:"Crypto", brokerage:"Coinbase", brokerageSlug:"COINBASE",
    balance:11_939.40, cash:0, positions:[
      _pos("BTC",  "Bitcoin",                          0.110, 32_400.00, 82_400.00,"Crypto"),
      _pos("ETH",  "Ethereum",                         0.850,  1_640.00,  2_640.00,"Crypto"),
      _pos("SOL",  "Solana",                           3.500,     62.00,    180.40,"Crypto"),
    ] },
  { accountId:"d-schwab-ind", accountName:"Dividend Portfolio", brokerage:"Charles Schwab", brokerageSlug:"SCHWAB",
    balance:21_046.40, cash:600.00, positions:[
      _pos("SCHD", "Schwab US Dividend ETF",           120.0,  72.00,  84.20,"ETF"),
      _pos("VYM",  "Vanguard High Dividend Yield",      48.0,  92.00, 128.40,"ETF"),
      _pos("VOO",  "Vanguard S&P 500 ETF",               8.0, 340.00, 522.40,"ETF"),
    ] },
];
// Enforce the real-brokerage invariant `balance === cash + Σ(position market
// value)` on the demo fixtures. Real SnapTrade accounts always satisfy this;
// the hand-authored literals above drifted from it, which made Net Worth (built
// from balance) disagree with Allocation / Market Value / the Performance panel
// (built from positions). Deriving balance here keeps every downstream metric
// reconciled and can't drift when positions are edited. Runs before
// DEMO_ACTIVITIES, whose contribution amounts are sized off balance.
DEMO_ACCOUNTS.forEach(a => {
  const posMV = (a.positions || []).reduce((s, p) => s + (p.price || 0) * (p.units || 0), 0);
  a.balance = Math.round(((a.cash || 0) + posMV) * 100) / 100;
});
// Net ~$264k invested across 6 accounts (Empower 401k, Vanguard Roth, Fidelity
// taxable, Robinhood, Coinbase, Schwab). Tag the demo's tickers so the screener
// doesn't show every position as "Review".
// Demo transaction history — multi-year buys, sells, quarterly dividends,
// monthly contributions, occasional withdrawals + fees per account.
const DEMO_ACTIVITIES = (() => {
  const out = [];
  const now = new Date();
  const dt = (daysBack) => {
    const d = new Date(now); d.setDate(d.getDate() - daysBack);
    return d.toISOString().slice(0, 10);
  };
  const push = (o) => out.push({ id: `d-act-${out.length}`, currency: { code: "USD" }, ...o });

  DEMO_ACCOUNTS.forEach(acct => {
    const acctRef = { id: acct.accountId, name: acct.accountName };
    const inst    = acct.brokerage;

    // Initial big deposit ~5 years ago
    push({
      trade_date: dt(1700 + Math.floor(Math.random()*60)), type: "DEPOSIT",
      symbol: null, units: null, price: null,
      amount: Math.round(acct.balance * 0.55 / 100) * 100,
      account: acctRef, institution_name: inst,
    });
    // Monthly contributions, last 36 months — smaller, regular
    for (let m = 36; m >= 1; m--) {
      if (Math.random() > 0.85) continue; // skip ~15% of months
      push({
        trade_date: dt(m * 30 + Math.floor(Math.random()*5)), type: "DEPOSIT",
        symbol: null, units: null, price: null,
        amount: Math.round(acct.balance * 0.005 / 100) * 100 + 500,
        account: acctRef, institution_name: inst,
      });
    }
    // Occasional withdrawal
    if (Math.random() > 0.5) {
      push({
        trade_date: dt(120 + Math.floor(Math.random()*200)), type: "WITHDRAWAL",
        symbol: null, units: null, price: null,
        amount: -Math.round(acct.balance * 0.008 / 100) * 100,
        account: acctRef, institution_name: inst,
      });
    }
    // Annual fee
    push({
      trade_date: dt(60 + Math.floor(Math.random()*30)), type: "FEE",
      symbol: null, units: null, price: null,
      amount: -Math.round(Math.random() * 80 + 20),
      account: acctRef, institution_name: inst,
    });

    // Per-position lots
    acct.positions.forEach(p => {
      const tk = p.symbol.symbol;
      const sym = { symbol: tk };
      const isCrypto = p.symbol.type === "Crypto";
      // Initial buy ~3 years ago
      push({
        trade_date: dt(900 + Math.floor(Math.random()*200)), type: "BUY",
        symbol: sym, units: p.units * 0.6, price: p.average_purchase_price,
        amount: -p.units * 0.6 * p.average_purchase_price,
        account: acctRef, institution_name: inst,
      });
      // Add-on buy ~1 year ago
      push({
        trade_date: dt(280 + Math.floor(Math.random()*100)), type: "BUY",
        symbol: sym, units: p.units * 0.4,
        price: (p.average_purchase_price + p.price) / 2,
        amount: -p.units * 0.4 * (p.average_purchase_price + p.price) / 2,
        account: acctRef, institution_name: inst,
      });
      // Quarterly dividends, 8 quarters back (skip crypto)
      if (!isCrypto) {
        for (let q = 1; q <= 8; q++) {
          push({
            trade_date: dt(q * 90 + Math.floor(Math.random()*15)), type: "DIVIDEND",
            symbol: sym, units: 0, price: 0,
            amount: +(p.units * p.price * 0.0042).toFixed(2), // ~1.7% annual / 4
            account: acctRef, institution_name: inst,
          });
        }
      }
    });
  });

  return out.sort((a, b) => b.trade_date.localeCompare(a.trade_date));
})();

const DEMO_SHARIA = {
  AAPL:"halal", MSFT:"halal", NVDA:"halal", GOOGL:"review", META:"review",
  "BRK.B":"review", COST:"halal", HD:"halal", ASML:"halal", TSM:"review",
  V:"review", VOO:"review", QQQ:"review", SPUS:"halal", HLAL:"halal",
  VTI:"review", VXUS:"review", AMAGX:"halal",
  TSLA:"halal", AMD:"halal", AVGO:"halal", ARM:"halal", PLTR:"review",
  VLXVX:"review", VTSAX:"review",
  BTC:"halal", ETH:"halal", SOL:"halal",
  BABA:"halal", TM:"halal", UL:"review", LMT:"review", NOW:"halal",
  // Schwab Individual Brokerage
  SCHD:"review", SCHB:"review", UNH:"halal", LIN:"halal", ABBV:"halal",
  // Vanguard Joint Taxable
  VYM:"review", VUG:"review",
  // Webull Active Trading
  AMZN:"halal", CRM:"halal", SHOP:"halal", UBER:"halal", NET:"halal",
  // Non-compliant
  JPM:"haram", WYNN:"haram", MO:"haram", LCID:"haram",
  // BND is a bond fund — interest-bearing → haram
  BND:"haram",
};

/* ─── PLAID ACCOUNT TYPE CLASSIFICATION ──────────────────
 * Plaid /accounts returns: depository, credit, loan, investment, brokerage, other.
 * MIZAN treats Plaid as the BANKING data source and SnapTrade as the BROKERAGE
 * data source. Investment-type Plaid accounts are excluded from all bank-side
 * math (and from the Finances tab UI) so a user who links the same broker via
 * both providers never double-counts cash, positions, or balances.
 *   isBankAsset  → depository → counts as POSITIVE bank cash
 *   isBankDebt   → credit/loan → counts as NEGATIVE bank balance
 *   isBrokerage  → investment/brokerage → handled by SnapTrade, ignored by Plaid math
 */
const isBankAsset    = a => a?.type === "depository";
const isBankDebt     = a => a?.type === "credit" || a?.type === "loan";
const isBrokeragePlaid = a => a?.type === "investment" || a?.type === "brokerage";
// Retirement accounts among Plaid investment accounts — 401(k)/403(b)/457,
// IRA/Roth, pension, TSP, Keogh. Used to auto-fill the Zakat worksheet's
// retirement row (vested value is zakatable). Subtype strings come from Plaid
// (e.g. "401k", "roth", "ira", "403b", "pension").
const isRetirementPlaid = a =>
  isBrokeragePlaid(a) && /(401|403|457|\bira\b|roth|pension|retire|thrift|tsp|keogh)/i.test(`${a?.subtype || ""} ${a?.name || ""}`);

// Individual connected accounts eligible for the Zakat asset picker — the
// checklist the user ticks (like the Goals account picker). SnapTrade brokerage
// accounts + Plaid investment/retirement + Plaid depository (cash). Credit/loan
// accounts are liabilities and are intentionally left out — the user enters
// those in the worksheet's debt rows. Stable ids let the Zakat tab AND the
// Overview tile share one selection so their figures can't diverge.
function zakatConnectedAccounts(snapAccounts = [], plaidAccounts = []) {
  const list = [];
  for (const a of (Array.isArray(snapAccounts) ? snapAccounts : [])) {
    if (!a.accountId) continue;
    list.push({ id: `snap:${a.accountId}`, label: `${a.brokerage || "Broker"} — ${a.accountName || ""}`, balance: Number(a.balance) || 0, kind: "brokerage" });
  }
  for (const a of (Array.isArray(plaidAccounts) ? plaidAccounts : [])) {
    if (!a.account_id) continue;
    const id = `plaid:${a.account_id}`;
    const balance = Number(a.current_bal) || 0;
    const label = `${a.institution_name || "Bank"} — ${a.name || a.subtype || a.type || ""}`;
    if (isRetirementPlaid(a)) list.push({ id, label, balance, kind: "retirement" });
    else if (isBrokeragePlaid(a)) list.push({ id, label, balance, kind: "investment" });
    else if (a.type === "depository") list.push({ id, label, balance, kind: "cash" });
    // credit / loan intentionally skipped (liabilities, not zakatable assets)
  }
  return list.filter((a) => a.balance > 0);
}

// Category totals from the picker selection. `excludedIds` = the ids the user
// unticked. Investment-class (brokerage + retirement + investments) is summed
// separately from cash because the investment factor only scales the former.
function zakatSelectedTotals(accountList = [], excludedIds) {
  const ex = excludedIds instanceof Set ? excludedIds : new Set(excludedIds || []);
  const t = { brokerage: 0, retirement: 0, investOther: 0, cash: 0 };
  for (const a of accountList) {
    if (ex.has(a.id)) continue;
    if (a.kind === "brokerage") t.brokerage += a.balance;
    else if (a.kind === "retirement") t.retirement += a.balance;
    else if (a.kind === "investment") t.investOther += a.balance;
    else if (a.kind === "cash") t.cash += a.balance;
  }
  t.invest = t.brokerage + t.retirement + t.investOther;
  return t;
}

// Connected credit-card accounts eligible for the Zakat LIABILITY picker — the
// user ticks the card balances that count as deductible short-term debt (rent,
// utilities and card bills due now reduce zakatable wealth per the scholar
// calculators Mizan mirrors), untick any they don't. Only revolving credit is
// auto-suggested; long-term loans (auto / mortgage) stay manual in the
// "Long-term debt due" row because only the portion due this year is zakat-
// deductible. Balance is the absolute owed amount. Ids share the same
// `excludedAccounts` namespace as the asset picker (no collision — asset ids
// are depository/investment accounts, these are credit accounts).
function zakatCreditAccounts(plaidAccounts = []) {
  const list = [];
  for (const a of (Array.isArray(plaidAccounts) ? plaidAccounts : [])) {
    if (!a.account_id) continue;
    if (a.type !== "credit") continue;
    const balance = Math.abs(Number(a.current_bal) || 0);
    if (balance <= 0) continue;
    list.push({
      id: `plaid:${a.account_id}`,
      label: `${a.institution_name || "Card"} — ${a.name || a.subtype || "Credit card"}`,
      balance,
      kind: "credit",
    });
  }
  return list;
}

// Sum of ticked (non-excluded) connected credit-card balances — the auto
// short-term-debt deduction fed to computeZakatWorksheet.connectedLiabilities.
function zakatSelectedLiabilities(creditList = [], excludedIds) {
  const ex = excludedIds instanceof Set ? excludedIds : new Set(excludedIds || []);
  return creditList.reduce((s, a) => (ex.has(a.id) ? s : s + a.balance), 0);
}

/* ─── DEMO BANK FIXTURES (Plaid stand-in) ────────────── */
// Mirrors DEMO_ACCOUNTS pattern — used to populate the Finances tab when
// demoMode is on. No real API calls needed; everything is local fixture.
// Cash profile sized to match the ~$264k brokerage demo: ~$58k net cash across
// everyday checking, HYSA, sweep, a small card balance, and a business account.
const DEMO_BANK_ACCOUNTS = [
  // Ally — primary everyday banking (income lands here, giving goes out from here)
  { item_id:"d-jpm",   institution_name:"Ally Bank",         account_id:"d-jpm-1", name:"Interest Checking",     official_name:"Ally Interest Checking",       type:"depository", subtype:"checking", mask:"0142", current_bal:9_240.55,  available_bal:9_240.55,  iso_currency:"USD" },
  { item_id:"d-jpm",   institution_name:"Ally Bank",         account_id:"d-jpm-2", name:"Online Savings",        official_name:"Ally Online Savings",          type:"depository", subtype:"savings",  mask:"5588", current_bal:18_520.00, available_bal:18_520.00, iso_currency:"USD" },
  // Chase — day-to-day spending
  { item_id:"d-chase", institution_name:"Chase",             account_id:"d-chase-1", name:"Total Checking",      official_name:"Chase Total Checking",         type:"depository", subtype:"checking", mask:"4421", current_bal:4_180.32,  available_bal:4_180.32,  iso_currency:"USD" },
  { item_id:"d-chase", institution_name:"Chase",             account_id:"d-chase-2", name:"Sapphire Preferred",  official_name:"Chase Sapphire Preferred",     type:"credit",     subtype:"credit card",mask:"3344", current_bal:1_840.45,  available_bal:10_159.55, iso_currency:"USD" },
  // Marcus — high-yield reserve
  { item_id:"d-marcus",institution_name:"Marcus by Goldman", account_id:"d-marcus-1",name:"High-Yield Savings",   official_name:"Marcus HYSA",                  type:"depository", subtype:"savings",  mask:"7733", current_bal:14_500.20, available_bal:14_500.20, iso_currency:"USD" },
  // Fidelity Cash Management — sweep
  { item_id:"d-fid",   institution_name:"Fidelity",          account_id:"d-fid-1",   name:"Cash Management",      official_name:"Fidelity CMA",                 type:"depository", subtype:"checking", mask:"9012", current_bal:5_240.10,  available_bal:5_240.10,  iso_currency:"USD" },
  // Mercury — business banking for Halal Bites LLC
  { item_id:"d-merc",  institution_name:"Mercury",           account_id:"d-merc-1",  name:"Halal Bites LLC",      official_name:"Mercury Business Checking",    type:"depository", subtype:"checking", mask:"6720", current_bal:8_600.40,  available_bal:8_600.40,  iso_currency:"USD" },
];

const DEMO_TRANSACTIONS = (() => {
  const today = new Date();
  const dt = (n) => { const d = new Date(today); d.setDate(today.getDate() - n); return d.toISOString().slice(0, 10); };
  // account_id → item_id + institution lookup so we don't string-sniff prefixes.
  const acctMeta = {
    "d-jpm-1":   { item_id:"d-jpm",   inst:"Ally Bank" },
    "d-jpm-2":   { item_id:"d-jpm",   inst:"Ally Bank" },
    "d-chase-1": { item_id:"d-chase", inst:"Chase" },
    "d-chase-2": { item_id:"d-chase", inst:"Chase" },
    "d-marcus-1":{ item_id:"d-marcus",inst:"Marcus by Goldman" },
    "d-fid-1":   { item_id:"d-fid",   inst:"Fidelity" },
    "d-merc-1":  { item_id:"d-merc",  inst:"Mercury" },
  };
  const T_ = (id, account_id, n, name, amount, primary, merchant) => {
    const m = acctMeta[account_id] || { item_id:"", inst:"" };
    return {
      transaction_id: `dt-${id}`, account_id, item_id: m.item_id, institution_name: m.inst,
      date: dt(n), authorized_date: dt(n),
      name, merchant_name: merchant || name, amount, iso_currency: "USD",
      category: [primary], personal_finance_category: { primary, detailed: primary },
      pending: false, payment_channel: "online",
    };
  };
  return [
    // ─── INFLOWS (Plaid convention: negative = inflow) ───────────────
    // Salary — biweekly-ish payroll direct deposit to the everyday checking
    T_( 1, "d-jpm-1",    2, "DIRECT DEPOSIT — PAYROLL",     -8_900.00,  "INCOME",      "Acme Software Payroll"),
    T_( 2, "d-jpm-1",   18, "DIRECT DEPOSIT — PAYROLL",     -8_900.00,  "INCOME",      "Acme Software Payroll"),
    T_( 3, "d-jpm-1",   48, "DIRECT DEPOSIT — PAYROLL",     -8_900.00,  "INCOME",      "Acme Software Payroll"),
    // Rental income (from the demo's Investment Property)
    T_( 4, "d-jpm-1",    5, "RENT — CONDO TENANT ACH",      -1_200.00,  "INCOME",      "Tenant"),
    T_( 5, "d-jpm-1",   35, "RENT — CONDO TENANT ACH",      -1_200.00,  "INCOME",      "Tenant"),
    T_( 6, "d-jpm-1",   65, "RENT — CONDO TENANT ACH",      -1_200.00,  "INCOME",      "Tenant"),
    // Business distribution from Halal Bites LLC (Mercury → checking)
    T_( 7, "d-jpm-1",   12, "HALAL BITES DISTRIBUTION",     -2_400.00,  "INCOME",      "Halal Bites LLC"),
    T_( 8, "d-jpm-1",   72, "HALAL BITES DISTRIBUTION",     -1_900.00,  "INCOME",      "Halal Bites LLC"),
    // Brokerage dividend sweep (Fidelity CMA receives quarterly dividends)
    T_( 9, "d-fid-1",    8, "FIDELITY DIVIDEND SWEEP",      -620.00,    "INCOME",      "Fidelity"),
    T_(10, "d-fid-1",   98, "FIDELITY DIVIDEND SWEEP",      -540.00,    "INCOME",      "Fidelity"),
    // Internal transfers
    T_(11, "d-jpm-2",    1, "TRANSFER FROM CHECKING",       -2_500.00,  "TRANSFER_IN", "Internal"),
    T_(12, "d-marcus-1",10, "TRANSFER FROM ALLY",           -3_000.00,  "TRANSFER_IN", "Internal"),

    // ─── CHARITABLE GIVING (shows up in bank tx feed too) ───────────
    T_(13, "d-jpm-1",    4, "ZAKAT — ISLAMIC RELIEF USA",      600.00,  "TRANSFER_OUT","Islamic Relief USA"),
    T_(14, "d-jpm-1",    7, "ZELLE — HELPING HAND",            300.00,  "TRANSFER_OUT","Helping Hand"),
    T_(15, "d-jpm-1",   22, "ZELLE — ZAYTUNA COLLEGE",         200.00,  "TRANSFER_OUT","Zaytuna College"),
    T_(16, "d-jpm-1",   38, "WIRE — BAYYINAH INSTITUTE",       150.00,  "TRANSFER_OUT","Bayyinah"),

    // ─── HOUSING (owns w/ mortgage — HOA + utilities + property tax) ─
    T_(17, "d-jpm-1",    9, "HOA — RESIDENCE",                220.00,   "RENT_AND_UTILITIES","HOA"),
    T_(18, "d-jpm-1",   14, "COOK COUNTY PROPERTY TAX",     2_100.00,   "RENT_AND_UTILITIES","Cook County"),
    T_(19, "d-chase-1", 12, "COMED ELECTRIC",                 312.50,   "RENT_AND_UTILITIES","ComEd"),
    T_(20, "d-chase-1", 12, "PEOPLES GAS",                    184.20,   "RENT_AND_UTILITIES","Peoples Gas"),
    T_(21, "d-chase-1", 15, "AT&T FIBER 5GB",                 165.00,   "RENT_AND_UTILITIES","AT&T"),
    T_(22, "d-chase-1", 15, "VERIZON WIRELESS — FAMILY PLAN", 285.00,   "RENT_AND_UTILITIES","Verizon"),

    // ─── KIDS / EDUCATION ───────────────────────────────────────────
    T_(23, "d-jpm-1",    3, "IQRA INTERNATIONAL — TUITION",   850.00,   "GENERAL_SERVICES","Iqra School"),
    T_(24, "d-jpm-1",   33, "IQRA INTERNATIONAL — TUITION",   850.00,   "GENERAL_SERVICES","Iqra School"),
    T_(25, "d-jpm-1",   63, "IQRA INTERNATIONAL — TUITION",   850.00,   "GENERAL_SERVICES","Iqra School"),
    T_(26, "d-chase-1", 18, "QURAN ACADEMY ONLINE",           320.00,   "GENERAL_SERVICES","Quran Academy"),

    // ─── SUBSCRIPTIONS / SERVICES ──────────────────────────────────
    T_(27, "d-chase-2",  1, "NETFLIX PREMIUM",                22.99,    "ENTERTAINMENT","Netflix"),
    T_(28, "d-chase-2", 31, "NETFLIX PREMIUM",                22.99,    "ENTERTAINMENT","Netflix"),
    T_(29, "d-chase-2",  4, "APPLE TV+ / MUSIC FAMILY",       32.99,    "ENTERTAINMENT","Apple"),
    T_(30, "d-chase-2",  8, "ADOBE CREATIVE CLOUD ALL APPS",  89.99,    "GENERAL_SERVICES","Adobe"),
    T_(31, "d-chase-2", 11, "EQUINOX — GOLD MEMBERSHIP",     295.00,    "PERSONAL_CARE","Equinox"),
    T_(32, "d-chase-2", 41, "EQUINOX — GOLD MEMBERSHIP",     295.00,    "PERSONAL_CARE","Equinox"),
    T_(33, "d-chase-2",  6, "OPENAI / CHATGPT TEAM",         200.00,    "GENERAL_SERVICES","OpenAI"),

    // ─── FOOD (halal grocery + dining) ──────────────────────────────
    T_(34, "d-chase-1",  2, "WHOLE FOODS MARKET",            384.83,    "FOOD_AND_DRINK","Whole Foods"),
    T_(35, "d-chase-1",  9, "WHOLE FOODS MARKET",            418.05,    "FOOD_AND_DRINK","Whole Foods"),
    T_(36, "d-chase-1", 14, "WHOLE FOODS MARKET",            366.41,    "FOOD_AND_DRINK","Whole Foods"),
    T_(37, "d-chase-1",  5, "ZABIHA HALAL MEAT MARKET",      287.20,    "FOOD_AND_DRINK","Zabiha Meat"),
    T_(38, "d-chase-2",  3, "CAVA — DOWNTOWN",                28.42,    "FOOD_AND_DRINK","Cava"),
    T_(39, "d-chase-2",  6, "HALAL GUYS",                     24.75,    "FOOD_AND_DRINK","Halal Guys"),
    T_(40, "d-chase-2", 10, "SHAKE SHACK",                    36.20,    "FOOD_AND_DRINK","Shake Shack"),

    // ─── TRANSPORT ─────────────────────────────────────────────────
    T_(41, "d-chase-2",  3, "UBER BLACK",                     68.50,    "TRANSPORTATION","Uber"),
    T_(42, "d-chase-2",  7, "SHELL V-POWER",                  92.20,    "TRANSPORTATION","Shell"),
    T_(43, "d-chase-2", 13, "TESLA SUPERCHARGER",             42.10,    "TRANSPORTATION","Tesla"),
    T_(44, "d-chase-1", 26, "AUTO INSURANCE — STATE FARM",   312.40,    "GENERAL_SERVICES","State Farm"),

    // ─── TRAVEL ────────────────────────────────────────────────────
    T_(45, "d-chase-2", 28, "EMIRATES — DXB (ECONOMY)",    1_480.00,    "TRAVEL","Emirates"),
    T_(46, "d-chase-2", 30, "HYATT REGENCY DUBAI",           890.00,    "TRAVEL","Hyatt"),

    // ─── SHOPPING / MISC ───────────────────────────────────────────
    T_(47, "d-chase-2",  6, "AMAZON.COM",                    168.42,    "GENERAL_MERCHANDISE","Amazon"),
    T_(48, "d-chase-2", 11, "AMAZON.COM",                    334.50,    "GENERAL_MERCHANDISE","Amazon"),
    T_(49, "d-chase-2",  4, "TARGET",                        127.30,    "GENERAL_MERCHANDISE","Target"),
    T_(50, "d-chase-2", 19, "APPLE STORE — IPAD AIR M3",   1_199.00,    "GENERAL_MERCHANDISE","Apple Store"),

    // ─── BUSINESS (Mercury) ────────────────────────────────────────
    T_(51, "d-merc-1",   3, "STRIPE PAYOUT",                -3_800.00,  "INCOME","Stripe"),
    T_(52, "d-merc-1",  17, "STRIPE PAYOUT",                -4_200.00,  "INCOME","Stripe"),
    T_(53, "d-merc-1",   5, "VENDOR — HALAL SUPPLY CO",     1_650.00,   "GENERAL_SERVICES","Halal Supply"),
    T_(54, "d-merc-1",   8, "AWS — INFRASTRUCTURE",           340.00,   "GENERAL_SERVICES","AWS"),
    T_(55, "d-merc-1",  15, "PAYROLL — 2 STAFF",            3_600.00,   "GENERAL_SERVICES","Gusto Payroll"),
  ];
})();

/* ─── DEMO MANUAL ASSETS + SADAQAH ──────────────────── */
const DEMO_MANUAL_ASSETS = [
  { id:"dm-1", type:"Gold",                 name:"Wedding gold + bullion",            value:16_500, zakatable:true,  added:"2024-09-12", notes:"22k jewelry + 2oz bars" },
  { id:"dm-2", type:"Real Estate",          name:"Primary residence equity",          value:40_000, zakatable:false, added:"2023-05-04", notes:"Home equity (net of mortgage); excluded from Zakat" },
  { id:"dm-3", type:"Investment Property",  name:"Rental — 2bd condo (equity)",       value:22_000, zakatable:true,  added:"2024-01-22", notes:"Equity net of mortgage; rents at $1,200/mo" },
  { id:"dm-4", type:"Business Equity",      name:"Halal Bites LLC (40% stake)",       value:18_000, zakatable:true,  added:"2023-11-08", notes:"Founder equity" },
  { id:"dm-5", type:"Vehicle",              name:"2022 Toyota Camry",                 value:16_200, zakatable:false, added:"2022-08-15", notes:"Daily driver, not zakatable" },
];

// Donations sized to the ~$435k demo persona — a practicing family giving a few
// thousand a year in sadaqah plus their annual Zakat. Covers a representative
// roster of major Muslim orgs (relief, education, dawah, masjid, advocacy).
const DEMO_SADAQAH = [
  // ───── 2026 — Ramadan + post-Ramadan zakat distribution ────────────
  { id:"ds-1",  dt:"2026-03-29", org:"Islamic Relief USA",                  method:"Wire",        account:"Interest Checking", amt:1_500, done:true  },
  { id:"ds-2",  dt:"2026-03-26", org:"Helping Hand for Relief & Development",method:"Wire",      account:"Interest Checking", amt:1_000, done:true  },
  { id:"ds-3",  dt:"2026-03-22", org:"Zaytuna College",                     method:"Wire",        account:"Interest Checking", amt:750,   done:true  },
  { id:"ds-4",  dt:"2026-03-19", org:"Bayyinah Institute",                  method:"Zelle",       account:"Interest Checking", amt:250,   done:true  },
  { id:"ds-5",  dt:"2026-03-16", org:"Yaqeen Institute",                    method:"Zelle",       account:"Interest Checking", amt:250,   done:true  },
  { id:"ds-6",  dt:"2026-03-14", org:"ICNA Relief USA",                     method:"Zelle",       account:"Interest Checking", amt:200,   done:true  },
  { id:"ds-7",  dt:"2026-03-12", org:"Penny Appeal USA",                    method:"Zelle",       account:"Online Savings",    amt:150,   done:true  },
  { id:"ds-8",  dt:"2026-03-08", org:"LaunchGood — Orphan Sponsorship",     method:"Credit Card", account:"Sapphire Preferred",amt:120,   done:true  },
  { id:"ds-9",  dt:"2026-03-05", org:"Masjid Al-Uthman",                    method:"Zelle",       account:"Online Savings",    amt:250,   done:true  },
  { id:"ds-10", dt:"2026-03-02", org:"ISNS (Islamic Society of North Suburbs)",method:"Zelle",    account:"Online Savings",    amt:150,   done:true  },
  { id:"ds-11", dt:"2026-02-28", org:"Hidaya Foundation",                   method:"Zelle",       account:"Online Savings",    amt:100,   done:true  },
  { id:"ds-12", dt:"2026-02-22", org:"LIFE for Relief & Development",       method:"Zelle",       account:"Online Savings",    amt:100,   done:true  },
  { id:"ds-13", dt:"2026-02-15", org:"Muslim Legal Fund of America",        method:"Zelle",       account:"Interest Checking", amt:85,    done:true  },
  { id:"ds-14", dt:"2026-02-10", org:"CAIR — Civil Rights Defense",         method:"Credit Card", account:"Sapphire Preferred",amt:50,    done:true  },
  { id:"ds-15", dt:"2026-01-22", org:"Iqra International School",           method:"Zelle",       account:"Interest Checking", amt:200,   done:true  },

  // ───── 2025 — full year giving ──────────────────────────────────────
  { id:"ds-16", dt:"2025-12-28", org:"Mercy Without Limits",                method:"Wire",        account:"Interest Checking", amt:300,   done:true  },
  { id:"ds-17", dt:"2025-12-20", org:"Islamic Relief USA — Gaza Appeal",    method:"Wire",        account:"Interest Checking", amt:750,   done:true  },
  { id:"ds-18", dt:"2025-11-15", org:"Zaytuna College",                     method:"Wire",        account:"Online Savings",    amt:500,   done:true  },
  { id:"ds-19", dt:"2025-09-08", org:"Bayyinah Institute",                  method:"Zelle",       account:"Online Savings",    amt:150,   done:true  },
  { id:"ds-20", dt:"2025-08-17", org:"Thakkat Charity",                     method:"Zelle",       account:"Interest Checking", amt:50,    done:true  },
  { id:"ds-21", dt:"2025-07-04", org:"Helping Hand — Eid Adha Qurbani",     method:"Credit Card", account:"Sapphire Preferred",amt:84,    done:true  },
  { id:"ds-22", dt:"2025-05-30", org:"Qalam Institute",                     method:"Zelle",       account:"Interest Checking", amt:75,    done:true  },
  { id:"ds-23", dt:"2025-04-02", org:"Masjid Al-Uthman — Ramadan Iftar",    method:"Zelle",       account:"Online Savings",    amt:200,   done:true  },
  { id:"ds-24", dt:"2025-03-25", org:"Yaqeen Institute",                    method:"Zelle",       account:"Online Savings",    amt:200,   done:true  },
  { id:"ds-25", dt:"2025-03-12", org:"Penny Appeal USA — Orphan Kind",      method:"Credit Card", account:"Sapphire Preferred",amt:120,   done:true  },

  // ───── 2024 ─────────────────────────────────────────────────────────
  { id:"ds-26", dt:"2024-12-15", org:"ICNA Relief USA",                     method:"Wire",        account:"Online Savings",    amt:250,   done:true  },
  { id:"ds-27", dt:"2024-09-20", org:"Muslim Aid USA",                      method:"Zelle",       account:"Interest Checking", amt:100,   done:true  },
  { id:"ds-28", dt:"2024-04-09", org:"MUHSEN (Muslims w/ Disabilities)",    method:"Zelle",       account:"Interest Checking", amt:50,    done:true  },
  { id:"ds-29", dt:"2024-04-08", org:"Masjid An-Noor (ICN)",                method:"Zelle",       account:"Online Savings",    amt:150,   done:true  },
  { id:"ds-30", dt:"2024-03-22", org:"Islamic Relief USA — Ramadan Zakat",  method:"Wire",        account:"Interest Checking", amt:1_200, done:true  },

  // ───── 2023 ─────────────────────────────────────────────────────────
  { id:"ds-31", dt:"2023-12-11", org:"ISNS",                                method:"Zelle",       account:"Online Savings",    amt:150,   done:true  },
  { id:"ds-32", dt:"2023-04-12", org:"Islamic Relief USA — Ramadan Zakat",  method:"Wire",        account:"Interest Checking", amt:950,   done:true  },

  // ───── Outstanding pledges ──────────────────────────────────────────
  { id:"ds-33", dt:"Pledge",     org:"Helping Hand — Earthquake Relief",    method:"TBD",         account:"Interest Checking", amt:500,   done:false },
  { id:"ds-34", dt:"Pledge",     org:"Masjid Al-Uthman — Building Fund",    method:"TBD",         account:"Online Savings",    amt:1_000, done:false },
  { id:"ds-35", dt:"Pledge",     org:"Zaytuna College — Endowed Chair",     method:"TBD",         account:"Interest Checking", amt:250,   done:false },
];

/* ─── CALC HELPERS ───────────────────────────────────── */
const mv   = h => h.sh * h.px;
const cost = h => h.sh * h.ac;
const gv   = h => mv(h) - cost(h);
const gp   = h => (h.ac > 0 ? ((h.px - h.ac) / h.ac) * 100 : 0);
const TOTAL_MV   = HOLDINGS.reduce((s,h)=>s+mv(h),0);
const TOTAL_COST = HOLDINGS.reduce((s,h)=>s+cost(h),0);

/* ─── ASSET-CLASS CLASSIFICATION ─────────────────────── */
// Map of ticker → asset class. Anything not in the map defaults to "us_equity"
// since the demo + most real portfolios skew that way. Bond funds, crypto,
// and money-market positions fall under "other" (informational only — they
// don't count against any of the 5 user-targetable classes).
const ASSET_CLASS_MAP = {
  // Sukuk (Sharia-compliant fixed-income proxies)
  SPSK:"sukuk", SPSU:"sukuk", FIIS:"sukuk", AGGS:"sukuk", SUKK:"sukuk",
  // REITs
  VNQ:"reit", SPRE:"reit", SCHH:"reit", IYR:"reit", REET:"reit",
  O:"reit", AMT:"reit", PLD:"reit", EQIX:"reit", SPG:"reit",
  // Global / international equity
  VXUS:"global_equity", VEA:"global_equity", VWO:"global_equity",
  IEFA:"global_equity", IEMG:"global_equity", VT:"global_equity",
  BABA:"global_equity", TM:"global_equity", UL:"global_equity",
  TSM:"global_equity", ASML:"global_equity", ARM:"global_equity",
  // Bonds + crypto + money market → "other" (untargeted, informational)
  BND:"other", AGG:"other", BNDX:"other", VGIT:"other", VGSH:"other",
  BTC:"other", ETH:"other", SOL:"other",
};
const ASSET_CLASSES = [
  { key:"us_equity",     label:"U.S. Equity",   defaultPct:60 },
  { key:"global_equity", label:"Global Equity", defaultPct:15 },
  { key:"sukuk",         label:"Sukuk",         defaultPct:10 },
  { key:"reit",          label:"Real Estate (REIT)", defaultPct:10 },
  { key:"cash",          label:"Cash",          defaultPct: 5 },
];
const DEFAULT_REBALANCE_TARGETS = ASSET_CLASSES.reduce((o,c)=>{o[c.key]=c.defaultPct;return o;},{});
// Default proxies used when a class is under-target and we need to buy SOMETHING.
// halal=true picks the screened-compliant alternative.
const CLASS_PROXY = {
  us_equity:    { default:"VOO",  halal:"SPUS" },
  global_equity:{ default:"VXUS", halal:"HLAL" },
  sukuk:        { default:"SPSK", halal:"SPSK" },
  reit:         { default:"VNQ",  halal:"SPRE" },
};
const classifyTicker = (tk) => {
  if (!tk) return "other";
  const u = String(tk).toUpperCase();
  return ASSET_CLASS_MAP[u] || "us_equity";
};

/* ─── CHART SEED ─────────────────────────────────────── */
const mkCurve=(n,start,vol)=>{let v=start;return Array.from({length:n},(_,i)=>{v+=(Math.random()-.46)*vol;if(v<start*.6)v=start*.65;return{i,v:+v.toFixed(2)};});};
const C1Y=mkCurve(252,TOTAL_MV*.82,TOTAL_MV*.006);
const C1M=C1Y.slice(-22);const C1W=C1Y.slice(-7);const CYTD=C1Y.slice(-90);

/* ─── LIVE DATA ──────────────────────────────────────── */
let _gk={};
function setGlobalKeys(k){_gk={...k};}

// All Anthropic traffic now flows through /api/advisor so the browser
// never holds an ANTHROPIC_KEY. The server attaches the key from env
// vars, applies rate limits, and logs usage.
const ai=async(prompt,max=6000)=>{
  const r=await apiFetch("/api/advisor",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      model:"claude-sonnet-4-6",
      max_tokens:max,
      // web_search lets the price/news fallbacks pull live data via the
      // server. The /api/advisor proxy only forwards documented tool types.
      tools:[{type:"web_search_20250305",name:"web_search"}],
      messages:[{role:"user",content:prompt}],
    }),
  });
  const d=await r.json();
  if(!r.ok||d.error)throw new Error(d.error||`advisor ${r.status}`);
  const blocks=Array.isArray(d.content)?d.content:[];
  return blocks.filter(b=>b.type==="text").map(b=>b.text).join("");
};
const tryJ=t=>{try{const m=t.match(/\[[\s\S]*\]/);return m?JSON.parse(m[0]):null;}catch{return null;}};

// Server-proxied. The browser never holds a vendor key; the proxy uses the
// server's FINNHUB_KEY env var and is per-user JWT-scoped + rate limited.
// The /quote proxy caps each request at 25 symbols (per-symbol Finnhub call
// fan-out), so chunk client-side and merge so users with >25 holdings still
// get a price + change % for every position.
async function fetchFinnhub(tickers){
  if(!Array.isArray(tickers)||tickers.length===0)return[];
  const uniq=[...new Set(tickers.filter(t=>typeof t==="string"&&t))];
  const CHUNK=25;
  const chunks=[];
  for(let i=0;i<uniq.length;i+=CHUNK)chunks.push(uniq.slice(i,i+CHUNK));
  try{
    const results=await Promise.allSettled(chunks.map(async chunk=>{
      const r=await apiFetch(`/api/finnhub/quote?symbols=${encodeURIComponent(chunk.join(","))}`);
      if(!r.ok)return[];
      const d=await r.json();
      return Array.isArray(d?.quotes)?d.quotes:[];
    }));
    return results.flatMap(r=>r.status==="fulfilled"?r.value:[]);
  }catch{return[];}
}

async function fetchNewsF(){
  try{
    const r=await apiFetch("/api/finnhub/news");
    if(!r.ok)return[];
    const d=await r.json();
    return(d?.news||[]).map(n=>({
      ...n,
      t:new Date((n.datetime||Date.now()/1000)*1000).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}),
    }));
  }catch{return[];}
}

async function fetchAIPrices(tickers){
  const txt=await ai(`Search Yahoo Finance NOW for current prices of: ${tickers.join(",")}. Return ONLY JSON array no markdown: [{"tk":"AAPL","price":195,"chg":1.2,"pct":0.62,"hi":197,"lo":194,"prePrice":196,"prePct":0.5,"postPrice":195.5,"postPct":-0.25,"vol":"58M"}]`);
  return tryJ(txt)||[];
}

async function fetchAINews(){
  const txt=await ai(`Search Yahoo Finance, Bloomberg, Reuters TODAY for top 8 market stories. Return ONLY JSON array no markdown: [{"h":"headline","src":"Bloomberg","t":"2h ago","s":"positive"}]\ns: positive|negative|neutral`,3000);
  return tryJ(txt)||[];
}

/* ─── MICRO COMPONENTS ───────────────────────────────── */
const f$=(v,d=2)=>v!=null&&!isNaN(v)?`$${Math.abs(+v).toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d})}`:"-";
const fp=v=>v!=null&&!isNaN(v)?`${+v>0?"+":""}${(+v).toFixed(2)}%`:"-";
const fc=v=>!v||isNaN(v)?T.muted:+v>0?T.gain:+v<0?T.loss:T.muted;
const kf=v=>v>=1e9?`$${(v/1e9).toFixed(2)}B`:v>=1e6?`$${(v/1e6).toFixed(1)}M`:`$${v.toLocaleString()}`;
// Common ticker-symbol typo corrections (mirrors the server NL builder's map),
// so a mistyped symbol is fixed before it's watched, screened, or traded.
const TICKER_TYPOS={APPL:"AAPL",APPLE:"AAPL",NTFLX:"NFLX",NETFLIX:"NFLX",NFLIX:"NFLX",TESLA:"TSLA",AMAZON:"AMZN",AMZ:"AMZN",MICROSOFT:"MSFT",NVIDIA:"NVDA",NVDIA:"NVDA",FACEBOOK:"META",FB:"META",GOOGLE:"GOOGL",ALPHABET:"GOOGL",BRK:"BRK.B",BERKSHIRE:"BRK.B"};
const fixTicker=s=>{const u=String(s||"").replace(/\s+/g,"").toUpperCase().trim();return TICKER_TYPOS[u]||u;};

// Inline status glyphs (success / failure) — shared so status lines stay terse.
// They inherit the container's currentColor (green ok-banner / red error-banner).
const ICON_OK=<Icon name="check" size={12} style={{display:"inline-block",verticalAlign:"-2px",marginRight:5}}/>;
const ICON_NO=<Icon name="close" size={12} style={{display:"inline-block",verticalAlign:"-2px",marginRight:5}}/>;

function LiveDot({on,pulse}){return<span style={{display:"inline-block",width:6,height:6,borderRadius:"50%",flexShrink:0,background:on?T.gain:T.muted,boxShadow:on?`0 0 8px ${T.gain}80`:"none",animation:pulse?"blink 2s ease-in-out infinite":"none"}}/>;}

function Tag({label,color}){
  const c=color||T.muted;
  return<span style={{
    display:"inline-flex",alignItems:"center",gap:T.s1,
    padding:`2px ${T.s2}`,borderRadius:999,
    fontSize:10,fontFamily:FM,fontWeight:600,letterSpacing:"0.06em",textTransform:"uppercase",
    color:c,background:`${c}18`,border:`1px solid ${c}30`,
    whiteSpace:"nowrap",
  }}>{label}</span>;
}

// Stat card. Numbers use SF Pro Display tabular figures so values stay
// in vertical alignment across columns. Hover lift via inline CSS in the
// global <style> block (.kv-card class).
function KV({label,value,sub,subColor,accent}){return<div className="kv-card" style={{
  background:T.card,
  border:`1px solid ${accent?accent+"30":T.border}`,
  borderRadius:T.rLg,
  padding:`${T.s4} ${T.s5}`,
  transition:"border-color 0.2s, transform 0.18s, box-shadow 0.2s",
}}>
  <div style={{fontFamily:FM,fontSize:9,color:T.muted,letterSpacing:"0.16em",textTransform:"uppercase",fontWeight:500,marginBottom:T.s2}}>{label}</div>
  <div style={{fontFamily:FU,fontSize:22,fontWeight:600,color:T.textHi,lineHeight:1.05,letterSpacing:"-0.02em",fontVariantNumeric:"tabular-nums"}}>{value}</div>
  {sub&&<div style={{fontFamily:FM,fontSize:11,fontWeight:500,color:subColor||T.muted,marginTop:T.s2,letterSpacing:"0.02em"}}>{sub}</div>}
</div>;}

function Sk({vals,color,w=72,h=22,fill}){
  if(!vals?.length)return null;
  const mn=Math.min(...vals),mx=Math.max(...vals)+.01;
  const pts=vals.map((v,i)=>({x:(i/(vals.length-1))*(w-2)+1,y:h-2-((v-mn)/(mx-mn))*(h-4)+1}));
  const d=pts.map((p,i)=>`${i===0?"M":"L"} ${p.x} ${p.y}`).join(" ");
  const c=color||T.blue;
  const areaD=fill?`${d} L ${w-1} ${h-1} L 1 ${h-1} Z`:null;
  const gid=`spark-${c.replace("#","")}`;
  return<svg width={w} height={h} style={{display:"block",flexShrink:0,overflow:"visible"}}>
    {fill&&<defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor={c} stopOpacity={0.35}/>
      <stop offset="100%" stopColor={c} stopOpacity={0}/>
    </linearGradient></defs>}
    {fill&&<path d={areaD} fill={`url(#${gid})`}/>}
    <path d={d} fill="none" stroke={c} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"/>
  </svg>;
}

// Donut chart for allocation breakdowns. Slices come in as
// [{label, value, color}]. Renders SVG arcs with a center hole + label.
function Donut({slices,size=180,thickness=22,centerLabel,centerValue}){
  const total=slices.reduce((s,x)=>s+(x.value||0),0)||1;
  const r=size/2-thickness/2;
  const cx=size/2,cy=size/2;
  let acc=0;
  const arc=(start,end)=>{
    const a0=(start-90)*Math.PI/180,a1=(end-90)*Math.PI/180;
    const x0=cx+r*Math.cos(a0),y0=cy+r*Math.sin(a0);
    const x1=cx+r*Math.cos(a1),y1=cy+r*Math.sin(a1);
    const large=end-start>180?1:0;
    return`M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
  };
  return<div style={{position:"relative",width:size,height:size}}>
    <svg width={size} height={size} style={{display:"block",overflow:"visible"}}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={T.dim} strokeWidth={thickness}/>
      {slices.map((s,i)=>{
        const pct=(s.value||0)/total;
        const start=acc*360;const end=(acc+pct)*360;
        acc+=pct;
        if(pct<=0)return null;
        // Handle full-circle edge case (single non-zero slice = 100%)
        if(pct>=0.999)return<circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={s.color} strokeWidth={thickness}/>;
        return<path key={i} d={arc(start,end)} fill="none" stroke={s.color} strokeWidth={thickness} strokeLinecap="butt"/>;
      })}
    </svg>
    {(centerLabel||centerValue)&&<div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",textAlign:"center",pointerEvents:"none"}}>
      {centerLabel&&<div style={{fontFamily:FM,fontSize:9,color:T.muted,letterSpacing:"0.14em",textTransform:"uppercase",fontWeight:500,marginBottom:2}}>{centerLabel}</div>}
      {centerValue&&<div style={{fontFamily:FU,fontSize:20,fontWeight:600,color:T.textHi,letterSpacing:"-0.02em",fontVariantNumeric:"tabular-nums"}}>{centerValue}</div>}
    </div>}
  </div>;
}

// Bento tile wrapper. Adds glass surface, hover lift, optional gradient
// background, and flexible grid-area placement via `span`.
// When `accent` is set: 2px colored top bar + tinted left border.
// When `onClick` is set: pointer cursor + scale hint in CSS.
function BentoTile({children,span="auto",accent,gradient,glass,style,onClick}){
  const baseStyle={
    background:gradient||(glass?T.glass:T.tileFill),
    border:`1px solid ${T.border}`,
    borderTop: accent ? `2px solid ${accent}` : `1px solid ${T.border}`,
    borderLeft: accent ? `1px solid ${accent}30` : `1px solid ${T.border}`,
    borderRadius:T.rLg,
    padding:`${T.s5} ${T.s5}`,
    boxShadow:"var(--mz-tile)",
    backdropFilter:glass?"blur(16px) saturate(160%)":undefined,
    WebkitBackdropFilter:glass?"blur(16px) saturate(160%)":undefined,
    gridColumn:span&&span.col||undefined,
    gridRow:span&&span.row||undefined,
    transition:"transform 0.18s cubic-bezier(.34,1.56,.64,1), box-shadow 0.2s, border-color 0.2s",
    cursor:onClick?"pointer":"default",
    position:"relative",
    overflow:"hidden",
    ...(style||{}),
  };
  return<div className={`bento-tile${onClick?" bento-tile--click":""}`} onClick={onClick} style={baseStyle}>{children}</div>;
}

// CollapsibleTile — a BentoTile whose header toggles its body. The header (title +
// optional one-line subtitle) is ALWAYS visible so the feature stays discoverable
// even when collapsed; only the body folds away, keeping long views short. Open
// state persists per `storageKey`. Use for SECONDARY / advanced panels; keep the
// primary content of a view as a plain BentoTile so it's always in view. `right`
// renders a node (badge, status dot) on the header's right edge. `flat` drops the
// card wrapper (just a header bar + body) — use it to wrap a panel that already
// renders its OWN card(s), so collapsing doesn't create a card-inside-a-card.
function CollapsibleTile({title,subtitle,defaultOpen=false,storageKey,accent,right,children,style,flat=false}){
  const skey=storageKey?`mizan_ct_${storageKey}`:null;
  const[open,setOpen]=useState(()=>{
    if(!skey)return defaultOpen;
    try{const v=localStorage.getItem(skey);return v===null?defaultOpen:v==="1";}catch{return defaultOpen;}
  });
  const toggle=()=>setOpen(o=>{const n=!o;if(skey){try{localStorage.setItem(skey,n?"1":"0");}catch{}}return n;});
  const header=<button onClick={toggle} aria-expanded={open} style={{
    width:"100%",display:"flex",alignItems:"center",gap:T.s3,
    padding:flat?`${T.s3} 0`:`${T.s4} ${T.s5}`,
    background:"transparent",border:"none",borderBottom:flat?`1px solid ${T.dim}`:"none",
    cursor:"pointer",textAlign:"left",
  }}>
    <span aria-hidden="true" style={{color:open?T.blue:T.muted,fontSize:11,lineHeight:1,flexShrink:0,
      display:"inline-block",transform:open?"rotate(90deg)":"none",transition:"transform 0.18s"}}>▸</span>
    <span style={{flex:1,minWidth:0}}>
      <span style={{display:"block",fontFamily:FM,fontSize:11,letterSpacing:"0.14em",fontWeight:600,color:T.textHi}}>{title}</span>
      {subtitle&&<span style={{display:"block",fontFamily:FP,fontSize:11,color:T.muted,marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{subtitle}</span>}
    </span>
    {right&&<span style={{flexShrink:0,marginLeft:T.s2}}>{right}</span>}
  </button>;
  if(flat)return<div style={{display:"flex",flexDirection:"column",gap:T.s4,...(style||{})}}>{header}{open&&children}</div>;
  return<BentoTile accent={accent} style={{padding:0,...(style||{})}}>
    {header}
    {open&&<div style={{padding:`0 ${T.s5} ${T.s5}`}}>{children}</div>}
  </BentoTile>;
}

function TT2({active,payload}){if(!active||!payload?.length)return null;return<div style={{background:T.card,border:`1px solid ${T.borderHi}`,borderRadius:8,padding:"6px 12px",fontFamily:FM,fontSize:11,color:T.textHi}}>${payload[0]?.value?.toLocaleString?.("en-US",{minimumFractionDigits:2})}</div>;}

// Data table — fintech-style. Tabular numerics, hover row highlight,
// sticky header optional (not on by default to keep nested tables simple).
function Tbl({cols,rows,onRow}){return<div style={{overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
  <table className="mz-tbl-desktop" style={{width:"100%",borderCollapse:"separate",borderSpacing:0,fontVariantNumeric:"tabular-nums"}}>
    <thead><tr>{cols.map(c=><th key={c.l} style={{
      padding:`${T.s3} ${T.s4}`,textAlign:c.r?"right":"left",
      fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.14em",textTransform:"uppercase",
      borderBottom:`1px solid ${T.border}`,fontWeight:600,whiteSpace:"nowrap",
      background:T.surface,
    }}>{c.l}</th>)}</tr></thead>
    <tbody>{rows.map((r,i)=><tr key={i} onClick={()=>onRow?.(r,i)} className="trow" style={{
      borderBottom:`1px solid ${T.border}`,cursor:onRow?"pointer":"default",transition:"background 0.12s",
    }}>{cols.map(c=><td key={c.l} style={{
      padding:`${T.s3} ${T.s4}`,textAlign:c.r?"right":"left",
      borderBottom:`1px solid ${T.border}`,
      ...(c.s?.(r)||{}),
    }}>{c.r_?c.r_(r):r[c.k]}</td>)}</tr>)}</tbody>
  </table>
  <div className="mz-tbl-mobile">{rows.map((r,i)=><div key={i} className="mz-tbl-card" onClick={()=>onRow?.(r,i)} style={{
    background:T.card,border:`1px solid ${T.border}`,borderRadius:T.rMd,
    padding:T.s4,cursor:onRow?"pointer":"default",
  }}>
    <div style={{fontFamily:FP,fontSize:14,fontWeight:600,color:T.textHi,marginBottom:T.s2,...(cols[0]?.s?.(r)||{})}}>
      {cols[0]?.r_?cols[0].r_(r):r[cols[0]?.k]}
    </div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"6px 16px"}}>
      {cols.slice(1).filter(c=>!c.mobileHide).map(c=><div key={c.l} style={{minWidth:0}}>
        <div style={{fontFamily:FM,fontSize:9,color:T.muted,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:2}}>{c.l}</div>
        <div style={{fontFamily:FM,fontSize:12,color:T.text,fontVariantNumeric:"tabular-nums",...(c.s?.(r)||{})}}>
          {c.r_?c.r_(r):r[c.k]}
        </div>
      </div>)}
    </div>
  </div>)}</div>
</div>;}

// Tab bar — pill-style segmented control. Active pill gets a soft purple
// halo. Scrolls horizontally on mobile via .mz-tabbar overflow handling.
function TabBar({tabs,active,onChange,accent}){return<div className="mz-tabbar-wrap" style={{marginBottom:T.s5}}><div className="mz-tabbar" style={{
  display:"flex",gap:T.s1,padding:T.s1,
  background:"var(--mz-glass)",border:"1px solid var(--mz-glass-border)",borderRadius:T.rLg,
  boxShadow:"inset 0 1px 0 rgba(255,255,255,0.06), 0 2px 8px rgba(0,0,0,0.14)",
  overflowX:"auto",WebkitOverflowScrolling:"touch",
}}>{tabs.map(([id,l])=>{
  const on=active===id;const acc=accent||T.blue;
  return<button key={id} onClick={()=>onChange(id)} style={{
    padding:`8px ${T.s4}`,
    background:on?"var(--mz-glass-strong, rgba(13,19,17,0.91))":"transparent",
    backdropFilter:on?"blur(20px) saturate(160%)":undefined,
    WebkitBackdropFilter:on?"blur(20px) saturate(160%)":undefined,
    border:"none",borderRadius:T.rMd,
    color:on?T.textHi:T.muted,
    fontFamily:FP,fontSize:13,fontWeight:on?600:500,letterSpacing:"-0.005em",
    cursor:"pointer",whiteSpace:"nowrap",flexShrink:0,
    boxShadow:on?`inset 0 1px 0 rgba(255,255,255,0.08), inset 0 -1px 0 rgba(0,0,0,0.20), 0 1px 4px rgba(0,0,0,0.22), 0 0 0 1px ${acc}28`:"none",
    transition:"all 0.18s cubic-bezier(.34,1.56,.64,1)",
  }}
  onMouseEnter={e=>{if(!on){e.currentTarget.style.background="rgba(255,255,255,0.05)";e.currentTarget.style.color=T.text;}}}
  onMouseLeave={e=>{if(!on){e.currentTarget.style.background="transparent";e.currentTarget.style.color=T.muted;}}}
  >{l}</button>;
})}</div></div>;}

/* ─── CSV PARSER (Fidelity / Robinhood / Coinbase) ───── */
// Returns activity rows shaped like SnapTrade's /activities response so they
// flow through every existing metric without special-casing.
// Best-effort broker detection from the CSV's first ~1KB. Each broker has
// a distinctive header / preamble shape:
//   Robinhood — "Trans Code" + "Activity Date"
//   Fidelity  — "Run Date" + "Action" + "Account Number"
//   Coinbase  — "Transaction Type" + "Quantity Transacted"
//   Schwab    — "Action" + "Date" + "Symbol" but no "Run Date"
// Returns null when we can't tell, so the caller's manual dropdown wins.
function detectBroker(text){
  const head=(text||"").slice(0,2000).toLowerCase();
  if(/trans code/.test(head)&&/activity date/.test(head))return"Robinhood";
  if(/run date/.test(head)&&/account number/.test(head))return"Fidelity";
  if(/transaction type/.test(head)&&/quantity transacted/.test(head))return"Coinbase";
  if(/^date,action,/.test(head)||/schwab/.test(head))return"Schwab";
  if(/vanguard/.test(head))return"Vanguard";
  return null;
}

function parseCSV(text,broker){
  // Quote-aware line splitter — handles cells with embedded newlines
  // (Robinhood's Description column has CUSIP + "Dividend Reinvestment"
  // on separate lines inside quoted cells). text.split(/\r?\n/) was
  // fragmenting these rows into 3 partial lines each, which broke
  // import + dedup. This walks the stream char-by-char, only treating
  // a newline as a row boundary when we're not inside an open quote.
  const splitLogicalRows=t=>{
    const rows=[];let cur="";let inQ=false;
    for(let i=0;i<t.length;i++){
      const c=t[i];
      if(c==='"'){inQ=!inQ;cur+=c;continue;}
      if(!inQ&&(c==="\n"||c==="\r")){
        if(cur.trim().length>0)rows.push(cur);
        cur="";
        if(c==="\r"&&t[i+1]==="\n")i++;
        continue;
      }
      cur+=c;
    }
    if(cur.trim().length>0)rows.push(cur);
    return rows;
  };
  const lines=splitLogicalRows(text);
  if(lines.length<2)throw new Error(`File has only ${lines.length} non-empty lines.`);
  // Find header line — brokers often prefix with junk metadata
  let headerIdx=lines.findIndex(l=>/(Run Date|Activity Date|Trade Date|Date|Trans Code|Action|Type)/i.test(l)&&l.split(",").length>=4);
  if(headerIdx<0)headerIdx=0;

  const split=l=>{
    const out=[];let cur="",inQ=false;
    for(const c of l){
      if(c==='"'){inQ=!inQ;continue;}
      if(c===","&&!inQ){out.push(cur);cur="";continue;}
      cur+=c;
    }
    out.push(cur);return out.map(s=>s.trim());
  };
  const header=split(lines[headerIdx]).map(h=>h.replace(/^"|"$/g,"").trim().toLowerCase());
  const idx=name=>header.findIndex(h=>h===name||h.startsWith(name));
  const get=(row,...names)=>{for(const n of names){const i=idx(n.toLowerCase());if(i>=0&&row[i])return row[i].replace(/^"|"$/g,"").trim();}return"";};
  const num=v=>{if(!v)return 0;const n=parseFloat(v.replace(/[$,()\s]/g,""));return isNaN(n)?0:n;};
  const isoDate=s=>{
    if(!s)return"";
    // Handle MM/DD/YYYY explicitly (Robinhood, Fidelity all use this)
    const us=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if(us){
      const yr=us[3].length===2?2000+ +us[3]:+us[3];
      return`${yr}-${String(+us[1]).padStart(2,"0")}-${String(+us[2]).padStart(2,"0")}`;
    }
    const d=new Date(s);
    return isNaN(+d)?"":d.toISOString().slice(0,10);
  };

  // Trans-code lookup covers Robinhood, Fidelity, Coinbase, Schwab.
  // Returns a tuple [type, signOverride] — signOverride is "auto" when the
  // amount sign in the row determines DEPOSIT vs WITHDRAWAL (e.g. ACH).
  const inferType=action=>{
    const a=(action||"").toUpperCase().trim();
    if(!a)return["",null];
    // Robinhood-specific Trans Codes
    if(a==="ACH"||a==="ACATC"||a==="JNLC"||a==="RTP")return["DEPOSIT","auto"]; // RTP = instant bank transfer (in/out by sign)
    if(a==="GOLD")return["FEE",null];                    // Robinhood Gold subscription fee
    if(/ELECTRONIC FUNDS TRANSFER/.test(a))return["DEPOSIT","auto"]; // Fidelity EFT (in/out by sign)
    if(a==="CDIV"||a==="GDIV"||a==="QDIV"||a==="DIV"||a==="DFEE")return["DIVIDEND",null];
    if(a==="INT")return["DIVIDEND",null];
    if(a==="OEXP"||a==="OASGN")return["SELL",null];
    // Coinbase-specific transaction types
    if(a==="CONVERT"||a==="CONVERSION")return["SELL",null];
    if(a==="SEND")return["WITHDRAWAL",null];
    if(a==="RECEIVE"||a==="DEPOSIT")return["DEPOSIT",null];
    if(/REWARD|STAKING|EARN|LEARNING|SUBSCRIPTION/.test(a))return["DIVIDEND",null];
    // Common patterns across brokers
    if(/^BUY|BOUGHT|REINVEST|YOU BOUGHT|ADVANCED TRADE BUY/.test(a))return["BUY",null];
    if(/^SELL|SOLD|YOU SOLD|ADVANCED TRADE SELL/.test(a))return["SELL",null];
    if(/DIVIDEND/.test(a))return["DIVIDEND",null];
    if(/INTEREST INCOME|INTEREST PAID/.test(a))return["DIVIDEND",null];
    if(/TRANSFER IN|CONTRIBUTION|FUNDS RECEIVED|ACH IN|EFT IN|RECEIVED FROM/.test(a))return["DEPOSIT",null];
    if(/WITHDRAW|TRANSFER OUT|ACH OUT|EFT OUT|SENT TO|DISTRIBUTION/.test(a))return["WITHDRAWAL",null];
    if(/FEE|COMMISSION|TAX|MISC FEE/.test(a))return["FEE",null];
    if(/JOURNAL/.test(a))return["DEPOSIT","auto"];
    return["",null];
  };

  const rows=[];
  let seen=0,skippedNoDate=0,skippedNoType=0;
  const unknownActions=new Set();

  for(let i=headerIdx+1;i<lines.length;i++){
    const r=split(lines[i]);
    if(r.length<3)continue;
    seen++;
    const date=isoDate(get(r,"activity date","trade date","run date","date","settle date","timestamp"));
    if(!date){skippedNoDate++;continue;}
    const action=get(r,"trans code","action","activity","transaction type","type","description");
    const[type,signMode]=inferType(action);
    if(!type){skippedNoType++;if(action)unknownActions.add(action);continue;}
    const symbol=get(r,"symbol","ticker","instrument","asset");
    const units=num(get(r,"quantity","shares","amount of shares","quantity transacted"));
    const price=num(get(r,"price","price per share","average price","price at transaction"));
    const rawAmt=num(get(r,"amount","amount ($)","amount usd","net amount","transaction amount","total","subtotal"));

    // Capture per-row account info when the CSV exposes it. Fidelity's
    // multi-account export carries "Account" + "Account Number" columns
    // (e.g., "ROTH IRA" / "259683091"); without this every row got tagged
    // just "Fidelity" and the Activity table couldn't tell ROTH from
    // Taxable from Individual. Robinhood + Coinbase exports are single-
    // account so account remains empty there.
    const acctName=get(r,"account","account name","account type");
    const acctNumber=get(r,"account number","account #","number");
    const acctLabel=acctName?acctName.trim():"";
    const institutionLabel=acctLabel?`${broker} — ${acctLabel}`:broker;

    let amount;
    if(signMode==="auto"){
      // ACH/JNLC: positive amount = DEPOSIT, negative = WITHDRAWAL
      amount=rawAmt;
      if(rawAmt<0){/* keep type as DEPOSIT but negative amount, will display as withdrawal-like */}
    }else if(type==="BUY"||type==="WITHDRAWAL"||type==="FEE"){
      amount=-Math.abs(rawAmt);
    }else{
      amount=Math.abs(rawAmt);
    }
    // Reclassify ACH negatives as WITHDRAWAL so totals add up correctly
    const finalType=(signMode==="auto"&&rawAmt<0)?"WITHDRAWAL":type;
    rows.push({
      id:`csv-${broker}-${acctLabel||"main"}-${i}-${date}`,
      trade_date:date,
      type:finalType,
      symbol:symbol?{symbol}:null,
      units:units||null,
      price:price||null,
      amount,
      currency:{code:"USD"},
      // When we have account info, fake a SnapTrade-shaped account object
      // so ActivityPanel's acctNameById lookup can match if the same
      // account is also connected via SnapTrade.
      account:acctLabel?{id:acctNumber||acctLabel,name:acctLabel,number:acctNumber||null}:null,
      institution_name:institutionLabel,
      _imported:true,
    });
  }
  if(rows.length===0){
    const sampleHeader=header.slice(0,8).join(", ");
    const unknownSample=[...unknownActions].slice(0,5).join(", ");
    throw new Error(
      `Parsed 0 rows from ${seen} data lines.\n`+
      `Header found at line ${headerIdx+1}: ${sampleHeader}\n`+
      `Skipped (no date): ${skippedNoDate}, (unknown action): ${skippedNoType}\n`+
      (unknownSample?`Unknown trans codes: ${unknownSample}`:`No action column matched. Try renaming a column to "Action" or "Trans Code".`)
    );
  }
  return rows;
}

/* ─── SECTOR BREAKDOWN ───────────────────────────────── */
// Buckets positions by sector. Pulls Finnhub /stock/profile2 per unique ticker
// and caches results in localStorage so we don't burn the 60-calls/min free tier.
function SectorBreakdown({holdings=[],total=0}){
  const[sectors,setSectors]=useState(()=>{try{return JSON.parse(localStorage.getItem("mizan_sectors")||"{}");}catch{return{};}});
  const tickerKey=holdings.map(h=>h.tk).filter(Boolean).join(",");

  useEffect(()=>{
    // Finnhub calls are server-proxied; the env-var key is what counts.
    if(!tickerKey)return;
    const cached={...sectors};
    const cryptoSet=new Set(["BTC","ETH","SOL","DOGE","ADA","DOT","LINK"]);
    const need=[...new Set(holdings.map(h=>h.tk))]
      .filter(tk=>tk&&!cached[tk]&&!cryptoSet.has(tk))
      .slice(0,30); // cap per-render to stay under rate limits
    if(need.length===0)return;
    Promise.allSettled(need.map(async tk=>{
      const r=await apiFetch(`/api/finnhub/profile2?symbol=${encodeURIComponent(tk)}`);
      const d=await r.json();
      return[tk,d.finnhubIndustry||d.gicsSector||"Other"];
    })).then(results=>{
      const next={...cached};
      results.forEach(r=>{if(r.status==="fulfilled"){const[tk,sec]=r.value;next[tk]=sec;}});
      try{localStorage.setItem("mizan_sectors",JSON.stringify(next));}catch{}
      setSectors(next);
    });
  },[tickerKey]);

  const buckets={};
  holdings.forEach(h=>{
    const sec=sectors[h.tk]||(h.ty==="Crypto"?"Crypto":h.ty==="ETF"?"ETFs & Funds":h.ty==="Fund"?"ETFs & Funds":"Other");
    buckets[sec]=(buckets[sec]||0)+mv(h);
  });
  const sorted=Object.entries(buckets).sort((a,b)=>b[1]-a[1]).slice(0,10);
  if(sorted.length===0)return null;
  const colorOf=(sec,i)=>["#2563EB","#059669","#D4AF37","#7C3AED","#DC2626","#0EA5E9","#F59E0B","#EC4899","#10B981","#6366F1"][i%10];
  const donutSlices=sorted.map(([label,value],i)=>({label,value,color:colorOf(label,i)}));
  const tracked=sorted.reduce((s,[,v])=>s+v,0);
  const topSector=sorted[0];

  return<BentoTile accent={T.blue} style={{background:`radial-gradient(circle at 100% 0%, ${T.blue}10, transparent 55%), ${T.card}`}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:T.s4,flexWrap:"wrap",gap:T.s2}}>
      <div>
        <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s1}}>SECTOR ALLOCATION</div>
        <div style={{fontFamily:FP,fontSize:13,color:T.muted,letterSpacing:"-0.005em"}}>{sorted.length} sector{sorted.length===1?"":"s"} · {kf(tracked)} tracked</div>
      </div>
      {topSector&&<div style={{textAlign:"right"}}>
        <div style={{fontFamily:FM,fontSize:9,color:T.muted,letterSpacing:"0.14em",fontWeight:600}}>TOP SECTOR</div>
        <div style={{fontFamily:FP,fontSize:14,fontWeight:600,color:T.textHi,letterSpacing:"-0.01em",marginTop:2}}>{topSector[0]}</div>
        <div style={{fontFamily:FM,fontSize:11,color:T.blue,fontVariantNumeric:"tabular-nums",marginTop:2}}>{(total>0?(topSector[1]/total)*100:0).toFixed(1)}%</div>
      </div>}
    </div>
    <div style={{display:"flex",gap:T.s5,alignItems:"center",flexWrap:"wrap"}}>
      <Donut slices={donutSlices} size={160} thickness={18} centerLabel="Tracked" centerValue={kf(tracked)}/>
      <div style={{display:"flex",flexDirection:"column",gap:T.s2,flex:1,minWidth:220}}>
        {sorted.map(([sec,val],i)=>{
          const pct=total>0?(val/total)*100:0;
          return<div key={sec} style={{display:"grid",gridTemplateColumns:"12px 1fr auto auto",gap:T.s2,alignItems:"center",padding:`${T.s1} 0`,borderBottom:i===sorted.length-1?"none":`1px solid ${T.border}`}}>
            <span style={{width:8,height:8,borderRadius:2,background:colorOf(sec,i)}}/>
            <span style={{fontFamily:FP,fontSize:13,color:T.text,letterSpacing:"-0.005em",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{sec}</span>
            <span style={{fontFamily:FM,fontSize:11,color:T.muted,fontVariantNumeric:"tabular-nums",marginRight:T.s3}}>{kf(val)}</span>
            <span style={{fontFamily:FM,fontSize:11,fontWeight:600,color:T.textHi,fontVariantNumeric:"tabular-nums",minWidth:48,textAlign:"right"}}>{pct.toFixed(1)}%</span>
          </div>;
        })}
      </div>
    </div>
  </BentoTile>;
}

/* ─── PRIVACY: hide sensitive dollar values ──────────────
 * Eye-toggle in the Overview / Portfolio hero. Persists to localStorage
 * (so a refresh keeps the chosen state) and broadcasts via a custom
 * event so a click in one tab updates the other tab's render too. */
const HIDE_VALUES_KEY = "mizan_hide_values";
function readHideValues(){
  try { return localStorage.getItem(HIDE_VALUES_KEY) === "1"; } catch { return false; }
}
function useHideValues(){
  const [hidden, setHidden] = useState(readHideValues);
  useEffect(() => {
    const sync = () => setHidden(readHideValues());
    window.addEventListener("storage", sync);
    window.addEventListener("mizan-hide-values", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("mizan-hide-values", sync);
    };
  }, []);
  const toggle = () => {
    try {
      const next = !hidden;
      localStorage.setItem(HIDE_VALUES_KEY, next ? "1" : "0");
      setHidden(next);
      try { window.dispatchEvent(new Event("mizan-hide-values")); } catch {}
    } catch {}
  };
  return { hidden, toggle, mask: (formatted) => hidden ? "••••••" : formatted };
}

// Small button: open/closed eye icon, toggles the hide flag on click.
// Receives `hidden` + `toggle` from useHideValues so caller controls state.
function EyeToggle({ hidden, toggle, size = 18, color }){
  const stroke = color || "currentColor";
  return (
    <button
      type="button"
      onClick={toggle}
      title={hidden ? "Show values" : "Hide values"}
      aria-label={hidden ? "Show values" : "Hide values"}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: size + 14, height: size + 14, padding: 0, marginLeft: 8,
        background: "transparent", border: "none", borderRadius: 6,
        cursor: "pointer", color: stroke, opacity: 0.7,
        transition: "opacity 0.15s, background 0.15s",
      }}
      onMouseEnter={e=>{e.currentTarget.style.opacity="1";e.currentTarget.style.background="rgba(255,255,255,0.05)";}}
      onMouseLeave={e=>{e.currentTarget.style.opacity="0.7";e.currentTarget.style.background="transparent";}}>
      {hidden ? (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
          <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
          <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
          <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/>
          <line x1="1" y1="1" x2="23" y2="23"/>
        </svg>
      ) : (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
      )}
    </button>
  );
}

/* ─── ACCOUNT NICKNAME EDITOR ────────────────────────── */
// Inline editor for per-account display names. Used in both the Overview
// account cards and the Finances institution cards. When `nickname` is
// set, the rename takes over as the primary line and `defaultName`
// drops to a smaller subtitle so users can still see the broker label
// for cross-reference. Click the edit icon → swap to an input pre-populated with
// the current display. Enter / blur saves; Esc / cancel discards.
function NicknameEditor({accountId,defaultName,nickname,onSetNickname,
  primaryStyle,subtitleStyle,pencilStyle,emptyHint="—"}){
  const[editing,setEditing]=useState(false);
  const[draft,setDraft]=useState(nickname||defaultName||"");
  const inputRef=useRef(null);
  useEffect(()=>{if(editing&&inputRef.current){try{inputRef.current.focus();inputRef.current.select();}catch{}}},[editing]);
  const startEdit=()=>{setDraft(nickname||defaultName||"");setEditing(true);};
  const commit=()=>{
    if(!onSetNickname){setEditing(false);return;}
    const trimmed=(draft||"").trim();
    // Treat unchanged value or "same as broker default" as no-op.
    const next=trimmed===(defaultName||"")?"":trimmed;
    onSetNickname(accountId,next);
    setEditing(false);
  };
  const cancel=()=>{setDraft(nickname||defaultName||"");setEditing(false);};
  if(editing){
    return<div style={{display:"flex",alignItems:"center",gap:6,minWidth:0}}>
      <input
        ref={inputRef}
        value={draft}
        onChange={e=>setDraft(e.target.value)}
        onKeyDown={e=>{
          if(e.key==="Enter"){e.preventDefault();commit();}
          else if(e.key==="Escape"){e.preventDefault();cancel();}
        }}
        onBlur={commit}
        maxLength={80}
        aria-label="Account nickname"
        style={{
          flex:"1 1 auto",minWidth:0,
          fontFamily:FP,fontSize:(primaryStyle&&primaryStyle.fontSize)||13,
          color:T.textHi,letterSpacing:"-0.005em",
          background:T.surface,border:`1px solid ${T.blue}60`,borderRadius:T.rSm,
          padding:"3px 6px",outline:"none",
        }}
      />
    </div>;
  }
  const display=nickname||defaultName||emptyHint;
  return<div style={{display:"flex",alignItems:"center",gap:6,minWidth:0}}>
    <span style={{...(primaryStyle||{}),minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{display}</span>
    {onSetNickname&&<button
      type="button"
      onClick={startEdit}
      title={nickname?"Edit nickname":"Add nickname"}
      aria-label={nickname?"Edit account nickname":"Add account nickname"}
      style={{
        background:"transparent",border:"none",cursor:"pointer",padding:2,
        color:T.muted,lineHeight:1,fontSize:12,
        display:"inline-flex",alignItems:"center",
        ...(pencilStyle||{}),
      }}><Icon name="pencil" size={12}/></button>}
  </div>;
}

/* ─── OVERVIEW ───────────────────────────────────────── */
function Overview({live,snapAccounts=[],allAccounts=[],plaidAccounts=[],disabledAccts=new Set(),onToggleAcct,onDisconnectAcct,mapPosition,metrics={},activities=[],netWorthHistory=[],onNav,onConnect,onToggleDemoFromBanner,bankBalance=0,nicknames={},onSetNickname,demoMode=false,pendingSignals=0}){
  const { hidden: valuesHidden, toggle: toggleHideValues, mask } = useHideValues();
  const[range,setRange]=useState("1Y");
  // Rolling 24-hour intraday NAV buffer (client-captured on live ticks) —
  // powers the real-time 1D chart. localStorage-backed so it survives nav
  // changes within a session. Only accrues while the app is open.
  const[intraday,setIntraday]=useState(()=>{try{return JSON.parse(localStorage.getItem("mizan_intraday")||"[]");}catch{return[];}});
  const liveSrc=snapAccounts.length>0
    ? snapAccounts.flatMap(a=>a.positions.map(p=>mapPosition(p,a.accountName,a.brokerage))).filter(h => h && h.sh > 0 && h.px > 0)
    : [];
  const merged=liveSrc.map(h=>{const l=live.find(q=>q.tk===h.tk);return l?{...h,px:l.price||h.px,_p:l.pct||0}:h;});
  // Total value combines:
  //   - Brokerage balances from SnapTrade (cash + equity per account)
  //   - Bank net position from Plaid (checking + savings − credit/loan)
  //   - Manual zakatable assets (gold, real estate, business equity)
  // Falls back to summing position market values when no broker is connected.
  const equityValue=merged.reduce((s,h)=>s+mv(h),0);
  const balanceSum=snapAccounts.reduce((s,a)=>s+(a.balance||0),0);
  const manualAssetsRaw=(()=>{try{return JSON.parse(localStorage.getItem("mizan_manual_assets")||"[]");}catch{return[];}})();
  const manualAssetTotal=manualAssetsRaw.reduce((s,a)=>s+(+a.value||0),0);
  const brokerageTot=snapAccounts.length>0?balanceSum:equityValue;
  // Plaid investment-type balances ONLY contribute to Net Worth as a
  // fallback when SnapTrade isn't connected at all. When SnapTrade IS
  // connected, it is the canonical brokerage source — including Plaid
  // investments on top would double-count any broker the user happens
  // to link via both providers (e.g. Robinhood appears as both a
  // SnapTrade brokerage account AND a Plaid investment account with the
  // same underlying balance, ~$13k in both lists).
  //
  // Plaid depository / credit / loan accounts always count via
  // bankBalance — they don't overlap with SnapTrade.
  const plaidInvestmentTot = snapAccounts.length === 0
    ? plaidAccounts.filter(isBrokeragePlaid).reduce((s,a)=>s+(+a.current_bal||0),0)
    : 0;
  const tot=brokerageTot+(bankBalance||0)+plaidInvestmentTot+manualAssetTotal;
  // Net zakatable wealth — honours the user's chosen Islamic-finance
  // methodology (silver vs gold nisab, full vs 30% long-term investment
  // valuation). Investment-class wealth (brokerage holdings, Plaid
  // investment-type accounts) is scaled by investmentFactor: 1.0 for
  // full value (default), 0.30 for long-term holders per AAOIFI / contemporary
  // fatwa guidance. Cash (bank, brokerage cash) is always full value.
  const zakatSettings = useZakatSettings();
  const liveNisab     = useLiveNisab();
  const nisabOverview = nisabValueFor(zakatSettings, liveNisab);
  // Read the SAME comprehensive worksheet the Portfolio → Zakat tab edits so
  // both surfaces report an identical figure. In demo, seed from the demo
  // manual assets; otherwise use the saved worksheet (or a first-run seed from
  // the user's manual assets). gateDue:true zeroes the headline below nisab
  // (the Overview shows nothing due; the tab exposes the raw 2.5%).
  const savedWorksheet = useZakatWorksheet();
  const overviewWorksheet = effectiveZakatWorksheet(
    savedWorksheet,
    demoMode ? DEMO_MANUAL_ASSETS : manualAssetsRaw,
    demoMode,
  );
  // Same connected-account picker selection the Zakat tab uses (the unticked
  // account ids live in the worksheet), so the tile and the tab never disagree.
  const overviewExcluded = new Set(Array.isArray(overviewWorksheet.excludedAccounts) ? overviewWorksheet.excludedAccounts : []);
  const overviewConnectedTotals = zakatSelectedTotals(
    zakatConnectedAccounts(snapAccounts, plaidAccounts),
    overviewExcluded,
  );
  const overviewConnectedLiab = zakatSelectedLiabilities(
    zakatCreditAccounts(plaidAccounts),
    overviewExcluded,
  );
  const {
    aboveNisab: overviewAboveNisab,
    zakatDue: zakatDueOverview,
  } = computeZakatWorksheet({
    worksheet: overviewWorksheet,
    settings: zakatSettings,
    brokerageTotal: overviewConnectedTotals.invest,
    bankBalance: overviewConnectedTotals.cash,
    connectedLiabilities: overviewConnectedLiab,
    nisab: nisabOverview,
    gateDue: true,
  });

  // Purification owed — lazy-loaded once from API for the summary line
  const [purificationOwedTotal, setPurificationOwedTotal] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const log = (() => { try { return JSON.parse(localStorage.getItem("mizan_purification_log") || "{}"); } catch { return {}; } })();
    apiFetch(`/api/purification/calculate?year=${new Date().getFullYear()}`)
      .then(async r => {
        if (cancelled || !r.ok) return;
        const d = await r.json().catch(() => ({}));
        const items = Array.isArray(d?.items) ? d.items : [];
        const pending = items.filter(it => !log[it.fingerprint]);
        if (!cancelled) setPurificationOwedTotal(pending.reduce((s, it) => s + it.purificationOwed, 0));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const totCost=merged.reduce((s,h)=>s+cost(h),0);
  // Gain is computed against position cost basis only (cash isn't a "gain")
  const gain=equityValue-totCost;
  const gpc=totCost>0?(gain/totCost)*100:0;
  const today=merged.reduce((s,h)=>s + (typeof h._p === "number" ? h._p : 0)/100*mv(h), 0);
  const haram=merged.filter(h=>h.sh_==="haram");
  const haramV=haram.reduce((s,h)=>s+mv(h),0);
  const top=[...merged].sort((a,b)=>mv(b)-mv(a)).slice(0,5);
  // Cash on Hand = brokerage cash sweep + positive depository balances.
  //
  // Credit-card / loan debt is NOT subtracted here. Debt reduces Net Worth
  // (handled by `tot` above, which uses bankBalance = depository − debt),
  // but it does not reduce the dollars you have available to spend. A user
  // with $1k checking + $5k credit-card debt still has $1k cash on hand
  // — they owe $5k separately.
  const brokerCashSum = snapAccounts.reduce((s,a) => {
    if (typeof a.cash === "number") return s + a.cash;
    // Some brokers don't return a separate cash field. Fall back to
    // `balance - sum(position market values)` for that account.
    const equity = (a.positions || []).reduce((es, p) => {
      const px = p.last_ask_price || p.last_trade_price || p.price || 0;
      const units = p.units || p.shares || 0;
      return es + (px * units);
    }, 0);
    const inferred = Math.max(0, (a.balance || 0) - equity);
    return s + inferred;
  }, 0);
  // Sum only positive depository balances from Plaid. We never net credit
  // card debt out of cash, and we never add Plaid investment balances
  // (those flow into `plaidInvestmentTot` for net-worth, not cash).
  const depositorySum = plaidAccounts
    .filter(isBankAsset)
    .reduce((s,a) => s + Math.max(0, +a.current_bal || 0), 0);
  const bankCashContribution = depositorySum;
  const totalCash = brokerCashSum + bankCashContribution;
  // Cards show every connected account (disabled ones dimmed); numbers above
  // are calculated from the parent-filtered `snapAccounts` only.
  // NO fallback to ACCOUNTS constant — that's the owner's data and would
  // leak to every other user who signed up.
  const cardSource=allAccounts.length>0?allAccounts:snapAccounts;
  // Infer per-account cash when the broker doesn't return a separate cash
  // field. Matches the same fallback we apply to brokerCashSum above so the
  // per-card "X cash" line stays consistent with the Cash on Hand tile.
  const inferAcctCash=a=>{
    if(typeof a.cash==="number")return a.cash;
    const equity=(a.positions||[]).reduce((es,p)=>{
      const px=p.last_ask_price||p.last_trade_price||p.price||0;
      const units=p.units||p.shares||0;
      return es+(px*units);
    },0);
    return Math.max(0,(a.balance||0)-equity);
  };
  const snapCards=cardSource.map(a=>({
    source:"snaptrade",
    id:a.accountId, nm:`${a.brokerage} — ${a.accountName}`, val:a.balance||0, cash:inferAcctCash(a),
    type:a.brokerage, kind:"Brokerage", authId:a.authorizationId,
    disabled:disabledAccts.has(a.accountId),
    color:a.brokerageSlug==="FIDELITY"?T.blue:a.brokerageSlug==="ROBINHOOD"?T.gain
          :a.brokerageSlug==="EMPOWER"?"#7C3AED":a.brokerageSlug==="COINBASE"?T.gold
          :a.brokerageSlug==="CHASE"?"#0F4C81":T.muted,
  }));
  // Plaid accounts — every type is surfaced so the Overview tab reflects
  // every connection (10 accounts = 10 accounts, regardless of provider).
  // Type drives the displayed `val` sign and the colored accent so users see
  // at a glance whether a row is a bank deposit, debt, or investment.
  const plaidCards=plaidAccounts.map(a=>{
    const bal=+a.current_bal||0;
    const isDebt=isBankDebt(a);
    const isDep=isBankAsset(a);
    const isInv=isBrokeragePlaid(a);
    const kind=isDep?(a.subtype||"deposit").replace(/\b\w/g,c=>c.toUpperCase())
              :isDebt?(a.subtype||a.type||"credit").replace(/\b\w/g,c=>c.toUpperCase())
              :isInv?"Investment (Plaid)"
              :"Other";
    return{
      source:"plaid",
      id:a.account_id, nm:`${a.institution_name||"Bank"} — ${a.name||a.subtype||a.type}`,
      val:isDebt?-bal:bal,
      cash:isDep?bal:0,
      type:a.institution_name||"Bank", kind,
      mask:a.mask||null,
      color:isDebt?T.loss:isDep?T.blue:isInv?T.gold:T.muted,
      disabled:false,
    };
  });
  const acctsForCards=[...snapCards,...plaidCards];
  // Stat cards: top 3 accounts by balance, dynamically pulled from real data.
  // Empty array when no real connections — caller renders the Welcome
  // banner instead of fallback cards with owner-specific account names.
  const topAccts=[...snapAccounts].sort((a,b)=>(b.balance||0)-(a.balance||0)).slice(0,3);
  const acctCards=topAccts.map(a=>({
    label:a.brokerage,
    value:kf(a.balance||0),
    sub:`${a.accountName} · ${a.positions.length} pos`,
  }));
  // Chart seeded off current `tot` so demo + live both render an accurate
  // ending value. `tot` is rounded to a stable bucket so tiny live-price
  // wiggles don't reshuffle the curve every render.
  // Real chart series — monthly buckets from earliest deposit to today.
  //   contributions = cumulative DEPOSIT amounts (real)
  //   value         = portfolio value over time, anchored to current `tot`
  // For value, we lerp from the cumulative-contributions curve up to `tot` so
  // the line reflects both the cash you've put in AND the growth on top.
  const totBucket=Math.round(tot/1000);

  // Capture the live total into the rolling 24h intraday buffer. Throttled:
  // a new point is appended at most every 2 minutes; in between, the latest
  // point's value/timestamp track the live total so the chart tip stays live.
  useEffect(()=>{
    if(demoMode||!(tot>0))return; // never pollute the real 24h buffer with demo totals
    const now=Date.now();
    setIntraday(prev=>{
      const cutoff=now-24*3600*1000;
      let next=prev.filter(p=>p&&p.ts>=cutoff);
      const last=next[next.length-1];
      const pt={ts:now,total:+tot.toFixed(2)};
      if(!last||now-last.ts>120000)next=[...next,pt];
      else next=[...next.slice(0,-1),pt]; // update tip in place (throttle density)
      try{localStorage.setItem("mizan_intraday",JSON.stringify(next));}catch{}
      return next;
    });
  },[tot]);

  // Nightly snapshots sorted newest-first for 1D/1W baselines.
  const sortedSnaps=useMemo(()=>[...netWorthHistory].sort((a,b)=>b.date.localeCompare(a.date)),[netWorthHistory]);
  // 1D: most recent snapshot strictly before today → 24h baseline (chart seed).
  const snap1D=useMemo(()=>{const t=new Date().toISOString().slice(0,10);return sortedSnaps.find(s=>s.date<t)||null;},[sortedSnaps]);
  // 1W: most recent snapshot at or before the most recent Sunday → week-to-date.
  const snap1W=useMemo(()=>{const d=new Date();const day=d.getDay();d.setDate(d.getDate()-(day===0?7:day));const str=d.toISOString().slice(0,10);return sortedSnaps.find(s=>s.date<=str)||null;},[sortedSnaps]);

  const chart=useMemo(()=>{
    const now=new Date();

    // ─── 1D: real-time 24h curve from the intraday buffer ───────────────
    if(range==="1D"){
      const cutoffTs=Date.now()-24*3600*1000;
      const pts=intraday.filter(p=>p&&p.ts>=cutoffTs)
        .map(p=>({ts:p.ts,date:new Date(p.ts).toISOString(),value:+(+p.total).toFixed(2),contrib:null}));
      // Seed an anchor at -24h from yesterday's close so the line always draws.
      if(snap1D)pts.unshift({ts:cutoffTs,date:new Date(cutoffTs).toISOString(),value:+(+snap1D.total).toFixed(2),contrib:null});
      // Pin the tip to the live total.
      if(tot>0){
        if(pts.length)pts[pts.length-1]={...pts[pts.length-1],ts:Date.now(),value:+tot.toFixed(2)};
        else pts.push({ts:Date.now(),date:new Date().toISOString(),value:+tot.toFixed(2),contrib:null});
      }
      return pts;
    }

    // ─── 1W: real-time daily curve for the current week (Sunday → today) ─
    if(range==="1W"){
      const todayKey=now.toISOString().slice(0,10);
      const sunday=new Date(now);sunday.setDate(now.getDate()-now.getDay());sunday.setHours(0,0,0,0);
      const byDate={};
      netWorthHistory.forEach(h=>{if(h.date>=sunday.toISOString().slice(0,10)&&h.date<=todayKey)byDate[h.date]=h.total;});
      const series=[];
      const cur=new Date(sunday);
      while(cur<=now){
        const k=cur.toISOString().slice(0,10);
        const val=k===todayKey?(tot>0?tot:byDate[k]):byDate[k];
        if(val!=null)series.push({ts:cur.getTime(),date:k,value:+(+val).toFixed(2),contrib:null});
        cur.setDate(cur.getDate()+1);
      }
      // Guarantee a live tip for today even if no snapshot was written yet.
      if(tot>0&&!series.some(p=>p.date===todayKey))series.push({ts:now.getTime(),date:todayKey,value:+tot.toFixed(2),contrib:null});
      return series;
    }

    const today=now;
    const deposits=activities.filter(a=>(a.type||"").toUpperCase()==="DEPOSIT")
      .filter(a=>a.trade_date)
      .sort((a,b)=>a.trade_date.localeCompare(b.trade_date));

    let firstDate;
    if(deposits.length>0){
      firstDate=new Date(deposits[0].trade_date);
    }else{
      // No real history — fall back to a 1-year synthetic window
      firstDate=new Date(today);firstDate.setFullYear(today.getFullYear()-1);
    }

    // Range filter
    const cutoff=new Date(today);
    if(range==="1D")cutoff.setDate(today.getDate()-1);
    else if(range==="1W"){const d=today.getDay();cutoff.setDate(today.getDate()-(d===0?7:d));}
    else if(range==="1M")cutoff.setMonth(today.getMonth()-1);
    else if(range==="3M")cutoff.setMonth(today.getMonth()-3);
    else if(range==="YTD")cutoff.setFullYear(today.getFullYear(),0,1);
    else if(range==="1Y")cutoff.setFullYear(today.getFullYear()-1);
    else cutoff.setTime(firstDate.getTime()); // "All"
    const startDate=cutoff>firstDate?cutoff:firstDate;

    // Build monthly buckets from startDate → today
    const buckets=[];
    const cur=new Date(startDate.getFullYear(),startDate.getMonth(),1);
    while(cur<=today){
      buckets.push(new Date(cur));
      cur.setMonth(cur.getMonth()+1);
    }
    if(buckets.length===0)buckets.push(new Date(today));

    // Cumulative contributions, walking through deposits
    let cum=0;
    let depIdx=0;
    // Pre-sum everything before startDate
    while(depIdx<deposits.length&&new Date(deposits[depIdx].trade_date)<startDate){
      cum+=+deposits[depIdx].amount||0;
      depIdx++;
    }
    const baselineContrib=cum;

    const series=buckets.map(bucket=>{
      const next=new Date(bucket);next.setMonth(next.getMonth()+1);
      while(depIdx<deposits.length&&new Date(deposits[depIdx].trade_date)<next){
        cum+=+deposits[depIdx].amount||0;
        depIdx++;
      }
      return{
        date:bucket.toISOString().slice(0,10),
        ts:bucket.getTime(),
        contrib:+cum.toFixed(2),
      };
    });

    // Now interpolate `value` so the last point equals current `tot` and the
    // shape tracks contributions but with growth on top.
    const totalContrib=series[series.length-1].contrib;
    const startContrib=series[0].contrib;
    const totalSpan=totalContrib-startContrib;
    const valueSpan=tot-(startContrib||0);
    series.forEach((p,i)=>{
      const progress=series.length>1?i/(series.length-1):1;
      const trackedContrib=p.contrib;
      const baseProg=totalSpan>0?(trackedContrib-startContrib)/totalSpan:progress;
      const blended=0.6*baseProg+0.4*progress;
      p.value=+(((startContrib||0)+valueSpan*blended)).toFixed(2);
    });

    // Real net-worth snapshots override the interpolation for exact dates.
    if(netWorthHistory.length>0){
      const histByMonth={};
      netWorthHistory.forEach(h=>{
        const k=h.date.slice(0,7);
        // Most recent snapshot in each month wins
        if(!histByMonth[k]||h.date>histByMonth[k].date)histByMonth[k]=h;
      });
      series.forEach(p=>{
        const k=p.date.slice(0,7);
        if(histByMonth[k])p.value=+histByMonth[k].total.toFixed(2);
      });
    }
    // Always pin the final point to the live net worth so the chart's tip
    // matches the headline number — a stale current-month snapshot must never
    // override "now". (1D/1W already pin their tip above.)
    if(tot>0&&series.length)series[series.length-1]={...series[series.length-1],value:+tot.toFixed(2)};
    return series;
  },[activities,netWorthHistory,totBucket,range,intraday,tot,snap1D]);

  const rangeStartVal=chart.length>1?chart[0].value:null;
  const dispGain=
    range==="1D"?(snap1D?tot-snap1D.total:today)
    :range==="1W"?(snap1W?tot-snap1W.total:(rangeStartVal!==null?tot-rangeStartVal:gain))
    :rangeStartVal!==null?tot-rangeStartVal:gain;
  const dispGpc=
    range==="1D"?(snap1D&&snap1D.total>0?(tot-snap1D.total)/snap1D.total*100:(tot>0?(today/(tot-today))*100:0))
    :range==="1W"?(snap1W&&snap1W.total>0?(tot-snap1W.total)/snap1W.total*100:(rangeStartVal>0?(tot-rangeStartVal)/rangeStartVal*100:gpc))
    :rangeStartVal>0?(tot-rangeStartVal)/rangeStartVal*100:gpc;
  const dispGainLabel=range==="All"?"all-time":range.toLowerCase();

  // Empty-state welcome card — shows for fresh users with no real broker
  // connections and demo mode off. Replaces the previous behavior where new
  // users saw a hardcoded sample portfolio.
  const isEmpty=snapAccounts.length===0&&merged.length===0;

  // Why a holding screens non-compliant — read from the screener's day cache so
  // the Overview alert can explain each verdict (sector exclusion or the failing
  // ratio), not just list tickers. Same single source of truth as the Screener.
  const screenCache=useMemo(()=>{try{return JSON.parse(localStorage.getItem("mizan_aaoifi_cache")||"{}");}catch{return{};}},[]);
  const reasonFor=tk=>{
    const v=screenCache[tk];if(!v)return"";
    if(v.reason)return v.reason;
    const bs=v.byStandard?.AAOIFI;
    const f=(bs?.tests||[]).find(t=>!t.pass)||bs?.fails?.[0];
    return f?`Fails ${f.rule}${f.detail?` (${f.detail})`:""}`:"";
  };

  // Sharia-compliance breakdown of the SCREENED EQUITY holdings (live-priced).
  // These drive BOTH the allocation donut and the Compliance tile from one set
  // of numbers so the two can never disagree. The denominator is equity — cash,
  // bank deposits and manual assets (gold, real estate) are not "stocks to
  // screen", so they must never inflate the compliance %.
  const equityTotal = merged.reduce((s,h)=>s+mv(h),0);
  const halalV  = merged.filter(h=>h.sh_==="halal").reduce((s,h)=>s+mv(h),0);
  const reviewV = merged.filter(h=>h.sh_==="review").reduce((s,h)=>s+mv(h),0);
  const halalCount  = merged.filter(h=>h.sh_==="halal").length;
  const reviewCount = merged.filter(h=>h.sh_==="review").length;
  // Allocation slices: equity grouped by compliance status, plus cash.
  const allocSlices=[
    {label:"Halal",        value:halalV,   color:T.gain},
    {label:"Review",       value:reviewV,  color:T.gold},
    {label:"Non-compliant",value:haramV,   color:T.loss},
    {label:"Cash",         value:totalCash,color:T.blue},
  ].filter(s=>s.value>0);

  // Today's spark — last 20 chart points if available, otherwise synthetic.
  const heroSpark=chart.length>0
    ? chart.slice(-20).map(p=>p.value)
    : Array.from({length:20},(_,i)=>tot*(0.95+i*0.0025));
  // Compliance headline = confirmed-halal share of SCREENED EQUITY (not net
  // worth). The old ((tot−haramV)/tot) inflated the figure with cash/manual
  // assets and blessed every "review"/unscreened holding as compliant, so the
  // headline % contradicted the "X of Y halal" count AND the allocation donut
  // (e.g. all-unscreened read "100.0%" over "0 of 8 halal"). Now they reconcile:
  // % and count share the same halal-over-equity basis. null → no holdings yet.
  const halalPct = equityTotal>0 ? (halalV/equityTotal)*100 : null;
  // Red only when you actually hold something non-compliant; green when ≥95%
  // confirmed halal; gold when the rest is merely pending review (not haram).
  const complianceColor = haramV>0 ? T.loss : halalPct==null ? T.muted : halalPct>=95 ? T.gain : T.gold;
  const fmtUSD=v=>`$${(+v).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}`;

  return<div className="bento" style={{display:"flex",flexDirection:"column",gap:T.s5}}>
    {/* Welcome state */}
    {isEmpty&&<BentoTile glass style={{textAlign:"center",padding:`${T.s10} ${T.s8}`}}>
      <div style={{fontFamily:FM,fontSize:10,color:T.blue,letterSpacing:"0.22em",fontWeight:600,marginBottom:T.s3}}>WELCOME TO MĪZAN</div>
      <div style={{fontFamily:FU,fontSize:30,fontWeight:700,color:T.textHi,letterSpacing:"-0.025em",marginBottom:T.s2}}>Connect your first brokerage</div>
      <div style={{fontFamily:FP,fontSize:14,color:T.muted,lineHeight:1.6,maxWidth:540,margin:`0 auto ${T.s6}`}}>
        Link Fidelity, Robinhood, Schwab, Coinbase, or any of 60+ brokers via SnapTrade. Your real holdings, activity, and Sharia screening will appear here.
      </div>
      <div style={{display:"flex",gap:T.s2,justifyContent:"center",flexWrap:"wrap"}}>
        <button onClick={onConnect} className="btn-primary" style={{fontSize:13,padding:`12px ${T.s5}`}}>+ Connect Account</button>
        <button onClick={onToggleDemoFromBanner} className="btn-ghost" style={{fontSize:13,padding:`11px ${T.s5}`,color:T.gold,borderColor:T.gold+"40"}}>Try Demo Mode →</button>
      </div>
    </BentoTile>}

    {/* Bot signals awaiting approval — surfaced here so you don't have to sit on the Trade tab */}
    {pendingSignals>0&&<div onClick={()=>onNav("trade")} style={{cursor:"pointer",padding:`${T.s3} ${T.s4}`,background:`linear-gradient(135deg, ${T.blue}14, transparent 60%), ${T.surface}`,border:`1px solid ${T.blue}40`,borderRadius:T.rMd,display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:T.s2}}>
      <span style={{display:"inline-flex",alignItems:"center",gap:T.s2,fontFamily:FM,fontSize:12,color:T.blue,fontWeight:600}}>
        <LiveDot on pulse/>{pendingSignals} bot signal{pendingSignals===1?"":"s"} need{pendingSignals===1?"s":""} your approval
      </span>
      <span style={{fontFamily:FM,fontSize:10,fontWeight:600,color:T.blue,letterSpacing:"0.08em"}}>REVIEW →</span>
    </div>}

    {/* Compliance alert — non-compliant holdings WITH the reason for each */}
    {haramV>0&&<div style={{padding:`${T.s3} ${T.s4}`,background:T.lossBg,border:`1px solid ${T.loss}30`,borderRadius:T.rMd}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:T.s2,marginBottom:T.s2}}>
        <span style={{fontFamily:FM,fontSize:10,color:T.loss,letterSpacing:"0.14em",fontWeight:600}}>NON-COMPLIANT HOLDINGS · {haram.length} · {mask(f$(haramV))}</span>
        <button onClick={()=>onNav("portfolio")} style={{fontFamily:FM,fontSize:10,fontWeight:600,color:T.loss,background:"transparent",border:`1px solid ${T.loss}40`,borderRadius:T.rMd,padding:`4px ${T.s3}`,cursor:"pointer",letterSpacing:"0.08em"}}>EXIT PLAN →</button>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:4}}>
        {haram.slice(0,5).map(h=>{const why=reasonFor(h.tk);return<div key={h.tk} style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:T.s2,fontFamily:FM,fontSize:11,color:T.text}}>
          <span><span style={{fontWeight:600,color:T.loss}}>{h.tk}</span>{why?<span style={{color:T.muted}}> — {why}</span>:null}</span>
          <span style={{color:T.muted,fontVariantNumeric:"tabular-nums",flexShrink:0}}>{mask(f$(mv(h)))}</span>
        </div>;})}
        {haram.length>5&&<span style={{fontFamily:FM,fontSize:10,color:T.muted}}>+{haram.length-5} more — see Portfolio → Screener</span>}
      </div>
    </div>}

    {/* ─── BENTO ROW 1: Hero + side stack ─────────────── */}
    <div className="bento-row" style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:T.s4}}>
      {/* HERO — Portfolio value with gradient + sparkline */}
      <BentoTile style={{
        background:`radial-gradient(circle at 0% 0%, ${T.blue}1F, transparent 55%), radial-gradient(circle at 100% 100%, ${T.gold}14, transparent 50%), ${T.card}`,
        borderColor:T.blue+"30",
        padding:`${T.s6} ${T.s6}`,
        minHeight:240,
      }}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:T.s3,flexWrap:"wrap",gap:T.s2}}>
          <div style={{display:"inline-flex",alignItems:"center",fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.18em",fontWeight:600}}>
            <span>NET WORTH</span>
            {snapAccounts.length>0&&<span style={{color:T.gain,marginLeft:T.s2,display:"inline-flex",alignItems:"center",gap:5}}><LiveDot on pulse/>LIVE</span>}
            <EyeToggle hidden={valuesHidden} toggle={toggleHideValues} size={14} color={T.muted}/>
          </div>
          <div style={{display:"flex",gap:T.s1}}>
            {["1D","1W","1M","3M","YTD","1Y","All"].map(r=><button key={r} onClick={()=>setRange(r)} style={{padding:`4px ${T.s3}`,borderRadius:T.rSm,fontFamily:FM,fontSize:10,fontWeight:600,letterSpacing:"0.04em",background:range===r?T.blue:"transparent",border:`1px solid ${range===r?T.blue:T.border}`,color:range===r?"#fff":T.muted,cursor:"pointer",transition:"all 0.15s"}}>{r}</button>)}
          </div>
        </div>
        <div style={{display:"flex",alignItems:"baseline",gap:T.s3,marginBottom:T.s1,flexWrap:"wrap"}}>
          <div style={{fontFamily:FU,fontSize:46,fontWeight:700,color:T.textHi,letterSpacing:"-0.035em",lineHeight:1,fontVariantNumeric:"tabular-nums"}}>{mask(fmtUSD(tot))}</div>
        </div>
        <div style={{display:"flex",gap:T.s4,marginTop:T.s2,fontFamily:FM,fontSize:12,color:T.muted,flexWrap:"wrap",alignItems:"center"}}>
          <span style={{display:"inline-flex",alignItems:"center",gap:T.s1}}>
            <span style={{color:dispGain>=0?T.gain:T.loss,fontWeight:600}}>{valuesHidden?"••••":`${dispGain>=0?"+":""}${kf(Math.abs(dispGain))}`}</span>
            <span style={{color:dispGpc>=0?T.gain:T.loss}}>({valuesHidden?"••":fp(dispGpc)})</span>
            {dispGainLabel}
          </span>
          <span style={{color:T.dim}}>·</span>
          <span>Today <span style={{color:fc(today),fontWeight:600}}>{valuesHidden?"••••":`${today>=0?"+":""}${f$(Math.abs(today))}`}</span></span>
        </div>
        <div style={{marginTop:T.s4,height:180}}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chart} margin={{top:6,right:8,bottom:20,left:56}}>
              <defs><linearGradient id="hero-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={T.blue} stopOpacity={0.3}/><stop offset="100%" stopColor={T.blue} stopOpacity={0}/></linearGradient></defs>
              <XAxis
                dataKey="ts" type="number" domain={["dataMin","dataMax"]} scale="time"
                tickFormatter={ts=>{
                  const d=new Date(ts);
                  if(range==="1D")return d.toLocaleTimeString("en-US",{hour:"numeric"});
                  if(range==="1W")return d.toLocaleDateString("en-US",{weekday:"short"});
                  const mo=d.toLocaleString("en-US",{month:"short"});
                  const yr=String(d.getFullYear()).slice(2);
                  return d.getMonth()===0?`${mo} '${yr}`:mo;
                }}
                tick={{fontFamily:FM,fontSize:9,fill:T.muted}} tickLine={false} axisLine={false}
                minTickGap={36}/>
              <YAxis
                domain={[0,"auto"]}
                tickFormatter={v=>v===0?"$0":`$${v>=1000?(v/1000).toFixed(0)+"k":v}`}
                tick={{fontFamily:FM,fontSize:9,fill:T.muted}} tickLine={false} axisLine={false}
                width={50}/>
              <Tooltip
                labelFormatter={ts=>{
                  const d=new Date(ts);
                  if(range==="1D")return d.toLocaleString("en-US",{hour:"numeric",minute:"2-digit"});
                  if(range==="1W")return d.toLocaleDateString("en-US",{weekday:"long",month:"short",day:"numeric"});
                  return d.toLocaleDateString("en-US",{year:"numeric",month:"short"});
                }}
                formatter={(v,name)=>[fmtUSD(v),name==="value"?"Net Worth":"Contributions"]}
                contentStyle={{background:T.card,border:`1px solid ${T.borderHi}`,borderRadius:T.rMd,fontFamily:FM,fontSize:11,boxShadow:"var(--sh-md)"}}
                itemStyle={{color:T.textHi}} labelStyle={{color:T.muted,fontSize:10}}/>
              <Area type="monotone" dataKey="value" stroke={T.blue} strokeWidth={2} fill="url(#hero-g)" dot={false}/>
              <Line type="monotone" dataKey="contrib" stroke={T.gold} strokeWidth={1.5} dot={false} strokeDasharray="3 3"/>
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </BentoTile>

      {/* Side stack: Zakat + Compliance + Cash */}
      <div style={{display:"flex",flexDirection:"column",gap:T.s4}}>
        <BentoTile accent={T.gold} style={{background:`linear-gradient(135deg, ${T.gold}10, transparent 60%), ${T.card}`}}>
          <div style={{fontFamily:FM,fontSize:10,color:T.gold,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>ZAKAT DUE</div>
          <div style={{fontFamily:FU,fontSize:28,fontWeight:700,color:T.textHi,letterSpacing:"-0.03em",fontVariantNumeric:"tabular-nums"}}>{mask(fmtUSD(zakatDueOverview))}</div>
          <div style={{fontFamily:FM,fontSize:11,color:T.muted,marginTop:T.s1}}>{overviewAboveNisab?`2.5% of net zakatable wealth${zakatSettings.investmentMethod==="longterm_30"?" (30% rule on investments)":""}`:`Below nisab (${zakatSettings.nisabStandard} standard, ${fmtUSD(nisabOverview)})`}</div>
          {purificationOwedTotal != null && purificationOwedTotal > 0 && (
            <button onClick={() => onNav?.("goals")} style={{display:"flex",alignItems:"center",gap:4,marginTop:T.s2,background:`${T.gold}10`,border:`1px solid ${T.gold}30`,borderRadius:T.rSm,padding:`3px ${T.s2}`,cursor:"pointer",fontFamily:FM,fontSize:10,color:T.gold,fontWeight:600,letterSpacing:"0.06em",textDecoration:"none",width:"100%",justifyContent:"flex-start"}}>
              <Icon name="leaf" size={12} color={T.gold}/>
              <span>Purify {fmtUSD(purificationOwedTotal)} → Zakat tab</span>
            </button>
          )}
        </BentoTile>
        <BentoTile>
          <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>COMPLIANCE</div>
          <div style={{fontFamily:FU,fontSize:28,fontWeight:700,color:complianceColor,letterSpacing:"-0.03em",fontVariantNumeric:"tabular-nums"}}>{halalPct==null?"—":`${halalPct.toFixed(1)}%`}</div>
          <div style={{fontFamily:FM,fontSize:11,color:T.muted,marginTop:T.s1}}>{merged.length===0?"No holdings to screen":<>{halalCount} of {merged.length} halal{reviewCount>0?` · ${reviewCount} review`:""}{haram.length>0?` · ${haram.length} non-compliant`:""}</>}</div>
        </BentoTile>
        {(totalCash>0||snapAccounts.length>0)&&<BentoTile>
          <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>CASH ON HAND</div>
          <div style={{fontFamily:FU,fontSize:24,fontWeight:600,color:T.textHi,letterSpacing:"-0.025em",fontVariantNumeric:"tabular-nums"}}
               title={`Brokerage cash (SnapTrade): ${fmtUSD(brokerCashSum)}\nBank deposits (Plaid depository): ${fmtUSD(bankCashContribution)}\nTotal: ${fmtUSD(totalCash)}\n\nDebts (credit / loan) reduce Net Worth elsewhere but never reduce Cash on Hand.`}>{mask(fmtUSD(totalCash))}</div>
          <div style={{fontFamily:FM,fontSize:11,color:T.muted,marginTop:T.s1}}>
            {valuesHidden
              ? "Brokerage cash + bank deposits"
              : <>Brokerage <b style={{color:T.text}}>{fmtUSD(brokerCashSum)}</b> + Bank <b style={{color:T.text}}>{fmtUSD(bankCashContribution)}</b></>}
          </div>
        </BentoTile>}
      </div>
    </div>

    {/* ─── BENTO ROW 2: Allocation donut + Performance metrics ─── */}
    <div className="bento-row" style={{display:"grid",gridTemplateColumns:"1fr 2fr",gap:T.s4}}>
      <BentoTile>
        <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s4}}>ALLOCATION</div>
        {allocSlices.length>0?<div style={{display:"flex",gap:T.s5,alignItems:"center",flexWrap:"wrap"}}>
          <Donut slices={allocSlices} size={170} thickness={20} centerLabel="Total" centerValue={mask(kf(allocSlices.reduce((s,x)=>s+x.value,0)))}/>
          <div style={{display:"flex",flexDirection:"column",gap:T.s2,flex:1,minWidth:140}}>
            {allocSlices.map(s=>{
              const t=allocSlices.reduce((a,b)=>a+b.value,0);
              const pct=t>0?(s.value/t*100):0;
              return<div key={s.label} style={{display:"flex",alignItems:"center",gap:T.s2}}>
                <span style={{width:8,height:8,borderRadius:2,background:s.color,flexShrink:0}}/>
                <span style={{fontFamily:FP,fontSize:13,color:T.text,flex:1,letterSpacing:"-0.005em"}}>{s.label}</span>
                <span style={{fontFamily:FM,fontSize:11,fontWeight:600,color:T.textHi,fontVariantNumeric:"tabular-nums"}}>{valuesHidden?"••":`${pct.toFixed(1)}%`}</span>
              </div>;
            })}
          </div>
        </div>:<div style={{fontFamily:FP,fontSize:13,color:T.muted,padding:`${T.s5} 0`,textAlign:"center"}}>Connect a brokerage to see your allocation.</div>}
      </BentoTile>

      <BentoTile>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:T.s4}}>
          <span style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600}}>PERFORMANCE</span>
          {metrics.activityCount>0&&<span style={{fontFamily:FM,fontSize:10,color:T.blue,letterSpacing:"0.06em"}}>● {metrics.activityCount} activities</span>}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(120px, 1fr))",gap:T.s4}}>
          {[
            {label:"Total Return",  value:mask(`${gain>=0?"+":""}${fmtUSD(Math.abs(gain))}`),sub:totCost>0?fp(gpc):"Unrealized",subColor:fc(gain)},
            {label:"YTD Contrib.",  value:mask(kf(metrics.ytdContrib||0)),                sub:"This year",                    subColor:T.gain},
            {label:"All-Time",       value:mask(kf(metrics.allTimeContrib||0)),            sub:"Lifetime deposits"},
            {label:"YTD Dividends", value:mask(kf(metrics.ytdDividends||0)),               sub:"Cash received",                subColor:T.gold},
            {label:"Fees (YTD)",    value:mask(kf(metrics.ytdFees||0)),                    sub:valuesHidden?"•••• all-time":`${kf(metrics.allTimeFees||0)} all-time`,subColor:T.loss},
            {label:"Net Inflow",    value:mask(fmtUSD((metrics.ytdContrib||0)-(metrics.ytdWithdrawals||0))),sub:"Deposits − withdrawals",subColor:T.gain},
          ].map(s=><div key={s.label}>
            <div style={{fontFamily:FM,fontSize:9,color:T.muted,letterSpacing:"0.14em",fontWeight:500,marginBottom:T.s1,textTransform:"uppercase"}}>{s.label}</div>
            <div style={{fontFamily:FU,fontSize:18,fontWeight:600,color:T.textHi,letterSpacing:"-0.02em",lineHeight:1.1,fontVariantNumeric:"tabular-nums"}}>{s.value}</div>
            {s.sub&&<div style={{fontFamily:FM,fontSize:10,fontWeight:500,color:s.subColor||T.muted,marginTop:T.s1}}>{s.sub}</div>}
          </div>)}
        </div>
      </BentoTile>
    </div>

    {/* ─── BENTO ROW 3: Top Holdings ────────────────── */}
    {top.length>0&&<CollapsibleTile title="TOP HOLDINGS" subtitle={`${top.length} position${top.length!==1?"s":""} by value`} storageKey="ov_top" defaultOpen
      right={snapAccounts.length>0?<span style={{fontFamily:FM,fontSize:10,color:T.blue,letterSpacing:"0.06em"}}>● REAL</span>:null}>
      <div style={{display:"flex",flexDirection:"column",gap:T.s2}}>
        {top.map(h=>{
          const gpct=gp(h),pof=tot>0?mv(h)/tot*100:0;
          return<div key={h.tk+(h.ac_||"")} style={{display:"flex",alignItems:"center",gap:T.s4,padding:`${T.s2} 0`,borderBottom:`1px solid ${T.border}`}}>
            <div style={{width:56}}>
              <div style={{fontFamily:FP,fontSize:14,fontWeight:600,color:T.textHi,letterSpacing:"-0.01em"}}>{h.tk}</div>
              <div style={{fontFamily:FM,fontSize:10,color:T.muted,marginTop:2,letterSpacing:"0.02em"}}>{h.br}</div>
            </div>
            <div style={{flex:1,minWidth:50}}>
              <div style={{height:4,background:T.dim,borderRadius:2,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${Math.min(pof*4,100)}%`,background:`linear-gradient(90deg, ${h.sh_==="haram"?T.loss:T.blue}, ${h.sh_==="haram"?T.loss:T.blueDim})`,borderRadius:2,transition:"width 0.4s"}}/>
              </div>
              <div style={{fontFamily:FM,fontSize:9,color:T.muted,marginTop:T.s1,letterSpacing:"0.04em"}}>{valuesHidden?"••% of book":`${pof.toFixed(1)}% of book`}</div>
            </div>
            <div style={{width:90,textAlign:"right"}}>
              <div style={{fontFamily:FP,fontSize:14,fontWeight:600,color:T.textHi,letterSpacing:"-0.01em",fontVariantNumeric:"tabular-nums"}}>{mask(f$(mv(h)))}</div>
              <div style={{fontFamily:FM,fontSize:10,fontWeight:500,color:fc(gpct),marginTop:2}}>{valuesHidden?"••":fp(gpct)}</div>
            </div>
            <Sk vals={Array.from({length:24},()=>mv(h)*(1+(Math.random()-.48)*.02))} color={fc(gpct)} w={80} h={28} fill/>
          </div>;
        })}
      </div>
    </CollapsibleTile>}

    {/* ─── BENTO ROW 4: Accounts (unified SnapTrade + Plaid) ───── */}
    {acctsForCards.length>0&&<CollapsibleTile title="ACCOUNTS" storageKey="ov_accts" defaultOpen
      subtitle={`${acctsForCards.length} linked${snapCards.length>0?` · ${snapCards.length} brokerage`:""}${plaidCards.length>0?` · ${plaidCards.length} bank/credit`:""}${disabledAccts.size>0?` · ${disabledAccts.size} hidden`:""}`}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:T.s2}}>
        {acctsForCards.map(a=>{
          const dim=a.disabled;
          const isPlaid=a.source==="plaid";
          const valColor=a.val<0?T.loss:T.textHi;
          return<div key={`${a.source}-${a.id}`} style={{
            background:dim?"transparent":T.surface,
            border:`1px solid ${dim?T.border:T.border}`,
            borderLeft:`3px solid ${a.color}`,
            borderRadius:T.rMd,
            padding:`${T.s3} ${T.s4} 28px`,
            position:"relative",
            opacity:dim?0.4:1,
            transition:"all 0.18s",
            minHeight:120,
          }}>
            {/* Type label — top-left. Sits below the action button row so
                the two never collide regardless of card width. */}
            <div style={{fontFamily:FM,fontSize:9,color:T.muted,letterSpacing:"0.14em",fontWeight:600,marginBottom:T.s1,paddingRight:64,textDecoration:dim?"line-through":"none"}}>{(a.type||"").toUpperCase()}</div>
            <div style={{fontFamily:FU,fontSize:18,fontWeight:700,color:valColor,letterSpacing:"-0.02em",fontVariantNumeric:"tabular-nums",textDecoration:dim?"line-through":"none"}}>{mask(fmtUSD(a.val||0))}</div>
            <div style={{fontFamily:FM,fontSize:10,color:T.muted,marginTop:2,letterSpacing:"0.04em"}}>{a.kind}{a.mask?` · ••${a.mask}`:""}</div>
            {a.cash>0&&<div style={{fontFamily:FM,fontSize:10,color:T.muted,marginTop:T.s1}}>{mask(fmtUSD(a.cash))} cash</div>}
            {/* Account name — shows user nickname if set, with the broker
                default as a small subtitle. Pencil button opens an inline
                editor; Enter commits, Esc cancels. */}
            <div style={{marginTop:T.s1}}>
              <NicknameEditor
                accountId={a.id}
                defaultName={a.nm}
                nickname={nicknames?.[a.id]||""}
                onSetNickname={onSetNickname}
                primaryStyle={{fontFamily:FP,fontSize:11,color:nicknames?.[a.id]?T.textHi:T.muted,letterSpacing:"-0.005em",fontWeight:nicknames?.[a.id]?600:400}}
                pencilStyle={{fontSize:12}}
              />
              {nicknames?.[a.id]&&<div style={{fontFamily:FM,fontSize:10,color:T.muted,marginTop:2}}>{a.nm}</div>}
            </div>

            {/* Action buttons — top-right. SnapTrade gets toggle + disconnect;
                Plaid gets a "Manage →" jump to the Finances tab. */}
            {!isPlaid&&<div style={{position:"absolute",top:T.s2,right:T.s2,display:"flex",gap:4}}>
              {onToggleAcct&&<button onClick={()=>onToggleAcct(a.id)} title={dim?"Include in totals":"Hide from totals"}
                style={{padding:`2px ${T.s2}`,borderRadius:T.rSm,fontFamily:FM,fontSize:9,fontWeight:600,letterSpacing:"0.06em",
                  background:dim?"transparent":`${T.muted}14`,border:`1px solid ${dim?T.gain+"40":T.border}`,
                  color:dim?T.gain:T.muted,cursor:"pointer"}}>{dim?"ON":"OFF"}</button>}
              {onDisconnectAcct&&<button onClick={()=>onDisconnectAcct(a.id,a.authId,a.nm)} title="Permanently disconnect"
                style={{padding:`2px ${T.s2}`,borderRadius:T.rSm,fontFamily:FM,fontSize:10,lineHeight:1,
                  background:"transparent",border:`1px solid ${T.loss}30`,color:T.loss,cursor:"pointer"}}><Icon name="close" size={12}/></button>}
            </div>}
            {isPlaid&&onNav&&<button onClick={()=>onNav("finances")} title="Manage in Finances tab"
              style={{position:"absolute",top:T.s2,right:T.s2,padding:`2px ${T.s2}`,borderRadius:T.rSm,fontFamily:FM,fontSize:9,fontWeight:600,letterSpacing:"0.06em",lineHeight:1.4,
                background:`${T.gold}14`,border:`1px solid ${T.gold}40`,color:T.gold,cursor:"pointer"}}>MANAGE →</button>}

            {/* Source badge — anchored to the bottom-right. Small, low-contrast,
                purely informational. Out of the action buttons' lane. */}
            <div style={{position:"absolute",bottom:6,right:T.s3,fontFamily:FM,fontSize:8,color:isPlaid?T.gold:T.blue,opacity:0.7,letterSpacing:"0.12em",fontWeight:600}}>{isPlaid?"PLAID":"SNAPTRADE"}</div>
          </div>;
        })}
      </div>
    </CollapsibleTile>}

    {/* Performance analytics — money-weighted return, position P&L, risk.
        Collapsed by default; only meaningful once holdings exist. */}
    {merged.length>0&&<PerformancePanel
      holdings={merged}
      activities={activities}
      netWorthHistory={netWorthHistory}
      currentValue={brokerageTot}
      mask={mask}
    />}

    {/* Savings goals — compact overview widget */}
    <GoalsOverviewWidget
      snapAccounts={snapAccounts}
      plaidAccounts={plaidAccounts}
      netWorthHistory={netWorthHistory}
      onNav={onNav}
    />

  </div>;
}

/* ─── AAOIFI COMPLIANCE ENGINE ───────────────────────── */
// Real Sharia screen using Finnhub fundamentals. AAOIFI standard:
//   1) Sector screen — exclude prohibited industries (banking, alcohol,
//      tobacco, gambling, pork, weapons, adult entertainment, conventional
//      insurance/financials, interest-based businesses).
//   2) Total interest-bearing debt / 12-mo avg market cap < 33%
//   3) Cash + interest-bearing securities / 12-mo avg market cap < 33%
//   4) Accounts receivable / market cap < 49% (DJIM); some bodies use 70%.
//   5) Non-permissible income / total revenue < 5% — purification required.
// Free Finnhub /stock/profile2 + /stock/metric provide enough to compute 1–4.
// Approximations: we use total debt (close to interest-bearing for most cos).
const PROHIBITED_INDUSTRIES = [
  "banks","banking","capital markets","consumer finance","insurance",
  "diversified financials","mortgage","mortgage finance","reit—mortgage",
  "thrifts & mortgage finance","financial services",
  "beverages—brewers","beverages-brewers","beverages—wineries","alcoholic beverages",
  "tobacco","casinos & gaming","casinos","gambling",
  "aerospace & defense", // weapons component — flagged for review
];
const REVIEW_INDUSTRIES = [
  "restaurants","leisure","hotels resorts & cruise lines","hotels, resorts & cruise lines",
  "media","movies & entertainment","interactive media & services","entertainment",
  "broadcasting",
];
function classifyIndustry(industry){
  if(!industry)return"unknown";
  const i=industry.toLowerCase();
  if(PROHIBITED_INDUSTRIES.some(p=>i.includes(p)))return"haram";
  if(REVIEW_INDUSTRIES.some(p=>i.includes(p)))return"review";
  return"halal";
}
// Compliance standards. Each defines a denominator (market cap or total
// assets) and the threshold for each ratio test. Sector exclusion is
// universal across all standards.
const STANDARDS = {
  AAOIFI: {
    name:"AAOIFI", region:"Bahrain (international)",
    denominator:"marketCap",      // 12-mo avg mkt cap (we approximate w/ current)
    debtMax:33, cashMax:33, recvMax:49, nonPermMax:5,
    notes:"Most conservative; widely used by Islamic banks.",
  },
  DOWJONES: {
    name:"Dow Jones Islamic", region:"International index methodology",
    denominator:"marketCap", debtMax:33, cashMax:33, recvMax:33, nonPermMax:5,
    notes:"24-mo avg market cap denominator.",
  },
  SP_SHARIAH: {
    name:"S&P Shariah", region:"International",
    denominator:"marketCap", debtMax:33, cashMax:33, recvMax:49, nonPermMax:5,
    notes:"Aligns closely with AAOIFI.",
  },
  FTSE_SHARIAH: {
    name:"FTSE Shariah", region:"London (Yasaar consult)",
    denominator:"totalAssets", debtMax:33, cashMax:33, recvMax:50, nonPermMax:5,
    notes:"Uses total assets — typically more lenient.",
  },
  MSCI_ISLAMIC: {
    name:"MSCI Islamic", region:"International index",
    denominator:"totalAssets", debtMax:33.33, cashMax:33.33, recvMax:33.33, nonPermMax:5,
    notes:"Total assets denominator; tightest A/R rule.",
  },
  SC_MALAYSIA: {
    name:"SC Malaysia (SAC)", region:"Malaysia",
    denominator:"totalAssets", debtMax:33, cashMax:33, recvMax:50, nonPermMax:5,
    notes:"Allows 5–25% mixed-permissible income with purification.",
  },
  IFSB: {
    name:"IFSB", region:"Kuala Lumpur (regulator)",
    denominator:"totalAssets", debtMax:33, cashMax:33, recvMax:50, nonPermMax:5,
    notes:"Prudential standard; defers to local board for retail screening.",
  },
};
// NOTE: The ratio engine (debt/cash/receivables + non-permissible income) now
// runs server-side in lib/sharia.mjs so a single provider (Finnhub now, Zoya
// when keyed) governs every surface. STANDARDS above is kept here only for the
// Screener's display metadata (names, regions, thresholds).
async function screenTicker(tk){
  // Single screening engine lives server-side (lib/sharia.mjs, provider-dispatched:
  // Finnhub now, Zoya when keyed). The Screener tab and the app-wide sh_ governance
  // both read this, so verdicts can never diverge. Server caches per-day; the
  // client STANDARDS table is kept only for display metadata (names/thresholds).
  try{
    const r=await apiFetch(`/api/screen?symbol=${encodeURIComponent(tk)}`);
    if(!r.ok)return{tk,status:"unknown",reason:`HTTP ${r.status}`};
    const d=await r.json();
    return d.verdict||{tk,status:"unknown"};
  }catch(err){
    return{tk,status:"unknown",reason:err.message||"Screen failed"};
  }
}
// ETF Overlap Analyzer — compares the halal ETFs / Amana funds a user holds (or
// is weighing) to expose duplicated holdings. The halal fund universe is small
// and heavily overlapping (SPUS vs HLAL share nearly all their large caps), so
// "I'm diversified across three funds" is often one bet in a trench coat. ETF
// holdings come from Alpha Vantage (daily, full constituents); the Amana mutual
// funds from a curated quarterly snapshot. Weights are 0..1 fractions; overlap %
// = Σ min(weightA, weightB) — the share of each fund duplicated by the other.
function ETFOverlapPanel(){
  const[universe,setUniverse]=useState([]);
  const[sel,setSel]=useState(()=>{try{const s=JSON.parse(localStorage.getItem("mizan_etf_overlap_sel")||"null");return Array.isArray(s)&&s.length>=2?s.slice(0,4):["SPUS","HLAL"];}catch{return["SPUS","HLAL"];}});
  const[data,setData]=useState(null);
  const[busy,setBusy]=useState(false);
  const[err,setErr]=useState(null);
  const[retryN,setRetryN]=useState(0);   // bump to force a refetch of the SAME selection

  useEffect(()=>{let on=true;apiFetch("/api/etf/universe").then(r=>r.json()).then(d=>{if(on)setUniverse(d.universe||[]);}).catch(()=>{});return()=>{on=false;};},[]);
  useEffect(()=>{
    if(sel.length<2){setData(null);return;}
    let on=true;setBusy(true);setErr(null);
    apiFetch(`/api/etf/overlap?symbols=${encodeURIComponent(sel.join(","))}`)
      .then(r=>r.ok?r.json():Promise.reject(new Error("overlap_failed")))
      .then(d=>{if(on){setData(d);setBusy(false);}})
      .catch(()=>{if(on){setErr("Couldn't load holdings. Try again in a moment.");setBusy(false);}});
    try{localStorage.setItem("mizan_etf_overlap_sel",JSON.stringify(sel));}catch{}
    return()=>{on=false;};
  },[sel.join(","),retryN]);

  const toggle=(s)=>setSel(prev=>prev.includes(s)?(prev.length>2?prev.filter(x=>x!==s):prev):(prev.length<4?[...prev,s]:prev));
  const pctS=(v)=>`${Math.round((v||0)*100)}%`;
  const sev=(v)=>v>=0.5?T.gold:v>=0.2?T.blue:T.slate;   // high overlap = redundancy warning (amber)
  const sevLabel=(v)=>v>=0.5?"Heavy overlap":v>=0.2?"Moderate overlap":"Low overlap";

  const funds=data?.funds||[];
  const pairs=data?.pairs||[];
  const fundMap=Object.fromEntries(funds.map(f=>[f.symbol,f]));
  const comparablePairs=pairs.filter(p=>p.comparable);
  const focus=comparablePairs.slice().sort((a,b)=>b.overlapPct-a.overlapPct)[0]||pairs[0]||null;
  const unavailable=funds.filter(f=>!f.available).map(f=>f.symbol);
  const srcNote=(f)=>!f?"":f.source==="alphavantage"?"full holdings · updated daily":f.source==="curated"?`top holdings${f.asOf?` · ${String(f.asOf).slice(0,10)}`:""}`:"awaiting data source";

  const chip=(u)=>{
    const on=sel.includes(u.symbol);
    return <button key={u.symbol} onClick={()=>toggle(u.symbol)}
      style={{fontFamily:FM,fontSize:11,letterSpacing:.3,padding:"6px 10px",borderRadius:8,cursor:"pointer",
        border:`1px solid ${on?T.blue:T.border}`,background:on?`${T.blue}18`:"transparent",
        color:on?T.blue:T.muted,fontWeight:on?600:400,display:"inline-flex",alignItems:"center",gap:6,transition:"all .15s"}}>
      {u.symbol}{u.vehicle==="mutual_fund"&&<span style={{fontSize:8,opacity:.7}}>MF</span>}{u.assetClass==="sukuk"&&<span style={{fontSize:8,opacity:.7}}>SUKUK</span>}
    </button>;
  };

  return <CollapsibleTile title="ETF OVERLAP ANALYZER" subtitle="Compare 2–4 halal funds — shared holdings mean you own the same companies twice" accent={T.blue} storageKey="etf_overlap" defaultOpen={true}>
    {/* fund pickers */}
    <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:T.s4}}>
      {(universe.length?universe:sel.map(s=>({symbol:s,vehicle:"etf",assetClass:"equity"}))).map(chip)}
    </div>

    {err&&<div style={{fontFamily:FM,fontSize:12,color:T.loss,padding:`${T.s3} 0`}}>{err} <button onClick={()=>setRetryN(n=>n+1)} style={{fontFamily:FM,fontSize:11,color:T.blue,background:"none",border:"none",cursor:"pointer",textDecoration:"underline"}}>Retry</button></div>}
    {busy&&!data&&<div style={{fontFamily:FM,fontSize:12,color:T.muted,padding:`${T.s4} 0`}}>Loading holdings…</div>}

    {focus&&!err&&<>
      {/* headline overlap for the strongest comparable pair */}
      <div style={{display:"flex",alignItems:"center",gap:T.s5,flexWrap:"wrap",marginBottom:T.s4}}>
        <div>
          <div style={{fontFamily:FU,fontSize:52,lineHeight:1,color:sev(focus.overlapPct),fontVariantNumeric:"tabular-nums"}}>{focus.comparable?pctS(focus.overlapPct):"—"}</div>
          <div style={{fontFamily:FM,fontSize:10,letterSpacing:1,color:T.muted,marginTop:4}}>{focus.comparable?`${sevLabel(focus.overlapPct).toUpperCase()} · ${focus.a} ∩ ${focus.b}`:"NOT COMPARABLE"}</div>
        </div>
        <div style={{flex:1,minWidth:200}}>
          {focus.comparable?<>
            <div style={{fontFamily:FP,fontSize:13,color:T.text,lineHeight:1.5}}>{focus.a} and {focus.b} share <strong style={{color:T.textHi}}>{focus.sharedCount}</strong> holdings. About <strong style={{color:sev(focus.overlapPct)}}>{pctS(focus.overlapPct)}</strong> of each fund is the same underlying companies.</div>
            {/* overlap vs unique bar */}
            <div style={{display:"flex",height:10,borderRadius:6,overflow:"hidden",marginTop:T.s3,border:`1px solid ${T.border}`}}>
              <div style={{width:pctS(focus.overlapPct),background:sev(focus.overlapPct)}} title={`Overlap ${pctS(focus.overlapPct)}`}/>
              <div style={{flex:1,background:T.slate,opacity:.25}} title="Unique"/>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",fontFamily:FM,fontSize:9,letterSpacing:.5,color:T.muted,marginTop:4}}><span>SHARED</span><span>UNIQUE</span></div>
          </>:<div style={{fontFamily:FP,fontSize:13,color:T.text,lineHeight:1.5}}>{focus.a} and {focus.b} are different asset classes (equity vs sukuk), so a holdings-overlap % isn’t meaningful. They’re complementary, not redundant.</div>}
        </div>
      </div>

      {/* pairwise matrix when 3+ funds selected */}
      {pairs.length>1&&<div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:T.s4}}>
        {pairs.map(p=><span key={`${p.a}-${p.b}`} style={{fontFamily:FM,fontSize:11,padding:"4px 8px",borderRadius:6,border:`1px solid ${T.border}`,color:T.muted}}>
          {p.a}×{p.b} <strong style={{color:p.comparable?sev(p.overlapPct):T.slate}}>{p.comparable?pctS(p.overlapPct):"n/a"}</strong>
        </span>)}
      </div>}

      {/* shared holdings table for the focus pair */}
      {focus.comparable&&focus.shared?.length>0&&<div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontFamily:FM,fontSize:12}}>
          <thead><tr style={{color:T.muted,fontSize:9,letterSpacing:.8}}>
            <th style={{textAlign:"left",padding:"6px 8px",fontWeight:600}}>SHARED HOLDING</th>
            <th style={{textAlign:"right",padding:"6px 8px",fontWeight:600}}>{focus.a}</th>
            <th style={{textAlign:"right",padding:"6px 8px",fontWeight:600}}>{focus.b}</th>
          </tr></thead>
          <tbody>{focus.shared.slice(0,12).map(s=><tr key={s.symbol} style={{borderTop:`1px solid ${T.dim}`}}>
            <td style={{padding:"6px 8px",color:T.textHi,fontWeight:600}}>{s.symbol}</td>
            <td style={{padding:"6px 8px",textAlign:"right",color:T.text,fontVariantNumeric:"tabular-nums"}}>{(s.weightA*100).toFixed(1)}%</td>
            <td style={{padding:"6px 8px",textAlign:"right",color:T.text,fontVariantNumeric:"tabular-nums"}}>{(s.weightB*100).toFixed(1)}%</td>
          </tr>)}</tbody>
        </table>
        {focus.shared.length>12&&<div style={{fontFamily:FM,fontSize:10,color:T.muted,padding:"6px 8px"}}>+{focus.shared.length-12} more shared holdings</div>}
      </div>}

      {/* per-fund source provenance */}
      <div style={{display:"flex",flexWrap:"wrap",gap:10,marginTop:T.s3,paddingTop:T.s3,borderTop:`1px solid ${T.dim}`}}>
        {funds.map(f=><span key={f.symbol} style={{fontFamily:FM,fontSize:9,letterSpacing:.3,color:T.muted}}>
          <strong style={{color:f.available?T.text:T.slate}}>{f.symbol}</strong> · {srcNote(f)}
        </span>)}
      </div>
      {unavailable.length>0&&<div style={{fontFamily:FP,fontSize:11,color:T.muted,marginTop:6}}>Holdings for {unavailable.join(", ")} activate once the ETF data source is connected.</div>}
    </>}

    {!focus&&!busy&&!err&&<div style={{fontFamily:FP,fontSize:13,color:T.muted,padding:`${T.s4} 0`}}>Select at least two funds with available holdings to compare.</div>}
  </CollapsibleTile>;
}

function AAOIFIScreener({holdings=[]}){
  const[results,setResults]=useState(()=>{try{return JSON.parse(localStorage.getItem("mizan_aaoifi_cache")||"{}");}catch{return{};}});
  const[busy,setBusy]=useState(false);
  const[primary,setPrimary]=useState(()=>{try{return localStorage.getItem("mizan_screen_standard")||"AAOIFI";}catch{return"AAOIFI";}});
  const setStandard=v=>{setPrimary(v);try{localStorage.setItem("mizan_screen_standard",v);}catch{}};
  const[flt,setFlt]=useState("all");        // compliance filter: all|halal|review|haram|unknown
  const[detail,setDetail]=useState(null);   // holding whose screening breakdown is open
  // AI plain-language explanation of the open verdict (grounded in the real ratio
  // data — never free-form). Cleared whenever a different holding's modal opens.
  const[aiExplain,setAiExplain]=useState("");
  const[aiBusy,setAiBusy]=useState(false);
  useEffect(()=>{setAiExplain("");setAiBusy(false);},[detail?.tk]);
  const explainVerdict=async(d)=>{
    const sc=d?._screen||{};
    setAiBusy(true);setAiExplain("");
    // Only the verdict FACTS go to the model — it explains, it doesn't re-judge.
    const facts={ticker:d.tk,name:sc.name||d.nm,status:sc.status,industry:sc.industry,
      byStandard:sc.byStandard,debtRatioPct:sc.debtR,cashRatioPct:sc.cashR,receivablesRatioPct:sc.recvR,
      nonPermissibleIncomePct:sc.nonPermPct,reason:sc.reason,dataSource:sc.source,assetType:sc.assetType};
    const system="You are MIZAN's Sharia-screening explainer for Muslim investors. You are given a holding's AAOIFI screening verdict as JSON. Explain in warm, plain, jargon-free English: (1) WHY it got this status, (2) the specific test that drove it — cite the actual number vs the threshold from the data, (3) what it means practically (if 'review': purification of the impure dividend share; if 'haram': consider exiting; if 'halal': it passed; if crypto: token-specific + scholar-dependent). 3-5 short sentences, no headers. NEVER invent a number that isn't in the data. This is an estimate, not a fatwa — end by noting a qualified scholar should confirm.";
    try{
      const r=await apiFetch("/api/advisor",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({system,max_tokens:400,messages:[{role:"user",content:`Explain this Sharia screening verdict:\n${JSON.stringify(facts,null,2)}`}]})});
      if(!r.ok)throw new Error("advisor_failed");
      const j=await r.json();
      const text=((j&&j.content)||[]).filter(b=>b&&b.type==="text").map(b=>b.text).join("").trim();
      setAiExplain(text||"Couldn't generate an explanation right now.");
    }catch{setAiExplain("Couldn't reach the AI explainer — try again in a moment.");}
    finally{setAiBusy(false);}
  };
  // Ethical / BDS overlay — an optional layer ON TOP of the AAOIFI verdict that
  // flags divestment-target names. Off by default; the Sharia status is never
  // altered, only an extra exclusion is surfaced when the user opts in.
  const[ethical,setEthical]=useState(()=>{try{return localStorage.getItem("mizan_ethical_overlay")==="1";}catch{return false;}});
  const setEthicalPref=v=>{setEthical(v);try{localStorage.setItem("mizan_ethical_overlay",v?"1":"0");}catch{}persistUserState("mizan_ethical_overlay",v?"1":"0");};
  // Cache freshness: most recent asOf date across all cached results.
  const today=new Date().toISOString().slice(0,10);
  const cachedDates=Object.values(results).map(r=>r.asOf).filter(Boolean);
  const latestCacheDate=cachedDates.length>0?cachedDates.sort().at(-1):null;
  const cacheAge=latestCacheDate
    ?latestCacheDate===today?"Screened today"
      :latestCacheDate===new Date(Date.now()-86400000).toISOString().slice(0,10)?"Screened yesterday"
      :`Screened ${latestCacheDate}`
    :"Not yet screened";
  const cacheStale=latestCacheDate&&latestCacheDate<today;
  const tickers=[...new Set(holdings.map(h=>h.tk).filter(Boolean))];

  const runScreen=async(forceAll)=>{
    setBusy(true);
    const today=new Date().toISOString().slice(0,10);
    const todo=tickers.filter(tk=>forceAll||!results[tk]||results[tk].asOf!==today);
    let final=results;
    for(let i=0;i<todo.length;i+=4){
      const batch=todo.slice(i,i+4);
      const settled=await Promise.allSettled(batch.map(tk=>screenTicker(tk)));
      const next={...final};
      settled.forEach((s,j)=>{if(s.status==="fulfilled")next[batch[j]]={...s.value,asOf:today};});
      final=next;
      setResults(next);
      try{localStorage.setItem("mizan_aaoifi_cache",JSON.stringify(next));}catch{}
      // 4 tickers × 2 Finnhub calls = 8 req per batch; pause between batches to stay under 60/min free tier
      if(i+4<todo.length)await new Promise(r=>setTimeout(r,2000));
    }
    setBusy(false);
    // Diff against baseline → fire compliance-change notifications.
    try{
      const baseline=JSON.parse(localStorage.getItem("mizan_screening_baseline")||"null");
      if(!baseline){
        // First-ever screen: silent baseline init, no spam.
        localStorage.setItem("mizan_screening_baseline",JSON.stringify(final));persistUserState("mizan_screening_baseline",final);
      }else if(typeof Notification!=="undefined"&&Notification.permission==="granted"){
        const updated={...baseline};
        let fired=0;
        Object.entries(final).forEach(([tk,res])=>{
          const was=baseline[tk]?.status, now=res.status;
          if(was&&now&&was!==now&&now==="haram"){
            try{new Notification(`${tk} flagged non-compliant`,{body:`Sharia status: ${was} → ${now}. Tap MIZAN to review and plan exit.`,icon:"/icon-192.png"});}catch{}
            updated[tk]=res; fired++;
          }else if(was&&now&&was==="haram"&&now==="halal"){
            try{new Notification(`${tk} now compliant`,{body:`Sharia status: ${was} → ${now}.`,icon:"/icon-192.png"});}catch{}
            updated[tk]=res; fired++;
          }
        });
        if(fired>0){localStorage.setItem("mizan_screening_baseline",JSON.stringify(updated));persistUserState("mizan_screening_baseline",updated);}
      }
    }catch{}
  };
  useEffect(()=>{if(tickers.length)runScreen(false); /* eslint-disable-next-line */},[tickers.join(",")]);

  const enriched=holdings.map(h=>({...h,_screen:results[h.tk]||{status:h.sh_||"unknown"}}));
  const bdsExcluded=ethical?enriched.filter(h=>h._screen?.ethical?.excluded):[];
  const byStatus={halal:[],review:[],haram:[],unknown:[]};
  enriched.forEach(h=>(byStatus[h._screen.status]||byStatus.unknown).push(h));
  const totalEquity=enriched.reduce((s,h)=>s+mv(h),0);
  const haramValue=byStatus.haram.reduce((s,h)=>s+mv(h),0);
  const reviewValue=byStatus.review.reduce((s,h)=>s+mv(h),0);
  // Purification (tazkiyyah) only applies to non-permissible income received from
  // holding the position — NOT the full market value. Without dividend/revenue
  // breakdown data, approximate using an average dividend-yield basis:
  //   haram: ~2% yield (~100% non-permissible income share)
  //   review: ~0.5% yield (~50% × half non-permissible income share)
  const haramPurification=haramValue*0.02;
  const reviewPurification=reviewValue*0.005;
  const purification=haramPurification+reviewPurification;
  const haramPct=totalEquity>0?(haramValue/totalEquity)*100:0;
  const sortByStatus=(a,b)=>{const o={haram:0,review:1,unknown:2,halal:3};return(o[a._screen.status]??9)-(o[b._screen.status]??9);};
  const visibleRows=[...enriched].filter(h=>flt==="all"||(h._screen.status||"unknown")===flt).sort(sortByStatus);

  return<div style={{display:"flex",flexDirection:"column",gap:T.s4}}>
    {/* ─── Intro + framework selector ───────────── */}
    <BentoTile>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:T.s4,flexWrap:"wrap"}}>
        <div style={{maxWidth:680}}>
          <div style={{fontFamily:FM,fontSize:10,color:T.gold,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>SHARIA COMPLIANCE</div>
          <p style={{fontFamily:FP,fontSize:13,color:T.muted,margin:0,lineHeight:1.55,letterSpacing:"-0.005em"}}>
            Live screening across {Object.keys(STANDARDS).length} frameworks. Pick a primary standard for row badges; every standard runs in the background so you see a per-position pass count. Data: Finnhub fundamentals. Full methodology &amp; Sharia governance in Settings → Methodology.
          </p>
        </div>
        <div style={{display:"flex",gap:T.s2,alignItems:"center",flexShrink:0}}>
          <button onClick={()=>setEthicalPref(!ethical)} title="Ethical / BDS overlay — flag divestment-target names on top of the Sharia screen (does not change the Sharia verdict)" style={{fontFamily:FM,fontSize:11,fontWeight:600,letterSpacing:"0.04em",padding:`6px ${T.s3}`,borderRadius:999,cursor:"pointer",background:ethical?`${T.loss}1A`:"transparent",border:`1px solid ${ethical?T.loss:T.border}`,color:ethical?T.loss:T.muted,transition:"all 0.15s",whiteSpace:"nowrap"}}>Ethical/BDS {ethical?"ON":"OFF"}</button>
          <select value={primary} onChange={e=>setStandard(e.target.value)} className="field" style={{width:"auto",fontSize:12,cursor:"pointer"}}>
            {Object.entries(STANDARDS).map(([k,s])=><option key={k} value={k}>{s.name}</option>)}
          </select>
          <button onClick={()=>runScreen(true)} disabled={busy} className="btn-primary">{busy?"Screening…":"Re-screen"}</button>
        </div>
      </div>
      <div style={{marginTop:T.s2,display:"flex",alignItems:"center",gap:T.s2,fontFamily:FM,fontSize:10,color:cacheStale?T.gold:T.muted}}>
        <span style={{width:6,height:6,borderRadius:"50%",background:cacheStale?T.gold:T.gain,flexShrink:0,display:"inline-block"}}/>
        {cacheAge}{cacheStale&&" — re-screen for fresh data"}
      </div>
      <div style={{marginTop:T.s3,padding:`${T.s2} ${T.s4}`,background:T.surface,border:`1px solid ${T.border}`,borderRadius:T.rMd,fontFamily:FM,fontSize:11,color:T.muted,lineHeight:1.6,letterSpacing:"0.02em"}}>
        <span style={{color:T.gold,fontWeight:600}}>{STANDARDS[primary].name}</span>
        <span style={{margin:`0 ${T.s2}`,color:T.dim}}>·</span>{STANDARDS[primary].region}
        <span style={{margin:`0 ${T.s2}`,color:T.dim}}>·</span>Debt/{STANDARDS[primary].denominator==="totalAssets"?"Assets":"MC"} &lt; {STANDARDS[primary].debtMax}%
        <span style={{margin:`0 ${T.s2}`,color:T.dim}}>·</span>Cash &lt; {STANDARDS[primary].cashMax}%
        <span style={{margin:`0 ${T.s2}`,color:T.dim}}>·</span>A/R &lt; {STANDARDS[primary].recvMax}%
        <span style={{margin:`0 ${T.s2}`,color:T.dim}}>·</span>Non-perm &lt; {STANDARDS[primary].nonPermMax}% <span style={{color:T.dim,fontStyle:"italic"}}>(not evaluated — sector check applies)</span>
      </div>
    </BentoTile>

    {/* ─── Status stat tiles ────────────────────── */}
    <div className="bento-row" style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(180px, 1fr))",gap:T.s3}}>
      <BentoTile accent={T.gain}>
        <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>HALAL POSITIONS</div>
        <div style={{fontFamily:FU,fontSize:22,fontWeight:700,color:T.textHi,letterSpacing:"-0.025em",fontVariantNumeric:"tabular-nums"}}>{byStatus.halal.length}</div>
        <div style={{fontFamily:FM,fontSize:11,fontWeight:500,color:T.gain,marginTop:T.s1,fontVariantNumeric:"tabular-nums"}}>{kf(byStatus.halal.reduce((s,h)=>s+mv(h),0))}</div>
      </BentoTile>
      <BentoTile accent={T.gold}>
        <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>REVIEW POSITIONS</div>
        <div style={{fontFamily:FU,fontSize:22,fontWeight:700,color:T.textHi,letterSpacing:"-0.025em",fontVariantNumeric:"tabular-nums"}}>{byStatus.review.length}</div>
        <div style={{fontFamily:FM,fontSize:11,fontWeight:500,color:T.gold,marginTop:T.s1,fontVariantNumeric:"tabular-nums"}}>{kf(reviewValue)}</div>
      </BentoTile>
      <BentoTile accent={T.loss} style={{background:`linear-gradient(135deg, ${T.loss}10, transparent 60%), ${T.card}`}}>
        <div style={{fontFamily:FM,fontSize:10,color:T.loss,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>NON-COMPLIANT</div>
        <div style={{fontFamily:FU,fontSize:22,fontWeight:700,color:T.textHi,letterSpacing:"-0.025em",fontVariantNumeric:"tabular-nums"}}>{byStatus.haram.length}</div>
        <div style={{fontFamily:FM,fontSize:11,fontWeight:500,color:T.loss,marginTop:T.s1,fontVariantNumeric:"tabular-nums"}}>{kf(haramValue)} · {haramPct.toFixed(1)}%</div>
      </BentoTile>
      <BentoTile accent={T.gold}>
        <div style={{fontFamily:FM,fontSize:10,color:T.gold,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>PURIFICATION EST.</div>
        <div style={{fontFamily:FU,fontSize:22,fontWeight:700,color:T.textHi,letterSpacing:"-0.025em",fontVariantNumeric:"tabular-nums"}}>{kf(purification)}</div>
        <div style={{fontFamily:FM,fontSize:11,fontWeight:500,color:T.gold,marginTop:T.s1,lineHeight:1.45}}>Estimate: dividend yield × non-permissible income share. Real purification depends on each holding's actual dividend distributions and revenue breakdown.</div>
      </BentoTile>
    </div>

    {/* ─── Compliance filter (halal-only / non-compliant / etc.) ─── */}
    <div style={{display:"flex",alignItems:"center",gap:T.s2,flexWrap:"wrap"}}>
      {[["all","All"],["halal","Halal"],["review","Review"],["haram","Non-Compliant"],["unknown","Unscreened"]].map(([k,l])=>{
        const n=k==="all"?enriched.length:(byStatus[k]||[]).length;
        const on=flt===k;
        const c=k==="halal"?T.gain:k==="haram"?T.loss:k==="review"?T.gold:k==="all"?T.blue:T.muted;
        return<button key={k} onClick={()=>setFlt(k)} style={{
          fontFamily:FM,fontSize:11,fontWeight:600,letterSpacing:"0.04em",
          padding:`6px ${T.s3}`,borderRadius:999,cursor:"pointer",
          background:on?`${c}1A`:"transparent",border:`1px solid ${on?c:T.border}`,
          color:on?c:T.muted,transition:"all 0.15s",
        }}>{l} <span style={{opacity:0.65,fontVariantNumeric:"tabular-nums"}}>{n}</span></button>;
      })}
      <span style={{marginLeft:"auto",fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.04em"}}>Tap “Why →” for the breakdown</span>
    </div>

    {ethical&&<div style={{padding:`${T.s2} ${T.s4}`,background:`${T.loss}0D`,border:`1px solid ${T.loss}33`,borderRadius:T.rMd,fontFamily:FM,fontSize:11,color:T.muted,lineHeight:1.55}}>
      <span style={{color:T.loss,fontWeight:600}}>Ethical / BDS overlay ON</span> · {bdsExcluded.length} holding{bdsExcluded.length===1?"":"s"} flagged{bdsExcluded.length?`: ${bdsExcluded.map(h=>h.tk).join(", ")}`:""}. A curated divestment-target list layered on top of the Sharia verdict — it does not change the Sharia status.
    </div>}

    <BentoTile style={{padding:0,overflow:"hidden"}}>
      <Tbl cols={[
        {l:"Symbol",r_:r=><div><div style={{fontFamily:FM,fontSize:12,fontWeight:500,color:r._screen.status==="haram"?T.loss:T.textHi}}>{r.tk}</div><div style={{fontFamily:FM,fontSize:9,color:T.muted}}>{r._screen.industry||r.ty||"—"}</div></div>},
        {l:"Mkt Value",r:true,r_:r=><span style={{fontFamily:FM,fontSize:12,color:T.textHi}}>{f$(mv(r))}</span>},
        {l:"Sector",r_:r=>{const c=classifyIndustry(r._screen.industry);return<Tag label={c==="haram"?"Excluded":c==="review"?"Review":c==="halal"?"OK":"—"} color={c==="haram"?T.loss:c==="review"?T.gold:c==="halal"?T.gain:T.muted}/>;}},
        {l:"Debt/Cap",r:true,mobileHide:true,r_:r=>{const v=r._screen.debtR;if(v==null)return<span style={{color:T.muted}}>—</span>;return<span style={{fontFamily:FM,fontSize:11,color:v<33?T.gain:T.loss}}>{v.toFixed(1)}%</span>;}},
        {l:"Cash/Cap",r:true,mobileHide:true,r_:r=>{const v=r._screen.cashR;if(v==null)return<span style={{color:T.muted}}>—</span>;return<span style={{fontFamily:FM,fontSize:11,color:v<33?T.gain:T.loss}}>{v.toFixed(1)}%</span>;}},
        {l:"A/R/Cap",r:true,mobileHide:true,r_:r=>{const v=r._screen.recvR;if(v==null)return<span style={{color:T.muted}}>—</span>;return<span style={{fontFamily:FM,fontSize:11,color:v<49?T.gain:T.loss}}>{v.toFixed(1)}%</span>;}},
        {l:"Status",r_:r=><span style={{display:"inline-flex",gap:4,alignItems:"center",flexWrap:"wrap"}}><Tag label={r._screen.status==="halal"?"Halal":r._screen.status==="haram"?"Non-Compliant":r._screen.status==="review"?"Review":"…"} color={r._screen.status==="halal"?T.gain:r._screen.status==="haram"?T.loss:r._screen.status==="review"?T.gold:T.muted}/>{ethical&&r._screen.ethical?.excluded&&<Tag label="BDS" color={T.loss}/>}</span>},
        {l:"Pass / 7",r:true,mobileHide:true,r_:r=>{const bs=r._screen.byStandard;if(!bs)return<span style={{color:T.muted}}>—</span>;const pass=Object.values(bs).filter(s=>s.pass===true).length;return<span style={{fontFamily:FM,fontSize:11,color:pass>=6?T.gain:pass>=4?T.gold:T.loss}} title={Object.entries(bs).map(([k,v])=>`${STANDARDS[k]?.name||k}: ${v.pass===true?"pass":v.pass===false?"fail":"n/a"}`).join("\n")}>{pass}/{Object.keys(STANDARDS).length}</span>;}},
        {l:"Primary",mobileHide:true,r_:r=>{const v=r._screen.byStandard?.[primary];if(!v)return<span style={{color:T.muted}}>—</span>;return v.pass===true?<Icon name="check" size={14} color={T.gain}/>:v.pass===false?<Icon name="close" size={14} color={T.loss}/>:<span style={{color:T.muted}}>…</span>;}},
        {l:"Why",r_:r=><button onClick={()=>setDetail(r)} title="Why this verdict?" style={{fontFamily:FM,fontSize:10,fontWeight:600,color:T.blue,background:"transparent",border:`1px solid ${T.blue}40`,borderRadius:T.rMd,padding:`3px ${T.s2}`,cursor:"pointer",whiteSpace:"nowrap"}}>Why →</button>},
      ]} rows={visibleRows}/>
      {visibleRows.length===0&&<div style={{padding:`${T.s8} ${T.s5}`,textAlign:"center",fontFamily:FP,fontSize:13,color:T.muted}}>No {flt==="all"?"":flt==="haram"?"non-compliant ":flt+" "}positions{flt==="all"?" yet":""}.</div>}
    </BentoTile>

    <div className="bento-row" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:T.s4}}>
      <BentoTile>
        <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s3}}>STANDARDS</div>
        <div style={{display:"flex",flexDirection:"column",gap:T.s2}}>
          {Object.entries(STANDARDS).map(([k,s])=><div key={k} style={{
            padding:`${T.s2} ${T.s3}`,
            background:T.surface,
            border:`1px solid ${T.border}`,
            borderLeft:`3px solid ${k===primary?T.gold:T.border}`,
            borderRadius:T.rMd,
          }}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:T.s1}}>
              <span style={{fontFamily:FP,fontSize:13,fontWeight:600,color:T.textHi,letterSpacing:"-0.01em"}}>{s.name}</span>
              <span style={{fontFamily:FM,fontSize:10,fontWeight:500,color:T.muted,letterSpacing:"0.04em"}}>{s.region}</span>
            </div>
            <div style={{fontFamily:FM,fontSize:10,color:T.muted,lineHeight:1.5,letterSpacing:"0.02em"}}>
              Debt &lt; {s.debtMax}% · Cash &lt; {s.cashMax}% · A/R &lt; {s.recvMax}% · Non-perm &lt; {s.nonPermMax}% <span style={{fontStyle:"italic",color:T.dim}}>(not evaluated — sector check applies)</span>
            </div>
          </div>)}
        </div>
        <div style={{marginTop:T.s3,fontFamily:FP,fontSize:12,color:T.muted,lineHeight:1.55,letterSpacing:"-0.005em"}}>
          <strong style={{color:T.text,fontWeight:600}}>Universal:</strong> Sector exclusion across all standards (banking, alcohol, tobacco, gambling, weapons, conventional insurance, adult entertainment, pork).
        </div>
      </BentoTile>
      <BentoTile accent={T.gold}>
        <div style={{fontFamily:FM,fontSize:10,color:T.gold,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s3}}>PURIFICATION GUIDE</div>
        <p style={{fontFamily:FP,fontSize:13,color:T.muted,margin:0,lineHeight:1.6,letterSpacing:"-0.005em"}}>
          Income from non-compliant or mixed-revenue companies must be purified — the impure portion is donated to charity (Sadaqah), without expectation of reward. The estimate above is a conservative proxy; for precision, multiply each holding's dividend by the company's non-permissible-income ratio.
        </p>
        <div style={{marginTop:T.s4,padding:`${T.s3} ${T.s4}`,background:`linear-gradient(135deg, ${T.gold}10, transparent 70%), ${T.surface}`,borderRadius:T.rMd,border:`1px solid ${T.gold}30`}}>
          <div style={{fontFamily:FM,fontSize:10,color:T.gold,letterSpacing:"0.14em",fontWeight:600,marginBottom:T.s1}}>EXIT GUIDANCE</div>
          <div style={{fontFamily:FP,fontSize:13,color:T.text,lineHeight:1.55,letterSpacing:"-0.005em"}}>
            For Non-Compliant positions: sell at the next reasonable opportunity, donate any gains realized after purification to charity, and replace with a Sharia-screened equivalent (SPUS / HLAL / UMMA / SPSK).
          </div>
        </div>
      </BentoTile>
    </div>

    {/* ─── Screening transparency: why this verdict? ─── */}
    {detail&&(()=>{
      const sc=detail._screen||{};
      const std=STANDARDS[primary]||STANDARDS.AAOIFI;
      const isA=std.denominator==="totalAssets";
      const bsP=sc.byStandard?.[primary];
      const sectorExcluded=classifyIndustry(sc.industry)==="haram"||/prohibited sector/i.test(sc.reason||"");
      const tests=bsP?.tests||(sc.debtR!=null?[
        {rule:`Debt/${isA?"Assets":"MC"}`,pass:sc.debtR<std.debtMax,detail:`${sc.debtR.toFixed(1)}%`,limit:std.debtMax},
        {rule:`Cash/${isA?"Assets":"MC"}`,pass:sc.cashR<std.cashMax,detail:`${sc.cashR.toFixed(1)}%`,limit:std.cashMax},
        {rule:`A/R/${isA?"Assets":"MC"}`,pass:sc.recvR===0||sc.recvR<std.recvMax,detail:sc.recvR?`${sc.recvR.toFixed(1)}%`:"n/a",limit:std.recvMax},
      ]:[]);
      const statusColor=sc.status==="halal"?T.gain:sc.status==="haram"?T.loss:sc.status==="review"?T.gold:T.muted;
      return<div onClick={()=>setDetail(null)} style={{position:"fixed",inset:0,zIndex:1001,background:"rgba(0,0,0,0.6)",backdropFilter:"blur(20px) saturate(160%)",WebkitBackdropFilter:"blur(20px) saturate(160%)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
        <div onClick={e=>e.stopPropagation()} style={{width:"100%",maxWidth:460,maxHeight:"88vh",overflowY:"auto",background:"var(--mz-glass-strong)",backdropFilter:"blur(40px) saturate(180%)",WebkitBackdropFilter:"blur(40px) saturate(180%)",border:"1px solid var(--mz-glass-border)",borderRadius:16,boxShadow:"var(--mz-glass-shadow-lg)",padding:T.s6,animation:"glassFadeUp 0.22s cubic-bezier(.34,1.56,.64,1)"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:T.s3,marginBottom:T.s1}}>
            <div>
              <div style={{fontFamily:FU,fontSize:22,fontWeight:700,color:T.textHi,letterSpacing:"-0.02em"}}>{detail.tk}</div>
              <div style={{fontFamily:FP,fontSize:12,color:T.muted,marginTop:2}}>{sc.name||detail.nm||""}{sc.industry?`${sc.name||detail.nm?" · ":""}${sc.industry}`:""}</div>
            </div>
            <Tag label={sc.status==="halal"?"Halal":sc.status==="haram"?"Non-Compliant":sc.status==="review"?"Review":"Unscreened"} color={statusColor}/>
          </div>

          {sectorExcluded
            ?<div style={{padding:`${T.s3} ${T.s4}`,background:`${T.loss}12`,border:`1px solid ${T.loss}30`,borderRadius:T.rMd,marginTop:T.s3}}>
                <div style={{fontFamily:FM,fontSize:10,color:T.loss,letterSpacing:"0.14em",fontWeight:600,marginBottom:T.s1}}>EXCLUDED — PROHIBITED SECTOR</div>
                <div style={{fontFamily:FP,fontSize:13,color:T.text,lineHeight:1.5}}>{sc.industry||"This industry"} is excluded under every standard (interest-based finance, alcohol, tobacco, gambling, weapons, conventional insurance, adult entertainment, pork). Financial ratios aren’t evaluated when the core business itself is non-compliant.</div>
              </div>
            :<>
              <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.14em",fontWeight:600,margin:`${T.s4} 0 ${T.s2}`}}>{std.name} RATIO TESTS</div>
              {tests.length===0
                ?<div style={{fontFamily:FP,fontSize:13,color:T.muted,lineHeight:1.5}}>Financial ratios aren’t available yet for {detail.tk}. Re-screen, or check back after the next data refresh.</div>
                :<div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {tests.map((t,i)=><div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:T.s2,padding:`${T.s2} ${T.s3}`,background:T.surface,border:`1px solid ${T.border}`,borderLeft:`3px solid ${t.pass?T.gain:T.loss}`,borderRadius:T.rMd}}>
                    <span style={{fontFamily:FM,fontSize:11,color:T.text}}>{t.rule}</span>
                    <span style={{display:"flex",alignItems:"center",gap:T.s2}}>
                      <span style={{fontFamily:FM,fontSize:11,fontWeight:600,color:t.pass?T.gain:T.loss,fontVariantNumeric:"tabular-nums"}}>{t.detail}</span>
                      <span style={{fontFamily:FM,fontSize:10,color:T.muted}}>limit &lt;{t.limit}%</span>
                      <Icon name={t.pass?"check":"close"} size={13} color={t.pass?T.gain:T.loss}/>
                    </span>
                  </div>)}
                </div>}
              {sc.nonPermPct==null&&<div style={{marginTop:T.s2,fontFamily:FM,fontSize:10,color:T.dim,fontStyle:"italic"}}>Non-permissible income % not evaluated on the current data provider — the sector screen carries that test.</div>}
            </>}

          {sc.byStandard&&<>
            <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.14em",fontWeight:600,margin:`${T.s4} 0 ${T.s2}`}}>ACROSS ALL STANDARDS</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {Object.entries(sc.byStandard).map(([k,v])=>{const c=v.pass===true?T.gain:v.pass===false?T.loss:T.muted;return<span key={k} title={STANDARDS[k]?.name||k} style={{fontFamily:FM,fontSize:10,fontWeight:600,color:c,background:`${c}14`,border:`1px solid ${c}33`,borderRadius:999,padding:`3px ${T.s2}`}}>{(STANDARDS[k]?.name||k).replace(/ \(.*\)/,"")} {v.pass===true?"✓":v.pass===false?"✕":"–"}</span>;})}
            </div>
          </>}

          {/* AI plain-language explanation — grounded in the ratio data above. */}
          <div style={{marginTop:T.s4}}>
            {!aiExplain&&!aiBusy&&<button onClick={()=>explainVerdict(detail)} style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:T.s2,padding:"10px",borderRadius:T.rMd,cursor:"pointer",background:`${T.blue}12`,border:`1px solid ${T.blue}40`,color:T.blue,fontFamily:FM,fontSize:12,fontWeight:600,letterSpacing:"0.04em"}}>✦ Explain in plain English</button>}
            {aiBusy&&<div style={{fontFamily:FM,fontSize:12,color:T.muted,textAlign:"center",padding:"10px"}}>Reading the ratios…</div>}
            {aiExplain&&<div style={{padding:`${T.s3} ${T.s4}`,background:`${T.blue}0C`,border:`1px solid ${T.blue}28`,borderRadius:T.rMd}}>
              <div style={{fontFamily:FM,fontSize:9,letterSpacing:"0.14em",color:T.blue,fontWeight:600,marginBottom:T.s2}}>✦ AI EXPLANATION</div>
              <div style={{fontFamily:FP,fontSize:13,color:T.text,lineHeight:1.6,whiteSpace:"pre-wrap"}}>{aiExplain}</div>
            </div>}
          </div>

          <div style={{marginTop:T.s4,fontFamily:FP,fontSize:11,color:T.muted,lineHeight:1.5}}>
            Data: {sc.source==="zoya"?"Zoya":"Finnhub"} fundamentals{sc.asOf?` · screened ${sc.asOf}`:""}. Verdicts are estimates from public financials against AAOIFI-aligned thresholds — confirm with a qualified scholar for your situation.
          </div>
          <button onClick={()=>setDetail(null)} className="btn-ghost" style={{marginTop:T.s4,width:"100%",fontSize:13,padding:"10px"}}>Close</button>
        </div>
      </div>;
    })()}
  </div>;
}

/* ─── TAX PLANNER ────────────────────────────────────── */
// Tax-loss harvesting candidates + estimated annual tax cost.
// Pure compute — no API calls. Replacement suggestions are halal defaults
// from the existing ETF universe (SPUS, HLAL, UMMA).
function TaxPlanner({holdings=[],activities=[],snapAccounts=[]}){
  const[bracket,setBracket]=useState(0.24);
  const[stateBracket,setStateBracket]=useState(0.05);
  // Normalize symbol to a clean uppercase string regardless of whether the
  // activity's symbol field is a plain string, {symbol:"AAPL"}, or a nested object.
  const normSym=s=>{
    if(!s)return"";
    if(typeof s==="string")return s.toUpperCase();
    let cur=s,depth=0;
    while(cur&&typeof cur==="object"&&depth<4){
      const v=cur.symbol??cur.raw_symbol??cur.ticker;
      if(typeof v==="string")return v.toUpperCase();
      if(typeof v==="object"){cur=v;depth++;continue;}
      break;
    }
    return(cur?.symbol??cur?.raw_symbol??cur?.ticker??"").toString().toUpperCase();
  };

  const losers=holdings
    .filter(h=>h.sh>0&&h.ac>0&&h.px<h.ac)
    .map(h=>{
      const loss=(h.px-h.ac)*h.sh;
      const lossPct=((h.px-h.ac)/h.ac)*100;
      const replacement=h.sh_==="haram"?"Exit — non-compliant":h.ty==="ETF"?"SPUS / HLAL":"SPUS / UMMA";
      return{...h,_loss:loss,_lossPct:lossPct,_replacement:replacement};
    })
    .sort((a,b)=>a._loss-b._loss);

  const totalLoss=losers.reduce((s,h)=>s+h._loss,0);
  const taxSavings=Math.abs(totalLoss)*(bracket+stateBracket);

  // YTD realized gain/loss from SELL activities.
  // Exact realized P&L requires lot-level cost basis (FIFO/LIFO/spec ID) which
  // we don't have from the brokerage feed. Defensible interim approach: estimate
  // realized P&L per sell as (proceeds − units × position_avg_cost) using the
  // current position's avg cost from snapAccounts. If the symbol is fully sold
  // (no longer held), fall back to a 0 contribution. Sum across YTD sells.
  // TODO: replace with true lot-level realized P&L once cost-basis lots are
  // surfaced from the brokerage import — tracked in math-correctness audit.
  const ytdISO=`${new Date().getFullYear()}-01-01`;
  const ytdSells=activities.filter(a=>(a.type||"").toUpperCase()==="SELL"&&(a.trade_date||"")>=ytdISO);
  // Build a symbol → avg cost lookup from current positions across visible accounts.
  // Holdings (merged) is the primary source; snapAccounts positions are the
  // fallback for any holding shape mismatch.
  const avgCostBySymbol={};
  holdings.forEach(h=>{const sym=(h.tk||"").toUpperCase();if(sym&&h.ac>0)avgCostBySymbol[sym]=h.ac;});
  snapAccounts.forEach(a=>(a.positions||[]).forEach(p=>{
    const sym=(p.symbol?.symbol||p.symbol||p.tk||"").toString().toUpperCase();
    const ac=+p.average_purchase_price||+p.ac||0;
    if(sym&&ac>0&&!avgCostBySymbol[sym])avgCostBySymbol[sym]=ac;
  }));
  let missingBasisCount=0;
  const ytdRealized=ytdSells.reduce((s,a)=>{
    const sym=normSym(a.symbol);
    const proceeds=Math.abs(+a.amount||0);
    const units=Math.abs(+a.units||0);
    const ac=avgCostBySymbol[sym];
    if(!sym||!units||!ac){missingBasisCount++;return s;}
    const basis=units*ac;
    return s+(proceeds-basis);
  },0);
  const ytdDividends=activities.filter(a=>(a.type||"").toUpperCase()==="DIVIDEND"&&(a.trade_date||"")>=ytdISO).reduce((s,a)=>s+(+a.amount||0),0);
  const estTax=Math.max(0,(ytdRealized+ytdDividends)*(bracket+stateBracket));

  // Wash-sale check: any SELL of same symbol in last 30 days
  const today=new Date();
  const days30=new Date(today);days30.setDate(today.getDate()-30);
  const days30ISO=days30.toISOString().slice(0,10);
  const recentSells=new Set(activities.filter(a=>(a.type||"").toUpperCase()==="SELL"&&(a.trade_date||"")>=days30ISO).map(a=>normSym(a.symbol)));

  return<div style={{display:"flex",flexDirection:"column",gap:T.s4}}>
    {/* ─── Hero + bracket selectors ────────────────── */}
    <div className="bento-row" style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:T.s4}}>
      <BentoTile accent={T.gold} style={{background:`radial-gradient(circle at 0% 0%, ${T.gold}15, transparent 55%), ${T.card}`}}>
        <div style={{fontFamily:FM,fontSize:10,color:T.gold,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s3}}>HARVESTABLE LOSS</div>
        <div style={{fontFamily:FU,fontSize:38,fontWeight:700,color:T.textHi,letterSpacing:"-0.03em",lineHeight:1,fontVariantNumeric:"tabular-nums"}}>{kf(Math.abs(totalLoss))}</div>
        <div style={{fontFamily:FM,fontSize:12,color:T.muted,marginTop:T.s2}}>{losers.length} position{losers.length===1?"":"s"} below cost</div>
        <div style={{marginTop:T.s4,padding:`${T.s3} ${T.s4}`,background:`${T.gold}10`,border:`1px solid ${T.gold}25`,borderRadius:T.rMd}}>
          <div style={{fontFamily:FM,fontSize:10,color:T.gold,letterSpacing:"0.14em",fontWeight:600,marginBottom:T.s1}}>ESTIMATED TAX SAVINGS</div>
          <div style={{fontFamily:FU,fontSize:24,fontWeight:700,color:T.gold,letterSpacing:"-0.025em",fontVariantNumeric:"tabular-nums"}}>{kf(taxSavings)}</div>
          <div style={{fontFamily:FM,fontSize:11,color:T.muted,marginTop:T.s1}}>@ {((bracket+stateBracket)*100).toFixed(0)}% combined marginal rate</div>
        </div>
      </BentoTile>

      <div style={{display:"flex",flexDirection:"column",gap:T.s4}}>
        <BentoTile accent={fc(ytdRealized)}>
          <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>YTD REALIZED</div>
          <div style={{fontFamily:FU,fontSize:22,fontWeight:700,color:fc(ytdRealized),letterSpacing:"-0.025em",fontVariantNumeric:"tabular-nums"}}>{ytdRealized>=0?"+":""}{kf(Math.abs(ytdRealized))}</div>
          <div style={{fontFamily:FM,fontSize:11,color:T.muted,marginTop:T.s1}}>{ytdSells.length} sells YTD{missingBasisCount>0?` · ${missingBasisCount} need lot-level basis`:""}</div>
        </BentoTile>
        <BentoTile accent={T.loss}>
          <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>EST. TAX OWED</div>
          <div style={{fontFamily:FU,fontSize:22,fontWeight:700,color:T.textHi,letterSpacing:"-0.025em",fontVariantNumeric:"tabular-nums"}}>{kf(estTax)}</div>
          <div style={{fontFamily:FM,fontSize:11,color:T.loss,marginTop:T.s1}}>On gains + divs</div>
        </BentoTile>
      </div>
    </div>

    {/* ─── Bracket controls + intro ────────────────── */}
    <BentoTile>
      <div style={{fontFamily:FP,fontSize:13,color:T.muted,lineHeight:1.55,maxWidth:680,marginBottom:T.s3,letterSpacing:"-0.005em"}}>
        Surfaces unrealized losses you could harvest to offset taxable gains. Wash-sale rule: a position sold at a loss can't be repurchased within 30 days. Estimates assume your combined federal + state marginal rate.
      </div>
      <div style={{display:"flex",gap:T.s3,alignItems:"center",fontFamily:FM,fontSize:11,color:T.muted,flexWrap:"wrap"}}>
        <span style={{letterSpacing:"0.04em"}}>FEDERAL</span>
        <select value={bracket} onChange={e=>setBracket(+e.target.value)} className="field" style={{width:"auto",fontSize:11,padding:`5px ${T.s3}`,cursor:"pointer"}}>
          {[0.10,0.12,0.22,0.24,0.32,0.35,0.37].map(b=><option key={b} value={b}>{(b*100).toFixed(0)}%</option>)}
        </select>
        <span style={{letterSpacing:"0.04em"}}>STATE</span>
        <select value={stateBracket} onChange={e=>setStateBracket(+e.target.value)} className="field" style={{width:"auto",fontSize:11,padding:`5px ${T.s3}`,cursor:"pointer"}}>
          {[0,0.03,0.05,0.07,0.09,0.13].map(b=><option key={b} value={b}>{(b*100).toFixed(0)}%</option>)}
        </select>
      </div>
    </BentoTile>

    {/* ─── Losers table ────────────────────────────── */}
    {losers.length===0
      ?<BentoTile style={{padding:`${T.s8} ${T.s5}`,textAlign:"center",borderStyle:"dashed"}}>
        <div style={{fontFamily:FP,fontSize:14,fontWeight:500,color:T.muted}}>No unrealized losses across visible accounts.</div>
        <div style={{fontFamily:FP,fontSize:12,color:T.muted,marginTop:T.s1}}>Nothing to harvest right now.</div>
      </BentoTile>
      :<BentoTile style={{padding:0,overflow:"hidden"}}>
          <Tbl cols={[
            {l:"Symbol",r_:r=><div>
              <div style={{fontFamily:FP,fontSize:14,fontWeight:600,color:r.sh_==="haram"?T.loss:T.textHi,letterSpacing:"-0.01em"}}>{r.tk}</div>
              <div style={{fontFamily:FM,fontSize:10,color:T.muted,marginTop:2}}>{r.ac_}</div>
            </div>},
            {l:"Shares",r:true,r_:r=><span style={{fontFamily:FM,fontSize:11,color:T.text,fontVariantNumeric:"tabular-nums"}}>{r.sh.toFixed(3)}</span>},
            {l:"Avg Cost",r:true,mobileHide:true,r_:r=><span style={{fontFamily:FM,fontSize:11,color:T.muted,fontVariantNumeric:"tabular-nums"}}>{f$(r.ac)}</span>},
            {l:"Current",r:true,mobileHide:true,r_:r=><span style={{fontFamily:FM,fontSize:12,fontWeight:500,color:T.text,fontVariantNumeric:"tabular-nums"}}>{f$(r.px)}</span>},
            {l:"Loss $",r:true,r_:r=><span style={{fontFamily:FP,fontSize:13,fontWeight:600,color:T.loss,letterSpacing:"-0.005em",fontVariantNumeric:"tabular-nums"}}>{f$(Math.abs(r._loss))}</span>},
            {l:"Loss %",r:true,r_:r=><span style={{fontFamily:FM,fontSize:11,fontWeight:600,color:T.loss,fontVariantNumeric:"tabular-nums"}}>{fp(r._lossPct)}</span>},
            {l:"Wash Risk",mobileHide:true,r_:r=>recentSells.has(r.tk)?<Tag label="< 30d sold" color={T.loss}/>:<Tag label="Clear" color={T.gain}/>},
            {l:"Replace With",r_:r=><span style={{fontFamily:FM,fontSize:11,fontWeight:500,color:r.sh_==="haram"?T.loss:T.gold}}>{r._replacement}</span>},
          ]} rows={losers}/>
        </BentoTile>
    }
  </div>;
}

/* ─── DOCUMENTS PANEL ────────────────────────────────── */
// Two sections: SnapTrade-fetched docs (statements/1099s/confirms from
// brokers) and User-uploaded files (CSV/PDF/DOCX/etc.) that we store
// locally + sync to Supabase. Per-file cap 2 MB to keep user_state row
// size reasonable; duplicates detected by name+size fingerprint.
const USER_DOC_MAX_BYTES = 2 * 1024 * 1024;
const USER_DOC_ACCEPT = ".csv,.pdf,.docx,.xls,.xlsx,.txt,.json,.png,.jpg,.jpeg,application/pdf,text/csv,text/plain";

function DocumentsPanel({documents=[],accounts=[]}){
  const[type,setType]=useState("all");
  const[acctF,setAcctF]=useState("all");

  // User-uploaded files. Stored as base64 data URLs so downloads work
  // offline after sync. Mirrored to Supabase via TRACKED_KEYS.
  const[userDocs,setUserDocs]=useState(()=>{try{return JSON.parse(localStorage.getItem("mizan_user_docs")||"[]");}catch{return[];}});
  const[uploadBusy,setUploadBusy]=useState(false);
  const[uploadStatus,setUploadStatus]=useState(null);
  const fileRef=useRef(null);

  const acctNameById=Object.fromEntries(accounts.map(a=>[a.accountId,`${a.brokerage} — ${a.accountName}`]));
  const types=[...new Set(documents.map(d=>(d.type||d.document_type||"OTHER").toUpperCase()))];

  const filtered=documents.filter(d=>{
    const dType=(d.type||d.document_type||"OTHER").toUpperCase();
    if(type!=="all"&&dType!==type)return false;
    const aId=d.account?.id||d.accountId||d.account_id;
    if(acctF!=="all"&&aId!==acctF)return false;
    return true;
  }).sort((a,b)=>(b.date||b.created_at||"").localeCompare(a.date||a.created_at||""));

  const colorOf=t=>({"STATEMENT":T.blue,"TAX":T.gold,"1099":T.gold,"TRADE_CONFIRMATION":T.gain,"NOTICE":T.muted}[t]||T.muted);
  const docFingerprint=d=>`${(d.name||"").toLowerCase()}|${d.size||0}`;
  const persistUserDocs=arr=>{
    setUserDocs(arr);
    try{localStorage.setItem("mizan_user_docs",JSON.stringify(arr));}catch{}
    persistUserState("mizan_user_docs",arr);
  };

  const handleUpload=async e=>{
    const files=Array.from(e.target.files||[]);
    if(!files.length)return;
    setUploadBusy(true);setUploadStatus(null);
    const existing=new Set(userDocs.map(docFingerprint));
    let added=0,skipped=0,oversized=0,failed=0;
    const fresh=[];
    for(const f of files){
      if(f.size>USER_DOC_MAX_BYTES){oversized++;continue;}
      const fp=`${f.name.toLowerCase()}|${f.size}`;
      // We still allow re-upload (no hard reject) but tag it as duplicate
      // so the user can keep multiple copies if they intentionally need to.
      const isDup=existing.has(fp);
      try{
        const dataUrl=await new Promise((resolve,reject)=>{
          const fr=new FileReader();
          fr.onload=()=>resolve(fr.result);
          fr.onerror=()=>reject(fr.error);
          fr.readAsDataURL(f);
        });
        fresh.push({
          id:`u-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
          name:f.name,
          type:f.type||"application/octet-stream",
          size:f.size,
          lastModified:f.lastModified,
          uploadedAt:new Date().toISOString(),
          duplicate:isDup,
          data:dataUrl,
        });
        if(isDup)skipped++;else{added++;existing.add(fp);}
      }catch{failed++;}
    }
    if(fresh.length>0)persistUserDocs([...fresh,...userDocs]);
    const parts=[];
    if(added>0)parts.push(`Added ${added} file${added===1?"":"s"}.`);
    if(skipped>0)parts.push(`${skipped} duplicate${skipped===1?"":"s"} kept (flagged).`);
    if(oversized>0)parts.push(`${oversized} skipped — over 2 MB limit.`);
    if(failed>0)parts.push(`${failed} failed to read.`);
    setUploadStatus({ok:added>0||skipped>0,msg:parts.join(" ")||"No files processed."});
    setUploadBusy(false);
    if(fileRef.current)fileRef.current.value="";
    setTimeout(()=>setUploadStatus(null),5500);
  };

  const removeUserDoc=id=>{
    if(!window.confirm("Delete this file? Cannot be undone."))return;
    persistUserDocs(userDocs.filter(d=>d.id!==id));
  };

  const fmtSize=b=>{
    if(b<1024)return`${b} B`;
    if(b<1024*1024)return`${(b/1024).toFixed(1)} KB`;
    return`${(b/1024/1024).toFixed(2)} MB`;
  };
  const fmtDate=s=>{try{return new Date(s).toLocaleDateString("en-US",{year:"numeric",month:"short",day:"numeric"});}catch{return s||"—";}};

  return<div style={{display:"flex",flexDirection:"column",gap:T.s5}}>
    {/* USER UPLOADS */}
    <BentoTile>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:T.s4,flexWrap:"wrap",marginBottom:T.s4}}>
        <div>
          <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>YOUR FILES</div>
          <p style={{fontFamily:FP,fontSize:13,color:T.muted,margin:0,lineHeight:1.55,maxWidth:520}}>
            Upload CSVs, PDFs, DOCX, images — any file up to 2 MB. Stored privately to your account, synced across devices, with duplicate detection by name + size.
          </p>
        </div>
        <div style={{display:"flex",gap:T.s2,alignItems:"center",flexShrink:0}}>
          <input ref={fileRef} type="file" multiple accept={USER_DOC_ACCEPT} onChange={handleUpload} style={{display:"none"}}/>
          <button onClick={()=>fileRef.current?.click()} disabled={uploadBusy} className="btn-primary">{uploadBusy?"Uploading…":"Upload Files"}</button>
        </div>
      </div>
      {uploadStatus&&<div style={{marginBottom:T.s3,padding:`${T.s2} ${T.s3}`,borderRadius:T.rMd,fontFamily:FM,fontSize:11,background:uploadStatus.ok?T.gainBg:T.lossBg,border:`1px solid ${(uploadStatus.ok?T.gain:T.loss)+"30"}`,color:uploadStatus.ok?T.gain:T.loss,lineHeight:1.5}}>{uploadStatus.ok?ICON_OK:ICON_NO}{uploadStatus.msg}</div>}
      {userDocs.length===0
        ?<div style={{padding:`${T.s8} ${T.s5}`,textAlign:"center",fontFamily:FP,fontSize:13,color:T.muted,border:`1px dashed ${T.border}`,borderRadius:T.rMd}}>
          No files yet. Click <strong style={{color:T.text}}>Upload Files</strong> to add CSVs, PDFs, or DOCX. Files sync to your account so they appear on every device you sign in from.
        </div>
        :<div style={{overflow:"hidden",borderRadius:T.rMd,border:`1px solid ${T.border}`}}>
          <Tbl cols={[
            {l:"Uploaded",r_:r=><span style={{fontFamily:FM,fontSize:11,color:T.muted}}>{fmtDate(r.uploadedAt)}</span>},
            {l:"Name",r_:r=><div style={{display:"flex",alignItems:"center",gap:T.s2}}>
              <span style={{fontFamily:FP,fontSize:13,color:T.text,letterSpacing:"-0.005em"}}>{r.name}</span>
              {r.duplicate&&<Tag label="Duplicate" color={T.gold}/>}
            </div>},
            {l:"Type",r_:r=>{
              const ext=(r.name.split(".").pop()||"").toUpperCase();
              const c=ext==="CSV"?T.blue:ext==="PDF"?T.loss:ext==="DOCX"||ext==="DOC"?T.gain:T.muted;
              return<Tag label={ext||"FILE"} color={c}/>;
            }},
            {l:"Size",r:true,r_:r=><span style={{fontFamily:FM,fontSize:11,color:T.muted,fontVariantNumeric:"tabular-nums"}}>{fmtSize(r.size)}</span>},
            {l:"",r:true,r_:r=><div style={{display:"flex",gap:T.s1,justifyContent:"flex-end"}}>
              <a href={r.data} download={r.name} style={{padding:`4px ${T.s3}`,borderRadius:T.rSm,fontFamily:FM,fontSize:10,fontWeight:600,letterSpacing:"0.06em",background:`${T.blue}18`,border:`1px solid ${T.blue}40`,color:T.blue,textDecoration:"none"}}>Download</a>
              <button onClick={()=>removeUserDoc(r.id)} style={{padding:`4px ${T.s2}`,borderRadius:T.rSm,fontFamily:FM,fontSize:11,background:"transparent",border:`1px solid ${T.loss}30`,color:T.loss,cursor:"pointer"}}><Icon name="close" size={12}/></button>
            </div>},
          ]} rows={userDocs}/>
        </div>}
    </BentoTile>

    {/* SNAPTRADE-FETCHED DOCS */}
    <BentoTile>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:T.s4,flexWrap:"wrap",marginBottom:T.s4}}>
        <div>
          <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>FROM YOUR BROKERS</div>
          <p style={{fontFamily:FP,fontSize:13,color:T.muted,margin:0,lineHeight:1.55,maxWidth:600}}>
            Statements, 1099s, trade confirmations, and broker notices pulled from SnapTrade. Coverage varies by broker — Fidelity + Robinhood expose statements + tax docs; Coinbase exports trade confirms.
          </p>
        </div>
      </div>

      <div className="bento-row" style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(160px, 1fr))",gap:T.s3,marginBottom:T.s4}}>
        <BentoTile style={{padding:`${T.s3} ${T.s4}`,boxShadow:"none"}}>
          <div style={{fontFamily:FM,fontSize:9,color:T.muted,letterSpacing:"0.14em",fontWeight:500,marginBottom:T.s1}}>TOTAL</div>
          <div style={{fontFamily:FU,fontSize:20,fontWeight:600,color:T.textHi,letterSpacing:"-0.02em",fontVariantNumeric:"tabular-nums"}}>{documents.length}</div>
          <div style={{fontFamily:FM,fontSize:10,color:T.muted,marginTop:T.s1}}>{types.length||0} types</div>
        </BentoTile>
        <BentoTile style={{padding:`${T.s3} ${T.s4}`,boxShadow:"none"}}>
          <div style={{fontFamily:FM,fontSize:9,color:T.muted,letterSpacing:"0.14em",fontWeight:500,marginBottom:T.s1}}>STATEMENTS</div>
          <div style={{fontFamily:FU,fontSize:20,fontWeight:600,color:T.textHi,letterSpacing:"-0.02em",fontVariantNumeric:"tabular-nums"}}>{documents.filter(d=>/STATEMENT/i.test(d.type||d.document_type||"")).length}</div>
          <div style={{fontFamily:FM,fontSize:10,color:T.muted,marginTop:T.s1}}>Monthly + quarterly</div>
        </BentoTile>
        <BentoTile style={{padding:`${T.s3} ${T.s4}`,boxShadow:"none"}}>
          <div style={{fontFamily:FM,fontSize:9,color:T.muted,letterSpacing:"0.14em",fontWeight:500,marginBottom:T.s1}}>TAX / 1099s</div>
          <div style={{fontFamily:FU,fontSize:20,fontWeight:600,color:T.gold,letterSpacing:"-0.02em",fontVariantNumeric:"tabular-nums"}}>{documents.filter(d=>/TAX|1099/i.test(d.type||d.document_type||"")).length}</div>
          <div style={{fontFamily:FM,fontSize:10,color:T.muted,marginTop:T.s1}}>Year-end</div>
        </BentoTile>
      </div>

      <div style={{display:"flex",gap:T.s2,flexWrap:"wrap",alignItems:"center",marginBottom:T.s3}}>
        <button onClick={()=>setType("all")} style={{padding:`5px ${T.s3}`,borderRadius:T.rMd,fontFamily:FM,fontSize:11,fontWeight:500,background:type==="all"?T.blue:"transparent",border:`1px solid ${type==="all"?T.blue:T.border}`,color:type==="all"?"#fff":T.muted,cursor:"pointer"}}>All</button>
        {types.map(t=><button key={t} onClick={()=>setType(t)} style={{padding:`5px ${T.s3}`,borderRadius:T.rMd,fontFamily:FM,fontSize:11,fontWeight:500,background:type===t?`${colorOf(t)}22`:"transparent",border:`1px solid ${type===t?colorOf(t):T.border}`,color:type===t?colorOf(t):T.muted,cursor:"pointer"}}>{t.replace(/_/g," ")}</button>)}
        <select value={acctF} onChange={e=>setAcctF(e.target.value)} className="field" style={{marginLeft:"auto",width:"auto",fontSize:11,padding:`5px ${T.s3}`}}>
          <option value="all">All Accounts</option>
          {accounts.map(a=><option key={a.accountId} value={a.accountId}>{a.brokerage} — {a.accountName}</option>)}
        </select>
      </div>

      {filtered.length===0
        ?<div style={{padding:`${T.s8} ${T.s5}`,textAlign:"center",fontFamily:FP,fontSize:13,color:T.muted,border:`1px dashed ${T.border}`,borderRadius:T.rMd}}>
          {documents.length===0?"No documents yet — SnapTrade syncs broker documents on a delay. Fidelity and Robinhood usually populate within 24 hours of connection.":"No documents match these filters."}
        </div>
        :<div style={{overflow:"hidden",borderRadius:T.rMd,border:`1px solid ${T.border}`}}>
            <Tbl cols={[
              {l:"Date",r_:r=><span style={{fontFamily:FM,fontSize:11,color:T.muted}}>{r.date||r.created_at||"—"}</span>},
              {l:"Type",r_:r=>{const t=(r.type||r.document_type||"OTHER").toUpperCase();return<Tag label={t.replace(/_/g," ")} color={colorOf(t)}/>;}},
              {l:"Name",r_:r=><span style={{fontFamily:FP,fontSize:13,color:T.text,letterSpacing:"-0.005em"}}>{r.name||r.title||r.description||r.id||"—"}</span>},
              {l:"Account",r_:r=>{const id=r.account?.id||r.accountId||r.account_id;return<span style={{fontFamily:FM,fontSize:11,color:T.muted}}>{acctNameById[id]||r.institution_name||"—"}</span>;}},
              {l:"",r:true,r_:r=>{const url=r.downloadUrl||r.download_url||r.url;return url?<a href={url} target="_blank" rel="noreferrer" style={{padding:`4px ${T.s3}`,borderRadius:T.rSm,fontFamily:FM,fontSize:10,fontWeight:600,letterSpacing:"0.06em",background:`${T.blue}18`,border:`1px solid ${T.blue}40`,color:T.blue,textDecoration:"none"}}>Download ↗</a>:<span style={{color:T.muted,fontSize:10}}>—</span>;}},
            ]} rows={filtered}/>
          </div>
      }
    </BentoTile>
  </div>;
}

/* ─── ACTIVITY (transaction history) ─────────────────── */
function ActivityPanel({activities=[],accounts=[],botFills=[]}){
  const[type,setType]=useState("all");
  const[acctF,setAcctF]=useState("all");
  const[range,setRange]=useState("1y");

  const acctNameById=Object.fromEntries(accounts.map(a=>[a.accountId,`${a.brokerage} — ${a.accountName}`]));
  const acctOptions=["all",...accounts.map(a=>a.accountId)];

  // Merge the bot's executed fills so a bot trade appears here IMMEDIATELY — the
  // broker feed (snapActivities) only catches up on SnapTrade's sync cadence, so
  // without this the Activity tab lags the Trade tab. Dedup: once the broker
  // reports the same ticker+side+units within ~4 days, that authoritative row
  // wins and the tagged bot dupe drops. Display-only — botFills are NOT in
  // snapActivities, so net-worth/flow calcs stay broker-sourced.
  const symOf=s=>{if(!s)return"";if(typeof s==="string")return s.toUpperCase();let c=s,d=0;while(c&&typeof c==="object"&&c.symbol&&typeof c.symbol==="object"&&d<3){c=c.symbol;d++;}return String(c?.symbol||c?.raw_symbol||c?.ticker||"").toUpperCase();};
  const ms=x=>{const d=new Date(x);return isNaN(d.getTime())?0:d.getTime();};
  const brokerTrades=activities.filter(a=>["BUY","SELL"].includes((a.type||"").toUpperCase()));
  const botRows=(botFills||[]).filter(b=>!brokerTrades.some(a=>
    symOf(a.symbol)===String(b.symbol||"").toUpperCase()
    &&(a.type||"").toUpperCase()===b.type
    &&Math.round(Number(a.units)||0)===Math.round(Number(b.units)||0)
    &&Math.abs(ms(a.trade_date||a.settlement_date)-ms(b.trade_date))<=4*86400000));
  const allActs=[...botRows,...activities];

  const cutoff=(()=>{
    const d=new Date();
    if(range==="1m")d.setMonth(d.getMonth()-1);
    else if(range==="3m")d.setMonth(d.getMonth()-3);
    else if(range==="1y")d.setFullYear(d.getFullYear()-1);
    else if(range==="5y")d.setFullYear(d.getFullYear()-5);
    else return null; // all
    return d.toISOString().slice(0,10);
  })();

  const rows=allActs.filter(a=>{
    if(type!=="all"&&(a.type||"").toUpperCase()!==type)return false;
    if(acctF!=="all"&&a.account?.id!==acctF)return false;
    if(cutoff&&(a.trade_date||a.settlement_date||"")<cutoff)return false;
    return true;
  });

  const totals={
    BUY:rows.filter(r=>(r.type||"").toUpperCase()==="BUY").reduce((s,r)=>s+Math.abs(r.amount||0),0),
    SELL:rows.filter(r=>(r.type||"").toUpperCase()==="SELL").reduce((s,r)=>s+Math.abs(r.amount||0),0),
    DIVIDEND:rows.filter(r=>(r.type||"").toUpperCase()==="DIVIDEND").reduce((s,r)=>s+(r.amount||0),0),
    DEPOSIT:rows.filter(r=>(r.type||"").toUpperCase()==="DEPOSIT").reduce((s,r)=>s+(r.amount||0),0),
  };

  const colorOf=t=>({BUY:T.blue,SELL:T.gold,DIVIDEND:T.gain,DEPOSIT:T.gain,WITHDRAWAL:T.loss,FEE:T.loss}[t]||T.muted);
  const fmtSym=s=>{
    if(s==null)return"—";
    if(typeof s==="string")return s;
    let cur=s, depth=0;
    while(cur&&typeof cur==="object"&&cur.symbol&&typeof cur.symbol==="object"&&depth<3){cur=cur.symbol;depth++;}
    if(typeof cur==="string")return cur;
    const out=cur?.symbol??cur?.raw_symbol??cur?.ticker;
    return typeof out==="string"&&out?out:"—";
  };

  const rangeLabel={all:"All time","1m":"1 month","3m":"3 months","1y":"1 year","5y":"5 years"}[range]||range;
  const withdrawals=rows.filter(r=>(r.type||"").toUpperCase()==="WITHDRAWAL").reduce((s,r)=>s+Math.abs(r.amount||0),0);
  const netFlow=totals.DEPOSIT-withdrawals;

  return<div style={{display:"flex",flexDirection:"column",gap:T.s5}}>
    <div className="bento-row" style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(160px, 1fr))",gap:T.s4}}>
      <BentoTile accent={T.blue}>
        <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>BUYS</div>
        <div style={{fontFamily:FU,fontSize:22,fontWeight:600,color:T.textHi,letterSpacing:"-0.025em",fontVariantNumeric:"tabular-nums"}}>{kf(totals.BUY)}</div>
        <div style={{fontFamily:FM,fontSize:11,color:T.muted,marginTop:T.s1}}>{rows.filter(r=>(r.type||"").toUpperCase()==="BUY").length} txns · {rangeLabel}</div>
      </BentoTile>
      <BentoTile accent={T.gold}>
        <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>SELLS</div>
        <div style={{fontFamily:FU,fontSize:22,fontWeight:600,color:T.textHi,letterSpacing:"-0.025em",fontVariantNumeric:"tabular-nums"}}>{kf(totals.SELL)}</div>
        <div style={{fontFamily:FM,fontSize:11,color:T.muted,marginTop:T.s1}}>{rows.filter(r=>(r.type||"").toUpperCase()==="SELL").length} txns · {rangeLabel}</div>
      </BentoTile>
      <BentoTile accent={T.gain}>
        <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>DIVIDENDS</div>
        <div style={{fontFamily:FU,fontSize:22,fontWeight:600,color:T.textHi,letterSpacing:"-0.025em",fontVariantNumeric:"tabular-nums"}}>{kf(totals.DIVIDEND)}</div>
        <div style={{fontFamily:FM,fontSize:11,fontWeight:500,color:T.gain,marginTop:T.s1}}>Cash received · {rangeLabel}</div>
      </BentoTile>
      <BentoTile accent={netFlow>=0?T.gain:T.loss}>
        <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>NET FLOW</div>
        <div style={{fontFamily:FU,fontSize:22,fontWeight:600,color:netFlow>=0?T.gain:T.loss,letterSpacing:"-0.025em",fontVariantNumeric:"tabular-nums"}}>{netFlow>=0?"+":"-"}{kf(Math.abs(netFlow))}</div>
        <div style={{fontFamily:FM,fontSize:11,color:T.muted,marginTop:T.s1}}>Deposits − withdrawals · {rangeLabel}</div>
      </BentoTile>
    </div>

    <div style={{display:"flex",gap:T.s2,flexWrap:"wrap",alignItems:"center"}}>
      {[["all","All"],["BUY","Buys"],["SELL","Sells"],["DIVIDEND","Dividends"],["DEPOSIT","Deposits"],["WITHDRAWAL","Withdrawals"],["FEE","Fees"]].map(([v,l])=>
        <button key={v} onClick={()=>setType(v)} style={{padding:`5px ${T.s3}`,borderRadius:T.rMd,fontFamily:FM,fontSize:11,fontWeight:500,
          background:type===v?`${colorOf(v)}22`:"transparent",
          border:`1px solid ${type===v?colorOf(v):T.border}`,
          color:type===v?colorOf(v):T.muted,cursor:"pointer",transition:"all 0.15s"}}>{l}</button>)}
      <div style={{width:1,height:18,background:T.border,alignSelf:"center"}}/>
      <select value={acctF} onChange={e=>setAcctF(e.target.value)} className="field" style={{width:"auto",fontSize:11,padding:`5px ${T.s3}`}}>
        <option value="all">All Accounts</option>
        {acctOptions.filter(o=>o!=="all").map(id=><option key={id} value={id}>{acctNameById[id]||id}</option>)}
      </select>
      <div style={{marginLeft:"auto",display:"flex",gap:T.s1,alignItems:"center"}}>
        {[["1m","1M"],["3m","3M"],["1y","1Y"],["5y","5Y"],["all","All"]].map(([v,l])=>
          <button key={v} onClick={()=>setRange(v)} style={{padding:`5px ${T.s3}`,borderRadius:T.rMd,fontFamily:FM,fontSize:10,fontWeight:600,letterSpacing:"0.06em",
            background:range===v?T.borderHi:"transparent",border:`1px solid ${range===v?T.borderHi:T.border}`,
            color:range===v?T.text:T.muted,cursor:"pointer"}}>{l}</button>)}
        <button
          onClick={()=>downloadCSV(
            rows.map(r=>({
              Date:r.trade_date||r.settlement_date||"",
              Type:(r.type||"").toUpperCase(),
              Symbol:fmtSym(r.symbol),
              Description:r.description||"",
              Quantity:r.units?+r.units:"",
              Price:r.price?+r.price:"",
              Amount:+r.amount||0,
              Account:acctNameById[r.account?.id]||r.institution_name||"",
            })),
            `mizan-activity-${new Date().toISOString().slice(0,10)}.csv`,
          )}
          disabled={rows.length===0}
          title={rows.length===0?"No activity to export":"Download activity as CSV"}
          style={{padding:`5px ${T.s3}`,borderRadius:T.rMd,fontFamily:FM,fontSize:10,fontWeight:600,letterSpacing:"0.06em",background:"transparent",border:`1px solid ${T.border}`,color:rows.length===0?T.dim:T.muted,cursor:rows.length===0?"not-allowed":"pointer"}}
        >CSV ↓</button>
        <button
          onClick={async()=>{
            const r=await apiFetch("/api/export/activity.csv");
            if(!r.ok){alert("Export failed");return;}
            const blob=await r.blob();
            const url=URL.createObjectURL(blob);
            const a=document.createElement("a");
            a.href=url;a.download=`mizan-activity-${new Date().toISOString().slice(0,10)}.csv`;
            document.body.appendChild(a);a.click();
            setTimeout(()=>{URL.revokeObjectURL(url);a.remove();},100);
          }}
          title="Download full activity export from server (5-year SnapTrade window)"
          style={{padding:`5px ${T.s3}`,borderRadius:T.rMd,fontFamily:FM,fontSize:10,fontWeight:600,letterSpacing:"0.06em",background:"transparent",border:`1px solid ${T.border}`,color:T.muted,cursor:"pointer"}}
        >↓ Export CSV</button>
      </div>
    </div>

    {rows.length===0?
      <BentoTile style={{padding:`${T.s10} ${T.s5}`,textAlign:"center",borderStyle:"dashed"}}>
        <div style={{fontFamily:FP,fontSize:14,fontWeight:500,color:T.muted}}>No activity in this range.</div>
        <div style={{fontFamily:FP,fontSize:12,color:T.muted,marginTop:T.s1}}>Widen the date filter or run Sync All.</div>
      </BentoTile>
      :
      <BentoTile style={{padding:0,overflow:"hidden"}}>
        <Tbl cols={[
          {l:"Date",   r_:r=><span style={{fontFamily:FM,fontSize:11,color:T.muted,fontVariantNumeric:"tabular-nums"}}>{r.trade_date||r.settlement_date||"—"}</span>},
          {l:"Type",   r_:r=>{const t=(r.type||"").toUpperCase();return<span style={{display:"inline-flex",gap:4,alignItems:"center"}}><Tag label={t||"—"} color={colorOf(t)}/>{r._bot&&<Tag label="BOT" color={T.blue}/>}</span>;}},
          {l:"Symbol", r_:r=><span style={{fontFamily:FP,fontSize:13,fontWeight:600,color:T.textHi,letterSpacing:"-0.005em"}}>{fmtSym(r.symbol)}</span>},
          {l:"Account",mobileHide:true,r_:r=><span style={{fontFamily:FM,fontSize:11,color:T.muted}}>{acctNameById[r.account?.id]||r.institution_name||"—"}</span>},
          {l:"Quantity",r:true,r_:r=><span style={{fontFamily:FM,fontSize:11,color:T.text,fontVariantNumeric:"tabular-nums"}}>{r.units?(+r.units).toLocaleString("en-US",{maximumFractionDigits:4}):"—"}</span>},
          {l:"Price",   r:true,mobileHide:true,r_:r=><span style={{fontFamily:FM,fontSize:11,color:T.muted,fontVariantNumeric:"tabular-nums"}}>{r.price?f$(r.price):"—"}</span>},
          {l:"Amount",  r:true,r_:r=>{const v=+r.amount||0;return<span style={{fontFamily:FP,fontSize:13,fontWeight:600,color:v>0?T.gain:v<0?T.loss:T.text,letterSpacing:"-0.005em",fontVariantNumeric:"tabular-nums"}}>{v>0?"+":v<0?"−":""}{f$(Math.abs(v))}</span>;}},
        ]} rows={rows.slice(0,500)}/>
        {rows.length>500&&<div style={{padding:`${T.s2} ${T.s4}`,fontFamily:FM,fontSize:10,color:T.muted,textAlign:"center",borderTop:`1px solid ${T.border}`}}>Showing first 500 of {rows.length} — narrow filters to see more.</div>}
      </BentoTile>
    }
  </div>;
}

/* ─── ZAKAT WORKSHEET (comprehensive) ─────────────────── */
// Presentational editor for the full Zakat worksheet — mirrors the category
// list of the authoritative scholar calculators Mizan follows (DarusSalam
// Seminary + Sacred Learning): every zakatable asset class, minus deductible
// short-term liabilities, at 2.5%. State + persistence are lifted to
// ZakatSadaqah; this renders the connected-account rows (auto, read-only), the
// editable asset + liability rows, and a live subtotal. Math lives in the pure
// computeZakatWorksheet() (src/lib/zakat.js).
function ZakatWorksheet({ draft, onField, onPersist, result, nisabUsd, settings, demoMode=false,
  connectedAccounts=[], excludedAccounts=new Set(), onToggleAccount, connectedTotals={}, creditAccounts=[], connectedLiabilities=0, onConnect }){
  const fmtUSD=v=>`$${(+v||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const factorPct = settings.investmentMethod==="longterm_30" ? "× 30%" : null;
  const countedN = connectedAccounts.filter(a=>!excludedAccounts.has(a.id)).length;
  const creditCountedN = creditAccounts.filter(a=>!excludedAccounts.has(a.id)).length;
  const KIND_LABEL = { brokerage:"Brokerage", retirement:"Retirement", investment:"Investment", cash:"Cash" };
  const KIND_COLOR = { brokerage:T.blue, retirement:T.violet, investment:T.blue, cash:T.gain };

  const inputRow=f=>(
    <div key={f.key} style={{display:"grid",gridTemplateColumns:"1fr 150px",gap:T.s3,alignItems:"center",padding:`${T.s2} 0`,borderBottom:`1px solid ${T.border}`}}>
      <div style={{minWidth:0}}>
        <div style={{fontFamily:FP,fontSize:13,fontWeight:500,color:T.text,letterSpacing:"-0.005em",display:"flex",alignItems:"center",gap:T.s2,flexWrap:"wrap"}}>
          {f.label}
          {f.inv&&factorPct&&<span style={{fontFamily:FM,fontSize:9,color:T.gold,letterSpacing:"0.06em",fontWeight:600,padding:`1px 5px`,borderRadius:T.rSm,background:`${T.gold}14`}}>{factorPct}</span>}
        </div>
        <div style={{fontFamily:FP,fontSize:11,color:T.muted,marginTop:1,lineHeight:1.35}}>{f.help}</div>
      </div>
      <div style={{position:"relative"}}>
        <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",fontFamily:FM,fontSize:12,color:T.muted,pointerEvents:"none"}}>$</span>
        <input type="number" inputMode="decimal" min="0" step="0.01"
          value={draft[f.key]||""}
          onChange={e=>onField(f.key,e.target.value)}
          onBlur={onPersist}
          disabled={demoMode}
          placeholder="0"
          className="field"
          style={{width:"100%",textAlign:"right",paddingLeft:22,fontVariantNumeric:"tabular-nums",fontFamily:FP,fontSize:14,opacity:demoMode?0.55:1}}/>
      </div>
    </div>
  );

  const autoRow=(label,value,note)=>(
    <div key={label} style={{display:"grid",gridTemplateColumns:"1fr 150px",gap:T.s3,alignItems:"center",padding:`${T.s2} 0`,borderBottom:`1px solid ${T.border}`}}>
      <div style={{minWidth:0}}>
        <div style={{fontFamily:FP,fontSize:13,fontWeight:500,color:T.text,letterSpacing:"-0.005em",display:"flex",alignItems:"center",gap:T.s2,flexWrap:"wrap"}}>
          {label}
          <span style={{fontFamily:FM,fontSize:9,color:T.blue,letterSpacing:"0.06em",fontWeight:600,padding:`1px 5px`,borderRadius:T.rSm,background:`${T.blue}14`}}>AUTO</span>
        </div>
        <div style={{fontFamily:FP,fontSize:11,color:T.muted,marginTop:1,lineHeight:1.35}}>{note}</div>
      </div>
      <div style={{textAlign:"right",fontFamily:FP,fontSize:14,fontWeight:600,color:T.textHi,fontVariantNumeric:"tabular-nums",paddingRight:2}}>{fmtUSD(value)}</div>
    </div>
  );

  const subtotal=(label,value,strong,color)=>(
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",padding:`${T.s2} 0`}}>
      <span style={{fontFamily:FM,fontSize:strong?12:11,color:strong?T.textHi:T.muted,letterSpacing:"0.05em",fontWeight:strong?600:500}}>{label}</span>
      <span style={{fontFamily:strong?FU:FP,fontSize:strong?18:14,fontWeight:strong?700:600,color:color||(strong?T.textHi:T.text),fontVariantNumeric:"tabular-nums",letterSpacing:strong?"-0.02em":"-0.005em"}}>{value}</span>
    </div>
  );

  return<div style={{display:"flex",flexDirection:"column",gap:T.s4}}>
    <div>
      <div style={{fontFamily:FM,fontSize:10,color:T.gain,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>ASSETS</div>

      {/* Connected-account picker — tick the accounts to count toward Zakat,
          untick any you don't (a joint account, one you handle separately). */}
      {connectedAccounts.length>0?<div style={{marginBottom:T.s3}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:T.s2,gap:T.s2,flexWrap:"wrap"}}>
          <span style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.12em",fontWeight:600}}>CONNECTED ACCOUNTS · {countedN} of {connectedAccounts.length} counted</span>
          {factorPct&&<span style={{fontFamily:FM,fontSize:9,color:T.gold,letterSpacing:"0.04em"}}>investments {factorPct}</span>}
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:4,maxHeight:220,overflowY:"auto",padding:T.s2,background:T.surface,border:`1px solid ${T.border}`,borderRadius:T.rMd}}>
          {connectedAccounts.map(a=>{
            const on=!excludedAccounts.has(a.id);
            return<label key={a.id} style={{display:"flex",alignItems:"center",gap:T.s2,padding:`6px ${T.s2}`,borderRadius:T.rSm,cursor:demoMode?"default":"pointer",background:on?`${T.blue}14`:"transparent",border:`1px solid ${on?T.blue+"55":T.border}`,opacity:demoMode?0.6:1}}>
              <input type="checkbox" checked={on} disabled={demoMode} onChange={()=>onToggleAccount&&onToggleAccount(a.id)} style={{cursor:demoMode?"default":"pointer",accentColor:T.blue}}/>
              <span style={{fontFamily:FM,fontSize:9,color:KIND_COLOR[a.kind]||T.muted,letterSpacing:"0.04em",fontWeight:600,padding:"1px 5px",borderRadius:T.rSm,background:`${KIND_COLOR[a.kind]||T.muted}14`,whiteSpace:"nowrap"}}>{KIND_LABEL[a.kind]||"Asset"}</span>
              <span style={{fontFamily:FP,fontSize:12,color:T.text,flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.label}</span>
              <span style={{fontFamily:FM,fontSize:11,color:on?T.textHi:T.muted,fontVariantNumeric:"tabular-nums"}}>{fmtUSD(a.balance)}</span>
            </label>;
          })}
        </div>
        <div style={{marginTop:T.s2,fontFamily:FM,fontSize:11,color:T.muted,fontVariantNumeric:"tabular-nums"}}>
          Counted: Investments <span style={{color:T.text,fontWeight:600}}>{fmtUSD(connectedTotals.invest||0)}</span>{factorPct?` (${factorPct})`:""} · Cash <span style={{color:T.text,fontWeight:600}}>{fmtUSD(connectedTotals.cash||0)}</span>
        </div>
      </div>:(onConnect&&!demoMode&&<button onClick={onConnect} style={{
        width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:T.s2,
        padding:`${T.s2} ${T.s3}`,marginBottom:T.s3,
        fontFamily:FM,fontSize:11,fontWeight:600,letterSpacing:"0.04em",
        color:T.blue,background:`${T.blue}0D`,border:`1px dashed ${T.blue}55`,borderRadius:T.rSm,cursor:"pointer",
      }}>
        <span aria-hidden="true" style={{fontSize:13,lineHeight:1}}>+</span>
        Connect a bank or brokerage to pick accounts here
      </button>)}

      {/* Manual rows — for anything NOT connected above (cash at home, gold,
          a 401k or brokerage you haven't linked, business assets, receivables) */}
      {connectedAccounts.length>0&&<div style={{fontFamily:FP,fontSize:11,color:T.muted,margin:`${T.s2} 0`,lineHeight:1.4}}>Add below only what your connected accounts don't already cover — cash at home, gold, unlinked accounts, business assets, money owed to you.</div>}
      {ZAKAT_ASSET_FIELDS.map(inputRow)}
    </div>
    <div>
      <div style={{fontFamily:FM,fontSize:10,color:T.loss,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>WHAT YOU OWE — deducted</div>
      {result.overdraft>0&&autoRow("Bank overdraft", result.overdraft, "Negative connected-account balance")}

      {/* Connected credit cards — tick the balances that count as deductible
          short-term debt (bills due now), untick any you don't. Mirrors the
          asset picker; shares the same excludedAccounts selection. */}
      {creditAccounts.length>0&&<div style={{marginBottom:T.s3}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:T.s2,gap:T.s2,flexWrap:"wrap"}}>
          <span style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.12em",fontWeight:600}}>CONNECTED CARDS · {creditCountedN} of {creditAccounts.length} counted</span>
          <span style={{fontFamily:FM,fontSize:11,color:T.loss,fontVariantNumeric:"tabular-nums"}}>− {fmtUSD(connectedLiabilities)}</span>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:4,maxHeight:180,overflowY:"auto",padding:T.s2,background:T.surface,border:`1px solid ${T.border}`,borderRadius:T.rMd}}>
          {creditAccounts.map(a=>{
            const on=!excludedAccounts.has(a.id);
            return<label key={a.id} style={{display:"flex",alignItems:"center",gap:T.s2,padding:`6px ${T.s2}`,borderRadius:T.rSm,cursor:demoMode?"default":"pointer",background:on?`${T.loss}14`:"transparent",border:`1px solid ${on?T.loss+"55":T.border}`,opacity:demoMode?0.6:1}}>
              <input type="checkbox" checked={on} disabled={demoMode} onChange={()=>onToggleAccount&&onToggleAccount(a.id)} style={{cursor:demoMode?"default":"pointer",accentColor:T.loss}}/>
              <span style={{fontFamily:FM,fontSize:9,color:T.loss,letterSpacing:"0.04em",fontWeight:600,padding:"1px 5px",borderRadius:T.rSm,background:`${T.loss}14`,whiteSpace:"nowrap"}}>Card</span>
              <span style={{fontFamily:FP,fontSize:12,color:T.text,flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.label}</span>
              <span style={{fontFamily:FM,fontSize:11,color:on?T.loss:T.muted,fontVariantNumeric:"tabular-nums"}}>− {fmtUSD(a.balance)}</span>
            </label>;
          })}
        </div>
        <div style={{marginTop:T.s2,fontFamily:FP,fontSize:11,color:T.muted,lineHeight:1.4}}>Ticked card balances count as short-term debt. Add anything else you owe below.</div>
      </div>}

      {ZAKAT_LIABILITY_FIELDS.map(inputRow)}
    </div>
    <div style={{borderTop:`2px solid ${T.dim}`,paddingTop:T.s1}}>
      {subtotal("Total zakatable assets", fmtUSD(result.assetsTotal))}
      {subtotal("Less liabilities", `− ${fmtUSD(result.liabilitiesTotal)}`, false, T.loss)}
      {subtotal("Net zakatable worth", fmtUSD(result.netZakatable), true)}
      {subtotal(`Nisab threshold (${settings.nisabStandard})`, fmtUSD(nisabUsd))}
    </div>
  </div>;
}

/* ─── ZAKAT + SADAQAH ────────────────────────────────── */
// Real per-user Zakat calc. Replaces the hardcoded panel that previously
// rendered the owner's figures to every user. Sums real brokerage balances
// + zakatable manual assets, applies 2.5%, and shows nisab threshold.
// Sadaqah is a user-entered ledger persisted to mizan_sadaqah (synced).
// ── Islamic finance — Zakat principles encoded here ──────────────────────
//
// Two recognized nisab (threshold) standards:
//   · Gold:   87.48 g (20 mithqal). Majority view — Shafi'i, Maliki, Hanbali.
//   · Silver: 612.36 g (200 dirham). Hanafi view. Lower threshold,
//             more inclusive of zakat obligation. Used by many contemporary
//             fatwa councils for cash-rich modern populations.
// Refresh spot price periodically; the constants below are 2026-05-31 spot.
// Zakat/nisab constants + pure math (NISAB_GOLD_USD, NISAB_SILVER_USD,
// INVESTMENT_FACTOR_*, DEFAULT_ZAKAT_SETTINGS, investmentFactor, nisabValueFor,
// computeZakat, …) are extracted to src/lib/zakat.js and imported at the top of
// this file. Investment methodology: "full" = 2.5% of full market value
// (trader); "longterm_30" = 2.5% of 30% of market value (AAOIFI long-term
// approximation of the zakatable share of company assets). Only the React
// hooks (useLiveNisab / useZakatSettings) and the localStorage load/save stay
// here — they touch storage/DOM and can't live in the pure module.

function loadZakatSettings(){
  try{
    const raw=localStorage.getItem("mizan_zakat_settings");
    if(!raw)return DEFAULT_ZAKAT_SETTINGS;
    const p=JSON.parse(raw);
    return {
      nisabStandard:    p.nisabStandard==="gold" ? "gold" : "silver",
      investmentMethod: p.investmentMethod==="full" ? "full" : "longterm_30",
    };
  }catch{ return DEFAULT_ZAKAT_SETTINGS; }
}
function saveZakatSettings(s){
  try{ localStorage.setItem("mizan_zakat_settings", JSON.stringify(s)); }catch{}
  // Broadcast so the Overview tile re-reads without a page reload.
  try{ window.dispatchEvent(new CustomEvent("mizan-zakat-settings")); }catch{}
}
// nisabValueFor(settings, live) + investmentFactor(settings) are imported from
// src/lib/zakat.js (pure, unit-tested). The live-price fetch + settings store
// below stay here because they touch apiFetch / localStorage / React.
//
// Subscribe a component to setting changes — returns the live settings and
// re-renders on save (from either the Zakat tab or another tab via storage event).
function useZakatSettings(){
  const[settings,setSettings]=useState(loadZakatSettings);
  useEffect(()=>{
    const re=()=>setSettings(loadZakatSettings());
    window.addEventListener("storage", re);
    window.addEventListener("mizan-zakat-settings", re);
    return()=>{
      window.removeEventListener("storage", re);
      window.removeEventListener("mizan-zakat-settings", re);
    };
  },[]);
  return settings;
}

// ── Zakat worksheet store ──────────────────────────────────────────────────
// The comprehensive worksheet (cash, metals, retirement, business, receivables,
// debts) lives in localStorage + user_state under mizan_zakat_worksheet. Pure
// math is in src/lib/zakat.js (computeZakatWorksheet); these are just the
// load/save/subscribe glue, mirroring the settings hooks above.
function loadZakatWorksheet(){
  try{
    const raw=localStorage.getItem("mizan_zakat_worksheet");
    if(!raw)return null; // never saved → caller seeds from manual assets
    const parsed=JSON.parse(raw);
    return parsed&&typeof parsed==="object"?parsed:null;
  }catch{ return null; }
}
function saveZakatWorksheet(ws){
  try{ localStorage.setItem("mizan_zakat_worksheet", JSON.stringify(ws)); }catch{}
  persistUserState("mizan_zakat_worksheet", ws);
  // Broadcast so the Overview ZAKAT DUE tile re-renders in lockstep with the tab.
  try{ window.dispatchEvent(new CustomEvent("mizan-zakat-worksheet")); }catch{}
}
// Returns the SAVED worksheet, or null if the user has never saved one.
function useZakatWorksheet(){
  const[ws,setWs]=useState(loadZakatWorksheet);
  useEffect(()=>{
    const re=()=>setWs(loadZakatWorksheet());
    window.addEventListener("storage", re);
    window.addEventListener("mizan-zakat-worksheet", re);
    return()=>{
      window.removeEventListener("storage", re);
      window.removeEventListener("mizan-zakat-worksheet", re);
    };
  },[]);
  return ws;
}
// First-run convenience: map the user's existing manual assets into worksheet
// categories so nobody's zakatable total silently drops when the worksheet
// ships. Used until the user saves a worksheet of their own (then it's truth).
// Personal-use items (zakatable:false — primary home, daily driver) are skipped.
function seedWorksheetFromManualAssets(manualAssets=[]){
  const ws={...DEFAULT_ZAKAT_WORKSHEET};
  for(const a of (Array.isArray(manualAssets)?manualAssets:[])){
    const v=+a.value||0;
    if(!v)continue;
    if(a.liability){ if(a.zakatable!==false) ws.shortTermDebt+=v; continue; }
    if(!a.zakatable)continue;
    switch(a.type){
      case"Gold":case"Silver": ws.goldSilver+=v; break;
      case"Investment Property":case"Real Estate":case"Real Estate (REIT)": ws.resaleProperty+=v; break;
      case"Business Equity":case"Business": ws.businessInventory+=v; break;
      default: ws.otherAssets+=v;
    }
  }
  return ws;
}
// The worksheet a surface should actually compute against: the demo seed in
// demo mode, else the user's saved worksheet, else a first-run seed from their
// manual assets. Keeps the Zakat tab and the Overview tile perfectly in sync.
function effectiveZakatWorksheet(savedWs, manualAssets, demoMode){
  if(demoMode)return seedWorksheetFromManualAssets(manualAssets);
  return savedWs || seedWorksheetFromManualAssets(manualAssets);
}

// Fetch live gold + silver spot prices from /api/metals/spot once per mount.
// Server caches 12 h; client just needs it for the lifetime of the page.
// Falls back to the static NISAB_*_USD constants when the endpoint is
// unconfigured (no FINNHUB_KEY) or the upstream fetch fails — same shape,
// source: "static", null refreshed_at.
function useLiveNisab(){
  const[data,setData]=useState({
    nisab_gold_usd:   NISAB_GOLD_USD,
    nisab_silver_usd: NISAB_SILVER_USD,
    refreshed_at:     null,
    source:           "static",
  });
  useEffect(()=>{
    let cancelled=false;
    apiFetch("/api/metals/spot").then(r=>r.ok?r.json():null).then(d=>{
      if(cancelled || !d?.ok)return;
      setData({
        nisab_gold_usd:   Number(d.nisab_gold_usd),
        nisab_silver_usd: Number(d.nisab_silver_usd),
        refreshed_at:     d.refreshed_at,
        source:           d.source,
      });
    }).catch(()=>{});
    return()=>{cancelled=true;};
  },[]);
  return data;
}

// Back-compat alias for any leftover references during this refactor.
const NISAB_USD = NISAB_GOLD_USD;

/* ─── PURIFICATION PANEL ─────────────────────────────── */
// AAOIFI-compliant dividend purification ledger. Each halal holding may
// carry a small percentage of impure income; that fraction of any dividend
// received must be donated to charity (without expectation of reward).
//
// Data flow:
//   /api/purification/calculate  → computed items for the current year
//   mizan_purification_log       → { [fingerprint]: {...} } marks purified
//   mizan_purification_overrides → { [ticker]: pct } user-set ratio overrides
//   mizan_sadaqah               → purified entries added here automatically
//
// Purification ratios are estimates. Consult your scholar or the fund's
// annual purification report for exact figures.

const DEMO_PURIFICATION_ITEMS = [
  { fingerprint:"SPUS_2026-03-28_12.40", ticker:"SPUS", date:"2026-03-28", dividendAmount:12.40, impurityPct:1.70, purificationOwed:0.2108, ratioSource:"SP Funds annual report — verify at spfunds.com" },
  { fingerprint:"HLAL_2026-03-15_8.75",  ticker:"HLAL", date:"2026-03-15", dividendAmount:8.75,  impurityPct:2.80, purificationOwed:0.245,  ratioSource:"Wahed FTSE USA Shariah ETF — issuer estimate" },
  { fingerprint:"SPUS_2025-12-30_11.90", ticker:"SPUS", date:"2025-12-30", dividendAmount:11.90, impurityPct:1.70, purificationOwed:0.2023, ratioSource:"SP Funds annual report — verify at spfunds.com" },
  { fingerprint:"UMMA_2025-09-19_6.20",  ticker:"UMMA", date:"2025-09-19", dividendAmount:6.20,  impurityPct:2.20, purificationOwed:0.1364, ratioSource:"Wahed EM Sharia ETF — issuer estimate" },
];

function PurificationPanel({ demoMode = false, onPurified }) {
  const [items, setItems]         = useState([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);
  const [year, setYear]           = useState(String(new Date().getFullYear()));
  const [overrides, setOverrides] = useState(() => {
    try { return JSON.parse(localStorage.getItem("mizan_purification_overrides") || "{}"); } catch { return {}; }
  });
  const [log, setLog]             = useState(() => {
    try { return JSON.parse(localStorage.getItem("mizan_purification_log") || "{}"); } catch { return {}; }
  });
  const [editOverride, setEditOverride] = useState(null); // { ticker, value }
  const [busy, setBusy]           = useState({}); // { [fingerprint]: true }

  const fmtUSD = v => `$${(+v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtPct = v => `${(+v || 0).toFixed(2)}%`;

  useEffect(() => {
    if (demoMode) { setItems(DEMO_PURIFICATION_ITEMS); return; }
    let cancelled = false;
    setLoading(true); setError(null);
    apiFetch(`/api/purification/calculate?year=${encodeURIComponent(year)}`)
      .then(async r => {
        if (cancelled) return;
        if (!r.ok) { setError("Could not load purification data."); return; }
        const d = await r.json().catch(() => ({}));
        setItems(Array.isArray(d?.items) ? d.items : []);
      })
      .catch(() => { if (!cancelled) setError("Network error — check your connection."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [demoMode, year]);

  const persistOverrides = updated => {
    setOverrides(updated);
    localStorage.setItem("mizan_purification_overrides", JSON.stringify(updated));
    persistUserState("mizan_purification_overrides", updated);
  };
  const persistLog = updated => {
    setLog(updated);
    localStorage.setItem("mizan_purification_log", JSON.stringify(updated));
    persistUserState("mizan_purification_log", updated);
  };

  const markPurified = (item, bulk = false) => {
    if (demoMode || log[item.fingerprint]) return;
    setBusy(b => ({ ...b, [item.fingerprint]: true }));
    const purifiedAt = new Date().toISOString();
    const sadaqahEntry = {
      id:      `purif-${Date.now()}-${item.ticker}`,
      dt:      item.date,
      org:     `Purification — ${item.ticker} dividend`,
      method:  "Purification",
      account: "",
      amt:     +item.purificationOwed.toFixed(4),
      done:    true,
    };
    // Append to sadaqah log
    const sadaqah = (() => { try { return JSON.parse(localStorage.getItem("mizan_sadaqah") || "[]"); } catch { return []; } })();
    const newSadaqah = [sadaqahEntry, ...sadaqah];
    localStorage.setItem("mizan_sadaqah", JSON.stringify(newSadaqah));
    persistUserState("mizan_sadaqah", newSadaqah);

    const newLog = { ...log, [item.fingerprint]: { purified_at: purifiedAt, ticker: item.ticker, dividend_amount: item.dividendAmount, purification_owed: item.purificationOwed } };
    persistLog(newLog);
    setBusy(b => { const n = { ...b }; delete n[item.fingerprint]; return n; });
    onPurified?.();
  };

  const purifyAll = () => {
    const pending = items.filter(it => !log[it.fingerprint]);
    pending.forEach(it => markPurified(it, true));
  };

  const saveOverride = () => {
    if (!editOverride) return;
    const val = parseFloat(editOverride.value);
    if (!Number.isFinite(val) || val < 0 || val > 100) { setEditOverride(null); return; }
    persistOverrides({ ...overrides, [editOverride.ticker]: val });
    setEditOverride(null);
    // Refresh computed items with new ratio applied locally
    setItems(prev => prev.map(it =>
      it.ticker === editOverride.ticker
        ? { ...it, impurityPct: val, purificationOwed: +(it.dividendAmount * val / 100).toFixed(4), ratioSource: "user override" }
        : it
    ));
  };

  const thisYear = String(new Date().getFullYear());
  const years    = [thisYear, String(+thisYear - 1), String(+thisYear - 2)];

  const pending       = items.filter(it => !log[it.fingerprint]);
  const purified      = items.filter(it =>  log[it.fingerprint]);
  const totalOwed     = pending.reduce((s, it) => s + it.purificationOwed, 0);
  const totalPurified = purified.reduce((s, it) => s + it.purificationOwed, 0);
  const hasPending    = pending.length > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: T.s4 }}>
      {/* ── Disclaimer ──────────────────────────────────── */}
      <div style={{
        padding: `${T.s3} ${T.s4}`,
        background: `${T.gold}0C`,
        border: `1px solid ${T.gold}30`,
        borderRadius: T.rMd,
        fontFamily: FM, fontSize: 11, color: T.muted, lineHeight: 1.6,
      }}>
        <span style={{ color: T.gold, fontWeight: 600 }}>ℹ Sharia note — </span>
        Purification ratios are estimates. Consult your scholar or the fund's annual purification report for exact figures.
        {" "}<strong style={{ color: T.text }}>MĪZAN is not a religious authority.</strong>
        {" "}Published reports: SP Funds (spfunds.com) · Wahed (wahedinvest.com) · Amana (saturna.com).
      </div>

      {/* ── Summary row ─────────────────────────────────── */}
      <div className="bento-row" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: T.s3 }}>
        <BentoTile accent={hasPending ? T.gold : T.gain}>
          <div style={{ fontFamily: FM, fontSize: 10, color: T.muted, letterSpacing: "0.16em", fontWeight: 600, marginBottom: T.s2 }}>PURIFICATION OWED</div>
          <div style={{ fontFamily: FU, fontSize: 24, fontWeight: 700, color: hasPending ? T.gold : T.muted, letterSpacing: "-0.025em", fontVariantNumeric: "tabular-nums" }}>{fmtUSD(totalOwed)}</div>
          <div style={{ fontFamily: FM, fontSize: 11, color: T.muted, marginTop: T.s1 }}>{pending.length} dividend{pending.length !== 1 ? "s" : ""} pending · {year}</div>
        </BentoTile>
        <BentoTile accent={T.gain}>
          <div style={{ fontFamily: FM, fontSize: 10, color: T.muted, letterSpacing: "0.16em", fontWeight: 600, marginBottom: T.s2 }}>PURIFIED YTD</div>
          <div style={{ fontFamily: FU, fontSize: 24, fontWeight: 700, color: T.gain, letterSpacing: "-0.025em", fontVariantNumeric: "tabular-nums" }}>{fmtUSD(totalPurified)}</div>
          <div style={{ fontFamily: FM, fontSize: 11, color: T.gain, marginTop: T.s1 }}>{purified.length} dividend{purified.length !== 1 ? "s" : ""} purified</div>
        </BentoTile>
      </div>

      {/* ── Controls: year picker + bulk action ─────────── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: T.s2 }}>
        <div style={{ display: "flex", gap: T.s2, alignItems: "center" }}>
          <span style={{ fontFamily: FM, fontSize: 10, color: T.muted, letterSpacing: "0.16em", fontWeight: 600 }}>YEAR</span>
          {years.map(y => (
            <button key={y} onClick={() => !demoMode && setYear(y)} style={{
              padding: `4px ${T.s3}`, borderRadius: T.rSm,
              fontFamily: FM, fontSize: 11, fontWeight: year === y ? 600 : 400,
              background: year === y ? `${T.blue}18` : "transparent",
              border: `1px solid ${year === y ? T.blue : T.border}`,
              color: year === y ? T.blue : T.muted,
              cursor: demoMode ? "not-allowed" : "pointer",
            }}>{y}</button>
          ))}
        </div>
        {hasPending && !demoMode && (
          <button
            onClick={purifyAll}
            style={{
              padding: `6px ${T.s4}`, borderRadius: T.rMd,
              fontFamily: FM, fontSize: 11, fontWeight: 600, letterSpacing: "0.04em",
              background: `${T.gain}18`, border: `1px solid ${T.gain}40`, color: T.gain, cursor: "pointer",
            }}
          >
            Purify all pending ({pending.length})
          </button>
        )}
      </div>

      {/* ── Dividends table ──────────────────────────────── */}
      <BentoTile style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: `${T.s3} ${T.s5}`, borderBottom: `1px solid ${T.border}`, fontFamily: FM, fontSize: 10, color: T.muted, letterSpacing: "0.16em", fontWeight: 600 }}>
          DIVIDEND PURIFICATION · {year}
        </div>
        {loading ? (
          <div style={{ padding: `${T.s6} ${T.s5}`, display: "flex", flexDirection: "column", gap: T.s3 }}>
            <Skeleton w="60%" h={13} /><Skeleton w="80%" h={13} /><Skeleton w="50%" h={13} />
          </div>
        ) : error ? (
          <div style={{ padding: `${T.s6} ${T.s5}`, fontFamily: FP, fontSize: 13, color: T.muted, textAlign: "center" }}>{error}</div>
        ) : items.length === 0 ? (
          <div style={{ padding: `${T.s8} ${T.s5}`, textAlign: "center", fontFamily: FP, fontSize: 13, color: T.muted }}>
            {demoMode ? "No purification data." : "No dividend activity found for this year. Connect a brokerage account to track dividends."}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontVariantNumeric: "tabular-nums" }}>
              <thead>
                <tr>
                  {["Ticker", "Date", "Dividend", "Impurity %", "Owed", "Status", ""].map((h, i) => (
                    <th key={h || i} style={{
                      padding: `${T.s3} ${T.s4}`, textAlign: i >= 2 ? "right" : "left",
                      fontFamily: FM, fontSize: 10, color: T.muted, letterSpacing: "0.14em",
                      textTransform: "uppercase", borderBottom: `1px solid ${T.border}`,
                      fontWeight: 600, whiteSpace: "nowrap", background: T.surface,
                      ...(i === 5 || i === 6 ? { textAlign: "center" } : {}),
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => {
                  const done = !!log[it.fingerprint];
                  const isEditing = editOverride?.ticker === it.ticker;
                  return (
                    <tr key={it.fingerprint} className="trow" style={{ borderBottom: `1px solid ${T.border}`, opacity: done ? 0.62 : 1 }}>
                      {/* Ticker */}
                      <td style={{ padding: `${T.s3} ${T.s4}`, borderBottom: `1px solid ${T.border}` }}>
                        <div style={{ fontFamily: FP, fontSize: 14, fontWeight: 600, color: T.textHi, letterSpacing: "-0.01em" }}>{it.ticker}</div>
                      </td>
                      {/* Date */}
                      <td style={{ padding: `${T.s3} ${T.s4}`, borderBottom: `1px solid ${T.border}` }}>
                        <span style={{ fontFamily: FM, fontSize: 11, color: T.muted }}>{it.date}</span>
                      </td>
                      {/* Dividend amount */}
                      <td style={{ padding: `${T.s3} ${T.s4}`, textAlign: "right", borderBottom: `1px solid ${T.border}` }}>
                        <span style={{ fontFamily: FM, fontSize: 12, color: T.text, fontVariantNumeric: "tabular-nums" }}>{fmtUSD(it.dividendAmount)}</span>
                      </td>
                      {/* Impurity % — click to override */}
                      <td style={{ padding: `${T.s3} ${T.s4}`, textAlign: "right", borderBottom: `1px solid ${T.border}` }}>
                        {isEditing ? (
                          <div style={{ display: "flex", gap: T.s1, justifyContent: "flex-end", alignItems: "center" }}>
                            <input
                              type="number" step="0.01" min="0" max="100"
                              value={editOverride.value}
                              onChange={e => setEditOverride(v => ({ ...v, value: e.target.value }))}
                              className="field"
                              style={{ width: 60, fontSize: 11, padding: `3px ${T.s2}`, textAlign: "right" }}
                              autoFocus
                              onKeyDown={e => { if (e.key === "Enter") saveOverride(); if (e.key === "Escape") setEditOverride(null); }}
                            />
                            <button onClick={saveOverride} style={{ padding: `2px ${T.s2}`, borderRadius: T.rSm, background: `${T.gain}18`, border: `1px solid ${T.gain}40`, color: T.gain, cursor: "pointer", fontFamily: FM, fontSize: 10, fontWeight: 600, display:"inline-flex", alignItems:"center" }}><Icon name="check" size={12}/></button>
                            <button onClick={() => setEditOverride(null)} style={{ padding: `2px ${T.s2}`, borderRadius: T.rSm, background: "transparent", border: `1px solid ${T.border}`, color: T.muted, cursor: "pointer", fontFamily: FM, fontSize: 11 }}><Icon name="close" size={12}/></button>
                          </div>
                        ) : (
                          <span
                            title={`Source: ${it.ratioSource}\nClick to override for ${it.ticker}`}
                            onClick={() => !done && !demoMode && setEditOverride({ ticker: it.ticker, value: String(it.impurityPct) })}
                            style={{
                              fontFamily: FM, fontSize: 11, fontVariantNumeric: "tabular-nums",
                              color: overrides[it.ticker] != null ? T.blue : T.muted,
                              cursor: done || demoMode ? "default" : "pointer",
                              borderBottom: done || demoMode ? "none" : `1px dashed ${T.border}`,
                            }}
                          >
                            {fmtPct(it.impurityPct)}
                            {overrides[it.ticker] != null && <span style={{ fontSize: 9, marginLeft: 3, color: T.blue }}>override</span>}
                          </span>
                        )}
                      </td>
                      {/* Purification owed */}
                      <td style={{ padding: `${T.s3} ${T.s4}`, textAlign: "right", borderBottom: `1px solid ${T.border}` }}>
                        <span style={{ fontFamily: FP, fontSize: 13, fontWeight: 600, color: done ? T.muted : T.gold, fontVariantNumeric: "tabular-nums" }}>{fmtUSD(it.purificationOwed)}</span>
                      </td>
                      {/* Status */}
                      <td style={{ padding: `${T.s3} ${T.s4}`, textAlign: "center", borderBottom: `1px solid ${T.border}` }}>
                        <Tag label={done ? "Purified" : "Pending"} color={done ? T.gain : T.gold} />
                      </td>
                      {/* Action */}
                      <td style={{ padding: `${T.s3} ${T.s4}`, textAlign: "center", borderBottom: `1px solid ${T.border}` }}>
                        {done ? (
                          <span style={{ fontFamily: FM, fontSize: 10, color: T.muted }}>—</span>
                        ) : (
                          <button
                            onClick={() => markPurified(it)}
                            disabled={!!busy[it.fingerprint] || demoMode}
                            style={{
                              padding: `4px ${T.s3}`, borderRadius: T.rSm,
                              fontFamily: FM, fontSize: 10, fontWeight: 600, letterSpacing: "0.04em",
                              background: `${T.gain}18`, border: `1px solid ${T.gain}40`, color: T.gain,
                              cursor: busy[it.fingerprint] || demoMode ? "not-allowed" : "pointer",
                              opacity: busy[it.fingerprint] ? 0.6 : 1,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {busy[it.fingerprint] ? "…" : "Mark Purified"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </BentoTile>

      {/* ── Help row ─────────────────────────────────────── */}
      <div style={{ fontFamily: FM, fontSize: 11, color: T.muted, lineHeight: 1.6, padding: `0 ${T.s1}` }}>
        <strong style={{ color: T.text }}>How purification works:</strong> Halal-screened funds may still earn a small portion of revenue from impermissible sources (interest, prohibited industries) below the AAOIFI 5% threshold. The impure fraction of any dividend you receive is computed as <em>dividend × impurity%</em> and must be donated to charity — not as a reward, but as purification of income. Click any impurity % to override it with the figure from the fund's latest annual report.
      </div>
    </div>
  );
}

function ZakatSadaqah({accounts=[],plaidAccounts=[],demoMode=false,bankBalance=0,onConnect,view="zakat"}){
  // The previous owner-only seed has been removed — it leaked the owner's
  // actual donation list into the JS bundle. Owner's existing donations are
  // already in Supabase user_state.mizan_sadaqah and hydrate on sign-in.
  // To restore from scratch, use the CSV Import button.
  const[sadaqah,setSadaqah]=useState(()=>{
    if(demoMode)return DEMO_SADAQAH;
    try{return JSON.parse(localStorage.getItem("mizan_sadaqah")||"[]");}catch{return[];}
  });
  // Re-sync when demo toggle flips
  useEffect(()=>{
    if(demoMode){setSadaqah(DEMO_SADAQAH);return;}
    try{setSadaqah(JSON.parse(localStorage.getItem("mizan_sadaqah")||"[]"));}catch{setSadaqah([]);}
  },[demoMode]);
  const[form,setForm]=useState({dt:new Date().toISOString().slice(0,10),org:"",method:"",account:"",amt:"",done:true});
  const[editingId,setEditingId]=useState(null);
  const[editDraft,setEditDraft]=useState({});
  const[importBusy,setImportBusy]=useState(false);
  const[importStatus,setImportStatus]=useState(null);
  const importRef=useRef(null);

  // Filter state
  const[fSearch,setFSearch]=useState("");
  const[fStatus,setFStatus]=useState("all");
  const[fMethod,setFMethod]=useState("all");
  const[fAccount,setFAccount]=useState("all");
  const[fYear,setFYear]=useState("all");

  const settings  = useZakatSettings();
  const liveNisab = useLiveNisab();
  const nisabUsd  = nisabValueFor(settings, liveNisab);
  // Surface live nisab values in the methodology buttons so the user can
  // see the current threshold without leaving the page. Fall back to the
  // static constants when /api/metals/spot isn't reachable.
  const liveGold   = liveNisab.source!=="static" ? liveNisab.nisab_gold_usd   : NISAB_GOLD_USD;
  const liveSilver = liveNisab.source!=="static" ? liveNisab.nisab_silver_usd : NISAB_SILVER_USD;

  const manualAssets=demoMode
    ?DEMO_MANUAL_ASSETS
    :(()=>{try{return JSON.parse(localStorage.getItem("mizan_manual_assets")||"[]");}catch{return[];}})();
  // The connected-account checklist (like the Goals account picker): every
  // brokerage / retirement / bank account the user can tick to include in — or
  // untick to exclude from — their zakatable assets.
  const connectedAccounts = zakatConnectedAccounts(accounts, plaidAccounts);

  // ── Comprehensive Zakat worksheet ──────────────────────────────────────
  // The editable worksheet is the source of truth for the manual side of the
  // calc. Connected brokerage + bank auto-fill their rows; the user enters
  // cash, metals, retirement, business assets, receivables and debts. On first
  // use the worksheet is seeded from any existing manual assets so nobody's
  // zakatable total drops silently. Math is the pure computeZakatWorksheet().
  const savedWs = useZakatWorksheet();
  const [wsDraft, setWsDraft] = useState(()=>effectiveZakatWorksheet(savedWs, manualAssets, demoMode));
  // Re-seed only when the demo toggle flips (read fresh state inside — never
  // key this on the manualAssets array identity, which changes every render).
  useEffect(()=>{
    const ma=demoMode?DEMO_MANUAL_ASSETS:(()=>{try{return JSON.parse(localStorage.getItem("mizan_manual_assets")||"[]");}catch{return[];}})();
    setWsDraft(effectiveZakatWorksheet(loadZakatWorksheet(), ma, demoMode));
  },[demoMode]);
  const onWsField=(key,val)=>{
    if(demoMode)return;
    const num=val===""?0:Math.max(0,+val||0);
    setWsDraft(d=>({...d,[key]:num}));
  };
  const persistWs=()=>{ if(!demoMode) saveZakatWorksheet(wsDraft); };
  const resetWs=()=>{
    if(demoMode)return;
    if(!window.confirm("Clear every worksheet figure back to zero?"))return;
    const blank={...DEFAULT_ZAKAT_WORKSHEET};
    setWsDraft(blank);
    saveZakatWorksheet(blank);
  };
  // Picker selection: unticked connected-account ids (stored in the worksheet
  // so the Overview tile reads the same choice). Default: every account counted.
  const excludedAccounts = new Set(Array.isArray(wsDraft.excludedAccounts)?wsDraft.excludedAccounts:[]);
  const toggleAccount=(id)=>{
    if(demoMode)return;
    setWsDraft(d=>{
      const cur=new Set(Array.isArray(d.excludedAccounts)?d.excludedAccounts:[]);
      if(cur.has(id))cur.delete(id); else cur.add(id);
      const next={...d,excludedAccounts:[...cur]};
      saveZakatWorksheet(next);
      return next;
    });
  };
  const connectedTotals = zakatSelectedTotals(connectedAccounts, excludedAccounts);
  // Connected credit cards the user ticked → deductible short-term debt.
  const creditAccounts = zakatCreditAccounts(plaidAccounts);
  const connectedLiabilities = zakatSelectedLiabilities(creditAccounts, excludedAccounts);
  // Connected investment wealth (brokerage + retirement + investments) feeds the
  // factor-scaled bucket; selected bank/depository accounts feed cash; ticked
  // credit-card balances feed short-term liabilities.
  const wsResult = computeZakatWorksheet({
    worksheet: wsDraft, settings, brokerageTotal: connectedTotals.invest, bankBalance: connectedTotals.cash, connectedLiabilities, nisab: nisabUsd,
  });
  const { assetsTotal, liabilitiesTotal, netZakatable, zakatDue, aboveNisab } = wsResult;
  const given           = sadaqah.filter(s=>s.done).reduce((a,b)=>a+(+b.amt||0),0);
  const pledged         = sadaqah.filter(s=>!s.done).reduce((a,b)=>a+(+b.amt||0),0);
  const fmtUSD          = v=>`$${(+v).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}`;

  // Date normalization for CSV imports. Accepts MM/DD/YYYY, MM/DD/YY, and
  // ISO formats; returns YYYY-MM-DD. "Pledge" / empty stays as-is so
  // outstanding entries keep their human label.
  const normalizeDt=s=>{
    if(!s)return"";
    const trimmed=s.trim();
    if(!trimmed)return"";
    // Already ISO?
    if(/^\d{4}-\d{2}-\d{2}/.test(trimmed))return trimmed.slice(0,10);
    // US format M/D/YYYY or M/D/YY
    const m=trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if(m){
      const yy=m[3].length===2?(+m[3]<70?2000+ +m[3]:1900+ +m[3]):+m[3];
      return`${yy}-${String(+m[1]).padStart(2,"0")}-${String(+m[2]).padStart(2,"0")}`;
    }
    // Non-date sentinel like "Pledge" — keep raw
    return trimmed;
  };

  // Unique method/account values for filter dropdowns
  const allMethods=[...new Set(sadaqah.map(s=>s.method).filter(Boolean))].sort();
  const allAccounts=[...new Set(sadaqah.map(s=>s.account).filter(Boolean))].sort();
  const allYears=[...new Set(sadaqah.map(s=>(s.dt||"").slice(0,4)).filter(y=>/^\d{4}$/.test(y)))].sort().reverse();

  // Apply filters
  const filtered=sadaqah.filter(s=>{
    if(fSearch&&!(s.org||"").toLowerCase().includes(fSearch.toLowerCase()))return false;
    if(fStatus==="given"&&!s.done)return false;
    if(fStatus==="pledged"&&s.done)return false;
    if(fMethod!=="all"&&s.method!==fMethod)return false;
    if(fAccount!=="all"&&s.account!==fAccount)return false;
    if(fYear!=="all"&&!(s.dt||"").startsWith(fYear))return false;
    return true;
  }).sort((a,b)=>(b.dt||"").localeCompare(a.dt||""));
  const filteredGiven  =filtered.filter(s=>s.done).reduce((a,b)=>a+(+b.amt||0),0);
  const filteredPledged=filtered.filter(s=>!s.done).reduce((a,b)=>a+(+b.amt||0),0);
  const hasActiveFilter=fSearch||fStatus!=="all"||fMethod!=="all"||fAccount!=="all"||fYear!=="all";

  const persist=arr=>{
    if(demoMode)return; // demo fixtures are read-only
    setSadaqah(arr);localStorage.setItem("mizan_sadaqah",JSON.stringify(arr));persistUserState("mizan_sadaqah",arr);
  };
  const add=e=>{
    e.preventDefault();
    if(demoMode||!form.org||!form.amt)return;
    persist([{id:`s-${Date.now()}`,...form,amt:+form.amt},...sadaqah]);
    setForm({...form,org:"",amt:""}); // keep method/account for next entry
  };
  const remove=id=>{
    if(demoMode)return;
    if(!window.confirm("Remove this donation entry?"))return;
    persist(sadaqah.filter(s=>s.id!==id));
  };
  const startEdit=row=>{
    if(demoMode)return;
    setEditingId(row.id);
    setEditDraft({
      dt:row.dt||"",
      org:row.org||"",
      method:row.method||"",
      account:row.account||"",
      amt:String(row.amt||""),
      done:!!row.done,
    });
  };
  const saveEdit=()=>{
    if(!editingId)return;
    persist(sadaqah.map(s=>s.id===editingId?{...s,...editDraft,amt:+editDraft.amt||0}:s));
    setEditingId(null);setEditDraft({});
  };
  const cancelEdit=()=>{setEditingId(null);setEditDraft({});};

  // CSV import: header-flexible. Recognizes:
  //   Date(s), Organization(/Name/Recipient/Charity), Method(/Payment),
  //   Account(/Source), Amount(/Amt/Total), Status(/Paid/Given/Pledged).
  // Dates accept M/D/YYYY and M/D/YY. Amounts strip $ + commas.
  // Fingerprint dedups by (dt, org, amount).
  const handleImport=async e=>{
    const file=e.target.files?.[0];
    if(!file||demoMode)return;
    setImportBusy(true);setImportStatus(null);
    try{
      const text=await file.text();
      const lines=text.split(/\r?\n/).filter(l=>l.trim());
      if(lines.length<2)throw new Error("CSV needs a header row + at least one donation row.");
      // Quote-aware splitter so "$2,000.00" doesn't break on the embedded comma.
      const split=l=>{
        const out=[];let cur="",inQ=false;
        for(const c of l){
          if(c==='"'){inQ=!inQ;continue;}
          if(c===","&&!inQ){out.push(cur);cur="";continue;}
          cur+=c;
        }
        out.push(cur);return out.map(s=>s.trim());
      };
      const header=split(lines[0]).map(h=>h.toLowerCase().trim());
      const idx={
        date:   header.findIndex(h=>h.includes("date")),
        org:    header.findIndex(h=>h.includes("org")||h.includes("recipient")||h.includes("charity")||h.includes("name")),
        method: header.findIndex(h=>h.includes("method")||h.includes("payment")||h.includes("pay")),
        acct:   header.findIndex(h=>h.includes("account")||h.includes("source")||h.includes("from")),
        amt:    header.findIndex(h=>h.includes("amount")||h.includes("amt")||h.includes("total")),
        stat:   header.findIndex(h=>h.includes("status")||h.includes("paid")||h.includes("given")||h.includes("pledged")),
      };
      if(idx.date<0||idx.org<0||idx.amt<0)throw new Error("CSV needs at least Date, Organization, and Amount columns.");
      const DONE=new Set(["given","done","paid","y","yes","true","1"]);
      const seen=new Set(sadaqah.map(s=>`${s.dt}|${(s.org||"").toLowerCase()}|${+s.amt||0}`));
      const fresh=[];let skipped=0;
      lines.slice(1).forEach((l,i)=>{
        const cells=split(l);
        const dt=normalizeDt(cells[idx.date]||"");
        const org=(cells[idx.org]||"").trim();
        const method=idx.method>=0?(cells[idx.method]||"").trim():"";
        const account=idx.acct>=0?(cells[idx.acct]||"").trim():"";
        const amtStr=(cells[idx.amt]||"").replace(/[$,]/g,"").trim();
        const amt=parseFloat(amtStr);
        if(!org||!Number.isFinite(amt))return;
        const stat=idx.stat>=0?(cells[idx.stat]||"").toLowerCase().trim():"given";
        const done=DONE.has(stat);
        const fp=`${dt}|${org.toLowerCase()}|${amt}`;
        if(seen.has(fp)){skipped++;return;}
        seen.add(fp);
        fresh.push({id:`s-${Date.now()}-${i}`,dt,org,method,account,amt,done});
      });
      if(fresh.length===0){setImportStatus({ok:true,msg:`No new rows — all ${skipped} entries were already in your history.`});}
      else{
        persist([...fresh,...sadaqah]);
        setImportStatus({ok:true,msg:`Added ${fresh.length} donation${fresh.length===1?"":"s"}${skipped>0?` (skipped ${skipped} duplicate${skipped===1?"":"s"})`:""}.`});
      }
    }catch(err){
      setImportStatus({ok:false,msg:err.message||"Import failed"});
    }finally{
      setImportBusy(false);
      if(importRef.current)importRef.current.value="";
      setTimeout(()=>setImportStatus(null),5500);
    }
  };

  const isEmpty=accounts.length===0&&manualAssets.length===0;

  return<div style={{display:"flex",flexDirection:"column",gap:T.s5}}>
    {/* ─── ROW 1 (Zakat view): Zakat hero, full width ─────── */}
    {view==="zakat"&&<BentoTile accent={T.gold} style={{
      background:`radial-gradient(circle at 100% 0%, ${T.gold}1F, transparent 55%), ${T.card}`,
      padding:`${T.s6} ${T.s6}`,
    }}>
      <div style={{fontFamily:FM,fontSize:10,color:T.gold,letterSpacing:"0.18em",fontWeight:600,marginBottom:T.s3}}>ZAKAT — {new Date().getFullYear()}</div>
      <div style={{fontFamily:FU,fontSize:38,fontWeight:700,color:aboveNisab?T.gold:T.muted,letterSpacing:"-0.03em",lineHeight:1,fontVariantNumeric:"tabular-nums"}}>{fmtUSD(zakatDue)}</div>
      <div style={{fontFamily:FM,fontSize:12,fontWeight:500,color:aboveNisab?T.gain:T.muted,marginTop:T.s2,letterSpacing:"-0.005em"}}>{aboveNisab?"● Above Nisab — Zakat obligatory":"Below Nisab — no Zakat owed"}</div>
      <div style={{fontFamily:FM,fontSize:10,color:T.dim,marginTop:T.s2,lineHeight:1.5,letterSpacing:"0.02em",maxWidth:460}}>An estimate using AAOIFI-aligned rules and live nisab. Zakat rulings vary by madhhab (hawl timing, asset treatment) — confirm your final amount with a qualified scholar.</div>
      <div style={{marginTop:T.s5,display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(140px, 1fr))",gap:T.s3}}>
        {[
          ["Total zakatable assets",fmtUSD(assetsTotal)],
          ["Less liabilities", `− ${fmtUSD(liabilitiesTotal)}`],
          ["Net zakatable worth",fmtUSD(netZakatable),true],
          [`Nisab (${settings.nisabStandard})`,fmtUSD(nisabUsd)],
        ].map(([l,v,b])=><div key={l}>
          <div style={{fontFamily:FM,fontSize:9,color:T.muted,letterSpacing:"0.14em",fontWeight:500,marginBottom:T.s1}}>{l}</div>
          <div style={{fontFamily:FP,fontSize:14,fontWeight:b?700:600,color:b?T.textHi:T.text,letterSpacing:"-0.01em",fontVariantNumeric:"tabular-nums"}}>{v}</div>
        </div>)}
      </div>
      {isEmpty&&<div style={{marginTop:T.s4,fontFamily:FP,fontSize:12,color:T.muted,lineHeight:1.55}}>Connect a brokerage or fill in the worksheet below to populate these figures.</div>}
    </BentoTile>}

    {/* ─── ROW 1 (Sadaqah view): donation summary ─────── */}
    {view==="sadaqah"&&<div className="bento-row" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:T.s4}}>
      <BentoTile accent={T.gain}>
        <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>GIVEN TOTAL</div>
        <div style={{fontFamily:FU,fontSize:28,fontWeight:700,color:T.textHi,letterSpacing:"-0.025em",fontVariantNumeric:"tabular-nums"}}>{fmtUSD(given)}</div>
        <div style={{fontFamily:FM,fontSize:11,fontWeight:500,color:T.gain,marginTop:T.s1}}>{sadaqah.filter(s=>s.done).length} donation{sadaqah.filter(s=>s.done).length===1?"":"s"}</div>
      </BentoTile>
      <BentoTile accent={T.gold}>
        <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>PLEDGED</div>
        <div style={{fontFamily:FU,fontSize:28,fontWeight:700,color:pledged>0?T.textHi:T.muted,letterSpacing:"-0.025em",fontVariantNumeric:"tabular-nums"}}>{fmtUSD(pledged)}</div>
        <div style={{fontFamily:FM,fontSize:11,fontWeight:500,color:T.gold,marginTop:T.s1}}>{sadaqah.filter(s=>!s.done).length} outstanding</div>
      </BentoTile>
    </div>}

    {/* ─── ROW 1.25 (Zakat view): Comprehensive worksheet ────────── */}
    {view==="zakat"&&<>
    {/* ─── ROW 1.25: Comprehensive worksheet ────────── */}
    {/* Every zakatable asset class, mirroring the scholar-designed calculators
        Mizan follows. Connected brokerage + bank auto-fill; the rest is
        user-entered. Persisted to mizan_zakat_worksheet (synced) and broadcast
        so the Overview ZAKAT DUE tile stays in lockstep. */}
    <CollapsibleTile title="ZAKAT WORKSHEET" subtitle="Every zakatable asset, minus what you owe" storageKey="zakat_worksheet" defaultOpen>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:T.s2,marginBottom:T.s3}}>
        <div style={{fontFamily:FP,fontSize:12,color:T.muted,lineHeight:1.5,maxWidth:520}}>
          Fill in what you own across the year. Amounts are stored privately and sync across your devices.
        </div>
        <div style={{display:"flex",alignItems:"center",gap:T.s2}}>
          {demoMode&&<span style={{fontFamily:FM,fontSize:10,color:T.blue,letterSpacing:"0.14em",fontWeight:600,padding:`2px ${T.s2}`,borderRadius:T.rSm,background:`${T.blue}14`,border:`1px solid ${T.blue}30`}}>DEMO — READ ONLY</span>}
          {!demoMode&&<button onClick={resetWs} className="btn-ghost" style={{fontSize:11,padding:`4px ${T.s3}`}}>Reset</button>}
        </div>
      </div>
      <ZakatWorksheet draft={wsDraft} onField={onWsField} onPersist={persistWs} result={wsResult} nisabUsd={nisabUsd} settings={settings} demoMode={demoMode}
        connectedAccounts={connectedAccounts} excludedAccounts={excludedAccounts} onToggleAccount={toggleAccount} connectedTotals={connectedTotals} creditAccounts={creditAccounts} connectedLiabilities={connectedLiabilities} onConnect={onConnect}/>
    </CollapsibleTile>

    {/* ─── ROW 1.5: Methodology selector ────────────── */}
    {/* Lets the user pick the scholarly basis for the calc:
        nisab standard (gold vs silver) and investment-zakat method
        (full market value vs 30% long-term rule). Saved to
        localStorage and broadcast so the Overview tile re-renders. */}
    <CollapsibleTile title="ZAKAT METHODOLOGY" subtitle="Nisab standard + investment-zakat method" storageKey="zakat_method">
      <div style={{display:"flex",flexWrap:"wrap",gap:T.s4,alignItems:"flex-start",justifyContent:"space-between"}}>
        <div style={{minWidth:0,flex:"1 1 240px"}}>
          <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>NISAB STANDARD</div>
          <div style={{display:"flex",gap:T.s2,flexWrap:"wrap"}}>
            {[
              {k:"silver",label:`Silver (${fmtUSD(liveSilver)})`,note:"612.36g · Hanafi"},
              {k:"gold",  label:`Gold (${fmtUSD(liveGold)})`,    note:"87.48g · Jumhur"},
            ].map(o=>(
              <button key={o.k}
                onClick={()=>!demoMode&&saveZakatSettings({...settings,nisabStandard:o.k})}
                disabled={demoMode}
                style={{
                  padding:`${T.s2} ${T.s3}`,
                  fontFamily:FM,fontSize:12,fontWeight:500,
                  textAlign:"left",
                  borderRadius:T.rSm,
                  border:`1px solid ${settings.nisabStandard===o.k?T.gold:T.border}`,
                  background:settings.nisabStandard===o.k?`${T.gold}1A`:"transparent",
                  color:settings.nisabStandard===o.k?T.gold:T.text,
                  cursor:demoMode?"not-allowed":"pointer",
                  opacity:demoMode?0.55:1,
                }}>
                <div>{o.label}</div>
                <div style={{fontSize:10,color:T.muted,marginTop:2}}>{o.note}</div>
              </button>
            ))}
          </div>
        </div>
        <div style={{minWidth:0,flex:"1 1 240px"}}>
          <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>INVESTMENT ZAKAT METHOD</div>
          <div style={{display:"flex",gap:T.s2,flexWrap:"wrap"}}>
            {[
              {k:"full",       label:"Full market value",    note:"Default · scholar consensus"},
              {k:"longterm_30",label:"Long-term (30% rule)",note:"AAOIFI · buy & hold"},
            ].map(o=>(
              <button key={o.k}
                onClick={()=>!demoMode&&saveZakatSettings({...settings,investmentMethod:o.k})}
                disabled={demoMode}
                style={{
                  padding:`${T.s2} ${T.s3}`,
                  fontFamily:FM,fontSize:12,fontWeight:500,
                  textAlign:"left",
                  borderRadius:T.rSm,
                  border:`1px solid ${settings.investmentMethod===o.k?T.gold:T.border}`,
                  background:settings.investmentMethod===o.k?`${T.gold}1A`:"transparent",
                  color:settings.investmentMethod===o.k?T.gold:T.text,
                  cursor:demoMode?"not-allowed":"pointer",
                  opacity:demoMode?0.55:1,
                }}>
                <div>{o.label}</div>
                <div style={{fontSize:10,color:T.muted,marginTop:2}}>{o.note}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
      <div style={{marginTop:T.s3,fontFamily:FM,fontSize:11,color:T.muted,lineHeight:1.5}}>
        Silver nisab is more inclusive (lower threshold); gold is the majority view. <strong style={{color:T.text}}>Full market value</strong> is the default — it matches the scholar-designed calculators Mizan follows, which count shares and retirement at full resale/vested value. The optional <strong style={{color:T.text}}>30% rule</strong> treats public-equity holdings as ~30% zakatable (approximating the cash/receivables/inventory share of company assets vs. exempt fixed assets) — a lighter basis some fatwa councils allow for long-term buy-and-hold investors.
      </div>
      <div style={{marginTop:T.s2,fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.05em"}}>
        {liveNisab.source==="static"
          ? "Spot prices unavailable — using static fallback values."
          : `Live spot via ${liveNisab.source} · refreshed ${liveNisab.refreshed_at?new Date(liveNisab.refreshed_at).toLocaleString():"recently"}`}
      </div>
    </CollapsibleTile>

    {/* ─── ROW 1.75: Dividend Purification ─────────── */}
    {/* Gated for new users: purification only has meaning once dividends from
        connected holdings exist. Hidden entirely until a brokerage is linked
        (or in demo) to keep the Zakat tab uncluttered for first-time users. */}
    {(accounts.length>0||demoMode)&&<BentoTile accent={T.gold}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:T.s2,marginBottom:T.s4}}>
        <div style={{display:"flex",alignItems:"center",gap:T.s3}}>
          <Icon name="leaf" size={20} color={T.gold}/>
          <div>
            <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:2}}>DIVIDEND PURIFICATION</div>
            <div style={{fontFamily:FP,fontSize:12,color:T.muted}}>AAOIFI-compliant — purify impure income from halal-screened funds</div>
          </div>
        </div>
        {demoMode&&<span style={{fontFamily:FM,fontSize:10,color:T.blue,letterSpacing:"0.14em",fontWeight:600,padding:`2px ${T.s2}`,borderRadius:T.rSm,background:`${T.blue}14`,border:`1px solid ${T.blue}30`}}>DEMO — READ ONLY</span>}
      </div>
      <PurificationPanel demoMode={demoMode} onPurified={()=>{
        // Refresh sadaqah total from localStorage so the donation tally updates
        try{setSadaqah(JSON.parse(localStorage.getItem("mizan_sadaqah")||"[]"))}catch{}
      }}/>
    </BentoTile>}
    </>}

    {/* ─── Sadaqah view: charity log (log entry + filter + history) ─── */}
    {view==="sadaqah"&&<>
    <CollapsibleTile flat title="SADAQAH — CHARITY LOG" subtitle="Log donations, track pledges & view history" storageKey="zakat_sadaqah">
    <BentoTile>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:T.s2,marginBottom:T.s3}}>
        <div style={{display:"flex",alignItems:"center",gap:T.s2,flexWrap:"wrap"}}>
          <span style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600}}>LOG A DONATION</span>
          {demoMode&&<span style={{fontFamily:FM,fontSize:10,color:T.blue,letterSpacing:"0.14em",fontWeight:600,padding:`2px ${T.s2}`,borderRadius:T.rSm,background:`${T.blue}14`,border:`1px solid ${T.blue}30`}}>DEMO — READ ONLY</span>}
        </div>
        <div style={{display:"flex",gap:T.s2,alignItems:"center"}}>
          <input ref={importRef} type="file" accept=".csv,text/csv" onChange={handleImport} style={{display:"none"}}/>
          <button onClick={()=>importRef.current?.click()} disabled={importBusy||demoMode} className="btn-ghost" title={demoMode?"Disable demo mode in Settings to import":"Import CSV with columns: Date, Organization, Method, Account, Amount, Status"}>{importBusy?"Importing…":"Import CSV"}</button>
        </div>
      </div>
      <form onSubmit={add} className="mz-form-row" style={{display:"grid",gridTemplateColumns:"130px 1fr 120px 110px 110px 100px auto",gap:T.s2,alignItems:"end",opacity:demoMode?0.55:1,pointerEvents:demoMode?"none":undefined}}>
        <input type="date" value={form.dt} onChange={e=>setForm({...form,dt:e.target.value})} className="field" disabled={demoMode}/>
        <input placeholder="Organization" value={form.org} onChange={e=>setForm({...form,org:e.target.value})} className="field" disabled={demoMode}/>
        <input list="dn-methods" placeholder="Method" value={form.method} onChange={e=>setForm({...form,method:e.target.value})} className="field" disabled={demoMode}/>
        <input list="dn-accts" placeholder="Account" value={form.account} onChange={e=>setForm({...form,account:e.target.value})} className="field" disabled={demoMode}/>
        <input type="number" step="0.01" placeholder="Amount" value={form.amt} onChange={e=>setForm({...form,amt:e.target.value})} className="field" style={{fontVariantNumeric:"tabular-nums"}} disabled={demoMode}/>
        <select value={form.done?"done":"pledged"} onChange={e=>setForm({...form,done:e.target.value==="done"})} className="field" style={{cursor:"pointer"}} disabled={demoMode}>
          <option value="done">Given</option>
          <option value="pledged">Pledged</option>
        </select>
        <button type="submit" className="btn-primary" disabled={demoMode}>Add</button>
      </form>
      <datalist id="dn-methods">{["Debit Card","Credit Card","Zelle","Cash","Check","Wire","Crypto","TBD",...allMethods].filter((v,i,a)=>a.indexOf(v)===i).map(m=><option key={m} value={m}/>)}</datalist>
      <datalist id="dn-accts">{["Checking","Savings","Brokerage","Cash",...allAccounts].filter((v,i,a)=>a.indexOf(v)===i).map(m=><option key={m} value={m}/>)}</datalist>
      {importStatus&&<div style={{marginTop:T.s3,padding:`${T.s2} ${T.s3}`,borderRadius:T.rMd,fontFamily:FM,fontSize:11,background:importStatus.ok?T.gainBg:T.lossBg,border:`1px solid ${(importStatus.ok?T.gain:T.loss)+"30"}`,color:importStatus.ok?T.gain:T.loss,lineHeight:1.5}}>{importStatus.ok?ICON_OK:ICON_NO}{importStatus.msg}</div>}
    </BentoTile>

    {/* ─── ROW 3: Filters ──────────────────────────── */}
    <BentoTile>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:T.s3,flexWrap:"wrap",gap:T.s2}}>
        <span style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600}}>FILTER DONATIONS</span>
        {hasActiveFilter&&<button onClick={()=>{setFSearch("");setFStatus("all");setFMethod("all");setFAccount("all");setFYear("all");}} className="btn-ghost" style={{fontSize:10,padding:`4px ${T.s3}`}}>Clear</button>}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 120px 140px 140px 120px",gap:T.s2}}>
        <input placeholder="Search organization…" value={fSearch} onChange={e=>setFSearch(e.target.value)} className="field"/>
        <select value={fStatus} onChange={e=>setFStatus(e.target.value)} className="field" style={{cursor:"pointer"}}>
          <option value="all">All status</option>
          <option value="given">Given</option>
          <option value="pledged">Pledged</option>
        </select>
        <select value={fMethod} onChange={e=>setFMethod(e.target.value)} className="field" style={{cursor:"pointer"}}>
          <option value="all">All methods</option>
          {allMethods.map(m=><option key={m} value={m}>{m}</option>)}
        </select>
        <select value={fAccount} onChange={e=>setFAccount(e.target.value)} className="field" style={{cursor:"pointer"}}>
          <option value="all">All accounts</option>
          {allAccounts.map(a=><option key={a} value={a}>{a}</option>)}
        </select>
        <select value={fYear} onChange={e=>setFYear(e.target.value)} className="field" style={{cursor:"pointer"}}>
          <option value="all">All years</option>
          {allYears.map(y=><option key={y} value={y}>{y}</option>)}
        </select>
      </div>
    </BentoTile>

    {/* ─── ROW 4: Donation history ─────────────────── */}
    <BentoTile style={{padding:0,overflow:"hidden"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:`${T.s4} ${T.s5}`,borderBottom:`1px solid ${T.border}`,flexWrap:"wrap",gap:T.s2}}>
        <span style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600}}>DONATION HISTORY{hasActiveFilter?<span style={{color:T.blue,marginLeft:T.s2}}>· {filtered.length} of {sadaqah.length}</span>:""}</span>
        <div style={{display:"flex",gap:T.s2,alignItems:"center"}}>
          <span style={{fontFamily:FM,fontSize:11,color:T.muted,fontVariantNumeric:"tabular-nums"}}>{fmtUSD(hasActiveFilter?filteredGiven:given)} given{(hasActiveFilter?filteredPledged:pledged)>0?` · ${fmtUSD(hasActiveFilter?filteredPledged:pledged)} pledged`:""}</span>
          <button
            onClick={()=>downloadCSV(
              filtered.map(s=>({
                Date:s.dt||"",
                Organization:s.org||"",
                Method:s.method||"",
                Account:s.account||"",
                Amount:+s.amt||0,
                Status:s.done?"Given":"Pledged",
              })),
              `mizan-donations-${new Date().toISOString().slice(0,10)}.csv`,
            )}
            disabled={filtered.length===0}
            title={filtered.length===0?"No donations to export":"Download donations as CSV"}
            style={{padding:`4px ${T.s2}`,borderRadius:T.rSm,fontFamily:FM,fontSize:10,fontWeight:600,letterSpacing:"0.06em",background:"transparent",border:`1px solid ${T.border}`,color:filtered.length===0?T.dim:T.muted,cursor:filtered.length===0?"not-allowed":"pointer"}}
          >CSV ↓</button>
        </div>
      </div>
      {sadaqah.length===0
        ?<div style={{padding:`${T.s8} ${T.s5}`,textAlign:"center",fontFamily:FP,fontSize:13,color:T.muted}}>No donations logged yet. Add one with the form above, or import a CSV.</div>
        :filtered.length===0
          ?<div style={{padding:`${T.s8} ${T.s5}`,textAlign:"center",fontFamily:FP,fontSize:13,color:T.muted}}>No donations match these filters. <button onClick={()=>{setFSearch("");setFStatus("all");setFMethod("all");setFAccount("all");setFYear("all");}} style={{background:"none",border:"none",color:T.blue,cursor:"pointer",textDecoration:"underline",font:"inherit"}}>Clear filters</button></div>
          :<Tbl cols={[
            {l:"Date",        r_:r=>editingId===r.id
              ?<input type="date" value={editDraft.dt} onChange={e=>setEditDraft({...editDraft,dt:e.target.value})} className="field" style={{fontSize:11,padding:`4px ${T.s2}`}}/>
              :<span style={{fontFamily:FM,fontSize:11,color:T.muted,fontVariantNumeric:"tabular-nums"}}>{r.dt||"—"}</span>},
            {l:"Organization",r_:r=>editingId===r.id
              ?<input value={editDraft.org} onChange={e=>setEditDraft({...editDraft,org:e.target.value})} className="field" style={{fontSize:12,padding:`4px ${T.s2}`}}/>
              :<span style={{fontFamily:FP,fontSize:13,color:T.text,letterSpacing:"-0.005em"}}>{r.org}</span>},
            {l:"Method",mobileHide:true,r_:r=>editingId===r.id
              ?<input list="dn-methods" value={editDraft.method} onChange={e=>setEditDraft({...editDraft,method:e.target.value})} className="field" style={{fontSize:11,padding:`4px ${T.s2}`}}/>
              :<span style={{fontFamily:FM,fontSize:11,color:T.muted}}>{r.method||"—"}</span>},
            {l:"Account",mobileHide:true,r_:r=>editingId===r.id
              ?<input list="dn-accts" value={editDraft.account} onChange={e=>setEditDraft({...editDraft,account:e.target.value})} className="field" style={{fontSize:11,padding:`4px ${T.s2}`}}/>
              :<span style={{fontFamily:FM,fontSize:11,color:T.muted}}>{r.account||"—"}</span>},
            {l:"Amount",r:true,r_:r=>editingId===r.id
              ?<input type="number" step="0.01" value={editDraft.amt} onChange={e=>setEditDraft({...editDraft,amt:e.target.value})} className="field" style={{fontSize:12,padding:`4px ${T.s2}`,fontVariantNumeric:"tabular-nums",textAlign:"right"}}/>
              :<span style={{fontFamily:FP,fontSize:13,fontWeight:600,color:T.gold,letterSpacing:"-0.005em",fontVariantNumeric:"tabular-nums"}}>{fmtUSD(r.amt)}</span>},
            {l:"Status",      r_:r=>editingId===r.id
              ?<select value={editDraft.done?"done":"pledged"} onChange={e=>setEditDraft({...editDraft,done:e.target.value==="done"})} className="field" style={{fontSize:10,padding:`4px ${T.s2}`,cursor:"pointer"}}>
                <option value="done">Given</option>
                <option value="pledged">Pledged</option>
              </select>
              :<Tag label={r.done?"Given":"Pledged"} color={r.done?T.gain:T.gold}/>},
            {l:"",r:true,     r_:r=>demoMode
              ?<span style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.04em"}}>—</span>
              :editingId===r.id
              ?<div style={{display:"flex",gap:T.s1,justifyContent:"flex-end"}}>
                <button onClick={saveEdit} style={{padding:`3px ${T.s2}`,borderRadius:T.rSm,background:`${T.gain}18`,border:`1px solid ${T.gain}40`,color:T.gain,cursor:"pointer",fontFamily:FM,fontSize:10,fontWeight:600,letterSpacing:"0.04em"}}>SAVE</button>
                <button onClick={cancelEdit} style={{padding:`3px ${T.s2}`,borderRadius:T.rSm,background:"transparent",border:`1px solid ${T.border}`,color:T.muted,cursor:"pointer",fontFamily:FM,fontSize:10,letterSpacing:"0.04em"}}>×</button>
              </div>
              :<div style={{display:"flex",gap:T.s1,justifyContent:"flex-end"}}>
                <button onClick={()=>startEdit(r)} title="Edit this entry" style={{padding:`3px ${T.s2}`,borderRadius:T.rSm,background:"transparent",border:`1px solid ${T.border}`,color:T.muted,cursor:"pointer",fontFamily:FM,fontSize:10,letterSpacing:"0.04em"}}>EDIT</button>
                <button onClick={()=>remove(r.id)} title="Remove this entry" style={{padding:`3px ${T.s2}`,borderRadius:T.rSm,background:"transparent",border:`1px solid ${T.loss}30`,color:T.loss,cursor:"pointer",fontFamily:FM,fontSize:11}}><Icon name="close" size={12}/></button>
              </div>},
          ]} rows={filtered}/>}
    </BentoTile>
    </CollapsibleTile>
    </>}
  </div>;
}

/* ─── REBALANCER ─────────────────────────────────────── */
// Target allocation editor + drift table + trade suggestions.
// Suggestions stash a "pending order" into localStorage and switch the
// user to the Trade tab; TradeBot reads + clears it on mount.
function Rebalancer({holdings=[],snapAccounts=[],onNav}){
  const[targets,setTargets]=useState(()=>{
    try{
      const raw=JSON.parse(localStorage.getItem("mizan_rebalance_targets")||"null");
      if(raw&&typeof raw==="object")return{...DEFAULT_REBALANCE_TARGETS,...raw};
    }catch{}
    return DEFAULT_REBALANCE_TARGETS;
  });
  const[halalOnly,setHalalOnly]=useState(()=>{
    try{return localStorage.getItem("mizan_rebalance_halal")==="1";}catch{return false;}
  });

  const saveTargets=t=>{
    setTargets(t);
    try{localStorage.setItem("mizan_rebalance_targets",JSON.stringify(t));}catch{}
    persistUserState("mizan_rebalance_targets",t);
  };
  const toggleHalal=()=>{
    const next=!halalOnly;setHalalOnly(next);
    try{localStorage.setItem("mizan_rebalance_halal",next?"1":"0");}catch{}
  };

  // ── Current allocation ────────────────────────────────────────────
  const cashTotal=snapAccounts.reduce((s,a)=>s+(a.cash||0),0);
  const byClass={us_equity:0,global_equity:0,sukuk:0,reit:0,cash:cashTotal,other:0};
  const positionsByClass={us_equity:[],global_equity:[],sukuk:[],reit:[],other:[]};
  holdings.forEach(h=>{
    const cls=classifyTicker(h.tk);
    const value=mv(h);
    byClass[cls]=(byClass[cls]||0)+value;
    if(positionsByClass[cls])positionsByClass[cls].push(h);
  });
  const total=Object.values(byClass).reduce((s,v)=>s+v,0);
  // The 5 targetable classes always reference the *rebalanceable* slice
  // (excludes "Other" — crypto, bond funds, etc. — which the user manages
  // out-of-band). This keeps the math exact: when each class hits its
  // target, the 5 of them sum to 100% of (NAV − Other), and Other stays
  // visible as informational at the bottom of the table.
  const targetedTotal=Math.max(0,total-byClass.other);
  const currentPct=k=>targetedTotal>0?(byClass[k]/targetedTotal)*100:0;

  // ── Drift ─────────────────────────────────────────────────────────
  const targetSum=ASSET_CLASSES.reduce((s,c)=>s+(+targets[c.key]||0),0);
  const driftRows=ASSET_CLASSES.map(c=>{
    const tgt=+targets[c.key]||0;
    const cur=currentPct(c.key);
    const drift=cur-tgt;
    const absDrift=Math.abs(drift);
    const status=absDrift<=5?"ok":absDrift<=10?"warn":"alert";
    const dollarDrift=(drift/100)*targetedTotal;
    return{cls:c,tgt,cur,drift,absDrift,status,dollarDrift,currentValue:byClass[c.key]};
  });

  // ── Trade suggestions ─────────────────────────────────────────────
  // 1. If halalOnly: sell every haram position first (full liquidation).
  // 2. For each over-target class: sell pro-rata across holdings.
  // 3. For each under-target class: buy the class proxy (halal proxy if toggled).
  const haramHoldings=holdings.filter(h=>h.sh_==="haram");
  const fmt$=v=>`$${(+v).toLocaleString("en-US",{minimumFractionDigits:0,maximumFractionDigits:0})}`;

  const suggestions=[];
  if(halalOnly){
    haramHoldings.forEach(h=>{
      suggestions.push({
        kind:"haram",
        side:"sell",
        sym:h.tk,
        name:h.nm||h.tk,
        qty:Math.floor(h.sh),
        price:h.px,
        amount:Math.floor(h.sh)*h.px,
        reason:`Sharia non-compliant — full liquidation`,
        cls:classifyTicker(h.tk),
      });
    });
  }
  driftRows.forEach(r=>{
    if(r.cls.key==="cash")return; // cash is a residual, not actively traded
    const dollarMove=Math.abs(r.dollarDrift);
    if(dollarMove<500)return; // ignore noise under $500
    if(r.drift>0){
      // OVER target — sell pro-rata across class positions (excluding haram
      // we already liquidated, since they're gone in the halalOnly branch).
      const pool=positionsByClass[r.cls.key].filter(h=>!halalOnly||h.sh_!=="haram");
      const poolValue=pool.reduce((s,h)=>s+mv(h),0);
      if(poolValue<=0)return;
      pool.forEach(h=>{
        const sliceValue=(mv(h)/poolValue)*dollarMove;
        const shares = h.px > 0 ? Math.floor(sliceValue / h.px) : 0;
        if(shares<=0)return;
        suggestions.push({
          kind:"drift",
          side:"sell",
          sym:h.tk,
          name:h.nm||h.tk,
          qty:shares,
          price:h.px,
          amount:shares*h.px,
          reason:`${r.cls.label} +${r.drift.toFixed(1)}% over target — trim`,
          cls:r.cls.key,
        });
      });
    }else if(r.drift<0){
      // UNDER target — buy the class proxy
      const proxy=CLASS_PROXY[r.cls.key];
      if(!proxy)return;
      const sym=halalOnly?proxy.halal:proxy.default;
      // Use the live price if we hold the proxy already, else fall back to a
      // class-typical estimate. Defaults below are rough; user will see real
      // execution price at order time.
      const heldProxy=holdings.find(h=>h.tk===sym);
      const estPx=heldProxy?heldProxy.px:(r.cls.key==="sukuk"?22:r.cls.key==="reit"?86:r.cls.key==="global_equity"?64:520);
      const shares=Math.floor(dollarMove/estPx);
      if(shares<=0)return;
      suggestions.push({
        kind:"drift",
        side:"buy",
        sym,
        name:`${r.cls.label} proxy`,
        qty:shares,
        price:estPx,
        amount:shares*estPx,
        reason:`${r.cls.label} ${r.drift.toFixed(1)}% under target — add`,
        cls:r.cls.key,
      });
    }
  });

  // Trade tab is gone in the consolidated nav; in-app Order Ticket is
  // Coming Soon. Best-effort "copy" now writes the ticker to the
  // clipboard so the user can paste it directly into their broker UI.
  const copyToOrder=s=>{
    const text=`${s.side?.toUpperCase()||""} ${s.qty||""} ${s.sym||""}`.trim();
    try{
      if(typeof navigator!=="undefined"&&navigator.clipboard?.writeText){
        navigator.clipboard.writeText(text).catch(()=>{});
      }
      localStorage.setItem("mizan_pending_order",JSON.stringify({
        sym:s.sym,side:s.side,qty:String(s.qty),at:Date.now(),
      }));
    }catch{}
  };

  const haramSellTotal=suggestions.filter(s=>s.kind==="haram").reduce((s,r)=>s+r.amount,0);
  const sellTotal=suggestions.filter(s=>s.side==="sell").reduce((s,r)=>s+r.amount,0);
  const buyTotal=suggestions.filter(s=>s.side==="buy").reduce((s,r)=>s+r.amount,0);

  // Sum validation status for the editor
  const sumOK=Math.abs(targetSum-100)<0.01;

  return<div style={{display:"flex",flexDirection:"column",gap:T.s5}}>
    {/* ─── ROW 1: Hero + halal toggle ─────────────────────────── */}
    <div className="bento-row" style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:T.s4}}>
      <BentoTile style={{
        background:`radial-gradient(circle at 0% 0%, ${T.blue}15, transparent 55%), ${T.card}`,
      }}>
        <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>PORTFOLIO REBALANCE</div>
        <div style={{fontFamily:FU,fontSize:34,fontWeight:700,color:T.textHi,letterSpacing:"-0.03em",lineHeight:1,fontVariantNumeric:"tabular-nums"}}>{fmt$(targetedTotal)}</div>
        <div style={{fontFamily:FM,fontSize:12,color:T.muted,marginTop:T.s2}}>rebalanceable · total NAV {fmt$(total)} {byClass.other>0?<>· <span style={{color:T.dim}}>{fmt$(byClass.other)} held outside</span></>:null}</div>
        <p style={{fontFamily:FP,fontSize:13,color:T.muted,margin:`${T.s4} 0 0`,lineHeight:1.55,maxWidth:560}}>
          Set target weights per asset class. Mizan compares to your live allocation, flags drift, and proposes trades — one click pre-fills the Order Ticket.
        </p>
      </BentoTile>
      <BentoTile accent={halalOnly?T.gold:undefined} style={halalOnly?{background:`linear-gradient(135deg, ${T.gold}10, transparent 60%), ${T.card}`}:undefined}>
        <div style={{fontFamily:FM,fontSize:10,color:halalOnly?T.gold:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>HALAL-ONLY REBALANCE</div>
        <p style={{fontFamily:FP,fontSize:12,color:T.muted,margin:`0 0 ${T.s3}`,lineHeight:1.5}}>
          Liquidates every non-compliant holding first, then buys only screened halal proxies (SPUS, HLAL, SPSK, SPRE).
        </p>
        <button onClick={toggleHalal} style={{
          padding:`9px ${T.s3}`,borderRadius:T.rMd,fontFamily:FM,fontSize:11,fontWeight:600,letterSpacing:"0.06em",
          background:halalOnly?T.gold:"transparent",border:`1px solid ${halalOnly?T.gold:T.border}`,
          color:halalOnly?"#000":T.text,cursor:"pointer",width:"100%",
        }}>{halalOnly?"Halal Mode: ON":"Halal Mode: OFF"}</button>
        {halalOnly&&haramHoldings.length>0&&<div style={{marginTop:T.s3,padding:`${T.s2} ${T.s3}`,borderRadius:T.rSm,background:`${T.loss}10`,border:`1px solid ${T.loss}30`,fontFamily:FM,fontSize:10,color:T.loss,lineHeight:1.5}}>
          {haramHoldings.length} haram position{haramHoldings.length===1?"":"s"} queued for liquidation ({fmt$(haramSellTotal)})
        </div>}
      </BentoTile>
    </div>

    {/* ─── ROW 2: Targets editor ───────────────────────────────── */}
    <BentoTile>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:T.s3,flexWrap:"wrap",gap:T.s2}}>
        <span style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600}}>TARGET ALLOCATION</span>
        <div style={{display:"flex",alignItems:"center",gap:T.s2}}>
          <span style={{fontFamily:FM,fontSize:11,color:sumOK?T.gain:T.loss,fontVariantNumeric:"tabular-nums"}}>Sum: {targetSum.toFixed(1)}%{!sumOK&&" — must equal 100%"}</span>
          <button onClick={()=>saveTargets(DEFAULT_REBALANCE_TARGETS)} className="btn-ghost" style={{fontSize:10}}>Reset defaults</button>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:T.s3}}>
        {ASSET_CLASSES.map(c=><div key={c.key} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:T.rMd,padding:`${T.s3} ${T.s3}`}}>
          <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.12em",fontWeight:500,marginBottom:T.s2}}>{c.label.toUpperCase()}</div>
          <div style={{display:"flex",alignItems:"center",gap:T.s2}}>
            <input
              type="number" min={0} max={100} step={1}
              value={targets[c.key]??0}
              onChange={e=>saveTargets({...targets,[c.key]:Math.max(0,Math.min(100,+e.target.value||0))})}
              className="field" style={{fontSize:18,fontWeight:700,letterSpacing:"-0.01em",fontVariantNumeric:"tabular-nums",width:"100%"}}
            />
            <span style={{fontFamily:FM,fontSize:14,color:T.muted,fontWeight:600}}>%</span>
          </div>
          <div style={{fontFamily:FM,fontSize:10,color:T.muted,marginTop:T.s2,fontVariantNumeric:"tabular-nums"}}>Target value {fmt$((+targets[c.key]||0)/100*targetedTotal)}</div>
        </div>)}
      </div>
    </BentoTile>

    {/* ─── ROW 3: Drift table ──────────────────────────────────── */}
    <BentoTile style={{padding:0,overflow:"hidden"}}>
      <div style={{padding:`${T.s4} ${T.s5}`,borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:T.s2}}>
        <span style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600}}>DRIFT ANALYSIS</span>
        <span style={{fontFamily:FM,fontSize:11,color:T.muted}}>green ≤ 5% · yellow ≤ 10% · red &gt; 10%</span>
      </div>
      <Tbl cols={[
        {l:"Asset Class",r_:r=><span style={{fontFamily:FP,fontSize:13,color:T.text,letterSpacing:"-0.005em"}}>{r.cls.label}</span>},
        {l:"Target %",r:true,r_:r=><span style={{fontFamily:FP,fontSize:13,color:T.text,fontVariantNumeric:"tabular-nums"}}>{r.tgt.toFixed(1)}%</span>},
        {l:"Current %",r:true,r_:r=><span style={{fontFamily:FP,fontSize:13,color:T.textHi,fontWeight:600,fontVariantNumeric:"tabular-nums"}}>{r.cur.toFixed(1)}%</span>},
        {l:"Current $",r:true,r_:r=><span style={{fontFamily:FM,fontSize:12,color:T.muted,fontVariantNumeric:"tabular-nums"}}>{fmt$(r.currentValue)}</span>},
        {l:"Drift",r:true,r_:r=><span style={{fontFamily:FP,fontSize:13,fontWeight:600,fontVariantNumeric:"tabular-nums",color:r.drift>0?T.gain:r.drift<0?T.loss:T.muted}}>{r.drift>0?"+":""}{r.drift.toFixed(1)}%</span>},
        {l:"$ Move",r:true,r_:r=><span style={{fontFamily:FM,fontSize:12,color:T.muted,fontVariantNumeric:"tabular-nums"}}>{r.drift>0?"−":"+"}{fmt$(Math.abs(r.dollarDrift))}</span>},
        {l:"Status",r_:r=><Tag label={r.status==="ok"?"OK":r.status==="warn"?"Warning":"Alert"} color={r.status==="ok"?T.gain:r.status==="warn"?T.gold:T.loss}/>},
      ]} rows={driftRows}/>
      {byClass.other>0&&<div style={{padding:`${T.s3} ${T.s5}`,background:T.surface,borderTop:`1px solid ${T.border}`,fontFamily:FM,fontSize:11,color:T.muted,lineHeight:1.5}}>
        Other / uncategorized (crypto, bonds, etc.): <span style={{color:T.text,fontWeight:600}}>{fmt$(byClass.other)}</span> · {(total>0?byClass.other/total*100:0).toFixed(1)}% of total NAV — held outside the rebalanceable slice. Targets above apply to the remaining <span style={{color:T.text,fontWeight:600}}>{fmt$(targetedTotal)}</span>.
      </div>}
    </BentoTile>

    {/* ─── ROW 4: Trade suggestions ────────────────────────────── */}
    <BentoTile style={{padding:0,overflow:"hidden"}}>
      <div style={{padding:`${T.s4} ${T.s5}`,borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:T.s2}}>
        <span style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600}}>SUGGESTED TRADES{suggestions.length>0&&<span style={{color:T.blue,marginLeft:T.s2}}>· {suggestions.length}</span>}</span>
        <span style={{fontFamily:FM,fontSize:11,color:T.muted,fontVariantNumeric:"tabular-nums"}}>
          Sell {fmt$(sellTotal)} · Buy {fmt$(buyTotal)} · Est. cost $0 (commission-free)
        </span>
      </div>
      {suggestions.length===0
        ?<div style={{padding:`${T.s8} ${T.s5}`,textAlign:"center",fontFamily:FP,fontSize:13,color:T.muted}}>
          {total===0
            ?"Connect a brokerage or enable demo mode to see rebalance suggestions."
            :sumOK
              ?"No trades needed — every class is within tolerance of its target."
              :"Set targets that sum to 100% to generate suggestions."}
        </div>
        :<Tbl cols={[
          {l:"Action",r_:r=><Tag label={r.side.toUpperCase()} color={r.side==="sell"?T.loss:T.gain}/>},
          {l:"Symbol",r_:r=><span style={{fontFamily:FP,fontSize:13,fontWeight:600,color:T.textHi,letterSpacing:"-0.005em"}}>{r.sym}</span>},
          {l:"Qty",r:true,r_:r=><span style={{fontFamily:FP,fontSize:13,fontVariantNumeric:"tabular-nums",color:T.text}}>{r.qty.toLocaleString()}</span>},
          {l:"~Price",r:true,r_:r=><span style={{fontFamily:FM,fontSize:12,color:T.muted,fontVariantNumeric:"tabular-nums"}}>${r.price.toFixed(2)}</span>},
          {l:"~Amount",r:true,r_:r=><span style={{fontFamily:FP,fontSize:13,fontWeight:600,color:r.side==="sell"?T.loss:T.gain,fontVariantNumeric:"tabular-nums"}}>{fmt$(r.amount)}</span>},
          {l:"Reason",r_:r=><span style={{fontFamily:FM,fontSize:11,color:T.muted,lineHeight:1.4}}>{r.reason}</span>},
          {l:"",r:true,r_:r=><button
            onClick={()=>copyToOrder(r)}
            style={{padding:`5px ${T.s3}`,borderRadius:T.rSm,background:`${T.blue}18`,border:`1px solid ${T.blue}40`,color:T.blue,cursor:"pointer",fontFamily:FM,fontSize:10,fontWeight:600,letterSpacing:"0.04em",whiteSpace:"nowrap"}}
            title="Copy this trade to the clipboard — paste into your broker"
          >COPY</button>},
        ]} rows={suggestions}/>}
    </BentoTile>
  </div>;
}

/* ─── HOLDINGS EXPAND: caches + helpers ─────────────── */
// Per-ticker news cache (5-min TTL) and earnings calendar cache (30-min TTL).
// Module-level so they survive re-renders without a React ref.
const _holdingNewsCache = new Map();       // tk → { news: [], ts: number }
const _earningsCalCache = { data: null, ts: 0 };

async function _fetchHoldingNews(tk) {
  const c = _holdingNewsCache.get(tk);
  if (c && Date.now() - c.ts < 5 * 60_000) return c.news;
  try {
    const today = new Date();
    const from = new Date(today); from.setDate(from.getDate() - 7);
    const r = await apiFetch(
      `/api/finnhub/news?symbol=${encodeURIComponent(tk)}&from=${encodeURIComponent(from.toISOString().slice(0,10))}&to=${encodeURIComponent(today.toISOString().slice(0,10))}`
    );
    if (!r.ok) { _holdingNewsCache.set(tk, { news: [], ts: Date.now() }); return []; }
    const d = await r.json().catch(() => ({}));
    const news = Array.isArray(d?.news) ? d.news : [];
    _holdingNewsCache.set(tk, { news, ts: Date.now() });
    return news;
  } catch { return []; }
}

async function _fetchEarningsCal() {
  if (_earningsCalCache.data && Date.now() - _earningsCalCache.ts < 30 * 60_000)
    return _earningsCalCache.data;
  try {
    const r = await apiFetch("/api/finnhub/earnings");
    if (!r.ok) return [];
    const d = await r.json().catch(() => ({}));
    const arr = Array.isArray(d?.earningsCalendar) ? d.earningsCalendar : [];
    _earningsCalCache.data = arr;
    _earningsCalCache.ts = Date.now();
    return arr;
  } catch { return []; }
}

function _daysUntil(dateStr) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + "T00:00:00");
  return Math.round((d - today) / 86_400_000);
}

function _relTime(unix) {
  const diff = Math.floor(Date.now() / 1000 - unix);
  if (diff < 60) return "just now";
  if (diff < 3_600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86_400) return `${Math.floor(diff / 3_600)}h ago`;
  return `${Math.floor(diff / 86_400)}d ago`;
}

function _buildEarningsMap(arr) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const map = {};
  arr.forEach(e => {
    if (!e.date || !e.symbol) return;
    const d = new Date(e.date + "T00:00:00");
    if (d < today) return;
    if (!map[e.symbol] || e.date < map[e.symbol].date) map[e.symbol] = e;
  });
  return map;
}

const _SENT_CLR = { positive: T.gain, negative: T.loss, neutral: T.muted };

// Expanded content rendered below the row when a holding is open.
function HoldingExpanded({ tk, state, costBasis = null, trades = null }) {
  if (!state || state.loading) {
    return (
      <div style={{ padding: `${T.s4} ${T.s5}`, display: "flex", flexDirection: "column", gap: T.s2, background: `${T.blue}06`, borderTop: `1px solid ${T.border}` }}>
        <Skeleton w={110} h={11} />
        <Skeleton w="88%" h={13} />
        <Skeleton w="72%" h={13} />
        <Skeleton w="80%" h={13} />
      </div>
    );
  }
  const { news = [], earnings } = state;
  const daysAway = earnings ? _daysUntil(earnings.date) : null;
  const soonLabel = daysAway != null && daysAway >= 0 && daysAway <= 7
    ? (daysAway === 0 ? "Today" : daysAway === 1 ? "Tomorrow" : `In ${daysAway} days`)
    : null;

  return (
    <div style={{ padding: `${T.s4} ${T.s5}`, background: `${T.blue}06`, borderTop: `1px solid ${T.border}`, display: "flex", flexDirection: "column", gap: T.s4 }}>
      {/* Price chart — IMPERSONAL market data (see docs/COMPLIANCE.md) */}
      <div>
        <div style={{ fontFamily: FM, fontSize: 9, color: T.muted, letterSpacing: "0.16em", fontWeight: 600, marginBottom: T.s2 }}>PRICE</div>
        <PriceChart symbol={tk} costBasis={costBasis} trades={trades} />
      </div>

      {/* Earnings row */}
      <div style={{ display: "flex", alignItems: "center", gap: T.s3, flexWrap: "wrap" }}>
        <span style={{ fontFamily: FM, fontSize: 9, color: T.muted, letterSpacing: "0.16em", fontWeight: 600 }}>NEXT EARNINGS</span>
        {earnings ? (
          <div style={{ display: "flex", alignItems: "center", gap: T.s2, flexWrap: "wrap" }}>
            <span style={{ fontFamily: FP, fontSize: 13, fontWeight: 600, color: T.textHi }}>
              {earnings.date}
              {earnings.hour && (
                <span style={{ fontFamily: FM, fontSize: 11, color: T.muted, marginLeft: T.s1, fontWeight: 400 }}>
                  · {earnings.hour === "bmo" ? "Before Open" : earnings.hour === "amc" ? "After Close" : earnings.hour}
                </span>
              )}
            </span>
            {earnings.epsEstimate != null && +earnings.epsEstimate !== 0 && (
              <span style={{ fontFamily: FM, fontSize: 11, color: T.gold }}>Est. EPS ${(+earnings.epsEstimate).toFixed(2)}</span>
            )}
            {soonLabel && <Tag label={soonLabel} color={daysAway <= 1 ? T.loss : T.gold} />}
          </div>
        ) : (
          <span style={{ fontFamily: FM, fontSize: 11, color: T.muted }}>None in next 30 days</span>
        )}
      </div>

      {/* News */}
      <div>
        <div style={{ fontFamily: FM, fontSize: 9, color: T.muted, letterSpacing: "0.16em", fontWeight: 600, marginBottom: T.s2 }}>RECENT NEWS</div>
        {news.length === 0 ? (
          <span style={{ fontFamily: FM, fontSize: 12, color: T.muted }}>No recent coverage found for {tk}.</span>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: T.s3 }}>
            {news.slice(0, 3).map((n, j) => (
              <a key={j} href={n.url} target="_blank" rel="noopener noreferrer"
                style={{ textDecoration: "none", display: "flex", gap: T.s2, alignItems: "flex-start" }}>
                <span style={{
                  flexShrink: 0, marginTop: 5,
                  width: 6, height: 6, borderRadius: "50%",
                  background: _SENT_CLR[n.s] || T.muted,
                  display: "inline-block",
                }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontFamily: FP, fontSize: 13, fontWeight: 500, color: T.textHi, lineHeight: 1.4,
                    overflow: "hidden", display: "-webkit-box",
                    WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                  }}>
                    {n.h}
                  </div>
                  <div style={{ fontFamily: FM, fontSize: 10, color: T.muted, marginTop: 3 }}>
                    {n.src} · {_relTime(n.datetime)}
                  </div>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Accordion holdings table — replaces the generic Tbl in the holdings section.
// Clicking a row expands it to show earnings + news; clicking again collapses.
function HoldingsTable({ filtered, valuesHidden, mask, f$, fp, fc, mv, gv, gp, activities = [] }) {
  const [openTk, setOpenTk] = useState(null);
  const [rowData, setRowData] = useState({});       // { [tk]: { news, earnings, loading } }
  const [earningsMap, setEarningsMap] = useState({}); // { [symbol]: nearest future entry }

  // Pre-fetch the earnings calendar once so collapsed badges show immediately.
  useEffect(() => {
    if (_earningsCalCache.data) {
      setEarningsMap(_buildEarningsMap(_earningsCalCache.data));
      return;
    }
    let cancelled = false;
    _fetchEarningsCal().then(arr => { if (!cancelled) setEarningsMap(_buildEarningsMap(arr)); });
    return () => { cancelled = true; };
  }, []);

  async function toggleRow(tk) {
    if (openTk === tk) { setOpenTk(null); return; }
    setOpenTk(tk);
    const existing = rowData[tk];
    if (existing && !existing.loading) return; // already cached
    setRowData(s => ({ ...s, [tk]: { news: null, earnings: null, loading: true } }));
    const [newsRes, earningsRes] = await Promise.allSettled([
      _fetchHoldingNews(tk),
      _fetchEarningsCal(),
    ]);
    const news = newsRes.status === "fulfilled" ? newsRes.value : [];
    const earningsArr = earningsRes.status === "fulfilled" ? earningsRes.value : [];
    // Refresh map in case it wasn't loaded yet
    setEarningsMap(_buildEarningsMap(earningsArr));
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const nextEarnings = earningsArr
      .filter(e => e.symbol === tk && e.date && new Date(e.date + "T00:00:00") >= today)
      .sort((a, b) => a.date.localeCompare(b.date))[0] || null;
    setRowData(s => ({ ...s, [tk]: { news, earnings: nextEarnings, loading: false } }));
  }

  const COL_COUNT = 8;
  const tdBase = (isOpen) => ({ padding: `${T.s3} ${T.s4}`, borderBottom: isOpen ? "none" : `1px solid ${T.border}` });

  return (
    <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
      <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontVariantNumeric: "tabular-nums" }}>
        <thead>
          <tr>
            {["Symbol", "Shares", "Avg Cost", "Price", "Today", "Mkt Value", "Gain/Loss", "Sharia"].map((h, i) => (
              <th key={h} style={{
                padding: `${T.s3} ${T.s4}`, textAlign: (i === 0 || h === "Sharia") ? "left" : "right",
                fontFamily: FM, fontSize: 10, color: T.muted, letterSpacing: "0.14em",
                textTransform: "uppercase", borderBottom: `1px solid ${T.border}`,
                fontWeight: 600, whiteSpace: "nowrap", background: T.surface,
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filtered.map((r, i) => {
            const isOpen = openTk === r.tk;
            const nextE = earningsMap[r.tk];
            const daysAway = nextE ? _daysUntil(nextE.date) : null;
            const earningsSoon = daysAway != null && daysAway >= 0 && daysAway <= 7;
            return (
              <React.Fragment key={i}>
                <tr onClick={() => toggleRow(r.tk)} className="trow" style={{
                  borderBottom: isOpen ? "none" : `1px solid ${T.border}`,
                  cursor: "pointer", transition: "background 0.12s",
                  background: isOpen ? `${T.blue}08` : undefined,
                }}>
                  {/* Symbol */}
                  <td style={tdBase(isOpen)}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{
                        display: "inline-flex", transition: "transform 0.15s",
                        transform: isOpen ? "rotate(90deg)" : "none",
                        lineHeight: 1, userSelect: "none",
                      }}><Icon name="chevron" size={11} color={isOpen ? T.blue : T.muted}/></span>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: T.s1 }}>
                          <span style={{ fontFamily: FP, fontSize: 14, fontWeight: 600, color: r.sh_ === "haram" ? T.loss : T.textHi, letterSpacing: "-0.01em" }}>{r.tk}</span>
                          {earningsSoon && (
                            <span title={`Earnings ${nextE.date}`} style={{
                              fontFamily: FM, fontSize: 9, fontWeight: 600, letterSpacing: "0.04em",
                              color: T.gold, background: `${T.gold}18`, border: `1px solid ${T.gold}30`,
                              borderRadius: 999, padding: "1px 5px", whiteSpace: "nowrap",
                            }}><Icon name="calendar" size={9} color={T.gold} style={{display:"inline-block",verticalAlign:"-1px",marginRight:3}}/>{daysAway}d</span>
                          )}
                        </div>
                        <div style={{ fontFamily: FM, fontSize: 10, color: T.muted, marginTop: 2 }}>{r.ac_}</div>
                      </div>
                    </div>
                  </td>
                  {/* Shares */}
                  <td style={{ ...tdBase(isOpen), textAlign: "right" }}>
                    <span style={{ fontFamily: FM, fontSize: 12, color: T.text, fontVariantNumeric: "tabular-nums" }}>{valuesHidden ? "••••" : r.sh.toFixed(3)}</span>
                  </td>
                  {/* Avg Cost */}
                  <td style={{ ...tdBase(isOpen), textAlign: "right" }}>
                    <span style={{ fontFamily: FM, fontSize: 11, color: T.muted, fontVariantNumeric: "tabular-nums" }}>{mask(f$(r.ac))}</span>
                  </td>
                  {/* Price */}
                  <td style={{ ...tdBase(isOpen), textAlign: "right" }}>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontFamily: FM, fontSize: 13, fontWeight: 500, color: r._live ? T.textHi : T.text, fontVariantNumeric: "tabular-nums" }}>{mask(f$(r.px))}</div>
                      {r._live && <div style={{ fontFamily: FM, fontSize: 9, color: T.gain, letterSpacing: "0.06em", marginTop: 1 }}>● LIVE</div>}
                    </div>
                  </td>
                  {/* Today */}
                  <td style={{ ...tdBase(isOpen), textAlign: "right" }}>
                    <span style={{ fontFamily: FM, fontSize: 11, fontWeight: 500, color: fc(r._p), fontVariantNumeric: "tabular-nums" }}>{valuesHidden ? "••" : (r._p ? fp(r._p) : "—")}</span>
                  </td>
                  {/* Mkt Value */}
                  <td style={{ ...tdBase(isOpen), textAlign: "right" }}>
                    <span style={{ fontFamily: FP, fontSize: 14, fontWeight: 600, color: T.textHi, letterSpacing: "-0.005em", fontVariantNumeric: "tabular-nums" }}>{mask(f$(mv(r)))}</span>
                  </td>
                  {/* Gain/Loss */}
                  <td style={{ ...tdBase(isOpen), textAlign: "right" }}>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontFamily: FM, fontSize: 12, fontWeight: 500, color: fc(gv(r)), fontVariantNumeric: "tabular-nums" }}>{mask(`${gv(r) >= 0 ? "+" : ""}${f$(gv(r))}`)}</div>
                      <div style={{ fontFamily: FM, fontSize: 10, color: fc(gp(r)), marginTop: 1 }}>{valuesHidden ? "••" : fp(gp(r))}</div>
                    </div>
                  </td>
                  {/* Sharia */}
                  <td style={tdBase(isOpen)}>
                    <Tag label={r.sh_ === "halal" ? "Halal" : r.sh_ === "haram" ? "Non-Compliant" : "Review"} color={r.sh_ === "halal" ? T.gain : r.sh_ === "haram" ? T.loss : T.gold} />
                  </td>
                </tr>
                {isOpen && (
                  <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                    <td colSpan={COL_COUNT} style={{ padding: 0, borderBottom: `1px solid ${T.border}` }}>
                      <HoldingExpanded
                        tk={r.tk}
                        state={rowData[r.tk]}
                        costBasis={valuesHidden ? null : (r.ac > 0 ? r.ac : null)}
                        trades={valuesHidden ? null : tradesForSymbol(activities, r.tk)}
                      />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ─── PORTFOLIO ──────────────────────────────────────── */
function Portfolio({live,snapAccounts=[],mapPosition,activities=[],botFills=[],documents=[],watchlist=[],onAddWatch,onRemoveWatch,onSetAlert,onAlertPermission,demoMode=false,onNav,onConnect,bankBalance=0}){
  const { hidden: valuesHidden, toggle: toggleHideValues, mask } = useHideValues();
  const[sub,setSub]=useState("holdings");
  const[acct,setAcct]=useState("all");
  const[screen,setScreen]=useState("all");
  const[sort,setSort]=useState("mv");

  const baseHoldings=snapAccounts.length>0
    ? snapAccounts.flatMap(a=>a.positions.map(p=>mapPosition(p,a.accountName,a.brokerage))).filter(h=>h&&h.sh>0)
    : [];
  const merged=baseHoldings.map(h=>{const l=live.find(q=>q.tk===h.tk);return l?{...h,px:l.price||h.px,_p:l.pct||0,_live:true}:h;});
  // Gate data-dependent sub-tabs for brand-new users: Tax (loss harvesting)
  // is meaningless with no positions, so it stays hidden until holdings exist.
  const hasHoldings=snapAccounts.length>0||merged.length>0;

  const tot=merged.reduce((s,h)=>s+mv(h),0);
  const totCost=merged.reduce((s,h)=>s+cost(h),0);
  const totGain=tot-totCost;
  const totGainPct=totCost>0?(totGain/totCost)*100:0;
  const today=merged.reduce((s,h)=>s+(h._p||0)/100*mv(h),0);
  const todayPct=tot>0?(today/tot)*100:0;
  const haram=merged.filter(h=>h.sh_==="haram");
  const haramV=haram.reduce((s,h)=>s+mv(h),0);
  const halalCount=merged.filter(h=>h.sh_==="halal").length;
  const fmtUSD=v=>`$${(+v).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}`;

  const acctOptions=["all",...Array.from(new Set(merged.map(h=>h.ac_).filter(Boolean)))];
  const filtered=(acct==="all"?merged:merged.filter(h=>h.ac_===acct))
    .filter(h=>screen==="all"||h.sh_===screen)
    .sort((a,b)=>sort==="mv"?mv(b)-mv(a):sort==="gp"?gp(b)-gp(a):a.tk.localeCompare(b.tk));

  // Allocation by brokerage — donut slices, color matched to Overview's account-card palette.
  const brokerSlices=(()=>{
    const palette={FIDELITY:T.blue,ROBINHOOD:T.gain,EMPOWER:"#7C3AED",COINBASE:T.gold,CHASE:"#0F4C81",SCHWAB:T.loss};
    const acc={};
    snapAccounts.forEach(a=>{
      const k=a.brokerage||a.brokerageSlug||"Other";
      acc[k]=(acc[k]||0)+(a.balance||0);
    });
    return Object.entries(acc).map(([label,value])=>({label,value,color:palette[(label||"").toUpperCase()]||T.muted})).filter(s=>s.value>0).sort((a,b)=>b.value-a.value);
  })();

  return<div style={{display:"flex",flexDirection:"column",gap:T.s5}}>
    {(()=>{
      // Two-level tabs: the three planning tools (Rebalance / Tax / Backtest) live
      // under a single "Tools" group so the top row stays ~5 tabs instead of 7 and
      // stops scrolling off-screen on narrow viewports. `sub` keeps its original
      // per-tool values; the top row derives its active state from them.
      const TOOLS=["rebalance","tax","dividends","backtest","overlap"];
      const topActive=TOOLS.includes(sub)?"tools":sub;
      const topTabs=[["holdings","Holdings"],["screener","Screener"],["activity","Activity"],["assets","Assets"],["tools","Tools"]];
      const toolTabs=[["rebalance","Rebalance"],...(hasHoldings?[["tax","Tax"]]:[]),["dividends","Dividends"],["backtest","Backtest"],["overlap","ETF Overlap"]];
      return<>
        <TabBar tabs={topTabs} active={topActive} onChange={v=>{if(v==="tools"){if(!TOOLS.includes(sub))setSub("rebalance");}else setSub(v);}}/>
        {topActive==="tools"&&<TabBar tabs={toolTabs} active={sub} onChange={setSub} accent={T.slate}/>}
      </>;
    })()}

    {sub==="holdings"&&<>
      {/* ─── BENTO ROW 1: Hero + side stack ─────────────── */}
      <div className="bento-row" style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:T.s4}}>
        <BentoTile style={{
          background:`radial-gradient(circle at 0% 0%, ${T.blue}1F, transparent 55%), radial-gradient(circle at 100% 100%, ${T.gold}12, transparent 50%), ${T.card}`,
          borderColor:T.blue+"30",
          padding:`${T.s6} ${T.s6}`,
        }}>
          <div style={{display:"inline-flex",alignItems:"center",fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.18em",fontWeight:600,marginBottom:T.s3}}>
            <span>MARKET VALUE</span>
            {snapAccounts.length>0&&<span style={{color:T.gain,marginLeft:T.s2,display:"inline-flex",alignItems:"center",gap:5}}><LiveDot on pulse/>LIVE</span>}
            <EyeToggle hidden={valuesHidden} toggle={toggleHideValues} size={14} color={T.muted}/>
          </div>
          <div style={{fontFamily:FU,fontSize:42,fontWeight:700,color:T.textHi,letterSpacing:"-0.035em",lineHeight:1,fontVariantNumeric:"tabular-nums"}}>{mask(fmtUSD(tot))}</div>
          <div style={{display:"flex",gap:T.s4,marginTop:T.s3,fontFamily:FM,fontSize:12,color:T.muted,flexWrap:"wrap",alignItems:"center"}}>
            <span>
              <span style={{color:totGain>=0?T.gain:T.loss,fontWeight:600}}>{valuesHidden?"••••":`${totGain>=0?"+":""}${kf(Math.abs(totGain))}`}</span>{" "}
              <span style={{color:totGain>=0?T.gain:T.loss}}>({valuesHidden?"••":fp(totGainPct)})</span>{" "}
              <span style={{color:T.muted}}>all-time</span>
            </span>
            <span style={{color:T.dim}}>·</span>
            <span>Today{" "}
              <span style={{color:fc(today),fontWeight:600}}>{valuesHidden?"••••":`${today>=0?"+":""}${f$(Math.abs(today))}`}</span>{" "}
              <span style={{color:fc(today)}}>({valuesHidden?"••":fp(todayPct)})</span>
            </span>
          </div>
          {merged.length>0&&<div style={{marginTop:T.s4,display:"flex",alignItems:"center",gap:T.s3,fontFamily:FM,fontSize:11,color:T.muted}}>
            <span>{merged.length} position{merged.length===1?"":"s"}</span>
            <span style={{color:T.dim}}>·</span>
            <span>Cost basis <span style={{color:T.textHi,fontWeight:600}}>{mask(fmtUSD(totCost))}</span></span>
          </div>}
        </BentoTile>

        <div style={{display:"flex",flexDirection:"column",gap:T.s4}}>
          <BentoTile accent={totGain>=0?T.gain:T.loss}>
            <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>TOTAL RETURN</div>
            <div style={{fontFamily:FU,fontSize:26,fontWeight:700,color:fc(totGain),letterSpacing:"-0.025em",fontVariantNumeric:"tabular-nums"}}>{mask(`${totGain>=0?"+":""}${kf(Math.abs(totGain))}`)}</div>
            <div style={{fontFamily:FM,fontSize:11,fontWeight:500,color:fc(totGain),marginTop:T.s1}}>{totCost>0?(valuesHidden?"••":fp(totGainPct)):"Unrealized"}</div>
          </BentoTile>
          {haramV>0?<BentoTile accent={T.loss} style={{background:`linear-gradient(135deg, ${T.loss}10, transparent 60%), ${T.card}`}}>
            <div style={{fontFamily:FM,fontSize:10,color:T.loss,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>NON-COMPLIANT</div>
            <div style={{fontFamily:FU,fontSize:26,fontWeight:700,color:T.textHi,letterSpacing:"-0.025em",fontVariantNumeric:"tabular-nums"}}>{mask(f$(haramV))}</div>
            <div style={{fontFamily:FM,fontSize:11,fontWeight:500,color:T.loss,marginTop:T.s1}}>{haram.length} position{haram.length===1?"":"s"} · Exit required</div>
          </BentoTile>:<BentoTile accent={T.gain}>
            <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>COMPLIANT</div>
            <div style={{fontFamily:FU,fontSize:26,fontWeight:700,color:T.textHi,letterSpacing:"-0.025em",fontVariantNumeric:"tabular-nums"}}>{halalCount}/{merged.length}</div>
            <div style={{fontFamily:FM,fontSize:11,fontWeight:500,color:T.gain,marginTop:T.s1}}>positions halal</div>
          </BentoTile>}
        </div>
      </div>

      {/* ─── BENTO ROW 2: Broker allocation (only when multiple brokers) ──── */}
      {brokerSlices.length>1&&<BentoTile>
        <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s4}}>ALLOCATION BY BROKERAGE</div>
        <div style={{display:"flex",gap:T.s5,alignItems:"center",flexWrap:"wrap"}}>
          <Donut slices={brokerSlices} size={160} thickness={18} centerLabel="Total" centerValue={mask(kf(brokerSlices.reduce((s,x)=>s+x.value,0)))}/>
          <div style={{display:"flex",flexDirection:"column",gap:T.s2,flex:1,minWidth:200}}>
            {brokerSlices.map(s=>{
              const tt=brokerSlices.reduce((a,b)=>a+b.value,0);
              const pct=tt>0?(s.value/tt*100):0;
              return<div key={s.label} style={{display:"flex",alignItems:"center",gap:T.s2}}>
                <span style={{width:8,height:8,borderRadius:2,background:s.color,flexShrink:0}}/>
                <span style={{fontFamily:FP,fontSize:13,color:T.text,flex:1,letterSpacing:"-0.005em"}}>{s.label}</span>
                <span style={{fontFamily:FM,fontSize:11,fontWeight:500,color:T.muted,fontVariantNumeric:"tabular-nums"}}>{mask(kf(s.value))}</span>
                <span style={{fontFamily:FM,fontSize:11,fontWeight:600,color:T.textHi,fontVariantNumeric:"tabular-nums",minWidth:45,textAlign:"right"}}>{valuesHidden?"••":`${pct.toFixed(1)}%`}</span>
              </div>;
            })}
          </div>
        </div>
      </BentoTile>}

      {/* ─── Sector allocation — sits under brokerage allocation ─────────── */}
      <SectorBreakdown holdings={merged} total={tot}/>

      {/* ─── Filter chips ─────────────────────────────── */}
      <div style={{display:"flex",gap:T.s2,flexWrap:"wrap",alignItems:"center"}}>
        {acctOptions.map(a=><button key={a} onClick={()=>setAcct(a)} style={{padding:`5px ${T.s3}`,borderRadius:T.rMd,fontFamily:FM,fontSize:11,fontWeight:500,letterSpacing:"-0.005em",background:acct===a?T.blue:"transparent",border:`1px solid ${acct===a?T.blue:T.border}`,color:acct===a?"#fff":T.muted,cursor:"pointer",transition:"all 0.15s"}}>{a==="all"?"All Accounts":a}</button>)}
        <div style={{width:1,height:18,background:T.border,alignSelf:"center"}}/>
        {[["all","All"],["halal","Halal"],["review","Review"],["haram","Non-Compliant"]].map(([v,l])=>{
          const c=v==="halal"?T.gain:v==="haram"?T.loss:v==="review"?T.gold:T.blue;
          return<button key={v} onClick={()=>setScreen(v)} style={{padding:`5px ${T.s3}`,borderRadius:T.rMd,fontFamily:FM,fontSize:11,fontWeight:500,letterSpacing:"-0.005em",background:screen===v?`${c}22`:"transparent",border:`1px solid ${screen===v?c:T.border}`,color:screen===v?c:T.muted,cursor:"pointer",transition:"all 0.15s"}}>{l}</button>;
        })}
        <div style={{marginLeft:"auto",display:"flex",gap:T.s1,alignItems:"center"}}>
          {[["mv","Value"],["gp","Gain%"],["tk","A-Z"]].map(([v,l])=><button key={v} onClick={()=>setSort(v)} style={{padding:`5px ${T.s3}`,borderRadius:T.rMd,fontFamily:FM,fontSize:10,fontWeight:600,letterSpacing:"0.06em",background:sort===v?T.borderHi:"transparent",border:`1px solid ${sort===v?T.borderHi:T.border}`,color:sort===v?T.text:T.muted,cursor:"pointer"}}>{l}</button>)}
          <button
            onClick={()=>downloadCSV(
              filtered.map(h=>({
                Ticker:h.tk, Name:h.nm||"", Shares:h.sh, AvgCost:+(+h.ac).toFixed(2),
                CurrentPrice:+(+h.px).toFixed(2), MarketValue:+mv(h).toFixed(2),
                GainLoss:+gv(h).toFixed(2), GainPct:+gp(h).toFixed(2),
                Account:h.ac_||"", Broker:h.brk||"", ShariaStatus:h.sh_||"",
              })),
              `mizan-holdings-${new Date().toISOString().slice(0,10)}.csv`,
            )}
            disabled={filtered.length===0}
            title={filtered.length===0?"No rows to export":"Download visible holdings as CSV"}
            style={{padding:`5px ${T.s3}`,borderRadius:T.rMd,fontFamily:FM,fontSize:10,fontWeight:600,letterSpacing:"0.06em",background:"transparent",border:`1px solid ${T.border}`,color:filtered.length===0?T.dim:T.muted,cursor:filtered.length===0?"not-allowed":"pointer"}}
          >CSV ↓</button>
          <button
            onClick={async()=>{
              const r=await apiFetch("/api/export/holdings.csv");
              if(!r.ok){alert("Export failed");return;}
              const blob=await r.blob();
              const url=URL.createObjectURL(blob);
              const a=document.createElement("a");
              a.href=url;a.download=`mizan-holdings-${new Date().toISOString().slice(0,10)}.csv`;
              document.body.appendChild(a);a.click();
              setTimeout(()=>{URL.revokeObjectURL(url);a.remove();},100);
            }}
            title="Download full holdings export from server (Plaid cache + fresh SnapTrade pull)"
            style={{padding:`5px ${T.s3}`,borderRadius:T.rMd,fontFamily:FM,fontSize:10,fontWeight:600,letterSpacing:"0.06em",background:"transparent",border:`1px solid ${T.border}`,color:T.muted,cursor:"pointer"}}
          >↓ Export CSV</button>
        </div>
      </div>

      {/* ─── Holdings table ───────────────────────────── */}
      <BentoTile style={{padding:0,overflow:"hidden"}}>
        <HoldingsTable filtered={filtered} valuesHidden={valuesHidden} mask={mask} f$={f$} fp={fp} fc={fc} mv={mv} gv={gv} gp={gp} activities={activities}/>
        {snapAccounts.length===0
          // No brokerage connected → teaching connect-to-unlock state. (We no
          // longer show perpetual skeleton rows here — that read as a stuck
          // load for a user who simply hasn't linked an account yet.)
          ?<div style={{padding:`${T.s10} ${T.s5}`,textAlign:"center"}}>
            <div style={{fontFamily:FM,fontSize:10,color:T.blue,letterSpacing:"0.2em",fontWeight:600,marginBottom:T.s3}}>HOLDINGS</div>
            <div style={{fontFamily:FU,fontSize:22,fontWeight:700,color:T.textHi,letterSpacing:"-0.02em",marginBottom:T.s2}}>Connect a brokerage to see your holdings</div>
            <div style={{fontFamily:FP,fontSize:13,color:T.muted,lineHeight:1.6,maxWidth:460,margin:`0 auto ${T.s5}`}}>Your positions, cost basis, live prices, P&amp;L, and per-holding Sharia screening appear here once you link a broker via SnapTrade.</div>
            <button onClick={onConnect} className="btn-primary" style={{fontSize:13,padding:`11px ${T.s5}`}}>+ Connect Account</button>
          </div>
          :filtered.length===0
            ?<div style={{padding:`${T.s10} ${T.s5}`,textAlign:"center",fontFamily:FP,fontSize:13,color:T.muted}}>No positions match these filters.</div>
            :null}
      </BentoTile>

      {/* ─── Watchlist section ─ merged in from the dropped sub-tab so
          tracked tickers live alongside owned positions in one pane. */}
      <div style={{display:"flex",alignItems:"center",gap:T.s3,marginTop:T.s3}}>
        <span style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600}}>TRACKED SYMBOLS</span>
        <div style={{flex:1,height:1,background:T.border}}/>
      </div>
      <Watchlist live={live} watchlist={watchlist} onAdd={onAddWatch} onRemove={onRemoveWatch} onSetAlert={onSetAlert} onAlertPermission={onAlertPermission}/>
    </>}

    {sub==="activity"&&<ActivityPanel activities={activities} accounts={snapAccounts} botFills={botFills}/>}

    {sub==="rebalance"&&<Rebalancer holdings={merged} snapAccounts={snapAccounts} onNav={onNav}/>}

    {sub==="tax"&&<TaxPlanner holdings={merged} activities={activities} snapAccounts={snapAccounts}/>}

    {/* Backtest moved here from the dropped Trade tab — it's a Portfolio
        research tool by nature, not a trading one. Uses Polygon for OHLC. */}
    {sub==="dividends"&&<DividendPlanner holdings={merged} portfolioValue={tot}/>}
    {sub==="backtest"&&<HistoricalBacktest/>}
    {sub==="overlap"&&<ETFOverlapPanel/>}

    {sub==="screener"&&<AAOIFIScreener holdings={merged}/>}
    {sub==="assets"&&<ManualAssets demoMode={demoMode}/>}
  </div>;
}

/* ─── WATCHLIST ──────────────────────────────────────── */
// Watchlist renders as a BentoTile, with sparklines per row when we have
// live data. Empty state is a dashed BentoTile that doubles as the add form.
function Watchlist({live=[],watchlist=[],onAdd,onRemove,onSetAlert,onAlertPermission}){
  const[input,setInput]=useState("");
  const submit=(e)=>{e.preventDefault();if(!input.trim())return;onAdd(input);setInput("");};
  const notifPerm=typeof Notification!=="undefined"?Notification.permission:"unsupported";

  return<CollapsibleTile title="WATCHLIST" subtitle={watchlist.length>0?`${watchlist.length} symbol${watchlist.length!==1?"s":""} tracked`:"Track prices + set price alerts"} storageKey="pf_watchlist" defaultOpen={false}>
      <div style={{display:"flex",justifyContent:"flex-end",gap:T.s2,alignItems:"center",flexWrap:"wrap",marginBottom:T.s4}}>
        {notifPerm!=="granted"&&<button onClick={onAlertPermission} style={{padding:`5px ${T.s3}`,borderRadius:T.rMd,fontFamily:FM,fontSize:10,fontWeight:600,letterSpacing:"0.06em",background:`${T.gold}18`,border:`1px solid ${T.gold}40`,color:T.gold,cursor:"pointer"}}>{notifPerm==="denied"?"Alerts blocked":"Enable alerts"}</button>}
        <form onSubmit={submit} style={{display:"flex",gap:T.s2}}>
          <input value={input} onChange={e=>setInput(e.target.value.toUpperCase())} placeholder="Add ticker"
            className="field" style={{width:120,fontSize:12,padding:`6px ${T.s3}`}}/>
          <button type="submit" className="btn-primary" style={{fontSize:11,padding:`6px ${T.s4}`}}>+ Add</button>
        </form>
      </div>
    {watchlist.length===0
      ?<div style={{padding:`${T.s8} ${T.s5}`,textAlign:"center",fontFamily:FP,fontSize:13,color:T.muted,border:`1px dashed ${T.border}`,borderRadius:T.rMd}}>
          No symbols yet. Add a ticker above to track price + set alerts.
        </div>
      :<div style={{overflow:"hidden",borderRadius:T.rMd,border:`1px solid ${T.border}`}}>
          <Tbl cols={[
            {l:"Symbol",r_:r=><span style={{fontFamily:FP,fontSize:14,fontWeight:600,color:T.textHi,letterSpacing:"-0.01em"}}>{r.symbol}</span>},
            {l:"Price",r:true,r_:r=>{const px=live.find(l=>l.tk===r.symbol)?.price;return<span style={{fontFamily:FP,fontSize:13,fontWeight:600,color:px?T.textHi:T.muted,fontVariantNumeric:"tabular-nums"}}>{px?f$(px):"—"}</span>;}},
            {l:"Change",r:true,r_:r=>{const p=live.find(l=>l.tk===r.symbol)?.pct;return<span style={{fontFamily:FM,fontSize:11,fontWeight:600,color:fc(p),fontVariantNumeric:"tabular-nums"}}>{p?fp(p):"—"}</span>;}},
            {l:"Trend",r_:r=>{
              const px=live.find(l=>l.tk===r.symbol)?.price;
              if(!px)return<span style={{color:T.muted,fontSize:10}}>—</span>;
              const p=live.find(l=>l.tk===r.symbol)?.pct||0;
              return<Sk vals={Array.from({length:18},(_,i)=>px*(1-((p/100)*(1-i/17))))} color={fc(p)} w={70} h={22} fill/>;
            }},
            {l:"Added @",r:true,r_:r=><span style={{fontFamily:FM,fontSize:11,color:T.muted,fontVariantNumeric:"tabular-nums"}}>{r.addPrice?f$(r.addPrice):"—"}</span>},
            {l:"Vs Add",r:true,r_:r=>{const px=live.find(l=>l.tk===r.symbol)?.price;if(!px||!r.addPrice)return<span style={{color:T.muted}}>—</span>;const pct=((px-r.addPrice)/r.addPrice)*100;return<span style={{fontFamily:FM,fontSize:11,fontWeight:600,color:fc(pct),fontVariantNumeric:"tabular-nums"}}>{fp(pct)}</span>;}},
            {l:"Alert ↑",r_:r=><input type="number" placeholder="—" defaultValue={r.alertAbove||""} onBlur={e=>onSetAlert(r.symbol,"alertAbove",e.target.value)} className="field" style={{width:78,fontSize:11,padding:`4px ${T.s2}`}}/>},
            {l:"Alert ↓",r_:r=><input type="number" placeholder="—" defaultValue={r.alertBelow||""} onBlur={e=>onSetAlert(r.symbol,"alertBelow",e.target.value)} className="field" style={{width:78,fontSize:11,padding:`4px ${T.s2}`}}/>},
            {l:"",r_:r=><button onClick={()=>onRemove(r.symbol)} style={{padding:`3px ${T.s2}`,borderRadius:T.rSm,background:"transparent",border:`1px solid ${T.loss}30`,color:T.loss,cursor:"pointer",fontFamily:FM,fontSize:11}}><Icon name="close" size={12}/></button>},
          ]} rows={watchlist}/>
        </div>}
  </CollapsibleTile>;
}

/* ─── EARNINGS WIDGET ────────────────────────────────── */
function EarningsWidget({earnings=[]}){
  if(!earnings||earnings.length===0)return null;
  return<div>
    <div style={{fontFamily:FM,fontSize:9,color:T.muted,letterSpacing:"0.14em",marginBottom:8,marginTop:6}}>UPCOMING EARNINGS</div>
    <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:"4px 0",maxHeight:240,overflowY:"auto"}}>
      {earnings.slice(0,12).map((e,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",padding:"7px 14px",borderBottom:`1px solid ${T.border}`,fontFamily:FM,fontSize:11}}>
        <span style={{color:T.textHi,fontWeight:500}}>{e.symbol}</span>
        <span style={{color:T.muted,fontSize:10}}>{e.date}{e.hour?` · ${e.hour}`:""}</span>
        <span style={{color:e.epsEstimate?T.gold:T.muted,fontSize:10}}>{e.epsEstimate?`est $${(+e.epsEstimate).toFixed(2)}`:"—"}</span>
      </div>)}
    </div>
  </div>;
}

/* ─── TRADE & BOT ────────────────────────────────────── */
/* ─── FIRE / RETIREMENT CALCULATOR ───────────────────── */
// Dividend Income Planner — forward-projects annual dividend income from a
// starting balance + monthly contributions + reinvestment (DRIP) + growth.
// Mizan-unique: shows GROSS dividends → minus PURIFICATION (impurity %) → the NET
// income you actually keep, since the impure fraction of a halal-fund dividend is
// owed to charity, not to you. Only the net (purified) portion is reinvested.
function DividendPlanner({holdings=[],portfolioValue=0}){
  // Privacy mask + currency formatter — same pattern the other panels use.
  // (Previously referenced but never defined here → the tool crashed on render.)
  const { mask } = useHideValues();
  const fmtUSD=v=>`$${(+v||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  // Published yields from the ETF catalog (e.g. "~0.9%") → decimals, so we can
  // blend a starting yield from the user's real halal-fund holdings when known.
  const yieldLookup=Object.fromEntries(ETF_LIST.map(f=>[f.tk,(parseFloat(String(f.div).replace(/[~%]/g,""))||0)/100]));
  const derivedYield=(()=>{
    let tv=0,dy=0;
    holdings.forEach(h=>{const v=mv(h),y=yieldLookup[h.tk];if(v>0&&y!=null){tv+=v;dy+=v*y;}});
    return tv>0?dy/tv:null;
  })();

  const[start,setStart]=useState(()=>Math.max(0,Math.round(portfolioValue))||10000);
  const[monthly,setMonthly]=useState(100);
  const[yld,setYld]=useState(()=>Math.round((derivedYield??0.018)*1000)/10);   // % on value
  const[growth,setGrowth]=useState(5);        // annual price appreciation %
  const[impurity,setImpurity]=useState(1.7);  // purification % (halal-fund blended avg)
  const[drip,setDrip]=useState(true);
  const[years,setYears]=useState(20);

  const proj=useMemo(()=>{
    const rows=[]; let bal=start, totGross=0, totPurif=0;
    for(let y=1;y<=years;y++){
      const gross=bal*(yld/100);
      const purif=gross*(impurity/100);
      const net=gross-purif;
      totGross+=gross; totPurif+=purif;
      rows.push({year:y,label:`Y${y}`,gross:+gross.toFixed(0),net:+net.toFixed(0)});
      bal=bal*(1+growth/100)+monthly*12+(drip?net:0);
    }
    return {rows,totGross,totPurif,finalBal:bal};
  },[start,monthly,yld,growth,impurity,drip,years]);

  const last=proj.rows[proj.rows.length-1]||{net:0,gross:0};
  const first=proj.rows[0]||{net:0};
  const num=(v,set,step=1,min=0)=><input type="number" value={v} min={min} step={step} onChange={e=>set(Math.max(min,+e.target.value||0))} className="field" style={{width:"100%",fontSize:13,padding:`8px ${T.s3}`,fontVariantNumeric:"tabular-nums"}}/>;
  const Field=({label,children,hint})=><div><div style={{fontFamily:FM,fontSize:9,color:T.muted,letterSpacing:"0.14em",fontWeight:600,marginBottom:6}}>{label}</div>{children}{hint&&<div style={{fontFamily:FP,fontSize:10,color:T.dim,marginTop:4,lineHeight:1.4}}>{hint}</div>}</div>;

  return<div style={{display:"flex",flexDirection:"column",gap:T.s5}}>
    <BentoTile accent={T.gain} style={{background:`radial-gradient(circle at 100% 0%, ${T.gain}12, transparent 55%), ${T.card}`}}>
      <div style={{fontFamily:FM,fontSize:10,color:T.gain,letterSpacing:"0.18em",fontWeight:600,marginBottom:T.s2}}>DIVIDEND INCOME · YEAR {years}</div>
      <div style={{display:"flex",gap:T.s6,flexWrap:"wrap",alignItems:"baseline"}}>
        <div>
          <div style={{fontFamily:FU,fontSize:38,fontWeight:700,color:T.textHi,letterSpacing:"-0.03em",lineHeight:1,fontVariantNumeric:"tabular-nums"}}>{mask(fmtUSD(last.net))}</div>
          <div style={{fontFamily:FM,fontSize:11,color:T.muted,marginTop:T.s2}}>net dividends / yr · ~{mask(fmtUSD(Math.round(last.net/12)))}/mo</div>
        </div>
        <div>
          <div style={{fontFamily:FU,fontSize:22,fontWeight:600,color:T.gold,letterSpacing:"-0.02em",fontVariantNumeric:"tabular-nums"}}>{mask(fmtUSD(Math.round(proj.totPurif)))}</div>
          <div style={{fontFamily:FM,fontSize:10,color:T.muted,marginTop:T.s1}}>purification owed over {years}y</div>
        </div>
        <div>
          <div style={{fontFamily:FU,fontSize:22,fontWeight:600,color:T.textHi,letterSpacing:"-0.02em",fontVariantNumeric:"tabular-nums"}}>{mask(fmtUSD(Math.round(proj.finalBal)))}</div>
          <div style={{fontFamily:FM,fontSize:10,color:T.muted,marginTop:T.s1}}>projected balance</div>
        </div>
      </div>
      <div style={{fontFamily:FP,fontSize:11,color:T.muted,marginTop:T.s3,lineHeight:1.5,maxWidth:560}}>Estimates only. The impure fraction of a halal-fund dividend ({impurity}%) is owed to charity, so only the <strong style={{color:T.text}}>net</strong> is yours to keep or reinvest. Confirm each fund's actual impurity % in Zakat → Dividend Purification.</div>
    </BentoTile>

    <div className="bento-row" style={{display:"grid",gridTemplateColumns:"minmax(240px,1fr) 2fr",gap:T.s4}}>
      <BentoTile>
        <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s4}}>ASSUMPTIONS</div>
        <div style={{display:"flex",flexDirection:"column",gap:T.s4}}>
          <Field label="STARTING BALANCE">{num(start,setStart,100)}</Field>
          <Field label="MONTHLY CONTRIBUTION">{num(monthly,setMonthly,25)}</Field>
          <Field label={`DIVIDEND YIELD · ${yld}%`} hint={derivedYield!=null?"Blended from your current halal-fund holdings.":"Halal-fund blended default."}>{num(yld,setYld,0.1)}</Field>
          <Field label={`PRICE GROWTH · ${growth}%/yr`}>{num(growth,setGrowth,0.5)}</Field>
          <Field label={`PURIFICATION · ${impurity}%`} hint="Impure share of dividends owed to charity.">{num(impurity,setImpurity,0.1)}</Field>
          <label style={{display:"flex",alignItems:"center",gap:T.s2,cursor:"pointer",fontFamily:FP,fontSize:13,color:T.text}}>
            <input type="checkbox" checked={drip} onChange={e=>setDrip(e.target.checked)}/> Reinvest dividends (DRIP)
          </label>
          <div>
            <div style={{fontFamily:FM,fontSize:9,color:T.muted,letterSpacing:"0.14em",fontWeight:600,marginBottom:6}}>HORIZON</div>
            <div style={{display:"flex",gap:T.s1,flexWrap:"wrap"}}>
              {[5,10,15,20,30].map(y=><button key={y} onClick={()=>setYears(y)} style={{padding:`5px ${T.s3}`,borderRadius:T.rSm,fontFamily:FM,fontSize:11,fontWeight:600,cursor:"pointer",background:years===y?T.gain:"transparent",border:`1px solid ${years===y?T.gain:T.border}`,color:years===y?"#fff":T.muted}}>{y}y</button>)}
            </div>
          </div>
        </div>
      </BentoTile>

      <BentoTile>
        <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s3}}>PROJECTED ANNUAL DIVIDENDS · GROSS vs NET</div>
        <div style={{height:280}}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={proj.rows} margin={{top:8,right:8,left:0,bottom:0}}>
              <defs>
                <linearGradient id="divNet" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={T.gain} stopOpacity={0.35}/><stop offset="100%" stopColor={T.gain} stopOpacity={0}/></linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={T.dim} vertical={false}/>
              <XAxis dataKey="label" tick={{fontSize:10,fontFamily:FM,fill:T.muted}} axisLine={{stroke:T.border}} tickLine={false} interval="preserveStartEnd"/>
              <YAxis tick={{fontSize:10,fontFamily:FM,fill:T.muted}} axisLine={false} tickLine={false} width={54} tickFormatter={v=>`$${kf(v)}`}/>
              <Tooltip formatter={(v,n)=>[mask(fmtUSD(v)),n==="net"?"Net (yours)":"Gross"]} labelFormatter={l=>`Year ${l.replace("Y","")}`} contentStyle={{background:T.card,border:`1px solid ${T.border}`,borderRadius:T.rMd,fontFamily:FM,fontSize:12}}/>
              <Area type="monotone" dataKey="gross" stroke={T.gold} strokeWidth={1.5} fill="none" strokeDasharray="4 3"/>
              <Area type="monotone" dataKey="net" stroke={T.gain} strokeWidth={2} fill="url(#divNet)"/>
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div style={{display:"flex",gap:T.s4,marginTop:T.s2,flexWrap:"wrap"}}>
          <span style={{fontFamily:FM,fontSize:10,color:T.gain}}>● Net (after purification) — Y1 {mask(fmtUSD(first.net))} → Y{years} {mask(fmtUSD(last.net))}</span>
          <span style={{fontFamily:FM,fontSize:10,color:T.gold}}>┄ Gross</span>
        </div>
      </BentoTile>
    </div>
  </div>;
}

function FireCalculator({currentNW=0,ytdContrib=0}){
  const[age,setAge]=useState(28);
  const[targetAge,setTargetAge]=useState(50);
  const[monthly,setMonthly]=useState(Math.max(2000,Math.round((ytdContrib||24000)/12/500)*500));
  const[ret,setRet]=useState(0.07);
  const[inflation,setInflation]=useState(0.03);
  const[withdrawRate,setWithdrawRate]=useState(0.04); // 4% safe withdrawal rule

  const projection=useMemo(()=>{
    const out=[];
    let bal=currentNW;
    for(let yr=0;yr<=Math.max(40,targetAge-age+5);yr++){
      out.push({year:age+yr,nominal:+bal.toFixed(0),real:+(bal/Math.pow(1+inflation,yr)).toFixed(0)});
      bal=bal*(1+ret)+monthly*12;
    }
    return out;
  },[currentNW,age,targetAge,monthly,ret,inflation]);

  const fireNumber=monthly*12*30; // assume desired annual spend ≈ current contribution * 12 (rough), 30x for 4% rule with margin
  // Better: ask user what their target annual spend is. For now derive from current NW * withdrawRate
  const targetSpend=Math.round(currentNW*0.04/12)*12||60_000;
  const fireTarget = withdrawRate > 0 ? targetSpend / withdrawRate : 0;
  const yearAtTarget=projection.find(p=>p.nominal>=fireTarget);
  const balanceAtRetirement=projection.find(p=>p.year===targetAge);

  return<div className="bento-row mz-side-by-side" style={{display:"grid",gridTemplateColumns:"360px 1fr",gap:T.s4}}>
    <div style={{display:"flex",flexDirection:"column",gap:T.s4}}>
      <BentoTile style={{display:"flex",flexDirection:"column",gap:T.s3}}>
        <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600}}>RETIREMENT PARAMETERS</div>
        {[
          {l:"Current Age",v:age,set:setAge,min:18,max:75,step:1,fmt:v=>v},
          {l:"Target Retirement Age",v:targetAge,set:setTargetAge,min:30,max:80,step:1,fmt:v=>v},
          {l:"Monthly Contribution",v:monthly,set:setMonthly,min:0,max:25000,step:250,fmt:v=>`$${v.toLocaleString()}`},
          {l:"Expected Annual Return",v:ret,set:setRet,min:0.02,max:0.15,step:0.005,fmt:v=>`${(v*100).toFixed(1)}%`},
          {l:"Inflation Assumption",v:inflation,set:setInflation,min:0,max:0.08,step:0.005,fmt:v=>`${(v*100).toFixed(1)}%`},
          {l:"Safe Withdrawal Rate",v:withdrawRate,set:setWithdrawRate,min:0.02,max:0.06,step:0.005,fmt:v=>`${(v*100).toFixed(1)}%`},
        ].map(s=><div key={s.l}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:T.s1}}>
            <span style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.14em",fontWeight:600}}>{s.l.toUpperCase()}</span>
            <span style={{fontFamily:FP,fontSize:14,fontWeight:600,color:T.textHi,letterSpacing:"-0.01em",fontVariantNumeric:"tabular-nums"}}>{s.fmt(s.v)}</span>
          </div>
          <input type="range" min={s.min} max={s.max} step={s.step} value={s.v} onChange={e=>s.set(+e.target.value)} style={{width:"100%",accentColor:T.blue,cursor:"pointer",height:4}}/>
        </div>)}
        <div style={{padding:`${T.s3} ${T.s4}`,background:`linear-gradient(135deg, ${T.gain}12, transparent 70%), ${T.gainBg}`,border:`1px solid ${T.gain}30`,borderRadius:T.rMd,marginTop:T.s2}}>
          <div style={{fontFamily:FM,fontSize:10,color:T.gain,letterSpacing:"0.14em",fontWeight:600,marginBottom:T.s1}}>FIRE NUMBER</div>
          <div style={{fontFamily:FU,fontSize:24,fontWeight:700,color:T.gain,letterSpacing:"-0.025em",fontVariantNumeric:"tabular-nums"}}>{kf(fireTarget)}</div>
          <div style={{fontFamily:FM,fontSize:11,color:T.muted,marginTop:T.s1}}>Supports {kf(targetSpend)}/yr at {(withdrawRate*100).toFixed(1)}%</div>
        </div>
      </BentoTile>

      <BentoTile>
        <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s3}}>PROJECTION</div>
        {[
          ["Years to FIRE",yearAtTarget?(yearAtTarget.year===age?"Already at FIRE":`${yearAtTarget.year-age} yrs`):"Not reached",yearAtTarget?T.gain:T.muted],
          ["FIRE at age",yearAtTarget?yearAtTarget.year:"—"],
          ["Balance at target",balanceAtRetirement?kf(balanceAtRetirement.nominal):"—"],
          ["Today's $ at target",balanceAtRetirement?kf(balanceAtRetirement.real):"—"],
        ].map(([l,v,clr])=><div key={l} style={{display:"flex",justifyContent:"space-between",padding:`${T.s2} 0`,borderBottom:`1px solid ${T.border}`,fontFamily:FM,fontSize:12}}>
          <span style={{color:T.muted,letterSpacing:"0.04em"}}>{l}</span>
          <span style={{color:clr||T.textHi,fontWeight:600,fontVariantNumeric:"tabular-nums"}}>{v}</span>
        </div>)}
      </BentoTile>
    </div>

    <BentoTile>
      <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s3}}>NET WORTH PROJECTION · Nominal vs Inflation-Adjusted</div>
      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart data={projection} margin={{top:10,right:14,bottom:8,left:14}}>
          <defs><linearGradient id="fireG" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={T.blue} stopOpacity={0.32}/><stop offset="95%" stopColor={T.blue} stopOpacity={0}/></linearGradient></defs>
          <CartesianGrid stroke={T.border} strokeDasharray="2 4" vertical={false}/>
          <XAxis dataKey="year" tick={{fontFamily:FM,fontSize:10,fill:T.muted}} axisLine={{stroke:T.border}} tickLine={false}/>
          <YAxis tickFormatter={v=>kf(v)} tick={{fontFamily:FM,fontSize:10,fill:T.muted}} axisLine={false} tickLine={false} width={60}/>
          <Tooltip
            formatter={(v,name)=>[kf(v),name==="nominal"?"Nominal":"Real (today's $)"]}
            contentStyle={{background:T.card,border:`1px solid ${T.borderHi}`,borderRadius:T.rMd,fontFamily:FM,fontSize:11,boxShadow:"var(--sh-md)"}}
            itemStyle={{color:T.textHi}} labelStyle={{color:T.muted}}/>
          <Area type="monotone" dataKey="nominal" stroke={T.blue} strokeWidth={2} fill="url(#fireG)" dot={false}/>
          <Line type="monotone" dataKey="real" stroke={T.gold} strokeWidth={1.8} strokeDasharray="3 3" dot={false}/>
        </ComposedChart>
      </ResponsiveContainer>
      <div style={{display:"flex",gap:T.s4,fontFamily:FM,fontSize:11,color:T.muted,marginTop:T.s3,flexWrap:"wrap"}}>
        <span style={{display:"flex",alignItems:"center",gap:T.s1}}><span style={{width:12,height:2,background:T.blue,display:"inline-block",borderRadius:1}}/>Nominal balance</span>
        <span style={{display:"flex",alignItems:"center",gap:T.s1}}><span style={{width:12,height:2,background:T.gold,display:"inline-block",borderRadius:1}}/>Inflation-adjusted (today's $)</span>
      </div>
    </BentoTile>
  </div>;
}

/* ─── ORDER PREVIEW MODAL ────────────────────────────── */
// Renders SnapTrade /trade/impact response — estimated fees, fill price,
// available cash, sharia warnings, and a Confirm/Cancel pair.
function OrderPreviewModal({preview={},onConfirm,onCancel,busy,side,sym,qty}){
  const trade=preview.trade||preview;
  const estCost=trade.estimated_commission?.amount??trade.estimated_total_amount?.amount??null;
  const fees=trade.estimated_commission?.amount??null;
  const fillPrice=trade.fill_price?.price??trade.fill_price??null;
  const remaining=trade.remaining_buying_power?.amount??null;
  const warnings=trade.warnings||trade.warnings_messages||[];

  return<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.60)",backdropFilter:"blur(24px) saturate(160%)",WebkitBackdropFilter:"blur(24px) saturate(160%)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
    <div style={{background:"var(--mz-glass-strong)",backdropFilter:"blur(40px) saturate(180%)",WebkitBackdropFilter:"blur(40px) saturate(180%)",border:"1px solid var(--mz-glass-border)",borderRadius:14,width:"100%",maxWidth:480,boxShadow:"var(--mz-glass-shadow-lg)",overflow:"hidden",animation:"glassFadeUp 0.22s cubic-bezier(.34,1.56,.64,1)"}}>
      <div style={{padding:"14px 18px",borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div>
          <div style={{fontFamily:FM,fontSize:12,fontWeight:600,color:T.textHi}}>Confirm {side==="buy"?"Buy":"Sell"} {sym}</div>
          <div style={{fontFamily:FP,fontSize:11,color:T.muted,marginTop:2}}>SnapTrade preview · review before placing</div>
        </div>
        <button onClick={onCancel} style={{background:"none",border:"none",color:T.muted,cursor:"pointer",fontSize:18,lineHeight:1}}><Icon name="close" size={16}/></button>
      </div>
      <div style={{padding:"16px 18px",display:"flex",flexDirection:"column",gap:8}}>
        {[
          ["Side",side.toUpperCase()],
          ["Symbol",sym],
          ["Quantity",qty],
          ["Est. fill price",fillPrice?f$(fillPrice):"—"],
          ["Est. fees",fees!=null?f$(fees):"—"],
          ["Est. total",estCost!=null?f$(estCost):"—"],
          ["Remaining cash",remaining!=null?kf(remaining):"—"],
        ].map(([l,v])=><div key={l} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:`1px solid ${T.border}`,fontFamily:FM,fontSize:12}}>
          <span style={{color:T.muted}}>{l}</span>
          <span style={{color:T.textHi}}>{v}</span>
        </div>)}
        {warnings.length>0&&<div style={{padding:"10px 12px",background:`${T.gold}0E`,border:`1px solid ${T.gold}30`,borderRadius:8,fontFamily:FM,fontSize:10,color:T.gold,lineHeight:1.5}}>
          <Icon name="warning" size={12} color={T.gold} style={{display:"inline-block",verticalAlign:"-2px",marginRight:4}}/>{Array.isArray(warnings)?warnings.join(" · "):String(warnings)}
        </div>}
        <div style={{padding:"10px 12px",background:`${T.gain}0E`,border:`1px solid ${T.gain}25`,borderRadius:8,fontFamily:FP,fontSize:11,color:T.text,lineHeight:1.5}}>
          <Icon name="check" size={12} color={T.gain} style={{display:"inline-block",verticalAlign:"-2px",marginRight:4}}/>Sharia pre-check: spot equity, no margin, no derivatives. Run the screener after placing if {sym} isn't classified yet.
        </div>
      </div>
      <div style={{padding:"12px 18px",borderTop:`1px solid ${T.border}`,display:"flex",gap:8,justifyContent:"flex-end"}}>
        <button onClick={onCancel} disabled={busy} style={{padding:"8px 16px",borderRadius:8,fontFamily:FM,fontSize:11,letterSpacing:"0.06em",background:"transparent",border:`1px solid ${T.border}`,color:T.text,cursor:busy?"not-allowed":"pointer"}}>Cancel</button>
        <button onClick={onConfirm} disabled={busy} style={{padding:"8px 18px",borderRadius:8,fontFamily:FM,fontSize:11,fontWeight:600,letterSpacing:"0.06em",background:busy?T.dim:`linear-gradient(135deg, ${side==="buy"?T.gain:T.loss}, ${side==="buy"?T.gain:T.loss}DD)`,border:"none",color:busy?T.muted:"#fff",cursor:busy?"not-allowed":"pointer",boxShadow:busy?"none":`0 2px 8px ${(side==="buy"?T.gain:T.loss)}55`}}>{busy?"Placing…":`Confirm ${side==="buy"?"Buy":"Sell"}`}</button>
      </div>
    </div>
  </div>;
}

/* ─── BOT DASHBOARD ──────────────────────────────────── */
// Live execution state for the trading bot. Pulls from snapActivities since
// orders flow through the same /activities endpoint after they fill.
function BotDashboard({activities=[],accounts=[]}){
  const sells=activities.filter(a=>(a.type||"").toUpperCase()==="SELL");
  const buys=activities.filter(a=>(a.type||"").toUpperCase()==="BUY");
  // Win rate: sells where amount > avg cost basis. We don't track exact lots,
  // but proxy: positive trade amount = win.
  const wins=sells.filter(a=>(+a.amount||0)>0).length;
  const losses=sells.length-wins;
  const winRate=sells.length>0?(wins/sells.length)*100:0;
  const realizedYTD=sells.filter(a=>(a.trade_date||"")>=`${new Date().getFullYear()}-01-01`).reduce((s,a)=>s+(+a.amount||0),0);
  // Streak: walk sells in reverse chrono, count consecutive wins or losses
  let streak=0,streakKind="—";
  const ordered=[...sells].sort((a,b)=>(b.trade_date||"").localeCompare(a.trade_date||""));
  for(const s of ordered){
    const win=(+s.amount||0)>0;
    if(streak===0){streak=1;streakKind=win?"W":"L";continue;}
    if((win&&streakKind==="W")||(!win&&streakKind==="L"))streak++;else break;
  }
  const recentTrades=[...buys,...sells].sort((a,b)=>(b.trade_date||"").localeCompare(a.trade_date||"")).slice(0,20);
  return<div style={{display:"flex",flexDirection:"column",gap:14}}>
    <p style={{fontFamily:FP,fontSize:13,color:T.muted,margin:0,lineHeight:1.7,maxWidth:680}}>
      Live trading state. Once you place orders via the Order Ticket, fills flow into Activity and surface here as P&L, win rate, and current streak.
    </p>
    <div className="mz-grid-4" style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
      <KV label="Total trades"   value={`${buys.length+sells.length}`} sub={`${buys.length} buys · ${sells.length} sells`}/>
      <KV label="Win rate"       value={sells.length?`${winRate.toFixed(0)}%`:"—"} sub={`${wins}W · ${losses}L`} subColor={winRate>=50?T.gain:T.loss}/>
      <KV label="Realized YTD"   value={`${realizedYTD>=0?"+":""}${kf(Math.abs(realizedYTD))}`} subColor={fc(realizedYTD)}/>
      <KV label="Current streak" value={`${streakKind} × ${streak}`} subColor={streakKind==="W"?T.gain:streakKind==="L"?T.loss:T.muted}/>
    </div>
    {recentTrades.length===0
      ?<div style={{background:T.card,border:`1px dashed ${T.border}`,borderRadius:12,padding:"32px",textAlign:"center",fontFamily:FM,fontSize:11,color:T.muted}}>No trades yet. Place an order from the Order Ticket tab.</div>
      :<div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,overflow:"hidden"}}>
        <Tbl cols={[
          {l:"Date",r_:r=><span style={{fontFamily:FM,fontSize:11,color:T.muted}}>{r.trade_date||"—"}</span>},
          {l:"Side",r_:r=><Tag label={(r.type||"").toUpperCase()} color={(r.type||"").toUpperCase()==="BUY"?T.blue:T.gold}/>},
          {l:"Symbol",r_:r=><span style={{fontFamily:FM,fontSize:12,fontWeight:500,color:T.textHi}}>{r.symbol?.symbol||r.symbol||"—"}</span>},
          {l:"Qty",r:true,r_:r=><span style={{fontFamily:FM,fontSize:11,color:T.text}}>{r.units?(+r.units).toLocaleString("en-US",{maximumFractionDigits:4}):"—"}</span>},
          {l:"Price",r:true,mobileHide:true,r_:r=><span style={{fontFamily:FM,fontSize:11,color:T.muted}}>{r.price?f$(r.price):"—"}</span>},
          {l:"Amount",r:true,r_:r=>{const v=+r.amount||0;return<span style={{fontFamily:FM,fontSize:12,fontWeight:500,color:v>0?T.gain:v<0?T.loss:T.text}}>{v>=0?"+":"−"}{f$(Math.abs(v))}</span>;}},
        ]} rows={recentTrades}/>
      </div>}
  </div>;
}

/* ─── HISTORICAL BACKTEST ────────────────────────────── */
// Polygon /v2/aggs daily bars + simple SMA-50/200 crossover strategy.
// Buy when SMA-50 crosses above SMA-200, sell when it crosses below.
// Shared SMA-50/200 crossover backtest over Polygon daily bars.
// Returns { series, trades, stats } where stats includes winRate, maxDrawdown,
// totalRet (compounded strategy return %), buyHold, and a return-distribution
// histogram of closed-trade returns. Reused by HistoricalBacktest and the
// Trading Bot strategy reality-check before activation.
function computeSmaBacktest(bars){
  if(!bars||bars.length<200)return{series:(bars||[]).map(b=>({t:b.t,c:b.c})),trades:[],stats:{bars:(bars||[]).length}};
  const closes=bars.map(b=>b.c);
  const sma=(arr,n,i)=>i<n-1?null:arr.slice(i-n+1,i+1).reduce((s,v)=>s+v,0)/n;
  const series=bars.map((b,i)=>({t:b.t,c:b.c,sma50:sma(closes,50,i),sma200:sma(closes,200,i),date:new Date(b.t).toISOString().slice(0,10)}));
  const trades=[];let pos=null;
  for(let i=1;i<series.length;i++){
    const p=series[i-1],c=series[i];
    if(p.sma50==null||p.sma200==null||c.sma50==null||c.sma200==null)continue;
    const wasAbove=p.sma50>p.sma200, isAbove=c.sma50>c.sma200;
    if(!wasAbove&&isAbove&&!pos){pos={entry:c.c,entryDate:c.date};trades.push({date:c.date,side:"BUY",price:c.c});}
    else if(wasAbove&&!isAbove&&pos){const r=(c.c-pos.entry)/pos.entry*100;trades.push({date:c.date,side:"SELL",price:c.c,return:r,entry:pos.entry});pos=null;}
  }
  const closed=trades.filter(t=>t.side==="SELL");
  const wins=closed.filter(t=>t.return>0).length;
  // Chain returns multiplicatively: each trade's return (%) compounds prior equity.
  const chained=closed.reduce((acc,t)=>acc*(1+(t.return||0)/100),1)-1;
  const totalRet=chained*100;
  // Max drawdown across the compounded equity curve of closed trades.
  let eq=1,peak=1,maxDd=0;
  for(const t of closed){eq*=(1+(t.return||0)/100);if(eq>peak)peak=eq;const dd=(peak-eq)/peak*100;if(dd>maxDd)maxDd=dd;}
  // Return-distribution histogram: bucket each closed trade's % return.
  const edges=[-100,-20,-10,-5,0,5,10,20,1e9];
  const labels=["< -20%","-20 to -10%","-10 to -5%","-5 to 0%","0 to 5%","5 to 10%","10 to 20%","> 20%"];
  const dist=labels.map((label,bi)=>({label,count:closed.filter(t=>(t.return||0)>=edges[bi]&&(t.return||0)<edges[bi+1]).length}));
  const buyHold=bars.length>1?((bars[bars.length-1].c-bars[0].c)/bars[0].c)*100:0;
  // Avg return per trade — used to scale an expectation over an arbitrary horizon.
  const avgTradeRet=closed.length?closed.reduce((s,t)=>s+(t.return||0),0)/closed.length:0;
  const spanDays=bars.length>1?Math.max(1,(bars[bars.length-1].t-bars[0].t)/86400000):1;
  return{series,trades,stats:{trades:closed.length,wins,losses:closed.length-wins,winRate:closed.length?(wins/closed.length)*100:0,totalRet,buyHold,maxDrawdown:maxDd,dist,avgTradeRet,spanDays,bars:bars.length}};
}

// Reality-check backtest for a parsed NL strategy. Fetches Polygon bars for the
// strategy ticker, runs computeSmaBacktest, scales the historical return to the
// strategy's time horizon, and surfaces an honest mismatch warning when the
// user's profit target is unrealistically above what the strategy historically
// achieved. Profit target is always framed as a GOAL, never a promise.
function StrategyReality({strat}){
  const[bars,setBars]=useState([]);
  const[busy,setBusy]=useState(false);
  const[err,setErr]=useState(null);
  const[ran,setRan]=useState(false);
  const ticker=strat&&strat.ticker;
  useEffect(()=>{
    if(!ticker){setBars([]);setRan(false);return;}
    let alive=true;
    (async()=>{
      setBusy(true);setErr(null);setRan(false);setBars([]);
      try{
        const to=new Date().toISOString().slice(0,10);
        const fromD=new Date();fromD.setFullYear(fromD.getFullYear()-2);
        const from=fromD.toISOString().slice(0,10);
        const r=await apiFetch(`/api/polygon/bars?symbol=${encodeURIComponent(ticker)}&from=${from}&to=${to}`);
        const d=await r.json();
        if(!r.ok||d.error)throw new Error(d.error||`HTTP ${r.status}`);
        if(alive){setBars(d.bars||[]);setRan(true);}
      }catch(e){if(alive)setErr(e.message||"Backtest unavailable");}
      finally{if(alive)setBusy(false);}
    })();
    return()=>{alive=false;};
  },[ticker]);

  const{stats,expectedRet,target,mismatch}=useMemo(()=>{
    const{stats}=computeSmaBacktest(bars);
    const target=Number(strat?.profit_target_pct)||0;
    const horizon=Number(strat?.time_horizon_days)||0;
    // Scale the strategy's total historical return to the user's horizon so the
    // comparison is apples-to-apples (return achieved over a comparable period).
    let expectedRet=null;
    if(stats.trades&&stats.spanDays>0){
      if(horizon>0)expectedRet=stats.totalRet*(horizon/stats.spanDays);
      else expectedRet=stats.totalRet;
    }
    // Mismatch: target meaningfully exceeds the historically achievable return.
    // Flag when target is >2x the (positive) expected return, or any positive
    // target against a flat/negative historical result.
    let mismatch=false;
    if(target>0&&expectedRet!=null){
      if(expectedRet<=0)mismatch=true;
      else if(target>expectedRet*2)mismatch=true;
    }
    return{stats,expectedRet,target,mismatch};
  },[bars,strat]);

  const hasData=ran&&bars.length>=200&&stats.trades>0;
  const maxDistCount=stats.dist?Math.max(1,...stats.dist.map(d=>d.count)):1;
  const lossPct=Number(strat?.stop_loss_pct)||Number(strat?.max_drawdown_pct)||0;

  return<div style={{marginTop:T.s3,padding:T.s3,background:T.bg,borderRadius:T.rMd,border:`1px solid ${T.border}`}}>
    <div style={{fontFamily:FM,fontSize:10,color:T.blue,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s3}}>HISTORICAL REALITY CHECK · {ticker}</div>
    {busy&&<div style={{height:90,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:FM,fontSize:11,color:T.muted}}>Running backtest on 2yr of {ticker} bars…</div>}
    {!busy&&err&&<div style={{padding:`${T.s2} ${T.s3}`,background:T.lossBg,border:`1px solid ${T.loss}30`,borderRadius:T.rMd,fontFamily:FM,fontSize:11,color:T.loss}}>{ICON_NO}{err}</div>}
    {!busy&&!err&&!hasData&&<div style={{padding:`${T.s2} ${T.s3}`,background:T.surface,border:`1px solid ${T.border}`,borderRadius:T.rMd,fontFamily:FP,fontSize:12,color:T.muted,lineHeight:1.5}}>Not enough historical data to backtest {ticker} (needs ~200 daily bars). Treat the profit target as an unvalidated goal and size risk accordingly.</div>}
    {!busy&&!err&&hasData&&<>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:T.s2,marginBottom:T.s3}}>
        {[
          ["Win rate",`${stats.winRate.toFixed(0)}%`,T.textHi],
          ["Max drawdown",`-${stats.maxDrawdown.toFixed(1)}%`,T.loss],
          ["Hist. return",`${stats.totalRet.toFixed(1)}%`,fc(stats.totalRet)],
        ].map(([l,v,clr])=><div key={l} style={{padding:T.s2,background:T.surface,borderRadius:T.rSm,border:`1px solid ${T.border}`}}>
          <div style={{fontFamily:FM,fontSize:9,color:T.muted,letterSpacing:"0.1em",marginBottom:3}}>{l.toUpperCase()}</div>
          <div style={{fontFamily:FU,fontSize:17,fontWeight:700,color:clr,fontVariantNumeric:"tabular-nums"}}>{v}</div>
        </div>)}
      </div>
      <div style={{fontFamily:FM,fontSize:9,color:T.muted,letterSpacing:"0.1em",marginBottom:T.s2}}>RETURN DISTRIBUTION · {stats.trades} CLOSED TRADES</div>
      <div style={{display:"flex",flexDirection:"column",gap:3,marginBottom:T.s3}}>
        {stats.dist.map(d=><div key={d.label} style={{display:"grid",gridTemplateColumns:"96px 1fr 24px",gap:T.s2,alignItems:"center"}}>
          <span style={{fontFamily:FM,fontSize:10,color:T.muted,fontVariantNumeric:"tabular-nums"}}>{d.label}</span>
          <div style={{height:8,background:T.surface,borderRadius:999,overflow:"hidden"}}>
            <div style={{height:"100%",width:`${(d.count/maxDistCount)*100}%`,background:d.label.includes("-")&&!d.label.startsWith("-5")?T.loss:d.label.startsWith("> ")||d.label.startsWith("10")||d.label.startsWith("5")?T.gain:d.label.startsWith("0")?T.gain:T.loss,borderRadius:999}}/>
          </div>
          <span style={{fontFamily:FM,fontSize:10,color:T.textHi,fontWeight:600,textAlign:"right",fontVariantNumeric:"tabular-nums"}}>{d.count}</span>
        </div>)}
      </div>
      {mismatch&&<div style={{padding:T.s3,background:T.lossBg,border:`1px solid ${T.loss}50`,borderRadius:T.rMd,marginBottom:T.s2}}>
        <div style={{display:"flex",alignItems:"center",gap:4,fontFamily:FM,fontSize:10,color:T.loss,letterSpacing:"0.12em",fontWeight:600,marginBottom:4}}><Icon name="warning" size={12} color={T.loss}/>TARGET MAY NOT BE REALISTIC</div>
        <div style={{fontFamily:FP,fontSize:12,color:T.text,lineHeight:1.55,fontVariantNumeric:"tabular-nums"}}>
          Your target is <strong style={{color:T.loss}}>{target}%</strong>; historically this strategy achieved <strong style={{color:T.textHi}}>~{expectedRet.toFixed(1)}%</strong> over a comparable {Number(strat?.time_horizon_days)||0}-day period. Hitting your target would require materially more risk than the backtest shows — or may not be achievable at all.
        </div>
      </div>}
      {!mismatch&&expectedRet!=null&&<div style={{padding:`${T.s2} ${T.s3}`,background:`${T.gold}10`,border:`1px solid ${T.gold}30`,borderRadius:T.rMd,marginBottom:T.s2,fontFamily:FP,fontSize:12,color:T.gold,lineHeight:1.5,fontVariantNumeric:"tabular-nums"}}>
        Over a comparable {Number(strat?.time_horizon_days)||0}-day window this strategy historically returned ~{expectedRet.toFixed(1)}%. Your {target}% target is within reach of past results but is still a goal, not a guarantee.
      </div>}
    </>}
    <div style={{padding:T.s3,background:`${T.gold}12`,border:`1px solid ${T.gold}30`,borderRadius:T.rMd,fontFamily:FP,fontSize:11,color:T.gold,lineHeight:1.6}}>
      This is a <strong>TARGET, not a guarantee.</strong> Aggressive return targets require high risk. This strategy could lose up to {lossPct||stats.maxDrawdown?.toFixed?.(0)||"a significant portion"}% of allocated capital. Past backtest performance does not predict live results. Not financial advice.
    </div>
  </div>;
}

// Progress card for a single enabled strategy. Uses the `progress` object from
// GET /api/bot/strategies: { current_value, pct_to_target, days_elapsed,
// days_horizon, trades_executed }. Degrades gracefully when progress is missing.
function StrategyProgressCard({strat}){
  const p=strat&&strat.progress;
  const capital=Number(strat?.capital_allocated)||0;
  const current=p&&p.current_value!=null?Number(p.current_value):null;
  const pnl=current!=null?current-capital:null;
  const pnlPct=current!=null&&capital>0?(pnl/capital)*100:null;
  const pctToTarget=p&&p.pct_to_target!=null?Math.max(0,Math.min(100,Number(p.pct_to_target))):null;
  const daysElapsed=p&&p.days_elapsed!=null?Number(p.days_elapsed):null;
  const daysHorizon=p&&p.days_horizon!=null?Number(p.days_horizon):(Number(strat?.time_horizon_days)||null);
  const trades=p&&p.trades_executed!=null?Number(p.trades_executed):null;
  const realized=p&&p.realized_pnl!=null?Number(p.realized_pnl):null;
  const closedCount=p&&p.closed_count!=null?Number(p.closed_count):0;
  const noData=current==null&&pctToTarget==null&&trades==null;
  const lyr=["manual","semi","full"].includes(strat.params?.layer)?strat.params.layer:(strat.mode==="full"?"full":"semi");
  const lyrColor=lyr==="full"?T.loss:lyr==="semi"?T.gold:T.blue;
  // Show the ticker the bot actually holds when there's an open position;
  // otherwise the universe it's screening.
  const held=p&&p.held_ticker;
  const cands=Array.isArray(strat.params?.universe_tickers)?strat.params.universe_tickers:[];
  const headline=held||(cands.length>1?`${cands.length} halal names`:(cands[0]||strat.ticker));
  // DCA (accumulation) strategies have no profit target / stop / horizon — read
  // them as "deploy & hold" instead of showing meaningless 0% values.
  const isDca=strat.strategy_type==="dca";
  const cadence=Number(strat.params?.dca_cadence_days)||7;
  const barLabel=isDca?"CAPITAL DEPLOYED":"PROGRESS TO TARGET";
  const barPct=isDca?(capital>0&&current!=null?Math.max(0,Math.min(100,(current/capital)*100)):0):pctToTarget;
  return<BentoTile accent={pnl!=null?(pnl>=0?T.gain:T.loss):T.blue} style={{display:"flex",flexDirection:"column",gap:T.s3}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
      <div style={{display:"flex",gap:T.s2,alignItems:"center"}}>
        <span style={{fontFamily:FM,fontSize:13,fontWeight:600,color:T.textHi}}>{headline}</span>
        {held&&cands.length>1&&<span style={{fontFamily:FM,fontSize:9,color:T.muted,letterSpacing:"0.06em"}}>HELD</span>}
        <Tag label={lyr.toUpperCase()} color={lyrColor}/>
        {isDca&&<Tag label="DCA" color={T.gain}/>}
      </div>
      <span style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.1em"}}>{isDca?`ACCUMULATE · ${cadence}D`:`TARGET ${strat.profit_target_pct}%`}</span>
    </div>
    {noData?<div style={{fontFamily:FP,fontSize:12,color:T.muted}}>Progress data not available yet — check back after the next bot run.</div>:<>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:T.s2}}>
        <div>
          <div style={{fontFamily:FM,fontSize:9,color:T.muted,letterSpacing:"0.1em",marginBottom:3}}>ALLOCATED</div>
          <div style={{fontFamily:FU,fontSize:18,fontWeight:700,color:T.textHi,fontVariantNumeric:"tabular-nums"}}>{f$(capital,0)}</div>
        </div>
        <div>
          <div style={{fontFamily:FM,fontSize:9,color:T.muted,letterSpacing:"0.1em",marginBottom:3}}>CURRENT VALUE</div>
          <div style={{fontFamily:FU,fontSize:18,fontWeight:700,color:pnl!=null?fc(pnl):T.textHi,fontVariantNumeric:"tabular-nums"}}>{current!=null?f$(current,0):"—"}</div>
          {pnl!=null&&<div style={{fontFamily:FM,fontSize:10,color:fc(pnl),fontWeight:600,fontVariantNumeric:"tabular-nums",marginTop:2}}>{pnl>=0?"+":"−"}{f$(pnl,0)} ({fp(pnlPct)})</div>}
        </div>
      </div>
      <div>
        <div style={{display:"flex",justifyContent:"space-between",fontFamily:FM,fontSize:10,color:T.muted,marginBottom:4,fontVariantNumeric:"tabular-nums"}}>
          <span style={{letterSpacing:"0.08em"}}>{barLabel}</span>
          <span style={{color:T.textHi,fontWeight:600}}>{barPct!=null?`${barPct.toFixed(0)}%`:"—"}</span>
        </div>
        <div style={{height:8,background:T.surface,borderRadius:999,overflow:"hidden",border:`1px solid ${T.border}`}}>
          <div style={{height:"100%",width:`${barPct||0}%`,background:`linear-gradient(90deg, ${T.gain}, ${T.blue})`,borderRadius:999,transition:"width 300ms cubic-bezier(0.16,1,0.3,1)"}}/>
        </div>
      </div>
      <div style={{display:"flex",justifyContent:"space-between",fontFamily:FM,fontSize:11,color:T.muted,fontVariantNumeric:"tabular-nums",borderTop:`1px solid ${T.border}`,paddingTop:T.s2}}>
        <span>{isDca?`Accumulate · hold (no auto-sell)`:`${daysElapsed!=null?`Day ${daysElapsed}`:"Day —"}${daysHorizon!=null?` of ${daysHorizon}`:""}`}</span>
        <span>{trades!=null?`${trades} ${isDca?"buy":"trade"}${trades===1?"":"s"}${isDca?"":" executed"}`:"— trades"}</span>
      </div>
      {realized!=null&&closedCount>0&&<div style={{display:"flex",justifyContent:"space-between",fontFamily:FM,fontSize:11,fontVariantNumeric:"tabular-nums"}}>
        <span style={{color:T.muted}}>Realized ({closedCount} closed)</span>
        <span style={{color:fc(realized),fontWeight:600}}>{`${realized>=0?"+":"−"}${f$(realized,0)}`}</span>
      </div>}
    </>}
  </BentoTile>;
}

function HistoricalBacktest(){
  const[symbol,setSymbol]=useState("AAPL");
  const[from,setFrom]=useState(()=>{const d=new Date();d.setFullYear(d.getFullYear()-2);return d.toISOString().slice(0,10);});
  const[to,setTo]=useState(()=>new Date().toISOString().slice(0,10));
  const[bars,setBars]=useState([]);
  const[busy,setBusy]=useState(false);
  const[err,setErr]=useState(null);

  const run=async()=>{
    setBusy(true);setErr(null);
    try{
      const r=await apiFetch(`/api/polygon/bars?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}`);
      const d=await r.json();
      if(!r.ok||d.error)throw new Error(d.error||`HTTP ${r.status}`);
      setBars(d.bars||[]);
    }catch(e){setErr(e.message||"Fetch failed");}
    finally{setBusy(false);}
  };

  // Compute SMAs + signal trades (shared helper, reused by the bot reality-check)
  const{series,trades,stats}=useMemo(()=>computeSmaBacktest(bars),[bars]);

  return<div className="bento-row mz-side-by-side" style={{display:"grid",gridTemplateColumns:"360px 1fr",gap:T.s4}}>
    <div style={{display:"flex",flexDirection:"column",gap:T.s4}}>
      <BentoTile style={{display:"flex",flexDirection:"column",gap:T.s3}}>
        <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600}}>BACKTEST INPUTS</div>
        <div>
          <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.14em",fontWeight:600,marginBottom:T.s1}}>SYMBOL</div>
          <input value={symbol} onChange={e=>setSymbol(e.target.value.toUpperCase())} className="field" style={{fontSize:16,fontWeight:600,color:T.blue,letterSpacing:"-0.01em"}}/>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:T.s2}}>
          <div><div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.14em",fontWeight:600,marginBottom:T.s1}}>FROM</div>
            <input type="date" value={from} onChange={e=>setFrom(e.target.value)} className="field" style={{fontSize:12}}/></div>
          <div><div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.14em",fontWeight:600,marginBottom:T.s1}}>TO</div>
            <input type="date" value={to} onChange={e=>setTo(e.target.value)} className="field" style={{fontSize:12}}/></div>
        </div>
        <div style={{padding:`${T.s3} ${T.s3}`,background:T.surface,borderRadius:T.rMd,border:`1px solid ${T.border}`,fontFamily:FP,fontSize:12,color:T.muted,lineHeight:1.55,letterSpacing:"-0.005em"}}>
          <strong style={{color:T.text,fontWeight:600}}>Strategy:</strong> SMA-50 / SMA-200 crossover. Buy when 50-day crosses above 200-day; sell on cross below. Free-tier Polygon caps at 2 years of daily bars.
        </div>
        <button onClick={run} disabled={busy} className="btn-primary" style={{padding:`10px ${T.s4}`}}>{busy?"Fetching bars…":"Run Backtest"}</button>
        {err&&<div style={{padding:`${T.s2} ${T.s3}`,background:T.lossBg,border:`1px solid ${T.loss}30`,borderRadius:T.rMd,fontFamily:FM,fontSize:11,color:T.loss}}>{ICON_NO}{err}</div>}
      </BentoTile>

      {bars.length>0&&<BentoTile>
        <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s3}}>RESULTS</div>
        {[
          ["Bars analyzed",stats.bars||0],
          ["Trades",stats.trades||0],
          ["Win rate",stats.trades?`${stats.winRate.toFixed(0)}% (${stats.wins}W/${stats.losses}L)`:"—"],
          ["Strategy return",stats.trades?`${stats.totalRet.toFixed(1)}%`:"—",stats.trades?fc(stats.totalRet):null],
          ["Buy & hold",`${(stats.buyHold||0).toFixed(1)}%`,fc(stats.buyHold||0)],
          ["Edge vs B&H",stats.trades?`${(stats.totalRet-stats.buyHold).toFixed(1)}%`:"—",stats.trades?fc(stats.totalRet-stats.buyHold):null],
        ].map(([l,v,clr])=><div key={l} style={{display:"flex",justifyContent:"space-between",padding:`${T.s2} 0`,borderBottom:`1px solid ${T.border}`,fontFamily:FM,fontSize:12}}>
          <span style={{color:T.muted,letterSpacing:"0.04em"}}>{l}</span>
          <span style={{color:clr||T.textHi,fontWeight:600,fontVariantNumeric:"tabular-nums"}}>{v}</span>
        </div>)}
      </BentoTile>}
    </div>

    <BentoTile>
      <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s3}}>{symbol} · CLOSE / SMA-50 / SMA-200</div>
      {bars.length===0
        ?<div style={{height:320,display:"flex",alignItems:"center",justifyContent:"center",border:`1px dashed ${T.border}`,borderRadius:T.rMd,fontFamily:FP,fontSize:13,color:T.muted}}>Run a backtest to load bars from Polygon</div>
        :<ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={series} margin={{top:6,right:14,bottom:8,left:14}}>
            <CartesianGrid stroke={T.border} strokeDasharray="2 4" vertical={false}/>
            <XAxis dataKey="date" tick={{fontFamily:FM,fontSize:10,fill:T.muted}} axisLine={{stroke:T.border}} tickLine={false} minTickGap={60}/>
            <YAxis tickFormatter={v=>`$${v.toFixed(0)}`} tick={{fontFamily:FM,fontSize:10,fill:T.muted}} axisLine={false} tickLine={false} width={60} domain={["auto","auto"]}/>
            <Tooltip contentStyle={{background:T.card,border:`1px solid ${T.borderHi}`,borderRadius:T.rMd,fontFamily:FM,fontSize:11,boxShadow:"var(--sh-md)"}} itemStyle={{color:T.textHi}} labelStyle={{color:T.muted}}/>
            <Line type="monotone" dataKey="c" stroke={T.text} strokeWidth={1.2} dot={false} name="Close"/>
            <Line type="monotone" dataKey="sma50" stroke={T.blue} strokeWidth={1.8} dot={false} name="SMA-50"/>
            <Line type="monotone" dataKey="sma200" stroke={T.gold} strokeWidth={1.8} dot={false} name="SMA-200"/>
          </ComposedChart>
        </ResponsiveContainer>}
      {trades.length>0&&<div style={{marginTop:T.s3,maxHeight:220,overflowY:"auto",background:T.surface,borderRadius:T.rMd,padding:T.s2,border:`1px solid ${T.border}`,fontFamily:FM,fontSize:11}}>
        {trades.slice(-20).reverse().map((t,i)=><div key={i} style={{display:"grid",gridTemplateColumns:"auto 1fr auto auto",gap:T.s3,padding:`5px ${T.s2}`,borderBottom:`1px solid ${T.border}`,alignItems:"center"}}>
          <Tag label={t.side} color={t.side==="BUY"?T.gain:T.loss}/>
          <span style={{color:T.muted,letterSpacing:"0.04em"}}>{t.date}</span>
          <span style={{color:T.textHi,fontWeight:500,fontVariantNumeric:"tabular-nums"}}>${t.price.toFixed(2)}</span>
          <span style={{color:t.return!=null?fc(t.return):T.muted,fontWeight:500,fontVariantNumeric:"tabular-nums",minWidth:50,textAlign:"right"}}>{t.return!=null?fp(t.return):"—"}</span>
        </div>)}
      </div>}
    </BentoTile>
  </div>;
}

// ── Trading Bot Panel ─────────────────────────────────────────────────────────
// Admin: full strategy management UI, NL builder, signals queue, kill switch
// Non-admin/demo: polished Coming Soon teaser showing the 3 layers
// The three execution layers. The bot's brain (screening, sizing, pricing) is
// identical across all three — the layer only decides who pulls the trigger.
const LAYER_META={
  manual:{label:"Manual",short:"M",color:T.blue,icon:"target",blurb:"The bot screens your halal universe, picks the ticker, sizes the position from allocated capital, and posts a ready-to-go signal. Nothing executes until YOU tap Execute on each one. No push, no auto-fire."},
  semi:{label:"Semi-auto",short:"S",color:T.gold,icon:"cpu",blurb:"The bot picks the full trade and sends you a push to approve. One tap approves and places it at your broker. Still never executes without your tap."},
  full:{label:"Full-auto",short:"F",color:T.loss,icon:"bolt",blurb:"The bot picks AND executes autonomously within your stop-loss, max-drawdown, daily cap, and the Sharia gate. Requires the per-account AUTO ON toggle below — off by default even here."},
};

function TradingBotPanel({view="strategies",isAdmin=false,fullAutoEnabled=false,isRoot=false,consented=false,snapAccounts=[],demoMode=false,onNav}){
  const showStrat=view==="strategies";
  // Beta (non-root) users get Manual/Semi only — full-auto is owner-only. The
  // server rejects layer="full" for them too; this keeps the UI honest.
  const LAYERS=isRoot?["manual","semi","full"]:["manual","semi"];
  // First-use consent gate (non-root only). Local flip after Accept avoids a refetch.
  const[consentedLocal,setConsentedLocal]=useState(consented);
  const needsConsent=!demoMode&&!isRoot&&!consentedLocal;
  const[consentBusy,setConsentBusy]=useState(false);
  const acceptConsent=async()=>{
    if(consentBusy)return;setConsentBusy(true);
    try{const r=await apiFetch("/api/bot/consent",{method:"POST"});if(r.ok)setConsentedLocal(true);}
    catch{}finally{setConsentBusy(false);}
  };
  const showSignals=view==="signals";
  const[strategies,setStrategies]=useState([]);
  const[signals,setSignals]=useState([]);
  const[loadingStrats,setLoadingStrats]=useState(false);
  const[loadingSignals,setLoadingSignals]=useState(false);
  const[nlInput,setNlInput]=useState("");
  const[nlBusy,setNlBusy]=useState(false);
  const[nlResult,setNlResult]=useState(null); // parsed strategy from NL
  const[nlErr,setNlErr]=useState(null);
  const[nlAccount,setNlAccount]=useState(""); // brokerage account the strategy runs on
  const[riskAck,setRiskAck]=useState(false);
  const acctId=a=>a.accountId||a.id; // SnapTrade accounts expose either shape
  // Halal Bogleheads quick-preset picker. Sleeves come from the server (single
  // source of truth); the user picks a ticker per sleeve + optional tilts, and we
  // POST the selection back for a server-validated preset that reuses the review flow.
  const[bogleSleeves,setBogleSleeves]=useState([]);
  const[bogleOpen,setBogleOpen]=useState(false);
  const[bogleSel,setBogleSel]=useState({us:"SPUS",intl:"SPWO",sukuk:"SPSK"});
  const[bogleBusy,setBogleBusy]=useState(false);
  const[killSwitchBusy,setKillSwitchBusy]=useState(false);
  const[killSwitchMsg,setKillSwitchMsg]=useState(null);
  // Per-account full-auto opt-in map: { [accountId]: true }
  const[faAccounts,setFaAccounts]=useState({});
  // Layer-change acknowledgment gate: { strat, target } while confirming.
  const[layerModal,setLayerModal]=useState(null);
  const[layerAck,setLayerAck]=useState(false);
  // In-place strategy edit: the strategy being edited + its working form values.
  const[editStrat,setEditStrat]=useState(null);
  const[editForm,setEditForm]=useState(null);
  const[editBusy,setEditBusy]=useState(false);
  const[editErr,setEditErr]=useState(null);
  const[editAck,setEditAck]=useState(false);
  // Default execution layer applied to NEW strategies (each strategy can still
  // override its own below). Persisted per-device.
  const[defaultLayer,setDefaultLayer]=useState(()=>{try{const v=localStorage.getItem("mizan_bot_default_layer")||"semi";return(v==="full"&&!isRoot)?"semi":v;}catch{return"semi";}});
  const setDefLayer=k=>{setDefaultLayer(k);try{localStorage.setItem("mizan_bot_default_layer",k);}catch{}};
  const allPaused=strategies.length>0&&strategies.every(s=>!s.enabled);

  // The execution LAYER is the user-facing choice; it lives in params.layer.
  // Fall back to the DB mode for strategies created before layers existed.
  const layerOf=s=>["manual","semi","full"].includes(s.params?.layer)?s.params.layer:(s.mode==="full"?"full":"semi");
  const requestLayer=(strat,target)=>{if(layerOf(strat)===target)return;setLayerAck(false);setLayerModal({strat,target});};
  const confirmLayer=async()=>{
    if(!layerModal||!layerAck)return;
    const{strat,target}=layerModal;
    setLayerModal(null);setLayerAck(false);
    await apiFetch(`/api/bot/strategies/${strat.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({layer:target})});
    await loadStrategies();
  };

  const loadStrategies=useCallback(async()=>{
    setLoadingStrats(true);
    try{
      const r=await apiFetch("/api/bot/strategies");
      const d=await r.json();
      if(r.ok)setStrategies(d.strategies||[]);
    }catch{}finally{setLoadingStrats(false);}
  },[]);

  const loadFaAccounts=useCallback(async()=>{
    try{
      const r=await apiFetch("/api/bot/full-auto-accounts");
      const d=await r.json();
      if(r.ok)setFaAccounts(Object.fromEntries((d.accounts||[]).map(a=>[a.account_id,!!a.enabled])));
    }catch{}
  },[]);

  const toggleFaAccount=async(accountId,next)=>{
    setFaAccounts(p=>({...p,[accountId]:next})); // optimistic
    try{
      const r=await apiFetch(`/api/bot/full-auto-accounts/${encodeURIComponent(accountId)}`,{
        method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled:next}),
      });
      if(!r.ok)setFaAccounts(p=>({...p,[accountId]:!next})); // rollback on failure
    }catch{setFaAccounts(p=>({...p,[accountId]:!next}));}
  };

  const loadSignals=useCallback(async()=>{
    setLoadingSignals(true);
    try{
      const r=await apiFetch("/api/bot/signals");
      const d=await r.json();
      if(r.ok)setSignals(d.signals||[]);
    }catch{}finally{setLoadingSignals(false);}
  },[]);

  // Realized-P&L ledger (closed round-trips across all strategies).
  const[ledger,setLedger]=useState(null);
  const loadLedger=useCallback(async()=>{
    try{
      const r=await apiFetch("/api/bot/trades");
      const d=await r.json();
      if(r.ok)setLedger(d);
    }catch{}
  },[]);

  // Bot activity timeline — every signal the bot generated + its outcome.
  // Sourced from the bot's own ledger, so a full-auto fill shows here instantly
  // (before it reaches the broker-synced Portfolio → Activity tab).
  const[activity,setActivity]=useState(null);
  const[loadingActivity,setLoadingActivity]=useState(false);
  const loadActivity=useCallback(async()=>{
    setLoadingActivity(true);
    try{
      const r=await apiFetch("/api/bot/activity");
      const d=await r.json();
      if(r.ok)setActivity(d.items||[]);
    }catch{}finally{setLoadingActivity(false);}
  },[]);

  useEffect(()=>{if(isAdmin&&!demoMode){loadStrategies();loadSignals();loadLedger();loadActivity();if(fullAutoEnabled)loadFaAccounts();}},[isAdmin,demoMode,fullAutoEnabled,loadStrategies,loadSignals,loadLedger,loadActivity,loadFaAccounts]);

  const activateKillSwitch=async()=>{
    if(!window.confirm("Pause ALL bot automation? No signals will execute until you re-enable strategies."))return;
    setKillSwitchBusy(true);
    try{
      await apiFetch("/api/bot/strategies/pause-all",{method:"PATCH",headers:{"Content-Type":"application/json"},body:"{}"});
      setKillSwitchMsg("All automation paused.");
      await loadStrategies();
    }catch{setKillSwitchMsg("Failed to pause.");}finally{
      setKillSwitchBusy(false);
      setTimeout(()=>setKillSwitchMsg(null),4000);
    }
  };

  const parseNl=async()=>{
    if(!nlInput.trim()||nlBusy)return;
    setNlBusy(true);setNlErr(null);setNlResult(null);setRiskAck(false);
    try{
      const accounts=snapAccounts.map(a=>({id:a.id||a.accountId,name:a.institution_name||a.brokerage?.name||a.name||"Unknown"}));
      const r=await apiFetch("/api/bot/strategy/nl",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({description:nlInput.trim(),accounts}),
      });
      const d=await r.json();
      if(!r.ok){setNlErr(d.error||"Parse failed");return;}
      // A refusal comes back as 200 { error } (no strategy). Surface it instead
      // of silently rendering nothing.
      if(d.error){setNlErr(d.error);return;}
      if(!d.strategy){setNlErr("Couldn't build a strategy from that. Try naming a ticker or theme, an amount, and your entry/exit rule (e.g. “Buy SPUS dips ~7%, take profit ~10%, $50”).");return;}
      setNlResult(d.strategy);
      // Default the account selector to the model-resolved account, else the
      // first connected brokerage. The user can change it before activating.
      const resolved=snapAccounts.find(a=>acctId(a)===d.strategy.account_id);
      setNlAccount(resolved?acctId(resolved):(snapAccounts[0]?acctId(snapAccounts[0]):""));
    }catch(e){setNlErr(e.message||"Network error");}finally{setNlBusy(false);}
  };

  // Load the Bogleheads sleeve menu once the panel is live (trading-enabled only).
  useEffect(()=>{
    if(!isAdmin||demoMode)return;
    apiFetch("/api/bot/bogleheads").then(r=>r.ok?r.json():null).then(d=>{if(d?.sleeves)setBogleSleeves(d.sleeves);}).catch(()=>{});
  },[isAdmin,demoMode]);

  // Toggle a sleeve pick. Core sleeves always keep one selection; optional tilts
  // (tech/reit) toggle off when their active ticker is clicked again.
  const pickSleeve=(sleeve,ticker)=>setBogleSel(prev=>{
    const next={...prev};
    if(!sleeve.core&&next[sleeve.key]===ticker)delete next[sleeve.key];
    else next[sleeve.key]=ticker;
    return next;
  });

  // Build a server-validated preset from the current sleeve picks and hand it to
  // the same review + activate flow the NL builder uses (setNlResult).
  const buildBoglehead=async()=>{
    if(bogleBusy)return;setBogleBusy(true);setNlErr(null);
    try{
      const account=nlAccount||(snapAccounts[0]?acctId(snapAccounts[0]):null);
      const r=await apiFetch("/api/bot/bogleheads",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({account_id:account,sel:bogleSel})});
      const d=await r.json().catch(()=>({}));
      if(!r.ok||!d.strategy){setNlErr(d.error==="invalid_selection"?"Pick a ticker for the three core sleeves (US · International · Sukuk).":(d.error||"Couldn't build the preset."));return;}
      setNlResult(d.strategy);setRiskAck(false);setBogleOpen(false);
      const resolved=snapAccounts.find(a=>acctId(a)===d.strategy.account_id);
      setNlAccount(resolved?acctId(resolved):(snapAccounts[0]?acctId(snapAccounts[0]):""));
    }catch(e){setNlErr(e.message||"Network error");}finally{setBogleBusy(false);}
  };

  const saveNlStrategy=async()=>{
    if(!nlResult||!riskAck)return;
    if(!nlAccount){setNlErr("Select a brokerage account to run this strategy on.");return;}
    // Deployable cap (authoritative): capital_allocated = deploy_pct% of the
    // selected account's buying power, hard-capped at 50% so the rest is reserved.
    const acc=snapAccounts.find(a=>acctId(a)===nlAccount);
    const bp=Number(acc?.cash ?? acc?.balance ?? 0);
    const deployPct=Math.min(100,Math.max(5,Math.round(Number(nlResult.params?.deploy_pct||25))||25));
    const capital=bp>0?Math.floor(bp*deployPct/100):Number(nlResult.capital_allocated||0);
    try{
      const r=await apiFetch("/api/bot/strategies",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({...nlResult,capital_allocated:capital,params:{...(nlResult.params||{}),deploy_pct:deployPct},account_id:nlAccount,layer:defaultLayer,nl_description:nlInput,nl_risk_disclosed:true}),
      });
      const d=await r.json().catch(()=>({}));
      if(r.ok){setNlResult(null);setNlInput("");setRiskAck(false);setNlErr(null);await loadStrategies();}
      else setNlErr(d.error==="stop_loss_required"?"Strategy needs a stop-loss (the AI should set one — try re-parsing).":(d.error||"Couldn't activate the strategy."));
    }catch(e){setNlErr(e.message||"Network error");}
  };

  const approveSignal=async(id)=>{
    await apiFetch(`/api/bot/signals/${id}/approve`,{method:"POST"});
    // A filled signal may have closed a position — refresh strategies + ledger + activity too.
    await Promise.all([loadSignals(),loadStrategies(),loadLedger(),loadActivity()]);
  };
  const rejectSignal=async(id)=>{
    await apiFetch(`/api/bot/signals/${id}/reject`,{method:"POST"});
    await Promise.all([loadSignals(),loadActivity()]);
  };

  const deleteStrategy=async(id)=>{
    if(!window.confirm("Delete this strategy?"))return;
    await apiFetch(`/api/bot/strategies/${id}`,{method:"DELETE"});
    await loadStrategies();
  };

  const toggleStrategy=async(id,enabled)=>{
    await apiFetch(`/api/bot/strategies/${id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled:!enabled})});
    await loadStrategies();
  };

  // ── In-place strategy editing ─────────────────────────────────────────────
  // Structured edit (no model call): pre-fill a form from the saved strategy and
  // PATCH the changed fields. The backend re-enforces the stop-loss compliance
  // gate and read-modify-writes params so universe/layer/rules survive the edit.
  const openEdit=(s)=>{
    setEditErr(null);setEditAck(false);
    setEditStrat(s);
    setEditForm({
      ticker:s.ticker||"",
      account_id:s.account_id||"",
      strategy_type:s.strategy_type||"",
      universe_tickers:(Array.isArray(s.params?.universe_tickers)?s.params.universe_tickers:[]).join(", "),
      capital_allocated:s.capital_allocated??0,
      profit_target_pct:s.profit_target_pct??"",
      stop_loss_pct:s.stop_loss_pct??"",
      max_drawdown_pct:s.max_drawdown_pct??"",
      time_horizon_days:s.time_horizon_days??"",
      max_trades_per_day:s.max_trades_per_day??"",
    });
  };
  const saveEdit=async()=>{
    if(!editStrat||editBusy)return;
    const f=editForm;
    if(!(Number(f.stop_loss_pct)>0)){setEditErr("Stop-loss is required and must be greater than 0% — it can never be removed.");return;}
    if(!String(f.ticker||"").trim()){setEditErr("Ticker can't be blank.");return;}
    if(!String(f.account_id||"").trim()){setEditErr("Pick a brokerage account.");return;}
    setEditBusy(true);setEditErr(null);
    try{
      const body={
        ticker:f.ticker,account_id:f.account_id,strategy_type:f.strategy_type,
        universe_tickers:String(f.universe_tickers||"").split(",").map(t=>t.trim()).filter(Boolean),
        capital_allocated:Number(f.capital_allocated)||0,
        profit_target_pct:f.profit_target_pct===""?null:Number(f.profit_target_pct),
        stop_loss_pct:Number(f.stop_loss_pct),
        max_drawdown_pct:f.max_drawdown_pct===""?null:Number(f.max_drawdown_pct),
        time_horizon_days:f.time_horizon_days===""?null:Number(f.time_horizon_days),
        max_trades_per_day:f.max_trades_per_day===""?null:Number(f.max_trades_per_day),
      };
      const r=await apiFetch(`/api/bot/strategies/${editStrat.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      const d=await r.json().catch(()=>({}));
      if(r.ok){setEditStrat(null);setEditForm(null);setEditAck(false);await loadStrategies();}
      else setEditErr(d.error==="stop_loss_required"?"Stop-loss is required and must be greater than 0%.":(d.error||`Couldn't save changes (${r.status}).`));
    }catch(e){setEditErr(e.message||"Network error");}finally{setEditBusy(false);}
  };

  // ── NON-ADMIN / DEMO VIEW ──────────────────────────────────────────────────
  if(!isAdmin||demoMode){
    const layers=[
      {id:"manual",icon:"target",title:"Manual Control",desc:"The bot screens your halal universe, picks the ticker, sizes the position, and hands you a ready-to-go signal. You tap Execute on each — nothing fires on its own. Every order is AAOIFI-screened first.",badge:"Live Soon",badgeColor:T.blue},
      {id:"semi",icon:"cpu",title:"Semi-Automatic",desc:"Same bot-picked signals, delivered as a push you approve. One tap places the trade at your broker — no trade executes without your tap.",badge:"Coming Soon",badgeColor:T.gold},
      {id:"full",icon:"bolt",title:"Fully Automated",desc:"The bot picks AND executes autonomously within your strategy, stop-loss, daily caps, and Sharia gate. Per-account opt-in, off by default. Every execution is logged and push-notified.",badge:"Coming Soon",badgeColor:T.slate},
    ];
    return<div style={{display:"flex",flexDirection:"column",gap:T.s5}}>
      <BentoTile style={{textAlign:"center",padding:`${T.s8} ${T.s6}`}}>
        <div style={{fontFamily:FM,fontSize:10,color:T.blue,letterSpacing:"0.2em",fontWeight:600,marginBottom:T.s3}}>COMING SOON</div>
        <div style={{fontFamily:FU,fontSize:32,fontWeight:700,color:T.textHi,letterSpacing:"-0.025em",marginBottom:T.s3}}>MĪZAN Trading Bot</div>
        <p style={{fontFamily:FP,fontSize:14,color:T.muted,maxWidth:560,margin:`0 auto ${T.s4}`,lineHeight:1.65}}>
          Halal systematic trading — manual, assisted, or fully automated. Every trade is screened against AAOIFI standards before it reaches your broker.
        </p>
        <div style={{display:"inline-flex",alignItems:"center",gap:T.s2,padding:`6px ${T.s3}`,borderRadius:T.rMd,background:`${T.blue}15`,border:`1px solid ${T.blue}30`,fontFamily:FM,fontSize:11,color:T.blue}}>
          All positions Sharia-screened · Stop-loss mandatory · No riba
        </div>
      </BentoTile>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(240px, 1fr))",gap:T.s4}}>
        {layers.map(l=><BentoTile key={l.id} style={{display:"flex",flexDirection:"column",gap:T.s3}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
            <Icon name={l.icon} size={24} color={l.badgeColor}/>
            <Tag label={l.badge} color={l.badgeColor}/>
          </div>
          <div style={{fontFamily:FM,fontSize:12,fontWeight:600,color:T.textHi,letterSpacing:"0.02em"}}>{l.title}</div>
          <p style={{fontFamily:FP,fontSize:12,color:T.muted,lineHeight:1.6,margin:0}}>{l.desc}</p>
        </BentoTile>)}
      </div>

      {/* Demo preview: disabled order ticket form */}
      <BentoTile style={{position:"relative",overflow:"hidden",opacity:0.75}}>
        <div style={{position:"absolute",top:T.s3,right:T.s3,padding:`4px ${T.s2}`,background:`${T.blue}20`,border:`1px solid ${T.blue}40`,borderRadius:T.rSm,fontFamily:FM,fontSize:9,color:T.blue,fontWeight:600,letterSpacing:"0.1em",zIndex:1}}>PREVIEW · ADMIN ONLY</div>
        <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s3}}>ORDER TICKET</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:T.s3,opacity:0.6,pointerEvents:"none"}}>
          {[["Symbol","SPUS"],["Quantity","10"],["Order Type","Market"],["Side","Buy"]].map(([l,v])=><div key={l}>
            <div style={{fontFamily:FM,fontSize:9,color:T.muted,marginBottom:4,letterSpacing:"0.08em"}}>{l.toUpperCase()}</div>
            <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:T.rMd,padding:`8px ${T.s3}`,fontFamily:FM,fontSize:13,color:T.textHi}}>{v}</div>
          </div>)}
        </div>
        <div style={{marginTop:T.s3,height:36,background:`${T.blue}20`,borderRadius:T.rMd,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:FM,fontSize:11,color:`${T.blue}60`,letterSpacing:"0.1em",opacity:0.6}}>PREVIEW — SHARIA SCREEN + ORDER PREVIEW</div>
      </BentoTile>

      {/* Sample signal card */}
      <BentoTile accent={T.gold} style={{opacity:0.75}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",marginBottom:4}}>BOT SIGNAL · PREVIEW</div>
            <div style={{fontFamily:FM,fontSize:14,fontWeight:600,color:T.textHi}}>BUY 5 SPUS · Momentum strategy</div>
            <div style={{fontFamily:FM,fontSize:11,color:T.gold,marginTop:4}}>Suggested at $62.18 · Expires in 58 min</div>
          </div>
          <div style={{display:"flex",gap:T.s2,opacity:0.5,pointerEvents:"none"}}>
            <button className="btn-primary" style={{fontSize:11,padding:`6px ${T.s3}`}}>Approve</button>
            <button className="btn-ghost" style={{fontSize:11,padding:`6px ${T.s3}`}}>Reject</button>
          </div>
        </div>
      </BentoTile>
    </div>;
  }

  // ── ADMIN VIEW ─────────────────────────────────────────────────────────────
  return<div style={{display:"flex",flexDirection:"column",gap:T.s5}}>
    {/* Kill Switch */}
    <BentoTile accent={allPaused?T.loss:T.gain} style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:T.s3}}>
      <div>
        <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:4}}>AUTOMATION STATUS</div>
        <div style={{display:"flex",alignItems:"center",gap:T.s2,fontFamily:FM,fontSize:14,fontWeight:600,color:allPaused?T.loss:T.gain}}>
          {strategies.length===0?"No strategies configured":allPaused?<><Icon name="pause" size={14} color={T.loss}/>All automation paused</>:<><Icon name="play" size={14} color={T.gain}/>Automation running</>}
        </div>
      </div>
      <div style={{display:"flex",gap:T.s3,alignItems:"center"}}>
        {killSwitchMsg&&<span style={{fontFamily:FM,fontSize:11,color:T.muted}}>{killSwitchMsg}</span>}
        {strategies.some(s=>s.enabled)&&<button onClick={activateKillSwitch} disabled={killSwitchBusy} style={{display:"inline-flex",alignItems:"center",gap:6,padding:`8px ${T.s4}`,borderRadius:T.rMd,border:`1px solid ${T.loss}60`,background:`${T.loss}15`,color:T.loss,fontFamily:FM,fontSize:11,fontWeight:600,letterSpacing:"0.08em",cursor:"pointer"}}><Icon name="stop" size={12} color={T.loss}/>PAUSE ALL</button>}
      </div>
    </BentoTile>

    {/* First-use consent gate (beta / non-root). Until accepted, the builder and
        default-layer card are hidden — the server also blocks create/execute. */}
    {showStrat&&needsConsent&&<BentoTile accent={T.gold} style={{background:`linear-gradient(135deg, ${T.gold}10, transparent 60%), ${T.card}`}}>
      <div style={{fontFamily:FM,fontSize:10,color:T.gold,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>BEFORE YOU START · BETA</div>
      <p style={{fontFamily:FP,fontSize:13,color:T.text,lineHeight:1.7,margin:`0 0 ${T.s3}`}}>
        Trade is an <strong>experimental beta</strong>. <strong>Mizan is not a registered investment adviser (RIA)</strong> and this is <strong>not financial advice</strong>. You build your own strategies and they run only on <strong>your own connected brokerage</strong> — <strong>you approve every trade yourself</strong> (no autonomous execution). Trading carries real risk: <strong>you can lose money, up to your full allocated capital</strong>. Stop-loss, max-drawdown, the daily cap, and the Sharia gate stay enforced, but they don't guarantee against loss.
      </p>
      <button onClick={acceptConsent} disabled={consentBusy} className="btn-primary" style={{fontSize:11,opacity:consentBusy?0.6:1}}>{consentBusy?"Saving…":"I understand — enable Trade for my account"}</button>
    </BentoTile>}

    {/* Execution Layer — the 3-layer premise, front and center. Sets the default
        for NEW strategies; each strategy still overrides its own layer below. */}
    {showStrat&&!needsConsent&&<BentoTile>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",flexWrap:"wrap",gap:T.s2,marginBottom:T.s3}}>
        <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600}}>EXECUTION LAYER · DEFAULT FOR NEW STRATEGIES</div>
        <div style={{fontFamily:FM,fontSize:10,color:T.muted}}>Each strategy overrides its own below</div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3, 1fr)",gap:T.s2}}>
        {LAYERS.map(k=>{const m=LAYER_META[k];const on=defaultLayer===k;const n=k==="manual"?"1":k==="semi"?"2":"3";return(
          <button key={k} onClick={()=>setDefLayer(k)} style={{
            display:"flex",flexDirection:"column",gap:5,alignItems:"flex-start",textAlign:"left",
            padding:T.s3,borderRadius:T.rMd,cursor:"pointer",transition:"all 0.15s",
            border:`1px solid ${on?m.color:T.border}`,
            background:on?`${m.color}14`:"transparent",
          }}>
            <div style={{display:"flex",alignItems:"center",gap:T.s2,width:"100%"}}>
              <Icon name={m.icon} size={18} color={on?m.color:T.muted}/>
              <span style={{fontFamily:FM,fontSize:9,color:on?m.color:T.muted,letterSpacing:"0.1em",fontWeight:600,marginLeft:"auto"}}>LAYER {n}</span>
            </div>
            <span style={{fontFamily:FM,fontSize:12,fontWeight:600,color:on?m.color:T.textHi}}>{m.label}</span>
          </button>
        );})}
      </div>
      <p style={{fontFamily:FP,fontSize:12,color:T.muted,lineHeight:1.6,margin:`${T.s3} 0 0`}}>{LAYER_META[defaultLayer].blurb}</p>
      {defaultLayer==="full"&&<div style={{marginTop:T.s2,fontFamily:FM,fontSize:11,color:T.loss}}>Full-auto still requires the per-account AUTO ON toggle below — off by default even here.</div>}
    </BentoTile>}

    {/* Quick Preset — Halal Bogleheads lazy portfolio. One-tap, per-sleeve pickable
        (US · International · Sukuk core, optional tech & REIT tilts). Builds a
        server-validated DCA basket and drops into the same review flow below. */}
    {showStrat&&!needsConsent&&<BentoTile accent={T.gain}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:T.s3,flexWrap:"wrap"}}>
        <div style={{minWidth:200,flex:1}}>
          <div style={{fontFamily:FM,fontSize:10,color:T.gain,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>QUICK PRESET · HALAL LAZY PORTFOLIO</div>
          <div style={{fontFamily:FU,fontSize:18,fontWeight:700,color:T.textHi,letterSpacing:"-0.02em",marginBottom:4}}>Halal Bogleheads</div>
          <p style={{fontFamily:FP,fontSize:12,color:T.muted,lineHeight:1.6,margin:0}}>The Islamic three-fund lazy portfolio — US equity, international, and sukuk (halal fixed income). Weekly DCA that rebalances via new contributions and holds long-term. Never auto-sells.</p>
        </div>
        <button onClick={()=>setBogleOpen(o=>!o)} className={bogleOpen?"btn-ghost":"btn-primary"} style={{fontSize:11,whiteSpace:"nowrap"}}>{bogleOpen?"Close":"Configure →"}</button>
      </div>

      {bogleOpen&&<div style={{marginTop:T.s4,paddingTop:T.s4,borderTop:`1px solid ${T.border}`}}>
        {bogleSleeves.length===0
          ?<div style={{fontFamily:FM,fontSize:11,color:T.muted}}>Loading preset options…</div>
          :<div style={{display:"flex",flexDirection:"column",gap:T.s3}}>
            {bogleSleeves.map(s=>{
              const active=bogleSel[s.key];
              const included=s.core||!!active;
              return<div key={s.key} style={{opacity:included?1:0.6}}>
                <div style={{display:"flex",alignItems:"baseline",gap:T.s2,marginBottom:T.s2,flexWrap:"wrap"}}>
                  <span style={{fontFamily:FM,fontSize:11,fontWeight:600,color:T.textHi,letterSpacing:"0.02em"}}>{s.label}</span>
                  <span style={{fontFamily:FM,fontSize:10,color:T.muted,fontVariantNumeric:"tabular-nums"}}>~{Math.round(s.weight*100)}%</span>
                  {s.core
                    ?<span style={{fontFamily:FM,fontSize:9,color:T.gain,letterSpacing:"0.08em"}}>CORE</span>
                    :<span style={{fontFamily:FM,fontSize:9,color:T.muted,letterSpacing:"0.08em"}}>{active?"ON · tap to remove":"OPTIONAL TILT"}</span>}
                </div>
                <div style={{display:"flex",gap:T.s2,flexWrap:"wrap"}}>
                  {s.options.map(o=>{
                    const on=active===o.ticker;
                    return<button key={o.ticker} onClick={()=>pickSleeve(s,o.ticker)} style={{
                      display:"flex",flexDirection:"column",gap:2,alignItems:"flex-start",textAlign:"left",
                      padding:`${T.s2} ${T.s3}`,borderRadius:T.rMd,cursor:"pointer",transition:"all 0.15s",
                      border:`1px solid ${on?T.gain:T.border}`,background:on?`${T.gain}14`:"transparent",minWidth:150,
                    }}>
                      <span style={{fontFamily:FM,fontSize:12,fontWeight:600,color:on?T.gain:T.textHi,letterSpacing:"0.04em"}}>{o.ticker}</span>
                      <span style={{fontFamily:FP,fontSize:10,color:T.muted,lineHeight:1.4}}>{o.name} · {o.expense}% ER</span>
                    </button>;
                  })}
                </div>
              </div>;
            })}
            <div style={{fontFamily:FM,fontSize:10,color:T.dim,lineHeight:1.5,marginTop:T.s1}}>Weights are targets — the bot buys the most-underweight affordable member each week to converge on them. You set the weekly amount + account in the review below.</div>
            <div><button onClick={buildBoglehead} disabled={bogleBusy} className="btn-primary" style={{fontSize:11,opacity:bogleBusy?0.6:1}}>{bogleBusy?"Building…":"Build Halal Bogleheads →"}</button></div>
          </div>}
      </div>}
    </BentoTile>}

    {/* NL Strategy Builder */}
    {showStrat&&!needsConsent&&<BentoTile>
      <div style={{fontFamily:FM,fontSize:10,color:T.blue,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s3}}>NATURAL LANGUAGE STRATEGY BUILDER</div>
      <p style={{fontFamily:FP,fontSize:12,color:T.muted,marginBottom:T.s3,lineHeight:1.6}}>Describe a trading goal in plain English. The AI parses it into a structured, risk-bounded strategy with mandatory stop-loss.</p>
      <textarea value={nlInput} onChange={e=>setNlInput(e.target.value)} placeholder='e.g. "Use $500 in my E*Trade account, run a momentum swing-trade on SPUS, target 20% return, within 4 weeks"' style={{width:"100%",minHeight:80,background:T.surface,border:`1px solid ${T.border}`,borderRadius:T.rMd,padding:T.s3,fontFamily:FP,fontSize:13,color:T.textHi,resize:"vertical",boxSizing:"border-box"}}/>
      {nlErr&&<div style={{fontFamily:FM,fontSize:11,color:T.loss,marginTop:T.s2}}>{nlErr}</div>}
      <button onClick={parseNl} disabled={nlBusy||!nlInput.trim()} className="btn-primary" style={{marginTop:T.s3,fontSize:11}}>{nlBusy?"Parsing…":"Parse Strategy"}</button>

      {/* Strategy Review Modal (inline) — honest reality-check before activation */}
      {nlResult&&(()=>{
        const params=nlResult.params||{};
        const universe=params.universe||nlResult.ticker;
        const cands=Array.isArray(nlResult.universe_tickers)&&nlResult.universe_tickers.length?nlResult.universe_tickers:(Array.isArray(params.universe_tickers)?params.universe_tickers:[]);
        const entryRules=params.entry_rules;
        const exitRules=params.exit_rules;
        const posSize=params.position_size_pct!=null?params.position_size_pct:nlResult.position_size_pct;
        const rule=v=>Array.isArray(v)?v.join(", "):(v||"—");
        const plain=[
          ["Universe",rule(universe)],
          ["Bot screens & picks from",cands.length?cands.join(", "):(nlResult.ticker||"—")],
          ["Strategy type",nlResult.strategy_type||"—"],
          ["Entry rules",rule(entryRules)],
          ["Exit rules",rule(exitRules)],
          ["Position size",posSize!=null?`${posSize}% of deployable capital`:"—"],
          ["Profit target (GOAL)",`${nlResult.profit_target_pct}%`],
          ["Stop loss",`${nlResult.stop_loss_pct}%`],
          ["Max drawdown",nlResult.max_drawdown_pct!=null?`${nlResult.max_drawdown_pct}%`:"—"],
          ["Time horizon",`${nlResult.time_horizon_days} days`],
          ["Max trades / day",nlResult.max_trades_per_day!=null?`${nlResult.max_trades_per_day}`:"—"],
        ];
        return<div style={{marginTop:T.s4,padding:T.s4,background:T.surface,borderRadius:T.rMd,border:`1px solid ${T.border}`}}>
        <div style={{fontFamily:FM,fontSize:10,color:T.gold,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s3}}>STRATEGY REVIEW · REALITY CHECK</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:`${T.s1} ${T.s4}`,marginBottom:T.s3}}>
          {plain.map(([k,v])=><div key={k} style={{display:"flex",justifyContent:"space-between",gap:T.s2,padding:`5px 0`,borderBottom:`1px solid ${T.border}`,fontFamily:FM,fontSize:11,fontVariantNumeric:"tabular-nums"}}>
            <span style={{color:T.muted,letterSpacing:"0.02em"}}>{k}</span>
            <span style={{color:k==="Profit target (GOAL)"?T.gold:T.textHi,fontWeight:600,textAlign:"right"}}>{v}</span>
          </div>)}
        </div>

        {/* Brokerage account selector — the strategy runs on this connected account.
            Defaults to the account the AI resolved from your text, else the first one. */}
        <div style={{marginBottom:T.s3}}>
          <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.12em",fontWeight:600,marginBottom:T.s1}}>BROKERAGE ACCOUNT</div>
          {snapAccounts.length===0
            ?<div style={{fontFamily:FM,fontSize:11,color:T.loss}}>No brokerage connected. Connect one in Settings → Connections before activating.</div>
            :<select value={nlAccount} onChange={e=>setNlAccount(e.target.value)} className="field" style={{width:"100%"}}>
              {snapAccounts.map(a=>{const id=acctId(a);return<option key={id} value={id}>{(a.brokerage||a.name||"Account")}{a.accountName?` — ${a.accountName}`:""}{a.balance!=null?` (${kf(a.balance)})`:""}</option>;})}
            </select>}
          {nlResult.account_id&&!snapAccounts.find(a=>acctId(a)===nlResult.account_id)&&<div style={{fontFamily:FM,fontSize:10,color:T.gold,marginTop:4}}>Couldn’t match “{nlResult.account_id}” to a connected account — pick one above.</div>}
        </div>

        {/* Deployable capital — how much of THIS account's buying power the strategy
            may use. Hard-capped at 50%; the rest stays untouched in every mode. */}
        {(()=>{
          const acc=snapAccounts.find(a=>acctId(a)===nlAccount);
          const bp=Number(acc?.cash ?? acc?.balance ?? 0);
          const f=n=>"$"+Number(n||0).toLocaleString("en-US",{maximumFractionDigits:0});
          const pct=Math.min(100,Math.max(5,Math.round(Number(nlResult.params?.deploy_pct ?? (bp>0?(Number(nlResult.capital_allocated||0)/bp)*100:25))||25)));
          const deployable=bp>0?Math.floor(bp*pct/100):Number(nlResult.capital_allocated||0);
          const reserve=Math.max(0,bp-deployable);
          const setPct=np=>{const c=Math.min(100,Math.max(5,np));setNlResult(prev=>({...prev,capital_allocated:bp>0?Math.floor(bp*c/100):prev.capital_allocated,params:{...(prev.params||{}),deploy_pct:c}}));};
          return<div style={{marginBottom:T.s3}}>
            <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.12em",fontWeight:600,marginBottom:T.s2}}>DEPLOYABLE CAPITAL</div>
            {bp>0?<>
              <div style={{display:"flex",justifyContent:"space-between",gap:T.s2,fontFamily:FM,fontSize:11,marginBottom:T.s2,flexWrap:"wrap"}}>
                <span style={{color:T.muted}}>Buying power <span style={{color:T.textHi,fontWeight:600}}>{f(bp)}</span></span>
                <span style={{color:T.muted}}>Deploy <span style={{color:T.blue,fontWeight:600}}>{pct}% = {f(deployable)}</span></span>
                <span style={{color:T.muted}}>Reserved <span style={{color:T.gain,fontWeight:600}}>{f(reserve)}</span></span>
              </div>
              <input type="range" min={5} max={100} step={5} value={pct} onChange={e=>setPct(+e.target.value)} style={{width:"100%",accentColor:T.blue}}/>
              <div style={{fontFamily:FM,fontSize:10,color:T.dim,marginTop:4,lineHeight:1.5}}>Deploy as much or as little as you choose — the reserved portion stays untouched in every mode (Manual · Semi · Full).</div>
            </>:<div style={{fontFamily:FM,fontSize:11,color:T.muted,lineHeight:1.5}}>Select a funded brokerage account to set a deployable %. Current allocation: {f(nlResult.capital_allocated)}.</div>}
          </div>;
        })()}

        {/* Weekly DCA amount — how much the accumulation basket deploys each period.
            Only for dca strategies; blank/0 falls back to deploying the full
            allocation as whole shares become affordable. */}
        {nlResult.strategy_type==="dca"&&<div style={{marginBottom:T.s3}}>
          <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.12em",fontWeight:600,marginBottom:T.s2}}>WEEKLY AMOUNT</div>
          <div style={{display:"flex",alignItems:"center",gap:T.s2}}>
            <span style={{fontFamily:FM,fontSize:14,color:T.muted}}>$</span>
            <input type="number" min={0} step={10} value={nlResult.params?.dca_amount||""} placeholder="e.g. 50"
              onChange={e=>{const v=Math.max(0,Number(e.target.value)||0);setNlResult(prev=>({...prev,params:{...(prev.params||{}),dca_amount:v}}));}}
              className="field" style={{width:140,fontVariantNumeric:"tabular-nums"}}/>
            <span style={{fontFamily:FM,fontSize:11,color:T.muted}}>every {nlResult.params?.dca_cadence_days||7} days</span>
          </div>
          <div style={{fontFamily:FM,fontSize:10,color:T.dim,marginTop:4,lineHeight:1.5}}>Each period the bot buys whole shares of the most-underweight member up to this amount, capped by your deployable allocation above. Leave blank to deploy the full allocation as shares become affordable.</div>
        </div>}

        {/* Faithfully captured trader rules + honest "approximated" label. */}
        {(()=>{
          const dr=nlResult.params?.detailed_rules||nlResult.detailed_rules;
          const ex=nlResult.params?.executed_as||nlResult.executed_as;
          if(!dr&&!ex)return null;
          return<div style={{marginBottom:T.s3,padding:T.s3,background:T.surface,border:`1px solid ${T.border}`,borderRadius:T.rMd}}>
            <div style={{display:"flex",alignItems:"center",gap:T.s2,marginBottom:T.s2,flexWrap:"wrap"}}>
              <span style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.12em",fontWeight:600}}>YOUR RULES — CAPTURED</span>
              <span style={{fontFamily:FM,fontSize:9,fontWeight:600,color:T.gold,background:`${T.gold}14`,border:`1px solid ${T.gold}33`,borderRadius:999,padding:`2px ${T.s2}`,letterSpacing:"0.04em"}}>APPROXIMATED · DAILY LONG-ONLY · NOT TICK-BY-TICK</span>
            </div>
            {dr&&<div style={{fontFamily:FP,fontSize:12,color:T.text,lineHeight:1.55,marginBottom:ex?T.s2:0}}>{dr}</div>}
            {ex&&<div style={{fontFamily:FP,fontSize:11,color:T.muted,lineHeight:1.5}}><span style={{fontWeight:600}}>Executed as:</span> {ex}</div>}
          </div>;
        })()}

        {/* Client-side backtest reality check + mismatch warning + risk disclosure */}
        <StrategyReality strat={nlResult}/>

        {nlResult.risk_disclosure&&<div style={{marginTop:T.s3,padding:T.s3,background:`${T.gold}12`,border:`1px solid ${T.gold}30`,borderRadius:T.rMd,fontFamily:FP,fontSize:12,color:T.gold,lineHeight:1.6}}>
          <Icon name="warning" size={13} color={T.gold} style={{display:"inline-block",verticalAlign:"-2px",marginRight:5}}/>{nlResult.risk_disclosure}
        </div>}
        <label style={{display:"flex",gap:T.s2,alignItems:"flex-start",fontFamily:FM,fontSize:11,color:T.text,cursor:"pointer",margin:`${T.s3} 0`}}>
          <input type="checkbox" checked={riskAck} onChange={e=>setRiskAck(e.target.checked)} style={{marginTop:2}}/>
          I understand this is a TARGET, not a guarantee. The strategy could lose up to {nlResult.stop_loss_pct||nlResult.max_drawdown_pct}% of my allocated capital, and backtest results do not predict live performance.
        </label>
        <div style={{display:"flex",gap:T.s3}}>
          <button onClick={saveNlStrategy} disabled={!riskAck||!nlAccount} title={!nlAccount?"Select a brokerage account first":""} className="btn-primary" style={{fontSize:11,opacity:(riskAck&&nlAccount)?1:0.5}}>Activate Strategy</button>
          <button onClick={()=>{setNlResult(null);setRiskAck(false);}} className="btn-ghost" style={{fontSize:11}}>Cancel</button>
        </div>
      </div>;})()}
    </BentoTile>}

    {/* Pending Signals — the Signals view. Always rendered here (with an empty state). */}
    {showSignals&&<BentoTile>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:T.s3}}>
        <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600}}>PENDING SIGNALS</div>
        <button onClick={loadSignals} style={{fontFamily:FM,fontSize:10,color:T.blue,background:"transparent",border:"none",cursor:"pointer",padding:0}}>{loadingSignals?"Loading…":"Refresh"}</button>
      </div>
      {loadingSignals&&!signals.length?<div style={{fontFamily:FM,fontSize:11,color:T.muted}}>Loading signals…</div>:
       signals.length===0?<div style={{fontFamily:FM,fontSize:11,color:T.muted}}>No pending signals.</div>:
       signals.map(sig=><div key={sig.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:`${T.s3} 0`,borderBottom:`1px solid ${T.border}`}}>
        <div>
          <div style={{fontFamily:FM,fontSize:13,fontWeight:600,color:sig.side==="buy"?T.gain:T.loss}}>{sig.side.toUpperCase()} {sig.qty} {sig.ticker}</div>
          <div style={{fontFamily:FM,fontSize:11,color:T.muted,fontVariantNumeric:"tabular-nums"}}>~${Number(sig.suggested_price||0).toFixed(2)} · Expires {new Date(sig.expires_at).toLocaleTimeString()}</div>
        </div>
        <div style={{display:"flex",gap:T.s2}}>
          <button onClick={()=>approveSignal(sig.id)} className="btn-primary" style={{fontSize:10,padding:`5px ${T.s3}`}}>Approve</button>
          <button onClick={()=>rejectSignal(sig.id)} className="btn-ghost" style={{fontSize:10,padding:`5px ${T.s3}`}}>Reject</button>
        </div>
      </div>)}
    </BentoTile>}

    {/* Bot Activity timeline — every action the bot took, from its own ledger.
        Shows full-auto fills the instant the cron runs, before the broker-synced
        Portfolio → Activity tab catches up. No need to open your brokerage. */}
    {showSignals&&(()=>{
      const META={ // status → { label, color }
        executed:{label:"FILLED",color:T.gain},
        pending: {label:"PENDING",color:T.blue},
        approved:{label:"APPROVED",color:T.blue},
        rejected:{label:"REJECTED",color:T.muted},
        expired: {label:"EXPIRED",color:T.muted},
      };
      const labelFor=a=>(a.status==="approved"&&a.error_msg)?{label:"FAILED",color:T.loss}:(META[a.status]||{label:(a.status||"—").toUpperCase(),color:T.muted});
      const stratLabel=id=>{const s=strategies.find(x=>x.id===id);if(!s)return null;const c=Array.isArray(s.params?.universe_tickers)?s.params.universe_tickers:[];return c.length>1?`${c.length} halal names`:(c[0]||s.ticker);};
      return<CollapsibleTile title="BOT ACTIVITY · ALL ACTIONS" subtitle="Every signal the bot generated + its outcome" storageKey="bot_activity">
        <div style={{display:"flex",justifyContent:"flex-end",alignItems:"center",marginBottom:T.s3}}>
          <button onClick={loadActivity} style={{fontFamily:FM,fontSize:10,color:T.blue,background:"transparent",border:"none",cursor:"pointer",padding:0}}>{loadingActivity?"Loading…":"Refresh"}</button>
        </div>
        <div style={{fontFamily:FM,fontSize:10,color:T.muted,lineHeight:1.5,marginBottom:T.s2}}>Every signal the bot generated and what became of it — buys, sells (exits), approvals, and failures. Updates the moment the bot acts, independent of broker sync.</div>
        {loadingActivity&&!activity?<div style={{fontFamily:FM,fontSize:11,color:T.muted}}>Loading…</div>:
         !activity||activity.length===0?<div style={{fontFamily:FP,fontSize:12,color:T.muted,textAlign:"center",padding:`${T.s4} 0`}}>No bot activity yet. Actions appear here as soon as the bot generates or fills a signal.</div>:
         <div style={{display:"flex",flexDirection:"column"}}>
          {activity.map((a,i)=>{const m=labelFor(a);const when=a.executed_at||a.created_at;const sl=stratLabel(a.strategy_id);return(
            <div key={a.id||i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:T.s3,flexWrap:"wrap",padding:`${T.s2} 0`,borderTop:i===0?"none":`1px solid ${T.border}`,fontVariantNumeric:"tabular-nums"}}>
              <div style={{display:"flex",gap:T.s2,alignItems:"baseline",minWidth:170}}>
                <span style={{fontFamily:FM,fontSize:12,fontWeight:600,color:a.side==="buy"?T.gain:T.loss}}>{(a.side||"").toUpperCase()}</span>
                <span style={{fontFamily:FM,fontSize:12,fontWeight:600,color:T.textHi}}>{a.qty} {a.ticker}</span>
                {sl&&<span style={{fontFamily:FM,fontSize:9,color:T.muted}}>· {sl}</span>}
              </div>
              <div style={{display:"flex",gap:T.s3,alignItems:"center",flexWrap:"wrap"}}>
                <span style={{fontFamily:FM,fontSize:11,color:T.muted}}>~${Number(a.suggested_price||0).toFixed(2)}</span>
                <Tag label={m.label} color={m.color}/>
                <span style={{fontFamily:FM,fontSize:10,color:T.muted}}>{when?new Date(when).toLocaleString([], {month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}):"—"}</span>
              </div>
              {m.label==="FAILED"&&a.error_msg&&<div style={{flexBasis:"100%",fontFamily:FM,fontSize:10,color:T.loss}}>{a.error_msg}</div>}
            </div>);})}
         </div>}
      </CollapsibleTile>;
    })()}

    {/* Strategy Progress — one card per enabled strategy, target is always a goal */}
    {showStrat&&strategies.some(s=>s.enabled)&&<div style={{display:"flex",flexDirection:"column",gap:T.s3}}>
      <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600}}>STRATEGY PROGRESS</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(260px, 1fr))",gap:T.s3}}>
        {strategies.filter(s=>s.enabled).map(s=><StrategyProgressCard key={s.id} strat={s}/>)}
      </div>
    </div>}

    {/* Realized P&L ledger — closed round-trips across all strategies. The
        "did Trade actually make money" answer, which the open-position cards lose
        once a position is fully sold. Shows only once there's a closed trade. */}
    {showStrat&&ledger&&ledger.closed_count>0&&(()=>{
      const net=Number(ledger.realized_pnl)||0;
      const pos=net>=0;
      return<CollapsibleTile accent={pos?T.gain:T.loss} title="REALIZED P&L · CLOSED TRADES" subtitle="Net realized gains from the bot's closed round-trips" storageKey="bot_pnl">
        <div style={{display:"flex",justifyContent:"flex-end",alignItems:"center",flexWrap:"wrap",gap:T.s2,marginBottom:T.s3}}>
          <button onClick={loadLedger} style={{fontFamily:FM,fontSize:10,color:T.blue,background:"transparent",border:"none",cursor:"pointer",padding:0}}>Refresh</button>
        </div>
        <div style={{display:"flex",gap:T.s6,flexWrap:"wrap",alignItems:"baseline"}}>
          <div>
            <div style={{fontFamily:FU,fontSize:30,fontWeight:700,color:fc(net),letterSpacing:"-0.03em",fontVariantNumeric:"tabular-nums"}}>{`${pos?"+":"−"}${f$(net,0)}`}</div>
            <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.1em",marginTop:2}}>NET REALIZED</div>
          </div>
          <div style={{display:"flex",gap:T.s4,fontFamily:FM,fontSize:11,color:T.muted,fontVariantNumeric:"tabular-nums"}}>
            <span><span style={{color:T.textHi,fontWeight:600}}>{ledger.closed_count}</span> closed</span>
            <span><span style={{color:T.gain,fontWeight:600}}>{ledger.wins}</span>W · <span style={{color:T.loss,fontWeight:600}}>{ledger.losses}</span>L</span>
            {ledger.win_rate!=null&&<span><span style={{color:T.textHi,fontWeight:600}}>{ledger.win_rate}%</span> win rate</span>}
          </div>
        </div>
        <div style={{fontFamily:FM,fontSize:10,color:T.muted,lineHeight:1.5}}>Realized from filled buy→sell round-trips (average-cost basis on signal fill price — approximate, no lot-level basis from the broker). Open positions are tracked separately above.</div>
        <div style={{display:"flex",flexDirection:"column"}}>
          {ledger.trades.slice(0,8).map((t,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:T.s3,flexWrap:"wrap",padding:`${T.s2} 0`,borderTop:i===0?"none":`1px solid ${T.border}`,fontFamily:FM,fontSize:11,fontVariantNumeric:"tabular-nums"}}>
            <div style={{display:"flex",gap:T.s2,alignItems:"center",minWidth:160}}>
              <span style={{fontWeight:600,color:T.textHi}}>{t.ticker}</span>
              <span style={{color:T.muted}}>{t.qty} sh · {f$(t.entry)}→{f$(t.exit)}</span>
            </div>
            <div style={{display:"flex",gap:T.s3,alignItems:"center"}}>
              <span style={{color:fc(t.realized),fontWeight:600}}>{`${t.realized>=0?"+":"−"}${f$(t.realized,0)}`}</span>
              <span style={{color:fc(t.realized)}}>({t.realized>=0?"+":""}{t.realized_pct}%)</span>
              <span style={{color:T.muted,fontSize:10}}>{t.closed_at?new Date(t.closed_at).toLocaleDateString():"—"}</span>
            </div>
          </div>)}
          {ledger.trades.length>8&&<div style={{fontFamily:FM,fontSize:10,color:T.muted,paddingTop:T.s2}}>+{ledger.trades.length-8} more closed trade{ledger.trades.length-8===1?"":"s"}</div>}
        </div>
      </CollapsibleTile>;
    })()}

    {/* Strategy List */}
    {showStrat&&<BentoTile>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:T.s3}}>
        <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600}}>STRATEGIES ({strategies.length})</div>
        <button onClick={loadStrategies} style={{fontFamily:FM,fontSize:10,color:T.blue,background:"transparent",border:"none",cursor:"pointer",padding:0}}>{loadingStrats?"Loading…":"Refresh"}</button>
      </div>
      {loadingStrats&&!strategies.length?<div style={{fontFamily:FM,fontSize:11,color:T.muted}}>Loading…</div>:
       strategies.length===0?<div style={{fontFamily:FP,fontSize:12,color:T.muted,textAlign:"center",padding:`${T.s5} 0`}}>No strategies configured yet. Use the builder above to create your first one.</div>:
       strategies.map(s=>{
        const lyr=layerOf(s);
        const cands=Array.isArray(s.params?.universe_tickers)?s.params.universe_tickers:[];
        const uniLabel=cands.length>1?`${cands[0]} +${cands.length-1} more`:(cands[0]||s.ticker);
        return<div key={s.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:T.s3,flexWrap:"wrap",padding:`${T.s3} 0`,borderBottom:`1px solid ${T.border}`}}>
        <div style={{minWidth:200}}>
          <div style={{display:"flex",gap:T.s2,alignItems:"center",marginBottom:4}}>
            <span style={{fontFamily:FM,fontSize:13,fontWeight:600,color:T.textHi}}>{uniLabel}</span>
            <Tag label={LAYER_META[lyr].label.toUpperCase()} color={LAYER_META[lyr].color}/>
            {s.strategy_type==="dca"&&<Tag label="DCA" color={T.gain}/>}
            {!s.enabled&&<Tag label="PAUSED" color={T.muted}/>}
          </div>
          <div style={{fontFamily:FM,fontSize:11,color:T.muted,fontVariantNumeric:"tabular-nums"}}>{cands.length>1?`Screens ${cands.length} halal names · `:""}{`$${Number(s.capital_allocated).toLocaleString()} · `}{s.strategy_type==="dca"?`DCA · every ${Number(s.params?.dca_cadence_days)||7}d · holds (no auto-sell)`:`Target: ${s.profit_target_pct}% · Stop: ${s.stop_loss_pct}%`}</div>
        </div>
        <div style={{display:"flex",gap:T.s3,alignItems:"center",flexWrap:"wrap"}}>
          {/* Layer selector — switching opens the acknowledgment gate */}
          <div style={{display:"inline-flex",border:`1px solid ${T.border}`,borderRadius:999,overflow:"hidden"}}>
            {LAYERS.map(k=>{const on=lyr===k;return(
              <button key={k} onClick={()=>requestLayer(s,k)} title={LAYER_META[k].blurb} style={{
                padding:`5px ${T.s2}`,border:"none",cursor:"pointer",
                fontFamily:FM,fontSize:9,fontWeight:600,letterSpacing:"0.06em",
                background:on?`${LAYER_META[k].color}1a`:"transparent",
                color:on?LAYER_META[k].color:T.muted,
              }}>{LAYER_META[k].label.toUpperCase()}</button>
            );})}
          </div>
          <button onClick={()=>openEdit(s)} className="btn-ghost" style={{fontSize:10,padding:`5px ${T.s2}`}}>Edit</button>
          <button onClick={()=>toggleStrategy(s.id,s.enabled)} className="btn-ghost" style={{fontSize:10,padding:`5px ${T.s2}`}}>{s.enabled?"Pause":"Resume"}</button>
          <button onClick={()=>deleteStrategy(s.id)} style={{fontFamily:FM,fontSize:10,padding:`5px ${T.s2}`,borderRadius:T.rSm,border:`1px solid ${T.loss}40`,background:"transparent",color:T.loss,cursor:"pointer"}}>Delete</button>
        </div>
      </div>;})}
    </BentoTile>}

    {showStrat&&fullAutoEnabled&&<BentoTile accent={T.loss}>
      <div style={{fontFamily:FM,fontSize:10,color:T.loss,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>FULL-AUTO — PER-ACCOUNT OPT-IN</div>
      <p style={{fontFamily:FP,fontSize:12,color:T.muted,lineHeight:1.6,margin:`0 0 ${T.s3}`}}>Autonomous execution runs <strong>only</strong> on accounts you turn on here. Each defaults to off. A full-mode strategy on an account that's off will still generate signals but never auto-execute.</p>
      {snapAccounts.length===0
        ?<div style={{fontFamily:FM,fontSize:11,color:T.muted}}>No connected accounts.</div>
        :snapAccounts.map(a=>{const id=a.accountId||a.id;const on=!!faAccounts[id];return(
          <div key={id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:`${T.s2} 0`,borderBottom:`1px solid ${T.border}`}}>
            <div>
              <div style={{fontFamily:FM,fontSize:12,fontWeight:600,color:T.textHi}}>{a.brokerage||a.name||"Account"}</div>
              <div style={{fontFamily:FM,fontSize:10,color:T.muted}}>{a.accountName||id}</div>
            </div>
            <button onClick={()=>toggleFaAccount(id,!on)} style={{
              padding:`5px ${T.s3}`,borderRadius:999,cursor:"pointer",
              fontFamily:FM,fontSize:10,fontWeight:600,letterSpacing:"0.08em",
              border:`1px solid ${on?T.loss:T.border}`,
              background:on?`${T.loss}18`:"transparent",
              color:on?T.loss:T.muted,
            }}>{on?"● AUTO ON":"AUTO OFF"}</button>
          </div>
        );})}
    </BentoTile>}

    {/* Layer-change acknowledgment gate — you can't switch a strategy's layer
        without confirming you understand what that layer does. */}
    {showStrat&&layerModal&&(()=>{const m=LAYER_META[layerModal.target];return(
      <div onClick={()=>{setLayerModal(null);setLayerAck(false);}} style={{position:"fixed",inset:0,zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:T.s4,background:"rgba(12,11,10,0.55)"}}>
        <div className="glass-strong" onClick={e=>e.stopPropagation()} style={{maxWidth:460,width:"100%",borderRadius:T.rLg,border:`1px solid ${m.color}40`,padding:T.s6}}>
          <div style={{display:"flex",alignItems:"center",gap:T.s2,marginBottom:T.s3}}>
            <Icon name={m.icon} size={22} color={m.color}/>
            <div>
              <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600}}>SWITCH EXECUTION LAYER</div>
              <div style={{fontFamily:FU,fontSize:20,fontWeight:700,color:m.color,letterSpacing:"-0.02em"}}>{m.label}</div>
            </div>
          </div>
          <p style={{fontFamily:FP,fontSize:13,color:T.text,lineHeight:1.65,margin:`0 0 ${T.s3}`}}>{m.blurb}</p>
          <div style={{fontFamily:FM,fontSize:11,color:T.muted,lineHeight:1.6,marginBottom:T.s4}}>
            Switching <span style={{color:T.textHi,fontWeight:600}}>{layerOf(layerModal.strat)===layerModal.target?m.label:LAYER_META[layerOf(layerModal.strat)].label}</span> → <span style={{color:m.color,fontWeight:600}}>{m.label}</span> for <span style={{color:T.textHi,fontWeight:600}}>{(Array.isArray(layerModal.strat.params?.universe_tickers)&&layerModal.strat.params.universe_tickers[0])||layerModal.strat.ticker}</span>. Stop-loss, max-drawdown, the daily cap, and the Sharia gate stay enforced on every layer.
            {layerModal.target==="full"&&<span style={{display:"block",marginTop:T.s2,color:T.loss}}>Full-auto also requires the per-account AUTO ON toggle (off by default) before anything executes on its own.</span>}
          </div>
          <label style={{display:"flex",gap:T.s2,alignItems:"flex-start",fontFamily:FM,fontSize:11,color:T.text,cursor:"pointer",marginBottom:T.s4}}>
            <input type="checkbox" checked={layerAck} onChange={e=>setLayerAck(e.target.checked)} style={{marginTop:2}}/>
            I understand what <strong style={{color:m.color}}>&nbsp;{m.label}&nbsp;</strong> means and accept how trades will be executed under it.
          </label>
          <div style={{display:"flex",gap:T.s3,justifyContent:"flex-end"}}>
            <button onClick={()=>{setLayerModal(null);setLayerAck(false);}} className="btn-ghost" style={{fontSize:11}}>Cancel</button>
            <button onClick={confirmLayer} disabled={!layerAck} className="btn-primary" style={{fontSize:11,opacity:layerAck?1:0.5}}>Set {m.label}</button>
          </div>
        </div>
      </div>);})()}

    {/* Edit Strategy — structured, pre-filled form. Full-auto edits re-prompt the
        risk ack since they change autonomous-execution behavior next cron tick. */}
    {showStrat&&editStrat&&editForm&&(()=>{
      const isFull=layerOf(editStrat)==="full"&&editStrat.enabled;
      const set=(k,v)=>setEditForm(f=>({...f,[k]:v}));
      const num=(label,k,suffix)=><label style={{display:"block"}}>
        <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.1em",fontWeight:600,marginBottom:4}}>{label}</div>
        <div style={{position:"relative"}}>
          <input type="number" value={editForm[k]} onChange={e=>set(k,e.target.value)} className="field" style={{width:"100%",fontVariantNumeric:"tabular-nums"}}/>
          {suffix&&<span style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",fontFamily:FM,fontSize:11,color:T.muted,pointerEvents:"none"}}>{suffix}</span>}
        </div>
      </label>;
      return(
      <div onClick={()=>{if(!editBusy){setEditStrat(null);setEditForm(null);setEditAck(false);}}} style={{position:"fixed",inset:0,zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:T.s4,background:"rgba(12,11,10,0.55)"}}>
        <div className="glass-strong" onClick={e=>e.stopPropagation()} style={{maxWidth:560,width:"100%",borderRadius:T.rLg,border:`1px solid ${T.blue}40`,padding:T.s6,maxHeight:"90vh",overflowY:"auto"}}>
          <div style={{fontFamily:FM,fontSize:10,color:T.blue,letterSpacing:"0.16em",fontWeight:600,marginBottom:4}}>EDIT STRATEGY</div>
          <div style={{fontFamily:FU,fontSize:20,fontWeight:700,color:T.textHi,letterSpacing:"-0.02em",marginBottom:T.s4}}>{(Array.isArray(editStrat.params?.universe_tickers)&&editStrat.params.universe_tickers[0])||editStrat.ticker}</div>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:T.s3,marginBottom:T.s3}}>
            <label style={{display:"block"}}>
              <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.1em",fontWeight:600,marginBottom:4}}>PRIMARY TICKER</div>
              <input value={editForm.ticker} onChange={e=>set("ticker",e.target.value.toUpperCase())} className="field" style={{width:"100%"}}/>
            </label>
            <label style={{display:"block"}}>
              <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.1em",fontWeight:600,marginBottom:4}}>STRATEGY TYPE</div>
              <input value={editForm.strategy_type} onChange={e=>set("strategy_type",e.target.value)} className="field" style={{width:"100%"}}/>
            </label>
          </div>

          <label style={{display:"block",marginBottom:T.s3}}>
            <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.1em",fontWeight:600,marginBottom:4}}>SCREEN UNIVERSE (comma-separated tickers — blank = single ticker above)</div>
            <input value={editForm.universe_tickers} onChange={e=>set("universe_tickers",e.target.value)} placeholder="e.g. SPUS, HLAL, UMMA" className="field" style={{width:"100%",fontFamily:FM}}/>
          </label>

          <label style={{display:"block",marginBottom:T.s3}}>
            <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.1em",fontWeight:600,marginBottom:4}}>BROKERAGE ACCOUNT</div>
            {snapAccounts.length===0
              ?<div style={{fontFamily:FM,fontSize:11,color:T.loss}}>No brokerage connected.</div>
              :<select value={editForm.account_id} onChange={e=>set("account_id",e.target.value)} className="field" style={{width:"100%"}}>
                {!snapAccounts.find(a=>acctId(a)===editForm.account_id)&&<option value={editForm.account_id}>Unmatched ({editForm.account_id||"none"}) — pick one</option>}
                {snapAccounts.map(a=>{const id=acctId(a);return<option key={id} value={id}>{(a.brokerage||a.name||"Account")}{a.accountName?` — ${a.accountName}`:""}{a.balance!=null?` (${kf(a.balance)})`:""}</option>;})}
              </select>}
          </label>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:T.s3,marginBottom:T.s3}}>
            {num("CAPITAL ALLOCATED","capital_allocated","$")}
            {num("PROFIT TARGET (GOAL)","profit_target_pct","%")}
            {num("STOP LOSS","stop_loss_pct","%")}
            {num("MAX DRAWDOWN","max_drawdown_pct","%")}
            {num("TIME HORIZON","time_horizon_days","days")}
            {num("MAX TRADES / DAY","max_trades_per_day","")}
          </div>

          <div style={{fontFamily:FM,fontSize:10,color:T.muted,lineHeight:1.6,marginBottom:T.s3}}>Stop-loss, max-drawdown, the daily cap, and the Sharia gate stay enforced on every layer. The stop-loss can be tightened but never removed.</div>

          {isFull&&<label style={{display:"flex",gap:T.s2,alignItems:"flex-start",fontFamily:FM,fontSize:11,color:T.text,cursor:"pointer",marginBottom:T.s3}}>
            <input type="checkbox" checked={editAck} onChange={e=>setEditAck(e.target.checked)} style={{marginTop:2}}/>
            This is a live FULL-AUTO strategy. I understand these changes take effect on the next automated run.
          </label>}

          {editErr&&<div style={{fontFamily:FM,fontSize:11,color:T.loss,marginBottom:T.s3}}>{editErr}</div>}
          <div style={{display:"flex",gap:T.s3,justifyContent:"flex-end"}}>
            <button onClick={()=>{setEditStrat(null);setEditForm(null);setEditAck(false);}} disabled={editBusy} className="btn-ghost" style={{fontSize:11}}>Cancel</button>
            <button onClick={saveEdit} disabled={editBusy||(isFull&&!editAck)} className="btn-primary" style={{fontSize:11,opacity:(editBusy||(isFull&&!editAck))?0.5:1}}>{editBusy?"Saving…":"Save Changes"}</button>
          </div>
        </div>
      </div>);})()}
  </div>;
}

/* ─── Brokerage trading support (reconnect notice + per-broker capability matrix) ───
   For Mizan to place orders, a brokerage must be connected WITH TRADE PERMISSION — a
   read-only/data connection can view balances but can't trade. What each broker allows
   also differs (fractional vs whole-share, read-only, custodial restrictions). Sourced
   from SnapTrade's per-broker trading support; capabilities can change over time. */
function TradeConnectionsPanel({onConnectTrade}){
  const[open,setOpen]=useState(false);
  const CAPS=[
    {name:"Robinhood",     tier:"full",    label:"Trade · fractional",   note:"Full trading, fractional shares, and instant deposits."},
    {name:"E*TRADE",       tier:"whole",   label:"Trade · whole shares", note:"Trading supported, but whole shares only — no fractional."},
    {name:"Charles Schwab",tier:"whole",   label:"Trade · whole shares", note:"Trading supported through the API (whole shares)."},
    {name:"Fidelity",      tier:"readonly",label:"Read-only",            note:"View-only — Fidelity does not permit order placement through the API."},
    {name:"Coinbase",      tier:"na",      label:"Crypto only",          note:"Equities trading isn’t available; crypto accounts are view-only here."},
  ];
  const TIER={full:T.gain,whole:T.gold,readonly:T.slate,na:T.slate};
  return<BentoTile>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:T.s4,flexWrap:"wrap"}}>
      <div style={{maxWidth:600}}>
        <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>BROKERAGE TRADING SUPPORT</div>
        <p style={{fontFamily:FP,fontSize:13,color:T.muted,margin:0,lineHeight:1.55}}>
          For Mizan to place orders, connect your brokerage <strong style={{color:T.text}}>with trade permission</strong>. A read-only (data) connection shows balances and holdings but <strong style={{color:T.text}}>cannot trade</strong> — reconnect and choose “Connect for trading.” What each broker allows differs; see the details below.
        </p>
      </div>
      {onConnectTrade&&<button onClick={onConnectTrade} className="btn-ghost" style={{flexShrink:0}}>Reconnect for trading</button>}
    </div>
    <button onClick={()=>setOpen(o=>!o)} style={{marginTop:T.s3,background:"none",border:"none",padding:0,cursor:"pointer",fontFamily:FM,fontSize:11,fontWeight:600,letterSpacing:"0.06em",color:T.blue}}>
      {open?"Hide broker details ▲":"Show broker details ▾"}
    </button>
    {open&&<div style={{marginTop:T.s3,paddingTop:T.s3,borderTop:`1px solid ${T.border}`,display:"flex",flexDirection:"column",gap:T.s3}}>
      {CAPS.map(b=>(
        <div key={b.name} style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:T.s3}}>
          <div style={{minWidth:0}}>
            <div style={{fontFamily:FM,fontSize:12,fontWeight:600,color:T.text}}>{b.name}</div>
            <div style={{fontFamily:FP,fontSize:12,color:T.muted,lineHeight:1.5}}>{b.note}</div>
          </div>
          <div style={{flexShrink:0}}><Tag label={b.label} color={TIER[b.tier]}/></div>
        </div>
      ))}
      <div style={{fontFamily:FP,fontSize:12,color:T.muted,lineHeight:1.5,paddingTop:T.s2,borderTop:`1px dashed ${T.border}`}}>
        <strong style={{color:T.text}}>Custodial accounts</strong> (UGMA/UTMA) usually can’t be traded through the API even when funded — connect an individual brokerage account instead. Support depends on SnapTrade and each broker and can change.
      </div>
    </div>}
  </BentoTile>;
}

function TradeBot({currentNW=0,ytdContrib=0,accounts=[],live=[],mapPosition,onOrderPlaced,activities=[],onNav,onConnectTrade,isAdmin=false,fullAutoEnabled=false,isRoot=false,consented=false,demoMode=false}){
  // Trade is the admin trading hub: bot Strategies + Signals, plus the analysis
  // tools (Screener / Rebalance / Backtest, reused from Portfolio) and an ad-hoc
  // Opens on Signals (pending approvals are the most time-sensitive view).
  const[sub,setSub]=useState("signals");
  // Holdings (with live prices merged) — needed by Screener + Rebalance. Same
  // derivation Portfolio uses, kept self-contained here.
  const merged=(()=>{
    if(!mapPosition)return[];
    const base=accounts.length>0?accounts.flatMap(a=>(a.positions||[]).map(p=>mapPosition(p,a.accountName,a.brokerage))).filter(h=>h&&h.sh>0):[];
    return base.map(h=>{const l=(live||[]).find(q=>q.tk===h.tk);return l?{...h,px:l.price||h.px,_p:l.pct||0,_live:true}:h;});
  })();
  const[side,setSide]=useState("buy");
  const[sym,setSym]=useState("AAPL");
  const[otype,setOtype]=useState("limit");
  const[qty,setQty]=useState("1");
  const[lpx,setLpx]=useState("289.00");
  const[done,setDone]=useState(false);
  const[acctId,setAcctId]=useState(()=>accounts[0]?.accountId||"");
  const[orderBusy,setOrderBusy]=useState(false);
  const[orderErr,setOrderErr]=useState(null);
  const[impactPreview,setImpactPreview]=useState(null);
  // Venue selector — "snaptrade" = real broker preview/confirm flow,
  // "alpaca" = paper-trading single-shot order. Persists per-device.
  const[venue,setVenueState]=useState(()=>{try{return localStorage.getItem("mizan_trade_venue")||"snaptrade";}catch{return"snaptrade";}});
  const setVenue=v=>{setVenueState(v);try{localStorage.setItem("mizan_trade_venue",v);}catch{}};
  useEffect(()=>{if(!acctId&&accounts[0])setAcctId(accounts[0].accountId);},[accounts]);

  // Pre-fill from a pending order stashed by the Rebalancer's "Copy to Order"
  // button. Read once, clear immediately so reloads don't keep re-filling.
  useEffect(()=>{
    try{
      const raw=localStorage.getItem("mizan_pending_order");
      if(!raw)return;
      const o=JSON.parse(raw);
      localStorage.removeItem("mizan_pending_order");
      if(o&&o.sym){
        setSub("order");
        setSym(String(o.sym).toUpperCase());
        if(o.side==="sell"||o.side==="buy")setSide(o.side);
        if(o.qty)setQty(String(o.qty));
      }
    }catch{}
  },[]);

  // Live quote for whatever symbol is typed (any US ticker, via the Finnhub
  // proxy → Alpaca/Yahoo fallback). Debounced so we don't fetch on every
  // keystroke. Powers the price chip + the Estimated Total for MARKET orders.
  const[quote,setQuote]=useState(null);
  const[quoteBusy,setQuoteBusy]=useState(false);
  useEffect(()=>{
    const s=(sym||"").trim().toUpperCase();
    if(!s){setQuote(null);return;}
    let cancelled=false;
    setQuoteBusy(true);
    const h=setTimeout(async()=>{
      try{
        // intent=order → dedicated rate-limit bucket so the ticket's quote is
        // never starved by the app's background portfolio/watchlist polling.
        const r=await apiFetch(`/api/finnhub/quote?symbols=${encodeURIComponent(s)}&intent=order`);
        if(cancelled)return;
        const d=await r.json().catch(()=>({}));
        const hit=(d.quotes||[]).find(x=>x.tk===s)||null;
        setQuote(hit&&hit.price>0?{price:hit.price,pct:hit.pct}:null);
      }catch{if(!cancelled)setQuote(null);}
      finally{if(!cancelled)setQuoteBusy(false);}
    },400);
    return()=>{cancelled=true;clearTimeout(h);};
  },[sym]);

  // Step 1: preview (SnapTrade) or place (Alpaca paper) the order.
  // - SnapTrade: posts to /trade/impact, surfaces a modal, then user
  //   confirms via placeOrder() which calls /trade/place.
  // - Alpaca paper: single-shot — posts to /api/alpaca/order which
  //   forwards to paper-api.alpaca.markets. No preview modal.
  const submit=async()=>{
    if(orderBusy)return;
    setOrderErr(null);
    if(venue==="snaptrade"&&!acctId){setOrderErr("Select an account first.");return;}
    if(!sym||!qty){setOrderErr("Symbol and quantity are required.");return;}
    setOrderBusy(true);
    try{
      if(venue==="alpaca"){
        const r=await apiFetch("/api/alpaca/order",{
          method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({
            symbol:sym.toUpperCase(),
            qty:+qty,
            side,
            type:otype==="limit"?"limit":otype==="stop"?"stop":otype==="stoplimit"?"stop_limit":"market",
            limitPrice:otype==="limit"||otype==="stoplimit"?+lpx:undefined,
          }),
        });
        const d=await r.json();
        if(!r.ok||d.error){setOrderErr(d.error||`HTTP ${r.status}`);return;}
        // No preview/confirm — Alpaca returns the placed order directly.
        setDone(true);
        setTimeout(()=>setDone(false),4000);
        onOrderPlaced?.();
        return;
      }
      // Sharia precheck — block known non-compliant tickers before hitting the broker API
      const HARAM_SNAP=new Set(["JPM","BAC","WFC","GS","MS","C","USB","BK","WYNN","MO","PM","MCD","BND","HYG","LCID"]);
      if(HARAM_SNAP.has(sym.toUpperCase())){
        setOrderErr(`${sym.toUpperCase()} is flagged as potentially non-compliant with AAOIFI standards. Consult your Sharia advisor before placing this order.`);
        setOrderBusy(false);
        return;
      }
      const orderTypeMap={market:"Market",limit:"Limit",stop:"StopLoss",stoplimit:"StopLimit"};
      const r=await apiFetch("/api/snaptrade/trade/impact",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          accountId:acctId,
          action:side==="buy"?"BUY":"SELL",
          symbol:sym.toUpperCase(),
          orderType:orderTypeMap[otype]||"Market",
          timeInForce:"Day",
          units:+qty,
          price:otype==="market"?null:+lpx,
        }),
      });
      const d=await r.json();
      if(!r.ok||d.error){setOrderErr(d.error||`HTTP ${r.status}`);return;}
      setImpactPreview(d.impact||d);
    }catch(err){setOrderErr(err.message||"Preview failed");}
    finally{setOrderBusy(false);}
  };

  // Step 2: confirm the previewed trade.
  const placeOrder=async()=>{
    const tradeId=impactPreview?.trade?.id||impactPreview?.id;
    if(!tradeId){setOrderErr("No trade ID returned from preview.");return;}
    setOrderBusy(true);setOrderErr(null);
    try{
      const r=await apiFetch("/api/snaptrade/trade/place",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({tradeId}),
      });
      const d=await r.json();
      if(!r.ok||d.error){setOrderErr(d.error||`HTTP ${r.status}`);return;}
      setDone(true);
      setImpactPreview(null);
      setTimeout(()=>setDone(false),4000);
      onOrderPlaced?.();
    }catch(err){setOrderErr(err.message||"Place failed");}
    finally{setOrderBusy(false);}
  };
  const cancelPreview=()=>{setImpactPreview(null);setOrderErr(null);};

  const ORDERS=[["Market","Execute immediately at market price",true],["Limit","Execute at specified price or better",true],["Stop-Loss","Sells when price drops to stop level",true],["Stop-Limit","Stop triggers limit — price floor control",true],["Trailing Stop","Dynamic stop — locks in gains as price rises",true],["Short Sell","Selling unowned shares · Maisir — prohibited",false],["Options","Derivative contracts · Gharar — prohibited",false],["Margin","Borrowed capital with interest · Riba — prohibited",false]];
  // Order-type names that map to a supported otype using ONLY the existing
  // single-price form (market needs no price; limit uses LIMIT PRICE). Stop
  // variants would need a stop-price field, so they stay display-only for now.
  const OTYPE_BY_NAME={Market:"market",Limit:"limit"};

  // Market orders execute at the live price → base the estimate on the quote;
  // limit orders use the entered LIMIT PRICE.
  const estPx=otype==="market"?(quote?.price||0):parseFloat(lpx||0);
  const estTotal=parseFloat(qty||0)*estPx;

  // Hard frontend gate: Trade does not exist for non-root users. The nav never
  // shows it and setNav bounces them, but this guarantees the surface renders
  // nothing even if a tampered client forces nav==="trade".
  if(!isAdmin)return null;

  return<div style={{display:"flex",flexDirection:"column",gap:T.s5}}>
    {/* Screener / Rebalance / Backtest are NOT duplicated here — they live in
        the Portfolio tab (one home each). Trade stays focused on the bot. */}
    <TabBar tabs={[["signals","Signals"],["strategies","Strategies"],["order","Quick Trade"]]} active={sub} onChange={setSub}/>
    {/* Persistent reference: how brokerage connections map to trade features, and the
        reconnect-with-trade-permission requirement. Collapsed by default. */}
    <TradeConnectionsPanel onConnectTrade={onConnectTrade}/>
    {/* Bot panel, split into Strategies + Signals views (same component, shared state). */}
    {(sub==="strategies"||sub==="signals")&&<TradingBotPanel view={sub} isAdmin={isAdmin} fullAutoEnabled={fullAutoEnabled} isRoot={isRoot} consented={consented} snapAccounts={accounts} demoMode={demoMode} onNav={onNav}/>}

    {/* Quick Trade (ad-hoc order ticket) lives behind a Coming Soon banner for non-admin users. */}
    {sub==="order"&&!isAdmin&&<ComingSoon
      title="Order Ticket"
      description="Place halal-screened buy/sell orders against your connected SnapTrade brokerage or against a free Alpaca paper account. Available for authorized users."
      hint="Want early access? Use the AI Advisor tab to research positions while this ships."
      action={onNav ? { label: "Open AI Advisor", onClick: () => onNav("advisor") } : null}
    />}
    {sub==="order"&&isAdmin&&impactPreview&&<OrderPreviewModal preview={impactPreview} onConfirm={placeOrder} onCancel={cancelPreview} busy={orderBusy} side={side} sym={sym} qty={qty}/>}
    {sub==="order"&&isAdmin&&<div className="bento-row mz-side-by-side" style={{display:"grid",gridTemplateColumns:"360px 1fr",gap:T.s4}}>
      {/* ─── Order Ticket bento ────────────────────────── */}
      <BentoTile style={{display:"flex",flexDirection:"column",gap:T.s4}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:T.s2,flexWrap:"wrap"}}>
          <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600}}>AD-HOC MANUAL ORDER</div>
          <Tag label={venue==="alpaca"?"PAPER · ALPACA":"LIVE · SNAPTRADE"} color={venue==="alpaca"?T.gold:T.blue}/>
        </div>
        <p style={{fontFamily:FP,fontSize:11,color:T.muted,lineHeight:1.55,margin:0}}>One-off trade you place by hand. For automated trades, create a strategy in the <strong>Trading Bot</strong> tab — it screens a halal universe, picks the ticker, sizes it, and executes per your chosen layer.</p>
        <div style={{display:"flex",background:T.surface,borderRadius:T.rMd,overflow:"hidden",border:`1px solid ${T.border}`,padding:3}}>
          {[["snaptrade","Live · SnapTrade"],["alpaca","Paper · Alpaca"]].map(([v,l])=><button key={v} onClick={()=>setVenue(v)} title={v==="alpaca"?"Paper trade against Alpaca's free sandbox — no real money":"Place a real order through your connected broker"} style={{
            flex:1,padding:"8px 10px",fontFamily:FM,fontSize:11,fontWeight:600,letterSpacing:"-0.005em",
            border:"none",cursor:"pointer",borderRadius:T.rSm,
            background:venue===v?(v==="alpaca"?`${T.gold}22`:`${T.blue}22`):"transparent",
            color:venue===v?(v==="alpaca"?T.gold:T.blue):T.muted,
            transition:"all 0.15s",
          }}>{l}</button>)}
        </div>
        <div style={{display:"flex",background:T.surface,borderRadius:T.rMd,overflow:"hidden",border:`1px solid ${T.border}`,padding:3}}>
          {["buy","sell"].map(s=><button key={s} onClick={()=>setSide(s)} style={{
            flex:1,padding:"10px",fontFamily:FP,fontSize:13,fontWeight:600,letterSpacing:"-0.005em",
            textTransform:"capitalize",border:"none",cursor:"pointer",borderRadius:T.rSm,
            background:side===s?(s==="buy"?T.gain:T.loss):"transparent",
            color:side===s?"#fff":T.muted,
            transition:"all 0.15s",
            boxShadow:side===s?`0 2px 8px ${(s==="buy"?T.gain:T.loss)}55`:"none",
          }}>{s}</button>)}
        </div>
        {venue==="snaptrade"
          ?<div>
            <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.14em",fontWeight:600,marginBottom:T.s1}}>ACCOUNT</div>
            <select value={acctId} onChange={e=>setAcctId(e.target.value)} className="field">
              {accounts.length===0?<option value="">No accounts connected</option>:accounts.map(a=><option key={a.accountId} value={a.accountId}>{a.brokerage} — {a.accountName} ({kf(a.balance||0)})</option>)}
            </select>
          </div>
          :<div style={{padding:`${T.s2} ${T.s3}`,background:T.surface,border:`1px solid ${T.gold}30`,borderRadius:T.rMd,fontFamily:FM,fontSize:11,color:T.muted,lineHeight:1.5}}>
            <span style={{color:T.gold,fontWeight:600,letterSpacing:"0.06em"}}>PAPER MODE</span> — order routes to your Alpaca paper account (no real money). Halal-only: haram tickers blocked server-side.
          </div>}
        {/* Symbol + live quote for whatever ticker is typed */}
        <div>
          <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.14em",fontWeight:600,marginBottom:T.s1}}>SYMBOL</div>
          <input type="text" value={sym} onChange={e=>setSym(e.target.value.toUpperCase())}
            className="field" style={{fontSize:16,fontWeight:600,color:T.blue,letterSpacing:"-0.01em"}}/>
          <div style={{marginTop:6,fontFamily:FM,fontSize:11,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            {quoteBusy&&!quote
              ?<span style={{color:T.muted}}>Fetching live price…</span>
              :quote
                ?<>
                  <span style={{color:T.textHi,fontWeight:600,fontVariantNumeric:"tabular-nums"}}>{f$(quote.price)}</span>
                  {quote.pct!=null&&<span style={{color:fc(quote.pct),fontVariantNumeric:"tabular-nums"}}>{fp(quote.pct)}</span>}
                  <span style={{color:T.gain,letterSpacing:"0.12em",fontWeight:600}}>● LIVE</span>
                  {otype!=="market"&&<button onClick={()=>setLpx(String(quote.price))} style={{fontFamily:FM,fontSize:9,fontWeight:600,letterSpacing:"0.06em",color:T.blue,background:`${T.blue}14`,border:`1px solid ${T.blue}30`,borderRadius:T.rSm,padding:"2px 7px",cursor:"pointer"}}>USE →</button>}
                </>
                :<span style={{color:T.muted}}>No live price for {sym||"—"}</span>}
          </div>
        </div>
        <div>
          <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.14em",fontWeight:600,marginBottom:T.s1}}>QUANTITY</div>
          <input type="number" value={qty} onChange={e=>setQty(e.target.value)}
            className="field" style={{fontSize:14,fontWeight:500,color:T.text,fontVariantNumeric:"tabular-nums"}}/>
        </div>
        {/* Limit price only applies to limit orders — hidden for market. */}
        {otype!=="market"&&<div>
          <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.14em",fontWeight:600,marginBottom:T.s1}}>LIMIT PRICE</div>
          <input type="number" value={lpx} onChange={e=>setLpx(e.target.value)}
            className="field" style={{fontSize:14,fontWeight:500,color:T.text,fontVariantNumeric:"tabular-nums"}}/>
        </div>}
        <div style={{background:T.surface,borderRadius:T.rMd,padding:`${T.s3} ${T.s4}`,border:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"baseline"}}>
          <span style={{fontFamily:FM,fontSize:11,color:T.muted,letterSpacing:"0.04em"}}>
            Estimated Total <span style={{opacity:0.7}}>· {otype==="market"?(quote?"@ live price":"@ market"):"@ limit"}</span>
          </span>
          <span style={{fontFamily:FU,fontSize:16,fontWeight:700,color:T.textHi,letterSpacing:"-0.015em",fontVariantNumeric:"tabular-nums"}}>{estPx>0?f$(estTotal):"—"}</span>
        </div>
        <div style={{background:`linear-gradient(135deg, ${T.gain}12, transparent 70%), ${T.surface}`,border:`1px solid ${T.gain}28`,borderRadius:T.rMd,padding:`${T.s2} ${T.s3}`}}>
          <div style={{fontFamily:FM,fontSize:9,color:T.gain,letterSpacing:"0.16em",fontWeight:600,marginBottom:2}}>● SHARIA PRE-CHECK</div>
          <div style={{fontFamily:FP,fontSize:12,color:T.text,letterSpacing:"-0.005em"}}>{sym} — screening against AAOIFI criteria</div>
        </div>
        <button onClick={submit} disabled={orderBusy||(venue==="snaptrade"&&!acctId)} style={{
          padding:`12px ${T.s4}`,borderRadius:T.rMd,
          fontFamily:FP,fontSize:13,fontWeight:600,letterSpacing:"-0.005em",
          border:"none",cursor:orderBusy||(venue==="snaptrade"&&!acctId)?"not-allowed":"pointer",
          background:done?`${T.gain}22`:orderBusy?T.dim:`linear-gradient(135deg, ${side==="buy"?T.gain:T.loss}, ${side==="buy"?"#0A8A65":"#D85555"})`,
          color:done?T.gain:orderBusy?T.muted:"#fff",
          transition:"all 0.2s",
          boxShadow:done||orderBusy?"none":`0 4px 14px ${(side==="buy"?T.gain:T.loss)}55`,
        }}>
          {done?<span style={{display:"inline-flex",alignItems:"center",gap:6}}>Order Placed<Icon name="check" size={13}/></span>:orderBusy?"Loading…":venue==="alpaca"?`Place Paper ${side==="buy"?"Buy":"Sell"} ${sym}`:`Preview ${side==="buy"?"Buy":"Sell"} ${sym}`}
        </button>
        {orderErr&&<div style={{padding:`${T.s2} ${T.s3}`,background:T.lossBg,border:`1px solid ${T.loss}30`,borderRadius:T.rMd,fontFamily:FM,fontSize:11,color:T.loss,whiteSpace:"pre-wrap",lineHeight:1.4}}>{ICON_NO}{orderErr}</div>}
      </BentoTile>

      {/* ─── Order Types card grid ─────────────────────── */}
      <BentoTile>
        <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s4}}>ORDER TYPES <span style={{color:T.blue}}>· click to select</span></div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(280px, 1fr))",gap:T.s2}}>
          {ORDERS.map(([nm,desc,ok])=>{
            const selectable=ok&&!!OTYPE_BY_NAME[nm];
            const active=selectable&&otype===OTYPE_BY_NAME[nm];
            return <div key={nm} onClick={selectable?()=>setOtype(OTYPE_BY_NAME[nm]):undefined} style={{
              background:active?`${T.gain}12`:T.surface,
              border:`1px solid ${active?T.gain+"66":T.border}`,
              borderLeft:`3px solid ${ok?T.gain:T.loss}`,
              borderRadius:T.rMd,
              padding:`${T.s3} ${T.s4}`,
              display:"flex",gap:T.s3,alignItems:"flex-start",
              opacity:ok?1:0.7,
              cursor:selectable?"pointer":"default",
              transition:"background 0.15s, border-color 0.15s",
            }}>
              <div style={{
                width:18,height:18,borderRadius:T.rSm,flexShrink:0,marginTop:2,
                background:ok?`${T.gain}22`:`${T.loss}22`,
                border:`1px solid ${ok?T.gain:T.loss}40`,
                display:"flex",alignItems:"center",justifyContent:"center",
                fontFamily:FM,fontSize:10,color:ok?T.gain:T.loss,fontWeight:700,
              }}>{ok?<Icon name="check" size={12}/>:<Icon name="close" size={12}/>}</div>
              <div style={{flex:1}}>
                <div style={{display:"flex",alignItems:"center",gap:T.s2}}>
                  <span style={{fontFamily:FP,fontSize:13,fontWeight:600,color:ok?T.textHi:T.muted,letterSpacing:"-0.005em"}}>{nm}</span>
                  {active&&<span style={{fontFamily:FM,fontSize:8,fontWeight:700,letterSpacing:"0.14em",color:T.gain,background:`${T.gain}1e`,border:`1px solid ${T.gain}40`,borderRadius:T.rSm,padding:"1px 5px"}}>SELECTED</span>}
                  {selectable&&!active&&<span style={{fontFamily:FM,fontSize:8,fontWeight:600,letterSpacing:"0.1em",color:T.blue}}>SELECT</span>}
                </div>
                <div style={{fontFamily:FP,fontSize:12,color:T.muted,lineHeight:1.55,letterSpacing:"-0.005em",marginTop:T.s1}}>{desc}</div>
              </div>
            </div>;
          })}
        </div>
      </BentoTile>
    </div>}

  </div>;
}

/* ─── SETTINGS ───────────────────────────────────────── */
/* ─── AI ADVISOR ─────────────────────────────────────── */
function AIAdvisor({accounts=[],activities=[],metrics={},hasKey=false}){
  const[msgs,setMsgs]=useState([]);
  const[input,setInput]=useState("");
  const[busy,setBusy]=useState(false);
  // Pre-flight token notice — null when no warning. {kind:"warn"|"err", text}.
  // Cleared whenever a new turn starts so the warning never sticks around for
  // an unrelated question.
  const[tokenNotice,setTokenNotice]=useState(null);
  const scrollRef=useRef(null);

  // Build a tight portfolio summary (string) sent as system context. Keep small
  // so we don't blow tokens.
  const context=useMemo(()=>{
    const total=accounts.reduce((s,a)=>s+(a.balance||0),0);
    const byBroker=accounts.map(a=>`${a.brokerage} ${a.accountName}: ${kf(a.balance||0)} (${a.positions.length} positions, ${kf(a.cash||0)} cash)`).join("; ");
    const positions=accounts.flatMap(a=>(a.positions||[])).slice(0,30).map(p=>{
      const s=p.symbol;
      const tk=typeof s==="string"?s:(s?.symbol||s?.raw_symbol||"?");
      return`${tk} ${p.units}sh @ $${p.average_purchase_price||0}/cost, $${p.price||0}/now`;
    }).join("; ");
    const ytd=metrics.ytdContrib||0,allTime=metrics.allTimeContrib||0,div=metrics.ytdDividends||0;
    return`PORTFOLIO SUMMARY
Total NW: ${kf(total)}.
Accounts: ${byBroker||"none connected"}.
Top positions: ${positions||"none"}.
YTD contrib: ${kf(ytd)}, all-time: ${kf(allTime)}, YTD dividends: ${kf(div)}.
Activity rows on file: ${activities.length}.`;
  },[accounts,activities,metrics]);

  const send=async(question)=>{
    const q=(question||input).trim();
    if(!q||busy)return;
    setTokenNotice(null);
    const sys=`You are MIZAN's Sharia-aware financial EDUCATION assistant. You provide general, educational information about Islamic finance and how AAOIFI screening rules work — NOT personalized investment advice. MIZAN is not a registered investment adviser (RIA). Do NOT issue personalized directives to buy, sell, or hold specific securities; instead explain the relevant considerations and tradeoffs, present options neutrally, and remind the user to confirm decisions with a licensed financial adviser and a qualified scholar. Use AAOIFI screening rules. Be specific, numeric, and concise (under 150 words unless asked). You may reference the portfolio summary below for context.\n\n${context}`;
    // Pre-flight token count. We send the same {messages, system, model}
    // shape the chat call will use, so the server's count matches the bytes
    // it'll actually forward to Anthropic (incl. the server-owned advisor
    // prefix). If the count call itself fails for an unexpected reason
    // (network, server bug), we fall through and let the real call proceed
    // so a broken pre-flight never blocks the user.
    try{
      const cr=await apiFetch("/api/advisor/count",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({system:sys,messages:[{role:"user",content:q}]}),
      });
      const cd=await cr.json().catch(()=>({}));
      if(cr.status===400){
        // Server rejected the context as too large — show inline and abort.
        setTokenNotice({kind:"err",text:cd.error||"Context too large to send."});
        return;
      }
      if(cr.ok&&Number(cd.input_tokens)>6000){
        setTokenNotice({kind:"warn",text:`Long context (${cd.input_tokens.toLocaleString()} tokens) — answer may be slower.`});
      }
    }catch{/* pre-flight is best-effort; proceed on transport failure */}
    setMsgs(m=>[...m,{role:"user",text:q}]);
    setInput("");setBusy(true);
    try{
      const r=await apiFetch("/api/advisor",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({system:sys,messages:[{role:"user",content:q}],max_tokens:1200}),
      });
      const d=await r.json();
      if(!r.ok||d.error){
        const msg=d.error?.message||d.error||`HTTP ${r.status}`;
        setMsgs(m=>[...m,{role:"err",text:String(msg)}]);
        return;
      }
      const text=(d.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("");
      setMsgs(m=>[...m,{role:"assistant",text:text||"(empty response)"}]);
    }catch(err){
      setMsgs(m=>[...m,{role:"err",text:err.message||"Request failed"}]);
    }finally{setBusy(false);}
  };

  useEffect(()=>{scrollRef.current?.scrollTo(0,scrollRef.current.scrollHeight);},[msgs,busy]);

  const totalNW=accounts.reduce((s,a)=>s+(a.balance||0),0);
  const totalPos=accounts.reduce((s,a)=>s+(a.positions?.length||0),0);

  // Suggested prompts presented as accent-colored bento cards. Each ties
  // to a different topic so the user can scan by domain.
  const prompts=[
    {q:"What's my biggest concentration risk?",            cat:"Risk",       icon:"warning",color:T.loss},
    {q:"Recommend 3 Sharia-compliant ETFs to diversify",   cat:"Allocation", icon:"◆",  color:T.blue},
    {q:"Should I tax-loss harvest any positions?",         cat:"Tax",        icon:"$",  color:T.gold},
    {q:"What's my projected Zakat for the year?",          cat:"Zakat",      icon:"scale",color:T.gold},
    {q:"How do I exit non-compliant positions efficiently?",cat:"Compliance",icon:"check",color:T.gain},
    {q:"Summarize my last 30 days of activity",            cat:"Activity",   icon:"≡",  color:T.blue},
  ];

  const clearChat=()=>{if(msgs.length===0)return;if(!window.confirm("Clear this conversation?"))return;setMsgs([]);};
  const copyMsg=async text=>{try{await navigator.clipboard.writeText(text);}catch{}};

  return<div style={{display:"flex",flexDirection:"column",gap:T.s4}}>
    {/* ─── CONTEXT BAR ────────────────────────────── */}
    <div style={{
      display:"flex",alignItems:"center",justifyContent:"space-between",
      padding:`${T.s3} ${T.s4}`,
      background:`linear-gradient(135deg, ${T.blue}10, transparent 60%), ${T.surface}`,
      border:`1px solid ${T.blue}30`,
      borderRadius:T.rMd,
      flexWrap:"wrap",gap:T.s2,
    }}>
      <div style={{display:"flex",alignItems:"center",gap:T.s3,flexWrap:"wrap"}}>
        <div style={{
          width:36,height:36,borderRadius:T.rMd,
          background:`linear-gradient(135deg, ${T.blue}, ${T.blueDim})`,
          display:"flex",alignItems:"center",justifyContent:"center",
          fontFamily:FU,fontSize:16,fontWeight:700,color:"#fff",letterSpacing:"-0.02em",
          boxShadow:`0 4px 14px ${T.blue}55`,
        }}>M</div>
        <div>
          <div style={{fontFamily:FP,fontSize:14,fontWeight:600,color:T.textHi,letterSpacing:"-0.01em"}}>Mizan Advisor</div>
          <div style={{fontFamily:FM,fontSize:11,color:T.muted,marginTop:2}}>Sharia-aware · powered by Claude</div>
        </div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:T.s4,fontFamily:FM,fontSize:11,color:T.muted,flexWrap:"wrap"}}>
        <span style={{display:"inline-flex",alignItems:"center",gap:T.s1}}>
          <LiveDot on={totalNW>0} pulse={false}/>
          Context: <span style={{color:T.textHi,fontWeight:600,fontVariantNumeric:"tabular-nums"}}>{accounts.length}</span> account{accounts.length===1?"":"s"} · <span style={{color:T.textHi,fontWeight:600,fontVariantNumeric:"tabular-nums"}}>{totalPos}</span> position{totalPos===1?"":"s"} · <span style={{color:T.textHi,fontWeight:600,fontVariantNumeric:"tabular-nums"}}>{kf(totalNW)}</span>
        </span>
        {msgs.length>0&&<button onClick={clearChat} className="btn-ghost" style={{fontSize:10,padding:`4px ${T.s3}`}}>Clear</button>}
      </div>
    </div>

    {/* Persistent advice disclaimer — always visible, not just on the empty state */}
    <div style={{fontFamily:FM,fontSize:10,color:T.dim,letterSpacing:"0.03em",lineHeight:1.5,padding:`0 ${T.s1}`}}>
      Educational information only — not investment advice. MĪZAN is not a registered investment adviser. Verify decisions with a licensed professional and a qualified scholar.
    </div>

    {/* ─── CHAT THREAD ────────────────────────────── */}
    <BentoTile style={{padding:0,display:"flex",flexDirection:"column",minHeight:"60vh",maxHeight:"calc(100vh - 280px)"}}>
      <div ref={scrollRef} style={{flex:1,overflowY:"auto",padding:`${T.s6} ${T.s6}`,display:"flex",flexDirection:"column",gap:T.s4}}>
        {msgs.length===0&&<div style={{margin:"auto 0",display:"flex",flexDirection:"column",gap:T.s5}}>
          <div style={{textAlign:"center"}}>
            <div style={{fontFamily:FU,fontSize:24,fontWeight:700,color:T.textHi,letterSpacing:"-0.025em",marginBottom:T.s2}}>How can I help with your portfolio?</div>
            <div style={{fontFamily:FP,fontSize:14,color:T.muted,maxWidth:480,margin:"0 auto",lineHeight:1.55}}>
              The advisor has your real account context — balances, top positions, Sharia compliance, contributions, dividends, and activity. Ask anything, or pick one of the suggestions below.
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(260px, 1fr))",gap:T.s3,maxWidth:780,margin:"0 auto",width:"100%"}}>
            {prompts.map(p=><button key={p.q} onClick={()=>send(p.q)} disabled={busy} style={{
              textAlign:"left",
              padding:`${T.s3} ${T.s4}`,
              background:T.surface,
              border:`1px solid ${T.border}`,
              borderLeft:`3px solid ${p.color}`,
              borderRadius:T.rMd,
              fontFamily:FP,fontSize:13,color:T.text,cursor:busy?"not-allowed":"pointer",
              lineHeight:1.5,letterSpacing:"-0.005em",
              transition:"transform 0.15s, border-color 0.15s, box-shadow 0.2s",
              display:"flex",flexDirection:"column",gap:T.s1,
            }}
            onMouseEnter={e=>{if(!busy){e.currentTarget.style.transform="translateY(-1px)";e.currentTarget.style.boxShadow="var(--sh-md)";e.currentTarget.style.borderColor=p.color+"55";}}}
            onMouseLeave={e=>{e.currentTarget.style.transform="none";e.currentTarget.style.boxShadow="none";e.currentTarget.style.borderLeftColor=p.color;e.currentTarget.style.borderTopColor=T.border;e.currentTarget.style.borderRightColor=T.border;e.currentTarget.style.borderBottomColor=T.border;}}>
              <div style={{display:"flex",alignItems:"center",gap:T.s2}}>
                <span style={{
                  width:22,height:22,borderRadius:T.rSm,
                  background:`${p.color}18`,color:p.color,
                  display:"flex",alignItems:"center",justifyContent:"center",
                  fontFamily:FM,fontSize:12,fontWeight:700,
                }}>{ICONS[p.icon]?<Icon name={p.icon} size={13} color={p.color}/>:p.icon}</span>
                <span style={{fontFamily:FM,fontSize:9,color:p.color,letterSpacing:"0.16em",fontWeight:600,textTransform:"uppercase"}}>{p.cat}</span>
              </div>
              <span style={{color:T.textHi,fontWeight:500}}>{p.q}</span>
            </button>)}
          </div>
          <div style={{fontFamily:FM,fontSize:10,color:T.dim,textAlign:"center",letterSpacing:"0.04em"}}>Not financial advice. Always consult a licensed professional + qualified scholar.</div>
        </div>}

        {msgs.map((m,i)=>{
          const isUser=m.role==="user",isErr=m.role==="err";
          return<div key={i} style={{display:"flex",gap:T.s3,alignItems:"flex-start",justifyContent:isUser?"flex-end":"flex-start"}}>
            {!isUser&&<div style={{
              width:32,height:32,borderRadius:T.rMd,flexShrink:0,
              background:isErr?`${T.loss}22`:`linear-gradient(135deg, ${T.blue}, ${T.blueDim})`,
              display:"flex",alignItems:"center",justifyContent:"center",
              fontFamily:FP,fontSize:13,fontWeight:700,color:isErr?T.loss:"#fff",letterSpacing:"-0.02em",
              boxShadow:isErr?"none":`0 2px 8px ${T.blue}40`,
            }}>{isErr?"!":"M"}</div>}
            <div style={{
              maxWidth:"78%",
              padding:`${T.s3} ${T.s4}`,
              borderRadius:T.rLg,
              background:isUser?`linear-gradient(135deg, ${T.blue}, ${T.blueDim})`:isErr?T.lossBg:T.surface,
              border:isUser?"none":`1px solid ${isErr?T.loss+"40":T.border}`,
              color:isUser?"#fff":isErr?T.loss:T.text,
              fontFamily:FP,fontSize:14,lineHeight:1.6,letterSpacing:"-0.005em",
              whiteSpace:"pre-wrap",wordBreak:"break-word",
              boxShadow:isUser?`0 4px 14px ${T.blue}40`:"none",
              position:"relative",
            }}>
              {m.text}
              {!isUser&&!isErr&&<button onClick={()=>copyMsg(m.text)} title="Copy" style={{
                position:"absolute",top:6,right:6,
                padding:`2px ${T.s2}`,borderRadius:T.rSm,
                background:T.card,border:`1px solid ${T.border}`,
                color:T.muted,cursor:"pointer",
                fontFamily:FM,fontSize:9,fontWeight:600,letterSpacing:"0.06em",
                opacity:0,transition:"opacity 0.15s",
              }}
              onMouseEnter={e=>e.currentTarget.style.opacity="1"}
              onMouseLeave={e=>e.currentTarget.style.opacity="0"}>COPY</button>}
            </div>
            {isUser&&<div style={{
              width:32,height:32,borderRadius:T.rMd,flexShrink:0,
              background:T.surface,border:`1px solid ${T.border}`,
              display:"flex",alignItems:"center",justifyContent:"center",
              fontFamily:FP,fontSize:13,fontWeight:600,color:T.text,
            }}>Y</div>}
          </div>;
        })}

        {busy&&<div style={{display:"flex",gap:T.s3,alignItems:"center"}}>
          <div style={{width:32,height:32,borderRadius:T.rMd,flexShrink:0,background:`linear-gradient(135deg, ${T.blue}, ${T.blueDim})`,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:FP,fontSize:13,fontWeight:700,color:"#fff"}}>M</div>
          <div style={{display:"flex",gap:T.s1,padding:`${T.s2} ${T.s3}`,background:T.surface,border:`1px solid ${T.border}`,borderRadius:T.rLg}}>
            {[0,1,2].map(i=><span key={i} style={{display:"inline-block",width:6,height:6,borderRadius:"50%",background:T.muted,animation:`blink 1.4s infinite`,animationDelay:`${i*0.15}s`}}/>)}
          </div>
        </div>}
      </div>

      {tokenNotice&&<div style={{
        borderTop:`1px solid ${tokenNotice.kind==="err"?T.loss+"40":T.gold+"40"}`,
        padding:`${T.s2} ${T.s4}`,
        background:tokenNotice.kind==="err"?T.lossBg:`${T.gold}10`,
        fontFamily:FM,fontSize:11,
        color:tokenNotice.kind==="err"?T.loss:T.gold,
        display:"flex",alignItems:"center",gap:T.s2,letterSpacing:"0.01em",
      }}>
        <Icon name="warning" size={13} style={{display:"inline-block",verticalAlign:"-2px"}}/>
        <span>{tokenNotice.text}</span>
      </div>}
      <form onSubmit={e=>{e.preventDefault();send();}} style={{borderTop:"1px solid var(--mz-glass-border)",padding:T.s3,display:"flex",gap:T.s2,background:"var(--mz-glass)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)"}}>
        <input value={input} onChange={e=>setInput(e.target.value)} placeholder="Ask about your portfolio…" disabled={busy}
          className="field" style={{flex:1,fontFamily:FP,fontSize:14,padding:`10px ${T.s4}`}}/>
        <button type="submit" disabled={busy||!input.trim()} className="btn-primary" style={{padding:`10px ${T.s5}`}}>{busy?"…":"Send"}</button>
      </form>
    </BentoTile>
  </div>;
}

/* ─── MANUAL ASSET LEDGER ────────────────────────────── */
// Track non-broker assets (gold, real estate, business equity, vehicles) so
// net-worth and Zakat math reflect everything you own. Persists locally.
function ManualAssets({demoMode=false}={}){
  const[assets,setAssets]=useState(()=>{
    if(demoMode)return DEMO_MANUAL_ASSETS;
    try{return JSON.parse(localStorage.getItem("mizan_manual_assets")||"[]");}catch{return[];}
  });
  const[form,setForm]=useState({type:"Gold",name:"",value:"",zakatable:true,notes:""});

  // Keep demo fixture authoritative when demo toggle flips on/off
  useEffect(()=>{
    if(demoMode){setAssets(DEMO_MANUAL_ASSETS);return;}
    try{setAssets(JSON.parse(localStorage.getItem("mizan_manual_assets")||"[]"));}catch{setAssets([]);}
  },[demoMode]);

  const persist=arr=>{
    if(demoMode)return; // demo state is read-only
    setAssets(arr);try{localStorage.setItem("mizan_manual_assets",JSON.stringify(arr));}catch{}persistUserState("mizan_manual_assets",arr);
  };
  const add=(e)=>{
    e.preventDefault();
    if(demoMode||!form.name||!form.value)return;
    const next=[...assets,{...form,value:+form.value,id:`m-${Date.now()}`,added:new Date().toISOString().slice(0,10)}];
    persist(next);
    setForm({type:"Gold",name:"",value:"",zakatable:true,notes:""});
  };
  const remove=id=>{if(demoMode)return;persist(assets.filter(a=>a.id!==id));};
  const total=assets.reduce((s,a)=>s+(+a.value||0),0);
  const zakatable=assets.filter(a=>a.zakatable).reduce((s,a)=>s+(+a.value||0),0);

  return<div style={{display:"flex",flexDirection:"column",gap:T.s4}}>
    {/* ─── Hero: total + zakatable side stack ────────── */}
    <div className="bento-row" style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:T.s4}}>
      <BentoTile style={{
        background:`radial-gradient(circle at 0% 0%, ${T.blue}15, transparent 55%), ${T.card}`,
      }}>
        <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>MANUAL ASSETS TOTAL</div>
        <div style={{fontFamily:FU,fontSize:34,fontWeight:700,color:T.textHi,letterSpacing:"-0.03em",lineHeight:1,fontVariantNumeric:"tabular-nums"}}>{kf(total)}</div>
        <div style={{fontFamily:FM,fontSize:12,color:T.muted,marginTop:T.s2}}>{assets.length} entr{assets.length===1?"y":"ies"}</div>
        <p style={{fontFamily:FP,fontSize:13,color:T.muted,margin:`${T.s4} 0 0`,lineHeight:1.55,maxWidth:560}}>
          Track assets your brokerage can't see — physical gold, real estate equity, private business stake, vehicles, collectibles. Toggle Zakat-eligibility per asset.
        </p>
      </BentoTile>
      <BentoTile accent={T.gold} style={{background:`linear-gradient(135deg, ${T.gold}10, transparent 60%), ${T.card}`}}>
        <div style={{fontFamily:FM,fontSize:10,color:T.gold,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>ZAKATABLE SHARE</div>
        <div style={{fontFamily:FU,fontSize:28,fontWeight:700,color:T.textHi,letterSpacing:"-0.025em",fontVariantNumeric:"tabular-nums"}}>{kf(zakatable)}</div>
        <div style={{fontFamily:FM,fontSize:12,fontWeight:500,color:T.gold,marginTop:T.s2}}>Adds {kf(zakatable*0.025)} to Zakat</div>
      </BentoTile>
    </div>

    {/* ─── Add asset form ─────────────────────────── */}
    <BentoTile>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:T.s3,gap:T.s2,flexWrap:"wrap"}}>
        <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600}}>ADD AN ASSET</div>
        {demoMode&&<span style={{fontFamily:FM,fontSize:10,color:T.blue,letterSpacing:"0.14em",fontWeight:600,padding:`2px ${T.s2}`,borderRadius:T.rSm,background:`${T.blue}14`,border:`1px solid ${T.blue}30`}}>DEMO — READ ONLY</span>}
      </div>
      <form onSubmit={add} className="mz-form-row" style={{display:"grid",gridTemplateColumns:"150px 1fr 140px auto auto",gap:T.s2,alignItems:"center",opacity:demoMode?0.55:1,pointerEvents:demoMode?"none":undefined}}>
        <select value={form.type} onChange={e=>setForm({...form,type:e.target.value})} className="field" style={{cursor:"pointer"}} disabled={demoMode}>
          {["Gold","Silver","Real Estate","Investment Property","Business Equity","Vehicle","Collectible","Other"].map(t=><option key={t}>{t}</option>)}
        </select>
        <input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Description (e.g. Wedding gold, Primary home equity)" className="field" disabled={demoMode}/>
        <input type="number" value={form.value} onChange={e=>setForm({...form,value:e.target.value})} placeholder="Value $" className="field" style={{fontVariantNumeric:"tabular-nums"}} disabled={demoMode}/>
        <label style={{fontFamily:FM,fontSize:11,fontWeight:500,color:T.muted,display:"flex",alignItems:"center",gap:T.s1,cursor:"pointer",letterSpacing:"0.04em",whiteSpace:"nowrap"}}>
          <input type="checkbox" checked={form.zakatable} onChange={e=>setForm({...form,zakatable:e.target.checked})} style={{accentColor:T.gold,width:14,height:14}} disabled={demoMode}/>
          Zakat
        </label>
        <button type="submit" className="btn-primary" disabled={demoMode}>+ Add</button>
      </form>
    </BentoTile>

    {/* ─── Assets table ─────────────────────────── */}
    {assets.length>0
      ?<BentoTile style={{padding:0,overflow:"hidden"}}>
        <Tbl cols={[
          {l:"Type",r_:r=><Tag label={r.type} color={r.type==="Gold"||r.type==="Silver"?T.gold:r.type.includes("Real")?T.blue:r.type==="Business Equity"?T.gain:T.muted}/>},
          {l:"Name",r_:r=><span style={{fontFamily:FP,fontSize:13,color:T.text,letterSpacing:"-0.005em"}}>{r.name}</span>},
          {l:"Value",r:true,r_:r=><span style={{fontFamily:FP,fontSize:14,fontWeight:600,color:T.textHi,letterSpacing:"-0.005em",fontVariantNumeric:"tabular-nums"}}>{f$(r.value)}</span>},
          {l:"Zakat",r_:r=><Tag label={r.zakatable?"Included":"Excluded"} color={r.zakatable?T.gold:T.muted}/>},
          {l:"Added",r_:r=><span style={{fontFamily:FM,fontSize:11,color:T.muted,fontVariantNumeric:"tabular-nums"}}>{r.added}</span>},
          {l:"",r_:r=>demoMode
            ?<span style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.04em"}}>—</span>
            :<button onClick={()=>remove(r.id)} style={{padding:`3px ${T.s2}`,borderRadius:T.rSm,background:"transparent",border:`1px solid ${T.loss}30`,color:T.loss,cursor:"pointer",fontFamily:FM,fontSize:11}}><Icon name="close" size={12}/></button>},
        ]} rows={assets}/>
      </BentoTile>
      :<BentoTile style={{padding:`${T.s8} ${T.s5}`,textAlign:"center",borderStyle:"dashed"}}>
        <div style={{fontFamily:FP,fontSize:14,fontWeight:500,color:T.muted}}>No manual assets yet.</div>
        <div style={{fontFamily:FP,fontSize:12,color:T.muted,marginTop:T.s1}}>Add gold, real estate, or business equity above to include them in net-worth + Zakat math.</div>
      </BentoTile>}
  </div>;
}

/* ─── CSV IMPORTER ───────────────────────────────────── */
function CSVImporter({onImport,onDedupe,onRetag}){
  const[broker,setBroker]=useState("Fidelity");
  const[status,setStatus]=useState(null);
  const[busy,setBusy]=useState(false);
  const[dedupeBusy,setDedupeBusy]=useState(false);
  const[retagBusy,setRetagBusy]=useState(false);
  const fileRef=useRef(null);

  const handleDedupe=()=>{
    if(!onDedupe||dedupeBusy)return;
    if(!window.confirm("Scan all imported activity for duplicate rows and remove them? This won't touch SnapTrade data — only your CSV imports."))return;
    setDedupeBusy(true);setStatus(null);
    // setTimeout lets the busy state paint before the (synchronous) sweep.
    setTimeout(()=>{
      try{
        const r=onDedupe();
        if(!r||r.removed===0){
          setStatus({ok:true,msg:"No duplicate rows found — your history is already clean."});
        }else{
          const parts=[`Removed ${r.removed} duplicate row${r.removed===1?"":"s"}.`];
          if(r.internalRemoved>0)parts.push(`${r.internalRemoved} were within your CSV imports.`);
          if(r.crossRemoved>0)parts.push(`${r.crossRemoved} already existed in SnapTrade.`);
          parts.push(`${r.kept} unique entries kept.`);
          setStatus({ok:true,msg:parts.join(" ")});
        }
      }catch(err){
        setStatus({ok:false,msg:err.message||"Dedupe failed"});
      }finally{setDedupeBusy(false);}
    },0);
  };

  const handleRetag=()=>{
    if(!onRetag||retagBusy)return;
    if(!window.confirm("Walk your imported activity and re-tag the broker for any rows that match a known SnapTrade trade? Useful when a CSV was uploaded with the wrong broker selected."))return;
    setRetagBusy(true);setStatus(null);
    setTimeout(()=>{
      try{
        const r=onRetag();
        if(!r||r.fixed===0){
          setStatus({ok:true,msg:`No retagging needed — ${r?.checked||0} rows already correctly attributed.`});
        }else{
          const breakdown=Object.entries(r.byBroker||{}).map(([b,n])=>`${n}→${b}`).join(", ");
          setStatus({ok:true,msg:`Retagged ${r.fixed} of ${r.checked} rows. ${breakdown}`});
        }
      }catch(err){
        setStatus({ok:false,msg:err.message||"Retag failed"});
      }finally{setRetagBusy(false);}
    },0);
  };

  const handle=async e=>{
    const file=e.target.files?.[0];
    if(!file||!onImport)return;
    setBusy(true);setStatus(null);
    // Peek at the header to figure out which broker the file ACTUALLY is.
    // Auto-corrects the dropdown when we can tell. Prevents the very common
    // bug of importing a Robinhood CSV with the dropdown still on Fidelity
    // (default), which tagged every imported row with the wrong account.
    let usedBroker=broker;
    try{
      const peek=await file.slice(0,4096).text();
      const detected=detectBroker(peek);
      if(detected&&detected!==broker){
        setBroker(detected);
        usedBroker=detected;
      }
    }catch{}
    try{
      const r=await onImport(file,usedBroker);
      const detectedNote=usedBroker!==broker?` Detected as ${usedBroker}.`:"";
      // Backwards-compat: importCSV used to resolve with a row count. It
      // now resolves with {added,skipped,total}. Handle both shapes.
      if(typeof r==="number"){
        setStatus({ok:true,msg:`Imported ${r} rows from ${file.name}.${detectedNote}`});
      }else if(r.added===0&&r.skipped>0){
        setStatus({ok:true,msg:`No new rows — all ${r.skipped} entries in ${file.name} are already imported.${detectedNote}`});
      }else if(r.skipped>0){
        setStatus({ok:true,msg:`Added ${r.added} new rows from ${file.name} (skipped ${r.skipped} duplicates).`});
      }else{
        setStatus({ok:true,msg:`Imported ${r.added} rows from ${file.name}.`});
      }
    }catch(err){
      setStatus({ok:false,msg:err.message||"Parse failed"});
    }finally{
      setBusy(false);
      if(fileRef.current)fileRef.current.value="";
    }
  };

  return<div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:T.rLg,padding:`${T.s4} ${T.s5}`,marginTop:T.s4,boxShadow:"var(--sh-sm)"}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:T.s4,flexWrap:"wrap"}}>
      <div>
        <div style={{fontFamily:FP,fontSize:14,fontWeight:600,color:T.textHi,marginBottom:T.s1,letterSpacing:"-0.01em"}}>CSV Import — Historical Backfill</div>
        <p style={{fontFamily:FP,fontSize:13,color:T.muted,margin:0,lineHeight:1.55,maxWidth:480}}>
          SnapTrade only backfills 1–2 years for some brokers. Export your full activity CSV from Fidelity / Robinhood / Coinbase and import it here for complete YTD + lifetime contribution numbers.
        </p>
      </div>
      <div style={{display:"flex",gap:T.s2,alignItems:"center",flexShrink:0,flexWrap:"wrap"}}>
        <select value={broker} onChange={e=>setBroker(e.target.value)} className="field" style={{width:"auto",cursor:"pointer"}}>
          <option>Fidelity</option><option>Robinhood</option><option>Coinbase</option>
          <option>Schwab</option><option>Vanguard</option><option>Other</option>
        </select>
        <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={handle} style={{display:"none"}}/>
        <button onClick={()=>fileRef.current?.click()} disabled={busy} className="btn-primary">{busy?"Parsing…":"Choose CSV"}</button>
        {onDedupe&&<button onClick={handleDedupe} disabled={dedupeBusy} title="Scan imported activity and remove duplicate rows" className="btn-ghost">{dedupeBusy?"Scanning…":"Dedupe history"}</button>}
        {onRetag&&<button onClick={handleRetag} disabled={retagBusy} title="Re-tag imports with the correct broker by matching against SnapTrade trades" className="btn-ghost">{retagBusy?"Retagging…":"Fix broker tags"}</button>}
      </div>
    </div>
    {status&&<div style={{marginTop:T.s3,padding:`${T.s2} ${T.s3}`,borderRadius:T.rMd,fontFamily:FM,fontSize:11,background:status.ok?T.gainBg:T.lossBg,border:`1px solid ${(status.ok?T.gain:T.loss)+"30"}`,color:status.ok?T.gain:T.loss,whiteSpace:"pre-wrap",lineHeight:1.5}}>{status.ok?ICON_OK:ICON_NO}{status.msg}</div>}
  </div>;
}

/* ─── SECURITY PANEL ─────────────────────────────────── */
// Account security: 2FA enrollment + status. Available to every user
// regardless of role — security is a baseline, not a paywall.
function SecurityPanel(){
  const{user,isSupabaseConfigured,mfaListFactors,mfaEnroll,mfaVerify,mfaUnenroll}=useAuth();
  const[factors,setFactors]=useState([]);
  const[loading,setLoading]=useState(true);
  const[enrolling,setEnrolling]=useState(null); // {factorId, qr, secret, uri}
  const[code,setCode]=useState("");
  const[busy,setBusy]=useState(false);
  const[error,setError]=useState(null);
  const[info,setInfo]=useState(null);

  const refresh=useCallback(async()=>{
    if(!isSupabaseConfigured){setLoading(false);return;}
    setLoading(true);
    const r=await mfaListFactors();
    setFactors(r?.data?.totp||[]);
    setLoading(false);
  },[isSupabaseConfigured,mfaListFactors]);
  useEffect(()=>{refresh();},[refresh]);

  const startEnroll=async()=>{
    setError(null);setInfo(null);setBusy(true);
    const r=await mfaEnroll("MIZAN");
    setBusy(false);
    if(r.error)return setError(r.error.message||"Could not start enrollment");
    setEnrolling({
      factorId:r.data.id,
      qr:r.data.totp?.qr_code,
      secret:r.data.totp?.secret,
      uri:r.data.totp?.uri,
    });
    setCode("");
  };
  const confirmEnroll=async()=>{
    if(!enrolling||code.length<6)return setError("Enter the 6-digit code from your authenticator");
    setBusy(true);setError(null);
    const r=await mfaVerify(enrolling.factorId,code);
    setBusy(false);
    if(r.error)return setError(r.error.message||"Invalid code");
    setEnrolling(null);setCode("");
    setInfo("Two-factor authentication enabled. You'll be prompted for a code on next sign-in.");
    refresh();
  };
  const cancelEnroll=async()=>{
    if(!enrolling)return;
    // Clean up the unverified factor so it doesn't dangle in Supabase.
    await mfaUnenroll(enrolling.factorId).catch(()=>{});
    setEnrolling(null);setCode("");setError(null);
  };
  const disableMfa=async(factorId)=>{
    if(!confirm("Disable two-factor authentication? Your account becomes less secure."))return;
    setBusy(true);setError(null);
    const r=await mfaUnenroll(factorId);
    setBusy(false);
    if(r.error)return setError(r.error.message||"Could not disable");
    setInfo("Two-factor authentication disabled.");
    refresh();
  };

  const verified=factors.filter(f=>f.status==="verified");
  if(!isSupabaseConfigured){
    return<div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:"24px 28px"}}>
      <div style={{fontFamily:FM,fontSize:11,color:T.muted,letterSpacing:"0.14em",marginBottom:8}}>SECURITY</div>
      <p style={{fontFamily:FP,fontSize:13,color:T.muted,margin:0,lineHeight:1.6}}>Multi-factor authentication requires Supabase Auth. Configure VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY to enable.</p>
    </div>;
  }

  return<div style={{display:"flex",flexDirection:"column",gap:14}}>
    <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:"22px 24px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:14,marginBottom:10}}>
        <div>
          <div style={{fontFamily:FM,fontSize:11,color:T.blue,letterSpacing:"0.16em",fontWeight:600,marginBottom:6}}>TWO-FACTOR AUTHENTICATION</div>
          <p style={{fontFamily:FP,fontSize:13,color:T.muted,margin:0,lineHeight:1.6,maxWidth:520}}>
            Add a TOTP authenticator (1Password, Authy, Google Authenticator) so a stolen password isn't enough to sign in.
          </p>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
          {verified.length>0
            ?<Tag label="Enabled" color={T.gain}/>
            :<Tag label="Off"     color={T.muted}/>}
        </div>
      </div>

      {loading&&<div style={{fontFamily:FM,fontSize:11,color:T.muted,padding:"6px 0"}}>Loading…</div>}

      {!loading&&!enrolling&&verified.length===0&&<div style={{marginTop:8}}>
        <button onClick={startEnroll} disabled={busy} style={{padding:"9px 18px",borderRadius:8,fontFamily:FM,fontSize:11,fontWeight:600,letterSpacing:"0.06em",background:T.blue,border:"none",color:"#fff",cursor:busy?"not-allowed":"pointer"}}>{busy?"Working…":"Enable 2FA"}</button>
      </div>}

      {!loading&&!enrolling&&verified.length>0&&<div style={{marginTop:10,display:"flex",flexDirection:"column",gap:8}}>
        {verified.map(f=><div key={f.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:T.surface,border:`1px solid ${T.border}`,borderRadius:8,padding:"10px 14px"}}>
          <div>
            <div style={{fontFamily:FM,fontSize:12,color:T.textHi}}>{f.friendly_name||"Authenticator"}</div>
            <div style={{fontFamily:FM,fontSize:10,color:T.muted,marginTop:2}}>Enrolled {f.created_at?new Date(f.created_at).toLocaleDateString():""}</div>
          </div>
          <button onClick={()=>disableMfa(f.id)} disabled={busy} style={{padding:"6px 12px",borderRadius:6,fontFamily:FM,fontSize:10,letterSpacing:"0.06em",background:"transparent",border:`1px solid ${T.loss}40`,color:T.loss,cursor:busy?"not-allowed":"pointer"}}>Disable</button>
        </div>)}
      </div>}

      {enrolling&&<div style={{marginTop:14,padding:14,background:T.surface,border:`1px solid ${T.border}`,borderRadius:10}}>
        <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.14em",marginBottom:10}}>STEP 1 — SCAN QR</div>
        {enrolling.qr&&<div style={{display:"flex",justifyContent:"center",marginBottom:10}}>
          <img src={enrolling.qr} alt="2FA QR code" style={{width:180,height:180,background:"#fff",padding:8,borderRadius:8}}/>
        </div>}
        {enrolling.secret&&<div style={{fontFamily:FM,fontSize:10,color:T.muted,textAlign:"center",marginBottom:12}}>
          Can't scan? Enter this secret manually:<br/>
          <span style={{fontFamily:FM,fontSize:11,color:T.text,letterSpacing:"0.06em"}}>{enrolling.secret}</span>
        </div>}
        <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.14em",marginBottom:8}}>STEP 2 — VERIFY</div>
        <input
          type="text" inputMode="numeric" maxLength={6}
          placeholder="6-digit code"
          value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,""))}
          style={{width:"100%",padding:"10px 12px",background:T.card,border:`1px solid ${T.border}`,borderRadius:8,fontFamily:FM,fontSize:16,color:T.text,letterSpacing:"0.3em",textAlign:"center",outline:"none",boxSizing:"border-box"}}
        />
        <div style={{display:"flex",gap:8,marginTop:10}}>
          <button onClick={confirmEnroll} disabled={busy} style={{flex:1,padding:"9px 14px",borderRadius:8,fontFamily:FM,fontSize:11,fontWeight:600,letterSpacing:"0.06em",background:busy?T.dim:T.blue,border:"none",color:"#fff",cursor:busy?"not-allowed":"pointer"}}>{busy?"Verifying…":"Confirm"}</button>
          <button onClick={cancelEnroll} disabled={busy} style={{padding:"9px 14px",borderRadius:8,fontFamily:FM,fontSize:11,letterSpacing:"0.06em",background:"transparent",border:`1px solid ${T.border}`,color:T.muted,cursor:busy?"not-allowed":"pointer"}}>Cancel</button>
        </div>
      </div>}

      {error&&<div style={{marginTop:10,padding:"8px 12px",borderRadius:8,fontFamily:FM,fontSize:11,background:T.lossBg,border:`1px solid ${T.loss}30`,color:T.loss}}>{error}</div>}
      {info&&<div style={{marginTop:10,padding:"8px 12px",borderRadius:8,fontFamily:FM,fontSize:11,background:T.gainBg,border:`1px solid ${T.gain}30`,color:T.gain}}>{info}</div>}
    </div>

    <SessionsPanel/>
  </div>;
}

/* ─── ACTIVE SESSIONS PANEL ─────────────────────────────── */
// Light user-agent parsing — no external dependency.
function parseUA(ua){
  if(!ua)return{device:"desktop",browser:"Unknown",os:"Unknown"};
  const u=String(ua);
  let os="Unknown";
  if(/Windows NT/.test(u))os="Windows";
  else if(/Mac OS X|Macintosh/.test(u))os="macOS";
  else if(/iPhone|iPad|iPod/.test(u))os="iOS";
  else if(/Android/.test(u))os="Android";
  else if(/Linux/.test(u))os="Linux";
  let browser="Unknown";
  if(/Edg\//.test(u))browser="Edge";
  else if(/Firefox\//.test(u))browser="Firefox";
  else if(/Chrome\//.test(u))browser="Chrome";
  else if(/Safari\//.test(u))browser="Safari";
  const device=/iPad|Tablet/.test(u)?"tablet":/Mobile|iPhone|Android(?!.*Tablet)/.test(u)?"mobile":"desktop";
  return{device,browser,os};
}
function deviceIcon(kind){
  if(kind==="mobile")return"▢";
  if(kind==="tablet")return"▣";
  return"▦";
}

function SessionsPanel(){
  const[sessions,setSessions]=useState([]);
  const[loading,setLoading]=useState(true);
  const[busy,setBusy]=useState(false);
  const[toast,setToast]=useState(null);
  const[err,setErr]=useState(null);

  const load=useCallback(async()=>{
    setLoading(true);setErr(null);
    try{
      const r=await apiFetch("/api/account/sessions");
      if(!r.ok)throw new Error(`Status ${r.status}`);
      const j=await r.json();
      setSessions(j.sessions||[]);
    }catch(e){setErr(e.message||"Failed to load sessions");}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{load();},[load]);

  const revoke=async(id)=>{
    setBusy(true);setErr(null);
    try{
      const r=await apiFetch(`/api/account/sessions/${id}`,{method:"DELETE"});
      if(!r.ok)throw new Error(`Status ${r.status}`);
      setSessions(sessions.filter(s=>s.id!==id));
      setToast("Session revoked");
      setTimeout(()=>setToast(null),3000);
    }catch(e){setErr(e.message||"Revoke failed");}
    finally{setBusy(false);}
  };
  const revokeAllOthers=async()=>{
    if(!confirm("Sign out everywhere except this device?"))return;
    setBusy(true);setErr(null);
    try{
      const r=await apiFetch("/api/account/sessions",{method:"DELETE"});
      if(!r.ok)throw new Error(`Status ${r.status}`);
      const j=await r.json();
      setSessions(sessions.filter(s=>s.current));
      setToast(`Revoked ${j.revoked ?? 0} other session${j.revoked===1?"":"s"}`);
      setTimeout(()=>setToast(null),3500);
    }catch(e){setErr(e.message||"Revoke failed");}
    finally{setBusy(false);}
  };

  const fmtDate=s=>s?new Date(s).toLocaleString():"—";
  const otherCount=sessions.filter(s=>!s.current).length;

  return<div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:"22px 24px",marginTop:T.s4}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:T.s4,marginBottom:T.s3,flexWrap:"wrap"}}>
      <div>
        <div style={{fontFamily:FM,fontSize:11,color:T.blue,letterSpacing:"0.16em",fontWeight:600,marginBottom:6}}>ACTIVE SESSIONS</div>
        <p style={{fontFamily:FP,fontSize:13,color:T.muted,margin:0,lineHeight:1.6,maxWidth:520}}>
          Every device currently signed into MIZAN with your account. Revoke any that you don't recognize.
        </p>
      </div>
      {otherCount>0&&<button onClick={revokeAllOthers} disabled={busy} className="btn-danger">Sign out all others</button>}
    </div>

    {toast&&<div style={{marginBottom:T.s3,padding:`${T.s2} ${T.s3}`,borderRadius:T.rMd,background:T.gainBg,border:`1px solid ${T.gain}30`,fontFamily:FM,fontSize:11,color:T.gain}}>{ICON_OK}{toast}</div>}
    {err&&<div style={{marginBottom:T.s3,padding:`${T.s2} ${T.s3}`,borderRadius:T.rMd,background:`${T.loss}10`,border:`1px solid ${T.loss}40`,fontFamily:FM,fontSize:11,color:T.loss}}>{ICON_NO}{err}</div>}

    {loading
      ?<div style={{fontFamily:FM,fontSize:11,color:T.muted,padding:`${T.s3} 0`}}>Loading…</div>
      :sessions.length===0
        ?<div style={{fontFamily:FP,fontSize:13,color:T.muted,padding:`${T.s3} 0`}}>No active sessions found.</div>
        :<div style={{display:"flex",flexDirection:"column",gap:T.s2}}>
          {sessions.map(s=>{
            const ua=parseUA(s.user_agent);
            return<div key={s.id} style={{
              display:"flex",alignItems:"center",justifyContent:"space-between",gap:T.s3,flexWrap:"wrap",
              background:T.surface,border:`1px solid ${s.current?T.gain+"40":T.border}`,borderRadius:T.rMd,padding:`${T.s3} ${T.s3}`,
            }}>
              <div style={{display:"flex",alignItems:"center",gap:T.s3,minWidth:0,flex:1}}>
                <span style={{fontSize:24,color:s.current?T.gain:T.muted,lineHeight:1}}>{deviceIcon(ua.device)}</span>
                <div style={{minWidth:0}}>
                  <div style={{fontFamily:FP,fontSize:13,fontWeight:600,color:T.textHi,letterSpacing:"-0.005em",display:"flex",alignItems:"center",gap:T.s2,flexWrap:"wrap"}}>
                    {ua.browser} · {ua.os}
                    {s.current&&<Tag label="CURRENT" color={T.gain}/>}
                  </div>
                  <div style={{fontFamily:FM,fontSize:10,color:T.muted,marginTop:2,letterSpacing:"0.02em"}}>
                    {s.ip?`IP ${s.ip} · `:""}signed in {fmtDate(s.created_at)}{s.last_seen_at&&s.last_seen_at!==s.created_at?` · seen ${fmtDate(s.last_seen_at)}`:""}
                  </div>
                </div>
              </div>
              {!s.current&&<button
                onClick={()=>revoke(s.id)}
                disabled={busy}
                title="Revoke this session"
                style={{padding:`6px ${T.s3}`,borderRadius:T.rSm,background:"transparent",border:`1px solid ${T.border}`,color:T.muted,cursor:busy?"not-allowed":"pointer",fontFamily:FM,fontSize:10,fontWeight:600,letterSpacing:"0.06em"}}
                onMouseEnter={e=>{e.currentTarget.style.color=T.loss;e.currentTarget.style.borderColor=T.loss+"60";}}
                onMouseLeave={e=>{e.currentTarget.style.color=T.muted;e.currentTarget.style.borderColor=T.border;}}
              >REVOKE</button>}
            </div>;
          })}
        </div>}
  </div>;
}

/* ─── SHARIA METHODOLOGY & GOVERNANCE ─────────────────── */
// Trust/credibility page. Mirrors the REAL engine (lib/sharia.mjs + the local
// STANDARDS table) — no marketing claims beyond what the code actually does.
// Governance is stated honestly: methodology is AAOIFI-aligned; named scholar
// certification is in progress (do NOT fabricate a board here).
function ShariaMethodology(){
  const EB={fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2};
  const P={fontFamily:FP,fontSize:13,color:T.muted,lineHeight:1.6,letterSpacing:"-0.005em",margin:0};
  const excluded=["Conventional banks & financial services","Insurance (conventional)","Mortgage & consumer finance","Alcohol & breweries","Tobacco","Gambling & casinos","Weapons & defense","Pork products","Adult entertainment"];
  const review=["Hotels, resorts & leisure","Media & entertainment","Restaurants","Broadcasting"];
  const ratios=[
    {t:"Debt / market cap",lim:"< 33%",d:"Total interest-bearing debt over market cap."},
    {t:"Cash & interest-bearing securities / market cap",lim:"< 33%",d:"Caps interest-earning assets."},
    {t:"Accounts receivable / market cap",lim:"< 49%",d:"Limits illiquid / credit exposure."},
    {t:"Non-permissible income / revenue",lim:"< 5%",d:"Impure income must be purified."},
  ];
  const chip=(label,color)=><span key={label} style={{fontFamily:FM,fontSize:11,fontWeight:600,color,background:`${color}14`,border:`1px solid ${color}33`,borderRadius:999,padding:`4px ${T.s3}`}}>{label}</span>;
  return<div style={{display:"flex",flexDirection:"column",gap:T.s4}}>
    {/* Intro */}
    <BentoTile accent={T.gold}>
      <div style={EB}>SHARIA SCREENING — METHODOLOGY & GOVERNANCE</div>
      <p style={P}>Every holding in MĪZAN is screened by a single server-side engine, so the Screener, Overview compliance, the Rebalancer’s halal mode, and Purification always show the same verdict — never a per-screen disagreement. Screening follows <strong style={{color:T.text}}>AAOIFI Shariah Standard No. 21</strong>: a business-activity screen plus financial-ratio tests.</p>
    </BentoTile>

    {/* Two-layer screen */}
    <div className="bento-row" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:T.s4}}>
      <BentoTile accent={T.loss}>
        <div style={EB}>LAYER 1 · BUSINESS ACTIVITY</div>
        <p style={{...P,marginBottom:T.s3}}>A company is excluded if its core business is impermissible — regardless of its financials:</p>
        <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:T.s3}}>{excluded.map(x=>chip(x,T.loss))}</div>
        <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.1em",fontWeight:600,marginBottom:T.s2}}>FLAGGED FOR REVIEW (mixed / case-by-case)</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>{review.map(x=>chip(x,T.gold))}</div>
      </BentoTile>
      <BentoTile accent={T.gain}>
        <div style={EB}>LAYER 2 · FINANCIAL RATIOS (AAOIFI)</div>
        <div style={{display:"flex",flexDirection:"column",gap:T.s2}}>
          {ratios.map(r=><div key={r.t} style={{padding:`${T.s2} ${T.s3}`,background:T.surface,border:`1px solid ${T.border}`,borderRadius:T.rMd}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",gap:T.s2}}>
              <span style={{fontFamily:FP,fontSize:13,fontWeight:600,color:T.textHi,letterSpacing:"-0.005em"}}>{r.t}</span>
              <span style={{fontFamily:FM,fontSize:11,fontWeight:600,color:T.gain,flexShrink:0}}>{r.lim}</span>
            </div>
            <div style={{fontFamily:FP,fontSize:12,color:T.muted,lineHeight:1.45,marginTop:2}}>{r.d}</div>
          </div>)}
        </div>
      </BentoTile>
    </div>

    {/* Verdict logic */}
    <BentoTile>
      <div style={EB}>HOW THE VERDICT IS DECIDED</div>
      <div style={{display:"flex",flexDirection:"column",gap:T.s2,fontFamily:FP,fontSize:13,color:T.text,lineHeight:1.55,letterSpacing:"-0.005em"}}>
        <div><span style={{color:T.loss,fontWeight:600}}>Prohibited sector</span> → <strong>Non-Compliant</strong> immediately; ratios aren’t evaluated.</div>
        <div>Otherwise the holding is tested against all <strong>{Object.keys(STANDARDS).length} standards</strong>: <span style={{color:T.gain,fontWeight:600}}>≥5 pass → Halal</span>, <span style={{color:T.loss,fontWeight:600}}>≥4 fail → Non-Compliant</span>, anything in between → <span style={{color:T.gold,fontWeight:600}}>Review</span>.</div>
        <div>Open any holding’s <strong>“Why →”</strong> in the Screener to see the exact ratios, thresholds, and per-standard result.</div>
      </div>
    </BentoTile>

    {/* Standards table */}
    <BentoTile>
      <div style={EB}>SUPPORTED STANDARDS</div>
      <div style={{display:"flex",flexDirection:"column",gap:T.s2}}>
        {Object.entries(STANDARDS).map(([k,s])=><div key={k} style={{padding:`${T.s2} ${T.s3}`,background:T.surface,border:`1px solid ${T.border}`,borderLeft:`3px solid ${k==="AAOIFI"?T.gold:T.border}`,borderRadius:T.rMd}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:T.s1,flexWrap:"wrap",gap:T.s1}}>
            <span style={{fontFamily:FP,fontSize:13,fontWeight:600,color:T.textHi,letterSpacing:"-0.01em"}}>{s.name}{k==="AAOIFI"&&<span style={{fontFamily:FM,fontSize:9,color:T.gold,marginLeft:T.s2,letterSpacing:"0.1em"}}>DEFAULT</span>}</span>
            <span style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.04em"}}>{s.region}</span>
          </div>
          <div style={{fontFamily:FM,fontSize:10,color:T.muted,lineHeight:1.5,letterSpacing:"0.02em"}}>
            {s.denominator==="totalAssets"?"vs total assets":"vs market cap"} · Debt &lt; {s.debtMax}% · Cash &lt; {s.cashMax}% · A/R &lt; {s.recvMax}% · Non-perm &lt; {s.nonPermMax}%
          </div>
        </div>)}
      </div>
      <p style={{...P,marginTop:T.s3}}><strong style={{color:T.text}}>Sector exclusion is universal</strong> across every standard; only the ratio thresholds and denominator differ. AAOIFI is the strict default.</p>
    </BentoTile>

    {/* Data transparency */}
    <BentoTile>
      <div style={EB}>DATA & TRANSPARENCY</div>
      <div style={{display:"flex",flexDirection:"column",gap:T.s2,fontFamily:FP,fontSize:13,color:T.muted,lineHeight:1.55,letterSpacing:"-0.005em"}}>
        <div><strong style={{color:T.text}}>Source:</strong> Finnhub fundamentals today; the engine swaps to <strong style={{color:T.text}}>Zoya</strong> when provisioned — adding a direct compliance verdict and the non-permissible-income test.</div>
        <div><strong style={{color:T.text}}>Honest limit:</strong> Finnhub’s free tier has no revenue-segment data, so the non-permissible-income test isn’t separately evaluated there — the sector screen carries it (shown as “not evaluated” in the Screener).</div>
        <div><strong style={{color:T.text}}>Freshness:</strong> verdicts cache once per day. Total debt is used as a close proxy for interest-bearing debt.</div>
      </div>
    </BentoTile>

    {/* Governance — honest, no fabricated board */}
    <BentoTile accent={T.blue}>
      <div style={EB}>SHARIA GOVERNANCE</div>
      <div style={{display:"flex",flexDirection:"column",gap:T.s3}}>
        <p style={P}>MĪZAN’s methodology is aligned to <strong style={{color:T.text}}>AAOIFI Shariah Standard No. 21</strong>. Screening is an <strong style={{color:T.text}}>informational research tool</strong> — it is not a fatwa, not investment advice, and MĪZAN is not a registered investment adviser.</p>
        <p style={P}>A named, AAOIFI-credentialed Sharia advisory board is being established and will be published here. Until then, treat verdicts as a starting point and confirm decisions with a qualified scholar.</p>
        <div style={{padding:`${T.s3} ${T.s4}`,background:`${T.blue}0F`,border:`1px solid ${T.blue}30`,borderRadius:T.rMd,fontFamily:FP,fontSize:12,color:T.text,lineHeight:1.55}}>
          Are you an AAOIFI-certified scholar or advisor? We’re forming our Sharia supervisory board — use the in-app feedback button to reach us.
        </div>
      </div>
    </BentoTile>

    <div style={{fontFamily:FM,fontSize:10,color:T.dim,lineHeight:1.5,letterSpacing:"0.02em",padding:`0 ${T.s1}`}}>
      Verdicts and ratios are estimates from public financial data against AAOIFI-aligned thresholds; they can differ from tools that use other standards or denominators. Always consult a qualified scholar for your situation.
    </div>
  </div>;
}

function Settings({apiKeys,setApiKeys,onConnect,onConnectTrade,isAdmin=false,onImportCSV,onDedupeCSV,onRetagCSV,onReplayOnboarding,demoMode,onToggleDemo,documents=[],accounts=[],plaidAccounts=[],bankBalance=0,onNav}){
  const{user,signOut,isSupabaseConfigured,isRoot}=useAuth();
  // Live-trading opt-in preference. "" = undecided, "enabled" = bot may place
  // real orders, "declined" = user turned it off. Mirrored to localStorage +
  // Supabase user_state so the choice follows the user across devices.
  const[tradeOptin,setTradeOptin]=useState(()=>{try{return localStorage.getItem("mizan_trade_optin")||"";}catch{return"";}});
  const setTradePref=v=>{setTradeOptin(v);try{localStorage.setItem("mizan_trade_optin",v);}catch{}persistUserState("mizan_trade_optin",v);};
  const[keys,setKeys]=useState({...apiKeys});
  const[saved,setSaved]=useState(false);
  // Non-root accounts never see the API Keys page — those keys belong on
  // the server (env vars), not in user-entered fields. Default the sub-tab
  // to brokers for everyone else.
  const[sub,setSub]=useState(isRoot?"keys":"connections");
  // Local install prompt detection for the Settings card.
  const[settingsInstallEvt,setSettingsInstallEvt]=useState(null);
  const[settingsInstalled,setSettingsInstalled]=useState(()=>{try{return window.matchMedia('(display-mode: standalone)').matches||!!navigator.standalone;}catch{return false;}});
  useEffect(()=>{
    const h=(e)=>{e.preventDefault();setSettingsInstallEvt(e);};
    window.addEventListener('beforeinstallprompt',h);
    const mq=window.matchMedia('(display-mode: standalone)');
    const onMQ=(e)=>{if(e.matches){setSettingsInstalled(true);setSettingsInstallEvt(null);}};
    mq.addEventListener('change',onMQ);
    return()=>{window.removeEventListener('beforeinstallprompt',h);mq.removeEventListener('change',onMQ);};
  },[]);
  const doSettingsInstall=async()=>{if(!settingsInstallEvt)return;settingsInstallEvt.prompt();const{outcome}=await settingsInstallEvt.userChoice;if(outcome==='accepted'){setSettingsInstalled(true);setSettingsInstallEvt(null);}};
  const save=()=>{setApiKeys(keys);setGlobalKeys(keys);try{localStorage.setItem("mizan_keys",JSON.stringify(keys));}catch{}persistUserState("mizan_keys",keys);recordAudit("settings.api_keys_saved",{metadata:{keysPresent:Object.keys(keys).filter(k=>(keys[k]||"").length>0)}});setSaved(true);setTimeout(()=>setSaved(false),2500);};
  const has=k=>(keys[k]||"").length>8;

  const APIS=[
    {id:"anthropic",l:"Anthropic API",  tier:"AI Advisor (server-only)",url:"console.anthropic.com", cost:"~$5/mo", color:"#CC785C",serverOnly:true,fields:[]},
    {id:"finnhub",  l:"Finnhub",        tier:"Stage 1 — Real-time",   url:"finnhub.io",             cost:"Free",   color:T.gain,   fields:[{k:"finnhub",l:"API Key",ph:"xxxxxxxx..."}]},
    {id:"polygon",  l:"Polygon.io",     tier:"Stage 2 — Charts",      url:"polygon.io",              cost:"Free",   color:T.blue,   fields:[{k:"polygon",l:"API Key",ph:"xxxxxxxx..."}]},
    {id:"snaptrade",l:"SnapTrade",      tier:"Broker Connect (consumer key server-only)",url:"snaptrade.com/developers",cost:"Free sandbox",color:"#7C3AED",fields:[{k:"snapId",l:"Client ID",ph:"your-client-id"}]},
    {id:"alpaca",   l:"Alpaca",         tier:"Stage 4 — Paper Trading",url:"alpaca.markets",         cost:"Free",   color:T.gold,   fields:[{k:"alpacaId",l:"Key ID",ph:"PKXX..."},{k:"alpacaSecret",l:"Secret",ph:"xxxx..."}]},
  ];

  const FEATURES=[
    {f:"Real-time quotes",          req:["finnhub"]},
    {f:"Pre/post-market prices",    req:["finnhub"]},
    {f:"News from Finnhub",         req:["finnhub"]},
    {f:"Historical charts (Polygon)",req:["polygon"]},
    {f:"AI Advisor",                req:[],alwaysOn:true,note:"Server-configured"},
    {f:"Connect Fidelity/Robinhood",req:["snapId"],alwaysOn:false,note:"Consumer key server-side"},
    {f:"Paper trading bot",         req:["alpacaId","alpacaSecret"]},
  ];

  return<div style={{display:"flex",flexDirection:"column",gap:T.s4}}>
    {/* ─── ACCOUNT PROFILE HERO ───────────────────── */}
    <BentoTile style={{
      background:`radial-gradient(circle at 0% 0%, ${T.blue}1A, transparent 50%), radial-gradient(circle at 100% 100%, ${T.gold}10, transparent 50%), ${T.card}`,
      borderColor:T.blue+"30",
    }}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:T.s4,flexWrap:"wrap"}}>
        <div style={{display:"flex",alignItems:"center",gap:T.s3}}>
          <div style={{
            width:52,height:52,borderRadius:T.rLg,
            background:`linear-gradient(135deg, ${T.blue}, ${T.gold})`,
            display:"flex",alignItems:"center",justifyContent:"center",
            fontFamily:FU,fontSize:22,fontWeight:700,color:"#fff",letterSpacing:"-0.025em",
            boxShadow:`0 6px 18px ${T.blue}55`,
          }}>{(user?.email||"?")[0].toUpperCase()}</div>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:T.s2,marginBottom:T.s1,flexWrap:"wrap"}}>
              <span style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600}}>{isSupabaseConfigured?"SIGNED IN":"SINGLE-USER MODE"}</span>
              {isRoot&&<Tag label="ROOT" color={T.gold}/>}
            </div>
            <div style={{fontFamily:FU,fontSize:18,fontWeight:600,color:T.textHi,letterSpacing:"-0.015em"}}>{user?.email||"local"}</div>
          </div>
        </div>
        {isSupabaseConfigured
          ?<div style={{display:"flex",gap:T.s2,alignItems:"center",flexWrap:"wrap"}}>
            {onReplayOnboarding&&<button onClick={onReplayOnboarding} className="btn-ghost" title="Re-run the 5-step welcome tour">Replay tour</button>}
            {settingsInstallEvt&&!settingsInstalled&&<button onClick={doSettingsInstall} className="btn-ghost" title="Install MĪZAN as a standalone app on this device" style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon name="download" size={13}/>Install App</button>}
            <button onClick={async()=>{if(confirm("Sign out of MIZAN?"))await signOut();}} className="btn-danger">Sign out</button>
          </div>
          :<div style={{display:"flex",gap:T.s2,alignItems:"center",flexWrap:"wrap"}}>
            {settingsInstallEvt&&!settingsInstalled&&<button onClick={doSettingsInstall} className="btn-ghost" title="Install MĪZAN as a standalone app" style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon name="download" size={13}/>Install App</button>}
            <span style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.08em"}}>Set VITE_SUPABASE_URL to enable accounts</span>
          </div>}
      </div>
    </BentoTile>

    <TabBar
      tabs={[
        ...(isRoot?[["keys","API Keys"]]:[]),
        ["connections","Connections"],
        ["account","Account"],
        ["methodology","Methodology"],
        ["docs","Documents"],
        ...(isRoot?[["admin","Admin"]]:[]),
      ]}
      active={sub}
      onChange={setSub}
    />

    {/* ─── API KEYS (Root only) ───────────────────── */}
    {sub==="keys"&&isRoot&&<div style={{display:"flex",flexDirection:"column",gap:T.s4}}>
      <BentoTile>
        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:T.s4,flexWrap:"wrap"}}>
          <div>
            <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>API KEYS · ADMIN</div>
            <p style={{fontFamily:FP,fontSize:13,color:T.muted,margin:0,lineHeight:1.55,maxWidth:520}}>
              Add keys in order. Finnhub activates real prices immediately. Keys save to localStorage — no re-entry needed. End-user accounts don't see this page.
            </p>
          </div>
          <button onClick={save} className="btn-primary" style={{background:saved?`linear-gradient(135deg, ${T.gain}, #0A8A65)`:undefined,boxShadow:saved?`0 2px 10px ${T.gain}55`:undefined}}>{saved?<span style={{display:"inline-flex",alignItems:"center",gap:6}}>Saved<Icon name="check" size={12}/></span>:"Save Keys"}</button>
        </div>
      </BentoTile>

      {APIS.map(api=><BentoTile key={api.id} accent={api.color}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:T.s3,flexWrap:"wrap",gap:T.s2}}>
          <div style={{display:"flex",gap:T.s2,alignItems:"center",flexWrap:"wrap"}}>
            <span style={{fontFamily:FP,fontSize:14,fontWeight:600,color:T.textHi,letterSpacing:"-0.01em"}}>{api.l}</span>
            <Tag label={api.tier} color={api.color}/>
            <Tag label={api.cost} color={T.muted}/>
          </div>
          <a href={`https://${api.url}`} target="_blank" rel="noreferrer" style={{fontFamily:FM,fontSize:10,fontWeight:600,color:api.color,textDecoration:"none",padding:`5px ${T.s3}`,border:`1px solid ${api.color}40`,borderRadius:T.rMd,letterSpacing:"0.08em",flexShrink:0,transition:"all 0.15s",background:`${api.color}10`}}>GET KEY ↗</a>
        </div>
        {api.fields.length>0&&<div className="mz-grid-2" style={{display:"grid",gridTemplateColumns:api.fields.length>1?"1fr 1fr":"1fr",gap:T.s2}}>
          {api.fields.map(f=><div key={f.k}>
            <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.14em",fontWeight:600,marginBottom:T.s1}}>{f.l}</div>
            <div style={{position:"relative"}}>
              <input type="password" value={keys[f.k]||""} placeholder={f.ph}
                onChange={e=>setKeys(k=>({...k,[f.k]:e.target.value}))}
                className="field"
                style={{borderColor:has(f.k)?api.color+"50":T.border,fontVariantNumeric:"tabular-nums"}}/>
              {has(f.k)&&<span style={{position:"absolute",right:T.s3,top:"50%",transform:"translateY(-50%)",display:"inline-flex"}}><Icon name="check" size={13} color={api.color}/></span>}
            </div>
          </div>)}
        </div>}
        {api.serverOnly&&<div style={{marginTop:T.s2,display:"flex",alignItems:"center",gap:T.s2,padding:`${T.s2} ${T.s3}`,background:`${T.gain}0F`,border:`1px solid ${T.gain}30`,borderRadius:T.rMd,fontFamily:FM,fontSize:11,color:T.gain,lineHeight:1.5}}>
          <Icon name="check" size={12} style={{flexShrink:0}}/><span>Server-configured. Set <code style={{color:T.text,padding:"1px 5px",background:T.surface,borderRadius:4}}>{api.id==="anthropic"?"ANTHROPIC_KEY":"SNAPTRADE_CONSUMER_KEY"}</code> in env vars on the host. Never exposed to the browser.</span>
        </div>}
      </BentoTile>)}

      <BentoTile>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:T.s4,flexWrap:"wrap",gap:T.s2}}>
          <span style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600}}>FEATURES ACTIVE</span>
          <span style={{fontFamily:FP,fontSize:14,fontWeight:600,color:T.textHi,fontVariantNumeric:"tabular-nums"}}>{FEATURES.filter(f=>f.alwaysOn||f.req.every(r=>has(r))).length}<span style={{color:T.muted,fontWeight:400}}> / {FEATURES.length}</span></span>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(240px, 1fr))",gap:T.s2}}>
          {FEATURES.map(f=>{
            const on=f.alwaysOn||f.req.every(r=>has(r));
            return<div key={f.f} style={{display:"flex",gap:T.s2,alignItems:"center",padding:`${T.s2} ${T.s3}`,background:T.surface,border:`1px solid ${on?T.gain+"30":T.border}`,borderRadius:T.rMd}}>
              <LiveDot on={on}/>
              <span style={{fontFamily:FP,fontSize:12,color:on?T.text:T.muted,letterSpacing:"-0.005em"}}>{f.f}</span>
              {f.note&&<span style={{fontFamily:FM,fontSize:10,color:T.muted,marginLeft:"auto"}}>{f.note}</span>}
            </div>;
          })}
        </div>
      </BentoTile>
    </div>}

    {/* ─── CONNECTIONS (health + broker management) ─── */}
    {sub==="connections"&&<div style={{display:"flex",flexDirection:"column",gap:T.s4}}>
      <ConnectionHealth onNav={onNav}/>
      <BentoTile>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:T.s4,flexWrap:"wrap"}}>
          <div>
            <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>BROKERAGE CONNECTIONS</div>
            <p style={{fontFamily:FP,fontSize:13,color:T.muted,margin:0,lineHeight:1.55,maxWidth:520}}>
              Connect via SnapTrade OAuth. Credentials go directly to your broker — MĪZAN never sees your password.
            </p>
          </div>
          <button onClick={onConnect} className="btn-primary">+ Connect Account</button>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:T.s2,marginTop:T.s4}}>
          {BROKERS.map(b=>{
            const saved=(()=>{try{return JSON.parse(localStorage.getItem("mizan_brokers")||"[]");}catch{return[];}})();
            const conn=saved.find(s=>s.id===b.id);
            return<div key={b.id} style={{
              background:T.surface,
              border:`1px solid ${conn?T.blue+"40":T.border}`,
              borderLeft:`3px solid ${conn?T.blue:T.border}`,
              borderRadius:T.rMd,
              padding:`${T.s3} ${T.s4}`,
              transition:"all 0.18s",
            }}>
              <div style={{fontFamily:FP,fontSize:14,fontWeight:600,color:conn?T.blue:T.textHi,letterSpacing:"-0.01em",marginBottom:T.s1}}>{b.nm}</div>
              <div style={{fontFamily:FM,fontSize:10,color:T.muted,marginBottom:T.s2}}>{b.desc}</div>
              <Tag label={conn?"Connected":"Not Connected"} color={conn?T.gain:T.muted}/>
            </div>;
          })}
        </div>
      </BentoTile>

      {/* ─── BANK CONNECTIONS (Plaid — managed in Finances, surfaced here so
          every connection lives in one place) ─── */}
      <BentoTile>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:T.s4,flexWrap:"wrap"}}>
          <div>
            <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>BANK CONNECTIONS</div>
            <p style={{fontFamily:FP,fontSize:13,color:T.muted,margin:0,lineHeight:1.55,maxWidth:520}}>
              Linked via Plaid — read-only, your credentials never touch MĪZAN. Balances, transactions, budgets, and bills live in your Finances tab.
            </p>
          </div>
          <button onClick={()=>onNav?.("finances")} className="btn-primary">+ Connect Bank</button>
        </div>
        {plaidAccounts.length>0
          ?<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:T.s2,marginTop:T.s4}}>
            {plaidAccounts.map((a,i)=><div key={a.account_id||a.id||i} style={{
              background:T.surface,
              border:`1px solid ${T.gold}40`,
              borderLeft:`3px solid ${T.gold}`,
              borderRadius:T.rMd,
              padding:`${T.s3} ${T.s4}`,
            }}>
              <div style={{fontFamily:FP,fontSize:14,fontWeight:600,color:T.textHi,letterSpacing:"-0.01em",marginBottom:T.s1}}>{a.name||a.official_name||a.subtype||"Account"}</div>
              <div style={{fontFamily:FM,fontSize:10,color:T.muted,marginBottom:T.s2,letterSpacing:"0.04em",textTransform:"capitalize"}}>{(a.subtype||a.type||"bank")}{a.mask?` ·· ${a.mask}`:""}</div>
              <Tag label="Connected" color={T.gain}/>
            </div>)}
          </div>
          :<div style={{marginTop:T.s4,padding:`${T.s6} ${T.s5}`,textAlign:"center",border:`1px dashed ${T.border}`,borderRadius:T.rMd,fontFamily:FP,fontSize:13,color:T.muted,lineHeight:1.55}}>
            No banks linked yet. Connect one to track checking, savings, and credit alongside your portfolio.
          </div>}
      </BentoTile>

      {/* ─── Live Trading opt-in (trading-bot users only) ─── */}
      {isAdmin&&(()=>{
        const on=tradeOptin==="enabled";
        return<BentoTile accent={on?T.gold:null} style={on?{background:`linear-gradient(135deg, ${T.gold}0F, transparent 60%), ${T.card}`}:undefined}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:T.s4,flexWrap:"wrap"}}>
            <div style={{maxWidth:560}}>
              <div style={{display:"flex",alignItems:"center",gap:T.s2,marginBottom:T.s2,flexWrap:"wrap"}}>
                <span style={{fontFamily:FM,fontSize:10,color:on?T.gold:T.muted,letterSpacing:"0.16em",fontWeight:600}}>LIVE TRADING</span>
                <Tag label={on?"Enabled":"Off"} color={on?T.gold:T.muted}/>
              </div>
              <p style={{fontFamily:FP,fontSize:13,color:T.muted,margin:0,lineHeight:1.55}}>
                Enabling lets the trading bot place <strong style={{color:T.text}}>real orders</strong> in your brokerage. This requires reconnecting your brokerage with trade permission — a read-only connection cannot execute trades. You can turn this off at any time.
              </p>
            </div>
            <button onClick={()=>setTradePref(on?"declined":"enabled")} style={{
              padding:`8px ${T.s4}`,borderRadius:T.rMd,
              fontFamily:FM,fontSize:11,fontWeight:600,letterSpacing:"0.06em",
              background:on?`${T.gold}22`:"transparent",
              border:`1px solid ${on?T.gold+"50":T.border}`,
              color:on?T.gold:T.text,
              cursor:"pointer",flexShrink:0,transition:"all 0.15s",
            }}>{on?"Turn off":"Enable trading"}</button>
          </div>
          {on&&<div style={{marginTop:T.s4,paddingTop:T.s4,borderTop:`1px solid ${T.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",gap:T.s3,flexWrap:"wrap"}}>
            <span style={{fontFamily:FM,fontSize:11,color:T.muted,lineHeight:1.5}}>Reconnect a brokerage with trade permission to activate live orders.</span>
            <button onClick={onConnectTrade} className="btn-primary" style={{flexShrink:0,background:`linear-gradient(135deg, ${T.gold}, ${T.gold}CC)`,boxShadow:`0 2px 10px ${T.gold}55`}}>+ Connect brokerage for trading</button>
          </div>}
        </BentoTile>;
      })()}

      {/* Demo mode toggle */}
      <BentoTile accent={demoMode?T.gold:null} style={demoMode?{background:`linear-gradient(135deg, ${T.gold}0F, transparent 60%), ${T.card}`}:undefined}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:T.s4,flexWrap:"wrap"}}>
          <div>
            <div style={{fontFamily:FM,fontSize:10,color:demoMode?T.gold:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>DEMO MODE</div>
            <p style={{fontFamily:FP,fontSize:13,color:T.muted,margin:0,lineHeight:1.55,maxWidth:520}}>
              Replaces your live data with a fictional ~$435k halal portfolio across 6 accounts — useful for screenshots, sharing, or previewing MIZAN before connecting brokers.
            </p>
          </div>
          <button onClick={onToggleDemo} style={{
            padding:`8px ${T.s4}`,borderRadius:T.rMd,
            fontFamily:FM,fontSize:11,fontWeight:600,letterSpacing:"0.06em",
            background:demoMode?`${T.gold}22`:"transparent",
            border:`1px solid ${demoMode?T.gold+"50":T.border}`,
            color:demoMode?T.gold:T.text,
            cursor:"pointer",flexShrink:0,
            transition:"all 0.15s",
          }}>{demoMode?"Demo: ON":"Demo: OFF"}</button>
        </div>
      </BentoTile>
    </div>}

    {/* Account = profile + security + data controls. (Notifications deferred until demand.) */}
    {sub==="account"&&<div style={{display:"flex",flexDirection:"column",gap:T.s4}}>
      <AccountPanel/>
      <CollapsibleTile flat title="SECURITY & SESSIONS" subtitle="Two-factor authentication + active sessions" storageKey="settings_security"><SecurityPanel/></CollapsibleTile>
      <CollapsibleTile flat title="DATA & PRIVACY" subtitle="Export your data or delete your account" storageKey="settings_privacy"><PrivacyPanel/></CollapsibleTile>
    </div>}
    {/* Documents = broker docs + CSV historical backfill + legal policies. */}
    {sub==="docs"&&<div style={{display:"flex",flexDirection:"column",gap:T.s4}}>
      <CollapsibleTile flat title="BROKER DOCUMENTS" subtitle="Statements & tax forms synced from your brokerages" storageKey="settings_docs" defaultOpen><DocumentsPanel documents={documents} accounts={accounts}/></CollapsibleTile>
      <CollapsibleTile flat title="IMPORT HISTORY (CSV)" subtitle="Backfill older activity from a broker CSV export" storageKey="settings_csv"><CSVImporter onImport={onImportCSV} onDedupe={onDedupeCSV} onRetag={onRetagCSV}/></CollapsibleTile>
      <LegalDocsPanel/>
    </div>}
    {sub==="methodology"&&<ShariaMethodology/>}
    {sub==="admin"&&isRoot&&<AdminPanel/>}
  </div>;
}

/* ─── NOTIFICATIONS PANEL (push subscription) ─────────── */
// Browser-only — service worker registered in main.jsx (already there).
// VAPID public key fetched from /api/notifications/vapid-public-key
// so we never have to commit it to the bundle.
function NotificationsPanel(){
  const[supported]=useState(()=>typeof window!=="undefined"&&"serviceWorker"in navigator&&"PushManager"in window);
  const[permission,setPermission]=useState(()=>typeof Notification!=="undefined"?Notification.permission:"default");
  const[busy,setBusy]=useState(false);
  const[subscription,setSubscription]=useState(null);
  const[vapidKey,setVapidKey]=useState(null);
  const[err,setErr]=useState(null);
  const[ok,setOk]=useState(null);
  const[digest,setDigest]=useState(null); // null = loading
  const[digestBusy,setDigestBusy]=useState(false);
  const[digestMsg,setDigestMsg]=useState(null); // {ok:boolean,text:string}

  // Load the weekly-digest opt-out preference.
  useEffect(()=>{
    let cancel=false;
    apiFetch("/api/user/features")
      .then(r=>r.ok?r.json():null)
      .then(j=>{if(!cancel&&j&&typeof j.email_digest==="boolean")setDigest(j.email_digest);})
      .catch(()=>{});
    return()=>{cancel=true;};
  },[]);

  const toggleDigest=async()=>{
    const next=!digest;
    setDigestBusy(true);setDigestMsg(null);
    try{
      const r=await apiFetch("/api/user/email-digest",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled:next})});
      if(!r.ok)throw new Error(`Server returned ${r.status}`);
      setDigest(next);
      setDigestMsg({ok:true,text:next?"Weekly digest enabled.":"Weekly digest disabled."});
    }catch(e){setDigestMsg({ok:false,text:e.message||"Couldn't update digest preference"});}
    finally{setDigestBusy(false);}
  };

  // Probe current subscription state on mount.
  useEffect(()=>{
    if(!supported)return;
    let cancel=false;
    (async()=>{
      try{
        const reg=await navigator.serviceWorker.ready;
        const sub=await reg.pushManager.getSubscription();
        if(!cancel)setSubscription(sub);
      }catch(e){if(!cancel)setErr(e.message);}
    })();
    apiFetch("/api/notifications/vapid-public-key")
      .then(r=>r.ok?r.json():null)
      .then(j=>{if(!cancel&&j?.key)setVapidKey(j.key);})
      .catch(()=>{});
    return()=>{cancel=true;};
  },[supported]);

  const urlBase64ToUint8Array=base64=>{
    const padding="=".repeat((4-base64.length%4)%4);
    const b64=(base64+padding).replace(/-/g,"+").replace(/_/g,"/");
    const raw=atob(b64);
    const out=new Uint8Array(raw.length);
    for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);
    return out;
  };

  const enable=async()=>{
    setBusy(true);setErr(null);setOk(null);
    try{
      if(!vapidKey)throw new Error("Server hasn't generated a VAPID public key yet. Ask the admin to set VAPID_PUBLIC_KEY in Vercel.");
      const perm=await Notification.requestPermission();
      setPermission(perm);
      if(perm!=="granted")throw new Error("Notification permission denied");
      const reg=await navigator.serviceWorker.ready;
      const sub=await reg.pushManager.subscribe({
        userVisibleOnly:true,
        applicationServerKey:urlBase64ToUint8Array(vapidKey),
      });
      const json=sub.toJSON();
      const r=await apiFetch("/api/notifications/subscribe",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({subscription:json}),
      });
      if(!r.ok)throw new Error(`Server rejected subscription (${r.status})`);
      setSubscription(sub);
      setOk("Notifications enabled on this device.");
    }catch(e){setErr(e.message||"Failed to enable notifications");}
    finally{setBusy(false);}
  };

  const disable=async()=>{
    setBusy(true);setErr(null);setOk(null);
    try{
      if(subscription){
        const endpoint=subscription.endpoint;
        await subscription.unsubscribe();
        await apiFetch("/api/notifications/subscribe",{
          method:"DELETE",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({endpoint}),
        }).catch(()=>{});
      }
      setSubscription(null);
      setOk("Notifications disabled on this device.");
    }catch(e){setErr(e.message||"Failed to disable");}
    finally{setBusy(false);}
  };

  const sendTest=async()=>{
    setBusy(true);setErr(null);setOk(null);
    try{
      const r=await apiFetch("/api/notifications/test",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
      if(!r.ok)throw new Error(`Server returned ${r.status}`);
      setOk("Test notification sent. Check your device.");
    }catch(e){setErr(e.message||"Test failed");}
    finally{setBusy(false);}
  };

  if(!supported){
    return<BentoTile>
      <div style={{fontFamily:FM,fontSize:11,color:T.muted,letterSpacing:"0.14em",marginBottom:T.s2}}>NOTIFICATIONS</div>
      <p style={{fontFamily:FP,fontSize:13,color:T.muted,margin:0,lineHeight:1.6}}>This browser doesn't support push notifications.</p>
    </BentoTile>;
  }

  const enabled=!!subscription&&permission==="granted";

  return<div style={{display:"flex",flexDirection:"column",gap:T.s4}}>
    <BentoTile>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:T.s4,marginBottom:T.s3,flexWrap:"wrap"}}>
        <div>
          <div style={{fontFamily:FM,fontSize:11,color:T.blue,letterSpacing:"0.16em",fontWeight:600,marginBottom:6}}>PUSH NOTIFICATIONS</div>
          <p style={{fontFamily:FP,fontSize:13,color:T.muted,margin:0,lineHeight:1.6,maxWidth:520}}>
            Get a system notification when something needs attention — Sharia status changes, price alerts, dividends, and sync errors. Per-device opt-in.
          </p>
        </div>
        <Tag label={enabled?"Enabled":permission==="denied"?"Blocked":"Off"} color={enabled?T.gain:permission==="denied"?T.loss:T.muted}/>
      </div>

      {permission==="denied"&&<div style={{padding:`${T.s2} ${T.s3}`,borderRadius:T.rMd,background:`${T.loss}10`,border:`1px solid ${T.loss}30`,fontFamily:FM,fontSize:11,color:T.loss,lineHeight:1.5,marginBottom:T.s3}}>
        Your browser is blocking notifications for this site. Re-enable them in your browser's site-settings panel, then reload.
      </div>}

      <div style={{display:"flex",gap:T.s2,flexWrap:"wrap"}}>
        {enabled
          ?<>
            <button onClick={disable} disabled={busy} className="btn-ghost">Disable</button>
            <button onClick={sendTest} disabled={busy} className="btn-primary">Send a test notification</button>
          </>
          :<button onClick={enable} disabled={busy||permission==="denied"||!vapidKey} className="btn-primary">{busy?"Working…":"Enable notifications"}</button>}
      </div>

      {!vapidKey&&permission!=="denied"&&<div style={{marginTop:T.s3,fontFamily:FM,fontSize:11,color:T.muted}}>
        Waiting on server: VAPID_PUBLIC_KEY isn't configured yet. Once admin sets it, refresh this page.
      </div>}
      {ok&&<div style={{marginTop:T.s3,padding:`${T.s2} ${T.s3}`,borderRadius:T.rMd,background:T.gainBg,border:`1px solid ${T.gain}30`,fontFamily:FM,fontSize:11,color:T.gain}}>{ICON_OK}{ok}</div>}
      {err&&<div style={{marginTop:T.s3,padding:`${T.s2} ${T.s3}`,borderRadius:T.rMd,background:`${T.loss}10`,border:`1px solid ${T.loss}40`,fontFamily:FM,fontSize:11,color:T.loss}}>{ICON_NO}{err}</div>}
    </BentoTile>

    <BentoTile>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:T.s4,marginBottom:T.s3,flexWrap:"wrap"}}>
        <div>
          <div style={{fontFamily:FM,fontSize:11,color:T.blue,letterSpacing:"0.16em",fontWeight:600,marginBottom:6}}>WEEKLY EMAIL DIGEST</div>
          <p style={{fontFamily:FP,fontSize:13,color:T.muted,margin:0,lineHeight:1.6,maxWidth:520}}>
            A Monday email summarizing your net-worth change over the past 7 days, sent to your account email.
          </p>
        </div>
        <Tag label={digest===null?"…":digest?"On":"Off"} color={digest?T.gain:T.muted}/>
      </div>
      <div style={{display:"flex",gap:T.s2,flexWrap:"wrap"}}>
        <button onClick={toggleDigest} disabled={digest===null||digestBusy} className={digest?"btn-ghost":"btn-primary"}>
          {digestBusy?"Working…":digest?"Turn off":"Turn on"}
        </button>
      </div>
      {digestMsg&&<div style={{marginTop:T.s3,padding:`${T.s2} ${T.s3}`,borderRadius:T.rMd,background:digestMsg.ok?T.gainBg:`${T.loss}10`,border:`1px solid ${digestMsg.ok?T.gain:T.loss}40`,fontFamily:FM,fontSize:11,color:digestMsg.ok?T.gain:T.loss}}>{digestMsg.ok?ICON_OK:ICON_NO}{digestMsg.text}</div>}
    </BentoTile>

    <BentoTile>
      <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s3}}>WHAT YOU'LL RECEIVE</div>
      <ul style={{fontFamily:FP,fontSize:13,color:T.muted,margin:0,padding:`0 0 0 ${T.s4}`,lineHeight:1.8}}>
        <li><span style={{color:T.text,fontWeight:500}}>Price alerts</span> — when a watchlist target is crossed</li>
        <li><span style={{color:T.text,fontWeight:500}}>Sharia status changes</span> — a holding flips halal→haram or vice-versa</li>
        <li><span style={{color:T.text,fontWeight:500}}>Upcoming dividends</span> — ex-div date is tomorrow on a ticker you hold</li>
        <li><span style={{color:T.text,fontWeight:500}}>Sync errors</span> — nightly SnapTrade sync failed and needs attention</li>
      </ul>
    </BentoTile>
  </div>;
}

/* ─── ACCOUNT PANEL (email change) ─────────────────────── */
function AccountPanel(){
  const{user}=useAuth();
  const[newEmail,setNewEmail]=useState("");
  const[currentPassword,setCurrentPassword]=useState("");
  const[busy,setBusy]=useState(false);
  const[ok,setOk]=useState(null);
  const[err,setErr]=useState(null);

  const valid=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail.trim())
    && newEmail.trim().toLowerCase()!==(user?.email||"").toLowerCase()
    && currentPassword.length>0;

  const submit=async(e)=>{
    e.preventDefault();
    if(!valid||busy)return;
    setBusy(true);setErr(null);setOk(null);
    try{
      const r=await apiFetch("/api/account/email",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({newEmail:newEmail.trim().toLowerCase(),currentPassword}),
      });
      const j=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(j.error||`Failed (${r.status})`);
      setOk(j.message||"Confirmation sent to new email.");
      setNewEmail("");setCurrentPassword("");
    }catch(e2){setErr(e2.message||"Email change failed");}
    finally{setBusy(false);}
  };

  return<div style={{display:"flex",flexDirection:"column",gap:T.s4}}>
    <BentoTile>
      <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>CURRENT EMAIL</div>
      <div style={{fontFamily:FU,fontSize:18,fontWeight:600,color:T.textHi,letterSpacing:"-0.01em"}}>{user?.email||"—"}</div>
    </BentoTile>

    <BentoTile>
      <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>CHANGE EMAIL</div>
      <p style={{fontFamily:FP,fontSize:13,color:T.muted,margin:`0 0 ${T.s4}`,lineHeight:1.55,maxWidth:560}}>
        Enter your new address and current password. Supabase will email a confirmation link to the new address — the change only takes effect after you click it.
      </p>
      <form onSubmit={submit} style={{display:"flex",flexDirection:"column",gap:T.s3,maxWidth:480}}>
        <label style={{display:"flex",flexDirection:"column",gap:T.s1}}>
          <span style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.12em",fontWeight:500}}>NEW EMAIL</span>
          <input
            type="email" autoComplete="email"
            value={newEmail} onChange={e=>setNewEmail(e.target.value)}
            placeholder="new@example.com"
            className="field"
            disabled={busy}
          />
        </label>
        <label style={{display:"flex",flexDirection:"column",gap:T.s1}}>
          <span style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.12em",fontWeight:500}}>CURRENT PASSWORD</span>
          <input
            type="password" autoComplete="current-password"
            value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)}
            className="field"
            disabled={busy}
          />
        </label>
        <button type="submit" disabled={!valid||busy} className="btn-primary" style={{alignSelf:"flex-start"}}>
          {busy?"Sending…":"Send verification"}
        </button>
      </form>

      {ok&&<div style={{marginTop:T.s3,padding:`${T.s2} ${T.s3}`,borderRadius:T.rMd,background:T.gainBg,border:`1px solid ${T.gain}30`,fontFamily:FM,fontSize:11,color:T.gain,lineHeight:1.5}}>{ICON_OK}{ok}</div>}
      {err&&<div style={{marginTop:T.s3,padding:`${T.s2} ${T.s3}`,borderRadius:T.rMd,background:`${T.loss}10`,border:`1px solid ${T.loss}40`,fontFamily:FM,fontSize:11,color:T.loss,lineHeight:1.5}}>{ICON_NO}{err}</div>}
    </BentoTile>
  </div>;
}

/* ─── PRIVACY & DATA (export + delete) ────────────────── */
// Public legal/policy links — lives under Settings → Documents (moved out of the
// Privacy/data-controls panel so all documents sit in one place).
function LegalDocsPanel(){
  const LEGAL_DOCS=[
    {l:"Privacy Policy",      desc:"What we collect, how we use it, your rights under GDPR/CCPA.", href:"/privacy",                          ext:false},
    {l:"Terms of Service",    desc:"Service rules, disclaimers, limitations of liability.",         href:"/terms",                            ext:false},
    {l:"Security Policy",     desc:"Encryption, access control, monitoring, and incident response.",href:"/legal/SECURITY_POLICY.pdf",        ext:true},
    {l:"Access Controls Policy",desc:"RBAC, MFA, periodic access reviews, secret management.",     href:"/legal/ACCESS_CONTROLS_POLICY.pdf", ext:true},
    {l:"Data Retention Policy",desc:"What we keep, how long, when it's deleted, vendor handling.",  href:"/legal/DATA_RETENTION_POLICY.pdf",  ext:true},
  ];
  return<CollapsibleTile title="LEGAL DOCUMENTS" subtitle="Privacy, terms, security & data policies" storageKey="settings_legal" defaultOpen={false}>
    <p style={{fontFamily:FP,fontSize:13,color:T.muted,margin:`0 0 ${T.s4}`,lineHeight:1.55,maxWidth:600}}>
      Our public-facing policies. Always available without a login at the same URLs — Plaid, Supabase, and your auditors can reach them too.
    </p>
    <div style={{display:"flex",flexDirection:"column",gap:T.s2}}>
      {LEGAL_DOCS.map(d=><a key={d.href} href={d.href} target={d.ext?"_blank":undefined} rel={d.ext?"noreferrer":undefined}
        style={{
          display:"flex",alignItems:"center",justifyContent:"space-between",gap:T.s3,
          padding:`${T.s3} ${T.s4}`,
          background:T.surface,border:`1px solid ${T.border}`,borderRadius:T.rMd,
          textDecoration:"none",color:"inherit",cursor:"pointer",
          transition:"border-color 0.15s, background 0.15s",
        }}
        onMouseEnter={e=>{e.currentTarget.style.borderColor=T.borderHi;e.currentTarget.style.background=T.card;}}
        onMouseLeave={e=>{e.currentTarget.style.borderColor=T.border;e.currentTarget.style.background=T.surface;}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontFamily:FP,fontSize:14,fontWeight:600,color:T.textHi,letterSpacing:"-0.005em"}}>{d.l}</div>
          <div style={{fontFamily:FP,fontSize:12,color:T.muted,marginTop:2,lineHeight:1.45}}>{d.desc}</div>
        </div>
        <span style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.08em",flexShrink:0}}>{d.ext?"PDF ↗":"OPEN ↗"}</span>
      </a>)}
    </div>
  </CollapsibleTile>;
}

function PrivacyPanel(){
  const{signOut}=useAuth();
  const[exportBusy,setExportBusy]=useState(false);
  const[deleteBusy,setDeleteBusy]=useState(false);
  const[confirmText,setConfirmText]=useState("");
  const[showModal,setShowModal]=useState(false);
  const[err,setErr]=useState(null);
  const[done,setDone]=useState(false);

  const downloadExport=async()=>{
    setExportBusy(true);setErr(null);
    try{
      const res=await apiFetch("/api/account/export");
      if(!res.ok)throw new Error(`Export failed (${res.status})`);
      const blob=await res.blob();
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");
      a.href=url;a.download=`mizan-export-${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(a);a.click();a.remove();
      URL.revokeObjectURL(url);
    }catch(e){setErr(e.message||"Export failed");}
    finally{setExportBusy(false);}
  };

  const submitDelete=async()=>{
    if(confirmText!=="DELETE")return;
    setDeleteBusy(true);setErr(null);
    try{
      const res=await apiFetch("/api/account",{
        method:"DELETE",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({confirm:"DELETE"}),
      });
      if(!res.ok){const body=await res.json().catch(()=>({}));throw new Error(body.error||`Delete failed (${res.status})`);}
      setDone(true);
      // Drop session + reload — Supabase signOut clears the JWT cookie.
      try{await signOut();}catch{}
      setTimeout(()=>{window.location.replace("/");},2000);
    }catch(e){setErr(e.message||"Delete failed");setDeleteBusy(false);}
  };

  if(done){
    return<BentoTile style={{padding:`${T.s8} ${T.s5}`,textAlign:"center"}}>
      <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.18em",fontWeight:600,marginBottom:T.s3}}>ACCOUNT DELETED</div>
      <div style={{fontFamily:FU,fontSize:18,color:T.textHi,fontWeight:600,letterSpacing:"-0.01em",marginBottom:T.s2}}>Your account has been deleted.</div>
      <div style={{fontFamily:FP,fontSize:13,color:T.muted}}>You'll be redirected in a moment.</div>
    </BentoTile>;
  }

  return<div style={{display:"flex",flexDirection:"column",gap:T.s4}}>
    <BentoTile>
      <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>DOWNLOAD MY DATA</div>
      <p style={{fontFamily:FP,fontSize:13,color:T.muted,margin:`0 0 ${T.s3}`,lineHeight:1.55,maxWidth:600}}>
        Exports a JSON file containing your profile, account settings, CSV imports, manual assets, donations, audit history, brokerage holdings, and bank accounts. The file is for your records — MIZAN never shares it.
      </p>
      <button onClick={downloadExport} disabled={exportBusy} className="btn-primary">
        {exportBusy?"Preparing…":"Download my data"}
      </button>
    </BentoTile>

    <BentoTile accent={T.loss} style={{background:`linear-gradient(135deg, ${T.loss}08, transparent 60%), ${T.card}`}}>
      <div style={{fontFamily:FM,fontSize:10,color:T.loss,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>DELETE MY ACCOUNT</div>
      <p style={{fontFamily:FP,fontSize:13,color:T.muted,margin:`0 0 ${T.s3}`,lineHeight:1.55,maxWidth:600}}>
        Permanently deletes everything — profile, account state, brokerage connections (via SnapTrade), bank links (via Plaid), and audit trail. This action cannot be undone.
      </p>
      <button onClick={()=>setShowModal(true)} className="btn-danger">Delete my account…</button>
    </BentoTile>

    {err&&<BentoTile style={{background:`${T.loss}10`,border:`1px solid ${T.loss}40`}}>
      <div style={{fontFamily:FM,fontSize:11,color:T.loss}}>{ICON_NO}{err}</div>
    </BentoTile>}

    {showModal&&<div style={{
      position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",backdropFilter:"blur(4px)",
      display:"flex",alignItems:"center",justifyContent:"center",zIndex:50,padding:T.s4,
    }} onClick={()=>!deleteBusy&&setShowModal(false)}>
      <div onClick={e=>e.stopPropagation()} style={{
        maxWidth:520,width:"100%",background:T.card,border:`1px solid ${T.loss}40`,borderRadius:T.rLg,padding:`${T.s6} ${T.s5}`,
      }}>
        <div style={{fontFamily:FM,fontSize:10,color:T.loss,letterSpacing:"0.18em",fontWeight:700,marginBottom:T.s3}}>DELETE ACCOUNT — IRREVERSIBLE</div>
        <p style={{fontFamily:FP,fontSize:14,color:T.text,margin:`0 0 ${T.s3}`,lineHeight:1.55}}>
          This will permanently remove:
        </p>
        <ul style={{fontFamily:FP,fontSize:13,color:T.muted,margin:`0 0 ${T.s4} ${T.s4}`,padding:0,lineHeight:1.7}}>
          <li>Your profile, settings, and authentication credentials</li>
          <li>Every connected brokerage (via SnapTrade /snapTrade/deleteUser)</li>
          <li>Every linked bank (Plaid Items unlinked)</li>
          <li>CSV imports, manual assets, donations, watchlist, screening baselines</li>
          <li>All cached holdings and activity data</li>
        </ul>
        <div style={{fontFamily:FM,fontSize:11,color:T.muted,letterSpacing:"0.06em",marginBottom:T.s2}}>TYPE <span style={{color:T.loss,fontWeight:700}}>DELETE</span> TO CONFIRM</div>
        <input
          value={confirmText} onChange={e=>setConfirmText(e.target.value)}
          placeholder="DELETE"
          disabled={deleteBusy}
          style={{width:"100%",padding:`${T.s3} ${T.s3}`,background:T.surface,border:`1px solid ${T.border}`,borderRadius:T.rMd,fontFamily:FM,fontSize:14,color:T.text,letterSpacing:"0.15em",textAlign:"center",outline:"none",boxSizing:"border-box",marginBottom:T.s4}}
          autoFocus
        />
        <div style={{display:"flex",gap:T.s2,justifyContent:"flex-end"}}>
          <button onClick={()=>{if(!deleteBusy){setShowModal(false);setConfirmText("");setErr(null);}}} disabled={deleteBusy} className="btn-ghost">Cancel</button>
          <button onClick={submitDelete} disabled={deleteBusy||confirmText!=="DELETE"} className="btn-danger">
            {deleteBusy?"Deleting…":"Delete account"}
          </button>
        </div>
      </div>
    </div>}
  </div>;
}

/* ─── ADMIN PANEL (root only) ────────────────────────── */
function AdminPanel(){
  const[tab,setTab]=useState("users");
  const[stats,setStats]=useState(null);
  const[users,setUsers]=useState([]);
  const[auditRows,setAuditRows]=useState([]);
  const[auditTotal,setAuditTotal]=useState(0);
  const[auditOffset,setAuditOffset]=useState(0);
  const[busy,setBusy]=useState(false);
  const[err,setErr]=useState(null);
  const[dbStatus,setDbStatus]=useState(null);
  // Per-job run state for the Maintenance panel: {job:{status,code,msg}}.
  const[cronRun,setCronRun]=useState({});
  // Branded-invite form state.
  const[inviteEmail,setInviteEmail]=useState("");
  const[inviteMsg,setInviteMsg]=useState(null);
  const[inviteBusy,setInviteBusy]=useState(false);

  const PAGE=50;

  // Cron jobs the /api/admin/run-cron endpoint accepts, with display labels.
  const CRON_JOBS=[
    ["sync","SnapTrade sync"],
    ["cleanup","Data cleanup"],
    ["nightly-snapshot","Net-worth snapshot"],
    ["dividend-check","Dividend check"],
    ["bill-reminders","Bill reminders"],
    ["weekly-digest","Weekly digest"],
    ["bot-signals","Bot signals"],
  ];

  const runCron=async job=>{
    setCronRun(p=>({...p,[job]:{status:"running"}}));
    try{
      const r=await apiFetch("/api/admin/run-cron",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({job})});
      let d=null;try{d=await r.json();}catch{}
      if(!r.ok||!d?.ok){
        const msg=d?.error?(typeof d.error==="string"?d.error:JSON.stringify(d.error)):`HTTP ${r.status}`;
        setCronRun(p=>({...p,[job]:{status:"error",msg}}));
        return;
      }
      setCronRun(p=>({...p,[job]:{status:"ok",code:d.cronStatus}}));
      load();
    }catch(e){
      setCronRun(p=>({...p,[job]:{status:"error",msg:e?.message||"Network error"}}));
    }
  };

  const invite=async()=>{
    const email=inviteEmail.trim().toLowerCase();
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){setInviteMsg({ok:false,msg:"Enter a valid email."});return;}
    setInviteBusy(true);setInviteMsg(null);
    try{
      const r=await apiFetch("/api/admin/invite",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email})});
      const d=await r.json().catch(()=>({}));
      if(!r.ok||!d?.ok){setInviteMsg({ok:false,msg:d?.error||`HTTP ${r.status}`});return;}
      setInviteMsg({ok:true,msg:`Branded invite sent to ${d.email}.`});
      setInviteEmail("");
      load();
    }catch(e){setInviteMsg({ok:false,msg:e?.message||"Network error"});}
    finally{setInviteBusy(false);}
  };

  const load=useCallback(async()=>{
    setBusy(true);setErr(null);
    // Check r.ok before reading JSON — otherwise a 403/500/503 error body is
    // consumed as if it were data and the panel renders empty/zero with no
    // signal, indistinguishable from a genuinely empty system.
    const j=async(path)=>{
      const r=await apiFetch(path);
      if(!r.ok){
        let msg=`HTTP ${r.status}`;
        try{const e=await r.json();if(e?.error)msg=typeof e.error==="string"?e.error:JSON.stringify(e.error);}catch{}
        throw new Error(`${path.split("?")[0]} — ${msg}`);
      }
      return r.json();
    };
    try{
      const[s,u,a,d]=await Promise.all([
        j("/api/admin/stats"),
        j("/api/admin/users?limit=200"),
        j(`/api/admin/audit-log?limit=${PAGE}&offset=${auditOffset}`),
        j("/api/admin/db-status"),
      ]);
      setStats(s);setUsers(u.users||[]);setAuditRows(a.rows||[]);setAuditTotal(a.total||0);setDbStatus(d);
    }catch(e){setErr(e.message||"Failed to load");}
    finally{setBusy(false);}
  },[auditOffset]);
  useEffect(()=>{load();},[load]);

  const suspend=async(id,op)=>{
    if(!confirm(`${op==="suspend"?"Suspend":"Unsuspend"} this user?`))return;
    const r=await apiFetch(`/api/admin/users/${id}/${op}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({})});
    if(!r.ok){setErr(`${op} failed`);return;}
    load();
  };

  const fmtDate=s=>s?new Date(s).toLocaleString():"—";

  return<div style={{display:"flex",flexDirection:"column",gap:T.s4}}>
    {/* ─── Stats cards ───────────────────────────── */}
    <div className="bento-row" style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(160px, 1fr))",gap:T.s3}}>
      {[
        ["TOTAL USERS",         stats?.users_total ?? "—"],
        ["ACTIVE (7d)",         stats?.active_last_7_days ?? "—"],
        ["SYNCS TODAY",         stats?.syncs_today ?? "—"],
        ["AI QUERIES TODAY",    stats?.ai_queries_today ?? "—"],
      ].map(([l,v])=><BentoTile key={l}>
        <div style={{fontFamily:FM,fontSize:9,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>{l}</div>
        <div style={{fontFamily:FU,fontSize:24,fontWeight:700,color:T.textHi,letterSpacing:"-0.02em",fontVariantNumeric:"tabular-nums"}}>{v.toLocaleString?.()||v}</div>
      </BentoTile>)}
    </div>

    {/* ─── DB / Cron health ──────────────────────── */}
    {dbStatus&&<BentoTile>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:T.s3,flexWrap:"wrap",gap:T.s2}}>
        <span style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600}}>SCHEMA + CRON</span>
        <Tag label={dbStatus.ok?"All migrations applied":"Migrations missing"} color={dbStatus.ok?T.gain:T.loss}/>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(220px, 1fr))",gap:T.s3}}>
        {(dbStatus.migrations||[]).map(m=><div key={m.migration} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:T.rMd,padding:`${T.s3} ${T.s3}`}}>
          <div style={{fontFamily:FM,fontSize:11,color:T.text,marginBottom:T.s1}}>{m.migration}</div>
          <Tag label={m.complete?"OK":"Missing"} color={m.complete?T.gain:T.loss}/>
        </div>)}
        {Object.entries(dbStatus.cron||{}).map(([action,row])=><div key={action} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:T.rMd,padding:`${T.s3} ${T.s3}`}}>
          <div style={{fontFamily:FM,fontSize:11,color:T.text,marginBottom:T.s1}}>{action}</div>
          <div style={{fontFamily:FM,fontSize:10,color:T.muted}}>Last: {fmtDate(row?.created_at)}</div>
          {row?.metadata&&<div style={{fontFamily:FM,fontSize:10,color:T.muted,marginTop:2}}>{Object.entries(row.metadata).map(([k,v])=>`${k}=${v}`).join(", ")}</div>}
        </div>)}
      </div>
    </BentoTile>}

    {/* ─── Maintenance · Cron Jobs ───────────────── */}
    <BentoTile>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:T.s3,flexWrap:"wrap",gap:T.s2}}>
        <span style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600}}>MAINTENANCE · CRON JOBS</span>
        <span style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.06em"}}>{busy?"Loading status…":"Run a job on demand"}</span>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(260px, 1fr))",gap:T.s3}}>
        {CRON_JOBS.map(([job,label])=>{
          const run=cronRun[job]||{};
          const last=dbStatus?.cron?.[`cron.${job}`];
          const running=run.status==="running";
          return<div key={job} style={{background:T.surface,border:`1px solid ${run.status==="error"?T.loss+"40":run.status==="ok"?T.gain+"40":T.border}`,borderRadius:T.rMd,padding:`${T.s3} ${T.s3}`,display:"flex",flexDirection:"column",gap:T.s2}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:T.s2}}>
              <div>
                <div style={{fontFamily:FP,fontSize:13,fontWeight:600,color:T.textHi,letterSpacing:"-0.01em"}}>{label}</div>
                <div style={{fontFamily:FM,fontSize:10,color:T.muted,marginTop:2}}>{job}</div>
              </div>
              <button onClick={()=>runCron(job)} disabled={running} style={{
                padding:`4px ${T.s3}`,borderRadius:T.rSm,
                background:running?"transparent":`${T.blue}14`,
                border:`1px solid ${running?T.border:T.blue+"40"}`,
                color:running?T.muted:T.blue,
                cursor:running?"default":"pointer",opacity:running?0.6:1,
                fontFamily:FM,fontSize:10,fontWeight:600,letterSpacing:"0.04em",flexShrink:0,
              }}>{running?"Running…":"Run now"}</button>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:T.s2,flexWrap:"wrap",minHeight:18}}>
              {run.status==="ok"&&<span style={{display:"inline-flex",alignItems:"center",gap:4,fontFamily:FM,fontSize:10,color:T.gain,fontVariantNumeric:"tabular-nums"}}><Icon name="check" size={11}/>HTTP {run.code}</span>}
              {run.status==="error"&&<span style={{fontFamily:FM,fontSize:10,color:T.loss,lineHeight:1.4}}>{ICON_NO}{run.msg}</span>}
              {!run.status&&(last?.created_at
                ?<span style={{fontFamily:FM,fontSize:10,color:T.muted,fontVariantNumeric:"tabular-nums"}}>Last run {fmtDate(last.created_at)}{Number.isFinite(last.hours_ago)?` · ${last.hours_ago}h ago`:""}</span>
                :<span style={{fontFamily:FM,fontSize:10,color:T.dim}}>No recent run recorded</span>)}
            </div>
          </div>;
        })}
      </div>
    </BentoTile>

    {/* ─── Sub-tabs ──────────────────────────────── */}
    <TabBar tabs={[["users","Users"],["audit","Audit Log"]]} active={tab} onChange={setTab}/>

    {err&&<BentoTile style={{background:`${T.loss}10`,border:`1px solid ${T.loss}40`}}>
      <div style={{fontFamily:FM,fontSize:11,color:T.loss}}>{ICON_NO}{err}</div>
    </BentoTile>}

    {tab==="users"&&<BentoTile style={{padding:0,overflow:"hidden"}}>
      <div style={{padding:`${T.s4} ${T.s5}`,borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600}}>USERS · {users.length}</span>
        <button onClick={load} disabled={busy} className="btn-ghost" style={{fontSize:10}}>{busy?"Loading…":"Refresh"}</button>
      </div>
      <div style={{padding:`${T.s4} ${T.s5}`,borderBottom:`1px solid ${T.border}`,display:"flex",flexDirection:"column",gap:T.s2}}>
        <span style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600}}>INVITE A USER</span>
        <div style={{display:"flex",gap:T.s2,flexWrap:"wrap"}}>
          <input value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")invite();}} placeholder="name@example.com" type="email" className="field" style={{flex:1,minWidth:200,fontSize:13}}/>
          <button onClick={invite} disabled={inviteBusy} className="btn-primary" style={{fontSize:11,whiteSpace:"nowrap"}}>{inviteBusy?"Sending…":"Send branded invite"}</button>
        </div>
        {inviteMsg&&<div style={{fontFamily:FM,fontSize:11,color:inviteMsg.ok?T.gain:T.loss}}>{inviteMsg.ok?<Icon name="check" size={12} style={{display:"inline-block",verticalAlign:"-2px",marginRight:5}}/>:ICON_NO}{inviteMsg.msg}</div>}
        <div style={{fontFamily:FP,fontSize:11,color:T.muted,lineHeight:1.5}}>Sends a Mīzan-branded invite from alerts@mizan.exchange — not Supabase's default. (Deliverability needs the DMARC DNS record; see setup notes.)</div>
      </div>
      {users.length===0
        ?<div style={{padding:`${T.s8} ${T.s5}`,textAlign:"center",fontFamily:FP,fontSize:13,color:T.muted}}>No users yet.</div>
        :<Tbl cols={[
          {l:"Email",r_:r=><span style={{fontFamily:FP,fontSize:13,color:T.text}}>{r.email}</span>},
          {l:"Joined",r_:r=><span style={{fontFamily:FM,fontSize:11,color:T.muted}}>{fmtDate(r.created_at)}</span>},
          {l:"Last sign-in",r_:r=><span style={{fontFamily:FM,fontSize:11,color:T.muted}}>{fmtDate(r.last_sign_in)}</span>},
          {l:"Status",r_:r=><Tag label={r.suspended?"Suspended":r.is_root?"Root":"Active"} color={r.suspended?T.loss:r.is_root?T.gold:T.gain}/>},
          {l:"",r:true,r_:r=><div style={{display:"flex",gap:T.s1,justifyContent:"flex-end"}}>
            {r.suspended
              ?<button onClick={()=>suspend(r.id,"unsuspend")} style={{padding:`3px ${T.s2}`,borderRadius:T.rSm,background:`${T.gain}18`,border:`1px solid ${T.gain}40`,color:T.gain,cursor:"pointer",fontFamily:FM,fontSize:10,fontWeight:600,letterSpacing:"0.04em"}}>UNSUSPEND</button>
              :<button onClick={()=>suspend(r.id,"suspend")} disabled={r.is_root} title={r.is_root?"Cannot suspend a root account":""} style={{padding:`3px ${T.s2}`,borderRadius:T.rSm,background:"transparent",border:`1px solid ${T.loss}40`,color:T.loss,cursor:r.is_root?"not-allowed":"pointer",opacity:r.is_root?0.4:1,fontFamily:FM,fontSize:10,fontWeight:600,letterSpacing:"0.04em"}}>SUSPEND</button>}
          </div>},
        ]} rows={users}/>}
    </BentoTile>}

    {tab==="audit"&&<BentoTile style={{padding:0,overflow:"hidden"}}>
      <div style={{padding:`${T.s4} ${T.s5}`,borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600}}>AUDIT LOG · {auditTotal.toLocaleString()} total · showing {auditOffset+1}-{Math.min(auditOffset+PAGE,auditTotal)}</span>
        <div style={{display:"flex",gap:T.s2}}>
          <button onClick={()=>setAuditOffset(Math.max(0,auditOffset-PAGE))} disabled={busy||auditOffset===0} className="btn-ghost" style={{fontSize:10}}>← Prev</button>
          <button onClick={()=>setAuditOffset(auditOffset+PAGE)} disabled={busy||auditOffset+PAGE>=auditTotal} className="btn-ghost" style={{fontSize:10}}>Next →</button>
        </div>
      </div>
      {auditRows.length===0
        ?<div style={{padding:`${T.s8} ${T.s5}`,textAlign:"center",fontFamily:FP,fontSize:13,color:T.muted}}>No audit entries.</div>
        :<Tbl cols={[
          {l:"When",r_:r=><span style={{fontFamily:FM,fontSize:11,color:T.muted,whiteSpace:"nowrap"}}>{fmtDate(r.created_at)}</span>},
          {l:"User",r_:r=><span style={{fontFamily:FP,fontSize:11,color:T.text}}>{r.email||(r.user_id?r.user_id.slice(0,8)+"…":"—")}</span>},
          {l:"Action",r_:r=><span style={{fontFamily:FP,fontSize:12,color:T.text,fontWeight:500}}>{r.action}</span>},
          {l:"Target",r_:r=><span style={{fontFamily:FM,fontSize:11,color:T.muted}}>{r.target||"—"}</span>},
          {l:"IP",r_:r=><span style={{fontFamily:FM,fontSize:10,color:T.muted}}>{r.ip||"—"}</span>},
          {l:"Metadata",r_:r=>r.metadata&&Object.keys(r.metadata).length>0
            ?<span style={{fontFamily:FM,fontSize:10,color:T.muted}}>{Object.entries(r.metadata).slice(0,3).map(([k,v])=>`${k}=${String(v).slice(0,30)}`).join(" · ")}</span>
            :<span style={{fontFamily:FM,fontSize:10,color:T.dim}}>—</span>},
        ]} rows={auditRows}/>}
    </BentoTile>}
  </div>;
}

/* ─── CONNECT MODAL ──────────────────────────────────── */
function ConnectModal({onClose,snapId,onConnected,connectionType="read"}){
  const isTrade = connectionType==="trade";
  const [step, setStep] = useState("select");
  const [sel,  setSel]  = useState(null);
  const [url,  setUrl]  = useState("");
  const [errMsg, setErrMsg] = useState("");
  const [search, setSearch] = useState("");
  const [conn, setConn] = useState(()=>{
    try { return JSON.parse(localStorage.getItem("mizan_brokers")||"[]"); }
    catch { return []; }
  });
  // Live SnapTrade brokerage list (60+) merged with our hardcoded BROKERS for
  // descriptions / "mine" tags. Fetched once on modal mount.
  const [allBrokerages, setAllBrokerages] = useState([]);
  useEffect(() => {
    apiFetch("/api/snaptrade/brokerages")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.brokerages) setAllBrokerages(d.brokerages); })
      .catch(() => {});
  }, []);

  // Merge: SnapTrade list is authoritative for IDs/names; BROKERS gives
  // human-friendly descriptions for popular brands. No `mine` flag — that
  // implied account ownership by hardcoding owner-specific brokers.
  const mergedBrokers = useMemo(() => {
    const localById = Object.fromEntries(BROKERS.map(b => [b.id, b]));
    const localBySlug = Object.fromEntries(BROKERS.map(b => [b.id.toUpperCase(), b]));
    const live = allBrokerages.length > 0
      ? allBrokerages.map(b => {
          const slug = (b.slug || b.id || "").toUpperCase();
          const local = localById[slug] || localBySlug[slug];
          return {
            id: b.slug || slug,
            nm: b.name || b.display_name || slug,
            desc: local?.desc || b.description || b.display_name || "",
            url: b.url, logo: b.logo,
            disabled: b.enabled === false,
            // SnapTrade's authoritative per-broker trade flag. `authorization_types`
            // is unreliable (lists "trade" for Robinhood even though it can't trade),
            // so gate on allows_trading. undefined = unknown (hardcoded fallback list).
            allowsTrading: b.allows_trading,
          };
        }).sort((a,b)=>{
          // In the TRADE flow, surface trade-capable brokers first.
          if (isTrade) {
            const ax = a.allowsTrading === false, bx = b.allowsTrading === false;
            if (ax !== bx) return ax ? 1 : -1;
          }
          // Enabled first, then alphabetical
          if (a.disabled !== b.disabled) return a.disabled ? 1 : -1;
          return a.nm.localeCompare(b.nm);
        })
      : BROKERS;
    const q = search.trim().toLowerCase();
    return q
      ? live.filter(b => (b.nm + " " + b.id).toLowerCase().includes(q))
      : live;
  }, [allBrokerages, search, isTrade]);

  // SnapTrade window messages per their docs
  useEffect(()=>{
    const h = e => {
      const d = e.data;
      if (!d) return;
      if (d.status === "SUCCESS") {
        if (sel) {
          const u = [...conn.filter(b=>b.id!==sel.id),
            {...sel, status:"connected", authId:d.authorizationId, at:new Date().toISOString()}];
          localStorage.setItem("mizan_brokers", JSON.stringify(u));persistUserState("mizan_brokers",u);
          setConn(u);
        }
        setStep("done");
        // Ask SnapTrade to pull fresh balances/positions from the broker
        // so the new connection reflects current state immediately
        // instead of whatever SnapTrade had cached before linking. Best
        // effort; the user can still click Force Refresh manually.
        try { onConnected?.({ broker: sel?.id, authorizationId: d.authorizationId }); } catch {}
      } else if (d.status === "ERROR") {
        setStep("error");
      } else if (d==="CLOSED" || d==="CLOSE_MODAL" || d==="ABANDONED") {
        setStep("select"); setUrl("");
      }
    };
    window.addEventListener("message", h, false);
    return () => window.removeEventListener("message", h, false);
  }, [sel, conn]);

  const connect = async b => {
    if (!snapId || snapId.length < 6) { setStep("nokeys"); return; }
    setSel(b);
    setStep("loading");
    setErrMsg("");
    try {
      const r = await apiFetch("/api/snaptrade/login", {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({broker: b.id, connectionType})
      });
      let d = null;
      try { d = await r.json(); } catch {}
      if (r.ok && d?.loginLink) {
        setUrl(d.loginLink);
        setStep("iframe");
        return;
      }
      const detail = d?.error
        ? (typeof d.error === "string" ? d.error : JSON.stringify(d.error))
        : `HTTP ${r.status}`;
      setErrMsg(detail);
      setStep("error");
      try { console.error("[snaptrade.login] failed", { status: r.status, body: d }); } catch {}
    } catch (err) {
      // True network/fetch failure: server unreachable. Only show the
      // "node server.js" dev hint in development; in production this is
      // an unexpected outage and users should see a friendly error.
      const isDev = !!(import.meta && import.meta.env && import.meta.env.DEV);
      if (isDev) {
        setStep("noserver");
      } else {
        setErrMsg(err?.message || "Network error");
        setStep("error");
      }
      try { console.error("[snaptrade.login] network error", err); } catch {}
    }
  };

  const isConn = id => conn.some(b => b.id===id && b.status==="connected");
  const drop   = id => {
    const u = conn.filter(b => b.id!==id);
    localStorage.setItem("mizan_brokers", JSON.stringify(u));
    setConn(u);
  };

  const maxW = step==="iframe" ? 640 : 480;

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.65)",backdropFilter:"blur(24px) saturate(160%)",WebkitBackdropFilter:"blur(24px) saturate(160%)",zIndex:1000,
      display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{background:"var(--mz-glass-strong)",backdropFilter:"blur(40px) saturate(180%)",WebkitBackdropFilter:"blur(40px) saturate(180%)",border:"1px solid var(--mz-glass-border)",borderRadius:14,
        width:"100%",maxWidth:maxW,maxHeight:"90vh",display:"flex",flexDirection:"column",overflow:"hidden",boxShadow:"var(--mz-glass-shadow-lg)",animation:"glassFadeUp 0.22s cubic-bezier(.34,1.56,.64,1)"}}>

        {/* Header */}
        <div style={{padding:"13px 18px",borderBottom:`1px solid ${T.border}`,
          display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
          <div>
            <div style={{fontFamily:FM,fontSize:12,fontWeight:500,color:T.textHi}}>
              {step==="iframe" ? `Connecting ${sel?.nm}…`
               : step==="done" ? "Account Connected"
               : step==="error" ? "Connection Failed"
               : "Connect Account"}
            </div>
            <div style={{fontFamily:FP,fontSize:11,color:isTrade?T.gold:T.muted,marginTop:2}}>
              {isTrade ? "Trade-enabled connection — the bot may place real orders"
               : step==="iframe" ? "Your credentials go directly to your broker"
               : "Powered by SnapTrade OAuth"}
            </div>
          </div>
          <button onClick={()=>{setStep("select");setUrl("");onClose?.();}}
            style={{background:"none",border:"none",color:T.muted,cursor:"pointer",fontSize:18,lineHeight:1}}><Icon name="close" size={16}/></button>
        </div>

        {/* Loading */}
        {step==="loading" && (
          <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",
            justifyContent:"center",padding:40,gap:14,textAlign:"center"}}>
            <div style={{width:32,height:32,borderRadius:"50%",
              border:`2px solid ${T.blue}`,borderTopColor:"transparent",
              animation:"spin 0.8s linear infinite"}}/>
            <div style={{fontFamily:FM,fontSize:12,color:T.muted}}>Generating secure login link…</div>
          </div>
        )}

        {/* No backend running */}
        {step==="noserver" && (
          <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",
            justifyContent:"center",padding:40,gap:14,textAlign:"center"}}>
            <div style={{fontFamily:FM,fontSize:13,color:T.loss}}>Backend Server Not Running</div>
            <div style={{fontFamily:FP,fontSize:12,color:T.muted,lineHeight:1.7,maxWidth:360}}>
              SnapTrade needs a signed link from your backend.<br/>
              Open a second terminal in your <code style={{color:T.blue,fontFamily:FM}}>mizan-app</code> folder and run:
            </div>
            <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,
              padding:"11px 20px",fontFamily:FM,fontSize:13,color:T.textHi,letterSpacing:"0.04em"}}>
              node server.js
            </div>
            <div style={{fontFamily:FP,fontSize:11,color:T.muted}}>
              Keep it running alongside <code style={{fontFamily:FM}}>npm run dev</code>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>sel&&connect(sel)}
                style={{padding:"7px 16px",borderRadius:6,background:`${T.blue}18`,
                  border:`1px solid ${T.blue}`,color:T.blue,fontFamily:FM,fontSize:10,cursor:"pointer"}}>
                Try Again
              </button>
              <button onClick={()=>setStep("select")}
                style={{padding:"7px 16px",borderRadius:6,background:"transparent",
                  border:`1px solid ${T.border}`,color:T.muted,fontFamily:FM,fontSize:10,cursor:"pointer"}}>
                Back
              </button>
            </div>
          </div>
        )}

        {/* No SnapTrade keys */}
        {step==="nokeys" && (
          <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",
            justifyContent:"center",padding:40,gap:12,textAlign:"center"}}>
            <div style={{fontFamily:FM,fontSize:13,color:T.loss}}>SnapTrade Client ID Required</div>
            <div style={{fontFamily:FP,fontSize:12,color:T.muted,lineHeight:1.7,maxWidth:300}}>
              Add your SnapTrade Client ID in Settings → API Keys.<br/>
              Sign up free at snaptrade.com/developers.
            </div>
            <button onClick={()=>setStep("select")}
              style={{padding:"7px 16px",borderRadius:6,background:"transparent",
                border:`1px solid ${T.border}`,color:T.muted,fontFamily:FM,fontSize:10,cursor:"pointer"}}>
              Back
            </button>
          </div>
        )}

        {/* SnapTrade iframe */}
        {step==="iframe" && url && (
          <>
            <iframe src={url} title="SnapTrade"
              style={{flex:1,width:"100%",border:"none",minHeight:460}}
              sandbox="allow-forms allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
              referrerPolicy="no-referrer"
              allow="clipboard-read; clipboard-write"/>
            <div style={{padding:"8px 16px",borderTop:`1px solid ${T.border}`,
              display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
              <span style={{fontFamily:FM,fontSize:9,color:T.muted,letterSpacing:"0.06em"}}>
                YOUR PASSWORD NEVER TOUCHES MĪZAN
              </span>
              <button onClick={()=>{setStep("select");setUrl("");}}
                style={{padding:"4px 10px",borderRadius:6,background:"transparent",
                  border:`1px solid ${T.border}`,color:T.muted,fontFamily:FM,fontSize:9,cursor:"pointer"}}>
                Cancel
              </button>
            </div>
          </>
        )}

        {/* Success */}
        {step==="done" && (
          <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",
            justifyContent:"center",padding:40,gap:12,textAlign:"center"}}>
            <div style={{width:44,height:44,borderRadius:"50%",background:T.gainBg,
              border:`1px solid ${T.gain}`,display:"flex",alignItems:"center",
              justifyContent:"center",color:T.gain}}><Icon name="check" size={22} color={T.gain}/></div>
            <div style={{fontFamily:FM,fontSize:13,color:T.gain}}>{sel?.nm} Connected</div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setStep("select")}
                style={{padding:"7px 16px",borderRadius:6,background:"transparent",
                  border:`1px solid ${T.border}`,color:T.muted,fontFamily:FM,fontSize:10,cursor:"pointer"}}>
                Connect Another
              </button>
              <button onClick={()=>{setStep("select");setUrl("");onClose?.();}}
                style={{padding:"7px 16px",borderRadius:6,background:T.blue,
                  border:"none",color:"#fff",fontFamily:FM,fontSize:10,cursor:"pointer"}}>
                Done
              </button>
            </div>
          </div>
        )}

        {/* Error */}
        {step==="error" && (
          <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",
            justifyContent:"center",padding:40,gap:12,textAlign:"center"}}>
            <div style={{fontFamily:FM,fontSize:13,color:T.loss}}>Connection Failed</div>
            <div style={{fontFamily:FP,fontSize:12,color:T.muted,lineHeight:1.6,maxWidth:340}}>
              We couldn't set up your broker connection right now. This is usually temporary — please try again.
              If it keeps happening, contact support.
            </div>
            {errMsg && (
              <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,
                padding:"8px 12px",fontFamily:FM,fontSize:10,color:T.muted,maxWidth:340,wordBreak:"break-word"}}>
                {errMsg}
              </div>
            )}
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>sel&&connect(sel)}
                style={{padding:"7px 14px",borderRadius:6,background:`${T.blue}18`,
                  border:`1px solid ${T.blue}`,color:T.blue,fontFamily:FM,fontSize:10,cursor:"pointer"}}>
                Try Again
              </button>
              <button onClick={()=>setStep("select")}
                style={{padding:"7px 14px",borderRadius:6,background:"transparent",
                  border:`1px solid ${T.border}`,color:T.muted,fontFamily:FM,fontSize:10,cursor:"pointer"}}>
                Back
              </button>
            </div>
          </div>
        )}

        {/* Broker select */}
        {step==="select" && (
          <>
            <div style={{padding:"10px 14px 0",flexShrink:0}}>
              <input value={search} onChange={e=>setSearch(e.target.value)}
                placeholder={`Search ${allBrokerages.length||0} brokerages…`}
                style={{width:"100%",background:T.surface,border:`1px solid ${T.border}`,borderRadius:8,padding:"8px 12px",fontFamily:FM,fontSize:12,color:T.text,outline:"none",boxSizing:"border-box"}}/>
            </div>
            <div style={{overflowY:"auto",flex:1,padding:14,
              display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}} className="mz-grid-2">
              {mergedBrokers.length===0&&<div style={{gridColumn:"1 / -1",fontFamily:FM,fontSize:11,color:T.muted,textAlign:"center",padding:24}}>
                {allBrokerages.length===0?"Loading SnapTrade brokerages…":"No brokerages match your search."}
              </div>}
              {mergedBrokers.map(b => {
                const c = isConn(b.id);
                // In the trade flow, brokers SnapTrade can't place orders on
                // (allows_trading===false, e.g. Robinhood/Fidelity) are shown but
                // not selectable — prevents the opaque "couldn't open login flow"
                // error users hit when SnapTrade returns code 1012.
                const tradeBlocked = isTrade && b.allowsTrading === false;
                return (
                  <div key={b.id} style={{background:T.card,
                    border:`1px solid ${c ? T.blue+"40" : T.border}`,
                    borderRadius:12,padding:"11px 13px",opacity:tradeBlocked?0.72:1}}>
                    <div style={{display:"flex",justifyContent:"space-between",
                      alignItems:"flex-start",marginBottom:4,gap:6}}>
                      <span style={{fontFamily:FM,fontSize:12,fontWeight:500,
                        color:c ? T.blue : T.textHi}}>{b.nm}</span>
                      {tradeBlocked ? <Tag label="Read-only" color={T.slate}/> : b.mine && <Tag label="Mine" color={T.blue}/>}
                    </div>
                    <div style={{fontFamily:FM,fontSize:9,color:T.muted,marginBottom:9}}>
                      {tradeBlocked ? "SnapTrade can't place trades on this broker — connect it read-only from Settings." : b.desc}
                    </div>
                    <div style={{display:"flex",gap:5}}>
                      {tradeBlocked ? (
                        <div title="This broker does not support trading through SnapTrade — only read-only data access."
                          style={{flex:1,padding:"5px",borderRadius:6,fontFamily:FM,fontSize:9,
                            fontWeight:500,letterSpacing:"0.06em",textAlign:"center",
                            border:`1px solid ${T.border}`,textTransform:"uppercase",
                            background:"transparent",color:T.muted}}>
                          Can't trade
                        </div>
                      ) : (
                      <button onClick={()=>!c&&connect(b)}
                        style={{flex:1,padding:"5px",borderRadius:6,fontFamily:FM,fontSize:9,
                          fontWeight:500,letterSpacing:"0.06em",
                          cursor:c?"default":"pointer",border:"none",textTransform:"uppercase",
                          background:c ? `${T.gain}15` : `${T.blue}20`,
                          color:c ? T.gain : T.blue}}>
                        {c ? "Connected" : "Connect"}
                      </button>
                      )}
                      {c && (
                        <button onClick={()=>drop(b.id)}
                          style={{padding:"5px 8px",borderRadius:6,background:"transparent",
                            border:`1px solid ${T.loss}28`,color:T.loss,
                            cursor:"pointer",fontFamily:FM,fontSize:9}}><Icon name="close" size={12}/></button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{padding:"9px 16px",borderTop:`1px solid ${T.border}`,flexShrink:0,
              fontFamily:FP,fontSize:11,color:T.muted,lineHeight:1.6}}>
              Your brokerage password never touches MĪZAN. SnapTrade uses the same OAuth as "Sign in with Google."
            </div>
          </>
        )}

      </div>
    </div>
  );
}


/* ─── ROOT ───────────────────────────────────────────── */

/* ─── FINANCES (Plaid banking) ───────────────────────── */
// Bank accounts (checking/savings/credit), recent transactions, spending
// summary by category, recurring subscription detection. Powered by Plaid
// via the server proxy at /api/plaid/*.

// Child wrapper for the Plaid usePlaidLink hook. Renders only when the
// dynamically-imported `react-plaid-link` module AND a link token are
// both available, so the hook executes unconditionally inside it. A
// conditional hook call in the parent (the previous approach) violated
// the Rules of Hooks the moment the lazy import resolved and crashed
// the Finances tree under SentryFallback.
function PlaidLinker({ usePlaidLinkHook, linkToken, onSuccess, onExit, shouldOpen, receivedRedirectUri }) {
  // receivedRedirectUri is set only when the user is returning from an
  // OAuth bank's site. Passing it tells Plaid Link to resume the OAuth
  // handshake using the same link_token that started the flow. For the
  // happy path (initial Connect Bank click) we leave it undefined.
  const linkApi = usePlaidLinkHook({
    token: linkToken,
    onSuccess,
    onExit,
    ...(receivedRedirectUri ? { receivedRedirectUri } : {}),
  });
  useEffect(() => {
    if (shouldOpen && linkApi.ready && typeof linkApi.open === "function") {
      linkApi.open();
    }
  }, [shouldOpen, linkApi.ready]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

// ── GoalsHub ──────────────────────────────────────────────────
// Single top-level "Plan" tab that consolidates the three forward-looking
// surfaces previously scattered across Portfolio (Zakat) and the dropped
// Trade tab (FIRE calculator). One place to project, plan, and dispense.
//
//   Goals    — savings targets + projected completion
//   Zakat    — religious obligation + sadaqah ledger
//   FIRE     — retirement / financial-independence math
//
// Each sub-tab is a self-contained component; this wrapper just owns the
// active-tab state and the TabBar. No new schema, no new endpoints.
function GoalsHub({snapAccounts=[],plaidAccounts=[],netWorthHistory=[],demoMode=false,currentNW=0,ytdContrib=0,bankBalance=0,onConnect}){
  const[sub,setSub]=useState("goals");
  return<div style={{display:"flex",flexDirection:"column",gap:T.s5}}>
    <TabBar tabs={[["goals","Goals"],["zakat","Zakat"],["sadaqah","Sadaqah"],["fire","Retirement / FIRE"]]} active={sub} onChange={setSub}/>
    {sub==="goals"&&<Goals snapAccounts={snapAccounts} plaidAccounts={plaidAccounts} netWorthHistory={netWorthHistory} demoMode={demoMode}/>}
    {sub==="zakat"&&<ZakatSadaqah view="zakat" accounts={snapAccounts} plaidAccounts={plaidAccounts} demoMode={demoMode} bankBalance={bankBalance} onConnect={onConnect}/>}
    {sub==="sadaqah"&&<ZakatSadaqah view="sadaqah" accounts={snapAccounts} plaidAccounts={plaidAccounts} demoMode={demoMode} bankBalance={bankBalance} onConnect={onConnect}/>}
    {sub==="fire"&&<FireCalculator currentNW={currentNW} ytdContrib={ytdContrib}/>}
  </div>;
}

function Finances({onBankBalanceChange,demoMode=false,onNav,nicknames={},onSetNickname}){
  const{user}=useAuth();
  // In demo mode short-circuit straight to the local fixtures so the
  // tab is fully populated without ever talking to Plaid. Toggle off
  // returns the user to real (or empty) state.
  const[accounts,setAccounts]=useState(()=>demoMode?DEMO_BANK_ACCOUNTS:[]);
  const[txns,setTxns]=useState(()=>demoMode?DEMO_TRANSACTIONS:[]);
  const[loading,setLoading]=useState(false);
  // Throttle the empty-state auto-sync inside refresh(). Server-side
  // plaid.sync is capped at 10/hr per user; the 90s interval + visibility
  // poll + post-link retry burst together can blow that budget within
  // minutes and 429 every subsequent /sync — including the user's manual
  // click. Gate auto-fires behind a ≥ 6 min gap so we leave headroom for
  // the burst (8 calls) and one manual sync. Burst syncs and manual clicks
  // bump this ref so they all share the same throttle window.
  const lastAutoSyncAtRef=useRef(0);
  const[linkToken,setLinkToken]=useState(null);
  const[plaidReady,setPlaidReady]=useState(false);
  const[busy,setBusy]=useState(false);
  const[status,setStatus]=useState(null);
  // Items the user must re-authorize (Plaid surfaced ITEM_LOGIN_REQUIRED /
  // PENDING_EXPIRATION). Populated from per-item errors in /accounts and
  // /transactions responses so we can show a yellow banner above the
  // affected institution's account list.
  const[itemsNeedingReauth,setItemsNeedingReauth]=useState([]);
  // Plaid's native recurring-transactions endpoint. null = not yet fetched.
  // Falls back to the local heuristic when the API returns an error or when
  // the user is in demo mode.
  const[plaidRecurring,setPlaidRecurring]=useState(null);

  const fmtUSD=v=>`$${(+v||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const fmtDate=s=>{try{return new Date(s).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});}catch{return s;}};

  const totalBank=useMemo(()=>accounts.reduce((s,a)=>{
    // For credit cards / loans, current_bal is a positive number representing
    // what you OWE. Treat depository (checking/savings) as positive net worth
    // contribution; loans/credit as negative. Investment-type Plaid accounts
    // are excluded — those are routed through SnapTrade as the canonical
    // brokerage source, so including them here would double-count any broker
    // a user happens to link via both providers (e.g. Robinhood).
    const v=+a.current_bal||0;
    if(isBankDebt(a))return s-v;
    if(isBankAsset(a))return s+v;
    return s;
  },0),[accounts]);

  // Restrict transaction analysis to bank-side accounts only. If the user
  // linked a brokerage via Plaid, its trade/dividend transactions would
  // otherwise pollute the spending category + recurring widgets.
  const bankAccountIds=useMemo(()=>{
    const ids=new Set();
    accounts.forEach(a=>{if(isBankAsset(a)||isBankDebt(a))ids.add(a.account_id);});
    return ids;
  },[accounts]);
  const bankTxns=useMemo(()=>{
    if(bankAccountIds.size===0)return txns; // no classification info → show all
    return txns.filter(t=>bankAccountIds.has(t.account_id));
  },[txns,bankAccountIds]);

  // ─── Transactions table state (search + filter chips + pagination) ─────
  // Launch-blocker: real bank histories have thousands of rows; .slice(0,200)
  // with no controls is unusable. Search is debounced ~200ms via a paired
  // useEffect/setTimeout (no new dependency). All four filters compose on
  // top of bankTxns (which already strips brokerage-Plaid trades).
  const[txnSearch,setTxnSearch]=useState("");
  const[txnSearchDebounced,setTxnSearchDebounced]=useState("");
  useEffect(()=>{
    const id=setTimeout(()=>setTxnSearchDebounced(txnSearch.trim().toLowerCase()),200);
    return()=>clearTimeout(id);
  },[txnSearch]);
  const[txnType,setTxnType]=useState("all"); // all | outflow | inflow | pending
  const[txnRange,setTxnRange]=useState("90d"); // 30d | 90d | ytd | all
  const[txnAccount,setTxnAccount]=useState("all"); // all | account_id
  const PAGE_SIZE=50;
  const[txnLimit,setTxnLimit]=useState(PAGE_SIZE);
  // Reset pagination whenever any filter input changes so users don't get
  // stuck on page 5 after narrowing the result set.
  useEffect(()=>{setTxnLimit(PAGE_SIZE);},[txnSearchDebounced,txnType,txnRange,txnAccount]);

  // Compose all filters on top of bankTxns. useMemo so the heavy work runs
  // once per dependency change, not on every keystroke before debounce fires.
  const filteredTxns=useMemo(()=>{
    const now=new Date();
    let cutoff=null;
    if(txnRange==="30d"){cutoff=new Date(now);cutoff.setDate(now.getDate()-30);}
    else if(txnRange==="90d"){cutoff=new Date(now);cutoff.setDate(now.getDate()-90);}
    else if(txnRange==="ytd"){cutoff=new Date(now.getFullYear(),0,1);}
    const cutoffStr=cutoff?cutoff.toISOString().slice(0,10):null;
    const q=txnSearchDebounced;
    return bankTxns.filter(t=>{
      // Date range — string compare works because Plaid dates are ISO YYYY-MM-DD.
      if(cutoffStr&&(t.date||"")<cutoffStr)return false;
      // Type filter — Plaid convention: amount > 0 is outflow, < 0 is inflow.
      if(txnType==="outflow"&&!(t.amount>0))return false;
      if(txnType==="inflow"&&!(t.amount<0))return false;
      if(txnType==="pending"&&!t.pending)return false;
      // Account filter — exact account_id match.
      if(txnAccount!=="all"&&t.account_id!==txnAccount)return false;
      // Search — merchant_name OR name OR Plaid category, substring, case-insensitive.
      if(q){
        const merchant=(t.merchant_name||"").toLowerCase();
        const name=(t.name||"").toLowerCase();
        const cat=(t.personal_finance_category?.primary||t.category?.[0]||"").toLowerCase();
        if(!merchant.includes(q)&&!name.includes(q)&&!cat.includes(q))return false;
      }
      return true;
    });
  },[bankTxns,txnSearchDebounced,txnType,txnRange,txnAccount]);
  const visibleTxns=useMemo(()=>filteredTxns.slice(0,txnLimit),[filteredTxns,txnLimit]);

  // Categories that are transfers / payments, not real spending (payment-flows tile).
  // Recurring-subscription classification moved to isSubscriptionCandidate /
  // isRecurringActive in lib/recurring.js (shared by both the Plaid + fallback paths).
  const EXCLUDE_CATS=new Set(["LOAN_PAYMENTS","TRANSFER_OUT","TRANSFER_IN","BANK_FEES","INCOME"]);

  // Payment flows tile — current month breakdown of excluded categories
  // (debt repayments, transfers, bank fees) plus income/inflow summary.
  const paymentFlows=useMemo(()=>{
    const now=new Date();
    const monthStart=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-01`;
    const PAYMENT_CATS=["LOAN_PAYMENTS","TRANSFER_OUT","BANK_FEES"];
    const outMap={};
    let incomeTotal=0;
    bankTxns.forEach(t=>{
      if(!t.date||t.date<monthStart)return;
      const cat=t.personal_finance_category?.primary||t.category?.[0]||"";
      if(t.amount>0&&PAYMENT_CATS.includes(cat)){
        outMap[cat]=(outMap[cat]||0)+t.amount;
      }
      // Inflows: INCOME or TRANSFER_IN with negative amount (Plaid convention)
      if(t.amount<0&&(cat==="INCOME"||cat==="TRANSFER_IN")){
        incomeTotal+=Math.abs(t.amount);
      }
    });
    const outEntries=Object.entries(outMap).map(([cat,total])=>({cat,total})).sort((a,b)=>b.total-a.total);
    const outTotal=outEntries.reduce((s,e)=>s+e.total,0);
    return{outEntries,outTotal,incomeTotal};
  },[bankTxns]);

  // Spending by category — current calendar month only, outflows only.
  const spendingByCategory=useMemo(()=>{
    const now=new Date();
    const monthStart=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-01`;
    const map={};
    bankTxns.forEach(t=>{
      if(t.amount<=0)return;
      if(!t.date||t.date<monthStart)return;
      const cat=t.personal_finance_category?.primary||t.category?.[0]||"Other";
      // Exclude transfers and loan/credit-card payments — they're balance
      // movements, not real spending categories.
      if(EXCLUDE_CATS.has(cat))return;
      map[cat]=(map[cat]||0)+t.amount;
    });
    const entries=Object.entries(map).map(([cat,total])=>({cat,total})).sort((a,b)=>b.total-a.total);
    const monthTotal=entries.reduce((s,e)=>s+e.total,0);
    return{entries,monthTotal};
  },[bankTxns]);

  // Recurring subscription detection: same merchant 2+ distinct months.
  // Cadence is derived from the median gap between charge dates so we
  // can label weekly/biweekly/monthly/quarterly correctly and compute
  // an accurate per-month cost instead of a raw average.
  const recurring=useMemo(()=>{
    const byMerchant={};
    bankTxns.forEach(t=>{
      const m=(t.merchant_name||t.name||"").trim();
      if(!m||t.amount<=0)return;
      // Skip transfers, brokerage funding, and card/loan payments — but keep
      // subscriptions Plaid mis-tags as transfers (see isSubscriptionCandidate).
      const cat=t.personal_finance_category?.primary||t.category?.[0]||"";
      if(!isSubscriptionCandidate(m,cat))return;
      const month=(t.date||"").slice(0,7);
      if(!byMerchant[m])byMerchant[m]={merchant:m,months:new Set(),amounts:[],dates:[]};
      byMerchant[m].months.add(month);
      byMerchant[m].amounts.push(t.amount);
      byMerchant[m].dates.push(t.date);
    });
    const nowMs=Date.now();
    const medianOf=arr=>{if(!arr.length)return NaN;const s=[...arr].sort((a,b)=>a-b);const m=Math.floor(s.length/2);return s.length%2===0?(s[m-1]+s[m])/2:s[m];};
    const cadenceLabel=g=>!isFinite(g)?"irregular":g<=10?"weekly":g<=18?"biweekly":g<=45?"monthly":g<=100?"quarterly":"irregular";
    return Object.values(byMerchant)
      .filter(x=>x.months.size>=2)
      .map(x=>{
        const sorted=[...x.dates].filter(Boolean).sort();
        const gaps=[];
        for(let i=1;i<sorted.length;i++){
          const a=new Date(sorted[i-1]+"T00:00:00Z").getTime();
          const b=new Date(sorted[i]+"T00:00:00Z").getTime();
          const d=Math.round((b-a)/86400000);
          if(d>0)gaps.push(d);
        }
        const mg=medianOf(gaps);
        const cadence=cadenceLabel(mg);
        const avg=x.amounts.reduce((s,n)=>s+n,0)/x.amounts.length;
        const estMonthly=cadence==="weekly"?avg*4.33:cadence==="biweekly"?avg*2:cadence==="quarterly"?avg/3:avg;
        const lastDate=sorted[sorted.length-1]||"";
        return{
          merchant:x.merchant,
          monthCount:x.months.size,
          cadence,
          avgPerCharge:avg,
          estMonthly,
          lastDate,
          active:isRecurringActive(lastDate,cadence,nowMs),
        };
      })
      .sort((a,b)=>{
        if(a.active!==b.active)return a.active?-1:1;
        return b.estMonthly-a.estMonthly;
      });
  },[bankTxns]);

  useEffect(()=>{onBankBalanceChange?.(totalBank);},[totalBank]); // eslint-disable-line

  // Load existing accounts + transactions on mount.
  // opts.skipAutoSync — when true, skip the empty-state /sync fire. Used
  // by the post-link retry burst, which fires its own explicit syncs at
  // a tuned schedule; the trailing refresh() exists only to pull the
  // updated read into the UI, not to re-trigger sync.
  const refresh=useCallback(async(opts={})=>{
    const{skipAutoSync=false,live=false}=opts;
    // Demo mode is a pure local fixture — never hit the Plaid API.
    if(demoMode){setAccounts(DEMO_BANK_ACCOUNTS);setTxns(DEMO_TRANSACTIONS);setItemsNeedingReauth([]);return;}
    setLoading(true);
    // Collect per-item errors (ITEM_LOGIN_REQUIRED / PENDING_EXPIRATION) so
    // we can surface a Re-authorize banner per affected institution.
    const reauthMap=new Map();
    const collectReauth=(arr)=>{
      if(!Array.isArray(arr))return;
      arr.forEach(e=>{
        if(!e?.item_id)return;
        if(e.hint==="UPDATE_MODE_REQUIRED"||e.code==="ITEM_LOGIN_REQUIRED"||e.code==="PENDING_EXPIRATION"){
          reauthMap.set(e.item_id,{item_id:e.item_id,institution_name:e.institution_name||null});
        }
      });
    };
    try{
      // live=true forces a real-time balance pull from the bank (accountsBalanceGet);
      // the frequent background poll omits it and gets Plaid's cached balance.
      const ar=await apiFetch(`/api/plaid/accounts${live?"?live=1":""}`);
      let acctCount=0;
      if(ar.ok){
        const ad=await ar.json();
        const acctList=Array.isArray(ad.accounts)?ad.accounts:[];
        acctCount=acctList.length;
        setAccounts(acctList);
        collectReauth(ad.item_errors);
      }
      // Read path: /api/plaid/transactions returns rows from the
      // plaid_transactions table (populated by /transactions/sync). For
      // users who linked their bank before the cursor-based migration
      // shipped, that table is empty until the first sync runs. Self-heal:
      // if the read came back empty AND the user has Plaid accounts, fire
      // ?sync=1 to backfill via the cursor, then re-read. Best-effort — if
      // sync fails we just leave the empty state alone.
      let tr=await apiFetch("/api/plaid/transactions");
      let txnList=[];
      if(tr.ok){
        const td=await tr.json();
        txnList=Array.isArray(td.transactions)?td.transactions:[];
        collectReauth(td.item_errors);
      }
      const AUTO_SYNC_MIN_GAP_MS=6*60*1000;
      if(txnList.length===0&&acctCount>0&&!skipAutoSync&&Date.now()-lastAutoSyncAtRef.current>=AUTO_SYNC_MIN_GAP_MS){
        // Plaid's initial pull for a new bank takes 1-15 minutes — sync
        // calls during that window succeed but return 0 added. We can't
        // flip a permanent "we tried" flag (the user would be stuck on
        // empty if Plaid finishes later), but we also can't fire on
        // every 90s interval/visibility tick — that blows the 10/hr
        // plaid.sync budget within minutes. The 6-min gap below caps
        // auto-fires at ~10/hr in steady state and leaves headroom for
        // the post-link burst and one manual click. Burst + manual paths
        // also bump the ref so they share the throttle window.
        lastAutoSyncAtRef.current=Date.now();
        try{
          const sr=await apiFetch("/api/plaid/transactions?sync=1");
          if(sr.ok){
            const sd=await sr.json();
            collectReauth(sd.errors);
            // Re-read after sync so the freshly upserted rows reach the UI.
            tr=await apiFetch("/api/plaid/transactions");
            if(tr.ok){
              const td2=await tr.json();
              txnList=Array.isArray(td2.transactions)?td2.transactions:[];
            }
          }
        }catch(syncErr){console.warn("Plaid backfill sync failed:",syncErr);}
      }
      setTxns(txnList);
      setItemsNeedingReauth(Array.from(reauthMap.values()));
    }catch(err){console.error("Finances refresh failed:",err);}
    finally{setLoading(false);}
  },[demoMode]);
  useEffect(()=>{refresh();},[refresh]);

  // Fetch Plaid's native recurring-transactions after accounts load.
  // Runs once on mount (and whenever demoMode toggles). Best-effort —
  // on any error we leave plaidRecurring null and fall back to the
  // local heuristic so the tile never goes empty.
  useEffect(()=>{
    if(demoMode){setPlaidRecurring(null);return;}
    let cancelled=false;
    (async()=>{
      try{
        const r=await apiFetch("/api/plaid/recurring");
        if(cancelled)return;
        if(r.ok){
          const d=await r.json();
          setPlaidRecurring(d);
        }
      }catch{/* fall back to heuristic */}
    })();
    return()=>{cancelled=true;};
  },[demoMode]);

  // Explicit "Sync transactions" — bypasses didBackfillRef so the user can
  // always force a re-sync even when the auto-backfill already fired.
  // Useful when a sync failed silently (rate limit, bank latency) or when
  // the user wants fresh diffs RIGHT NOW instead of waiting for the cron.
  const[syncBusy,setSyncBusy]=useState(false);
  const[syncMsg,setSyncMsg]=useState(null);
  const syncTransactions=useCallback(async()=>{
    if(demoMode||syncBusy)return;
    setSyncBusy(true);setSyncMsg(null);
    lastAutoSyncAtRef.current=Date.now();
    try{
      const sr=await apiFetch("/api/plaid/transactions?sync=1");
      const sd=await sr.json().catch(()=>({}));
      if(!sr.ok){
        if(sr.status===429){
          setSyncMsg({ok:false,msg:"Rate-limited. Sync caps at 10/hour — try again later."});
        }else{
          setSyncMsg({ok:false,msg:sd.error||`Sync failed (${sr.status})`});
        }
        return;
      }
      const{added=0,modified=0,removed=0,failed=0}=sd;
      // Re-read transactions AND force a live balance pull from the bank
      // (accountsBalanceGet) so "Sync" refreshes both — balances otherwise lag
      // on Plaid's cached accountsGet value. refresh() shares the sync throttle
      // ref (bumped above) so it won't double-fire the transaction backfill.
      await refresh({live:true});
      const totalChanges=added+modified+removed;
      setSyncMsg({
        ok:failed===0,
        msg:failed>0
          ?`Synced with ${failed} item error${failed===1?"":"s"} · ${totalChanges} change${totalChanges===1?"":"s"}`
          :totalChanges===0
            ?"Up to date — no new transactions."
            :`Synced · +${added} added, ~${modified} updated, −${removed} removed`,
      });
    }catch(err){
      setSyncMsg({ok:false,msg:err.message||"Sync failed"});
    }finally{
      setSyncBusy(false);
      setTimeout(()=>setSyncMsg(null),6000);
    }
  },[demoMode,syncBusy,refresh]);

  // Server-side CSV download — fetches the endpoint as text/csv, builds a
  // blob-URL, clicks a synthetic anchor, then cleans up. Used by the Finances
  // tab Export CSV button below (and the Holdings/Activity buttons in the
  // Portfolio tab via the same helper inlined there).
  const downloadCSVFromEndpoint = useCallback(async (endpoint, filename) => {
    const r = await apiFetch(endpoint);
    if (!r.ok) { alert("Export failed"); return; }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
  }, []);

  // Keep the Finances tab fresh: poll every 90s (matches the global live-price
  // cadence) and re-fetch the moment the tab becomes visible after being
  // backgrounded. Plaid /accounts is cached server-side so the cost is low.
  useEffect(()=>{
    if(demoMode)return;
    const tick=setInterval(()=>{refresh();},90*1000);
    const onVis=()=>{if(document.visibilityState==="visible")refresh();};
    document.addEventListener("visibilitychange",onVis);
    return()=>{clearInterval(tick);document.removeEventListener("visibilitychange",onVis);};
  },[refresh,demoMode]);

  // Lazy-load react-plaid-link only when user clicks Connect (keeps initial bundle small).
  const[PlaidLink,setPlaidLink]=useState(null);
  // OAuth resume: if the user is on /oauth-redirect (Plaid sent them back
  // from the bank's site) we need the same link_token they started with,
  // plus the full incoming URL, to resume Plaid Link. Stash the token in
  // sessionStorage on startLink and read it back on mount below.
  const PLAID_OAUTH_TOKEN_KEY="mizan_plaid_oauth_token";
  const isOAuthRedirect=typeof window!=="undefined"&&(
    window.location.pathname==="/oauth-redirect"||
    /[?&]oauth_state_id=/.test(window.location.search||"")
  );
  const[receivedRedirectUri,setReceivedRedirectUri]=useState(
    isOAuthRedirect?(typeof window!=="undefined"?window.location.href:null):null
  );

  // On mount, if we landed on /oauth-redirect (or a URL with ?oauth_state_id=…),
  // reload the link_token from sessionStorage so Plaid Link can resume the
  // OAuth handshake. Lazy-import react-plaid-link too so usePlaidLink is
  // available. Plaid Link auto-opens once both token + receivedRedirectUri
  // are wired into the hook.
  useEffect(()=>{
    if(!isOAuthRedirect)return;
    let cancelled=false;
    (async()=>{
      try{
        const stashed=sessionStorage.getItem(PLAID_OAUTH_TOKEN_KEY);
        if(!stashed){
          setStatus({ok:false,msg:"Lost the OAuth session. Please connect again."});
          return;
        }
        if(!PlaidLink){
          const mod=await import("react-plaid-link");
          if(cancelled)return;
          setPlaidLink(()=>mod);
        }
        if(cancelled)return;
        setLinkToken(stashed);
        setPlaidReady(true);
      }catch(err){
        setStatus({ok:false,msg:err.message||"OAuth resume failed"});
      }
    })();
    return()=>{cancelled=true;};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  const startLink=async()=>{
    setBusy(true);setStatus(null);
    try{
      const r=await apiFetch("/api/plaid/link-token",{method:"POST"});
      const d=await r.json().catch(()=>({}));
      // MFA gate from the server. Surface a specific CTA so the user
      // knows exactly what to do next instead of getting a raw error.
      if(r.status===403&&(d.code==="MFA_ENROLLMENT_REQUIRED"||d.code==="MFA_VERIFICATION_REQUIRED")){
        setStatus({ok:false,msg:d.error||"Multi-factor authentication required.",code:d.code});
        return;
      }
      if(!r.ok||!d.link_token)throw new Error(d.error||"Could not start Plaid Link");
      // Stash the token for the OAuth redirect-back path. Same-origin
      // sessionStorage survives the bank-site round trip.
      try{sessionStorage.setItem(PLAID_OAUTH_TOKEN_KEY,d.link_token);}catch{}
      setLinkToken(d.link_token);
      if(!PlaidLink){
        const mod=await import("react-plaid-link");
        setPlaidLink(()=>mod);
      }
      setPlaidReady(true);
    }catch(err){
      setStatus({ok:false,msg:err.message||"Plaid Link failed to start"});
    }finally{setBusy(false);}
  };

  const onPlaidSuccess=async(public_token,metadata)=>{
    setBusy(true);setStatus(null);
    // Connection succeeded — clear the OAuth resume token + the
    // ?oauth_state_id= URL params so a refresh doesn't try to resume
    // an already-completed flow.
    try{sessionStorage.removeItem(PLAID_OAUTH_TOKEN_KEY);}catch{}
    if(typeof window!=="undefined"&&(window.location.pathname==="/oauth-redirect"||/[?&]oauth_state_id=/.test(window.location.search))){
      window.history.replaceState({},"","/");
    }
    setReceivedRedirectUri(null);
    try{
      const r=await apiFetch("/api/plaid/exchange",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({public_token,metadata}),
      });
      const d=await r.json();
      if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);
      setStatus({ok:true,msg:`Linked ${d.institution_name}. Pulling transactions…`});
      setPlaidReady(false);setLinkToken(null);
      // The burst below fires its own explicit syncs; tell refresh() to
      // skip its empty-state auto-fire so we don't double-spend the
      // plaid.sync budget.
      await refresh({skipAutoSync:true});

      // Plaid's transactions API is asynchronous for newly-linked Items:
      // the access_token works immediately for /accounts but /transactions/sync
      // returns empty until Plaid finishes the initial pull (typically
      // 10-60 s; can be longer — some banks take 5-15 min for large histories).
      // The server-side webhook handler triggers sync when Plaid signals
      // SYNC_UPDATES_AVAILABLE; webhooks can be slow/missed so we belt-and-
      // braces with a wider client retry burst spanning 15 minutes. The
      // burst stamps lastAutoSyncAtRef on each tick so refresh()'s own
      // empty-state auto-sync (driven by the 90s interval / visibility
      // poll) stays throttled and doesn't double-fire alongside us.
      lastAutoSyncAtRef.current=Date.now();
      apiFetch("/api/plaid/transactions?sync=1").catch(()=>{});
      [15_000, 45_000, 90_000, 180_000, 300_000, 480_000, 720_000, 900_000].forEach((delay)=>{
        setTimeout(()=>{
          lastAutoSyncAtRef.current=Date.now();
          apiFetch("/api/plaid/transactions?sync=1").catch(()=>{});
          // Pull the refreshed table into the UI right after each retry.
          // skipAutoSync so we don't fire another sync on top of the one
          // we just dispatched above.
          setTimeout(()=>refresh({skipAutoSync:true}).catch(()=>{}), 1500);
        }, delay);
      });
    }catch(err){
      setStatus({ok:false,msg:err.message||"Bank link failed"});
    }finally{
      setBusy(false);
      setTimeout(()=>setStatus(null),5000);
    }
  };

  // Update mode: an existing Item's bank session expired or needs a
  // re-auth (PENDING_EXPIRATION / ITEM_LOGIN_REQUIRED webhook from Plaid,
  // or the user's bank changed credentials). The server looks up the
  // stored access_token by item_id and returns a link_token in update
  // mode, which Plaid Link uses to resume the existing connection
  // instead of creating a new Item. No new access_token is issued.
  const startUpdateMode=async(itemId,institutionName)=>{
    setBusy(true);setStatus(null);
    try{
      const r=await apiFetch("/api/plaid/link-token",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({item_id:itemId}),
      });
      const d=await r.json().catch(()=>({}));
      if(r.status===403&&(d.code==="MFA_ENROLLMENT_REQUIRED"||d.code==="MFA_VERIFICATION_REQUIRED")){
        setStatus({ok:false,msg:d.error,code:d.code});
        return;
      }
      if(!r.ok||!d.link_token)throw new Error(d.error||"Could not start update mode");
      try{sessionStorage.setItem(PLAID_OAUTH_TOKEN_KEY,d.link_token);}catch{}
      setLinkToken(d.link_token);
      if(!PlaidLink){
        const mod=await import("react-plaid-link");
        setPlaidLink(()=>mod);
      }
      setPlaidReady(true);
      setStatus({ok:true,msg:`Re-authorizing ${institutionName}…`});
    }catch(err){
      setStatus({ok:false,msg:err.message||"Re-authorize failed"});
    }finally{setBusy(false);}
  };

  const removeItem=async(itemId,institutionName)=>{
    if(!window.confirm(`Disconnect ${institutionName}? Your balances + transactions will stop syncing.`))return;
    setBusy(true);
    try{
      const r=await apiFetch(`/api/plaid/item?itemId=${encodeURIComponent(itemId)}`,{method:"DELETE"});
      if(!r.ok){const d=await r.json().catch(()=>({}));throw new Error(d.error||`HTTP ${r.status}`);}
      await refresh();
    }catch(err){
      setStatus({ok:false,msg:err.message||"Disconnect failed"});
      setTimeout(()=>setStatus(null),5000);
    }finally{setBusy(false);}
  };

  // Group every Plaid account by institution. All account types render here
  // (depository, credit, loan, investment, brokerage, other) so the user sees
  // every connection they've authorized — the type badge per card explains
  // what each one is. Cash on Hand math elsewhere classifies them correctly
  // so they don't double-count when also linked via SnapTrade.
  const byInst={};
  accounts.forEach(a=>{
    if(!byInst[a.institution_name])byInst[a.institution_name]={inst:a.institution_name,item_id:a.item_id,accts:[]};
    byInst[a.institution_name].accts.push(a);
  });
  const institutions=Object.values(byInst);

  // Plaid Link hook from the lazy-loaded module. Mount the child only
  // once both the module + link token are present so usePlaidLink is
  // called unconditionally inside it. Calling the hook conditionally in
  // this parent (before vs after dynamic import resolves) violates the
  // Rules of Hooks and crashes the whole Finances tree under
  // SentryFallback the first time a real connect succeeds.
  const usePlaidLinkHook=PlaidLink?.usePlaidLink;

  return<div style={{display:"flex",flexDirection:"column",gap:T.s5}}>
    {/* Plaid Link hook host. Mounted only when the lazy module + token
        are both ready. Returns null; its sole job is to call usePlaidLink
        and open the iframe when plaidReady flips true. */}
    {usePlaidLinkHook && linkToken && (
      <PlaidLinker
        usePlaidLinkHook={usePlaidLinkHook}
        linkToken={linkToken}
        onSuccess={onPlaidSuccess}
        onExit={() => setPlaidReady(false)}
        shouldOpen={plaidReady}
        receivedRedirectUri={receivedRedirectUri}
      />
    )}
    {/* ─── HERO: Total bank balance + Connect ─────────── */}
    <BentoTile style={{
      background:`radial-gradient(circle at 0% 0%, ${T.blue}1A, transparent 55%), radial-gradient(circle at 100% 100%, ${T.gain}10, transparent 50%), ${T.card}`,
      borderColor:T.blue+"30",
      padding:`${T.s6} ${T.s6}`,
    }}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:T.s4}}>
        <div>
          <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.18em",fontWeight:600,marginBottom:T.s2}}>BANK NET POSITION
            {loading&&<span style={{marginLeft:T.s2,color:T.blue}}>● Syncing…</span>}
          </div>
          <div style={{fontFamily:FU,fontSize:42,fontWeight:700,color:totalBank>=0?T.textHi:T.loss,letterSpacing:"-0.03em",lineHeight:1,fontVariantNumeric:"tabular-nums"}}>{fmtUSD(totalBank)}</div>
          <div style={{fontFamily:FM,fontSize:12,color:T.muted,marginTop:T.s2}}>{institutions.length} institution{institutions.length===1?"":"s"} · {accounts.length} account{accounts.length===1?"":"s"}</div>
        </div>
        <div style={{display:"flex",gap:T.s2,flexWrap:"wrap"}}>
          {institutions.length>0&&!demoMode&&<button onClick={syncTransactions} disabled={syncBusy}
            title="Pull the latest transactions from Plaid (cursor-based diff sync)"
            style={{padding:`12px ${T.s4}`,fontSize:12,fontFamily:FM,fontWeight:600,letterSpacing:"0.04em",
              borderRadius:T.rMd,cursor:syncBusy?"wait":"pointer",
              background:syncBusy?"transparent":`${T.blue}14`,
              border:`1px solid ${T.blue}40`,color:T.blue}}>
            {syncBusy?"Syncing…":"↻ Sync transactions"}
          </button>}
          {institutions.length>0&&!demoMode&&<button
            onClick={()=>downloadCSVFromEndpoint("/api/export/transactions.csv",`mizan-transactions-${new Date().toISOString().slice(0,10)}.csv`)}
            title="Download every Plaid transaction on file as CSV"
            style={{padding:`12px ${T.s4}`,fontSize:12,fontFamily:FM,fontWeight:600,letterSpacing:"0.04em",
              borderRadius:T.rMd,cursor:"pointer",
              background:"transparent",
              border:`1px solid ${T.border}`,color:T.muted}}>
            ↓ Export CSV
          </button>}
          <button onClick={startLink} disabled={busy||demoMode} title={demoMode?"Disable demo mode in Settings to connect a real bank":undefined} className="btn-primary" style={{padding:`12px ${T.s5}`,fontSize:13}}>{busy?"Working…":demoMode?"+ Connect Bank (demo)":"+ Connect Bank"}</button>
        </div>
      </div>
      {syncMsg&&<div style={{marginTop:T.s3,padding:`${T.s2} ${T.s3}`,borderRadius:T.rMd,fontFamily:FM,fontSize:12,background:syncMsg.ok?T.gainBg:T.lossBg,border:`1px solid ${(syncMsg.ok?T.gain:T.loss)+"30"}`,color:syncMsg.ok?T.gain:T.loss}}>
        {syncMsg.ok?ICON_OK:ICON_NO}{syncMsg.msg}
      </div>}
      {status&&<div style={{marginTop:T.s4,padding:`${T.s2} ${T.s3}`,borderRadius:T.rMd,fontFamily:FM,fontSize:12,background:status.ok?T.gainBg:T.lossBg,border:`1px solid ${(status.ok?T.gain:T.loss)+"30"}`,color:status.ok?T.gain:T.loss,display:"flex",alignItems:"center",gap:T.s3,flexWrap:"wrap"}}>
        <span style={{flex:"1 1 auto"}}>{status.ok?ICON_OK:ICON_NO}{status.msg}</span>
        {(status.code==="MFA_ENROLLMENT_REQUIRED"||status.code==="MFA_VERIFICATION_REQUIRED")&&onNav&&
          <button onClick={()=>onNav("settings")}
            style={{padding:"6px 12px",borderRadius:6,border:`1px solid ${T.loss}`,background:"transparent",color:T.loss,fontFamily:FM,fontSize:11,fontWeight:600,cursor:"pointer",letterSpacing:"0.04em"}}>
            {status.code==="MFA_ENROLLMENT_REQUIRED"?"Enable 2FA":"Verify 2FA"}
          </button>
        }
      </div>}
    </BentoTile>

    {/* ─── INSTITUTIONS + ACCOUNTS ─────────────────── */}
    {institutions.length===0&&!loading?<BentoTile style={{padding:`${T.s10} ${T.s5}`,textAlign:"center",borderStyle:"dashed"}}>
      <div style={{fontFamily:FU,fontSize:18,fontWeight:600,color:T.textHi,marginBottom:T.s2,letterSpacing:"-0.01em"}}>No banks linked yet</div>
      <div style={{fontFamily:FP,fontSize:13,color:T.muted,lineHeight:1.55,maxWidth:520,margin:"0 auto"}}>
        Connect a bank to track checking, savings, and credit balances alongside your brokerage portfolio. Powered by Plaid — read-only, your credentials never touch our servers.
      </div>
    </BentoTile>:null}

    {institutions.map(inst=>{
      const needsReauth=itemsNeedingReauth.some(r=>r.item_id===inst.item_id);
      return<BentoTile key={inst.item_id||inst.inst} accent={T.blue}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:T.s3,flexWrap:"wrap",gap:T.s2}}>
        <div style={{fontFamily:FU,fontSize:16,fontWeight:600,color:T.textHi,letterSpacing:"-0.01em"}}>{inst.inst}</div>
        <div style={{display:"flex",gap:T.s2}}>
          <button onClick={()=>startUpdateMode(inst.item_id,inst.inst)} disabled={busy} className="btn-ghost" style={{fontSize:10}} title="Re-authenticate with the bank if a session expired or a password changed">Re-authorize</button>
          <button onClick={()=>removeItem(inst.item_id,inst.inst)} disabled={busy} className="btn-danger" style={{fontSize:10}}>Disconnect</button>
        </div>
      </div>
      {needsReauth&&<div style={{
        marginBottom:T.s3,
        padding:`${T.s2} ${T.s3}`,
        background:`${T.gold}1A`,
        border:`1px solid ${T.gold}`,
        borderRadius:T.rMd,
        fontFamily:FU,
        fontSize:12,
        color:T.textHi,
        display:"flex",
        alignItems:"center",
        gap:T.s2,
      }}>
        <Icon name="warning" size={14} aria-hidden="true"/>
        <span>This connection needs re-authorization. Click Re-authorize.</span>
      </div>}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(220px, 1fr))",gap:T.s2}}>
        {inst.accts.map(a=>{
          const isLiability=isBankDebt(a);
          const isInv=isBrokeragePlaid(a);
          // Color: red for debt, green for savings, gold for investment,
          // blue for everything else (checking, money market, etc.).
          const accent=isLiability?T.loss:isInv?T.gold:a.subtype==="savings"?T.gain:T.blue;
          return<div key={a.account_id} style={{
            padding:`${T.s3} ${T.s4}`,
            background:T.surface,
            border:`1px solid ${T.border}`,
            borderLeft:`3px solid ${accent}`,
            borderRadius:T.rMd,
            position:"relative",
          }}>
            <div style={{fontFamily:FM,fontSize:9,color:T.muted,letterSpacing:"0.14em",fontWeight:600,marginBottom:T.s1}}>{(a.subtype||a.type||"").toUpperCase()}{a.mask?` · ····${a.mask}`:""}</div>
            {isInv&&<div style={{position:"absolute",top:T.s2,right:T.s2,fontFamily:FM,fontSize:8,color:T.gold,letterSpacing:"0.1em",fontWeight:600,padding:`1px ${T.s1}`,border:`1px solid ${T.gold}40`,borderRadius:T.rSm}}>INVESTMENT</div>}
            {/* Display name — nickname wins when set, broker default
                becomes the smaller subtitle so users can still tell which
                physical account this is. */}
            <div style={{marginBottom:T.s1}}>
              <NicknameEditor
                accountId={a.account_id}
                defaultName={a.name||a.official_name||"Account"}
                nickname={nicknames?.[a.account_id]||""}
                onSetNickname={onSetNickname}
                primaryStyle={{fontFamily:FP,fontSize:13,color:T.text,letterSpacing:"-0.005em",fontWeight:nicknames?.[a.account_id]?600:400}}
                pencilStyle={{fontSize:13}}
              />
              {nicknames?.[a.account_id]&&<div style={{fontSize:10,color:T.muted,marginTop:2,fontFamily:FM}}>{a.name||a.official_name||"Account"}</div>}
            </div>
            <div style={{fontFamily:FU,fontSize:18,fontWeight:700,color:isLiability?T.loss:T.textHi,letterSpacing:"-0.015em",fontVariantNumeric:"tabular-nums"}}>{isLiability?"−":""}{fmtUSD(a.current_bal)}</div>
            {a.available_bal!=null&&a.available_bal!==a.current_bal&&<div style={{fontFamily:FM,fontSize:10,color:T.muted,marginTop:T.s1,fontVariantNumeric:"tabular-nums"}}>{fmtUSD(a.available_bal)} available</div>}
            {isInv&&<div style={{fontFamily:FM,fontSize:10,color:T.muted,marginTop:T.s1,lineHeight:1.4}}>Excluded from Bank Net Position — counted as brokerage on Overview / Portfolio.</div>}
          </div>;
        })}
      </div>
    </BentoTile>;
    })}

    {/* ─── SPENDING BY CATEGORY ─────────────────── */}
    {spendingByCategory.entries.length>0&&(()=>{
      const{entries,monthTotal}=spendingByCategory;
      const now=new Date();
      const monthLabel=now.toLocaleDateString("en-US",{month:"long",year:"numeric"});
      const fmtCat=s=>s.split("_").map(w=>w==="AND"?"&":w[0].toUpperCase()+w.slice(1).toLowerCase()).join(" ");
      return<CollapsibleTile title="SPENDING BY CATEGORY" subtitle={`${monthLabel} · ${fmtUSD(monthTotal)} spent`} storageKey="fin_spending">
        <div style={{display:"flex",flexDirection:"column",gap:T.s2}}>
          {entries.map(s=>{
            const pct=monthTotal>0?(s.total/monthTotal)*100:0;
            const barPct=(s.total/(entries[0]?.total||1))*100;
            return<div key={s.cat} style={{display:"grid",gridTemplateColumns:"minmax(130px,1.4fr) 1fr 90px 52px",gap:T.s3,alignItems:"center"}}>
              <span style={{fontFamily:FP,fontSize:13,color:T.text,letterSpacing:"-0.005em"}}>{fmtCat(s.cat)}</span>
              <div style={{height:8,background:T.dim,borderRadius:2,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${barPct}%`,background:`linear-gradient(90deg, ${T.blue}, ${T.blueDim})`,borderRadius:2}}/>
              </div>
              <span style={{fontFamily:FP,fontSize:13,fontWeight:600,color:T.textHi,textAlign:"right",fontVariantNumeric:"tabular-nums"}}>{fmtUSD(s.total)}</span>
              <span style={{fontFamily:FM,fontSize:11,color:T.muted,textAlign:"right",fontVariantNumeric:"tabular-nums"}}>{pct.toFixed(0)}%</span>
            </div>;
          })}
        </div>
      </CollapsibleTile>;
    })()}

    {/* ─── DEBT PAYMENTS & TRANSFERS ──────────── */}
    {paymentFlows.outEntries.length>0&&(()=>{
      const{outEntries,outTotal,incomeTotal}=paymentFlows;
      const now=new Date();
      const monthLabel=now.toLocaleDateString("en-US",{month:"long",year:"numeric"});
      const CAT_LABEL={LOAN_PAYMENTS:"Loan & Card Payments",TRANSFER_OUT:"Outbound Transfers",BANK_FEES:"Bank Fees"};
      return<CollapsibleTile title="DEBT PAYMENTS & TRANSFERS" subtitle={`${monthLabel} · ${fmtUSD(outTotal)}`} storageKey="fin_debt">
        <div style={{display:"flex",flexDirection:"column",gap:T.s2}}>
          {outEntries.map(e=>{
            const pct=outTotal>0?(e.total/outTotal)*100:0;
            const barPct=(e.total/(outEntries[0]?.total||1))*100;
            return<div key={e.cat} style={{display:"grid",gridTemplateColumns:"minmax(160px,1.6fr) 1fr 90px 52px",gap:T.s3,alignItems:"center"}}>
              <span style={{fontFamily:FP,fontSize:13,color:T.text,letterSpacing:"-0.005em"}}>{CAT_LABEL[e.cat]||e.cat.replace(/_/g," ")}</span>
              <div style={{height:8,background:T.dim,borderRadius:2,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${barPct}%`,background:`linear-gradient(90deg,${T.loss}88,${T.loss}44)`,borderRadius:2}}/>
              </div>
              <span style={{fontFamily:FP,fontSize:13,fontWeight:600,color:T.textHi,textAlign:"right",fontVariantNumeric:"tabular-nums"}}>{fmtUSD(e.total)}</span>
              <span style={{fontFamily:FM,fontSize:11,color:T.muted,textAlign:"right",fontVariantNumeric:"tabular-nums"}}>{pct.toFixed(0)}%</span>
            </div>;
          })}
        </div>
        {incomeTotal>0&&<div style={{marginTop:T.s4,paddingTop:T.s3,borderTop:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontFamily:FM,fontSize:10,color:T.gain,letterSpacing:"0.14em",fontWeight:600}}>INCOME & INFLOWS THIS MONTH</span>
          <span style={{fontFamily:FP,fontSize:14,fontWeight:700,color:T.gain,fontVariantNumeric:"tabular-nums"}}>{fmtUSD(incomeTotal)}</span>
        </div>}
      </CollapsibleTile>;
    })()}

    {/* ─── RECURRING SUBSCRIPTIONS ─────────────── */}
    {(()=>{
      // Prefer Plaid's native recurring-transactions data when available.
      // Plaid's API classifies properly (subscriptions vs groceries vs rent),
      // provides a real `is_active` flag, and reports exact frequency.
      // Fall back to the local heuristic only when Plaid hasn't returned yet
      // or when in demo mode.
      const FREQ_LABEL={WEEKLY:"weekly",BIWEEKLY:"biweekly",SEMI_MONTHLY:"biweekly",MONTHLY:"monthly",ANNUALLY:"annual",UNKNOWN:"irregular"};
      const plaidRows=plaidRecurring?.outflow_streams;
      const nowMs=Date.now();
      // Two client-side detectors over raw transactions, both SUPPLEMENTING Plaid
      // (whose ML misses subs with few charges): fixed-price subscriptions, and
      // usage-based metered spend (e.g. Anthropic API) shown as a monthly run-rate.
      const clientSubs=detectFixedPriceSubscriptions(bankTxns,{asOfMs:nowMs});
      const usageSpend=detectUsageBasedSpend(bankTxns,{asOfMs:nowMs});
      let rows;
      let usingPlaid=false;
      const bySort=(a,b)=>{
        if(a.active!==b.active)return a.active?-1:1;
        return b.estMonthly-a.estMonthly;
      };
      // Merge client-detected rows into a base, skipping any merchant already
      // present (fixed-price wins over usage for the same vendor).
      const mergeExtra=(base)=>{
        const seen=new Set(base.map(r=>normalizeMerchant(r.merchant)));
        const extra=[];
        for(const s of [...clientSubs,...usageSpend]){
          const k=normalizeMerchant(s.merchant);
          if(seen.has(k))continue;
          seen.add(k);
          extra.push(s);
        }
        return [...base,...extra];
      };
      if(Array.isArray(plaidRows)&&plaidRows.length>0){
        usingPlaid=true;
        const mapped=plaidRows
          // Keep subscriptions Plaid mis-tags as transfers; drop true money
          // movement + card/loan payments (see isSubscriptionCandidate).
          .filter(s=>isSubscriptionCandidate(s.merchant_name||s.description||"", s.personal_finance_category?.primary||""))
          .map(s=>{
            const avg=Math.abs(Number(s.average_amount?.amount)||0);
            const freq=FREQ_LABEL[s.frequency]||"irregular";
            const estMonthly=freq==="weekly"?avg*4.33:freq==="biweekly"?avg*2:freq==="annual"?avg/12:avg;
            return{
              merchant:s.merchant_name||s.description||"Unknown",
              cadence:freq,
              avgPerCharge:avg,
              estMonthly,
              lastDate:s.last_date||"",
              // Trust Plaid's is_active/status, but also flip to inactive when the
              // last charge is stale for the cadence — Plaid lags ~a cycle before
              // tombstoning a cancelled stream.
              active:s.is_active!==false && s.status!=="TOMBSTONED" && isRecurringActive(s.last_date,freq,nowMs),
              institution:s._institution||null,
              status:s.status||null,
            };
          });
        rows=mergeExtra(mapped).sort(bySort);
      } else {
        // No Plaid data — precise fixed-price + usage detectors; fall back to the
        // broader (noisier) month-based heuristic only if both find nothing.
        const base=mergeExtra([]);
        rows=base.length?base.sort(bySort):recurring;
      }
      if(rows.length===0)return null;
      const active=rows.filter(r=>r.active);
      const inactive=rows.filter(r=>!r.active);
      const totalMonthly=active.reduce((s,r)=>s+r.estMonthly,0);
      return<CollapsibleTile accent={T.gold} title="RECURRING SUBSCRIPTIONS" subtitle={`${active.length} active · ${fmtUSD(totalMonthly)}/mo`} storageKey="fin_subs" right={usingPlaid?<span style={{fontFamily:FM,fontSize:9,color:T.gain,letterSpacing:"0.1em",padding:"1px 6px",border:`1px solid ${T.gain}50`,borderRadius:T.rSm}}>PLAID</span>:null}>
        <div style={{overflow:"hidden",borderRadius:T.rMd,border:`1px solid ${T.border}`}}>
          <Tbl cols={[
            {l:"Merchant",r_:r=><div style={{display:"flex",alignItems:"center",gap:T.s2}}>
              <span style={{fontFamily:FP,fontSize:13,fontWeight:600,color:r.active?T.textHi:T.muted,letterSpacing:"-0.005em"}}>{r.merchant}</span>
              {r.usage&&<span title="Usage-based / metered billing — the monthly figure is a run-rate, not a fixed price" style={{fontFamily:FM,fontSize:9,color:T.violet,letterSpacing:"0.1em",padding:"1px 5px",border:`1px solid ${T.violet}55`,borderRadius:T.rSm,background:`${T.violet}14`}}>USAGE</span>}
              {!r.active&&<span style={{fontFamily:FM,fontSize:9,color:T.muted,letterSpacing:"0.1em",padding:"1px 5px",border:`1px solid ${T.border}`,borderRadius:T.rSm}}>INACTIVE</span>}
            </div>},
            {l:"Cadence",r_:r=><span style={{fontFamily:FM,fontSize:11,color:T.muted,textTransform:"capitalize"}}>{r.cadence}</span>},
            {l:"Per charge",r:true,r_:r=><span style={{fontFamily:FM,fontSize:12,fontWeight:500,color:r.active?T.textHi:T.muted,fontVariantNumeric:"tabular-nums"}}>{r.usage?"avg ":""}{fmtUSD(r.avgPerCharge)}</span>},
            {l:"Est. / mo",r:true,r_:r=><span style={{fontFamily:FP,fontSize:13,fontWeight:600,color:r.active?T.gold:T.muted,fontVariantNumeric:"tabular-nums"}}>{r.usage?"~":""}{fmtUSD(r.estMonthly)}</span>},
            {l:"Last charge",r_:r=><span style={{fontFamily:FM,fontSize:11,color:T.muted}}>{fmtDate(r.lastDate)}</span>},
          ]} rows={[...active,...inactive].slice(0,50)}/>
        </div>
      </CollapsibleTile>;
    })()}

    {/* Empty-state when a bank is connected but transactions haven't landed yet. */}
    {institutions.length>0&&bankTxns.length===0&&!demoMode&&<ComingSoon
      pending
      title="Plaid is pulling your transactions"
      description="Your bank is connected. Plaid's initial pull usually finishes in 30-60 seconds, but some banks take 5-15 minutes for the full history. The Spending and Recurring tiles fill in automatically once the data lands — no need to refresh."
      hint={syncMsg?(syncMsg.ok?`Last sync: ${syncMsg.msg}`:`Last sync: ${syncMsg.msg}`):"We're retrying every few minutes in the background. Click Sync now to force a check."}
      action={{ label: "↻ Sync now", onClick: syncTransactions, busy: syncBusy }}
    />}

    {/* ─── RECENT TRANSACTIONS — search + filter + paged, nickname-aware ─── */}
    {txns.length>0&&(()=>{
      // Chip styling helper — keep visual style consistent with the rest of
      // the Finances tab (Tag-component look but selectable).
      const chip=(label,active,onClick)=>(<button key={label} onClick={onClick} style={{
        padding:`4px ${T.s3}`,borderRadius:999,
        fontFamily:FM,fontSize:10,fontWeight:600,letterSpacing:"0.06em",textTransform:"uppercase",
        color:active?T.textHi:T.muted,
        background:active?`${T.blue}22`:"transparent",
        border:`1px solid ${active?`${T.blue}55`:T.border}`,
        cursor:"pointer",whiteSpace:"nowrap",transition:"all 0.12s",
      }}>{label}</button>);
      const acctLabel=a=>(nicknames?.[a.account_id]||a.name);
      return<BentoTile style={{padding:0,overflow:"hidden"}}>
        <div style={{padding:`${T.s4} ${T.s5}`,borderBottom:`1px solid ${T.border}`,fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600}}>RECENT TRANSACTIONS · {bankTxns.length} entries</div>
        {/* Controls row — search + filters. Wraps responsively. */}
        <div style={{padding:`${T.s3} ${T.s5}`,borderBottom:`1px solid ${T.border}`,display:"flex",flexDirection:"column",gap:T.s3}}>
          <div style={{display:"flex",flexWrap:"wrap",gap:T.s3,alignItems:"center"}}>
            <input
              type="text"
              value={txnSearch}
              onChange={e=>setTxnSearch(e.target.value)}
              placeholder="Search merchant, name, or category…"
              style={{
                flex:"1 1 240px",minWidth:200,
                padding:`8px ${T.s3}`,
                background:T.surface,border:`1px solid ${T.border}`,borderRadius:T.rMd,
                color:T.textHi,fontFamily:FP,fontSize:13,letterSpacing:"-0.005em",
                outline:"none",
              }}
            />
            <select
              value={txnAccount}
              onChange={e=>setTxnAccount(e.target.value)}
              style={{
                padding:`8px ${T.s3}`,
                background:T.surface,border:`1px solid ${T.border}`,borderRadius:T.rMd,
                color:T.text,fontFamily:FP,fontSize:13,letterSpacing:"-0.005em",
                outline:"none",cursor:"pointer",
              }}
            >
              <option value="all">All accounts</option>
              {accounts.map(a=>(<option key={a.account_id} value={a.account_id}>{`${acctLabel(a)} ····${a.mask||""}`}</option>))}
            </select>
          </div>
          <div style={{display:"flex",flexWrap:"wrap",gap:T.s2,alignItems:"center"}}>
            <span style={{fontFamily:FM,fontSize:9,color:T.muted,letterSpacing:"0.14em",textTransform:"uppercase",marginRight:T.s1}}>Type</span>
            {chip("All",     txnType==="all",     ()=>setTxnType("all"))}
            {chip("Outflow", txnType==="outflow", ()=>setTxnType("outflow"))}
            {chip("Inflow",  txnType==="inflow",  ()=>setTxnType("inflow"))}
            {chip("Pending", txnType==="pending", ()=>setTxnType("pending"))}
            <span style={{flex:"0 0 1px",alignSelf:"stretch",background:T.border,margin:`0 ${T.s2}`}}/>
            <span style={{fontFamily:FM,fontSize:9,color:T.muted,letterSpacing:"0.14em",textTransform:"uppercase",marginRight:T.s1}}>Range</span>
            {chip("30d", txnRange==="30d", ()=>setTxnRange("30d"))}
            {chip("90d", txnRange==="90d", ()=>setTxnRange("90d"))}
            {chip("YTD", txnRange==="ytd", ()=>setTxnRange("ytd"))}
            {chip("All", txnRange==="all", ()=>setTxnRange("all"))}
          </div>
        </div>
        <Tbl cols={[
          {l:"Date",r_:r=><span style={{fontFamily:FM,fontSize:11,color:T.muted,fontVariantNumeric:"tabular-nums"}}>{r.date}</span>},
          {l:"Merchant",r_:r=><div>
            <div style={{fontFamily:FP,fontSize:13,color:T.text,letterSpacing:"-0.005em"}}>{r.merchant_name||r.name||"—"}</div>
            {r.pending&&<div style={{fontFamily:FM,fontSize:9,color:T.gold,letterSpacing:"0.06em",marginTop:2}}>● PENDING</div>}
          </div>},
          {l:"Category",r_:r=>{
            const c=r.personal_finance_category?.primary||r.category?.[0]||"";
            return c?<Tag label={c.replace(/_/g," ")} color={T.blue}/>:<span style={{color:T.muted}}>—</span>;
          }},
          {l:"Account",r_:r=>{
            const a=accounts.find(x=>x.account_id===r.account_id);
            // Prefer the user-defined nickname when present so the
            // transactions table reads consistently with the institution
            // cards above. Falls back to the broker default + last-4 mask.
            const nick=nicknames?.[r.account_id];
            const label=nick
              ? (a?.mask?`${nick} ····${a.mask}`:nick)
              : (a?`${a.name} ····${a.mask}`:r.institution_name||"—");
            return<span style={{fontFamily:FM,fontSize:11,color:T.muted}}>{label}</span>;
          }},
          {l:"Amount",r:true,r_:r=>{const out=r.amount>0;return<span style={{fontFamily:FP,fontSize:13,fontWeight:600,color:out?T.loss:T.gain,letterSpacing:"-0.005em",fontVariantNumeric:"tabular-nums"}}>{out?"−":"+"}{fmtUSD(Math.abs(r.amount))}</span>;}},
        ]} rows={visibleTxns}/>
        {/* Footer: counter + Load more. Empty state when filters wipe results. */}
        {filteredTxns.length===0?(
          <div style={{padding:`${T.s5} ${T.s4}`,fontFamily:FM,fontSize:11,color:T.muted,textAlign:"center",borderTop:`1px solid ${T.border}`}}>
            No transactions match the current filters.
          </div>
        ):(
          <div style={{padding:`${T.s3} ${T.s4}`,display:"flex",flexDirection:"column",alignItems:"center",gap:T.s2,borderTop:`1px solid ${T.border}`}}>
            <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.06em",textAlign:"center"}}>
              Showing {visibleTxns.length} of {filteredTxns.length} filtered · {bankTxns.length} total
            </div>
            {filteredTxns.length>visibleTxns.length&&(
              <button onClick={()=>setTxnLimit(n=>n+PAGE_SIZE)} style={{
                padding:`6px ${T.s4}`,borderRadius:T.rMd,
                background:T.surface,border:`1px solid ${T.borderHi}`,
                color:T.textHi,fontFamily:FM,fontSize:11,fontWeight:600,letterSpacing:"0.06em",textTransform:"uppercase",
                cursor:"pointer",transition:"background 0.12s",
              }}>Load more</button>
            )}
          </div>
        )}
      </BentoTile>;
    })()}
  </div>;
}

/* ─── ONBOARDING FLOW ─────────────────────────────── */
// Full-screen 5-step intro shown to first-time users (no broker connections,
// no onboarding-complete flag). Progress persists to localStorage so a refresh
// or tab close doesn't restart from step 1. Final step writes mizan_onboarded=1
// to Supabase user_state which marks the user as fully onboarded.
/* ─── FEATURE TOUR ───────────────────────────────────────
   Optional, user-triggered walkthrough (launched from the "?" in the dock).
   Deliberately NOT a forced linear tour and NOT auto-opened — research is
   decisive that forced tab-by-tab tours get skipped and cause guidance
   fatigue. This is opt-in: a short, skippable carousel where each step can
   jump straight to the relevant tab. Leads with the no-connection hero path
   (screen a stock / calculate Zakat) so value comes before any account link. */
function FeatureTour({open,onClose,onNav}){
  const STEPS=[
    {eyebrow:"START HERE", t:"Welcome to MĪZAN",            d:"A quick lay of the land. Everything here is explorable free — screen any stock for Sharia compliance or calculate your Zakat without connecting a single account.", to:null,        cta:null},
    {eyebrow:"PORTFOLIO",  t:"Holdings & Sharia screening", d:"Live positions, activity, and rebalancing — plus the Screener, which checks any ticker against AAOIFI rules with zero connection required.",               to:"portfolio", cta:"Open Portfolio"},
    {eyebrow:"GOALS & ZAKAT",t:"Zakat, Sadaqah & goals",    d:"Live nisab from real gold and silver prices, dividend purification, and goal templates for Hajj, Mahr, Waqf, and FIRE.",                                  to:"goals",     cta:"Open Goals"},
    {eyebrow:"OVERVIEW",   t:"Your money at a glance",      d:"Once you connect a broker or bank, net worth, performance, allocation, and top holdings all land here in one dashboard.",                              to:"overview",  cta:"Open Overview"},
    {eyebrow:"FINANCES",   t:"Banking & spending",          d:"Link a bank via Plaid to track balances, transactions, budgets, and bills right next to your portfolio.",                                            to:"finances",  cta:"Open Finances"},
    {eyebrow:"AI ADVISOR", t:"Ask anything",                d:"A Sharia-aware advisor that sees your real portfolio context — answers are specific to you.",                                                         to:"advisor",   cta:"Open AI Advisor"},
  ];
  const[i,setI]=useState(0);
  useEffect(()=>{if(open)setI(0);},[open]);
  if(!open)return null;
  const s=STEPS[i];
  const last=i===STEPS.length-1;
  const go=()=>{if(s.to)onNav?.(s.to);onClose?.();};
  return<div onClick={onClose} style={{position:"fixed",inset:0,zIndex:1001,background:"rgba(0,0,0,0.55)",backdropFilter:"blur(20px) saturate(160%)",WebkitBackdropFilter:"blur(20px) saturate(160%)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
    <div onClick={e=>e.stopPropagation()} style={{width:"100%",maxWidth:440,background:"var(--mz-glass-strong)",backdropFilter:"blur(40px) saturate(180%)",WebkitBackdropFilter:"blur(40px) saturate(180%)",border:"1px solid var(--mz-glass-border)",borderRadius:16,boxShadow:"var(--mz-glass-shadow-lg)",padding:`${T.s7} ${T.s6} ${T.s5}`,textAlign:"center",animation:"glassFadeUp 0.22s cubic-bezier(.34,1.56,.64,1)"}}>
      <div style={{fontFamily:FM,fontSize:10,color:T.blue,letterSpacing:"0.2em",fontWeight:600,marginBottom:T.s3}}>{s.eyebrow}</div>
      <div style={{fontFamily:FU,fontSize:24,fontWeight:700,color:T.textHi,letterSpacing:"-0.02em",marginBottom:T.s2}}>{s.t}</div>
      <div style={{fontFamily:FP,fontSize:14,color:T.muted,lineHeight:1.6,maxWidth:380,margin:`0 auto ${T.s5}`}}>{s.d}</div>
      <div style={{display:"flex",gap:6,justifyContent:"center",marginBottom:T.s5}}>
        {STEPS.map((_,k)=><span key={k} style={{width:k===i?18:6,height:6,borderRadius:999,background:k===i?T.blue:T.border,transition:"all 0.2s"}}/>)}
      </div>
      <div style={{display:"flex",gap:T.s2,justifyContent:"center",flexWrap:"wrap"}}>
        {s.cta&&<button onClick={go} className="btn-primary" style={{fontSize:13,padding:`10px ${T.s5}`}}>{s.cta} →</button>}
        {last
          ?<button onClick={onClose} className="btn-ghost" style={{fontSize:13,padding:`9px ${T.s5}`}}>Done</button>
          :<button onClick={()=>setI(i+1)} className="btn-ghost" style={{fontSize:13,padding:`9px ${T.s5}`}}>Next →</button>}
      </div>
      <button onClick={onClose} style={{marginTop:T.s4,background:"none",border:"none",color:T.muted,fontFamily:FM,fontSize:11,letterSpacing:"0.04em",cursor:"pointer"}}>Skip tour</button>
    </div>
  </div>;
}

function OnboardingFlow({onConnect,onImportCSV,onComplete,snapAccountsLen,onNav,resolvedTheme}){
  const STORAGE_KEY="mizan_onboarding_step";
  const[step,setStepRaw]=useState(()=>{try{const v=+localStorage.getItem(STORAGE_KEY);return Number.isFinite(v)&&v>=0&&v<2?v:0;}catch{return 0;}});
  const[dir,setDir]=useState(0); // -1 prev, +1 next; drives slide direction
  const[mounted,setMounted]=useState(false);
  const setStep=n=>{
    setDir(n>step?1:-1);
    setStepRaw(n);
    try{localStorage.setItem(STORAGE_KEY,String(n));}catch{}
  };
  useEffect(()=>{setMounted(true);},[]);

  const finish=async()=>{
    try{localStorage.setItem("mizan_onboarded","1");}catch{}
    try{localStorage.removeItem(STORAGE_KEY);}catch{}
    await persistUserState("mizan_onboarded","1");
    onComplete?.();
  };

  // ───── STEP 1 — Welcome ──────────
  const StepWelcome=<>
    <div style={{display:"inline-flex",alignItems:"center",justifyContent:"center",gap:T.s3,marginBottom:T.s5}}>
      <img src={resolvedTheme==="dark"?"/mark-light.png":"/mark.png"} alt="" width={56} height={56} style={{display:"block"}}/>
      <span style={{fontFamily:FU,fontSize:38,fontWeight:700,color:T.textHi,letterSpacing:"-0.02em"}}>MĪZAN</span>
    </div>
    <div style={{fontFamily:FU,fontSize:30,fontWeight:700,color:T.textHi,letterSpacing:"-0.025em",lineHeight:1.15,maxWidth:560,margin:`0 auto ${T.s3}`}}>Your Halal Financial Terminal</div>
    <div style={{fontFamily:FU,fontSize:15,color:T.muted,lineHeight:1.6,maxWidth:560,margin:`0 auto ${T.s6}`,letterSpacing:"-0.005em"}}>
      Brokerages, banking, and Zakat — unified and Sharia-screened, in one place.
    </div>
    <div style={{display:"flex",flexDirection:"column",gap:T.s2,maxWidth:480,margin:"0 auto",textAlign:"left"}}>
      {[
        {accent:T.blue,t:"Real portfolio",d:"Live balances + positions from every connected broker (Fidelity, Robinhood, Schwab, Coinbase, and 60+ more)."},
        {accent:T.gold,t:"Sharia-screened",d:"Every position screened against AAOIFI + 6 other frameworks. Automatic Zakat + purification math."},
        {accent:T.gain,t:"Banking & spending",d:"Link your bank via Plaid to see balances, transactions, budgets, and bills right next to your portfolio — one complete picture."},
      ].map(b=><div key={b.t} style={{padding:`${T.s3} ${T.s4}`,background:T.surface,border:`1px solid ${T.border}`,borderLeft:`3px solid ${b.accent}`,borderRadius:T.rMd}}>
        <div style={{fontFamily:FP,fontSize:14,fontWeight:600,color:T.textHi,letterSpacing:"-0.01em",marginBottom:T.s1}}>{b.t}</div>
        <div style={{fontFamily:FP,fontSize:13,color:T.muted,lineHeight:1.55,letterSpacing:"-0.005em"}}>{b.d}</div>
      </div>)}
    </div>
  </>;

  // ───── Import CSV (defined but unused — see note below) ──────────
  const csvRef=useRef(null);
  const[csvBroker,setCsvBroker]=useState("Fidelity");
  const[csvStatus,setCsvStatus]=useState(null);
  const handleCsv=async file=>{
    if(!file||!onImportCSV)return;
    try{
      const r=await onImportCSV(file,csvBroker);
      const msg=typeof r==="number"?`Imported ${r} rows.`:r?.added>0?`Imported ${r.added} new rows${r.skipped?` (${r.skipped} duplicates)`:""}.`:r?.skipped?`All ${r.skipped} rows were duplicates.`:"No rows parsed.";
      setCsvStatus({ok:true,msg});
    }catch(err){setCsvStatus({ok:false,msg:err.message||"Import failed"});}
  };
  const StepImport=<>
    <div style={{fontFamily:FU,fontSize:28,fontWeight:700,color:T.textHi,letterSpacing:"-0.025em",lineHeight:1.2,marginBottom:T.s2}}>Bring in your past activity</div>
    <div style={{fontFamily:FP,fontSize:14,color:T.muted,lineHeight:1.55,maxWidth:520,margin:`0 auto ${T.s5}`}}>
      SnapTrade only backfills 1–2 years. Drop a Fidelity / Robinhood / Coinbase CSV here for your complete history. Drag in or click to choose.
    </div>
    <input ref={csvRef} type="file" accept=".csv,text/csv" onChange={e=>handleCsv(e.target.files?.[0])} style={{display:"none"}}/>
    <div
      onClick={()=>csvRef.current?.click()}
      onDragOver={e=>{e.preventDefault();}}
      onDrop={e=>{e.preventDefault();handleCsv(e.dataTransfer.files?.[0]);}}
      style={{
        maxWidth:520,margin:`0 auto ${T.s4}`,
        padding:`${T.s8} ${T.s5}`,
        border:`2px dashed ${T.borderHi}`,
        borderRadius:T.rLg,
        background:T.surface,
        cursor:"pointer",
        transition:"border-color 0.15s, background 0.15s",
      }}
      onMouseEnter={e=>{e.currentTarget.style.borderColor=T.blue;e.currentTarget.style.background=`${T.blue}10`;}}
      onMouseLeave={e=>{e.currentTarget.style.borderColor=T.borderHi;e.currentTarget.style.background=T.surface;}}>
      <div style={{fontFamily:FU,fontSize:16,fontWeight:600,color:T.textHi,letterSpacing:"-0.01em",marginBottom:T.s1}}>Drop a CSV here</div>
      <div style={{fontFamily:FM,fontSize:11,color:T.muted,letterSpacing:"0.04em"}}>or click to browse</div>
    </div>
    <div style={{display:"flex",gap:T.s2,justifyContent:"center",marginBottom:T.s3}}>
      <select value={csvBroker} onChange={e=>setCsvBroker(e.target.value)} className="field" style={{width:"auto",fontSize:12,cursor:"pointer"}}>
        <option>Fidelity</option><option>Robinhood</option><option>Coinbase</option>
        <option>Schwab</option><option>Vanguard</option><option>Other</option>
      </select>
      <span style={{fontFamily:FM,fontSize:10,color:T.muted,alignSelf:"center"}}>auto-detected if your CSV is recognizable</span>
    </div>
    {csvStatus&&<div style={{maxWidth:520,margin:"0 auto",padding:`${T.s2} ${T.s3}`,borderRadius:T.rMd,fontFamily:FM,fontSize:12,background:csvStatus.ok?T.gainBg:T.lossBg,border:`1px solid ${(csvStatus.ok?T.gain:T.loss)+"30"}`,color:csvStatus.ok?T.gain:T.loss}}>{csvStatus.ok?ICON_OK:ICON_NO}{csvStatus.msg}</div>}
  </>;

  // ───── Final step — Tour complete ──────────
  const navItems=[
    {n:"Overview",   d:"Net worth, performance, allocation, top holdings — all in one bento."},
    {n:"Finances",   d:"Bank balances, transactions, spending by category, recurring (Plaid)."},
    {n:"Portfolio",  d:"Holdings, activity, tax planning, backtest, rebalance, Sharia screener."},
    {n:"Goals",      d:"Savings goals, Zakat & Sadaqah ledger, retirement (FIRE) projection."},
    {n:"AI Advisor", d:"Sharia-aware chat with your full portfolio context — ask anything."},
    {n:"Settings",   d:"Brokers, 2FA, manual assets, documents, demo mode."},
  ];
  const StepDone=<>
    <div style={{fontFamily:FU,fontSize:28,fontWeight:700,color:T.textHi,letterSpacing:"-0.025em",lineHeight:1.2,marginBottom:T.s2}}>You're set</div>
    <div style={{fontFamily:FP,fontSize:14,color:T.muted,lineHeight:1.55,maxWidth:520,margin:`0 auto ${T.s5}`}}>
      Six tabs. Everything connects. Here's the lay of the land:
    </div>
    <div style={{maxWidth:600,margin:"0 auto",display:"flex",flexDirection:"column",gap:T.s2,textAlign:"left"}}>
      {navItems.map((it,i)=><div key={it.n} style={{
        display:"grid",gridTemplateColumns:"auto 130px 1fr",gap:T.s3,alignItems:"baseline",
        padding:`${T.s2} ${T.s3}`,
        background:T.surface,
        border:`1px solid ${T.border}`,
        borderRadius:T.rMd,
      }}>
        <span style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.14em",fontWeight:600,fontVariantNumeric:"tabular-nums"}}>{String(i+1).padStart(2,"0")}</span>
        <span style={{fontFamily:FP,fontSize:13,fontWeight:600,color:T.textHi,letterSpacing:"-0.005em"}}>{it.n}</span>
        <span style={{fontFamily:FP,fontSize:13,color:T.muted,lineHeight:1.5,letterSpacing:"-0.005em"}}>{it.d}</span>
      </div>)}
    </div>
    <div style={{fontFamily:FM,fontSize:10,color:T.dim,lineHeight:1.5,letterSpacing:"0.02em",maxWidth:520,margin:`${T.s5} auto 0`}}>
      MĪZAN provides Sharia screening, Zakat, and educational tools — not investment advice, and not a registered investment adviser. Compliance verdicts and Zakat figures are estimates; confirm important decisions with a qualified scholar and a licensed professional.
    </div>
  </>;

  // CSV/document import is intentionally NOT part of onboarding — new users
  // shouldn't be asked to upload anything before they ever see the app. It still
  // lives in Settings for anyone who wants to backfill history. (StepImport is
  // left defined but unused.)
  const steps=[StepWelcome,StepDone];
  const LAST=steps.length-1;
  const ctaLabel=step===0?"Let's get started →":step===LAST?"Open MĪZAN →":"Continue →";
  const onCta=()=>{if(step===LAST)return finish();setStep(step+1);};
  const onSkip=()=>{if(step===LAST)return finish();setStep(step+1);};
  const canSkip=step!==0&&step!==LAST;

  return<div style={{
    position:"fixed",inset:0,zIndex:1000,
    background:"rgba(0,0,0,0.65)",
    backdropFilter:"blur(28px) saturate(160%)",
    WebkitBackdropFilter:"blur(28px) saturate(160%)",
    display:"flex",alignItems:"center",justifyContent:"center",
    padding:T.s5,
    opacity:mounted?1:0,
    transition:"opacity 0.25s",
  }}>
    <div style={{
      width:"100%",maxWidth:720,
      background:`radial-gradient(circle at 0% 0%, ${T.blue}12, transparent 55%), radial-gradient(circle at 100% 100%, ${T.gold}08, transparent 50%), var(--mz-glass-strong)`,
      backdropFilter:"blur(40px) saturate(180%)",
      WebkitBackdropFilter:"blur(40px) saturate(180%)",
      border:"1px solid var(--mz-glass-border)",
      borderRadius:T.rLg,
      boxShadow:"var(--mz-glass-shadow-lg)",
      padding:`${T.s8} ${T.s8} ${T.s6}`,
      position:"relative",
      overflow:"hidden",
      animation:"glassFadeUp 0.28s cubic-bezier(.34,1.56,.64,1)",
    }}>
      {/* Progress dots */}
      <div style={{display:"flex",justifyContent:"center",gap:T.s2,marginBottom:T.s6}}>
        {steps.map((_,i)=><button
          key={i}
          onClick={()=>i<step?setStep(i):null}
          disabled={i>step}
          aria-label={`Step ${i+1}`}
          style={{
            width:i===step?28:8,
            height:8,
            borderRadius:999,
            background:i<=step?T.blue:T.dim,
            border:"none",
            padding:0,
            cursor:i<step?"pointer":"default",
            transition:"width 0.25s, background 0.25s",
            opacity:i===step?1:i<step?0.55:0.3,
          }}/>)}
      </div>

      {/* Step content — keyed for slide animation */}
      <div style={{
        textAlign:"center",
        minHeight:380,
        animation:dir!==0?`onbSlide${dir>0?"R":"L"} 0.32s cubic-bezier(.34,1.56,.64,1)`:"none",
      }} key={step}>
        {steps[step]}
      </div>

      {/* Footer: prev / skip / cta */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:T.s6,gap:T.s3,flexWrap:"wrap"}}>
        <button
          onClick={()=>step>0?setStep(step-1):null}
          disabled={step===0}
          className="btn-ghost"
          style={{opacity:step===0?0.4:1,cursor:step===0?"not-allowed":"pointer"}}
        >← Back</button>
        <div style={{display:"flex",gap:T.s2,alignItems:"center"}}>
          {canSkip&&<button onClick={onSkip} className="btn-ghost" style={{fontSize:11,padding:`6px ${T.s3}`}}>Skip</button>}
          <button onClick={onCta} className="btn-primary" style={{fontSize:13,padding:`10px ${T.s5}`}}>{ctaLabel}</button>
        </div>
      </div>

      {/* Inline slide keyframes — local so we don't pollute the global block */}
      <style>{`
        @keyframes onbSlideR { from { opacity:0; transform: translateX(40px); } to { opacity:1; transform:none; } }
        @keyframes onbSlideL { from { opacity:0; transform: translateX(-40px); } to { opacity:1; transform:none; } }
      `}</style>
    </div>
  </div>;
}

/* ─── KEYBOARD SHORTCUTS ──────────────────────────────────
   Defined as a tiny child component (rather than inline in Mizan) so the
   useKeyboard hook only re-binds when the wrapped handlers actually
   change. Mizan re-renders on every nav switch, but the handler
   references are stable callbacks — passing them as props lets React
   bail out cheaply. */
const SHORTCUT_REFERENCE = {
  "g o": "Go to Overview",
  "g p": "Go to Portfolio",
  "g f": "Go to Finances",
  "g t": "Go to Trade",
  "g a": "Go to AI Advisor",
  "g s": "Go to Settings",
  "r":   "Sync All",
  "/":   "Open command palette",
  "?":   "Show this help",
  "Esc": "Close any open modal",
};

function KeyboardShortcuts({ onNav, onSync, onConnect, onHelp, onCommand, isAdmin = false }) {
  useKeyboard({
    shortcuts: {
      "g o": "overview",
      "g p": "portfolio",
      "g f": "finances",
      "g g": "goals",
      ...(isAdmin ? { "g t": "trade" } : {}),
      "g a": "advisor",
      "g s": "settings",
      "r": "sync",
      "?": "help",
      "/": "command",
    },
    onShortcut: (name) => {
      const NAV_TARGETS = new Set(["overview","portfolio","finances","goals","advisor","settings","trade"]);
      if (NAV_TARGETS.has(name)) { onNav(name); return; }
      if (name === "sync")    { onSync?.(); return; }
      if (name === "help")    { onHelp?.(); return; }
      if (name === "command") { onCommand?.(); return; }
    },
  });
  return null;
}

export default function Mizan(){
  // Scope cross-tab broadcasts to the authenticated user so a separate tab
  // signed in as a different user can't receive (or send) state intended
  // for this one. Falls back to "anon" in single-user pass-through mode.
  const{user:authUser}=useAuth();
  const bcastChannelName="mizan:"+(authUser?.id||"anon");
  // Onboarding: show the 5-step intro modal for fresh users. Suppress in
  // single-user pass-through mode (no real auth, demo only) and once the
  // mizan_onboarded flag has been set (persists via TRACKED_KEYS).
  const[onboardingDismissed,setOnboardingDismissed]=useState(()=>{
    try{return localStorage.getItem("mizan_onboarded")==="1";}catch{return true;}
  });
  // Manual-replay path lets a user with brokers already connected re-run
  // the tour. The default auto-show only fires when snapAccounts is empty;
  // force=true bypasses that so Settings can trigger it any time.
  const[onboardingForce,setOnboardingForce]=useState(false);
  const[isAdmin,setIsAdmin]=useState(false);
  const[featuresLoaded,setFeaturesLoaded]=useState(false);
  const[fullAutoEnabled,setFullAutoEnabled]=useState(false);
  const[botIsRoot,setBotIsRoot]=useState(false);       // owner — full-auto + no consent gate
  const[botConsented,setBotConsented]=useState(false); // beta user accepted the disclosure
  const replayOnboarding=useCallback(()=>{
    if(!window.confirm("Re-run the 5-step welcome tour?"))return;
    try{
      localStorage.removeItem("mizan_onboarded");
      localStorage.removeItem("mizan_onboarding_step");
    }catch{}
    // Best effort: tell Supabase we're not onboarded. "0" is falsy
    // against the `=== "1"` trigger check, so hydrating on another
    // device will also re-show the modal.
    persistUserState("mizan_onboarded","0");
    setOnboardingDismissed(false);
    setOnboardingForce(true);
    setNav("overview");
  },[]); // eslint-disable-line react-hooks/exhaustive-deps
  // Persist active tab per-device so a reload lands you where you left off.
  // Per-device, not per-user — different devices may want different defaults.
  const[nav,setNavState]=useState(()=>{
    // OAuth resume from Plaid: bank redirected the user back to
    // /oauth-redirect (or any URL with ?oauth_state_id=…). Force the
    // Finances tab so its onMount effect can resume Plaid Link instead
    // of restoring whichever tab the user was last on.
    try{
      if(typeof window!=="undefined"){
        const p=window.location.pathname;
        const q=window.location.search||"";
        if(p==="/oauth-redirect"||/[?&]oauth_state_id=/.test(q))return"finances";
      }
    }catch{}
    try{
      const v=localStorage.getItem("mizan_nav");
      // Guard against a stale value that no longer maps to a real tab.
      // After the consolidation, "trade" + "about" map to other tabs:
      // "trade" → "portfolio" (Backtest lives there now); "about" → "settings"
      // (under the About sub-tab). Keeps stale localStorage from crashing.
      // "trade" restores only for admins — the guard effect below bounces any
      // non-admin off it once features load (legit non-admins never store it).
      const valid=new Set(["overview","finances","portfolio","goals","advisor","settings","trade"]);
      if (v && valid.has(v)) return v;
      if (v === "about") return "settings";
      return "overview";
    }catch{return"overview";}
  });
  // Non-root users can never navigate to Trade. Every entry point (nav bar,
  // command palette, keyboard, deep link) funnels through setNav, so this one
  // guard hides the whole surface. The server also 403s /api/bot/* for them.
  const setNav=v=>{const t=(v==="trade"&&!isAdmin)?"overview":v;setNavState(t);try{localStorage.setItem("mizan_nav",t);}catch{}};

  // Command palette state (Cmd+K). The hook listens for the global
  // keystroke and toggles open. Commands are built below from setNav
  // + sync + setConn + toggleDemo, so they always reflect the latest
  // closure of those handlers.
  const palette=useCommandPalette();
  const[shortcutHelpOpen,setShortcutHelpOpen]=useState(false);
  const[tourOpen,setTourOpen]=useState(false);

  // ── PWA install prompt ──────────────────────────────────────────────────
  // Capture beforeinstallprompt so we can show a button instead of relying
  // on the browser's ambient mini-infobar. iOS Safari never fires this event;
  // those users see the iosHint banner instead.
  const[installEvt,setInstallEvt]=useState(null);
  const[isInstalled,setIsInstalled]=useState(()=>{try{return window.matchMedia('(display-mode: standalone)').matches||!!navigator.standalone;}catch{return false;}});
  const[iosHintDismissed,setIosHintDismissed]=useState(()=>{try{return localStorage.getItem("mizan_ios_hint")==="1";}catch{return true;}});
  const isIosSafari=typeof navigator!=="undefined"&&/iP(hone|ad|od)/.test(navigator.userAgent)&&/Safari/.test(navigator.userAgent)&&!/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);
  useEffect(()=>{
    const h=(e)=>{e.preventDefault();setInstallEvt(e);};
    window.addEventListener('beforeinstallprompt',h);
    const mq=window.matchMedia('(display-mode: standalone)');
    const onMQ=(e)=>{if(e.matches){setIsInstalled(true);setInstallEvt(null);}};
    mq.addEventListener('change',onMQ);
    return()=>{window.removeEventListener('beforeinstallprompt',h);mq.removeEventListener('change',onMQ);};
  },[]);
  const doInstall=async()=>{if(!installEvt)return;installEvt.prompt();const{outcome}=await installEvt.userChoice;if(outcome==='accepted'){setIsInstalled(true);setInstallEvt(null);}};
  const dismissIosHint=()=>{setIosHintDismissed(true);try{localStorage.setItem("mizan_ios_hint","1");}catch{}};
  // ── Pull-to-refresh ──────────────────────────────────────────────────────
  const[ptrActive,setPtrActive]=useState(false);
  const[ptrReady,setPtrReady]=useState(false);
  const syncRef=useRef(null);
  const[live,setLive]=useState(()=>{try{return JSON.parse(localStorage.getItem("mizan_live_cache")||"[]");}catch{return[];}});
  // Plaid net cash position (depository minus credit/loan), seeded from
  // localStorage so the Overview hero can include it on first paint
  // without waiting for the Finances tab to mount.
  const[bankBalance,setBankBalance]=useState(()=>{try{const v=localStorage.getItem("mizan_bank_balance");return v?+v:0;}catch{return 0;}});
  // Guard on the raw demo flag (not the `demoMode` state var, which is declared
  // just below — referencing it here would TDZ-crash). Prevents the demo bank
  // total from persisting into a real session's cached balance.
  useEffect(()=>{try{if(localStorage.getItem("mizan_demo")==="1")return;localStorage.setItem("mizan_bank_balance",String(bankBalance||0));}catch{}},[bankBalance]);
  // Demo mode — declared up here (before the Plaid + pending-signals effects)
  // because those effects list `demoMode` in their dependency arrays, which are
  // evaluated during render. Declaring it later caused a TDZ ("Cannot access
  // before initialization") that crashed the whole app once a fresh bundle
  // loaded. Default OFF: a new user with no connections sees their real ($0)
  // state, not the demo persona; demo is opt-in via the DEMO toggle (mizan_demo=1).
  const[demoMode,setDemoMode]=useState(()=>{
    try{return localStorage.getItem("mizan_demo")==="1";}catch{return false;}
  });
  // Unified Plaid accounts state — every type (depository / credit / loan /
  // investment / brokerage / other) is held here, so the Overview, Finances,
  // and Portfolio tabs can all consume the same source of truth. The numeric
  // `bankBalance` is derived from it (depository as +, credit/loan as −) and
  // exists separately so consumers that only need the net number don't have
  // to re-walk the list. Hydrated from localStorage on first paint, then
  // refreshed every 90s on the app-wide auto-sync cadence.
  const[plaidAccounts,setPlaidAccounts]=useState(()=>{try{return JSON.parse(localStorage.getItem("mizan_plaid_accounts")||"[]");}catch{return[];}});
  useEffect(()=>{if(demoMode)return;try{localStorage.setItem("mizan_plaid_accounts",JSON.stringify(plaidAccounts));}catch{}},[plaidAccounts,demoMode]);
  useEffect(()=>{
    let cancel=false;
    // Demo mode: feed the local bank fixtures into the SHARED plaidAccounts +
    // bankBalance so Overview's Cash on Hand and net worth match the Finances
    // tab (which also renders DEMO_BANK_ACCOUNTS). No real Plaid call in demo.
    if(demoMode){
      setPlaidAccounts(DEMO_BANK_ACCOUNTS);
      setBankBalance(DEMO_BANK_ACCOUNTS.reduce((s,a)=>{const v=+a.current_bal||0;return isBankDebt(a)?s-v:isBankAsset(a)?s+v:s;},0));
      return;
    }
    const pull=async()=>{
      try{
        const r=await apiFetch("/api/plaid/accounts");
        if(!r.ok||cancel)return;
        const d=await r.json();
        const accts=Array.isArray(d.accounts)?d.accounts:[];
        if(cancel)return;
        setPlaidAccounts(accts);
        // bankBalance = depository − (credit + loan). Investment-type
        // balances do not contribute here — they appear under the
        // brokerage/investment bucket below, so they aren't double-counted
        // against a SnapTrade-linked broker.
        const total=accts.reduce((s,a)=>{
          const v=+a.current_bal||0;
          if(isBankDebt(a))return s-v;
          if(isBankAsset(a))return s+v;
          return s;
        },0);
        if(!cancel)setBankBalance(total);
      }catch{/* ignore */}
    };
    pull();
    const tick=setInterval(pull,90*1000);
    return()=>{cancel=true;clearInterval(tick);};
  },[demoMode]);

  // ── Pending bot signals (Overview banner) ─────────────
  // Count signals awaiting approval so the Overview can surface a banner —
  // the user doesn't have to sit on the Trade tab to catch them. Trading
  // users only (isAdmin), never in demo. Polls on the 90s cadence.
  const[pendingSignals,setPendingSignals]=useState(0);
  // Executed bot fills, surfaced in the Activity tab BEFORE SnapTrade's broker
  // feed syncs (display-only; never merged into snapActivities so net-worth/flow
  // calcs stay broker-sourced). Same 90s cadence + bot-user/demo gating.
  const[botFills,setBotFills]=useState([]);
  useEffect(()=>{
    if(!isAdmin||demoMode){setPendingSignals(0);setBotFills([]);return;}
    let cancel=false;
    const pull=async()=>{try{
      const[rs,ra]=await Promise.all([apiFetch("/api/bot/signals"),apiFetch("/api/bot/activity")]);
      if(cancel)return;
      if(rs.ok){const d=await rs.json();setPendingSignals((d.signals||[]).filter(s=>s.status==="pending").length);}
      if(ra.ok){const d=await ra.json();setBotFills((d.items||[]).filter(s=>s.status==="executed"&&s.executed_at).map(s=>{
        const sell=(s.side||"").toUpperCase()==="SELL";const q=Number(s.qty)||0,px=Number(s.suggested_price)||0;
        return{_bot:true,id:"bot-"+s.id,type:sell?"SELL":"BUY",symbol:s.ticker,units:q,price:px,amount:(sell?1:-1)*q*px,trade_date:String(s.executed_at).slice(0,10)};
      }));}
    }catch{}};
    pull();
    const t=setInterval(pull,90*1000);
    return()=>{cancel=true;clearInterval(t);};
  },[isAdmin,demoMode]);

  // ── Account nicknames ─────────────────────────────────
  // Per-user, per-account-id display overrides. Hydrated from
  // localStorage for an instant first paint, then refreshed from
  // /api/account-nicknames once the session is ready. `onSetNickname`
  // commits via PUT (empty/null removes the row) and updates the
  // in-memory map optimistically; consumers re-render through props.
  const[nicknames,setNicknames]=useState(()=>{try{return JSON.parse(localStorage.getItem("mizan_account_nicknames")||"{}");}catch{return{};}});
  useEffect(()=>{try{localStorage.setItem("mizan_account_nicknames",JSON.stringify(nicknames));}catch{}},[nicknames]);
  useEffect(()=>{
    let cancel=false;
    (async()=>{
      try{
        const r=await apiFetch("/api/account-nicknames");
        if(!r.ok||cancel)return;
        const d=await r.json();
        if(!cancel&&d&&typeof d.nicknames==="object"&&d.nicknames)setNicknames(d.nicknames);
      }catch{/* offline / unauthenticated — keep cached map */}
    })();
    return()=>{cancel=true;};
  },[]);
  const onSetNickname=useCallback(async(accountId,nickname)=>{
    if(!accountId)return;
    const trimmed=(typeof nickname==="string"?nickname:"").trim();
    // Optimistic update — UI reflects the rename immediately, even on
    // slow networks. Server failure rolls back via the catch below.
    const prev=nicknames;
    setNicknames(curr=>{
      const next={...curr};
      if(!trimmed)delete next[accountId]; else next[accountId]=trimmed;
      return next;
    });
    try{
      const r=await apiFetch("/api/account-nicknames",{
        method:"PUT",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({account_id:accountId,nickname:trimmed||null}),
      });
      if(!r.ok)throw new Error(`PUT /api/account-nicknames ${r.status}`);
    }catch{
      // Rollback to whatever the server-confirmed state was.
      setNicknames(prev);
    }
  },[nicknames]);

  const[fetching,setFetch]=useState(false);
  const[lastSync,setSync]=useState(null);
  const[showConn,setConn]=useState(false);
  // Brokerage connect scope: "read" (default, everywhere) vs "trade" (live
  // trading opt-in, gated to trading-bot users). Reset to "read" on close so
  // the next default connect is never accidentally trade-enabled.
  const[connMode,setConnMode]=useState("read");
  // Hydrate from cache so refresh / new tab loads instantly with last-known state.
  const[snapAccounts,setSnapAccounts]=useState(()=>{try{return JSON.parse(localStorage.getItem("mizan_accounts_cache")||"[]");}catch{return[];}});
  const[snapActivities,setSnapActivities]=useState(()=>{try{return JSON.parse(localStorage.getItem("mizan_activities_cache")||"[]");}catch{return[];}});
  const[snapDocuments,setSnapDocuments]=useState(()=>{try{return JSON.parse(localStorage.getItem("mizan_documents_cache")||"[]");}catch{return[];}});
  const[hasRealData,setHasRealData]=useState(()=>{try{return localStorage.getItem("mizan_has_real_data")==="1";}catch{return false;}});
  const[disabledAccts,setDisabledAccts]=useState(()=>{try{return new Set(JSON.parse(localStorage.getItem("mizan_disabled_accts")||"[]"));}catch{return new Set();}});
  // Auto-sync defaults ON now (every 90 s) so figures match the user's
  // brokerage accounts in close to real time. Toggle off in the status bar
  // if Finnhub/SnapTrade quotas become a concern.
  const[auto,setAuto2]=useState(()=>{try{const v=localStorage.getItem("mizan_auto");return v===null?true:v==="1";}catch{return true;}});
  const autoRef=useRef(null);
  const bcastRef=useRef(null);

  // Cross-tab sync via BroadcastChannel — when one tab refreshes data, others
  // pick up the new state without re-fetching themselves.
  useEffect(()=>{
    try{
      const bc=new BroadcastChannel(bcastChannelName);
      bcastRef.current=bc;
      bc.onmessage=e=>{
        const m=e.data||{};
        if(m.type==="accounts")setSnapAccounts(m.payload);
        if(m.type==="activities")setSnapActivities(m.payload);
        if(m.type==="live")setLive(m.payload);
      };
      return()=>bc.close();
    }catch{/* old browsers — non-fatal */}
  },[bcastChannelName]);
  const broadcast=(type,payload)=>{try{bcastRef.current?.postMessage({type,payload});}catch{}};

  // Wrap the auto setter so we can persist toggle state to localStorage.
  const setAuto=v=>{
    const next=typeof v==="function"?v(auto):v;
    setAuto2(next);
    try{localStorage.setItem("mizan_auto",next?"1":"0");}catch{}
  };

  const toggleAcctEnabled=(id)=>{
    setDisabledAccts(prev=>{
      const next=new Set(prev);
      next.has(id)?next.delete(id):next.add(id);
      try{localStorage.setItem("mizan_disabled_accts",JSON.stringify([...next]));}catch{}persistUserState("mizan_disabled_accts",[...next]);
      return next;
    });
  };

  // Accounts the rest of the app sees — disabled ones are filtered out completely.
  // Memoized so the reference is stable across the frequent live-price re-renders.
  // Unmemoized, these were a NEW array/Set every render, which made the net-worth
  // snapshot effect below (and children keyed on snapAccounts, e.g. Goals) re-fire
  // every render — spamming localStorage + Supabase writes and, in Goals, a fetch loop.
  const visibleAccounts=useMemo(()=>snapAccounts.filter(a=>!disabledAccts.has(a.accountId)),[snapAccounts,disabledAccts]);
  const visibleAccountIds=useMemo(()=>new Set(visibleAccounts.map(a=>a.accountId)),[visibleAccounts]);

  // Net-worth history lives in state (seeded from localStorage) instead of being
  // JSON.parsed inline on every render at each consumer — the snapshot effect
  // below keeps it fresh. A stable reference means the Overview chart / perf memos
  // stop recomputing over 10y of history on every live-price tick.
  const [netWorthHistory,setNetWorthHistory]=useState(()=>{try{return JSON.parse(localStorage.getItem("mizan_networth_history")||"[]");}catch{return[];}});

  // Daily net-worth snapshots. Each successful sync writes one entry per day
  // (overwrites same-day so live ticks don't bloat history).
  useEffect(()=>{
    if(demoMode)return; // never persist the demo persona into a real user's net-worth history (local + Supabase)
    if(!visibleAccounts.length)return;
    const balanceSum=visibleAccounts.reduce((s,a)=>s+(a.balance||0),0);
    if(balanceSum<=0)return;
    try{
      const today=new Date().toISOString().slice(0,10);
      const hist=JSON.parse(localStorage.getItem("mizan_networth_history")||"[]");
      const cashSum=visibleAccounts.reduce((s,a)=>s+(a.cash||0),0);
      const next={date:today,total:+balanceSum.toFixed(2),cash:+cashSum.toFixed(2),accounts:visibleAccounts.length};
      const without=hist.filter(h=>h.date!==today);
      const updated=[...without,next].sort((a,b)=>a.date.localeCompare(b.date));
      const trimmed=updated.slice(-3650);
      localStorage.setItem("mizan_networth_history",JSON.stringify(trimmed)); // 10 years cap
      persistUserState("mizan_networth_history",trimmed);
      setNetWorthHistory(trimmed);
    }catch{}
  },[visibleAccounts,demoMode]);

  // Activity-derived metrics. All amounts respect the account on/off toggles.
  const performanceMetrics=useMemo(()=>{
    const visibleActs=snapActivities.filter(a=>!a.account?.id||visibleAccountIds.has(a.account.id));
    const ytdStart=new Date();ytdStart.setMonth(0,1);ytdStart.setHours(0,0,0,0);
    const ytdISO=ytdStart.toISOString().slice(0,10);
    const sumByType=(rows,type,sinceISO)=>rows
      .filter(r=>(r.type||"").toUpperCase()===type&&(!sinceISO||(r.trade_date||r.settlement_date||"")>=sinceISO))
      .reduce((s,r)=>s+(+r.amount||0),0);
    return{
      ytdContrib:    sumByType(visibleActs,"DEPOSIT",ytdISO),
      allTimeContrib:sumByType(visibleActs,"DEPOSIT",null),
      ytdDividends:  sumByType(visibleActs,"DIVIDEND",ytdISO),
      allTimeDividends:sumByType(visibleActs,"DIVIDEND",null),
      ytdFees:       Math.abs(sumByType(visibleActs,"FEE",ytdISO)),
      allTimeFees:   Math.abs(sumByType(visibleActs,"FEE",null)),
      ytdWithdrawals:Math.abs(sumByType(visibleActs,"WITHDRAWAL",ytdISO)),
      allTimeWithdrawals:Math.abs(sumByType(visibleActs,"WITHDRAWAL",null)),
      activityCount: visibleActs.length,
    };
  },[snapActivities,disabledAccts.size]);

  // Live Sharia screen verdicts (ticker → {status,...}) from the server screening
  // service (/api/screen — Finnhub now, Zoya when keyed). This is the SINGLE
  // source of truth for h.sh_: Overview compliance, Portfolio filter, the
  // Rebalancer's halal mode, and Purification all flow from it. The hardcoded
  // SHARIA_MAP is only an instant fallback while the live screen loads.
  const[shariaScreen,setShariaScreen]=useState(()=>{try{return JSON.parse(localStorage.getItem("mizan_aaoifi_cache")||"{}");}catch{return{};}});

  // Map SnapTrade position → MIZAN holding format. Robust to nested UniversalSymbol
  // shapes (some brokers wrap symbols 1–2 levels deep).
  const SHARIA_MAP={...DEMO_SHARIA,...Object.fromEntries(HOLDINGS.map(h=>[h.tk,h.sh_]))};
  const readSymbol=(pos)=>{
    let s=pos?.symbol;
    let depth=0;
    while(s&&typeof s==="object"&&s.symbol&&typeof s.symbol==="object"&&depth<3){s=s.symbol;depth++;}
    if(typeof s==="string")return{tk:s,nm:s,ty:"Stock"};
    const tk=s?.symbol||s?.raw_symbol||s?.ticker||"";
    const nm=s?.description||pos?.symbol?.description||tk;
    const ty0=s?.type;
    const ty=typeof ty0==="string"?ty0:(ty0?.code||ty0?.description||"Stock");
    return{tk:typeof tk==="string"?tk:"",nm:typeof nm==="string"?nm:"",ty};
  };
  const mapPosition=useCallback((pos,acctName,broker)=>{
    const{tk,nm,ty}=readSymbol(pos);
    if(!tk)return null; // cash, money-market, malformed → caller filters
    const sh=Number(pos?.units)||0;
    const px=Number(pos?.price)||0;
    const ac=Number(pos?.average_purchase_price)||px;
    const b=(broker||"").toLowerCase();
    const ac_=b.includes("fidelity")?(acctName||"Fidelity")
            :b.includes("robinhood")?"Robinhood"
            :b.includes("empower")?"401(k)"
            :b.includes("schwab")?"Schwab"
            :b.includes("coinbase")?"Crypto"
            :b.includes("chase")?"Chase"
            :(acctName||broker||"Unknown");
    // The live ENGINE verdict (/api/screen) is the ONLY source of truth for a real
    // user's holdings — nothing is hardcoded. In DEMO mode the persona's SHARIA_MAP
    // supplies labels; for real users an unscreened / unknown / crypto holding shows
    // "review" (flag it, never bless it) until the engine returns a verdict. This
    // fixes the old bug where crypto auto-labeled "halal" (mislabeling DOGE/XRP) and
    // the demo persona's hardcoded map leaked into real users' screening.
    const live=shariaScreen[tk]&&shariaScreen[tk].status&&shariaScreen[tk].status!=="unknown"?shariaScreen[tk].status:null;
    // Ethical/BDS overlay flag from the screen verdict (independent of sh_). The
    // app only ACTS on it when the user turns the overlay on (see ethicalOverlay).
    const bds=shariaScreen[tk]&&shariaScreen[tk].ethical&&shariaScreen[tk].ethical.excluded?shariaScreen[tk].ethical:null;
    return{tk,nm,sh,ac,px,ty,
      sh_:live||(demoMode?SHARIA_MAP[tk]:null)||"review",
      bds_:bds,
      ac_,br:broker,_live:true,_fromSnap:true};
  },[shariaScreen,demoMode]);

  // Screen the user's real holdings server-side so h.sh_ reflects the live
  // verdict app-wide (not just when the Screener tab is open). Only tickers not
  // already screened today are sent; results merge into shariaScreen + the
  // shared mizan_aaoifi_cache the Screener tab reads. Skipped in demo mode.
  useEffect(()=>{
    if(demoMode)return;
    const today=new Date().toISOString().slice(0,10);
    // Gather held tickers WITH their connector-reported asset type. Crypto has no
    // Finnhub fundamentals, so it's handled explicitly (flagged "review" — status is
    // token-specific + scholar-dependent) rather than sent to the ratio engine and
    // coming back "unknown" (which previously let it fall through to auto-"halal").
    const heldMap=new Map();
    snapAccounts.forEach(a=>(a.positions||[]).forEach(p=>{const{tk,ty}=readSymbol(p);if(tk&&!heldMap.has(tk))heldMap.set(tk,ty);}));
    const stale=tk=>!shariaScreen[tk]||shariaScreen[tk].asOf!==today;
    const isCryptoTy=t=>/crypto/i.test(String(t||""));
    // Force the crypto "review" verdict whenever the cached entry isn't ALREADY it —
    // regardless of freshness — so a stale/old cached "halal" (e.g. a DOGE that was
    // screened before this fix) can't keep showing green until the cache expires.
    // Idempotent: once an entry is assetType:"crypto" it's skipped, so no re-loop.
    const cryptoTodo=[...heldMap].filter(([tk,ty])=>isCryptoTy(ty)&&shariaScreen[tk]?.assetType!=="crypto").map(([tk])=>tk);
    if(cryptoTodo.length)setShariaScreen(prev=>{
      const next={...prev};
      cryptoTodo.forEach(tk=>{next[tk]={status:"review",reason:"Cryptocurrency — Sharia status is token-specific and scholar-dependent; Mizan does not auto-classify crypto. Consult a qualified scholar.",asOf:today,assetType:"crypto"};});
      try{localStorage.setItem("mizan_aaoifi_cache",JSON.stringify(next));}catch{}
      return next;
    });
    const todo=[...heldMap].filter(([tk,ty])=>!isCryptoTy(ty)&&stale(tk)).map(([tk])=>tk);
    if(!todo.length)return;
    let cancelled=false;
    (async()=>{
      try{
        const r=await apiFetch("/api/screen",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({symbols:todo})});
        if(!r.ok)return;
        const d=await r.json();
        const results=d.results||{};
        if(cancelled||!Object.keys(results).length)return;
        setShariaScreen(prev=>{
          const next={...prev};
          Object.entries(results).forEach(([tk,v])=>{next[tk]={...v,asOf:v.asOf||today};});
          try{localStorage.setItem("mizan_aaoifi_cache",JSON.stringify(next));}catch{}
          return next;
        });
      }catch{/* screen failures leave sh_ on its fallback — never throw */}
    })();
    return()=>{cancelled=true;};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[demoMode,snapAccounts]);

  // Persist + broadcast helper so every place that updates these arrays caches
  // the value AND notifies other open tabs.
  const persistAccounts=useCallback(arr=>{
    setSnapAccounts(arr);
    try{localStorage.setItem("mizan_accounts_cache",JSON.stringify(arr));}catch{}
    broadcast("accounts",arr);
  },[]);
  const persistActivities=useCallback(arr=>{
    setSnapActivities(arr);
    try{localStorage.setItem("mizan_activities_cache",JSON.stringify(arr));}catch{}
    broadcast("activities",arr);
  },[]);

  const fetchSnapHoldings=useCallback(async()=>{
    let imported=[];
    try{imported=JSON.parse(localStorage.getItem("mizan_imports")||"[]");}catch{}
    if(demoMode){
      persistAccounts(DEMO_ACCOUNTS);
      persistActivities(dedupeActivities([...DEMO_ACTIVITIES,...imported]).sort((a,b)=>(b.trade_date||"").localeCompare(a.trade_date||"")));
      return;
    }
    try{
      const r=await apiFetch("/api/snaptrade/all");
      if(r.ok){
        const d=await r.json();
        const accts=Array.isArray(d.accounts)?d.accounts:[];
        persistAccounts(accts);
        // Flag that this user has real broker connections — used to auto-hide
        // the demo toggle once they've connected at least one account.
        if(accts.length>0&&!hasRealData){
          setHasRealData(true);
          try{localStorage.setItem("mizan_has_real_data","1");}catch{}
        }
        // Reconcile mizan_brokers localStorage with reality. If the server
        // reports zero connected accounts but localStorage still lists
        // brokers as "connected" (stale state from the old SnapTrade
        // account or a prior session), wipe the local list so the
        // Connect modal stops showing brokers that aren't actually linked
        // anymore. Same for mizan_accounts_cache / mizan_activities_cache.
        if(accts.length===0){
          try{
            const stale=JSON.parse(localStorage.getItem("mizan_brokers")||"[]");
            if(Array.isArray(stale)&&stale.length>0){
              localStorage.setItem("mizan_brokers","[]");
              persistUserState("mizan_brokers",[]);
              localStorage.removeItem("mizan_accounts_cache");
              localStorage.removeItem("mizan_activities_cache");
            }
          }catch{}
        }
      }
    }catch{/* backend down — ignore */}
    try{
      const r2=await apiFetch("/api/snaptrade/activities");
      if(r2.ok){
        const d2=await r2.json();
        const real=Array.isArray(d2.activities)?d2.activities:[];
        // Enrich SnapTrade rows with a full broker + sub-account label so
        // fingerprint dedup can distinguish "Fidelity ROTH IRA" from
        // "Coinbase" (was the cause of Fidelity rows showing as Coinbase
        // after the retag tool ran). Builds an accountId → label map from
        // the just-fetched snapAccounts cache; falls back to brokerage or
        // whatever institution_name SnapTrade returned.
        let acctLabelById={},acctNumById={};
        try{
          const cachedAccts=JSON.parse(localStorage.getItem("mizan_accounts_cache")||"[]");
          cachedAccts.forEach(a=>{
            acctLabelById[a.accountId]=`${a.brokerage} — ${a.accountName}`;
            if(a.number)acctNumById[a.accountId]=a.number;
          });
        }catch{}
        // institution_name stays the (renameable) display label; the STABLE
        // broker account number rides along on .account.number so fingerprint
        // dedup can collapse a CSV import onto the same SnapTrade transaction
        // even when the account was renamed in Mizan (see fingerprintRow).
        const enrichedReal=real.map(r=>({
          ...r,
          account:{...(r.account||{}),number:acctNumById[r.account?.id]??r.account?.number??null},
          institution_name:acctLabelById[r.account?.id]||r.institution_name||r.account?.institution_name||"Unknown",
        }));
        // SnapTrade real first so any CSV import row that fingerprint-matches
        // a real transaction is dropped (the broker is the source of truth).
        // Then a second, account-blind pass collapses single-account CSV imports
        // (Robinhood/Coinbase — no account number) onto their real twin.
        const looseIdx=realLooseIndex(enrichedReal);
        const mergedActs=dedupeActivities([...enrichedReal,...imported]).filter(r=>!(r._imported&&importMatchesReal(r,looseIdx)));
        persistActivities(mergedActs.sort((a,b)=>(b.trade_date||"").localeCompare(a.trade_date||"")));
      }else{
        persistActivities(dedupeActivities(imported));
      }
    }catch{persistActivities(dedupeActivities(imported));}
    try{
      const r3=await apiFetch("/api/snaptrade/documents");
      if(r3.ok){
        const d3=await r3.json();
        const docs=Array.isArray(d3.documents)?d3.documents:Array.isArray(d3.documents?.documents)?d3.documents.documents:[];
        setSnapDocuments(docs);
        try{localStorage.setItem("mizan_documents_cache",JSON.stringify(docs));}catch{}
      }
    }catch{/* backend down — keep cache */}
  },[demoMode,persistAccounts,persistActivities]);

  const toggleDemo=()=>{
    const next=!demoMode;
    setDemoMode(next);
    try{localStorage.setItem("mizan_demo",next?"1":"0");}catch{}
  };

  // CSV import for historical backfill (Fidelity / Robinhood / Coinbase
  // activity exports). Parsed rows merge into snapActivities so all the
  // performance metrics pick them up automatically.
  //
  // Dedup: two rows are considered the same if their broker + trade_date +
  // type + symbol + units + price + amount all match. This catches the
  // common "user re-uploads the same export" case without rejecting a
  // legitimately-updated export that simply contains the same older rows
  // plus new ones — only the duplicates are skipped, new rows still land.
  // Activity fingerprint — used by import-time dedup AND by the merge in
  // fetchSnapHoldings so SnapTrade activities and CSV imports of the same
  // underlying transaction collapse to a single row.
  //
  // Kept:
  //   - institution_name (broker + sub-account, normalized) — required.
  //     Prevents a Coinbase ACH deposit collapsing with a Fidelity ACH
  //     deposit on the same day for the same amount. Both upstream
  //     sources (CSV imports + SnapTrade real activities, now enriched
  //     in fetchSnapHoldings) produce the same "Broker — SubAccount"
  //     string so re-uploads of the same Robinhood CSV still dedup.
  //   - date (YYYY-MM-DD)            — required
  //   - symbol (uppercased, trimmed)
  //   - units, signed, 2 dp          — preserves direction
  //   - amount, signed, 2 dp         — preserves direction (a BUY and
  //                                    SELL of the same lot don't collapse)
  //
  // Dropped:
  //   - transaction type ("Buy" vs "BUY" vs "BTOO") — Robinhood has
  //     churned trans-code formats over the years
  //   - price precision ($150.234 vs $150.23) — less stable than amount
  const fingerprintRow=r=>{
    const n=v=>{
      const f=parseFloat(v);
      return Number.isFinite(f)?f.toFixed(2):"";
    };
    const sym=r.symbol?.symbol||r.symbol||"";
    const inst=(r.institution_name||"").trim().toUpperCase();
    // Account key: prefer the STABLE broker account NUMBER (last 4) over the
    // display label. The label carries the user's Mizan nickname, so a CSV
    // export (broker's own account name) and the SnapTrade feed (renamed) never
    // matched → the same transaction survived twice. `broker#last4` is
    // rename-immune yet still keeps two sub-accounts at one broker distinct.
    // Falls back to the full label when no number is present (e.g. single-
    // account Robinhood/Coinbase exports) — unchanged from prior behavior.
    const last4=String(r.account?.number||"").replace(/[^a-z0-9]/gi,"").toUpperCase().slice(-4);
    const brokerTok=inst.split("—")[0].trim().split(/\s+/)[0];
    const acctKey=last4?`${brokerTok}#${last4}`:inst;
    return[
      acctKey,
      (r.trade_date||r.settlement_date||"").slice(0,10),
      (typeof sym==="string"?sym:"").trim().toUpperCase(),
      n(r.units),
      n(r.amount),
    ].join("|");
  };

  // Drop activities that fingerprint-match earlier ones. Earlier rows win —
  // callers control priority by ordering (e.g. SnapTrade real first,
  // CSV imports second so imports lose when overlapping a real activity).
  const dedupeActivities=arr=>{
    const seen=new Set();
    const out=[];
    for(const r of arr){
      const fp=fingerprintRow(r);
      if(seen.has(fp))continue;
      seen.add(fp);
      out.push(r);
    }
    return out;
  };

  // ── Cross-source (CSV import ⇄ SnapTrade real) loose dedupe ───────────────
  // The strict fingerprint keys on the account (broker#last4, else label).
  // Single-account broker exports (Robinhood, Coinbase) carry NO account number,
  // so their rows can never number-match the live feed and the strict pass leaves
  // them duplicated. These helpers match a CSV import to a real transaction by
  // the transaction itself (broker+date+symbol+units+amount) — account-BLIND but
  // number-COMPATIBLE: only collapse when one side has no number or the last-4
  // agree, so two distinct numbered accounts at one broker are never merged, and
  // ONLY _imported rows are ever removed (a real row is never dropped).
  const looseKey=r=>{
    const n=v=>{const f=parseFloat(v);return Number.isFinite(f)?f.toFixed(2):"";};
    const sym=r.symbol?.symbol||r.symbol||"";
    const brokerTok=(r.institution_name||"").trim().toUpperCase().split("—")[0].trim().split(/\s+/)[0];
    return[brokerTok,(r.trade_date||r.settlement_date||"").slice(0,10),(typeof sym==="string"?sym:"").trim().toUpperCase(),n(r.units),n(r.amount)].join("|");
  };
  const acctLast4=r=>String(r.account?.number||"").replace(/[^a-z0-9]/gi,"").toUpperCase().slice(-4);
  const realLooseIndex=reals=>{
    const m=new Map();
    for(const r of reals||[]){const k=looseKey(r);const arr=m.get(k);if(arr)arr.push(acctLast4(r));else m.set(k,[acctLast4(r)]);}
    return m;
  };
  const importMatchesReal=(imp,idx)=>{
    const reals=idx.get(looseKey(imp));if(!reals)return false;
    const mine=acctLast4(imp);
    return reals.some(rn=>!rn||!mine||rn===mine);
  };

  // Dedupe button — runs two passes:
  //   1) Remove duplicate rows within mizan_imports (same fingerprint).
  //   2) Remove imported rows that already exist as real SnapTrade activities
  //      (broker is source of truth — the CSV row is redundant). Without this
  //      pass, the next auto-sync would re-merge real + imports and visually
  //      reintroduce duplicates even though mizan_imports itself was clean.
  // Then reconcile snapActivities so totals refresh immediately.
  const dedupeImports=useCallback(()=>{
    let existing=[];
    try{existing=JSON.parse(localStorage.getItem("mizan_imports")||"[]");}catch{}
    if(!Array.isArray(existing)||existing.length===0)return{removed:0,kept:0};

    // Pass 1: internal dedup
    const internalDedup=dedupeActivities(existing);
    const internalRemoved=existing.length-internalDedup.length;

    // Pass 2: drop imports that match SnapTrade real activities — by strict
    // fingerprint AND by the account-blind, number-compatible loose match, so
    // single-account CSVs (Robinhood/Coinbase, no account number) still collapse
    // onto the renamed live feed.
    const realFingerprints=new Set();
    let realRows=[];
    try{
      realRows=JSON.parse(localStorage.getItem("mizan_activities_cache")||"[]").filter(a=>!a._imported);
      realRows.forEach(a=>realFingerprints.add(fingerprintRow(a)));
    }catch{}
    const looseIdx=realLooseIndex(realRows);
    const final=internalDedup.filter(r=>!realFingerprints.has(fingerprintRow(r))&&!importMatchesReal(r,looseIdx));
    const crossRemoved=internalDedup.length-final.length;
    const removed=internalRemoved+crossRemoved;

    if(removed===0)return{removed:0,kept:final.length};
    localStorage.setItem("mizan_imports",JSON.stringify(final));
    persistUserState("mizan_imports",final);

    // Rebuild snapActivities so the next render sees the cleaned data.
    // Easiest: re-merge from cache + cleaned imports via the same dedupe
    // path fetchSnapHoldings would use.
    try{
      const real=JSON.parse(localStorage.getItem("mizan_activities_cache")||"[]").filter(a=>!a._imported);
      const next=dedupeActivities([...real,...final]).sort((a,b)=>(b.trade_date||"").localeCompare(a.trade_date||""));
      persistActivities(next);
    }catch{
      persistActivities(dedupeActivities(final));
    }
    return{removed,kept:final.length,internalRemoved,crossRemoved};
  },[persistActivities]);

  // One-shot tool to fix already-imported rows that were tagged with the
  // wrong broker (e.g., Fidelity CSV uploaded with the dropdown still on
  // Coinbase). Strategy:
  //   1. Build a map keyed by content-only fingerprint (no institution)
  //      from SnapTrade real activities → the authoritative broker label.
  //   2. For each CSV row, look up by content-only FP. If a real activity
  //      matches and its broker differs from the row's institution_name,
  //      retag the row.
  // Stripping the institution piece is what makes this work even after
  // fingerprintRow started including institution_name — otherwise a
  // mistagged row would never match its real twin.
  const retagImports=useCallback(()=>{
    let existing=[];
    try{existing=JSON.parse(localStorage.getItem("mizan_imports")||"[]");}catch{}
    if(!Array.isArray(existing)||existing.length===0)return{checked:0,fixed:0,byBroker:{}};
    // Content-only fingerprint: drop the leading institution segment.
    const stripFp=fp=>fp.split("|").slice(1).join("|");
    const realByContentFp=new Map();
    try{
      const realCache=JSON.parse(localStorage.getItem("mizan_activities_cache")||"[]");
      // The real cache rows are already enriched with full "Broker — Sub" in
      // institution_name by fetchSnapHoldings. We still build the broker
      // label from snapAccounts when possible as a safer fallback.
      realCache.filter(a=>!a._imported).forEach(a=>{
        const acct=visibleAccounts.find(x=>x.accountId===a.account?.id);
        const brokerLabel=acct?`${acct.brokerage} — ${acct.accountName}`:a.institution_name||null;
        if(brokerLabel){
          realByContentFp.set(stripFp(fingerprintRow(a)),brokerLabel);
        }
      });
    }catch{}
    const byBroker={};
    let fixed=0;
    const next=existing.map(r=>{
      const contentFp=stripFp(fingerprintRow(r));
      const realBroker=realByContentFp.get(contentFp);
      if(realBroker&&realBroker!==r.institution_name){
        fixed++;
        byBroker[realBroker]=(byBroker[realBroker]||0)+1;
        return{...r,institution_name:realBroker};
      }
      return r;
    });
    if(fixed>0){
      localStorage.setItem("mizan_imports",JSON.stringify(next));
      persistUserState("mizan_imports",next);
      // Refresh snapActivities by re-merging real + retagged imports.
      try{
        const real=JSON.parse(localStorage.getItem("mizan_activities_cache")||"[]").filter(a=>!a._imported);
        persistActivities(dedupeActivities([...real,...next]).sort((a,b)=>(b.trade_date||"").localeCompare(a.trade_date||"")));
      }catch{}
    }
    return{checked:existing.length,fixed,byBroker};
  },[persistActivities,visibleAccounts]);

  const importCSV=useCallback((file,broker)=>{
    return new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=e=>{
        try{
          const text=e.target.result;
          const rows=parseCSV(text,broker);
          if(!rows.length){reject(new Error("No rows parsed — check the CSV format"));return;}
          const existing=JSON.parse(localStorage.getItem("mizan_imports")||"[]");
          // Seen set spans BOTH existing CSV imports AND SnapTrade real
          // activities — so a user can't accidentally import a row the
          // broker already provides.
          const seen=new Set(existing.map(fingerprintRow));
          try{
            const realCache=JSON.parse(localStorage.getItem("mizan_activities_cache")||"[]");
            realCache.filter(a=>!a._imported).forEach(a=>seen.add(fingerprintRow(a)));
          }catch{}
          const fresh=[];
          let skipped=0;
          for(const r of rows){
            const fp=fingerprintRow(r);
            if(seen.has(fp)){skipped++;continue;}
            seen.add(fp);
            fresh.push(r);
          }
          if(fresh.length===0){
            // Nothing new — leave storage untouched so we don't waste a
            // Supabase round-trip on an identical re-upload.
            resolve({added:0,skipped,total:rows.length});
            return;
          }
          const merged=[...existing,...fresh];
          localStorage.setItem("mizan_imports",JSON.stringify(merged));persistUserState("mizan_imports",merged);
          // Push into the live state so Overview updates immediately.
          setSnapActivities(prev=>dedupeActivities([...prev,...fresh]).sort((a,b)=>(b.trade_date||"").localeCompare(a.trade_date||"")));
          resolve({added:fresh.length,skipped,total:rows.length});
        }catch(err){reject(err);}
      };
      reader.onerror=()=>reject(reader.error);
      reader.readAsText(file);
    });
  },[]);

  // Watchlist + browser-native price alerts.
  const[watchlist,setWatchlist]=useState(()=>{try{return JSON.parse(localStorage.getItem("mizan_watchlist")||"[]");}catch{return[];}});
  const persistWatchlist=next=>{setWatchlist(next);try{localStorage.setItem("mizan_watchlist",JSON.stringify(next));}catch{}persistUserState("mizan_watchlist",next);};
  const addToWatchlist=(sym)=>{
    const tk=fixTicker(sym); // auto-correct common typos (APPL→AAPL, etc.)
    if(!tk||watchlist.some(w=>w.symbol===tk))return;
    const px=live.find(l=>l.tk===tk)?.price||0;
    persistWatchlist([...watchlist,{symbol:tk,addedAt:new Date().toISOString().slice(0,10),addPrice:px}]);
  };
  const removeFromWatchlist=(sym)=>persistWatchlist(watchlist.filter(w=>w.symbol!==sym));
  const setAlert=(sym,key,value)=>{
    persistWatchlist(watchlist.map(w=>w.symbol===sym?{...w,[key]:value===""||value==null?null:Number(value),[key+"Fired"]:false}:w));
  };
  // Keep the watchlist in sync with every ticker the bot strategies track —
  // active OR paused — so the user can follow them without opening the brokerage.
  // Admin only; idempotent (only appends missing symbols); typo-corrected.
  useEffect(()=>{
    if(!isAdmin||demoMode)return;
    let cancelled=false;
    apiFetch("/api/bot/strategies").then(r=>r.ok?r.json():null).then(d=>{
      if(cancelled||!d?.strategies)return;
      const want=new Set();
      for(const s of d.strategies){
        (Array.isArray(s.params?.universe_tickers)?s.params.universe_tickers:[]).forEach(t=>{const f=fixTicker(t);if(f)want.add(f);});
        const ft=fixTicker(s.ticker); if(ft)want.add(ft);
      }
      if(!want.size)return;
      setWatchlist(prev=>{
        const have=new Set(prev.map(w=>w.symbol));
        const adds=[...want].filter(t=>!have.has(t)).map(symbol=>({symbol,addedAt:new Date().toISOString().slice(0,10),addPrice:null,fromStrategy:true}));
        if(!adds.length)return prev;
        const next=[...prev,...adds];
        try{localStorage.setItem("mizan_watchlist",JSON.stringify(next));}catch{}
        persistUserState("mizan_watchlist",next);
        return next;
      });
    }).catch(()=>{});
    return()=>{cancelled=true;};
  },[isAdmin,demoMode]);
  const requestAlertPermission=async()=>{
    if(!("Notification"in window))return alert("This browser doesn't support notifications.");
    if(Notification.permission==="granted")return;
    await Notification.requestPermission();
  };

  // Dividend payment notifications — diff incoming /activities against the
  // "seen" set in localStorage. First run silently seeds the set so we don't
  // spam past dividends as if they were new.
  useEffect(()=>{
    if(!snapActivities.length)return;
    if(typeof Notification==="undefined"||Notification.permission!=="granted")return;
    let seenIds;
    try{seenIds=new Set(JSON.parse(localStorage.getItem("mizan_seen_dividends")||"[]"));}catch{seenIds=new Set();}
    const initialized=localStorage.getItem("mizan_seen_dividends_initialized")==="1";
    const dividends=snapActivities.filter(a=>(a.type||"").toUpperCase()==="DIVIDEND"&&a.id);
    if(!initialized){
      // Silent seed — every existing dividend is already "seen".
      const all=new Set(dividends.map(d=>d.id));
      try{
        const allArr=[...all];
        localStorage.setItem("mizan_seen_dividends",JSON.stringify(allArr));
        localStorage.setItem("mizan_seen_dividends_initialized","1");
        persistUserState("mizan_seen_dividends",allArr);
        persistUserState("mizan_seen_dividends_initialized","1");
      }catch{}
      return;
    }
    const fresh=dividends.filter(d=>!seenIds.has(d.id));
    if(!fresh.length)return;
    fresh.slice(0,5).forEach(d=>{
      const tk=d.symbol?.symbol||d.symbol||"—";
      const amt=Math.abs(+d.amount||0);
      try{new Notification(`${tk} dividend received`,{body:`+$${amt.toFixed(2)} on ${d.trade_date}`,icon:"/icon-192.png"});}catch{}
      seenIds.add(d.id);
    });
    if(fresh.length>5){
      // Coalesce overflow into a single "+ N more" notification
      try{new Notification(`${fresh.length-5} more dividends`,{body:"Open MIZAN → Activity to review",icon:"/icon-192.png"});}catch{}
      fresh.slice(5).forEach(d=>seenIds.add(d.id));
    }
    try{const seenArr=[...seenIds];localStorage.setItem("mizan_seen_dividends",JSON.stringify(seenArr));persistUserState("mizan_seen_dividends",seenArr);}catch{}
  },[snapActivities]);

  // Alert checker — fires browser notifications when targets are crossed.
  // Marks each alert "fired" so we don't spam every sync.
  useEffect(()=>{
    if(!live.length||!watchlist.length)return;
    if(!("Notification"in window)||Notification.permission!=="granted")return;
    let mutated=false;
    const next=watchlist.map(w=>{
      const px=live.find(l=>l.tk===w.symbol)?.price;
      if(!px)return w;
      let n={...w};
      if(w.alertAbove&&px>=w.alertAbove&&!w.alertAboveFired){
        try{new Notification(`${w.symbol} ↑`,{body:`Price ${px.toFixed(2)} hit target ${w.alertAbove}`});}catch{}
        n.alertAboveFired=true;mutated=true;
      }
      if(w.alertBelow&&px<=w.alertBelow&&!w.alertBelowFired){
        try{new Notification(`${w.symbol} ↓`,{body:`Price ${px.toFixed(2)} crossed below ${w.alertBelow}`});}catch{}
        n.alertBelowFired=true;mutated=true;
      }
      return n;
    });
    if(mutated)persistWatchlist(next);
  },[live]);

  const disconnectAccount=useCallback(async(accountId,authorizationId,label)=>{
    if(demoMode){
      // Demo: locally drop the account from the in-memory copy.
      setSnapAccounts(prev=>prev.filter(a=>a.accountId!==accountId));
      return;
    }
    if(!confirm(`Permanently disconnect "${label}"?\n\nThis removes the brokerage authorization at SnapTrade. Any sibling accounts under the same authorization are also removed. To restore, reconnect through the SnapTrade portal.`))return;
    try{
      const r=await apiFetch("/api/snaptrade/disconnect",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({accountId,authorizationId}),
      });
      const d=await r.json();
      if(!r.ok){alert(`Disconnect failed: ${d.error||r.status}`);return;}
      // Drop the account immediately; full refetch will pick up sibling-removal too.
      setSnapAccounts(prev=>prev.filter(a=>a.accountId!==accountId&&a.authorizationId!==(authorizationId||d.authorizationId)));
      fetchSnapHoldings();
    }catch(err){alert(`Disconnect error: ${err.message}`);}
  },[demoMode,fetchSnapHoldings]);

  const[apiKeys,setApiKeys]=useState(()=>{
    // Public-only keys come from VITE_ env. Sensitive keys (Anthropic,
    // SnapTrade Consumer Key) are server-only and accessed via /api proxies.
    const E=import.meta.env;
    const def={
      finnhub:      E.VITE_FINNHUB_KEY          || "",
      polygon:      E.VITE_POLYGON_KEY          || "",
      snapId:       E.VITE_SNAPTRADE_CLIENT_ID  || "",
      alpacaId:     E.VITE_ALPACA_KEY_ID        || "",
      alpacaSecret: E.VITE_ALPACA_SECRET        || "",
      // Sensitive — never read from import.meta.env. Server proxies these.
      anthropic:"", snapKey:"",
    };
    try{
      const s=JSON.parse(localStorage.getItem("mizan_keys")||"{}");
      return Object.fromEntries(Object.entries(def).map(([k,v])=>[k,s[k]||v]));
    }catch{return def;}
  });

  // Tickers we routinely refresh prices for. Built from the user's real
  // SnapTrade positions + their watchlist + their CSV-imported activity
  // symbols. Falls back to a small market-bellwether set ONLY when the
  // user has no connections at all, so first-load Markets still has
  // something to render. NEVER seeded from the owner's HOLDINGS sample.
  // Recomputes whenever holdings or the watchlist change so a freshly-added
  // watchlist ticker enters the next price sync (previously frozen at mount,
  // which left new symbols showing "—" until a full page reload).
  const tickers=useMemo(()=>{
    const set=new Set();
    snapAccounts.forEach(a=>(a.positions||[]).forEach(p=>{
      const t=p?.symbol?.symbol||p?.symbol;
      if(typeof t==="string"&&t)set.add(t);
    }));
    watchlist.forEach(w=>w?.symbol&&set.add(w.symbol));
    if(set.size===0){
      // Generic market bellwethers — not user data.
      ["SPY","QQQ","AAPL","MSFT","NVDA"].forEach(t=>set.add(t));
    }
    return[...set];
  },[snapAccounts,watchlist]);
  const isLive=live.length>0;

  const sync=useCallback(async()=>{
    setFetch(true);
    try{
      await Promise.allSettled([
        (async()=>{
          // Cover both fixture tickers AND any live/demo tickers we're holding,
          // so live prices reach every position on every tab.
          let allTickers=tickers;
          try{
            const cached=JSON.parse(localStorage.getItem("mizan_accounts_cache")||"[]");
            const tks=cached.flatMap(a=>(a.positions||[]).map(p=>(p?.symbol?.symbol||p?.symbol||"")));
            allTickers=[...new Set([...tickers,...tks.filter(t=>typeof t==="string"&&t)])];
          }catch{}
          // Server proxy uses env-var FINNHUB_KEY regardless of any
          // user-supplied key, so we can always try it. fetchAIPrices is
          // the Anthropic-driven fallback (also routed through /api/advisor).
          let prices=await fetchFinnhub(allTickers).catch(()=>[]);
          if(!prices.length)prices=await fetchAIPrices(allTickers).catch(()=>[]);
          if(prices.length){setLive(prices);try{localStorage.setItem("mizan_live_cache",JSON.stringify(prices));}catch{}broadcast("live",prices);}
        })(),
        fetchSnapHoldings(),
      ]);
      setSync(new Date());
    }finally{setFetch(false);}
  },[fetchSnapHoldings]);

  // Keep a stable ref to sync so pull-to-refresh can call it without
  // re-registering touch listeners every time sync changes.
  useEffect(()=>{syncRef.current=sync;},[sync]);
  // Fetch live prices on mount and whenever the tracked-symbol set changes
  // (e.g. a watchlist add or accounts loading). Keyed on the joined ticker
  // string — not the array — so it fires only when the set actually changes,
  // not on every re-memo. Uses syncRef so this effect doesn't re-run each time
  // sync() is recreated. Removes the ~90s blank window before the first
  // auto-sync tick and makes new watchlist tickers resolve right away.
  const tickersKey=tickers.join(",");
  useEffect(()=>{syncRef.current?.();},[tickersKey]);
  useEffect(()=>{
    let startY=null;
    const ptrReadyRef={current:false};
    const onStart=(e)=>{if(window.scrollY===0)startY=e.touches[0].clientY;};
    const onMove=(e)=>{
      if(startY===null)return;
      const dy=e.touches[0].clientY-startY;
      if(dy>0){setPtrActive(dy>16);const r=dy>64;setPtrReady(r);ptrReadyRef.current=r;}
      else{startY=null;}
    };
    const onEnd=()=>{
      if(ptrReadyRef.current&&syncRef.current)syncRef.current();
      setPtrActive(false);setPtrReady(false);ptrReadyRef.current=false;startY=null;
    };
    document.addEventListener('touchstart',onStart,{passive:true});
    document.addEventListener('touchmove',onMove,{passive:true});
    document.addEventListener('touchend',onEnd,{passive:true});
    return()=>{
      document.removeEventListener('touchstart',onStart);
      document.removeEventListener('touchmove',onMove);
      document.removeEventListener('touchend',onEnd);
    };
  },[]);

  // Force broker-side refresh — pushes a manualRefresh signal to SnapTrade
  // so balances + activity reflect what's on the brokerage UI right now.
  // SnapTrade caps this server-side (~few per hour per connection); we layer
  // a client cooldown so the button can't spam-fail. After requesting,
  // schedule a regular sync() ~25s later so the freshly-refreshed data
  // makes it into the UI without the user pressing anything else.
  const FORCE_REFRESH_COOLDOWN_MS = 5 * 60 * 1000;
  const[forceBusy,setForceBusy]=useState(false);
  const[forceCooldownUntil,setForceCooldownUntil]=useState(0);
  const[forceMsg,setForceMsg]=useState(null);
  const forceRefresh=useCallback(async()=>{
    if(forceBusy||Date.now()<forceCooldownUntil)return;
    setForceBusy(true);setForceMsg(null);
    try{
      const r=await apiFetch("/api/snaptrade/refresh",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
      const d=await r.json().catch(()=>({}));
      if(r.ok){
        const q=d?.queued??0,t=d?.total??0,th=d?.throttled??0;
        let msg=`Broker refresh queued (${q}/${t}). Data updating…`;
        if(th>0)msg+=` ${th} connection${th===1?"":"s"} throttled by SnapTrade.`;
        if(t===0)msg="No active connections to refresh.";
        setForceMsg({ok:true,msg});
        setForceCooldownUntil(Date.now()+FORCE_REFRESH_COOLDOWN_MS);
        // Pull the refreshed data ~25 s later so the user doesn't have to
        // press Sync All themselves. SnapTrade typically returns updated
        // figures within 15–30 s for live connections.
        setTimeout(()=>{sync();},25*1000);
      }else if(r.status===429){
        setForceMsg({ok:false,msg:d?.error||"Refresh throttled by SnapTrade. Try again in ~1 hour."});
        setForceCooldownUntil(Date.now()+60*60*1000);
      }else{
        setForceMsg({ok:false,msg:d?.error||`Refresh failed (${r.status}).`});
      }
    }catch(err){
      setForceMsg({ok:false,msg:err.message||"Network error"});
    }finally{
      setForceBusy(false);
      setTimeout(()=>setForceMsg(null),6000);
    }
  },[forceBusy,forceCooldownUntil,sync]);
  // Tick once a second when in cooldown so the button label countdown stays fresh.
  const[,forceTick]=useState(0);
  useEffect(()=>{
    if(forceCooldownUntil<=Date.now())return;
    const t=setInterval(()=>forceTick(n=>n+1),1000);
    return()=>clearInterval(t);
  },[forceCooldownUntil]);

  // fetchSnapHoldings on mount is covered by the [demoMode] effect below and by
  // the mount sync() (tickersKey effect); this one only seeds global keys.
  useEffect(()=>{setGlobalKeys(apiKeys);},[]);
  useEffect(()=>{fetchSnapHoldings();},[demoMode]);
  useEffect(()=>{
    apiFetch("/api/user/features").then(r=>r.ok?r.json():null).then(d=>{
      if(d){setIsAdmin(!!d.trading_bot);setFullAutoEnabled(!!d.full_auto);setBotIsRoot(!!d.is_root);setBotConsented(!!d.trading_bot_consented);}
    }).catch(()=>{}).finally(()=>setFeaturesLoaded(true));
  },[]);

  // Defensive bounce: once we know the user's capabilities, a non-admin sitting
  // on Trade (only possible via tampered localStorage/URL) is sent to Overview.
  useEffect(()=>{ if(featuresLoaded&&!isAdmin&&nav==="trade")setNav("overview"); },[featuresLoaded,isAdmin,nav]);

  // Hydrate broker connections from SnapTrade so they survive a localStorage wipe.
  useEffect(()=>{
    apiFetch("/api/snaptrade/accounts").then(r=>r.json()).then(d=>{
      const accounts=Array.isArray(d?.accounts)?d.accounts:[];
      if(!accounts.length)return;
      const saved=JSON.parse(localStorage.getItem("mizan_brokers")||"[]");
      const merged=[...saved];
      accounts.forEach(a=>{
        const inst=(a.institution_name||a.brokerage?.name||a.name||"").toUpperCase();
        const broker=BROKERS.find(b=>inst.includes(b.id)||inst.includes(b.nm.toUpperCase()));
        if(!broker||merged.some(s=>s.id===broker.id))return;
        merged.push({...broker,status:"connected",authId:a.brokerage_authorization||a.id,at:new Date().toISOString()});
      });
      if(merged.length!==saved.length)localStorage.setItem("mizan_brokers",JSON.stringify(merged));
    }).catch(()=>{});
  },[]);
  // 90-second cadence when auto is ON. Each tick fires the same sync() used
  // by the manual button: live prices (Finnhub proxy), SnapTrade /accounts +
  // /activities, and news. Stays under the per-user rate limit (~3 req/min
  // vs the 120 req/min cap). NOTE: SnapTrade's own broker poll is the upper
  // bound on cash/balance freshness; for instant refresh, a future "Force
  // sync" button could call /connections/:authId/refresh (throttled by
  // SnapTrade to a few hits per hour per connection).
  useEffect(()=>{
    if(auto){
      autoRef.current=setInterval(sync,90*1000);
      return()=>clearInterval(autoRef.current);
    }
    clearInterval(autoRef.current);
  },[auto,sync]);

  // ── Theme: auto (sunrise/sunset) | dark | light ──────────
  const[themeMode,setThemeMode]=useState(()=>{try{return localStorage.getItem("mizan_theme_mode")||"light";}catch{return"light";}});
  const[resolvedTheme,setResolvedTheme]=useState("light");
  useEffect(()=>{
    // Inject the palette CSS once.
    const existing=document.getElementById("mz-theme-css");
    if(existing)return;
    const s=document.createElement("style");
    s.id="mz-theme-css";s.textContent=THEME_CSS;
    document.head.appendChild(s);
  },[]);
  useEffect(()=>{
    document.documentElement.setAttribute("data-theme",resolvedTheme);
  },[resolvedTheme]);

  // Sunrise/sunset auto-switching. Geolocation with NYC fallback. Free
  // sunrise-sunset.org API, no key. Cached daily in localStorage.
  useEffect(()=>{
    if(themeMode==="dark"){setResolvedTheme("dark");return;}
    if(themeMode==="light"){setResolvedTheme("light");return;}
    let cancelled=false;
    const apply=({sunrise,sunset})=>{
      if(cancelled)return;
      const now=Date.now();
      const sr=new Date(sunrise).getTime();
      const ss=new Date(sunset).getTime();
      // Normalize to today: API returns today's UTC times. If now < sunrise, before-dawn → dark.
      // If sunrise <= now < sunset → light. Else dark.
      const next=now>=sr&&now<ss?"light":"dark";
      setResolvedTheme(next);
    };
    const fetchSun=async(lat,lng)=>{
      const today=new Date().toISOString().slice(0,10);
      const cacheKey=`mizan_sun_${today}_${lat.toFixed(2)}_${lng.toFixed(2)}`;
      try{
        const cached=JSON.parse(localStorage.getItem(cacheKey)||"null");
        if(cached){apply(cached);return;}
      }catch{}
      try{
        const r=await fetch(`https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lng}&formatted=0`);
        const d=await r.json();
        if(d.status==="OK"){
          const payload={sunrise:d.results.sunrise,sunset:d.results.sunset};
          try{localStorage.setItem(cacheKey,JSON.stringify(payload));}catch{}
          apply(payload);
        }
      }catch{/* network down — stick with current theme */}
    };
    // Try geolocation first, fallback to NYC
    if(navigator.geolocation){
      navigator.geolocation.getCurrentPosition(
        p=>fetchSun(p.coords.latitude,p.coords.longitude),
        ()=>fetchSun(40.7128,-74.0060),
        {timeout:3000,maximumAge:24*3600*1000}
      );
    }else{
      fetchSun(40.7128,-74.0060);
    }
    // Re-evaluate every 10 minutes (handles crossings within an open session).
    const t=setInterval(()=>{
      if(navigator.geolocation){
        navigator.geolocation.getCurrentPosition(
          p=>fetchSun(p.coords.latitude,p.coords.longitude),
          ()=>fetchSun(40.7128,-74.0060),
        );
      }else fetchSun(40.7128,-74.0060);
    },10*60*1000);
    return()=>{cancelled=true;clearInterval(t);};
  },[themeMode]);

  const cycleTheme=()=>{
    const next=themeMode==="auto"?"light":themeMode==="light"?"dark":"auto";
    setThemeMode(next);
    try{localStorage.setItem("mizan_theme_mode",next);}catch{}
  };

  // Live-ticking NYC clock + market status. Re-renders every second.
  const[clockNow,setClockNow]=useState(new Date());
  useEffect(()=>{const t=setInterval(()=>setClockNow(new Date()),1000);return()=>clearInterval(t);},[]);
  const nyc=useMemo(()=>{
    const fmt=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",hour:"numeric",minute:"2-digit",second:"2-digit",hour12:true,weekday:"short"});
    const parts=fmt.formatToParts(clockNow);
    const get=t=>parts.find(p=>p.type===t)?.value||"";
    const time=`${get("hour")}:${get("minute")}:${get("second")} ${get("dayPeriod")}`;
    const wd=get("weekday");

    // User's local time + timezone abbreviation (resolved from browser locale).
    // Keep literals (the colon + space + AM/PM separator) — only strip the
    // timeZoneName part and re-append it cleanly at the end.
    const localFmt=new Intl.DateTimeFormat([],{hour:"numeric",minute:"2-digit",hour12:true,timeZoneName:"short"});
    const localParts=localFmt.formatToParts(clockNow);
    const localTime=localParts.filter(p=>p.type!=="timeZoneName").map(p=>p.value).join("").trim().replace(/\s+$/,"").replace(/,\s*$/,"");
    const localTZ=localParts.find(p=>p.type==="timeZoneName")?.value||"";
    const localDisplay=localTZ?`${localTime} ${localTZ}`:localTime;
    // Pull NYC h+m as numbers for status logic
    const hmFmt=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",hour:"2-digit",minute:"2-digit",hour12:false});
    const hm=hmFmt.format(clockNow);
    const[h,m]=hm.split(":").map(Number);
    const minutes=h*60+m;
    const isWeekend=wd==="Sat"||wd==="Sun";
    const open=9*60+30, close=16*60, pre=4*60, post=20*60;
    let status="Closed",color=T.muted,nextEvent="",nextMins=0;
    if(isWeekend){status="Weekend";nextEvent="Monday open";}
    else if(minutes>=open&&minutes<close){status="Open";color=T.gain;nextEvent="Close";nextMins=close-minutes;}
    else if(minutes>=pre&&minutes<open){status="Pre-Market";color=T.gold;nextEvent="Open";nextMins=open-minutes;}
    else if(minutes>=close&&minutes<post){status="Post-Market";color=T.gold;nextEvent="Post-close";nextMins=post-minutes;}
    else{status="Closed";nextEvent="Pre-mkt";nextMins=(minutes<pre?pre-minutes:24*60-minutes+pre);}
    const cd=nextMins>0?`${Math.floor(nextMins/60)}h ${String(nextMins%60).padStart(2,"0")}m`:"";
    return{time,localDisplay,wd,status,color,countdown:cd,nextEvent,isWeekend,minutes};
  },[clockNow]);
  const hr=nyc.minutes/60;
  const sessionLabel=nyc.status,sessionColor=nyc.color;

  // Six-tab dock. About moved into Settings, Trade redistributed
  // (FIRE → Goals, Backtest → Portfolio, Sharia → Screener, Order Ticket
  // Coming Soon and reachable via CommandPalette only). Keeps the dock
  // un-crowded so first-time users aren't decision-fatigued.
  const NAV=[{id:"overview",l:"Overview"},{id:"finances",l:"Finances"},{id:"portfolio",l:"Portfolio"},...(isAdmin?[{id:"trade",l:"Trade"}]:[]),{id:"goals",l:"Goals"},{id:"advisor",l:"AI Advisor"},{id:"settings",l:"Settings"}];

  return<div style={{minHeight:"100vh",background:T.bg,color:T.text,fontFamily:FU,fontFeatureSettings:'"cv11","ss01","kern"'}}>
    {/* Atmospheric Arabic wordmark (ميزان) — fixed, translucent, sits behind all content */}
    <div aria-hidden="true" style={{position:"fixed",top:"50%",left:"50%",transform:"translate(-50%,-50%)",width:"min(82vw,820px)",aspectRatio:"1058 / 380",background:resolvedTheme==="dark"?"#efe9dd":"#1e4e8c",opacity:0.08,WebkitMaskImage:"url(/wordmark-ar.png)",maskImage:"url(/wordmark-ar.png)",WebkitMaskRepeat:"no-repeat",maskRepeat:"no-repeat",WebkitMaskPosition:"center",maskPosition:"center",WebkitMaskSize:"contain",maskSize:"contain",userSelect:"none",pointerEvents:"none",zIndex:0}}></div>
    <style>{`
      *{box-sizing:border-box;margin:0;padding:0;}
      html,body{background:${T.bg};-webkit-tap-highlight-color:transparent;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;}
      ::-webkit-scrollbar{width:8px;height:8px;background:transparent;}
      ::-webkit-scrollbar-thumb{background:${T.border};border-radius:4px;}
      ::-webkit-scrollbar-thumb:hover{background:${T.borderHi};}
      @keyframes blink{0%,100%{opacity:1}50%{opacity:0.25}}
      @keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
      .trow:hover td{background:${T.surface}!important;}
      input:focus,select:focus,textarea:focus{border-color:${T.blue}!important;outline:none;box-shadow:0 0 0 3px ${T.blue}22;}
      .page{animation:fadeUp 0.22s cubic-bezier(.34,1.56,.64,1) forwards;}
      .dock-off:hover{transform:translateY(-2px);background:${T.card}!important;color:${T.textHi}!important;}
      .dock-on:hover{transform:translateY(-2px) scale(1.02);}
      button:not(:disabled){transition:all 0.15s ease;}

      /* Design-system primitives. Used by KV stat cards, buttons, inputs. */
      .kv-card:hover{border-color:${T.borderHi}!important;transform:translateY(-1px);box-shadow:var(--sh-md);}
      .bento-tile{position:relative;}
      .bento-tile:hover{border-color:${T.borderHi}!important;box-shadow:var(--mz-tile-hover)!important;transform:translateY(-1px);}
      .bento-tile--click:hover{transform:translateY(-2px) scale(1.003);}
      .bento-tile--click:active{transform:translateY(0) scale(0.998);box-shadow:var(--sh-sm)!important;}
      @media (max-width: 900px) {
        .bento-row { grid-template-columns: 1fr !important; }
        /* Disable lift on touch devices — no hover intent */
        .bento-tile:hover{transform:none;}
      }
      .btn-primary{background:linear-gradient(135deg,${T.blue},${T.blueDim});color:#faf8f4;border:none;font-family:${FM};font-size:11px;font-weight:600;letter-spacing:0.04em;padding:8px 16px;border-radius:var(--r-md);cursor:pointer;box-shadow:0 2px 10px ${T.blue}40;transition:transform 0.15s,box-shadow 0.2s;}
      .btn-primary:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 4px 14px ${T.blue}66;}
      .btn-primary:active:not(:disabled){transform:translateY(0);box-shadow:0 1px 6px ${T.blue}40;}
      .btn-primary:disabled{opacity:0.55;cursor:not-allowed;box-shadow:none;}
      .btn-ghost{background:transparent;color:${T.text};border:1px solid ${T.border};font-family:${FM};font-size:11px;font-weight:500;letter-spacing:0.04em;padding:7px 14px;border-radius:var(--r-md);cursor:pointer;transition:border-color 0.15s,background 0.15s,color 0.15s;}
      .btn-ghost:hover:not(:disabled){border-color:${T.borderHi};background:${T.surface};color:${T.textHi};}
      .btn-danger{background:transparent;color:${T.loss};border:1px solid ${T.loss}40;font-family:${FM};font-size:11px;font-weight:500;letter-spacing:0.04em;padding:7px 14px;border-radius:var(--r-md);cursor:pointer;transition:all 0.15s;}
      .btn-danger:hover:not(:disabled){background:${T.loss}10;border-color:${T.loss}80;}
      .field{background:${T.surface};border:1px solid ${T.border};border-radius:var(--r-md);padding:9px 12px;font-family:${FM};font-size:12px;color:${T.text};outline:none;width:100%;box-sizing:border-box;transition:border-color 0.15s,box-shadow 0.15s;}
      .field:focus{border-color:${T.blue};box-shadow:0 0 0 3px ${T.blue}22;}

      /* TabBar — keep horizontal scrolling but hide the scrollbar so it
         doesn't look broken on iPhone Safari. Tabs stay reachable via swipe. */
      .mz-tabbar {
        scrollbar-width: none;
        -ms-overflow-style: none;
        scroll-snap-type: x proximity;
        scroll-padding-left: 6px;
        position: relative;
      }
      .mz-tabbar::-webkit-scrollbar { display: none; }
      .mz-tabbar > button { scroll-snap-align: start; }
      /* Right-edge fade so users see there's more to scroll on narrow screens.
         Pure background gradient that doesn't intercept clicks. */
      .mz-tabbar-wrap {
        position: relative;
      }
      .mz-tabbar-wrap::after {
        content: "";
        position: absolute;
        top: 0; right: 0; bottom: 0;
        width: 36px;
        pointer-events: none;
        background: linear-gradient(to right, transparent, ${T.card});
        border-radius: 0 var(--r-lg) var(--r-lg) 0;
        opacity: 0;
        transition: opacity 0.2s;
      }
      @media (max-width: 720px) {
        .mz-tabbar-wrap::after { opacity: 1; }
        .mz-tabbar > button {
          padding: 11px 16px !important;
          font-size: 13px !important;
          min-height: 40px;
        }
      }

      /* Mobile / tablet responsive rules */
      @media (max-width: 900px) {
        .mz-hide-md{display:none!important;}
        .mz-grid-5{grid-template-columns:repeat(2,1fr)!important;}
        .mz-grid-4{grid-template-columns:repeat(2,1fr)!important;}
        .mz-grid-3{grid-template-columns:repeat(2,1fr)!important;}
        .mz-side-by-side{grid-template-columns:1fr!important;height:auto!important;}
        .mz-table-scroll{overflow-x:auto!important;}
        .mz-form-row{grid-template-columns:1fr 1fr!important;}
        main{padding-left:16px!important;padding-right:16px!important;padding-bottom:calc(120px + env(safe-area-inset-bottom,0px))!important;}
      }
      @media (max-width: 600px) {
        .mz-hide-sm{display:none!important;}
        .mz-grid-5{grid-template-columns:1fr!important;}
        .mz-grid-4{grid-template-columns:1fr!important;}
        .mz-grid-3{grid-template-columns:1fr!important;}
        .mz-grid-2{grid-template-columns:1fr!important;}
        .mz-form-row{grid-template-columns:1fr!important;}
        .mz-dock{padding:4px!important;gap:2px!important;border-radius:14px!important;bottom:calc(10px + env(safe-area-inset-bottom,0px))!important;left:8px!important;right:8px!important;transform:none!important;justify-content:space-around;}
        .mz-dock button{padding:8px 6px!important;font-size:10px!important;border-radius:10px!important;flex:1;letter-spacing:0.02em!important;min-height:44px;}
        .mz-status{padding:0 12px!important;gap:8px!important;}
        .mz-status-mid{display:none!important;}
        .mz-status-right{gap:4px!important;}
        .mz-status-right button{padding:5px 8px!important;font-size:9px!important;min-height:40px;}
        .mz-status-sync{padding:6px 10px!important;font-size:10px!important;}
        .mz-page-content{padding-bottom:calc(130px + env(safe-area-inset-bottom,0px))!important;}
      }

      /* ── Safe-area insets ─────────────────────────────────────── */
      /* Status bar: extend height by notch/Dynamic Island inset */
      .mz-status{
        padding-top:env(safe-area-inset-top,0px);
        min-height:calc(48px + env(safe-area-inset-top,0px))!important;
      }
      /* Dock: lift above home indicator on iPhone */
      .mz-dock{bottom:calc(var(--s-5) + env(safe-area-inset-bottom,0px))!important;}

      /* ── Overflow prevention ──────────────────────────────────── */
      /* Use clip on html only — overflow-x:hidden on body breaks iOS WebKit
         inner horizontal scroll containers (e.g. the Settings TabBar). */
      html{overflow-x:clip;}
      /* Ensure the TabBar scroll container is properly bounded by its parent.
         Without width:100%, a display:flex container can size to its content
         and push past the viewport on some layout contexts. */
      .mz-tabbar-wrap{overflow:hidden;width:100%;}
      .mz-tabbar{width:100%;}

      /* ── Responsive card tables ──────────────────────────────── */
      /* Desktop: normal table visible, card list hidden */
      .mz-tbl-mobile{display:none;}
      /* Mobile: swap to card list */
      @media(max-width:640px){
        .mz-tbl-desktop{display:none!important;}
        .mz-tbl-mobile{display:flex;flex-direction:column;gap:8px;}
      }

      /* ── Touch targets ───────────────────────────────────────── */
      @media(max-width:640px){
        /* min-height only — don't force padding so custom button styles survive */
        .btn-primary,.btn-ghost,.btn-danger{min-height:44px;}
        /* Prevent iOS auto-zoom on input focus (requires font-size >= 16px) */
        .field{font-size:16px!important;}
        input,select,textarea{font-size:16px!important;}
      }

      /* ── CommandPalette mobile: full-width sheet ─────────────── */
      @media(max-width:640px){
        /* The palette card inside the fixed overlay */
        .mz-palette-card{max-width:100%!important;border-radius:20px 20px 0 0!important;}
        /* Shift the overlay align to flex-end so it slides up from bottom */
        .mz-palette-overlay{align-items:flex-end!important;padding-top:0!important;}
      }
    `}</style>

    {/* TOP BAR */}
    {/* STATUS BAR — slim, glanceable, single row. Brand left, info middle, actions right. */}
    <header className="mz-status glass" style={{minHeight:"calc(48px + env(safe-area-inset-top, 0px))",padding:`env(safe-area-inset-top, 0px) ${T.s5} 0`,borderBottom:`1px solid var(--mz-glass-border)`,display:"flex",alignItems:"center",gap:T.s4,position:"sticky",top:0,zIndex:100}}>
      <div style={{display:"flex",alignItems:"center",gap:T.s2,flexShrink:0}}>
        <img src={resolvedTheme==="dark"?"/mark-light.png":"/mark.png"} alt="" width={18} height={18} style={{display:"block",flexShrink:0}}/>
        <span style={{fontFamily:FU,fontSize:15,fontWeight:700,color:T.textHi,letterSpacing:"0.04em"}}>MĪZAN</span>
        <span style={{fontFamily:FM,fontSize:8,fontWeight:600,color:T.blue,letterSpacing:"0.18em",background:`${T.blue}18`,border:`1px solid ${T.blue}30`,padding:"3px 7px",borderRadius:999}}>HALAL</span>
      </div>

      {/* Center: live status — clock, market, data freshness */}
      <div className="mz-status-mid" style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:14,fontFamily:FM,fontSize:10}}>
        <div style={{display:"flex",alignItems:"center",gap:6}} title={`Local ${nyc.localDisplay} · NYC ${nyc.wd} ${nyc.time} ET · Market ${nyc.status}${nyc.countdown?` · ${nyc.nextEvent} in ${nyc.countdown}`:""}`}>
          <LiveDot on={hr>=4&&hr<20} pulse={hr>=9.5&&hr<16}/>
          <span style={{color:T.muted,fontSize:9}}>{nyc.wd}</span>
          <span style={{color:T.text,letterSpacing:"0.04em",fontVariantNumeric:"tabular-nums"}}>{nyc.localDisplay}</span>
          <span style={{color:T.dim}}>/</span>
          <span style={{color:T.text,letterSpacing:"0.04em",fontVariantNumeric:"tabular-nums"}}>{nyc.time} ET</span>
          <span style={{color:T.muted}}>·</span>
          <span style={{color:sessionColor,fontWeight:500}}>{sessionLabel}</span>
          {nyc.countdown&&<span style={{color:T.muted,fontSize:9}}>· {nyc.nextEvent} {nyc.countdown}</span>}
        </div>
        <span style={{color:T.dim}}>|</span>
        <span style={{color:isLive?T.gain:T.muted,fontVariantNumeric:"tabular-nums"}}>{fetching?"Syncing…":isLive?`${live.length} live`:"No live data"}</span>
        {snapAccounts.length>0&&<>
          <span style={{color:T.dim}}>|</span>
          <span style={{color:demoMode?T.gold:T.blue,fontWeight:500}}>{demoMode?"DEMO":`${snapAccounts.reduce((s,a)=>s+a.positions.length,0)} positions`}</span>
        </>}
        {lastSync&&<>
          <span style={{color:T.dim}}>|</span>
          <span style={{color:T.muted}}>last sync {lastSync.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</span>
        </>}
      </div>

      {/* Right: compact action toggles + sync */}
      <div className="mz-status-right" style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
        <button onClick={cycleTheme} title={`Theme: ${themeMode} (resolved: ${resolvedTheme}).`} style={{display:"inline-flex",alignItems:"center",justifyContent:"center",color:T.muted,padding:"5px 9px",background:"transparent",border:`1px solid ${T.border}`,borderRadius:8,cursor:"pointer",minWidth:30,lineHeight:1}}><Icon name={(themeMode==="auto"?resolvedTheme:themeMode)==="dark"?"moon":"sun"} size={14}/></button>
        {(!hasRealData||demoMode)&&<button onClick={toggleDemo} title="Toggle demo data (fictional 8-figure book)" style={{fontFamily:FM,fontSize:9,color:demoMode?T.gold:T.muted,padding:"5px 10px",letterSpacing:"0.06em",background:demoMode?`${T.gold}14`:"transparent",border:`1px solid ${demoMode?T.gold+"40":T.border}`,borderRadius:8,cursor:"pointer"}}>DEMO</button>}
        <button onClick={()=>setAuto(v=>!v)} title={`Auto-sync ${auto?"on":"off"}`} style={{fontFamily:FM,fontSize:9,color:auto?T.gain:T.muted,padding:"5px 10px",letterSpacing:"0.06em",background:auto?`${T.gain}14`:"transparent",border:`1px solid ${auto?T.gain+"40":T.border}`,borderRadius:8,cursor:"pointer"}}>{auto?"AUTO":"AUTO"}</button>
        <button onClick={()=>setConn(true)} className="btn-ghost">+ Connect</button>
        {snapAccounts.length>0&&(()=>{
          const cooldownLeft=Math.max(0,forceCooldownUntil-Date.now());
          const cooling=cooldownLeft>0;
          const mins=Math.ceil(cooldownLeft/60000);
          const disabled=forceBusy||cooling||fetching;
          const label=forceBusy?"⟳…":cooling?`⟳ ${mins}m`:"⟳ Force";
          const title=cooling?`Broker refresh on cooldown — try again in ${mins} min`:"Push a refresh signal to SnapTrade so balances + activity catch up to what your brokerage shows.";
          return<button onClick={forceRefresh} disabled={disabled} title={title} style={{fontFamily:FM,fontSize:11,fontWeight:500,letterSpacing:"0.04em",padding:`7px ${T.s3}`,borderRadius:T.rMd,border:`1px solid ${cooling?T.border:T.gold+"40"}`,background:cooling?"transparent":`${T.gold}14`,color:disabled?T.muted:T.gold,cursor:disabled?"not-allowed":"pointer",transition:"all 0.15s"}}>{label}</button>;
        })()}
        {installEvt&&!isInstalled&&<button onClick={doInstall} className="btn-ghost mz-hide-sm" title="Install MĪZAN as an app on this device" style={{display:"inline-flex",alignItems:"center",gap:5,fontFamily:FM,fontSize:9,letterSpacing:"0.06em"}}><Icon name="download" size={11}/>Install</button>}
        <button onClick={sync} disabled={fetching} className="btn-primary mz-status-sync">{fetching?"Syncing…":"Sync All"}</button>
      </div>
      {forceMsg&&<div style={{position:"absolute",top:"calc(env(safe-area-inset-top, 0px) + 50px)",right:T.s3,background:"var(--mz-glass-strong)",backdropFilter:"blur(20px) saturate(160%)",WebkitBackdropFilter:"blur(20px) saturate(160%)",border:`1px solid ${forceMsg.ok?T.gain+"40":T.loss+"40"}`,color:forceMsg.ok?T.gain:T.loss,padding:`${T.s2} ${T.s3}`,borderRadius:T.rMd,fontFamily:FM,fontSize:11,boxShadow:"var(--mz-glass-shadow)",zIndex:101,maxWidth:340,animation:"glassFadeUp 0.2s cubic-bezier(.34,1.56,.64,1)"}}>{forceMsg.msg}</div>}
    </header>

    {/* Pull-to-refresh indicator — appears above status bar when dragging down from top */}
    {ptrActive&&<div style={{
      position:"fixed",top:`calc(48px + env(safe-area-inset-top,0px) + 8px)`,
      left:"50%",transform:"translateX(-50%)",zIndex:95,
      background:"var(--mz-glass)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",
      border:"1px solid var(--mz-glass-border)",borderRadius:999,
      padding:"6px 16px",fontFamily:FM,fontSize:11,color:ptrReady?T.blue:T.muted,
      boxShadow:"var(--mz-glass-shadow)",whiteSpace:"nowrap",pointerEvents:"none",
      transition:"color 0.15s",
    }}>{ptrReady?"↑ Release to refresh":"↓ Pull to refresh"}</div>}

    <main style={{position:"relative",zIndex:1,maxWidth:1320,margin:"0 auto",padding:`24px 24px calc(110px + env(safe-area-inset-bottom, 0px))`}}>
      <div className="page">
        {nav==="overview"  &&<Overview  live={live} snapAccounts={visibleAccounts} allAccounts={snapAccounts} plaidAccounts={plaidAccounts} disabledAccts={disabledAccts} onToggleAcct={toggleAcctEnabled} onDisconnectAcct={disconnectAccount} mapPosition={mapPosition} metrics={performanceMetrics} activities={snapActivities} netWorthHistory={netWorthHistory} onNav={setNav} onConnect={()=>setConn(true)} onToggleDemoFromBanner={toggleDemo} bankBalance={bankBalance} nicknames={nicknames} onSetNickname={onSetNickname} demoMode={demoMode} pendingSignals={pendingSignals}/>}
        {nav==="finances"  &&<Finances onBankBalanceChange={setBankBalance} demoMode={demoMode} onNav={setNav} nicknames={nicknames} onSetNickname={onSetNickname}/>}
        {nav==="portfolio" &&<Portfolio live={live} snapAccounts={visibleAccounts} mapPosition={mapPosition} activities={snapActivities} botFills={botFills} documents={snapDocuments} watchlist={watchlist} onAddWatch={addToWatchlist} onRemoveWatch={removeFromWatchlist} onSetAlert={setAlert} onAlertPermission={requestAlertPermission} demoMode={demoMode} onNav={setNav} onConnect={()=>{setConnMode("read");setConn(true);}} bankBalance={bankBalance}/>}
        {nav==="trade"     &&<TradeBot currentNW={visibleAccounts.reduce((s,a)=>s+(a.balance||0),0)} ytdContrib={performanceMetrics.ytdContrib||0} accounts={visibleAccounts} live={live} mapPosition={mapPosition} activities={snapActivities} onNav={setNav} onConnectTrade={()=>{setConnMode("trade");setConn(true);}} isAdmin={isAdmin} fullAutoEnabled={fullAutoEnabled} isRoot={botIsRoot} consented={botConsented} demoMode={demoMode}/>}
        {nav==="goals"     &&<GoalsHub
          snapAccounts={visibleAccounts}
          plaidAccounts={plaidAccounts}
          netWorthHistory={netWorthHistory}
          demoMode={demoMode}
          currentNW={visibleAccounts.reduce((s,a)=>s+(a.balance||0),0)}
          ytdContrib={performanceMetrics.ytdContrib||0}
          bankBalance={bankBalance}
          onConnect={()=>{setConnMode("read");setConn(true);}}
        />}
        {nav==="advisor"   &&<AIAdvisor accounts={visibleAccounts} activities={snapActivities} metrics={performanceMetrics} hasKey={true}/>}
        {nav==="settings"  &&<Settings  apiKeys={apiKeys} setApiKeys={setApiKeys} onConnect={()=>{setConnMode("read");setConn(true);}} onConnectTrade={()=>{setConnMode("trade");setConn(true);}} isAdmin={isAdmin} onImportCSV={importCSV} onDedupeCSV={dedupeImports} onRetagCSV={retagImports} onReplayOnboarding={replayOnboarding} demoMode={demoMode} onToggleDemo={toggleDemo} documents={snapDocuments} accounts={visibleAccounts} plaidAccounts={plaidAccounts} bankBalance={bankBalance} onNav={setNav}/>}
      </div>
    </main>

    {/* iOS Safari install hint — one-time, dismissible, shown only on
        iOS Safari outside standalone mode (no beforeinstallprompt on iOS). */}
    {isIosSafari&&!isInstalled&&!iosHintDismissed&&<div style={{
      position:"fixed",bottom:`calc(80px + env(safe-area-inset-bottom,0px))`,
      left:"50%",transform:"translateX(-50%)",zIndex:89,
      background:"var(--mz-glass-strong)",backdropFilter:"blur(20px) saturate(160%)",WebkitBackdropFilter:"blur(20px) saturate(160%)",
      border:"1px solid var(--mz-glass-border)",borderRadius:T.rLg,
      padding:`${T.s3} ${T.s4}`,display:"flex",alignItems:"center",gap:T.s3,
      boxShadow:"var(--mz-glass-shadow)",maxWidth:"calc(100vw - 32px)",
      animation:"glassFadeUp 0.25s cubic-bezier(.34,1.56,.64,1)",
    }}>
      <Icon name="arrowUp" size={18} color={T.blue}/>
      <div style={{flex:1}}>
        <div style={{fontFamily:FM,fontSize:11,fontWeight:600,color:T.textHi,marginBottom:2}}>Install MĪZAN</div>
        <div style={{fontFamily:FP,fontSize:11,color:T.muted}}>Tap Share → "Add to Home Screen"</div>
      </div>
      <button onClick={dismissIosHint} style={{background:"transparent",border:"none",color:T.muted,cursor:"pointer",fontSize:16,padding:T.s2,minHeight:44,minWidth:44,display:"flex",alignItems:"center",justifyContent:"center"}}><Icon name="close" size={16}/></button>
    </div>}

    {/* DOCK — Mac-style floating nav at the bottom. Glass surface, rounded
        pill, lifted with shadow. Active item highlighted with accent gradient. */}
    <nav className="mz-dock" style={{
      position:"fixed",bottom:"calc(env(safe-area-inset-bottom, 0px) + 20px)",left:"50%",transform:"translateX(-50%)",
      display:"flex",alignItems:"center",gap:T.s1,
      padding:`${T.s1} ${T.s2}`,
      background:"var(--mz-glass)",
      backdropFilter:"blur(28px) saturate(190%)",
      WebkitBackdropFilter:"blur(28px) saturate(190%)",
      border:"1px solid var(--mz-glass-border)",
      borderRadius:999,
      boxShadow:"inset 0 1px 0 rgba(255,255,255,0.09), inset 0 -1px 0 rgba(0,0,0,0.22), 0 20px 60px rgba(0,0,0,0.55), 0 4px 16px rgba(0,0,0,0.30)",
      zIndex:90,
    }}>
      {NAV.map(n=>{
        const active=nav===n.id;
        return<button key={n.id} onClick={()=>setNav(n.id)} className={active?"dock-on":"dock-off"} style={{
          padding:`10px ${T.s4}`,
          background:active?`linear-gradient(135deg, ${T.blue}, ${T.blueDim})`:"transparent",
          border:"none",
          borderRadius:999,
          color:active?"#fff":T.text,
          fontFamily:FP,fontSize:12,fontWeight:active?600:500,
          letterSpacing:"-0.005em",
          cursor:"pointer",
          transition:"all 0.18s cubic-bezier(.34,1.56,.64,1)",
          boxShadow:active?`0 6px 18px ${T.blue}60`:"none",
        }}>{n.l}</button>;
      })}
      {/* Optional, user-triggered tour launcher (not a forced walkthrough). */}
      <button onClick={()=>setTourOpen(true)} title="Take a tour" aria-label="Take a tour" className="dock-off" style={{
        width:36,height:36,padding:0,marginLeft:T.s1,flexShrink:0,
        display:"flex",alignItems:"center",justifyContent:"center",
        background:"transparent",border:"1px solid var(--mz-glass-border)",borderRadius:999,
        color:T.text,fontFamily:FM,fontSize:14,fontWeight:600,cursor:"pointer",
        transition:"all 0.18s cubic-bezier(.34,1.56,.64,1)",
      }}>?</button>
    </nav>

    {showConn&&<ConnectModal onClose={()=>{setConn(false);setConnMode("read");}} snapId={apiKeys.snapId} connectionType={connMode} onConnected={()=>{
      // Pull the new account into state IMMEDIATELY so every tab/sub-tab reflects
      // it right away — even a cash-only account with zero holdings. forceRefresh
      // then asks the broker to re-pull positions (which can lag ~15-30s).
      try{ fetchSnapHoldings(); }catch{}
      try{ forceRefresh(); }catch{}
    }}/>}

    {/* Always-on bug-report affordance. Self-positioned bottom-right above
        the dock; also listens for the "mizan:open-bug-report" custom event
        so the About panel link can pop the same modal. */}
    <BugReportButton/>

    {/* Keyboard shortcuts + command palette. Both global at the root so
        every nav target and action is one keystroke away. */}
    <KeyboardShortcuts
      onNav={setNav}
      onSync={sync}
      onConnect={()=>setConn(true)}
      onHelp={()=>setShortcutHelpOpen(true)}
      onCommand={()=>palette.setOpen(true)}
      isAdmin={isAdmin}
    />
    <ShortcutHelp
      open={shortcutHelpOpen}
      onClose={()=>setShortcutHelpOpen(false)}
      shortcuts={isAdmin?SHORTCUT_REFERENCE:Object.fromEntries(Object.entries(SHORTCUT_REFERENCE).filter(([k])=>k!=="g t"))}
    />
    <FeatureTour open={tourOpen} onClose={()=>setTourOpen(false)} onNav={setNav}/>
    <CommandPalette
      open={palette.open}
      onClose={palette.close}
      commands={[
        // Navigate
        {id:"nav-overview", label:"Go to Overview",      group:"Navigate", hint:"g o", icon:"◎", action:()=>setNav("overview")},
        {id:"nav-portfolio",label:"Go to Portfolio",     group:"Navigate", hint:"g p", icon:"▣", action:()=>setNav("portfolio")},
        {id:"nav-finances", label:"Go to Finances",      group:"Navigate", hint:"g f", icon:"$", action:()=>setNav("finances")},
        {id:"nav-goals",    label:"Go to Goals",         group:"Navigate", hint:"g g", icon:"◉", action:()=>setNav("goals")},
        {id:"nav-advisor",  label:"Go to AI Advisor",    group:"Navigate", hint:"g a", icon:<Icon name="spark" size={14}/>, action:()=>setNav("advisor")},
        {id:"nav-settings", label:"Go to Settings",      group:"Navigate", hint:"g s", icon:<Icon name="gear" size={14}/>, action:()=>setNav("settings")},
        ...(isAdmin?[{id:"nav-trade",label:"Go to Trade",group:"Navigate",hint:"g t",icon:<Icon name="hexagon" size={14}/>,action:()=>setNav("trade")}]:[]),
        // Actions
        {id:"act-sync",     label:"Sync All",            group:"Actions",  hint:"r",   icon:"↻", action:()=>sync()},
        {id:"act-connect",  label:"Connect Account",     group:"Actions",  icon:"+",             action:()=>setConn(true)},
        {id:"act-demo",     label:demoMode?"Disable demo mode":"Enable demo mode", group:"Actions", icon:"◧", action:()=>toggleDemo()},
        {id:"act-help",     label:"Keyboard shortcuts",  group:"Actions",  hint:"?",   icon:<Icon name="keyboard" size={14}/>, action:()=>setShortcutHelpOpen(true)},
        {id:"act-tour",     label:"Take a tour",         group:"Actions",  icon:"◎",             action:()=>setTourOpen(true)},
      ]}
      onSelect={()=>{/* command.action already fired in the palette */}}
    />

    {/* Onboarding. Auto-shows for fresh users (no brokers connected); the
        Settings "Replay tour" button sets onboardingForce so existing users
        can run the tour again. Always suppressed in single-user pass-through
        and demo mode. */}
    {!onboardingDismissed
      &&authUser?.id&&authUser.id!=="single-user"
      &&!demoMode
      &&(onboardingForce||snapAccounts.length===0)
      &&<OnboardingFlow
          snapAccountsLen={snapAccounts.length}
          onConnect={()=>setConn(true)}
          onImportCSV={importCSV}
          onComplete={()=>{setOnboardingDismissed(true);setOnboardingForce(false);}}
          onNav={setNav}
          resolvedTheme={resolvedTheme}
        />}
  </div>;
}
