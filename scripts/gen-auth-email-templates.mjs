// Generate branded Supabase Auth email templates from the app's own
// renderBrandedEmail(), so the auth emails (confirm-signup, invite, magic-link,
// reset-password) match the in-app branded emails exactly. The CTA link is
// Supabase's {{ .ConfirmationURL }} variable — esc() leaves it untouched.
//
// Run: node scripts/gen-auth-email-templates.mjs
// Output: supabase/email-templates/*.html  (+ subjects printed / written to subjects.json)
import { renderBrandedEmail } from "../lib/alerts.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "supabase", "email-templates");
mkdirSync(OUT, { recursive: true });

const LINK = "{{ .ConfirmationURL }}"; // Supabase substitutes the real action URL

const TEMPLATES = {
  confirmation: {
    subject: "Confirm your MĪZAN email",
    html: renderBrandedEmail({
      eyebrow: "Confirm your email",
      title: "Confirm your email",
      bodyText:
        "Welcome to MĪZAN — the Sharia-compliant platform to track, screen, and grow your wealth in line with your values.\n\n" +
        "Confirm your email address to activate your account.",
      ctaUrl: LINK, ctaLabel: "Confirm my email →",
      ctaUrl2: "https://www.mizan.exchange", ctaLabel2: "Learn more about Mizan →",
      footNote: "You received this because this email was used to sign up for Mizan. If it wasn't you, you can safely ignore it.",
    }),
  },
  invite: {
    subject: "You're invited to MĪZAN",
    html: renderBrandedEmail({
      eyebrow: "Private invitation",
      title: "You're invited to MĪZAN",
      bodyText:
        "You've been invited to MĪZAN — the Sharia-compliant platform to track, screen, and grow your wealth in line with your values.\n\n" +
        "Screen your holdings against AAOIFI standards, calculate Zakat with live nisab, purify dividends, and see your whole financial picture in one place.\n\n" +
        "Tap below to accept your invitation and set up your account.",
      ctaUrl: LINK, ctaLabel: "Accept your invitation →",
      ctaUrl2: "https://www.mizan.exchange", ctaLabel2: "Learn more about Mizan →",
      footNote: "You received this invitation from Mizan. If you weren't expecting it, you can safely ignore this email.",
    }),
  },
  magic_link: {
    subject: "Your MĪZAN sign-in link",
    html: renderBrandedEmail({
      eyebrow: "Sign-in link",
      title: "Your sign-in link",
      bodyText:
        "Tap below to sign in to MĪZAN. This link is single-use and expires shortly.\n\n" +
        "If you didn't request it, you can safely ignore this email — no one can sign in without this link.",
      ctaUrl: LINK, ctaLabel: "Sign in to Mizan →",
      footNote: "You received this because a sign-in link was requested for this email.",
    }),
  },
  recovery: {
    subject: "Reset your MĪZAN password",
    html: renderBrandedEmail({
      eyebrow: "Password reset",
      title: "Reset your password",
      bodyText:
        "We received a request to reset your MĪZAN password. Tap below to choose a new one. This link expires shortly.\n\n" +
        "If you didn't request this, ignore this email and your password stays the same.",
      ctaUrl: LINK, ctaLabel: "Reset my password →",
      footNote: "You received this because a password reset was requested for this email.",
    }),
  },
};

const subjects = {};
for (const [key, t] of Object.entries(TEMPLATES)) {
  writeFileSync(join(OUT, `${key}.html`), t.html);
  subjects[key] = t.subject;
  console.log(`wrote ${key}.html  ·  subject: ${t.subject}`);
}
writeFileSync(join(OUT, "subjects.json"), JSON.stringify(subjects, null, 2));
console.log("\nAll 4 templates written to supabase/email-templates/");
