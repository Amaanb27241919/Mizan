# OpenBB Platform — Integration Due Diligence

**Subject:** Replacing/supplementing Finnhub as the fundamentals source for Sharia screening (`lib/sharia.mjs`)
**Assessed:** 2026-07-30 · **Method:** source review of `OpenBB-finance/OpenBB` @ shallow clone, plus a stub-server integration test
**Status:** ⛔ **NOT APPROVED FOR PRODUCTION.** Prototype merged dormant. Promotion blocked on Gate 1–3 below.
**Assessed by:** engineering (Claude) · **Decision owner:** Amaan

---

## 0. Executive summary

OpenBB is **not a data source**. It is an open-source *aggregation and normalization layer* that fronts 33 third-party providers behind one API. Adopting it does not get Mizan better data by itself — it gets Mizan a **provider-independent seam**, and the data quality is entirely determined by which upstream provider is selected underneath.

**The original case for adopting it was overstated, and this review corrects it.** The claim was "OpenBB returns a normalized balance sheet, so the brittle per-filer concept matching disappears." Reading the source shows the standard `BalanceSheetData` model declares **only three fields** (`period_ending`, `fiscal_period`, `fiscal_year`). Every actual line item — assets, debt, cash — is declared per provider, and the base `Data` class sets `extra="allow"`, so providers pass through whatever they have. **Normalization is per-provider, not global.**

The case survives that correction, but in a narrower form:

| | Finnhub (today) | OpenBB + `sec` |
|---|---|---|
| Debt source | `debt/equity ratio × book equity`, with a raw-concept fallback | Declared balance-sheet fields |
| Field naming varies by | **Every filer** (unbounded) | Provider + OpenBB version (finite, ~4 shapes) |
| Coverage of foreign/IFRS filers | Weak (`bsConcept` prefix matching) | Not covered — `sec` is US filers only |
| Upstream licensing | Finnhub ToS | **Public domain** (SEC EDGAR) |
| Cost | Free tier, 60 req/min | Free, no key |

**Real, defensible benefits:** authoritative public-domain source data; an explicit schema you can pin and test; a provider seam that makes future swaps a config change; removal of the ratio×equity reconstruction.

**Real costs:** a second runtime (Python) to host, secure, monitor and back up; an unbounded new dependency tree; AGPLv3 obligations; and a per-provider field-mapping burden that is *smaller* than today's but **not zero**.

**Finding that most affects the decision:** this review found **three defects in our own prototype**, two of which would have produced wrong Sharia verdicts in production (§4.3). They were found only by reading provider source. That is the single strongest argument for doing this as a gated project rather than a swap.

---

## 1. Where the data actually comes from

OpenBB ships **33 provider extensions**. Each is a thin client against a third party's API. OpenBB stores no data and operates no data collection of its own.

Only **four** implement the balance sheet Mizan needs:

| Provider | Key required | Upstream | Declared BS fields | Licensing posture for a commercial app |
|---|---|---|---|---|
| **`sec`** | **No** | SEC EDGAR company facts (XBRL) | **120** | ✅ **Public domain.** No restriction. |
| `yfinance` | No | Yahoo Finance (unofficial/scraped) | **6** (alias map only) | ⚠️ **Yahoo ToS restricts commercial use.** Unofficial client. |
| `fmp` | Yes (paid) | Financial Modeling Prep | 64 | Commercial licence; per-tier limits |
| `intrinio` | Yes (paid) | Intrinio | 98 | Commercial licence; expensive |

**`sec` is the only option that is simultaneously free, authoritative, and licence-clean for a commercial product.** That combination is the actual prize here — not "normalization."

**yfinance should be disqualified for Mizan** on two independent grounds: (1) Yahoo's terms restrict commercial redistribution, and Mizan has commercial ambition; (2) its model declares essentially nothing and relies on dynamic passthrough, so field presence is not guaranteed per symbol — unacceptable for a compliance verdict. The prototype's default was changed from `yfinance` to `sec` as a result of this review.

**`sec`'s hard limit: US filers only.** Mizan holds ADRs and foreign issuers (TSM, BABA, SHOP). Those return nothing from `sec`. This is why the adapter is built as a **coverage union** (OpenBB primary → Finnhub fallback) rather than a swap — Finnhub keeps serving what `sec` cannot.

---

## 2. Plumbing — how a request flows

