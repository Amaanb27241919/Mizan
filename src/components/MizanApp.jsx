import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { AreaChart, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useAuth } from "../lib/auth.jsx";
import { apiFetch, recordAudit } from "../lib/apiFetch.js";
import { persistUserState } from "../lib/userState.js";
import { downloadCSV } from "../lib/exportCSV.js";
import { useKeyboard, ShortcutHelp } from "../lib/useKeyboard.js";
import { CommandPalette, useCommandPalette } from "./CommandPalette.jsx";
import { Skeleton, SkeletonCard, SkeletonTable } from "./Skeleton.jsx";
import Goals from "./Goals.jsx";
import ComingSoon from "./ComingSoon.jsx";
import ConnectionHealth from "./ConnectionHealth.jsx";
import BugReportButton from "./BugReportButton.jsx";

/* ─── DESIGN TOKENS ──────────────────────────────────── */
// Savium-inspired palette: deep navy base, vibrant purple primary, soft
// coral for highlights, soft red for warnings/losses. Theme-variable colors
// live as CSS vars; accent hexes stay constant across light/dark.
// `T.blue` and `T.gold` keep their property names for codebase stability —
// values shifted to the new direction.
const T = {
  bg:"var(--mz-bg)", surface:"var(--mz-surface)", card:"var(--mz-card)",
  border:"var(--mz-border)", borderHi:"var(--mz-borderHi)",
  blue:"#7B61FF", blueDim:"#5A3FE0",        // vibrant purple (primary)
  gold:"#FF9F6A", goldDim:"#D9764A",        // soft coral (secondary)
  gain:"#10B981", gainBg:"var(--mz-gainBg)",
  loss:"#FF6B6B", lossBg:"var(--mz-lossBg)", // soft red
  text:"var(--mz-text)", textHi:"var(--mz-textHi)",
  muted:"var(--mz-muted)", dim:"var(--mz-dim)",
  // Surface effects (theme-variable)
  shadow:"var(--mz-shadow)", glass:"var(--mz-glass)",
  // Token shortcuts (resolve to CSS vars set in THEME_CSS).
  s1:"var(--s-1)", s2:"var(--s-2)", s3:"var(--s-3)", s4:"var(--s-4)",
  s5:"var(--s-5)", s6:"var(--s-6)", s8:"var(--s-8)", s10:"var(--s-10)",
  s12:"var(--s-12)",
  rSm:"var(--r-sm)", rMd:"var(--r-md)", rLg:"var(--r-lg)",
};
const THEME_CSS = `
  :root, :root[data-theme="dark"] {
    --mz-bg: #0B0F1E; --mz-surface: #141930; --mz-card: #1A1F35;
    --mz-border: #252B40; --mz-borderHi: #353C55;
    --mz-text: #C5CCDE; --mz-textHi: #ECEFF7;
    --mz-muted: #6F7997; --mz-dim: #252B40;
    --mz-gainBg: #0A1F18; --mz-lossBg: #1F1015;
    --mz-shadow: 0 1px 0 rgba(255,255,255,0.03) inset, 0 8px 28px rgba(0,0,0,0.5);
    --mz-glass: rgba(20,25,48,0.72);
    color-scheme: dark;
  }
  :root[data-theme="light"] {
    --mz-bg: #F6F7FB; --mz-surface: #FFFFFF; --mz-card: #FFFFFF;
    --mz-border: #E2E6EE; --mz-borderHi: #C6CCD9;
    --mz-text: #1F2540; --mz-textHi: #0B0F1E;
    --mz-muted: #6F7997; --mz-dim: #EEF0F5;
    --mz-gainBg: #F0FBF4; --mz-lossBg: #FFF1F1;
    --mz-shadow: 0 1px 0 rgba(255,255,255,0.6) inset, 0 6px 20px rgba(15,18,30,0.06);
    --mz-glass: rgba(255,255,255,0.78);
    color-scheme: light;
  }
  /* Spacing scale — 4 px base. Reach for these instead of magic numbers
     when laying out new surfaces; existing inline styles can adopt them
     incrementally. */
  :root {
    --s-1: 4px;  --s-2: 8px;  --s-3: 12px; --s-4: 16px;
    --s-5: 20px; --s-6: 24px; --s-8: 32px; --s-10: 40px;
    --s-12: 48px;
    --r-sm: 6px; --r-md: 10px; --r-lg: 14px;
    --sh-sm: 0 1px 2px rgba(0,0,0,0.08);
    --sh-md: 0 4px 14px rgba(0,0,0,0.18);
    --sh-lg: 0 12px 36px rgba(0,0,0,0.32);
  }
`;
// SF Pro Display + SF Mono are first-party on macOS / iOS; on other
// platforms fall back to the platform UI stack (Segoe UI on Windows,
// Roboto on Android, system sans elsewhere). Avoid the Google-Fonts
// preconnect entirely — CSP no longer needs to allow it for fonts.
const FU = "'SF Pro Display','SF Pro Text',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
const FM = "'SF Mono',ui-monospace,'JetBrains Mono','Menlo','Monaco',monospace";
const GF = ""; // unused — kept as an export shim in case other code references it.

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
  { accountId:"d-fid-conc", accountName:"Concentrated Equity", brokerage:"Fidelity", brokerageSlug:"FIDELITY",
    balance:4_182_640.55, cash:62_400.00, positions:[
      _pos("AAPL", "Apple Inc.",                   8_200.0, 142.00, 289.48),
      _pos("MSFT", "Microsoft Corp.",              5_140.0, 275.00, 424.00),
      _pos("NVDA", "Nvidia Corp.",                 3_620.0,  88.00, 213.00),
      _pos("GOOGL","Alphabet Inc. Class A",        4_180.0, 138.00, 198.40),
      _pos("META", "Meta Platforms Inc.",          1_520.0, 360.00, 620.30),
    ] },
  { accountId:"d-jpm-pwm", accountName:"Wealth Management", brokerage:"J.P. Morgan Private Bank", brokerageSlug:"JPMORGAN",
    balance:11_842_500.20, cash:485_200.00, positions:[
      _pos("BRK.B","Berkshire Hathaway Class B",   12_400.0, 320.00, 462.50),
      _pos("COST", "Costco Wholesale Corp.",        2_640.0, 420.00, 882.10),
      _pos("HD",   "Home Depot Inc.",               3_180.0, 295.00, 410.20),
      _pos("ASML", "ASML Holding NV ADR",           1_240.0, 540.00,1_042.30),
      _pos("TSM",  "Taiwan Semiconductor ADR",      4_820.0, 185.00, 411.86),
      _pos("V",    "Visa Inc. Class A",             4_200.0, 220.00, 308.40),
    ] },
  { accountId:"d-schwab-trust", accountName:"Family Trust", brokerage:"Charles Schwab", brokerageSlug:"SCHWAB",
    balance:8_204_318.91, cash:120_400.00, positions:[
      _pos("VOO",  "Vanguard S&P 500 ETF",         12_400.0, 340.00, 522.40,"ETF"),
      _pos("QQQ",  "Invesco QQQ Trust",             6_200.0, 320.00, 482.10,"ETF"),
      _pos("SPUS", "SP Funds S&P 500 Sharia",      18_400.0,  44.20,  55.57,"ETF"),
      _pos("HLAL", "Wahed FTSE USA Shariah",       14_600.0,  58.00,  68.93,"ETF"),
    ] },
  { accountId:"d-vg-roth", accountName:"Roth IRA", brokerage:"Vanguard", brokerageSlug:"VANGUARD",
    balance:1_624_708.66, cash:14_200.00, positions:[
      _pos("VTI",  "Vanguard Total Stock Mkt ETF",  3_840.0, 180.00, 295.40,"ETF"),
      _pos("VXUS", "Vanguard Total Intl Stock",     8_200.0,  48.00,  62.18,"ETF"),
      _pos("AMAGX","Amana Growth Fund",             3_420.0,  88.00, 105.60,"Fund"),
    ] },
  { accountId:"d-rh-active", accountName:"Active Brokerage", brokerage:"Robinhood", brokerageSlug:"ROBINHOOD",
    balance:3_184_910.44, cash:42_600.00, positions:[
      _pos("TSLA", "Tesla Inc.",                    2_240.0, 210.00, 406.01),
      _pos("AMD",  "Advanced Micro Devices",        1_640.0, 140.00, 405.93),
      _pos("AVGO", "Broadcom Inc.",                   720.0, 280.00, 419.02),
      _pos("ARM",  "Arm Holdings",                    980.0, 108.00, 212.69),
      _pos("PLTR", "Palantir Technologies",         5_400.0,  38.00, 138.23),
      // Mixed compliance — non-halal positions surface in screener
      _pos("JPM",  "JPMorgan Chase & Co.",          1_240.0, 165.00, 248.30),
      _pos("WYNN", "Wynn Resorts Ltd.",               420.0, 110.00, 142.50),
      _pos("MO",   "Altria Group Inc.",             2_180.0,  42.00,  58.20),
      _pos("LCID", "Lucid Motors",                  4_240.0,  24.00,   6.06),
    ] },
  { accountId:"d-empower-401k", accountName:"401(k) Plan", brokerage:"Empower Retirement", brokerageSlug:"EMPOWER",
    balance:3_018_440.20, cash:18_400.00, positions:[
      _pos("VLXVX","Vanguard Target 2065",         30_400.0,  28.00,  43.82,"Fund"),
      _pos("VTSAX","Vanguard Total Stock Mkt Adm", 12_800.0,  92.00, 142.80,"Fund"),
    ] },
  { accountId:"d-cb-prime", accountName:"Crypto", brokerage:"Coinbase", brokerageSlug:"COINBASE",
    balance:1_842_580.00, cash:0, positions:[
      _pos("BTC",  "Bitcoin",                          18.420, 32_400.00, 82_400.00,"Crypto"),
      _pos("ETH",  "Ethereum",                        110.180,  1_640.00,  2_640.00,"Crypto"),
      _pos("SOL",  "Solana",                        1_240.000,     62.00,    180.40,"Crypto"),
    ] },
  { accountId:"d-ibkr-global", accountName:"Global Equity", brokerage:"Interactive Brokers", brokerageSlug:"IBKR",
    balance:5_104_220.18, cash:240_600.00, positions:[
      _pos("BABA", "Alibaba Group ADR",            22_400.0,  88.00, 142.30),
      _pos("TM",   "Toyota Motor ADR",              8_400.0, 165.00, 241.80),
      _pos("UL",   "Unilever PLC ADR",             14_600.0,  48.00,  62.40),
      _pos("LMT",  "Lockheed Martin Corp.",         1_240.0, 380.00, 562.10),
      _pos("NOW",  "ServiceNow Inc.",                 980.0, 420.00, 882.40),
    ] },
  { accountId:"d-schwab-ind", accountName:"Individual Brokerage", brokerage:"Charles Schwab", brokerageSlug:"SCHWAB",
    balance:1_482_316.40, cash:38_200.00, positions:[
      _pos("SCHD", "Schwab US Dividend ETF",        8_400.0,  72.00,  84.20,"ETF"),
      _pos("SCHB", "Schwab US Broad Market ETF",    6_200.0,  48.00,  62.40,"ETF"),
      _pos("UNH",  "UnitedHealth Group",              420.0, 480.00, 552.10),
      _pos("LIN",  "Linde plc",                       640.0, 360.00, 442.80),
      _pos("ABBV", "AbbVie Inc.",                     820.0, 138.00, 188.40),
    ] },
  { accountId:"d-vg-taxable", accountName:"Joint Taxable", brokerage:"Vanguard", brokerageSlug:"VANGUARD",
    balance:982_440.12, cash:9_800.00, positions:[
      _pos("VOO",  "Vanguard S&P 500 ETF",          1_240.0, 360.00, 522.40,"ETF"),
      _pos("VYM",  "Vanguard High Dividend Yield",  2_180.0,  92.00, 128.40,"ETF"),
      _pos("BND",  "Vanguard Total Bond Market",    4_240.0,  78.00,  72.10,"ETF"),
      _pos("VUG",  "Vanguard Growth ETF",             840.0, 240.00, 388.20,"ETF"),
    ] },
  { accountId:"d-webull-active", accountName:"Active Trading", brokerage:"Webull", brokerageSlug:"WEBULL",
    balance:284_910.66, cash:12_400.00, positions:[
      _pos("AMZN", "Amazon.com Inc.",                 480.0, 142.00, 218.40),
      _pos("CRM",  "Salesforce Inc.",                 320.0, 220.00, 308.20),
      _pos("SHOP", "Shopify Inc.",                    640.0,  62.00, 108.40),
      _pos("UBER", "Uber Technologies",               820.0,  48.00,  82.30),
      _pos("NET",  "Cloudflare Inc.",                 480.0,  64.00, 112.40),
    ] },
];
// Net ~$41M across 11 expanded accounts (Fidelity, JPM, Schwab ×2, Vanguard ×2, Robinhood, Empower, Coinbase, IBKR, Webull).
// Tag the demo's non-overlapping tickers so the screener doesn't show
// every position as "Review".
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

/* ─── DEMO BANK FIXTURES (Plaid stand-in) ────────────── */
// Mirrors DEMO_ACCOUNTS pattern — used to populate the Finances tab when
// demoMode is on. No real API calls needed; everything is local fixture.
// Cash profile sized to match the ~$41M brokerage demo: ~$2.6M total cash
// across private-banking, retail, HYSA, sweep, and business accounts.
const DEMO_BANK_ACCOUNTS = [
  // JPMorgan Private Client — primary banking relationship
  { item_id:"d-jpm",   institution_name:"JPMorgan Private Client", account_id:"d-jpm-1", name:"Private Client Checking", official_name:"JPM Private Client Checking", type:"depository", subtype:"checking", mask:"0142", current_bal:184_620.55, available_bal:184_620.55, iso_currency:"USD" },
  { item_id:"d-jpm",   institution_name:"JPMorgan Private Client", account_id:"d-jpm-2", name:"Premier Savings",         official_name:"JPM Premier Plus Savings",    type:"depository", subtype:"savings",  mask:"5588", current_bal:1_240_820.00, available_bal:1_240_820.00, iso_currency:"USD" },
  // Chase — day-to-day spending
  { item_id:"d-chase", institution_name:"Chase",                   account_id:"d-chase-1", name:"Total Checking",        official_name:"Chase Total Checking",         type:"depository", subtype:"checking", mask:"4421", current_bal:42_180.32, available_bal:42_180.32, iso_currency:"USD" },
  { item_id:"d-chase", institution_name:"Chase",                   account_id:"d-chase-2", name:"Sapphire Reserve",      official_name:"Chase Sapphire Reserve",       type:"credit",     subtype:"credit card",mask:"3344", current_bal:4_287.45,  available_bal:45_712.55, iso_currency:"USD" },
  // Marcus — high-yield reserve
  { item_id:"d-marcus",institution_name:"Marcus by Goldman",       account_id:"d-marcus-1",name:"High-Yield Savings",    official_name:"Marcus HYSA",                  type:"depository", subtype:"savings",  mask:"7733", current_bal:842_500.20, available_bal:842_500.20, iso_currency:"USD" },
  // Fidelity Cash Management — sweep
  { item_id:"d-fid",   institution_name:"Fidelity",                account_id:"d-fid-1",   name:"Cash Management",       official_name:"Fidelity CMA",                 type:"depository", subtype:"checking", mask:"9012", current_bal:312_440.10, available_bal:312_440.10, iso_currency:"USD" },
  // Mercury — business banking for Halal Bites LLC
  { item_id:"d-merc",  institution_name:"Mercury",                 account_id:"d-merc-1",  name:"Halal Bites LLC",       official_name:"Mercury Business Checking",    type:"depository", subtype:"checking", mask:"6720", current_bal:128_620.40, available_bal:128_620.40, iso_currency:"USD" },
];

const DEMO_TRANSACTIONS = (() => {
  const today = new Date();
  const dt = (n) => { const d = new Date(today); d.setDate(today.getDate() - n); return d.toISOString().slice(0, 10); };
  // account_id → item_id + institution lookup so we don't string-sniff prefixes.
  const acctMeta = {
    "d-jpm-1":   { item_id:"d-jpm",   inst:"JPMorgan Private Client" },
    "d-jpm-2":   { item_id:"d-jpm",   inst:"JPMorgan Private Client" },
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
    // Consulting / advisory income — JPM Private Client checking
    T_( 1, "d-jpm-1",    2, "WIRE IN — CONSULTING RETAINER",-42_000.00, "INCOME",      "Strategic Advisory"),
    T_( 2, "d-jpm-1",   18, "WIRE IN — CONSULTING RETAINER",-42_000.00, "INCOME",      "Strategic Advisory"),
    T_( 3, "d-jpm-1",   48, "WIRE IN — CONSULTING RETAINER",-42_000.00, "INCOME",      "Strategic Advisory"),
    // Rental income (from the demo's Investment Property)
    T_( 4, "d-jpm-1",    5, "RENT — CONDO TENANT ACH",      -2_400.00,  "INCOME",      "Tenant"),
    T_( 5, "d-jpm-1",   35, "RENT — CONDO TENANT ACH",      -2_400.00,  "INCOME",      "Tenant"),
    T_( 6, "d-jpm-1",   65, "RENT — CONDO TENANT ACH",      -2_400.00,  "INCOME",      "Tenant"),
    // Business distribution from Halal Bites LLC (Mercury → JPM)
    T_( 7, "d-jpm-1",   12, "HALAL BITES DISTRIBUTION",     -18_500.00, "INCOME",      "Halal Bites LLC"),
    T_( 8, "d-jpm-1",   72, "HALAL BITES DISTRIBUTION",     -22_400.00, "INCOME",      "Halal Bites LLC"),
    // Brokerage dividend sweep (Fidelity CMA receives quarterly dividends)
    T_( 9, "d-fid-1",    8, "FIDELITY DIVIDEND SWEEP",      -8_482.40,  "INCOME",      "Fidelity"),
    T_(10, "d-fid-1",   98, "FIDELITY DIVIDEND SWEEP",      -7_640.20,  "INCOME",      "Fidelity"),
    // Internal transfers
    T_(11, "d-jpm-2",    1, "TRANSFER FROM CHECKING",       -25_000.00, "TRANSFER_IN", "Internal"),
    T_(12, "d-marcus-1",10, "TRANSFER FROM JPM",            -50_000.00, "TRANSFER_IN", "Internal"),

    // ─── CHARITABLE GIVING (shows up in bank tx feed too) ───────────
    T_(13, "d-jpm-1",    4, "ZAKAT — ISLAMIC RELIEF USA",   50_000.00,  "TRANSFER_OUT","Islamic Relief USA"),
    T_(14, "d-jpm-1",    7, "ZELLE — HELPING HAND",         25_000.00,  "TRANSFER_OUT","Helping Hand"),
    T_(15, "d-jpm-1",   22, "ZELLE — ZAYTUNA COLLEGE",      15_000.00,  "TRANSFER_OUT","Zaytuna College"),
    T_(16, "d-jpm-1",   38, "WIRE — BAYYINAH INSTITUTE",    10_000.00,  "TRANSFER_OUT","Bayyinah"),

    // ─── HOUSING (paid off — only HOA + utilities + property tax) ───
    T_(17, "d-jpm-1",    9, "HOA — RESIDENCE",                650.00,   "RENT_AND_UTILITIES","HOA"),
    T_(18, "d-jpm-1",   14, "COOK COUNTY PROPERTY TAX",     8_420.00,   "RENT_AND_UTILITIES","Cook County"),
    T_(19, "d-chase-1", 12, "COMED ELECTRIC",                 312.50,   "RENT_AND_UTILITIES","ComEd"),
    T_(20, "d-chase-1", 12, "PEOPLES GAS",                    184.20,   "RENT_AND_UTILITIES","Peoples Gas"),
    T_(21, "d-chase-1", 15, "AT&T FIBER 5GB",                 165.00,   "RENT_AND_UTILITIES","AT&T"),
    T_(22, "d-chase-1", 15, "VERIZON WIRELESS — FAMILY PLAN", 285.00,   "RENT_AND_UTILITIES","Verizon"),

    // ─── KIDS / EDUCATION ───────────────────────────────────────────
    T_(23, "d-jpm-1",    3, "IQRA INTERNATIONAL — TUITION", 2_850.00,   "GENERAL_SERVICES","Iqra School"),
    T_(24, "d-jpm-1",   33, "IQRA INTERNATIONAL — TUITION", 2_850.00,   "GENERAL_SERVICES","Iqra School"),
    T_(25, "d-jpm-1",   63, "IQRA INTERNATIONAL — TUITION", 2_850.00,   "GENERAL_SERVICES","Iqra School"),
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
    T_(45, "d-chase-2", 28, "EMIRATES — DXB BUSINESS",     5_840.00,    "TRAVEL","Emirates"),
    T_(46, "d-chase-2", 30, "FOUR SEASONS DUBAI",          3_420.00,    "TRAVEL","Four Seasons"),

    // ─── SHOPPING / MISC ───────────────────────────────────────────
    T_(47, "d-chase-2",  6, "AMAZON.COM",                    168.42,    "GENERAL_MERCHANDISE","Amazon"),
    T_(48, "d-chase-2", 11, "AMAZON.COM",                    334.50,    "GENERAL_MERCHANDISE","Amazon"),
    T_(49, "d-chase-2",  4, "TARGET",                        127.30,    "GENERAL_MERCHANDISE","Target"),
    T_(50, "d-chase-2", 19, "APPLE STORE — IPAD PRO M4",   1_899.00,    "GENERAL_MERCHANDISE","Apple Store"),

    // ─── BUSINESS (Mercury) ────────────────────────────────────────
    T_(51, "d-merc-1",   3, "STRIPE PAYOUT",               -18_420.00,  "INCOME","Stripe"),
    T_(52, "d-merc-1",  17, "STRIPE PAYOUT",               -22_180.00,  "INCOME","Stripe"),
    T_(53, "d-merc-1",   5, "VENDOR — HALAL SUPPLY CO",     4_280.00,   "GENERAL_SERVICES","Halal Supply"),
    T_(54, "d-merc-1",   8, "AWS — INFRASTRUCTURE",         1_420.00,   "GENERAL_SERVICES","AWS"),
    T_(55, "d-merc-1",  15, "PAYROLL — 4 STAFF",           14_820.00,   "GENERAL_SERVICES","Gusto Payroll"),
  ];
})();

/* ─── DEMO MANUAL ASSETS + SADAQAH ──────────────────── */
const DEMO_MANUAL_ASSETS = [
  { id:"dm-1", type:"Gold",                 name:"Wedding gold + bullion",            value:48_500, zakatable:true,  added:"2024-09-12", notes:"22k jewelry + 5oz bars" },
  { id:"dm-2", type:"Real Estate",          name:"Primary residence equity (paid)",   value:220_000,zakatable:false, added:"2023-05-04", notes:"Primary home excluded from Zakat" },
  { id:"dm-3", type:"Investment Property",  name:"Rental — 2bd condo",                value:185_000,zakatable:true,  added:"2024-01-22", notes:"Net of mortgage; rents at $2,400/mo" },
  { id:"dm-4", type:"Business Equity",      name:"Halal Bites LLC (40% stake)",       value:60_000, zakatable:true,  added:"2023-11-08", notes:"Founder equity" },
  { id:"dm-5", type:"Vehicle",              name:"2022 Toyota Camry",                 value:18_200, zakatable:false, added:"2022-08-15", notes:"Daily driver, not zakatable" },
];

