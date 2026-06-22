Write the following content exactly into screens/auth/signup.md:

# Screen: Sign up

## Route
/auth/signup

## Purpose
New traveller creates an account before starting any trip.

## Layout (top to bottom)
1. Status bar — light content on primary colour background
2. Top section — primary colour background, 120px tall
   - App name "SafeTrack" centred, 28px bold, white
   - Tagline "Your safety companion" centred, 14px, white 70% opacity
3. Form card — surface colour, 24px margin horizontal, 
   -20px overlap with top section (pulls card up over header)
   - Card padding 24px
   - Heading: "Create account" 22px bold text primary
   - Gap 20px
   - Input: Full name (person icon left)
   - Input: Phone number, placeholder "+234 800 000 0000" (phone icon left)
   - Input: Password (lock icon left, eye icon right for show/hide)
   - Input: Confirm password (lock icon left, eye icon right)
   - Gap 8px
   - Inline error text if validation fails — danger colour 13px
   - Gap 20px
   - Primary button: "Create account" — disabled until all fields valid
   - Gap 16px
   - Divider line with "or" centred
   - Gap 16px
4. Bottom — centred text "Already have an account?"
   with "Log in" in primary colour, tappable

## Validation rules
- Full name: required, minimum 2 characters
- Phone: required, must match +234 followed by 10 digits
- Password: required, minimum 8 characters
- Confirm password: must match password exactly
- Button only becomes active when ALL fields pass validation

## States
- Default: all inputs empty, button disabled (50% opacity)
- Typing: real-time validation, show error only after field is blurred
- Loading: button replaced with spinner, all inputs disabled
- Error from server: show toast at top of screen in danger colour
- Success: navigate to /trip/home with user session stored

## Navigation
- Success → /trip/home
- "Log in" link → /auth/login

## Notes
- Keyboard aware — form scrolls up when keyboard opens
- Use SecureTextEntry for both password fields
- Phone field opens numeric keyboard
- All colours and spacing from _design-system.md only
- Icons from @expo/vector-icons Feather set