```
Mizan handler (Node/Vercel)
  └── HTTPS  GET {OPENBB_API_BASE}/api/v1/equity/fundamental/balance?symbol=X&provider=sec
        └── FastAPI/Uvicorn  (openbb-api, default :6900)
              └── CORS middleware  ← default allow_origins ["*"]
              └── auth_hook        ← HTTP Basic, DEFAULT OFF
              └── command router   → standard model → provider model
                    └── aiohttp → https://data.sec.gov/...
              └── response envelope { results: [...], provider, warnings, chart, extra }
```

Verified specifics:
- **Path prefix** is `/api/v{version}` (computed property, `api_settings.py:47`) → `/api/v1/...`
- **Envelope** is `{ results: [...] }`; the adapter normalizes both array and single-object forms
- **No built-in response cache.** `provider/utils/` has an LRU helper and a custom `aiohttp` session, but there is no durable query cache. **Every screen is a live upstream call unless Mizan caches** — Mizan's existing per-day `_cache` in `sharia.mjs` therefore remains load-bearing, not optional.

---

## 3. Security assessment

Reviewed against the defaults an operator gets from `pip install openbb && openbb-api`.

| # | Finding | Severity | Evidence | Required control |
|---|---|---|---|---|
| S1 | **API auth is DISABLED by default.** `OPENBB_API_AUTH` defaults to `False`; when off, `security = lambda: None` and the auth hook's check is skipped entirely. | 🔴 **Critical** | `core/openbb_core/env.py:22-24`, `api/auth/user.py:12-20` | Never bind to a public interface without `OPENBB_API_AUTH=true`. Prefer private networking so the service has no public route at all. |
| S2 | **CORS defaults to `allow_origins: ["*"]`, `allow_methods: ["*"]`.** | 🟠 High | `app/model/api_settings.py:11-12` | Set explicit origins, or keep the service non-browser-reachable. |
| S3 | **Auth, when enabled, is HTTP Basic with a single shared username/password from env.** No per-client keys, no rotation, no revocation. | 🟠 High | `api/auth/user.py` | Treat as a shared secret: TLS-only, private network, rotate on any personnel change. Do not treat as multi-tenant. |
| S4 | **Provider API keys are stored in plaintext JSON** at `~/.openbb_platform/user_settings.json`. | 🟠 High | `app/constants.py:5-8`, `service/user_service.py:45-49` | Inject via env vars instead; never bake into an image; restrict filesystem perms. Moot if using `sec` (no key). |
| S5 | **The `sec` provider ships placeholder User-Agent strings** (`"my real company name definitelynot@fakecompany.com"`). SEC fair-access policy requires a genuine identifying UA and can block non-compliant traffic. | 🟡 Medium | `providers/sec/openbb_sec/utils/definitions.py:10,18`, `form4.py:9` | Override with a real Mizan contact string before any `sec` traffic. **Blocks Gate 2.** |
| S6 | **Large, unaudited transitive dependency tree.** ~30 first-party packages plus aiohttp/pandas/pydantic and each provider's deps. New supply-chain surface. | 🟡 Medium | `openbb_platform/pyproject.toml` | Install only needed extras (`openbb-core`, `openbb-sec`, `openbb-platform-api`) — **not `openbb[all]`**. Pin versions, lockfile, `pip-audit` in CI. |
| S7 | **SSRF/egress:** the service makes outbound calls to third parties by design. | 🟢 Low | by design | Egress allowlist to `data.sec.gov`; no inbound user-controlled URLs. |

**Net posture:** acceptable **only** as an internal service on a private network with auth on, running a minimal extra set, with keys injected by env. It is not safe to expose publicly with defaults.

**Mizan-specific note:** no PII, holdings, or user identifiers are ever sent — the adapter transmits a **ticker symbol only**. That materially limits blast radius: a compromise of this service leaks no user data. It could, however, **return falsified fundamentals**, which would corrupt Sharia verdicts. Integrity, not confidentiality, is the threat model here.

---

## 4. Design impact on Mizan

### 4.1 What was built (dormant)
- `screenViaOpenBB()` + pure `normalizeOpenBBFundamentals()` in `lib/sharia.mjs`
- Precedence Zoya > OpenBB > Finnhub via `activeShariaProvider()`; **gated on `OPENBB_API_BASE`** — unset ⇒ behavior identical to today
- Any OpenBB failure falls back to Finnhub (**coverage union**, not a swap)
- 8s abort timeout so a hung backend cannot pin a Vercel invocation open
- 13 unit tests; 344/344 suite green; build green

