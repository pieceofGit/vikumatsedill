#!/usr/bin/env node
/**
 * Watches in-progress matches and pushes when one turns genuinely tense.
 *
 * ESPN's scoreboard carries, for a live match, the clock, the score, per-side
 * shot counts, and a `details` array holding every goal with the minute it was
 * scored. That timeline is enough to spot comebacks and lead changes without
 * remembering anything between polls — state is only needed so the same match
 * is not announced twice.
 *
 * Sends via Telegram when TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set;
 * otherwise prints what it would have sent and exits cleanly, so the detector
 * can be watched against real matches before it is wired up.
 *
 * Usage:  node tools/live-alerts.mjs [--state <path>] [--force]
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { enqueue, flush, DELAY_MINUTES } from './notify.mjs'
import { sameClub } from './clubs.mjs'
import { readCommands, watching, describe } from './commands.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d }
const STATE = argOf('--state', join(ROOT, '.live-state.json'))
const THRESHOLD = Number(process.env.EXCITEMENT_THRESHOLD ?? 10)

const BOARDS = {
  pl: 'https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard',
  ucl: 'https://site.api.espn.com/apis/site/v2/sports/soccer/uefa.champions/scoreboard',
}

/* ------------------------------------------------------------- excitement */

/**
 * Only ever interested in a live match that is still in the balance and far
 * enough along to matter — "an even match that is ongoing". Everything past
 * the gate is a question of how much drama it has accumulated.
 */
function assess (ev, isBig, fpl) {
  const c = ev.competitions?.[0]
  const st = c?.status ?? ev.status
  if (st?.type?.state !== 'in') return null
  if (/halftime|half time/i.test(st?.type?.name ?? '')) return null

  const home = c.competitors?.find((x) => x.homeAway === 'home')
  const away = c.competitors?.find((x) => x.homeAway === 'away')
  if (!home || !away) return null

  const hs = Number(home.score) || 0
  const as = Number(away.score) || 0
  const minute = Math.floor((Number(st.clock) || 0) / 60)
  const margin = Math.abs(hs - as)

  const head = { id: ev.id, minute, hs, as,
    home: home.team?.shortDisplayName ?? home.team?.displayName,
    away: away.team?.shortDisplayName ?? away.team?.displayName,
    clock: st.type?.detail ?? `${minute}'` }

  if (margin > 1) return { ...head, eligible: false, why: `${margin}-goal margin` }
  if (minute < 50) return { ...head, eligible: false, why: 'not past the hour yet' }

  const goals = (c.details ?? []).filter((d) => d.scoringPlay)
    .map((d) => ({ min: Math.floor((d.clock?.value ?? 0) / 60), team: d.team?.id }))
    .sort((a, b) => a.min - b.min)
  const reds = (c.details ?? []).filter((d) => d.redCard).length

  const stat = (side, name) => Number(
    side.statistics?.find((s) => s.name === name)?.displayValue) || 0
  const sot = stat(home, 'shotsOnTarget') + stat(away, 'shotsOnTarget')

  // Walk the goal timeline: who was ahead, and how often that changed hands.
  let h = 0, a = 0, leader = null, leadChanges = 0, lateEqualiser = false
  for (const g of goals) {
    if (g.team === home.team?.id) h++; else a++
    const now = h > a ? 'h' : a > h ? 'a' : null
    if (now && leader && now !== leader) leadChanges++
    if (now) leader = now
    if (h === a && g.min >= 70) lateEqualiser = true
  }

  const total = hs + as
  const lastGoal = goals.length ? goals[goals.length - 1].min : null
  const recentGoal = lastGoal != null && minute - lastGoal <= 12

  const reasons = []
  let score = 0
  const add = (n, why) => { if (n > 0) { score += n; if (why) reasons.push(why) } }

  add(Math.min(total, 4), total >= 3 ? `${total} goals` : null)
  add(sot >= 10 ? 3 : sot >= 7 ? 2 : sot >= 4 ? 1 : 0, sot >= 7 ? `${sot} shots on target` : null)
  add(recentGoal ? 3 : 0, recentGoal ? `goal on ${lastGoal}'` : null)
  add(Math.min(leadChanges * 2, 4), leadChanges ? `${leadChanges} lead change${leadChanges > 1 ? 's' : ''}` : null)
  add(lateEqualiser ? 3 : 0, lateEqualiser ? 'late equaliser' : null)
  add(reds ? 2 : 0, reds ? `${reds} red card${reds > 1 ? 's' : ''}` : null)
  add(minute >= 85 ? 3 : minute >= 75 ? 2 : minute >= 65 ? 1 : 0, null)
  add(isBig ? 2 : 0, null)

  // A match with your fantasy captain in it is worth more of your evening.
  const mine = [...(fpl?.home ?? []), ...(fpl?.away ?? [])].filter((p) => !p.benched)
  const captain = mine.find((p) => p.captain)
  add(captain ? 2 : mine.length >= 3 ? 1 : 0,
    captain ? `${captain.name} (C) playing` : mine.length >= 3 ? `${mine.length} of your players` : null)
  if (hs === as) add(1, null)

  return { ...head, eligible: true, score, reasons }
}

/* ------------------------------------------------------------------ output */

