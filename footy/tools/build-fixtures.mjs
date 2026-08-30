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
import { norm, sameClub, isOneOf } from './clubs.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
/* Populated when a club name fails to line up between feeds, and written into
 * the output so the mismatch can be read off the data rather than a log. */
const DIAGNOSTICS = { unmatchedClubs: [], espnClubs: [] }
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
  syn:      { name: 'Sýn Sport',         short: 'Sýn',    tint: '#7c3aed',
              how: 'Stöð 2 Sport / SÝN Sport, with Icelandic commentary. Sold by Sýn direct or through Síminn, which distributes the same channels.' },
  paramount:{ name: 'Paramount+',        short: 'P+',     tint: '#0f4c9e',
              how: 'Every match streams on Paramount+; a few also air on CBS or CBS Sports Network. Spanish-language coverage is on TUDN and Univision.' },
}

/* Who the listing is for. Iceland leads — this is an Icelandic site. */
const REGIONS = {
  is: { name: 'Iceland', short: 'IS' },
  uk: { name: 'United Kingdom', short: 'UK' },
  us: { name: 'United States', short: 'US' },
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

/* ------------------------------------------------------------ big matches --
 * Two clubs are always flagged, by request. Beyond those, a match is big if it
 * puts two heavyweights against each other, or if it is a named derby — the
 * fixtures people plan an evening around rather than merely watch.
 */
const ALWAYS_BIG = [
  { label: 'Man Utd', names: ['man utd', 'man united', 'manchester united'] },
  { label: 'PSG', names: ['psg', 'paris saint germain', 'paris sg'] },
]

const HEAVYWEIGHTS = [
  ['arsenal'], ['chelsea'], ['liverpool'], ['man city', 'manchester city'],
  ['man utd', 'man united', 'manchester united'], ['tottenham', 'spurs'],
  ['real madrid'], ['barcelona'], ['bayern', 'bayern munchen', 'bayern munich'],
  ['psg', 'paris saint germain'], ['inter milan', 'internazionale'],
  ['ac milan', 'milan'], ['juventus'], ['atletico', 'atletico madrid'],
  ['dortmund', 'borussia dortmund'], ['napoli'], ['as roma', 'roma'],
  ['benfica'], ['porto'], ['ajax'],
]

const DERBIES = [
  [['newcastle'], ['sunderland'], 'Tyne–Wear derby'],
  [['liverpool'], ['everton'], 'Merseyside derby'],
  [['arsenal'], ['tottenham'], 'North London derby'],
  [['man city', 'manchester city'], ['man utd', 'man united'], 'Manchester derby'],
  [['crystal palace'], ['brighton'], 'M23 derby'],
  [['chelsea'], ['fulham'], 'West London derby'],
  [['brentford'], ['fulham'], 'West London derby'],
  [['chelsea'], ['brentford'], 'West London derby'],
  [['leeds'], ['man utd', 'man united'], 'Roses rivalry'],
  [['real madrid'], ['barcelona'], 'El Clásico'],
  [['inter milan'], ['ac milan', 'milan'], 'Derby della Madonnina'],
]

/* Which matches are worth a push notification. Everything a star covers, with
 * one narrowing: PSG earn a nudge for their Champions League nights or a
 * genuinely big tie, not for every routine league game. Manchester United are
 * flagged whatever they are playing. */
function alertWorthy (match) {
  const h = match.highlight
  if (!h) return false
  if (h.kind === 'derby' || h.kind === 'heavyweight') return true
  if (h.reason === 'Man Utd') return true
  if (h.reason === 'PSG') return match.comp === 'ucl'
  return false
}

/* Which of the manager's fantasy players are in this fixture. */
function fplFor (squad, home, away) {
  if (!squad?.players?.length) return null
  const side = (team) => squad.players
    .filter((p) => sameClub(p.club, team))
    .map(({ name, position, captain, vice, benched }) => ({ name, position, captain, vice, benched }))
  const h = side(home)
  const a = side(away)
  if (!h.length && !a.length) return null
  return { home: h, away: a, count: h.length + a.length }
}

/* Returns why a match is big, or null. Most specific reason wins: a derby says
 * more than "two big clubs", which says more than "one club you follow". */
function bigMatch (home, away) {
  for (const [a, b, label] of DERBIES) {
    if ((isOneOf(home, a) && isOneOf(away, b)) || (isOneOf(home, b) && isOneOf(away, a))) {
      return { big: true, reason: label, kind: 'derby' }
    }
  }
  const heavy = (t) => HEAVYWEIGHTS.some((names) => isOneOf(t, names))
  if (heavy(home) && heavy(away)) return { big: true, reason: 'Heavyweight tie', kind: 'heavyweight' }
  for (const { label, names } of ALWAYS_BIG) {
    if (isOneOf(home, names) || isOneOf(away, names)) {
      return { big: true, reason: label, kind: 'follow' }
    }
  }
  return null
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

/* ESPN event ids, so the page can pull a match's detail on demand. The
 * fixtures themselves come from openfootball, which knows nothing about ESPN,
 * so the two are matched on kickoff date and clubs. */
async function espnEventIds (matches) {
  const year = Number(SEASON.slice(0, 4))
  const url = 'https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard'
    + `?limit=1000&dates=${year}0701-${year + 1}0701`
  let events
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    events = (await res.json()).events ?? []
  } catch (e) {
    console.warn(`warn: ESPN event ids unavailable (${e.message}); match pages will be limited`)
    return 0
  }

  const index = events.map((ev) => {
    const c = ev.competitions?.[0]
    const side = (which) => {
      const t = c?.competitors?.find((x) => x.homeAway === which)?.team
      return t?.shortDisplayName ?? t?.displayName ?? ''
    }
    return { id: ev.id, date: readIn(UK, new Date(ev.date)).date, home: side('home'), away: side('away') }
  })

  let hits = 0
  const unmatched = new Set()
  for (const m of matches) {
    if (m.comp !== 'pl' || m.espnId) continue
    const hit = index.find((e) =>
      e.date === m.ukDate && sameClub(e.home, m.home) && sameClub(e.away, m.away))
    if (hit) { m.espnId = hit.id; hits++ }
    else { unmatched.add(m.home); unmatched.add(m.away) }
  }
  if (unmatched.size) {
    // Name mismatches are the usual cause, so record both sides' spellings
    // where a later workflow step can print them.
    const espnNames = [...new Set(index.flatMap((e) => [e.home, e.away]))].sort()
    const report = [
      `unmatched (ours): ${[...unmatched].sort().join(', ')}`,
      `espn names: ${espnNames.join(', ')}`,
    ].join('\n')
    console.warn(report)
    DIAGNOSTICS.unmatchedClubs = [...unmatched].sort()
    DIAGNOSTICS.espnClubs = espnNames
  }
  return hits
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

    const channels = {
      // Sýn hold the Icelandic rights for 2025/26–2027/28 and show all 380.
      // The 3pm blackout is a British rule, so a match dark in the UK is not
      // dark here — which is exactly when this listing earns its keep.
      is: {
        broadcaster: 'syn',
        confidence: 'rule',
        note: broadcaster === 'blackout'
          ? 'Shown in Iceland. The 3pm Saturday blackout is a UK rule and does not apply here.'
          : null,
      },
      uk: { broadcaster, confidence, note },
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
      highlight: bigMatch(home, away),
      channels,
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
  const out = events.map((ev) => {
    const comp = ev.competitions?.[0]
    const side = (which) => {
      const c = comp?.competitors?.find((x) => x.homeAway === which)
      return c?.team?.shortDisplayName ?? c?.team?.displayName ?? 'TBC'
    }
    const uk = readIn(UK, new Date(ev.date))
    const headline = comp?.notes?.[0]?.headline ?? ''
    // The league phase runs September to January; everything from February is
    // knockout. ESPN's headline says so directly when it provides one.
    const month = Number(uk.date.slice(5, 7))
    const leaguePhase = /league phase|matchday/i.test(headline) ||
      (!headline && (month >= 8 || month === 1))
    const scores = comp?.competitors?.length === 2 && comp.status?.type?.completed
      ? [Number(comp.competitors.find((x) => x.homeAway === 'home')?.score),
         Number(comp.competitors.find((x) => x.homeAway === 'away')?.score)]
      : null
    return {
      date: uk.date, time: uk.time,
      home: side('home'), away: side('away'),
      round: headline || null,
      leaguePhase,
      score: scores && scores.every(Number.isFinite) ? scores : null,
    }
  })
  return labelMatchdays(out)
}

/* ESPN often gives no round name. The league phase plays in eight bursts of a
 * day or two, so clustering the dates recovers the matchday number. */
function labelMatchdays (matches) {
  const dates = [...new Set(matches.filter((m) => m.leaguePhase).map((m) => m.date))].sort()
  const md = new Map()
  let n = 0, prev = null
  for (const d of dates) {
    if (prev === null || (Date.parse(d) - Date.parse(prev)) / 86400000 > 4) n++
    md.set(d, n)
    prev = d
  }
  for (const m of matches) {
    if (m.round) continue
    m.round = m.leaguePhase && md.has(m.date)
      ? `League phase MD${md.get(m.date)}`
      : 'Knockout stage'
  }
  return matches
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

  // A scheduled rebuild runs unattended. If no source answers and nothing is
  // kept by hand, hold on to the last good build rather than quietly emptying
  // the page because a feed happened to be down.
  if (!live && !(file.matches ?? []).length) {
    const prev = await loadJson('data/fixtures.json', { matches: [] })
    // Fold them back to source shape so they run through the mapping below
    // again — otherwise a kept set would be frozen at whatever the schema
    // looked like on the day the feeds last worked.
    const kept = (prev.matches ?? [])
      .filter((m) => m.comp === 'ucl')
      .map((m) => ({
        date: m.ukDate, time: m.ukTime, home: m.home, away: m.away,
        round: m.round, leaguePhase: /league phase/i.test(m.round ?? ''),
        score: m.score ?? null,
      }))
    if (kept.length) {
      console.warn(`warn: no Champions League source answered; keeping ${kept.length} fixtures from the last build`)
      file.matches = kept
    }
  }

  return (file.matches ?? []).map((m, i) => {
    const day = weekday(m.date)          // UK weekday
    const leaguePhase = m.leaguePhase ?? /league phase/i.test(m.round ?? '')
    let broadcaster = m.broadcaster
    let confidence = m.broadcaster ? 'confirmed' : 'rule'
    // Amazon take first pick of one Tuesday match per matchweek and TNT show
    // the other seven or eight, so TNT is the answer for any given Tuesday tie
    // — with the caveat noted below rather than a shrug.
    const amazonNight = day === 'Tue' && leaguePhase
    if (!broadcaster) broadcaster = 'tnt'

    const kickoff = m.time ? zonedToUtc(m.date, m.time, UK) : null
    const local = kickoff ? readIn(ICELAND, kickoff) : { date: m.date, time: null }

    return {
      id: m.id ?? `ucl-${slug(m.round ?? 'r')}-${slug(m.home ?? '')}-${i}`,
      comp: 'ucl',
      espnId: m.espnId ?? null,
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
      highlight: bigMatch(m.home, m.away),
      channels: {
        // Sýn hold the Icelandic UEFA rights through the end of 2026/27.
        is: { broadcaster: 'syn', confidence: 'rule', note: null },
        uk: {
          broadcaster,
          confidence,
          note: m.note ?? (amazonNight && confidence === 'rule'
            ? 'Amazon Prime Video take first pick of one Tuesday match each matchweek. If this is the one, it is on Prime instead.'
            : null),
        },
        // CBS hold the US rights to 2029/30; every match is on Paramount+.
        us: { broadcaster: 'paramount', confidence: 'rule', note: null },
      },
      score: m.score ?? null,
    }
  })
}

const main = async () => {
  const overrides = await loadJson('data/overrides.json', {})
  const squad = await loadJson('data/fpl.json', null)
  const matches = [...await premierLeague(), ...await championsLeague()]

  for (const m of matches) m.fpl = fplFor(squad, m.home, m.away)
  const linked = await espnEventIds(matches)
  console.log(`espn ids    ${linked} Premier League fixtures linked`)

  let applied = 0
  for (const m of matches) {
    const o = overrides[m.id]
    if (!o) continue
    for (const [key, value] of Object.entries(o)) {
      if (REGIONS[key]) {
        m.channels[key] = { note: null, ...m.channels[key], ...value, confidence: 'confirmed' }
      } else {
        m[key] = value
      }
    }
    applied++
  }

  for (const m of matches) m.alert = alertWorthy(m)

  matches.sort((a, b) => (a.date + (a.time ?? '')).localeCompare(b.date + (b.time ?? '')))

  const withPlayers = matches.filter((m) => m.fpl).length
  if (squad?.players?.length) {
    console.log(`fantasy     ${withPlayers} fixtures feature your players`)
  }

  const out = {
    generatedAt: new Date().toISOString(),
    fantasy: squad ? {
      name: squad.name, gameweek: squad.gameweek, teamId: squad.teamId,
      overallPoints: squad.overallPoints, overallRank: squad.overallRank,
    } : null,
    season: SEASON,
    timezone: 'Atlantic/Reykjavik',
    broadcasters: BROADCASTERS,
    regions: REGIONS,
    competitions: {
      pl: { name: 'Premier League', short: 'PL' },
      ucl: { name: 'Champions League', short: 'UCL' },
    },
    diagnostics: DIAGNOSTICS.unmatchedClubs.length ? DIAGNOSTICS : null,
    sources: [
      { name: 'openfootball / football.json', url: PL_SOURCE, covers: 'Premier League fixtures and kickoff times' },
      { name: 'football-data.org / ESPN / data/ucl.json', url: null, covers: 'Champions League fixtures' },
    ],
    matches,
  }
  await writeFile(join(ROOT, 'data/fixtures.json'), JSON.stringify(out, null, 1) + '\n')

  const pl = matches.filter((m) => m.comp === 'pl')
  const named = (m) => m.channels?.uk?.broadcaster && m.channels.uk.broadcaster !== 'tbc'
  console.log(`season      ${SEASON}`)
  console.log(`premier lg  ${pl.length} matches, ${pl.filter(named).length} with a UK channel`)
  console.log(`champions   ${matches.filter((m) => m.comp === 'ucl').length} matches`)
  console.log(`big matches ${matches.filter((m) => m.highlight).length} flagged, ${matches.filter((m) => m.alert).length} alerting`)
  console.log(`overrides   ${applied} applied`)
  console.log(`wrote       data/fixtures.json`)
}

main().catch((e) => { console.error('build failed:', e.message); process.exit(1) })
