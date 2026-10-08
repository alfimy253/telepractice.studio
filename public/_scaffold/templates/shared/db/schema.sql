-- SITE_ID scopes every row to one practice site in the Neon database.
-- The generated package targets one selected hosting runtime.
CREATE TABLE IF NOT EXISTS sites (
  site_id text PRIMARY KEY,
  config jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Fixed blog schema by design: no custom content types or arbitrary blocks.
CREATE TABLE IF NOT EXISTS blog_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id text NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,
  title varchar(140) NOT NULL,
  slug varchar(160) NOT NULL,
  excerpt varchar(260) NOT NULL DEFAULT '',
  body text NOT NULL,
  feature_image_url text NOT NULL,
  feature_image_alt varchar(180) NOT NULL,
  category varchar(60) NOT NULL DEFAULT 'Practice notes',
  status varchar(12) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, slug)
);
CREATE UNIQUE INDEX IF NOT EXISTS blog_posts_site_post_fk_idx ON blog_posts(site_id, id);
CREATE INDEX IF NOT EXISTS blog_posts_public_idx ON blog_posts(site_id, status, published_at DESC);

-- Idempotent migration for earlier Canopy schemas: existing posts get an original
-- local cover image, while all new post writes must supply a non-empty feature image.
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS feature_image_url text;
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS feature_image_alt varchar(180);
UPDATE blog_posts SET feature_image_url = '/images/blog-welcome.svg' WHERE feature_image_url IS NULL OR length(btrim(feature_image_url)) = 0;
UPDATE blog_posts SET feature_image_alt = 'Practice article feature image' WHERE feature_image_alt IS NULL OR length(btrim(feature_image_alt)) = 0;
ALTER TABLE blog_posts ALTER COLUMN feature_image_url SET NOT NULL;
ALTER TABLE blog_posts ALTER COLUMN feature_image_alt SET NOT NULL;
ALTER TABLE blog_posts ALTER COLUMN feature_image_url DROP DEFAULT;
ALTER TABLE blog_posts ALTER COLUMN feature_image_alt DROP DEFAULT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'blog_posts'::regclass AND conname = 'blog_posts_feature_image_nonempty') THEN
    ALTER TABLE blog_posts ADD CONSTRAINT blog_posts_feature_image_nonempty CHECK (length(btrim(feature_image_url)) > 0);
  END IF;
END $$;

-- Fixed-schema per-post image gallery. The first item by sort_order is the
-- featured hero image when the owner does not specify a separate feature image.
CREATE TABLE IF NOT EXISTS blog_post_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id text NOT NULL,
  post_id uuid NOT NULL,
  image_url text NOT NULL,
  alt_text varchar(180) NOT NULL,
  caption varchar(300) NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0 AND sort_order <= 11),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (site_id, post_id) REFERENCES blog_posts(site_id, id) ON DELETE CASCADE,
  UNIQUE (post_id, sort_order)
);
CREATE INDEX IF NOT EXISTS blog_post_images_order_idx ON blog_post_images(site_id, post_id, sort_order);

-- Fixed practice-wide gallery, separate from article-attached galleries.
CREATE TABLE IF NOT EXISTS gallery_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id text NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,
  title varchar(120) NOT NULL,
  image_url text NOT NULL DEFAULT '',
  alt_text varchar(180) NOT NULL DEFAULT '',
  caption varchar(300) NOT NULL DEFAULT '',
  category varchar(60) NOT NULL DEFAULT 'Practice life',
  status varchar(12) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0 AND sort_order <= 9999),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gallery_items_public_idx ON gallery_items(site_id, status, sort_order, created_at DESC);

-- Self-service client accounts. Passwords are stored only as salted PBKDF2 hashes;
-- raw session tokens are never written to the database.
CREATE TABLE IF NOT EXISTS client_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id text NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,
  full_name varchar(100) NOT NULL,
  email varchar(120) NOT NULL,
  phone varchar(30) NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, email)
);
CREATE INDEX IF NOT EXISTS client_accounts_site_idx ON client_accounts(site_id, created_at DESC);

CREATE TABLE IF NOT EXISTS client_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id text NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,
  client_account_id uuid NOT NULL REFERENCES client_accounts(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, token_hash)
);
CREATE INDEX IF NOT EXISTS client_sessions_expiry_idx ON client_sessions(site_id, expires_at);

-- Owner-published schedule for each upcoming month. Weekly rules generate the
-- normal slots; date exceptions replace a day's hours or close that date.
CREATE TABLE IF NOT EXISTS monthly_schedules (
  site_id text NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,
  month_start date NOT NULL CHECK (date_trunc('month', month_start)::date = month_start),
  weekly_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  exceptions jsonb NOT NULL DEFAULT '[]'::jsonb,
  status varchar(12) NOT NULL DEFAULT 'published' CHECK (status IN ('published')),
  published_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, month_start)
);

