# 🏠 Chore Tracker

A simple, good-looking chore app for multiple users. No build step, no
dependencies — just open `index.html` in any browser.

## Features

- **Multiple users** — add users with the `+ User` button and switch between
  them with the tabs at the top. Each user has their own chore list and
  progress ring.
- **Daily / weekly / monthly chores** — chores are grouped into sections by
  frequency.
- **Automatic resets** — daily chores reset at midnight, weekly chores reset
  every Monday, and monthly chores reset on the 1st of the month. No timers
  needed: each completion is stamped with its period, so it simply stops
  counting once the period rolls over.
- **Simple toggle** — click the checkbox (or the chore name) to mark a chore
  done or undone.
- **Add / remove chores** — type a chore, pick a frequency, hit Add. Hover a
  chore and click ✕ to remove it. You can also remove the current user (and
  their chores) from the footer.
- **Persistent** — everything is saved to the browser's `localStorage`.

## Running it

Open `index.html` directly, or serve the folder:

```sh
python3 -m http.server 8000
# then visit http://localhost:8000
```

On first launch the app seeds one sample user ("Me") with a few example
chores so you can see how it works — feel free to delete them.

## Notes

- Data is stored per-browser. All household members using the same
  device/browser share the same data, which is the typical "family tablet on
  the fridge" setup. There is no backend or authentication.
- Weeks start on Monday. To change that, edit `currentPeriodKey()` in
  `app.js`.
