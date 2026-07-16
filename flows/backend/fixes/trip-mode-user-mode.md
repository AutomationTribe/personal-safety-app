N/A — fix is mobile only.

The Trip Mode / User Mode toggle bug (`flows/fixes.md`) and its fix
(`flows/mobile/fixes/trip-mode-user-mode.md`) are entirely contained within
`mobile/src/screens/trip/HomeScreen.tsx` (gesture/tap handling and local
state). No backend route, schema, or service was touched or needs to be.
