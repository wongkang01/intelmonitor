// The verification harness for IntelMonitor: `pnpm -C web verify <command>`. Agents use it to health
// check the dev servers, reach a feature's page with real ids, drive it through agent-browser and
// keep the evidence. .claude/skills/verify-intelmonitor/SKILL.md documents every command.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import createClient from "openapi-fetch";

import type { paths } from "../lib/api/schema";

const ROOT = path.resolve(import.meta.dirname, "../..");
const WEB_URL = "https://intelmonitor.web.localhost";
const API_URL = "https://intelmonitor.api.localhost";
// Parallel agents each set VERIFY_SESSION so they never drive the same browser.
const SESSION = process.env.VERIFY_SESSION ?? "im-verify";
const EVIDENCE = path.join(ROOT, "artifacts/verify");
const STATE = path.join(EVIDENCE, ".control-state.json");
const STORE = path.join(ROOT, "data/intelmonitor.db");
const SNAPSHOTS = path.join(ROOT, "data/verify-snapshots");

const api = createClient<paths>({ baseUrl: API_URL });

/** A failure the agent can act on: what went wrong and the command that fixes it. */
class Fix extends Error {
  readonly fix: string;
  constructor(message: string, fix: string) {
    super(message);
    this.fix = fix;
  }
}

const print = (value: unknown) => console.log(JSON.stringify(value, null, 1));

/** Runs agent-browser in this harness's own session, never the user's default one. */
const browser = (...args: string[]) =>
  execFileSync("agent-browser", ["--session", SESSION, ...args], { encoding: "utf8" }).trim();

async function reachable(url: string) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(5000) })).ok;
  } catch {
    return false;
  }
}

function portlessRoutes() {
  try {
    return execFileSync("portless", ["list"], { encoding: "utf8" });
  } catch {
    return "";
  }
}

interface Check {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string;
  /** A warning is reported but does not fail doctor. */
  warn?: boolean;
}

/** Read-only answer to "is this instance worth driving?". Exits 1 when a check fails. */
async function doctor() {
  const checks: Check[] = [];
  const routes = portlessRoutes();
  const proxied = ["intelmonitor.web", "intelmonitor.api"].filter((r) => routes.includes(`${r}.localhost`));
  checks.push({
    name: "proxy",
    ok: proxied.length === 2,
    detail: proxied.length ? `routes: ${proxied.join(", ")}` : "no Portless routes",
    fix: "pnpm -C web verify up",
  });

  const apiUp = await reachable(`${API_URL}/health`);
  checks.push({ name: "api", ok: apiUp, detail: apiUp ? `${API_URL}/health ok` : "API not answering", fix: "pnpm -C web verify up" });
  const webUp = await reachable(WEB_URL);
  checks.push({ name: "web", ok: webUp, detail: webUp ? `${WEB_URL} ok` : "web not answering", fix: "pnpm -C web verify up" });

  if (apiUp) {
    const live: unknown = await (await fetch(`${API_URL}/openapi.json`)).json();
    const generated: unknown = JSON.parse(readFileSync(path.join(ROOT, "web/lib/api/openapi.json"), "utf8"));
    const same = isDeepStrictEqual(live, generated);
    checks.push({
      name: "api-types",
      ok: same,
      detail: same ? "web types match the live API" : "the live API's schema differs from web/lib/api/openapi.json",
      fix: "pnpm -C web gen:api, then pnpm -C web typecheck",
    });

    const { data: status } = await api.GET("/runs/status");
    const { data: runs } = await api.GET("/runs");
    const latest = runs?.[0];
    checks.push({
      name: "run",
      ok: !status?.running,
      warn: true,
      detail: status?.running
        ? `run ${status.run_id} is computing; answers change under you`
        : `latest run ${latest?.id ?? "none"} (${latest?.result ?? "no runs"})`,
      fix: "wait for the run to finish: pnpm -C web verify api /runs/status",
    });
  }

  const store = existsSync(STORE) ? statSync(STORE) : null;
  checks.push({
    name: "store",
    ok: store !== null,
    detail: store ? `data/intelmonitor.db ${(store.size / 1e6).toFixed(0)} MB, modified ${store.mtime.toISOString()}` : "no store",
    fix: "restore a snapshot: pnpm -C web verify store restore <file>",
  });

  let agentBrowser = "";
  try {
    agentBrowser = execFileSync("agent-browser", ["--version"], { encoding: "utf8" }).trim();
  } catch {
    // not installed: reported by the check below
  }
  checks.push({ name: "agent-browser", ok: Boolean(agentBrowser), detail: agentBrowser || "not installed", fix: "brew install agent-browser" });

  const head = execFileSync("git", ["-C", ROOT, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["-C", ROOT, "status", "--porcelain"], { encoding: "utf8" }).split("\n").filter(Boolean).length;
  checks.push({ name: "git", ok: true, detail: `HEAD ${head}, ${dirty} changed files` });

  const ok = checks.every((c) => c.ok || c.warn);
  print({ ok, checks: checks.map(({ fix, ...c }) => (c.ok ? c : { ...c, fix })) });
  if (!ok) process.exitCode = 1;
}

interface State {
  /** Process group ids this harness started, so `down` stops only those. */
  pids: Record<string, number>;
}

const readState = (): State => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : { pids: {} });

