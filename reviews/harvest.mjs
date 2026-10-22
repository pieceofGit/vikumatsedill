import fs from 'node:fs';
import { TOPIC_URL, parseNtfyLines, applyDeletions } from './core.mjs';

const FILE = new URL('../reviews.json', import.meta.url);

const res = await fetch(`${TOPIC_URL}/json?poll=1&since=all`);
if (!res.ok) throw new Error(`ntfy ${res.status}: ${await res.text()}`);
const { reviews, deletions, rejected } = parseNtfyLines(await res.text());
if (rejected.length) console.warn(`Skipped ${rejected.length} malformed message(s): ${rejected.join(', ')}`);

const stored = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const byId = new Map(stored.map(r => [r.id, r]));
for (const r of reviews) if (!byId.has(r.id)) byId.set(r.id, r);
await applyDeletions(byId, deletions);

const all = [...byId.values()].sort((a, b) => a.time - b.time);
fs.writeFileSync(FILE, JSON.stringify(all, null, 1) + '\n');
console.log(`${all.length} review(s) stored (was ${stored.length}; ${reviews.length} posted, ${deletions.length} deletion(s) cached on ntfy).`);
