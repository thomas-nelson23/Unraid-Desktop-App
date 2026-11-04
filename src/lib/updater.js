import { useCallback, useEffect, useState } from 'react';
import { desktop } from './api.js';

// The app's updates, shared by the top bar's pill and the Settings card:
// which build is running, the newer build on its branch if the main
// process found one, and the install that's running with its progress.
export function useUpdates() {
  const [running, setRunning] = useState(null);
  const [available, setAvailable] = useState(null);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  // What an install that didn't restart the app had to say (the file was left somewhere).
  const [note, setNote] = useState(null);

  useEffect(() => {
    if (!desktop) return undefined;
    desktop.updates.running().then(setRunning).catch(() => {});
    // The main process checks on its own at startup and hourly; a page that
    // opened after a check asks for the answer it already has.
    desktop.updates
      .check(false)
      .then((c) => setAvailable(c.available))
      .catch(() => {});
    // Back on the page while an update started earlier is still running.
    desktop.updates
      .busy()
      .then((busy) => busy && setProgress((p) => p || { text: 'An update is still running…', pct: null }))
      .catch(() => {});
    const offProgress = desktop.updates.onProgress(setProgress);
    const offAvailable = desktop.updates.onAvailable(setAvailable);
    return () => {
      offProgress();
      offAvailable();
    };
  }, []);

  const install = useCallback(async (branch) => {
    setError(null);
    setNote(null);
    setProgress({ text: 'Starting…', pct: null });
    try {
      const out = await desktop.updates.install(branch);
      if (out.relaunch || out.quit) setProgress({ text: out.note || 'Installed. Restarting…', pct: null });
      else {
        setProgress(null);
        setNote(out.note || 'Downloaded.');
      }
    } catch (err) {
      setProgress(null);
      setError(err.message);
    }
  }, []);
  const cancel = useCallback(() => desktop.updates.cancel().catch(() => {}), []);

  return { running, available, progress, error, note, install, cancel };
}
