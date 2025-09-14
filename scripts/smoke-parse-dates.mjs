import { parseLooseDate } from "../src/utils/postTime.js";

const now = new Date("2025-09-13T12:00:00+08:00");
const rel = (s) => parseLooseDate(s, { now });

// Expectations expressed in UTC (toISOString) to be timezone-agnostic.
const cases = [
  ["Just now",              new Date(now).toISOString()],
  ["1m",                    new Date(now.getTime() - 1*60*1000).toISOString()],
  ["2 h",                   new Date(now.getTime() - 2*60*60*1000).toISOString()],
  ["Yesterday at 3:45 PM",  (() => { const d = new Date(now); d.setDate(d.getDate()-1); d.setHours(15,45,0,0); return d.toISOString(); })()],
  ["September 13 at 2:34 PM", (() => { const d = new Date(now); d.setMonth(8,13); d.setHours(14,34,0,0); return d.toISOString(); })()],
];

const failed = [];
for (const [input, expected] of cases) {
  const got = rel(input);
  if (!got || got !== expected) failed.push({ input, expected, got });
}

if (failed.length) {
  console.error("SMOKE FAIL:", JSON.stringify(failed, null, 2));
  process.exit(1);
}
console.log("SMOKE OK:", cases.length, "cases");