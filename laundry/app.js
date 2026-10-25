// Laundry reminder. Everything lives in localStorage on this device; the only
// thing that leaves it is the optional batch of scheduled ntfy.sh messages,
// which is what keeps nagging a phone after the page has gone to sleep.

import { SIRI_TOPIC } from './shared.mjs';

const STORE = 'laundry.v1';
const NTFY = 'https://ntfy.sh';
const PHONE_WINDOW_MIN = 180;   // how long ntfy keeps reminding after the end time
const PHONE_MAX = 25;           // hard cap on messages booked per run (ntfy.sh limits anonymous use)

const MACHINES = {
  washer: { name: 'Washer', emoji: '🫧', tag: 'droplet', presets: [30, 45, 60, 90, 120], fallback: 60 },
  dryer: { name: 'Dryer', emoji: '🌀', tag: 'dash', presets: [30, 45, 60, 90, 120], fallback: 60 },
};

const state = load();
const $ = sel => document.querySelector(sel);

function load() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(STORE)) || {}; } catch {}
  s.interval ??= 10;
  s.ntfy ??= false;
  s.topic ??= 'laundry-' + randomId(12);
  s.machines ??= {};
  for (const m of Object.keys(MACHINES)) s.machines[m] ??= { minutes: MACHINES[m].fallback, run: null };
  return s;
}

function save() {
  try { localStorage.setItem(STORE, JSON.stringify(state)); } catch {}
}

function randomId(n) {
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789';
  return [...crypto.getRandomValues(new Uint8Array(n))].map(b => abc[b % abc.length]).join('');
}

const clock = t => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

function countdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
  const pad = n => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

function ago(ms) {
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  return `${Math.floor(min / 60)} h ${min % 60} min ago`;
}

// ---------- ntfy (phone reminders) ----------

const pageUrl = () => location.origin + location.pathname;

// Each reminder is its own scheduled message with its own sequence ID, because
// ntfy only cancels a scheduled message by deleting its sequence ID.
const seqIds = run => Array.from({ length: run.booked || 0 }, (_, i) => `${run.id}-${i}`);

async function ntfyPost(path, params, body) {
  const res = await fetch(`${NTFY}/${path}?${new URLSearchParams(params)}`, { method: 'POST', body });
  if (!res.ok) throw new Error(`ntfy ${res.status}`);
}

async function bookPhoneReminders(machine, run) {
  if (!state.ntfy || !state.topic) return;
  const { name, tag } = MACHINES[machine];
  const every = state.interval * 60000;
  const count = Math.min(PHONE_MAX, 1 + Math.floor(PHONE_WINDOW_MIN / state.interval));
  const stopUrl = `${pageUrl()}?stop=${encodeURIComponent(`${state.topic}.${run.id}.${count}`)}&finish=${machine}`;
  run.booked = count;
  run.topic = state.topic;
  save();
  const sends = [];
  for (let i = 0; i < count; i++) {
    const at = run.end + i * every;
    if (at - Date.now() < 15000) continue;  // ntfy's minimum delay is 10s; the page covers anything that close
    sends.push(ntfyPost(`${state.topic}/${run.id}-${i}`, {
      title: i === 0 ? `${name} is done` : `${name} still needs emptying`,
      tags: tag,
      priority: i === 0 ? '4' : '5',
      at: String(Math.floor(at / 1000)),
      click: pageUrl(),
      actions: `view, Emptied it, ${stopUrl}, clear=true`,
    }, i === 0 ? `Finished at ${clock(run.end)}.` : `Done since ${clock(run.end)}. Reminder ${i + 1}.`));
  }
  const results = await Promise.allSettled(sends);
  const failed = results.filter(r => r.status === 'rejected').length;
  if (failed) setStatus('ntfy-status', `${failed} of ${sends.length} phone reminders could not be booked.`);
}

async function cancelPhoneReminders(topic, ids) {
  if (!topic || !ids.length) return;
  await Promise.allSettled(ids.map(id => fetch(`${NTFY}/${topic}/${id}`, { method: 'DELETE' })));
}

// ---------- in-page alerts ----------

let audio;
function unlockAudio() {
  audio ??= new (window.AudioContext || window.webkitAudioContext)();
  if (audio.state === 'suspended') audio.resume();
}

function beep() {
  if (!audio) return;
  const t0 = audio.currentTime;
  [0, .35, .7].forEach((d, i) => {
    const osc = audio.createOscillator(), gain = audio.createGain();
    osc.frequency.value = i === 2 ? 1046 : 784;
    gain.gain.setValueAtTime(.0001, t0 + d);
    gain.gain.exponentialRampToValueAtTime(.3, t0 + d + .02);
    gain.gain.exponentialRampToValueAtTime(.0001, t0 + d + .28);
    osc.connect(gain).connect(audio.destination);
    osc.start(t0 + d);
    osc.stop(t0 + d + .3);
  });
}

