#!/usr/bin/env node
/**
 * Builds footy/data/fixtures.json — the dataset the site reads.
 *
 * Premier League fixtures come from the openfootball project (no API key).
 * That feed carries the real kickoff times, and in the UK the kickoff slot
 * *is* the broadcaster: the rights deal splits the week into fixed windows.
 * So we map slot -> channel, and mark anything we inferred as such.
 *
 * Champions League fixtures have no free feed, so they are read from
 * data/ucl.json, which is maintained by hand.
 *
 * Usage:  node tools/build-fixtures.mjs [--season 2026-27] [--offline]
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d }
const SEASON = argOf('--season', '2026-27')
const PL_SOURCE = `https://raw.githubusercontent.com/openfootball/football.json/master/${SEASON}/en.1.json`

/* ---------------------------------------------------------------- channels */

const BROADCASTERS = {
  sky:      { name: 'Sky Sports',        short: 'Sky',    tint: '#0a58ff',
              how: 'Sky Sports Premier League / Main Event, or streamed on NOW with a Sports Membership.' },
  tnt:      { name: 'TNT Sports',        short: 'TNT',    tint: '#ffd400',
              how: 'TNT Sports 1–4, or streamed on HBO Max, which replaced discovery+ as its UK streaming home in March 2026.' },
  amazon:   { name: 'Amazon Prime Video', short: 'Prime', tint: '#00a8e1',
              how: 'Included with an Amazon Prime membership.' },
  bbc:      { name: 'BBC',               short: 'BBC',    tint: '#d4145a',
              how: 'Free to air. Highlights on Match of the Day (BBC One) and BBC iPlayer.' },
  blackout: { name: 'Not shown live in the UK', short: 'Blackout', tint: '#8a8f98',
              how: 'The 3pm Saturday blackout: UK broadcasters may not show any football live between 14:45 and 17:15 on a Saturday. Highlights follow on Match of the Day.' },
  tbc:      { name: 'Not selected yet',  short: 'TBC',    tint: '#8a8f98',
              how: 'Broadcasters pick matches roughly five to six weeks ahead. Until then the kickoff time shown is the provisional one.' },
}

/* The UK Premier League broadcast grid: weekday + kickoff -> who shows it. */
const PL_SLOTS = {
  'Fri 20:00': 'sky',
  'Sat 12:30': 'tnt',
  'Sat 15:00': 'blackout',
  'Sat 17:30': 'sky',
  'Sat 20:00': 'sky',
  'Sun 14:00': 'sky',
  'Sun 16:30': 'sky',
  'Mon 20:00': 'sky',
}
const MIDWEEK = new Set(['Tue', 'Wed', 'Thu'])

const SHORT = {
  'AFC Bournemouth': 'Bournemouth', 'Brighton & Hove Albion FC': 'Brighton',
  'Wolverhampton Wanderers FC': 'Wolves', 'Tottenham Hotspur FC': 'Tottenham',
  'Manchester City FC': 'Man City', 'Manchester United FC': 'Man Utd',
  'Newcastle United FC': 'Newcastle', 'Nottingham Forest FC': "Nott'm Forest",
  'Leeds United FC': 'Leeds', 'Ipswich Town FC': 'Ipswich',
  'Coventry City FC': 'Coventry', 'West Ham United FC': 'West Ham',
  'Sheffield United FC': 'Sheffield Utd', 'West Bromwich Albion FC': 'West Brom',
  'Leicester City FC': 'Leicester', 'Queens Park Rangers FC': 'QPR',
}
const COLOURS = {
  Arsenal: '#ef0107', 'Aston Villa': '#670e36', Bournemouth: '#da291c',
  Brentford: '#e30613', Brighton: '#0057b8', Chelsea: '#034694',
  Coventry: '#78d0f3', 'Crystal Palace': '#1b458f', Everton: '#003399',
  Fulham: '#1b1b1b', 'Hull City': '#f5a12d', Ipswich: '#3a64a3',
  Leeds: '#ffcd00', Liverpool: '#c8102e', 'Man City': '#6cabdd',
  'Man Utd': '#da291c', Newcastle: '#2b2b2b', "Nott'm Forest": '#dd0000',
  Sunderland: '#eb172b', Tottenham: '#132257', Wolves: '#fdb913',
}

