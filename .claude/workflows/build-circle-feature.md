# Workflow: Build Circle Feature

## Agent sequence
Run these agents in order. Each must complete before next starts.

### Step 1 — Database Engineer
Prompt: .claude/prompts/migrations/06-trusted-contacts.md
Verify: trusted_contacts table exists in Supabase with RLS

### Step 2 — Mobile Engineer  
Prompts (in order):
  .claude/prompts/services/04-CircleService.md
  .claude/prompts/screens/05-SuccessToast.md
  .claude/prompts/screens/06-CircleScreen.md
  .claude/prompts/screens/07-AddContactModal.md
  .claude/prompts/screens/08-EditContactModal.md
  .claude/prompts/screens/09-DeleteContactSheet.md

### Step 3 — Backend Engineer
Prompt: .claude/prompts/backend/01-contacts-notify-route.md
Verify: POST /api/v1/contacts/notify returns 200

### Step 4 — QA Engineer
Write unit tests for CircleService.ts
Write manual test for add-contact SMS delivery
Write integration test for full add contact flow

### Completion checklist
- [ ] trusted_contacts table exists with RLS
- [ ] CircleService.ts all 7 functions working
- [ ] Add contact saves to Supabase
- [ ] SMS sent via Africa's Talking on add
- [ ] Edit updates Supabase record
- [ ] Delete removes record
- [ ] Search filters locally
- [ ] SuccessToast animates correctly
- [ ] TypeScript zero errors across all new files
