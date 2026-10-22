import { TOPIC_URL, MAX_TEXT, SIMILAR, toReview, parseNtfyLines, applyDeletions, similarity, sha256hex } from './core.mjs';

const byId = new Map();
const NAME_KEY = 'vikumatsedill:name';
const MINE_KEY = 'vikumatsedill:mine';
const mine = JSON.parse(localStorage.getItem(MINE_KEY) || '{}');
const saveMine = () => localStorage.setItem(MINE_KEY, JSON.stringify(mine));

const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids.filter(k => k != null));
  return n;
};
const stars = n => '★'.repeat(n) + '☆'.repeat(5 - n);
const fmtDate = t => new Date(t * 1000).toLocaleDateString('is-IS', { day: 'numeric', month: 'short', year: 'numeric' });

function matches(place, dish) {
  return [...byId.values()]
    .filter(r => r.place === place && (r.dish === dish || similarity(r.dish, dish) >= SIMILAR))
    .sort((a, b) => b.time - a.time);
}

function form(place, dish) {
  const f = el('form', { className: 'rv__form' });
  const rate = el('fieldset', { className: 'rv__rate' }, el('legend', { textContent: 'Einkunn' }));
  for (let i = 5; i >= 1; i--) {
    const id = `rv-${Math.random().toString(36).slice(2)}`;
    rate.append(
      el('input', { type: 'radio', name: 'rating', value: i, id, required: true }),
      el('label', { htmlFor: id, textContent: '★', title: `${i} af 5` }));
  }
  const text = el('textarea', { name: 'text', rows: 2, maxLength: MAX_TEXT, placeholder: 'Hvernig var þetta?' });
  const name = el('input', { name: 'name', maxLength: 40, placeholder: 'Nafn (valfrjálst)', value: localStorage.getItem(NAME_KEY) || '' });
  const send = el('button', { type: 'submit', textContent: 'Senda' });
  const status = el('span', { className: 'rv__status', role: 'status' });
  f.append(rate, text, el('div', { className: 'rv__row' }, name, send), status);

  f.addEventListener('submit', async e => {
    e.preventDefault();
    send.disabled = true;
    status.textContent = '';
    localStorage.setItem(NAME_KEY, name.value.trim());
    const secret = crypto.randomUUID();
    try {
      const res = await fetch(TOPIC_URL, {
        method: 'POST',
        body: JSON.stringify({ place, dish, rating: Number(f.rating.value), text: text.value.trim(), name: name.value.trim(), key: await sha256hex(secret) }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const r = toReview(await res.json());
      if (!r) throw new Error('ógilt svar');
      byId.set(r.id, r);
      mine[r.id] = secret;
      saveMine();
      renderAll();
    } catch (err) {
      console.error('review post failed', err);
      status.textContent = 'Tókst ekki að senda, reyndu aftur.';
      send.disabled = false;
    }
  });
  return f;
}

function deleteButton(r) {
  const b = el('button', { type: 'button', className: 'rv__del', textContent: 'Eyða' });
  b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      const res = await fetch(TOPIC_URL, { method: 'POST', body: JSON.stringify({ delete: r.id, secret: mine[r.id] }) });
      if (!res.ok) throw new Error(`${res.status}`);
      byId.delete(r.id);
      delete mine[r.id];
      saveMine();
      renderAll();
    } catch (err) {
      console.error('review delete failed', err);
      b.textContent = 'Tókst ekki, reyndu aftur';
      b.disabled = false;
    }
  });
  return b;
}

function render(li) {
  const { place, dish } = li.dataset;
  const found = matches(place, dish);
  const details = li.querySelector('.rv');
  const summary = details.querySelector('summary');
  const body = details.querySelector('.rv__body');

  if (found.length) {
    const avg = found.reduce((s, r) => s + r.rating, 0) / found.length;
    summary.textContent = `★ ${avg.toLocaleString('is-IS', { maximumFractionDigits: 1 })} · ${found.length} ${found.length === 1 ? 'umsögn' : 'umsagnir'}`;
  } else summary.textContent = 'Gefa umsögn';

  body.replaceChildren(...[
    found.length ? el('ul', { className: 'rv__list' }, ...found.map(r => el('li', {},
      el('span', { className: 'rv__stars', textContent: stars(r.rating), title: `${r.rating} af 5` }),
      r.text ? el('q', { textContent: r.text }) : null,
      el('span', { className: 'rv__meta', textContent: [r.name, fmtDate(r.time)].filter(Boolean).join(' · ') }),
      r.dish !== dish ? el('span', { className: 'rv__similar', textContent: `Um svipaðan rétt: ${r.dish}` }) : null,
      mine[r.id] ? deleteButton(r) : null,
    ))) : null,
    found.some(r => mine[r.id] && r.dish === dish)
      ? el('span', { className: 'rv__meta', textContent: 'Þú hefur gefið þessum rétti einkunn.' })
      : form(place, dish)].filter(Boolean));
}

function renderAll() {
  document.querySelectorAll('li[data-dish]').forEach(render);
}

const [stored, live] = await Promise.allSettled([
  fetch(`reviews.json?t=${Date.now()}`).then(r => { if (!r.ok) throw new Error(`reviews.json ${r.status}`); return r.json(); }),
  fetch(`${TOPIC_URL}/json?poll=1&since=12h`).then(r => { if (!r.ok) throw new Error(`ntfy ${r.status}`); return r.text(); }),
]);
if (stored.status === 'fulfilled') stored.value.forEach(r => byId.set(r.id, r));
else console.error('stored reviews unavailable', stored.reason);
if (live.status === 'fulfilled') {
  const { reviews, deletions } = parseNtfyLines(live.value);
  reviews.forEach(r => byId.set(r.id, r));
  await applyDeletions(byId, deletions);
} else console.error('recent reviews unavailable', live.reason);
renderAll();
