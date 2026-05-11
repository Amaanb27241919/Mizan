import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { AreaChart, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useAuth } from "../lib/auth.jsx";
import { apiFetch, recordAudit } from "../lib/apiFetch.js";
import { persistUserState } from "../lib/userState.js";

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
];
// Net ~$38.4M across 8 expanded accounts.
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
  // Non-compliant
  JPM:"haram", WYNN:"haram", MO:"haram", LCID:"haram",
};

/* ─── CALC HELPERS ───────────────────────────────────── */
const mv   = h => h.sh * h.px;
const cost = h => h.sh * h.ac;
const gv   = h => mv(h) - cost(h);
const gp   = h => ((h.px-h.ac)/h.ac)*100;
const TOTAL_MV   = HOLDINGS.reduce((s,h)=>s+mv(h),0);
const TOTAL_COST = HOLDINGS.reduce((s,h)=>s+cost(h),0);

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
async function fetchFinnhub(tickers){
  if(!Array.isArray(tickers)||tickers.length===0)return[];
  try{
    const r=await apiFetch(`/api/finnhub/quote?symbols=${encodeURIComponent(tickers.slice(0,25).join(","))}`);
    if(!r.ok)return[];
    const d=await r.json();
    return Array.isArray(d?.quotes)?d.quotes:[];
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
function TabBar({tabs,active,onChange,accent}){return<div className="mz-tabbar" style={{
  display:"flex",gap:T.s1,marginBottom:T.s5,padding:T.s1,
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
})}</div>;}

/* ─── CSV PARSER (Fidelity / Robinhood / Coinbase) ───── */
// Returns activity rows shaped like SnapTrade's /activities response so they
// flow through every existing metric without special-casing.
function parseCSV(text,broker){
  const lines=text.split(/\r?\n/).filter(l=>l.trim().length>0);
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
      id:`csv-${broker}-${i}-${date}`,
      trade_date:date,
      type:finalType,
      symbol:symbol?{symbol}:null,
      units:units||null,
      price:price||null,
      amount,
      currency:{code:"USD"},
      account:null,
      institution_name:broker,
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
    if(!_gk.finnhub||!tickerKey)return;
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

  return<div>
    <div style={{fontFamily:FM,fontSize:9,color:T.muted,letterSpacing:"0.14em",marginBottom:12}}>SECTOR ALLOCATION{!_gk.finnhub&&<span style={{color:T.muted,marginLeft:8}}>· add Finnhub key for finer bucketing</span>}</div>
    {sorted.map(([sec,val],i)=>{
      const pct=total>0?(val/total)*100:0;
      return<div key={sec} style={{padding:"7px 0",display:"flex",gap:14,alignItems:"center",borderBottom:`1px solid ${T.border}`}}>
        <div style={{width:160,fontFamily:FM,fontSize:11,color:T.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{sec}</div>
        <div style={{flex:1,height:4,background:T.dim,borderRadius:6,overflow:"hidden"}}>
          <div style={{height:"100%",width:`${Math.min(pct,100)}%`,background:colorOf(sec,i),borderRadius:2}}/>
        </div>
        <div style={{width:90,textAlign:"right",fontFamily:FM,fontSize:11,color:T.textHi}}>{kf(val)}</div>
        <div style={{width:48,textAlign:"right",fontFamily:FM,fontSize:10,color:T.muted}}>{pct.toFixed(1)}%</div>
      </div>;
    })}
  </div>;
}

/* ─── OVERVIEW ───────────────────────────────────────── */
function Overview({live,snapAccounts=[],allAccounts=[],disabledAccts=new Set(),onToggleAcct,onDisconnectAcct,mapPosition,metrics={},activities=[],netWorthHistory=[],onNav,onConnect,onToggleDemoFromBanner}){
  const[range,setRange]=useState("All");
  const liveSrc=snapAccounts.length>0
    ? snapAccounts.flatMap(a=>a.positions.map(p=>mapPosition(p,a.accountName,a.brokerage))).filter(h=>h&&h.sh>0)
    : [];
  const merged=liveSrc.map(h=>{const l=live.find(q=>q.tk===h.tk);return l?{...h,px:l.price||h.px,_p:l.pct||0}:h;});
  // Total value = account balance sum (cash + equity) when SnapTrade is connected;
  // otherwise fall back to summing position market values from fixtures.
  // This matches what brokers (and Origin/Mint/etc.) report.
  const equityValue=merged.reduce((s,h)=>s+mv(h),0);
  const balanceSum=snapAccounts.reduce((s,a)=>s+(a.balance||0),0);
  const tot=snapAccounts.length>0?balanceSum:equityValue;
  const totCost=merged.reduce((s,h)=>s+cost(h),0);
  // Gain is computed against position cost basis only (cash isn't a "gain")
  const gain=equityValue-totCost;
  const gpc=totCost>0?(gain/totCost)*100:0;
  const today=merged.reduce((s,h)=>s+(h._p||0)/100*mv(h),0);
  const haram=merged.filter(h=>h.sh_==="haram");
  const haramV=haram.reduce((s,h)=>s+mv(h),0);
  const top=[...merged].sort((a,b)=>mv(b)-mv(a)).slice(0,5);
  // Cash + per-account display from live data
  const totalCash=snapAccounts.reduce((s,a)=>s+(a.cash||0),0);
  // Cards show every connected account (disabled ones dimmed); numbers above
  // are calculated from the parent-filtered `snapAccounts` only.
  // NO fallback to ACCOUNTS constant — that's the owner's data and would
  // leak to every other user who signed up.
  const cardSource=allAccounts.length>0?allAccounts:snapAccounts;
  const acctsForCards=cardSource.map(a=>({
    id:a.accountId, nm:`${a.brokerage} — ${a.accountName}`, val:a.balance||0, cash:a.cash||0,
    type:a.brokerage, authId:a.authorizationId,
    disabled:disabledAccts.has(a.accountId),
    color:a.brokerageSlug==="FIDELITY"?T.blue:a.brokerageSlug==="ROBINHOOD"?T.gain
          :a.brokerageSlug==="EMPOWER"?"#7C3AED":a.brokerageSlug==="COINBASE"?T.gold
          :a.brokerageSlug==="CHASE"?"#0F4C81":T.muted,
  }));
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
      <span style={{fontFamily:FM,fontSize:12,color:T.loss}}>{haram.map(h=>h.tk).join(", ")} — Non-compliant · {f$(haramV)}</span>
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
          <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.18em",fontWeight:600}}>TOTAL PORTFOLIO VALUE
            {snapAccounts.length>0&&<span style={{color:T.gain,marginLeft:T.s2,display:"inline-flex",alignItems:"center",gap:5}}><LiveDot on pulse/>LIVE</span>}
          </div>
          <div style={{display:"flex",gap:T.s1}}>
            {["1Y","3Y","5Y","All"].map(r=><button key={r} onClick={()=>setRange(r)} style={{padding:`4px ${T.s3}`,borderRadius:T.rSm,fontFamily:FM,fontSize:10,fontWeight:600,letterSpacing:"0.04em",background:range===r?T.blue:"transparent",border:`1px solid ${range===r?T.blue:T.border}`,color:range===r?"#fff":T.muted,cursor:"pointer",transition:"all 0.15s"}}>{r}</button>)}
          </div>
        </div>
        <div style={{display:"flex",alignItems:"baseline",gap:T.s3,marginBottom:T.s1,flexWrap:"wrap"}}>
          <div style={{fontFamily:FU,fontSize:46,fontWeight:700,color:T.textHi,letterSpacing:"-0.035em",lineHeight:1,fontVariantNumeric:"tabular-nums"}}>{fmtUSD(tot)}</div>
        </div>
        <div style={{display:"flex",gap:T.s4,marginTop:T.s2,fontFamily:FM,fontSize:12,color:T.muted,flexWrap:"wrap",alignItems:"center"}}>
          <span style={{display:"inline-flex",alignItems:"center",gap:T.s1}}>
            <span style={{color:gain>=0?T.gain:T.loss,fontWeight:600}}>{gain>=0?"+":""}{kf(Math.abs(gain))}</span>
            <span style={{color:gpc>=0?T.gain:T.loss}}>({fp(gpc)})</span>
            all-time
          </span>
          <span style={{color:T.dim}}>·</span>
          <span>Today <span style={{color:fc(today),fontWeight:600}}>{today>=0?"+":""}{f$(Math.abs(today))}</span></span>
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
          <div style={{fontFamily:FU,fontSize:28,fontWeight:700,color:T.textHi,letterSpacing:"-0.03em",fontVariantNumeric:"tabular-nums"}}>{fmtUSD(tot*0.025)}</div>
          <div style={{fontFamily:FM,fontSize:11,color:T.muted,marginTop:T.s1}}>2.5% of net worth</div>
        </BentoTile>
        <BentoTile>
          <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>COMPLIANCE</div>
          <div style={{fontFamily:FU,fontSize:28,fontWeight:700,color:halalPct>=95?T.gain:halalPct>=70?T.gold:T.loss,letterSpacing:"-0.03em",fontVariantNumeric:"tabular-nums"}}>{halalPct.toFixed(1)}%</div>
          <div style={{fontFamily:FM,fontSize:11,color:T.muted,marginTop:T.s1}}>{merged.filter(h=>h.sh_==="halal").length} of {merged.length} halal</div>
        </BentoTile>
        {totalCash>0&&<BentoTile>
          <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>CASH ON HAND</div>
          <div style={{fontFamily:FU,fontSize:24,fontWeight:600,color:T.textHi,letterSpacing:"-0.025em",fontVariantNumeric:"tabular-nums"}}>{fmtUSD(totalCash)}</div>
        </BentoTile>}
      </div>
    </div>

    {/* ─── BENTO ROW 2: Allocation donut + Performance metrics ─── */}
    <div className="bento-row" style={{display:"grid",gridTemplateColumns:"1fr 2fr",gap:T.s4}}>
      <BentoTile>
        <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s4}}>ALLOCATION</div>
        {allocSlices.length>0?<div style={{display:"flex",gap:T.s5,alignItems:"center",flexWrap:"wrap"}}>
          <Donut slices={allocSlices} size={170} thickness={20} centerLabel="Total" centerValue={kf(allocSlices.reduce((s,x)=>s+x.value,0))}/>
          <div style={{display:"flex",flexDirection:"column",gap:T.s2,flex:1,minWidth:140}}>
            {allocSlices.map(s=>{
              const t=allocSlices.reduce((a,b)=>a+b.value,0);
              const pct=t>0?(s.value/t*100):0;
              return<div key={s.label} style={{display:"flex",alignItems:"center",gap:T.s2}}>
                <span style={{width:8,height:8,borderRadius:2,background:s.color,flexShrink:0}}/>
                <span style={{fontFamily:FU,fontSize:13,color:T.text,flex:1,letterSpacing:"-0.005em"}}>{s.label}</span>
                <span style={{fontFamily:FM,fontSize:11,fontWeight:600,color:T.textHi,fontVariantNumeric:"tabular-nums"}}>{pct.toFixed(1)}%</span>
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
            {label:"Total Return",  value:`${gain>=0?"+":""}${kf(Math.abs(gain))}`,sub:totCost>0?fp(gpc):"Unrealized",subColor:fc(gain)},
            {label:"YTD Contrib.",  value:kf(metrics.ytdContrib||0),                sub:"This year",                    subColor:T.gain},
            {label:"All-Time",       value:kf(metrics.allTimeContrib||0),            sub:"Lifetime deposits"},
            {label:"YTD Dividends", value:kf(metrics.ytdDividends||0),               sub:"Cash received",                subColor:T.gold},
            {label:"Fees (YTD)",    value:kf(metrics.ytdFees||0),                    sub:`$${(metrics.allTimeFees||0).toFixed(0)} all-time`,subColor:T.loss},
            {label:"Net Inflow",    value:kf((metrics.ytdContrib||0)-(metrics.ytdWithdrawals||0)),sub:"Deposits − withdrawals",subColor:T.gain},
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
              <div style={{fontFamily:FM,fontSize:9,color:T.muted,marginTop:T.s1,letterSpacing:"0.04em"}}>{pof.toFixed(1)}% of book</div>
            </div>
            <div style={{width:90,textAlign:"right"}}>
              <div style={{fontFamily:FU,fontSize:14,fontWeight:600,color:T.textHi,letterSpacing:"-0.01em",fontVariantNumeric:"tabular-nums"}}>{f$(mv(h))}</div>
              <div style={{fontFamily:FM,fontSize:10,fontWeight:500,color:fc(gpct),marginTop:2}}>{fp(gpct)}</div>
            </div>
            <Sk vals={Array.from({length:24},()=>mv(h)*(1+(Math.random()-.48)*.02))} color={fc(gpct)} w={80} h={28} fill/>
          </div>;
        })}
      </div>
    </BentoTile>}

    {/* ─── BENTO ROW 4: Accounts ────────────────────── */}
    {acctsForCards.length>0&&<BentoTile>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:T.s4}}>
        <span style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600}}>ACCOUNTS{disabledAccts.size>0&&<span style={{color:T.muted,marginLeft:T.s2,fontWeight:400}}>· {disabledAccts.size} hidden</span>}</span>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:T.s2}}>
        {acctsForCards.map(a=>{
          const dim=a.disabled;
          return<div key={a.id} style={{
            background:dim?"transparent":T.surface,
            border:`1px solid ${dim?T.border:T.border}`,
            borderLeft:`3px solid ${a.color}`,
            borderRadius:T.rMd,
            padding:`${T.s3} ${T.s4}`,
            position:"relative",
            opacity:dim?0.4:1,
            transition:"all 0.18s",
          }}>
            <div style={{fontFamily:FM,fontSize:9,color:T.muted,letterSpacing:"0.14em",fontWeight:600,marginBottom:T.s1,textDecoration:dim?"line-through":"none"}}>{(a.type||"").toUpperCase()}</div>
            <div style={{fontFamily:FU,fontSize:18,fontWeight:700,color:T.textHi,letterSpacing:"-0.02em",fontVariantNumeric:"tabular-nums",textDecoration:dim?"line-through":"none"}}>{fmtUSD(a.val||0)}</div>
            {a.cash>0&&<div style={{fontFamily:FM,fontSize:10,color:T.muted,marginTop:T.s1}}>{fmtUSD(a.cash)} cash</div>}
            <div style={{fontFamily:FU,fontSize:11,color:T.muted,marginTop:T.s1,letterSpacing:"-0.005em"}}>{a.nm}</div>
            {a.note&&<div style={{fontFamily:FM,fontSize:10,color:T.gold,marginTop:T.s1,fontWeight:500}}>{a.note}</div>}
            <div style={{position:"absolute",top:T.s2,right:T.s2,display:"flex",gap:4}}>
              {onToggleAcct&&<button onClick={()=>onToggleAcct(a.id)} title={dim?"Include in totals":"Hide from totals"}
                style={{padding:`2px ${T.s2}`,borderRadius:T.rSm,fontFamily:FM,fontSize:9,fontWeight:600,letterSpacing:"0.06em",
                  background:dim?"transparent":`${T.muted}14`,border:`1px solid ${dim?T.gain+"40":T.border}`,
                  color:dim?T.gain:T.muted,cursor:"pointer"}}>{dim?"ON":"OFF"}</button>}
              {onDisconnectAcct&&<button onClick={()=>onDisconnectAcct(a.id,a.authId,a.nm)} title="Permanently disconnect"
                style={{padding:`2px ${T.s2}`,borderRadius:T.rSm,fontFamily:FM,fontSize:10,
                  background:"transparent",border:`1px solid ${T.loss}30`,color:T.loss,cursor:"pointer"}}>✕</button>}
            </div>
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
  if(!_gk.finnhub)return{tk,status:"unknown",reason:"No Finnhub key"};
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
  useEffect(()=>{if(tickers.length&&_gk.finnhub)runScreen(false); /* eslint-disable-next-line */},[tickers.join(",")]);

  const enriched=holdings.map(h=>({...h,_screen:results[h.tk]||{status:h.sh_||"unknown"}}));
  const byStatus={halal:[],review:[],haram:[],unknown:[]};
  enriched.forEach(h=>(byStatus[h._screen.status]||byStatus.unknown).push(h));
  const totalEquity=enriched.reduce((s,h)=>s+mv(h),0);
  const haramValue=byStatus.haram.reduce((s,h)=>s+mv(h),0);
  const reviewValue=byStatus.review.reduce((s,h)=>s+mv(h),0);
  // Purification estimate: 5% × dividend × non-permissible income proxy (we
  // don't have non-perm income from free APIs, so use a conservative 5%
  // multiplier on review-status dividends).
  // For now, surface the haram + review values as "purification candidates".
  const haramPct=totalEquity>0?(haramValue/totalEquity)*100:0;

  return<div style={{display:"flex",flexDirection:"column",gap:14}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:14,flexWrap:"wrap"}}>
      <div style={{maxWidth:680}}>
        <p style={{fontFamily:FU,fontSize:13,color:T.muted,margin:0,lineHeight:1.7}}>
          Live Sharia screening across multiple frameworks. Pick a primary standard for the row badges; every standard runs in the background so you see a per-position pass count. Data: Finnhub fundamentals.
        </p>
      </div>
      <div style={{display:"flex",gap:8,alignItems:"center"}}>
        <select value={primary} onChange={e=>setStandard(e.target.value)} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:6,padding:"7px 10px",fontFamily:FM,fontSize:11,color:T.text,cursor:"pointer"}}>
          {Object.entries(STANDARDS).map(([k,s])=><option key={k} value={k}>{s.name}</option>)}
        </select>
        <button onClick={()=>runScreen(true)} disabled={busy||!_gk.finnhub} style={{padding:"7px 16px",borderRadius:6,fontFamily:FM,fontSize:11,fontWeight:500,letterSpacing:"0.06em",background:busy?T.dim:T.blue,border:"none",color:busy?T.muted:"#fff",cursor:busy||!_gk.finnhub?"not-allowed":"pointer"}}>{busy?"Screening…":!_gk.finnhub?"Add Finnhub key":"Re-screen"}</button>
      </div>
    </div>
    <div style={{fontFamily:FM,fontSize:10,color:T.muted,padding:"8px 12px",background:T.card,border:`1px solid ${T.border}`,borderRadius:3}}>
      <span style={{color:T.textHi,fontWeight:500}}>{STANDARDS[primary].name}</span>
      <span style={{margin:"0 6px"}}>·</span>{STANDARDS[primary].region}
      <span style={{margin:"0 6px"}}>·</span>Debt/{STANDARDS[primary].denominator==="totalAssets"?"Assets":"MC"} &lt; {STANDARDS[primary].debtMax}%
      <span style={{margin:"0 6px"}}>·</span>Cash &lt; {STANDARDS[primary].cashMax}%
      <span style={{margin:"0 6px"}}>·</span>A/R &lt; {STANDARDS[primary].recvMax}%
      <span style={{margin:"0 6px"}}>·</span>Non-perm income &lt; {STANDARDS[primary].nonPermMax}%
      <span style={{margin:"0 6px"}}>·</span><span style={{color:T.text}}>{STANDARDS[primary].notes}</span>
    </div>

    <div className="mz-grid-4" style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
      <KV label="Halal positions"      value={`${byStatus.halal.length}`}    sub={kf(byStatus.halal.reduce((s,h)=>s+mv(h),0))}    subColor={T.gain}/>
      <KV label="Review positions"     value={`${byStatus.review.length}`}   sub={kf(reviewValue)}                                  subColor={T.gold}/>
      <KV label="Non-Compliant"        value={`${byStatus.haram.length}`}    sub={`${kf(haramValue)} · ${haramPct.toFixed(1)}%`}      subColor={T.loss} accent={T.loss}/>
      <KV label="Purification est."    value={kf(haramValue*0.025+reviewValue*0.005)} sub="2.5% haram + 0.5% review" subColor={T.gold} accent={T.gold}/>
    </div>

    <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,overflow:"hidden"}}>
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
    </div>

    <div className="mz-grid-2" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
      <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:14}}>
        <div style={{fontFamily:FM,fontSize:9,color:T.muted,letterSpacing:"0.14em",marginBottom:8}}>STANDARDS RUN AGAINST EACH HOLDING</div>
        {Object.entries(STANDARDS).map(([k,s])=><div key={k} style={{padding:"7px 0",borderBottom:`1px solid ${T.border}`,fontFamily:FU,fontSize:12}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
            <span style={{color:T.text,fontWeight:500}}>{s.name}</span>
            <span style={{color:T.muted,fontFamily:FM,fontSize:10}}>{s.region}</span>
          </div>
          <div style={{color:T.muted,fontSize:11,lineHeight:1.5,fontFamily:FM}}>
            <span style={{color:T.text}}>Debt/{s.denominator==="totalAssets"?"Assets":"MC"} &lt; {s.debtMax}%</span>
            <span style={{margin:"0 6px"}}>·</span>
            <span style={{color:T.text}}>Cash &lt; {s.cashMax}%</span>
            <span style={{margin:"0 6px"}}>·</span>
            <span style={{color:T.text}}>A/R &lt; {s.recvMax}%</span>
            <span style={{margin:"0 6px"}}>·</span>
            <span style={{color:T.text}}>Income &lt; {s.nonPermMax}%</span>
          </div>
          <div style={{color:T.muted,fontSize:10,lineHeight:1.5,marginTop:3}}>{s.notes}</div>
        </div>)}
        <div style={{padding:"8px 0 0",fontFamily:FU,fontSize:11,color:T.muted,lineHeight:1.5}}>
          <strong style={{color:T.text}}>Universal:</strong> Sector exclusion across all standards (banking, alcohol, tobacco, gambling, weapons, conventional insurance, adult entertainment, pork). IFRS provides accounting framework; not a screening standard itself.
        </div>
      </div>
      <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:14}}>
        <div style={{fontFamily:FM,fontSize:9,color:T.muted,letterSpacing:"0.14em",marginBottom:8}}>PURIFICATION GUIDE</div>
        <p style={{fontFamily:FU,fontSize:12,color:T.muted,margin:0,lineHeight:1.6}}>
          Income from non-compliant or mixed-revenue companies must be purified — the impure portion is donated to charity (Sadaqah), without expectation of reward. The estimate at the top is a conservative proxy; for precision, multiply each holding's dividend by the company's non-permissible-income ratio (rarely disclosed publicly).
        </p>
        <div style={{marginTop:12,padding:"10px 12px",background:`${T.gold}0C`,borderRadius:8,border:`1px solid ${T.gold}25`}}>
          <div style={{fontFamily:FM,fontSize:9,color:T.muted,marginBottom:4}}>EXIT GUIDANCE</div>
          <div style={{fontFamily:FU,fontSize:12,color:T.text,lineHeight:1.6}}>
            For Non-Compliant positions: sell at the next reasonable opportunity, donate any gains realized after purification to charity, and replace with a Sharia-screened equivalent (SPUS / HLAL / UMMA / SPSK).
          </div>
        </div>
      </div>
    </div>
  </div>;
}

