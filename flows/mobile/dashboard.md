# Mobile Dashboard Flow

## Access Control
Only users with `subscription_status = 'active'` or `subscription_status = 'trial'` (non-expired)
can view the dashboard. `AppNavigator.resolveInitialRoute` handles the gate — free users go to
`Subscription`, valid subscribers/trial users go to `Home`.

---

## First-Login Setup Checklist

Shown once on first open. Each step is tracked in AsyncStorage. Steps are sequential and blocking
until complete or skipped (audio only).

| Step | AsyncStorage Key | Skippable |
|---|---|---|
| GPS permission | `HADIN_SETUP_GPS` | No |
| Microphone permission | `HADIN_SETUP_AUDIO` | Yes |
| SOS PIN | `HADIN_SOS_PIN` | No |

### Step 1 — GPS
- Check `Location.getForegroundPermissionsAsync()`
- If `status === 'granted'`: mark done immediately, advance to audio
- If not granted: show modal → "Enable" → `Linking.openSettings()` → user returns → re-check
- Modal title: "Enable Location Access"
- Cannot skip

### Step 2 — Microphone
- Show modal → "Enable" → `Linking.openSettings()`, OR "Skip for now"
- Either action marks step done and advances to PIN
- Modal title: "Enable Microphone Access"

### Step 3 — SOS PIN
- In-app numpad modal, 4-digit PIN
- Enter PIN → Confirm PIN → if match, save to `HADIN_SOS_PIN` in AsyncStorage
- If mismatch, show "PINs don't match, try again" and reset
- Cannot skip

After all steps complete, `setupStep` is null and modals never show again.

---

## GPS Off Banner
If location permission is revoked after setup, a yellow warning banner appears at the top of the
idle scroll:
> "Location access disabled — tap to re-enable"
Tapping opens `Linking.openSettings()`. Banner disappears once permission is restored.

---

## User Mode Toggle

Single sliding pill at the top of the scroll area (tap either half, or drag
the thumb) — see `flows/mobile/fixes/trip-mode-user-mode.md` for the fix that
guarantees this toggle is fully decoupled from the "start a trip" form.

| Pill | Basic Plan | Elite / Trial |
|---|---|---|
| Always On | Greyed, lock icon + "ELITE" badge — tap opens `UpgradeSheet`, mode unchanged | Toggleable, `colors.brand.primary` fill when active |
| Trip Mode | Active (default) | Toggleable |

- Default: Trip Mode selected
- Toggle tap/drag calls `handleModeToggle` only — never opens `StartTripModal`
  (that is a separate "+" control on the map, reachable independently)
- Switching **to** Trip Mode stops any running tracking session — no pings
  are written until the user explicitly starts a trip
- Switching **to** Always On starts a foreground GPS watcher immediately
  (`startTracking(null, 1)`); map updates live via the shared position
  listener
- Persisted to `AsyncStorage` key `` `HADIN_USER_MODE:<userId>` `` (namespaced
  per user, not a single global key)
- Restored on relaunch; Always Online only auto-resumes if the plan still
  allows it (checked fresh, not cached)
- Low battery (≤15%): pause always-on tracking, fire a local notification,
  show "Tracking paused — tap to resume" banner; resumes automatically at >20%

---

## Map

- Full-bleed card, height 540
- Real device location via `Location.getCurrentPositionAsync({ accuracy: Balanced })`
- Reverse geocoded location name shown in location badge ("CURRENT LOCATION / City, State")
- Default region: Nigeria (6.524°N, 3.379°E) shown while GPS resolves
- Map controls (right column): settings icon, crosshair (re-center), phone, SOS FAB (red)
- SOS FAB visible in idle mode but tapping shows "Start a trip first" bottom modal (not Alert)

---

## My Safety Circle Section

- Title: "My Safety Circle" + "View All" → `CircleScreen`
- Shows up to 2 contacts from `trusted_contacts`
- If 0 contacts: only the "Add a Circle Member" card shown
- "Add a Circle Member" card always rendered below any existing contacts
- Contact row: avatar initials, name, relationship, green check icon

---

## History Section

- Title: "History" + "View All" → `RoutesScreen`
- Shows up to 2 recent completed/cancelled trips
- If no trips: placeholder rows with "No history yet" state

---

## Family Groups Section

| Condition | Display |
|---|---|
| `plan === 'basic'` | "Upgrade to Elite" card with lock icon + "Unlock with Elite Plan" label |
| `plan === 'elite'`, no groups | "Add a Family Group" empty state card |
| `plan === 'elite'`, has groups | Up to 2 group rows + "View All" → `CircleScreen` |

---

## Active Trip State

Unchanged from existing implementation:
- Green active banner + trip route header
- Stat row (elapsed, pings, stops, max stop)
- Last known location card
- Circle standby card
- SOS button → triggers `triggerSOS()`
- Cancel SOS button (SOS sent state)
- End trip button → EndTripModal

---

## Supabase / Backend Calls (Idle State)

| Call | Purpose |
|---|---|
| `auth.getUser()` | User identity, display name |
| `profiles.select('plan, subscription_status').eq('id', uid)` | Plan gating |
| `trips.select('*').eq('status','active').limit(1)` | Active trip check |
| `trips.select('*').neq('status','active').limit(3)` | History |
| `trusted_contacts.select('id,name,phone,relationship').limit(2)` | Circle preview |
| `trusted_contacts.select(…)` (no limit) | SOS contact cache |
| `family_groups.select('id,name').eq('owner_id',uid).limit(2)` | Elite only |
| `Realtime: trips` channel | Refresh on trip status change |

---

## AsyncStorage Keys

| Key | Values |
|---|---|
| `HADIN_SETUP_GPS` | `'done'` or absent |
| `HADIN_SETUP_AUDIO` | `'done'` \| `'skipped'` or absent |
| `HADIN_SOS_PIN` | 4-digit string or absent |
| `HADIN_USER_MODE` | `'always_on'` \| `'trip'` |

---

## Navigation Map

| Action | Result |
|---|---|
| "View All" (Circle section) | → `CircleScreen` |
| "View All" (History section) | → `RoutesScreen` |
| Profile tab | → `SettingsScreen` |
| Circle tab | → `CircleScreen` |
| History tab | → `RoutesScreen` |
| Start trip (Trip Mode) | StartTripModal → active trip state |
| Always On toggle | Starts GPS watcher in session |
