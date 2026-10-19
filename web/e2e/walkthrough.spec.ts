// The Phase 1 walkthrough against the running dev servers: onboarding, the fixed dashboard, the
// feed, a development's popup, editing and making dashboards, the sidebar, an entity page, search,
// switching role and Help, then two scripted pipeline checks. It reads what the pipeline produced
// through the API to decide what to click and what to expect. It writes to the live store (a
// profile, dashboards, follows, visits, read marks), so it backs the store up first and puts it
// back at the end, and can run again.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { api } from "../lib/api/client";
import { shortDate } from "../lib/format";

import { runDir, screenshotName, STEPS } from "./steps";

/** One pass of `im check series`: requests that reached a source, were cached, or had no cache. */
interface FetchReplay {
  added: number;
  revised: number;
  failures: Record<string, string>;
  network: number;
  cached: number;
  missed: number;
}

/** What `im check series` prints (api/intelmonitor/checks.py). */
interface SeriesCheck {
  backfill: FetchReplay;
  fetch: FetchReplay;
  catalogue: number;
  series: number;
  observations: number;
  per_100: { series_id: string; unit: string; period: string; value: number | null }[];
  compared: number;
  differences: string[];
}

/** What `im check detector` prints (api/intelmonitor/checks.py). */
interface DetectorCheck {
  as_of: string;
  detections: string[];
  developments: { title: string; materiality_label: string; materiality_rule: string | null; needs_attention: boolean; subjects: string[]; sources: number }[];
}

const ROOT = path.resolve(import.meta.dirname, "../..");
const STORE = path.join(ROOT, "data/intelmonitor.db");

/** Runs `uv run im check <name>` in api/ and returns what it prints. */
const imCheck = (name: string) => execFileSync("uv", ["run", "im", "check", name], { cwd: path.join(ROOT, "api"), encoding: "utf8" });

/** Shows a check's JSON as the step's page, so its screenshot records the result. */
const showJson = (page: Page, value: unknown) =>
  page.setContent(`<pre style="font: 13px/1.5 ui-monospace, monospace; white-space: pre-wrap">${JSON.stringify(value, null, 2)}</pre>`);

async function unwrap<T>(request: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  const { data, error, response } = await request;
  if (error !== undefined || data === undefined) {
    throw new Error(`${response.url} answered ${response.status}: ${JSON.stringify(error)}`);
  }
  return data;
}

