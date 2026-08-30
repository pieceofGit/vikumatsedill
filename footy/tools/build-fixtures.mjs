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
              how: 'Sky Sports Premier League / Main Event. Also streamed on NOW with a Sports Membership.' },
  tnt:      { name: 'TNT Sports',        short: 'TNT',    tint: '#ffd400',
              how: 'TNT Sports 1–4. Also streamed on discovery+ with a TNT Sports add-on.' },
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
    const day = weekday(m.date)
    const isPicked = picked.has(m.round)

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
      date: m.date,
      time: m.time,
      provisionalTime: !isPicked,
      home, away, homeFull: m.team1, awayFull: m.team2,
      homeColour: COLOURS[home] ?? null, awayColour: COLOURS[away] ?? null,
      broadcaster, confidence, note,
      score: m.score?.ft ?? null,
    }
  })
}

/* Optional live source. football-data.org's free tier covers the Champions
 * League; set FOOTBALL_DATA_TOKEN to use it. Without a token we fall back to
 * the hand-kept data/ucl.json, and a failure here is never fatal. */
async function uclFromApi () {
  const token = process.env.FOOTBALL_DATA_TOKEN
  if (!token || args.includes('--offline')) return null
  const year = SEASON.slice(0, 4)
  const url = `https://api.football-data.org/v4/competitions/CL/matches?season=${year}`
  try {
    const res = await fetch(url, { headers: { 'X-Auth-Token': token } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = await res.json()
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    })
    const ukParts = (iso) => {
      const p = Object.fromEntries(parts.formatToParts(new Date(iso)).map((x) => [x.type, x.value]))
      return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` }
    }
    const stageName = (m) => m.stage === 'LEAGUE_STAGE'
      ? `League phase MD${m.matchday}`
      : m.stage.replace('LAST_16', 'Round of 16').replace(/_/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase())
    return body.matches.map((m) => {
      const { date, time } = ukParts(m.utcDate)
      const ft = m.score?.fullTime
      return {
        date, time,
        home: m.homeTeam?.shortName ?? m.homeTeam?.name ?? 'TBC',
        away: m.awayTeam?.shortName ?? m.awayTeam?.name ?? 'TBC',
        round: stageName(m),
        leaguePhase: m.stage === 'LEAGUE_STAGE',
        score: ft && ft.home != null ? [ft.home, ft.away] : null,
      }
    })
  } catch (e) {
    console.warn(`warn: Champions League feed unavailable (${e.message}); using data/ucl.json`)
    return null
  }
}

async function championsLeague () {
  const live = await uclFromApi()
  const file = live ? { matches: live } : await loadJson('data/ucl.json', { matches: [] })
  return (file.matches ?? []).map((m, i) => {
    const day = weekday(m.date)
    // UK rule: Amazon take first pick of one Tuesday league-phase match each
    // matchweek; TNT Sports show everything else, including all knockout ties.
    const leaguePhase = m.leaguePhase ?? /league phase/i.test(m.round ?? '')
    let broadcaster = m.broadcaster
    let confidence = m.broadcaster ? 'confirmed' : 'rule'
    // Amazon take first pick of one Tuesday match per matchweek, so on a
    // Tuesday we cannot say which of the two it is until they announce.
    if (!broadcaster) broadcaster = (day === 'Tue' && leaguePhase) ? 'tbc' : 'tnt'
    return {
      id: m.id ?? `ucl-${slug(m.round ?? 'r')}-${i}`,
      comp: 'ucl',
      round: m.round ?? 'Champions League',
      date: m.date,
      time: m.time ?? null,
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
    timezone: 'Europe/London',
    broadcasters: BROADCASTERS,
    competitions: {
      pl: { name: 'Premier League', short: 'PL' },
      ucl: { name: 'Champions League', short: 'UCL' },
    },
    sources: [
      { name: 'openfootball / football.json', url: PL_SOURCE, covers: 'Premier League fixtures and kickoff times' },
      { name: 'data/ucl.json', url: null, covers: 'Champions League fixtures (maintained by hand)' },
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
