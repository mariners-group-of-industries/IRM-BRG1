-- CreateEnum
CREATE TYPE "UserKind" AS ENUM ('STAFF', 'PARTICIPANT');

-- CreateEnum
CREATE TYPE "HolderType" AS ENUM ('INDIVIDUAL', 'CORPORATE');

-- CreateEnum
CREATE TYPE "ShareholderStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "IdentityKind" AS ENUM ('BO', 'FOLIO');

-- CreateEnum
CREATE TYPE "ContactKind" AS ENUM ('PHONE', 'EMAIL');

-- CreateEnum
CREATE TYPE "ContactSource" AS ENUM ('REGISTER', 'MANUAL');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('UPLOADED', 'VALIDATED', 'COMMITTED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "ImportMode" AS ENUM ('FULL', 'DELTA');

-- CreateEnum
CREATE TYPE "ImportRowStatus" AS ENUM ('VALID', 'ERROR');

-- CreateEnum
CREATE TYPE "ImportRowAction" AS ENUM ('NEW', 'CHANGED', 'UNCHANGED', 'CLOSED', 'NONE');

-- CreateEnum
CREATE TYPE "FileKind" AS ENUM ('REGISTER_IMPORT', 'AUTHORIZATION_DOCUMENT');

-- CreateEnum
CREATE TYPE "AuthorizationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'REVOKED');

-- CreateEnum
CREATE TYPE "ProxyScope" AS ENUM ('ATTEND', 'ATTEND_AND_VOTE');

-- CreateEnum
CREATE TYPE "ParticipantKind" AS ENUM ('SHAREHOLDER', 'CORPORATE_REPRESENTATIVE', 'PROXY_REPRESENTATIVE');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('PARTICIPANT_LOGIN', 'MFA_LOGIN');


-- AlterTable
ALTER TABLE "users" ADD COLUMN     "kind" "UserKind" NOT NULL DEFAULT 'STAFF',
ADD COLUMN     "mfa_last_step" INTEGER,
ADD COLUMN     "mfa_recovery_hashes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "mfa_secret_enc" TEXT,
ADD COLUMN     "phone" VARCHAR(20),
ALTER COLUMN "email" DROP NOT NULL;

-- CreateTable
CREATE TABLE "share_classes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" VARCHAR(12) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "votes_per_share" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "share_classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shareholders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "type" "HolderType" NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "name_bn" VARCHAR(200),
    "status" "ShareholderStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shareholders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shareholder_identities" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "shareholder_id" UUID NOT NULL,
    "kind" "IdentityKind" NOT NULL,
    "value" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shareholder_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shareholder_contacts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "shareholder_id" UUID NOT NULL,
    "kind" "ContactKind" NOT NULL,
    "value" VARCHAR(254) NOT NULL,
    "source" "ContactSource" NOT NULL,
    "verified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retired_at" TIMESTAMPTZ(3),

    CONSTRAINT "shareholder_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shareholdings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "identity_id" UUID NOT NULL,
    "share_class_id" UUID NOT NULL,
    "quantity" BIGINT NOT NULL,
    "as_of_date" DATE NOT NULL,
    "valid_from" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to" TIMESTAMPTZ(3),
    "import_id" UUID,

    CONSTRAINT "shareholdings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "register_imports" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'UPLOADED',
    "mode" "ImportMode",
    "as_of_date" DATE,
    "headers" TEXT[],
    "mapping" JSONB,
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "valid_rows" INTEGER NOT NULL DEFAULT 0,
    "error_rows" INTEGER NOT NULL DEFAULT 0,
    "summary" JSONB,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validated_at" TIMESTAMPTZ(3),
    "committed_by_id" UUID,
    "committed_at" TIMESTAMPTZ(3),
    "failure_message" VARCHAR(500),

    CONSTRAINT "register_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "register_import_rows" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "import_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "raw" JSONB NOT NULL,
    "normalized" JSONB,
    "status" "ImportRowStatus" NOT NULL,
    "action" "ImportRowAction" NOT NULL DEFAULT 'NONE',
    "errors" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "register_import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stored_files" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "kind" "FileKind" NOT NULL,
    "storage_key" VARCHAR(200) NOT NULL,
    "original_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "uploaded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stored_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "corporate_representatives" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "shareholder_id" UUID NOT NULL,
    "full_name" VARCHAR(160) NOT NULL,
    "designation" VARCHAR(120),
    "email" VARCHAR(254) NOT NULL,
    "phone" VARCHAR(20),
    "identity_ids" UUID[],
    "valid_from" DATE NOT NULL,
    "valid_until" DATE NOT NULL,
    "status" "AuthorizationStatus" NOT NULL DEFAULT 'PENDING',
    "document_id" UUID,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "decision_note" VARCHAR(500),

    CONSTRAINT "corporate_representatives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proxy_authorizations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "grantor_shareholder_id" UUID NOT NULL,
    "full_name" VARCHAR(160) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "phone" VARCHAR(20),
    "scope" "ProxyScope" NOT NULL,
    "meeting_reference" VARCHAR(160) NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_until" DATE NOT NULL,
    "status" "AuthorizationStatus" NOT NULL DEFAULT 'PENDING',
    "document_id" UUID,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "decision_note" VARCHAR(500),

    CONSTRAINT "proxy_authorizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participant_links" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "ParticipantKind" NOT NULL,
    "shareholder_id" UUID,
    "corporate_rep_id" UUID,
    "proxy_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "participant_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_challenges" (
    "id" UUID NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "secret_hash" VARCHAR(64) NOT NULL,
    "subject" JSONB NOT NULL,
    "user_id" UUID,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "ip_address" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dev_outbox_messages" (
    "id" UUID NOT NULL,
    "channel" "ContactKind" NOT NULL,
    "recipient" VARCHAR(254) NOT NULL,
    "subject" VARCHAR(200) NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dev_outbox_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "share_classes_company_id_code_key" ON "share_classes"("company_id", "code");

-- CreateIndex
CREATE INDEX "shareholders_company_id_name_idx" ON "shareholders"("company_id", "name");

-- CreateIndex
CREATE INDEX "shareholder_identities_shareholder_id_idx" ON "shareholder_identities"("shareholder_id");

-- CreateIndex
CREATE UNIQUE INDEX "shareholder_identities_company_id_kind_value_key" ON "shareholder_identities"("company_id", "kind", "value");

-- CreateIndex
CREATE INDEX "shareholder_contacts_shareholder_id_idx" ON "shareholder_contacts"("shareholder_id");

-- CreateIndex
CREATE INDEX "shareholdings_company_id_valid_to_idx" ON "shareholdings"("company_id", "valid_to");

-- CreateIndex
CREATE INDEX "shareholdings_identity_id_idx" ON "shareholdings"("identity_id");

-- CreateIndex
CREATE INDEX "register_imports_company_id_created_at_idx" ON "register_imports"("company_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "register_import_rows_import_id_status_idx" ON "register_import_rows"("import_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "register_import_rows_import_id_row_number_key" ON "register_import_rows"("import_id", "row_number");

-- CreateIndex
CREATE UNIQUE INDEX "stored_files_storage_key_key" ON "stored_files"("storage_key");

-- CreateIndex
CREATE INDEX "corporate_representatives_company_id_email_idx" ON "corporate_representatives"("company_id", "email");

-- CreateIndex
CREATE INDEX "proxy_authorizations_company_id_email_idx" ON "proxy_authorizations"("company_id", "email");

-- CreateIndex
CREATE INDEX "participant_links_user_id_idx" ON "participant_links"("user_id");

-- CreateIndex
CREATE INDEX "participant_links_company_id_idx" ON "participant_links"("company_id");

-- CreateIndex
CREATE INDEX "otp_challenges_expires_at_idx" ON "otp_challenges"("expires_at");

-- CreateIndex
CREATE INDEX "dev_outbox_messages_created_at_idx" ON "dev_outbox_messages"("created_at" DESC);

-- AddForeignKey
ALTER TABLE "shareholder_identities" ADD CONSTRAINT "shareholder_identities_shareholder_id_fkey" FOREIGN KEY ("shareholder_id") REFERENCES "shareholders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shareholder_contacts" ADD CONSTRAINT "shareholder_contacts_shareholder_id_fkey" FOREIGN KEY ("shareholder_id") REFERENCES "shareholders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shareholdings" ADD CONSTRAINT "shareholdings_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "shareholder_identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shareholdings" ADD CONSTRAINT "shareholdings_share_class_id_fkey" FOREIGN KEY ("share_class_id") REFERENCES "share_classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shareholdings" ADD CONSTRAINT "shareholdings_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "register_imports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "register_imports" ADD CONSTRAINT "register_imports_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "stored_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "register_import_rows" ADD CONSTRAINT "register_import_rows_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "register_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corporate_representatives" ADD CONSTRAINT "corporate_representatives_shareholder_id_fkey" FOREIGN KEY ("shareholder_id") REFERENCES "shareholders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corporate_representatives" ADD CONSTRAINT "corporate_representatives_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "stored_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proxy_authorizations" ADD CONSTRAINT "proxy_authorizations_grantor_shareholder_id_fkey" FOREIGN KEY ("grantor_shareholder_id") REFERENCES "shareholders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proxy_authorizations" ADD CONSTRAINT "proxy_authorizations_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "stored_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_links" ADD CONSTRAINT "participant_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_links" ADD CONSTRAINT "participant_links_shareholder_id_fkey" FOREIGN KEY ("shareholder_id") REFERENCES "shareholders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── Hand-written integrity rules (not expressible in the Prisma schema) ───

-- Staff accounts must have an email; participants may sign in by phone only.
ALTER TABLE "users" ADD CONSTRAINT "users_staff_email_check" CHECK ("kind" <> 'STAFF' OR "email" IS NOT NULL);

-- Every company-owned row must agree with its company's tenant.
ALTER TABLE "share_classes" ADD CONSTRAINT "share_classes_company_tenant_fkey" FOREIGN KEY ("company_id", "tenant_id") REFERENCES "companies"("id", "tenant_id") ON DELETE RESTRICT;
ALTER TABLE "shareholders" ADD CONSTRAINT "shareholders_company_tenant_fkey" FOREIGN KEY ("company_id", "tenant_id") REFERENCES "companies"("id", "tenant_id") ON DELETE RESTRICT;
ALTER TABLE "shareholder_identities" ADD CONSTRAINT "shareholder_identities_company_tenant_fkey" FOREIGN KEY ("company_id", "tenant_id") REFERENCES "companies"("id", "tenant_id") ON DELETE RESTRICT;
ALTER TABLE "shareholder_contacts" ADD CONSTRAINT "shareholder_contacts_company_tenant_fkey" FOREIGN KEY ("company_id", "tenant_id") REFERENCES "companies"("id", "tenant_id") ON DELETE RESTRICT;
ALTER TABLE "shareholdings" ADD CONSTRAINT "shareholdings_company_tenant_fkey" FOREIGN KEY ("company_id", "tenant_id") REFERENCES "companies"("id", "tenant_id") ON DELETE RESTRICT;
ALTER TABLE "register_imports" ADD CONSTRAINT "register_imports_company_tenant_fkey" FOREIGN KEY ("company_id", "tenant_id") REFERENCES "companies"("id", "tenant_id") ON DELETE RESTRICT;
ALTER TABLE "register_import_rows" ADD CONSTRAINT "register_import_rows_company_tenant_fkey" FOREIGN KEY ("company_id", "tenant_id") REFERENCES "companies"("id", "tenant_id") ON DELETE RESTRICT;
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_company_tenant_fkey" FOREIGN KEY ("company_id", "tenant_id") REFERENCES "companies"("id", "tenant_id") ON DELETE RESTRICT;
ALTER TABLE "corporate_representatives" ADD CONSTRAINT "corporate_representatives_company_tenant_fkey" FOREIGN KEY ("company_id", "tenant_id") REFERENCES "companies"("id", "tenant_id") ON DELETE RESTRICT;
ALTER TABLE "proxy_authorizations" ADD CONSTRAINT "proxy_authorizations_company_tenant_fkey" FOREIGN KEY ("company_id", "tenant_id") REFERENCES "companies"("id", "tenant_id") ON DELETE RESTRICT;
ALTER TABLE "participant_links" ADD CONSTRAINT "participant_links_company_tenant_fkey" FOREIGN KEY ("company_id", "tenant_id") REFERENCES "companies"("id", "tenant_id") ON DELETE RESTRICT;

-- Holdings: never negative; at most one current row per (identity, share class).
ALTER TABLE "shareholdings" ADD CONSTRAINT "shareholdings_quantity_check" CHECK ("quantity" >= 0);
CREATE UNIQUE INDEX "shareholdings_current_unique" ON "shareholdings" ("identity_id", "share_class_id") WHERE "valid_to" IS NULL;
ALTER TABLE "share_classes" ADD CONSTRAINT "share_classes_votes_check" CHECK ("votes_per_share" >= 0);

-- One active copy of each contact per shareholder.
CREATE UNIQUE INDEX "shareholder_contacts_active_unique" ON "shareholder_contacts" ("shareholder_id", "kind", "value") WHERE "retired_at" IS NULL;

-- Authorization date ranges must be valid.
ALTER TABLE "corporate_representatives" ADD CONSTRAINT "corporate_representatives_dates_check" CHECK ("valid_until" >= "valid_from");
ALTER TABLE "proxy_authorizations" ADD CONSTRAINT "proxy_authorizations_dates_check" CHECK ("valid_until" >= "valid_from");

-- Participant links: exactly the reference that matches the kind, and no duplicates.
ALTER TABLE "participant_links" ADD CONSTRAINT "participant_links_kind_check" CHECK (
  ("kind" = 'SHAREHOLDER' AND "shareholder_id" IS NOT NULL AND "corporate_rep_id" IS NULL AND "proxy_id" IS NULL) OR
  ("kind" = 'CORPORATE_REPRESENTATIVE' AND "corporate_rep_id" IS NOT NULL AND "proxy_id" IS NULL) OR
  ("kind" = 'PROXY_REPRESENTATIVE' AND "proxy_id" IS NOT NULL AND "corporate_rep_id" IS NULL)
);
CREATE UNIQUE INDEX "participant_links_shareholder_unique" ON "participant_links" ("company_id", "shareholder_id") WHERE "kind" = 'SHAREHOLDER';
CREATE UNIQUE INDEX "participant_links_rep_unique" ON "participant_links" ("user_id", "corporate_rep_id") WHERE "corporate_rep_id" IS NOT NULL;
CREATE UNIQUE INDEX "participant_links_proxy_unique" ON "participant_links" ("user_id", "proxy_id") WHERE "proxy_id" IS NOT NULL;

-- Holdings history is immutable: the only permitted change is closing a current row.
CREATE OR REPLACE FUNCTION irm_shareholdings_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'shareholdings history cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD."valid_to" IS NOT NULL
     OR NEW."valid_to" IS NULL
     OR NEW."quantity" <> OLD."quantity"
     OR NEW."identity_id" <> OLD."identity_id"
     OR NEW."share_class_id" <> OLD."share_class_id"
     OR NEW."as_of_date" <> OLD."as_of_date"
     OR NEW."valid_from" <> OLD."valid_from"
     OR NEW."company_id" <> OLD."company_id"
     OR NEW."tenant_id" <> OLD."tenant_id" THEN
    RAISE EXCEPTION 'shareholdings rows can only be closed, not modified' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "shareholdings_guard" BEFORE UPDATE OR DELETE ON "shareholdings"
  FOR EACH ROW EXECUTE FUNCTION irm_shareholdings_guard();

-- ─── Row-level security ─────────────────────────────────────────────────
-- The API runs company-scoped work inside a transaction that switches to the
-- restricted role irm_app and sets app.company_ids. Under that role, these
-- policies hide every row outside the listed companies, even for hand-written SQL.
-- With no app.company_ids set, no rows are visible (deny by default).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'irm_app') THEN
    CREATE ROLE irm_app NOLOGIN NOINHERIT;
  END IF;
END $$;

-- The migrating role must be a member to SET ROLE irm_app at runtime.
DO $$
BEGIN
  EXECUTE format('GRANT irm_app TO %I', current_user);
EXCEPTION WHEN others THEN NULL;
END $$;

GRANT USAGE ON SCHEMA public TO irm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO irm_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO irm_app;

CREATE OR REPLACE FUNCTION irm_company_ids() RETURNS uuid[] AS $$
  SELECT CASE
    WHEN coalesce(current_setting('app.company_ids', true), '') = '' THEN ARRAY[]::uuid[]
    ELSE string_to_array(current_setting('app.company_ids', true), ',')::uuid[]
  END
$$ LANGUAGE sql STABLE;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'share_classes', 'shareholders', 'shareholder_identities', 'shareholder_contacts', 'shareholdings',
    'register_imports', 'register_import_rows', 'stored_files', 'corporate_representatives',
    'proxy_authorizations', 'participant_links'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO irm_app USING (company_id = ANY (irm_company_ids())) WITH CHECK (company_id = ANY (irm_company_ids()))',
      t || '_company_isolation', t
    );
  END LOOP;
END $$;
