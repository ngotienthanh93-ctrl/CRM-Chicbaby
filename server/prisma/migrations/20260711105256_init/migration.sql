-- CreateEnum
CREATE TYPE "RoleKey" AS ENUM ('chu_shop', 'crm_officer', 'cskh', 'marketing', 'tro_ly_du_lieu');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'disabled');

-- CreateEnum
CREATE TYPE "CustomerRoleType" AS ENUM ('retail_customer', 'wholesale_contact');

-- CreateEnum
CREATE TYPE "CustomerRoleSource" AS ENUM ('auto_from_kv', 'manual');

-- CreateEnum
CREATE TYPE "PreferredChannel" AS ENUM ('zalo', 'call', 'sms');

-- CreateEnum
CREATE TYPE "RetentionStatus" AS ENUM ('active', 'masked');

-- CreateEnum
CREATE TYPE "PhoneType" AS ENUM ('primary', 'zalo', 'receiver', 'backup');

-- CreateEnum
CREATE TYPE "DataSource" AS ENUM ('KV', 'CRM');

-- CreateEnum
CREATE TYPE "SourceSystem" AS ENUM ('kiotviet');

-- CreateEnum
CREATE TYPE "LinkMethod" AS ENUM ('auto', 'manual');

-- CreateEnum
CREATE TYPE "DatePrecision" AS ENUM ('exact', 'month_estimated');

-- CreateEnum
CREATE TYPE "InfoSource" AS ENUM ('me_ke', 'bac_si_chan_doan', 'nhan_vien_quan_sat');

-- CreateEnum
CREATE TYPE "BabyAssignmentMode" AS ENUM ('baby_specific', 'multi_audience', 'not_baby_applicable');

-- CreateEnum
CREATE TYPE "ConfidenceLevel" AS ENUM ('high', 'medium', 'low');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('auto_assigned', 'suggested', 'confirmed', 'customer_level', 'not_applicable');

-- CreateEnum
CREATE TYPE "AssignmentSource" AS ENUM ('auto_single_baby', 'auto_age_match', 'manual', 'unassigned');

-- CreateEnum
CREATE TYPE "OrgStatus" AS ENUM ('active', 'slow', 'at_risk', 'paused', 'lost', 'collecting');

-- CreateEnum
CREATE TYPE "DeclineReason" AS ENUM ('gia_cao', 'doi_thu_chao_gia', 'hang_ban_cham', 'shop_het_hang', 'giao_hang_cham', 'cong_no', 'dai_ly_dong_cua', 'khong_lien_he_duoc', 'khac');

-- CreateEnum
CREATE TYPE "ReasonStatus" AS ENUM ('unknown', 'investigating', 'confirmed', 'cannot_contact');

-- CreateEnum
CREATE TYPE "EscalationLevel" AS ENUM ('L1', 'L2', 'L3', 'L4', 'L5');

-- CreateEnum
CREATE TYPE "OrgContactRole" AS ENUM ('chu_shop', 'nguoi_dat_hang', 'ke_toan', 'nguoi_nhan_hang');

-- CreateEnum
CREATE TYPE "FollowUpTargetType" AS ENUM ('customer', 'organization');

-- CreateEnum
CREATE TYPE "ReminderType" AS ENUM ('consumption', 'replenishment', 'consultation_followup', 'agency_investigation');

-- CreateEnum
CREATE TYPE "FollowUpStatus" AS ENUM ('cho_toi_han', 'den_han', 'da_lien_he', 'hen_lai', 'da_mua_lai', 'dong');

-- CreateEnum
CREATE TYPE "CloseReason" AS ENUM ('khong_dung_nua', 'doi_sp', 'mua_noi_khac', 'khong_phan_hoi', 'be_da_lon', 'khac');

-- CreateEnum
CREATE TYPE "FrequencyCapScope" AS ENUM ('proactive_sales_contact', 'marketing_contact', 'service_contact');