### 4.2 Blast radius if this goes wrong
`h.sh_` flows from this one verdict into the **Screener tab, Overview compliance counts, Rebalancer halal mode, Purification, and trading pre-checks**. A mapping error does not degrade gracefully — it silently relabels holdings. The worst outcome is a **false halal** (understated debt), because a user acts on it and it is religiously consequential. Every design decision below optimizes against that specific direction.

### 4.3 Defects this review found in our own prototype

All three were introduced by reasoning from assumed field names, and all were caught only by reading provider source.

| Defect | Impact | Status |
|---|---|---|
| Used `Authorization: Bearer` | Auth would fail against Basic-auth deployments | ✅ Fixed |
| Missed `sec`'s `cash_and_equivalents` spelling (assumed `cash_and_cash_equivalents`) | Cash reads **0** → cash screen silently passes at 0.0% | ✅ Fixed + test |
| Debt sum omitted `current_portion_of_long_term_debt` — `sec`'s `long_term_debt` is *noncurrent only* | **Understates debt → false halal.** In the regression test: 33.3% (fails AAOIFI) → 23.3% (passes). | ✅ Fixed + test |

**This is the core lesson of the assessment.** Two of three defects produced wrong compliance verdicts, silently, with no error surfaced. Any provider added later must go through the same source-level field audit.

### 4.4 Unresolved *domain* question (not a data question)
`sec`'s `long_term_debt` **excludes lease obligations**. Whether capitalized/finance leases count toward the AAOIFI debt ratio is a **scholarly** question. It shifts every ratio and it is not something engineering should decide. **Requires a qualified scholar's ruling before `sec` is promoted.**

---

## 5. Operations, availability, backups

**Backups:** there is genuinely **nothing to back up in OpenBB** — it is stateless, holds no Mizan data, and stores only a config file. DR = redeploy the container. The config (`user_settings.json` / env) is the only state, and it belongs in the secret manager, versioned with the rest of Mizan's config.

**What that means:** the "backup" question reframes as an **availability + integrity** question:

| Concern | Assessment | Control |
|---|---|---|
| Service down | Adapter throws → **falls back to Finnhub** → screening continues | Already built. Verified in the stub test (404 → Finnhub). |
| Service hangs | Would pin a Vercel invocation | 8s `AbortController` timeout. Already built. |
| Silent bad data | **The real risk.** No error, wrong verdict. | Diff harness + `debtSource` telemetry + Gate 3 canary. |
| Upstream (SEC) blocks us | All `sec` screens fail → Finnhub fallback | Real User-Agent (S5); respect SEC ~10 req/s. |
| Cost | Hosting only (~$5–10/mo Fly/Railway). `sec` has no data cost. | Cannot fit Vercel serverless — Python + heavy deps + cold start. |
| Monitoring | Not yet wired | Add to `lib/anomaly.mjs` `DATA_FEEDS` — the existing detector for "an upstream source dying quietly". Also alert on **fallback rate**, not just hard failure. |

**Recommended topology:** OpenBB on Fly/Railway, **private networking only**, auth on, minimal extras, env-injected config, `sec` provider, real UA, monitored via the existing `DATA_FEEDS` detector.

---

## 6. Legal / licensing

- **AGPLv3**, and the LICENSE asserts it covers *"All files in this repository."* Copyright OpenBB Inc., 2021–2025.
- Running **unmodified** OpenBB as a **separate service** that Mizan calls over HTTP is the standard arm's-length pattern: Mizan's own source is not a derivative work.
- **The moment you fork or patch it**, AGPL §13 obliges you to offer that modified source to users interacting with it over a network.
- **This directly constrains S5's fix.** Overriding the SEC User-Agent must be done via **configuration/env**, not by editing provider source — editing it creates a modified AGPL work. *Confirm the override is exposed as config; if it is not, that is a promotion blocker and needs counsel.*
- Upstream **data** licensing is separate from OpenBB's code licence: SEC EDGAR is public domain ✅; Yahoo/yfinance is restricted ⚠️ (a further reason `yfinance` is disqualified).

**Not legal advice.** Before Mizan takes revenue, have counsel confirm the arm's-length reading and the UA-override approach.

---

## 7. Risk register

