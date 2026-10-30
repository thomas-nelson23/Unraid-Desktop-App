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
  this computer); Chat with your Hermes chats, including Telegram ones;
  Models. Studio, Tools and Memory are next.
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

- `electron/main.cjs` keeps the server address in the app's config folder and
  makes every `/api/...` request itself, so the sign-in cookie lives in
  Electron's cookie jar and there are no CORS problems.
- `electron/preload.cjs` gives the page a small `window.cubecrusher` bridge.
- `src/` is the React app. `src/steeze/` is a copy of the Steeze tokens,
  components and fonts.
