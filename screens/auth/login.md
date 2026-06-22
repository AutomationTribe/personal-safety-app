Write the following content exactly into screens/auth/login.md:

# Screen: Login

## Route
/auth/login

## Purpose
Returning traveller signs in to resume tracking.

## Layout (top to bottom)
1. Same top section as signup — primary colour, app name and tagline
2. Form card — same overlap style as signup
   - Heading: "Welcome back" 22px bold text primary
   - Subtext: "Sign in to continue" text secondary 14px
   - Gap 20px
   - Input: Phone number (phone icon left)
   - Input: Password (lock icon left, eye icon right)
   - Gap 8px
   - "Forgot password?" right-aligned, primary colour, 13px
   - Gap 24px
   - Primary button: "Sign in"
   - Gap 16px
   - Divider with "or"
   - Gap 16px
3. Bottom — "Don't have an account?" with "Sign up" in primary colour

## States
- Default: inputs empty, button active (login has no pre-validation)
- Loading: spinner, inputs disabled
- Error: "Incorrect phone number or password" inline below password field
- Success: navigate to /trip/home

## Navigation
- Success → /trip/home
- "Sign up" link → /auth/signup
- "Forgot password?" → not built yet, show "Coming soon" toast

## Notes
- Same keyboard aware behaviour as signup
- Remember last used phone number in AsyncStorage
- Auto-focus phone input on mount
- All colours and spacing from _design-system.md only