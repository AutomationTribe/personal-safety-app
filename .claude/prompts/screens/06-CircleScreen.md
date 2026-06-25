# Prompt: CircleScreen.tsx

## Read first (in this order)
- CLAUDE.md
- mobile/src/styles/tokens.ts
- mobile/src/services/CircleService.ts
- mobile/src/components/SuccessToast.tsx
- mobile/src/navigation/AppNavigator.tsx

## Goal
Build mobile/src/screens/circle/CircleScreen.tsx

## State
```typescript
contacts: TrustedContact[]
filtered: TrustedContact[]
query: string
loading: boolean
showAddModal: boolean
showEditModal: boolean
showDeleteSheet: boolean
selectedContact: TrustedContact | null
toast: { visible: boolean; title: string; subtitle: string }
```

## On mount
Call CircleService.getContacts(), set contacts and filtered.
Show ActivityIndicator while loading.

## Search
On every keystroke call CircleService.searchContacts(query, contacts).
Update filtered. If filtered empty but contacts not: show
"No results for '[query]'" empty state.

## Layout

### Header (white bg, safe area top via useSafeAreaInsets)
- Left: "Your circle" (20px, 800), "[n] people travel with you" (12px, muted)
- Right: green + button (36x36, radius 10) → sets showAddModal=true

### Search bar (white bg)
- #F4F3EF bg, radius 12, search icon, placeholder "Search your circle…"

### Scrollable body (#F4F3EF bg)
Section label: "[n] contacts" (filtered count when searching)

Contact cards (white, radius 14, 0.5px border):
- Avatar: 38px circle, initials, colour by index from palette:
  index 0: bg #E6F1FB, text #0C447C
  index 1: bg #EAF3DE, text #27500A
  index 2: bg #EEEDFE, text #3C3489
  index 3: bg #FAEEDA, text #633806
  index 4: bg #E1F5EE, text #085041
  (cycle with modulo for > 5 contacts)
- Name (13px, 600), relationship + masked phone (11px, muted)
- Edit button (30x30, #EFF9F4 bg, green edit icon)
- Delete button (30x30, #FEF2F2 bg, red trash icon)

Add card: 1.5px dashed #C6E8D5, circle-plus icon,
"Add someone to your circle"

Empty state (no contacts at all):
- "Your circle is empty" title
- "Add the people who travel with you in spirit." subtitle
- Primary green button "Add your first contact"

### Bottom tab bar
Home | Routes | Circle (active, green underline) | Settings
Use useNavigation() for Home tab press → navigate('Home')

## Modals
Render each conditionally:
- AddContactModal when showAddModal=true
- EditContactModal when showEditModal=true and selectedContact != null
- DeleteContactSheet when showDeleteSheet=true and selectedContact != null

## Callbacks
On contact saved: re-fetch, show toast "[name] added to your circle"
  / subtitle "SMS sent · They know they're watching over you"
On contact updated: re-fetch, show toast "[name] updated"
On contact deleted: re-fetch, show toast "[name] removed from your circle"

## Rules
- TypeScript strict, no any
- StyleSheet.create() only
- useSafeAreaInsets() for header
