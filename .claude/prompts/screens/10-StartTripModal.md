# Prompt: StartTripModal.tsx

## Agent
Mobile Engineer — read .claude/agents/mobile-engineer.md first.

## Read before writing
- CLAUDE.md
- mobile/src/screens/trip/HomeScreen.tsx
- mobile/src/services/LocationService.ts
- mobile/src/services/CircleService.ts
- mobile/src/styles/tokens.ts

## Goal
Build mobile/src/screens/trip/StartTripModal.tsx and update
HomeScreen.tsx to use it.

## Props
```typescript
interface Props {
  visible: boolean
  onClose: () => void
  onTripStarted: (trip: Trip) => void
}
```

## Fields (all in one bottom sheet modal)

### Row 1 — side by side
From (required *): text input, placeholder "Where are you leaving from?"
To (required *): text input, placeholder "Your destination"

### Row 2 — side by side
Estimated stops: number dropdown
  Options: 0 stops, 1 stop, 2 stops, 3 stops, 4 stops, 5+ stops
  Default: 0 stops

Max stop duration: time dropdown
  Options: 15 min, 30 min, 45 min, 1 hour
  Intervals of 15 mins starting from 15 mins up to 1 hour
  Default: 30 min
  Implemented as: Picker or custom flat list inside a modal

### Full width — contact selector
Label: "Alert contacts *"
Show all contacts from CircleService.getContacts()
Each row: checkbox (default checked), avatar initials, name, relationship
All contacts pre-checked by default (opt-out model, not opt-in)
User can uncheck specific contacts to exclude them
Show loading spinner while contacts load
If no contacts: show "Add contacts to your circle first"
  with a link that calls onClose() then navigates to Circle

## Validation on "Start tracking" press
- origin: required, min 2 chars
- destination: required, min 2 chars  
- At least 1 contact must be selected

## On "Start tracking" press
1. Validate fields — show inline errors if invalid
2. Insert to trips table via Supabase:
   { status: 'active', origin, destination,
     started_at: new Date().toISOString(),
     expected_stops: number,
     max_stop_duration_minutes: number }
3. Call LocationService.startTracking(trip.id, 30)
4. POST to /api/v1/trips/notify-start:
   { tripId, origin, destination, contactIds: selectedContactIds }
   Fire and forget — do not block on this
5. Call onTripStarted(trip) with the created trip
6. Call onClose()

## HomeScreen.tsx changes
- Import StartTripModal
- Add showStartModal: boolean to state (default false)
- Replace handleStartTrip() direct insert with:
    setShowStartModal(true)
- Render <StartTripModal> in the idle view
- On onTripStarted: set activeTrip, show SuccessToast:
    title: "Trip started · [contact1] and [contact2] notified"
    subtitle: "GPS tracking active · Next ping in 30 min"
- Pass trip.expected_stops and trip.max_stop_duration_minutes
  to ActiveTripView stats card

## ActiveTripView stats card update
Add two more stat columns:
- Stops: trip.expected_stops (or "—" if 0)
- Max stop: trip.max_stop_duration_minutes + "m"

## Visual (match approved design)
- Same bottom sheet style as AddContactModal
- From/To in a flex row with gap 8
- Stops/MaxStop in a flex row with gap 8
- Contact selector: white card with 0.5px border,
  each row 44px tall for touch targets
- Checkbox: 18x18, radius 5, #1A6B4A when checked
- "Start tracking →" button: full width, #1A6B4A bg

## Rules
- TypeScript strict, no any
- StyleSheet.create() only
- useSafeAreaInsets() not needed — modal handles safe area
- KeyboardAvoidingView for iOS