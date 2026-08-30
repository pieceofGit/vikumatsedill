# On which channel?

A small website that answers one question: **which British TV channel is
showing this football match?** It covers the Premier League and the Champions
League, and it is honest about the matches nobody has picked yet — and about
the ones no channel is allowed to show at all.

Kickoff times are shown in **Icelandic time (GMT)**.

No framework, no build step for the page itself, no API key required for the
Premier League. It is a static folder you can host anywhere.

## Run it

```sh
node tools/build-fixtures.mjs   # refresh data/fixtures.json
python3 -m http.server          # then open http://localhost:8000
```

The page fetches `data/fixtures.json`, so it needs to be served over HTTP
rather than opened straight from disk. If you want a single file you can open
by double-clicking, or email to someone:

```sh
node tools/bundle.mjs           # writes dist/index.html with the data inlined
```

## Times: Icelandic clock, British slots

Iceland stays on GMT all year. The UK does not — from late March to late
October it runs an hour ahead on British Summer Time. Kickoffs are published on
the UK clock and the broadcast slots are *UK* slots, so the build script works
out the channel on UK time and only then converts the kickoff to Icelandic
time. Both are kept in the data (`time`/`date` are Icelandic, `ukTime`/`ukDate`
are British, `kickoff` is the ISO instant), and through the British summer each
row on the page shows the UK clock underneath as a second line.

## How the channel is worked out

In the UK the kickoff slot *is* the broadcaster — the rights deal carves the
week into fixed windows, so once a match has been given a real kickoff time you
already know who is showing it. **UK kickoff times:**

| Slot | Channel |
| --- | --- |
| Friday 20:00 | Sky Sports |
| Saturday 12:30 | TNT Sports |
| Saturday 15:00 | nobody — the 3pm blackout |
| Saturday 17:30 | Sky Sports |
| Saturday 20:00 | Sky Sports |
| Sunday 14:00 | Sky Sports |
| Sunday 16:30 | Sky Sports |
| Monday 20:00 | Sky Sports |

Matches beyond roughly the next five or six weeks have not been picked yet.
They sit on a provisional 15:00 Saturday placeholder in the fixture data, so the
build script marks the whole round **not selected yet** rather than pretending
they are blacked out. A round counts as picked once its kickoff times have been
spread across more than one slot.

For the Champions League the rule is simpler: **TNT Sports show everything**,
except that Amazon Prime Video take first pick of one Tuesday league-phase match
each matchweek. So a Wednesday tie is TNT, a knockout tie is TNT, and a Tuesday
league-phase tie is one of the two until Amazon announce their pick.

Every match on the page is labelled with where its channel came from —
`confirmed`, or `from the slot`.

## Who holds the rights (2026/27)

| | Competition | Package |
| --- | --- | --- |
| **Sky Sports** | Premier League | At least 215 matches: every Friday and Monday night, most Saturday evening and Sunday kickoffs, three midweek rounds, the final day. |
| **TNT Sports** | Premier League | About 52 matches: the exclusive Saturday 12:30 kickoff and two midweek rounds. |
| **TNT Sports** | Champions League | The majority of ties, plus the play-off round, last 16, quarter-finals, semi-finals and the final. |
| **Amazon Prime Video** | Champions League | 17 matches — first pick of the Tuesday nights. It no longer shows the Premier League; that package ended after 2024/25. |
| **BBC** | Premier League | Highlights only, on Match of the Day. |

TNT Sports streams on **HBO Max**, which replaced discovery+ as its UK
streaming home in March 2026. Sky streams on NOW.

**This is the last season of both deals.** From 2027/28 Paramount takes over
TNT's Premier League package alongside Sky, and Paramount+ takes the majority
Champions League package; Amazon keeps its Tuesday first pick through 2030/31.
The slot table above will need revisiting next summer.

## Data

| What | Where from |
| --- | --- |
| Premier League fixtures and kickoff times | [openfootball/football.json](https://github.com/openfootball/football.json), fetched by the build script. No key needed. |
| Champions League fixtures | football-data.org, or ESPN, or `data/ucl.json` — see below |
| Manual channel corrections | `data/overrides.json` |

**No fixture API tells you the broadcaster.** They all give you teams, dates and
kickoff times; the channel comes from the rights rules above, or from
`data/overrides.json`. The only sources that carry a confirmed UK channel are
listings sites such as live-footballontv.com, which would mean scraping someone
else's HTML — fragile, and their terms are their own.

### Champions League fixtures

openfootball has no Champions League feed, so the build script tries three
sources in order and uses whichever answers first:

1. **football-data.org** — the best option. Documented, stable, and the
   Champions League sits on its permanent free tier (10 requests/minute). Needs
   a free key, no card:

   ```sh
   FOOTBALL_DATA_TOKEN=your-token node tools/build-fixtures.mjs
   ```

2. **ESPN's public API** — no key at all
   (`site.api.espn.com/apis/site/v2/sports/soccer/uefa.champions/scoreboard`).
   It is undocumented and unofficial, so the shape can change without notice;
   every field is read defensively. Used automatically when there is no
   football-data token.

3. **`data/ucl.json`** — kept by hand. The file documents its own fields; leave
   `broadcaster` out to let the TNT/Amazon rule decide. Times in this file are
   **UK** times, like the slot grid.

If a source fails the script warns and falls through to the next one. It never
fails the build.

UEFA's own site is backed by a public JSON endpoint (`match.uefa.com`) rather
than needing HTML scraping, but it is undocumented and unsupported, so it is not
wired up here — the two options above are cleaner.

### Correcting a channel

Broadcasters occasionally move a match off its usual slot. Put the truth in
`data/overrides.json`, keyed by the match `id` from `data/fixtures.json`:

```json
{
  "pl-matchday-12-arsenal-chelsea": { "broadcaster": "tnt", "time": "17:30" }
}
```

Anything you set there wins over the inferred channel and is shown as
**confirmed**.

## Options

```sh
node tools/build-fixtures.mjs --season 2025-26   # a different season
node tools/build-fixtures.mjs --offline          # reuse the cached download
```

## A caveat

The slot mapping reflects the published rights deals, but broadcasters do move
matches around, and rights change between seasons. Worth a glance at your
provider's own guide before you settle in.