const shorten = (n) => SHORT[n] ?? n.replace(/^AFC\s+/, '').replace(/\s+(FC|AFC)$/, '')
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const weekday = (iso) => DAYS[new Date(`${iso}T12:00:00Z`).getUTCDay()]

/* Kickoffs are published in UK time and the broadcast slots are UK slots, but
 * the page shows Icelandic time. Iceland stays on GMT all year; the UK does
 * not, so from late March to late October the two are an hour apart and the
 * conversion has to be real rather than a fixed offset. */
const UK = 'Europe/London'
const ICELAND = 'Atlantic/Reykjavik'

const partsIn = (tz, date) => {
  const dtf = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' })
  return Object.fromEntries(dtf.formatToParts(date)
    .filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]))
}
const offsetMs = (tz, date) => {
  const p = partsIn(tz, date)
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - date.getTime()
}
/* a wall-clock time in `tz` -> the actual instant */
const zonedToUtc = (dateStr, timeStr, tz) => {
  const naive = Date.parse(`${dateStr}T${timeStr}:00Z`)
  let ts = naive - offsetMs(tz, new Date(naive))
  ts = naive - offsetMs(tz, new Date(ts))   // second pass settles DST boundaries
  return new Date(ts)
}
/* an instant -> { date, time, day } as read in `tz` */
const readIn = (tz, date) => {
  const p = partsIn(tz, date)
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, day: p.weekday }
}

/* ------------------------------------------------------------------ build */

async function loadJson (path, fallback) {
  try { return JSON.parse(await readFile(join(ROOT, path), 'utf8')) }
  catch { return fallback }
}

async function premierLeague () {
  let raw
  if (args.includes('--offline')) {
    raw = await loadJson('data/.cache-pl.json', null)
    if (!raw) throw new Error('no cached Premier League data; run once without --offline')
  } else {
    const res = await fetch(PL_SOURCE)
    if (!res.ok) throw new Error(`${PL_SOURCE} -> HTTP ${res.status}`)
    raw = await res.json()
    await writeFile(join(ROOT, 'data/.cache-pl.json'), JSON.stringify(raw))
  }

  // A round is "TV-picked" once its kickoffs have been spread across slots.
  // Until then every match sits on a provisional placeholder time.
  const rounds = new Map()
  for (const m of raw.matches) {
    if (!rounds.has(m.round)) rounds.set(m.round, new Set())
    rounds.get(m.round).add(m.time)
  }
  const picked = new Set([...rounds].filter(([, t]) => t.size > 1).map(([r]) => r))

  return raw.matches.map((m) => {
    const home = shorten(m.team1)
    const away = shorten(m.team2)
    const day = weekday(m.date)          // UK weekday — the slot grid is a UK grid
    const isPicked = picked.has(m.round)
    const kickoff = zonedToUtc(m.date, m.time, UK)
    const local = readIn(ICELAND, kickoff)

    let broadcaster = 'tbc'
    let confidence = 'tbc'
    let note = null

    if (isPicked) {
      const slotted = PL_SLOTS[`${day} ${m.time}`]
      if (slotted) {
        broadcaster = slotted
        confidence = slotted === 'blackout' ? 'rule' : 'slot'
      } else if (MIDWEEK.has(day)) {
        broadcaster = 'tbc'
        note = 'Midweek round — every match is shown live, split between Sky Sports and TNT Sports.'
      }
    } else if (m.round === `Matchday ${rounds.size}`) {
      note = 'Final day: all ten matches kick off together and all are shown live.'
    }

    return {
      id: `pl-${slug(m.round)}-${slug(home)}-${slug(away)}`,
      comp: 'pl',
      round: m.round,
      date: local.date,
      time: local.time,
      ukDate: m.date,
      ukTime: m.time,
      kickoff: kickoff.toISOString(),
      provisionalTime: !isPicked,
      home, away, homeFull: m.team1, awayFull: m.team2,
      homeColour: COLOURS[home] ?? null, awayColour: COLOURS[away] ?? null,
      broadcaster, confidence, note,
      score: m.score?.ft ?? null,
    }
  })
}

