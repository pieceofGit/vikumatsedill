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
