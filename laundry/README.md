# Laundry reminder

Tell it you switched the washer or dryer on and how long the programme runs.
When it's done it reminds you, then keeps reminding you every few minutes
until you press **Finished, I've emptied it**.

Once merged to main it's served by GitHub Pages at `/laundry/`. Use your
browser's "Add to Home Screen" to install it like an app.

## How the reminders reach you

- **While the page is open** it beeps, vibrates and shows a notification
  (allow notifications under *Reminders*).
- **With the page closed or the phone locked**, turn on *Phone reminders
  through ntfy* and subscribe to your topic in the free
  [ntfy app](https://ntfy.sh/). When you start a machine, the page books
  scheduled messages on ntfy.sh: one at the end time, then one every interval
  for 3 hours. Finishing (on the page, or the **Emptied it** button on the
  phone notification) deletes the ones still waiting.

Everything else stays in `localStorage` on the device. No build step.

## History

The page keeps a list of loads on the device: start, ready and emptied
times, and how long the load waited. Loads started or finished by Siri are
added from the workflow's "timer set" and "emptied" messages (their click
link carries the details), which ntfy.sh keeps for 12 hours, so open the page
at least that often to keep the history complete.

## Siri

The Siri shortcut is two actions: **Ask for Input**, then **Get Contents of
URL** on an address the page's *Start with Siri* section gives you, with the
answer stuck on the end. That just posts "2 hours" (titled with your topic and
machine) to a command topic on ntfy.sh. The `laundry-siri` workflow polls it
every 5 minutes and runs `tools/siri.mjs`, which understands "90 minutes",
"2 hours", "an hour and a half", "done"… and books the reminders on your topic
under fixed IDs (`washer-1`, `washer-2`, …). The reminders count from when you
spoke to Siri, so a late GitHub run only delays the "timer set" confirmation.
The page polls ntfy for those IDs and shows the machine as running.

Links also work if you'd rather open the page: `?start=washer&min=90` starts a
timer on the page and `?finish=washer` ends it.
