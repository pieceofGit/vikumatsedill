// Reviews are posted anonymously to an ntfy.sh topic; ntfy.sh only caches
// messages for ~12h, so the hourly reviews workflow folds them into
// reviews.json for keeps. Shared by the page and that harvester.
export const TOPIC_URL = 'https://ntfy.sh/vikumatsedill-umsagnir-0f3cb0fe4f';
export const MAX_TEXT = 500;
export const SIMILAR = 0.7;

export function toReview(event) {
  if (event.event !== 'message') return null;
  let m;
  try { m = JSON.parse(event.message); } catch { return null; }
  if (!m || typeof m.place !== 'string' || typeof m.dish !== 'string' || !m.place || !m.dish) return null;
  if (!Number.isInteger(m.rating) || m.rating < 1 || m.rating > 5) return null;
  return {
    id: event.id,
    time: event.time,
    place: m.place.slice(0, 80),
    dish: m.dish.slice(0, 200),
    rating: m.rating,
    text: typeof m.text === 'string' ? m.text.slice(0, MAX_TEXT) : '',
    name: typeof m.name === 'string' ? m.name.slice(0, 40) : '',
  };
}

export function parseNtfyLines(body) {
  const reviews = [], rejected = [];
  for (const line of body.split('\n')) {
    if (!line.trim()) continue;
    const event = JSON.parse(line);
    if (event.event !== 'message') continue;
    const r = toReview(event);
    if (r) reviews.push(r); else rejected.push(event.id);
  }
  return { reviews, rejected };
}

const STOP = new Set(['með', 'og', 'í', 'á', 'úr', 'að', 'eða', 'the', 'with', 'and', 'of', 'in']);

function trigrams(name) {
  const t = ' ' + name.toLowerCase().replace(/\(.*?\)/g, '')
    .split(/[^\p{L}]+/u).filter(w => w && !STOP.has(w)).join(' ') + ' ';
  const g = new Set();
  for (let i = 0; i < t.length - 2; i++) g.add(t.slice(i, i + 3));
  return g;
}

// Trigram Dice over the name: Icelandic compounds and inflection defeat
// word-level matching ("tómatsúpa" vs "tómat- og papriku súpa").
export function similarity(a, b) {
  const A = trigrams(a), B = trigrams(b);
  let shared = 0;
  for (const x of A) if (B.has(x)) shared++;
  return (2 * shared) / (A.size + B.size || 1);
}
