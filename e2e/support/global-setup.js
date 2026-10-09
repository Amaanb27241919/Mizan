// Pre-flight for the e2e suite: the build under test must have Supabase
// configured, or the app runs in single-user pass-through mode and the auth,
// onboarding and demo-wipe specs fail for a reason their messages never name.
// See playwright.config.js. Reads the built bundle; touches no network.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = fileURLToPath(new URL("../../dist/assets/", import.meta.url));
const PROJECT_REF = "kcghivcvczxaguezurii";

export default function globalSetup() {
  if (!existsSync(DIST)) {
    throw new Error("e2e: dist/ is missing — run `npm run build:e2e` first.");
  }
  const bundles = readdirSync(DIST).filter((f) => /^index-.*\.js$/.test(f));
  const configured = bundles.some((f) => readFileSync(join(DIST, f), "utf8").includes(`${PROJECT_REF}.supabase.co`));
  if (!configured) {
    throw new Error(
      "e2e: dist/ was built WITHOUT Supabase settings, so the app would run in single-user pass-through mode " +
      "(no login, a fake user) and the auth/onboarding/demo specs would fail for that reason alone. " +
      "Rebuild with `npm run build:e2e`.");
  }
}
