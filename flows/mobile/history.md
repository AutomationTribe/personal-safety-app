# History — Mobile Flow

Source: `flows/General/general.md` — "History: this page shows sos alerts and
trips. it has a filter and search functionality and also a delete
functionality."

Screen component: `mobile/src/screens/routes/RoutesScreen.tsx` (route name
`Routes` in `AppStackParamList` — unchanged; bottom-tab label is "History").
Detail screen: `mobile/src/screens/routes/TripDetailScreen.tsx`.

## Entry points
- Bottom tab bar "History" item — from Dashboard, Circle, Settings, Routes itself.
- Dashboard "History" section → "View All" action.

## Screen layout (top to bottom)
1. Header — title "My routes" / subtitle "Your travel history", "Select all" toggle.
2. Metrics strip — Total trips / Safe / SOS fired / Active (unchanged, trip-only).
3. Search bar — Feather `search` icon, placeholder "Search by destination…", clear (`x`) button when non-empty. Filters the currently active tab's rows by trip origin/destination text (case-insensitive substring). Has no effect on SOS rows beyond hiding them entirely when a query is active (SOS rows have no destination field to match).
4. Filter bar — three tabs: **All / Trips / SOS events**.
   - **All** — trips and SOS events interleaved, sorted by date descending (trip `created_at` vs SOS `triggered_at`).
   - **Trips** — trips only.
   - **SOS events** — `sos_events` rows only.
5. List (FlatList, pull-to-refresh) of trip rows and/or SOS rows per the active tab.
6. Bottom tab bar.
7. Select-mode toolbar (trips only — see Delete behaviour).

## Trip row
- Route icon (`navigation`, green; `alert-triangle`, red if `status = 'sos'`).
- Origin → Destination text.
- Meta line: relative date (`Today` or `d MMM`) + duration (if ended) or "In progress" (if active).
- Status badge: `completed` → "Safe" (green), `sos` → "SOS fired" (red), `active` → "Active" (blue/mid).
- Swipe-left reveals View / Delete actions. Tap opens `TripDetail`.

## SOS row
- Red alert icon (`alert-triangle`) in a red-tinted circle.
- Title: "Emergency SOS Triggered".
- Meta line: relative date + time (`triggered_at`).
- Status badge: `resolved_at` set → "Resolved" (green); `cancelled_at` set → "Cancelled" (grey); neither → "Active" (red, pulsing not required).
- Delivery method chip: "Sent via SMS" / "Sent via internet" / "Sent via both" (from `delivery_method`).
- Read-only — no swipe actions, no checkbox, not selectable in bulk-delete mode. Tapping does nothing (no SOS detail screen in this pass — SOS events tied to a trip are visible from that trip's `TripDetail`).

There is no `trigger_type` (manual / accident / auto-SOS) or `alert_level`
(1st / 2nd) column in `sos_events` today, and only one call site
(`SOSService.triggerSOS`, the manual SOS button) exists in the app. The row
does not display a trigger type or alert level — see "Decisions/blocked" in
the implementation report.

## TripDetailScreen
- Back button → `navigation.goBack()`.
- Header: origin → destination, status badge.
- Metadata card: started_at, ended_at, duration, distance (sum of haversine distance between consecutive `location_pings`, shown in km).
- Map (`react-native-maps`): `Polyline` through all pings for the trip (ordered by `created_at`), start/end `Marker`s, plus a red `Marker` for each SOS event tied to the trip (via lat/lng).
- Ping list: scrollable list below the map — timestamp + lat/lng (5dp) per ping, newest first.
- SOS events section: if any `sos_events` rows reference this trip, list them with the same fields as the SOS row above (read-only).
- Empty state (no pings recorded yet — e.g. a trip started seconds ago): "No location pings yet."

## Empty states (per filter tab)
- **All**: icon `activity`, "No activity yet", "Your trips and SOS alerts will appear here once you start using Hadin's safety features."
- **Trips**: icon `navigation`, "No trips yet", "Start your first trip from the home screen."
- **SOS events**: icon `shield`, "No SOS alerts", "You haven't triggered an SOS. That's a good thing."
- Search with zero matches (any tab): icon `search`, "No results for \"{query}\"".

## Pull-to-refresh
`RefreshControl` on the `FlatList` re-runs both the trips query and the
sos_events query.

## Delete behaviour
- **Trips**: unchanged — single delete via swipe (confirmation sheet), bulk delete via select-all + toolbar (confirmation sheet, blocks if any selected trip is `active`). Deletes `location_pings` for the trip first, then the trip row.
- **SOS events**: not deletable from this screen — `sos_events` are an audit trail. (Flow doesn't distinguish trip vs SOS delete permissions, but treating safety alerts as immutable is the safer default; flagged as a decision below.)

## Navigation
Tab bar → History (`Routes`) → tap a trip row → `TripDetail` (`{ tripId }`) → back → `Routes`. SOS rows do not navigate.