/* ---------------------------------------------- champions league sources ---
 * There is no openfootball feed for the Champions League, so the fixtures come
 * from one of three places, in order of preference:
 *
 *   1. football-data.org  — documented and stable, Champions League is on the
 *      permanent free tier. Needs a free key in FOOTBALL_DATA_TOKEN.
 *   2. ESPN's undocumented public API — no key at all, but unofficial: the
 *      shape can change without notice, so every field is read defensively.
 *   3. data/ucl.json — kept by hand.
 *
 * None of these say who is broadcasting; that still comes from the UK rights
 * rule below. Every source is normalised to UK wall-clock date/time first,
 * because the rights rule is expressed in UK time.
 */
async function uclFromFootballData () {
  const token = process.env.FOOTBALL_DATA_TOKEN
  if (!token) return null
  const year = SEASON.slice(0, 4)
  const url = `https://api.football-data.org/v4/competitions/CL/matches?season=${year}`
  const res = await fetch(url, { headers: { 'X-Auth-Token': token } })
  if (!res.ok) throw new Error(`football-data.org HTTP ${res.status}`)
  const body = await res.json()
  const stageName = (m) => m.stage === 'LEAGUE_STAGE'
    ? `League phase MD${m.matchday}`
    : String(m.stage ?? '').replace('LAST_16', 'Round of 16').replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase())
  return body.matches.map((m) => {
    const uk = readIn(UK, new Date(m.utcDate))
    const ft = m.score?.fullTime
    return {
      date: uk.date, time: uk.time,
      home: m.homeTeam?.shortName ?? m.homeTeam?.name ?? 'TBC',
      away: m.awayTeam?.shortName ?? m.awayTeam?.name ?? 'TBC',
      round: stageName(m),
      leaguePhase: m.stage === 'LEAGUE_STAGE',
      score: ft && ft.home != null ? [ft.home, ft.away] : null,
    }
  })
}

async function uclFromEspn () {
  const year = Number(SEASON.slice(0, 4))
  const url = 'https://site.api.espn.com/apis/site/v2/sports/soccer/uefa.champions/scoreboard'
    + `?limit=500&dates=${year}0701-${year + 1}0701`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`ESPN HTTP ${res.status}`)
  const body = await res.json()
  const events = body?.events
  if (!Array.isArray(events) || !events.length) throw new Error('ESPN returned no events')
  return events.map((ev) => {
    const comp = ev.competitions?.[0]
    const side = (which) => {
      const c = comp?.competitors?.find((x) => x.homeAway === which)
      return c?.team?.shortDisplayName ?? c?.team?.displayName ?? 'TBC'
    }
    const uk = readIn(UK, new Date(ev.date))
    const headline = comp?.notes?.[0]?.headline ?? ''
    // Before February the competition is still in its league phase; the
    // headline says so when ESPN provides one.
    const leaguePhase = /league phase|matchday/i.test(headline) ||
      (!headline && Number(uk.date.slice(5, 7)) >= 8)
    const scores = comp?.competitors?.length === 2 && comp.status?.type?.completed
      ? [Number(comp.competitors.find((x) => x.homeAway === 'home')?.score),
         Number(comp.competitors.find((x) => x.homeAway === 'away')?.score)]
      : null
    return {
      date: uk.date, time: uk.time,
      home: side('home'), away: side('away'),
      round: headline || 'Champions League',
      leaguePhase,
      score: scores && scores.every(Number.isFinite) ? scores : null,
    }
  })
}

