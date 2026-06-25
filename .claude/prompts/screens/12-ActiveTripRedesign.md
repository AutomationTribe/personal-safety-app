# Screen Prompt 12 — Active Trip Redesign

Agent: mobile-engineer

## Before writing anything

Read these files:
- mobile/src/screens/trip/HomeScreen.tsx
- mobile/src/services/SOSService.ts
- mobile/src/services/CircleService.ts
- mobile/src/styles/tokens.ts
- CLAUDE.md

## Task

Replace the `ActiveTripView` section inside `HomeScreen.tsx` with the approved design below.
Do not touch anything outside the active trip view.

## Layout

```
┌─────────────────────────────────────────┐
│ [green thin banner]  Trip active  [Background chip] │
├─────────────────────────────────────────┤
│                                         │
│  [white card]  Circle on standby        │
│  Contact 1 avatar + name                │
│  Contact 2 avatar + name                │
│  +3 more  (overflow row, shown if 5+)   │
│                                         │
│  [SOS button — single tap]              │
│  Shows spinner while triggering         │
│                                         │
│  [End trip button]                      │
└─────────────────────────────────────────┘
```

## Colours & tokens

- Background: `#F4F3EF`
- Cards: white
- Banner: thin green bar, text `colors.primary`
- SOS button: red, full width, 56px height
- End trip: ghost/outline button

## Background chip behaviour

- Android: calls `BackHandler.exitApp()` to background the app
- iOS: shows `Alert` with instructions:
  > "Swipe up and go home to background Hadin. Your trip is still active."

## SOS button states

1. **Idle** — "Send SOS" label
2. **Triggered (loading)** — spinner, button disabled
3. **SOS active** — red banner replaces green banner, "Cancel SOS" button appears below

## Circle on standby card

- Shows first 2 contacts by name + avatar initials
- If more than 4 contacts: show "+N more" overflow row
- If 0 contacts: show "Add contacts to your circle" prompt linking to CircleScreen

## SOS triggered view

- Green banner → red banner: "SOS Active — help is on the way"
- "Cancel SOS" ghost button below SOS button
- On cancel: calls `cancelSOS(eventId)`, resets to idle state

## Rules
- TypeScript strict, no any
- Use `SOSService.triggerSOS` and `SOSService.cancelSOS`
- Single tap to trigger SOS — no double-tap, no hold
- Keep all existing HomeScreen logic for non-active-trip state
- `KeyboardAvoidingView` not needed here — no inputs
