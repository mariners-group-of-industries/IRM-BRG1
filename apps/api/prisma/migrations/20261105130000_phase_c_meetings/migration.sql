-- CreateEnum
CREATE TYPE "MeetingType" AS ENUM ('AGM', 'EGM');

-- CreateEnum
CREATE TYPE "MeetingMode" AS ENUM ('VIRTUAL', 'HYBRID');

-- CreateEnum
CREATE TYPE "MeetingState" AS ENUM ('DRAFT', 'SCHEDULED', 'REGISTRATION_OPEN', 'LIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ResolutionKind" AS ENUM ('ORDINARY', 'SPECIAL');

-- CreateEnum
CREATE TYPE "MeetingDocumentKind" AS ENUM ('NOTICE', 'ANNUAL_REPORT', 'FINANCIAL_STATEMENTS', 'PROXY_FORM', 'PRESENTATION', 'OTHER');

-- CreateEnum
CREATE TYPE "MeetingStaffRole" AS ENUM ('BOARD_MEMBER', 'MODERATOR');

-- CreateEnum
CREATE TYPE "MeetingParticipantStatus" AS ENUM ('REGISTERED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "FileKind" ADD VALUE 'MEETING_DOCUMENT';













-- AlterTable
ALTER TABLE "proxy_authorizations" ADD COLUMN     "meeting_id" UUID;

-- CreateTable
CREATE TABLE "meetings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "type" "MeetingType" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(2000),
    "notice_text" TEXT,
    "mode" "MeetingMode" NOT NULL DEFAULT 'VIRTUAL',
    "venue" VARCHAR(300),
    "scheduled_start" TIMESTAMPTZ(3) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Dhaka',
    "record_date" DATE NOT NULL,
    "state" "MeetingState" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "rules" JSONB NOT NULL,
    "published_at" TIMESTAMPTZ(3),
    "snapshot_taken_at" TIMESTAMPTZ(3),
    "started_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_state_transitions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "meeting_id" UUID NOT NULL,
    "from_state" "MeetingState",
    "to_state" "MeetingState" NOT NULL,
    "actor_user_id" UUID,
    "reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_state_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agenda_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "meeting_id" UUID NOT NULL,
    "number" VARCHAR(10) NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "description" VARCHAR(5000),
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "agenda_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resolutions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "agenda_item_id" UUID NOT NULL,
    "kind" "ResolutionKind" NOT NULL,
    "text" TEXT NOT NULL,
    "requires_proposal" BOOLEAN NOT NULL DEFAULT true,
    "requires_seconding" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "resolutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_documents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "meeting_id" UUID NOT NULL,
    "agenda_item_id" UUID,
    "kind" "MeetingDocumentKind" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "file_id" UUID NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "uploaded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMPTZ(3),

    CONSTRAINT "meeting_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_staff" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "meeting_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "MeetingStaffRole" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shareholding_snapshots" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "meeting_id" UUID NOT NULL,
    "shareholder_id" UUID NOT NULL,
    "identity_id" UUID NOT NULL,
    "share_class_id" UUID NOT NULL,
    "holding_id" UUID NOT NULL,
    "quantity" BIGINT NOT NULL,
    "votes_per_share" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shareholding_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voting_entitlements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "meeting_id" UUID NOT NULL,
    "snapshot_id" UUID NOT NULL,
    "shareholder_id" UUID NOT NULL,
    "identity_id" UUID NOT NULL,
    "weight" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voting_entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_participants" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "meeting_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "ParticipantKind" NOT NULL,
    "shareholder_id" UUID NOT NULL,
    "corporate_rep_id" UUID,
    "proxy_id" UUID,
    "entitlement_ids" UUID[],
    "status" "MeetingParticipantStatus" NOT NULL DEFAULT 'REGISTERED',
    "registered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_participants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meetings_company_id_scheduled_start_idx" ON "meetings"("company_id", "scheduled_start");

-- CreateIndex
CREATE INDEX "meeting_state_transitions_meeting_id_created_at_idx" ON "meeting_state_transitions"("meeting_id", "created_at");

-- CreateIndex
CREATE INDEX "agenda_items_meeting_id_position_idx" ON "agenda_items"("meeting_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "agenda_items_meeting_id_number_key" ON "agenda_items"("meeting_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "resolutions_agenda_item_id_key" ON "resolutions"("agenda_item_id");

-- CreateIndex
CREATE INDEX "meeting_documents_meeting_id_idx" ON "meeting_documents"("meeting_id");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_staff_meeting_id_user_id_role_key" ON "meeting_staff"("meeting_id", "user_id", "role");

-- CreateIndex
CREATE INDEX "shareholding_snapshots_meeting_id_shareholder_id_idx" ON "shareholding_snapshots"("meeting_id", "shareholder_id");

-- CreateIndex
CREATE UNIQUE INDEX "shareholding_snapshots_meeting_id_identity_id_share_class_i_key" ON "shareholding_snapshots"("meeting_id", "identity_id", "share_class_id");

-- CreateIndex
CREATE UNIQUE INDEX "voting_entitlements_snapshot_id_key" ON "voting_entitlements"("snapshot_id");

-- CreateIndex
CREATE INDEX "voting_entitlements_meeting_id_shareholder_id_idx" ON "voting_entitlements"("meeting_id", "shareholder_id");

-- CreateIndex
CREATE INDEX "meeting_participants_meeting_id_status_idx" ON "meeting_participants"("meeting_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_participants_meeting_id_user_id_kind_shareholder_id_key" ON "meeting_participants"("meeting_id", "user_id", "kind", "shareholder_id");

-- CreateIndex
CREATE INDEX "proxy_authorizations_meeting_id_idx" ON "proxy_authorizations"("meeting_id");

-- AddForeignKey
ALTER TABLE "proxy_authorizations" ADD CONSTRAINT "proxy_authorizations_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_state_transitions" ADD CONSTRAINT "meeting_state_transitions_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agenda_items" ADD CONSTRAINT "agenda_items_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolutions" ADD CONSTRAINT "resolutions_agenda_item_id_fkey" FOREIGN KEY ("agenda_item_id") REFERENCES "agenda_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_documents" ADD CONSTRAINT "meeting_documents_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_documents" ADD CONSTRAINT "meeting_documents_agenda_item_id_fkey" FOREIGN KEY ("agenda_item_id") REFERENCES "agenda_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_documents" ADD CONSTRAINT "meeting_documents_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "stored_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_staff" ADD CONSTRAINT "meeting_staff_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shareholding_snapshots" ADD CONSTRAINT "shareholding_snapshots_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voting_entitlements" ADD CONSTRAINT "voting_entitlements_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voting_entitlements" ADD CONSTRAINT "voting_entitlements_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "shareholding_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── Hand-written integrity rules (Phase C) ──────────────────────────────

-- Meetings belong to a company in the same tenant.
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_company_tenant_fkey" FOREIGN KEY ("company_id", "tenant_id") REFERENCES "companies"("id", "tenant_id") ON DELETE RESTRICT;
-- Composite key so every child row can be forced into the meeting's own company.
CREATE UNIQUE INDEX "meetings_id_company_key" ON "meetings" ("id", "company_id");

ALTER TABLE "meeting_state_transitions" ADD CONSTRAINT "meeting_state_transitions_meeting_company_fkey" FOREIGN KEY ("meeting_id", "company_id") REFERENCES "meetings"("id", "company_id") ON DELETE RESTRICT;
ALTER TABLE "agenda_items" ADD CONSTRAINT "agenda_items_meeting_company_fkey" FOREIGN KEY ("meeting_id", "company_id") REFERENCES "meetings"("id", "company_id") ON DELETE RESTRICT;
ALTER TABLE "meeting_documents" ADD CONSTRAINT "meeting_documents_meeting_company_fkey" FOREIGN KEY ("meeting_id", "company_id") REFERENCES "meetings"("id", "company_id") ON DELETE RESTRICT;
ALTER TABLE "meeting_staff" ADD CONSTRAINT "meeting_staff_meeting_company_fkey" FOREIGN KEY ("meeting_id", "company_id") REFERENCES "meetings"("id", "company_id") ON DELETE RESTRICT;
ALTER TABLE "shareholding_snapshots" ADD CONSTRAINT "shareholding_snapshots_meeting_company_fkey" FOREIGN KEY ("meeting_id", "company_id") REFERENCES "meetings"("id", "company_id") ON DELETE RESTRICT;
ALTER TABLE "voting_entitlements" ADD CONSTRAINT "voting_entitlements_meeting_company_fkey" FOREIGN KEY ("meeting_id", "company_id") REFERENCES "meetings"("id", "company_id") ON DELETE RESTRICT;
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_meeting_company_fkey" FOREIGN KEY ("meeting_id", "company_id") REFERENCES "meetings"("id", "company_id") ON DELETE RESTRICT;
ALTER TABLE "proxy_authorizations" ADD CONSTRAINT "proxy_authorizations_meeting_company_fkey" FOREIGN KEY ("meeting_id", "company_id") REFERENCES "meetings"("id", "company_id") ON DELETE RESTRICT;

-- Resolutions stay in their agenda item's company.
CREATE UNIQUE INDEX "agenda_items_id_company_key" ON "agenda_items" ("id", "company_id");
ALTER TABLE "resolutions" ADD CONSTRAINT "resolutions_agenda_company_fkey" FOREIGN KEY ("agenda_item_id", "company_id") REFERENCES "agenda_items"("id", "company_id") ON DELETE CASCADE;
ALTER TABLE "resolutions" ADD CONSTRAINT "resolutions_company_tenant_fkey" FOREIGN KEY ("company_id", "tenant_id") REFERENCES "companies"("id", "tenant_id") ON DELETE RESTRICT;

-- Value checks.
ALTER TABLE "shareholding_snapshots" ADD CONSTRAINT "shareholding_snapshots_quantity_check" CHECK ("quantity" > 0 AND "votes_per_share" >= 0);
ALTER TABLE "voting_entitlements" ADD CONSTRAINT "voting_entitlements_weight_check" CHECK ("weight" > 0);
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_version_check" CHECK ("version" >= 1);
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_hybrid_venue_check" CHECK ("mode" <> 'HYBRID' OR "venue" IS NOT NULL);
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_kind_check" CHECK (
  ("kind" = 'SHAREHOLDER' AND "corporate_rep_id" IS NULL AND "proxy_id" IS NULL) OR
  ("kind" = 'CORPORATE_REPRESENTATIVE' AND "corporate_rep_id" IS NOT NULL AND "proxy_id" IS NULL) OR
  ("kind" = 'PROXY_REPRESENTATIVE' AND "proxy_id" IS NOT NULL AND "corporate_rep_id" IS NULL)
);

-- Immutable records: state history, record-date snapshots and entitlements.
CREATE OR REPLACE FUNCTION irm_immutable_row() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is immutable (% blocked)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "meeting_state_transitions_immutable" BEFORE UPDATE OR DELETE ON "meeting_state_transitions" FOR EACH ROW EXECUTE FUNCTION irm_immutable_row();
CREATE TRIGGER "shareholding_snapshots_immutable" BEFORE UPDATE OR DELETE ON "shareholding_snapshots" FOR EACH ROW EXECUTE FUNCTION irm_immutable_row();
CREATE TRIGGER "voting_entitlements_immutable" BEFORE UPDATE OR DELETE ON "voting_entitlements" FOR EACH ROW EXECUTE FUNCTION irm_immutable_row();

-- ─── Row-level security for the new company-owned tables ─────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO irm_app;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'meetings', 'meeting_state_transitions', 'agenda_items', 'resolutions', 'meeting_documents',
    'meeting_staff', 'shareholding_snapshots', 'voting_entitlements', 'meeting_participants'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO irm_app USING (company_id = ANY (irm_company_ids())) WITH CHECK (company_id = ANY (irm_company_ids()))',
      t || '_company_isolation', t
    );
  END LOOP;
END $$;
