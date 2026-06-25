# Prompt: SuccessToast.tsx

## Read first
- mobile/src/styles/tokens.ts

## Goal
Build mobile/src/components/SuccessToast.tsx

## Props
```typescript
interface Props {
  visible: boolean
  title: string
  subtitle?: string
  onHide?: () => void
  duration?: number  // default 3000ms
}
```

## Behaviour
- visible true → slide in from top + fade in, 300ms
- Auto-dismiss after duration ms
- On dismiss → slide out upward + fade out, 250ms
- Call onHide() after exit animation completes
- visible false externally → triggers exit animation

## Visual
- Position: absolute, top: insets.top + 12, left: 14, right: 14
- Background: #1A1A1A, border-radius: 14px, padding: 12px 14px
- Left: 38px circle, #1D9E75 bg, white ti-check icon (use
  @expo/vector-icons Feather 'check' icon)
- Title: 13px, weight 600, white
- Subtitle: 11px, rgba(255,255,255,0.55)
- Animated.Value for translateY (-80 → 0) and opacity (0 → 1)
- useSafeAreaInsets() for top position

## Rules
- Default export
- TypeScript strict, no any
- StyleSheet.create() only
