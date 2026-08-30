/**
 * Sending, with a deliberate delay.
 *
 * Broadcast and streams run behind the pitch, so an alert that fires the
 * instant a goal is detected arrives before the viewer has seen it — the
 * notification spoils the moment it is meant to celebrate. Everything is
 * therefore queued and held for ALERT_DELAY_MINUTES (default 3) before it goes
 * out, measured from when it was detected.
 *
 * The poll gap already adds lag of its own, so real delivery sits somewhere
 * between the delay and the delay plus one polling interval. That asymmetry is
 * deliberate: arriving late is a small annoyance, arriving early ruins the goal.
 */
export const DELAY_MINUTES = Number(process.env.ALERT_DELAY_MINUTES ?? 3)
const DELAY_MS = Math.max(0, DELAY_MINUTES) * 60_000

export async function sendNow (text) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chat = process.env.TELEGRAM_CHAT_ID
  if (!token || !chat) {
    console.log('  [dry run — no Telegram credentials set, would have sent]')
    console.log(text.split('\n').map((l) => `  | ${l}`).join('\n'))
    return 'dry-run'
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true,
    }),
  })
  if (!res.ok) throw new Error(`Telegram HTTP ${res.status}: ${await res.text()}`)
  return 'sent'
}

/** Hold an alert. `key` makes it idempotent across polls. */
export function enqueue (state, key, text) {
  state.pending ??= []
  if (state.pending.some((p) => p.key === key)) return false
  state.pending.push({ key, text, at: Date.now() })
  console.log(`  held ${DELAY_MINUTES}m: ${key}`)
  return true
}

/** Send whatever has now waited long enough. Call before looking for new ones. */
export async function flush (state) {
  state.pending ??= []
  const now = Date.now()
  const due = state.pending.filter((p) => now - p.at >= DELAY_MS)
  state.pending = state.pending.filter((p) => now - p.at < DELAY_MS)

  for (const p of due) {
    const waited = Math.round((now - p.at) / 60_000)
    console.log(`releasing ${p.key} (held ${waited}m)`)
    console.log(`  → ${await sendNow(p.text)}`)
  }
  if (state.pending.length) {
    console.log(`${state.pending.length} alert(s) still held`)
  }
  return due.length
}
