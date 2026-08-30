/**
 * Commands you send the bot, read back on the next poll.
 *
 * The alerts are sent from a GitHub Actions runner, which cannot see a toggle
 * on a static page — but it can ask Telegram what you have said to the bot. So
 * "watching" is set by messaging the bot rather than by touching the site.
 *
 *   /watching          — you are watching football; stay quiet except half-time
 *   /watching arsenal  — same, but only tell me about that club's match
 *   /unwatch           — back to normal
 *   /status            — what mode am I in
 *
 * Watching lapses on its own after WATCH_HOURS (default 4), so a mode set on a
 * Saturday afternoon is not still muting things on Sunday.
 */
import { sendNow } from './notify.mjs'

const WATCH_MS = Number(process.env.WATCH_HOURS ?? 4) * 3_600_000

/** Is watching mode on right now? Returns the mode, or null. */
export function watching (state) {
  const w = state?.watching
  if (!w?.since) return null
  if (Date.now() - w.since > WATCH_MS) return null
  return w
}

export function describe (state) {
  const w = watching(state)
  if (!w) return 'Normal: goals, tense matches and your squad all reach you.'
  const mins = Math.round((Date.now() - w.since) / 60_000)
  const scope = w.team ? `matches involving ${w.team}` : 'any live match'
  return `Watching (${mins}m). Quiet except half-time, for ${scope}.`
}

/** Read anything sent to the bot since last time and act on it. */
export async function readCommands (state) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return
  let updates
  try {
    const url = `https://api.telegram.org/bot${token}/getUpdates`
      + `?offset=${state.updateOffset ?? 0}&timeout=0&allowed_updates=%5B%22message%22%5D`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = await res.json()
    updates = body.result ?? []
  } catch (e) {
    // Never let a command check stop the alerts themselves.
    console.warn(`warn: could not read bot commands (${e.message})`)
    return
  }
  if (!updates.length) return

  for (const u of updates) {
    state.updateOffset = u.update_id + 1
    const text = (u.message?.text ?? '').trim()
    if (!text.startsWith('/')) continue
    const [cmd, ...rest] = text.split(/\s+/)
    const arg = rest.join(' ').trim()

    switch (cmd.split('@')[0].toLowerCase()) {
      case '/watching': {
        state.watching = { since: Date.now(), team: arg || null }
        await sendNow(`👀 <b>Watching</b> — nothing until half-time`
          + `${arg ? `, for ${arg}` : ''}. Send /unwatch to undo.`)
        break
      }
      case '/unwatch':
        state.watching = null
        await sendNow('🔔 <b>Back to normal</b> — goals and tense matches will reach you again.')
        break
      case '/status':
        await sendNow(describe(state))
        break
      default:
        break
    }
  }
}