/* ─── TAX PLANNER ────────────────────────────────────── */
// Tax-loss harvesting candidates + estimated annual tax cost.
// Pure compute — no API calls. Replacement suggestions are halal defaults
// from the existing ETF universe (SPUS, HLAL, UMMA).
function TaxPlanner({holdings=[],activities=[]}){
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

  // YTD realized gain/loss from SELL activities
  const ytdISO=`${new Date().getFullYear()}-01-01`;
  const ytdSells=activities.filter(a=>(a.type||"").toUpperCase()==="SELL"&&(a.trade_date||"")>=ytdISO);
  const ytdRealized=ytdSells.reduce((s,a)=>s+(+a.amount||0),0);
  const ytdDividends=activities.filter(a=>(a.type||"").toUpperCase()==="DIVIDEND"&&(a.trade_date||"")>=ytdISO).reduce((s,a)=>s+(+a.amount||0),0);
  const estTax=Math.max(0,(ytdRealized+ytdDividends)*(bracket+stateBracket));

  // Wash-sale check: any SELL of same symbol in last 30 days
  const today=new Date();
  const days30=new Date(today);days30.setDate(today.getDate()-30);
  const days30ISO=days30.toISOString().slice(0,10);
  const recentSells=new Set(activities.filter(a=>(a.type||"").toUpperCase()==="SELL"&&(a.trade_date||"")>=days30ISO).map(a=>a.symbol?.symbol||a.symbol));

  return<div style={{display:"flex",flexDirection:"column",gap:14}}>
    <div style={{fontFamily:FU,fontSize:13,color:T.muted,lineHeight:1.7,maxWidth:680}}>
      Surfaces unrealized losses you could harvest to offset taxable gains. Wash-sale rule: a position sold at a loss can't be repurchased within 30 days. Estimates assume your federal+state marginal rate.
    </div>

    <div className="mz-grid-4" style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
      <KV label="Harvestable Loss" value={kf(Math.abs(totalLoss))} sub={`${losers.length} positions`} subColor={T.gain}/>
      <KV label="Est. Tax Savings" value={kf(taxSavings)} sub={`@ ${((bracket+stateBracket)*100).toFixed(0)}% marginal`} subColor={T.gold} accent={T.gold}/>
      <KV label="YTD Realized" value={`${ytdRealized>=0?"+":""}${kf(Math.abs(ytdRealized))}`} sub={`${ytdSells.length} sells YTD`} subColor={fc(ytdRealized)}/>
      <KV label="Est. Tax Owed" value={kf(estTax)} sub="On YTD gains + divs" subColor={T.loss}/>
    </div>

    <div style={{display:"flex",gap:10,alignItems:"center",fontFamily:FM,fontSize:11,color:T.muted}}>
      <span>Federal bracket:</span>
      <select value={bracket} onChange={e=>setBracket(+e.target.value)} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:6,padding:"4px 10px",fontFamily:FM,fontSize:11,color:T.text,cursor:"pointer"}}>
        {[0.10,0.12,0.22,0.24,0.32,0.35,0.37].map(b=><option key={b} value={b}>{(b*100).toFixed(0)}%</option>)}
      </select>
      <span>State:</span>
      <select value={stateBracket} onChange={e=>setStateBracket(+e.target.value)} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:6,padding:"4px 10px",fontFamily:FM,fontSize:11,color:T.text,cursor:"pointer"}}>
        {[0,0.03,0.05,0.07,0.09,0.13].map(b=><option key={b} value={b}>{(b*100).toFixed(0)}%</option>)}
      </select>
    </div>

    {losers.length===0
      ?<div style={{background:T.card,border:`1px dashed ${T.border}`,borderRadius:12,padding:"32px",textAlign:"center",fontFamily:FM,fontSize:11,color:T.muted}}>No unrealized losses across visible accounts. Nothing to harvest.</div>
      :<div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,overflow:"hidden"}}>
          <Tbl cols={[
            {l:"Symbol",r_:r=><div><div style={{fontFamily:FM,fontSize:12,fontWeight:500,color:r.sh_==="haram"?T.loss:T.textHi}}>{r.tk}</div><div style={{fontFamily:FM,fontSize:9,color:T.muted}}>{r.ac_}</div></div>},
            {l:"Shares",r:true,r_:r=><span style={{fontFamily:FM,fontSize:11,color:T.text}}>{r.sh.toFixed(3)}</span>},
            {l:"Avg Cost",r:true,r_:r=><span style={{fontFamily:FM,fontSize:11,color:T.muted}}>{f$(r.ac)}</span>},
            {l:"Current",r:true,r_:r=><span style={{fontFamily:FM,fontSize:11,color:T.text}}>{f$(r.px)}</span>},
            {l:"Loss $",r:true,r_:r=><span style={{fontFamily:FM,fontSize:12,fontWeight:500,color:T.loss}}>{f$(Math.abs(r._loss))}</span>},
            {l:"Loss %",r:true,r_:r=><span style={{fontFamily:FM,fontSize:11,color:T.loss}}>{fp(r._lossPct)}</span>},
            {l:"Wash Risk",r_:r=>recentSells.has(r.tk)?<Tag label="< 30d sold" color={T.loss}/>:<Tag label="Clear" color={T.gain}/>},
            {l:"Replace With",r_:r=><span style={{fontFamily:FM,fontSize:11,color:r.sh_==="haram"?T.loss:T.gold}}>{r._replacement}</span>},
          ]} rows={losers}/>
        </div>
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
      <div style={{marginLeft:"auto",display:"flex",gap:T.s1}}>
        {[["1m","1M"],["3m","3M"],["1y","1Y"],["5y","5Y"],["all","All"]].map(([v,l])=>
          <button key={v} onClick={()=>setRange(v)} style={{padding:`5px ${T.s3}`,borderRadius:T.rMd,fontFamily:FM,fontSize:10,fontWeight:600,letterSpacing:"0.06em",
            background:range===v?T.borderHi:"transparent",border:`1px solid ${range===v?T.borderHi:T.border}`,
            color:range===v?T.text:T.muted,cursor:"pointer"}}>{l}</button>)}
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
const NISAB_USD = 5765; // 87.48g gold @ ~$66/g — updated periodically.