let swReg = null;
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(r => { swReg = r; }).catch(e => console.warn('service worker', e));
  navigator.serviceWorker.addEventListener('message', e => { if (e.data?.finish) finish(e.data.finish); });
}

async function systemNotify(machine, run, n) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  // ntfy is already putting this on the phone, so don't double up while it's covering this reminder.
  if (run.booked && n < run.booked) return;
  const { name } = MACHINES[machine];
  const opts = {
    body: n === 0 ? `Finished at ${clock(run.end)}.` : `Done since ${clock(run.end)}. Reminder ${n + 1}.`,
    icon: 'icon.svg', tag: `laundry-${machine}`, renotify: true, requireInteraction: true,
    data: { machine }, actions: [{ action: 'finished', title: 'Emptied it' }],
  };
  const title = n === 0 ? `${name} is done` : `${name} still needs emptying`;
  try {
    if (swReg) await swReg.showNotification(title, opts);
    else new Notification(title, opts);
  } catch (e) { console.warn('notification', e); }
}

function alarm(machine, run, n) {
  beep();
  navigator.vibrate?.([300, 150, 300, 150, 600]);
  systemNotify(machine, run, n);
  const card = document.getElementById(machine);
  card.classList.remove('ringing');
  void card.offsetWidth;
  card.classList.add('ringing');
}

// ---------- actions ----------

function start(machine, minutes) {
  unlockAudio();
  minutes = Math.max(1, Math.round(minutes));
  const ms = state.machines[machine];
  ms.minutes = minutes;
  const now = Date.now();
  ms.run = { id: `${machine.slice(0, 1)}${randomId(8)}`, start: now, end: now + minutes * 60000, alerted: 0 };
  save();
  render();
  bookPhoneReminders(machine, ms.run).catch(e => setStatus('ntfy-status', `Phone reminders failed: ${e.message}`));
}

function stop(machine) {
  const run = state.machines[machine].run;
  if (!run) return;
  state.machines[machine].run = null;
  if (run.siri) siriQuietUntil[machine] = Date.now() + 60000;
  save();
  render();
  cancelPhoneReminders(run.topic, seqIds(run));
}
const finish = stop;

function extend(machine, minutes) {
  const ms = state.machines[machine];
  const old = ms.run;
  if (!old) return;
  unlockAudio();
  // Push the end time out from whichever is later: the old end or now (when it's already done).
  const end = Math.max(old.end, Date.now()) + minutes * 60000;
  ms.run = { ...old, id: `${machine.slice(0, 1)}${randomId(8)}`, end, alerted: 0, booked: 0 };
  save();
  render();
  cancelPhoneReminders(old.topic, seqIds(old));
  bookPhoneReminders(machine, ms.run).catch(e => setStatus('ntfy-status', `Phone reminders failed: ${e.message}`));
}

// ---------- rendering ----------

function render() {
  for (const machine of Object.keys(MACHINES)) renderCard(machine);
}

