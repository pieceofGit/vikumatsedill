#!/usr/bin/env node
/**
 * Picks up what the Siri shortcut posted to SIRI_TOPIC and books (or cancels)
 * the reminders on the person's own ntfy topic. Run every few minutes by
 * .github/workflows/laundry-siri.yml.
 *
 * Each command is an ntfy message titled "<topic>.<machine>.<interval>" whose
 * body is whatever was said to Siri: "2 hours", "90 minutes", "done", …
 */
import { readFile, writeFile } from 'node:fs/promises'
import { NTFY, PAGE_URL, SIRI_TOPIC, MACHINES, SEQ_MAX, reminderCount, stopUrl } from '../shared.mjs'

const STATE = new URL('../.siri-state.json', import.meta.url)
const LOOKBACK = '6h'

const WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, 'forty-five': 45, fortyfive: 45,
  fifty: 50, sixty: 60, ninety: 90 }

/** Minutes from things like "2 hours", "1.5 h", "an hour and a half", "1 hour 30 minutes", "45". */
export function parseMinutes(text) {
  let t = ` ${String(text).toLowerCase().replace(/,/g, '.')} `
  const andHalf = /and a half|and 1\/2|½/.test(t)
  t = t.replace(/[a-z-]+/g, w => WORDS[w] !== undefined ? String(WORDS[w]) : w)
  if (/half (a|1|an) ?hour/.test(t)) return 30
  t = t.replace(/(\d+) and 1 half (?=hours?|hrs?|h\b)/, '$1.5 ')   // "2 and a half hours"
  let min = 0, found = false
  const h = /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h\b|klst|tím)/.exec(t)
  if (h) { min += parseFloat(h[1]) * 60; found = true }
  if (h && andHalf && !h[1].includes('.')) min += 30
  const m = /(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m\b|mín)/.exec(t)
  if (m) { min += parseFloat(m[1]); found = true }
  if (!found) {
    const n = /(\d+(?:\.\d+)?)/.exec(t)
    if (n) { min = parseFloat(n[1]); found = true }
  }
  return found && min >= 1 && min <= 600 ? Math.round(min) : null
}

const isDone = text => /\b(done|finish|finished|empt|emptied|stop|cancel|búin|búið|tóm)/i.test(text)

const clock = ms => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Atlantic/Reykjavik' })

async function ntfy(method, path, params = {}, body) {
  const qs = new URLSearchParams(params).toString()
  const res = await fetch(`${NTFY}/${path}${qs ? `?${qs}` : ''}`, { method, body })
  if (!res.ok) throw new Error(`ntfy ${method} ${path.replace(/^[^/]+/, '<topic>')}: ${res.status}`)
  return res
}

async function cancel(topic, machine) {
  await Promise.allSettled(Array.from({ length: SEQ_MAX }, (_, i) => ntfy('DELETE', `${topic}/${machine}-${i}`)))
}

async function book(topic, machine, interval, end) {
  const { name, tag } = MACHINES[machine]
  const now = Date.now()
  const count = reminderCount(interval)
  const common = {
    title: `${name} is done`, priority: '5', tags: tag, click: PAGE_URL,
    actions: `view, Emptied it, ${stopUrl(PAGE_URL, topic, machine)}, clear=true`,
  }
  let caughtUp = false
  for (let k = count; k >= 1; k--) {
    const at = end + (k - 1) * interval * 60000
    const msg = k === 1 ? `Finished at ${clock(end)}. Empty the ${name.toLowerCase()}.` : `Done since ${clock(end)}. Reminder ${k}.`
    if (at > now + 15000) {
      await ntfy('POST', `${topic}/${machine}-${k}`, { ...common, at: String(Math.floor(at / 1000)) }, msg)
    } else if (!caughtUp) {
      // This run came late enough that reminders are already due: send the latest one now.
      caughtUp = true
      await ntfy('POST', `${topic}/${machine}-${k}`, common, msg)
    }
  }
}

export async function main() {
  let state = { seen: {} }
  try { state = JSON.parse(await readFile(STATE, 'utf8')) } catch {}
  const cutoff = Date.now() / 1000 - 12 * 3600
  for (const [id, t] of Object.entries(state.seen)) if (t < cutoff) delete state.seen[id]

  const res = await ntfy('GET', `${SIRI_TOPIC}/json`, { poll: '1', since: LOOKBACK })
  const commands = (await res.text()).split('\n').filter(Boolean).map(l => JSON.parse(l))
    .filter(m => m.event === 'message' && !state.seen[m.id])
    .sort((a, b) => a.time - b.time)

  let done = 0
  for (const c of commands) {
    state.seen[c.id] = c.time
    const [topic, machine, iv] = String(c.title || '').split('.')
    const interval = Math.min(60, Math.max(5, parseInt(iv, 10) || 10))
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(topic || '') || !MACHINES[machine]) { console.log(`skipped malformed command ${c.id}`); continue }
    const text = String(c.message || '').replace(/^m=/, '').replace(/\+/g, ' ')
    try {
      if (isDone(text)) {
        await cancel(topic, machine)
        console.log(`${machine}: cancelled`)
      } else {
        const min = parseMinutes(text)
        if (!min) {
          await ntfy('POST', topic, { title: `Didn't catch how long`, tags: 'question' }, `Siri heard “${text}” for the ${machine}. Try again with e.g. “90 minutes” or “2 hours”.`)
          console.log(`${machine}: could not parse "${text}"`)
          continue
        }
        const end = c.time * 1000 + min * 60000
        await cancel(topic, machine)
        await book(topic, machine, interval, end)
        await ntfy('POST', topic, { title: `${MACHINES[machine].name} timer set`, tags: 'stopwatch', priority: '2' }, `Ready at ${clock(end)} (${min} min). Reminders every ${interval} min until you empty it.`)
        console.log(`${machine}: ${min} min, ready ${clock(end)}, ${Math.round((Date.now() - c.time * 1000) / 1000)}s after Siri`)
      }
      done++
    } catch (e) {
      delete state.seen[c.id]   // try again next run
      console.log(`${machine}: ${e.message}`)
    }
  }
  await writeFile(STATE, JSON.stringify(state))
  console.log(`${commands.length} new command(s), ${done} handled.`)
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
