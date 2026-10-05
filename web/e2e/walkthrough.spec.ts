// The POC walkthrough (poc-plan.md, Verification > E2E) against the running dev servers. It reads
// whatever the pipeline produced through the API to decide what to click and what to expect, and
// undoes its own changes at the end so it can run again.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { api, API_URL, type Schema } from "../lib/api/client";
import { listQuery } from "../lib/developments";
import {
  answerText,
  changeCounts,
  daysBetween,
  indicatorChange,
  indicatorSentence,
  longDate,
  monthsBefore,
  plural,
  seriesPeriod,
  seriesValue,
  shortDate,
  STATE_LABEL,
} from "../lib/format";

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

/** What `im check past-run` prints (api/intelmonitor/checks.py). */
interface PastRunCheck {
  as_of: string;
  log: string[];
  later_documents: number;
  later_observations: number;
  later_detections: number;
  detections: number;
  developments: number;
  answers: number;
  notes: number;
  indicators: number;
  late: { sources: number; indicators: number; facts: number; notes: number };
  differences: string[];
}

/** What `im check depeg` prints (api/intelmonitor/checks.py). */
interface DepegCheck {
  detections: string[];
  developments: { title: string; materiality_label: string; materiality_rule: string | null; needs_attention: boolean; sources: number }[];
  fixed_states: Schema<"FixedState">[];
  peg: { question_id: string; state: string; summary: string; state_rules: string[] };
  prices: Schema<"Observation">[];
}

/** Runs `uv run im check <name>` in api/ and returns what it prints. */
const imCheck = (name: string) =>
  execFileSync("uv", ["run", "im", "check", name], { cwd: path.resolve(import.meta.dirname, "../../api"), encoding: "utf8" });

/** Shows a check's JSON as the step's page, so its screenshot records the result. */
const showJson = (page: Page, value: unknown) =>
  page.setContent(`<pre style="font: 13px/1.5 ui-monospace, monospace; white-space: pre-wrap">${JSON.stringify(value, null, 2)}</pre>`);

/** Claude-backed actions (Generate, custom question drafts) can take minutes. */
const LLM_TIMEOUT = 6 * 60_000;

async function unwrap<T>(request: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  const { data, error, response } = await request;
  if (error !== undefined || data === undefined) {
    throw new Error(`${response.url} answered ${response.status}: ${JSON.stringify(error)}`);
  }
  return data;
}

async function deleted(request: Promise<{ response: Response }>) {
  const { response } = await request;
  if (!response.ok && response.status !== 404) throw new Error(`${response.url} answered ${response.status}`);
}

const grid = (scope: Page | Locator) => scope.locator(".dash-grid [data-widget-id]");

async function widgetIds(scope: Page | Locator): Promise<string[]> {
  return grid(scope).evaluateAll((els) => els.map((el) => el.getAttribute("data-widget-id") ?? ""));
}

/** Presses on `from`, drags past the threshold, and drops on the right half of `to`: widgets or sidebar rows. */
async function drag(page: Page, from: Locator, to: Locator) {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (!a || !b) throw new Error("drag: widget not on screen");
  const start = { x: a.x + a.width / 2, y: a.y + Math.min(a.height / 2, 60) };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 12, start.y + 4, { steps: 3 });
  await page.mouse.move(b.x + b.width * 0.8, b.y + Math.min(b.height / 2, 60), { steps: 20 });
  await page.mouse.up();
}

const isPut = (url: string) => (r: { url(): string; request(): { method(): string } }) =>
  r.url() === url && r.request().method() === "PUT";

