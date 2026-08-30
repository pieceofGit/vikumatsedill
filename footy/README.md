# On which channel?

A small website that answers one question: **which channel is showing this
football match?** It covers the Premier League and the Champions League, and
lists the broadcaster in **Iceland, Britain and the United States** side by
side. It is honest about the matches nobody has picked yet — and about the ones
no British channel is allowed to show at all.

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
each matchweek — 17 matches out of about 190. So every tie is listed as TNT, and
Tuesday ties carry a note saying Prime may have taken that one.

Iceland and the United States need no such inference: Sýn show everything, and
Paramount+ show every Champions League tie.

## Who holds the rights (2026/27)

| Where | | Competition | Package |
| --- | --- | --- | --- |
| 🇮🇸 | **Sýn Sport** | Both | Stöð 2 Sport / SÝN Sport, in Icelandic. All 380 Premier League matches — the 3pm blackout is a British rule and does not apply. Premier League to 2027/28, UEFA competitions to the end of this season. Also distributed by Síminn. |
| 🇬🇧 | **Sky Sports** | Premier League | At least 215 matches: every Friday and Monday night, most Saturday evening and Sunday kickoffs, three midweek rounds, the final day. |
| 🇬🇧 | **TNT Sports** | Premier League | About 52 matches: the exclusive Saturday 12:30 kickoff and two midweek rounds. |
| 🇬🇧 | **TNT Sports** | Champions League | The majority of ties, plus the play-off round, last 16, quarter-finals, semi-finals and the final. |
| 🇬🇧 | **Amazon Prime Video** | Champions League | 17 matches — first pick of the Tuesday nights. It no longer shows the Premier League; that package ended after 2024/25. |
| 🇬🇧 | **BBC** | Premier League | Highlights only, on Match of the Day. |
| 🇺🇸 | **Paramount+** | Champions League | CBS hold the US rights to 2029/30. Every match on Paramount+, a few also on CBS or CBS Sports Network. Spanish-language on TUDN/Univision. Neither ESPN nor TNT carries it in the States. |

Iceland and the United States each have a single rightsholder per competition,
so those answers are simple; Britain is the one split by kickoff slot.
**American Premier League coverage is not tracked** — only the Champions
League, as asked.

TNT Sports streams on **HBO Max**, which replaced discovery+ as its UK
streaming home in March 2026. Sky streams on NOW.

**This is the last season of both deals.** From 2027/28 Paramount takes over
TNT's Premier League package alongside Sky, and Paramount+ takes the majority
Champions League package; Amazon keeps its Tuesday first pick through 2030/31.
The slot table above will need revisiting next summer.

## Big matches and alerts

Starred rows are the ones worth clearing an evening for. A match earns a star
for one of three reasons, most specific first:

| Reason | What it means |
| --- | --- |
| A named derby | Tyne–Wear, Merseyside, North London, Manchester, West London, M23, the Roses, El Clásico, Derby della Madonnina |
| A heavyweight tie | Both sides drawn from the twenty-odd clubs that decide these competitions |
| Man Utd or PSG | Flagged every time they play, whoever the opponent |

101 matches this season. `★ Big matches` on the page narrows to them.

The alert list is deliberately *not* the same as the star list. Every derby,
heavyweight tie and Manchester United match is worth a notification; PSG earn
one for their Champions League nights or a genuinely big tie, not for a routine
league game. That rule lives in `alertWorthy()` in the build script, and the
result is written to each match as `"alert": true|false` — so the job that
sends the notification has nothing to decide beyond today's date.

A scheduled Claude routine reads `data/fixtures.json` each morning at 09:00
Icelandic time and pushes a phone notification naming the match, its kickoff and
the Icelandic channel. It stays quiet on days with nothing on.

To change what counts, edit `ALWAYS_BIG`, `HEAVYWEIGHTS` and `DERBIES` near the
top of `tools/build-fixtures.mjs`. Team names differ between the two feeds —
openfootball says `Man Utd`, ESPN says `Man United` — so matching normalises
case, accents and club suffixes and compares against an alias list.

