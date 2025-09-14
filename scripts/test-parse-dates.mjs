import { parseLooseDate } from "../src/utils/postTime.js";

const now = new Date("2025-10-07T00:00:00Z");
const rel = (s) => parseLooseDate(s, { now });

const cases = [
  ["3h",                   new Date(now.getTime() - 3*60*60*1000).toISOString()],
  ["4 d",                  new Date(now.getTime() - 4*24*60*60*1000).toISOString()],
  ["Yesterday at 12:00 AM", (() => { const d = new Date(now); d.setDate(d.getDate()-1); d.setHours(0,0,0,0); return d.toISOString(); })()],
  ["December 31 at 11:59 PM", (() => { const d = new Date(now); d.setMonth(11,31); d.setHours(23,59,0,0); return d.toISOString(); })()],
  ["  Just  now  ",         now.toISOString()],
];

const failed = [];
for (const [input, expected] of cases) {
  const got = rel(input);
  if (!got || got !== expected) failed.push({ input, expected, got });
}

if (failed.length) {
  console.error("TEST FAIL:", JSON.stringify(failed, null, 2));
  process.exit(1);
}
console.log("TEST OK:", cases.length, "cases");