-- CreateEnum
CREATE TYPE "ClaimState" AS ENUM ('unclaimed', 'claimed', 'in_progress', 'completed', 'released');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('pending', 'verified', 'not_found');

-- CreateEnum
CREATE TYPE "AttributionStatus" AS ENUM ('attributed', 'not_attributed');

-- CreateEnum
CREATE TYPE "CustomerReport" AS ENUM ('already_purchased', 'intends_to_purchase');

-- CreateEnum
CREATE TYPE "Temperature" AS ENUM ('nong', 'am', 'lanh');

-- CreateEnum
CREATE TYPE "ConsultationResult" AS ENUM ('da_chot', 'chua_chot', 'tu_choi');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('granted', 'revoked');

-- CreateEnum
CREATE TYPE "ConsentSubjectType" AS ENUM ('customer', 'baby');

-- CreateEnum
CREATE TYPE "ExperimentStatus" AS ENUM ('draft', 'running', 'paused', 'completed');

-- CreateEnum
CREATE TYPE "ExperimentGroup" AS ENUM ('treatment', 'holdout');

-- CreateEnum
CREATE TYPE "ExportStatus" AS ENUM ('pending', 'approved', 'rejected', 'expired');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('pending', 'processing', 'done', 'error', 'dead_letter');

-- CreateEnum
CREATE TYPE "KvInvoiceStatus" AS ENUM ('pending', 'completed', 'cancelled', 'partially_returned', 'fully_returned', 'unknown');

