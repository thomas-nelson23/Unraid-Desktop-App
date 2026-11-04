# Cubecrusher desktop

A desktop app for the Cubecrusher Unraid server, for macOS, Windows and Linux.
Built with Electron, React and the Steeze design system.

It talks straight to Cubecrusher through Unraid's own API (the GraphQL one
built into Unraid 7, with an API key) for the server, array, disks and
containers, and over SSH for what that API lacks: GPU readings, container
logs and live container stats. Each Hermes Agent container is reached
directly, and the weather comes straight from Open-Meteo. The
[Home-Dashboard](https://github.com/thomas-nelson23/Home-Dashboard) server is
optional: only the calendar, to-do list and notes come from it. Until
something is set up, every page shows sample data and says so.

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
- **Docker:** Cubecrusher's containers through Unraid's API (start, stop,
  restart; logs and per-container CPU and memory over SSH), and any other
  machine added under Settings over SSH, where the app can start, stop,
  restart and read logs. The app uses the SSH keys on this computer.
- **Settings:** Cubecrusher's address and Unraid API key (plus the SSH
  user), the optional dashboard server, the weather place, Hermes instances,
  Docker servers, and in-app updates: pick a branch and install its latest
  GitHub Actions build.
- **VMs** (remote control, through Home-Dashboard): one page with two tabs, VM console and RDP, and
  one slim bar (the tab switch, a drop-down of VMs or computers, the
  connection's state and tools); the screen fills the rest. **VM console**
  shows a VM's own screen (VNC, the console Unraid opens) with Ctrl+Alt+Del
  and other keys, paste-by-typing, snapshots, fit or 1:1, picture quality and
  full screen. **RDP** opens a computer's desktop through guacd, the Guacamole
  container Home-Dashboard's Remote page already uses, and can add computers
  and wake sleeping ones. Both tabs stay connected while you switch tabs or
  pages, and while a screen has the keyboard the app's own shortcuts (reload,
  close) go to the remote computer.
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

Under **Settings → Cubecrusher**, enter the Unraid web UI's address, such
as `http://192.168.1.10`, and an API key made on the server under
**Settings → Management Access → API Keys** (admin role, so containers can
be started and stopped). For an `https://` address by IP, tick "Trust its
certificate". SSH uses this computer's keys, so `ssh root@192.168.1.10` has
to work in a terminal for the GPU, logs and container stats.

For the calendar, click **Connect…** under Home-Dashboard (optional) and
enter the dashboard's address, such as `http://192.168.1.10:3000`, then sign
in. To try that part without Cubecrusher, run Home-Dashboard with sample
data (`npm run dev:server` in that repo) and connect to
`http://localhost:3000`.

```sh
npm run build    # builds the page into dist/
npm start        # runs Electron on the built page
npm test
```

## How it fits together

- `electron/main.cjs` opens the window; `settings.cjs` keeps what's set up
  in the app's config folder; `unraid.cjs` queries Unraid's GraphQL API
  (`unraidShape.cjs` turns its answers into the shapes the pages draw, and
  falls back to plainer queries on an older API); `ssh.cjs` runs commands
  over SSH; `dashboard.cjs` makes every `/api/...` request to
  Home-Dashboard, so the sign-in cookie lives in Electron's cookie jar and
  there are no CORS problems; `hermes.cjs` talks to Hermes Agent's API;
  `docker.cjs` picks the Unraid API or SSH per server; `weather.cjs` asks
  Open-Meteo; `updates.cjs` fetches builds from GitHub Releases. The
  workflow publishes every push as a release tagged `builds/<branch>/<run>`
  with one asset per installer, and the updater picks the one for this
  computer (`updatesShape.cjs`); it checks the app's own branch at startup
  and hourly, and the download shows its progress, can be cancelled, and
  gives up if nothing arrives for a minute.
- `electron/preload.cjs` gives the page a small `window.cubecrusher` bridge.
- The VMs page's screens are WebSockets from the page to the server. The
  main process adds the sign-in cookie and the Origin the server checks to
  those sockets (only for the configured server's `/api/` paths).
- `src/` is the React app. `src/steeze/` is a copy of the Steeze tokens,
  components and fonts.

## Installers

Every push builds the app for all three platforms on GitHub Actions and
publishes the installers as a release: the newest build of `main` is the
**Latest** release on the [Releases page](https://github.com/thomas-nelson23/Unraid-Desktop-App/releases),
and other branches are pre-releases. The repository is public, so the
downloads need no account.

**Updating is one click.** The app checks its own branch when it starts and
every hour; when a newer build is out, an **Update ready** button appears
in the top bar. Clicking it downloads the installer, replaces the app and
restarts it: the Mac app is swapped in place, an AppImage is overwritten,
a pacman install is upgraded with the new package (the system asks for
your password), and on Windows the installer runs quietly and starts the
app again. Settings → Updates shows the build that's running and lets any
branch's build be installed instead.

On CachyOS or any Arch-based distro, install the `.pacman` package once:

```sh
curl -LO https://github.com/thomas-nelson23/Unraid-Desktop-App/releases/latest/download/cubecrusher-desktop-0.1.0.pacman
sudo pacman -U cubecrusher-desktop-0.1.0.pacman
```

It shows up in the app menu as Cubecrusher (binary `cubecrusher`), and
updates itself from then on. The AppImage runs anywhere: `chmod +x` it and
double-click; it needs `fuse2` (`sudo pacman -S fuse2`), or run it with
`--appimage-extract-and-run`.

`npm run dist:mac`, `dist:win` or `dist:linux` builds an installer into
`release/` by hand. The Mac build on Actions is the Apple Silicon zip only;
run the workflow by hand with the "Also build the Mac disk images" box
ticked for the Intel build and disk images.

The Mac app isn't notarized by Apple yet, so the first time, right-click it
and choose **Open**. If macOS says it's damaged, run this once in Terminal:

```sh
xattr -cr /Applications/Cubecrusher.app
codesign --force --deep -s - /Applications/Cubecrusher.app
```