// Owner-only seed: restores the donation history that was hardcoded in the
// pre-privacy-fix bundle. Only runs when the signed-in user's email matches
// the configured VITE_OWNER_EMAIL, and only the first time (marker stored
// in mizan_sadaqah_seeded). Future deletes won't re-seed.
const OWNER_SADAQAH_SEED = [
  {dt:"2022-04-29",org:"Islamic Foundation",amt:500, done:true},
  {dt:"2023-12-11",org:"ISNS",              amt:2000,done:true},
  {dt:"2024-04-08",org:"Masjid An-Noor",    amt:1000,done:true},
  {dt:"2024-04-09",org:"Muhsen",            amt:250, done:true},
  {dt:"2025-05-30",org:"Qalam",             amt:52,  done:true},
  {dt:"2026-02-23",org:"ISNS",              amt:1000,done:true},
  {dt:"2026-03-19",org:"Masjid Uthman",     amt:500, done:true},
  {dt:"Pledge",    org:"Helping Hand",      amt:1300,done:false},
  {dt:"Pledge",    org:"ISNS",              amt:2000,done:false},
  {dt:"Pledge",    org:"Masjid Uthman",     amt:5000,done:false},
];

function ZakatSadaqah({accounts=[]}){
  const{user}=useAuth();
  const[sadaqah,setSadaqah]=useState(()=>{try{return JSON.parse(localStorage.getItem("mizan_sadaqah")||"[]");}catch{return[];}});
  const[form,setForm]=useState({dt:new Date().toISOString().slice(0,10),org:"",amt:"",done:true});
  const[importBusy,setImportBusy]=useState(false);
  const[importStatus,setImportStatus]=useState(null);
  const importRef=useRef(null);

  // Owner one-time backfill — runs once after sign-in. Skips if the user
  // already has any entries or the marker was set previously.
  useEffect(()=>{
    if(!user?.email)return;
    const owner=(import.meta.env.VITE_OWNER_EMAIL||"").trim().toLowerCase();
    if(!owner||user.email.toLowerCase()!==owner)return;
    let seeded=false;try{seeded=localStorage.getItem("mizan_sadaqah_seeded")==="1";}catch{}
    if(seeded||sadaqah.length>0)return;
    const seedRows=OWNER_SADAQAH_SEED.map((r,i)=>({id:`seed-${i}`,...r}));
    setSadaqah(seedRows);
    try{
      localStorage.setItem("mizan_sadaqah",JSON.stringify(seedRows));
      localStorage.setItem("mizan_sadaqah_seeded","1");
    }catch{}
    persistUserState("mizan_sadaqah",seedRows);
    persistUserState("mizan_sadaqah_seeded","1");
  },[user?.email]); // eslint-disable-line react-hooks/exhaustive-deps

  const manualAssets=(()=>{try{return JSON.parse(localStorage.getItem("mizan_manual_assets")||"[]");}catch{return[];}})();
  const acctTotal       = accounts.reduce((s,a)=>s+(a.balance||0),0);
  const zakatableManual = manualAssets.filter(a=>a.zakatable).reduce((s,a)=>s+(a.value||0),0);
  const zakatable       = acctTotal+zakatableManual;
  const zakatDue        = zakatable*0.025;
  const aboveNisab      = zakatable >= NISAB_USD;
  const given           = sadaqah.filter(s=>s.done).reduce((a,b)=>a+(+b.amt||0),0);
  const pledged         = sadaqah.filter(s=>!s.done).reduce((a,b)=>a+(+b.amt||0),0);
  const fmtUSD          = v=>`$${(+v).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}`;

  const persist=arr=>{setSadaqah(arr);localStorage.setItem("mizan_sadaqah",JSON.stringify(arr));persistUserState("mizan_sadaqah",arr);};
  const add=e=>{e.preventDefault();if(!form.org||!form.amt)return;persist([{id:`s-${Date.now()}`,...form,amt:+form.amt},...sadaqah]);setForm({...form,org:"",amt:""});};
  const remove=id=>{
    if(!window.confirm("Remove this donation entry?"))return;
    persist(sadaqah.filter(s=>s.id!==id));
  };

  // CSV import: expects "Date, Organization, Amount, Status" header row,
  // case-insensitive. Status of "given"|"done"|"paid"|"y"|"yes"|"true"
  // means donated; anything else means pledged. Fingerprint-dedups.
  const handleImport=async e=>{
    const file=e.target.files?.[0];
    if(!file)return;
    setImportBusy(true);setImportStatus(null);
    try{
      const text=await file.text();
      const lines=text.split(/\r?\n/).filter(l=>l.trim());
      if(lines.length<2)throw new Error("CSV needs a header row + at least one donation row.");
      const split=l=>l.split(",").map(c=>c.trim().replace(/^"|"$/g,""));
      const header=split(lines[0]).map(h=>h.toLowerCase());
      const idx={
        date:header.findIndex(h=>h.includes("date")),
        org: header.findIndex(h=>h.includes("org")||h.includes("recipient")||h.includes("charity")),
        amt: header.findIndex(h=>h.includes("amount")||h.includes("amt")||h.includes("total")),
        stat:header.findIndex(h=>h.includes("status")||h.includes("paid")||h.includes("given")||h.includes("pledged")),
      };
      if(idx.date<0||idx.org<0||idx.amt<0)throw new Error("CSV must have Date, Organization, and Amount columns.");
      const DONE=new Set(["given","done","paid","y","yes","true","1"]);
      const seen=new Set(sadaqah.map(s=>`${s.dt}|${(s.org||"").toLowerCase()}|${+s.amt||0}`));
      const fresh=[];let skipped=0;
      lines.slice(1).forEach((l,i)=>{
        const cells=split(l);
        const dt=cells[idx.date]||"";
        const org=cells[idx.org]||"";
        const amtStr=(cells[idx.amt]||"").replace(/[$,]/g,"");
        const amt=parseFloat(amtStr);
        if(!org||!Number.isFinite(amt))return;
        const stat=idx.stat>=0?(cells[idx.stat]||"").toLowerCase():"given";
        const done=DONE.has(stat);
        const fp=`${dt}|${org.toLowerCase()}|${amt}`;
        if(seen.has(fp)){skipped++;return;}
        seen.add(fp);
        fresh.push({id:`s-${Date.now()}-${i}`,dt,org,amt,done});
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
            ["Brokerage",fmtUSD(acctTotal)],
            ["Manual zakatable",fmtUSD(zakatableManual)],
            ["Total zakatable",fmtUSD(zakatable),true],
            ["Nisab threshold",fmtUSD(NISAB_USD)],
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

    {/* ─── ROW 2: Log entry + import ───────────────── */}
    <BentoTile>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:T.s2,marginBottom:T.s3}}>
        <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600}}>LOG A DONATION</div>
        <div style={{display:"flex",gap:T.s2,alignItems:"center"}}>
          <input ref={importRef} type="file" accept=".csv,text/csv" onChange={handleImport} style={{display:"none"}}/>
          <button onClick={()=>importRef.current?.click()} disabled={importBusy} className="btn-ghost" title="Import a CSV with columns: Date, Organization, Amount, Status">{importBusy?"Importing…":"Import CSV"}</button>
        </div>
      </div>
      <form onSubmit={add} className="mz-form-row" style={{display:"grid",gridTemplateColumns:"140px 1fr 130px 110px auto",gap:T.s2,alignItems:"end"}}>
        <input type="date" value={form.dt} onChange={e=>setForm({...form,dt:e.target.value})} className="field"/>
        <input placeholder="Organization" value={form.org} onChange={e=>setForm({...form,org:e.target.value})} className="field"/>
        <input type="number" step="0.01" placeholder="Amount" value={form.amt} onChange={e=>setForm({...form,amt:e.target.value})} className="field" style={{fontVariantNumeric:"tabular-nums"}}/>
        <select value={form.done?"done":"pledged"} onChange={e=>setForm({...form,done:e.target.value==="done"})} className="field" style={{cursor:"pointer"}}>
          <option value="done">Given</option>
          <option value="pledged">Pledged</option>
        </select>
        <button type="submit" className="btn-primary">Add</button>
      </form>
      {importStatus&&<div style={{marginTop:T.s3,padding:`${T.s2} ${T.s3}`,borderRadius:T.rMd,fontFamily:FM,fontSize:11,background:importStatus.ok?T.gainBg:T.lossBg,border:`1px solid ${(importStatus.ok?T.gain:T.loss)+"30"}`,color:importStatus.ok?T.gain:T.loss,lineHeight:1.5}}>{importStatus.ok?"✓ ":"✗ "}{importStatus.msg}</div>}
    </BentoTile>

    {/* ─── ROW 3: Donation history ─────────────────── */}
    <BentoTile style={{padding:0,overflow:"hidden"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:`${T.s4} ${T.s5}`,borderBottom:`1px solid ${T.border}`,flexWrap:"wrap",gap:T.s2}}>
        <span style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600}}>DONATION HISTORY</span>
        <span style={{fontFamily:FM,fontSize:11,color:T.muted,fontVariantNumeric:"tabular-nums"}}>{fmtUSD(given)} given{pledged>0?` · ${fmtUSD(pledged)} pledged`:""}</span>
      </div>
      {sadaqah.length===0
        ?<div style={{padding:`${T.s8} ${T.s5}`,textAlign:"center",fontFamily:FU,fontSize:13,color:T.muted}}>No donations logged yet. Add one with the form above, or import a CSV.</div>
        :<Tbl cols={[
          {l:"Date",       r_:r=><span style={{fontFamily:FM,fontSize:11,color:T.muted,fontVariantNumeric:"tabular-nums"}}>{r.dt||"—"}</span>},
          {l:"Organization",r_:r=><span style={{fontFamily:FU,fontSize:13,color:T.text,letterSpacing:"-0.005em"}}>{r.org}</span>},
          {l:"Amount",r:true,r_:r=><span style={{fontFamily:FU,fontSize:13,fontWeight:600,color:T.gold,letterSpacing:"-0.005em",fontVariantNumeric:"tabular-nums"}}>{fmtUSD(r.amt)}</span>},
          {l:"Status",     r_:r=><Tag label={r.done?"Given":"Pledged"} color={r.done?T.gain:T.gold}/>},
          {l:"",r:true,    r_:r=><button onClick={()=>remove(r.id)} title="Remove this entry" style={{padding:`3px ${T.s2}`,borderRadius:T.rSm,background:"transparent",border:`1px solid ${T.loss}30`,color:T.loss,cursor:"pointer",fontFamily:FM,fontSize:11}}>✕</button>},
        ]} rows={[...sadaqah].sort((a,b)=>(b.dt||"").localeCompare(a.dt||""))}/>}
    </BentoTile>
  </div>;
}

