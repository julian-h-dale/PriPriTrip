# Testing dates and time zones

How to make the app think it's a different day, time or place, so you can
see Today, "Next up", fading entries (Run 30), check-out mornings and
countdowns the way you will on a trip. Three ways, from least to most
disruptive:

1. **Chrome DevTools**: the time zone only, for one tab.
2. **`faketime`** on the Pi: the date and time for the dev API only.
3. **The Pi's own clock**, over VNC: everything on the Pi, the browser and
   the dev API together.

There's no "pretend it's…" switch in the app on purpose (Run 31): these
tools change the clock from outside, so the app is tested as it really
runs.

## What the app reads the clock for

Knowing this tells you which clock to move.

| What | Which clock |
|---|---|
| Which day Today is about; Next up; fading; Tonight | the **real instant** (`Date.now()`), compared with each entry's time **on its own place's clock** (a check-out uses the hotel's zone; a landing uses the arrival city's). The phone's own time zone doesn't change any of these. |
| "This phone" on Time zones; a memory's own zone | the **browser's time zone** |
| The trips list countdown ("16 days to go") | the real instant against the trip's first day |
| When a memory was received, the weather cache, sign-in tokens | the **server's clock** (the dev API) |

So: to test "it's 11:30 in Athens on check-out day", you need to move the
**date and time** (an instant). Changing only the time zone moves "This
phone" but not what Today shows.

## The example trips

| Trip | Dates | Zone | Moments worth testing |
|---|---|---|---|
| Bern & Wengen Long Weekend (`sample_trip.json`) | fixed: **May 10–14, 2026** | Europe/Zurich | May 11, 11:30 Zurich: landed, off the 10:28 train, lunch at 12:15 next. May 12 morning: check-out 10:00 from one hotel, check-in 15:00 at the next (a changeover day). May 14, 13:05: the flight home. |
| Athens Getaway (`demo_trip.py`) | **moves**: day 3 of 8 is the day you last ran `make seed` | Europe/Athens | Day 1 12:10: landing from Chicago. Day 1 14:00: check-in. Day 8 11:00: check-out (Julian's example: at 11:30 Athens time it's faded), then the 14:20 flight home to Chicago (lands 18:05 Chicago, 02:05 Athens). |

The Athens trip is the easy one: it's always under way, because `make
seed` re-dates it around today. You only need to move the clock to reach
a particular hour, or its first and last days.

Zurich is UTC+2 in May. Athens is UTC+3 and Chicago UTC−5 until
2026-10-25 (then UTC+2 and UTC−6 after 2026-11-01).

## 1. Chrome DevTools: change the time zone

Good for: "This phone" on Time zones, the phone-zone side of memories, and
checking nothing on Today depends on where the phone is.

1. Open the app in Chrome, then DevTools (F12, or ⋮ → More tools →
   Developer tools).
2. ⋮ in DevTools → **More tools → Sensors**. (Or Ctrl+Shift+P, type
   "Sensors".)
3. Under **Location**, pick a preset city (e.g. Tokyo), or **Manage… →
   Add location** and fill in a name, latitude/longitude and **Timezone
   ID** (e.g. `Europe/Athens`).
4. Reload the tab. The override holds while DevTools is open for that tab.

To check it took, type `Intl.DateTimeFormat().resolvedOptions().timeZone`
in the Console.

**What it doesn't do:** change the date or time. Chrome has no setting for
that. For it, use 2 or 3 below (or Playwright's `page.clock`, which the
e2e specs use; see `ui/e2e/done-entries.spec.js`).

## 2. `faketime`: the dev API only

Good for: the server agreeing about "now" (when a memory was received, the
weather cache), while the rest of the Pi keeps the real time. Install it
once:

```bash
sudo apt install faketime
```

Then run the dev API under it (stop the normal one first):

```bash
# Starting at 11:30 on Oct 17 in Athens, and ticking on from there:
cd ~/development/PriPriTrip/api
TZ=Europe/Athens faketime -m -f '@2026-10-17 11:30:00' .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
```

- It prints its start-up lines and then nothing, so it can look as if it
  has hung. It hasn't: `curl localhost:8000/health` answers. Stop it with
  Ctrl+C.
- `@` means "start at this time and keep ticking". Without it the clock
  stands still.
- `faketime` reads the time in the command's own zone, so give `TZ=` and
  the time there together (here, 11:30 in Athens).
- `-m` uses the multi-threaded version of the library.
- The examples use the Athens trip seeded on 2026-10-12: it runs Oct
  10–17, so check-out day is Oct 17. Seeded on another day, use that
  trip's own dates (its timeline shows them).

**Not for Chromium** (tested on this Pi, 2026-10-12):
- Under `faketime`, Chromium hangs on this app. Without `-m` it hangs on
  any page. With `-m` a plain page works, but the app (the Vite dev
  server's many module requests and its live-reload connection) never
  finishes loading.
- For the browser, use the Pi's own clock (3, below) or a Playwright
  window started at a chosen moment (the same clock the e2e specs use).
- Chromium's terminal message `registration_request ... DEPRECATED_ENDPOINT`
  is harmless. It's Chromium failing to register for Google's push
  messages (this Chromium has no Google API keys), and has nothing to do
  with the time.

## 3. The Pi's own clock, over VNC

Good for: when you want everything on the Pi at that moment, with the
least setup. It's also the most disruptive, so read the gotchas first.

```bash
# Stop the network time sync, set the zone (optional: it moves "This phone"
# too), then the date and time, which is read in the zone just set:
sudo timedatectl set-ntp false
sudo timedatectl set-timezone Europe/Athens
sudo timedatectl set-time '2026-10-17 11:30:00'      # 11:30 in Athens