/** Starts whatever of the proxy, API and web server is not already up, and waits until both answer. */
async function up() {
  mkdirSync(path.join(ROOT, "artifacts/logs"), { recursive: true });
  const state = readState();
  const start = (name: string, cmd: string, args: string[], cwd: string) => {
    const log = openSync(path.join(ROOT, `artifacts/logs/verify-${name}.log`), "a");
    const child = spawn(cmd, args, { cwd, detached: true, stdio: ["ignore", log, log] });
    child.unref();
    if (child.pid) state.pids[name] = child.pid;
  };

  if (!portlessRoutes().includes("Active routes")) execFileSync(path.join(ROOT, "scripts/proxy-start.sh"), { stdio: "inherit" });
  if (!(await reachable(`${API_URL}/health`))) start("api", "portless", ["intelmonitor.api", "uv", "run", "im", "serve"], path.join(ROOT, "api"));
  if (!(await reachable(WEB_URL))) start("web", "portless", ["intelmonitor.web", "pnpm", "dev"], path.join(ROOT, "web"));
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(STATE, JSON.stringify(state));

  const deadline = Date.now() + 120_000;
  while (!((await reachable(`${API_URL}/health`)) && (await reachable(WEB_URL)))) {
    if (Date.now() > deadline) throw new Fix("servers did not answer within 2 minutes", "read artifacts/logs/verify-{api,web}.log");
    await new Promise((r) => setTimeout(r, 1000));
  }
  print({ ok: true, started: Object.keys(state.pids), logs: "artifacts/logs/verify-{api,web}.log" });
}

/** Stops only the servers `up` started; servers the user started keep running. */
function down() {
  const state = readState();
  const stopped = Object.entries(state.pids).flatMap(([name, pid]) => {
    try {
      process.kill(-pid, "SIGTERM");
      return [name];
    } catch {
      return [];
    }
  });
  writeFileSync(STATE, JSON.stringify({ pids: {} }));
  print({ stopped });
}

/** Picks the one item an id or name names; several matches is an error that lists their ids. */
function pick<T extends { id: string; name: string }>(items: T[] | undefined, query: string, kind: string) {
  const q = query.toLowerCase();
  const byId = items?.find((i) => i.id === query);
  if (byId) return byId.id;
  const exact = items?.filter((i) => i.name.toLowerCase() === q) ?? [];
  const hits = exact.length ? exact : (items?.filter((i) => i.name.toLowerCase().includes(q)) ?? []);
  if (hits.length === 1) return hits[0].id;
  const list = `pnpm -C web verify api /${kind}`;
  if (!hits.length) throw new Fix(`no ${kind} match "${query}"`, list);
  throw new Fix(`"${query}" matches ${hits.map((h) => `${h.id} (${h.name})`).join(", ")}`, "pass the id instead");
}

const subjectId = async (query: string) => pick((await api.GET("/subjects")).data, query, "subjects");
const dashboardId = async (query: string) => pick((await api.GET("/dashboards")).data, query, "dashboards");

/** The sidebar's first dashboard, where Home lands, for pages that need one and were given none. */
const firstDashboard = async () => {
  const first = (await api.GET("/dashboards")).data?.[0];
  if (!first) throw new Fix("the store has no dashboards", "pnpm -C web verify api /dashboards");
  return first.id;
};

