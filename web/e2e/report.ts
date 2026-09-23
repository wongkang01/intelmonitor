// Writes index.html into the run directory: each walkthrough step with its status, duration,
// error and screenshot, plus the run's video and trace copied next to it.
import type { Reporter, TestCase, TestResult, TestStep } from "@playwright/test/reporter";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { runDir, screenshotName, STEPS } from "./steps";

type Status = "passed" | "failed" | "not run";

interface Row {
  title: string;
  status: Status;
  ms: number;
  error: string | null;
  screenshot: string | null;
}

const escape = (text: string) =>
  text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

// Playwright error messages carry ANSI colour codes.
const plain = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, "");

export default class WalkthroughReporter implements Reporter {
  private result: TestResult | null = null;
  private test: TestCase | null = null;

  onTestEnd(test: TestCase, result: TestResult) {
    this.test = test;
    this.result = result;
  }

  onEnd() {
    const dir = runDir();
    mkdirSync(dir, { recursive: true });
    const result = this.result;
    const steps = new Map<string, TestStep>(
      (result?.steps ?? []).filter((s) => s.category === "test.step").map((s) => [s.title, s]),
    );
    const rows: Row[] = STEPS.map((title, i) => {
      const step = steps.get(title);
      const shot = screenshotName(i);
      return {
        title,
        status: !step ? "not run" : step.error ? "failed" : "passed",
        ms: step?.duration ?? 0,
        error: step?.error?.message ? plain(step.error.message) : null,
        screenshot: existsSync(path.join(dir, shot)) ? shot : null,
      };
    });

    const copied = (name: string, file: string) => {
      const from = result?.attachments.find((a) => a.name === name)?.path;
      if (!from || !existsSync(from)) return null;
      copyFileSync(from, path.join(dir, file));
      return file;
    };
    const video = copied("video", "video.webm");
    const trace = copied("trace", "trace.zip");

    const passed = result?.status === "passed" && rows.every((r) => r.status === "passed");
    const outside = result?.errors
      .map((e) => plain(e.message ?? ""))
      .filter((m) => m && !rows.some((r) => r.error === m));
    writeFileSync(path.join(dir, "index.html"), page({ rows, passed, video, trace, result, test: this.test, outside: outside ?? [] }));
    writeFileSync(
      path.join(dir, "summary.json"),
      JSON.stringify({ passed, status: result?.status ?? "not run", steps: rows }, null, 2),
    );
    console.log(`\nE2E artifacts: ${dir}/index.html`);
  }
}

function page({
  rows,
  passed,
  video,
  trace,
  result,
  test,
  outside,
}: {
  rows: Row[];
  passed: boolean;
  video: string | null;
  trace: string | null;
  result: TestResult | null;
  test: TestCase | null;
  outside: string[];
}) {
  const started = result?.startTime.toISOString() ?? "";
  const seconds = Math.round((result?.duration ?? 0) / 1000);
  const items = rows
    .map(
      (r, i) => `
    <section class="step ${r.status.replace(" ", "-")}">
      <div class="text">
        <div class="head">
          <span class="n">${i + 1}</span>
          <h2>${escape(r.title)}</h2>
        </div>
        <p><span class="status">${r.status}</span>${r.status === "not run" ? "" : `, ${(r.ms / 1000).toFixed(1)} s`}</p>
        ${r.error ? `<pre>${escape(r.error)}</pre>` : ""}
      </div>
      ${r.screenshot ? `<a href="${r.screenshot}"><img src="${r.screenshot}" alt="Step ${i + 1} screenshot" loading="lazy"></a>` : "<span></span>"}
    </section>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>IntelMonitor E2E</title>
<style>
  :root { --ink: #1c1c1e; --ink2: #6e6e73; --line: #e4e4ea; --pass: #1f7a3a; --fail: #c62828; --bg: #f5f5f7; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif; }
  main { max-width: 1100px; margin: 0 auto; padding: 24px 16px 48px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .meta { color: var(--ink2); margin: 0 0 16px; }
  .verdict { font-weight: 600; color: ${passed ? "var(--pass)" : "var(--fail)"}; }
  .files a { margin-right: 16px; }
  video { width: 100%; border: 1px solid var(--line); border-radius: 8px; background: #000; }
  .rec { font-size: 15px; margin: 24px 0 8px; }
  .step { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 16px; background: #fff; border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; margin: 0 0 12px; }
  .head { display: flex; align-items: baseline; gap: 10px; }
  .head h2 { font-size: 15px; margin: 0; }
  .step p { margin: 6px 0 0 22px; color: var(--ink2); }
  .n { color: var(--ink2); font-variant-numeric: tabular-nums; width: 12px; }
  .status { font-weight: 600; }
  .passed .status { color: var(--pass); }
  .failed .status { color: var(--fail); }
  .not-run .status { color: var(--ink2); }
  img { display: block; width: 100%; border: 1px solid var(--line); border-radius: 6px; }
  @media (max-width: 640px) { .step { grid-template-columns: 1fr; } }
  pre { white-space: pre-wrap; background: #fff5f5; border-radius: 6px; padding: 8px; font-size: 12px; overflow-x: auto; }
</style>
</head>
<body>
<main>
  <h1>IntelMonitor E2E</h1>
  <p class="meta"><span class="verdict">${passed ? "Passed" : "Failed"}</span>, ${rows.filter((r) => r.status === "passed").length} of ${rows.length} steps passed. ${escape(test?.title ?? "")}. Started ${escape(started)}, ${seconds} s.</p>
  <p class="files">${video ? `<a href="${video}">Video</a>` : "No video"}${trace ? `<a href="${trace}">Trace</a> <span class="meta">open with <code>pnpm exec playwright show-trace trace.zip</code></span>` : "No trace"}</p>
  ${outside.map((m) => `<pre>${escape(m)}</pre>`).join("")}
  ${items}
  ${video ? `<h2 class="rec">Recording</h2><video src="${video}" controls muted preload="metadata"></video>` : ""}
</main>
</body>
</html>
`;
}