async function channelsFor (m) {
  try {
    const data = JSON.parse(await readFile(join(ROOT, 'data/fixtures.json'), 'utf8'))
    const today = new Date().toISOString().slice(0, 10)
    const hit = data.matches.find((x) =>
      (x.date === today || x.ukDate === today) &&
      sameClub(x.home, m.home) && sameClub(x.away, m.away))
    if (!hit) return { line: null, big: false, fpl: null }
    const name = (k) => data.broadcasters[hit.channels?.[k]?.broadcaster]?.name
    const parts = []
    if (name('is')) parts.push(`${name('is')} (IS)`)
    if (name('uk') && hit.channels.uk.broadcaster !== 'blackout') parts.push(`${name('uk')} (UK)`)
    return { line: parts.join(' · ') || null, big: Boolean(hit.alert), fpl: hit.fpl ?? null }
  } catch { return { line: null, big: false, fpl: null } }
}

/* -------------------------------------------------------------------- main */

const main = async () => {
  const state = await readFile(STATE, 'utf8').then(JSON.parse).catch(() => ({}))
  state.matches ??= {}
  const today = new Date().toISOString().slice(0, 10)
  for (const k of Object.keys(state.matches)) {
    if (state.matches[k].day !== today) delete state.matches[k]
  }

  // Anything held from an earlier poll goes out first.
  await flush(state)

  // Then find out whether you have told the bot you are watching.
  await readCommands(state)
  const mode = watching(state)
  console.log(describe(state))

  const live = []
  for (const [comp, url] of Object.entries(BOARDS)) {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = await res.json()
      for (const ev of body.events ?? []) live.push([comp, ev])
    } catch (e) {
      console.warn(`warn: ${comp} scoreboard unavailable (${e.message})`)
    }
  }

  const inPlay = live.filter(([, ev]) =>
    (ev.competitions?.[0]?.status ?? ev.status)?.type?.state === 'in')
  console.log(`${live.length} fixtures on the boards, ${inPlay.length} in play`)

  let pushed = 0
  for (const [comp, ev] of inPlay) {
    const st = ev.competitions?.[0]?.status ?? ev.status
    const atHalfTime = /halftime|half.time/i.test(st?.type?.name ?? '')
    const was = state.matches[ev.id] ?? {}

    // The one thing watching mode does say. Announced on the transition into
    // half-time, so it fires once rather than on every poll of the interval.
    if (atHalfTime && was.phase !== 'HT') {
      const probe = assess({ ...ev, competitions: [{ ...ev.competitions[0],
        status: { ...st, type: { ...st.type, name: 'PLAY' } } }] }, false)
      const involved = probe && (!mode?.team ||
        sameClub(probe.home, mode.team) || sameClub(probe.away, mode.team))
      if (mode && probe && involved) {
        enqueue(state, `ht:${ev.id}`,
          `⏸ <b>Half-time</b>\n${probe.home} ${probe.hs}–${probe.as} ${probe.away}`)
        pushed++
      }
    }
    state.matches[ev.id] = { ...was, day: today, phase: atHalfTime ? 'HT' : 'play' }
    if (atHalfTime) continue

    // Everything below is a spoiler, which is the whole point of watching mode.
    if (mode) continue

    const probe = assess(ev, false)
    if (!probe) continue
    if (!probe.eligible) {
      console.log(`  ${probe.home} ${probe.hs}-${probe.as} ${probe.away} ${probe.clock}` +
        ` → skipped, ${probe.why}`)
      continue
    }
    const { line, big, fpl } = await channelsFor(probe)
    const m = assess(ev, big, fpl)
    const prev = state.matches[m.id]

    console.log(`  ${m.home} ${m.hs}-${m.as} ${m.away} ${m.clock}` +
      ` → ${m.score}/${THRESHOLD}${m.reasons.length ? ` (${m.reasons.join(', ')})` : ''}` +
      `${m.score >= THRESHOLD ? '  ** ALERT **' : ''}`)

    if (m.score < THRESHOLD && !args.includes('--force')) continue
    // One nudge per match, and a second only if the score has moved since.
    if (prev && prev.count >= 2) continue
    if (prev && prev.at === `${m.hs}-${m.as}`) continue

    const text = [
      `⚽️ <b>${m.home} ${m.hs}–${m.as} ${m.away}</b> · ${m.clock}`,
      m.reasons.length ? m.reasons.join(' · ') : 'Still anyone’s game',
      line ? `📺 ${line}` : null,
      `<a href="https://pieceofgit.github.io/vikumatsedill/footy/">Full guide</a>`,
    ].filter(Boolean).join('\n')

    enqueue(state, `match:${m.id}:${m.hs}-${m.as}`, text)
    state.matches[m.id] = { ...prev, day: today, at: `${m.hs}-${m.as}`, count: (prev?.count ?? 0) + 1 }
    pushed++
  }

  console.log(`${pushed} match alert${pushed === 1 ? '' : 's'} queued (${DELAY_MINUTES}m delay)`)
  await mkdir(dirname(STATE), { recursive: true })
  await writeFile(STATE, JSON.stringify(state, null, 1))
}

main().catch((e) => { console.error('live-alerts failed:', e.message); process.exit(1) })