// Donations sized to match a ~$41M demo persona. Annual Zakat alone runs
// ~$750k on the zakatable share, so historical sadaqah is in the high 5-
// to mid 6-figure range. Covers a representative roster of major Muslim
// orgs (relief, education, dawah, masjid, advocacy).
const DEMO_SADAQAH = [
  // ───── 2026 — Ramadan + post-Ramadan zakat distribution ────────────
  { id:"ds-1",  dt:"2026-03-29", org:"Islamic Relief USA",                  method:"Wire",        account:"Private Client Checking", amt:150_000, done:true  },
  { id:"ds-2",  dt:"2026-03-26", org:"Helping Hand for Relief & Development",method:"Wire",      account:"Private Client Checking", amt:100_000, done:true  },
  { id:"ds-3",  dt:"2026-03-22", org:"Zaytuna College",                     method:"Wire",        account:"Private Client Checking", amt:75_000,  done:true  },
  { id:"ds-4",  dt:"2026-03-19", org:"Bayyinah Institute",                  method:"Zelle",       account:"Private Client Checking", amt:25_000,  done:true  },
  { id:"ds-5",  dt:"2026-03-16", org:"Yaqeen Institute",                    method:"Zelle",       account:"Private Client Checking", amt:25_000,  done:true  },
  { id:"ds-6",  dt:"2026-03-14", org:"ICNA Relief USA",                     method:"Zelle",       account:"Private Client Checking", amt:20_000,  done:true  },
  { id:"ds-7",  dt:"2026-03-12", org:"Penny Appeal USA",                    method:"Zelle",       account:"Premier Savings",         amt:15_000,  done:true  },
  { id:"ds-8",  dt:"2026-03-08", org:"LaunchGood — Orphan Sponsorship",     method:"Credit Card", account:"Sapphire Reserve",        amt:12_000,  done:true  },
  { id:"ds-9",  dt:"2026-03-05", org:"Masjid Al-Uthman",                    method:"Zelle",       account:"Premier Savings",         amt:25_000,  done:true  },
  { id:"ds-10", dt:"2026-03-02", org:"ISNS (Islamic Society of North Suburbs)",method:"Zelle",    account:"Premier Savings",         amt:15_000,  done:true  },
  { id:"ds-11", dt:"2026-02-28", org:"Hidaya Foundation",                   method:"Zelle",       account:"Premier Savings",         amt:10_000,  done:true  },
  { id:"ds-12", dt:"2026-02-22", org:"LIFE for Relief & Development",       method:"Zelle",       account:"Premier Savings",         amt:10_000,  done:true  },
  { id:"ds-13", dt:"2026-02-15", org:"Muslim Legal Fund of America",        method:"Zelle",       account:"Private Client Checking", amt:8_500,   done:true  },
  { id:"ds-14", dt:"2026-02-10", org:"CAIR — Civil Rights Defense",         method:"Credit Card", account:"Sapphire Reserve",        amt:5_000,   done:true  },
  { id:"ds-15", dt:"2026-01-22", org:"Iqra International School",           method:"Zelle",       account:"Private Client Checking", amt:20_000,  done:true  },

  // ───── 2025 — full year giving ──────────────────────────────────────
  { id:"ds-16", dt:"2025-12-28", org:"Mercy Without Limits",                method:"Wire",        account:"Private Client Checking", amt:30_000,  done:true  },
  { id:"ds-17", dt:"2025-12-20", org:"Islamic Relief USA — Gaza Appeal",    method:"Wire",        account:"Private Client Checking", amt:75_000,  done:true  },
  { id:"ds-18", dt:"2025-11-15", org:"Zaytuna College",                     method:"Wire",        account:"Premier Savings",         amt:50_000,  done:true  },
  { id:"ds-19", dt:"2025-09-08", org:"Bayyinah Institute",                  method:"Zelle",       account:"Premier Savings",         amt:15_000,  done:true  },
  { id:"ds-20", dt:"2025-08-17", org:"Thakkat Charity",                     method:"Zelle",       account:"Private Client Checking", amt:5_000,   done:true  },
  { id:"ds-21", dt:"2025-07-04", org:"Helping Hand — Eid Adha Qurbani",     method:"Credit Card", account:"Sapphire Reserve",        amt:8_400,   done:true  },
  { id:"ds-22", dt:"2025-05-30", org:"Qalam Institute",                     method:"Zelle",       account:"Private Client Checking", amt:7_500,   done:true  },
  { id:"ds-23", dt:"2025-04-02", org:"Masjid Al-Uthman — Ramadan Iftar",    method:"Zelle",       account:"Premier Savings",         amt:20_000,  done:true  },
  { id:"ds-24", dt:"2025-03-25", org:"Yaqeen Institute",                    method:"Zelle",       account:"Premier Savings",         amt:20_000,  done:true  },
  { id:"ds-25", dt:"2025-03-12", org:"Penny Appeal USA — Orphan Kind",      method:"Credit Card", account:"Sapphire Reserve",        amt:12_000,  done:true  },

  // ───── 2024 ─────────────────────────────────────────────────────────
  { id:"ds-26", dt:"2024-12-15", org:"ICNA Relief USA",                     method:"Wire",        account:"Premier Savings",         amt:25_000,  done:true  },
  { id:"ds-27", dt:"2024-09-20", org:"Muslim Aid USA",                      method:"Zelle",       account:"Private Client Checking", amt:10_000,  done:true  },
  { id:"ds-28", dt:"2024-04-09", org:"MUHSEN (Muslims w/ Disabilities)",    method:"Zelle",       account:"Private Client Checking", amt:5_000,   done:true  },
  { id:"ds-29", dt:"2024-04-08", org:"Masjid An-Noor (ICN)",                method:"Zelle",       account:"Premier Savings",         amt:15_000,  done:true  },
  { id:"ds-30", dt:"2024-03-22", org:"Islamic Relief USA — Ramadan Zakat",  method:"Wire",        account:"Private Client Checking", amt:120_000, done:true  },

  // ───── 2023 ─────────────────────────────────────────────────────────
  { id:"ds-31", dt:"2023-12-11", org:"ISNS",                                method:"Zelle",       account:"Premier Savings",         amt:15_000,  done:true  },
  { id:"ds-32", dt:"2023-04-12", org:"Islamic Relief USA — Ramadan Zakat",  method:"Wire",        account:"Private Client Checking", amt:95_000,  done:true  },

  // ───── Outstanding pledges ──────────────────────────────────────────
  { id:"ds-33", dt:"Pledge",     org:"Helping Hand — Earthquake Relief",    method:"TBD",         account:"Private Client Checking", amt:50_000,  done:false },
  { id:"ds-34", dt:"Pledge",     org:"Masjid Al-Uthman — Building Fund",    method:"TBD",         account:"Premier Savings",         amt:100_000, done:false },
  { id:"ds-35", dt:"Pledge",     org:"Zaytuna College — Endowed Chair",     method:"TBD",         account:"Private Client Checking", amt:25_000,  done:false },
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
      model:"claude-sonnet-4-20250514",
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
function BentoTile({children,span="auto",accent,gradient,glass,style,onClick}){
  const baseStyle={
    background:gradient||(glass?T.glass:T.card),
    border:`1px solid ${accent?accent+"40":T.border}`,
    borderRadius:T.rLg,
    padding:`${T.s5} ${T.s5}`,
    boxShadow:"var(--sh-md)",
    backdropFilter:glass?"blur(16px) saturate(160%)":undefined,
    WebkitBackdropFilter:glass?"blur(16px) saturate(160%)":undefined,
    gridColumn:span.col||undefined,
    gridRow:span.row||undefined,
    transition:"transform 0.18s, box-shadow 0.2s, border-color 0.2s",
    cursor:onClick?"pointer":"default",
    position:"relative",
    overflow:"hidden",
    ...(style||{}),
  };
  return<div className="bento-tile" onClick={onClick} style={baseStyle}>{children}</div>;
}

function TT2({active,payload}){if(!active||!payload?.length)return null;return<div style={{background:T.card,border:`1px solid ${T.borderHi}`,borderRadius:8,padding:"6px 12px",fontFamily:FM,fontSize:11,color:T.textHi}}>${payload[0]?.value?.toLocaleString?.("en-US",{minimumFractionDigits:2})}</div>;}

// Data table — fintech-style. Tabular numerics, hover row highlight,
// sticky header optional (not on by default to keep nested tables simple).
function Tbl({cols,rows,onRow}){return<div style={{overflowX:"auto",WebkitOverflowScrolling:"touch"}}><table style={{width:"100%",borderCollapse:"separate",borderSpacing:0,fontVariantNumeric:"tabular-nums"}}>
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
</table></div>;}

// Tab bar — pill-style segmented control. Active pill gets a soft purple
// halo. Scrolls horizontally on mobile via .mz-tabbar overflow handling.
function TabBar({tabs,active,onChange,accent}){return<div className="mz-tabbar-wrap" style={{marginBottom:T.s5}}><div className="mz-tabbar" style={{
  display:"flex",gap:T.s1,padding:T.s1,
  background:T.surface,border:`1px solid ${T.border}`,borderRadius:T.rLg,
  overflowX:"auto",WebkitOverflowScrolling:"touch",
}}>{tabs.map(([id,l])=>{
  const on=active===id;const acc=accent||T.blue;
  return<button key={id} onClick={()=>onChange(id)} style={{
    padding:`8px ${T.s4}`,background:on?T.card:"transparent",
    border:"none",borderRadius:T.rMd,
    color:on?T.textHi:T.muted,
    fontFamily:FU,fontSize:13,fontWeight:on?600:500,letterSpacing:"-0.005em",
    cursor:"pointer",whiteSpace:"nowrap",flexShrink:0,
    boxShadow:on?`0 1px 3px rgba(0,0,0,0.18), 0 0 0 1px ${acc}24`:"none",
    transition:"all 0.15s ease",
  }}>{l}</button>;
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
    if(a==="ACH"||a==="ACATC"||a==="JNLC")return["DEPOSIT","auto"];
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
      account:acctLabel?{id:acctNumber||acctLabel,name:acctLabel}:null,
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
        <div style={{fontFamily:FU,fontSize:13,color:T.muted,letterSpacing:"-0.005em"}}>{sorted.length} sector{sorted.length===1?"":"s"} · {kf(tracked)} tracked</div>
      </div>
      {topSector&&<div style={{textAlign:"right"}}>
        <div style={{fontFamily:FM,fontSize:9,color:T.muted,letterSpacing:"0.14em",fontWeight:600}}>TOP SECTOR</div>
        <div style={{fontFamily:FU,fontSize:14,fontWeight:600,color:T.textHi,letterSpacing:"-0.01em",marginTop:2}}>{topSector[0]}</div>
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
            <span style={{fontFamily:FU,fontSize:13,color:T.text,letterSpacing:"-0.005em",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{sec}</span>
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
// for cross-reference. Click ✎ → swap to an input pre-populated with
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
          fontFamily:FU,fontSize:(primaryStyle&&primaryStyle.fontSize)||13,
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
        ...(pencilStyle||{}),
      }}>✎</button>}
  </div>;
}

/* ─── OVERVIEW ───────────────────────────────────────── */
function Overview({live,snapAccounts=[],allAccounts=[],plaidAccounts=[],disabledAccts=new Set(),onToggleAcct,onDisconnectAcct,mapPosition,metrics={},activities=[],netWorthHistory=[],onNav,onConnect,onToggleDemoFromBanner,bankBalance=0,nicknames={},onSetNickname}){
  const { hidden: valuesHidden, toggle: toggleHideValues, mask } = useHideValues();
  const[range,setRange]=useState("All");
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
  // Zakatable manual assets only — primary residence, daily-driver car,
  // and other personal-use items have `zakatable:false` and must NOT
  // appear in the Overview ZAKAT DUE tile. Mirrors the filter in the
  // ZakatSadaqah Portfolio tab so both surfaces report the same figure.
  const manualAssetZakatable=manualAssetsRaw
    .filter(a=>!a.liability && a.zakatable)
    .reduce((s,a)=>s+(+a.value||0),0);
  // Manual liabilities (entries flagged `liability:true`) — used to deduct from
  // zakatable wealth on the Overview tile so it stays consistent with the
  // Portfolio → Zakat & Sadaqah tab's calculation.
  const manualLiabilities=manualAssetsRaw
    .filter(a=>a.liability && a.zakatable !== false)
    .reduce((s,a)=>s+(+a.value||0),0);
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
  // active traders, 0.30 for long-term holders per AAOIFI / contemporary
  // fatwa guidance. Cash (bank, brokerage cash) is always full value.
  // manualAssetZakatable already filters out personal-use exempt items
  // (primary residence, daily-driver car).
  const zakatSettings = useZakatSettings();
  const liveNisab     = useLiveNisab();
  const invFactor = investmentFactor(zakatSettings);
  const zakatableForOverview=Math.max(0,
    Math.max(0,brokerageTot) * invFactor
    + Math.max(0,bankBalance||0)
    + plaidInvestmentTot * invFactor
    + manualAssetZakatable
    - manualLiabilities
  );
  const nisabOverview = nisabValueFor(zakatSettings, liveNisab);
  const overviewAboveNisab = zakatableForOverview >= nisabOverview;
  const zakatDueOverview = overviewAboveNisab ? zakatableForOverview * 0.025 : 0;
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
  const chart=useMemo(()=>{
    const deposits=activities.filter(a=>(a.type||"").toUpperCase()==="DEPOSIT")
      .filter(a=>a.trade_date)
      .sort((a,b)=>a.trade_date.localeCompare(b.trade_date));

    const today=new Date();
    let firstDate;
    if(deposits.length>0){
      firstDate=new Date(deposits[0].trade_date);
    }else{
      // No real history — fall back to a 1-year synthetic window
      firstDate=new Date(today);firstDate.setFullYear(today.getFullYear()-1);
    }

    // Range filter
    const cutoff=new Date(today);
    if(range==="1Y")cutoff.setFullYear(today.getFullYear()-1);
    else if(range==="3Y")cutoff.setFullYear(today.getFullYear()-3);
    else if(range==="5Y")cutoff.setFullYear(today.getFullYear()-5);
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
    return series;
  },[activities,netWorthHistory,totBucket,range]);

  // Empty-state welcome card — shows for fresh users with no real broker
  // connections and demo mode off. Replaces the previous behavior where new
  // users saw a hardcoded sample portfolio.
  const isEmpty=snapAccounts.length===0&&merged.length===0;

  // Allocation slices: equity vs cash vs (future: real estate, gold, etc.).
  // Built from positions grouped by Sharia-compliance status, plus cash.
  const allocSlices=(()=>{
    const halal=merged.filter(h=>h.sh_==="halal").reduce((s,h)=>s+mv(h),0);
    const review=merged.filter(h=>h.sh_==="review").reduce((s,h)=>s+mv(h),0);
    const haramTot=merged.filter(h=>h.sh_==="haram").reduce((s,h)=>s+mv(h),0);
    return[
      {label:"Halal",        value:halal,    color:T.gain},
      {label:"Review",       value:review,   color:T.gold},
      {label:"Non-compliant",value:haramTot, color:T.loss},
      {label:"Cash",         value:totalCash,color:T.blue},
    ].filter(s=>s.value>0);
  })();

  // Today's spark — last 20 chart points if available, otherwise synthetic.
  const heroSpark=chart.length>0
    ? chart.slice(-20).map(p=>p.value)
    : Array.from({length:20},(_,i)=>tot*(0.95+i*0.0025));
  const halalPct=tot>0?((tot-haramV)/tot)*100:100;
  const fmtUSD=v=>`$${(+v).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}`;

  return<div className="bento" style={{display:"flex",flexDirection:"column",gap:T.s5}}>
    {/* Welcome state */}
    {isEmpty&&<BentoTile glass style={{textAlign:"center",padding:`${T.s10} ${T.s8}`}}>
      <div style={{fontFamily:FM,fontSize:10,color:T.blue,letterSpacing:"0.22em",fontWeight:600,marginBottom:T.s3}}>WELCOME TO MĪZAN</div>
      <div style={{fontFamily:FU,fontSize:30,fontWeight:700,color:T.textHi,letterSpacing:"-0.025em",marginBottom:T.s2}}>Connect your first brokerage</div>
      <div style={{fontFamily:FU,fontSize:14,color:T.muted,lineHeight:1.6,maxWidth:540,margin:`0 auto ${T.s6}`}}>
        Link Fidelity, Robinhood, Schwab, Coinbase, or any of 60+ brokers via SnapTrade. Your real holdings, activity, and Sharia screening will appear here.
      </div>
      <div style={{display:"flex",gap:T.s2,justifyContent:"center",flexWrap:"wrap"}}>
        <button onClick={onConnect} className="btn-primary" style={{fontSize:13,padding:`12px ${T.s5}`}}>+ Connect Account</button>
        <button onClick={onToggleDemoFromBanner} className="btn-ghost" style={{fontSize:13,padding:`11px ${T.s5}`,color:T.gold,borderColor:T.gold+"40"}}>Try Demo Mode →</button>
      </div>
    </BentoTile>}

    {/* Compliance alert ribbon */}
    {haramV>0&&<div style={{padding:`${T.s2} ${T.s4}`,background:T.lossBg,border:`1px solid ${T.loss}30`,borderRadius:T.rMd,display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:T.s2}}>
      <span style={{fontFamily:FM,fontSize:12,color:T.loss}}>{haram.map(h=>h.tk).join(", ")} — Non-compliant · {mask(f$(haramV))}</span>
      <button onClick={()=>onNav("portfolio")} style={{fontFamily:FM,fontSize:10,fontWeight:600,color:T.loss,background:"transparent",border:`1px solid ${T.loss}40`,borderRadius:T.rMd,padding:`4px ${T.s3}`,cursor:"pointer",letterSpacing:"0.08em"}}>EXIT PLAN →</button>
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
            <span>TOTAL PORTFOLIO VALUE</span>
            {snapAccounts.length>0&&<span style={{color:T.gain,marginLeft:T.s2,display:"inline-flex",alignItems:"center",gap:5}}><LiveDot on pulse/>LIVE</span>}
            <EyeToggle hidden={valuesHidden} toggle={toggleHideValues} size={14} color={T.muted}/>
          </div>
          <div style={{display:"flex",gap:T.s1}}>
            {["1Y","3Y","5Y","All"].map(r=><button key={r} onClick={()=>setRange(r)} style={{padding:`4px ${T.s3}`,borderRadius:T.rSm,fontFamily:FM,fontSize:10,fontWeight:600,letterSpacing:"0.04em",background:range===r?T.blue:"transparent",border:`1px solid ${range===r?T.blue:T.border}`,color:range===r?"#fff":T.muted,cursor:"pointer",transition:"all 0.15s"}}>{r}</button>)}
          </div>
        </div>
        <div style={{display:"flex",alignItems:"baseline",gap:T.s3,marginBottom:T.s1,flexWrap:"wrap"}}>
          <div style={{fontFamily:FU,fontSize:46,fontWeight:700,color:T.textHi,letterSpacing:"-0.035em",lineHeight:1,fontVariantNumeric:"tabular-nums"}}>{mask(fmtUSD(tot))}</div>
        </div>
        <div style={{display:"flex",gap:T.s4,marginTop:T.s2,fontFamily:FM,fontSize:12,color:T.muted,flexWrap:"wrap",alignItems:"center"}}>
          <span style={{display:"inline-flex",alignItems:"center",gap:T.s1}}>
            <span style={{color:gain>=0?T.gain:T.loss,fontWeight:600}}>{valuesHidden?"••••":`${gain>=0?"+":""}${kf(Math.abs(gain))}`}</span>
            <span style={{color:gpc>=0?T.gain:T.loss}}>({valuesHidden?"••":fp(gpc)})</span>
            all-time
          </span>
          <span style={{color:T.dim}}>·</span>
          <span>Today <span style={{color:fc(today),fontWeight:600}}>{valuesHidden?"••••":`${today>=0?"+":""}${f$(Math.abs(today))}`}</span></span>
        </div>
        <div style={{marginTop:T.s4,height:120}}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chart} margin={{top:6,right:6,bottom:0,left:0}}>
              <defs><linearGradient id="hero-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={T.blue} stopOpacity={0.35}/><stop offset="100%" stopColor={T.blue} stopOpacity={0}/></linearGradient></defs>
              <XAxis dataKey="ts" type="number" domain={["dataMin","dataMax"]} scale="time" hide/>
              <YAxis hide domain={["dataMin","auto"]}/>
              <Tooltip
                labelFormatter={ts=>new Date(ts).toLocaleDateString("en-US",{year:"numeric",month:"short"})}
                formatter={(v,name)=>[fmtUSD(v),name==="value"?"Portfolio":"Contributions"]}
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
        </BentoTile>
        <BentoTile>
          <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>COMPLIANCE</div>
          <div style={{fontFamily:FU,fontSize:28,fontWeight:700,color:halalPct>=95?T.gain:halalPct>=70?T.gold:T.loss,letterSpacing:"-0.03em",fontVariantNumeric:"tabular-nums"}}>{halalPct.toFixed(1)}%</div>
          <div style={{fontFamily:FM,fontSize:11,color:T.muted,marginTop:T.s1}}>{merged.filter(h=>h.sh_==="halal").length} of {merged.length} halal</div>
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
                <span style={{fontFamily:FU,fontSize:13,color:T.text,flex:1,letterSpacing:"-0.005em"}}>{s.label}</span>
                <span style={{fontFamily:FM,fontSize:11,fontWeight:600,color:T.textHi,fontVariantNumeric:"tabular-nums"}}>{valuesHidden?"••":`${pct.toFixed(1)}%`}</span>
              </div>;
            })}
          </div>
        </div>:<div style={{fontFamily:FU,fontSize:13,color:T.muted,padding:`${T.s5} 0`,textAlign:"center"}}>Connect a brokerage to see your allocation.</div>}
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
    {top.length>0&&<BentoTile>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:T.s4}}>
        <span style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600}}>TOP HOLDINGS</span>
        {snapAccounts.length>0&&<span style={{fontFamily:FM,fontSize:10,color:T.blue,letterSpacing:"0.06em"}}>● REAL POSITIONS</span>}
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:T.s2}}>
        {top.map(h=>{
          const gpct=gp(h),pof=tot>0?mv(h)/tot*100:0;
          return<div key={h.tk+(h.ac_||"")} style={{display:"flex",alignItems:"center",gap:T.s4,padding:`${T.s2} 0`,borderBottom:`1px solid ${T.border}`}}>
            <div style={{width:56}}>
              <div style={{fontFamily:FU,fontSize:14,fontWeight:600,color:T.textHi,letterSpacing:"-0.01em"}}>{h.tk}</div>
              <div style={{fontFamily:FM,fontSize:10,color:T.muted,marginTop:2,letterSpacing:"0.02em"}}>{h.br}</div>
            </div>
            <div style={{flex:1,minWidth:50}}>
              <div style={{height:4,background:T.dim,borderRadius:2,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${Math.min(pof*4,100)}%`,background:`linear-gradient(90deg, ${h.sh_==="haram"?T.loss:T.blue}, ${h.sh_==="haram"?T.loss:T.blueDim})`,borderRadius:2,transition:"width 0.4s"}}/>
              </div>
              <div style={{fontFamily:FM,fontSize:9,color:T.muted,marginTop:T.s1,letterSpacing:"0.04em"}}>{valuesHidden?"••% of book":`${pof.toFixed(1)}% of book`}</div>
            </div>
            <div style={{width:90,textAlign:"right"}}>
              <div style={{fontFamily:FU,fontSize:14,fontWeight:600,color:T.textHi,letterSpacing:"-0.01em",fontVariantNumeric:"tabular-nums"}}>{mask(f$(mv(h)))}</div>
              <div style={{fontFamily:FM,fontSize:10,fontWeight:500,color:fc(gpct),marginTop:2}}>{valuesHidden?"••":fp(gpct)}</div>
            </div>
            <Sk vals={Array.from({length:24},()=>mv(h)*(1+(Math.random()-.48)*.02))} color={fc(gpct)} w={80} h={28} fill/>
          </div>;
        })}
      </div>
    </BentoTile>}

    {/* ─── BENTO ROW 4: Accounts (unified SnapTrade + Plaid) ───── */}
    {acctsForCards.length>0&&<BentoTile>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:T.s4,flexWrap:"wrap",gap:T.s2}}>
        <span style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600}}>
          ACCOUNTS · {acctsForCards.length} total
          {snapCards.length>0&&<span style={{color:T.muted,marginLeft:T.s2,fontWeight:400}}>· {snapCards.length} brokerage</span>}
          {plaidCards.length>0&&<span style={{color:T.muted,marginLeft:T.s2,fontWeight:400}}>· {plaidCards.length} bank/credit</span>}
          {disabledAccts.size>0&&<span style={{color:T.muted,marginLeft:T.s2,fontWeight:400}}>· {disabledAccts.size} hidden</span>}
        </span>
      </div>
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
                primaryStyle={{fontFamily:FU,fontSize:11,color:nicknames?.[a.id]?T.textHi:T.muted,letterSpacing:"-0.005em",fontWeight:nicknames?.[a.id]?600:400}}
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
                  background:"transparent",border:`1px solid ${T.loss}30`,color:T.loss,cursor:"pointer"}}>✕</button>}
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
    </BentoTile>}

    {/* Sector breakdown — keep as a standalone card */}
    <SectorBreakdown holdings={merged} total={equityValue}/>
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
// NOTE: The non-permissible income ratio (standard.nonPermMax) is intentionally
// NOT evaluated here. That test requires a revenue-breakdown by business segment
// (e.g. interest income, alcohol-derived revenue) which is not available from the
// Finnhub free tier. We rely on the sector-exclusion check instead. The UI flags
// this limitation next to each standard's spec line.
function evaluateAgainst(standard,{sector,debt,cash,recv,mc,assets}){
  if(sector==="haram")return{pass:false,fails:[{rule:"Sector",detail:"Prohibited industry"}],ratios:{}};
  const denom=standard.denominator==="totalAssets"?assets:mc;
  if(!denom||denom<=0)return{pass:null,fails:[],ratios:{},reason:`No ${standard.denominator} data`};
  const debtR=(debt/denom)*100, cashR=(cash/denom)*100, recvR=recv>0?(recv/denom)*100:0;
  const tests=[
    {rule:`Debt/${standard.denominator==="totalAssets"?"Assets":"MC"}`,pass:debtR<standard.debtMax,detail:`${debtR.toFixed(1)}%`,limit:standard.debtMax},
    {rule:`Cash/${standard.denominator==="totalAssets"?"Assets":"MC"}`,pass:cashR<standard.cashMax,detail:`${cashR.toFixed(1)}%`,limit:standard.cashMax},
    {rule:`A/R/${standard.denominator==="totalAssets"?"Assets":"MC"}`,pass:recv===0||recvR<standard.recvMax,detail:recv===0?"n/a":`${recvR.toFixed(1)}%`,limit:standard.recvMax},
  ];
  const fails=tests.filter(t=>!t.pass);
  return{pass:fails.length===0,fails,ratios:{debtR,cashR,recvR},tests};
}
async function screenTicker(tk){
  // No client-side Finnhub gate — /api/finnhub/* is server-proxied with the
  // env-var FINNHUB_KEY and is per-user JWT-scoped + rate limited. The
  // browser never holds the key, so we can always attempt the call.
  if(/^(BTC|ETH|SOL|DOGE|ADA|DOT|LINK)$/.test(tk))return{tk,status:"halal",industry:"Cryptocurrency",notes:"Treated as commodity per most contemporary scholars",byStandard:Object.fromEntries(Object.keys(STANDARDS).map(k=>[k,{pass:true,note:"crypto"}]))};
  try{
    const[profileR,metricR]=await Promise.all([
      apiFetch(`/api/finnhub/profile2?symbol=${encodeURIComponent(tk)}`),
      apiFetch(`/api/finnhub/metric?symbol=${encodeURIComponent(tk)}`),
    ]);
    const profile=await profileR.json();
    const metric=(await metricR.json()).metric||{};
    const industry=profile.finnhubIndustry||profile.gicsSector||"";
    const sector=classifyIndustry(industry);
    const mc=profile.marketCapitalization||0;
    const debt=metric.totalDebt||metric.longTermDebtAnnual||0;
    const cash=metric.cashAndShortTermInvestmentsAnnual||metric.cashAndCashEquivalentsAnnual||0;
    const recv=metric.netReceivablesAnnual||0;
    const assets=metric.totalAssetsAnnual||metric.totalAssetsTTM||0;
    if(sector==="haram"){
      const byStandard=Object.fromEntries(Object.keys(STANDARDS).map(k=>[k,{pass:false,fails:[{rule:"Sector"}]}]));
      return{tk,status:"haram",industry,reason:`Prohibited sector: ${industry}`,marketCap:mc,byStandard};
    }
    // Run every standard
    const byStandard={};
    Object.entries(STANDARDS).forEach(([key,std])=>{
      byStandard[key]=evaluateAgainst(std,{sector,debt,cash,recv,mc,assets});
    });
    const passCount=Object.values(byStandard).filter(r=>r.pass===true).length;
    const failCount=Object.values(byStandard).filter(r=>r.pass===false).length;
    const status=sector==="review"?"review":passCount>=5?"halal":failCount>=4?"haram":"review";
    // Aggregate ratios from AAOIFI for the row display (most conservative)
    const{ratios={}}=byStandard.AAOIFI||{};
    return{tk,status,industry,marketCap:mc,assets,
      debtR:ratios.debtR,cashR:ratios.cashR,recvR:ratios.recvR,
      byStandard,passCount,failCount,country:profile.country,name:profile.name};
  }catch(err){
    return{tk,status:"unknown",reason:err.message||"Screen failed"};
  }
}
function AAOIFIScreener({holdings=[]}){
  const[results,setResults]=useState(()=>{try{return JSON.parse(localStorage.getItem("mizan_aaoifi_cache")||"{}");}catch{return{};}});
  const[busy,setBusy]=useState(false);
  const[primary,setPrimary]=useState(()=>{try{return localStorage.getItem("mizan_screen_standard")||"AAOIFI";}catch{return"AAOIFI";}});
  const setStandard=v=>{setPrimary(v);try{localStorage.setItem("mizan_screen_standard",v);}catch{}};
  const tickers=[...new Set(holdings.map(h=>h.tk).filter(Boolean))];

  const runScreen=async(forceAll)=>{
    setBusy(true);
    const today=new Date().toISOString().slice(0,10);
    const todo=tickers.filter(tk=>forceAll||!results[tk]||results[tk].asOf!==today);
    let final=results;
    for(let i=0;i<todo.length;i+=8){
      const batch=todo.slice(i,i+8);
      const settled=await Promise.allSettled(batch.map(tk=>screenTicker(tk)));
      const next={...final};
      settled.forEach((s,j)=>{if(s.status==="fulfilled")next[batch[j]]={...s.value,asOf:today};});
      final=next;
      setResults(next);
      try{localStorage.setItem("mizan_aaoifi_cache",JSON.stringify(next));}catch{}
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
            try{new Notification(`${tk} now compliant ✓`,{body:`Sharia status: ${was} → ${now}.`,icon:"/icon-192.png"});}catch{}
            updated[tk]=res; fired++;
          }
        });
        if(fired>0){localStorage.setItem("mizan_screening_baseline",JSON.stringify(updated));persistUserState("mizan_screening_baseline",updated);}
      }
    }catch{}
  };
  useEffect(()=>{if(tickers.length)runScreen(false); /* eslint-disable-next-line */},[tickers.join(",")]);

  const enriched=holdings.map(h=>({...h,_screen:results[h.tk]||{status:h.sh_||"unknown"}}));
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

  return<div style={{display:"flex",flexDirection:"column",gap:T.s4}}>
    {/* ─── Intro + framework selector ───────────── */}
    <BentoTile>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:T.s4,flexWrap:"wrap"}}>
        <div style={{maxWidth:680}}>
          <div style={{fontFamily:FM,fontSize:10,color:T.gold,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>SHARIA COMPLIANCE</div>
          <p style={{fontFamily:FU,fontSize:13,color:T.muted,margin:0,lineHeight:1.55,letterSpacing:"-0.005em"}}>
            Live screening across {Object.keys(STANDARDS).length} frameworks. Pick a primary standard for row badges; every standard runs in the background so you see a per-position pass count. Data: Finnhub fundamentals.
          </p>
        </div>
        <div style={{display:"flex",gap:T.s2,alignItems:"center",flexShrink:0}}>
          <select value={primary} onChange={e=>setStandard(e.target.value)} className="field" style={{width:"auto",fontSize:12,cursor:"pointer"}}>
            {Object.entries(STANDARDS).map(([k,s])=><option key={k} value={k}>{s.name}</option>)}
          </select>
          <button onClick={()=>runScreen(true)} disabled={busy} className="btn-primary">{busy?"Screening…":"Re-screen"}</button>
        </div>
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

    <BentoTile style={{padding:0,overflow:"hidden"}}>
      <Tbl cols={[
        {l:"Symbol",r_:r=><div><div style={{fontFamily:FM,fontSize:12,fontWeight:500,color:r._screen.status==="haram"?T.loss:T.textHi}}>{r.tk}</div><div style={{fontFamily:FM,fontSize:9,color:T.muted}}>{r._screen.industry||r.ty||"—"}</div></div>},
        {l:"Mkt Value",r:true,r_:r=><span style={{fontFamily:FM,fontSize:12,color:T.textHi}}>{f$(mv(r))}</span>},
        {l:"Sector",r_:r=>{const c=classifyIndustry(r._screen.industry);return<Tag label={c==="haram"?"Excluded":c==="review"?"Review":c==="halal"?"OK":"—"} color={c==="haram"?T.loss:c==="review"?T.gold:c==="halal"?T.gain:T.muted}/>;}},
        {l:"Debt/Cap",r:true,r_:r=>{const v=r._screen.debtR;if(v==null)return<span style={{color:T.muted}}>—</span>;return<span style={{fontFamily:FM,fontSize:11,color:v<33?T.gain:T.loss}}>{v.toFixed(1)}%</span>;}},
        {l:"Cash/Cap",r:true,r_:r=>{const v=r._screen.cashR;if(v==null)return<span style={{color:T.muted}}>—</span>;return<span style={{fontFamily:FM,fontSize:11,color:v<33?T.gain:T.loss}}>{v.toFixed(1)}%</span>;}},
        {l:"A/R/Cap",r:true,r_:r=>{const v=r._screen.recvR;if(v==null)return<span style={{color:T.muted}}>—</span>;return<span style={{fontFamily:FM,fontSize:11,color:v<49?T.gain:T.loss}}>{v.toFixed(1)}%</span>;}},
        {l:"Status",r_:r=><Tag label={r._screen.status==="halal"?"✓ Halal":r._screen.status==="haram"?"✗ Non-Compliant":r._screen.status==="review"?"⚠ Review":"…"} color={r._screen.status==="halal"?T.gain:r._screen.status==="haram"?T.loss:r._screen.status==="review"?T.gold:T.muted}/>},
        {l:"Pass / 7",r:true,r_:r=>{const bs=r._screen.byStandard;if(!bs)return<span style={{color:T.muted}}>—</span>;const pass=Object.values(bs).filter(s=>s.pass===true).length;return<span style={{fontFamily:FM,fontSize:11,color:pass>=6?T.gain:pass>=4?T.gold:T.loss}} title={Object.entries(bs).map(([k,v])=>`${STANDARDS[k]?.name||k}: ${v.pass===true?"pass":v.pass===false?"fail":"n/a"}`).join("\n")}>{pass}/{Object.keys(STANDARDS).length}</span>;}},
        {l:"Primary",r_:r=>{const v=r._screen.byStandard?.[primary];if(!v)return<span style={{color:T.muted}}>—</span>;return<Tag label={v.pass===true?"✓":v.pass===false?"✗":"…"} color={v.pass===true?T.gain:v.pass===false?T.loss:T.muted}/>;}},
        {l:"Action",r_:r=>r._screen.status==="haram"?<Tag label="Exit + purify" color={T.loss}/>:r._screen.status==="review"?<Tag label="Verify" color={T.gold}/>:r._screen.status==="halal"?<Tag label="Hold" color={T.gain}/>:<Tag label="—" color={T.muted}/>},
      ]} rows={[...enriched].sort((a,b)=>{const o={haram:0,review:1,unknown:2,halal:3};return(o[a._screen.status]??9)-(o[b._screen.status]??9);})}/>
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
              <span style={{fontFamily:FU,fontSize:13,fontWeight:600,color:T.textHi,letterSpacing:"-0.01em"}}>{s.name}</span>
              <span style={{fontFamily:FM,fontSize:10,fontWeight:500,color:T.muted,letterSpacing:"0.04em"}}>{s.region}</span>
            </div>
            <div style={{fontFamily:FM,fontSize:10,color:T.muted,lineHeight:1.5,letterSpacing:"0.02em"}}>
              Debt &lt; {s.debtMax}% · Cash &lt; {s.cashMax}% · A/R &lt; {s.recvMax}% · Non-perm &lt; {s.nonPermMax}% <span style={{fontStyle:"italic",color:T.dim}}>(not evaluated — sector check applies)</span>
            </div>
          </div>)}
        </div>
        <div style={{marginTop:T.s3,fontFamily:FU,fontSize:12,color:T.muted,lineHeight:1.55,letterSpacing:"-0.005em"}}>
          <strong style={{color:T.text,fontWeight:600}}>Universal:</strong> Sector exclusion across all standards (banking, alcohol, tobacco, gambling, weapons, conventional insurance, adult entertainment, pork).
        </div>
      </BentoTile>
      <BentoTile accent={T.gold}>
        <div style={{fontFamily:FM,fontSize:10,color:T.gold,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s3}}>PURIFICATION GUIDE</div>
        <p style={{fontFamily:FU,fontSize:13,color:T.muted,margin:0,lineHeight:1.6,letterSpacing:"-0.005em"}}>
          Income from non-compliant or mixed-revenue companies must be purified — the impure portion is donated to charity (Sadaqah), without expectation of reward. The estimate above is a conservative proxy; for precision, multiply each holding's dividend by the company's non-permissible-income ratio.
        </p>
        <div style={{marginTop:T.s4,padding:`${T.s3} ${T.s4}`,background:`linear-gradient(135deg, ${T.gold}10, transparent 70%), ${T.surface}`,borderRadius:T.rMd,border:`1px solid ${T.gold}30`}}>
          <div style={{fontFamily:FM,fontSize:10,color:T.gold,letterSpacing:"0.14em",fontWeight:600,marginBottom:T.s1}}>EXIT GUIDANCE</div>
          <div style={{fontFamily:FU,fontSize:13,color:T.text,lineHeight:1.55,letterSpacing:"-0.005em"}}>
            For Non-Compliant positions: sell at the next reasonable opportunity, donate any gains realized after purification to charity, and replace with a Sharia-screened equivalent (SPUS / HLAL / UMMA / SPSK).
          </div>
        </div>
      </BentoTile>
    </div>
  </div>;
}

/* ─── TAX PLANNER ────────────────────────────────────── */
// Tax-loss harvesting candidates + estimated annual tax cost.
// Pure compute — no API calls. Replacement suggestions are halal defaults
// from the existing ETF universe (SPUS, HLAL, UMMA).
function TaxPlanner({holdings=[],activities=[],snapAccounts=[]}){
  const[bracket,setBracket]=useState(0.24);
  const[stateBracket,setStateBracket]=useState(0.05);

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
    const sym=((a.symbol&&(a.symbol.symbol||a.symbol))||"").toString().toUpperCase();
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
  const recentSells=new Set(activities.filter(a=>(a.type||"").toUpperCase()==="SELL"&&(a.trade_date||"")>=days30ISO).map(a=>a.symbol?.symbol||a.symbol));

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
      <div style={{fontFamily:FU,fontSize:13,color:T.muted,lineHeight:1.55,maxWidth:680,marginBottom:T.s3,letterSpacing:"-0.005em"}}>
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
        <div style={{fontFamily:FU,fontSize:14,fontWeight:500,color:T.muted}}>No unrealized losses across visible accounts.</div>
        <div style={{fontFamily:FU,fontSize:12,color:T.muted,marginTop:T.s1}}>Nothing to harvest right now.</div>
      </BentoTile>
      :<BentoTile style={{padding:0,overflow:"hidden"}}>
          <Tbl cols={[
            {l:"Symbol",r_:r=><div>
              <div style={{fontFamily:FU,fontSize:14,fontWeight:600,color:r.sh_==="haram"?T.loss:T.textHi,letterSpacing:"-0.01em"}}>{r.tk}</div>
              <div style={{fontFamily:FM,fontSize:10,color:T.muted,marginTop:2}}>{r.ac_}</div>
            </div>},
            {l:"Shares",r:true,r_:r=><span style={{fontFamily:FM,fontSize:11,color:T.text,fontVariantNumeric:"tabular-nums"}}>{r.sh.toFixed(3)}</span>},
            {l:"Avg Cost",r:true,r_:r=><span style={{fontFamily:FM,fontSize:11,color:T.muted,fontVariantNumeric:"tabular-nums"}}>{f$(r.ac)}</span>},
            {l:"Current",r:true,r_:r=><span style={{fontFamily:FM,fontSize:12,fontWeight:500,color:T.text,fontVariantNumeric:"tabular-nums"}}>{f$(r.px)}</span>},
            {l:"Loss $",r:true,r_:r=><span style={{fontFamily:FU,fontSize:13,fontWeight:600,color:T.loss,letterSpacing:"-0.005em",fontVariantNumeric:"tabular-nums"}}>{f$(Math.abs(r._loss))}</span>},
            {l:"Loss %",r:true,r_:r=><span style={{fontFamily:FM,fontSize:11,fontWeight:600,color:T.loss,fontVariantNumeric:"tabular-nums"}}>{fp(r._lossPct)}</span>},
            {l:"Wash Risk",r_:r=>recentSells.has(r.tk)?<Tag label="< 30d sold" color={T.loss}/>:<Tag label="Clear" color={T.gain}/>},
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
          <p style={{fontFamily:FU,fontSize:13,color:T.muted,margin:0,lineHeight:1.55,maxWidth:520}}>
            Upload CSVs, PDFs, DOCX, images — any file up to 2 MB. Stored privately to your account, synced across devices, with duplicate detection by name + size.
          </p>
        </div>
        <div style={{display:"flex",gap:T.s2,alignItems:"center",flexShrink:0}}>
          <input ref={fileRef} type="file" multiple accept={USER_DOC_ACCEPT} onChange={handleUpload} style={{display:"none"}}/>
          <button onClick={()=>fileRef.current?.click()} disabled={uploadBusy} className="btn-primary">{uploadBusy?"Uploading…":"Upload Files"}</button>
        </div>
      </div>
      {uploadStatus&&<div style={{marginBottom:T.s3,padding:`${T.s2} ${T.s3}`,borderRadius:T.rMd,fontFamily:FM,fontSize:11,background:uploadStatus.ok?T.gainBg:T.lossBg,border:`1px solid ${(uploadStatus.ok?T.gain:T.loss)+"30"}`,color:uploadStatus.ok?T.gain:T.loss,lineHeight:1.5}}>{uploadStatus.ok?"✓ ":"✗ "}{uploadStatus.msg}</div>}
      {userDocs.length===0
        ?<div style={{padding:`${T.s8} ${T.s5}`,textAlign:"center",fontFamily:FU,fontSize:13,color:T.muted,border:`1px dashed ${T.border}`,borderRadius:T.rMd}}>
          No files yet. Click <strong style={{color:T.text}}>Upload Files</strong> to add CSVs, PDFs, or DOCX. Files sync to your account so they appear on every device you sign in from.
        </div>
        :<div style={{overflow:"hidden",borderRadius:T.rMd,border:`1px solid ${T.border}`}}>
          <Tbl cols={[
            {l:"Uploaded",r_:r=><span style={{fontFamily:FM,fontSize:11,color:T.muted}}>{fmtDate(r.uploadedAt)}</span>},
            {l:"Name",r_:r=><div style={{display:"flex",alignItems:"center",gap:T.s2}}>
              <span style={{fontFamily:FU,fontSize:13,color:T.text,letterSpacing:"-0.005em"}}>{r.name}</span>
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
              <button onClick={()=>removeUserDoc(r.id)} style={{padding:`4px ${T.s2}`,borderRadius:T.rSm,fontFamily:FM,fontSize:11,background:"transparent",border:`1px solid ${T.loss}30`,color:T.loss,cursor:"pointer"}}>✕</button>
            </div>},
          ]} rows={userDocs}/>
        </div>}
    </BentoTile>

    {/* SNAPTRADE-FETCHED DOCS */}
    <BentoTile>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:T.s4,flexWrap:"wrap",marginBottom:T.s4}}>
        <div>
          <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>FROM YOUR BROKERS</div>
          <p style={{fontFamily:FU,fontSize:13,color:T.muted,margin:0,lineHeight:1.55,maxWidth:600}}>
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
        ?<div style={{padding:`${T.s8} ${T.s5}`,textAlign:"center",fontFamily:FU,fontSize:13,color:T.muted,border:`1px dashed ${T.border}`,borderRadius:T.rMd}}>
          {documents.length===0?"No documents yet — SnapTrade syncs broker documents on a delay. Fidelity and Robinhood usually populate within 24 hours of connection.":"No documents match these filters."}
        </div>
        :<div style={{overflow:"hidden",borderRadius:T.rMd,border:`1px solid ${T.border}`}}>
            <Tbl cols={[
              {l:"Date",r_:r=><span style={{fontFamily:FM,fontSize:11,color:T.muted}}>{r.date||r.created_at||"—"}</span>},
              {l:"Type",r_:r=>{const t=(r.type||r.document_type||"OTHER").toUpperCase();return<Tag label={t.replace(/_/g," ")} color={colorOf(t)}/>;}},
              {l:"Name",r_:r=><span style={{fontFamily:FU,fontSize:13,color:T.text,letterSpacing:"-0.005em"}}>{r.name||r.title||r.description||r.id||"—"}</span>},
              {l:"Account",r_:r=>{const id=r.account?.id||r.accountId||r.account_id;return<span style={{fontFamily:FM,fontSize:11,color:T.muted}}>{acctNameById[id]||r.institution_name||"—"}</span>;}},
              {l:"",r:true,r_:r=>{const url=r.downloadUrl||r.download_url||r.url;return url?<a href={url} target="_blank" rel="noreferrer" style={{padding:`4px ${T.s3}`,borderRadius:T.rSm,fontFamily:FM,fontSize:10,fontWeight:600,letterSpacing:"0.06em",background:`${T.blue}18`,border:`1px solid ${T.blue}40`,color:T.blue,textDecoration:"none"}}>Download ↗</a>:<span style={{color:T.muted,fontSize:10}}>—</span>;}},
            ]} rows={filtered}/>
          </div>
      }
    </BentoTile>
  </div>;
}

/* ─── ACTIVITY (transaction history) ─────────────────── */
function ActivityPanel({activities=[],accounts=[]}){
  const[type,setType]=useState("all");
  const[acctF,setAcctF]=useState("all");
  const[range,setRange]=useState("1y");

  const acctNameById=Object.fromEntries(accounts.map(a=>[a.accountId,`${a.brokerage} — ${a.accountName}`]));
  const acctOptions=["all",...accounts.map(a=>a.accountId)];

  const cutoff=(()=>{
    const d=new Date();
    if(range==="1m")d.setMonth(d.getMonth()-1);
    else if(range==="3m")d.setMonth(d.getMonth()-3);
    else if(range==="1y")d.setFullYear(d.getFullYear()-1);
    else if(range==="5y")d.setFullYear(d.getFullYear()-5);
    else return null; // all
    return d.toISOString().slice(0,10);
  })();

  const rows=activities.filter(a=>{
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

  return<div style={{display:"flex",flexDirection:"column",gap:T.s5}}>
    <div className="bento-row" style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(160px, 1fr))",gap:T.s4}}>
      <BentoTile accent={T.blue}>
        <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>BUYS</div>
        <div style={{fontFamily:FU,fontSize:22,fontWeight:600,color:T.textHi,letterSpacing:"-0.025em",fontVariantNumeric:"tabular-nums"}}>{kf(totals.BUY)}</div>
        <div style={{fontFamily:FM,fontSize:11,color:T.muted,marginTop:T.s1}}>{rows.filter(r=>(r.type||"").toUpperCase()==="BUY").length} txns</div>
      </BentoTile>
      <BentoTile accent={T.gold}>
        <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>SELLS</div>
        <div style={{fontFamily:FU,fontSize:22,fontWeight:600,color:T.textHi,letterSpacing:"-0.025em",fontVariantNumeric:"tabular-nums"}}>{kf(totals.SELL)}</div>
        <div style={{fontFamily:FM,fontSize:11,color:T.muted,marginTop:T.s1}}>{rows.filter(r=>(r.type||"").toUpperCase()==="SELL").length} txns</div>
      </BentoTile>
      <BentoTile accent={T.gain}>
        <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>DIVIDENDS</div>
        <div style={{fontFamily:FU,fontSize:22,fontWeight:600,color:T.textHi,letterSpacing:"-0.025em",fontVariantNumeric:"tabular-nums"}}>{kf(totals.DIVIDEND)}</div>
        <div style={{fontFamily:FM,fontSize:11,fontWeight:500,color:T.gain,marginTop:T.s1}}>Cash received</div>
      </BentoTile>
      <BentoTile accent={T.gain}>
        <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>DEPOSITS</div>
        <div style={{fontFamily:FU,fontSize:22,fontWeight:600,color:T.textHi,letterSpacing:"-0.025em",fontVariantNumeric:"tabular-nums"}}>{kf(totals.DEPOSIT)}</div>
        <div style={{fontFamily:FM,fontSize:11,fontWeight:500,color:T.gain,marginTop:T.s1}}>Net contributions</div>
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
        <div style={{fontFamily:FU,fontSize:14,fontWeight:500,color:T.muted}}>No activity in this range.</div>
        <div style={{fontFamily:FU,fontSize:12,color:T.muted,marginTop:T.s1}}>Widen the date filter or run Sync All.</div>
      </BentoTile>
      :
      <BentoTile style={{padding:0,overflow:"hidden"}}>
        <Tbl cols={[
          {l:"Date",   r_:r=><span style={{fontFamily:FM,fontSize:11,color:T.muted,fontVariantNumeric:"tabular-nums"}}>{r.trade_date||r.settlement_date||"—"}</span>},
          {l:"Type",   r_:r=>{const t=(r.type||"").toUpperCase();return<Tag label={t||"—"} color={colorOf(t)}/>;}},
          {l:"Symbol", r_:r=><span style={{fontFamily:FU,fontSize:13,fontWeight:600,color:T.textHi,letterSpacing:"-0.005em"}}>{fmtSym(r.symbol)}</span>},
          {l:"Account",r_:r=><span style={{fontFamily:FM,fontSize:11,color:T.muted}}>{acctNameById[r.account?.id]||r.institution_name||"—"}</span>},
          {l:"Quantity",r:true,r_:r=><span style={{fontFamily:FM,fontSize:11,color:T.text,fontVariantNumeric:"tabular-nums"}}>{r.units?(+r.units).toLocaleString("en-US",{maximumFractionDigits:4}):"—"}</span>},
          {l:"Price",   r:true,r_:r=><span style={{fontFamily:FM,fontSize:11,color:T.muted,fontVariantNumeric:"tabular-nums"}}>{r.price?f$(r.price):"—"}</span>},
          {l:"Amount",  r:true,r_:r=>{const v=+r.amount||0;return<span style={{fontFamily:FU,fontSize:13,fontWeight:600,color:v>0?T.gain:v<0?T.loss:T.text,letterSpacing:"-0.005em",fontVariantNumeric:"tabular-nums"}}>{v>0?"+":v<0?"−":""}{f$(Math.abs(v))}</span>;}},
        ]} rows={rows.slice(0,500)}/>
        {rows.length>500&&<div style={{padding:`${T.s2} ${T.s4}`,fontFamily:FM,fontSize:10,color:T.muted,textAlign:"center",borderTop:`1px solid ${T.border}`}}>Showing first 500 of {rows.length} — narrow filters to see more.</div>}
      </BentoTile>
    }
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
const NISAB_GOLD_USD   = 8310;  // 87.48 g × ~$95/g
const NISAB_SILVER_USD = 670;   // 612.36 g × ~$1.09/g

// Investment portfolio methodology — two scholarly approaches for users who
// hold stocks/ETFs/mutual funds (not actively trading):
//   · "full"        : 2.5% of full market value. Treats user as trader.
//   · "longterm_30" : 2.5% of 30% of market value. Per AAOIFI guidance +
//                     contemporary fatwas — approximates the share of
//                     company assets that are zakatable (cash, receivables,
//                     inventory) vs. exempt fixed assets (buildings, plant,
//                     equipment). Appropriate for retirement / buy-and-hold.
const INVESTMENT_FACTOR_FULL    = 1.0;
const INVESTMENT_FACTOR_LONGTERM = 0.30;

const DEFAULT_ZAKAT_SETTINGS = {
  nisabStandard:    "silver",        // "gold" | "silver"
  investmentMethod: "longterm_30",   // "full" | "longterm_30"
};

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
function nisabValueFor(s, live){
  // live is { nisab_gold_usd, nisab_silver_usd, source } from useLiveNisab,
  // or null. When live data is present and successful, prefer it over the
  // static fallback so spot-price drift doesn't silently mislead the user.
  const gold   = (live && live.source !== "static" && Number.isFinite(live.nisab_gold_usd))   ? live.nisab_gold_usd   : NISAB_GOLD_USD;
  const silver = (live && live.source !== "static" && Number.isFinite(live.nisab_silver_usd)) ? live.nisab_silver_usd : NISAB_SILVER_USD;
  return s.nisabStandard==="gold" ? gold : silver;
}
function investmentFactor(s){
  return s.investmentMethod==="full" ? INVESTMENT_FACTOR_FULL : INVESTMENT_FACTOR_LONGTERM;
}
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

function ZakatSadaqah({accounts=[],demoMode=false,bankBalance=0}){
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
  const invFactor = investmentFactor(settings);
  const nisabUsd  = nisabValueFor(settings, liveNisab);
  // Surface live nisab values in the methodology buttons so the user can
  // see the current threshold without leaving the page. Fall back to the
  // static constants when /api/metals/spot isn't reachable.
  const liveGold   = liveNisab.source!=="static" ? liveNisab.nisab_gold_usd   : NISAB_GOLD_USD;
  const liveSilver = liveNisab.source!=="static" ? liveNisab.nisab_silver_usd : NISAB_SILVER_USD;

  const manualAssets=demoMode
    ?DEMO_MANUAL_ASSETS
    :(()=>{try{return JSON.parse(localStorage.getItem("mizan_manual_assets")||"[]");}catch{return[];}})();
  const acctTotal       = accounts.reduce((s,a)=>s+(a.balance||0),0);
  // Brokerage holdings are scaled by the user's chosen investment method:
  //   · full:        treat as trading inventory → 2.5% of full value
  //   · longterm_30: per AAOIFI / contemporary fatwa, ~30% of a public
  //                  company's assets are zakatable (cash, receivables,
  //                  inventory); the rest (fixed assets) is exempt
  // Default is longterm_30 — most retail users buy and hold.
  const acctZakatable   = acctTotal * invFactor;
  const zakatableManual = manualAssets.filter(a=>a.zakatable && !a.liability).reduce((s,a)=>s+(a.value||0),0);
  // Deduct short-term debt from zakatable wealth per AAOIFI guidance.
  // Bank credit/loan balances flow in via bankBalance (negative component).
  // Manual assets with a `liability:true` flag are user-flagged short-term debts.
  const liabilityTotal = manualAssets
    .filter(a=>a.liability && a.zakatable !== false)
    .reduce((s,a)=>s+(+a.value||0),0);
  const negativeBank   = bankBalance < 0 ? Math.abs(bankBalance) : 0;
  const zakatable      = Math.max(0, acctZakatable + zakatableManual - liabilityTotal - negativeBank);
  const zakatDue        = zakatable*0.025;
  const aboveNisab      = zakatable >= nisabUsd;
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
    {/* ─── ROW 1: Zakat Hero + Donation totals ─────── */}
    <div className="bento-row" style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:T.s4}}>
      <BentoTile accent={T.gold} style={{
        background:`radial-gradient(circle at 100% 0%, ${T.gold}1F, transparent 55%), ${T.card}`,
        padding:`${T.s6} ${T.s6}`,
      }}>
        <div style={{fontFamily:FM,fontSize:10,color:T.gold,letterSpacing:"0.18em",fontWeight:600,marginBottom:T.s3}}>ZAKAT — {new Date().getFullYear()}</div>
        <div style={{fontFamily:FU,fontSize:38,fontWeight:700,color:aboveNisab?T.gold:T.muted,letterSpacing:"-0.03em",lineHeight:1,fontVariantNumeric:"tabular-nums"}}>{fmtUSD(zakatDue)}</div>
        <div style={{fontFamily:FM,fontSize:12,fontWeight:500,color:aboveNisab?T.gain:T.muted,marginTop:T.s2,letterSpacing:"-0.005em"}}>{aboveNisab?"● Above Nisab — Zakat obligatory":"Below Nisab — no Zakat owed"}</div>
        <div style={{marginTop:T.s5,display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(140px, 1fr))",gap:T.s3}}>
          {[
            [settings.investmentMethod==="longterm_30"?"Brokerage × 30%":"Brokerage",fmtUSD(acctZakatable)],
            ["Manual zakatable",fmtUSD(zakatableManual)],
            ["Short-term debt", `− ${fmtUSD(liabilityTotal+negativeBank)}`],
            ["Net zakatable wealth (assets minus short-term debt)",fmtUSD(zakatable),true],
            [`Nisab (${settings.nisabStandard})`,fmtUSD(nisabUsd)],
          ].map(([l,v,b])=><div key={l}>
            <div style={{fontFamily:FM,fontSize:9,color:T.muted,letterSpacing:"0.14em",fontWeight:500,marginBottom:T.s1}}>{l}</div>
            <div style={{fontFamily:FU,fontSize:14,fontWeight:b?700:600,color:b?T.textHi:T.text,letterSpacing:"-0.01em",fontVariantNumeric:"tabular-nums"}}>{v}</div>
          </div>)}
        </div>
        {isEmpty&&<div style={{marginTop:T.s4,fontFamily:FU,fontSize:12,color:T.muted,lineHeight:1.55}}>Connect a brokerage or add manual assets to populate these figures.</div>}
      </BentoTile>

      <div style={{display:"flex",flexDirection:"column",gap:T.s4}}>
        <BentoTile accent={T.gain}>
          <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>GIVEN TOTAL</div>
          <div style={{fontFamily:FU,fontSize:24,fontWeight:700,color:T.textHi,letterSpacing:"-0.025em",fontVariantNumeric:"tabular-nums"}}>{fmtUSD(given)}</div>
          <div style={{fontFamily:FM,fontSize:11,fontWeight:500,color:T.gain,marginTop:T.s1}}>{sadaqah.filter(s=>s.done).length} donation{sadaqah.filter(s=>s.done).length===1?"":"s"}</div>
        </BentoTile>
        {pledged>0&&<BentoTile accent={T.gold}>
          <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>PLEDGED</div>
          <div style={{fontFamily:FU,fontSize:24,fontWeight:700,color:T.textHi,letterSpacing:"-0.025em",fontVariantNumeric:"tabular-nums"}}>{fmtUSD(pledged)}</div>
          <div style={{fontFamily:FM,fontSize:11,fontWeight:500,color:T.gold,marginTop:T.s1}}>{sadaqah.filter(s=>!s.done).length} outstanding</div>
        </BentoTile>}
      </div>
    </div>

    {/* ─── ROW 1.5: Methodology selector ────────────── */}
    {/* Lets the user pick the scholarly basis for the calc:
        nisab standard (gold vs silver) and investment-zakat method
        (full market value vs 30% long-term rule). Saved to
        localStorage and broadcast so the Overview tile re-renders. */}
    <BentoTile>
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
              {k:"longterm_30",label:"Long-term (30% rule)",note:"AAOIFI · buy & hold"},
              {k:"full",       label:"Full market value",    note:"Active trader"},
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
        Silver nisab is more inclusive (lower threshold); gold is the majority view. The 30% rule treats public-equity holdings as ~30% zakatable to approximate the share of company assets that are cash/receivables/inventory (vs. exempt fixed assets) — appropriate for long-term holders. Active traders should pick full value.
      </div>
      <div style={{marginTop:T.s2,fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.05em"}}>
        {liveNisab.source==="static"
          ? "Spot prices unavailable — using static fallback values."
          : `Live spot via ${liveNisab.source} · refreshed ${liveNisab.refreshed_at?new Date(liveNisab.refreshed_at).toLocaleString():"recently"}`}
      </div>
    </BentoTile>

    {/* ─── ROW 2: Log entry + import ───────────────── */}
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
      {importStatus&&<div style={{marginTop:T.s3,padding:`${T.s2} ${T.s3}`,borderRadius:T.rMd,fontFamily:FM,fontSize:11,background:importStatus.ok?T.gainBg:T.lossBg,border:`1px solid ${(importStatus.ok?T.gain:T.loss)+"30"}`,color:importStatus.ok?T.gain:T.loss,lineHeight:1.5}}>{importStatus.ok?"✓ ":"✗ "}{importStatus.msg}</div>}
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
        ?<div style={{padding:`${T.s8} ${T.s5}`,textAlign:"center",fontFamily:FU,fontSize:13,color:T.muted}}>No donations logged yet. Add one with the form above, or import a CSV.</div>
        :filtered.length===0
          ?<div style={{padding:`${T.s8} ${T.s5}`,textAlign:"center",fontFamily:FU,fontSize:13,color:T.muted}}>No donations match these filters. <button onClick={()=>{setFSearch("");setFStatus("all");setFMethod("all");setFAccount("all");setFYear("all");}} style={{background:"none",border:"none",color:T.blue,cursor:"pointer",textDecoration:"underline",font:"inherit"}}>Clear filters</button></div>
          :<Tbl cols={[
            {l:"Date",        r_:r=>editingId===r.id
              ?<input type="date" value={editDraft.dt} onChange={e=>setEditDraft({...editDraft,dt:e.target.value})} className="field" style={{fontSize:11,padding:`4px ${T.s2}`}}/>
              :<span style={{fontFamily:FM,fontSize:11,color:T.muted,fontVariantNumeric:"tabular-nums"}}>{r.dt||"—"}</span>},
            {l:"Organization",r_:r=>editingId===r.id
              ?<input value={editDraft.org} onChange={e=>setEditDraft({...editDraft,org:e.target.value})} className="field" style={{fontSize:12,padding:`4px ${T.s2}`}}/>
              :<span style={{fontFamily:FU,fontSize:13,color:T.text,letterSpacing:"-0.005em"}}>{r.org}</span>},
            {l:"Method",      r_:r=>editingId===r.id
              ?<input list="dn-methods" value={editDraft.method} onChange={e=>setEditDraft({...editDraft,method:e.target.value})} className="field" style={{fontSize:11,padding:`4px ${T.s2}`}}/>
              :<span style={{fontFamily:FM,fontSize:11,color:T.muted}}>{r.method||"—"}</span>},
            {l:"Account",     r_:r=>editingId===r.id
              ?<input list="dn-accts" value={editDraft.account} onChange={e=>setEditDraft({...editDraft,account:e.target.value})} className="field" style={{fontSize:11,padding:`4px ${T.s2}`}}/>
              :<span style={{fontFamily:FM,fontSize:11,color:T.muted}}>{r.account||"—"}</span>},
            {l:"Amount",r:true,r_:r=>editingId===r.id
              ?<input type="number" step="0.01" value={editDraft.amt} onChange={e=>setEditDraft({...editDraft,amt:e.target.value})} className="field" style={{fontSize:12,padding:`4px ${T.s2}`,fontVariantNumeric:"tabular-nums",textAlign:"right"}}/>
              :<span style={{fontFamily:FU,fontSize:13,fontWeight:600,color:T.gold,letterSpacing:"-0.005em",fontVariantNumeric:"tabular-nums"}}>{fmtUSD(r.amt)}</span>},
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
                <button onClick={()=>remove(r.id)} title="Remove this entry" style={{padding:`3px ${T.s2}`,borderRadius:T.rSm,background:"transparent",border:`1px solid ${T.loss}30`,color:T.loss,cursor:"pointer",fontFamily:FM,fontSize:11}}>✕</button>
              </div>},
          ]} rows={filtered}/>}
    </BentoTile>
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
        <p style={{fontFamily:FU,fontSize:13,color:T.muted,margin:`${T.s4} 0 0`,lineHeight:1.55,maxWidth:560}}>
          Set target weights per asset class. Mizan compares to your live allocation, flags drift, and proposes trades — one click pre-fills the Order Ticket.
        </p>
      </BentoTile>
      <BentoTile accent={halalOnly?T.gold:undefined} style={halalOnly?{background:`linear-gradient(135deg, ${T.gold}10, transparent 60%), ${T.card}`}:undefined}>
        <div style={{fontFamily:FM,fontSize:10,color:halalOnly?T.gold:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>HALAL-ONLY REBALANCE</div>
        <p style={{fontFamily:FU,fontSize:12,color:T.muted,margin:`0 0 ${T.s3}`,lineHeight:1.5}}>
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
        {l:"Asset Class",r_:r=><span style={{fontFamily:FU,fontSize:13,color:T.text,letterSpacing:"-0.005em"}}>{r.cls.label}</span>},
        {l:"Target %",r:true,r_:r=><span style={{fontFamily:FU,fontSize:13,color:T.text,fontVariantNumeric:"tabular-nums"}}>{r.tgt.toFixed(1)}%</span>},
        {l:"Current %",r:true,r_:r=><span style={{fontFamily:FU,fontSize:13,color:T.textHi,fontWeight:600,fontVariantNumeric:"tabular-nums"}}>{r.cur.toFixed(1)}%</span>},
        {l:"Current $",r:true,r_:r=><span style={{fontFamily:FM,fontSize:12,color:T.muted,fontVariantNumeric:"tabular-nums"}}>{fmt$(r.currentValue)}</span>},
        {l:"Drift",r:true,r_:r=><span style={{fontFamily:FU,fontSize:13,fontWeight:600,fontVariantNumeric:"tabular-nums",color:r.drift>0?T.gain:r.drift<0?T.loss:T.muted}}>{r.drift>0?"+":""}{r.drift.toFixed(1)}%</span>},
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
        ?<div style={{padding:`${T.s8} ${T.s5}`,textAlign:"center",fontFamily:FU,fontSize:13,color:T.muted}}>
          {total===0
            ?"Connect a brokerage or enable demo mode to see rebalance suggestions."
            :sumOK
              ?"No trades needed — every class is within tolerance of its target."
              :"Set targets that sum to 100% to generate suggestions."}
        </div>
        :<Tbl cols={[
          {l:"Action",r_:r=><Tag label={r.side.toUpperCase()} color={r.side==="sell"?T.loss:T.gain}/>},
          {l:"Symbol",r_:r=><span style={{fontFamily:FU,fontSize:13,fontWeight:600,color:T.textHi,letterSpacing:"-0.005em"}}>{r.sym}</span>},
          {l:"Qty",r:true,r_:r=><span style={{fontFamily:FU,fontSize:13,fontVariantNumeric:"tabular-nums",color:T.text}}>{r.qty.toLocaleString()}</span>},
          {l:"~Price",r:true,r_:r=><span style={{fontFamily:FM,fontSize:12,color:T.muted,fontVariantNumeric:"tabular-nums"}}>${r.price.toFixed(2)}</span>},
          {l:"~Amount",r:true,r_:r=><span style={{fontFamily:FU,fontSize:13,fontWeight:600,color:r.side==="sell"?T.loss:T.gain,fontVariantNumeric:"tabular-nums"}}>{fmt$(r.amount)}</span>},
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

/* ─── PORTFOLIO ──────────────────────────────────────── */
function Portfolio({live,snapAccounts=[],mapPosition,activities=[],documents=[],watchlist=[],onAddWatch,onRemoveWatch,onSetAlert,onAlertPermission,demoMode=false,onNav,bankBalance=0}){
  const { hidden: valuesHidden, toggle: toggleHideValues, mask } = useHideValues();
  const[sub,setSub]=useState("holdings");
  const[acct,setAcct]=useState("all");
  const[screen,setScreen]=useState("all");
  const[sort,setSort]=useState("mv");

  const baseHoldings=snapAccounts.length>0
    ? snapAccounts.flatMap(a=>a.positions.map(p=>mapPosition(p,a.accountName,a.brokerage))).filter(h=>h&&h.sh>0)
    : [];
  const merged=baseHoldings.map(h=>{const l=live.find(q=>q.tk===h.tk);return l?{...h,px:l.price||h.px,_p:l.pct||0,_live:true}:h;});

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
    <TabBar tabs={[["holdings","Holdings"],["activity","Activity"],["rebalance","Rebalance"],["tax","Tax"],["backtest","Backtest"],["screener","Screener"]]} active={sub} onChange={setSub}/>

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
          {merged.length>0&&<div style={{marginTop:T.s4,display:"flex",alignItems:"center",gap:T.s2}}>
            <Sk vals={Array.from({length:30},(_,i)=>tot*(0.92+i*0.0028))} color={totGain>=0?T.gain:T.loss} w={220} h={42} fill/>
            <span style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.06em"}}>30-day trend</span>
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
                <span style={{fontFamily:FU,fontSize:13,color:T.text,flex:1,letterSpacing:"-0.005em"}}>{s.label}</span>
                <span style={{fontFamily:FM,fontSize:11,fontWeight:500,color:T.muted,fontVariantNumeric:"tabular-nums"}}>{mask(kf(s.value))}</span>
                <span style={{fontFamily:FM,fontSize:11,fontWeight:600,color:T.textHi,fontVariantNumeric:"tabular-nums",minWidth:45,textAlign:"right"}}>{valuesHidden?"••":`${pct.toFixed(1)}%`}</span>
              </div>;
            })}
          </div>
        </div>
      </BentoTile>}

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
        <Tbl cols={[
          {l:"Symbol", r_:r=><div><div style={{fontFamily:FU,fontSize:14,fontWeight:600,color:r.sh_==="haram"?T.loss:T.textHi,letterSpacing:"-0.01em"}}>{r.tk}</div><div style={{fontFamily:FM,fontSize:10,color:T.muted,marginTop:2}}>{r.ac_}</div></div>},
          {l:"Shares",  r_:r=><span style={{fontFamily:FM,fontSize:12,color:T.text,fontVariantNumeric:"tabular-nums"}}>{valuesHidden?"••••":r.sh.toFixed(3)}</span>},
          {l:"Avg Cost",r:true,r_:r=><span style={{fontFamily:FM,fontSize:11,color:T.muted,fontVariantNumeric:"tabular-nums"}}>{mask(f$(r.ac))}</span>},
          {l:"Price",   r:true,r_:r=><div style={{textAlign:"right"}}><div style={{fontFamily:FM,fontSize:13,fontWeight:500,color:r._live?T.textHi:T.text,fontVariantNumeric:"tabular-nums"}}>{mask(f$(r.px))}</div>{r._live&&<div style={{fontFamily:FM,fontSize:9,color:T.gain,letterSpacing:"0.06em",marginTop:1}}>● LIVE</div>}</div>},
          {l:"Today",   r:true,r_:r=><span style={{fontFamily:FM,fontSize:11,fontWeight:500,color:fc(r._p),fontVariantNumeric:"tabular-nums"}}>{valuesHidden?"••":(r._p?fp(r._p):"—")}</span>},
          {l:"Mkt Value",r:true,r_:r=><span style={{fontFamily:FU,fontSize:14,fontWeight:600,color:T.textHi,letterSpacing:"-0.005em",fontVariantNumeric:"tabular-nums"}}>{mask(f$(mv(r)))}</span>},
          {l:"Gain/Loss",r:true,r_:r=><div style={{textAlign:"right"}}><div style={{fontFamily:FM,fontSize:12,fontWeight:500,color:fc(gv(r)),fontVariantNumeric:"tabular-nums"}}>{mask(`${gv(r)>=0?"+":""}${f$(gv(r))}`)}</div><div style={{fontFamily:FM,fontSize:10,color:fc(gp(r)),marginTop:1}}>{valuesHidden?"••":fp(gp(r))}</div></div>},
          {l:"Sharia",  r_:r=><Tag label={r.sh_==="halal"?"Halal":r.sh_==="haram"?"Non-Compliant":"Review"} color={r.sh_==="halal"?T.gain:r.sh_==="haram"?T.loss:T.gold}/>},
        ]} rows={filtered}/>
        {filtered.length===0&&merged.length===0&&snapAccounts.length===0
          // No accounts connected → genuine empty state, show skeleton rows
          // so users sense the table shape while their first sync runs in
          // the background. After the first sync completes, the empty
          // state below replaces this only if filters knocked everything out.
          ?<div style={{padding:T.s4}}><SkeletonTable rows={8} cols={6}/></div>
          :filtered.length===0
            ?<div style={{padding:`${T.s10} ${T.s5}`,textAlign:"center",fontFamily:FU,fontSize:13,color:T.muted}}>No positions match these filters.</div>
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

    {sub==="activity"&&<ActivityPanel activities={activities} accounts={snapAccounts}/>}

    {sub==="rebalance"&&<Rebalancer holdings={merged} snapAccounts={snapAccounts} onNav={onNav}/>}

    {sub==="tax"&&<TaxPlanner holdings={merged} activities={activities} snapAccounts={snapAccounts}/>}

    {/* Backtest moved here from the dropped Trade tab — it's a Portfolio
        research tool by nature, not a trading one. Uses Polygon for OHLC. */}
    {sub==="backtest"&&<HistoricalBacktest/>}

    {sub==="screener"&&<AAOIFIScreener holdings={merged}/>}
  </div>;
}

/* ─── WATCHLIST ──────────────────────────────────────── */
// Watchlist renders as a BentoTile, with sparklines per row when we have
// live data. Empty state is a dashed BentoTile that doubles as the add form.
function Watchlist({live=[],watchlist=[],onAdd,onRemove,onSetAlert,onAlertPermission}){
  const[input,setInput]=useState("");
  const submit=(e)=>{e.preventDefault();if(!input.trim())return;onAdd(input);setInput("");};
  const notifPerm=typeof Notification!=="undefined"?Notification.permission:"unsupported";

  return<BentoTile>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:T.s4,flexWrap:"wrap",gap:T.s2}}>
      <span style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600}}>WATCHLIST{watchlist.length>0?<span style={{color:T.muted,marginLeft:T.s2,fontWeight:400}}>· {watchlist.length} symbols</span>:""}</span>
      <div style={{display:"flex",gap:T.s2,alignItems:"center",flexWrap:"wrap"}}>
        {notifPerm!=="granted"&&<button onClick={onAlertPermission} style={{padding:`5px ${T.s3}`,borderRadius:T.rMd,fontFamily:FM,fontSize:10,fontWeight:600,letterSpacing:"0.06em",background:`${T.gold}18`,border:`1px solid ${T.gold}40`,color:T.gold,cursor:"pointer"}}>{notifPerm==="denied"?"Alerts blocked":"Enable alerts"}</button>}
        <form onSubmit={submit} style={{display:"flex",gap:T.s2}}>
          <input value={input} onChange={e=>setInput(e.target.value.toUpperCase())} placeholder="Add ticker"
            className="field" style={{width:120,fontSize:12,padding:`6px ${T.s3}`}}/>
          <button type="submit" className="btn-primary" style={{fontSize:11,padding:`6px ${T.s4}`}}>+ Add</button>
        </form>
      </div>
    </div>
    {watchlist.length===0
      ?<div style={{padding:`${T.s8} ${T.s5}`,textAlign:"center",fontFamily:FU,fontSize:13,color:T.muted,border:`1px dashed ${T.border}`,borderRadius:T.rMd}}>
          No symbols yet. Add a ticker above to track price + set alerts.
        </div>
      :<div style={{overflow:"hidden",borderRadius:T.rMd,border:`1px solid ${T.border}`}}>
          <Tbl cols={[
            {l:"Symbol",r_:r=><span style={{fontFamily:FU,fontSize:14,fontWeight:600,color:T.textHi,letterSpacing:"-0.01em"}}>{r.symbol}</span>},
            {l:"Price",r:true,r_:r=>{const px=live.find(l=>l.tk===r.symbol)?.price;return<span style={{fontFamily:FU,fontSize:13,fontWeight:600,color:px?T.textHi:T.muted,fontVariantNumeric:"tabular-nums"}}>{px?f$(px):"—"}</span>;}},
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
            {l:"",r_:r=><button onClick={()=>onRemove(r.symbol)} style={{padding:`3px ${T.s2}`,borderRadius:T.rSm,background:"transparent",border:`1px solid ${T.loss}30`,color:T.loss,cursor:"pointer",fontFamily:FM,fontSize:11}}>✕</button>},
          ]} rows={watchlist}/>
        </div>}
  </BentoTile>;
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
            <span style={{fontFamily:FU,fontSize:14,fontWeight:600,color:T.textHi,letterSpacing:"-0.01em",fontVariantNumeric:"tabular-nums"}}>{s.fmt(s.v)}</span>
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

  return<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.72)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
    <div style={{background:T.surface,border:`1px solid ${T.borderHi}`,borderRadius:14,width:"100%",maxWidth:480,boxShadow:T.shadow,overflow:"hidden"}}>
      <div style={{padding:"14px 18px",borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div>
          <div style={{fontFamily:FM,fontSize:12,fontWeight:600,color:T.textHi}}>Confirm {side==="buy"?"Buy":"Sell"} {sym}</div>
          <div style={{fontFamily:FU,fontSize:11,color:T.muted,marginTop:2}}>SnapTrade preview · review before placing</div>
        </div>
        <button onClick={onCancel} style={{background:"none",border:"none",color:T.muted,cursor:"pointer",fontSize:18,lineHeight:1}}>✕</button>
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
          ⚠ {Array.isArray(warnings)?warnings.join(" · "):String(warnings)}
        </div>}
        <div style={{padding:"10px 12px",background:`${T.gain}0E`,border:`1px solid ${T.gain}25`,borderRadius:8,fontFamily:FU,fontSize:11,color:T.text,lineHeight:1.5}}>
          ✓ Sharia pre-check: spot equity, no margin, no derivatives. Run the screener after placing if {sym} isn't classified yet.
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
    <p style={{fontFamily:FU,fontSize:13,color:T.muted,margin:0,lineHeight:1.7,maxWidth:680}}>
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
          {l:"Price",r:true,r_:r=><span style={{fontFamily:FM,fontSize:11,color:T.muted}}>{r.price?f$(r.price):"—"}</span>},
          {l:"Amount",r:true,r_:r=>{const v=+r.amount||0;return<span style={{fontFamily:FM,fontSize:12,fontWeight:500,color:v>0?T.gain:v<0?T.loss:T.text}}>{v>=0?"+":"−"}{f$(Math.abs(v))}</span>;}},
        ]} rows={recentTrades}/>
      </div>}
  </div>;
}

/* ─── HISTORICAL BACKTEST ────────────────────────────── */
// Polygon /v2/aggs daily bars + simple SMA-50/200 crossover strategy.
// Buy when SMA-50 crosses above SMA-200, sell when it crosses below.
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

  // Compute SMAs + signal trades
  const{series,trades,stats}=useMemo(()=>{
    if(bars.length<200)return{series:bars.map(b=>({t:b.t,c:b.c})),trades:[],stats:{}};
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
    // Chain returns multiplicatively: each trade's return (%) compounds the prior equity.
    const chained=closed.reduce((acc,t)=>acc*(1+(t.return||0)/100),1)-1;
    const totalRet=chained*100;
    const buyHold=bars.length>1?((bars[bars.length-1].c-bars[0].c)/bars[0].c)*100:0;
    return{series,trades,stats:{trades:closed.length,wins,losses:closed.length-wins,winRate:closed.length?(wins/closed.length)*100:0,totalRet,buyHold,bars:bars.length}};
  },[bars]);

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
        <div style={{padding:`${T.s3} ${T.s3}`,background:T.surface,borderRadius:T.rMd,border:`1px solid ${T.border}`,fontFamily:FU,fontSize:12,color:T.muted,lineHeight:1.55,letterSpacing:"-0.005em"}}>
          <strong style={{color:T.text,fontWeight:600}}>Strategy:</strong> SMA-50 / SMA-200 crossover. Buy when 50-day crosses above 200-day; sell on cross below. Free-tier Polygon caps at 2 years of daily bars.
        </div>
        <button onClick={run} disabled={busy} className="btn-primary" style={{padding:`10px ${T.s4}`}}>{busy?"Fetching bars…":"Run Backtest"}</button>
        {err&&<div style={{padding:`${T.s2} ${T.s3}`,background:T.lossBg,border:`1px solid ${T.loss}30`,borderRadius:T.rMd,fontFamily:FM,fontSize:11,color:T.loss}}>✗ {err}</div>}
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
        ?<div style={{height:320,display:"flex",alignItems:"center",justifyContent:"center",border:`1px dashed ${T.border}`,borderRadius:T.rMd,fontFamily:FU,fontSize:13,color:T.muted}}>Run a backtest to load bars from Polygon</div>
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

function TradeBot({currentNW=0,ytdContrib=0,accounts=[],onOrderPlaced,activities=[],onNav}){
  // Order Ticket is currently behind a "Coming Soon" gate — real trading
  // requires Alpaca prod keys + a polished risk/preview flow we haven't
  // shipped yet. Default to the FIRE calculator so the tab opens onto
  // something useful instead of a placeholder.
  const[sub,setSub]=useState("fire");
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

  const estTotal=parseFloat(qty||0)*parseFloat(lpx||0);

  return<div style={{display:"flex",flexDirection:"column",gap:T.s5}}>
    <TabBar tabs={[["order","Order Ticket"],["backtest","Backtest"],["fire","Retirement / FIRE"],["sharia","Sharia Principles"]]} active={sub} onChange={setSub}/>
    {sub==="fire"&&<FireCalculator currentNW={currentNW} ytdContrib={ytdContrib}/>}
    {sub==="backtest"&&<HistoricalBacktest/>}

    {/* Order Ticket lives behind a Coming Soon banner. We still render the
        TabBar entry so users discover it's planned, but the actual order-
        placement UI (real-money via SnapTrade, paper via Alpaca) is gated
        until the risk/preview flow is finished and the Alpaca production
        keys are provisioned. */}
    {sub==="order"&&<ComingSoon
      title="Order Ticket"
      description="Place halal-screened buy/sell orders against your connected SnapTrade brokerage or against a free Alpaca paper account. The interface, AAOIFI pre-check, and order preview are built — they're behind a Coming Soon gate until the risk-of-loss UX and Alpaca production keys finish review."
      hint="Want early access? Use the AI Advisor tab to research positions while this ships."
      action={onNav ? { label: "Open AI Advisor", onClick: () => onNav("advisor") } : null}
    />}
    {false&&sub==="order"&&impactPreview&&<OrderPreviewModal preview={impactPreview} onConfirm={placeOrder} onCancel={cancelPreview} busy={orderBusy} side={side} sym={sym} qty={qty}/>}
    {false&&sub==="order"&&<div className="bento-row mz-side-by-side" style={{display:"grid",gridTemplateColumns:"360px 1fr",gap:T.s4}}>
      {/* ─── Order Ticket bento ────────────────────────── */}
      <BentoTile style={{display:"flex",flexDirection:"column",gap:T.s4}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:T.s2,flexWrap:"wrap"}}>
          <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600}}>ORDER TICKET</div>
          <Tag label={venue==="alpaca"?"PAPER · ALPACA":"LIVE · SNAPTRADE"} color={venue==="alpaca"?T.gold:T.blue}/>
        </div>
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
            flex:1,padding:"10px",fontFamily:FU,fontSize:13,fontWeight:600,letterSpacing:"-0.005em",
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
        {[["SYMBOL",sym,setSym,"text"],["QUANTITY",qty,setQty,"number"],["LIMIT PRICE",lpx,setLpx,"number"]].map(([l,v,set,type])=>
          <div key={l}>
            <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.14em",fontWeight:600,marginBottom:T.s1}}>{l}</div>
            <input type={type} value={v} onChange={e=>set(type==="text"?e.target.value.toUpperCase():e.target.value)}
              className="field" style={{fontSize:type==="text"?16:14,fontWeight:type==="text"?600:500,color:type==="text"?T.blue:T.text,letterSpacing:type==="text"?"-0.01em":"0",fontVariantNumeric:"tabular-nums"}}/>
          </div>)}
        <div style={{background:T.surface,borderRadius:T.rMd,padding:`${T.s3} ${T.s4}`,border:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"baseline"}}>
          <span style={{fontFamily:FM,fontSize:11,color:T.muted,letterSpacing:"0.04em"}}>Estimated Total</span>
          <span style={{fontFamily:FU,fontSize:16,fontWeight:700,color:T.textHi,letterSpacing:"-0.015em",fontVariantNumeric:"tabular-nums"}}>{f$(estTotal)}</span>
        </div>
        <div style={{background:`linear-gradient(135deg, ${T.gain}12, transparent 70%), ${T.surface}`,border:`1px solid ${T.gain}28`,borderRadius:T.rMd,padding:`${T.s2} ${T.s3}`}}>
          <div style={{fontFamily:FM,fontSize:9,color:T.gain,letterSpacing:"0.16em",fontWeight:600,marginBottom:2}}>● SHARIA PRE-CHECK</div>
          <div style={{fontFamily:FU,fontSize:12,color:T.text,letterSpacing:"-0.005em"}}>{sym} — screening against AAOIFI criteria</div>
        </div>
        <button onClick={submit} disabled={orderBusy||(venue==="snaptrade"&&!acctId)} style={{
          padding:`12px ${T.s4}`,borderRadius:T.rMd,
          fontFamily:FU,fontSize:13,fontWeight:600,letterSpacing:"-0.005em",
          border:"none",cursor:orderBusy||(venue==="snaptrade"&&!acctId)?"not-allowed":"pointer",
          background:done?`${T.gain}22`:orderBusy?T.dim:`linear-gradient(135deg, ${side==="buy"?T.gain:T.loss}, ${side==="buy"?"#0A8A65":"#D85555"})`,
          color:done?T.gain:orderBusy?T.muted:"#fff",
          transition:"all 0.2s",
          boxShadow:done||orderBusy?"none":`0 4px 14px ${(side==="buy"?T.gain:T.loss)}55`,
        }}>
          {done?"Order Placed ✓":orderBusy?"Loading…":venue==="alpaca"?`Place Paper ${side==="buy"?"Buy":"Sell"} ${sym}`:`Preview ${side==="buy"?"Buy":"Sell"} ${sym}`}
        </button>
        {orderErr&&<div style={{padding:`${T.s2} ${T.s3}`,background:T.lossBg,border:`1px solid ${T.loss}30`,borderRadius:T.rMd,fontFamily:FM,fontSize:11,color:T.loss,whiteSpace:"pre-wrap",lineHeight:1.4}}>✗ {orderErr}</div>}
      </BentoTile>

      {/* ─── Order Types card grid ─────────────────────── */}
      <BentoTile>
        <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s4}}>ORDER TYPES</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(280px, 1fr))",gap:T.s2}}>
          {ORDERS.map(([nm,desc,ok])=><div key={nm} style={{
            background:T.surface,
            border:`1px solid ${T.border}`,
            borderLeft:`3px solid ${ok?T.gain:T.loss}`,
            borderRadius:T.rMd,
            padding:`${T.s3} ${T.s4}`,
            display:"flex",gap:T.s3,alignItems:"flex-start",
            opacity:ok?1:0.7,
          }}>
            <div style={{
              width:18,height:18,borderRadius:T.rSm,flexShrink:0,marginTop:2,
              background:ok?`${T.gain}22`:`${T.loss}22`,
              border:`1px solid ${ok?T.gain:T.loss}40`,
              display:"flex",alignItems:"center",justifyContent:"center",
              fontFamily:FM,fontSize:10,color:ok?T.gain:T.loss,fontWeight:700,
            }}>{ok?"✓":"✕"}</div>
            <div>
              <div style={{fontFamily:FU,fontSize:13,fontWeight:600,color:ok?T.textHi:T.muted,letterSpacing:"-0.005em",marginBottom:T.s1}}>{nm}</div>
              <div style={{fontFamily:FU,fontSize:12,color:T.muted,lineHeight:1.55,letterSpacing:"-0.005em"}}>{desc}</div>
            </div>
          </div>)}
        </div>
      </BentoTile>
    </div>}

    {sub==="sharia"&&<div className="bento-row" style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(280px, 1fr))",gap:T.s3}}>
      {[
        {t:"No Riba (Interest)",ok:true,d:"Cash-only accounts. No margin, no overnight interest charges. Never borrows capital to trade."},
        {t:"No Gharar (Uncertainty)",ok:true,d:"Spot equity only. No options, futures, CFDs, or leveraged ETFs."},
        {t:"No Maisir (Gambling)",ok:true,d:"Systematic edge required. Positive expectancy confirmed before any capital is deployed."},
        {t:"Debt Screening",ok:true,d:"Total Debt / Total Assets must be below 33% per AAOIFI standard."},
        {t:"Revenue Test",ok:true,d:"Haram revenue must be below 5% of total revenue. Purification calculated for mixed income."},
        {t:"No Short Selling",ok:false,d:"You cannot sell what you don't own. Long positions only — no inverse or bear positions."},
        {t:"No Derivatives",ok:false,d:"Options and futures contracts are prohibited under Gharar (excessive uncertainty)."},
        {t:"No Margin",ok:false,d:"Borrowed capital with interest charges is Riba — absolutely prohibited."},
      ].map(r=><BentoTile key={r.t} style={{borderLeft:`3px solid ${r.ok?T.gain:T.loss}`}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:T.s2,marginBottom:T.s2}}>
          <span style={{fontFamily:FU,fontSize:14,fontWeight:600,color:r.ok?T.textHi:T.muted,letterSpacing:"-0.01em"}}>{r.t}</span>
          <Tag label={r.ok?"Required":"Prohibited"} color={r.ok?T.gain:T.loss}/>
        </div>
        <p style={{fontFamily:FU,fontSize:13,color:T.muted,margin:0,lineHeight:1.6,letterSpacing:"-0.005em"}}>{r.d}</p>
      </BentoTile>)}
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
    const sys=`You are MIZAN's Sharia-aware personal finance advisor. Use AAOIFI screening rules. Be specific, numeric, and concise (under 150 words unless asked). Use the portfolio summary below to answer.\n\n${context}`;
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
    {q:"What's my biggest concentration risk?",            cat:"Risk",       icon:"⚠",  color:T.loss},
    {q:"Recommend 3 Sharia-compliant ETFs to diversify",   cat:"Allocation", icon:"◆",  color:T.blue},
    {q:"Should I tax-loss harvest any positions?",         cat:"Tax",        icon:"$",  color:T.gold},
    {q:"What's my projected Zakat for the year?",          cat:"Zakat",      icon:"⚖",  color:T.gold},
    {q:"How do I exit non-compliant positions efficiently?",cat:"Compliance",icon:"✓",  color:T.gain},
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
          <div style={{fontFamily:FU,fontSize:14,fontWeight:600,color:T.textHi,letterSpacing:"-0.01em"}}>Mizan Advisor</div>
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

    {/* ─── CHAT THREAD ────────────────────────────── */}
    <BentoTile style={{padding:0,display:"flex",flexDirection:"column",minHeight:"60vh",maxHeight:"calc(100vh - 280px)"}}>
      <div ref={scrollRef} style={{flex:1,overflowY:"auto",padding:`${T.s6} ${T.s6}`,display:"flex",flexDirection:"column",gap:T.s4}}>
        {msgs.length===0&&<div style={{margin:"auto 0",display:"flex",flexDirection:"column",gap:T.s5}}>
          <div style={{textAlign:"center"}}>
            <div style={{fontFamily:FU,fontSize:24,fontWeight:700,color:T.textHi,letterSpacing:"-0.025em",marginBottom:T.s2}}>How can I help with your portfolio?</div>
            <div style={{fontFamily:FU,fontSize:14,color:T.muted,maxWidth:480,margin:"0 auto",lineHeight:1.55}}>
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
              fontFamily:FU,fontSize:13,color:T.text,cursor:busy?"not-allowed":"pointer",
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
                }}>{p.icon}</span>
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
              fontFamily:FU,fontSize:13,fontWeight:700,color:isErr?T.loss:"#fff",letterSpacing:"-0.02em",
              boxShadow:isErr?"none":`0 2px 8px ${T.blue}40`,
            }}>{isErr?"!":"M"}</div>}
            <div style={{
              maxWidth:"78%",
              padding:`${T.s3} ${T.s4}`,
              borderRadius:T.rLg,
              background:isUser?`linear-gradient(135deg, ${T.blue}, ${T.blueDim})`:isErr?T.lossBg:T.surface,
              border:isUser?"none":`1px solid ${isErr?T.loss+"40":T.border}`,
              color:isUser?"#fff":isErr?T.loss:T.text,
              fontFamily:FU,fontSize:14,lineHeight:1.6,letterSpacing:"-0.005em",
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
              fontFamily:FU,fontSize:13,fontWeight:600,color:T.text,
            }}>Y</div>}
          </div>;
        })}

        {busy&&<div style={{display:"flex",gap:T.s3,alignItems:"center"}}>
          <div style={{width:32,height:32,borderRadius:T.rMd,flexShrink:0,background:`linear-gradient(135deg, ${T.blue}, ${T.blueDim})`,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:FU,fontSize:13,fontWeight:700,color:"#fff"}}>M</div>
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
        <span style={{fontWeight:700}}>{tokenNotice.kind==="err"?"✕":"⚠"}</span>
        <span>{tokenNotice.text}</span>
      </div>}
      <form onSubmit={e=>{e.preventDefault();send();}} style={{borderTop:`1px solid ${T.border}`,padding:T.s3,display:"flex",gap:T.s2,background:T.surface}}>
        <input value={input} onChange={e=>setInput(e.target.value)} placeholder="Ask about your portfolio…" disabled={busy}
          className="field" style={{flex:1,fontFamily:FU,fontSize:14,padding:`10px ${T.s4}`}}/>
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
        <p style={{fontFamily:FU,fontSize:13,color:T.muted,margin:`${T.s4} 0 0`,lineHeight:1.55,maxWidth:560}}>
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
          {l:"Name",r_:r=><span style={{fontFamily:FU,fontSize:13,color:T.text,letterSpacing:"-0.005em"}}>{r.name}</span>},
          {l:"Value",r:true,r_:r=><span style={{fontFamily:FU,fontSize:14,fontWeight:600,color:T.textHi,letterSpacing:"-0.005em",fontVariantNumeric:"tabular-nums"}}>{f$(r.value)}</span>},
          {l:"Zakat",r_:r=><Tag label={r.zakatable?"Included":"Excluded"} color={r.zakatable?T.gold:T.muted}/>},
          {l:"Added",r_:r=><span style={{fontFamily:FM,fontSize:11,color:T.muted,fontVariantNumeric:"tabular-nums"}}>{r.added}</span>},
          {l:"",r_:r=>demoMode
            ?<span style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.04em"}}>—</span>
            :<button onClick={()=>remove(r.id)} style={{padding:`3px ${T.s2}`,borderRadius:T.rSm,background:"transparent",border:`1px solid ${T.loss}30`,color:T.loss,cursor:"pointer",fontFamily:FM,fontSize:11}}>✕</button>},
        ]} rows={assets}/>
      </BentoTile>
      :<BentoTile style={{padding:`${T.s8} ${T.s5}`,textAlign:"center",borderStyle:"dashed"}}>
        <div style={{fontFamily:FU,fontSize:14,fontWeight:500,color:T.muted}}>No manual assets yet.</div>
        <div style={{fontFamily:FU,fontSize:12,color:T.muted,marginTop:T.s1}}>Add gold, real estate, or business equity above to include them in net-worth + Zakat math.</div>
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
        <div style={{fontFamily:FU,fontSize:14,fontWeight:600,color:T.textHi,marginBottom:T.s1,letterSpacing:"-0.01em"}}>CSV Import — Historical Backfill</div>
        <p style={{fontFamily:FU,fontSize:13,color:T.muted,margin:0,lineHeight:1.55,maxWidth:480}}>
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
    {status&&<div style={{marginTop:T.s3,padding:`${T.s2} ${T.s3}`,borderRadius:T.rMd,fontFamily:FM,fontSize:11,background:status.ok?T.gainBg:T.lossBg,border:`1px solid ${(status.ok?T.gain:T.loss)+"30"}`,color:status.ok?T.gain:T.loss,whiteSpace:"pre-wrap",lineHeight:1.5}}>{status.ok?"✓ ":"✗ "}{status.msg}</div>}
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
      <p style={{fontFamily:FU,fontSize:13,color:T.muted,margin:0,lineHeight:1.6}}>Multi-factor authentication requires Supabase Auth. Configure VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY to enable.</p>
    </div>;
  }

  return<div style={{display:"flex",flexDirection:"column",gap:14}}>
    <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:"22px 24px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:14,marginBottom:10}}>
        <div>
          <div style={{fontFamily:FM,fontSize:11,color:T.blue,letterSpacing:"0.16em",fontWeight:600,marginBottom:6}}>TWO-FACTOR AUTHENTICATION</div>
          <p style={{fontFamily:FU,fontSize:13,color:T.muted,margin:0,lineHeight:1.6,maxWidth:520}}>
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
        <p style={{fontFamily:FU,fontSize:13,color:T.muted,margin:0,lineHeight:1.6,maxWidth:520}}>
          Every device currently signed into MIZAN with your account. Revoke any that you don't recognize.
        </p>
      </div>
      {otherCount>0&&<button onClick={revokeAllOthers} disabled={busy} className="btn-danger">Sign out all others</button>}
    </div>

    {toast&&<div style={{marginBottom:T.s3,padding:`${T.s2} ${T.s3}`,borderRadius:T.rMd,background:T.gainBg,border:`1px solid ${T.gain}30`,fontFamily:FM,fontSize:11,color:T.gain}}>✓ {toast}</div>}
    {err&&<div style={{marginBottom:T.s3,padding:`${T.s2} ${T.s3}`,borderRadius:T.rMd,background:`${T.loss}10`,border:`1px solid ${T.loss}40`,fontFamily:FM,fontSize:11,color:T.loss}}>✗ {err}</div>}

    {loading
      ?<div style={{fontFamily:FM,fontSize:11,color:T.muted,padding:`${T.s3} 0`}}>Loading…</div>
      :sessions.length===0
        ?<div style={{fontFamily:FU,fontSize:13,color:T.muted,padding:`${T.s3} 0`}}>No active sessions found.</div>
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
                  <div style={{fontFamily:FU,fontSize:13,fontWeight:600,color:T.textHi,letterSpacing:"-0.005em",display:"flex",alignItems:"center",gap:T.s2,flexWrap:"wrap"}}>
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

function Settings({apiKeys,setApiKeys,onConnect,onImportCSV,onDedupeCSV,onRetagCSV,onReplayOnboarding,demoMode,onToggleDemo,documents=[],accounts=[],onNav}){
  const{user,signOut,isSupabaseConfigured,isRoot}=useAuth();
  const[keys,setKeys]=useState({...apiKeys});
  const[saved,setSaved]=useState(false);
  // Non-root accounts never see the API Keys page — those keys belong on
  // the server (env vars), not in user-entered fields. Default the sub-tab
  // to brokers for everyone else.
  const[sub,setSub]=useState(isRoot?"keys":"brokers");
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
          ?<div style={{display:"flex",gap:T.s2,alignItems:"center"}}>
            {onReplayOnboarding&&<button onClick={onReplayOnboarding} className="btn-ghost" title="Re-run the 5-step welcome tour">Replay tour</button>}
            <button onClick={async()=>{if(confirm("Sign out of MIZAN?"))await signOut();}} className="btn-danger">Sign out</button>
          </div>
          :<span style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.08em"}}>Set VITE_SUPABASE_URL to enable accounts</span>}
      </div>
    </BentoTile>

    <TabBar
      tabs={[
        ...(isRoot?[["keys","API Keys"]]:[]),
        ["brokers","Connect Accounts"],
        ["connections","Connections"],
        ["account","Account"],
        ["security","Security"],
        ["notifications","Notifications"],
        ["assets","Manual Assets"],
        ["docs","Documents"],
        ["privacy","Privacy & Data"],
        ["about","About"],
        ...(isRoot?[["admin","Admin"]]:[]),
      ]}
      active={sub}
      onChange={setSub}
    />

    {sub==="connections"&&<ConnectionHealth onNav={onNav}/>}

    {sub==="assets"&&<ManualAssets demoMode={demoMode}/>}

    {/* ─── API KEYS (Root only) ───────────────────── */}
    {sub==="keys"&&isRoot&&<div style={{display:"flex",flexDirection:"column",gap:T.s4}}>
      <BentoTile>
        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:T.s4,flexWrap:"wrap"}}>
          <div>
            <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>API KEYS · ADMIN</div>
            <p style={{fontFamily:FU,fontSize:13,color:T.muted,margin:0,lineHeight:1.55,maxWidth:520}}>
              Add keys in order. Finnhub activates real prices immediately. Keys save to localStorage — no re-entry needed. End-user accounts don't see this page.
            </p>
          </div>
          <button onClick={save} className="btn-primary" style={{background:saved?`linear-gradient(135deg, ${T.gain}, #0A8A65)`:undefined,boxShadow:saved?`0 2px 10px ${T.gain}55`:undefined}}>{saved?"Saved ✓":"Save Keys"}</button>
        </div>
      </BentoTile>

      {APIS.map(api=><BentoTile key={api.id} accent={api.color}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:T.s3,flexWrap:"wrap",gap:T.s2}}>
          <div style={{display:"flex",gap:T.s2,alignItems:"center",flexWrap:"wrap"}}>
            <span style={{fontFamily:FU,fontSize:14,fontWeight:600,color:T.textHi,letterSpacing:"-0.01em"}}>{api.l}</span>
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
              {has(f.k)&&<span style={{position:"absolute",right:T.s3,top:"50%",transform:"translateY(-50%)",fontFamily:FM,fontSize:11,fontWeight:700,color:api.color}}>✓</span>}
            </div>
          </div>)}
        </div>}
        {api.serverOnly&&<div style={{marginTop:T.s2,display:"flex",alignItems:"center",gap:T.s2,padding:`${T.s2} ${T.s3}`,background:`${T.gain}0F`,border:`1px solid ${T.gain}30`,borderRadius:T.rMd,fontFamily:FM,fontSize:11,color:T.gain,lineHeight:1.5}}>
          ✓ Server-configured. Set <code style={{color:T.text,padding:"1px 5px",background:T.surface,borderRadius:4}}>{api.id==="anthropic"?"ANTHROPIC_KEY":"SNAPTRADE_CONSUMER_KEY"}</code> in env vars on the host. Never exposed to the browser.
        </div>}
      </BentoTile>)}

      <BentoTile>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:T.s4,flexWrap:"wrap",gap:T.s2}}>
          <span style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600}}>FEATURES ACTIVE</span>
          <span style={{fontFamily:FU,fontSize:14,fontWeight:600,color:T.textHi,fontVariantNumeric:"tabular-nums"}}>{FEATURES.filter(f=>f.alwaysOn||f.req.every(r=>has(r))).length}<span style={{color:T.muted,fontWeight:400}}> / {FEATURES.length}</span></span>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(240px, 1fr))",gap:T.s2}}>
          {FEATURES.map(f=>{
            const on=f.alwaysOn||f.req.every(r=>has(r));
            return<div key={f.f} style={{display:"flex",gap:T.s2,alignItems:"center",padding:`${T.s2} ${T.s3}`,background:T.surface,border:`1px solid ${on?T.gain+"30":T.border}`,borderRadius:T.rMd}}>
              <LiveDot on={on}/>
              <span style={{fontFamily:FU,fontSize:12,color:on?T.text:T.muted,letterSpacing:"-0.005em"}}>{f.f}</span>
              {f.note&&<span style={{fontFamily:FM,fontSize:10,color:T.muted,marginLeft:"auto"}}>{f.note}</span>}
            </div>;
          })}
        </div>
      </BentoTile>
    </div>}

    {/* ─── CONNECT ACCOUNTS ─────────────────────────── */}
    {sub==="brokers"&&<div style={{display:"flex",flexDirection:"column",gap:T.s4}}>
      <BentoTile>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:T.s4,flexWrap:"wrap"}}>
          <div>
            <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>BROKERAGE CONNECTIONS</div>
            <p style={{fontFamily:FU,fontSize:13,color:T.muted,margin:0,lineHeight:1.55,maxWidth:520}}>
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
              <div style={{fontFamily:FU,fontSize:14,fontWeight:600,color:conn?T.blue:T.textHi,letterSpacing:"-0.01em",marginBottom:T.s1}}>{b.nm}</div>
              <div style={{fontFamily:FM,fontSize:10,color:T.muted,marginBottom:T.s2}}>{b.desc}</div>
              <Tag label={conn?"Connected":"Not Connected"} color={conn?T.gain:T.muted}/>
            </div>;
          })}
        </div>
      </BentoTile>

      {/* CSV import for historical backfill */}
      <CSVImporter onImport={onImportCSV} onDedupe={onDedupeCSV} onRetag={onRetagCSV}/>

      {/* Demo mode toggle */}
      <BentoTile accent={demoMode?T.gold:null} style={demoMode?{background:`linear-gradient(135deg, ${T.gold}0F, transparent 60%), ${T.card}`}:undefined}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:T.s4,flexWrap:"wrap"}}>
          <div>
            <div style={{fontFamily:FM,fontSize:10,color:demoMode?T.gold:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>DEMO MODE</div>
            <p style={{fontFamily:FU,fontSize:13,color:T.muted,margin:0,lineHeight:1.55,maxWidth:520}}>
              Replaces your live data with a fictional ~$42M halal portfolio across 8 brokers — useful for screenshots, sharing, or previewing MIZAN before connecting brokers.
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

    {sub==="account"&&<AccountPanel/>}
    {sub==="security"&&<SecurityPanel/>}
    {sub==="notifications"&&<NotificationsPanel/>}
    {sub==="docs"&&<DocumentsPanel documents={documents} accounts={accounts}/>}
    {sub==="privacy"&&<PrivacyPanel/>}
    {sub==="about"&&<About/>}
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
      <p style={{fontFamily:FU,fontSize:13,color:T.muted,margin:0,lineHeight:1.6}}>This browser doesn't support push notifications.</p>
    </BentoTile>;
  }

  const enabled=!!subscription&&permission==="granted";

  return<div style={{display:"flex",flexDirection:"column",gap:T.s4}}>
    <BentoTile>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:T.s4,marginBottom:T.s3,flexWrap:"wrap"}}>
        <div>
          <div style={{fontFamily:FM,fontSize:11,color:T.blue,letterSpacing:"0.16em",fontWeight:600,marginBottom:6}}>PUSH NOTIFICATIONS</div>
          <p style={{fontFamily:FU,fontSize:13,color:T.muted,margin:0,lineHeight:1.6,maxWidth:520}}>
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
      {ok&&<div style={{marginTop:T.s3,padding:`${T.s2} ${T.s3}`,borderRadius:T.rMd,background:T.gainBg,border:`1px solid ${T.gain}30`,fontFamily:FM,fontSize:11,color:T.gain}}>✓ {ok}</div>}
      {err&&<div style={{marginTop:T.s3,padding:`${T.s2} ${T.s3}`,borderRadius:T.rMd,background:`${T.loss}10`,border:`1px solid ${T.loss}40`,fontFamily:FM,fontSize:11,color:T.loss}}>✗ {err}</div>}
    </BentoTile>

    <BentoTile>
      <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s3}}>WHAT YOU'LL RECEIVE</div>
      <ul style={{fontFamily:FU,fontSize:13,color:T.muted,margin:0,padding:`0 0 0 ${T.s4}`,lineHeight:1.8}}>
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
      <p style={{fontFamily:FU,fontSize:13,color:T.muted,margin:`0 0 ${T.s4}`,lineHeight:1.55,maxWidth:560}}>
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

      {ok&&<div style={{marginTop:T.s3,padding:`${T.s2} ${T.s3}`,borderRadius:T.rMd,background:T.gainBg,border:`1px solid ${T.gain}30`,fontFamily:FM,fontSize:11,color:T.gain,lineHeight:1.5}}>✓ {ok}</div>}
      {err&&<div style={{marginTop:T.s3,padding:`${T.s2} ${T.s3}`,borderRadius:T.rMd,background:`${T.loss}10`,border:`1px solid ${T.loss}40`,fontFamily:FM,fontSize:11,color:T.loss,lineHeight:1.5}}>✗ {err}</div>}
    </BentoTile>
  </div>;
}

