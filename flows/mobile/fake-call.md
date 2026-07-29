# Fake Call Flow

Source: `flows/General/general.md` — "Fake call": "This works by setting in
how many minutes the user should receive a call. the user also sets a
caller id that the user wants to display when the call comes in. after the
set time has elapsed a call is placed to the users phone using the phones
set ringtone and the set caller id is shown. The call appears as an actual
call and when the user picks the UI for call in session for that phone is
shown until the call is ended."

This pass implements the feature fully client-side, in-app (not a real
Android telephony call — no native call-injection capability exists in an
Expo-managed app). The "looks/feels like an incoming call" requirement is
met with a full-screen lock-style UI + a bundled looping ringtone via
`expo-av`, not the device's actual ringtone/dialer.

## Entry point

`mobile/src/screens/trip/HomeScreen.tsx`, `IdleView`'s map card — a
circular purple (`#4B0082`) FAB, bottom-left of the map, Feather `phone`
icon, sibling to the existing bottom-right map controls cluster
(add-trip / recentre / SOS). Replaces the old unwired placeholder phone
icon that lived in that bottom-right cluster (dead code — no `onPress`,
disabled-only render).

Disabled (`styles.lockedControl`) whenever `sosActive` — per the
dashboard-lockdown rule (`flows/mobile/sos-manual.md` / this session's
"only Cancel SOS works during an active SOS" instruction), no new fake
call can be scheduled while a real SOS is in progress.

Not gated by plan — general.md's mode description only says Always Online
"allows... fake call anytime," it does not say Trip Mode blocks it, so the
FAB is available in both modes/plans.

## Setup sheet (`FakeCallSetupSheet.tsx`)

Bottom sheet modal (`Modal transparent animationType="slide"`), not a full
screen.

- Header: "Fake a Call" title, left aligned bold ~20px; Feather `x` close
  button top right.
- **Caller Display Name** field — labelled, `user` icon inside input,
  placeholder "Emergency Contact". Last-used value persisted to
  `AsyncStorage` (`HADIN_FAKECALL_LAST_NAME`) and pre-filled on next open.
- **Timer (seconds)** field — labelled, `clock` icon inside input, numeric
  keyboard, default `"30"`. Clamped client-side to 5–300; out-of-range or
  non-numeric input shows inline error text (no `Alert.alert`).
- CTA: full-width `#4B0082` button, `clock` icon + "Schedule Call", white
  text; subtitle below: "This will trigger a realistic incoming call
  screen."
- On submit: validates name (non-empty after trim) and timer (5–300,
  integer). On success, sheet closes and calls `onSchedule(name, seconds)`
  — HomeScreen owns the actual countdown, not the sheet, since the
  countdown must keep running (and its cancel banner must stay visible)
  after the sheet has already dismissed.

## Countdown banner (dashboard-level, in `HomeScreen.tsx`)

Once scheduled, a floating pill banner appears over the `IdleView`
dashboard: "Incoming call in `[n]`s — Tap to cancel." Ticks down every
1000ms via `setInterval`. Tapping it cancels the timer outright (no call
fires, banner disappears, no confirmation step — this is a low-stakes
undo, not a destructive action).

When the countdown reaches 0: the interval is cleared and
`navigation.replace('IncomingCall', { callerName })` fires —
`replace` (not `navigate`) so the dashboard isn't left on the back stack
mid-transition, matching "no back gesture" for the call screens.

## Incoming call screen (`IncomingCallScreen.tsx`)

Full screen, `#0F172A` background, lock-screen style. `gestureEnabled:
false` at the navigator level (see Navigation below) — Android hardware
back is also swallowed via `BackHandler` so DECLINE is the only way out
other than ACCEPT.

- 120px circular grey avatar showing the caller name's initials (reuses
  the same `initials()` helper pattern already used elsewhere in
  `HomeScreen.tsx`).
- Caller name, 28px white bold.
- "Incoming Call" subtitle, 14px `#1D9E75`, pulsing opacity animation
  (`Animated.loop`).
- Ringtone: `expo-av` `Audio.Sound`, `isLooping: true`, bundled asset —
  see "Ringtone asset" below. Starts on mount, stopped/unloaded on both
  accept and decline (and on unmount, as a safety net).
- DECLINE (left): red (`#C0392B`) circle, `phone-off` icon, "Decline"
  label → stops audio → `navigation.navigate('Home')`.
- ACCEPT (right): green (`#1A6B4A`) circle, `phone` icon, "Accept" label
  → stops audio → `navigation.replace('ActiveCall', { callerName })`.

## Active call screen (`ActiveCallScreen.tsx`)

Full screen, `#0F172A` background. No audio at all on this screen (per
spec — ringing stops the moment the call is "answered").

- Caller name, 24px white bold, top-centre.
- "Hadin Safety Call" subtitle, 13px muted.
- Live `00:00` elapsed timer, counts up every second from the moment this
  screen mounts (`setInterval`, cleared on unmount).
- Mute (`mic-off`) and Speaker (`volume-2`) buttons — circular grey,
  visual-only per spec (no real call to mute/route audio for).
- END CALL — large red (`#C0392B`) circle, `phone-off` icon → clears the
  timer → `navigation.navigate('Home')`.
- Subtle pulsing animation on the avatar/timer area to simulate an active
  call (same `Animated.loop` opacity technique as the incoming screen).

## Navigation

`AppStackParamList` (`mobile/src/navigation/AppNavigator.tsx`) gains:
```
IncomingCall: { callerName: string };
ActiveCall: { callerName: string };
```
Both screens registered with `headerShown: false, gestureEnabled: false`
(screen-level `options`, not navigator-wide, so every other screen keeps
its normal swipe-back behaviour).

## Ringtone asset

`mobile/assets/audio/ringtone.wav` — **placeholder tone**, not a real
ringtone. Generated this pass as a 1s looping two-beep sine-wave pattern
(950Hz) since no ringtone audio file existed anywhere in the repo and one
can't be authored without an actual sound asset. Flagged under "Blocked /
needs a decision" in the implementation report — swap this file for a
real ringtone `.mp3`/`.wav` (same filename, or update the `require()` path
in `IncomingCallScreen.tsx`) whenever one is available.

## Not implemented this pass (out of scope of the given spec)

- **History logging.** general.md says "every fake call placed and
  completed is logged in the history page as an activity with correct
  activity type which is fake call" — no `fake_calls` table, no history
  row, and no `RoutesScreen.tsx` change were requested in this pass's
  spec, so none were added. Flagged as blocked/needs-a-decision.
- **Minutes vs seconds.** general.md says the delay is set "in how many
  minutes"; this pass's explicit spec overrides that with a 5–300
  **second** timer field (matching the attached screen design exactly,
  which is authoritative for this pass). Documented here in case that was
  an unintentional mismatch.
