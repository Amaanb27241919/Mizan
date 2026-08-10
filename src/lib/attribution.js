/**
 * MĪZAN — signup attribution (pure, no I/O).
 *
 * BACKLOG G2. The Admin ACTIVATION FUNNEL already measures signups → connected
 * → returned, but nothing recorded where any of those people came from. Post to
 * Instagram and the tile ticks up with no way to know whether Instagram did it.
 *
 * FIRST-TOUCH, not last-touch. The question being answered is "what introduced
 * this person to Mizan", so the first recorded visit wins and later visits never
 * overwrite it. Someone who arrives from a post, leaves, and returns via Google
 * a week later to sign up was still brought in by the post.
 *
 * ATTRIBUTION CANNOT BE BACKFILLED — a signup that arrives before this is wired
 * up is unattributable forever. That is why it had to land before the first
 * campaign, not after it.
 *
 * PRIVACY: never store a full referring URL. Query strings on a referrer can
 * carry search terms, session ids, or personal data. Only the hostname is read,
 * and it is immediately reduced to a short token from a known list (or the bare
 * hostname). Nothing here is shown to the user; it exists for one operator
 * counting where signups come from.
 */

/** Longest value we keep. Anything longer is junk or an injection attempt. */
export const MAX_FIELD_LEN = 48;

/**
 * localStorage key holding the first touch until the visitor has an account.
 * Deliberately NOT a synced TRACKED_KEY (src/lib/userState.js): the server copy
 * is written once and made immutable by /api/user/attribution, so syncing this
 * would let a second device's "direct" visit race the real origin.
 */
export const ATTRIBUTION_KEY = "mizan_attribution";

// Referrer hostnames → the channel name the funnel groups by. Suffix-matched,
// so `m.facebook.com` and `l.instagram.com` fold into their parents.
const HOST_CHANNELS = [
  ["instagram.com", "instagram"],
  ["facebook.com", "facebook"],
  ["fb.me", "facebook"],
  ["twitter.com", "x"],
  ["x.com", "x"],
  ["t.co", "x"],
  ["tiktok.com", "tiktok"],
  ["linkedin.com", "linkedin"],
  ["lnkd.in", "linkedin"],
  ["youtube.com", "youtube"],
  ["youtu.be", "youtube"],
  ["reddit.com", "reddit"],
  ["whatsapp.com", "whatsapp"],
  ["google.", "google"],
  ["bing.com", "bing"],
  ["duckduckgo.com", "duckduckgo"],
  ["yahoo.com", "yahoo"],
];

// Mizan's own marketing site. NOT treated as internal: the landing → app hop is
// exactly the boundary BACKLOG G6 says is unmeasured, so seeing "landing" as a
// source is the point. Only the app's own host counts as internal.
const LANDING_HOSTS = ["mizan.exchange"];

/** Trim, lowercase, strip anything that isn't a safe token character, and cap. */
function clean(v) {
  if (typeof v !== "string") return "";
  return v.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, MAX_FIELD_LEN);
}

/** Hostname of a URL string, or "" when it isn't parseable. Never the path or query. */
export function hostOf(url) {
  if (typeof url !== "string" || !url) return "";
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return ""; }
}

function hostMatches(host, suffix) {
  return host === suffix || host.endsWith(`.${suffix}`) ||
    // "google." is stored with a trailing dot to match google.com, google.co.uk…
    (suffix.endsWith(".") && (host.startsWith(suffix) || host.includes(`.${suffix}`)));
}

/** Reduce a referrer hostname to a channel token. Unknown hosts keep their host. */
export function channelForHost(host) {
  if (!host) return "";
  for (const [suffix, name] of HOST_CHANNELS) if (hostMatches(host, suffix)) return name;
  if (LANDING_HOSTS.some((h) => hostMatches(host, h))) return "landing";
  return clean(host);
}

/**
 * Work out the attribution for a visit.
 *
 * @param {object} ctx
 * @param {string} ctx.search    location.search ("?utm_source=…")
 * @param {string} ctx.referrer  document.referrer (full URL; only its host is read)
 * @param {string} ctx.selfHost  location.hostname — used to ignore internal navigation
 * @returns {{source:string, medium:string, campaign:string|null}|null}
 *          null means "this visit says nothing" (internal navigation) and must
 *          NOT overwrite anything already stored.
 */
export function parseAttribution({ search = "", referrer = "", selfHost = "" } = {}) {
  let params;
  try { params = new URLSearchParams(search || ""); } catch { params = new URLSearchParams(); }

  // Explicit campaign tagging always wins — it is the only signal that carries
  // intent rather than being inferred.
  const utmSource = clean(params.get("utm_source"));
  if (utmSource) {
    return {
      source: utmSource,
      medium: clean(params.get("utm_medium")) || "unknown",
      campaign: clean(params.get("utm_campaign")) || null,
    };
  }

  const refHost = hostOf(referrer);
  const self = clean(selfHost).replace(/^www\./, "");

  // Internal navigation carries no information about origin. Returning null
  // (rather than "direct") is what stops a page-to-page click from erasing the
  // real first touch.
  if (refHost && self && (refHost === self || refHost.endsWith(`.${self}`))) return null;

  if (!refHost) return { source: "direct", medium: "none", campaign: null };

  const channel = channelForHost(refHost);
  const searchEngines = new Set(["google", "bing", "duckduckgo", "yahoo"]);
  return {
    source: channel,
    medium: searchEngines.has(channel) ? "organic" : channel === "landing" ? "internal-site" : "referral",
    campaign: null,
  };
}

/**
 * Decide what to store, given what is already stored. First touch wins.
 * @returns the value to persist, or null when nothing should change.
 */
export function firstTouch(existing, incoming) {
  if (existing && existing.source) return null;  // already attributed — never overwrite
  if (!incoming || !incoming.source) return null;
  return incoming;
}

/**
 * Group stored attribution rows into funnel-ready counts, largest first.
 * @param {Array<{source?:string, medium?:string}>} rows
 * @param {number} totalUsers users in the funnel, including unattributed ones
 */
export function summarizeSources(rows = [], totalUsers = 0) {
  const counts = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const s = clean(r?.source);
    if (!s) continue;
    counts.set(s, (counts.get(s) || 0) + 1);
  }
  const attributed = [...counts.values()].reduce((a, b) => a + b, 0);
  const out = [...counts.entries()]
    .map(([source, count]) => ({
      source,
      count,
      pct: totalUsers > 0 ? Math.round((count / totalUsers) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));
  // Everyone who signed up before this shipped, surfaced honestly rather than
  // silently dropped — otherwise the breakdown looks complete when it isn't.
  const unknown = Math.max(0, totalUsers - attributed);
  if (unknown > 0) {
    out.push({
      source: "unattributed",
      count: unknown,
      pct: totalUsers > 0 ? Math.round((unknown / totalUsers) * 100) : 0,
    });
  }
  return out;
}
