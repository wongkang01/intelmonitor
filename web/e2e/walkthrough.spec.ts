// The POC walkthrough (poc-plan.md, Verification > E2E) against the running dev servers. It reads
// whatever the pipeline produced through the API to decide what to click and what to expect, and
// undoes its own changes at the end so it can run again.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { api, API_URL, type Schema } from "../lib/api/client";
import { answerText, changeCounts, shortDate } from "../lib/format";

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
      await expect(widget.locator(".row.dev").first()).toContainText(wc.developments[0].title);

      // Show all opens the dashboard's changed developments, with the widget's counts.
      await widget.getByRole("link", { name: "Show all" }).click();
      await expect(page).toHaveURL(`/developments?dashboard=${starter.id}&changed=1`);
      const changes = page.getByRole("region", { name: "What changed since last review" });
      await expect(changes.locator(".mon-lead")).toHaveText(changeCounts(wc));
      await expect(changes.locator(".row.dev")).toHaveCount(wc.developments.length);
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

      const actions = page.getByRole("region", { name: "Actions" });
      const reviewed = page.waitForResponse((r) => r.url().endsWith("/reviews") && r.request().method() === "POST");
      await actions.getByRole("button", { name: "Mark reviewed" }).click();
      expect((await reviewed).ok()).toBe(true);
      await expect(page.getByText(`${entity.name} marked reviewed`)).toBeVisible();
      await expect(actions.getByText(/^Reviewed /)).toBeVisible();

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

    await step(STEPS[7], async () => {
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

    await step(STEPS[8], async () => {
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

    await step(STEPS[9], async () => {
      // A word from a latest-run development title that finds developments and documents.
      const all = await unwrap(api.GET("/developments", { params: { query: { limit: 20 } } }));
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