function renderCard(machine) {
  const card = document.getElementById(machine);
  const { name, emoji, presets } = MACHINES[machine];
  const ms = state.machines[machine];
  const run = ms.run;
  const now = Date.now();
  const st = !run ? 'idle' : now < run.end ? 'running' : 'done';
  if (card.dataset.state === st && card.dataset.run === (run?.id ?? '')) return tick(machine);
  card.dataset.state = st;
  card.dataset.run = run?.id ?? '';
  const label = { idle: 'Off', running: 'Running', done: 'Done' }[st];
  const head = `<h2><span aria-hidden="true">${emoji}</span>${name}<span class="state">${label}</span></h2>`;

  if (st === 'idle') {
    card.innerHTML = `${head}
      <div class="chips" role="group" aria-label="Programme length">
        ${presets.map(p => `<button type="button" class="chip" data-min="${p}" aria-pressed="${p === ms.minutes}">${p >= 60 && p % 60 === 0 ? `${p / 60} h` : p >= 60 ? `${Math.floor(p / 60)} h ${p % 60}` : `${p} min`}</button>`).join('')}
      </div>
      <div class="row">
        <label for="${machine}-min">Minutes</label>
        <input type="number" id="${machine}-min" min="1" max="600" inputmode="numeric" value="${ms.minutes}">
        <label for="${machine}-at">or ready at</label>
        <input type="time" id="${machine}-at">
      </div>
      <button type="button" class="primary wide" data-act="start">I switched the ${name.toLowerCase()} on</button>`;
    const min = card.querySelector(`#${machine}-min`), at = card.querySelector(`#${machine}-at`);
    const syncAt = () => { at.value = clock(Date.now() + (+min.value || 0) * 60000); };
    const pick = v => {
      min.value = v;
      syncAt();
      card.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', String(+c.dataset.min === +v)));
    };
    syncAt();
    card.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => pick(+c.dataset.min)));
    min.addEventListener('input', () => pick(min.value));
    at.addEventListener('change', () => {
      if (!at.value) return;
      const [h, m] = at.value.split(':').map(Number);
      const t = new Date(); t.setHours(h, m, 0, 0);
      if (t <= Date.now()) t.setDate(t.getDate() + 1);
      min.value = Math.max(1, Math.round((t - Date.now()) / 60000));
      card.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', String(+c.dataset.min === +min.value)));
    });
    card.querySelector('[data-act="start"]').addEventListener('click', () => {
      const v = +min.value;
      if (!(v >= 1)) { min.focus(); return; }
      start(machine, v);
    });
    return;
  }

  if (st === 'running') {
    card.innerHTML = `${head}
      <div class="big" data-countdown></div>
      <p class="sub">Ready at <b>${clock(run.end)}</b> · ${run.siri ? 'started with Siri' : `started ${clock(run.start)}`}</p>
      <div class="row">
        <button type="button" class="secondary" data-act="plus">+5 min</button>
        <button type="button" class="secondary" data-act="stop">Cancel</button>
      </div>`;
  } else {
    card.innerHTML = `${head}
      <div class="big">Empty me</div>
      <p class="sub" data-since></p>
      <button type="button" class="primary wide" data-act="stop">Finished, I've emptied it</button>
      <div class="row"><button type="button" class="secondary" data-act="plus">Not quite done, +5 min</button></div>`;
  }
  card.querySelector('[data-act="stop"]').addEventListener('click', () => stop(machine));
  card.querySelector('[data-act="plus"]').addEventListener('click', () => extend(machine, 5));
  tick(machine);
}

function tick(machine) {
  const card = document.getElementById(machine);
  const run = state.machines[machine].run;
  if (!run) return;
  const now = Date.now();
  const cd = card.querySelector('[data-countdown]');
  if (cd) cd.textContent = countdown(run.end - now);
  const since = card.querySelector('[data-since]');
  if (since) since.textContent = `Done at ${clock(run.end)} (${ago(now - run.end)}). Next reminder at ${clock(run.end + run.alerted * state.interval * 60000)}.`;
}

// One reminder at the end time and one per interval after it. After a long
// sleep the page rings once and catches up rather than ringing for every miss.
function check() {
  const now = Date.now();
  for (const machine of Object.keys(MACHINES)) {
    const run = state.machines[machine].run;
    if (!run || now < run.end) continue;
    const due = 1 + Math.floor((now - run.end) / (state.interval * 60000));
    if (due > run.alerted) {
      run.alerted = due;
      save();
      alarm(machine, run, due - 1);
    }
  }
  render();
}

function setStatus(id, text, ok = false) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.classList.toggle('ok', ok);
}

// ---------- settings ----------

function initSettings() {
  const interval = $('#interval'), on = $('#ntfy-on'), topic = $('#topic'), setup = $('#ntfy-setup');
  interval.value = String(state.interval);
  on.checked = state.ntfy;
  topic.value = state.topic;
  $('#topic-code').textContent = state.topic;
  setup.hidden = !state.ntfy;

  interval.addEventListener('change', () => { state.interval = +interval.value; save(); render(); });
  on.addEventListener('change', () => { state.ntfy = on.checked; setup.hidden = !on.checked; save(); });
  topic.addEventListener('change', () => {
    const t = topic.value.trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
    state.topic = t || state.topic;
    topic.value = state.topic;
    $('#topic-code').textContent = state.topic;
    save();
  });
  $('#ntfy-test').addEventListener('click', async () => {
    setStatus('ntfy-status', 'Sending…', true);
    try {
      await ntfyPost(state.topic, { title: 'Laundry reminders are working', tags: 'white_check_mark', click: pageUrl() }, 'You will get reminders here when a machine is done.');
      setStatus('ntfy-status', `Sent to ${state.topic}. Check your phone.`, true);
    } catch (e) { setStatus('ntfy-status', `Could not send: ${e.message}`); }
  });

  const allow = $('#allow');
  const showPerm = () => {
    if (!('Notification' in window)) { allow.hidden = true; setStatus('allow-status', 'This browser cannot show notifications.'); return; }
    const p = Notification.permission;
    allow.hidden = p !== 'default';
    setStatus('allow-status', p === 'granted' ? 'Notifications are on.' : p === 'denied' ? 'Notifications are blocked in your browser settings.' : '', p === 'granted');
  };
  allow.addEventListener('click', async () => { unlockAudio(); await Notification.requestPermission(); showPerm(); });
  showPerm();
}