| ID | Risk | Sev | Likelihood | Mitigation | Residual |
|---|---|---|---|---|---|
| R1 | Field-mapping error → **false halal** | 🔴 Critical | Medium (3 found already) | Source-level field audit per provider; fail-closed `null` debt; diff harness; Gate 3 canary | Medium |
| R2 | Public exposure with default auth off | 🔴 Critical | Low | Private networking + `OPENBB_API_AUTH=true` | Low |
| R3 | Lease-obligation treatment unresolved | 🟠 High | High | **Scholar ruling required** | Open |
| R4 | `sec` has no foreign/ADR coverage | 🟠 High | Certain | Finnhub fallback (built) | Low |
| R5 | AGPL obligations triggered by patching | 🟠 High | Medium | Config-only changes; counsel review | Low |
| R6 | Supply-chain compromise in dep tree | 🟡 Med | Low | Minimal extras, pinned, `pip-audit` | Low |
| R7 | Second runtime to operate (Python) | 🟡 Med | Certain | Container + existing monitoring | Medium |
| R8 | SEC blocks placeholder UA | 🟡 Med | Medium | Real UA before any traffic | Low |
| R9 | Upstream schema drift on OpenBB upgrade | 🟡 Med | Medium | Pin version; re-run diff harness on every bump | Low |

---

## 8. Phased plan with go/no-go gates

**Phase 0 — Prototype** ✅ *complete.* Dormant adapter, 13 tests, harness, stub-verified, this document.

**Gate 1 — Provider decision (owner + scholar).**
- [ ] Confirm `sec` as provider (accepting US-only + Finnhub fallback)
- [ ] **Scholar ruling on lease obligations** (R3)
- [ ] Confirm SEC User-Agent is overridable via config, not a source patch (R5/S5)
- [ ] Counsel sign-off on the AGPL arm's-length reading if commercial

**Gate 2 — Staging deployment.**
- [ ] Fly/Railway, private networking, `OPENBB_API_AUTH=true`, minimal extras, real UA
- [ ] `pip-audit` clean; versions pinned
- [ ] Wire into `lib/anomaly.mjs` `DATA_FEEDS`

**Gate 3 — Evidence (the real gate).**
- [ ] Run `scripts/screen-provider-diff.mjs` across **every ticker actually held by a live user**, not just the sample basket
- [ ] **Explain every FLIP (halal⇄haram) individually.** Do not promote on "mostly agrees."
- [ ] Confirm GAIN > LOSS (OpenBB verifies debt where Finnhub could not, more than the reverse)
- [ ] Manually reconcile 3 verdicts against the actual 10-K

**Gate 4 — Controlled rollout.** Owner account only → beta cohort → all users. `debtSource` + provider recorded on every verdict for auditability. Instant rollback = unset `OPENBB_API_BASE`.

---

## 9. Decisions required from the owner

1. **Proceed past Gate 1 at all?** The honest framing: this buys *authoritative, licence-clean, schema-explicit* fundamentals and a provider seam, at the cost of operating a second runtime. It does **not** buy foreign-issuer coverage, and it does **not** eliminate field mapping.
2. **Scholar consult on lease obligations** (R3) — blocks `sec`, and is a domain call, not an engineering one.
3. **Hosting + budget** (~$5–10/mo) and who operates it.
4. **Is Mizan commercial?** Determines how hard the AGPL and Yahoo-ToS questions bite.

**Engineering recommendation:** proceed to **Gate 1 only**, and do not schedule Gate 2 until the scholar question (R3) is answered — it can invalidate the provider choice, and staging work done before it may be wasted. If the answer is "leases count as debt," `sec`'s exclusion of them becomes a correctness problem that may favour paid FMP instead.

---

## Appendix — verification method

Reviewed from source, not documentation:

| Claim | Evidence |
|---|---|
| Standard model declares only period fields | `core/openbb_core/provider/standard_models/balance_sheet.py` (37 lines) |
| Providers pass through extras | `provider/abstract/data.py:77-79` — `extra="allow"` |
| Only 4 providers implement BS | `find providers/*/…/models/balance_sheet.py` |
| Field counts 64/120/98/6 | per-provider field grep |
| `total_debt` only on `fmp` | cross-provider grep |
| `sec` long_term_debt is noncurrent, excludes leases | field description, `providers/sec/.../balance_sheet.py` |
| Auth off by default | `env.py:22-24`, `api/auth/user.py:12` |
| CORS `*` | `app/model/api_settings.py:11-12` |
| Keys in plaintext | `app/constants.py:5-8`, `user_service.py:45-49` |
| Placeholder SEC UA | `providers/sec/.../definitions.py:10,18` |
| AGPLv3 all files | `LICENSE` |

**Not verified — open items:** live `yfinance` field availability per symbol; whether `openbb-api` has request rate limiting; a full CVE audit of the dependency tree; live-data accuracy (that is Gate 3's job).