timedatectl                                          # check

# Put it all back:
sudo timedatectl set-timezone America/Chicago
sudo timedatectl set-ntp true                        # the clock corrects itself within a minute
```

Restart the dev API after changing the clock (Ctrl+C, then `make dev`), so
nothing it worked out at start-up is stale. Then use Chromium on the Pi's
desktop at `http://localhost:3000`.

## Gotchas

- **HTTPS stops working if the date is far off.** Certificates are valid
  for a window (Let's Encrypt's last 90 days, Google's about as long). Set
  the clock to before that window, or after it, and every HTTPS request
  fails. On the Pi that means Google Maps, Places and the weather. To the
  app that looks like being offline: the offline bar shows, and saved
  copies appear. `http://localhost` is unaffected. Stay within a few weeks
  of today unless offline is what you're testing.
- **Sign-in.**
  - A token made while the clock is moved carries that time. Back on the
    real clock, it may look expired: just sign in again.
  - Moving the browser's clock more than 60 days ahead makes the app think
    its sign-in has expired, so it stops refreshing it.
- **The Pi photo backup** (`make pi-backup-install`) runs on the Pi's
  clock. With option 3, its schedule and its HTTPS calls to the live app
  are affected while the clock is moved. Options 1 and 2 leave it alone.
- **Writes keep the fake time.** A memory written while the clock is moved
  is stamped with that time and zone, and so is the server's "received".
  Test with the seed data on the dev server, not the live app.
- **Put it back.** Run `timedatectl` and check "System clock synchronized:
  yes" before using the Pi for anything else.

## A checklist

With the Athens trip, around its check-out day (day 8; Oct 17 if seeded
on Oct 12):

- [ ] 10:59 Athens: check-out not faded; Next up says check-out, "in 1 min".
- [ ] 11:01 Athens: check-out faded; Next up is the 14:20 flight, without
      reopening the page (Run 31).
- [ ] 23:59 → 00:01 Athens on the last day: Today moves on, and after the
      last day it opens on the timeline.
- [ ] The flight home after it leaves (Athens 14:20, Chicago 18:05): it
      stays bright until it lands in Chicago, even though it's past
      midnight in Athens (Run 30).
- [ ] DevTools time zone set to Asia/Tokyo: nothing on Today changes; Time
      zones' "This phone" says Tokyo.

With the Bern trip (needs 2 or 3, it's in May): May 12 at 08:00 Zurich,
when Tonight shows the morning's check-out and the evening's new hotel.
