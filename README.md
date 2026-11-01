# Cubecrusher desktop

A desktop app for the Cubecrusher Unraid server, for macOS, Windows and Linux.
Built with Electron, React and the Steeze design system.

It talks to the [Home-Dashboard](https://github.com/thomas-nelson23/Home-Dashboard)
server running on Cubecrusher and signs in with the same account. Until it's
connected, every page shows sample data and says so.

## What's built

- **Shell:** the sidebar and the top bar with Cubecrusher's status and live
  CPU, RAM, GPU, VRAM and array meters.
- **Home** (design H1): greeting, clock and Hermes ask bar with suggestions;
  the "Needs you" feed (built from unhealthy or stopped containers, full
  disks and hot GPUs); weather and today's calendar.
- **Hermes** (design option 2): Agents with In / Near / Out autonomy,
  approvals and activity (sample agents for now; the settings are saved on
  this computer); Chat, which streams the reply as Hermes works and lets you
  allow or deny a command it asks about; Models. The app talks to each
  Hermes Agent container directly, and a switcher on the page picks which
  one. Studio, Tools and Memory are next.
- **Docker:** containers on Cubecrusher through the dashboard (read only),
  and on any machine added under Settings over SSH, where the app can start,
  stop, restart and read logs. The app uses the SSH keys on this computer.
- **Settings:** the dashboard server, Hermes instances, Docker servers, and
  in-app updates: pick a branch and install its latest GitHub Actions build.
- **Overview** (design option 4, "Story"): a plain-language summary and a
  verdict for compute, memory, each GPU and storage; CPU, GPU and RAM lanes
  for the time the app has been open; an ask bar for Hermes. **Array &
  disks** is its second tab (no longer a separate page): the array's size,
  disks ranked by how full they are, and suggestions. The sample data also
  shows the growth forecast, per-disk temperatures and tonight's schedule,
  which need the dashboard to report more.
- Every other page says what it will do. They haven't been designed yet.

## Running it

```sh
npm install
npm run dev      # Vite + Electron with hot reload
```

Click **Connect** in the top bar and enter the dashboard's address, such as
`http://192.168.1.10:3000`, then sign in.

To try it without Cubecrusher, run Home-Dashboard with sample data
(`npm run dev:server` in that repo) and connect to `http://localhost:3000`.

```sh
npm run build    # builds the page into dist/
npm start        # runs Electron on the built page
npm test
```

## How it fits together

- `electron/main.cjs` opens the window; `settings.cjs` keeps what's set up
  in the app's config folder; `dashboard.cjs` makes every `/api/...` request
  to Home-Dashboard, so the sign-in cookie lives in Electron's cookie jar and
  there are no CORS problems; `hermes.cjs` talks to Hermes Agent's API;
  `docker.cjs` runs `docker` over SSH; `updates.cjs` fetches builds from
  GitHub Actions. The workflow uploads a small artifact per platform for the
  updater (`cubecrusher-mac-arm64`, `cubecrusher-mac-x64`, `cubecrusher-win`,
  `cubecrusher-linux`, about 100 MB each) next to the all-in-one ones for a
  first install; the download shows its progress, can be cancelled, and gives
  up if nothing arrives for a minute.
- `electron/preload.cjs` gives the page a small `window.cubecrusher` bridge.
- `src/` is the React app. `src/steeze/` is a copy of the Steeze tokens,
  components and fonts.

## Installers

`npm run dist:mac`, `dist:win` or `dist:linux` builds an installer into
`release/`. Every push also builds all three on GitHub Actions (Mac, Windows,
Linux); download them from the run's **Artifacts**.

The Mac app isn't notarized by Apple yet, so the first time, right-click it
and choose **Open**. If macOS says it's damaged, run this once in Terminal:

```sh
xattr -cr /Applications/Cubecrusher.app
codesign --force --deep -s - /Applications/Cubecrusher.app
```
