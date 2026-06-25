# Prompt: DeleteContactSheet.tsx

## Read first
- CLAUDE.md
- mobile/src/styles/tokens.ts
- mobile/src/services/CircleService.ts

## Goal
Build mobile/src/screens/circle/DeleteContactSheet.tsx

## Props
```typescript
interface Props {
  visible: boolean
  contact: TrustedContact | null
  onClose: () => void
  onDeleted: (contactId: string) => void
}
```

## State
deleting: boolean

## Visual
- Modal, animationType="slide", transparent=true
- Overlay: rgba(0,0,0,0.5)
- Sheet: white, radius 24px 24px 0 0
- Handle at top
- Icon: 52px circle, #FEF2F2 bg, Feather 'user-minus' icon,
  #C0392B color, 24px — centered, mt 24
- Title centered: "Remove from circle?" (17px, 800)
- Body centered: "[contact.name] will no longer be notified
  when you travel. They won't receive SOS alerts."
  (12px, #8F8D85, line-height 1.6)
- Contact preview card: #F4F3EF bg, radius 12, padding 12x14
  Avatar initials + name + relationship · masked phone
- Two buttons side by side:
    Left "Keep them": #F4F3EF bg, #8F8D85 text → calls onClose()
    Right "Remove": #C0392B bg, white text → confirms delete

## On Remove press
- Set deleting=true
- Call CircleService.deleteContact(contact.id)
- Success → onDeleted(contact.id), onClose()
- Error → show error text above buttons, set deleting=false
- Show loading spinner on Remove button when deleting=true

## Critical UX note
"Keep them" is intentionally the positive/safe framing.
Never change this copy — it reduces accidental deletions.

## Rules
- TypeScript strict, no any
- StyleSheet.create() only
