import * as Battery from 'expo-battery';

// Always Online battery gate (flows/mobile/user-mode.md):
// pause tracking at <=15%, resume at >20% — the gap between the two
// thresholds is deliberate hysteresis so the watcher doesn't flap
// pause/resume every time the level ticks across a single cutoff.
const PAUSE_THRESHOLD = 0.15;
const RESUME_THRESHOLD = 0.20;

let _subscription: Battery.Subscription | null = null;
let _paused = false;

export interface BatteryMonitorCallbacks {
  onPause: () => void;
  onResume: () => void;
}

/**
 * Watches battery level while Always Online tracking is active. Only runs
 * as long as the JS runtime is alive (foreground or backgrounded-but-not-
 * killed) — like the tracking watcher itself, this stops if the OS kills
 * the app, since no background task is registered for it.
 */
export async function startBatteryMonitor(callbacks: BatteryMonitorCallbacks): Promise<void> {
  stopBatteryMonitor();
  _paused = false;

  try {
    const level = await Battery.getBatteryLevelAsync();
    if (level >= 0 && level <= PAUSE_THRESHOLD) {
      _paused = true;
      callbacks.onPause();
    }
  } catch {
    // non-fatal — the listener below will still pick up subsequent changes
  }

  _subscription = Battery.addBatteryLevelListener(({ batteryLevel }) => {
    if (!_paused && batteryLevel <= PAUSE_THRESHOLD) {
      _paused = true;
      callbacks.onPause();
    } else if (_paused && batteryLevel > RESUME_THRESHOLD) {
      _paused = false;
      callbacks.onResume();
    }
  });
}

export function stopBatteryMonitor(): void {
  _subscription?.remove();
  _subscription = null;
  _paused = false;
}

/**
 * Returns true if the Always Online battery monitor is currently active.
 * Used by LocationService to skip the trip-level battery gate when the
 * Always Online gate already covers the low-battery scenario.
 */
export function isRunning(): boolean {
  return _subscription !== null;
}
