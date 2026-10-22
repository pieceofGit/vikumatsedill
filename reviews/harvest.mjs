import fs from 'node:fs';
import { TOPIC_URL, parseNtfyLines } from './core.mjs';

const FILE = new URL('../reviews.json', import.meta.url);

const res = await fetch(`${TOPIC_URL}/json?poll=1&since=all`);
if (!res.ok) throw new Error(`ntfy ${res.status}: ${await res.text()}`);
const { reviews, rejected } = parseNtfyLines(await res.text());
if (rejected.length) console.warn(`Skipped ${rejected.length} malformed message(s): ${rejected.join(', ')}`);

const stored = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const known = new Set(stored.map(r => r.id));
const fresh = reviews.filter(r => !known.has(r.id));
if (!fresh.length) {
  console.log(`No new reviews (${reviews.length} cached on ntfy, ${stored.length} stored).`);
  process.exit(0);
}
const all = [...stored, ...fresh].sort((a, b) => a.time - b.time);
fs.writeFileSync(FILE, JSON.stringify(all, null, 1) + '\n');
console.log(`Added ${fresh.length} review(s), ${all.length} total.`);
