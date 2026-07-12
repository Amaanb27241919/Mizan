// Push the branded Supabase Auth email templates to the HOSTED project via the
// Management API. Run AFTER `node scripts/gen-auth-email-templates.mjs`.
//
// Requires a Supabase Personal Access Token (account-level, powerful — treat
// like a password). Generate one at https://supabase.com/dashboard/account/tokens
//
// Usage:
//   SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/push-auth-email-templates.mjs
//   (optionally SUPABASE_PROJECT_REF=... to override the default)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "supabase", "email-templates");
const TOKEN = (process.env.SUPABASE_ACCESS_TOKEN || "").trim();
const REF = (process.env.SUPABASE_PROJECT_REF || "kcghivcvczxaguezurii").trim();

if (!TOKEN) {
  console.error("Set SUPABASE_ACCESS_TOKEN (a Supabase Personal Access Token).");
  console.error("Generate one at https://supabase.com/dashboard/account/tokens");
  process.exit(1);
}

const subjects = JSON.parse(readFileSync(join(DIR, "subjects.json"), "utf8"));
const read = (k) => readFileSync(join(DIR, `${k}.html`), "utf8");

// Map our 4 templates → the Management API config/auth fields.
const body = {
  mailer_templates_confirmation_content: read("confirmation"),
  mailer_subjects_confirmation:          subjects.confirmation,
  mailer_templates_invite_content:       read("invite"),
  mailer_subjects_invite:                subjects.invite,
  mailer_templates_magic_link_content:   read("magic_link"),
  mailer_subjects_magic_link:            subjects.magic_link,
  mailer_templates_recovery_content:     read("recovery"),
  mailer_subjects_recovery:              subjects.recovery,
};

const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/config/auth`, {
  method: "PATCH",
  headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const text = await res.text();
if (!res.ok) {
  console.error(`Failed (${res.status}):`, text.slice(0, 400));
  process.exit(1);
}
console.log(`✓ Pushed 4 branded auth email templates to project ${REF}.`);
console.log("  Verify in Dashboard → Authentication → Email Templates.");
