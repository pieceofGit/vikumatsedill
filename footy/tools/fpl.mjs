#!/usr/bin/env node
/**
 * Fetches a Fantasy Premier League squad and writes data/fpl.json, so the
 * fixture list can say which of your players are in a given match.
 *
 * The FPL API is public and needs no key. Your team id is the number in the
 * URL when you look at your own side:
 *   fantasy.premierleague.com/entry/<THIS NUMBER>/event/3
 *
 * Pass it as FPL_TEAM_ID, or --team <id>. With no id this writes nothing and
 * exits cleanly, so the rest of the build is unaffected.
 *
 * Usage:  FPL_TEAM_ID=123456 node tools/fpl.mjs
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d }
const API = 'https://fantasy.premierleague.com/api'
const POSITIONS = { 1: 'GKP', 2: 'DEF', 3: 'MID', 4: 'FWD' }

const get = async (path) => {
  const res = await fetch(`${API}${path}`, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`)
  return res.json()
}

async function teamId () {
  const fromArg = argOf('--team', process.env.FPL_TEAM_ID)
  if (fromArg) return String(fromArg).trim()
  // fall back to whatever a previous run stored
  try {
    const prev = JSON.parse(await readFile(join(ROOT, 'data/fpl.json'), 'utf8'))
    return prev.teamId ? String(prev.teamId) : null
  } catch { return null }
}

const main = async () => {
  const id = await teamId()
  if (!id || !/^\d+$/.test(id)) {
    console.log('fpl         no team id set (FPL_TEAM_ID); skipping')
    return
  }

  const boot = await get('/bootstrap-static/')
  const clubs = new Map(boot.teams.map((t) => [t.id, t.name]))
  const players = new Map(boot.elements.map((p) => [p.id, p]))

  // The current gameweek, or the one just gone if the season is between weeks.
  const event = boot.events.find((e) => e.is_current) ??
    boot.events.filter((e) => e.finished).pop() ?? boot.events[0]

  const entry = await get(`/entry/${id}/`)

  let picks = []
  try {
    const p = await get(`/entry/${id}/event/${event.id}/picks/`)
    picks = p.picks ?? []
  } catch (e) {
    // Picks stay hidden until the gameweek deadline passes.
    console.warn(`warn: picks for GW${event.id} unavailable (${e.message})`)
  }

  const squad = picks.map((pick) => {
    const p = players.get(pick.element)
    return {
      id: pick.element,          // FPL element id — the key the live feed uses
      name: p?.web_name ?? `#${pick.element}`,
      club: clubs.get(p?.team) ?? null,
      position: POSITIONS[p?.element_type] ?? null,
      captain: Boolean(pick.is_captain),
      vice: Boolean(pick.is_vice_captain),
      benched: pick.multiplier === 0,
      points: p?.event_points ?? null,
    }
  })

  const out = {
    fetchedAt: new Date().toISOString(),
    teamId: Number(id),
    name: entry.name ?? null,
    manager: [entry.player_first_name, entry.player_last_name].filter(Boolean).join(' ') || null,
    gameweek: event.id,
    gameweekName: event.name ?? null,
    overallPoints: entry.summary_overall_points ?? null,
    overallRank: entry.summary_overall_rank ?? null,
    gameweekPoints: entry.summary_event_points ?? null,
    players: squad,
  }
  await writeFile(join(ROOT, 'data/fpl.json'), JSON.stringify(out, null, 1) + '\n')

  const starting = squad.filter((p) => !p.benched).length
  console.log(`fpl         "${out.name}" GW${event.id}: ${squad.length} players (${starting} starting)`)
}

main().catch((e) => {
  // Never fail the build over fantasy data.
  console.warn(`warn: FPL fetch failed (${e.message}); leaving data/fpl.json as is`)
})