/* ─── PRIVACY & DATA (export + delete) ────────────────── */
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
      <div style={{fontFamily:FU,fontSize:13,color:T.muted}}>You'll be redirected in a moment.</div>
    </BentoTile>;
  }

  const LEGAL_DOCS=[
    {l:"Privacy Policy",      desc:"What we collect, how we use it, your rights under GDPR/CCPA.", href:"/privacy",                          ext:false},
    {l:"Terms of Service",    desc:"Service rules, disclaimers, limitations of liability.",         href:"/terms",                            ext:false},
    {l:"Security Policy",     desc:"Encryption, access control, monitoring, and incident response.",href:"/legal/SECURITY_POLICY.pdf",        ext:true},
    {l:"Access Controls Policy",desc:"RBAC, MFA, periodic access reviews, secret management.",     href:"/legal/ACCESS_CONTROLS_POLICY.pdf", ext:true},
    {l:"Data Retention Policy",desc:"What we keep, how long, when it's deleted, vendor handling.",  href:"/legal/DATA_RETENTION_POLICY.pdf",  ext:true},
  ];

  return<div style={{display:"flex",flexDirection:"column",gap:T.s4}}>
    <BentoTile>
      <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>LEGAL DOCUMENTS</div>
      <p style={{fontFamily:FU,fontSize:13,color:T.muted,margin:`0 0 ${T.s4}`,lineHeight:1.55,maxWidth:600}}>
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
            <div style={{fontFamily:FU,fontSize:14,fontWeight:600,color:T.textHi,letterSpacing:"-0.005em"}}>{d.l}</div>
            <div style={{fontFamily:FU,fontSize:12,color:T.muted,marginTop:2,lineHeight:1.45}}>{d.desc}</div>
          </div>
          <span style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.08em",flexShrink:0}}>{d.ext?"PDF ↗":"OPEN ↗"}</span>
        </a>)}
      </div>
    </BentoTile>

    <BentoTile>
      <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>DOWNLOAD MY DATA</div>
      <p style={{fontFamily:FU,fontSize:13,color:T.muted,margin:`0 0 ${T.s3}`,lineHeight:1.55,maxWidth:600}}>
        Exports a JSON file containing your profile, account settings, CSV imports, manual assets, donations, audit history, brokerage holdings, and bank accounts. The file is for your records — MIZAN never shares it.
      </p>
      <button onClick={downloadExport} disabled={exportBusy} className="btn-primary">
        {exportBusy?"Preparing…":"Download my data"}
      </button>
    </BentoTile>

    <BentoTile accent={T.loss} style={{background:`linear-gradient(135deg, ${T.loss}08, transparent 60%), ${T.card}`}}>
      <div style={{fontFamily:FM,fontSize:10,color:T.loss,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>DELETE MY ACCOUNT</div>
      <p style={{fontFamily:FU,fontSize:13,color:T.muted,margin:`0 0 ${T.s3}`,lineHeight:1.55,maxWidth:600}}>
        Permanently deletes everything — profile, account state, brokerage connections (via SnapTrade), bank links (via Plaid), and audit trail. This action cannot be undone.
      </p>
      <button onClick={()=>setShowModal(true)} className="btn-danger">Delete my account…</button>
    </BentoTile>

    {err&&<BentoTile style={{background:`${T.loss}10`,border:`1px solid ${T.loss}40`}}>
      <div style={{fontFamily:FM,fontSize:11,color:T.loss}}>✗ {err}</div>
    </BentoTile>}

    {showModal&&<div style={{
      position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",backdropFilter:"blur(4px)",
      display:"flex",alignItems:"center",justifyContent:"center",zIndex:50,padding:T.s4,
    }} onClick={()=>!deleteBusy&&setShowModal(false)}>
      <div onClick={e=>e.stopPropagation()} style={{
        maxWidth:520,width:"100%",background:T.card,border:`1px solid ${T.loss}40`,borderRadius:T.rLg,padding:`${T.s6} ${T.s5}`,
      }}>
        <div style={{fontFamily:FM,fontSize:10,color:T.loss,letterSpacing:"0.18em",fontWeight:700,marginBottom:T.s3}}>DELETE ACCOUNT — IRREVERSIBLE</div>
        <p style={{fontFamily:FU,fontSize:14,color:T.text,margin:`0 0 ${T.s3}`,lineHeight:1.55}}>
          This will permanently remove:
        </p>
        <ul style={{fontFamily:FU,fontSize:13,color:T.muted,margin:`0 0 ${T.s4} ${T.s4}`,padding:0,lineHeight:1.7}}>
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

  const PAGE=50;

  const load=useCallback(async()=>{
    setBusy(true);setErr(null);
    try{
      const[s,u,a,d]=await Promise.all([
        apiFetch("/api/admin/stats").then(r=>r.json()),
        apiFetch("/api/admin/users?limit=200").then(r=>r.json()),
        apiFetch(`/api/admin/audit-log?limit=${PAGE}&offset=${auditOffset}`).then(r=>r.json()),
        apiFetch("/api/admin/db-status").then(r=>r.json()),
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

    {/* ─── Sub-tabs ──────────────────────────────── */}
    <TabBar tabs={[["users","Users"],["audit","Audit Log"]]} active={tab} onChange={setTab}/>

    {err&&<BentoTile style={{background:`${T.loss}10`,border:`1px solid ${T.loss}40`}}>
      <div style={{fontFamily:FM,fontSize:11,color:T.loss}}>✗ {err}</div>
    </BentoTile>}

    {tab==="users"&&<BentoTile style={{padding:0,overflow:"hidden"}}>
      <div style={{padding:`${T.s4} ${T.s5}`,borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600}}>USERS · {users.length}</span>
        <button onClick={load} disabled={busy} className="btn-ghost" style={{fontSize:10}}>{busy?"Loading…":"Refresh"}</button>
      </div>
      {users.length===0
        ?<div style={{padding:`${T.s8} ${T.s5}`,textAlign:"center",fontFamily:FU,fontSize:13,color:T.muted}}>No users yet.</div>
        :<Tbl cols={[
          {l:"Email",r_:r=><span style={{fontFamily:FU,fontSize:13,color:T.text}}>{r.email}</span>},
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
        ?<div style={{padding:`${T.s8} ${T.s5}`,textAlign:"center",fontFamily:FU,fontSize:13,color:T.muted}}>No audit entries.</div>
        :<Tbl cols={[
          {l:"When",r_:r=><span style={{fontFamily:FM,fontSize:11,color:T.muted,whiteSpace:"nowrap"}}>{fmtDate(r.created_at)}</span>},
          {l:"User",r_:r=><span style={{fontFamily:FU,fontSize:11,color:T.text}}>{r.email||(r.user_id?r.user_id.slice(0,8)+"…":"—")}</span>},
          {l:"Action",r_:r=><span style={{fontFamily:FU,fontSize:12,color:T.text,fontWeight:500}}>{r.action}</span>},
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
function ConnectModal({onClose,snapId,onConnected}){
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
          };
        }).sort((a,b)=>{
          // Enabled first, then alphabetical
          if (a.disabled !== b.disabled) return a.disabled ? 1 : -1;
          return a.nm.localeCompare(b.nm);
        })
      : BROKERS;
    const q = search.trim().toLowerCase();
    return q
      ? live.filter(b => (b.nm + " " + b.id).toLowerCase().includes(q))
      : live;
  }, [allBrokerages, search]);

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
        body: JSON.stringify({broker: b.id, connectionType: "read"})
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
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",zIndex:1000,
      display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{background:T.surface,border:`1px solid ${T.borderHi}`,borderRadius:14,
        width:"100%",maxWidth:maxW,maxHeight:"90vh",display:"flex",flexDirection:"column",overflow:"hidden"}}>

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
            <div style={{fontFamily:FU,fontSize:11,color:T.muted,marginTop:2}}>
              {step==="iframe" ? "Your credentials go directly to your broker"
               : "Powered by SnapTrade OAuth"}
            </div>
          </div>
          <button onClick={()=>{setStep("select");setUrl("");onClose?.();}}
            style={{background:"none",border:"none",color:T.muted,cursor:"pointer",fontSize:18,lineHeight:1}}>✕</button>
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
            <div style={{fontFamily:FU,fontSize:12,color:T.muted,lineHeight:1.7,maxWidth:360}}>
              SnapTrade needs a signed link from your backend.<br/>
              Open a second terminal in your <code style={{color:T.blue,fontFamily:FM}}>mizan-app</code> folder and run:
            </div>
            <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,
              padding:"11px 20px",fontFamily:FM,fontSize:13,color:T.textHi,letterSpacing:"0.04em"}}>
              node server.js
            </div>
            <div style={{fontFamily:FU,fontSize:11,color:T.muted}}>
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
            <div style={{fontFamily:FU,fontSize:12,color:T.muted,lineHeight:1.7,maxWidth:300}}>
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
              justifyContent:"center",color:T.gain,fontSize:18}}>✓</div>
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
            <div style={{fontFamily:FU,fontSize:12,color:T.muted,lineHeight:1.6,maxWidth:340}}>
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
                return (
                  <div key={b.id} style={{background:T.card,
                    border:`1px solid ${c ? T.blue+"40" : T.border}`,
                    borderRadius:12,padding:"11px 13px"}}>
                    <div style={{display:"flex",justifyContent:"space-between",
                      alignItems:"flex-start",marginBottom:4}}>
                      <span style={{fontFamily:FM,fontSize:12,fontWeight:500,
                        color:c ? T.blue : T.textHi}}>{b.nm}</span>
                      {b.mine && <Tag label="Mine" color={T.blue}/>}
                    </div>
                    <div style={{fontFamily:FM,fontSize:9,color:T.muted,marginBottom:9}}>{b.desc}</div>
                    <div style={{display:"flex",gap:5}}>
                      <button onClick={()=>!c&&connect(b)}
                        style={{flex:1,padding:"5px",borderRadius:6,fontFamily:FM,fontSize:9,
                          fontWeight:500,letterSpacing:"0.06em",
                          cursor:c?"default":"pointer",border:"none",textTransform:"uppercase",
                          background:c ? `${T.gain}15` : `${T.blue}20`,
                          color:c ? T.gain : T.blue}}>
                        {c ? "Connected" : "Connect"}
                      </button>
                      {c && (
                        <button onClick={()=>drop(b.id)}
                          style={{padding:"5px 8px",borderRadius:6,background:"transparent",
                            border:`1px solid ${T.loss}28`,color:T.loss,
                            cursor:"pointer",fontFamily:FM,fontSize:9}}>✕</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{padding:"9px 16px",borderTop:`1px solid ${T.border}`,flexShrink:0,
              fontFamily:FU,fontSize:11,color:T.muted,lineHeight:1.6}}>
              Your brokerage password never touches MĪZAN. SnapTrade uses the same OAuth as "Sign in with Google."
            </div>
          </>
        )}

      </div>
    </div>
  );
}


/* ─── ROOT ───────────────────────────────────────────── */
/* ─── ABOUT ──────────────────────────────────────────── */
function About(){
  const sections = [
    { icon:"💳", t:"Finances",     accent:T.blue, d:"Net worth tracked daily across every connected brokerage plus manual assets (gold, real estate, business equity). Live Zakat calculation with per-asset eligibility toggles." },
    { icon:"📈", t:"Investments",  accent:T.gain, d:"Unified portfolio across all brokerages via SnapTrade. Real-time Sharia screening against 7 frameworks. Tax-loss harvesting with halal replacement suggestions." },
    { icon:"⚡", t:"Trading",      accent:T.gold, d:"Order ticket with preview/confirm flow. Pre/post-market quotes, browser-native price alerts, watchlist. Sharia pre-check on every order — spot only." },
    { icon:"🧠", t:"Intelligence", accent:"#7C3AED", d:"Sentiment-tagged market news. Sharia-aware AI advisor with full portfolio context. Auto-notifications for non-compliance changes and dividend payments." },
  ];
  const principles = [
    ["Riba","No interest-bearing instruments. Cash accounts only. Margin and shorts blocked at the order layer."],
    ["Gharar","No options, futures, CFDs, or leveraged ETFs. Spot equity and physical assets only."],
    ["Maisir","Edge required before deployment. Bot strategies require positive expected value."],
    ["Sector screen","Banking, alcohol, tobacco, gambling, conventional insurance, weapons, adult entertainment, pork — excluded."],
    ["Financial ratios","Total debt <33%, cash + interest-bearing securities <33%, accounts receivable <49% (varies by framework)."],
    ["Purification","Non-permissible income calculated and surfaced for Sadaqah. No expectation of reward."],
  ];
  const standards = ["AAOIFI","IFSB","DJIM","S&P Shariah","FTSE Shariah","MSCI Islamic","SC Malaysia"];
  const integrations = [
    {n:"SnapTrade",d:"60+ brokerages",c:T.blue},
    {n:"Finnhub",d:"Real-time quotes + news",c:T.gain},
    {n:"Polygon",d:"Historical OHLC bars",c:T.gold},
    {n:"Anthropic",d:"AI advisor (Claude)",c:"#CC785C"},
    {n:"Supabase",d:"Auth + per-user state",c:"#3ECF8E"},
  ];

  return <div style={{display:"flex",flexDirection:"column",gap:T.s5,maxWidth:1080,margin:"0 auto",paddingBottom:T.s10}}>
    {/* ─── HERO ─────────────────────────────────────────── */}
    <BentoTile style={{
      background:`radial-gradient(circle at 0% 0%, ${T.blue}18, transparent 55%), radial-gradient(circle at 100% 100%, ${T.gold}12, transparent 50%), ${T.card}`,
      borderColor:T.blue+"30",
      padding:`${T.s10} ${T.s8}`,
      textAlign:"center",
    }}>
      <div style={{display:"inline-flex",alignItems:"center",justifyContent:"center",gap:T.s3,marginBottom:T.s4}}>
        <svg width={48} height={48} viewBox="0 0 16 16" fill="none">
          <defs><linearGradient id="abLg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor={T.blue}/><stop offset="100%" stopColor={T.gold}/></linearGradient></defs>
          <path d="M8 1L15 7L8 13L1 7Z" stroke="url(#abLg)" strokeWidth={1.4} fill="none"/>
          <circle cx="8" cy="7" r="2" fill={T.blue} opacity={0.9}/>
        </svg>
        <span style={{fontFamily:FU,fontSize:44,fontWeight:700,color:T.textHi,letterSpacing:"-0.02em"}}>MĪZAN</span>
      </div>
      <div style={{fontFamily:FU,fontSize:24,fontWeight:600,color:T.textHi,lineHeight:1.3,maxWidth:680,margin:`0 auto ${T.s2}`,letterSpacing:"-0.02em"}}>
        The Shariah-compliant financial super-app.
      </div>
      <div style={{fontFamily:FU,fontSize:15,color:T.muted,lineHeight:1.6,maxWidth:600,margin:"0 auto"}}>
        Brokerages, banking, trading, and AI insights — unified, halal-screened, in one place.
      </div>
    </BentoTile>

    {/* ─── 4 FEATURE BENTO CARDS ──────────────────────── */}
    <div className="bento-row" style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(320px, 1fr))",gap:T.s4}}>
      {sections.map(s=><BentoTile key={s.t} accent={s.accent} style={{
        background:`linear-gradient(135deg, ${s.accent}0F, transparent 60%), ${T.card}`,
        display:"flex",flexDirection:"column",gap:T.s2,
      }}>
        <div style={{display:"flex",alignItems:"center",gap:T.s3}}>
          <span style={{fontSize:28,lineHeight:1}}>{s.icon}</span>
          <span style={{fontFamily:FM,fontSize:11,fontWeight:600,color:s.accent,letterSpacing:"0.18em"}}>{s.t.toUpperCase()}</span>
        </div>
        <div style={{fontFamily:FU,fontSize:14,color:T.text,lineHeight:1.6,letterSpacing:"-0.005em"}}>{s.d}</div>
      </BentoTile>)}
    </div>

    {/* ─── SHARIAH FOUNDATIONS ──────────────────────── */}
    <BentoTile accent={T.gold} style={{background:`radial-gradient(circle at 100% 0%, ${T.gold}10, transparent 55%), ${T.card}`}}>
      <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",marginBottom:T.s2,flexWrap:"wrap",gap:T.s2}}>
        <span style={{fontFamily:FM,fontSize:11,color:T.gold,letterSpacing:"0.18em",fontWeight:600}}>SHARIAH FOUNDATIONS</span>
        <span style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.08em"}}>{standards.length} STANDARDS</span>
      </div>
      <div style={{fontFamily:FU,fontSize:14,color:T.muted,lineHeight:1.6,maxWidth:760,marginBottom:T.s4,letterSpacing:"-0.005em"}}>
        Built around six Islamic finance principles. Not annotations on a generic finance app — they shape what's displayed, what's allowed at the order layer, and how AI recommendations are generated.
      </div>
      <div style={{display:"flex",flexWrap:"wrap",gap:T.s1,marginBottom:T.s4}}>
        {standards.map(s=><span key={s} style={{
          padding:`5px ${T.s3}`,
          background:`${T.gold}15`,
          border:`1px solid ${T.gold}35`,
          borderRadius:999,
          fontFamily:FM,fontSize:10,fontWeight:600,color:T.gold,letterSpacing:"0.06em",
        }}>{s}</span>)}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(220px, 1fr))",gap:T.s2}}>
        {principles.map(([k,v])=><div key={k} style={{
          padding:`${T.s3} ${T.s4}`,
          background:T.surface,
          borderRadius:T.rMd,
          border:`1px solid ${T.border}`,
          borderLeft:`3px solid ${T.gold}`,
        }}>
          <div style={{fontFamily:FU,fontSize:14,fontWeight:600,color:T.gold,letterSpacing:"-0.01em",marginBottom:T.s1}}>{k}</div>
          <div style={{fontFamily:FU,fontSize:12,color:T.muted,lineHeight:1.55,letterSpacing:"-0.005em"}}>{v}</div>
        </div>)}
      </div>
    </BentoTile>

    {/* ─── INTEGRATIONS ─────────────────────────────── */}
    <BentoTile accent={T.blue}>
      <div style={{fontFamily:FM,fontSize:11,color:T.blue,letterSpacing:"0.18em",fontWeight:600,marginBottom:T.s4}}>DATA & INTEGRATIONS</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(160px, 1fr))",gap:T.s2}}>
        {integrations.map(i=><div key={i.n} style={{
          padding:`${T.s3} ${T.s4}`,
          background:T.surface,
          borderRadius:T.rMd,
          border:`1px solid ${T.border}`,
          borderLeft:`3px solid ${i.c}`,
        }}>
          <div style={{fontFamily:FU,fontSize:14,fontWeight:600,color:T.textHi,letterSpacing:"-0.01em",marginBottom:T.s1}}>{i.n}</div>
          <div style={{fontFamily:FM,fontSize:11,color:T.muted}}>{i.d}</div>
        </div>)}
      </div>
    </BentoTile>

    {/* ─── REPORT A BUG ───────────────────────────── */}
    {/* Surfaces the floating BugReportButton modal via custom event so
        users who land here looking for "contact us" have a direct CTA. */}
    <div style={{textAlign:"center",padding:`${T.s2} 0`}}>
      <button
        type="button"
        onClick={()=>{try{window.dispatchEvent(new Event("mizan:open-bug-report"));}catch{}}}
        style={{
          fontFamily:FM,fontSize:11,fontWeight:600,letterSpacing:"0.08em",
          color:T.muted,
          background:"transparent",
          border:`1px solid ${T.border}`,
          borderRadius:T.rMd,
          padding:`8px ${T.s4}`,
          cursor:"pointer",
        }}>FOUND A BUG?  →  REPORT IT</button>
    </div>

    {/* ─── DISCLAIMER ─────────────────────────────── */}
    <div style={{textAlign:"center",fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.14em",padding:`${T.s4} 0 ${T.s6}`,lineHeight:1.8,fontWeight:500}}>
      MĪZAN · NOT FINANCIAL OR RELIGIOUS ADVICE<br/>
      CONSULT A QUALIFIED SCHOLAR FOR PERSONAL JURISPRUDENCE
    </div>
  </div>;
}

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
function GoalsHub({snapAccounts=[],plaidAccounts=[],netWorthHistory=[],demoMode=false,currentNW=0,ytdContrib=0,bankBalance=0}){
  const[sub,setSub]=useState("goals");
  return<div style={{display:"flex",flexDirection:"column",gap:T.s5}}>
    <TabBar tabs={[["goals","Goals"],["zakat","Zakat & Sadaqah"],["fire","Retirement / FIRE"]]} active={sub} onChange={setSub}/>
    {sub==="goals"&&<Goals snapAccounts={snapAccounts} plaidAccounts={plaidAccounts} netWorthHistory={netWorthHistory} demoMode={demoMode}/>}
    {sub==="zakat"&&<ZakatSadaqah accounts={snapAccounts} demoMode={demoMode} bankBalance={bankBalance}/>}
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

  // Categories that are transfers / payments, not real spending or subscriptions.
  const EXCLUDE_CATS=new Set(["LOAN_PAYMENTS","TRANSFER_OUT","TRANSFER_IN","BANK_FEES","INCOME"]);
  // ACH description patterns that identify credit-card or loan payments.
  const PAYMENT_RE=/credit\s*card\s*pay|crcardpmt|autopay|card\s*pmnt|loan\s*pay|mortgage\s*pay|bill\s*pay|heloc|student\s*loan/i;

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
      // Skip transfers, loan repayments, and credit-card payments — these
      // are balance movements, not subscription charges.
      const cat=t.personal_finance_category?.primary||t.category?.[0]||"";
      if(EXCLUDE_CATS.has(cat))return;
      if(PAYMENT_RE.test(m))return;
      const month=(t.date||"").slice(0,7);
      if(!byMerchant[m])byMerchant[m]={merchant:m,months:new Set(),amounts:[],dates:[]};
      byMerchant[m].months.add(month);
      byMerchant[m].amounts.push(t.amount);
      byMerchant[m].dates.push(t.date);
    });
    const today=new Date();
    const cutoff=new Date(today);cutoff.setDate(today.getDate()-45);
    const cutoffStr=cutoff.toISOString().slice(0,10);
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
          active:lastDate>=cutoffStr,
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
    const{skipAutoSync=false}=opts;
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
      const ar=await apiFetch("/api/plaid/accounts");
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
      // Re-read the table after sync so the new rows render.
      const tr=await apiFetch("/api/plaid/transactions");
      if(tr.ok){
        const td=await tr.json();
        setTxns(Array.isArray(td.transactions)?td.transactions:[]);
      }
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
  },[demoMode,syncBusy]);

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
        {syncMsg.ok?"✓ ":"✗ "}{syncMsg.msg}
      </div>}
      {status&&<div style={{marginTop:T.s4,padding:`${T.s2} ${T.s3}`,borderRadius:T.rMd,fontFamily:FM,fontSize:12,background:status.ok?T.gainBg:T.lossBg,border:`1px solid ${(status.ok?T.gain:T.loss)+"30"}`,color:status.ok?T.gain:T.loss,display:"flex",alignItems:"center",gap:T.s3,flexWrap:"wrap"}}>
        <span style={{flex:"1 1 auto"}}>{status.ok?"✓ ":"✗ "}{status.msg}</span>
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
      <div style={{fontFamily:FU,fontSize:13,color:T.muted,lineHeight:1.55,maxWidth:520,margin:"0 auto"}}>
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
        <span style={{fontSize:14}} aria-hidden="true">⚠️</span>
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
                primaryStyle={{fontFamily:FU,fontSize:13,color:T.text,letterSpacing:"-0.005em",fontWeight:nicknames?.[a.account_id]?600:400}}
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
      return<BentoTile>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:T.s4,flexWrap:"wrap",gap:T.s2}}>
          <span style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600}}>SPENDING BY CATEGORY · {monthLabel}</span>
          <span style={{fontFamily:FU,fontSize:14,fontWeight:700,color:T.textHi,fontVariantNumeric:"tabular-nums"}}>{fmtUSD(monthTotal)}</span>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:T.s2}}>
          {entries.map(s=>{
            const pct=monthTotal>0?(s.total/monthTotal)*100:0;
            const barPct=(s.total/(entries[0]?.total||1))*100;
            return<div key={s.cat} style={{display:"grid",gridTemplateColumns:"minmax(130px,1.4fr) 1fr 90px 52px",gap:T.s3,alignItems:"center"}}>
              <span style={{fontFamily:FU,fontSize:13,color:T.text,letterSpacing:"-0.005em"}}>{fmtCat(s.cat)}</span>
              <div style={{height:8,background:T.dim,borderRadius:2,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${barPct}%`,background:`linear-gradient(90deg, ${T.blue}, ${T.blueDim})`,borderRadius:2}}/>
              </div>
              <span style={{fontFamily:FU,fontSize:13,fontWeight:600,color:T.textHi,textAlign:"right",fontVariantNumeric:"tabular-nums"}}>{fmtUSD(s.total)}</span>
              <span style={{fontFamily:FM,fontSize:11,color:T.muted,textAlign:"right",fontVariantNumeric:"tabular-nums"}}>{pct.toFixed(0)}%</span>
            </div>;
          })}
        </div>
      </BentoTile>;
    })()}

    {/* ─── DEBT PAYMENTS & TRANSFERS ──────────── */}
    {paymentFlows.outEntries.length>0&&(()=>{
      const{outEntries,outTotal,incomeTotal}=paymentFlows;
      const now=new Date();
      const monthLabel=now.toLocaleDateString("en-US",{month:"long",year:"numeric"});
      const CAT_LABEL={LOAN_PAYMENTS:"Loan & Card Payments",TRANSFER_OUT:"Outbound Transfers",BANK_FEES:"Bank Fees"};
      return<BentoTile>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:T.s4,flexWrap:"wrap",gap:T.s2}}>
          <span style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600}}>DEBT PAYMENTS & TRANSFERS · {monthLabel}</span>
          <span style={{fontFamily:FU,fontSize:14,fontWeight:700,color:T.textHi,fontVariantNumeric:"tabular-nums"}}>{fmtUSD(outTotal)}</span>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:T.s2}}>
          {outEntries.map(e=>{
            const pct=outTotal>0?(e.total/outTotal)*100:0;
            const barPct=(e.total/(outEntries[0]?.total||1))*100;
            return<div key={e.cat} style={{display:"grid",gridTemplateColumns:"minmax(160px,1.6fr) 1fr 90px 52px",gap:T.s3,alignItems:"center"}}>
              <span style={{fontFamily:FU,fontSize:13,color:T.text,letterSpacing:"-0.005em"}}>{CAT_LABEL[e.cat]||e.cat.replace(/_/g," ")}</span>
              <div style={{height:8,background:T.dim,borderRadius:2,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${barPct}%`,background:`linear-gradient(90deg,${T.loss}88,${T.loss}44)`,borderRadius:2}}/>
              </div>
              <span style={{fontFamily:FU,fontSize:13,fontWeight:600,color:T.textHi,textAlign:"right",fontVariantNumeric:"tabular-nums"}}>{fmtUSD(e.total)}</span>
              <span style={{fontFamily:FM,fontSize:11,color:T.muted,textAlign:"right",fontVariantNumeric:"tabular-nums"}}>{pct.toFixed(0)}%</span>
            </div>;
          })}
        </div>
        {incomeTotal>0&&<div style={{marginTop:T.s4,paddingTop:T.s3,borderTop:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontFamily:FM,fontSize:10,color:T.gain,letterSpacing:"0.14em",fontWeight:600}}>INCOME & INFLOWS THIS MONTH</span>
          <span style={{fontFamily:FU,fontSize:14,fontWeight:700,color:T.gain,fontVariantNumeric:"tabular-nums"}}>{fmtUSD(incomeTotal)}</span>
        </div>}
      </BentoTile>;
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
      let rows;
      let usingPlaid=false;
      if(Array.isArray(plaidRows)&&plaidRows.length>0){
        usingPlaid=true;
        rows=plaidRows
          .filter(s=>{
            // Drop credit-card payments, transfers, and loan repayments
            // that Plaid may surface as recurring outflows.
            const cat=s.personal_finance_category?.primary||"";
            if(EXCLUDE_CATS.has(cat))return false;
            const name=s.merchant_name||s.description||"";
            if(PAYMENT_RE.test(name))return false;
            return true;
          })
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
              active:s.is_active!==false,
              institution:s._institution||null,
              status:s.status||null,
            };
          })
          .sort((a,b)=>{
            if(a.active!==b.active)return a.active?-1:1;
            return b.estMonthly-a.estMonthly;
          });
      } else {
        rows=recurring;
      }
      if(rows.length===0)return null;
      const active=rows.filter(r=>r.active);
      const inactive=rows.filter(r=>!r.active);
      const totalMonthly=active.reduce((s,r)=>s+r.estMonthly,0);
      return<BentoTile accent={T.gold}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:T.s3,flexWrap:"wrap",gap:T.s2}}>
          <div style={{display:"flex",alignItems:"center",gap:T.s3}}>
            <span style={{fontFamily:FM,fontSize:10,color:T.gold,letterSpacing:"0.16em",fontWeight:600}}>RECURRING SUBSCRIPTIONS · {active.length} active</span>
            {usingPlaid&&<span style={{fontFamily:FM,fontSize:9,color:T.gain,letterSpacing:"0.1em",padding:"1px 6px",border:`1px solid ${T.gain}50`,borderRadius:T.rSm}}>PLAID</span>}
          </div>
          <span style={{fontFamily:FU,fontSize:14,fontWeight:700,color:T.gold,fontVariantNumeric:"tabular-nums"}}>{fmtUSD(totalMonthly)}<span style={{fontFamily:FM,fontSize:10,fontWeight:400,color:T.muted,marginLeft:4}}>/mo</span></span>
        </div>
        <div style={{overflow:"hidden",borderRadius:T.rMd,border:`1px solid ${T.border}`}}>
          <Tbl cols={[
            {l:"Merchant",r_:r=><div style={{display:"flex",alignItems:"center",gap:T.s2}}>
              <span style={{fontFamily:FU,fontSize:13,fontWeight:600,color:r.active?T.textHi:T.muted,letterSpacing:"-0.005em"}}>{r.merchant}</span>
              {!r.active&&<span style={{fontFamily:FM,fontSize:9,color:T.muted,letterSpacing:"0.1em",padding:"1px 5px",border:`1px solid ${T.border}`,borderRadius:T.rSm}}>INACTIVE</span>}
            </div>},
            {l:"Cadence",r_:r=><span style={{fontFamily:FM,fontSize:11,color:T.muted,textTransform:"capitalize"}}>{r.cadence}</span>},
            {l:"Per charge",r:true,r_:r=><span style={{fontFamily:FM,fontSize:12,fontWeight:500,color:r.active?T.textHi:T.muted,fontVariantNumeric:"tabular-nums"}}>{fmtUSD(r.avgPerCharge)}</span>},
            {l:"Est. / mo",r:true,r_:r=><span style={{fontFamily:FU,fontSize:13,fontWeight:600,color:r.active?T.gold:T.muted,fontVariantNumeric:"tabular-nums"}}>{fmtUSD(r.estMonthly)}</span>},
            {l:"Last charge",r_:r=><span style={{fontFamily:FM,fontSize:11,color:T.muted}}>{fmtDate(r.lastDate)}</span>},
          ]} rows={[...active,...inactive].slice(0,25)}/>
        </div>
      </BentoTile>;
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
                color:T.textHi,fontFamily:FU,fontSize:13,letterSpacing:"-0.005em",
                outline:"none",
              }}
            />
            <select
              value={txnAccount}
              onChange={e=>setTxnAccount(e.target.value)}
              style={{
                padding:`8px ${T.s3}`,
                background:T.surface,border:`1px solid ${T.border}`,borderRadius:T.rMd,
                color:T.text,fontFamily:FU,fontSize:13,letterSpacing:"-0.005em",
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
            <div style={{fontFamily:FU,fontSize:13,color:T.text,letterSpacing:"-0.005em"}}>{r.merchant_name||r.name||"—"}</div>
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
          {l:"Amount",r:true,r_:r=>{const out=r.amount>0;return<span style={{fontFamily:FU,fontSize:13,fontWeight:600,color:out?T.loss:T.gain,letterSpacing:"-0.005em",fontVariantNumeric:"tabular-nums"}}>{out?"−":"+"}{fmtUSD(Math.abs(r.amount))}</span>;}},
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
function OnboardingFlow({onConnect,onImportCSV,onComplete,snapAccountsLen,onNav}){
  const STORAGE_KEY="mizan_onboarding_step";
  const[step,setStepRaw]=useState(()=>{try{const v=+localStorage.getItem(STORAGE_KEY);return Number.isFinite(v)&&v>=0&&v<5?v:0;}catch{return 0;}});
  const[dir,setDir]=useState(0); // -1 prev, +1 next; drives slide direction
  const[mounted,setMounted]=useState(false);
  const setStep=n=>{
    setDir(n>step?1:-1);
    setStepRaw(n);
    try{localStorage.setItem(STORAGE_KEY,String(n));}catch{}
  };
  useEffect(()=>{setMounted(true);},[]);

  // Auto-advance step 2 once a broker is actually connected during the tour.
  useEffect(()=>{if(step===1&&snapAccountsLen>0)setStep(2);},[snapAccountsLen]); // eslint-disable-line

  const finish=async()=>{
    try{localStorage.setItem("mizan_onboarded","1");}catch{}
    try{localStorage.removeItem(STORAGE_KEY);}catch{}
    await persistUserState("mizan_onboarded","1");
    onComplete?.();
  };

  // ───── STEP 1 — Welcome ──────────
  const StepWelcome=<>
    <div style={{display:"inline-flex",alignItems:"center",justifyContent:"center",gap:T.s3,marginBottom:T.s5}}>
      <svg width={56} height={56} viewBox="0 0 16 16" fill="none">
        <defs><linearGradient id="onbLg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor={T.blue}/><stop offset="100%" stopColor={T.gold}/></linearGradient></defs>
        <path d="M8 1L15 7L8 13L1 7Z" stroke="url(#onbLg)" strokeWidth={1.4} fill="none"/>
        <circle cx="8" cy="7" r="2.2" fill={T.blue} opacity={0.9}/>
      </svg>
      <span style={{fontFamily:FU,fontSize:38,fontWeight:700,color:T.textHi,letterSpacing:"-0.02em"}}>MĪZAN</span>
    </div>
    <div style={{fontFamily:FU,fontSize:30,fontWeight:700,color:T.textHi,letterSpacing:"-0.025em",lineHeight:1.15,maxWidth:560,margin:`0 auto ${T.s3}`}}>Your Halal Financial Terminal</div>
    <div style={{fontFamily:FU,fontSize:15,color:T.muted,lineHeight:1.6,maxWidth:560,margin:`0 auto ${T.s6}`,letterSpacing:"-0.005em"}}>
      Brokerages, banking, AI insights — unified and Sharia-screened, in one place.
    </div>
    <div style={{display:"flex",flexDirection:"column",gap:T.s2,maxWidth:480,margin:"0 auto",textAlign:"left"}}>
      {[
        {accent:T.blue,t:"Real portfolio",d:"Live balances + positions from every connected broker (Fidelity, Robinhood, Schwab, Coinbase, and 60+ more)."},
        {accent:T.gold,t:"Sharia-screened",d:"Every position screened against AAOIFI + 6 other frameworks. Automatic Zakat + purification math."},
        {accent:T.gain,t:"AI advisor with context",d:"Ask anything about your portfolio. Claude sees your accounts, positions, and activity — answers are specific to you."},
      ].map(b=><div key={b.t} style={{padding:`${T.s3} ${T.s4}`,background:T.surface,border:`1px solid ${T.border}`,borderLeft:`3px solid ${b.accent}`,borderRadius:T.rMd}}>
        <div style={{fontFamily:FU,fontSize:14,fontWeight:600,color:T.textHi,letterSpacing:"-0.01em",marginBottom:T.s1}}>{b.t}</div>
        <div style={{fontFamily:FU,fontSize:13,color:T.muted,lineHeight:1.55,letterSpacing:"-0.005em"}}>{b.d}</div>
      </div>)}
    </div>
  </>;

  // ───── STEP 2 — Connect brokerage ──────────
  const StepConnect=<>
    <div style={{fontFamily:FU,fontSize:28,fontWeight:700,color:T.textHi,letterSpacing:"-0.025em",lineHeight:1.2,marginBottom:T.s2}}>Connect your brokerage</div>
    <div style={{fontFamily:FU,fontSize:14,color:T.muted,lineHeight:1.55,maxWidth:520,margin:`0 auto ${T.s5}`}}>
      MĪZAN reads your accounts directly via SnapTrade — your credentials never touch our servers. Read-only by default.
    </div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(140px, 1fr))",gap:T.s2,maxWidth:560,margin:`0 auto ${T.s5}`}}>
      {[
        {n:"Fidelity",  c:T.blue},
        {n:"Robinhood", c:T.gain},
        {n:"Schwab",    c:T.loss},
        {n:"Empower",   c:"#7C3AED"},
        {n:"Coinbase",  c:T.gold},
        {n:"Chase",     c:"#0F4C81"},
      ].map(b=><div key={b.n} style={{
        padding:`${T.s3} ${T.s2}`,
        background:T.surface,
        border:`1px solid ${T.border}`,
        borderTop:`3px solid ${b.c}`,
        borderRadius:T.rMd,
        textAlign:"center",
        fontFamily:FU,fontSize:13,fontWeight:600,color:T.textHi,letterSpacing:"-0.01em",
      }}>{b.n}</div>)}
    </div>
    <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.06em",marginBottom:T.s4}}>+ 60 more available</div>
    {snapAccountsLen>0
      ?<div style={{padding:`${T.s3} ${T.s4}`,background:T.gainBg,border:`1px solid ${T.gain}40`,borderRadius:T.rMd,fontFamily:FM,fontSize:13,color:T.gain,maxWidth:420,margin:"0 auto"}}>● Connected — {snapAccountsLen} account{snapAccountsLen===1?"":"s"} linked.</div>
      :<button onClick={onConnect} className="btn-primary" style={{fontSize:14,padding:`12px ${T.s6}`}}>+ Connect Account</button>}
  </>;

  // ───── STEP 3 — Import CSV ──────────
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
    <div style={{fontFamily:FU,fontSize:14,color:T.muted,lineHeight:1.55,maxWidth:520,margin:`0 auto ${T.s5}`}}>
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
    {csvStatus&&<div style={{maxWidth:520,margin:"0 auto",padding:`${T.s2} ${T.s3}`,borderRadius:T.rMd,fontFamily:FM,fontSize:12,background:csvStatus.ok?T.gainBg:T.lossBg,border:`1px solid ${(csvStatus.ok?T.gain:T.loss)+"30"}`,color:csvStatus.ok?T.gain:T.loss}}>{csvStatus.ok?"✓ ":"✗ "}{csvStatus.msg}</div>}
  </>;

  // ───── STEP 4 — First AI question ──────────
  const PRESET_QUESTION="How is my portfolio performing vs. halal benchmarks?";
  const[aiQ]=useState(PRESET_QUESTION);
  const[aiAnswer,setAiAnswer]=useState("");
  const[aiBusy,setAiBusy]=useState(false);
  const[aiErr,setAiErr]=useState(null);
  const[aiStarted,setAiStarted]=useState(false);
  const askAi=useCallback(async()=>{
    if(aiBusy||aiAnswer)return;
    setAiBusy(true);setAiErr(null);
    try{
      const r=await apiFetch("/api/advisor",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          system:"You are MIZAN's Sharia-aware personal finance advisor. Use AAOIFI screening rules. Be specific, numeric, and concise (under 150 words). This is the user's first conversation — be welcoming.",
          messages:[{role:"user",content:aiQ}],
          max_tokens:600,
        }),
      });
      const d=await r.json();
      if(!r.ok||d.error)throw new Error(d.error?.message||d.error||`HTTP ${r.status}`);
      const text=(d.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("");
      setAiAnswer(text||"(empty response)");
    }catch(err){setAiErr(err.message||"Request failed");}
    finally{setAiBusy(false);}
  },[aiBusy,aiAnswer,aiQ]);
  // Auto-fire when the step opens (once).
  useEffect(()=>{if(step===3&&!aiStarted){setAiStarted(true);askAi();}},[step,aiStarted,askAi]);
  const StepAdvisor=<>
    <div style={{fontFamily:FU,fontSize:28,fontWeight:700,color:T.textHi,letterSpacing:"-0.025em",lineHeight:1.2,marginBottom:T.s2}}>Ask your AI advisor</div>
    <div style={{fontFamily:FU,fontSize:14,color:T.muted,lineHeight:1.55,maxWidth:520,margin:`0 auto ${T.s5}`}}>
      This is how every conversation works on the AI Advisor tab. The advisor sees your real account context — answers are tailored to you.
    </div>
    <div style={{maxWidth:560,margin:"0 auto",display:"flex",flexDirection:"column",gap:T.s3,textAlign:"left"}}>
      {/* User bubble */}
      <div style={{display:"flex",justifyContent:"flex-end",gap:T.s2}}>
        <div style={{
          maxWidth:"82%",
          padding:`${T.s3} ${T.s4}`,
          borderRadius:T.rLg,
          background:`linear-gradient(135deg, ${T.blue}, ${T.blueDim})`,
          color:"#fff",
          fontFamily:FU,fontSize:14,lineHeight:1.55,letterSpacing:"-0.005em",
          boxShadow:`0 4px 14px ${T.blue}40`,
        }}>{aiQ}</div>
        <div style={{width:32,height:32,borderRadius:T.rMd,flexShrink:0,background:T.surface,border:`1px solid ${T.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:FU,fontSize:13,fontWeight:600,color:T.text}}>Y</div>
      </div>
      {/* Assistant bubble */}
      <div style={{display:"flex",gap:T.s2,alignItems:"flex-start"}}>
        <div style={{width:32,height:32,borderRadius:T.rMd,flexShrink:0,background:`linear-gradient(135deg, ${T.blue}, ${T.blueDim})`,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:FU,fontSize:13,fontWeight:700,color:"#fff",boxShadow:`0 2px 8px ${T.blue}40`}}>M</div>
        <div style={{
          maxWidth:"82%",
          padding:`${T.s3} ${T.s4}`,
          borderRadius:T.rLg,
          background:T.surface,
          border:`1px solid ${T.border}`,
          color:T.text,
          fontFamily:FU,fontSize:14,lineHeight:1.6,letterSpacing:"-0.005em",
          whiteSpace:"pre-wrap",
          minHeight:60,
        }}>
          {aiBusy
            ?<div style={{display:"flex",gap:T.s1}}>{[0,1,2].map(i=><span key={i} style={{display:"inline-block",width:6,height:6,borderRadius:"50%",background:T.muted,animation:"blink 1.4s infinite",animationDelay:`${i*0.15}s`}}/>)}</div>
            :aiErr?<span style={{color:T.loss}}>{aiErr}</span>:aiAnswer||"…"}
        </div>
      </div>
    </div>
  </>;

  // ───── STEP 5 — Tour complete ──────────
  const navItems=[
    {n:"Overview",   d:"Net worth, performance, allocation, top holdings — all in one bento."},
    {n:"Finances",   d:"Bank balances, transactions, spending by category, recurring (Plaid)."},
    {n:"Portfolio",  d:"Holdings, activity, tax planning, backtest, rebalance, Sharia screener."},
    {n:"Goals",      d:"Savings goals, Zakat & Sadaqah ledger, retirement (FIRE) projection."},
    {n:"AI Advisor", d:"Sharia-aware, context-rich chat (you just tried this)."},
    {n:"Settings",   d:"Brokers, 2FA, manual assets, documents, demo mode."},
  ];
  const StepDone=<>
    <div style={{fontFamily:FU,fontSize:28,fontWeight:700,color:T.textHi,letterSpacing:"-0.025em",lineHeight:1.2,marginBottom:T.s2}}>You're set</div>
    <div style={{fontFamily:FU,fontSize:14,color:T.muted,lineHeight:1.55,maxWidth:520,margin:`0 auto ${T.s5}`}}>
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
        <span style={{fontFamily:FU,fontSize:13,fontWeight:600,color:T.textHi,letterSpacing:"-0.005em"}}>{it.n}</span>
        <span style={{fontFamily:FU,fontSize:13,color:T.muted,lineHeight:1.5,letterSpacing:"-0.005em"}}>{it.d}</span>
      </div>)}
    </div>
  </>;

  const steps=[StepWelcome,StepConnect,StepImport,StepAdvisor,StepDone];
  const ctaLabel=step===0?"Let's get started →":step===4?"Open MĪZAN →":"Continue →";
  const onCta=()=>{if(step===4)return finish();setStep(step+1);};
  const onSkip=()=>{if(step===4)return finish();setStep(step+1);};
  const canSkip=step!==0&&step!==4;

  return<div style={{
    position:"fixed",inset:0,zIndex:1000,
    background:"rgba(11,15,30,0.78)",
    backdropFilter:"blur(20px) saturate(160%)",
    WebkitBackdropFilter:"blur(20px) saturate(160%)",
    display:"flex",alignItems:"center",justifyContent:"center",
    padding:T.s5,
    opacity:mounted?1:0,
    transition:"opacity 0.25s",
  }}>
    <div style={{
      width:"100%",maxWidth:720,
      background:`radial-gradient(circle at 0% 0%, ${T.blue}14, transparent 55%), radial-gradient(circle at 100% 100%, ${T.gold}10, transparent 50%), ${T.card}`,
      border:`1px solid ${T.borderHi}`,
      borderRadius:T.rLg,
      boxShadow:"var(--sh-lg)",
      padding:`${T.s8} ${T.s8} ${T.s6}`,
      position:"relative",
      overflow:"hidden",
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
  "g t": "Go to Trade & Bot",
  "g a": "Go to AI Advisor",
  "g s": "Go to Settings",
  "r":   "Sync All",
  "/":   "Open command palette",
  "?":   "Show this help",
  "Esc": "Close any open modal",
};

function KeyboardShortcuts({ onNav, onSync, onConnect, onHelp, onCommand }) {
  useKeyboard({
    shortcuts: {
      "g o": "overview",
      "g p": "portfolio",
      "g f": "finances",
      "g g": "goals",
      "g a": "advisor",
      "g s": "settings",
      "r": "sync",
      "?": "help",
      "/": "command",
    },
    onShortcut: (name) => {
      const NAV_TARGETS = new Set(["overview","portfolio","finances","goals","advisor","settings"]);
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
      const valid=new Set(["overview","finances","portfolio","goals","advisor","settings"]);
      if (v && valid.has(v)) return v;
      if (v === "trade") return "portfolio";
      if (v === "about") return "settings";
      return "overview";
    }catch{return"overview";}
  });
  const setNav=v=>{setNavState(v);try{localStorage.setItem("mizan_nav",v);}catch{}};

  // Command palette state (Cmd+K). The hook listens for the global
  // keystroke and toggles open. Commands are built below from setNav
  // + sync + setConn + toggleDemo, so they always reflect the latest
  // closure of those handlers.
  const palette=useCommandPalette();
  const[shortcutHelpOpen,setShortcutHelpOpen]=useState(false);
  const[live,setLive]=useState(()=>{try{return JSON.parse(localStorage.getItem("mizan_live_cache")||"[]");}catch{return[];}});
  // Plaid net cash position (depository minus credit/loan), seeded from
  // localStorage so the Overview hero can include it on first paint
  // without waiting for the Finances tab to mount.
  const[bankBalance,setBankBalance]=useState(()=>{try{const v=localStorage.getItem("mizan_bank_balance");return v?+v:0;}catch{return 0;}});
  useEffect(()=>{try{localStorage.setItem("mizan_bank_balance",String(bankBalance||0));}catch{}},[bankBalance]);
  // Unified Plaid accounts state — every type (depository / credit / loan /
  // investment / brokerage / other) is held here, so the Overview, Finances,
  // and Portfolio tabs can all consume the same source of truth. The numeric
  // `bankBalance` is derived from it (depository as +, credit/loan as −) and
  // exists separately so consumers that only need the net number don't have
  // to re-walk the list. Hydrated from localStorage on first paint, then
  // refreshed every 90s on the app-wide auto-sync cadence.
  const[plaidAccounts,setPlaidAccounts]=useState(()=>{try{return JSON.parse(localStorage.getItem("mizan_plaid_accounts")||"[]");}catch{return[];}});
  useEffect(()=>{try{localStorage.setItem("mizan_plaid_accounts",JSON.stringify(plaidAccounts));}catch{}},[plaidAccounts]);
  useEffect(()=>{
    let cancel=false;
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
  },[]);

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
  // Hydrate from cache so refresh / new tab loads instantly with last-known state.
  const[snapAccounts,setSnapAccounts]=useState(()=>{try{return JSON.parse(localStorage.getItem("mizan_accounts_cache")||"[]");}catch{return[];}});
  const[snapActivities,setSnapActivities]=useState(()=>{try{return JSON.parse(localStorage.getItem("mizan_activities_cache")||"[]");}catch{return[];}});
  const[snapDocuments,setSnapDocuments]=useState(()=>{try{return JSON.parse(localStorage.getItem("mizan_documents_cache")||"[]");}catch{return[];}});
  // Demo defaults to ON for users with no real connections (so they don't land
  // on an empty app), OFF for users who have connected brokers. Explicit user
  // toggle (mizan_demo = "0" or "1") always wins.
  const[demoMode,setDemoMode]=useState(()=>{
    try{
      const explicit=localStorage.getItem("mizan_demo");
      if(explicit==="0")return false;
      if(explicit==="1")return true;
      const hasReal=localStorage.getItem("mizan_has_real_data")==="1";
      return!hasReal;
    }catch{return false;}
  });
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
  const visibleAccounts=snapAccounts.filter(a=>!disabledAccts.has(a.accountId));
  const visibleAccountIds=new Set(visibleAccounts.map(a=>a.accountId));

  // Daily net-worth snapshots. Each successful sync writes one entry per day
  // (overwrites same-day so live ticks don't bloat history).
  useEffect(()=>{
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
    }catch{}
  },[visibleAccounts]);

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
      activityCount: visibleActs.length,
    };
  },[snapActivities,disabledAccts.size]);

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
    return{tk,nm,sh,ac,px,ty,
      sh_:SHARIA_MAP[tk]||(ty==="Crypto"||ty==="cryptocurrency"?"halal":"review"),
      ac_,br:broker,_live:true,_fromSnap:true};
  },[]);

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
        let acctLabelById={};
        try{
          const cachedAccts=JSON.parse(localStorage.getItem("mizan_accounts_cache")||"[]");
          cachedAccts.forEach(a=>{
            acctLabelById[a.accountId]=`${a.brokerage} — ${a.accountName}`;
          });
        }catch{}
        const enrichedReal=real.map(r=>({
          ...r,
          institution_name:acctLabelById[r.account?.id]||r.institution_name||r.account?.institution_name||"Unknown",
        }));
        // SnapTrade real first so any CSV import row that fingerprint-matches
        // a real transaction is dropped (the broker is the source of truth).
        persistActivities(dedupeActivities([...enrichedReal,...imported]).sort((a,b)=>(b.trade_date||"").localeCompare(a.trade_date||"")));
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
    return[
      inst,
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

    // Pass 2: drop imports that match SnapTrade real activities.
    const realFingerprints=new Set();
    try{
      const cached=JSON.parse(localStorage.getItem("mizan_activities_cache")||"[]");
      cached.filter(a=>!a._imported).forEach(a=>realFingerprints.add(fingerprintRow(a)));
    }catch{}
    const final=internalDedup.filter(r=>!realFingerprints.has(fingerprintRow(r)));
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
    const tk=(sym||"").trim().toUpperCase();
    if(!tk||watchlist.some(w=>w.symbol===tk))return;
    const px=live.find(l=>l.tk===tk)?.price||0;
    persistWatchlist([...watchlist,{symbol:tk,addedAt:new Date().toISOString().slice(0,10),addPrice:px}]);
  };
  const removeFromWatchlist=(sym)=>persistWatchlist(watchlist.filter(w=>w.symbol!==sym));
  const setAlert=(sym,key,value)=>{
    persistWatchlist(watchlist.map(w=>w.symbol===sym?{...w,[key]:value===""||value==null?null:Number(value),[key+"Fired"]:false}:w));
  };
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
  const tickers=useMemo(()=>{
    const set=new Set();
    try{
      const cached=JSON.parse(localStorage.getItem("mizan_accounts_cache")||"[]");
      cached.forEach(a=>(a.positions||[]).forEach(p=>{
        const t=p?.symbol?.symbol||p?.symbol;
        if(typeof t==="string"&&t)set.add(t);
      }));
    }catch{}
    try{
      const wl=JSON.parse(localStorage.getItem("mizan_watchlist")||"[]");
      wl.forEach(w=>w?.symbol&&set.add(w.symbol));
    }catch{}
    if(set.size===0){
      // Generic market bellwethers — not user data.
      ["SPY","QQQ","AAPL","MSFT","NVDA"].forEach(t=>set.add(t));
    }
    return[...set];
  },[]);
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

  useEffect(()=>{setGlobalKeys(apiKeys);fetchSnapHoldings();},[]);
  useEffect(()=>{fetchSnapHoldings();},[demoMode]);

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
  const[themeMode,setThemeMode]=useState(()=>{try{return localStorage.getItem("mizan_theme_mode")||"auto";}catch{return"auto";}});
  const[resolvedTheme,setResolvedTheme]=useState("dark");
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
  const NAV=[{id:"overview",l:"Overview"},{id:"finances",l:"Finances"},{id:"portfolio",l:"Portfolio"},{id:"goals",l:"Goals"},{id:"advisor",l:"AI Advisor"},{id:"settings",l:"Settings"}];

  return<div style={{minHeight:"100vh",background:T.bg,color:T.text,fontFamily:FU,fontFeatureSettings:'"cv11","ss01","kern"'}}>
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
      .bento-tile:hover{border-color:${T.borderHi}!important;box-shadow:var(--sh-lg);}
      @media (max-width: 900px) { .bento-row { grid-template-columns: 1fr !important; } }
      .btn-primary{background:linear-gradient(135deg,${T.blue},${T.blueDim});color:#fff;border:none;font-family:${FM};font-size:11px;font-weight:600;letter-spacing:0.04em;padding:8px 16px;border-radius:var(--r-md);cursor:pointer;box-shadow:0 2px 10px ${T.blue}50;transition:transform 0.15s,box-shadow 0.2s;}
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
        main{padding-left:16px!important;padding-right:16px!important;padding-bottom:120px!important;}
      }
      @media (max-width: 600px) {
        .mz-hide-sm{display:none!important;}
        .mz-grid-5{grid-template-columns:1fr!important;}
        .mz-grid-4{grid-template-columns:1fr!important;}
        .mz-grid-3{grid-template-columns:1fr!important;}
        .mz-grid-2{grid-template-columns:1fr!important;}
        .mz-form-row{grid-template-columns:1fr!important;}
        .mz-dock{padding:4px!important;gap:2px!important;border-radius:14px!important;bottom:10px!important;left:8px!important;right:8px!important;transform:none!important;justify-content:space-around;}
        .mz-dock button{padding:8px 6px!important;font-size:10px!important;border-radius:10px!important;flex:1;letter-spacing:0.02em!important;}
        .mz-status{padding:0 12px!important;gap:8px!important;}
        .mz-status-mid{display:none!important;}
        .mz-status-right{gap:4px!important;}
        .mz-status-right button{padding:5px 8px!important;font-size:9px!important;}
        .mz-status-sync{padding:6px 10px!important;font-size:10px!important;}
        .mz-page-content{padding-bottom:130px!important;}
      }
    `}</style>

    {/* TOP BAR */}
    {/* STATUS BAR — slim, glanceable, single row. Brand left, info middle, actions right. */}
    <header className="mz-status" style={{height:48,background:T.glass,backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",borderBottom:`1px solid ${T.border}`,display:"flex",alignItems:"center",padding:`0 ${T.s5}`,gap:T.s4,position:"sticky",top:0,zIndex:100}}>
      <div style={{display:"flex",alignItems:"center",gap:T.s2,flexShrink:0}}>
        <svg width={18} height={18} viewBox="0 0 16 16" fill="none"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor={T.blue}/><stop offset="100%" stopColor={T.gold}/></linearGradient></defs><path d="M8 1L15 7L8 13L1 7Z" stroke="url(#lg)" strokeWidth={1.5} fill="none"/><circle cx="8" cy="7" r="2" fill={T.blue} opacity={0.9}/></svg>
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
        <button onClick={cycleTheme} title={`Theme: ${themeMode} (resolved: ${resolvedTheme}).`} style={{fontFamily:FM,fontSize:11,color:T.muted,padding:"5px 9px",background:"transparent",border:`1px solid ${T.border}`,borderRadius:8,cursor:"pointer",minWidth:30,lineHeight:1}}>{themeMode==="auto"?(resolvedTheme==="dark"?"🌙":"☀"):themeMode==="dark"?"🌙":"☀"}</button>
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
        <button onClick={sync} disabled={fetching} className="btn-primary mz-status-sync">{fetching?"Syncing…":"Sync All"}</button>
      </div>
      {forceMsg&&<div style={{position:"absolute",top:50,right:T.s3,background:T.card,border:`1px solid ${forceMsg.ok?T.gain+"40":T.loss+"40"}`,color:forceMsg.ok?T.gain:T.loss,padding:`${T.s2} ${T.s3}`,borderRadius:T.rMd,fontFamily:FM,fontSize:11,boxShadow:"var(--sh-md)",zIndex:101,maxWidth:340}}>{forceMsg.msg}</div>}
    </header>

    <main style={{maxWidth:1320,margin:"0 auto",padding:"24px 24px 110px"}}>
      <div className="page">
        {nav==="overview"  &&<Overview  live={live} snapAccounts={visibleAccounts} allAccounts={snapAccounts} plaidAccounts={plaidAccounts} disabledAccts={disabledAccts} onToggleAcct={toggleAcctEnabled} onDisconnectAcct={disconnectAccount} mapPosition={mapPosition} metrics={performanceMetrics} activities={snapActivities} netWorthHistory={(()=>{try{return JSON.parse(localStorage.getItem("mizan_networth_history")||"[]");}catch{return[];}})()} onNav={setNav} onConnect={()=>setConn(true)} onToggleDemoFromBanner={toggleDemo} bankBalance={bankBalance} nicknames={nicknames} onSetNickname={onSetNickname}/>}
        {nav==="finances"  &&<Finances onBankBalanceChange={setBankBalance} demoMode={demoMode} onNav={setNav} nicknames={nicknames} onSetNickname={onSetNickname}/>}
        {nav==="portfolio" &&<Portfolio live={live} snapAccounts={visibleAccounts} mapPosition={mapPosition} activities={snapActivities} documents={snapDocuments} watchlist={watchlist} onAddWatch={addToWatchlist} onRemoveWatch={removeFromWatchlist} onSetAlert={setAlert} onAlertPermission={requestAlertPermission} demoMode={demoMode} onNav={setNav} bankBalance={bankBalance}/>}
        {nav==="goals"     &&<GoalsHub
          snapAccounts={visibleAccounts}
          plaidAccounts={plaidAccounts}
          netWorthHistory={(()=>{try{return JSON.parse(localStorage.getItem("mizan_networth_history")||"[]");}catch{return[];}})()}
          demoMode={demoMode}
          currentNW={visibleAccounts.reduce((s,a)=>s+(a.balance||0),0)}
          ytdContrib={performanceMetrics.ytdContrib||0}
          bankBalance={bankBalance}
        />}
        {nav==="advisor"   &&<AIAdvisor accounts={visibleAccounts} activities={snapActivities} metrics={performanceMetrics} hasKey={true}/>}
        {nav==="settings"  &&<Settings  apiKeys={apiKeys} setApiKeys={setApiKeys} onConnect={()=>setConn(true)} onImportCSV={importCSV} onDedupeCSV={dedupeImports} onRetagCSV={retagImports} onReplayOnboarding={replayOnboarding} demoMode={demoMode} onToggleDemo={toggleDemo} documents={snapDocuments} accounts={visibleAccounts} onNav={setNav}/>}
      </div>
    </main>

    {/* DOCK — Mac-style floating nav at the bottom. Glass surface, rounded
        pill, lifted with shadow. Active item highlighted with accent gradient. */}
    <nav className="mz-dock" style={{
      position:"fixed",bottom:T.s5,left:"50%",transform:"translateX(-50%)",
      display:"flex",alignItems:"center",gap:T.s1,
      padding:`${T.s1} ${T.s2}`,
      background:T.glass,
      backdropFilter:"blur(28px) saturate(180%)",
      WebkitBackdropFilter:"blur(28px) saturate(180%)",
      border:`1px solid ${T.borderHi}`,
      borderRadius:999,
      boxShadow:"var(--sh-lg)",
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
          fontFamily:FU,fontSize:12,fontWeight:active?600:500,
          letterSpacing:"-0.005em",
          cursor:"pointer",
          transition:"all 0.18s cubic-bezier(.34,1.56,.64,1)",
          boxShadow:active?`0 6px 18px ${T.blue}60`:"none",
        }}>{n.l}</button>;
      })}
    </nav>

    {showConn&&<ConnectModal onClose={()=>setConn(false)} snapId={apiKeys.snapId} onConnected={()=>{ try{forceRefresh();}catch{} }}/>}

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
    />
    <ShortcutHelp
      open={shortcutHelpOpen}
      onClose={()=>setShortcutHelpOpen(false)}
      shortcuts={SHORTCUT_REFERENCE}
    />
    <CommandPalette
      open={palette.open}
      onClose={palette.close}
      commands={[
        // Navigate
        {id:"nav-overview", label:"Go to Overview",      group:"Navigate", hint:"g o", icon:"◎", action:()=>setNav("overview")},
        {id:"nav-portfolio",label:"Go to Portfolio",     group:"Navigate", hint:"g p", icon:"▣", action:()=>setNav("portfolio")},
        {id:"nav-finances", label:"Go to Finances",      group:"Navigate", hint:"g f", icon:"$", action:()=>setNav("finances")},
        {id:"nav-goals",    label:"Go to Goals",         group:"Navigate", hint:"g g", icon:"◉", action:()=>setNav("goals")},
        {id:"nav-advisor",  label:"Go to AI Advisor",    group:"Navigate", hint:"g a", icon:"✦", action:()=>setNav("advisor")},
        {id:"nav-settings", label:"Go to Settings",      group:"Navigate", hint:"g s", icon:"⚙", action:()=>setNav("settings")},
        // Actions
        {id:"act-sync",     label:"Sync All",            group:"Actions",  hint:"r",   icon:"↻", action:()=>sync()},
        {id:"act-connect",  label:"Connect Account",     group:"Actions",  icon:"+",             action:()=>setConn(true)},
        {id:"act-demo",     label:demoMode?"Disable demo mode":"Enable demo mode", group:"Actions", icon:"◧", action:()=>toggleDemo()},
        {id:"act-help",     label:"Keyboard shortcuts",  group:"Actions",  hint:"?",   icon:"⌨", action:()=>setShortcutHelpOpen(true)},
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
        />}
  </div>;
}