/** Each target's page path. Arguments are what follows the target name on the command line. */
const TARGETS = {
  home: async () => "/",
  dashboard: async (q: string) => `/dashboards/${await dashboardId(q)}`,
  // A monitor page's tabs: Overview, Developments (the query sets its feed's period and facets),
  // Related and Data; the graph view is reachable by URL only.
  monitor: async (q: string) => `/monitors/${await subjectId(q)}`,
  "monitor-developments": async (q: string, query = "") =>
    `/monitors/${await subjectId(q)}/developments${query ? `?${query.replace(/^\?/, "")}` : ""}`,
  related: async (q: string) => `/monitors/${await subjectId(q)}/related`,
  data: async (q: string) => `/monitors/${await subjectId(q)}/data`,
  graph: async (q: string) => `/monitors/${await subjectId(q)}/graph`,
  // The feed belongs to a dashboard; the query adds the period (days=), facets or q=.
  developments: async (dashboard: string, query = "") => {
    const params = new URLSearchParams(query.replace(/^\?/, ""));
    params.set("dashboard", await dashboardId(dashboard));
    return `/developments?${params}`;
  },
  // A development's popup over a dashboard: the one named (its priority for that dashboard), else the default.
  development: async (id: string, dashboard = "") => {
    const popup = `development=${encodeURIComponent(id)}`;
    if (!dashboard) return `/?${popup}`;
    const d = await dashboardId(dashboard);
    return `/dashboards/${d}?${popup}&scope=dashboard:${d}`;
  },
  // The answer drawer opens over any page; over a dashboard unless one is named.
  answer: async (param: string, dashboard = "") =>
    `/dashboards/${dashboard ? await dashboardId(dashboard) : await firstDashboard()}?answer=${encodeURIComponent(param)}`,
} satisfies Record<string, (...args: string[]) => Promise<string>>;

type Target = keyof typeof TARGETS;
const isTarget = (name: string): name is Target => name in TARGETS;

/** The page URL for a feature target, for example `monitor OCBC` or `developments "Singapore banks" changed=1`. */
async function url([name = "", ...args]: string[]) {
  if (!isTarget(name)) throw new Fix(`unknown target "${name}"`, `use one of: ${Object.keys(TARGETS).join(", ")}`);
  if (name !== "home" && !args[0]) throw new Fix(`${name} needs an argument`, "pnpm -C web verify help lists each target's arguments");
  const [first = "", second] = args;
  return WEB_URL + (await TARGETS[name](first, second));
}

/** Opens a target in the harness browser at the e2e viewport and waits for the network to settle. */
async function open(args: string[]) {
  const target = await url(args);
  browser("set", "viewport", "1440", "900");
  browser("open", target);
  browser("wait", "--load", "networkidle");
  print({ url: browser("get", "url"), title: browser("get", "title") });
}

/** Screenshot plus accessibility snapshot, the pair every proof keeps. `run/name` names the files. */
function shot([name = ""]: string[]) {
  if (!name.includes("/")) throw new Fix("name the shot as <run>/<step>", "pnpm -C web verify shot fix-drawer/01-open");
  const file = path.join(EVIDENCE, name);
  mkdirSync(path.dirname(file), { recursive: true });
  browser("screenshot", `${file}.png`);
  writeFileSync(`${file}.aria.txt`, browser("snapshot", "-c"));
  print({ png: path.relative(ROOT, `${file}.png`), aria: path.relative(ROOT, `${file}.aria.txt`), url: browser("get", "url") });
}

function record([action = "", name = ""]: string[]) {
  if (action === "stop") return print({ stopped: browser("record", "stop") });
  if (action !== "start" || !name.includes("/")) throw new Fix("record start <run>/<name> | record stop", "pnpm -C web verify record start fix-drawer/flow");
  const file = path.join(EVIDENCE, `${name}.webm`);
  mkdirSync(path.dirname(file), { recursive: true });
  browser("record", "start", file);
  print({ recording: path.relative(ROOT, file) });
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

/**
 * Calls the API and prints its JSON: `api /subjects` reads, `api DELETE /reviews/132` or
 * `api POST /notes '{...}'` writes. Writes are for setup and cleanup; proofs act through the UI.
 */
async function call(args: string[]) {
  const [method, target = "", body] = METHODS.includes(args[0]?.toUpperCase() ?? "") ? [args[0].toUpperCase(), ...args.slice(1)] : ["GET", ...args];
  if (!target.startsWith("/")) throw new Fix("give an API path", "pnpm -C web verify api /subjects");
  const res = await fetch(API_URL + target, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body,
  });
  if (!res.ok) throw new Fix(`${method} ${target} returned ${res.status}: ${await res.text()}`, "pnpm -C web verify api /openapi.json lists the paths");
  const text = await res.text();
  print(text ? JSON.parse(text) : { status: res.status });
}