test("IntelMonitor POC walkthrough", async ({ page, baseURL }, testInfo) => {
  test.setTimeout(30 * 60_000);
  const dir = runDir();
  mkdirSync(path.join(dir, "steps"), { recursive: true });
  const apiBase = new URL("/", API_URL).href;
  const cleanups: (() => Promise<void>)[] = [];
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

  // What the pipeline produced: the latest run, and the entity with the most new developments.
  const runs = await unwrap(api.GET("/runs"));
  const latest = runs[0];
  expect(latest, "the pipeline has a run").toBeTruthy();
  expect(latest.previous_run_id, "the latest run has a run to compare against").toBeTruthy();
  const subjects = await unwrap(api.GET("/subjects"));
  const entity = [...subjects]
    .filter((s) => s.type === "entity")
    .sort((a, b) => b.new_developments - a.new_developments)[0];
  expect(entity.new_developments, "some entity has new developments").toBeGreaterThan(0);
  const dashboards = await unwrap(api.GET("/dashboards"));
  const starter = dashboards.find((d) => d.name === "Singapore banks");
  if (!starter) throw new Error("the Singapore banks starter dashboard is missing");
  const stamp = path.basename(dir);
  // Creating a dashboard follows its subjects; the cleanup, which runs last, puts the follows back.
  const followsAtStart = new Set((await unwrap(api.GET("/follows"))).map((f) => f.id));
  cleanups.push(async () => {
    for (const f of await unwrap(api.GET("/follows"))) {
      if (!followsAtStart.has(f.id)) await unwrap(api.DELETE("/follows/{subject_id}", { params: { path: { subject_id: f.id } } }));
    }
    for (const id of followsAtStart) await unwrap(api.PUT("/follows/{subject_id}", { params: { path: { subject_id: id } } }));
  });

  // The first-run tour would cover the page: the run marks it seen, and puts the profile back after.
  const profileAtStart = await unwrap(api.GET("/profile"));
  cleanups.push(async () => void (await unwrap(api.PUT("/profile", { body: profileAtStart }))));
  if (!profileAtStart.tour_seen_at) {
    await unwrap(api.PUT("/profile", { body: { ...profileAtStart, tour_seen_at: new Date().toISOString() } }));
  }

  try {
    await step(STEPS[0], async () => {
      await page.goto("/");
      const nav = page.getByRole("navigation", { name: "Main" });
      await nav.getByRole("link", { name: "Singapore banks", exact: true }).click();
      await expect(page).toHaveURL(`/dashboards/${starter.id}`);
      await expect(page.getByRole("heading", { level: 1, name: "Singapore banks" })).toBeVisible();

      const data = await unwrap(
        api.GET("/dashboards/{dashboard_id}/data", { params: { path: { dashboard_id: starter.id } } }),
      );
      const since = data.find((w) => w.type === "since");
      if (since?.type !== "since") throw new Error("the Singapore banks dashboard has no Since your last review widget");
      expect(since.run.id).toBe(latest.id);
      expect(since.run.previous_run_id).toBe(latest.previous_run_id);
      const wc = since.what_changed;
      expect(wc.new_count + wc.updated_count, "Run 2 has changes against Run 1").toBeGreaterThan(0);

      const widget = page.getByRole("group", { name: "Since your last review" });
      await expect(widget.locator(".hero")).toHaveText(new RegExp(`^${wc.new_count} new, ${wc.needs_attention_count} needs? attention$`));
      const meta = `Run of ${shortDate(latest.as_of)} against ${shortDate(latest.previous_run_id ?? "")}`;
      await expect(widget.locator(".wm")).toHaveText(meta);
      // Rows are what changed since the review and is not dismissed: needing attention, then unread new.
      const current = wc.developments.filter((d) => d.unreviewed && !d.dismissed);
      const first = current.find((d) => d.needs_attention) ?? current.find((d) => d.change === "new" && !d.read);
      if (!first) throw new Error("the Since widget has no rows");
      await expect(widget.locator(".row.dev").first()).toContainText(first.title);

      // Show all opens the dashboard's What changed, with the widget's counts.
      await widget.getByRole("link", { name: "Show all" }).click();
      await expect(page).toHaveURL(`/developments?dashboard=${starter.id}&changed=1`);
      const changes = page.locator(".dv-table");
      await expect(changes.locator(".mon-lead")).toHaveText(changeCounts(wc));
      // The switch counts what is still new: the counts line's developments, not the read ones listed.
      const unreadCount = current.filter((d) => !d.read).length;
      expect(unreadCount).toBe(wc.new_count + wc.updated_count);
      await expect(page.getByRole("button", { name: /^New since review / })).toHaveAccessibleName(`New since review ${unreadCount}`);
      await expect(changes.getByRole("group", { name: "Filter developments" }).getByRole("button", { name: /^All / })).toHaveAccessibleName(
        `All ${current.length}`,
      );
      await expect(changes.locator("tbody tr")).toHaveCount(current.length);
      await page.goBack();
      await expect(page).toHaveURL(`/dashboards/${starter.id}`);
    });

    await step(STEPS[1], async () => {
      const widget = page.getByRole("group", { name: "Since your last review" });
      const links = widget.locator(".row.dev a.stretch");
      const hrefs = await links.evaluateAll((els) => els.map((el) => el.getAttribute("href") ?? ""));
      // The first development whose sources carry a highlighted quote.
      let chosen: { href: string; detail: Schema<"DevelopmentDetail">; quote: string } | null = null;
      for (const href of hrefs) {
        const id = new URL(href, baseURL).searchParams.get("evidence");
        if (!id) continue;
        const detail = await unwrap(api.GET("/developments/{development_id}", { params: { path: { development_id: id } } }));
        const passage = detail.sources.flatMap((s) => s.findings).find((f) => f.passage.highlights.length > 0)?.passage;
        if (!passage) continue;
        const [h] = [...passage.highlights].sort((x, y) => x.start - y.start);
        chosen = { href, detail, quote: passage.text.slice(h.start, h.end) };
        break;
      }
      if (!chosen) throw new Error("no development on the widget has a highlighted quote");

      await widget.locator(`a.stretch[href="${chosen.href}"]`).click();
      await expect(page).toHaveURL(new RegExp(`\\?evidence=${encodeURIComponent(chosen.detail.id)}$`));
      const drawer = page.getByTestId("evidence-drawer");
      await expect(drawer.getByRole("heading", { name: "Evidence" })).toBeVisible();
      await expect(drawer.getByRole("heading", { level: 3 })).toHaveText(chosen.detail.title);
      await expect(drawer.locator(".source").first().locator("a").first()).toHaveText(chosen.detail.sources[0].title);
      const mark = drawer.locator(".source blockquote mark").first();
      await expect(mark).toBeVisible();
      await expect(mark).toHaveText(chosen.quote.trim());
      // Tinted with the --mark token, whatever color space the browser reports it in.
      const tint = await mark.evaluate((el) => {
        const probe = document.createElement("span");
        probe.style.backgroundColor = "var(--mark)";
        el.append(probe);
        const color = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return color;
      });
      expect(tint, "the --mark token resolves to a color").not.toMatch(/^(transparent|rgba\(0, 0, 0, 0\))$/);
      await expect(mark).toHaveCSS("background-color", tint);
    });

    await step(STEPS[2], async () => {
      await page.getByRole("button", { name: "Close evidence" }).click();
      await expect(page.getByTestId("evidence-drawer")).toBeHidden();
      cleanups.push(async () => {
        await unwrap(
          api.PUT("/dashboards/{dashboard_id}", {
            params: { path: { dashboard_id: starter.id } },
            body: { name: starter.name, subject_ids: starter.subject_ids, widgets: starter.widgets },
          }),
        );
      });
      const putUrl = new URL(`dashboards/${starter.id}`, apiBase).href;

      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await expect(page.getByRole("button", { name: "Done" })).toBeVisible();
      const before = await widgetIds(page);
      expect(before.length).toBeGreaterThanOrEqual(3);
      const [moving, target] = [before[1], before[2]];
      const saved = page.waitForResponse(isPut(putUrl));
      await drag(page, page.locator(`[data-widget-id="${moving}"]`), page.locator(`[data-widget-id="${target}"]`));
      expect((await saved).ok()).toBe(true);
      const dragged = await widgetIds(page);
      expect(dragged.indexOf(moving), "the dragged widget moved").toBeGreaterThan(dragged.indexOf(target));

      const last = dragged.at(-1) ?? "";
      const catalog = await unwrap(api.GET("/widgets/catalog"));
      const lastName = catalog.find((t) => t.type === starter.widgets.find((w) => w.id === last)?.type)?.name;
      if (!lastName) throw new Error(`widget ${last} has no catalog name`);
      const removed = page.waitForResponse(isPut(putUrl));
      await page.locator(`[data-widget-id="${last}"] button.minus`).click();
      expect((await removed).ok()).toBe(true);
      await expect(page.getByText(`Removed ${lastName}`, { exact: true })).toBeVisible();
      const expected = dragged.filter((id) => id !== last);
      await expect.poll(() => widgetIds(page)).toEqual(expected);

      await page.reload();
      await expect(page.getByRole("heading", { level: 1, name: "Singapore banks" })).toBeVisible();
      await expect.poll(() => widgetIds(page)).toEqual(expected);
    });

    await step(STEPS[3], async () => {
      const nav = page.getByRole("navigation", { name: "Main" });
      await nav.getByRole("button", { name: "New dashboard" }).click();
      const dialog = page.getByRole("dialog", { name: "New dashboard" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("tab", { name: "Build" })).toHaveAttribute("aria-selected", "true");

      // An empty draft opens on the gallery; after that, Add widget brings it back.
      const gallery = dialog.locator(".nd-gallery");
      for (let i = 0; i < 3; i++) {
        if (i > 0) await dialog.getByRole("button", { name: "Add widget", exact: true }).click();
        await expect(gallery).toBeVisible();
        if (i === 0) await gallery.locator("button.subj", { has: page.getByText(entity.name, { exact: true }) }).click();
        await expect(gallery.getByRole("heading", { level: 3 })).toHaveText(entity.name);
        const add = gallery
          .locator('section.offer:not([aria-label="Custom question"])')
          .nth(i)
          .getByRole("button", { name: /^Add / });
        await expect(add).toBeEnabled();
        await add.click();
        await expect(gallery).toBeHidden();
        await expect(grid(dialog)).toHaveCount(i + 1);
      }

      const before = await widgetIds(dialog);
      await drag(page, dialog.locator(`[data-widget-id="${before[0]}"]`), dialog.locator(`[data-widget-id="${before[1]}"]`));
      await expect.poll(() => widgetIds(dialog)).not.toEqual(before);
      const order = await widgetIds(dialog);

      const name = `E2E Build ${stamp}`;
      await dialog.getByLabel("Name").fill(name);
      await dialog.getByRole("button", { name: "Create dashboard" }).click();
      await expect(dialog).toBeHidden();
      await expect(page).toHaveURL(/\/dashboards\/[0-9a-f]+$/);
      const id = new URL(page.url()).pathname.split("/").at(-1) ?? "";
      cleanups.push(() => deleted(api.DELETE("/dashboards/{dashboard_id}", { params: { path: { dashboard_id: id } } })));
      await expect(nav.getByRole("link", { name, exact: true })).toHaveAttribute("aria-current", "page");
      await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
      await expect.poll(() => widgetIds(page)).toEqual(order);
      const created = await unwrap(api.GET("/dashboards/{dashboard_id}", { params: { path: { dashboard_id: id } } }));
      expect(created.widgets.map((w) => w.id)).toEqual(order);
    });

    await step(STEPS[4], async () => {
      const nav = page.getByRole("navigation", { name: "Main" });
      await nav.getByRole("button", { name: "New dashboard" }).click();
      const dialog = page.getByRole("dialog", { name: "New dashboard" });
      await dialog.getByRole("tab", { name: "Generate" }).click();
      const prompt = dialog.getByLabel("Describe your dashboard");
      await expect(prompt).toBeFocused();
      const ask = `Track ${entity.name}: what changed since my last review, its standing questions and recent developments`;
      const undo = dialog.getByRole("button", { name: "Undo" });
      const keep = dialog.getByRole("button", { name: "Keep" });
      const failure = dialog.locator(".nd-error");

      // The first request dies on the way, as when Chrome aborts it on a network change; the
      // prompt is sent again and generates.
      let dropped = 0;
      await page.route(`${apiBase}agent/generate`, (route) => (dropped++, route.abort("connectionreset")), { times: 1 });
      await prompt.fill(ask);
      await prompt.press("Enter");
      await expect(undo.or(failure)).toBeVisible({ timeout: LLM_TIMEOUT });
      await expect(failure).toBeHidden();
      expect(dropped, "the first Generate request was dropped").toBe(1);
      const first = await grid(dialog).count();
      expect(first, "the agent added widgets").toBeGreaterThan(0);
      // The summary counts the widgets the draft gained, never Claude's own sentence.
      await expect(dialog.locator(".nd-thread summary b")).toHaveText(`Added ${plural(first, "widget")}`);

      await undo.click();
      await expect(grid(dialog)).toHaveCount(0);
      await expect(dialog.locator(".nd-thread b")).toHaveText("Undone.");

      await prompt.fill(ask);
      await prompt.press("Enter");
      await expect(keep.or(failure)).toBeVisible({ timeout: LLM_TIMEOUT });
      await expect(failure).toBeHidden();
      await expect.poll(() => grid(dialog).count()).toBeGreaterThan(0);
      const order = await widgetIds(dialog);
      await keep.click();
      await expect(keep).toBeHidden();

      // The Build dashboard from the previous step is still open, so wait for the URL to change.
      const buildUrl = page.url();
      await dialog.getByRole("button", { name: "Create dashboard" }).click();
      await expect(dialog).toBeHidden();
      await expect(page).not.toHaveURL(buildUrl);
      await expect(page).toHaveURL(/\/dashboards\/[0-9a-f]+$/);
      const id = new URL(page.url()).pathname.split("/").at(-1) ?? "";
      cleanups.push(() => deleted(api.DELETE("/dashboards/{dashboard_id}", { params: { path: { dashboard_id: id } } })));
      const created = await unwrap(api.GET("/dashboards/{dashboard_id}", { params: { path: { dashboard_id: id } } }));
      expect(created.widgets.map((w) => w.id)).toEqual(order);
      await expect(nav.getByRole("link", { name: created.name, exact: true })).toHaveAttribute("aria-current", "page");
      await expect.poll(() => widgetIds(page)).toEqual(order);
    });

    await step(STEPS[5], async () => {
      const search = page.getByRole("combobox", { name: "Search" });
      await page.locator("body").click({ position: { x: 5, y: 5 } });
      await page.keyboard.press("ControlOrMeta+k");
      await expect(search).toBeFocused();
      await search.pressSequentially(entity.name, { delay: 40 });
      await expect(page.getByRole("option").first()).toContainText(entity.name);
      await search.press("Enter");
      await expect(page).toHaveURL(`/monitors/${entity.id}`);
      await expect(page.getByRole("heading", { level: 1, name: entity.name, exact: true })).toBeVisible();

      // Mark reviewed moves the review watermark: What changed folds away until Undo.
      const before = await unwrap(api.GET("/subjects/{subject_id}/page", { params: { path: { subject_id: entity.id } } }));
      const wc = before.what_changed;
      const changes = page.getByRole("region", { name: "What changed since last review" });
      await expect(changes.locator(".mon-lead")).toHaveText(changeCounts(wc));
      const actions = page.getByRole("region", { name: "Actions" });
      const reviewed = page.waitForResponse((r) => r.url().endsWith("/reviews") && r.request().method() === "POST");
      await actions.getByRole("button", { name: "Mark reviewed" }).click();
      expect((await reviewed).ok()).toBe(true);
      const cleared = wc.new_count + wc.updated_count;
      const reviewToast = page.locator(".toast", { hasText: `${entity.name} marked reviewed.` });
      await expect(reviewToast).toHaveText(new RegExp(`^${entity.name} marked reviewed\\.${cleared ? ` ${cleared} new cleared\\.` : ""}Undo$`));
      await expect(changes.locator(".mon-lead")).toHaveText("Nothing new since your review");
      await expect(changes.getByRole("button", { name: new RegExp(`^Run of ${shortDate(latest.as_of)} · `) })).toHaveAttribute("aria-expanded", "false");
      await expect(actions.getByText(/^Reviewed today at /)).toBeVisible();
      await expect(actions.getByRole("button", { name: "Mark reviewed" })).toBeDisabled();
      // The sidebar's count of new developments goes with the review, and comes back with Undo.
      const sidebarCount = page.locator(`nav a.navitem[href="/monitors/${entity.id}"] .count`);
      await expect(sidebarCount).toHaveCount(0);
      await reviewToast.getByRole("button", { name: "Undo" }).click();
      await expect(changes.locator(".mon-lead")).toHaveText(changeCounts(wc));
      await expect(actions.getByRole("button", { name: "Mark reviewed" })).toBeEnabled();
      await expect(sidebarCount).toHaveText(String(entity.new_developments));

      const text = `E2E note ${stamp}`;
      cleanups.push(async () => {
        const notes = await unwrap(api.GET("/notes", { params: { query: { subject_id: entity.id } } }));
        for (const n of notes.filter((n) => n.text === text)) {
          await deleted(api.DELETE("/notes/{note_id}", { params: { path: { note_id: n.id } } }));
        }
      });
      await actions.getByRole("textbox", { name: "Note" }).fill(text);
      await actions.getByRole("button", { name: "Add note" }).click();
      const note = actions.locator(".note", { hasText: text });
      await expect(note).toBeVisible();
      await expect(actions.getByRole("textbox", { name: "Note" })).toHaveValue("");

      // Deleting is a soft delete: the toast's Undo restores the note. The toast waits while the
      // pointer is over it, well past its 8 s.
      await note.getByRole("button", { name: "Delete note" }).click();
      await expect(note).toHaveCount(0);
      const toast = page.locator(".toast", { hasText: "Deleted note" });
      await toast.hover();
      await page.waitForTimeout(9_000);
      await expect(toast).toBeVisible();
      await toast.getByRole("button", { name: "Undo" }).click();
      await expect(note).toBeVisible();

      // Left alone, it shows for 8 s, longer than a plain Undo toast's 5 s, and then goes.
      await note.getByRole("button", { name: "Delete note" }).click();
      await expect(note).toHaveCount(0);
      await page.mouse.move(700, 150);
      await page.waitForTimeout(6_000);
      await expect(toast).toBeVisible();
      await expect(toast).toHaveCount(0, { timeout: 4_000 });

      // In a window only as tall as the rail, the rail cannot fit under the top bar: scrolling to
      // where its foot would show brings Add note into view instead of leaving it pinned below.
      const main = page.locator("main.main");
      const railBox = async () => {
        await main.evaluate((m) => m.scrollTo(0, 0));
        const box = await page.locator(".mon-rail").boundingBox();
        if (!box) throw new Error("the monitor rail is not on screen");
        return box;
      };
      await page.setViewportSize({ width: 1440, height: Math.round((await railBox()).height) });
      const rail = await railBox();
      await main.evaluate((m, foot) => m.scrollTo(0, foot - m.clientHeight + 24), rail.y + rail.height);
      await expect(actions.getByRole("button", { name: "Add note" })).toBeInViewport({ ratio: 1 });
      await page.setViewportSize({ width: 1440, height: 900 });
    });

    await step(STEPS[6], async () => {
      const devPath = (id: string) => ({ params: { path: { development_id: id } } });
      const whatChanged = () => unwrap(api.GET("/what-changed", { params: { query: { subject_id: [entity.id] } } }));
      const start = await whatChanged();
      const listed = start.developments.filter((d) => d.unreviewed);
      // Put back every development this step touches as it was.
      const touched = new Map<string, Schema<"TriageChange">>();
      const remember = (id: string, state: Schema<"TriageChange">) => {
        if (!touched.has(id)) touched.set(id, state);
      };
      const stateOf = (x: Schema<"ChangedDevelopment">) => ({ read: x.read, flagged: x.flagged, dismissed: x.dismissed });
      cleanups.push(async () => {
        for (const [id, change] of touched) {
          await unwrap(api.PATCH("/developments/{development_id}/triage", { ...devPath(id), body: change }));
        }
      });
      const count = (filter: (d: (typeof listed)[number]) => boolean) => listed.filter(filter).length;
      const changes = page.getByRole("region", { name: "What changed since last review" });
      const filters = changes.getByRole("group", { name: "Filter developments" });
      const filterButton = (label: string) => filters.getByRole("button", { name: new RegExp(`^${label} \\d+$`) });
      await expect(filterButton("All")).toHaveAccessibleName(`All ${count((d) => !d.dismissed)}`);
      await expect(filterButton("Unread")).toHaveAccessibleName(`Unread ${count((d) => !d.read && !d.dismissed)}`);
      const rows = changes.locator(".row.triage");
      expect(await rows.count(), "What changed lists developments to triage").toBeGreaterThan(1);

      // Keyboard: Tab from a row's title reaches its actions, which replace the date while focus is in the row.
      const row = rows.first();
      const title = (await row.locator(".row-title").textContent()) ?? "";
      const d = listed.find((x) => x.title === title);
      if (!d) throw new Error(`no listed development is titled ${title}`);
      expect(d.flagged, "the first row starts unflagged").toBe(false);
      remember(d.id, stateOf(d));
      await expect(row.locator(".triage-date")).toBeVisible();
      await expect(row.locator(".triage-acts")).toBeHidden();
      await row.locator("a.stretch").focus();
      const readLabel = d.read ? "Mark unread" : "Mark read";
      for (let i = 0; i < 8 && (await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))) !== readLabel; i++) {
        await page.keyboard.press("Tab");
      }
      await expect(row.getByRole("button", { name: readLabel })).toBeFocused();
      await expect(row.locator(".triage-date")).toBeHidden();

      // Flag by keyboard: the row stays, Flagged counts it.
      await page.keyboard.press("Tab");
      const flag = row.getByRole("button", { name: "Flag" });
      await expect(flag).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(flag).toHaveAttribute("aria-pressed", "true");
      await expect(filterButton("Flagged")).toHaveAccessibleName(`Flagged ${count((x) => x.flagged && !x.dismissed) + 1}`);
      await expect.poll(async () => (await whatChanged()).developments.find((x) => x.id === d.id)?.flagged).toBe(true);

      // Dismiss by keyboard: the row leaves All and focus moves to Dismiss on the row after it.
      const next = (await rows.nth(1).locator(".row-title").textContent()) ?? "";
      await page.keyboard.press("Tab");
      await expect(row.getByRole("button", { name: "Dismiss" })).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(rows.first().locator(".row-title")).toHaveText(next);
      await expect(rows.first().getByRole("button", { name: "Dismiss" })).toBeFocused();
      await expect(filterButton("Dismissed")).toHaveAccessibleName(`Dismissed ${count((x) => x.dismissed) + 1}`);

      // The Dismissed filter lists it, and Dismiss again brings it back to All.
      await filterButton("Dismissed").click();
      const dismissed = rows.filter({ hasText: title });
      await expect(dismissed).toHaveCount(1);
      await dismissed.hover();
      await expect(dismissed.getByRole("button", { name: "Dismiss" })).toHaveAttribute("aria-pressed", "true");
      await dismissed.getByRole("button", { name: "Dismiss" }).click();
      await expect(dismissed).toHaveCount(0);
      await filterButton("All").click();
      await expect(rows.filter({ hasText: title })).toHaveCount(1);

      // Unread: Mark read takes the row out of the list and one off the subject's count in the sidebar.
      await filterButton("Unread").click();
      const unread = count((x) => !x.read && !x.dismissed);
      if (unread > 0) {
        const target = rows.first();
        const targetTitle = (await target.locator(".row-title").textContent()) ?? "";
        const t = listed.find((x) => x.title === targetTitle);
        if (!t) throw new Error(`no listed development is titled ${targetTitle}`);
        remember(t.id, stateOf(t));
        await target.hover();
        await target.getByRole("button", { name: "Mark read" }).click();
        await expect(rows.filter({ hasText: targetTitle })).toHaveCount(0);
        await expect(filterButton("Unread")).toHaveAccessibleName(`Unread ${unread - 1}`);
        const sidebarCount = page.locator(`nav a.navitem[href="/monitors/${entity.id}"] .count`);
        if (entity.new_developments > 1) await expect(sidebarCount).toHaveText(String(entity.new_developments - 1));
        else await expect(sidebarCount).toHaveCount(0);
      }
      await filterButton("All").click();

      // Follow: the page head toggles it and the alerts popover counts followed subjects.
      const follows = await unwrap(api.GET("/follows"));
      const following = follows.some((f) => f.id === entity.id);
      cleanups.push(async () => {
        const params = { params: { path: { subject_id: entity.id } } };
        await unwrap(following ? api.PUT("/follows/{subject_id}", params) : api.DELETE("/follows/{subject_id}", params));
      });
      const followButton = page.getByRole("button", { name: following ? "Following" : "Follow", exact: true });
      await expect(followButton).toHaveAttribute("aria-pressed", String(following));
      await followButton.click();
      const toggled = page.getByRole("button", { name: following ? "Follow" : "Following", exact: true });
      await expect(toggled).toHaveAttribute("aria-pressed", String(!following));
      const followedNow = follows.length + (following ? -1 : 1);
      await expect.poll(async () => (await unwrap(api.GET("/follows"))).length).toBe(followedNow);
      const bell = page.getByRole("button", { name: /^Alerts/ });
      await bell.click();
      const popover = page.getByRole("dialog", { name: "Alerts" });
      await expect(popover.locator(".pop-foot")).toContainText(`From ${followedNow} followed subject`);

      // Alerts: per-item Mark unread counts on the bell, and opening the alert reads it again.
      const alerts = await unwrap(api.GET("/alerts"));
      const alert = alerts.alerts[0];
      if (alert) {
        remember(alert.id, { read: alert.read });
        const alertRow = popover.locator(".alert-row").filter({ hasText: alert.title }).first();
        if (alert.read) {
          await alertRow.hover();
          await alertRow.getByRole("button", { name: "Mark unread" }).click();
          await expect(alertRow.getByRole("img", { name: "Unread" })).toBeVisible();
          await expect(bell).toHaveAccessibleName(`Alerts, ${alerts.unread.total + 1} unread`);
        }
        await alertRow.locator(".alert-body").click();
        await expect(page).toHaveURL(new RegExp(`[?&]evidence=${encodeURIComponent(alert.id)}$`));
        await expect(page.getByTestId("evidence-drawer").getByRole("heading", { level: 3 })).toHaveText(alert.title);
        await expect.poll(async () => (await unwrap(api.GET("/alerts"))).alerts.find((a) => a.id === alert.id)?.read).toBe(true);
        await expect(bell).toHaveAccessibleName(
          alerts.unread.total - (alert.read ? 0 : 1) ? `Alerts, ${alerts.unread.total - (alert.read ? 0 : 1)} unread` : "Alerts",
        );
        await page.getByRole("button", { name: "Close evidence" }).click();
      } else {
        await page.keyboard.press("Escape");
      }
      await followButton.or(toggled).first().click();
      await expect(page.getByRole("button", { name: following ? "Following" : "Follow", exact: true })).toBeVisible();
    });

    await step(STEPS[7], async () => {
      const slots = await unwrap(api.GET("/custom-questions/slots"));
      expect(slots.left, "a custom question slot is free").toBeGreaterThan(0);
      const questions = page.getByRole("region", { name: "Standing questions" });
      await questions.getByRole("button", { name: "Add a question" }).click();
      const drafted = page.waitForResponse(
        (r) => r.url() === new URL("custom-questions", apiBase).href && r.request().method() === "POST",
        { timeout: LLM_TIMEOUT },
      );
      await questions
        .getByLabel(`Your question about ${entity.name}`)
        .fill(`What were the most material developments for ${entity.name} in this period, and what risks do they raise?`);
      await questions.getByRole("button", { name: "Draft question" }).click();
      const response = await drafted;
      expect(response.ok(), await response.text()).toBe(true);
      const draft: Schema<"CustomQuestion"> = await response.json();
      cleanups.push(() =>
        deleted(api.DELETE("/custom-questions/{question_id}", { params: { path: { question_id: draft.id } } })),
      );

      const preview = questions.getByRole("group", { name: "Custom question preview" });
      await expect(preview).toBeVisible();
      await expect(preview.locator(".cq-run")).toHaveCount(draft.runs.length);
      await expect(preview.locator(".cq-cites")).toContainText(/^Cites \d+ developments?/);
      expect(draft.evidence.length, "the preview cites developments").toBeGreaterThan(0);
      await preview.getByRole("button", { name: "Keep" }).click();
      await expect(page.getByText(`${draft.label} added to ${entity.name}`)).toBeVisible();

      const row = questions.locator(`.qrow[data-question-id="${draft.id}"]`);
      await expect(row.locator(".badge", { hasText: /^Custom$/ })).toBeVisible();
      await expect(row.locator(".qlabel b")).toHaveText(draft.label);
      const latestAnswer = draft.runs.at(-1);
      if (!latestAnswer) throw new Error("the custom question has no answers");
      await expect(row.locator(".qanswer p")).toHaveText(answerText(latestAnswer.summary));
      await row.getByRole("link", { name: "See evidence" }).click();

      const drawer = page.getByTestId("evidence-drawer");
      await expect(drawer.locator(".badge", { hasText: /^Custom$/ })).toBeVisible();
      await expect(drawer.getByRole("heading", { level: 3 })).toHaveText(answerText(latestAnswer.summary));
      await expect(drawer.getByRole("heading", { level: 4 }).first()).toHaveText(/^Based on \d+ developments?$/);
      await expect(drawer.locator(".ev-dev").first()).toBeVisible();
      await expect(drawer.locator(".source blockquote mark").first()).toBeVisible();
      await drawer.getByRole("button", { name: "Close evidence" }).click();
      await expect(drawer).toBeHidden();
    });

    await step(STEPS[8], async () => {
      await page.getByRole("region", { name: "Links" }).getByRole("link", { name: "Open graph view" }).click();
      await expect(page).toHaveURL(`/monitors/${entity.id}/graph`);
      const stage = page.getByTestId("graph-canvas");
      const listed = page.getByTestId("graph-nodes").locator("[data-node]");
      await expect(stage).toHaveAttribute("data-layout", "settled", { timeout: 30_000 });
      const oneHop = await listed.count();
      expect(oneHop).toBeGreaterThan(0);

      const hops = page.getByRole("group", { name: "Hops" });
      await hops.getByRole("button", { name: "2 hops" }).click();
      await expect(hops.getByRole("button", { name: "2 hops" })).toHaveAttribute("aria-pressed", "true");
      await expect.poll(() => listed.count()).toBeGreaterThan(oneHop);
      // Rows sit under "<Type>, 2 hops" group headings.
      await expect(page.getByTestId("graph-nodes").getByRole("heading", { level: 3, name: /, 2 hops/ }).first()).toBeVisible();
      await expect(stage).toHaveAttribute("data-layout", "settled", { timeout: 30_000 });

      // Only subject nodes, so any node the pointer finds opens a monitor page.
      await page.getByRole("button", { name: "Nodes: All" }).click();
      const developments = page.getByRole("group", { name: "Nodes shown" }).getByRole("checkbox", { name: "Developments" });
      await developments.uncheck();
      await expect(developments).not.toBeChecked();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("group", { name: "Nodes shown" })).toBeHidden();
      await expect(page.getByTestId("graph-nodes").locator('[data-node^="dev:"]')).toHaveCount(0);
      await expect(stage).toHaveAttribute("data-layout", "settled", { timeout: 30_000 });

      const hit = await findNode(page, stage, entity.id);
      await page.mouse.click(hit.x, hit.y);
      await expect(page).toHaveURL(/\/monitors\/[^/?]+$/);
      const opened = new URL(page.url()).pathname.split("/").at(-1) ?? "";
      expect(opened).not.toBe(entity.id);
      const subject = await unwrap(api.GET("/subjects/{subject_id}", { params: { path: { subject_id: opened } } }));
      await expect(page.getByRole("heading", { level: 1, name: subject.name, exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "What changed since last review" })).toBeVisible();
    });

    await step(STEPS[9], async () => {
      const before = await unwrap(api.GET("/dashboards"));
      expect(before.length, "at least three dashboards to reorder").toBeGreaterThanOrEqual(3);
      const colors = new Map(before.map((d) => [d.id, d.color]));
      cleanups.push(async () => {
        await unwrap(api.PUT("/dashboards/order", { body: before.map((d) => d.id) }));
      });
      const orderUrl = new URL("dashboards/order", apiBase).href;
      const nav = page.getByRole("navigation", { name: "Main" });
      const rows = nav.locator(".dashrow");
      const order = () => rows.evaluateAll((els) => els.map((el) => el.getAttribute("data-dashboard-id") ?? ""));
      const ids = before.map((d) => d.id);
      await expect.poll(order).toEqual(ids);

      // Drag the last dashboard to the top; the drop saves the order and does not open the dashboard.
      const url = page.url();
      const dropped = page.waitForResponse(isPut(orderUrl));
      await drag(page, rows.last(), rows.first());
      expect((await dropped).ok()).toBe(true);
      expect(page.url()).toBe(url);
      const afterDrag = [ids.at(-1) ?? "", ...ids.slice(0, -1)];
      await expect.poll(order).toEqual(afterDrag);

      // Keyboard: Move up from the options popover keeps focus on the button as the row moves.
      const second = before.find((d) => d.id === afterDrag[1]);
      if (!second) throw new Error("the second dashboard is missing");
      await nav.getByRole("button", { name: `Options for ${second.name}`, exact: true }).first().click();
      const moveUp = page.getByRole("dialog", { name: `Edit ${second.name}` }).getByRole("button", { name: "Move up" });
      const moved = page.waitForResponse(isPut(orderUrl));
      await moveUp.focus();
      await page.keyboard.press("Enter");
      expect((await moved).ok()).toBe(true);
      const afterMove = [afterDrag[1], afterDrag[0], ...afterDrag.slice(2)];
      await expect.poll(order).toEqual(afterMove);
      await expect(moveUp).toBeFocused();
      await expect(moveUp).toHaveAttribute("aria-disabled", "true");
      await page.keyboard.press("Escape");

      // The order persists and every dashboard keeps its color.
      await page.reload();
      await expect.poll(order).toEqual(afterMove);
      const saved = await unwrap(api.GET("/dashboards"));
      expect(saved.map((d) => [d.id, d.color])).toEqual(afterMove.map((id) => [id, colors.get(id)]));
      const dots = await rows.evaluateAll((els) =>
        els.map((el) => (el.querySelector<HTMLElement>(".dash-dot")?.style.background ?? "")),
      );
      expect(dots).toEqual(afterMove.map((id) => `var(--dash-${colors.get(id)})`));
    });

    await step(STEPS[10], async () => {
      // A word from a latest-run development title that finds developments and documents.
      const all = (await unwrap(api.GET("/developments", { params: { query: { limit: 20 } } }))).developments;
      const words = [...new Set(all.flatMap((d) => d.title.match(/\b[A-Za-z]{6,}\b/g) ?? []))];
      let found: { word: string; results: Schema<"SearchResults"> } | null = null;
      for (const word of words) {
        const results = await unwrap(api.GET("/search", { params: { query: { q: word } } }));
        if (results.developments.length && results.documents.length) {
          found = { word, results };
          break;
        }
      }
      if (!found) throw new Error("no title word finds both developments and documents");
      const { word, results } = found;
      const search = page.getByRole("combobox", { name: "Search" });
      const list = page.getByRole("listbox", { name: "Search results" });
      const drawer = page.getByTestId("evidence-drawer");

      const development = results.developments[0];
      await page.keyboard.press("ControlOrMeta+k");
      await search.pressSequentially(word, { delay: 20 });
      const devOption = list.getByRole("group", { name: "Developments" }).getByRole("option").first();
      await expect(devOption).toContainText(development.title);
      await devOption.click();
      await expect(page).toHaveURL(new RegExp(`[?&]evidence=${encodeURIComponent(development.id)}$`));
      await expect(drawer.getByRole("heading", { level: 3 })).toHaveText(development.title);

      // Document snippets are a passage of body text: no markdown, and not the title again.
      for (const d of results.documents) {
        expect(d.snippet, d.title).not.toMatch(/^[#>*-]|\*\*|\]\(/);
        expect(d.snippet.toLowerCase(), d.title).not.toContain(d.title.toLowerCase());
      }
      const document = results.documents[0];
      await page.keyboard.press("ControlOrMeta+k");
      await search.pressSequentially(word, { delay: 20 });
      const docOption = list.getByRole("group", { name: "Documents" }).getByRole("option").first();
      await expect(docOption).toContainText(document.title);
      await expect(docOption.locator(".alias")).toHaveText(document.snippet);
      await docOption.click();
      await expect(page).toHaveURL(new RegExp(`[?&]evidence=${encodeURIComponent(document.development_id)}$`));
      await expect(drawer.locator(".source a").filter({ hasText: document.title }).first()).toBeVisible();
    });

    await step(STEPS[11], async () => {
      // Mark wrong under a built-in answer that cites developments: the form opens in the row.
      const monitor = await unwrap(api.GET("/subjects/{subject_id}/page", { params: { path: { subject_id: entity.id } } }));
      const answer = monitor.questions.find((a) => !a.custom && a.development_ids.length > 0 && !a.feedback);
      if (!answer) throw new Error(`${entity.name} has no built-in answer citing developments`);
      const answerPath = { params: { path: { subject_id: entity.id, question_id: answer.question_id } } };
      const devPath = { params: { path: { development_id: answer.development_ids[0] } } };
      // Corrections are rows in the feedback table; the cleanup deletes any this run left.
      cleanups.push(async () => {
        const { feedback } = (await unwrap(api.GET("/subjects/{subject_id}/answers/{question_id}/evidence", answerPath))).answer;
        const tags = (await unwrap(api.GET("/developments/{development_id}", devPath))).tag_feedback;
        for (const f of [...(feedback ? [feedback] : []), ...tags].filter((f) => f.reason.includes(stamp))) {
          await deleted(api.DELETE("/feedback/{feedback_id}", { params: { path: { feedback_id: f.id } } }));
        }
      });
      const target = answer.state === "stable" ? "watch" : "stable";
      await page.goto(`/monitors/${entity.id}`);
      const row = page.locator(`[data-question-id="${answer.question_id}"]`);
      await row.getByRole("button", { name: "Mark wrong" }).click();
      const form = row.getByRole("form", { name: "Mark answer wrong" });
      await expect(form.getByRole("checkbox", { name: "State" })).toBeFocused();
      await expect(form.getByRole("button", { name: "Send" })).toBeDisabled();
      await form.getByRole("checkbox", { name: "State" }).check();
      await form.getByRole("combobox", { name: "What the state should be" }).selectOption(target);
      await form.getByRole("checkbox", { name: /^Cited developments/ }).check();
      await form.getByRole("textbox", { name: "Reason" }).fill(`E2E ${stamp}: not what the sources say`);
      await form.getByRole("button", { name: "Send" }).click();
      await expect(page.locator(".toast", { hasText: "Feedback saved. The next run takes it into account." })).toBeVisible();
      const cited = plural(answer.development_ids.length, "cited development");
      const line = row.locator(".fb-line");
      await expect(line).toHaveText(`You marked this wrong today: state should be ${STATE_LABEL[target]}, ${cited}. Undo`);
      const { feedback } = (await unwrap(api.GET("/subjects/{subject_id}/answers/{question_id}/evidence", answerPath))).answer;
      expect(feedback).toMatchObject({ state: target, development_ids: answer.development_ids, answer_state: answer.state });
      await expect(line.getByRole("button", { name: "Undo" })).toBeFocused();
      await expect(row.getByRole("button", { name: "Mark wrong" })).toHaveCount(0);
      await line.getByRole("button", { name: "Undo" }).click();
      await expect(line).toHaveCount(0);
      await expect(row.getByRole("button", { name: "Mark wrong" })).toBeFocused();

      // In the evidence drawer, Escape closes the form but not the drawer.
      await row.getByRole("link", { name: "See evidence" }).click();
      const drawer = page.getByTestId("evidence-drawer");
      await drawer.getByRole("button", { name: "Mark wrong" }).click();
      await expect(drawer.getByRole("form", { name: "Mark answer wrong" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(drawer.getByRole("form", { name: "Mark answer wrong" })).toHaveCount(0);
      await expect(drawer.getByRole("button", { name: "Mark wrong" })).toBeFocused();

      // A cited development's drawer lists its tags, each with Wrong: Remove tag, then Undo.
      await drawer.locator(".ev-title a").first().click();
      await expect(page).toHaveURL(new RegExp(`[?&]evidence=${encodeURIComponent(answer.development_ids[0])}$`));
      const dev = await unwrap(api.GET("/developments/{development_id}", devPath));
      const tag = dev.subject_confidence[0].subject;
      const tagRow = drawer.locator(`[data-tag="${tag.id}"]`);
      await tagRow.getByRole("button", { name: `${tag.name} is wrong` }).click();
      const tagForm = drawer.getByRole("form", { name: `Remove the ${tag.name} tag` });
      await expect(tagForm.getByRole("textbox", { name: "Reason" })).toBeFocused();
      await tagForm.getByRole("textbox", { name: "Reason" }).fill(`E2E ${stamp}: not about ${tag.name}`);
      await tagForm.getByRole("button", { name: "Remove tag" }).click();
      await expect(tagRow).toContainText("You marked this wrong today. Removed from the next run.");
      const removed = (await unwrap(api.GET("/developments/{development_id}", devPath))).tag_feedback;
      expect(removed).toMatchObject([{ subject: { id: tag.id }, applied: false }]);
      const undo = tagRow.getByRole("button", { name: `Undo removing ${tag.name}` });
      await expect(undo).toBeFocused();
      await undo.click();
      await expect(tagRow.getByRole("button", { name: `${tag.name} is wrong` })).toBeFocused();
      expect((await unwrap(api.GET("/developments/{development_id}", devPath))).tag_feedback).toEqual([]);
    });

    await step(STEPS[12], async () => {
      await page.goto(`/dashboards/${starter.id}`);
      const profileButton = page.locator("button.profile");
      await expect(page.getByRole("dialog", { name: "Tour" }), "a seen tour does not start").toHaveCount(0);

      // ? opens Help: states, the materiality levels from the API with this run's counts, shortcuts.
      await page.keyboard.press("?");
      const help = page.getByRole("dialog", { name: "Help" });
      const states = help.getByRole("region", { name: "States" });
      await expect(states.locator(".help-row .badge")).toHaveText(["New", "Updated", "Watch", "Needs attention", "Stable"]);
      const levels = await unwrap(api.GET("/materiality-levels"));
      const attention = levels.filter((l) => l.needs_attention).map((l) => l.name).reverse().join(" or ");
      await expect(states.locator(".help-row").nth(3)).toContainText(`Rated ${attention}.`);
      const rows = help.getByRole("region", { name: "Materiality" }).locator(".help-row");
      await expect(rows.locator("b")).toHaveText(levels.map((l) => l.name));
      await expect(rows.first()).toContainText(`${levels[0].developments} this run`);
      await expect(help.getByRole("region", { name: "Keyboard shortcuts" })).toContainText("Help");

      // Replay tour: five coach marks over the dimmed dashboard, focus on each step's primary button.
      await help.getByRole("button", { name: "Replay tour" }).click();
      await expect(help).toBeHidden();
      const tour = page.getByRole("dialog", { name: "Tour" });
      const card = tour.getByRole("group");
      const next = tour.getByRole("button", { name: "Next" });
      const drawer = page.getByTestId("evidence-drawer");
      // The ring follows the drawer to where its slide-in ends.
      const ringOnDrawer = () =>
        expect
          .poll(async () => {
            const [ring, box] = await Promise.all([tour.locator(".tour-ring").boundingBox(), drawer.boundingBox()]);
            return ring && box ? Math.abs(ring.x - box.x) : null;
          })
          .toBeLessThan(2);
      const titles = ["Dashboards and monitors", "Since your last review", "Evidence", "Mark reviewed", "Generate a dashboard"];
      for (const [i, title] of titles.entries()) {
        await expect(card).toHaveAccessibleName(title);
        await expect(card).toContainText(`${i + 1} of 5`);
        const primary = tour.getByRole("button", { name: i === 4 ? "Done" : "Next" });
        await expect(primary).toBeFocused();
        if (i === 1) {
          // The ring sits on the Since widget.
          const ring = await tour.locator(".tour-ring").boundingBox();
          const since = await page.getByRole("main").getByRole("group", { name: "Since your last review" }).boundingBox();
          expect(ring && since && Math.abs(ring.x - since.x) + Math.abs(ring.y - since.y) + Math.abs(ring.width - since.width)).toBeLessThan(2);
        }
        if (i === 2) {
          await expect(page).toHaveURL(/[?&]evidence=/);
          await ringOnDrawer();
          // Back closes the drawer again.
          await tour.getByRole("button", { name: "Back" }).click();
          await expect(page).toHaveURL(`/dashboards/${starter.id}`);
          await expect(card).toHaveAccessibleName(titles[1]);
          await next.click();
          await expect(page).toHaveURL(/[?&]evidence=/);
        }
        await primary.press("Enter");
      }
      await expect(tour).toHaveCount(0);
      await expect(profileButton).toBeFocused();
      expect((await unwrap(api.GET("/profile"))).tour_seen_at, "Replay records the tour as seen").toBeTruthy();

      // From the profile menu's Help item: Esc at the evidence step ends the tour and closes the drawer.
      await profileButton.click();
      await page.getByRole("menuitem", { name: "Help" }).click();
      await help.getByRole("button", { name: "Replay tour" }).click();
      await next.click();
      await next.click();
      await expect(drawer).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(tour).toHaveCount(0);
      await expect(page).toHaveURL(`/dashboards/${starter.id}`);
      await expect(drawer).toHaveCount(0);
      await expect(profileButton).toBeFocused();

      // The step's screenshot shows the evidence step.
      await page.keyboard.press("?");
      await help.getByRole("button", { name: "Replay tour" }).click();
      await next.click();
      await next.click();
      await expect(card).toHaveAccessibleName("Evidence");
      await expect(drawer.locator(".source").first()).toBeVisible();
      await ringOnDrawer();
    });

    await step(STEPS[13], async () => {
      // The Developments widget's in-scope count opens the dashboard's developments list.
      await page.goto(`/dashboards/${starter.id}`);
      const query = { dashboard_id: starter.id };
      const all = await unwrap(api.GET("/developments", { params: { query } }));
      const widget = page.getByRole("group", { name: "Developments", exact: true });
      await widget.getByRole("link", { name: `${all.in_scope} in scope` }).click();
      await expect(page).toHaveURL(`/developments?dashboard=${starter.id}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Developments");
      await expect(page.locator(".pagehead p")).toContainText(plural(all.in_scope, "development"));
      const nav = page.getByRole("navigation", { name: "Main" });
      await expect(nav.getByRole("link", { name: starter.name, exact: true })).toHaveAttribute("aria-current", "page");
      const table = page.locator(".dv-table");
      const rows = table.locator("tbody tr");
      await expect(page.getByRole("button", { name: /^All \d+$/ })).toHaveAccessibleName(`All ${all.in_scope}`);
      await expect(rows).toHaveCount(all.in_scope);

      // Facets: each popover lists values with counts; picking one narrows the list to what it counted.
      const bar = page.getByRole("group", { name: "Filters" });
      const facet = (label: string) => bar.getByRole("button", { name: new RegExp(`^${label}`) });
      const level = all.facets.materiality[0];
      await facet("Materiality").click();
      const materiality = page.getByRole("dialog", { name: "Materiality" });
      // The URL holds the selection, so a box shows checked once the URL has it.
      const levelBox = materiality.getByRole("checkbox", { name: `${level.label} ${level.count}` });
      await levelBox.click();
      await expect(levelBox).toBeChecked();
      await expect(page).toHaveURL(new RegExp(`[?&]materiality=${level.value}(&|$)`));
      await expect(rows).toHaveCount(level.count);
      await page.keyboard.press("Escape");
      await expect(materiality).toHaveCount(0);
      await expect(facet("Materiality")).toHaveAccessibleName(`Materiality: ${level.label}`);

      const byLevel = await unwrap(api.GET("/developments", { params: { query: { ...query, materiality: [Number(level.value)] } } }));
      const place = byLevel.facets.jurisdiction[0];
      await facet("Jurisdiction").click();
      const jurisdiction = page.getByRole("dialog", { name: "Jurisdiction" });
      await expect(jurisdiction.getByRole("searchbox", { name: "Find a jurisdiction" })).toBeFocused();
      await page.keyboard.type(place.label.slice(0, 4));
      const placeBox = jurisdiction.getByRole("checkbox", { name: `${place.label} ${place.count}` });
      await placeBox.click();
      await expect(placeBox).toBeChecked();
      await expect(rows).toHaveCount(place.count);
      await page.keyboard.press("Escape");
      // The query the page sent for its URL.
      const filters = listQuery(starter.id, new URL(page.url()).searchParams);
      const narrowed = await unwrap(api.GET("/developments", { params: { query: filters } }));
      expect(narrowed.developments.every((d) => d.materiality_label === level.label && d.jurisdictions.includes(place.label))).toBe(true);

      // Sorting by Date: newest first, then oldest first on a second click.
      const dates = [...narrowed.developments.map((d) => d.last_published)].sort();
      const dateHead = table.getByRole("columnheader", { name: "Date" });
      await dateHead.getByRole("button").click();
      await expect(dateHead).toHaveAttribute("aria-sort", "descending");
      await expect(rows.first().locator("td").last()).toHaveText(shortDate(dates.at(-1) ?? ""));
      await dateHead.getByRole("button").click();
      await expect(dateHead).toHaveAttribute("aria-sort", "ascending");
      await expect(rows.first().locator("td").last()).toHaveText(shortDate(dates[0]));
      const url = page.url();
      expect(url).toContain("sort=date");

      // A reload keeps the filters and the sort, and so does the evidence drawer.
      await page.reload();
      await expect(facet("Jurisdiction")).toHaveAccessibleName(`Jurisdiction: ${place.label}`);
      await expect(rows).toHaveCount(place.count);
      await expect(dateHead).toHaveAttribute("aria-sort", "ascending");
      const first = rows.first().locator(".tt a");
      const firstTitle = (await first.textContent()) ?? "";
      await first.click();
      await expect(page).toHaveURL((u) => u.href.startsWith(`${url}&evidence=`));
      const drawer = page.getByTestId("evidence-drawer");
      await expect(drawer.getByRole("heading", { level: 3 })).toHaveText(firstTitle);
      await page.getByRole("button", { name: "Close evidence" }).click();
      await expect(page).toHaveURL(url);
      await expect(rows).toHaveCount(place.count);

      // Words narrow the list too; Clear filters puts every development back.
      const word = firstTitle.match(/\b[A-Za-z]{5,}\b/)?.[0] ?? firstTitle.split(" ")[0];
      const worded = await unwrap(api.GET("/developments", { params: { query: { ...filters, q: word } } }));
      await bar.getByRole("searchbox", { name: "Filter by words" }).fill(word);
      await expect(page).toHaveURL(new RegExp(`[?&]q=${encodeURIComponent(word)}`));
      await expect(rows).toHaveCount(worded.developments.length);
      await bar.getByRole("searchbox", { name: "Filter by words" }).fill("zzzqqq");
      await table.getByRole("button", { name: "Clear filters" }).click();
      await expect(rows).toHaveCount(all.in_scope);
      await expect(bar.getByRole("searchbox", { name: "Filter by words" })).toHaveValue("");

      // New since review: What changed with the Since widget's counts, and triage in the table.
      const wc = await unwrap(api.GET("/what-changed", { params: { query } }));
      const current = wc.developments.filter((d) => d.unreviewed && !d.dismissed);
      await page.getByRole("button", { name: /^New since review/ }).click();
      await expect(page).toHaveURL(/[?&]changed=1/);
      await expect(table.locator(".mon-lead")).toHaveText(changeCounts(wc));
      const unreadButton = table.getByRole("group", { name: "Filter developments" }).getByRole("button", { name: /^Unread / });
      const unread = current.filter((d) => !d.read);
      await expect(unreadButton).toHaveAccessibleName(`Unread ${unread.length}`);
      if (unread.length > 0) {
        await unreadButton.click();
        const row = rows.first();
        const title = (await row.locator(".tt a").textContent()) ?? "";
        const d = unread.find((x) => x.title === title);
        if (!d) throw new Error(`no unread development is titled ${title}`);
        cleanups.push(async () => {
          await unwrap(api.PATCH("/developments/{development_id}/triage", { params: { path: { development_id: d.id } }, body: { read: false } }));
        });
        await row.hover();
        await row.getByRole("button", { name: "Mark read" }).click();
        await expect(rows.filter({ hasText: title })).toHaveCount(0);
        await expect(unreadButton).toHaveAccessibleName(`Unread ${unread.length - 1}`);
        const whatChanged = () => unwrap(api.GET("/what-changed", { params: { query } }));
        await expect.poll(async () => (await whatChanged()).developments.find((x) => x.id === d.id)?.read).toBe(true);
        await expect(table.locator(".mon-lead")).toHaveText(changeCounts(await whatChanged()));
      }
    });

    await step(STEPS[14], async () => {
      const query = { dashboard_id: starter.id };
      const all = await unwrap(api.GET("/developments", { params: { query } }));
      const bar = page.getByRole("group", { name: "Filters" });
      const facet = (label: string) => bar.getByRole("button", { name: new RegExp(`^${label}`) });

      // The Date popover focuses its checked radio; tabbing out of a popover closes it.
      await page.goto(`/developments?dashboard=${starter.id}`);
      await facet("Date").focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("radio", { name: /^Any time / })).toBeFocused();
      await page.keyboard.press("Escape");
      await facet("Category").focus();
      await page.keyboard.press("Enter");
      const category = page.getByRole("dialog", { name: "Category" });
      await expect(category.getByRole("checkbox").first()).toBeFocused();
      // Through each value; Clear is disabled while nothing is picked, so the last Tab leaves.
      for (let i = 0; i < all.facets.category.length; i++) await page.keyboard.press("Tab");
      await expect(facet("Materiality")).toBeFocused();
      await expect(category).toHaveCount(0);

      // Hand-edited values the list cannot apply are ignored, and the buttons do not name them.
      await page.goto(`/developments?dashboard=${starter.id}&category=bogus&materiality=9&jurisdiction=xx&days=abc&source=foo`);
      const rows = page.locator(".dv-table tbody tr");
      await expect(rows).toHaveCount(all.in_scope);
      for (const label of ["Category", "Materiality", "Jurisdiction", "Date", "Source"]) await expect(facet(label)).toHaveAccessibleName(label);

      // At the app's narrowest width with every facet set, the bar wraps rather than push the
      // switch off screen, and nothing scrolls sideways.
      await page.setViewportSize({ width: 1024, height: 800 });
      const every = new URLSearchParams({ dashboard: starter.id, days: "30" });
      for (const id of ["category", "materiality", "jurisdiction", "source"] as const) every.append(id, all.facets[id][0].value);
      await page.goto(`/developments?${every}`);
      await expect(facet("Source")).toHaveAccessibleName(`Source: ${all.facets.source[0].label}`);
      const main = page.locator("main");
      const sideways = () => main.evaluate((m) => m.scrollWidth - m.clientWidth);
      const view = page.getByRole("group", { name: "Developments to list" });
      expect(await sideways()).toBe(0);
      expect(await view.evaluate((v) => v.getBoundingClientRect().right)).toBeLessThanOrEqual(1024);

      // What changed, whose triage actions take the widest date column: titles keep room, and
      // the column heads stick under the wrapped bar.
      await page.goto(`/developments?dashboard=${starter.id}&changed=1`);
      const title = page.locator(".dtable th").nth(1);
      await expect(title).toBeVisible();
      expect((await title.boundingBox())?.width).toBeGreaterThanOrEqual(200);
      expect(await sideways()).toBe(0);
      await main.evaluate((m) => m.scrollBy(0, 1200));
      await expect
        .poll(async () => (await title.boundingBox())?.y)
        .toBe(await bar.evaluate((b) => b.getBoundingClientRect().bottom));
      // The step's screenshot shows this narrow layout; the viewport stays at 1024 px.
    });

    await step(STEPS[15], async () => {
      // MAS quotes Asian currencies per 100 units; the store keeps SGD per one unit. Known values
      // for 18 Sep 2026, checked against FRED cross rates (structured-data-plan.md, F1).
      for (const [id, unit, value] of [
        ["fx.sgd.myr", "SGD per MYR", 0.3128],
        ["fx.sgd.thb", "SGD per THB", 0.038342],
      ] as const) {
        const one = await unwrap(
          api.GET("/series/{series_id}", { params: { path: { series_id: id }, query: { from: "2026-09-18", to: "2026-09-18" } } }),
        );
        expect(one.series.unit).toBe(unit);
        expect(one.observations.map((o) => o.value), `${id} on 18 Sep`).toEqual([value]);
      }

      // Indicators as of Run 1's date read only what was available by the end of that day, while
      // today's see later periods. Changes compare with a real earlier value, never with zero, and
      // a window shorter than the series' frequency stays empty.
      const run1 = runs.find((r) => r.id === latest.previous_run_id);
      if (!run1) throw new Error("Run 1 is not in the run history");
      const asOf = run1.as_of;
      const sampled = ["singapore-banks", "circle", "malaysia", "fed"];
      const snapshot: Record<string, Schema<"SubjectIndicators">> = {};
      let later = 0;
      for (const subjectId of sampled) {
        const subject = { subject_id: subjectId };
        const then = await unwrap(api.GET("/subjects/{subject_id}/indicators", { params: { path: subject, query: { as_of: asOf } } }));
        const now = await unwrap(api.GET("/subjects/{subject_id}/indicators", { params: { path: subject } }));
        snapshot[subjectId] = then;
        expect(then.indicators.length, `${subjectId} has series`).toBeGreaterThan(0);
        for (const [i, ind] of then.indicators.entries()) {
          const name = `${ind.series.id} as of ${asOf}`;
          if (!ind.latest) throw new Error(`${name} has no data`);
          expect(ind.latest.available_at.slice(0, 10) <= asOf, `${name} was available by then`).toBe(true);
          const today = now.indicators[i].latest;
          if (today && today.period > ind.latest.period) later++;
          for (const c of ind.changes) {
            if (c.change === null) continue;
            expect(c.since !== null && c.since < ind.latest.period, `${name} ${c.window} compares with an earlier period`).toBe(true);
            if (ind.change_basis === "percent") expect(c.from_value, `${name} ${c.window} starts from a value`).not.toBe(0);
          }
          if (ind.series.frequency !== "daily") expect(ind.changes.find((c) => c.window === "1w")?.change, `${name} has no 1w change`).toBeNull();
          expect(ind.percentile).not.toBeNull();
        }
      }
      expect(later, "today's indicators have periods Run 1 could not see").toBeGreaterThan(0);

      // Before any history, every series reads No data rather than failing.
      const before = await unwrap(
        api.GET("/subjects/{subject_id}/indicators", { params: { path: { subject_id: "circle" }, query: { as_of: "2020-01-01" } } }),
      );
      expect(new Set(before.indicators.map((i) => i.state))).toEqual(new Set(["no_data"]));

      writeFileSync(path.join(dir, "indicators.json"), JSON.stringify({ as_of: asOf, subjects: snapshot }, null, 2));
      await page.goto(new URL(`subjects/circle/indicators?as_of=${asOf}`, apiBase).href);
    });

    await step(STEPS[16], async () => {
      // `im check series` backfills every series into a scratch store from data/raw/ alone, then
      // fetches again as the daily fetch does, both at the moment of the store's fetches of 28 Sep
      // (structured-data-plan.md, F1). A request with no cached response fails instead of reaching
      // the source, so a clean pass proves the fetch path runs offline end to end.
      const check: SeriesCheck = JSON.parse(imCheck("series"));
      for (const [name, pass] of [["backfill", check.backfill], ["fetch", check.fetch]] as const) {
        expect(pass.network, `the ${name} reaches no source`).toBe(0);
        expect(pass.missed, `every ${name} request is cached`).toBe(0);
        expect(pass.cached, `the ${name} made requests`).toBeGreaterThan(0);
        expect(pass.failures, `no series fails in the ${name}`).toEqual({});
      }
      expect(check.backfill.added).toBe(check.observations);
      expect(check.series, "every series has history").toBe(check.catalogue);
      // The same responses again: nothing new, nothing revised.
      expect([check.fetch.added, check.fetch.revised]).toEqual([0, 0]);
      // Quotes per 100 units are stored per unit, the values the app serves.
      for (const v of check.per_100) {
        const served = await unwrap(
          api.GET("/series/{series_id}", { params: { path: { series_id: v.series_id }, query: { from: v.period, to: v.period } } }),
        );
        expect([v.unit, v.value], `${v.series_id} on ${v.period}`).toEqual([served.series.unit, served.observations[0]?.value]);
      }
      expect(check.per_100.map((v) => v.value)).toEqual([0.3128, 0.038342]);
      // Every replayed observation over the runs' months equals the store's as known that day.
      expect(check.compared).toBeGreaterThan(3000);
      expect(check.differences).toEqual([]);

      writeFileSync(path.join(dir, "series-fetch.json"), JSON.stringify(check, null, 2));
      await showJson(page, check);
    });

    await step(STEPS[17], async () => {
      // `im check past-run` copies the store, which holds a week of documents, observations and
      // detections after Run 1's date, among them the Fed funds rise known on 18 Sep, and
      // recomputes Run 1 in the copy through the pipeline's own steps. Every model call must replay a recorded one, so the run cannot
      // differ by chance: nothing it stores may use what became known after its date, and every
      // development, answer, note, indicator and fact must equal the stored run's.
      const check: PastRunCheck = JSON.parse(imCheck("past-run"));
      expect(check.as_of).toBe(latest.previous_run_id);
      const stored = runs.find((r) => r.as_of === check.as_of && r.status === "complete");
      if (!stored) throw new Error(`no complete run as of ${check.as_of}`);
      expect(check.later_documents, "the store holds documents from after the date").toBeGreaterThan(0);
      expect(check.later_observations, "and observations known after it").toBeGreaterThan(0);
      expect(check.later_detections, "and detections known after it").toBeGreaterThan(0);
      expect(check.detections, "the run takes the detections known by its date").toBeGreaterThan(0);
      expect(check.log.at(-1), "the run completes").toMatch(/\] complete: /);
      expect(check.log.filter((line) => !/ \(\d+s, 0 calls, \d+ cached\)$/.test(line)), "no model call is made").toEqual([]);
      expect(check.late).toEqual({ sources: 0, indicators: 0, facts: 0, notes: 0 });
      expect(check.differences).toEqual([]);
      expect(check.developments).toBe(stored.developments);
      for (const n of [check.answers, check.notes, check.indicators]) expect(n).toBeGreaterThan(0);

      writeFileSync(path.join(dir, "past-run.json"), JSON.stringify(check, null, 2));
      await showJson(page, check);
    });

    await step(STEPS[18], async () => {
      // The latest run's answers to questions linked to series cite them, and each cited series
      // carries the fact the run gave the answer, from what was available by the run date.
      const linked: [string, string][] = [
        ["circle", "issuer.peg"],
        ["tether", "issuer.peg"],
        ["paxos", "issuer.peg"],
        ["straitsx", "issuer.peg"],
        ["stablecoins", "stablecoins.reserves-peg"],
        ["dbs", "bank.financial"],
        ["singapore", "country.economic-policy"],
        ["fed", "central-bank.policy-stance"],
      ];
      let citing = 0;
      const cited: Schema<"AnswerEvidence">[] = [];
      for (const [subjectId, questionId] of linked) {
        const ev = await unwrap(
          api.GET("/subjects/{subject_id}/answers/{question_id}/evidence", {
            params: { path: { subject_id: subjectId, question_id: questionId } },
          }),
        );
        expect(ev.series.map((s) => s.series.id), `${subjectId} ${questionId} cites what it lists`).toEqual(ev.answer.series_ids);
        if (ev.series.length) citing++;
        cited.push(ev);
        for (const { series, fact } of ev.series) {
          expect(fact.question_ids, `${series.id} is linked to ${questionId}`).toContain(questionId);
          expect(fact.text.startsWith(series.name), `${series.id} states its name`).toBe(true);
          for (const o of [fact.latest, fact.low, fact.high]) {
            if (o) expect(o.available_at.slice(0, 10) <= ev.run.as_of, `${series.id} was known by the run date`).toBe(true);
          }
        }
        if (ev.answer.state_rules.length) expect(ev.answer.state).toBe("needs_attention");
      }
      expect(citing, "answers cite their series").toBeGreaterThanOrEqual(linked.length / 2);

      // Facts as of a past date read only what was available by the end of that day; today's see
      // later periods. A date before the history states no data and fixes nothing.
      const past = "2026-08-15";
      const sampled = ["circle", "paxos", "dbs", "malaysia", "fed", "stablecoins", "geopolitics"];
      const snapshot: Record<string, Schema<"SubjectFacts">> = {};
      let later = 0;
      for (const subjectId of sampled) {
        const subject = { subject_id: subjectId };
        const then = await unwrap(api.GET("/subjects/{subject_id}/facts", { params: { path: subject, query: { as_of: past } } }));
        const now = await unwrap(api.GET("/subjects/{subject_id}/facts", { params: { path: subject } }));
        snapshot[subjectId] = then;
        expect(then.facts.length, `${subjectId} has facts`).toBeGreaterThan(0);
        for (const [i, { series, fact }] of then.facts.entries()) {
          const name = `${series.id} as of ${past}`;
          if (!fact.latest) throw new Error(`${name} has no data`);
          for (const o of [fact.latest, fact.low, fact.high]) {
            if (o) expect(o.available_at.slice(0, 10) <= past, `${name} states only what was known then`).toBe(true);
          }
          if (fact.window_start) expect(fact.low && fact.low.period > fact.window_start, `${name} low is in its window`).toBe(true);
          for (const c of fact.changes) expect(c.since !== null && c.since < fact.latest.period, `${name} ${c.window} compares with an earlier period`).toBe(true);
          const today = now.facts[i].fact.latest;
          if (today && today.period > fact.latest.period) later++;
        }
      }
      expect(later, "today's facts state periods the past date could not see").toBeGreaterThan(0);
      const before = await unwrap(
        api.GET("/subjects/{subject_id}/facts", { params: { path: { subject_id: "circle" }, query: { as_of: "2020-01-01" } } }),
      );
      expect(new Set(before.facts.map((f) => f.fact.state))).toEqual(new Set(["no_data"]));
      expect(before.fixed_states).toEqual([]);

      // XSGD's SGD price is its 00:00 UTC USD price times the same day's MAS rate, so days without
      // a MAS rate have none. Its 2 to 4 May 2026 "depeg" came from pairing it with an earlier
      // day's rate and is gone, so Peg is not fixed; USDP's single day 0.57% off on 11 Sep 2026 is
      // not 24 hours either (structured-data-plan.md, F2).
      const range = { from: "2026-04-27", to: "2026-05-10" };
      const [usd, rate, sgd] = await Promise.all(
        ["cg.xsgd.price", "fx.sgd.usd", "derived.xsgd.price_sgd"].map((id) =>
          unwrap(api.GET("/series/{series_id}", { params: { path: { series_id: id }, query: range } })),
        ),
      );
      const byPeriod = (d: Schema<"SeriesDetail">) => new Map(d.observations.map((o) => [o.period, o.value]));
      const [usdAt, rateAt] = [byPeriod(usd), byPeriod(rate)];
      expect(sgd.observations.map((o) => o.period), "XSGD in SGD on the days with a MAS rate").toEqual(
        usd.observations.map((o) => o.period).filter((p) => rateAt.has(p)),
      );
      for (const o of sgd.observations) {
        expect(o.value, `XSGD in SGD on ${o.period}`).toBeCloseTo((usdAt.get(o.period) ?? NaN) * (rateAt.get(o.period) ?? NaN), 10);
      }
      const held = await unwrap(
        api.GET("/subjects/{subject_id}/facts", { params: { path: { subject_id: "straitsx" }, query: { as_of: "2026-05-10" } } }),
      );
      expect(held.fixed_states, "no XSGD depeg in May 2026").toEqual([]);
      const single = await unwrap(
        api.GET("/subjects/{subject_id}/facts", { params: { path: { subject_id: "paxos" }, query: { as_of: "2026-09-24" } } }),
      );
      expect(single.fixed_states).toEqual([]);

      // Answers on FX series name each rate as its fact does, "SGD per MYR", with the SGD's side:
      // a pair such as SGD/MYR reads as the SGD strengthening when it weakened.
      const fxAnswers: [string, string][] = [
        ["malaysia", "country.economic-policy"],
        ["singapore", "country.economic-policy"],
        ["philippines", "country.economic-policy"],
        ["geopolitics", "geopolitics.financial-channels"],
        ["mas", "central-bank.policy-stance"],
        ["hkma", "central-bank.policy-stance"],
      ];
      for (const [subjectId, questionId] of fxAnswers) {
        const ev = await unwrap(
          api.GET("/subjects/{subject_id}/answers/{question_id}/evidence", {
            params: { path: { subject_id: subjectId, question_id: questionId } },
          }),
        );
        expect(ev.answer.summary, `${subjectId} ${questionId} names no currency pair`).not.toMatch(/\b(?:SGD ?[/:\-–] ?[A-Z]{3}|[A-Z]{3} ?[/:\-–] ?SGD|SGD[A-Z]{3}|[A-Z]{3}SGD)\b/);
      }

      writeFileSync(path.join(dir, "facts.json"), JSON.stringify({ as_of: past, subjects: snapshot, held, answers: cited }, null, 2));
      await page.goto(new URL(`subjects/straitsx/facts?as_of=2026-05-10`, apiBase).href);
    });

    await step(STEPS[19], async () => {
      // The effective Fed funds rate rose from 3.63% to 3.88% on 17 Sep 2026, published by FRED
      // on 18 Sep: after Run 1's date and by Run 2's. The fed-funds-change detector
      // (api/seed/detectors.yaml) writes it as a data document, which search finds; the run takes
      // it like any source, and same-event merging joins it to the FOMC decision's development,
      // tagged to the Fed, which the followed Central banks group covers.
      const statement = "Fed funds effective rate up 0.25 points to 3.88% on 17 Sep 2026, from 3.63% on 16 Sep 2026.";
      const run1 = runs.find((r) => r.id === latest.previous_run_id);
      if (!run1) throw new Error("Run 1 is not in the run history");
      const found = await unwrap(api.GET("/search", { params: { query: { q: "Fed funds effective rate" } } }));
      const doc = found.documents.find((d) => d.title === "Fed funds rate change: Fed funds effective rate");
      if (!doc?.development_id) throw new Error("search does not find the Fed funds detection in a development");
      expect(doc.snippet).toBe(statement);
      const dev = await unwrap(api.GET("/developments/{development_id}", { params: { path: { development_id: doc.development_id } } }));
      const source = dev.sources.find((s) => s.document_id === doc.id);
      if (!source) throw new Error("the development does not list the detection as a source");

      // The detection: a data document from the source table, known after Run 1 and by Run 2.
      expect(source).toMatchObject({ url: "https://fred.stlouisfed.org/series/DFF", domain: "fred.stlouisfed.org", source: "detector", collection: "data", doc_type: "Move detector", classification: "public", new_in_run: true });
      const published = source.published_at.slice(0, 10);
      expect(published > run1.as_of && published <= latest.as_of, "known after Run 1 and by Run 2").toBe(true);
      expect(source.findings.map((f) => [f.statement, f.event_date])).toEqual([[statement, "2026-09-17"]]);

      // The development: changed in Run 2 by the detection, tagged to the Fed, and at least the
      // rule's Notable. Made of the detection alone, the rule would set its level outright.
      expect(dev.run.id).toBe(latest.id);
      expect(dev.change === "new" || dev.change === "updated", "the detection changed it in Run 2").toBe(true);
      expect(dev.collections).toContain("data");
      expect(dev.subjects.map((s) => s.id)).toContain("fed");
      expect(dev.materiality_level).toBeGreaterThanOrEqual(2);
      if (dev.sources.length === 1) expect(dev).toMatchObject({ materiality_label: "Notable", materiality_confidence: 1 });
      // The rule set the level unless Jev scored the merged development higher.
      expect(dev.materiality_rule).toBe(dev.materiality_level === 2 ? "Fed funds rate change" : null);
      // A development with a detection is titled by its measured sentence, merged with news or
      // not, and the detection leads its sources as the series it measured, the event cited.
      expect(dev.title).toBe(statement);
      expect(found.developments.find((d) => d.id === dev.id)?.title, "search shows the measured title").toBe(statement);
      const changed = await unwrap(api.GET("/what-changed", { params: { query: { subject_id: ["fed"] } } }));
      expect(changed.developments.find((d) => d.id === dev.id)?.title, "What changed shows the measured title").toBe(statement);
      expect(dev.sources[0].document_id).toBe(doc.id);
      // Then the Fed's own publications (its FOMC statement), then DMS (a BIS speech), official
      // and news documents, earliest first within each.
      const own = dev.sources.findIndex((s) => s.domain === "federalreserve.gov");
      const later = dev.sources.findIndex((s) => s.domain !== "federalreserve.gov" && s.domain !== "hkma.gov.hk" && s.collection !== "data");
      expect(own, "the Fed's own publications follow the detection").toBe(1);
      expect(dev.sources.slice(later).every((s) => s.domain !== "federalreserve.gov"), "the Fed's publications come before other sources").toBe(true);
      expect(source.series).toMatchObject({ series: { id: "fred.fed_funds" }, end: latest.as_of, cited_from: "2026-09-17", cited_to: "2026-09-17", cited: { period: "2026-09-17", value: 3.88 } });
      const followed = new Set((await unwrap(api.GET("/follows"))).map((f) => f.id));
      expect(followed.has("fed") || followed.has("central-banks"), "the Fed is followed, itself or through Central banks").toBe(true);
      const alert = (await unwrap(api.GET("/alerts"))).alerts.find((a) => a.id === dev.id);
      if (!alert) throw new Error("the development does not alert");
      expect(alert.badge).toBe(dev.needs_attention ? "needs_attention" : "watch");
      expect(alert.title, "alerts show the measured title").toBe(statement);

      // In the app: the alert opens the evidence drawer on the data source, its event highlighted
      // on the series' chart; the sentence is the title, so the block does not repeat it.
      const devPath = { params: { path: { development_id: alert.id } } };
      cleanups.push(async () => void (await unwrap(api.PATCH("/developments/{development_id}/triage", { ...devPath, body: { read: alert.read } }))));
      await page.goto("/");
      await page.getByRole("button", { name: /^Alerts/ }).click();
      const popover = page.getByRole("dialog", { name: "Alerts" });
      await popover.locator(".alert-row").filter({ hasText: alert.title }).first().locator(".alert-body").click();
      await expect(page).toHaveURL(new RegExp(`[?&]evidence=${encodeURIComponent(alert.id)}$`));
      const drawer = page.getByTestId("evidence-drawer");
      await expect(drawer.getByRole("heading", { level: 3 })).toHaveText(dev.title);
      await expect(drawer.locator(".ev-conf").first()).toHaveText(
        dev.materiality_rule ? `Materiality set by rule: ${dev.materiality_rule}` : /^Materiality: (high|medium|low) confidence$/,
      );
      const article = drawer.locator('article.series-src[data-series-id="fred.fed_funds"]');
      await expect(drawer.locator("article.source").first()).toHaveAttribute("data-series-id", "fred.fed_funds");
      await expect(article.getByRole("link", { name: "Fed funds effective rate" })).toHaveAttribute("href", source.url);
      await expect(article.locator(".meta")).toContainText("18 Sep 2026 · Data, FRED DFF · fred.stlouisfed.org · new this run");
      await expect(article.locator(".finding > p")).toHaveCount(0);
      await expect(article.getByRole("img")).toHaveAccessibleName(/cited: 17 Sep 2026$/);
      await expect(article.locator(".sc-band")).toHaveCount(1);
      await article.scrollIntoViewIfNeeded();
      await expect.poll(async () => (await unwrap(api.GET("/alerts"))).alerts.find((a) => a.id === alert.id)?.read).toBe(true);

      writeFileSync(path.join(dir, "detections.json"), JSON.stringify({ run: latest, alert, development: dev }, null, 2));
    });

    await step(STEPS[20], async () => {
      // No stored price breaches a peg, so `im check depeg` puts fixture prices in a scratch store:
      // USDC 0.70%, 0.85% and 0.75% below its peg on 8 to 10 Sep 2026, a 48-hour spell. It runs the
      // pipeline's detectors, merge and answer step with a canned model that answers Stable, so only
      // the rule can raise Peg (api/intelmonitor/checks.py).
      const check: DepegCheck = JSON.parse(imCheck("depeg"));
      const statement =
        "USDC off its USD peg by more than 0.50% for 24 hours, from 8 Sep 2026 to 9 Sep 2026; 0.9915 USD (0.85% below) on 9 Sep 2026.";
      expect(check.detections).toEqual([statement]);
      // The detection alone makes a development titled by its sentence, at the rule's level.
      expect(check.developments).toEqual([
        { title: statement, materiality_label: "Significant", materiality_rule: "depeg", needs_attention: true, sources: 1 },
      ]);
      // The peg rule (0.5% for 24 hours, api/seed/questions.yaml) fixes Peg over the model's Stable.
      expect(check.fixed_states.map((f) => [f.question_id, f.series_id, f.state, f.start, f.end, f.hours])).toEqual([
        ["issuer.peg", "derived.usdc.peg", "needs_attention", "2026-09-08", "2026-09-10", 48],
      ]);
      expect(check.peg.state).toBe("needs_attention");
      expect(check.peg.state_rules).toEqual(check.fixed_states.map((f) => f.text));

      writeFileSync(path.join(dir, "depeg.json"), JSON.stringify(check, null, 2));
      await showJson(page, { ...check, prices: check.prices.slice(-5) });
    });

    await step(STEPS[21], async () => {
      // Indicators sit between What changed and Standing questions, as of the page's run date
      // (structured-data-plan.md, F4). OCBC has no figures of its own: its rows are the Singapore
      // banking system's MAS series, labelled System-wide in the head and on every row.
      const ocbc = await unwrap(
        api.GET("/subjects/{subject_id}/indicators", { params: { path: { subject_id: "ocbc" }, query: { as_of: latest.as_of } } }),
      );
      const rows = ocbc.indicators.filter((i) => i.series.listed);
      expect(rows.length, "OCBC has the system's series").toBeGreaterThan(0);
      // The mock's width; the list steps before this one leave the window at 1024 px.
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto("/monitors/ocbc");
      const section = page.locator("section", { has: page.locator("h2#indicators") });
      await expect(section.locator(".mon-sec-head .meta")).toHaveText("System-wide");
      const headings = await page.locator("main h2").allTextContents();
      expect(headings.indexOf("Indicators"), "Indicators come before Standing questions").toBeLessThan(headings.indexOf("Standing questions"));
      await expect(section.locator(".mon-sub")).toHaveText(["Loan-to-deposit ratio", "Non-performing loans"]);
      for (const ind of rows) {
        if (!ind.latest) throw new Error(`${ind.series.id} has no data as of ${latest.as_of}`);
        expect(ind.latest.available_at.slice(0, 10) <= latest.as_of, `${ind.series.id} was known by the run date`).toBe(true);
        const row = section.locator(`[data-series-id="${ind.series.id}"]`);
        await expect(row.locator(".ind-val")).toHaveText(seriesValue(ind.series, ind.latest.value));
        const meta = row.locator(".row-meta").first();
        await expect(meta).toContainText(seriesPeriod(ind.series, ind.latest.period));
        await expect(meta).toContainText(`${ind.series.source_label} · System-wide`);
        if (ind.state === "preliminary") await expect(meta).toContainText("preliminary");
        const change = indicatorChange(ind);
        if (change) await expect(row.locator(".ind-chg")).toHaveText(`${change.value}${change.window}`);
      }

      // The Fed funds rise of 17 Sep fired its detector after Run 1 (F3), so the rate reads Watch
      // in Run 2 and its row opens the development that carries the detection.
      const fed = await unwrap(
        api.GET("/subjects/{subject_id}/indicators", { params: { path: { subject_id: "fed" }, query: { as_of: latest.as_of } } }),
      );
      const funds = fed.indicators.find((i) => i.series.id === "fred.fed_funds");
      if (!funds) throw new Error("the Fed has no Fed funds indicator");
      expect(funds.status).toBe("watch");
      const event = funds.events.find((e) => e.statement.startsWith("Fed funds effective rate up 0.25 points to 3.88%"));
      if (!event?.development_id) throw new Error("the Fed funds indicator does not carry its detection's development");
      await page.goto("/monitors/fed");
      const fundsRow = page.locator('[data-series-id="fred.fed_funds"]');
      await expect(fundsRow.locator(".stat")).toHaveText("Watch");
      await expect(page.locator('[data-series-id="fx.sgd.usd"] .row-meta').first()).toContainText("Market-wide");

      // The line's readout: the crosshair snaps to an observation and names its value and date.
      const line = fundsRow.locator(".ind-line");
      await line.scrollIntoViewIfNeeded();
      const box = await line.boundingBox();
      if (!box) throw new Error("the Fed funds line is not on screen");
      await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
      const tip = page.getByRole("tooltip");
      await expect(tip).toBeVisible();
      await expect(tip.locator("b")).toHaveText(seriesValue(funds.series, funds.line[funds.line.length - 1].value));
      await expect(tip).toContainText("Fed funds effective rate");

      await fundsRow.click();
      await expect(page).toHaveURL(new RegExp(`[?&]evidence=${encodeURIComponent(event.development_id)}$`));
      const dev = await unwrap(api.GET("/developments/{development_id}", { params: { path: { development_id: event.development_id } } }));
      await expect(page.getByTestId("evidence-drawer").getByRole("heading", { level: 3 })).toHaveText(dev.title);
      expect(dev.sources.some((src) => src.collection === "data" && src.findings.some((f) => f.statement === event.statement))).toBe(true);

      // Inputs to derived series (prices, supply per chain) stay off the rows; a bank with no
      // mapped series has no section.
      await page.goto("/monitors/circle");
      await expect(page.locator("h2#indicators")).toBeVisible();
      await expect(page.locator('[data-series-id^="cg."], [data-series-id^="llama.usdc.supply."]')).toHaveCount(0);
      await page.goto("/monitors/maybank");
      await expect(page.getByRole("heading", { level: 2, name: "Standing questions" })).toBeVisible();
      await expect(page.locator("h2#indicators")).toHaveCount(0);

      writeFileSync(path.join(dir, "monitor-indicators.json"), JSON.stringify({ run: latest, ocbc, fed }, null, 2));
      await page.goto("/monitors/ocbc");
      await page.locator("h2#indicators").scrollIntoViewIfNeeded();
    });

    await step(STEPS[22], async () => {
      // An indicator set only to a subject shows its primary series, a peg first
      // (structured-data-plan.md, F5); values are as of the run date, the sentence written by code.
      const created = await unwrap(
        api.POST("/dashboards", {
          body: {
            name: `E2E Indicator ${stamp}`,
            subject_ids: ["tether", "circle"],
            widgets: [{ id: "peg", order: 0, type: "indicator", size: "S", settings: { subject_id: "tether" } }],
          },
        }),
      );
      cleanups.push(() => deleted(api.DELETE("/dashboards/{dashboard_id}", { params: { path: { dashboard_id: created.id } } })));
      const pegData = await unwrap(api.POST("/widgets/data", { body: { widget: created.widgets[0] } }));
      if (pegData.type !== "indicator") throw new Error("the indicator widget returned other data");
      expect(pegData.indicator.series.id).toBe("derived.usdt.peg");
      expect(pegData.run.id).toBe(latest.id);
      expect(pegData.indicator.latest?.available_at.slice(0, 10) ?? "", "the value was known by the run date").not.toBe("");
      expect((pegData.indicator.latest?.available_at.slice(0, 10) ?? "") <= latest.as_of).toBe(true);
      await page.goto(`/dashboards/${created.id}`);
      const peg = page.locator('[data-widget-id="peg"]');
      await expect(peg.locator(".wt")).toHaveText("USDT off its USD peg");
      await expect(peg.locator(".wm")).toHaveText("Tether");
      await expect(peg.locator(".ans")).toHaveText(STATE_LABEL[pegData.indicator.status]);
      await expect(peg.locator(".w-text")).toHaveText(indicatorSentence(pegData.indicator, latest.as_of));
      await expect(peg.locator(".wf .w-meta")).toHaveText(pegData.indicator.series.providers.join(", "));

      // The gallery suggests Circle's own series first, the peg selected and supply beside it.
      await page.getByRole("button", { name: "Add widget", exact: true }).click();
      const sheet = page.getByRole("dialog", { name: "Add widget" });
      await sheet.locator("button.subj", { has: page.getByText("Circle", { exact: true }) }).click();
      await expect(sheet.getByRole("heading", { level: 3 })).toHaveText("Circle");
      const offer = sheet.locator("section.offer").first();
      await expect(offer).toHaveAttribute("aria-label", "Indicator");
      const series = offer.getByLabel("Series");
      await expect(series).toHaveValue("derived.usdc.peg");
      await expect(series.locator('optgroup[label="Primary"] option')).toHaveText(["USDC off its USD peg", "USDC circulating supply"]);
      await expect(offer.locator(".wt")).toHaveText("USDC off its USD peg");
      await series.selectOption("llama.usdc.supply");
      await offer.getByRole("button", { name: "Large" }).click();
      await expect(offer.locator(".w.L .wt")).toHaveText("USDC circulating supply");
      const putUrl = new URL(`dashboards/${created.id}`, apiBase).href;
      const saved = page.waitForResponse(isPut(putUrl));
      await offer.getByRole("button", { name: "Add Indicator" }).click();
      expect((await saved).ok()).toBe(true);
      await expect(sheet).toBeHidden();
      const after = await unwrap(api.GET("/dashboards/{dashboard_id}", { params: { path: { dashboard_id: created.id } } }));
      const added = after.widgets.find((w) => w.id !== "peg");
      if (added?.type !== "indicator") throw new Error("the gallery added no indicator");
      expect(added.size).toBe("L");
      expect(added.settings).toEqual({ subject_id: "circle", series_id: "llama.usdc.supply" });

      // Large: the scale at the left, the developments lane under the line, the axis naming the
      // stretch before the first document, and the latest marked developments as rows.
      const supplyData = await unwrap(api.POST("/widgets/data", { body: { widget: added } }));
      if (supplyData.type !== "indicator") throw new Error("the indicator widget returned other data");
      const supply = page.locator(`[data-widget-id="${added.id}"]`);
      const ind = supplyData.indicator;
      const values = ind.line.map((p) => p.value);
      await expect(supply.locator(".ind-y")).toHaveText([seriesValue(ind.series, Math.max(...values)), seriesValue(ind.series, Math.min(...values))]);
      await expect(supply.locator(".ind-xa")).toContainText(`No documents before ${shortDate(supplyData.documents_from)}`);
      await expect(supply.locator(".ind-xa")).toContainText(shortDate(latest.as_of));
      const marks = supplyData.developments;
      expect(marks.length, "Circle has developments to mark").toBeGreaterThan(0);
      expect(marks.every((m) => m.on <= latest.as_of && (m.badge === "watch" || m.development.needs_attention))).toBe(true);
      await expect(supply.locator(".ind-tk")).toHaveCount(new Set(marks.map((m) => m.on)).size);
      await expect(supply.locator(".ind-wrows .row")).toHaveCount(Math.min(2, marks.length));
      await expect(supply.locator(".ind-wrows .row-title").first()).toHaveText(marks[0].development.title);
      // The latest day's marker, last in the lane so it sits on top of its neighbours.
      const tick = supply.locator(".ind-tk").last();
      await tick.hover();
      const tip = page.getByRole("tooltip");
      await expect(tip).toBeVisible();
      await expect(tip.locator(".tip-title").first()).toHaveText(marks.find((m) => m.on === marks[0].on && m.badge === "needs_attention")?.development.title ?? marks[0].development.title);
      await expect(supply.locator(".ind-wrows .row").first()).toHaveClass(/\bon\b/);

      // See data opens the subject's Indicators section; a subject without series gets no offer.
      await page.mouse.move(5, 5);
      await peg.getByRole("link", { name: "See data" }).click();
      await expect(page).toHaveURL(/\/monitors\/tether#indicators$/);
      await expect(page.locator('[data-series-id="derived.usdt.peg"]')).toBeVisible();
      // The section renders after its data loads and still lands level with the rail, on client
      // navigation and on a direct load.
      const indicatorsTop = () => page.locator("section:has(> .mon-sec-head #indicators)").evaluate((el) => el.getBoundingClientRect().top);
      await expect.poll(indicatorsTop).toBe(80);
      await page.goto("/");
      await page.goto("/monitors/tether#indicators");
      await expect(page.locator('[data-series-id="derived.usdt.peg"]')).toBeVisible();
      await expect.poll(indicatorsTop).toBe(80);
      await page.goto(`/dashboards/${created.id}`);
      await page.getByRole("button", { name: "Add widget", exact: true }).click();
      await sheet.locator("button.subj", { has: page.getByText("Maybank", { exact: true }) }).click();
      await expect(sheet.getByRole("heading", { level: 3 })).toHaveText("Maybank");
      await expect(sheet.locator("section.offer").first()).toBeVisible();
      await expect(sheet.locator('section.offer[aria-label="Indicator"]')).toHaveCount(0);
      await sheet.getByRole("button", { name: "Close" }).click();

      writeFileSync(path.join(dir, "indicator-widget.json"), JSON.stringify({ run: latest, peg: pegData, supply: supplyData }, null, 2));
      await supply.scrollIntoViewIfNeeded();
    });

    await step(STEPS[23], async () => {
      // Each series an answer cites is a source block: its chart ends on the run date, as known
      // then, over 12 months for a daily series, 24 for a monthly one and the whole stored history
      // for a quarterly one; it highlights what the sentence cites (a daily series' window to its
      // latest point, a release's latest period).
      const answers: Schema<"AnswerEvidence">[] = [];
      for (const [subjectId, questionId] of [
        ["dbs", "bank.financial"],
        ["circle", "issuer.peg"],
        ["fed", "central-bank.policy-stance"],
      ]) {
        const ev = await unwrap(
          api.GET("/subjects/{subject_id}/answers/{question_id}/evidence", {
            params: { path: { subject_id: subjectId, question_id: questionId } },
          }),
        );
        answers.push(ev);
        for (const { series, fact, chart } of ev.series) {
          const name = `${subjectId} ${series.id}`;
          expect(chart.end, `${name} ends on the run date`).toBe(ev.run.as_of);
          if (series.frequency === "quarterly") expect(chart.start, `${name} spans its history`).toBe(chart.line[0].period);
          else expect(chart.start, `${name} span`).toBe(monthsBefore(ev.run.as_of, series.frequency === "daily" ? 12 : 24));
          expect(chart.line.every((p) => p.period >= chart.start && p.period <= chart.end), `${name} stays in its span`).toBe(true);
          if (!fact.latest || !chart.cited) throw new Error(`${name} cites no value`);
          expect(chart.cited).toEqual(fact.latest);
          expect(chart.cited_to).toBe(fact.latest.period);
          expect(chart.cited.available_at.slice(0, 10) <= ev.run.as_of, `${name} was known by the run date`).toBe(true);
          if (fact.window_start) expect(chart.cited_from && chart.cited_from > fact.window_start, `${name} cites its window`).toBe(true);
          else expect(chart.cited_from).toBe(fact.latest.period);
        }
      }
      const dbs = answers[0];
      expect(dbs.series.map((s) => s.series.frequency)).toEqual(expect.arrayContaining(["monthly", "quarterly"]));

      // In the app: after "Based on", each series links its source table; the meta line says when
      // the value was known, the source, the scope and the release with its flag in words.
      await page.goto(`/monitors/dbs?answer=${encodeURIComponent("dbs:bank.financial")}`);
      const drawer = page.getByTestId("evidence-drawer");
      const counts = [dbs.developments.length && plural(dbs.developments.length, "development"), plural(dbs.series.length, "series", "series")];
      await expect(drawer.locator("h4.ev-label")).toHaveText(`Based on ${counts.filter(Boolean).join(" and ")}`);
      const blocks = drawer.locator("section.ev-series article.series-src");
      await expect(blocks).toHaveCount(dbs.series.length);
      for (const [i, { series, fact, chart }] of dbs.series.entries()) {
        const block = blocks.nth(i);
        if (!chart.cited) throw new Error(`${series.id} cites no value`);
        await expect(block).toHaveAttribute("data-series-id", series.id);
        await expect(block.getByRole("link", { name: series.name, exact: true })).toHaveAttribute("href", series.source_url);
        const flag = chart.revisions.length ? ", revised" : chart.cited.preliminary ? ", preliminary" : "";
        await expect(block.locator(".meta")).toHaveText(
          `${longDate(chart.cited.available_at)} · Data, ${series.source_label} · System-wide · mas.gov.sg · ${seriesPeriod(series, chart.cited.period)}${flag}`,
        );
        const sentence = fact.text.slice(`${series.name}: `.length);
        await expect(block.locator(".finding > p")).toHaveText(sentence.charAt(0).toUpperCase() + sentence.slice(1));
        await expect(block.getByRole("img")).toHaveAccessibleName(new RegExp(`cited: ${seriesPeriod(series, chart.cited.period)}$`));
      }

      // The cited period is tinted like a quote, and the crosshair on it reads the cited value.
      const first = blocks.first();
      const band = first.locator(".sc-band");
      const tint = await band.evaluate((el) => getComputedStyle(el).fill);
      const mark = await page.evaluate(() => {
        const probe = document.createElement("span");
        probe.style.color = "var(--mark)";
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      });
      expect(tint).toBe(mark);
      await first.scrollIntoViewIfNeeded();
      const box = await band.boundingBox();
      if (!box) throw new Error("the cited period is not on screen");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      const tip = page.getByRole("tooltip");
      await expect(tip.locator("b")).toHaveText(seriesValue(dbs.series[0].series, dbs.series[0].chart.cited?.value ?? NaN));
      await expect(tip).toContainText(seriesPeriod(dbs.series[0].series, dbs.series[0].chart.cited?.period ?? ""));

      // An answer change under What changed that cites only series opens its evidence too.
      let seriesOnly: Schema<"QuestionStateChange"> | undefined;
      for (const subjectId of ["circle", "tether", "paxos", "straitsx"]) {
        const wc = await unwrap(api.GET("/what-changed", { params: { query: { subject_id: [subjectId] } } }));
        seriesOnly = wc.question_changes.find((c) => c.subject.id === subjectId && c.development_ids.length === 0 && c.series_ids.length > 0);
        if (seriesOnly) break;
      }
      if (!seriesOnly) throw new Error("no answer change cites only series");
      await page.goto(`/monitors/${seriesOnly.subject.id}`);
      const changes = page.getByRole("region", { name: "What changed since last review" });
      const earlier = changes.getByRole("button", { name: /^Run of / });
      if (await earlier.isVisible()) await earlier.click();
      const changed = changes.locator(".qrow", { hasText: seriesOnly.summary });
      await expect(changed).not.toContainText("No sources");
      await changed.getByRole("link", { name: "See evidence" }).click();
      await expect(drawer.locator("h4.ev-label")).toHaveText(`Based on ${plural(seriesOnly.series_ids.length, "series", "series")}`);

      writeFileSync(path.join(dir, "data-sources.json"), JSON.stringify({ run: latest, answers, series_only: seriesOnly }, null, 2));
    });

    await step(STEPS[24], async () => {
      // Weekly runs from 30 Jul to the latest, each with a note on why the subject's series moved in
      // its week, citing that run's developments and given facts known by its date
      // (structured-data-plan.md, F6).
      const trend = await unwrap(api.GET("/subjects/{subject_id}/trend", { params: { path: { subject_id: "circle" } } }));
      expect(trend.run.id).toBe(latest.id);
      expect(trend.runs[0].run.as_of).toBe("2026-07-30");
      expect(trend.runs[trend.runs.length - 1].run.id).toBe(latest.id);
      for (const [i, r] of trend.runs.entries()) {
        if (i > 0) expect(daysBetween(trend.runs[i - 1].run.as_of, r.run.as_of), `${r.run.id} is a week after the run before`).toBe(7);
        expect(r.since, `${r.run.id}'s week starts at the run before`).toBe(i > 0 ? trend.runs[i - 1].run.as_of : "2026-07-23");
        const note = r.note;
        if (!note) throw new Error(`${r.run.id} has no note for Circle`);
        const cites = [...new Set([...note.body.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))];
        expect(cites, `${r.run.id}'s citations are numbered in order`).toEqual(note.developments.map((_, k) => k + 1));
        for (const d of note.developments) {
          expect(d.development.last_published <= r.run.as_of, `${d.development.id} was published by ${r.run.id}`).toBe(true);
          expect(d.on >= trend.start && d.on <= trend.run.as_of, `${d.development.id} sits in the chart`).toBe(true);
        }
        expect(note.facts.map((f) => f.series_id)).toEqual(trend.series.map((s) => s.series.id));
        for (const f of note.facts) {
          for (const o of [f.latest, f.start, f.widest]) {
            if (o) expect(o.available_at.slice(0, 10) <= r.run.as_of, `${r.run.id} ${f.series_id} was known by the run date`).toBe(true);
          }
        }
      }
      expect(trend.runs[0].since < trend.documents_from, "the first run's week reaches before the first document").toBe(true);
      expect(trend.questions.every((q) => q.states.length === trend.runs.length && q.states.every((st) => st !== null))).toBe(true);
      const shown = trend.runs[trend.runs.length - 1];
      const note = shown.note;
      if (!note) throw new Error("the latest run has no note for Circle");
      const inView = note.developments.filter((d) => d.on >= trend.start);

      // In the app: the Trend tab opens on the latest run's note, its citations linked and numbered
      // on the chart of the series it is about, with the facts it was given beside it.
      await page.goto("/monitors/circle");
      await page.getByRole("navigation", { name: "View" }).getByRole("link", { name: "Trend" }).click();
      await expect(page).toHaveURL(/\/monitors\/circle\/trend$/);
      const why = page.locator('section[aria-labelledby="why"]');
      await expect(why.locator(".mon-sec-head .meta")).toHaveText(`Run of ${shortDate(shown.run.as_of)} against ${shortDate(shown.since)}`);
      const runButtons = why.getByRole("group", { name: "Run" }).getByRole("button");
      await expect(runButtons).toHaveText([...trend.runs.map((r) => shortDate(r.run.as_of)).reverse(), `Before ${shortDate(trend.documents_from)}`]);
      await expect(why.locator(".tr-lead")).toHaveText(note.headline);
      await expect(why.locator(".tr-prose .cite")).toHaveCount(note.body.match(/\[\d+\]/g)?.length ?? 0);
      if (note.developments.length) await expect(why.locator(".tr-prose .cite").first()).toHaveAttribute("title", note.developments[0].development.title);
      await expect(why.locator(".tr-mk")).toHaveCount(inView.length);
      const lead = trend.series.find((x) => x.series.id === note.series_id) ?? trend.series[0];
      await expect(why.getByRole("group", { name: "Series" }).getByRole("button", { pressed: true })).toHaveText(lead.series.short_name);
      const days = new Set(trend.developments.filter((m) => m.on >= trend.start).map((m) => m.on));
      await expect(why.locator(".tr-tk")).toHaveCount(days.size);
      const fact = note.facts.find((f) => f.series_id === lead.series.id);
      if (!fact?.latest) throw new Error(`the note has no latest value for ${lead.series.id}`);
      const facts = page.locator('section[aria-labelledby="facts"]');
      await expect(facts.locator(".mon-sec-head .meta")).toHaveText("Given to the note");
      await expect(facts.locator(".tr-facts > div").first()).toHaveText(`Latest, ${shortDate(fact.latest.period)}${seriesValue(lead.series, fact.latest.value)}`);
      await expect(facts.getByRole("link", { name: "Open source table" })).toHaveAttribute("href", lead.series.source_url);

      // Standing questions: one mark per run, the shown run's state and answer in words.
      const table = page.locator("table.tr-qt");
      await expect(table.locator("tbody tr")).toHaveCount(trend.questions.length);
      await expect(table.locator("tbody tr").first().locator(".tr-strip s")).toHaveCount(trend.runs.length);
      const last = trend.runs.length - 1;
      await expect(table.locator("tbody .tr-state")).toHaveText(trend.questions.map((q) => STATE_LABEL[q.states[last] ?? "stable"]));
      await expect(page.locator('section[aria-labelledby="cited"] .tr-cited')).toHaveCount(note.developments.length);

      // An earlier run shows its own note and week; the 1-month window ends on it.
      const earlier = trend.runs[last - 1];
      await runButtons.filter({ hasText: new RegExp(`^${shortDate(earlier.run.as_of)}$`) }).click();
      await expect(why.locator(".tr-lead")).toHaveText(earlier.note?.headline ?? "");
      await expect(why.locator(".mon-sec-head .meta")).toHaveText(`Run of ${shortDate(earlier.run.as_of)} against ${shortDate(earlier.since)}`);
      await expect(table.locator("tbody .tr-state")).toHaveText(trend.questions.map((q) => STATE_LABEL[q.states[last - 1] ?? "stable"]));
      await why.getByRole("group", { name: "Period" }).getByRole("button", { name: "1 month" }).click();
      await expect(why.locator(".tr-chart svg")).toHaveAccessibleName(new RegExp(`to ${longDate(earlier.run.as_of)}, latest`));

      // Before the first document there is no run and no note: the series alone, facts by code.
      await runButtons.filter({ hasText: "Before" }).click();
      await expect(why.locator(".mon-sec-head .meta")).toHaveText("No run: before collection started");
      await expect(why.locator(".tr-lead")).toHaveText(`No documents before ${shortDate(trend.documents_from)}`);
      await expect(why.locator(".tr-mk")).toHaveCount(0);
      await expect(page.locator('section[aria-labelledby="cited"]')).toHaveCount(0);
      await expect(facts.locator(".mon-sec-head .meta")).toHaveText("Computed");
      await expect(table.locator("tbody .tr-state").first()).toHaveText("No run");

      // A subject without measured series has no Trend tab.
      await page.goto("/monitors/maybank");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Maybank");
      await expect(page.getByRole("navigation", { name: "View" })).toHaveCount(0);

      writeFileSync(path.join(dir, "trend.json"), JSON.stringify(trend, null, 2));
      await page.goto("/monitors/circle/trend");
      await expect(page.locator(".tr-lead")).toHaveText(note.headline);
    });

    await step(STEPS[25], async () => {
      // A custom question can name series of its subject, picked like the gallery's indicator
      // series; each run's answer gets their facts as of its date and may cite them
      // (structured-data-plan.md, F7). The text and pick are fixed, so the calls are recorded.
      const slots = await unwrap(api.GET("/custom-questions/slots"));
      expect(slots.left, "a custom question slot is free").toBeGreaterThan(0);
      await page.goto("/monitors/malaysia");
      const questions = page.getByRole("region", { name: "Standing questions" });
      await questions.getByRole("button", { name: "Add a question" }).click();
      await questions.getByLabel("Your question about Malaysia").fill("How is the SGD moving against the ringgit, and what is driving it?");
      const picker = questions.getByRole("combobox", { name: "Series", exact: true });
      await expect(picker).toHaveValue("");
      await expect(picker.locator("option").first()).toHaveText("Named in the question");
      await expect(picker.locator('optgroup[label="Primary"] option')).toHaveText(["SGD per Malaysian ringgit"]);
      // Malaysia lists one series, so there is no second to add.
      await expect(questions.getByRole("button", { name: "Add series" })).toHaveCount(0);
      await picker.selectOption("fx.sgd.myr");
      const drafted = page.waitForResponse(
        (r) => r.url() === new URL("custom-questions", apiBase).href && r.request().method() === "POST",
        { timeout: LLM_TIMEOUT },
      );
      await questions.getByRole("button", { name: "Draft question" }).click();
      const response = await drafted;
      expect(response.ok(), await response.text()).toBe(true);
      expect(response.request().postDataJSON()).toEqual({
        text: "How is the SGD moving against the ringgit, and what is driving it?",
        subject_id: "malaysia",
        series_ids: ["fx.sgd.myr"],
      });
      const draft: Schema<"CustomQuestion"> = await response.json();
      cleanups.push(() =>
        deleted(api.DELETE("/custom-questions/{question_id}", { params: { path: { question_id: draft.id } } })),
      );
      expect(draft.series.map((x) => x.id)).toEqual(["fx.sgd.myr"]);
      const pair = /\b(?:SGD ?[/:\-–] ?[A-Z]{3}|[A-Z]{3} ?[/:\-–] ?SGD|SGD[A-Z]{3}|[A-Z]{3}SGD)\b/;
      for (const text of [draft.question, draft.label, ...draft.runs.map((r) => r.summary)]) {
        expect(text, "FX is named by the SGD's side, never as a pair").not.toMatch(pair);
      }
      for (const r of draft.runs) expect(r.summary, "answers name their window plainly").not.toMatch(/lookback|\bwindow\b/i);
      const newest = draft.runs.at(-1);
      if (!newest) throw new Error("the custom question has no answers");
      expect(newest.run.id).toBe(latest.id);
      expect(newest.series_ids, "the latest answer cites the series").toEqual(["fx.sgd.myr"]);

      const preview = questions.getByRole("group", { name: "Custom question preview" });
      await expect(preview.locator(".cq-config dt", { hasText: "Series" }).locator("+ dd")).toHaveText("SGD per Malaysian ringgit");
      await expect(preview.locator(".cq-cites .cq-label")).toHaveText(/(^Cites | and )1 series$/);
      await expect(preview.locator(".cq-cites .row-title").last()).toHaveText("SGD per Malaysian ringgit");
      await preview.getByRole("button", { name: "Keep" }).click();
      await expect(page.getByText(`${draft.label} added to Malaysia`)).toBeVisible();

      // The evidence shows the facts this question was given: its own 14-day window, known by
      // the run date, not the built-in questions' window.
      const evidence = await unwrap(
        api.GET("/subjects/{subject_id}/answers/{question_id}/evidence", {
          params: { path: { subject_id: "malaysia", question_id: draft.id } },
        }),
      );
      const cited = evidence.series[0];
      expect(evidence.series.map((x) => x.series.id)).toEqual(["fx.sgd.myr"]);
      expect(cited.fact.question_ids).toEqual([draft.id]);
      expect(daysBetween(cited.fact.window_start ?? "", latest.as_of)).toBe(draft.lookback_days);
      expect((cited.fact.latest?.available_at.slice(0, 10) ?? "9999") <= latest.as_of, "the fact was known by the run date").toBe(true);
      const row = questions.locator(`.qrow[data-question-id="${draft.id}"]`);
      await row.getByRole("link", { name: "See evidence" }).click();
      const drawer = page.getByTestId("evidence-drawer");
      await expect(drawer.getByRole("heading", { level: 4 }).first()).toHaveText(/^Based on (\d+ developments? and )?1 series$/);
      const block = drawer.locator('.series-src[data-series-id="fx.sgd.myr"]');
      await expect(block.getByRole("link", { name: "SGD per Malaysian ringgit" })).toBeVisible();
      const sentence = cited.fact.text.slice("SGD per Malaysian ringgit: ".length);
      await expect(block.locator(".finding p")).toHaveText(sentence.charAt(0).toUpperCase() + sentence.slice(1));
      await drawer.getByRole("button", { name: "Close evidence" }).click();
      await expect(drawer).toBeHidden();

      // The edit dialog picks the series with the same select, None to drop it.
      await row.getByRole("button", { name: `Edit ${draft.label}` }).click();
      const dialog = page.getByRole("dialog", { name: "Edit custom question" });
      const editPicker = dialog.getByRole("combobox", { name: "Series", exact: true });
      await expect(editPicker).toHaveValue("fx.sgd.myr");
      await expect(editPicker.locator("option").first()).toHaveText("None");
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).toBeHidden();

      // Its widget at Medium draws the series' 12-month line beside the answer; Small has none.
      const created = await unwrap(
        api.POST("/dashboards", {
          body: {
            name: `E2E Custom series ${stamp}`,
            subject_ids: ["malaysia"],
            widgets: [
              { id: "cqm", order: 0, type: "question", size: "M", settings: { subject_id: "malaysia", question_id: draft.id } },
              { id: "cqs", order: 1, type: "question", size: "S", settings: { subject_id: "malaysia", question_id: draft.id } },
            ],
          },
        }),
      );
      cleanups.push(() => deleted(api.DELETE("/dashboards/{dashboard_id}", { params: { path: { dashboard_id: created.id } } })));
      const data = await unwrap(api.POST("/widgets/data", { body: { widget: created.widgets[0] } }));
      if (data.type !== "question") throw new Error("the question widget returned other data");
      expect(data.indicator?.series.id).toBe("fx.sgd.myr");
      expect(data.indicator?.line.at(-1)?.period).toBe(data.indicator?.latest?.period);
      await page.goto(`/dashboards/${created.id}`);
      const medium = page.locator('[data-widget-id="cqm"]');
      await expect(medium.locator(".wt")).toHaveText(draft.label);
      await expect(medium.locator(".ind-wm .w-text")).toHaveText(answerText(newest.summary));
      await expect(medium.locator(".ind-wm .ind-line svg")).toBeVisible();
      await expect(medium.getByRole("link", { name: "See evidence" })).toBeVisible();
      await expect(page.locator('[data-widget-id="cqs"] .ind-line')).toHaveCount(0);

      writeFileSync(path.join(dir, "custom-series.json"), JSON.stringify({ run: latest, question: draft, evidence, widget: data }, null, 2));
    });

    expect(pageErrors, "no uncaught errors in the page").toEqual([]);
  } finally {
    const failures: string[] = [];
    for (const cleanup of cleanups.reverse()) {
      await cleanup().catch((e: unknown) => failures.push(e instanceof Error ? e.message : String(e)));
    }
    testInfo.annotations.push({ type: "cleanup", description: failures.length ? failures.join("; ") : "ok" });
    if (failures.length) console.error(`E2E cleanup failed: ${failures.join("; ")}`);
  }
});

/**
 * Moves the pointer outward from the centre of the graph until sigma reports a node other than
 * `skip` under it: the stage then names the hovered node in data-hovered.
 */
async function findNode(page: Page, stage: Locator, skip: string): Promise<{ x: number; y: number }> {
  const box = await stage.boundingBox();
  if (!box) throw new Error("graph canvas not on screen");
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const STEP = 8;
  for (let r = 0; r < Math.hypot(box.width, box.height) / 2; r += STEP) {
    const count = Math.max(1, Math.ceil((2 * Math.PI * r) / STEP));
    for (let k = 0; k < count; k++) {
      const x = cx + r * Math.cos((2 * Math.PI * k) / count);
      const y = cy + r * Math.sin((2 * Math.PI * k) / count);
      if (x < box.x + 4 || x > box.x + box.width - 4 || y < box.y + 4 || y > box.y + box.height - 4) continue;
      await page.mouse.move(x, y);
      const hovered = await stage.getAttribute("data-hovered");
      if (hovered && hovered !== skip) return { x, y };
    }
  }
  throw new Error("no graph node found under the pointer");
}
