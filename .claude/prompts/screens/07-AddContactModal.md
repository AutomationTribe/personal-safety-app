# Prompt: AddContactModal.tsx

## Read first
- CLAUDE.md
- mobile/src/styles/tokens.ts
- mobile/src/services/CircleService.ts

## Goal
Build mobile/src/screens/circle/AddContactModal.tsx

## Props
```typescript
interface Props {
  visible: boolean
  onClose: () => void
  onSaved: (contact: TrustedContact) => void
}
```

## State
name, phone, email, relationship: string
errors: { name?: string; phone?: string; relationship?: string }
saving: boolean

## Visual
- React Native Modal, animationType="slide", transparent=true
- Overlay: rgba(0,0,0,0.45)
- Sheet: white, radius 24px 24px 0 0
- Handle: 36px wide, 3px tall, rgba(0,0,0,0.1), centered, mt 12
- Header: "Add to your circle" (17px, 800) + X close button

## Fields
Name (required *): text input
Phone (required *): phone keyboard
  - Auto-format via CircleService.formatNigerianPhone() on blur
  - Green check icon when valid Nigerian number
Email (optional): email keyboard, label shows "(optional)" in grey
Relationship (required *): chip selector
  Chips: Sister | Brother | Mother | Father | Friend | Partner | Other
  Selected: #1A6B4A bg, white text
  Unselected: #F4F3EF bg, #8F8D85 text

## SMS note box
- #EFF9F4 bg, 0.5px #C6E8D5 border, radius 10
- "[name] will receive an SMS letting them know they've been
  added to your Hadin circle."
- Updates dynamically as name field changes
- If name empty: "They will receive an SMS..."

## Validation on save
- name: required, min 2 chars
- phone: required, valid Nigerian E.164
- relationship: required, must have chip selected
- Show inline error in red below each invalid field

## Save button
Text: "Save contact"
Loading spinner when saving=true
Disabled when saving=true
On press: call CircleService.addContact()
  Success → onSaved(newContact), onClose(), reset form
  Error → show error below button, keep modal open

## Rules
- KeyboardAvoidingView for iOS
- Modal animationType="slide" transparent=true
- TypeScript strict, no any
- StyleSheet.create() only
