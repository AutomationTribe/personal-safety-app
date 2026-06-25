# Prompt: EditContactModal.tsx

## Read first
- CLAUDE.md
- mobile/src/styles/tokens.ts
- mobile/src/services/CircleService.ts
- mobile/src/screens/circle/AddContactModal.tsx

## Goal
Build mobile/src/screens/circle/EditContactModal.tsx

## Props
```typescript
interface Props {
  visible: boolean
  contact: TrustedContact | null
  onClose: () => void
  onUpdated: (contact: TrustedContact) => void
}
```

## Differences from AddContactModal
- Header: "Edit contact" title + green badge showing contact.name below
- All fields pre-filled via useEffect when contact prop changes
- Save button: "Save changes"
- No SMS note box
- On save: call CircleService.updateContact(contact.id, data)
  Success → onUpdated(updatedContact), onClose()
- No SMS sent on update

## Everything else
Identical structure to AddContactModal:
same fields, same chips, same validation, same keyboard handling.

## Rules
- TypeScript strict, no any
- StyleSheet.create() only
