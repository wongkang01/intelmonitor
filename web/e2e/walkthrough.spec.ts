// The POC walkthrough (poc-plan.md, Verification > E2E) against the running dev servers. It reads
// whatever the pipeline produced through the API to decide what to click and what to expect, and
// undoes its own changes at the end so it can run again.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { api, API_URL, type Schema } from "../lib/api/client";
import { answerText, changeCounts, plural, shortDate, STATE_LABEL } from "../lib/format";

import { runDir, screenshotName, STEPS } from "./steps";

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
      await expect(page.getByRole("button", { name: /^New since review / })).toHaveAccessibleName(`New since review ${current.length}`);
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

      await prompt.fill(ask);
      await prompt.press("Enter");
      await expect(undo.or(failure)).toBeVisible({ timeout: LLM_TIMEOUT });
      await expect(failure).toBeHidden();
      const first = await grid(dialog).count();
      expect(first, "the agent added widgets").toBeGreaterThan(0);

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
      const filters = { ...query, materiality: [Number(level.value)], jurisdiction: [place.value] };
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