/** `im check <name>`: the API's scripted pipeline checks, each printing JSON. */
function check([name = ""]: string[]) {
  process.stdout.write(execFileSync("uv", ["run", "im", "check", name], { cwd: path.join(ROOT, "api"), encoding: "utf8" }));
}

/** Copies of the live store taken through SQLite's backup, safe while the API serves it. */
function store([action = "", arg = ""]: string[]) {
  mkdirSync(SNAPSHOTS, { recursive: true });
  if (action === "save") {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
    const file = path.join(SNAPSHOTS, `${stamp}${arg ? `-${arg}` : ""}.db`);
    execFileSync("sqlite3", [STORE, `.backup '${file}'`]);
    return print({ saved: path.relative(ROOT, file) });
  }
  if (action === "restore") {
    // `store save` prints the path from the repo root; pnpm -C web runs this from web/.
    const file = [path.resolve(arg), path.resolve(ROOT, arg)].find((f) => existsSync(f)) ?? path.resolve(arg);
    if (!existsSync(file)) throw new Fix(`no snapshot at ${arg}`, "ls data/verify-snapshots");
    // Keep what is replaced, so a restore can be undone.
    const replaced = path.join(SNAPSHOTS, `replaced-${Date.now()}.db`);
    execFileSync("sqlite3", [STORE, `.backup '${replaced}'`]);
    execFileSync("sqlite3", [STORE, `.restore '${file}'`]);
    return print({ restored: path.relative(ROOT, file), replaced: path.relative(ROOT, replaced) });
  }
  throw new Fix("store save [label] | store restore <file>", "pnpm -C web verify store save before-drawer-fix");
}

/** Closes the harness browser session. Evidence under artifacts/verify stays. */
function cleanup() {
  try {
    browser("close");
  } catch {
    // no open session to close
  }
  print({ closed: SESSION, evidence: path.relative(ROOT, EVIDENCE) });
}

const HELP = `pnpm -C web verify <command>

  doctor                      health of proxy, servers, web types, run, store, agent-browser
  up | down                   start what is not running | stop only what up started
  url <target> [arg]          page URL for a target
  open <target> [arg]         open it in the harness browser (session ${SESSION}, 1440x900)
      targets: home, dashboard <dashboard>, monitor <subject>,
               monitor-developments <subject> [query], related <subject>, data <subject>,
               graph <subject>, developments <dashboard> [query],
               development <development-id> [dashboard], answer <subject:question> [dashboard]
      <dashboard> and <subject> are an id or a name that matches one item
  shot <run>/<name>           screenshot + ARIA snapshot to artifacts/verify/<run>/
  record start <run>/<name> | record stop
  api [METHOD] <path> [json]  call the API, e.g. /subjects, DELETE /reviews/132
  check <name>                uv run im check <series|past-run|detector>
  store save [label] | store restore <file>
  cleanup                     close the harness browser; evidence stays

Drive the page itself with: agent-browser --session ${SESSION} <snapshot -i|click|fill|press|...>`;

const COMMANDS: Record<string, (args: string[]) => unknown> = {
  doctor,
  up,
  down,
  url: async (args) => console.log(await url(args)),
  open,
  shot,
  record,
  api: call,
  check,
  store,
  cleanup,
};

const [command = "help", ...args] = process.argv.slice(2);
const run = COMMANDS[command];
if (!run) {
  console.log(HELP);
  if (!["help", "--help", "-h"].includes(command)) process.exitCode = 1;
} else {
  try {
    await run(args);
  } catch (e) {
    if (!(e instanceof Fix)) throw e;
    print({ error: e.message, fix: e.fix });
    process.exitCode = 1;
  }
}
