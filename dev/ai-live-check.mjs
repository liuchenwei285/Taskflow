// Real-connectivity probe against the LOCAL function server (no mocks).
//   1) node dev/function-local.ts        (reads DEEPSEEK_API_KEY from your env)
//   2) node dev/ai-live-check.mjs
// Prints only status codes / field presence. Never prints secrets or balances.
const BASE = "http://127.0.0.1:8000";

const health = await fetch(BASE + "/health").then((r) => r.json()).catch(() => null);
if (!health || health.ok !== true) {
  console.log("NOT CONNECTED: local function server unreachable at " + BASE);
  process.exit(2);
}
console.log("health:", JSON.stringify(health));
if (!health.configured) {
  console.log("NOT CONNECTED: DEEPSEEK_API_KEY is not set in the function server environment.");
  console.log("Set it in your own shell/env (never in repo files), restart dev/function-local.ts, rerun this probe.");
  process.exit(2);
}

const res = await fetch(BASE + "/functions/v1/app/ai/capture", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    text: "周五晚八点前写完高数作业，大概两小时，很重要",
    lang: "zh",
    tz: -new Date().getTimezoneOffset(),
    now: Date.now(),
  }),
});
const data = await res.json().catch(() => null);
if (res.status === 200 && data && data.ok === true && data.draft) {
  const d = data.draft;
  console.log("CONNECTED: real DeepSeek call succeeded.");
  console.log("draft fields:", JSON.stringify({
    title: typeof d.title === "string" && d.title.length > 0,
    desc: typeof d.desc === "string",
    dueAt: d.dueAt === null || Number.isFinite(d.dueAt),
    priority: ["high", "medium", "low"].includes(d.priority),
    estimatedMs: d.estimatedMs === null || Number.isFinite(d.estimatedMs),
  }));
  console.log("draft:", JSON.stringify(d));
  console.log("usage:", JSON.stringify(data.usage));
  process.exit(0);
}
console.log("NOT CONNECTED: upstream call failed.", "http=" + res.status, JSON.stringify(data && data.error));
process.exit(2);