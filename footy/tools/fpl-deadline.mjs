#!/usr/bin/env node
/**
 * Warns you before a Fantasy Premier League deadline, and whenever one of your
 * fifteen picks up a flag.
 *
 * This is the half of fantasy that actually costs points: not missing a goal
 * alert, but arriving at Saturday with an injured captain and no transfer made.
 * Both signals come from bootstrap-static, which carries each player's status,
 * their chance of playing, the club's note, and the next deadline.
 *
 * Flags are deltas against the previous run, so a flag is announced once rather
 * than every hour until the deadline. Nothing here is a spoiler, so unlike the
 * live alerts it is sent immediately and is not held back by watching mode.
 *
 * Usage:  node tools/fpl-deadline.mjs [--state <path>] [--force-reminder]
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sendNow } from './notify.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d }
const STATE = argOf('--state', join(ROOT, '.fpl-deadline-state.json'))
const API = 'https://fantasy.premierleague.com/api'

/** Hours before the deadline at which to warn, longest first. */
const REMINDERS = [24, 2]

const STATUS = {
  a: null,                    // available — nothing to say
  d: 'doubtful',
  i: 'injured',
  s: 'suspended',
  u: 'unavailable',
  n: 'not in the squad',
}

const get = async (path) => {
  const res = await fetch(`${API}${path}`, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`)
  return res.json()
}

const fmt = (iso) => new Date(iso).toLocaleString('en-GB', {
  timeZone: 'Atlantic/Reykjavik', weekday: 'short', day: 'numeric',
  month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
})

/** A one-line description of why a player is flagged, or null if they are fine. */
function concern (el) {
  const word = STATUS[el.status] ?? null
  const chance = el.chance_of_playing_next_round
  if (!word && (chance == null || chance === 100)) return null
  const bits = [word, chance != null && chance < 100 ? `${chance}% chance` : null]
    .filter(Boolean).join(', ')
  const news = (el.news ?? '').trim()
  return news ? `${bits || 'flagged'} — ${news}` : (bits || 'flagged')
}

const main = async () => {
  const squad = await readFile(join(ROOT, 'data/fpl.json'), 'utf8')
    .then(JSON.parse).catch(() => null)
  if (!squad?.players?.length) {
    console.log('no squad in data/fpl.json; nothing to watch')
    return
  }

  const state = await readFile(STATE, 'utf8').then(JSON.parse).catch(() => ({}))
  state.players ??= {}
  state.remindersSent ??= {}

  const boot = await get('/bootstrap-static/')
  const byId = new Map(boot.elements.map((p) => [p.id, p]))
  const next = boot.events.find((e) => e.is_next) ?? boot.events.find((e) => e.is_current)

  /* ---- flags, as deltas -------------------------------------------------- */
  // A squad with nobody flagged records nothing, so "have we ever run" needs
  // its own marker rather than being inferred from the players map.
  const first = !state.initialised
  const flagged = []
  for (const p of squad.players) {
    const el = byId.get(p.id)
    if (!el) continue
    const now = concern(el)
    const was = state.players[p.id] ?? null
    if (now) flagged.push({ ...p, concern: now })

    // Only speak on a change, and never on the first run — that would announce
    // every pre-existing knock in the squad at once.
    if (now !== was && !first) {
      const when = next ? `\n${next.name} deadline ${fmt(next.deadline_time)}` : ''
      await sendNow(now
        ? `⚠️ <b>${p.name} flagged</b>\n${now}${when}`
        : `✅ <b>${p.name} is available again</b>${when}`)
      console.log(`${p.name}: ${was ?? 'ok'} -> ${now ?? 'ok'} (sent)`)
    }
    state.players[p.id] = now
  }

  state.initialised = true

  /* ---- deadline reminders ------------------------------------------------ */
  if (next?.deadline_time) {
    const hoursLeft = (Date.parse(next.deadline_time) - Date.now()) / 3_600_000
    const sent = state.remindersSent[next.id] ?? []
    const due = REMINDERS.find((h) => hoursLeft > 0 && hoursLeft <= h && !sent.includes(h))

    if (due || args.includes('--force-reminder')) {
      const entry = await get(`/entry/${squad.teamId}/`).catch(() => null)
      const left = hoursLeft >= 2 ? `${Math.round(hoursLeft)} hours` : `${Math.round(hoursLeft * 60)} minutes`
      const lines = [
        `⏳ <b>${next.name} deadline in ${left}</b>`,
        fmt(next.deadline_time),
        '',
        flagged.length
          ? flagged.map((f) => `⚠️ ${f.name} — ${f.concern}`).join('\n')
          : '✅ Nobody in your squad is flagged',
      ]
      if (entry?.last_deadline_bank != null) {
        lines.push('', `💰 ${(entry.last_deadline_bank / 10).toFixed(1)}m in the bank`
          + ` · squad ${(entry.last_deadline_value / 10).toFixed(1)}m (at the last deadline)`)
      }
      await sendNow(lines.join('\n'))
      console.log(`deadline reminder sent (${left} left)`)
      // Mark every threshold already passed, not just this one — otherwise a
      // longer reminder fires after a shorter one it should have preceded.
      if (due) {
        state.remindersSent[next.id] =
          [...new Set([...sent, ...REMINDERS.filter((h) => hoursLeft <= h)])]
      }
    } else {
      console.log(`${next.name} deadline in ${hoursLeft.toFixed(1)}h; ` +
        `${flagged.length} flagged; reminders sent: ${sent.join(', ') || 'none'}`)
    }
  }

  // Keep only the current gameweek's reminder record.
  if (next) state.remindersSent = { [next.id]: state.remindersSent[next.id] ?? [] }

  await mkdir(dirname(STATE), { recursive: true })
  await writeFile(STATE, JSON.stringify(state, null, 1))
}

main().catch((e) => { console.error('fpl-deadline failed:', e.message); process.exit(1) })
