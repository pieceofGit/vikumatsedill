#!/usr/bin/env node
/**
 * Weekly pointers for the fantasy squad: who to captain, who is coasting, who
 * is worth bringing in, and what the fixtures look like from here.
 *
 * Everything is derived from FPL's own bootstrap-static and fixture list, both
 * public. That includes expected goals — FPL publishes xG, xA and expected goal
 * involvements per player, which is the one genuinely predictive input here.
 *
 * The ranking is a stated heuristic, not a model. Every number that feeds it is
 * shown alongside the verdict so it can be argued with rather than trusted.
 *
 * Usage:  node tools/fpl-advice.mjs [--horizon 5]
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d }
const HORIZON = Number(argOf('--horizon', 5))
const API = 'https://fantasy.premierleague.com/api'
const POS = { 1: 'GKP', 2: 'DEF', 3: 'MID', 4: 'FWD' }

const get = async (path) => {
  const res = await fetch(`${API}${path}`, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`)
  return res.json()
}
const num = (v) => Number(v) || 0

/**
 * How good the next few fixtures look, 1 (brutal) to 5 (kind).
 * FPL's own difficulty runs 1–5 the other way, so it is simply inverted.
 */
const ease = (fixtures) => fixtures.length
  ? fixtures.reduce((a, f) => a + (6 - f.difficulty), 0) / fixtures.length
  : 3

/**
 * An ordering, not a prediction. Recent form and season-long scoring rate
 * carry it; fixtures nudge it; anyone flagged or barely playing is pushed down.
 */
function rate (el, fixtures) {
  const base = 0.5 * num(el.form) + 0.5 * num(el.points_per_game)
  const fixtureFactor = 0.75 + (ease(fixtures) - 3) * 0.12   // 0.51 … 0.99 … 1.23
  const playing = el.status === 'a'
    ? Math.min(1, num(el.minutes) / Math.max(1, num(el.starts) * 80 || 90))
    : 0.35
  return Number((base * fixtureFactor * playing).toFixed(2))
}

const main = async () => {
  const squad = await readFile(join(ROOT, 'data/fpl.json'), 'utf8')
    .then(JSON.parse).catch(() => null)
  if (!squad?.players?.length) {
    console.log('advice      no squad in data/fpl.json; skipping')
    return
  }

  const boot = await get('/bootstrap-static/')
  const fixtures = await get('/fixtures/?future=1')
  const clubs = new Map(boot.teams.map((t) => [t.id, t.short_name || t.name]))
  const byId = new Map(boot.elements.map((p) => [p.id, p]))
  const next = boot.events.find((e) => e.is_next) ?? boot.events.find((e) => e.is_current)

  /* Every club's next few fixtures, with the difficulty FPL assigns them.
   * Counting fixtures rather than gameweeks means a double gameweek simply
   * shows up as two, which is the right way round for planning. */
  const ahead = new Map()
  for (const f of [...fixtures].sort((a, b) => (a.event ?? 99) - (b.event ?? 99))) {
    if (!f.event) continue
    for (const [side, opp, diff] of [
      ['team_h', 'team_a', f.team_h_difficulty],
      ['team_a', 'team_h', f.team_a_difficulty],
    ]) {
      const list = ahead.get(f[side]) ?? []
      if (list.length < HORIZON) {
        list.push({
          gw: f.event, opponent: clubs.get(f[opp]) ?? '?',
          home: side === 'team_h', difficulty: diff,
        })
      }
      ahead.set(f[side], list)
    }
  }

  const describe = (el) => {
    const fx = ahead.get(el.team) ?? []
    return {
      id: el.id,
      name: el.web_name,
      club: clubs.get(el.team) ?? '?',
      position: POS[el.element_type],
      price: num(el.now_cost) / 10,
      form: num(el.form),
      ppg: num(el.points_per_game),
      total: num(el.total_points),
      xgi90: num(el.expected_goal_involvements_per_90),
      xgc: num(el.expected_goals_conceded),
      minutes: num(el.minutes),
      starts: num(el.starts),
      owned: num(el.selected_by_percent),
      status: el.status,
      news: (el.news ?? '').trim() || null,
      priceMomentum: num(el.transfers_in_event) - num(el.transfers_out_event),
      fixtures: fx,
      ease: Number(ease(fx).toFixed(1)),
      rating: rate(el, fx),
    }
  }

  const mine = squad.players
    .map((p) => ({ ...describe(byId.get(p.id) ?? {}), captain: p.captain, vice: p.vice, benched: p.benched }))
    .filter((p) => p.name)

  /* ---- captain: best rating among those actually starting ---------------- */
  const captainRanking = mine
    .filter((p) => !p.benched && p.status === 'a')
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 4)
    .map((p) => ({ name: p.name, rating: p.rating, opponent: p.fixtures[0], xgi90: p.xgi90, form: p.form }))

  /* ---- transfers: who is dragging, and who could replace them ------------ */
  const bank = squad.bank ?? 0
  const pool = boot.elements.filter((el) =>
    el.status === 'a' && num(el.minutes) > 60 && !squad.players.some((p) => p.id === el.id))

  const weakest = [...mine].sort((a, b) => a.rating - b.rating).slice(0, 3)
  const suggestions = weakest.map((p) => {
    const budget = p.price + bank
    const options = pool
      .filter((el) => POS[el.element_type] === p.position && num(el.now_cost) / 10 <= budget)
      .map(describe)
      .filter((c) => c.rating > p.rating * 1.15)
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 3)
      .map((c) => ({
        name: c.name, club: c.club, price: c.price, rating: c.rating,
        form: c.form, xgi90: c.xgi90, ease: c.ease, owned: c.owned,
        fixtures: c.fixtures.slice(0, 3),
      }))
    return { out: { name: p.name, club: p.club, position: p.position, price: p.price, rating: p.rating,
                    form: p.form, ease: p.ease, status: p.status, news: p.news }, options }
  }).filter((s) => s.options.length)

  const out = {
    generatedAt: new Date().toISOString(),
    gameweek: next?.id ?? null,
    gameweekName: next?.name ?? null,
    deadline: next?.deadline_time ?? null,
    horizon: HORIZON,
    bank,
    method: 'Rating = (form + points per game) / 2, adjusted for the difficulty of the '
      + `next ${HORIZON} fixtures and for how reliably the player starts. A heuristic for `
      + 'ordering, not a projection — the inputs are all shown so it can be argued with.',
    squad: mine.sort((a, b) => b.rating - a.rating),
    captainRanking,
    suggestions,
  }
  await writeFile(join(ROOT, 'data/advice.json'), JSON.stringify(out, null, 1) + '\n')

  console.log(`advice      GW${next?.id}: captain pick ${captainRanking[0]?.name ?? '?'}`
    + `, ${suggestions.length} transfer idea(s)`)
}

main().catch((e) => { console.warn(`warn: advice failed (${e.message})`) })