## Live "this one's worth watching" alerts

`tools/live-alerts.mjs`, run every five minutes by
`.github/workflows/live-alerts.yml` during the hours matches are played
(11:00–22:59 UTC), watches in-progress games and pushes when one turns tense.

Claude routines cap out at hourly, which would miss most of a 105-minute match,
so this runs in Actions instead.

**The gate.** A match is only considered if it is live, level or within one
goal, and past the 50th minute — an even match that is ongoing. Half-time is
skipped.

**The score.** Past the gate, drama accumulates:

| Signal | Points |
| --- | --- |
| Goals in the match | up to 4 |
| Combined shots on target (≥10 / ≥7 / ≥4) | 3 / 2 / 1 |
| A goal in the last 12 minutes | 3 |
| Lead changes | 2 each, up to 4 |
| An equaliser after the 70th minute | 3 |
| A red card | 2 |
| How late it is (≥85' / ≥75' / ≥65') | 3 / 2 / 1 |
| It is a starred match | 2 |
| Scores level | 1 |

It alerts at 10 or more. Set an `EXCITEMENT_THRESHOLD` repository *variable* to
tune that without touching code.

ESPN's `details` array carries every goal with the minute it was scored, so lead
changes and late equalisers are reconstructed from a single poll — nothing has
to be remembered between runs. State is kept (in the Actions cache) only so a
match is not announced twice: one alert per match, and a second only if the
score has moved since.

**Wiring up the push.** Add two repository secrets under *Settings → Secrets and
variables → Actions*:

| Secret | Value |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Your bot's token from @BotFather |
| `TELEGRAM_CHAT_ID` | The chat to send to |

Until both are set the detector runs in **dry run**: it works out exactly what
it would have sent and prints it to the workflow summary, so you can watch it
against a weekend of real matches and settle the threshold before a single
notification is sent.

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
   Used automatically when there is no football-data token, and currently what
   the site runs on: it returns the full 144-match league phase. It is
   undocumented and unofficial, so the shape can change without notice and every
   field is read defensively. It also returns no round names, so the matchday
   number is recovered by clustering the fixture dates — the league phase plays
   in eight bursts of a day or two.

3. **`data/ucl.json`** — kept by hand. The file documents its own fields; leave
   `broadcaster` out to let the TNT/Amazon rule decide. Times in this file are
   **UK** times, like the slot grid.

If a source fails the script warns and falls through to the next one. If none
answers and `data/ucl.json` is empty, it keeps the Champions League fixtures
from the last good build rather than emptying the page because a feed happened
to be down. It never fails the build.

UEFA's own site is backed by a public JSON endpoint (`match.uefa.com`) rather
than needing HTML scraping, but it is undocumented and unsupported, so it is not
wired up here — the two options above are cleaner.

### Correcting a channel

Broadcasters occasionally move a match off its usual slot. Put the truth in
`data/overrides.json`, keyed by the match `id` from `data/fixtures.json`. A
region key (`is`, `uk`, `us`) replaces that region's channel; anything else is
set on the match itself:

```json
{
  "pl-matchday-12-arsenal-chelsea": {
    "uk": { "broadcaster": "tnt" },
    "ukTime": "17:30"
  }
}
```

Anything you set there wins over the inferred channel and is shown as
**confirmed**.

## Hosting

The site is served by GitHub Pages from `main`, which redeploys on every push.
`.github/workflows/fixtures.yml` rebuilds `data/fixtures.json` daily (and on
demand via *Run workflow*), committing it only when something changed. The
runner is also where the fixture feeds are actually reachable, so the scheduled
build is what keeps the Champions League listings current.

## Options

```sh
node tools/build-fixtures.mjs --season 2025-26   # a different season
node tools/build-fixtures.mjs --offline          # reuse the cached download
```

## A caveat

The slot mapping reflects the published rights deals, but broadcasters do move
matches around, and rights change between seasons. Worth a glance at your
provider's own guide before you settle in.