/** SQLite's online backup of the live store, safe while the API serves it (as `verify store save`). */
function backupStore(label: string): string {
  const dir = path.join(ROOT, "data/verify-snapshots");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${label}-e2e.db`);
  execFileSync("sqlite3", [STORE, `.backup '${file}'`]);
  return file;
}

const restoreStore = (file: string) => execFileSync("sqlite3", [STORE, `.restore '${file}'`]);

const PRIORITIES = ["High", "Medium", "Low"];

/** The feed rows' priority badges, top to bottom. */
const badges = (feed: Locator) => feed.locator(".frow .fstat .badge:not(.b-new)").allTextContents();

type Listed = { priority: string }[];
type Watch = { new_high: number; top: { priority: string; last_published: string } | null; subject: { name: string } };

/** The feed's column header, then the shown rows' priority badges, High first, as the API lists them. */
async function expectOrdered(feed: Locator, shown: Listed) {
  await expect(feed.locator(".frow-head")).toHaveText("PriorityFindingDate");
  await expect(feed.locator(".frow .fstat .badge:not(.b-new)")).toHaveText(shown.map((d) => d.priority));
}

/** The watchlist's rows before Show all: up to 3 entities with a development this month (4 when that is all), most new High first. */
function watchShown(watchlist: Watch[]): string[] {
  const rank = (w: Watch) => (w.top ? PRIORITIES.indexOf(w.top.priority) : 3);
  return [...watchlist]
    .sort((a, b) => b.new_high - a.new_high || rank(a) - rank(b) || (a.top && b.top ? b.top.last_published.localeCompare(a.top.last_published) : 0))
    .filter((w) => w.top)
    .filter((_, i, active) => i < (active.length === 4 ? 4 : 3))
    .map((w) => w.subject.name);
}

/** The id in a `/dashboards/<id>` URL. */
const dashboardIn = (url: string) => new URL(url).pathname.match(/^\/dashboards\/([^/]+)$/)?.[1] ?? "";

/** A URL with a development's popup open over a page whose path matches `page`. */
const popupUrl = (page: string, id: string) => new RegExp(`${page}\\?(.*&)?development=${id}(&|$)`);

test("IntelMonitor Phase 1 walkthrough", async ({ page }) => {
  test.setTimeout(15 * 60_000);
  const dir = runDir();
  mkdirSync(path.join(dir, "steps"), { recursive: true });
  const stamp = path.basename(dir);
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  let index = 0;
  const step = async (title: (typeof STEPS)[number], body: () => Promise<void>) => {
    const i = index++;
    expect(STEPS[i], "steps run in the order of STEPS").toBe(title);
    await test.step(title, async () => {
      try {
        await body();
      } finally {
        await page.screenshot({ path: path.join(dir, screenshotName(i)), animations: "disabled" }).catch(() => undefined);
      }
    });
  };

  const latest = await unwrap(api.GET("/runs/latest"));
  expect(latest.latest_news, "the latest run covers some news").toBeTruthy();
  const subjects = await unwrap(api.GET("/subjects"));
  const profileAtStart = await unwrap(api.GET("/profile"));
  const backup = backupStore(stamp);

  // Set by the steps that create them, read by the later ones.
  let dashboardId = "";
  let dashboardName = "";
  let feedUrl = "";

  try {
    await step(STEPS[0], async () => {
      // A first visit lands on onboarding; with a role already picked, Add a role opens the same page.
      await page.goto(profileAtStart.role === null ? "/" : "/setup");
      await expect(page).toHaveURL(/\/setup$/);
      await expect(page.getByRole("heading", { level: 1, name: "What is your role?" })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Main" }), "onboarding has no sidebar").toHaveCount(0);

      await page.getByRole("link", { name: /^Technology and cyber risk supervisor/ }).click();
      await expect(page).toHaveURL(/role=tech_cyber_supervisor/);
      // The page says "first" only when no role is picked yet.
      const heading = profileAtStart.role === null ? "Your first dashboard" : "Your new dashboard";
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      const suggestions = await unwrap(api.GET("/onboarding/suggestions", { params: { query: { role: "tech_cyber_supervisor" } } }));
      const ticked = page.locator(".picker-rows input:checked");
      await expect(ticked, "the role's suggestions start ticked").toHaveCount(suggestions.picks.length);
      const preview = page.locator(".setup-preview-count");
      await expect(preview).toHaveText(/^\d+ developments?, (\d+ High|none High)$/);

      // Trim one pick: the count and the preview follow.
      const singtel = page.getByRole("checkbox", { name: /^Singtel/ });
      await expect(singtel).toBeChecked();
      const previewCall = page.waitForResponse((r) => r.url().includes("/developments?") && r.url().includes("days=7"));
      await singtel.uncheck();
      await previewCall;
      await expect(ticked).toHaveCount(suggestions.picks.length - 1);
      await expect(preview).toHaveText(/^\d+ developments?, /);

      dashboardName = `E2E ${stamp}`;
      await page.getByRole("textbox", { name: "Dashboard name" }).fill(dashboardName);
      await page.getByRole("button", { name: "Create dashboard" }).click();
      await expect(page).toHaveURL(/\/dashboards\/[^/]+$/);
      dashboardId = dashboardIn(page.url());
      await expect(page.getByRole("heading", { level: 1, name: dashboardName })).toBeVisible();

      const profile = await unwrap(api.GET("/profile"));
      expect([profile.role, profile.default_dashboard_id]).toEqual(["tech_cyber_supervisor", dashboardId]);
      const dashboard = await unwrap(api.GET("/dashboards/{dashboard_id}", { params: { path: { dashboard_id: dashboardId } } }));
      expect(new Set(dashboard.subject_ids)).toEqual(new Set(suggestions.picks.filter((id) => id !== "singtel")));
    });

    await step(STEPS[1], async () => {
      const overview = await unwrap(api.GET("/dashboards/{dashboard_id}/overview", { params: { path: { dashboard_id: dashboardId } } }));
      const list = await unwrap(api.GET("/developments", { params: { query: { dashboard_id: dashboardId, days: 30, dismissed: false } } }));

      // One date in the top bar, and none of the parked controls anywhere.
      await expect(page.locator(".topbar .updated")).toHaveText(`Week to ${shortDate(latest.as_of)} · updated weekly`);
      for (const name of ["Add widget", "Edit", "Done", "Run now", "Mark all reviewed", "Mark reviewed", "Follow", "Generate"]) {
        await expect(page.getByRole("button", { name, exact: true }), `no ${name} button`).toHaveCount(0);
      }
      await expect(page.getByRole("button", { name: /^(Alerts|Show runs|Monitoring)/ })).toHaveCount(0);
      await expect(page.locator("dialog.tour"), "no tour starts").toHaveCount(0);
      await expect(page.locator("[data-widget-id]"), "no widget grid").toHaveCount(0);

      // Watchlist: the busiest entities with developments this month, each with its new High count and
      // its top development in full; Show all lists every entity.
      const watch = page.getByRole("region", { name: "Watchlist" });
      const rows = watch.locator("tbody tr");
      const names = watchShown(overview.watchlist);
      await expect(rows.getByRole("rowheader")).toHaveText(names);
      for (const [i, name] of names.entries()) {
        const w = overview.watchlist.find((x) => x.subject.name === name);
        if (!w?.top) throw new Error(`${name} has no top development`);
        await expect(rows.nth(i).locator(".wl-cnt")).toHaveText(w.new_high > 0 ? `${w.new_high} new High` : "None");
        await expect(rows.nth(i).getByRole("link", { name: w.top.title, exact: true })).toBeVisible();
      }
      if (names.length < overview.watchlist.length) {
        await watch.getByRole("button", { name: `Show all ${overview.watchlist.length} entities` }).click();
        await expect(rows).toHaveCount(overview.watchlist.length);
        await watch.getByRole("button", { name: "Show fewer" }).click();
        await expect(rows).toHaveCount(names.length);
      }

      // The feed: the API's order, priority first, New on unread new rows, 15 rows then Show all.
      const feed = page.getByRole("region", { name: "Latest developments" });
      const shown = list.developments.slice(0, 15);
      await expect(feed.locator(".frow")).toHaveCount(shown.length);
      await expect(feed.locator(".frow .ftitle").first()).toHaveText(shown[0].title);
      const ranks = (await badges(feed)).map((b) => PRIORITIES.indexOf(b));
      expect(ranks, "highest priority first").toEqual([...ranks].sort((a, b) => a - b));
      await expect(feed.locator(".frow .b-new")).toHaveCount(shown.filter((d) => d.change === "new" && !d.read).length);
      await expectOrdered(feed, shown);
      await expect(feed.locator(".mon-sec-head .meta")).toContainText(overview.new_count > 0 ? `${overview.new_count} new since` : "Nothing new since");

      // Upcoming dates in full, each label a link to its development, then the development's title.
      const upcoming = page.getByRole("region", { name: "Upcoming dates" });
      if (overview.upcoming.length === 0) await expect(upcoming).toContainText("No upcoming dates in this dashboard's news.");
      else {
        const [u] = overview.upcoming;
        await expect(upcoming.locator("li")).toHaveCount(overview.upcoming.length);
        await expect(upcoming.locator(".up-label").first()).toHaveText(u.label);
        await expect(upcoming.locator(".up-label").first()).toHaveAttribute("href", popupUrl(`/dashboards/${dashboardId}`, u.development_id));
        await expect(upcoming.locator(".up-about").first()).toHaveText(u.development_title);
        await expect(upcoming, "no long From: lines").not.toContainText("From:");
      }
    });

    await step(STEPS[2], async () => {
      const feed = page.getByRole("region", { name: "Latest developments" });
      const all = await unwrap(api.GET("/developments", { params: { query: { dashboard_id: dashboardId, days: 30, dismissed: false } } }));
      expect(all.developments.length, "the month has more rows than the dashboard shows").toBeGreaterThan(15);
      await feed.getByRole("link", { name: `Show all ${all.developments.length}` }).click();
      await expect(page).toHaveURL(new RegExp(`/developments\\?dashboard=${dashboardId}$`));
      await expect(page.getByRole("heading", { level: 1, name: "Developments" })).toBeVisible();
      await expect(page.locator(".frow")).toHaveCount(all.developments.length);
      await expectOrdered(page.locator(".feed"), all.developments);
      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`/dashboards/${dashboardId}$`));

      // This week, then High only: the URL holds both, a reload keeps them, every row is High.
      await feed.getByRole("group", { name: "Period" }).getByRole("button", { name: /^This week/ }).click();
      await expect(page).toHaveURL(/days=7/);
      await feed.getByRole("button", { name: /^Priority/ }).click();
      await page.getByRole("dialog", { name: "Priority" }).getByRole("checkbox", { name: /^High/ }).check();
      await expect(page).toHaveURL(/priority=High/);
      await page.keyboard.press("Escape");
      await page.reload();
      await expect(feed.getByRole("group", { name: "Period" }).getByRole("button", { name: /^This week/ })).toHaveAttribute("aria-pressed", "true");
      await expect(feed.getByRole("button", { name: /^Priority: High/ })).toBeVisible();
      const high = await unwrap(
        api.GET("/developments", { params: { query: { dashboard_id: dashboardId, days: 7, priority: ["High"], dismissed: false } } }),
      );
      await expect(feed.locator(".frow")).toHaveCount(Math.min(high.developments.length, 15));
      expect(new Set(await badges(feed)), "only High rows").toEqual(new Set(high.developments.length ? ["High"] : []));
      feedUrl = page.url();
    });

    await step(STEPS[3], async () => {
      const feed = page.getByRole("region", { name: "Latest developments" });
      const rows = await unwrap(
        api.GET("/developments", { params: { query: { dashboard_id: dashboardId, days: 7, priority: ["High"], dismissed: false } } }),
      );
      const d = rows.developments[0];
      expect(d, "this week has a High development").toBeTruthy();
      const link = feed.getByRole("link", { name: d.title, exact: true });
      await link.click();
      await expect(page).toHaveURL(popupUrl(`/dashboards/${dashboardId}`, d.id));
      const popup = page.getByRole("dialog", { name: d.title });
      await expect(popup.getByRole("heading", { level: 2, name: d.title })).toBeFocused();
      await expect(popup.getByRole("button", { name: "Close development" })).toBeVisible();
      await expect(popup.getByRole("button", { name: /^Back/ })).toHaveCount(0);
      await expect(popup.getByRole("heading", { name: "Who it impacts" })).toBeVisible();
      await expect(popup.getByRole("heading", { name: "Connections" })).toBeVisible();
      await expect(popup.getByRole("tab", { name: /^News/ })).toBeVisible();
      await expect(popup.getByRole("tab", { name: /^Social/ })).toBeVisible();
      await expect(popup.getByRole("button", { name: "Dismiss", exact: true })).toBeVisible();
      await expect(popup.getByRole("button", { name: "Not relevant", exact: true })).toBeVisible();
      for (const word of ["materiality", "Tagged to", "tagged by", "Needs attention"]) {
        await expect(popup, `no "${word}"`).not.toContainText(word, { ignoreCase: true });
      }
      // The New dashboard popup's size: 80% of the screen.
      const box = await popup.boundingBox();
      const view = page.viewportSize();
      expect(box && view && Math.round(box.width) === Math.round(Math.min(1400, Math.max(900, view.width * 0.8))), "80% wide").toBe(true);

      await page.keyboard.press("Escape");
      await expect(page).toHaveURL(feedUrl);
      await expect(popup).toHaveCount(0);
      await expect(link, "focus returns to the row").toBeFocused();
      const after = await unwrap(api.GET("/developments", { params: { query: { dashboard_id: dashboardId, days: 7, priority: ["High"] } } }));
      expect(after.developments.find((x) => x.id === d.id)?.read, "opening it marked it read").toBe(true);
      await expect(feed.locator(".frow").filter({ hasText: d.title }).locator(".b-new")).toHaveCount(0);

      // The development's old page address opens the popup on the dashboard; close drops it.
      await page.goto(`/developments/${d.id}?dashboard=${dashboardId}`);
      await expect(page).toHaveURL(popupUrl(`/dashboards/${dashboardId}`, d.id));
      await expect(popup).toBeVisible();
      await popup.getByRole("button", { name: "Close development" }).click();
      await expect(page).toHaveURL(new RegExp(`/dashboards/${dashboardId}$`));
      await page.goto(feedUrl);
    });
    await step(STEPS[4], async () => {
      const feed = page.getByRole("region", { name: "Latest developments" });
      const title = (await feed.locator(".frow .ftitle").first().textContent()) ?? "";
      await feed.getByRole("link", { name: title, exact: true }).click();
      const popup = page.getByRole("dialog", { name: title });
      await expect(popup).toBeVisible();
      const id = new URL(page.url()).searchParams.get("development") ?? "";
      const triage = async () => (await unwrap(api.GET("/developments/{development_id}", { params: { path: { development_id: id } } }))).triage;
      expect((await triage()).dismissed).toBe(false);

      await page.getByRole("button", { name: "Dismiss", exact: true }).click();
      // The toast region is a zero-size live region; its message and Undo are what show.
      const toast = page.locator(".toast-region").filter({ hasText: "Dismissed." });
      await expect(toast.getByText("Dismissed.")).toBeVisible();
      await expect(popup).toContainText("Restore to feed");
      await expect.poll(async () => (await triage()).dismissed, { message: "the API has it dismissed" }).toBe(true);
      await toast.getByRole("button", { name: "Undo" }).click();
      await expect.poll(async () => (await triage()).dismissed, { message: "Undo restores it" }).toBe(false);
      await popup.getByRole("button", { name: "Close development" }).click();
      await expect(page).toHaveURL(feedUrl);
      await expect(feed.getByRole("link", { name: title, exact: true }), "back in the feed").toBeVisible();
    });

    await step(STEPS[5], async () => {
      await page.goto(`/dashboards/${dashboardId}`);
      await page.getByRole("button", { name: "Edit dashboard" }).click();
      const dialog = page.getByRole("dialog", { name: "Edit dashboard" });
      await expect(dialog.getByRole("textbox", { name: "Dashboard name" })).toHaveValue(dashboardName);
      const singtel = dialog.getByRole("checkbox", { name: /^Singtel/ });
      await expect(singtel).not.toBeChecked();
      await singtel.check();
      const saved = page.waitForResponse((r) => r.url().endsWith(`/dashboards/${dashboardId}`) && r.request().method() === "PUT");
      await dialog.getByRole("button", { name: "Save" }).click();
      await saved;
      await expect(dialog).toHaveCount(0);
      const dashboard = await unwrap(api.GET("/dashboards/{dashboard_id}", { params: { path: { dashboard_id: dashboardId } } }));
      expect(dashboard.subject_ids).toContain("singtel");
      // Singtel may sit past the compact watchlist's first rows; Show all lists every entity.
      const watch = page.getByRole("region", { name: "Watchlist" });
      const overview = await unwrap(api.GET("/dashboards/{dashboard_id}/overview", { params: { path: { dashboard_id: dashboardId } } }));
      if (!watchShown(overview.watchlist).includes("Singtel")) await watch.getByRole("button", { name: `Show all ${overview.watchlist.length} entities` }).click();
      await expect(watch.getByRole("rowheader", { name: "Singtel" })).toBeVisible();
    });

    await step(STEPS[6], async () => {
      const nav = page.getByRole("navigation", { name: "Main" });
      await nav.getByRole("button", { name: "New dashboard" }).click();
      const dialog = page.getByRole("dialog", { name: "New dashboard" });
      await expect(dialog.getByRole("button", { name: "Create dashboard" })).toBeDisabled();
      await dialog.getByRole("button", { name: "Add all Exchanges" }).click();
      await expect(dialog.getByRole("textbox", { name: "Dashboard name" })).toHaveValue("Exchanges");
      await expect(dialog.getByRole("status")).toHaveText("2 entities");
      await dialog.getByRole("button", { name: "Create dashboard" }).click();
      await page.waitForURL((u) => /^\/dashboards\/[^/]+$/.test(u.pathname) && u.pathname !== `/dashboards/${dashboardId}`);
      const id = dashboardIn(page.url());
      await expect(page.getByRole("heading", { level: 1, name: "Exchanges" })).toBeVisible();
      const overview = await unwrap(api.GET("/dashboards/{dashboard_id}/overview", { params: { path: { dashboard_id: id } } }));
      expect(overview.watchlist.map((w) => w.subject.name).sort()).toEqual(["HKEX", "SGX"]);
      const watch = page.getByRole("region", { name: "Watchlist" });
      const names = watchShown(overview.watchlist);
      if (names.length > 0) await expect(watch.getByRole("rowheader")).toHaveText(names);
      else await expect(watch).toContainText("Nothing this month for these entities.");
      await expect(nav.locator(`[data-dashboard-id="${id}"] a`)).toHaveAttribute("aria-current", "page");
    });

    await step(STEPS[7], async () => {
      const nav = page.getByRole("navigation", { name: "Main" });
      const groups = subjects.filter((s) => s.type === "group");
      // Groups are headings under Entities, not a section of their own.
      await expect(nav.getByText("Groups", { exact: true })).toHaveCount(0);
      const banks = groups.find((g) => g.id === "singapore-banks");
      if (!banks) throw new Error("the Singapore banks group is missing");
      const heading = nav.getByRole("button", { name: `Singapore banks ${banks.members.length}`, exact: true });
      await expect(heading).toHaveAttribute("aria-expanded", "false");
      await heading.click();
      await expect(heading).toHaveAttribute("aria-expanded", "true");
      const dbs = (await unwrap(api.GET("/subjects"))).find((s) => s.id === "dbs");
      await nav.getByRole("link", { name: dbs && dbs.new_high > 0 ? `DBS ${dbs.new_high} High` : "DBS", exact: true }).click();
      await expect(page).toHaveURL(/\/monitors\/dbs$/);
      await expect(page.getByRole("heading", { level: 1, name: "DBS" })).toBeVisible();
      await expect(nav.locator("[aria-current=page]")).toHaveText(/^DBS/);
      // Topics with a new High development say so; the counts moved as this walkthrough read developments.
      const now = await unwrap(api.GET("/subjects"));
      for (const t of now.filter((s) => s.type === "topic")) {
        await expect(nav.getByRole("link", { name: t.new_high > 0 ? `${t.name} ${t.new_high} High` : t.name, exact: true })).toBeVisible();
      }
      // Each dashboard shows its new count, the number its feed head shows.
      for (const d of await unwrap(api.GET("/dashboards"))) {
        const count = nav.locator(`[data-dashboard-id="${d.id}"] .count`);
        if (d.new_count > 0) await expect(count).toHaveText(`${d.new_count} new`);
        else await expect(count).toHaveCount(0);
      }
    });

    await step(STEPS[8], async () => {
      for (const region of ["This week", "Top DBS developments", "Related to DBS"]) {
        await expect(page.getByRole("region", { name: region }), `the ${region} block`).toBeVisible();
      }
      await expect(page.getByRole("link", { name: "Open Data" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Ask about DBS" })).toHaveAttribute("href", "/ask?about=dbs");
      // Could affect and Shared with are on the Related tab, which the Related card's See all links opens.
      for (const region of ["Could affect DBS", "Shared with"]) {
        await expect(page.getByRole("region", { name: region }), `no ${region} on the Overview`).toHaveCount(0);
      }
      const tabs = page.getByRole("navigation", { name: "Monitor views" });
      await page.getByRole("region", { name: "Related to DBS" }).getByRole("link", { name: "See all links" }).click();
      await expect(page).toHaveURL(/\/monitors\/dbs\/related$/);
      await expect(tabs.getByRole("link", { name: "Related" })).toHaveAttribute("aria-current", "page");
      const related = page.locator("main .mon-sec h2");
      await expect(related).toHaveText(["Could affect DBS", "Shared with"]);
      await expect(page.getByRole("region", { name: "Could affect DBS" }).locator(".ca-row")).not.toHaveCount(0);
      await tabs.getByRole("link", { name: "Overview" }).click();
      await expect(page).toHaveURL(/\/monitors\/dbs$/);
      for (const name of ["Mark reviewed", "Follow", "Add a focus area"]) {
        await expect(page.getByRole("button", { name, exact: true }), `no ${name}`).toHaveCount(0);
      }
      await expect(page.getByRole("link", { name: /^(Connections|Trend)$/ })).toHaveCount(0);

      // The Overview shows this month's top 5 with their priority; See all opens the Developments tab.
      const month = await unwrap(api.GET("/developments", { params: { query: { subject_id: ["dbs"], days: 30, dismissed: false } } }));
      const top = page.getByRole("region", { name: "Top DBS developments" });
      await expect(top.locator(".frow")).toHaveCount(Math.min(month.developments.length, 5));
      await expect(top.locator(".frow .ftitle").first()).toHaveText(month.developments[0].title);
      await expect(top.locator(".frow-head")).toHaveText("PriorityFindingDate");
      await top.getByRole("link", { name: /^See all/ }).click();
      await expect(page).toHaveURL(/\/monitors\/dbs\/developments$/);
      await expect(tabs.getByRole("link", { name: "Developments" })).toHaveAttribute("aria-current", "page");
      const tab = page.getByRole("region", { name: "Developments about DBS" });
      await expect(tab.locator(".frow")).toHaveCount(month.developments.length);
      await expectOrdered(tab, month.developments);
      await expect(tab.getByRole("button", { name: /^Adverse event/ })).toBeVisible();

      await tabs.getByRole("link", { name: "Data" }).click();
      await expect(page).toHaveURL(/\/monitors\/dbs\/data$/);
      await expect(page.locator('section[aria-labelledby="why"] .mon-sec-head .meta')).toHaveText(/^Week to \d+ \w{3}$/);
      // The chrome is in plain words; note bodies are the model's text and are not checked here.
      await expect(page.locator("main .tr-legend").first()).toHaveText("HighMedium");
      await expect(page.locator('section[aria-labelledby="runs"]'), "no focus areas by run").toHaveCount(0);
      const indicatorBadges = await page.locator('section[aria-labelledby="indicators"] .badge').allTextContents();
      expect(indicatorBadges.filter((b) => b !== "No data" && b !== "Stale"), "no Watch or Stable on series").toEqual([]);
      await expect(page.locator("main")).not.toContainText("Run of");
      // Cited developments carry their priority for DBS, as its feed shows them.
      const cited = (await unwrap(api.GET("/subjects/{subject_id}/trend", { params: { path: { subject_id: "dbs" } } }))).runs.at(-1)?.note?.developments ?? [];
      const feed = await unwrap(api.GET("/developments", { params: { query: { subject_id: ["dbs"], days: null } } }));
      const inFeed = new Map(feed.developments.map((d) => [d.id, d.priority]));
      await expect(page.locator(".tr-cited .badge")).toHaveText(cited.map((c) => inFeed.get(c.development.id) ?? c.development.priority));

      // A topic links to nothing: no Related tab, and its URL lands on the Overview.
      await page.goto("/monitors/banking-regulation/related");
      await expect(page).toHaveURL(/\/monitors\/banking-regulation$/);
      await expect(tabs.getByRole("link")).toHaveText(["Overview", "Developments", "Data"]);
    });

    await step(STEPS[9], async () => {
      const search = page.getByRole("combobox", { name: "Search" });
      // A pointer resting where the results open would take the highlight on hover.
      await page.mouse.move(700, 880);
      await page.keyboard.press("ControlOrMeta+k");
      await expect(search).toBeFocused();
      await search.fill("ocbc");
      await expect(page.getByRole("option", { name: "OCBC Entity" })).toHaveAttribute("aria-selected", "true");
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/monitors\/ocbc$/);

      const results = await unwrap(api.GET("/search", { params: { query: { q: "outage", limit: 5 } } }));
      const hit = results.developments[0];
      expect(hit, "a development matches outage").toBeTruthy();
      await page.keyboard.press("ControlOrMeta+k");
      await search.fill("outage");
      await page.locator("#search-results .search-hit.development").filter({ hasText: hit.title }).click();
      await expect(page).toHaveURL(popupUrl("/monitors/ocbc", hit.id));
      await expect(page.getByRole("dialog", { name: hit.title }).getByRole("heading", { level: 2, name: hit.title })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page).toHaveURL(/\/monitors\/ocbc$/);
    });

    await step(STEPS[10], async () => {
      const fmd = (await unwrap(api.GET("/profiles"))).find((p) => p.id === "fmd");
      if (!fmd?.default_dashboard_id) throw new Error("the FMD profile and its dashboard are missing");
      await page.locator(".profile").click();
      await page.getByRole("menuitemradio", { name: /^FMD/ }).click();
      await expect(page).toHaveURL(new RegExp(`/dashboards/${fmd.default_dashboard_id}$`));
      const dashboard = await unwrap(api.GET("/dashboards/{dashboard_id}", { params: { path: { dashboard_id: fmd.default_dashboard_id } } }));
      await expect(page.getByRole("heading", { level: 1, name: dashboard.name })).toBeVisible();
      expect((await unwrap(api.GET("/profile"))).id).toBe("fmd");
      // The sidebar lists FMD's dashboards, not the ones made under the other role.
      await expect(page.locator(`[data-dashboard-id="${dashboardId}"]`)).toHaveCount(0);

      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press("?");
      const help = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Help" }) });
      await expect(help).toBeVisible();
      const labels = help.getByRole("region", { name: "Labels on a development" });
      for (const word of ["High", "Medium", "Low", "Adverse event", "New", "Updated"]) await expect(labels).toContainText(word);
      await page.keyboard.press("Escape");
      await expect(help).toHaveCount(0);
    });

    await step(STEPS[11], async () => {
      await page.setViewportSize({ width: 1024, height: 800 });
      await page.goto(`/dashboards/${dashboardId}`);
      await expect(page.getByRole("heading", { level: 1, name: dashboardName })).toBeVisible();
      await expect(page.locator(".frow").first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth), "no sideways scroll").toBe(1024);
      // Titles a user must read to decide what to open show in full: no clamp, no ellipsis, no hidden overflow.
      const cut = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>(".ftitle, .wtitle, .up-label, .navitem > span:first-of-type, h1")]
          .filter((el) => el.clientHeight > 0 && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1))
          .map((el) => el.textContent),
      );
      expect(cut).toEqual([]);
    });

    await step(STEPS[12], async () => {
      // `im check series` backfills every series into a scratch store from data/raw/ alone, then
      // fetches again as the daily fetch does. A request with no cached response fails instead of
      // reaching the source, so a clean pass proves the fetch path runs offline end to end.
      await page.setViewportSize({ width: 1440, height: 900 });
      const check: SeriesCheck = JSON.parse(imCheck("series"));
      for (const [name, pass] of [["backfill", check.backfill], ["fetch", check.fetch]] as const) {
        expect(pass.network, `the ${name} reaches no source`).toBe(0);
        expect(pass.missed, `every ${name} request is cached`).toBe(0);
        expect(pass.cached, `the ${name} made requests`).toBeGreaterThan(0);
        expect(pass.failures, `no series fails in the ${name}`).toEqual({});
      }
      expect(check.series, "every series but the hand-collected one has history").toBeGreaterThanOrEqual(check.catalogue - 1);
      expect([check.fetch.added, check.fetch.revised], "the same responses again add nothing").toEqual([0, 0]);
      // Quotes per 100 units are stored per unit, the values the app serves.
      for (const v of check.per_100) {
        const served = await unwrap(
          api.GET("/series/{series_id}", { params: { path: { series_id: v.series_id }, query: { from: v.period, to: v.period } } }),
        );
        expect([v.unit, v.value], `${v.series_id} on ${v.period}`).toEqual([served.series.unit, served.observations[0]?.value]);
      }
      expect(check.compared, "replayed observations were compared with the store").toBeGreaterThan(1000);
      expect(check.differences).toEqual([]);
      writeFileSync(path.join(dir, "series-fetch.json"), JSON.stringify(check, null, 2));
      await showJson(page, check);
    });

    await step(STEPS[13], async () => {
      // `im check detector` feeds fixture loan-to-deposit values to a scratch store; crossing 90%
      // fires the rule into one development that reaches High through its rule.
      const check: DetectorCheck = JSON.parse(imCheck("detector"));
      expect(check.detections).toHaveLength(1);
      expect(check.detections[0]).toMatch(/rose above 90\.0%/);
      expect(check.developments).toHaveLength(1);
      const [d] = check.developments;
      expect([d.title, d.materiality_rule, d.needs_attention, d.sources]).toEqual([check.detections[0], "ltd-above-90", true, 1]);
      writeFileSync(path.join(dir, "detector.json"), JSON.stringify(check, null, 2));
      await showJson(page, check);
    });
  } finally {
    restoreStore(backup);
  }
  expect(pageErrors, "no uncaught errors in the page").toEqual([]);
});
