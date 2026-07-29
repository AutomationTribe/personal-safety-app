CREATE TABLE sos_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sos_event_id uuid NOT NULL REFERENCES sos_events(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES trusted_contacts(id) ON DELETE CASCADE,
  contact_name text NOT NULL,
  contact_phone text NOT NULL,
  is_platform_user boolean NOT NULL DEFAULT false,
  notified_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledgement_token uuid UNIQUE DEFAULT gen_random_uuid(),
  delivery_status text NOT NULL DEFAULT 'sent' -- 'sent' | 'delivered' | 'failed' | 'acknowledged'
);

ALTER TABLE sos_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner can read own SOS notifications"
  ON sos_notifications FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM sos_events
      WHERE sos_events.id = sos_notifications.sos_event_id
      AND sos_events.user_id = auth.uid()
    )
  );

-- Realtime so SOSDetailScreen updates live as contacts acknowledge.
ALTER PUBLICATION supabase_realtime ADD TABLE sos_notifications;

-- Per the STEP 1 spec ("if not already present") — currently unused since
-- acknowledgement is tracked per-contact via sos_notifications.acknowledgement_token,
-- not per-event. Kept nullable/unreferenced; see flows/backend/sos-manual.md.
ALTER TABLE sos_events ADD COLUMN IF NOT EXISTS acknowledgement_token uuid DEFAULT gen_random_uuid();
