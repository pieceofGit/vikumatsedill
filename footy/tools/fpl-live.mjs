#!/usr/bin/env node
/**
 * Pushes when someone in your fantasy squad does something worth knowing about
 * — a goal, an assist, a saved penalty, a clean sheet, bonus points, a haul.
 *
 * FPL's live endpoint reports per-player stats for the gameweek, keyed by the
 * same element id stored in data/fpl.json, so the squad matches exactly. Every
 * alert is a *delta* against the previous poll, which is why this keeps state.
 *
 * Premier League only — the fantasy game does not track European nights.
 *
 * Usage:  node tools/fpl-live.mjs [--state <path>] [--dry]
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d }
const STATE = argOf('--state', join(ROOT, '.fpl-state.json'))
const API = 'https://fantasy.premierleague.com/api'

const get = async (url) => {
  const res = await fetch(url, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`)
  return res.json()
}
const readJson = (p, fallback) => readFile(join(ROOT, p), 'utf8')
  .then(JSON.parse).catch(() => fallback)

/* What counts as worth interrupting someone for. Each returns a phrase, or
 * null if this particular jump is not interesting. */
const MOMENTS = [
  { stat: 'goals_scored', say: (n, tot) => tot > 1 ? `scored again — ${tot} now` : 'scored', icon: '⚽️' },
  { stat: 'assists', say: (n) => n > 1 ? `${n} assists` : 'assisted', icon: '🅰️' },
  { stat: 'penalties_saved', say: () => 'saved a penalty', icon: '🧤' },
  { stat: 'clean_sheets', say: () => 'kept a clean sheet', icon: '🛡️' },
  { stat: 'bonus', say: (n) => `picked up ${n} bonus`, icon: '⭐️' },
]

async function liveScores () {
  // Score and clock for context, from the same board the match alerts use.
  const out = new Map()
  try {
    const b = await get('https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard')
    for (const ev of b.events ?? []) {
      const c = ev.competitions?.[0]
      const st = c?.status ?? ev.status
      const h = c?.competitors?.find((x) => x.homeAway === 'home')
      const a = c?.competitors?.find((x) => x.homeAway === 'away')
      if (!h || !a) continue
      const line = `${h.team?.shortDisplayName} ${h.score}–${a.score} ${a.team?.shortDisplayName}`
        + ` · ${st?.type?.detail ?? ''}`.trimEnd()
      for (const t of [h, a]) out.set((t.team?.shortDisplayName ?? '').toLowerCase(), line)
    }
  } catch { /* context is optional */ }
  return out
}

async function send (text) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chat = process.env.TELEGRAM_CHAT_ID
  if (!token || !chat || args.includes('--dry')) {
    console.log('[dry run — would have sent]')
    console.log(text)
    return 'dry-run'
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  })
  if (!res.ok) throw new Error(`Telegram HTTP ${res.status}: ${await res.text()}`)
  return 'sent'
}

const main = async () => {
  const squad = await readJson('data/fpl.json', null)
  if (!squad?.players?.length) {
    console.log('no squad in data/fpl.json (set FPL_TEAM_ID); nothing to watch')
    return
  }
  const mine = new Map(squad.players.filter((p) => p.id).map((p) => [p.id, p]))
  if (!mine.size) {
    console.log('squad has no player ids — re-run tools/fpl.mjs')
    return
  }

  const boot = await get(`${API}/bootstrap-static/`)
  const event = boot.events.find((e) => e.is_current)
  if (!event) { console.log('no gameweek in progress'); return }

  const live = await get(`${API}/event/${event.id}/live/`)
  const state = await readFile(STATE, 'utf8').then(JSON.parse).catch(() => ({}))
  if (state.gameweek !== event.id) { state.gameweek = event.id; state.players = {} }
  state.players ??= {}

  const scores = await liveScores()
  const fixtures = await readJson('data/fixtures.json', { matches: [], broadcasters: {} })
  const today = new Date().toISOString().slice(0, 10)

  let sent = 0
  for (const el of live.elements ?? []) {
    const player = mine.get(el.id)
    if (!player) continue
    const now = el.stats ?? {}
    const was = state.players[el.id] ?? {}
    const first = !Object.keys(was).length

    const moments = []
    for (const m of MOMENTS) {
      const delta = (now[m.stat] ?? 0) - (was[m.stat] ?? 0)
      if (delta > 0) moments.push({ icon: m.icon, phrase: m.say(delta, now[m.stat] ?? 0) })
    }
    // Hauls, announced once per threshold crossed.
    const pts = now.total_points ?? 0
    for (const bar of [10, 15, 20]) {
      if (pts >= bar && (was.total_points ?? 0) < bar) moments.push({ icon: '🔥', phrase: `${pts} points` })
    }

    state.players[el.id] = {
      goals_scored: now.goals_scored ?? 0, assists: now.assists ?? 0,
      penalties_saved: now.penalties_saved ?? 0, clean_sheets: now.clean_sheets ?? 0,
      bonus: now.bonus ?? 0, total_points: pts,
    }

    // The first poll of a gameweek is a baseline, not news.
    if (first || !moments.length) continue

    const who = `${player.name}${player.captain ? ' (C)' : player.vice ? ' (V)' : ''}`
    const context = scores.get((player.club ?? '').toLowerCase())
    const fixture = fixtures.matches?.find((x) =>
      x.date === today && x.fpl &&
      [...(x.fpl.home ?? []), ...(x.fpl.away ?? [])].some((p) => p.name === player.name))
    const channel = fixture && fixtures.broadcasters[fixture.channels?.is?.broadcaster]?.name

    const [lead, ...rest] = moments
    const text = [
      `${lead.icon} <b>${who} ${lead.phrase}</b>`,
      ...rest.map((m) => `${m.icon} ${m.phrase}`),
      context ? `\n${context}` : null,
      `${pts} pts this gameweek${player.captain ? ' (doubled as captain)' : ''}`,
      channel ? `📺 ${channel}` : null,
    ].filter(Boolean).join('\n')

    console.log(`${player.name}: ${moments.map((m) => m.phrase).join(', ')} (${pts} pts)`)
    console.log(`  → ${await send(text)}`)
    sent++
  }

  console.log(`GW${event.id}: ${sent} squad alert${sent === 1 ? '' : 's'}`)
  await mkdir(dirname(STATE), { recursive: true })
  await writeFile(STATE, JSON.stringify(state, null, 1))
}

main().catch((e) => { console.error('fpl-live failed:', e.message); process.exit(1) })
