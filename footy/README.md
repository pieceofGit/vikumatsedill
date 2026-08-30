# On which channel?

A small website that answers one question: **which British TV channel is
showing this football match?** It covers the Premier League and the Champions
League, and it is honest about the matches nobody has picked yet — and about
the ones no channel is allowed to show at all.

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

## How the channel is worked out

In the UK the kickoff slot *is* the broadcaster — the rights deal carves the
week into fixed windows, so once a match has been given a real kickoff time you
already know who is showing it:

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

## Data

| What | Where from |
| --- | --- |
| Premier League fixtures and kickoff times | [openfootball/football.json](https://github.com/openfootball/football.json), fetched by the build script. No key needed. |
| Champions League fixtures | `data/ucl.json`, kept by hand — or a live feed, see below. |
| Manual channel corrections | `data/overrides.json` |

### Champions League fixtures

There is no free, key-less feed for these. Two options:

1. **By hand.** Add entries to the `matches` array in `data/ucl.json` and
   re-run the build script. The file documents its own fields, and you can
   leave `broadcaster` out to let the TNT/Amazon rule above decide.
2. **From football-data.org.** Their free tier covers the Champions League.
   Get a token and the build script will use it:

   ```sh
   FOOTBALL_DATA_TOKEN=your-token node tools/build-fixtures.mjs
   ```

   If the token is missing or the call fails, the script warns and falls back
   to `data/ucl.json` — it never fails the build.

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
