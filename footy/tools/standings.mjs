#!/usr/bin/env node
/**
 * Writes data/standings.json — the league tables, plus each club's recent form.
 *
 * The table comes from ESPN; the form is derived from our own fixture results,
 * because that way the two always agree with what the site is showing.
 *
 * Usage:  node tools/standings.mjs
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sameClub } from './clubs.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCES = {
  pl: { name: 'Premier League', url: 'https://site.api.espn.com/apis/v2/sports/soccer/eng.1/standings' },
  ucl: { name: 'Champions League', url: 'https://site.api.espn.com/apis/v2/sports/soccer/uefa.champions/standings' },
}

const stat = (entry, name) => {
  const s = entry.stats?.find((x) => x.name === name)
  return s ? Number(s.value ?? s.displayValue) : null
}

/** Last five results for a club, newest first, from played fixtures. */
function formFor (matches, comp, team) {
  return matches
    .filter((m) => m.comp === comp && m.score &&
      (sameClub(m.home, team) || sameClub(m.away, team)))
    .sort((a, b) => (b.date).localeCompare(a.date))
    .slice(0, 5)
    .map((m) => {
      const home = sameClub(m.home, team)
      const [f, a] = home ? m.score : [m.score[1], m.score[0]]
      return { r: f > a ? 'W' : f < a ? 'L' : 'D', opponent: home ? m.away : m.home, score: `${f}-${a}` }
    })
}

/* If ESPN is unreachable, the table can still be built from the results we
 * already hold. It will not know about points deductions, but it beats having
 * no table at all. */
function tableFromResults (matches, comp) {
  const rows = new Map()
  const row = (t) => {
    if (!rows.has(t)) {
      rows.set(t, { team: t, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0 })
    }
    return rows.get(t)
  }
  for (const m of matches) {
    if (m.comp !== comp || !m.score) continue
    const [hs, as] = m.score
    const h = row(m.home); const a = row(m.away)
    h.played++; a.played++
    h.gf += hs; h.ga += as; a.gf += as; a.ga += hs
    if (hs > as) { h.won++; h.points += 3; a.lost++ }
    else if (hs < as) { a.won++; a.points += 3; h.lost++ }
    else { h.drawn++; a.drawn++; h.points++; a.points++ }
  }
  for (const r of rows.values()) r.gd = r.gf - r.ga
  return [...rows.values()]
}

const main = async () => {
  const fixtures = JSON.parse(await readFile(join(ROOT, 'data/fixtures.json'), 'utf8'))
  const tables = {}

  for (const [comp, src] of Object.entries(SOURCES)) {
    try {
      const res = await fetch(src.url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = await res.json()
      const entries = body.children?.[0]?.standings?.entries ?? body.standings?.entries ?? []
      if (!entries.length) throw new Error('no entries')

      // Prefer the club names the rest of the site already uses.
      const known = [...new Set(fixtures.matches.filter((m) => m.comp === comp)
        .flatMap((m) => [m.home, m.away]))]
      const label = (espn) => known.find((k) => sameClub(k, espn)) ?? espn

      tables[comp] = {
        name: src.name,
        rows: entries.map((e) => {
          const team = label(e.team?.shortDisplayName ?? e.team?.displayName ?? '')
          return {
            team,
            played: stat(e, 'gamesPlayed'), won: stat(e, 'wins'),
            drawn: stat(e, 'ties'), lost: stat(e, 'losses'),
            gf: stat(e, 'pointsFor'), ga: stat(e, 'pointsAgainst'),
            gd: stat(e, 'pointDifferential'), points: stat(e, 'points'),
            form: formFor(fixtures.matches, comp, team),
          }
        }).sort((a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf)
          .map((r, i) => ({ rank: i + 1, ...r })),
      }
      console.log(`standings   ${comp}: ${tables[comp].rows.length} teams`)
    } catch (e) {
      const rows = tableFromResults(fixtures.matches, comp)
      if (!rows.length) {
        console.warn(`warn: ${comp} standings unavailable (${e.message})`)
        continue
      }
      console.warn(`warn: ${comp} standings unavailable (${e.message}); computed from results`)
      tables[comp] = {
        name: src.name,
        computed: true,
        rows: rows
          .map((r) => ({ ...r, form: formFor(fixtures.matches, comp, r.team) }))
          .sort((a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf)
          .map((r, i) => ({ rank: i + 1, ...r })),
      }
    }
  }

  if (!Object.keys(tables).length) {
    console.warn('warn: no standings fetched; leaving data/standings.json as is')
    return
  }
  await writeFile(join(ROOT, 'data/standings.json'),
    JSON.stringify({ fetchedAt: new Date().toISOString(), tables }, null, 1) + '\n')
  console.log('wrote       data/standings.json')
}

main().catch((e) => { console.warn(`warn: standings failed (${e.message})`) })