/* ─── PORTFOLIO ──────────────────────────────────────── */
function Portfolio({live,snapAccounts=[],mapPosition,activities=[],documents=[],watchlist=[],onAddWatch,onRemoveWatch,onSetAlert,onAlertPermission}){
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
    <TabBar tabs={[["holdings","Holdings"],["watchlist","Watchlist"],["activity","Activity"],["tax","Tax Planning"],["zakat","Zakat & Sadaqah"],["etfs","ETFs & Funds"],["screener","Sharia Screener"]]} active={sub} onChange={setSub}/>

    {sub==="holdings"&&<>
      {/* ─── BENTO ROW 1: Hero + side stack ─────────────── */}
      <div className="bento-row" style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:T.s4}}>
        <BentoTile style={{
          background:`radial-gradient(circle at 0% 0%, ${T.blue}1F, transparent 55%), radial-gradient(circle at 100% 100%, ${T.gold}12, transparent 50%), ${T.card}`,
          borderColor:T.blue+"30",
          padding:`${T.s6} ${T.s6}`,
        }}>
          <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.18em",fontWeight:600,marginBottom:T.s3}}>MARKET VALUE
            {snapAccounts.length>0&&<span style={{color:T.gain,marginLeft:T.s2,display:"inline-flex",alignItems:"center",gap:5}}><LiveDot on pulse/>LIVE</span>}
          </div>
          <div style={{fontFamily:FU,fontSize:42,fontWeight:700,color:T.textHi,letterSpacing:"-0.035em",lineHeight:1,fontVariantNumeric:"tabular-nums"}}>{fmtUSD(tot)}</div>
          <div style={{display:"flex",gap:T.s4,marginTop:T.s3,fontFamily:FM,fontSize:12,color:T.muted,flexWrap:"wrap",alignItems:"center"}}>
            <span>
              <span style={{color:totGain>=0?T.gain:T.loss,fontWeight:600}}>{totGain>=0?"+":""}{kf(Math.abs(totGain))}</span>{" "}
              <span style={{color:totGain>=0?T.gain:T.loss}}>({fp(totGainPct)})</span>{" "}
              <span style={{color:T.muted}}>all-time</span>
            </span>
            <span style={{color:T.dim}}>·</span>
            <span>Today{" "}
              <span style={{color:fc(today),fontWeight:600}}>{today>=0?"+":""}{f$(Math.abs(today))}</span>{" "}
              <span style={{color:fc(today)}}>({fp(todayPct)})</span>
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
            <div style={{fontFamily:FU,fontSize:26,fontWeight:700,color:fc(totGain),letterSpacing:"-0.025em",fontVariantNumeric:"tabular-nums"}}>{totGain>=0?"+":""}{kf(Math.abs(totGain))}</div>
            <div style={{fontFamily:FM,fontSize:11,fontWeight:500,color:fc(totGain),marginTop:T.s1}}>{totCost>0?fp(totGainPct):"Unrealized"}</div>
          </BentoTile>
          {haramV>0?<BentoTile accent={T.loss} style={{background:`linear-gradient(135deg, ${T.loss}10, transparent 60%), ${T.card}`}}>
            <div style={{fontFamily:FM,fontSize:10,color:T.loss,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s2}}>NON-COMPLIANT</div>
            <div style={{fontFamily:FU,fontSize:26,fontWeight:700,color:T.textHi,letterSpacing:"-0.025em",fontVariantNumeric:"tabular-nums"}}>{f$(haramV)}</div>
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
          <Donut slices={brokerSlices} size={160} thickness={18} centerLabel="Total" centerValue={kf(brokerSlices.reduce((s,x)=>s+x.value,0))}/>
          <div style={{display:"flex",flexDirection:"column",gap:T.s2,flex:1,minWidth:200}}>
            {brokerSlices.map(s=>{
              const tt=brokerSlices.reduce((a,b)=>a+b.value,0);
              const pct=tt>0?(s.value/tt*100):0;
              return<div key={s.label} style={{display:"flex",alignItems:"center",gap:T.s2}}>
                <span style={{width:8,height:8,borderRadius:2,background:s.color,flexShrink:0}}/>
                <span style={{fontFamily:FU,fontSize:13,color:T.text,flex:1,letterSpacing:"-0.005em"}}>{s.label}</span>
                <span style={{fontFamily:FM,fontSize:11,fontWeight:500,color:T.muted,fontVariantNumeric:"tabular-nums"}}>{kf(s.value)}</span>
                <span style={{fontFamily:FM,fontSize:11,fontWeight:600,color:T.textHi,fontVariantNumeric:"tabular-nums",minWidth:45,textAlign:"right"}}>{pct.toFixed(1)}%</span>
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
        <div style={{marginLeft:"auto",display:"flex",gap:T.s1}}>
          {[["mv","Value"],["gp","Gain%"],["tk","A-Z"]].map(([v,l])=><button key={v} onClick={()=>setSort(v)} style={{padding:`5px ${T.s3}`,borderRadius:T.rMd,fontFamily:FM,fontSize:10,fontWeight:600,letterSpacing:"0.06em",background:sort===v?T.borderHi:"transparent",border:`1px solid ${sort===v?T.borderHi:T.border}`,color:sort===v?T.text:T.muted,cursor:"pointer"}}>{l}</button>)}
        </div>
      </div>

      {/* ─── Holdings table ───────────────────────────── */}
      <BentoTile style={{padding:0,overflow:"hidden"}}>
        <Tbl cols={[
          {l:"Symbol", r_:r=><div><div style={{fontFamily:FU,fontSize:14,fontWeight:600,color:r.sh_==="haram"?T.loss:T.textHi,letterSpacing:"-0.01em"}}>{r.tk}</div><div style={{fontFamily:FM,fontSize:10,color:T.muted,marginTop:2}}>{r.ac_}</div></div>},
          {l:"Shares",  r_:r=><span style={{fontFamily:FM,fontSize:12,color:T.text,fontVariantNumeric:"tabular-nums"}}>{r.sh.toFixed(3)}</span>},
          {l:"Avg Cost",r:true,r_:r=><span style={{fontFamily:FM,fontSize:11,color:T.muted,fontVariantNumeric:"tabular-nums"}}>{f$(r.ac)}</span>},
          {l:"Price",   r:true,r_:r=><div style={{textAlign:"right"}}><div style={{fontFamily:FM,fontSize:13,fontWeight:500,color:r._live?T.textHi:T.text,fontVariantNumeric:"tabular-nums"}}>{f$(r.px)}</div>{r._live&&<div style={{fontFamily:FM,fontSize:9,color:T.gain,letterSpacing:"0.06em",marginTop:1}}>● LIVE</div>}</div>},
          {l:"Today",   r:true,r_:r=><span style={{fontFamily:FM,fontSize:11,fontWeight:500,color:fc(r._p),fontVariantNumeric:"tabular-nums"}}>{r._p?fp(r._p):"—"}</span>},
          {l:"Mkt Value",r:true,r_:r=><span style={{fontFamily:FU,fontSize:14,fontWeight:600,color:T.textHi,letterSpacing:"-0.005em",fontVariantNumeric:"tabular-nums"}}>{f$(mv(r))}</span>},
          {l:"Gain/Loss",r:true,r_:r=><div style={{textAlign:"right"}}><div style={{fontFamily:FM,fontSize:12,fontWeight:500,color:fc(gv(r)),fontVariantNumeric:"tabular-nums"}}>{gv(r)>=0?"+":""}{f$(gv(r))}</div><div style={{fontFamily:FM,fontSize:10,color:fc(gp(r)),marginTop:1}}>{fp(gp(r))}</div></div>},
          {l:"Sharia",  r_:r=><Tag label={r.sh_==="halal"?"Halal":r.sh_==="haram"?"Non-Compliant":"Review"} color={r.sh_==="halal"?T.gain:r.sh_==="haram"?T.loss:T.gold}/>},
        ]} rows={filtered}/>
        {filtered.length===0&&<div style={{padding:`${T.s10} ${T.s5}`,textAlign:"center",fontFamily:FU,fontSize:13,color:T.muted}}>No positions match these filters.</div>}
      </BentoTile>
    </>}

    {sub==="watchlist"&&<Watchlist live={live} watchlist={watchlist} onAdd={onAddWatch} onRemove={onRemoveWatch} onSetAlert={onSetAlert} onAlertPermission={onAlertPermission}/>}

    {sub==="activity"&&<ActivityPanel activities={activities} accounts={snapAccounts}/>}

    {sub==="tax"&&<TaxPlanner holdings={merged} activities={activities}/>}

    {sub==="zakat"&&<ZakatSadaqah accounts={snapAccounts}/>}

    {sub==="etfs"&&<BentoTile style={{padding:0,overflow:"hidden"}}>
      <Tbl cols={[
        {l:"Ticker",   r_:r=><span style={{fontFamily:FU,fontSize:14,fontWeight:600,color:T.textHi,letterSpacing:"-0.01em"}}>{r.tk}</span>},
        {l:"Name",     r_:r=><span style={{fontFamily:FU,fontSize:13,color:T.text}}>{r.nm}</span>},
        {l:"Category", r_:r=><Tag label={r.cat} color={r.cat==="Sukuk"?T.gold:r.cat==="Global"?T.gain:T.blue}/>},
        {l:"Expense",  r:true,r_:r=><span style={{fontFamily:FM,fontSize:11,color:T.muted,fontVariantNumeric:"tabular-nums"}}>{r.exp}</span>},
        {l:"Div. Yield",r:true,r_:r=><span style={{fontFamily:FM,fontSize:12,fontWeight:500,color:T.textHi,fontVariantNumeric:"tabular-nums"}}>{r.div}</span>},
        {l:"Frequency",r_:r=><span style={{fontFamily:FM,fontSize:10,color:T.muted}}>{r.freq}</span>},
        {l:"Min",      r_:r=><span style={{fontFamily:FM,fontSize:11,color:r.avail?T.gain:T.loss,fontVariantNumeric:"tabular-nums"}}>{r.min}</span>},
        {l:"Fidelity", r_:r=><Tag label={r.avail?"Available":"$2,500 Min"} color={r.avail?T.gain:T.muted}/>},
      ]} rows={ETF_LIST}/>
    </BentoTile>}

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
    const realRet=ret-inflation;
    for(let yr=0;yr<=Math.max(40,targetAge-age+5);yr++){
      out.push({year:age+yr,nominal:+bal.toFixed(0),real:+(bal/Math.pow(1+inflation,yr)).toFixed(0)});
      bal=bal*(1+ret)+monthly*12;
    }
    return out;
  },[currentNW,age,targetAge,monthly,ret,inflation]);

  const fireNumber=monthly*12*30; // assume desired annual spend ≈ current contribution * 12 (rough), 30x for 4% rule with margin
  // Better: ask user what their target annual spend is. For now derive from current NW * withdrawRate
  const targetSpend=Math.round(currentNW*0.04/12)*12||60_000;
  const fireTarget=targetSpend/withdrawRate;
  const yearAtTarget=projection.find(p=>p.nominal>=fireTarget);
  const balanceAtRetirement=projection.find(p=>p.year===targetAge);

  return<div className="mz-side-by-side" style={{display:"grid",gridTemplateColumns:"320px 1fr",gap:20}}>
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:18}}>
        <div style={{fontFamily:FM,fontSize:9,color:T.muted,letterSpacing:"0.14em",marginBottom:14}}>RETIREMENT PARAMETERS</div>
        {[
          {l:"Current Age",v:age,set:setAge,min:18,max:75,step:1,fmt:v=>v},
          {l:"Target Retirement Age",v:targetAge,set:setTargetAge,min:30,max:80,step:1,fmt:v=>v},
          {l:"Monthly Contribution",v:monthly,set:setMonthly,min:0,max:25000,step:250,fmt:v=>`$${v.toLocaleString()}`},
          {l:"Expected Annual Return",v:ret,set:setRet,min:0.02,max:0.15,step:0.005,fmt:v=>`${(v*100).toFixed(1)}%`},
          {l:"Inflation Assumption",v:inflation,set:setInflation,min:0,max:0.08,step:0.005,fmt:v=>`${(v*100).toFixed(1)}%`},
          {l:"Safe Withdrawal Rate",v:withdrawRate,set:setWithdrawRate,min:0.02,max:0.06,step:0.005,fmt:v=>`${(v*100).toFixed(1)}%`},
        ].map(s=><div key={s.l} style={{marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",fontFamily:FM,fontSize:10,marginBottom:5}}>
            <span style={{color:T.muted}}>{s.l}</span>
            <span style={{color:T.textHi,fontWeight:500}}>{s.fmt(s.v)}</span>
          </div>
          <input type="range" min={s.min} max={s.max} step={s.step} value={s.v} onChange={e=>s.set(+e.target.value)} style={{width:"100%",accentColor:T.blue,cursor:"pointer"}}/>
        </div>)}
        <div style={{marginTop:6,padding:"10px 12px",background:T.gainBg,border:`1px solid ${T.gain}25`,borderRadius:3}}>
          <div style={{fontFamily:FM,fontSize:9,color:T.muted,marginBottom:4}}>FIRE NUMBER</div>
          <div style={{fontFamily:FM,fontSize:18,fontWeight:500,color:T.gain}}>{kf(fireTarget)}</div>
          <div style={{fontFamily:FM,fontSize:9,color:T.muted,marginTop:3}}>To support {kf(targetSpend)} / yr at {(withdrawRate*100).toFixed(1)}%</div>
        </div>
      </div>
      <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:14}}>
        {[
          ["Years to FIRE",yearAtTarget?`${yearAtTarget.year-age} yrs`:"Not reached"],
          ["FIRE at age",yearAtTarget?yearAtTarget.year:"—"],
          ["Balance at target",balanceAtRetirement?kf(balanceAtRetirement.nominal):"—"],
          ["Today's $ at target",balanceAtRetirement?kf(balanceAtRetirement.real):"—"],
        ].map(([l,v])=><div key={l} style={{display:"flex",justifyContent:"space-between",padding:"7px 0",borderBottom:`1px solid ${T.border}`,fontFamily:FM,fontSize:11}}>
          <span style={{color:T.muted}}>{l}</span>
          <span style={{color:T.textHi}}>{v}</span>
        </div>)}
      </div>
    </div>

    <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:18}}>
      <div style={{fontFamily:FM,fontSize:9,color:T.muted,letterSpacing:"0.14em",marginBottom:8}}>NET WORTH PROJECTION (Nominal vs Inflation-Adjusted)</div>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={projection} margin={{top:10,right:14,bottom:8,left:14}}>
          <defs><linearGradient id="fireG" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={T.blue} stopOpacity={0.22}/><stop offset="95%" stopColor={T.blue} stopOpacity={0}/></linearGradient></defs>
          <CartesianGrid stroke={T.border} strokeDasharray="2 4" vertical={false}/>
          <XAxis dataKey="year" tick={{fontFamily:FM,fontSize:9,fill:T.muted}} axisLine={{stroke:T.border}} tickLine={false}/>
          <YAxis tickFormatter={v=>kf(v)} tick={{fontFamily:FM,fontSize:9,fill:T.muted}} axisLine={false} tickLine={false} width={60}/>
          <Tooltip
            formatter={(v,name)=>[kf(v),name==="nominal"?"Nominal":"Real (today's $)"]}
            contentStyle={{background:T.card,border:`1px solid ${T.borderHi}`,borderRadius:8,fontFamily:FM,fontSize:11}}
            itemStyle={{color:T.textHi}} labelStyle={{color:T.muted}}/>
          <Area type="monotone" dataKey="nominal" stroke={T.blue} strokeWidth={1.5} fill="url(#fireG)" dot={false}/>
          <Line type="monotone" dataKey="real" stroke={T.gold} strokeWidth={1.5} strokeDasharray="3 3" dot={false}/>
        </ComposedChart>
      </ResponsiveContainer>
      <div style={{display:"flex",gap:14,fontFamily:FM,fontSize:10,color:T.muted,marginTop:8}}>
        <span style={{display:"flex",alignItems:"center",gap:5}}><span style={{width:10,height:2,background:T.blue,display:"inline-block"}}/>Nominal balance</span>
        <span style={{display:"flex",alignItems:"center",gap:5}}><span style={{width:10,height:2,background:T.gold,display:"inline-block"}}/>Inflation-adjusted (today's $)</span>
      </div>
    </div>
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
    const totalRet=closed.reduce((s,t)=>s+(t.return||0),0);
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

function TradeBot({currentNW=0,ytdContrib=0,accounts=[],onOrderPlaced,activities=[]}){
  const[sub,setSub]=useState("order");
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
  useEffect(()=>{if(!acctId&&accounts[0])setAcctId(accounts[0].accountId);},[accounts]);

  // Step 1: preview the order via SnapTrade impact. Server returns
  // {impact: {trade: {id, ...estimated_fees, ...}}} — we surface in a modal.
  const submit=async()=>{
    if(orderBusy)return;
    setOrderErr(null);
    if(!acctId){setOrderErr("Select an account first.");return;}
    if(!sym||!qty){setOrderErr("Symbol and quantity are required.");return;}
    setOrderBusy(true);
    try{
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

    {sub==="order"&&impactPreview&&<OrderPreviewModal preview={impactPreview} onConfirm={placeOrder} onCancel={cancelPreview} busy={orderBusy} side={side} sym={sym} qty={qty}/>}
    {sub==="order"&&<div className="bento-row mz-side-by-side" style={{display:"grid",gridTemplateColumns:"360px 1fr",gap:T.s4}}>
      {/* ─── Order Ticket bento ────────────────────────── */}
      <BentoTile style={{display:"flex",flexDirection:"column",gap:T.s4}}>
        <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600}}>ORDER TICKET</div>
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
        <div>
          <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.14em",fontWeight:600,marginBottom:T.s1}}>ACCOUNT</div>
          <select value={acctId} onChange={e=>setAcctId(e.target.value)} className="field">
            {accounts.length===0?<option value="">No accounts connected</option>:accounts.map(a=><option key={a.accountId} value={a.accountId}>{a.brokerage} — {a.accountName} ({kf(a.balance||0)})</option>)}
          </select>
        </div>
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
        <button onClick={submit} disabled={orderBusy||!acctId} style={{
          padding:`12px ${T.s4}`,borderRadius:T.rMd,
          fontFamily:FU,fontSize:13,fontWeight:600,letterSpacing:"-0.005em",
          border:"none",cursor:orderBusy||!acctId?"not-allowed":"pointer",
          background:done?`${T.gain}22`:orderBusy?T.dim:`linear-gradient(135deg, ${side==="buy"?T.gain:T.loss}, ${side==="buy"?"#0A8A65":"#D85555"})`,
          color:done?T.gain:orderBusy?T.muted:"#fff",
          transition:"all 0.2s",
          boxShadow:done||orderBusy?"none":`0 4px 14px ${(side==="buy"?T.gain:T.loss)}55`,
        }}>
          {done?"Order Placed ✓":orderBusy?"Loading…":`Preview ${side==="buy"?"Buy":"Sell"} ${sym}`}
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
    setMsgs(m=>[...m,{role:"user",text:q}]);
    setInput("");setBusy(true);
    try{
      const sys=`You are MIZAN's Sharia-aware personal finance advisor. Use AAOIFI screening rules. Be specific, numeric, and concise (under 150 words unless asked). Use the portfolio summary below to answer.\n\n${context}`;
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
function ManualAssets(){
  const[assets,setAssets]=useState(()=>{try{return JSON.parse(localStorage.getItem("mizan_manual_assets")||"[]");}catch{return[];}});
  const[form,setForm]=useState({type:"Gold",name:"",value:"",zakatable:true,notes:""});

  const persist=arr=>{setAssets(arr);try{localStorage.setItem("mizan_manual_assets",JSON.stringify(arr));}catch{}persistUserState("mizan_manual_assets",arr);};
  const add=(e)=>{
    e.preventDefault();
    if(!form.name||!form.value)return;
    const next=[...assets,{...form,value:+form.value,id:`m-${Date.now()}`,added:new Date().toISOString().slice(0,10)}];
    persist(next);
    setForm({type:"Gold",name:"",value:"",zakatable:true,notes:""});
  };
  const remove=id=>persist(assets.filter(a=>a.id!==id));
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
      <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.16em",fontWeight:600,marginBottom:T.s3}}>ADD AN ASSET</div>
      <form onSubmit={add} className="mz-form-row" style={{display:"grid",gridTemplateColumns:"150px 1fr 140px auto auto",gap:T.s2,alignItems:"center"}}>
        <select value={form.type} onChange={e=>setForm({...form,type:e.target.value})} className="field" style={{cursor:"pointer"}}>
          {["Gold","Silver","Real Estate","Investment Property","Business Equity","Vehicle","Collectible","Other"].map(t=><option key={t}>{t}</option>)}
        </select>
        <input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Description (e.g. Wedding gold, Primary home equity)" className="field"/>
        <input type="number" value={form.value} onChange={e=>setForm({...form,value:e.target.value})} placeholder="Value $" className="field" style={{fontVariantNumeric:"tabular-nums"}}/>
        <label style={{fontFamily:FM,fontSize:11,fontWeight:500,color:T.muted,display:"flex",alignItems:"center",gap:T.s1,cursor:"pointer",letterSpacing:"0.04em",whiteSpace:"nowrap"}}>
          <input type="checkbox" checked={form.zakatable} onChange={e=>setForm({...form,zakatable:e.target.checked})} style={{accentColor:T.gold,width:14,height:14}}/>
          Zakat
        </label>
        <button type="submit" className="btn-primary">+ Add</button>
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
          {l:"",r_:r=><button onClick={()=>remove(r.id)} style={{padding:`3px ${T.s2}`,borderRadius:T.rSm,background:"transparent",border:`1px solid ${T.loss}30`,color:T.loss,cursor:"pointer",fontFamily:FM,fontSize:11}}>✕</button>},
        ]} rows={assets}/>
      </BentoTile>
      :<BentoTile style={{padding:`${T.s8} ${T.s5}`,textAlign:"center",borderStyle:"dashed"}}>
        <div style={{fontFamily:FU,fontSize:14,fontWeight:500,color:T.muted}}>No manual assets yet.</div>
        <div style={{fontFamily:FU,fontSize:12,color:T.muted,marginTop:T.s1}}>Add gold, real estate, or business equity above to include them in net-worth + Zakat math.</div>
      </BentoTile>}
  </div>;
}

/* ─── CSV IMPORTER ───────────────────────────────────── */
function CSVImporter({onImport,onDedupe}){
  const[broker,setBroker]=useState("Fidelity");
  const[status,setStatus]=useState(null);
  const[busy,setBusy]=useState(false);
  const[dedupeBusy,setDedupeBusy]=useState(false);
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

  const handle=async e=>{
    const file=e.target.files?.[0];
    if(!file||!onImport)return;
    setBusy(true);setStatus(null);
    try{
      const r=await onImport(file,broker);
      // Backwards-compat: importCSV used to resolve with a row count. It
      // now resolves with {added,skipped,total}. Handle both shapes.
      if(typeof r==="number"){
        setStatus({ok:true,msg:`Imported ${r} rows from ${file.name}`});
      }else if(r.added===0&&r.skipped>0){
        setStatus({ok:true,msg:`No new rows — all ${r.skipped} entries in ${file.name} are already imported.`});
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
  </div>;
}

function Settings({apiKeys,setApiKeys,onConnect,onImportCSV,onDedupeCSV,demoMode,onToggleDemo,documents=[],accounts=[]}){
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
          ?<button onClick={async()=>{if(confirm("Sign out of MIZAN?"))await signOut();}} className="btn-danger">Sign out</button>
          :<span style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.08em"}}>Set VITE_SUPABASE_URL to enable accounts</span>}
      </div>
    </BentoTile>

    <TabBar
      tabs={[
        ...(isRoot?[["keys","API Keys"]]:[]),
        ["brokers","Connect Accounts"],
        ["security","Security"],
        ["assets","Manual Assets"],
        ["docs","Documents"],
      ]}
      active={sub}
      onChange={setSub}
    />

    {sub==="assets"&&<ManualAssets/>}

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
      <CSVImporter onImport={onImportCSV} onDedupe={onDedupeCSV}/>

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

    {sub==="security"&&<SecurityPanel/>}
    {sub==="docs"&&<DocumentsPanel documents={documents} accounts={accounts}/>}
  </div>;
}

/* ─── CONNECT MODAL ──────────────────────────────────── */
function ConnectModal({onClose,snapId}){
  const [step, setStep] = useState("select");
  const [sel,  setSel]  = useState(null);
  const [url,  setUrl]  = useState("");
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
      } else if (d.status === "ERROR") {
        setStep("error");
      } else if (d==="CLOSED" || d==="CLOSE_MODAL" || d==="ABANDONED") {
        setStep("select"); setUrl("");
      }
    };
    window.addEventListener("message", h, false);
    return () => window.removeEventListener("message", h, false);
  }, [sel, conn]);

  const connect = b => {
    if (!snapId || snapId.length < 6) { setStep("nokeys"); return; }
    setSel(b);
    setStep("loading");
    apiFetch("/api/snaptrade/login", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({broker: b.id, connectionType: "read"})
    })
    .then(r => r.json())
    .then(d => {
      if (d.loginLink) { setUrl(d.loginLink); setStep("iframe"); }
      else { setStep("noserver"); }
    })
    .catch(() => setStep("noserver"));
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

  return <div style={{display:"flex",flexDirection:"column",gap:28,maxWidth:1080,margin:"0 auto",paddingBottom:40}}>
    {/* HERO */}
    <div style={{textAlign:"center",padding:"32px 0 8px"}}>
      <div style={{display:"inline-flex",alignItems:"center",justifyContent:"center",gap:14,marginBottom:18}}>
        <svg width={42} height={42} viewBox="0 0 16 16" fill="none">
          <defs><linearGradient id="abLg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor={T.blue}/><stop offset="100%" stopColor={T.gold}/></linearGradient></defs>
          <path d="M8 1L15 7L8 13L1 7Z" stroke="url(#abLg)" strokeWidth={1.2} fill="none"/>
          <circle cx="8" cy="7" r="1.8" fill={T.blue} opacity={0.9}/>
        </svg>
        <span style={{fontFamily:FM,fontSize:36,fontWeight:600,color:T.textHi,letterSpacing:"0.16em"}}>MĪZAN</span>
      </div>
      <div style={{fontFamily:FU,fontSize:20,color:T.text,lineHeight:1.55,maxWidth:680,margin:"0 auto 6px",fontWeight:400}}>
        The Shariah-compliant financial super-app.
      </div>
      <div style={{fontFamily:FU,fontSize:14,color:T.muted,lineHeight:1.65,maxWidth:640,margin:"0 auto"}}>
        Brokerages, banking, trading, and AI insights — unified, halal-screened, in one place.
      </div>
    </div>

    {/* 4 FEATURE CARDS — equal-height 2×2 */}
    <div className="mz-grid-2" style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:14}}>
      {sections.map(s=><div key={s.t} style={{
        background:T.card, border:`1px solid ${T.border}`, borderRadius:14,
        padding:"24px 26px", boxShadow:T.shadow, display:"flex", flexDirection:"column",
        position:"relative", overflow:"hidden",
      }}>
        <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:`linear-gradient(90deg, ${s.accent}, transparent)`}}/>
        <div style={{display:"flex",alignItems:"baseline",gap:12,marginBottom:10}}>
          <span style={{fontSize:22}}>{s.icon}</span>
          <span style={{fontFamily:FM,fontSize:14,fontWeight:600,color:T.textHi,letterSpacing:"0.06em"}}>{s.t.toUpperCase()}</span>
        </div>
        <div style={{fontFamily:FU,fontSize:13.5,color:T.text,lineHeight:1.65,flex:1}}>{s.d}</div>
      </div>)}
    </div>

    {/* SHARIAH FOUNDATIONS */}
    <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:"28px 30px",boxShadow:T.shadow}}>
      <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",marginBottom:6,flexWrap:"wrap",gap:8}}>
        <div style={{fontFamily:FM,fontSize:11,color:T.gold,letterSpacing:"0.18em",fontWeight:600}}>SHARIAH FOUNDATIONS</div>
        <div style={{fontFamily:FM,fontSize:10,color:T.muted,letterSpacing:"0.08em"}}>{standards.length} STANDARDS</div>
      </div>
      <div style={{fontFamily:FU,fontSize:14,color:T.muted,lineHeight:1.65,maxWidth:760,marginBottom:20}}>
        Built around six Islamic finance principles. Not annotations on a generic finance app — they shape what's displayed, what's allowed at the order layer, and how AI recommendations are generated.
      </div>
      <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:22}}>
        {standards.map(s=><span key={s} style={{padding:"4px 10px",background:`${T.gold}12`,border:`1px solid ${T.gold}30`,borderRadius:6,fontFamily:FM,fontSize:10,color:T.gold,letterSpacing:"0.04em"}}>{s}</span>)}
      </div>
      <div className="mz-grid-3" style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
        {principles.map(([k,v])=><div key={k} style={{padding:"14px 16px",background:T.surface,borderRadius:10,border:`1px solid ${T.border}`,minHeight:120}}>
          <div style={{fontFamily:FM,fontSize:12,fontWeight:600,color:T.gold,letterSpacing:"0.04em",marginBottom:6}}>{k}</div>
          <div style={{fontFamily:FU,fontSize:12,color:T.muted,lineHeight:1.55}}>{v}</div>
        </div>)}
      </div>
    </div>

    {/* INTEGRATIONS */}
    <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:"28px 30px",boxShadow:T.shadow}}>
      <div style={{fontFamily:FM,fontSize:11,color:T.blue,letterSpacing:"0.18em",fontWeight:600,marginBottom:18}}>DATA & INTEGRATIONS</div>
      <div className="mz-grid-5" style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:12}}>
        {integrations.map(i=><div key={i.n} style={{padding:"14px 16px",background:T.surface,borderRadius:10,border:`1px solid ${T.border}`,position:"relative",overflow:"hidden"}}>
          <div style={{position:"absolute",top:0,left:0,bottom:0,width:3,background:i.c}}/>
          <div style={{fontFamily:FM,fontSize:13,fontWeight:600,color:T.textHi,marginBottom:4,marginLeft:6}}>{i.n}</div>
          <div style={{fontFamily:FM,fontSize:10,color:T.muted,marginLeft:6}}>{i.d}</div>
        </div>)}
      </div>
    </div>

    {/* DISCLAIMER */}
    <div style={{textAlign:"center",fontFamily:FM,fontSize:9,color:T.muted,letterSpacing:"0.14em",padding:"8px 0 24px",lineHeight:1.8}}>
      MĪZAN · NOT FINANCIAL OR RELIGIOUS ADVICE<br/>
      CONSULT A QUALIFIED SCHOLAR FOR PERSONAL JURISPRUDENCE
    </div>
  </div>;
}