-- CreateEnum
CREATE TYPE "ConfigAppliesTo" AS ENUM ('new_only', 'recalculate');

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "key" "RoleKey" NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "device" TEXT,
    "ip" TEXT,
    "revokedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trusted_devices" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceLabel" TEXT,
    "fingerprint" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trusted_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers_crm" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "displayName" TEXT,
    "facebook" TEXT,
    "zalo" TEXT,
    "preferredChannel" "PreferredChannel",
    "retentionStatus" "RetentionStatus" NOT NULL DEFAULT 'active',
    "note" TEXT,
    "careAddress" TEXT,
    "dormant" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "customers_crm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_roles" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "role" "CustomerRoleType" NOT NULL,
    "source" "CustomerRoleSource" NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_phones" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "phoneRaw" TEXT NOT NULL,
    "phoneNormalized" TEXT NOT NULL,
    "type" "PhoneType" NOT NULL DEFAULT 'primary',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "source" "DataSource" NOT NULL DEFAULT 'CRM',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_phones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_external_identities" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "sourceSystem" "SourceSystem" NOT NULL DEFAULT 'kiotviet',
    "externalCustomerId" TEXT NOT NULL,
    "externalCode" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "linkedMethod" "LinkMethod" NOT NULL DEFAULT 'auto',
    "linkedBy" TEXT,
    "linkedAt" TIMESTAMP(3),
    "unlinkedAt" TIMESTAMP(3),
    "matchConfidence" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_external_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_tag_assignments" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_tag_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merge_history" (
    "id" TEXT NOT NULL,
    "masterId" TEXT NOT NULL,
    "mergedId" TEXT NOT NULL,
    "mergedBy" TEXT NOT NULL,
    "mergedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revertible" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "merge_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "baby_profiles" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "babyName" TEXT,
    "birthDate" TIMESTAMP(3),
    "ageMonthsAtRecording" INTEGER,
    "ageRecordedAt" TIMESTAMP(3),
    "estimatedBirthMonth" TIMESTAMP(3),
    "datePrecision" "DatePrecision" NOT NULL DEFAULT 'month_estimated',
    "gender" TEXT,
    "allergies" TEXT,
    "allergiesSource" "InfoSource",
    "allergiesRecordedBy" TEXT,
    "allergiesRecordedAt" TIMESTAMP(3),
    "condition" TEXT,
    "conditionSource" "InfoSource",
    "conditionRecordedBy" TEXT,
    "conditionRecordedAt" TIMESTAMP(3),
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "baby_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "baby_product_usages" (
    "id" TEXT NOT NULL,
    "babyId" TEXT NOT NULL,
    "kvProductId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "baby_product_usages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "baby_product_avoidances" (
    "id" TEXT NOT NULL,
    "babyId" TEXT NOT NULL,
    "kvProductId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "baby_product_avoidances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "replacement_groups" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "replacement_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_crm_meta" (
    "id" TEXT NOT NULL,
    "kvProductId" TEXT NOT NULL,
    "babyAssignmentMode" "BabyAssignmentMode" NOT NULL DEFAULT 'multi_audience',
    "suggestedCycleDays" INTEGER,
    "suggestionSampleSize" INTEGER,
    "suggestionConfidence" "ConfidenceLevel",
    "suggestionMethod" TEXT,
    "approvedCycleDays" INTEGER,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "cycleMinDays" INTEGER,
    "cycleMaxDays" INTEGER,
    "replacementGroupId" TEXT,
    "autoRemindEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_crm_meta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_item_baby_allocations" (
    "id" TEXT NOT NULL,
    "kvInvoiceLineId" TEXT NOT NULL,
    "babyId" TEXT,
    "suggestedBabyId" TEXT,
    "assignmentStatus" "AssignmentStatus" NOT NULL,
    "assignmentConfidence" "ConfidenceLevel" NOT NULL DEFAULT 'low',
    "assignmentSource" "AssignmentSource" NOT NULL DEFAULT 'unassigned',
    "assignedQuantity" DECIMAL(10,2) NOT NULL,
    "consumptionStartDate" TIMESTAMP(3) NOT NULL,
    "cycleDaysOverride" INTEGER,
    "confirmedBy" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "skipCount" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_item_baby_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocation_history" (
    "id" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB,
    "changedBy" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,

    CONSTRAINT "allocation_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "orgName" TEXT NOT NULL,
    "mainAddress" TEXT,
    "province" TEXT,
    "district" TEXT,
    "tier" TEXT,
    "sizeEstimate" TEXT,
    "hasPhysicalStore" BOOLEAN,
    "competingBrands" TEXT,
    "competitorOffers" TEXT,
    "complaints" TEXT,
    "status" "OrgStatus" NOT NULL DEFAULT 'collecting',
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "pausedReason" TEXT,
    "pausedUntil" TIMESTAMP(3),
    "supplierStockoutAffected" BOOLEAN NOT NULL DEFAULT false,
    "declineReason" "DeclineReason",
    "declineReasonNote" TEXT,
    "reasonStatus" "ReasonStatus" NOT NULL DEFAULT 'unknown',
    "escalationLevel" "EscalationLevel",
    "medianCadenceDays" INTEGER,
    "cadenceSampleSize" INTEGER,
    "lastPurchaseAt" TIMESTAMP(3),
    "revenue90d" DECIMAL(14,2),
    "revenuePrev90d" DECIMAL(14,2),
    "revenueTrend" TEXT,
    "recordedBy" TEXT,
    "recordedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_contacts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "OrgContactRole" NOT NULL,
    "phone" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_organization_roles" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" "OrgContactRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_organization_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_excluded_periods" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fromDate" TIMESTAMP(3) NOT NULL,
    "toDate" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_excluded_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follow_ups" (
    "id" TEXT NOT NULL,
    "targetType" "FollowUpTargetType" NOT NULL,
    "customerId" TEXT,
    "organizationId" TEXT,
    "reminderType" "ReminderType" NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "assigneeId" TEXT,
    "status" "FollowUpStatus" NOT NULL DEFAULT 'cho_toi_han',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "result" TEXT,
    "closeReason" "CloseReason",
    "frequencyCapScope" "FrequencyCapScope" NOT NULL DEFAULT 'proactive_sales_contact',
    "contactedAt" TIMESTAMP(3),
    "reminderCount" INTEGER NOT NULL DEFAULT 0,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "content" TEXT,
    "claimState" "ClaimState" NOT NULL DEFAULT 'unclaimed',
    "claimedBy" TEXT,
    "claimedAt" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3),
    "claimExpiresAt" TIMESTAMP(3),
    "isHoldout" BOOLEAN NOT NULL DEFAULT false,
    "dormantFlag" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follow_up_state_history" (
    "id" TEXT NOT NULL,
    "followUpId" TEXT NOT NULL,
    "oldStatus" "FollowUpStatus",
    "newStatus" "FollowUpStatus" NOT NULL,
    "changedBy" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "follow_up_state_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follow_up_conversions" (
    "id" TEXT NOT NULL,
    "followUpId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "invoiceLineId" TEXT,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'pending',
    "attributionStatus" "AttributionStatus" NOT NULL DEFAULT 'not_attributed',
    "customerReport" "CustomerReport",
    "matchedAt" TIMESTAMP(3),
    "matchMethod" "LinkMethod",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "follow_up_conversions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminder_sources" (
    "id" TEXT NOT NULL,
    "followUpId" TEXT,
    "customerId" TEXT NOT NULL,
    "babyId" TEXT,
    "babyKey" TEXT NOT NULL,
    "replacementGroupId" TEXT,
    "invoiceId" TEXT NOT NULL,
    "assignmentStatus" "AssignmentStatus" NOT NULL,
    "confidenceLevel" "ConfidenceLevel" NOT NULL DEFAULT 'low',
    "expectedDepletionDate" TIMESTAMP(3) NOT NULL,
    "remindDate" TIMESTAMP(3) NOT NULL,
    "contentLine" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminder_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminder_source_lines" (
    "id" TEXT NOT NULL,
    "reminderSourceId" TEXT NOT NULL,
    "kvInvoiceLineId" TEXT NOT NULL,
    "allocationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminder_source_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consultations" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "babyId" TEXT,
    "issue" TEXT NOT NULL,
    "temperature" "Temperature",
    "result" "ConsultationResult",
    "reasonNoBuy" TEXT,
    "nextContactDate" TIMESTAMP(3),
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "consultations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consultation_advised_products" (
    "id" TEXT NOT NULL,
    "consultationId" TEXT NOT NULL,
    "kvProductId" TEXT NOT NULL,

    CONSTRAINT "consultation_advised_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consultation_versions" (
    "id" TEXT NOT NULL,
    "consultationId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changedBy" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consultation_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_types" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_consents" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "consentTypeId" TEXT NOT NULL,
    "subjectType" "ConsentSubjectType" NOT NULL DEFAULT 'customer',
    "babyId" TEXT,
    "representative" TEXT,
    "noticeVersion" TEXT,
    "channel" TEXT,
    "status" "ConsentStatus" NOT NULL,
    "grantedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "evidence" TEXT,
    "recordedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_events" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "consentTypeId" TEXT NOT NULL,
    "subjectType" "ConsentSubjectType" NOT NULL DEFAULT 'customer',
    "babyId" TEXT,
    "status" "ConsentStatus" NOT NULL,
    "representative" TEXT,
    "noticeVersion" TEXT,
    "channel" TEXT,
    "evidence" TEXT,
    "recordedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "experiments" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "holdoutRatio" DECIMAL(4,3) NOT NULL,
    "status" "ExperimentStatus" NOT NULL DEFAULT 'draft',
    "assignmentUnit" TEXT NOT NULL DEFAULT 'customer_id',
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "minSampleTreatment" INTEGER NOT NULL DEFAULT 0,
    "minSampleHoldout" INTEGER NOT NULL DEFAULT 0,
    "exclusionRules" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "experiments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "experiment_assignments" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "group" "ExperimentGroup" NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "experiment_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "objectId" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,
    "reason" TEXT,
    "ip" TEXT,
    "device" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuration_versions" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "configuration_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuration_change_logs" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB,
    "changedBy" TEXT NOT NULL,
    "reason" TEXT,
    "appliesTo" "ConfigAppliesTo" NOT NULL DEFAULT 'new_only',
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "configuration_change_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_requests" (
    "id" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "datasetScope" TEXT NOT NULL,
    "filtersSnapshot" JSONB,
    "reason" TEXT NOT NULL,
    "status" "ExportStatus" NOT NULL DEFAULT 'pending',
    "approvedBy" TEXT,
    "expiresAt" TIMESTAMP(3),
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "export_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_events" (
    "id" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "kvModifiedAt" TIMESTAMP(3),
    "eventId" TEXT,
    "payload" JSONB NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_state" (
    "id" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "lastCursor" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_reconciliation" (
    "id" TEXT NOT NULL,
    "periodLabel" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "kvCount" INTEGER,
    "crmCount" INTEGER,
    "mismatch" INTEGER,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_reconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_credentials" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'kiotviet',
    "secretCipher" TEXT,
    "meta" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kv_customers" (
    "id" TEXT NOT NULL,
    "kvCustomerId" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "customerGroup" TEXT,
    "address" TEXT,
    "kvModifiedAt" TIMESTAMP(3),
    "kvDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kv_customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kv_products" (
    "id" TEXT NOT NULL,
    "kvProductId" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "unit" TEXT,
    "price" DECIMAL(14,2),
    "categoryId" TEXT,
    "ageFromMonths" INTEGER,
    "ageToMonths" INTEGER,
    "kvDeleted" BOOLEAN NOT NULL DEFAULT false,
    "kvModifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kv_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kv_categories" (
    "id" TEXT NOT NULL,
    "kvCategoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kv_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kv_invoices" (
    "id" TEXT NOT NULL,
    "kvInvoiceId" TEXT NOT NULL,
    "code" TEXT,
    "kvCustomerId" TEXT,
    "purchaseDate" TIMESTAMP(3) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "status" "KvInvoiceStatus" NOT NULL DEFAULT 'completed',
    "kvModifiedAt" TIMESTAMP(3),
    "kvDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kv_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kv_invoice_lines" (
    "id" TEXT NOT NULL,
    "kvInvoiceLineId" TEXT NOT NULL,
    "kvInvoiceId" TEXT NOT NULL,
    "kvProductId" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "price" DECIMAL(14,2) NOT NULL,
    "discount" DECIMAL(14,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kv_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kv_returns" (
    "id" TEXT NOT NULL,
    "kvReturnId" TEXT NOT NULL,
    "code" TEXT,
    "kvInvoiceId" TEXT,
    "kvCustomerId" TEXT,
    "returnDate" TIMESTAMP(3) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "kvModifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kv_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kv_return_lines" (
    "id" TEXT NOT NULL,
    "kvReturnLineId" TEXT NOT NULL,
    "kvReturnId" TEXT NOT NULL,
    "kvProductId" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "price" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kv_return_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kv_orders" (
    "id" TEXT NOT NULL,
    "kvOrderId" TEXT NOT NULL,
    "code" TEXT,
    "kvCustomerId" TEXT,
    "orderDate" TIMESTAMP(3) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "status" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kv_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kv_stock_snapshots" (
    "id" TEXT NOT NULL,
    "kvProductId" TEXT NOT NULL,
    "snapshotAt" TIMESTAMP(3) NOT NULL,
    "onHand" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kv_stock_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_key_key" ON "roles"("key");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "trusted_devices_userId_idx" ON "trusted_devices"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_roles_customerId_role_key" ON "customer_roles"("customerId", "role");

-- CreateIndex
CREATE INDEX "customer_phones_phoneNormalized_idx" ON "customer_phones"("phoneNormalized");

-- CreateIndex
CREATE INDEX "customer_phones_customerId_idx" ON "customer_phones"("customerId");

-- CreateIndex
CREATE INDEX "customer_external_identities_externalCustomerId_idx" ON "customer_external_identities"("externalCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_external_identities_sourceSystem_externalCustomerI_key" ON "customer_external_identities"("sourceSystem", "externalCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_tag_assignments_customerId_tag_key" ON "customer_tag_assignments"("customerId", "tag");

-- CreateIndex
CREATE INDEX "baby_profiles_customerId_idx" ON "baby_profiles"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "baby_product_usages_babyId_kvProductId_key" ON "baby_product_usages"("babyId", "kvProductId");

-- CreateIndex
CREATE UNIQUE INDEX "baby_product_avoidances_babyId_kvProductId_key" ON "baby_product_avoidances"("babyId", "kvProductId");

-- CreateIndex
CREATE UNIQUE INDEX "product_crm_meta_kvProductId_key" ON "product_crm_meta"("kvProductId");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_item_baby_allocations_kvInvoiceLineId_key" ON "invoice_item_baby_allocations"("kvInvoiceLineId");

-- CreateIndex
CREATE INDEX "invoice_item_baby_allocations_babyId_idx" ON "invoice_item_baby_allocations"("babyId");

-- CreateIndex
CREATE INDEX "allocation_history_allocationId_idx" ON "allocation_history"("allocationId");

-- CreateIndex
CREATE INDEX "organization_contacts_organizationId_idx" ON "organization_contacts"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_organization_roles_customerId_organizationId_role_key" ON "customer_organization_roles"("customerId", "organizationId", "role");

-- CreateIndex
CREATE INDEX "organization_excluded_periods_organizationId_idx" ON "organization_excluded_periods"("organizationId");

-- CreateIndex
CREATE INDEX "follow_ups_assigneeId_dueDate_status_idx" ON "follow_ups"("assigneeId", "dueDate", "status");

-- CreateIndex
CREATE INDEX "follow_ups_customerId_dueDate_idx" ON "follow_ups"("customerId", "dueDate");

-- CreateIndex
CREATE INDEX "follow_up_state_history_followUpId_idx" ON "follow_up_state_history"("followUpId");

-- CreateIndex
CREATE INDEX "follow_up_conversions_followUpId_idx" ON "follow_up_conversions"("followUpId");

-- CreateIndex
CREATE UNIQUE INDEX "follow_up_conversions_invoiceId_key" ON "follow_up_conversions"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "follow_up_conversions_invoiceLineId_key" ON "follow_up_conversions"("invoiceLineId");

-- CreateIndex
CREATE INDEX "reminder_sources_customerId_idx" ON "reminder_sources"("customerId");

-- CreateIndex
CREATE INDEX "reminder_sources_followUpId_idx" ON "reminder_sources"("followUpId");

-- CreateIndex
CREATE INDEX "reminder_source_lines_reminderSourceId_idx" ON "reminder_source_lines"("reminderSourceId");

-- CreateIndex
CREATE INDEX "consultations_customerId_idx" ON "consultations"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "consultation_advised_products_consultationId_kvProductId_key" ON "consultation_advised_products"("consultationId", "kvProductId");

-- CreateIndex
CREATE INDEX "consultation_versions_consultationId_idx" ON "consultation_versions"("consultationId");

-- CreateIndex
CREATE UNIQUE INDEX "consent_types_key_key" ON "consent_types"("key");

-- CreateIndex
CREATE INDEX "customer_consents_customerId_idx" ON "customer_consents"("customerId");

-- CreateIndex
CREATE INDEX "consent_events_customerId_idx" ON "consent_events"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "experiment_assignments_experimentId_customerId_key" ON "experiment_assignments"("experimentId", "customerId");

-- CreateIndex
CREATE INDEX "audit_logs_objectType_objectId_idx" ON "audit_logs"("objectType", "objectId");

-- CreateIndex
CREATE INDEX "audit_logs_userId_createdAt_idx" ON "audit_logs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "configuration_versions_key_isActive_idx" ON "configuration_versions"("key", "isActive");

-- CreateIndex
CREATE INDEX "configuration_change_logs_key_idx" ON "configuration_change_logs"("key");

-- CreateIndex
CREATE UNIQUE INDEX "sync_events_objectType_objectId_kvModifiedAt_key" ON "sync_events"("objectType", "objectId", "kvModifiedAt");

-- CreateIndex
CREATE UNIQUE INDEX "sync_state_objectType_key" ON "sync_state"("objectType");

-- CreateIndex
CREATE UNIQUE INDEX "kv_customers_kvCustomerId_key" ON "kv_customers"("kvCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "kv_products_kvProductId_key" ON "kv_products"("kvProductId");

-- CreateIndex
CREATE UNIQUE INDEX "kv_categories_kvCategoryId_key" ON "kv_categories"("kvCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "kv_invoices_kvInvoiceId_key" ON "kv_invoices"("kvInvoiceId");

-- CreateIndex
CREATE INDEX "kv_invoices_purchaseDate_idx" ON "kv_invoices"("purchaseDate");

-- CreateIndex
CREATE INDEX "kv_invoices_kvCustomerId_idx" ON "kv_invoices"("kvCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "kv_invoice_lines_kvInvoiceLineId_key" ON "kv_invoice_lines"("kvInvoiceLineId");

-- CreateIndex
CREATE INDEX "kv_invoice_lines_kvProductId_idx" ON "kv_invoice_lines"("kvProductId");

-- CreateIndex
CREATE INDEX "kv_invoice_lines_kvInvoiceId_idx" ON "kv_invoice_lines"("kvInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "kv_returns_kvReturnId_key" ON "kv_returns"("kvReturnId");

-- CreateIndex
CREATE INDEX "kv_returns_kvInvoiceId_idx" ON "kv_returns"("kvInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "kv_return_lines_kvReturnLineId_key" ON "kv_return_lines"("kvReturnLineId");

-- CreateIndex
CREATE INDEX "kv_return_lines_kvReturnId_idx" ON "kv_return_lines"("kvReturnId");

-- CreateIndex
CREATE UNIQUE INDEX "kv_orders_kvOrderId_key" ON "kv_orders"("kvOrderId");

-- CreateIndex
CREATE INDEX "kv_stock_snapshots_kvProductId_idx" ON "kv_stock_snapshots"("kvProductId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_roles" ADD CONSTRAINT "customer_roles_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers_crm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_phones" ADD CONSTRAINT "customer_phones_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers_crm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_external_identities" ADD CONSTRAINT "customer_external_identities_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers_crm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_tag_assignments" ADD CONSTRAINT "customer_tag_assignments_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers_crm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "baby_profiles" ADD CONSTRAINT "baby_profiles_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers_crm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "baby_product_usages" ADD CONSTRAINT "baby_product_usages_babyId_fkey" FOREIGN KEY ("babyId") REFERENCES "baby_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "baby_product_avoidances" ADD CONSTRAINT "baby_product_avoidances_babyId_fkey" FOREIGN KEY ("babyId") REFERENCES "baby_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_crm_meta" ADD CONSTRAINT "product_crm_meta_kvProductId_fkey" FOREIGN KEY ("kvProductId") REFERENCES "kv_products"("kvProductId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_crm_meta" ADD CONSTRAINT "product_crm_meta_replacementGroupId_fkey" FOREIGN KEY ("replacementGroupId") REFERENCES "replacement_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_item_baby_allocations" ADD CONSTRAINT "invoice_item_baby_allocations_kvInvoiceLineId_fkey" FOREIGN KEY ("kvInvoiceLineId") REFERENCES "kv_invoice_lines"("kvInvoiceLineId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_item_baby_allocations" ADD CONSTRAINT "invoice_item_baby_allocations_babyId_fkey" FOREIGN KEY ("babyId") REFERENCES "baby_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_item_baby_allocations" ADD CONSTRAINT "invoice_item_baby_allocations_suggestedBabyId_fkey" FOREIGN KEY ("suggestedBabyId") REFERENCES "baby_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_history" ADD CONSTRAINT "allocation_history_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "invoice_item_baby_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_contacts" ADD CONSTRAINT "organization_contacts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_organization_roles" ADD CONSTRAINT "customer_organization_roles_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers_crm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_organization_roles" ADD CONSTRAINT "customer_organization_roles_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_excluded_periods" ADD CONSTRAINT "organization_excluded_periods_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers_crm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_up_state_history" ADD CONSTRAINT "follow_up_state_history_followUpId_fkey" FOREIGN KEY ("followUpId") REFERENCES "follow_ups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_up_conversions" ADD CONSTRAINT "follow_up_conversions_followUpId_fkey" FOREIGN KEY ("followUpId") REFERENCES "follow_ups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_sources" ADD CONSTRAINT "reminder_sources_followUpId_fkey" FOREIGN KEY ("followUpId") REFERENCES "follow_ups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_sources" ADD CONSTRAINT "reminder_sources_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers_crm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_sources" ADD CONSTRAINT "reminder_sources_babyId_fkey" FOREIGN KEY ("babyId") REFERENCES "baby_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_sources" ADD CONSTRAINT "reminder_sources_replacementGroupId_fkey" FOREIGN KEY ("replacementGroupId") REFERENCES "replacement_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_source_lines" ADD CONSTRAINT "reminder_source_lines_reminderSourceId_fkey" FOREIGN KEY ("reminderSourceId") REFERENCES "reminder_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers_crm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_babyId_fkey" FOREIGN KEY ("babyId") REFERENCES "baby_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_advised_products" ADD CONSTRAINT "consultation_advised_products_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "consultations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_versions" ADD CONSTRAINT "consultation_versions_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "consultations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_consents" ADD CONSTRAINT "customer_consents_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers_crm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_consents" ADD CONSTRAINT "customer_consents_consentTypeId_fkey" FOREIGN KEY ("consentTypeId") REFERENCES "consent_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_consents" ADD CONSTRAINT "customer_consents_babyId_fkey" FOREIGN KEY ("babyId") REFERENCES "baby_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers_crm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_consentTypeId_fkey" FOREIGN KEY ("consentTypeId") REFERENCES "consent_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_babyId_fkey" FOREIGN KEY ("babyId") REFERENCES "baby_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiment_assignments" ADD CONSTRAINT "experiment_assignments_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "experiments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiment_assignments" ADD CONSTRAINT "experiment_assignments_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers_crm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kv_invoices" ADD CONSTRAINT "kv_invoices_kvCustomerId_fkey" FOREIGN KEY ("kvCustomerId") REFERENCES "kv_customers"("kvCustomerId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kv_invoice_lines" ADD CONSTRAINT "kv_invoice_lines_kvInvoiceId_fkey" FOREIGN KEY ("kvInvoiceId") REFERENCES "kv_invoices"("kvInvoiceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kv_invoice_lines" ADD CONSTRAINT "kv_invoice_lines_kvProductId_fkey" FOREIGN KEY ("kvProductId") REFERENCES "kv_products"("kvProductId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kv_return_lines" ADD CONSTRAINT "kv_return_lines_kvReturnId_fkey" FOREIGN KEY ("kvReturnId") REFERENCES "kv_returns"("kvReturnId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- 🔴 CHECK constraint (DM/§2.5): allocation ở trạng thái không gắn bé
-- (suggested | customer_level | not_applicable) BẮT BUỘC babyId IS NULL.
-- Prisma không hỗ trợ CHECK trong schema => append thủ công vào migration.
-- ============================================================
ALTER TABLE "invoice_item_baby_allocations"
  ADD CONSTRAINT "chk_allocation_baby_null_when_unassigned"
  CHECK (
    "assignmentStatus" NOT IN ('suggested', 'customer_level', 'not_applicable')
    OR "babyId" IS NULL
  );

-- ============================================================
-- audit_logs APPEND-ONLY (SEC/DM-02): chặn UPDATE & DELETE ở tầng DB.
-- ============================================================
CREATE OR REPLACE FUNCTION "audit_logs_block_mutation"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs la append-only: khong duoc % ban ghi', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "trg_audit_logs_no_update"
  BEFORE UPDATE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "audit_logs_block_mutation"();

CREATE TRIGGER "trg_audit_logs_no_delete"
  BEFORE DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "audit_logs_block_mutation"();