CREATE TABLE IF NOT EXISTS consultation_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id text NOT NULL,
  month_start date NOT NULL,
  slot_date date NOT NULL,
  slot_time time NOT NULL,
  is_open boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (site_id, month_start) REFERENCES monthly_schedules(site_id, month_start) ON DELETE CASCADE,
  CHECK (slot_date >= month_start AND slot_date < (month_start + interval '1 month')::date),
  UNIQUE (site_id, slot_date, slot_time)
);
CREATE INDEX IF NOT EXISTS consultation_slots_month_idx ON consultation_slots(site_id, month_start, slot_date, slot_time);

CREATE TABLE IF NOT EXISTS appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id text NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,
  client_account_id uuid,
  availability_slot_id uuid,
  name varchar(100) NOT NULL,
  email varchar(120) NOT NULL,
  phone varchar(30) NOT NULL,
  service varchar(120) NOT NULL,
  appointment_date date NOT NULL,
  appointment_time time NOT NULL,
  context varchar(100) NOT NULL DEFAULT '',
  status varchar(12) NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'confirmed', 'cancelled')),
  payment_method varchar(12) NOT NULL DEFAULT 'gcash' CHECK (payment_method IN ('gcash', 'maya')),
  payment_status varchar(20) NOT NULL DEFAULT 'approved' CHECK (payment_status IN ('awaiting_proof', 'pending_review', 'approved', 'rejected', 'expired')),
  payment_due_at timestamptz NOT NULL DEFAULT now(),
  payment_reminder_sent_at timestamptz,
  payment_owner_attention_at timestamptz,
  payment_manual_received_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Idempotent migration for existing appointment tables and their new account/slot relations.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS client_account_id uuid;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS availability_slot_id uuid;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS payment_method varchar(12) NOT NULL DEFAULT 'gcash' CHECK (payment_method IN ('gcash', 'maya'));
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS payment_status varchar(20) NOT NULL DEFAULT 'approved' CHECK (payment_status IN ('awaiting_proof', 'pending_review', 'approved', 'rejected', 'expired'));
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS payment_due_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS payment_reminder_sent_at timestamptz;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS payment_owner_attention_at timestamptz;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS payment_manual_received_at timestamptz;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'appointments'::regclass AND conname = 'appointments_client_account_fk') THEN
    ALTER TABLE appointments ADD CONSTRAINT appointments_client_account_fk FOREIGN KEY (client_account_id) REFERENCES client_accounts(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'appointments'::regclass AND conname = 'appointments_availability_slot_fk') THEN
    ALTER TABLE appointments ADD CONSTRAINT appointments_availability_slot_fk FOREIGN KEY (availability_slot_id) REFERENCES consultation_slots(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS appointments_slot_idx
  ON appointments(site_id, appointment_date, appointment_time)
  WHERE status <> 'cancelled';
CREATE UNIQUE INDEX IF NOT EXISTS appointments_availability_slot_idx
  ON appointments(site_id, availability_slot_id)
  WHERE availability_slot_id IS NOT NULL AND status <> 'cancelled';
CREATE INDEX IF NOT EXISTS appointments_client_idx ON appointments(site_id, client_account_id, appointment_date, appointment_time);
CREATE INDEX IF NOT EXISTS appointments_date_idx ON appointments(site_id, appointment_date, status);
CREATE INDEX IF NOT EXISTS appointments_payment_due_idx ON appointments(site_id, payment_status, payment_due_at) WHERE status <> 'cancelled';

-- Private proof images are stored as bounded base64 in Neon, never in public assets.
-- The owner-only API serves proof bytes after session authentication.
CREATE TABLE IF NOT EXISTS appointment_payment_proofs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id text NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  client_account_id uuid NOT NULL REFERENCES client_accounts(id) ON DELETE CASCADE,
  payment_method varchar(12) NOT NULL CHECK (payment_method IN ('gcash', 'maya')),
  image_mime_type varchar(20) NOT NULL CHECK (image_mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  image_base64 text NOT NULL CHECK (length(image_base64) BETWEEN 16 AND 4194304),
  review_status varchar(20) NOT NULL DEFAULT 'pending_review' CHECK (review_status IN ('pending_review', 'approved', 'rejected')),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  UNIQUE (site_id, appointment_id)
);
CREATE INDEX IF NOT EXISTS appointment_payment_proofs_status_idx ON appointment_payment_proofs(site_id, review_status, uploaded_at DESC);

-- One optional private owner-to-client note per consultation. The client API only
-- returns a note when the authenticated account owns that appointment.
CREATE TABLE IF NOT EXISTS consultation_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id text NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  client_account_id uuid NOT NULL REFERENCES client_accounts(id) ON DELETE CASCADE,
  note_body text NOT NULL CHECK (length(btrim(note_body)) > 0 AND length(note_body) <= 12000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, appointment_id)
);
CREATE INDEX IF NOT EXISTS consultation_notes_client_idx ON consultation_notes(site_id, client_account_id, updated_at DESC);