export default function Mizan(){
  // Scope cross-tab broadcasts to the authenticated user so a separate tab
  // signed in as a different user can't receive (or send) state intended
  // for this one. Falls back to "anon" in single-user pass-through mode.
  const{user:authUser}=useAuth();
  const bcastChannelName="mizan:"+(authUser?.id||"anon");
  // Persist active tab per-device so a reload lands you where you left off.
  // Per-device, not per-user — different devices may want different defaults.
  const[nav,setNavState]=useState(()=>{
    try{
      const v=localStorage.getItem("mizan_nav");
      // Guard against a stale value that no longer maps to a real tab.
      const valid=new Set(["overview","portfolio","trade","advisor","settings","about"]);
      return v&&valid.has(v)?v:"overview";
    }catch{return"overview";}
  });
  const setNav=v=>{setNavState(v);try{localStorage.setItem("mizan_nav",v);}catch{}};
  const[live,setLive]=useState(()=>{try{return JSON.parse(localStorage.getItem("mizan_live_cache")||"[]");}catch{return[];}});
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
      }
    }catch{/* backend down — ignore */}
    try{
      const r2=await apiFetch("/api/snaptrade/activities");
      if(r2.ok){
        const d2=await r2.json();
        const real=Array.isArray(d2.activities)?d2.activities:[];
        // SnapTrade real first so any CSV import row that fingerprint-matches
        // a real transaction is dropped (the broker is the source of truth).
        persistActivities(dedupeActivities([...real,...imported]).sort((a,b)=>(b.trade_date||"").localeCompare(a.trade_date||"")));
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
  // Lenient on purpose. Two CSV exports of the same Robinhood trade can
  // differ in:
  //   - broker label ("Robinhood" vs "ROBINHOOD") — dropped
  //   - transaction type ("Buy" vs "BTOO" vs "BUY") — dropped (Robinhood
  //     has churned trans-code formats over the years)
  //   - price precision ($150.234 vs $150.23) — dropped (less stable than
  //     amount, which is rounded to cents at the broker)
  // Kept:
  //   - date (YYYY-MM-DD)            — required
  //   - symbol (uppercased, trimmed) — required
  //   - units, signed, 2 dp          — preserves direction
  //   - amount, signed, 2 dp         — preserves direction (so a BUY and
  //                                    SELL of the same lot don't collapse)
  const fingerprintRow=r=>{
    const n=v=>{
      const f=parseFloat(v);
      return Number.isFinite(f)?f.toFixed(2):"";
    };
    const sym=r.symbol?.symbol||r.symbol||"";
    return[
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

  const NAV=[{id:"overview",l:"Overview"},{id:"portfolio",l:"Portfolio"},{id:"trade",l:"Trade & Bot"},{id:"advisor",l:"AI Advisor"},{id:"settings",l:"Settings"},{id:"about",l:"About"}];

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
      .mz-tabbar { scrollbar-width: none; -ms-overflow-style: none; }
      .mz-tabbar::-webkit-scrollbar { display: none; }

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
        {nav==="overview"  &&<Overview  live={live} snapAccounts={visibleAccounts} allAccounts={snapAccounts} disabledAccts={disabledAccts} onToggleAcct={toggleAcctEnabled} onDisconnectAcct={disconnectAccount} mapPosition={mapPosition} metrics={performanceMetrics} activities={snapActivities} netWorthHistory={(()=>{try{return JSON.parse(localStorage.getItem("mizan_networth_history")||"[]");}catch{return[];}})()} onNav={setNav} onConnect={()=>setConn(true)} onToggleDemoFromBanner={toggleDemo}/>}
        {nav==="portfolio" &&<Portfolio live={live} snapAccounts={visibleAccounts} mapPosition={mapPosition} activities={snapActivities} documents={snapDocuments} watchlist={watchlist} onAddWatch={addToWatchlist} onRemoveWatch={removeFromWatchlist} onSetAlert={setAlert} onAlertPermission={requestAlertPermission}/>}
        {nav==="trade"     &&<TradeBot currentNW={visibleAccounts.reduce((s,a)=>s+(a.balance||0),0)} ytdContrib={performanceMetrics.ytdContrib||0} accounts={visibleAccounts} activities={snapActivities} onOrderPlaced={fetchSnapHoldings}/>}
        {nav==="advisor"   &&<AIAdvisor accounts={visibleAccounts} activities={snapActivities} metrics={performanceMetrics} hasKey={true}/>}
        {nav==="settings"  &&<Settings  apiKeys={apiKeys} setApiKeys={setApiKeys} onConnect={()=>setConn(true)} onImportCSV={importCSV} onDedupeCSV={dedupeImports} demoMode={demoMode} onToggleDemo={toggleDemo} documents={snapDocuments} accounts={visibleAccounts}/>}
        {nav==="about"     &&<About/>}
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

    {showConn&&<ConnectModal onClose={()=>setConn(false)} snapId={apiKeys.snapId}/>}
  </div>;
}
