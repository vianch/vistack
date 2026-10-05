// Copy into the QA lane's evidence directory (for example .claude/state/qa/<slug>/<slice-or-pr>/<head7>/checkout.mjs), then from the project root,
// with QA_USER and QA_PASSWORD exported from the approved credential file:
//   node <plugin>/skills/qa-video/scripts/qa-video.mjs record \
//     --scenario <dir>/checkout.mjs --out <dir> --url http://localhost:3000 --head <sha> --actions --title-card
// Secrets come from process.env only; never put them in argv, captions, or step names.
// `sensitive` hides the action overlay, which prints filled values; it does not hide what the page renders.

export const contextOptions = {
  locale: "en-US",
  ...(process.env.QA_BYPASS_SECRET ? { extraHTTPHeaders: { "x-vercel-protection-bypass": process.env.QA_BYPASS_SECRET } } : {}),
};

// Runs in a separate, unrecorded context; only its cookies and storage carry into the recording.
export const login = async ({ page }) => {
  if (!process.env.QA_PASSWORD) throw new Error("set QA_PASSWORD in the environment");
  await page.goto("/login");
  await page.getByLabel("Email").fill(process.env.QA_USER ?? "qa@example.com");
  await page.getByLabel("Password").fill(process.env.QA_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
};

const expectText = async (locator, expected) => {
  const actual = (await locator.textContent())?.trim();
  if (actual !== expected) throw new Error(`expected "${expected}", saw "${actual}"`);
};

export default async ({ page, step }) => {
  await step("home", async () => {
    await page.goto("/");
    await expectText(page.getByRole("heading", { level: 1 }), "signed in");
  }, { caption: "Home shows the signed-in session" });

  await step("search", async () => {
    await page.getByRole("searchbox").fill("widget");
    await page.getByRole("button", { name: "Search" }).click();
    await page.getByRole("listitem").first().waitFor();
  }, { caption: "Search for widget lists results" });

  const count = await step("results", async () => {
    const total = await page.getByRole("listitem").count();
    if (total === 0) throw new Error("no results");
    return total;
  }, { caption: "At least one result is shown" });

  await step("promo", async () => {
    await page.getByLabel("Promo code").fill(process.env.QA_PROMO_CODE ?? "WELCOME10");
    await page.getByRole("button", { name: "Apply" }).click();
    await expectText(page.getByRole("status"), "Promo applied");
  }, { caption: `Promo applies to ${count} results`, sensitive: true });
};
