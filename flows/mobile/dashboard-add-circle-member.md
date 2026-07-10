# Mobile Flow — Add a Circle Member

## Entry Points

| Entry | Param | Result |
|---|---|---|
| "Add a Circle Member" card on HomeScreen dashboard | `Circle: { openAddModal: true }` | CircleScreen opens, AddContactModal auto-opens |
| "+" button on CircleScreen header | none | AddContactModal opens |
| "Add someone to your circle" card on CircleScreen (when list has contacts) | none | AddContactModal opens |
| "Add your first contact" button (empty state) | none | AddContactModal opens |

---

## Navigation path (from dashboard)

1. User taps "Add a Circle Member" card on HomeScreen
2. `navigation.navigate('Circle', { openAddModal: true })`
3. CircleScreen mounts → `useEffect` reads route params → `setShowAddModal(true)`
4. AddContactModal slides up
5. User fills in name, phone, [email], selects relationship
6. Tap "Add to Circle" → contact saved to Supabase → fire-and-forget SMS via backend
7. AddContactModal closes → `MemberAddedModal` appears centred over CircleScreen
8. User taps "Done" → MemberAddedModal closes, CircleScreen list refreshed

---

## AddContactModal — Field Spec

| Field | Required | Validation |
|---|---|---|
| Full Name | Yes | Min 2 chars |
| Phone Number | Yes | Nigerian number; strip leading 0, prepend +234; must match `/^\+234[789]\d{9}$/` |
| Email | No | No server validation; passed as-is if non-empty |
| Relationship | Yes | One of: Sister, Brother, Mother, Father, Friend, Partner, Other |

### Phone normalisation
```
08012345678     → +2348012345678   ✓
2348012345678   → +2348012345678   ✓
+2348012345678  → +2348012345678   ✓
0801234567      → rejected (too short)
+447911123456   → rejected (not Nigerian)
```

---

## Error States

| Condition | UI |
|---|---|
| Name missing | Inline error below field: "Name is required." |
| Name < 2 chars | "Name must be at least 2 characters." |
| Phone missing | "Phone number is required." |
| Phone invalid | "Enter a valid Nigerian number (e.g. 08012345678)." |
| Relationship not selected | "Please select a relationship." |
| Supabase insert fails | Inline error below form: error.message from Supabase |
| contacts.length >= 10 | Do not open modal — show inline error in CircleScreen: "Your circle is full (10/10). Remove a member to add someone new." |

---

## Member Cap

- Maximum: 10 contacts per user (enforced in UI, not backend)
- Check before opening AddContactModal; if `contacts.length >= 10`, show cap error instead
- Cap error is inline below the "+" header button — does not block viewing the list

---

## Success Modal (MemberAddedModal)

Centred overlay modal, appears after AddContactModal closes.

| Element | Value |
|---|---|
| Overlay | Dark semi-transparent full-screen, `rgba(0,0,0,0.55)` |
| Card | White, radius 20, centred, width `screenWidth - 56` |
| Icon | Purple circle with white check-circle Feather icon, size 48, bg `#EDE9FE` |
| Title | "Member Added Successfully" |
| Body | "{contactName} has been invited to join your circle and will receive a notification shortly." |
| Button | Full-width "Done" button, bg `colors.brand.primary` |

---

## Empty State (CircleScreen)

Shown when `contacts.length === 0`.

- Icon: `users` Feather icon, inside green circle ring
- Title: "Your circle is empty"
- Subtitle: "Add people you trust to notify in an emergency."
- CTA button: "Add your first contact" → opens AddContactModal

---

## After Add — List Refresh

- `reload()` called inside `handleContactSaved` before showing MemberAddedModal
- List updates immediately; MemberAddedModal shows on top of updated list
- Realtime not required for this flow — pull-on-save is sufficient

---

## AsyncStorage / Cache

No AsyncStorage used in this flow. Contacts are always fetched from Supabase on mount and after each mutation.

---

## Design tokens used

- `colors.brand.primary` — CTA buttons, empty state icon
- `colors.brand.sos` — delete button
- `colors.brand.light` — avatar backgrounds
- `colors.white`, `colors.brand.bgSurface` — card, input backgrounds
- `spacing.*`, `fontSizes.*` from `tokens.ts`

---

## What is NOT in scope

- Push notifications to the added contact (SMS only)
- Email notifications
- Contact accepting/declining the invite
- Web dashboard contact management
