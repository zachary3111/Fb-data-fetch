import { parseLooseDate } from "../src/utils/postTime.js";

const now = new Date("2025-10-07T10:30:00Z");
const rel = (s) => parseLooseDate(s, { now });

const cases = [
  ["15 minutes",           new Date(now.getTime() - 15*60*1000).toISOString()],
  ["6 hours",               new Date(now.getTime() - 6*60*60*1000).toISOString()],
  ["2 days",                new Date(now.getTime() - 2*24*60*60*1000).toISOString()],
  ["Yesterday at 12:00 PM", (() => { const d = new Date(now); d.setDate(d.getDate()-1); d.setHours(12,0,0,0); return d.toISOString(); })()],
];

const failed = [];
for (const [input, expected] of cases) {
  const got = rel(input);
  if (!got || got !== expected) failed.push({ input, expected, got });
}

if (failed.length) {
  console.error("EDGE FAIL:", JSON.stringify(failed, null, 2));
  process.exit(1);
}
console.log("EDGE OK:", cases.length, "cases");