// ---------- Siri shortcut ----------

// The shortcut only sends what was said to SIRI_TOPIC, titled with this
// topic, machine and interval; tools/siri.mjs (run by a GitHub workflow)
// books the reminders from it.
function siriTexts(machine) {
  const base = `${NTFY}/${SIRI_TOPIC}/publish?` + new URLSearchParams({ title: `${state.topic}.${machine}.${state.interval}` });
  return {
    name: MACHINES[machine].name, every: String(state.interval),
    start: `${base}&message=`,
    done: `${base}&message=done`,
  };
}

function renderSiri() {
  const texts = siriTexts($('#siri-machine').value);
  document.querySelectorAll('#siri [data-s]').forEach(el => { el.textContent = texts[el.dataset.s]; });
}

function initSiri() {
  $('#siri-machine').addEventListener('change', renderSiri);
  ['#interval', '#topic'].forEach(sel => $(sel).addEventListener('change', renderSiri));
  document.querySelectorAll('#siri .copy').forEach(btn => btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(siriTexts($('#siri-machine').value)[btn.dataset.copy]);
      btn.textContent = 'Copied';
    } catch { btn.textContent = 'Copy failed'; }
    setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
  }));
  renderSiri();
}

// ---------- picking up runs the Siri shortcut started ----------

// The shortcut never touches this page, so ask ntfy which reminders are still
// waiting under the shortcut's fixed IDs and show that machine as running.
const siriQuietUntil = {};

async function syncSiriRuns() {
  if (!state.ntfy || !state.topic) return;
  let body;
  try {
    const res = await fetch(`${NTFY}/${state.topic}/json?poll=1&sched=1`);
    if (!res.ok) return;
    body = await res.text();
  } catch { return; }
  const now = Date.now(), every = state.interval * 60000;
  const pending = {};
  for (const line of body.split('\n')) {
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    const hit = /^(washer|dryer)-(\d+)$/.exec(m.sequence_id || '');
    if (m.event !== 'message' || !hit || m.time * 1000 <= now) continue;
    const at = m.time * 1000, k = +hit[2];
    if (!pending[hit[1]] || at < pending[hit[1]].at) pending[hit[1]] = { at, k };
  }
  let changed = false;
  for (const machine of Object.keys(MACHINES)) {
    const ms = state.machines[machine];
    if (ms.run && !ms.run.siri) continue;           // a run started here wins
    if ((siriQuietUntil[machine] || 0) > now) continue;
    const p = pending[machine];
    if (!p) {
      // Nothing left on ntfy: the shortcut's run was finished somewhere else.
      if (ms.run?.siri) { ms.run = null; changed = true; }
      continue;
    }
    const end = p.at - (p.k - 1) * every;            // reminder 1 is the end time
    if (ms.run?.siri && Math.abs(ms.run.end - end) < 60000) continue;
    ms.run = { id: machine, siri: true, start: null, end, alerted: Math.max(0, p.k - 1), booked: PHONE_MAX, topic: state.topic };
    changed = true;
  }
  if (changed) { save(); render(); }
}

// ---------- links from the phone notification and Siri Shortcuts ----------

function handleLink() {
  const q = new URLSearchParams(location.search);
  const stopArg = q.get('stop'), finishArg = q.get('finish'), startArg = q.get('start');
  if (!stopArg && !finishArg && !startArg) return;
  history.replaceState(null, '', location.pathname);
  // ?start=washer[&min=60] — what a "turn on the washer" shortcut opens.
  if (startArg) {
    if (!MACHINES[startArg]) return;
    const min = +q.get('min');
    return start(startArg, min >= 1 && min <= 600 ? min : state.machines[startArg].minutes);
  }
  const ms = state.machines[finishArg];
  const [topic, id, count] = (stopArg || '').split('.');
  // A link from an older run must not end the one that's going now.
  if (ms?.run && (!id || ms.run.id === id)) return stop(finishArg);
  // The stop link carries everything needed to cancel, so it also works on a
  // device that never saw this run start.
  if (topic && id && +count > 0) {
    cancelPhoneReminders(topic, Array.from({ length: Math.min(+count, PHONE_MAX) }, (_, i) => `${id}-${i}`));
  }
}

initSettings();
initSiri();
render();
handleLink();
check();
setInterval(check, 1000);
syncSiriRuns();
setInterval(syncSiriRuns, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { check(); syncSiriRuns(); } });
document.addEventListener('pointerdown', unlockAudio, { once: true });