async function uclFixtures () {
  if (args.includes('--offline')) return null
  for (const [label, fn] of [['football-data.org', uclFromFootballData], ['ESPN', uclFromEspn]]) {
    try {
      const out = await fn()
      if (out?.length) { console.log(`champions   source: ${label}`); return out }
    } catch (e) {
      console.warn(`warn: ${label} unavailable (${e.message})`)
    }
  }
  return null
}

async function championsLeague () {
  const live = await uclFixtures()
  const file = live ? { matches: live } : await loadJson('data/ucl.json', { matches: [] })
  return (file.matches ?? []).map((m, i) => {
    const day = weekday(m.date)          // UK weekday
    const leaguePhase = m.leaguePhase ?? /league phase/i.test(m.round ?? '')
    let broadcaster = m.broadcaster
    let confidence = m.broadcaster ? 'confirmed' : 'rule'
    // Amazon take first pick of one Tuesday match per matchweek, so on a
    // Tuesday we cannot say which of the two it is until they announce.
    if (!broadcaster) broadcaster = (day === 'Tue' && leaguePhase) ? 'tbc' : 'tnt'

    const kickoff = m.time ? zonedToUtc(m.date, m.time, UK) : null
    const local = kickoff ? readIn(ICELAND, kickoff) : { date: m.date, time: null }

    return {
      id: m.id ?? `ucl-${slug(m.round ?? 'r')}-${slug(m.home ?? '')}-${i}`,
      comp: 'ucl',
      round: m.round ?? 'Champions League',
      date: local.date,
      time: local.time,
      ukDate: m.date,
      ukTime: m.time ?? null,
      kickoff: kickoff ? kickoff.toISOString() : null,
      provisionalTime: !m.time,
      home: m.home, away: m.away,
      homeFull: m.home, awayFull: m.away,
      homeColour: COLOURS[m.home] ?? null, awayColour: COLOURS[m.away] ?? null,
      broadcaster, confidence,
      note: m.note ?? (broadcaster === 'tbc'
        ? 'Tuesday league-phase night: Amazon Prime Video take first pick of one match, TNT Sports show the rest.'
        : null),
      score: m.score ?? null,
    }
  })
}

const main = async () => {
  const overrides = await loadJson('data/overrides.json', {})
  const matches = [...await premierLeague(), ...await championsLeague()]

  let applied = 0
  for (const m of matches) {
    const o = overrides[m.id]
    if (!o || m.id.startsWith('_')) continue
    Object.assign(m, o, { confidence: 'confirmed' })
    applied++
  }

  matches.sort((a, b) => (a.date + (a.time ?? '')).localeCompare(b.date + (b.time ?? '')))

  const out = {
    generatedAt: new Date().toISOString(),
    season: SEASON,
    timezone: 'Atlantic/Reykjavik',
    broadcasters: BROADCASTERS,
    competitions: {
      pl: { name: 'Premier League', short: 'PL' },
      ucl: { name: 'Champions League', short: 'UCL' },
    },
    sources: [
      { name: 'openfootball / football.json', url: PL_SOURCE, covers: 'Premier League fixtures and kickoff times' },
      { name: 'football-data.org / ESPN / data/ucl.json', url: null, covers: 'Champions League fixtures' },
    ],
    matches,
  }
  await writeFile(join(ROOT, 'data/fixtures.json'), JSON.stringify(out, null, 1) + '\n')

  const pl = matches.filter((m) => m.comp === 'pl')
  console.log(`season      ${SEASON}`)
  console.log(`premier lg  ${pl.length} matches, ${pl.filter((m) => m.broadcaster !== 'tbc').length} with a channel`)
  console.log(`champions   ${matches.filter((m) => m.comp === 'ucl').length} matches`)
  console.log(`overrides   ${applied} applied`)
  console.log(`wrote       data/fixtures.json`)
}

main().catch((e) => { console.error('build failed:', e.message); process.exit(1) })
