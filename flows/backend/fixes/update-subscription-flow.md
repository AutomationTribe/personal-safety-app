# Fix: Update Subscription Flow — Backend

## Backend changes
None. All three endpoints (`/init`, `/verify`, `/webhook`, `/trial/start`) remain unchanged.

The fix is entirely in the mobile layer — the payment method selection interface
(Paystack's WebView checkout) now opens automatically instead of requiring an
extra button tap.

## No environment variable changes needed.
## No SQL migrations needed.
## No backend restart needed for this fix.
