# From travel-safety-app root — create the prompt file
mkdir -p .claude/prompts/screens

cat > .claude/prompts/screens/13-RoutesScreen.md << 'PROMPT_EOF'
# Prompt: RoutesScreen.tsx — Mobile Engineer

## Agent
Read .claude/agents/mobile-engineer.md before doing anything.

## Read before writing (in this order)
- CLAUDE.md
- mobile/src/navigation/AppNavigator.tsx
- mobile/src/screens/trip/HomeScreen.tsx
- mobile/src/screens/circle/CircleScreen.tsx
- mobile/src/styles/tokens.ts
- mobile/src/lib/supabase.ts

## Goal
Build mobile/src/screens/routes/RoutesScreen.tsx and wire it
into the navigator as the Routes tab destination.

## Navigation wiring
Add to AppStackParamList in AppNavigator.tsx:
  Routes: undefined

Add to AppStack:
  <AppStackNav.Screen name="Routes" component={RoutesScreen} />

In HomeScreen.tsx both tab bars, wire Routes tab:
  onPress: () => navigation.navigate('Routes')

## Types
Trip: id, origin, destination, status (active|completed|sos),
started_at, ended_at, expected_stops, max_stop_duration_minutes,
created_at — all string | null except status and id.

TripMetrics: total, safe, sos, active — all numbers.

## State
trips, filtered, activeFilter (all|completed|sos|active),
loading, selectedIds, selectMode, swipedId, showDeleteSheet,
tripToDelete, deleting, metrics.

## Data
On mount: fetch all trips ordered created_at DESC.
Compute metrics from result.
Subscribe to Supabase Realtime on trips — refresh on any change.
Unsubscribe on unmount.

## Filter
all → all trips
completed → status=completed (shown as Safe)
sos → status=sos
active → status=active

## Layout — match approved design exactly

### Header (white, safe area top)
Left: "My routes" (20px 800 #1A1A1A) + "Your travel history" (11px #9C9A92)
Right: checkbox (18x18 radius 5) + "Select all" label
  Tapping enters selectMode and selects all

### Metrics strip (white, border-bottom)
4 boxes in a row, gap 8, each #F4F3EF radius 12 border #EEECe6:
  Total trips — value #1A1A1A
  Safe — value #1A6B4A
  SOS fired — value #C0392B
  Active — value #1D9E75
  Label 10px #9C9A92 below each value

### Filter tabs (white, border-bottom)
All | Safe | SOS | Active
Active: #1A6B4A, border-bottom 2px #1A6B4A, weight 700
Inactive: #9C9A92, transparent border

### Trip rows (FlatList, bg #F4F3EF, padding 10 13)
Each row: white card radius 14 border 0.5px #EEECe6.

Swipe implemented with PanResponder + Animated.Value (translateX).
Threshold 80px left to reveal actions. One row open at a time.
Swiping new row closes previous.

Normal row layout:
  checkbox | icon | info column | badge+date | chevron
  
  Checkbox: only interactive in selectMode.
  Always rendered (transparent when not in selectMode) so
  layout never shifts.
  Checked: #1A6B4A bg, white checkmark.
  
  Icon 34x34 radius 10:
    active/completed: #EFF9F4 bg, green ti-route
    sos: #FDEDEC bg, red ti-alert-triangle
  
  Info:
    "[origin] → [destination]" 13px 700 #1A1A1A
    meta: date + duration or "In progress" — 10px #9C9A92
  
  Right: badge + date (10px #B4B2A9)
    completed badge: Safe — #EFF9F4/#0F6E56/#C6E8D5
    sos badge: SOS fired — #FDEDEC/#A32D2D/#F9C6C6
    active badge: Active — #EFF9F4/#0F6E56/#C6E8D5
  
  Chevron ti-chevron-right 14px #D0CEC8 (hidden in selectMode)
  
  Tap (not selectMode): navigate TripDetail with tripId
  Tap (selectMode): toggle in selectedIds

Swiped row: translateX -120px, reveals:
  View button 60px #1A6B4A: ti-eye + "View" label
    → close swipe + navigate TripDetail
  Delete button 60px #C0392B radius 0 14 14 0: ti-trash + "Delete"
    → close swipe + set tripToDelete + showDeleteSheet=true

### Select mode toolbar
Absolute, top 0, full width, #1A6B4A bg, covers header.
Left: ti-x (white 20px, cancels selectMode) + "[N] selected" (14px 600 white)
Right: Delete chip (trash icon + "Delete" text, white)
  Only enabled when selectedIds.length > 0

Select all checkbox behaviour:
  All selected → deselect all
  Not all → select all filtered IDs

Delete in toolbar:
  If any selected ID has status=active:
    Alert "Cannot delete an active trip"
    Return
  Else Alert confirm → delete all selected → reload → exit selectMode

### Delete sheet
Bottom sheet modal (same pattern as DeleteContactSheet):
  Overlay rgba(0,0,0,0.45)
  Sheet white radius 22 22 0 0
  Handle bar
  Trash icon 52px #FDEDEC bg #C0392B
  Title: "Delete this trip?"
  Body: "This permanently removes the trip and all location
  pings. This cannot be undone."
  Preview card: icon + route + date + status badge
  Buttons: "Keep it" (#F4F3EF) | "Delete" (#C0392B)

On Delete confirm:
  Delete from trips WHERE id=tripToDelete.id AND status != active
  Delete from location_pings WHERE trip_id=tripToDelete.id
  Reload trips, close sheet
  Show SuccessToast "Trip deleted"

### Empty state (when filtered empty, not loading)
56x56 #EFF9F4 radius 16, ti-route 28px #1A6B4A
Title varies by filter:
  all: "No trips yet"
  completed: "No safe trips"
  sos: "No SOS trips"
  active: "No active trips"
Subtitle (all filter only): "Start your first trip from the home screen."

## Helpers
formatDuration(startedAt, endedAt): e.g. "2h 05min" or "48min"
formatTripDate(iso): "Today" or "Jun 18"

## Rules
- TypeScript strict, no any
- StyleSheet.create() only
- FlatList for trip list
- PanResponder for swipe
- useSafeAreaInsets() for header
- Never delete an active trip
- Supabase always via lib/supabase.ts
- Import SuccessToast from components/SuccessToast.tsx
PROMPT_EOF