# Supabase Auth email templates (branded)

All 6 hosted Supabase Auth email templates, branded to match the app's
`renderBrandedEmail()` (lib/alerts.mjs). One place, one push command.

| File | Supabase template | Management-API field | Key variable |
|------|-------------------|----------------------|--------------|
| `confirmation.html`     | Confirm signup        | `mailer_templates_confirmation_content`     | `{{ .ConfirmationURL }}` |
| `invite.html`           | Invite user           | `mailer_templates_invite_content`           | `{{ .ConfirmationURL }}` |
| `magic_link.html`       | Magic Link            | `mailer_templates_magic_link_content`       | `{{ .ConfirmationURL }}` |
| `recovery.html`         | Reset password        | `mailer_templates_recovery_content`         | `{{ .ConfirmationURL }}` |
| `email_change.html`     | Change Email Address  | `mailer_templates_email_change_content`     | `{{ .ConfirmationURL }}`, `{{ .NewEmail }}` |
| `reauthentication.html` | Reauthentication      | `mailer_templates_reauthentication_content` | `{{ .Token }}` (OTP, no button) |

Subjects live in `subjects.json`.

## Editing
Don't hand-edit the `.html` files — they're **generated** so they can't drift
from the app's branding. Edit the copy in `scripts/gen-auth-email-templates.mjs`
(or the shared shell in `lib/alerts.mjs`), then regenerate:

```bash
node scripts/gen-auth-email-templates.mjs
```

## Applying to the hosted project
Either push via the Management API (needs a Supabase Personal Access Token from
https://supabase.com/dashboard/account/tokens — keep it in your shell, not in git):

```bash
SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/push-auth-email-templates.mjs
```

…or paste each file into **Dashboard → Authentication → Email Templates** with
the matching subject from `subjects.json`.

> Deliverability: these send from `mizan.exchange`, which still needs a **DMARC**
> DNS record (`_dmarc` TXT = `v=DMARC1; p=none; rua=mailto:dmarc@mizan.exchange; fo=1`)
> or they'll land in spam regardless of branding. See BACKLOG F8.
