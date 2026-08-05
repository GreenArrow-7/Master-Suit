-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "VisibilityScope" AS ENUM ('NONE', 'OWN', 'TEAM', 'BRANCH', 'REGION', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "PermissionAction" AS ENUM ('VIEW', 'CREATE', 'EDIT', 'DELETE', 'EXPORT', 'IMPORT', 'ASSIGN', 'REASSIGN', 'BULK_UPDATE', 'VIEW_REPORTS', 'MANAGE_AUTOMATION', 'MANAGE_USERS', 'MANAGE_CONFIGURATION', 'ACCESS_API', 'VIEW_SENSITIVE_FIELDS');

-- CreateEnum
CREATE TYPE "FieldType" AS ENUM ('TEXT', 'LONG_TEXT', 'NUMBER', 'CURRENCY', 'PERCENTAGE', 'DATE', 'DATETIME', 'DROPDOWN', 'MULTI_SELECT', 'CHECKBOX', 'RADIO', 'EMAIL', 'PHONE', 'URL', 'USER_LOOKUP', 'LEAD_LOOKUP', 'ACCOUNT_LOOKUP', 'PRODUCT_LOOKUP', 'FORMULA', 'FILE', 'IMAGE', 'GEO_POINT', 'SIGNATURE');

-- CreateEnum
CREATE TYPE "StageCategory" AS ENUM ('OPEN', 'CONVERSION', 'TERMINAL_NEGATIVE', 'TERMINAL_JUNK');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('UNKNOWN', 'GRANTED', 'WITHDRAWN', 'IMPLIED');

-- CreateEnum
CREATE TYPE "RecordSource" AS ENUM ('MANUAL', 'QUICK_CREATE', 'IMPORT', 'PUBLIC_FORM', 'LANDING_PAGE', 'API', 'WEBHOOK', 'EMAIL_PARSER', 'TELEPHONY', 'AD_LEAD_FORM', 'CHAT', 'MARKETPLACE', 'AUTOMATION');

-- CreateEnum
CREATE TYPE "TaskCategory" AS ENUM ('APPOINTMENT', 'TODO');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'RESCHEDULED');

-- CreateEnum
CREATE TYPE "OpportunityStatus" AS ENUM ('OPEN', 'WON', 'LOST', 'ABANDONED');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('NEW', 'OPEN', 'PENDING_CUSTOMER', 'PENDING_INTERNAL', 'ESCALATED', 'RESOLVED', 'CLOSED', 'REOPENED');

-- CreateEnum
CREATE TYPE "SlaState" AS ENUM ('ON_TRACK', 'AT_RISK', 'BREACHED', 'MET', 'PAUSED');

-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('EMAIL', 'SMS', 'WHATSAPP', 'VOICE', 'IN_APP', 'CHAT', 'NOTE', 'PUSH');

-- CreateEnum
CREATE TYPE "CommunicationDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "CommunicationStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'CLICKED', 'REPLIED', 'BOUNCED', 'FAILED', 'SUPPRESSED');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PublishState" AS ENUM ('DRAFT', 'PUBLISHED', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('ACTIVE', 'WAITING', 'COMPLETED', 'EXITED', 'FAILED', 'SUPPRESSED');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'RETRYING');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DistributionMethod" AS ENUM ('ROUND_ROBIN', 'WEIGHTED_ROUND_ROBIN', 'LEAST_LOADED', 'TERRITORY', 'POSTAL_CODE', 'PRODUCT', 'LANGUAGE', 'BRANCH', 'SOURCE', 'CAMPAIGN', 'SKILL', 'AVAILABILITY', 'MANAGER_SELECTED', 'FIXED_OWNER', 'EXTERNAL_API');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('UPLOADED', 'PENDING_VERIFICATION', 'VERIFIED', 'REJECTED', 'EXPIRED', 'REPLACED');

-- CreateEnum
CREATE TYPE "ListType" AS ENUM ('STATIC', 'DYNAMIC', 'SUPPRESSION');

-- CreateEnum
CREATE TYPE "AuditEvent" AS ENUM ('LOGIN', 'LOGOUT', 'LOGIN_FAILED', 'PASSWORD_CHANGED', 'MFA_ENROLLED', 'RECORD_CREATED', 'RECORD_UPDATED', 'RECORD_DELETED', 'RECORD_RESTORED', 'STAGE_CHANGED', 'OWNER_CHANGED', 'PERMISSION_CHANGED', 'EXPORT_REQUESTED', 'IMPORT_STARTED', 'API_KEY_CREATED', 'API_KEY_REVOKED', 'AUTOMATION_MODIFIED', 'INTEGRATION_MODIFIED', 'DOCUMENT_ACCESSED', 'SENSITIVE_FIELD_VIEWED', 'TARGET_CREATED', 'TARGET_UPDATED', 'CALL_STARTED', 'CALL_COMPLETED', 'RECORDING_ACCESSED', 'CONSENT_RECORDED', 'CONSENT_WITHDRAWN', 'AI_ANALYSIS_COMPLETED', 'CALL_AUDIT_COMPLETED');

-- CreateEnum
CREATE TYPE "ModuleKey" AS ENUM ('HRMS', 'SALES');

-- CreateEnum
CREATE TYPE "SubscriptionState" AS ENUM ('TRIAL', 'ACTIVE', 'GRACE', 'SUSPENDED', 'CANCELED');

-- CreateEnum
CREATE TYPE "TargetPeriod" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "TargetMetric" AS ENUM ('LEADS_ASSIGNED', 'CALLS_ATTEMPTED', 'CALLS_CONNECTED', 'FOLLOWUPS_COMPLETED', 'INVITATIONS_SENT', 'RSVPS_CONFIRMED', 'LEADS_QUALIFIED', 'LEADS_CONVERTED');

-- CreateEnum
CREATE TYPE "CallStatus" AS ENUM ('SCHEDULED', 'RINGING', 'IN_PROGRESS', 'COMPLETED', 'MISSED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CallOutcome" AS ENUM ('CONNECTED', 'NO_ANSWER', 'BUSY', 'VOICEMAIL', 'WRONG_NUMBER', 'CALLBACK_REQUESTED', 'NOT_INTERESTED', 'INTERESTED', 'QUALIFIED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "ConsentMethod" AS ENUM ('VERBAL', 'WRITTEN', 'ELECTRONIC', 'PRE_AUTHORIZED');

-- CreateEnum
CREATE TYPE "AnalysisStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'INSUFFICIENT_DATA');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('ONLINE', 'PHYSICAL', 'HYBRID');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "RsvpStatus" AS ENUM ('PENDING', 'CONFIRMED', 'DECLINED', 'TENTATIVE', 'NO_RESPONSE', 'ATTENDED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "InviteChannel" AS ENUM ('EMAIL', 'WHATSAPP', 'SMS', 'IN_APP');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "primaryDomain" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "planCode" TEXT NOT NULL DEFAULT 'standard',
    "dataRegion" TEXT NOT NULL DEFAULT 'me-central-1',
    "leadCeiling" INTEGER NOT NULL DEFAULT 1000000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionPlan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "modules" "ModuleKey"[],
    "seatLimit" INTEGER NOT NULL,
    "storageMb" INTEGER NOT NULL,
    "featureLimits" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantSubscription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "state" "SubscriptionState" NOT NULL DEFAULT 'TRIAL',
    "trialEndsAt" TIMESTAMP(3),
    "graceEndsAt" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "externalCustomerId" TEXT,
    "externalContractId" TEXT,
    "canceledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModuleEntitlement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "module" "ModuleKey" NOT NULL,
    "state" "SubscriptionState" NOT NULL DEFAULT 'TRIAL',
    "limits" JSONB NOT NULL DEFAULT '{}',
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModuleEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationSetting" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productName" TEXT NOT NULL DEFAULT 'Master App',
    "logoUrl" TEXT,
    "faviconUrl" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#2447C7',
    "accentColor" TEXT NOT NULL DEFAULT '#0E7C66',
    "emailFromName" TEXT,
    "emailFromAddress" TEXT,
    "defaultTimezone" TEXT NOT NULL DEFAULT 'Asia/Dubai',
    "defaultLocale" TEXT NOT NULL DEFAULT 'en-AE',
    "defaultCurrency" TEXT NOT NULL DEFAULT 'AED',
    "fiscalYearStart" INTEGER NOT NULL DEFAULT 1,
    "terminology" JSONB NOT NULL DEFAULT '{}',
    "workingHours" JSONB NOT NULL DEFAULT '{}',
    "quietHours" JSONB NOT NULL DEFAULT '{}',
    "passwordPolicy" JSONB NOT NULL DEFAULT '{}',
    "sessionTtlMinutes" INTEGER NOT NULL DEFAULT 480,
    "mfaRequired" BOOLEAN NOT NULL DEFAULT false,
    "ipAllowlist" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "retentionPolicy" JSONB NOT NULL DEFAULT '{}',
    "featureFlags" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Region" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "headUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Region_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "regionId" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "addressLine" TEXT,
    "city" TEXT,
    "country" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Dubai',
    "workingHours" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Territory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "branchId" TEXT,
    "countries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "states" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "postalCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Territory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "branchId" TEXT,
    "departmentId" TEXT,
    "managerId" TEXT,
    "parentTeamId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerifiedAt" TIMESTAMP(3),
    "passwordHash" TEXT,
    "fullName" TEXT NOT NULL,
    "displayName" TEXT,
    "phone" TEXT,
    "avatarUrl" TEXT,
    "employeeCode" TEXT,
    "jobTitle" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'INVITED',
    "roleId" TEXT NOT NULL,
    "branchId" TEXT,
    "regionId" TEXT,
    "managerId" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Dubai',
    "locale" TEXT NOT NULL DEFAULT 'en-AE',
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "workingHours" JSONB NOT NULL DEFAULT '{}',
    "onLeaveUntil" TIMESTAMP(3),
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "dailyLeadQuota" INTEGER,
    "weeklyLeadQuota" INTEGER,
    "monthlyLeadQuota" INTEGER,
    "activeLeadCapacity" INTEGER,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecret" TEXT,
    "mfaRecoveryCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "passwordChangedAt" TIMESTAMP(3),
    "notificationPrefs" JSONB NOT NULL DEFAULT '{}',
    "uiPreferences" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserTeam" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "isManager" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "deviceLabel" TEXT,
    "mfaSatisfied" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "rank" INTEGER NOT NULL DEFAULT 100,
    "defaultScope" "VisibilityScope" NOT NULL DEFAULT 'OWN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "action" "PermissionAction" NOT NULL,
    "description" TEXT,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL DEFAULT true,
    "scope" "VisibilityScope" NOT NULL DEFAULT 'OWN',
    "conditions" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldPermission" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "canView" BOOLEAN NOT NULL DEFAULT true,
    "canEdit" BOOLEAN NOT NULL DEFAULT false,
    "maskStrategy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FieldPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadStage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "StageCategory" NOT NULL DEFAULT 'OPEN',
    "color" TEXT NOT NULL DEFAULT '#64748B',
    "position" INTEGER NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "requiredFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowedNextStages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "slaMinutes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "LeadStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "firstName" TEXT,
    "middleName" TEXT,
    "lastName" TEXT,
    "fullName" TEXT NOT NULL,
    "email" TEXT,
    "secondaryEmail" TEXT,
    "phone" TEXT,
    "phoneNormalized" TEXT,
    "secondaryPhone" TEXT,
    "whatsappNumber" TEXT,
    "country" TEXT,
    "state" TEXT,
    "city" TEXT,
    "postalCode" TEXT,
    "addressLine" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "company" TEXT,
    "jobTitle" TEXT,
    "industry" TEXT,
    "source" "RecordSource" NOT NULL DEFAULT 'MANUAL',
    "sourceDetail" TEXT,
    "subSource" TEXT,
    "campaignId" TEXT,
    "productInterestId" TEXT,
    "stageId" TEXT NOT NULL,
    "status" TEXT,
    "score" INTEGER NOT NULL DEFAULT 0,
    "grade" TEXT,
    "quality" TEXT,
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "conversionProbability" INTEGER,
    "ownerId" TEXT,
    "teamId" TEXT,
    "branchId" TEXT,
    "regionId" TEXT,
    "territoryId" TEXT,
    "accountId" TEXT,
    "convertedContactId" TEXT,
    "consentStatus" "ConsentStatus" NOT NULL DEFAULT 'UNKNOWN',
    "doNotCall" BOOLEAN NOT NULL DEFAULT false,
    "emailOptOut" BOOLEAN NOT NULL DEFAULT false,
    "smsOptOut" BOOLEAN NOT NULL DEFAULT false,
    "whatsappOptOut" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "customData" JSONB NOT NULL DEFAULT '{}',
    "searchVector" TEXT,
    "firstContactedAt" TIMESTAMP(3),
    "firstResponseMins" INTEGER,
    "lastActivityAt" TIMESTAMP(3),
    "nextFollowUpAt" TIMESTAMP(3),
    "slaDueAt" TIMESTAMP(3),
    "slaState" "SlaState" NOT NULL DEFAULT 'ON_TRACK',
    "convertedAt" TIMESTAMP(3),
    "assignedAt" TIMESTAMP(3),
    "duplicateOfId" TEXT,
    "isMerged" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadCustomFieldDefinition" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "objectType" TEXT NOT NULL DEFAULT 'LEAD',
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "FieldType" NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "isUnique" BOOLEAN NOT NULL DEFAULT false,
    "isReadOnly" BOOLEAN NOT NULL DEFAULT false,
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "isSearchable" BOOLEAN NOT NULL DEFAULT false,
    "isFilterable" BOOLEAN NOT NULL DEFAULT true,
    "includeInExport" BOOLEAN NOT NULL DEFAULT true,
    "isSensitive" BOOLEAN NOT NULL DEFAULT false,
    "defaultValue" JSONB,
    "options" JSONB,
    "validationRule" JSONB,
    "conditionalVisibility" JSONB,
    "formulaExpression" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "helpText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "LeadCustomFieldDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadCustomFieldValue" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "valueText" TEXT,
    "valueNumber" DECIMAL(20,6),
    "valueBool" BOOLEAN,
    "valueDate" TIMESTAMP(3),
    "valueJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadCustomFieldValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadStageHistory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "fromStageId" TEXT,
    "toStageId" TEXT NOT NULL,
    "changedById" TEXT,
    "changedBySystem" TEXT,
    "reason" TEXT,
    "durationSecs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadStageHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadAssignmentHistory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "fromOwnerId" TEXT,
    "toOwnerId" TEXT,
    "ruleId" TEXT,
    "method" "DistributionMethod",
    "reason" TEXT,
    "assignedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadAssignmentHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadScoreHistory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "ruleId" TEXT,
    "delta" INTEGER NOT NULL,
    "scoreAfter" INTEGER NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadScoreHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadTag" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#94A3B8',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoringRule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'SCORE',
    "objectType" TEXT NOT NULL DEFAULT 'LEAD',
    "triggerType" TEXT NOT NULL,
    "conditions" JSONB NOT NULL DEFAULT '{}',
    "delta" INTEGER NOT NULL DEFAULT 0,
    "gradeValue" TEXT,
    "decayDays" INTEGER,
    "decayAmount" INTEGER,
    "maxPerDay" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "ScoringRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DuplicateRule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "objectType" TEXT NOT NULL DEFAULT 'LEAD',
    "name" TEXT NOT NULL,
    "matchFields" TEXT[],
    "strategy" TEXT NOT NULL DEFAULT 'WARN',
    "position" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DuplicateRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountType" TEXT,
    "industry" TEXT,
    "parentAccountId" TEXT,
    "website" TEXT,
    "mainPhone" TEXT,
    "mainEmail" TEXT,
    "billingAddress" JSONB,
    "shippingAddress" JSONB,
    "ownerId" TEXT,
    "teamId" TEXT,
    "regionId" TEXT,
    "branchId" TEXT,
    "employeeCount" INTEGER,
    "annualRevenue" DECIMAL(18,2),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "customerTier" TEXT,
    "renewalDate" TIMESTAMP(3),
    "notes" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "customData" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "fullName" TEXT NOT NULL,
    "jobTitle" TEXT,
    "department" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "phoneNormalized" TEXT,
    "whatsappNumber" TEXT,
    "accountId" TEXT,
    "decisionRole" TEXT,
    "ownerId" TEXT,
    "communicationPreference" TEXT,
    "consentStatus" "ConsentStatus" NOT NULL DEFAULT 'UNKNOWN',
    "emailOptOut" BOOLEAN NOT NULL DEFAULT false,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "customData" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityType" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultPipelineId" TEXT,
    "fieldLayout" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpportunityType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pipeline" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "opportunityTypeId" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "Pipeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineStage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "StageCategory" NOT NULL DEFAULT 'OPEN',
    "color" TEXT NOT NULL DEFAULT '#64748B',
    "position" INTEGER NOT NULL,
    "probability" INTEGER NOT NULL DEFAULT 0,
    "requiredFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowedNextStages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "stallDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PipelineStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Opportunity" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "typeId" TEXT,
    "leadId" TEXT,
    "accountId" TEXT,
    "contactId" TEXT,
    "productId" TEXT,
    "pipelineId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "status" "OpportunityStatus" NOT NULL DEFAULT 'OPEN',
    "ownerId" TEXT,
    "teamId" TEXT,
    "branchId" TEXT,
    "regionId" TEXT,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "expectedRevenue" DECIMAL(18,2),
    "probability" INTEGER NOT NULL DEFAULT 0,
    "expectedCloseDate" TIMESTAMP(3),
    "actualCloseDate" TIMESTAMP(3),
    "source" "RecordSource" NOT NULL DEFAULT 'MANUAL',
    "campaignId" TEXT,
    "competitor" TEXT,
    "lossReasonId" TEXT,
    "lossNotes" TEXT,
    "notes" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "customData" JSONB NOT NULL DEFAULT '{}',
    "lastActivityAt" TIMESTAMP(3),
    "stageEnteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityStageHistory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "fromStageId" TEXT,
    "toStageId" TEXT NOT NULL,
    "changedById" TEXT,
    "durationSecs" INTEGER,
    "amountAtChange" DECIMAL(18,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpportunityStageHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityCollaborator" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpportunityCollaborator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LossReason" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LossReason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "unitPrice" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "taxRate" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "ownerId" TEXT,
    "eligibilityCriteria" JSONB,
    "relatedPipelineId" TEXT,
    "relatedFormId" TEXT,
    "customData" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityProduct" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(18,2) NOT NULL,
    "discountPct" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "taxRate" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpportunityProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityType" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "color" TEXT NOT NULL DEFAULT '#64748B',
    "direction" "CommunicationDirection",
    "scoreDelta" INTEGER NOT NULL DEFAULT 0,
    "fieldSchema" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivityType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "leadId" TEXT,
    "opportunityId" TEXT,
    "accountId" TEXT,
    "contactId" TEXT,
    "ticketId" TEXT,
    "ownerId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" TEXT,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "durationSecs" INTEGER,
    "location" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "notes" TEXT,
    "nextAction" TEXT,
    "followUpAt" TIMESTAMP(3),
    "source" "RecordSource" NOT NULL DEFAULT 'MANUAL',
    "customData" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskType" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "TaskCategory" NOT NULL DEFAULT 'TODO',
    "color" TEXT NOT NULL DEFAULT '#64748B',
    "defaultDurationMins" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "category" "TaskCategory" NOT NULL DEFAULT 'TODO',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "leadId" TEXT,
    "opportunityId" TEXT,
    "accountId" TEXT,
    "ticketId" TEXT,
    "ownerId" TEXT,
    "teamId" TEXT,
    "startAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3) NOT NULL,
    "remindAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "outcome" TEXT,
    "location" TEXT,
    "meetingUrl" TEXT,
    "recurrenceRule" TEXT,
    "parentTaskId" TEXT,
    "completionNotes" TEXT,
    "escalatedAt" TIMESTAMP(3),
    "customData" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DistributionRule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "objectType" TEXT NOT NULL DEFAULT 'LEAD',
    "method" "DistributionMethod" NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "conditions" JSONB NOT NULL DEFAULT '{}',
    "candidatePool" JSONB NOT NULL DEFAULT '{}',
    "weights" JSONB NOT NULL DEFAULT '{}',
    "respectWorkingHours" BOOLEAN NOT NULL DEFAULT true,
    "respectLeave" BOOLEAN NOT NULL DEFAULT true,
    "respectQuotas" BOOLEAN NOT NULL DEFAULT true,
    "respectCapacity" BOOLEAN NOT NULL DEFAULT true,
    "fallbackTeamId" TEXT,
    "fallbackUserId" TEXT,
    "reassignAfterMins" INTEGER,
    "escalateAfterMins" INTEGER,
    "externalEndpoint" TEXT,
    "lastAssignedUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "DistributionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Automation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "objectType" TEXT NOT NULL,
    "state" "PublishState" NOT NULL DEFAULT 'DRAFT',
    "activeVersionId" TEXT,
    "allowReEnrollment" BOOLEAN NOT NULL DEFAULT false,
    "suppressionRules" JSONB NOT NULL DEFAULT '{}',
    "exitConditions" JSONB NOT NULL DEFAULT '{}',
    "isTestMode" BOOLEAN NOT NULL DEFAULT false,
    "concurrencyLimit" INTEGER NOT NULL DEFAULT 50,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Automation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "graph" JSONB NOT NULL,
    "triggerSpec" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "changeNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "AutomationVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationEnrollment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentNodeId" TEXT,
    "context" JSONB NOT NULL DEFAULT '{}',
    "resumeAt" TIMESTAMP(3),
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "exitReason" TEXT,
    "idempotencyKey" TEXT,

    CONSTRAINT "AutomationEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationExecution" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "nodeType" TEXT NOT NULL,
    "status" "ExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "input" JSONB,
    "output" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,

    CONSTRAINT "AutomationExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "campaignType" TEXT NOT NULL,
    "channel" "ChannelType",
    "ownerId" TEXT,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "budget" DECIMAL(18,2),
    "actualSpend" DECIMAL(18,2),
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "targetListId" TEXT,
    "source" TEXT,
    "expectedLeads" INTEGER,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "customData" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingList" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "listType" "ListType" NOT NULL DEFAULT 'STATIC',
    "objectType" TEXT NOT NULL DEFAULT 'LEAD',
    "definition" JSONB NOT NULL DEFAULT '{}',
    "memberCount" INTEGER NOT NULL DEFAULT 0,
    "lastBuiltAt" TIMESTAMP(3),
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MarketingList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingListMember" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "addedVia" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingListMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailCampaign" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "campaignId" TEXT,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "preheader" TEXT,
    "fromName" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "replyTo" TEXT,
    "templateId" TEXT,
    "bodyHtml" TEXT,
    "bodyDesign" JSONB,
    "listId" TEXT,
    "suppressionListId" TEXT,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "timezoneSend" BOOLEAN NOT NULL DEFAULT false,
    "abVariant" JSONB,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "deliveredCount" INTEGER NOT NULL DEFAULT 0,
    "openCount" INTEGER NOT NULL DEFAULT 0,
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "bounceCount" INTEGER NOT NULL DEFAULT 0,
    "unsubscribeCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "EmailCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" "ChannelType" NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "designJson" JSONB,
    "mergeFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "providerTemplateId" TEXT,
    "approvalState" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Communication" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channel" "ChannelType" NOT NULL,
    "direction" "CommunicationDirection" NOT NULL,
    "status" "CommunicationStatus" NOT NULL DEFAULT 'QUEUED',
    "leadId" TEXT,
    "contactId" TEXT,
    "accountId" TEXT,
    "opportunityId" TEXT,
    "ticketId" TEXT,
    "campaignId" TEXT,
    "templateId" TEXT,
    "fromAddress" TEXT,
    "toAddress" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT,
    "providerKey" TEXT,
    "providerMessageId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "queuedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "clickedAt" TIMESTAMP(3),
    "repliedAt" TIMESTAMP(3),
    "callDisposition" TEXT,
    "callRecordingUrl" TEXT,
    "durationSecs" INTEGER,
    "agentNotes" TEXT,
    "ownerId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "Communication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationProvider" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channel" "ChannelType" NOT NULL,
    "providerKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "configEncrypted" TEXT,
    "rateLimitPerMin" INTEGER,
    "quietHours" JSONB NOT NULL DEFAULT '{}',
    "lastTestedAt" TIMESTAMP(3),
    "lastTestResult" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunicationProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Form" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'LEAD_CAPTURE',
    "targetObject" TEXT NOT NULL DEFAULT 'LEAD',
    "state" "PublishState" NOT NULL DEFAULT 'DRAFT',
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "requiresAuth" BOOLEAN NOT NULL DEFAULT false,
    "successMessage" TEXT,
    "redirectUrl" TEXT,
    "captchaEnabled" BOOLEAN NOT NULL DEFAULT true,
    "submissionLimit" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "allowSaveDraft" BOOLEAN NOT NULL DEFAULT false,
    "layout" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Form_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormField" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "FieldType" NOT NULL,
    "sectionKey" TEXT,
    "stepIndex" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "placeholder" TEXT,
    "helpText" TEXT,
    "options" JSONB,
    "validationRule" JSONB,
    "conditionalLogic" JSONB,
    "calculation" TEXT,
    "mapsToField" TEXT,
    "maxFileSizeKb" INTEGER,
    "allowedFileTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormSubmission" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "leadId" TEXT,
    "ticketId" TEXT,
    "opportunityId" TEXT,
    "payload" JSONB NOT NULL,
    "isDraft" BOOLEAN NOT NULL DEFAULT false,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "referrerUrl" TEXT,
    "utm" JSONB NOT NULL DEFAULT '{}',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "submittedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FormSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LandingPage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "state" "PublishState" NOT NULL DEFAULT 'DRAFT',
    "customDomain" TEXT,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "socialImageUrl" TEXT,
    "blocks" JSONB NOT NULL DEFAULT '[]',
    "trackingScripts" TEXT,
    "formId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "visitCount" INTEGER NOT NULL DEFAULT 0,
    "submissionCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "LandingPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LandingPageVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "landingPageId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "blocks" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "LandingPageVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldVisit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leadId" TEXT,
    "accountId" TEXT,
    "taskId" TEXT,
    "plannedAt" TIMESTAMP(3),
    "checkInAt" TIMESTAMP(3),
    "checkInLat" DOUBLE PRECISION,
    "checkInLng" DOUBLE PRECISION,
    "checkInAccuracy" DOUBLE PRECISION,
    "checkInPhotoKey" TEXT,
    "checkOutAt" TIMESTAMP(3),
    "checkOutLat" DOUBLE PRECISION,
    "checkOutLng" DOUBLE PRECISION,
    "distanceMeters" INTEGER,
    "outcome" TEXT,
    "notes" TEXT,
    "geofenceOk" BOOLEAN,
    "locationSuspect" BOOLEAN NOT NULL DEFAULT false,
    "offlineCapturedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "FieldVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldAttendance" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "totalMinutes" INTEGER,
    "visitsPlanned" INTEGER NOT NULL DEFAULT 0,
    "visitsDone" INTEGER NOT NULL DEFAULT 0,
    "distanceMeters" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FieldAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketCategory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "defaultSlaId" TEXT,
    "defaultTeamId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SLA" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "firstResponseMins" INTEGER NOT NULL,
    "resolutionMins" INTEGER NOT NULL,
    "businessHoursOnly" BOOLEAN NOT NULL DEFAULT true,
    "workingHours" JSONB NOT NULL DEFAULT '{}',
    "holidayCalendarId" TEXT,
    "warningThresholdPct" INTEGER NOT NULL DEFAULT 80,
    "escalationChain" JSONB NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SLA_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HolidayCalendar" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dates" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HolidayCalendar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT,
    "contactId" TEXT,
    "leadId" TEXT,
    "accountId" TEXT,
    "productId" TEXT,
    "channel" "ChannelType" NOT NULL DEFAULT 'EMAIL',
    "categoryId" TEXT,
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "status" "TicketStatus" NOT NULL DEFAULT 'NEW',
    "agentId" TEXT,
    "teamId" TEXT,
    "slaId" TEXT,
    "firstResponseDueAt" TIMESTAMP(3),
    "resolutionDueAt" TIMESTAMP(3),
    "firstRespondedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "reopenedCount" INTEGER NOT NULL DEFAULT 0,
    "slaState" "SlaState" NOT NULL DEFAULT 'ON_TRACK',
    "escalatedAt" TIMESTAMP(3),
    "resolutionNotes" TEXT,
    "csatScore" INTEGER,
    "csatComment" TEXT,
    "parentTicketId" TEXT,
    "mergedIntoTicketId" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "customData" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketComment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT,
    "authorType" TEXT NOT NULL DEFAULT 'AGENT',
    "body" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "cannedResponseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CannedResponse" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "categoryId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CannedResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "storageKey" TEXT NOT NULL,
    "storageBucket" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "previousVersionId" TEXT,
    "status" "DocumentStatus" NOT NULL DEFAULT 'UPLOADED',
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "expiresAt" TIMESTAMP(3),
    "ownerId" TEXT,
    "leadId" TEXT,
    "opportunityId" TEXT,
    "accountId" TEXT,
    "ticketId" TEXT,
    "taskId" TEXT,
    "activityId" TEXT,
    "productId" TEXT,
    "isSensitive" BOOLEAN NOT NULL DEFAULT false,
    "scanState" TEXT NOT NULL DEFAULT 'PENDING',
    "scanResult" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmartView" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "ownerId" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'PERSONAL',
    "sharedTeamIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sharedRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "filterTree" JSONB NOT NULL DEFAULT '{}',
    "sortSpec" JSONB NOT NULL DEFAULT '[]',
    "columns" JSONB NOT NULL DEFAULT '[]',
    "quickActions" JSONB NOT NULL DEFAULT '[]',
    "position" INTEGER NOT NULL DEFAULT 0,
    "layout" TEXT NOT NULL DEFAULT 'TOP_TABS',
    "isDefaultForRoleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SmartView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedFilter" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "ownerId" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'PERSONAL',
    "filterTree" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedFilter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dashboard" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'PERSONAL',
    "sharedRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "layout" JSONB NOT NULL DEFAULT '[]',
    "isDefaultForRoleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Dashboard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardWidget" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dashboardId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "widgetType" TEXT NOT NULL,
    "dataSource" TEXT NOT NULL,
    "metricSpec" JSONB NOT NULL DEFAULT '{}',
    "filterTree" JSONB NOT NULL DEFAULT '{}',
    "drilldown" JSONB NOT NULL DEFAULT '{}',
    "gridX" INTEGER NOT NULL DEFAULT 0,
    "gridY" INTEGER NOT NULL DEFAULT 0,
    "gridW" INTEGER NOT NULL DEFAULT 4,
    "gridH" INTEGER NOT NULL DEFAULT 3,
    "requiredPermission" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DashboardWidget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "dataSource" TEXT NOT NULL,
    "columns" JSONB NOT NULL DEFAULT '[]',
    "filterTree" JSONB NOT NULL DEFAULT '{}',
    "groupBy" JSONB NOT NULL DEFAULT '[]',
    "aggregations" JSONB NOT NULL DEFAULT '[]',
    "calculatedFields" JSONB NOT NULL DEFAULT '[]',
    "sortSpec" JSONB NOT NULL DEFAULT '[]',
    "chartSpec" JSONB,
    "visibility" TEXT NOT NULL DEFAULT 'PERSONAL',
    "sharedRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ownerId" TEXT,
    "scheduleCron" TEXT,
    "scheduleRecipients" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "scheduleFormat" TEXT DEFAULT 'XLSX',
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "columnMapping" JSONB NOT NULL DEFAULT '{}',
    "duplicateStrategy" TEXT NOT NULL DEFAULT 'SKIP',
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "successRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "duplicateRows" INTEGER NOT NULL DEFAULT 0,
    "errorFileKey" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "requestedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'CSV',
    "columns" JSONB NOT NULL DEFAULT '[]',
    "filterTree" JSONB NOT NULL DEFAULT '{}',
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "storageKey" TEXT,
    "downloadExpiresAt" TIMESTAMP(3),
    "requestedById" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Integration" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "authMethod" TEXT NOT NULL,
    "configEncrypted" TEXT,
    "fieldMappings" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncStatus" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "lastErrorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "APIKey" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "roleId" TEXT,
    "ipAllowlist" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rateLimitPerMin" INTEGER NOT NULL DEFAULT 600,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "rotatedFromId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "APIKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Webhook" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "events" TEXT[],
    "signingSecretEnc" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "maxRetries" INTEGER NOT NULL DEFAULT 5,
    "lastDeliveryAt" TIMESTAMP(3),
    "lastStatusCode" INTEGER,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "Webhook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "statusCode" INTEGER,
    "responseBody" TEXT,
    "errorMessage" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "nextRetryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "objectType" TEXT,
    "recordId" TEXT,
    "actionUrl" TEXT,
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "readAt" TIMESTAMP(3),
    "channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorApiKeyId" TEXT,
    "actorType" TEXT NOT NULL DEFAULT 'USER',
    "event" "AuditEvent" NOT NULL,
    "objectType" TEXT,
    "recordId" TEXT,
    "fieldKey" TEXT,
    "previousValue" JSONB,
    "newValue" JSONB,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitCounter" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "bucketKey" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "windowEnd" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeTarget" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "campaignId" TEXT,
    "metric" "TargetMetric" NOT NULL,
    "period" "TargetPeriod" NOT NULL DEFAULT 'DAILY',
    "targetValue" INTEGER NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "EmployeeTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TargetProgress" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dateKey" TEXT NOT NULL,
    "achieved" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TargetProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Call" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT,
    "contactId" TEXT,
    "accountId" TEXT,
    "campaignId" TEXT,
    "callerId" TEXT NOT NULL,
    "direction" "CommunicationDirection" NOT NULL DEFAULT 'OUTBOUND',
    "status" "CallStatus" NOT NULL DEFAULT 'SCHEDULED',
    "outcome" "CallOutcome",
    "externalCallId" TEXT,
    "providerName" TEXT,
    "callerNumber" TEXT,
    "recipientNumber" TEXT,
    "startedAt" TIMESTAMP(3),
    "answeredAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "durationSecs" INTEGER,
    "notes" TEXT,
    "followUpAt" TIMESTAMP(3),
    "scriptId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Call_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recording" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "storageBucket" TEXT,
    "mimeType" TEXT NOT NULL DEFAULT 'audio/webm',
    "sizeBytes" INTEGER,
    "durationSecs" INTEGER,
    "encryptionKey" TEXT,
    "retainUntil" TIMESTAMP(3),
    "accessCount" INTEGER NOT NULL DEFAULT 0,
    "lastAccessedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recording_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecordingConsent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "consentGiven" BOOLEAN NOT NULL,
    "method" "ConsentMethod",
    "consentedBy" TEXT,
    "consentVersion" TEXT,
    "givenAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecordingConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transcript" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "provider" TEXT,
    "confidence" DOUBLE PRECISION,
    "wordCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transcript_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIAnalysis" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "status" "AnalysisStatus" NOT NULL DEFAULT 'PENDING',
    "modelId" TEXT,
    "summary" TEXT,
    "clientNeeds" JSONB NOT NULL DEFAULT '[]',
    "objections" JSONB NOT NULL DEFAULT '[]',
    "commitments" JSONB NOT NULL DEFAULT '[]',
    "buyingSignals" JSONB NOT NULL DEFAULT '[]',
    "risks" JSONB NOT NULL DEFAULT '[]',
    "nextSteps" JSONB NOT NULL DEFAULT '[]',
    "topicsDiscussed" JSONB NOT NULL DEFAULT '[]',
    "topicsMissed" JSONB NOT NULL DEFAULT '[]',
    "sentiment" TEXT,
    "sentimentScore" DOUBLE PRECISION,
    "suggestedStatus" TEXT,
    "complianceFlags" JSONB NOT NULL DEFAULT '[]',
    "uncertainItems" JSONB NOT NULL DEFAULT '[]',
    "rawOutput" JSONB,
    "humanCorrected" BOOLEAN NOT NULL DEFAULT false,
    "correctedById" TEXT,
    "correctedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "processingMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditScorecard" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "campaignId" TEXT,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "AuditScorecard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditCriterion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "scorecardId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AuditCriterion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallAudit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "scorecardId" TEXT NOT NULL,
    "overallScore" DOUBLE PRECISION,
    "maxScore" DOUBLE PRECISION,
    "status" "AnalysisStatus" NOT NULL DEFAULT 'PENDING',
    "criteriaScores" JSONB NOT NULL DEFAULT '[]',
    "missedPoints" JSONB NOT NULL DEFAULT '[]',
    "strengths" JSONB NOT NULL DEFAULT '[]',
    "risks" JSONB NOT NULL DEFAULT '[]',
    "suggestions" JSONB NOT NULL DEFAULT '[]',
    "nextAction" TEXT,
    "errorMessage" TEXT,
    "humanReviewed" BOOLEAN NOT NULL DEFAULT false,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUpTask" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT,
    "callId" TEXT,
    "campaignId" TEXT,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "completedAt" TIMESTAMP(3),
    "outcome" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "FollowUpTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationConnection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "webhookKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DISCONNECTED',
    "credentials" JSONB,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "externalUserId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "refreshToken" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "lastSyncAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "IntegrationConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "campaignId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "eventType" "EventType" NOT NULL DEFAULT 'PHYSICAL',
    "status" "EventStatus" NOT NULL DEFAULT 'DRAFT',
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Dubai',
    "hostId" TEXT,
    "location" TEXT,
    "address" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "meetingUrl" TEXT,
    "capacity" INTEGER,
    "registeredCount" INTEGER NOT NULL DEFAULT 0,
    "attendedCount" INTEGER NOT NULL DEFAULT 0,
    "externalCalendarId" TEXT,
    "externalMeetId" TEXT,
    "notes" TEXT,
    "reminderSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventInvitee" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "leadId" TEXT,
    "contactId" TEXT,
    "userId" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "name" TEXT,
    "rsvpStatus" "RsvpStatus" NOT NULL DEFAULT 'PENDING',
    "rsvpAt" TIMESTAMP(3),
    "rsvpChannel" "InviteChannel",
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inviteChannel" "InviteChannel" NOT NULL DEFAULT 'EMAIL',
    "inviteSentAt" TIMESTAMP(3),
    "inviteDelivered" BOOLEAN NOT NULL DEFAULT false,
    "reminderSentAt" TIMESTAMP(3),
    "checkedInAt" TIMESTAMP(3),
    "checkedOutAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventInvitee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignScript" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "CampaignScript_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignTalkingPoint" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "scriptId" TEXT,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CampaignTalkingPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignQualification" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "expectedAnswer" TEXT,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CampaignQualification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignMember" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'CALLER',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "CampaignMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE INDEX "Tenant_status_idx" ON "Tenant"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPlan_code_key" ON "SubscriptionPlan"("code");

-- CreateIndex
CREATE UNIQUE INDEX "TenantSubscription_tenantId_key" ON "TenantSubscription"("tenantId");

-- CreateIndex
CREATE INDEX "TenantSubscription_state_currentPeriodEnd_idx" ON "TenantSubscription"("state", "currentPeriodEnd");

-- CreateIndex
CREATE INDEX "ModuleEntitlement_tenantId_state_idx" ON "ModuleEntitlement"("tenantId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "ModuleEntitlement_tenantId_module_key" ON "ModuleEntitlement"("tenantId", "module");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationSetting_tenantId_key" ON "OrganizationSetting"("tenantId");

-- CreateIndex
CREATE INDEX "Region_tenantId_idx" ON "Region"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Region_tenantId_code_key" ON "Region"("tenantId", "code");

-- CreateIndex
CREATE INDEX "Branch_tenantId_regionId_idx" ON "Branch"("tenantId", "regionId");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_tenantId_code_key" ON "Branch"("tenantId", "code");

-- CreateIndex
CREATE INDEX "Territory_tenantId_idx" ON "Territory"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Territory_tenantId_code_key" ON "Territory"("tenantId", "code");

-- CreateIndex
CREATE INDEX "Department_tenantId_idx" ON "Department"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Department_tenantId_code_key" ON "Department"("tenantId", "code");

-- CreateIndex
CREATE INDEX "Team_tenantId_branchId_idx" ON "Team"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX "Team_tenantId_managerId_idx" ON "Team"("tenantId", "managerId");

-- CreateIndex
CREATE UNIQUE INDEX "Team_tenantId_code_key" ON "Team"("tenantId", "code");

-- CreateIndex
CREATE INDEX "User_tenantId_status_idx" ON "User"("tenantId", "status");

-- CreateIndex
CREATE INDEX "User_tenantId_roleId_idx" ON "User"("tenantId", "roleId");

-- CreateIndex
CREATE INDEX "User_tenantId_branchId_idx" ON "User"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX "User_tenantId_managerId_idx" ON "User"("tenantId", "managerId");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_tenantId_email_key" ON "User"("tenantId", "email");

-- CreateIndex
CREATE INDEX "UserTeam_tenantId_teamId_idx" ON "UserTeam"("tenantId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "UserTeam_userId_teamId_key" ON "UserTeam"("userId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_tenantId_userId_idx" ON "Session"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_tenantId_userId_idx" ON "PasswordResetToken"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

-- CreateIndex
CREATE INDEX "Role_tenantId_idx" ON "Role"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_tenantId_key_key" ON "Role"("tenantId", "key");

-- CreateIndex
CREATE INDEX "Permission_module_idx" ON "Permission"("module");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_module_action_key" ON "Permission"("module", "action");

-- CreateIndex
CREATE INDEX "RolePermission_tenantId_roleId_idx" ON "RolePermission"("tenantId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_roleId_permissionId_key" ON "RolePermission"("roleId", "permissionId");

-- CreateIndex
CREATE INDEX "FieldPermission_tenantId_objectType_idx" ON "FieldPermission"("tenantId", "objectType");

-- CreateIndex
CREATE UNIQUE INDEX "FieldPermission_roleId_objectType_fieldKey_key" ON "FieldPermission"("roleId", "objectType", "fieldKey");

-- CreateIndex
CREATE INDEX "LeadStage_tenantId_position_idx" ON "LeadStage"("tenantId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "LeadStage_tenantId_key_key" ON "LeadStage"("tenantId", "key");

-- CreateIndex
CREATE INDEX "Lead_tenantId_stageId_updatedAt_idx" ON "Lead"("tenantId", "stageId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "Lead_tenantId_ownerId_stageId_idx" ON "Lead"("tenantId", "ownerId", "stageId");

-- CreateIndex
CREATE INDEX "Lead_tenantId_email_idx" ON "Lead"("tenantId", "email");

-- CreateIndex
CREATE INDEX "Lead_tenantId_phoneNormalized_idx" ON "Lead"("tenantId", "phoneNormalized");

-- CreateIndex
CREATE INDEX "Lead_tenantId_createdAt_idx" ON "Lead"("tenantId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Lead_tenantId_nextFollowUpAt_idx" ON "Lead"("tenantId", "nextFollowUpAt");

-- CreateIndex
CREATE INDEX "Lead_tenantId_slaState_slaDueAt_idx" ON "Lead"("tenantId", "slaState", "slaDueAt");

-- CreateIndex
CREATE INDEX "Lead_tenantId_branchId_teamId_idx" ON "Lead"("tenantId", "branchId", "teamId");

-- CreateIndex
CREATE INDEX "Lead_tenantId_score_idx" ON "Lead"("tenantId", "score" DESC);

-- CreateIndex
CREATE INDEX "Lead_tenantId_deletedAt_idx" ON "Lead"("tenantId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_tenantId_reference_key" ON "Lead"("tenantId", "reference");

-- CreateIndex
CREATE INDEX "LeadCustomFieldDefinition_tenantId_objectType_displayOrder_idx" ON "LeadCustomFieldDefinition"("tenantId", "objectType", "displayOrder");

-- CreateIndex
CREATE UNIQUE INDEX "LeadCustomFieldDefinition_tenantId_objectType_key_key" ON "LeadCustomFieldDefinition"("tenantId", "objectType", "key");

-- CreateIndex
CREATE INDEX "LeadCustomFieldValue_tenantId_definitionId_valueText_idx" ON "LeadCustomFieldValue"("tenantId", "definitionId", "valueText");

-- CreateIndex
CREATE INDEX "LeadCustomFieldValue_tenantId_definitionId_valueNumber_idx" ON "LeadCustomFieldValue"("tenantId", "definitionId", "valueNumber");

-- CreateIndex
CREATE UNIQUE INDEX "LeadCustomFieldValue_leadId_definitionId_key" ON "LeadCustomFieldValue"("leadId", "definitionId");

-- CreateIndex
CREATE INDEX "LeadStageHistory_tenantId_leadId_createdAt_idx" ON "LeadStageHistory"("tenantId", "leadId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadStageHistory_tenantId_toStageId_createdAt_idx" ON "LeadStageHistory"("tenantId", "toStageId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadAssignmentHistory_tenantId_leadId_createdAt_idx" ON "LeadAssignmentHistory"("tenantId", "leadId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadAssignmentHistory_tenantId_toOwnerId_createdAt_idx" ON "LeadAssignmentHistory"("tenantId", "toOwnerId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadScoreHistory_tenantId_leadId_createdAt_idx" ON "LeadScoreHistory"("tenantId", "leadId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LeadTag_tenantId_name_key" ON "LeadTag"("tenantId", "name");

-- CreateIndex
CREATE INDEX "ScoringRule_tenantId_isActive_triggerType_idx" ON "ScoringRule"("tenantId", "isActive", "triggerType");

-- CreateIndex
CREATE INDEX "DuplicateRule_tenantId_objectType_isActive_idx" ON "DuplicateRule"("tenantId", "objectType", "isActive");

-- CreateIndex
CREATE INDEX "Account_tenantId_ownerId_idx" ON "Account"("tenantId", "ownerId");

-- CreateIndex
CREATE INDEX "Account_tenantId_name_idx" ON "Account"("tenantId", "name");

-- CreateIndex
CREATE INDEX "Account_tenantId_status_idx" ON "Account"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Account_tenantId_reference_key" ON "Account"("tenantId", "reference");

-- CreateIndex
CREATE INDEX "Contact_tenantId_accountId_idx" ON "Contact"("tenantId", "accountId");

-- CreateIndex
CREATE INDEX "Contact_tenantId_email_idx" ON "Contact"("tenantId", "email");

-- CreateIndex
CREATE INDEX "Contact_tenantId_phoneNormalized_idx" ON "Contact"("tenantId", "phoneNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_tenantId_reference_key" ON "Contact"("tenantId", "reference");

-- CreateIndex
CREATE INDEX "OpportunityType_tenantId_idx" ON "OpportunityType"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "OpportunityType_tenantId_key_key" ON "OpportunityType"("tenantId", "key");

-- CreateIndex
CREATE INDEX "Pipeline_tenantId_isActive_idx" ON "Pipeline"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Pipeline_tenantId_key_key" ON "Pipeline"("tenantId", "key");

-- CreateIndex
CREATE INDEX "PipelineStage_tenantId_pipelineId_position_idx" ON "PipelineStage"("tenantId", "pipelineId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineStage_pipelineId_key_key" ON "PipelineStage"("pipelineId", "key");

-- CreateIndex
CREATE INDEX "Opportunity_tenantId_pipelineId_stageId_idx" ON "Opportunity"("tenantId", "pipelineId", "stageId");

-- CreateIndex
CREATE INDEX "Opportunity_tenantId_ownerId_status_idx" ON "Opportunity"("tenantId", "ownerId", "status");

-- CreateIndex
CREATE INDEX "Opportunity_tenantId_expectedCloseDate_idx" ON "Opportunity"("tenantId", "expectedCloseDate");

-- CreateIndex
CREATE INDEX "Opportunity_tenantId_status_actualCloseDate_idx" ON "Opportunity"("tenantId", "status", "actualCloseDate");

-- CreateIndex
CREATE INDEX "Opportunity_tenantId_accountId_idx" ON "Opportunity"("tenantId", "accountId");

-- CreateIndex
CREATE INDEX "Opportunity_tenantId_leadId_idx" ON "Opportunity"("tenantId", "leadId");

-- CreateIndex
CREATE UNIQUE INDEX "Opportunity_tenantId_reference_key" ON "Opportunity"("tenantId", "reference");

-- CreateIndex
CREATE INDEX "OpportunityStageHistory_tenantId_opportunityId_createdAt_idx" ON "OpportunityStageHistory"("tenantId", "opportunityId", "createdAt");

-- CreateIndex
CREATE INDEX "OpportunityCollaborator_tenantId_userId_idx" ON "OpportunityCollaborator"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "OpportunityCollaborator_opportunityId_userId_key" ON "OpportunityCollaborator"("opportunityId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "LossReason_tenantId_name_key" ON "LossReason"("tenantId", "name");

-- CreateIndex
CREATE INDEX "Product_tenantId_status_category_idx" ON "Product"("tenantId", "status", "category");

-- CreateIndex
CREATE UNIQUE INDEX "Product_tenantId_code_key" ON "Product"("tenantId", "code");

-- CreateIndex
CREATE INDEX "OpportunityProduct_tenantId_opportunityId_idx" ON "OpportunityProduct"("tenantId", "opportunityId");

-- CreateIndex
CREATE INDEX "ActivityType_tenantId_isActive_idx" ON "ActivityType"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityType_tenantId_key_key" ON "ActivityType"("tenantId", "key");

-- CreateIndex
CREATE INDEX "Activity_tenantId_leadId_occurredAt_idx" ON "Activity"("tenantId", "leadId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "Activity_tenantId_ownerId_occurredAt_idx" ON "Activity"("tenantId", "ownerId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "Activity_tenantId_typeId_occurredAt_idx" ON "Activity"("tenantId", "typeId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "Activity_tenantId_opportunityId_idx" ON "Activity"("tenantId", "opportunityId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskType_tenantId_key_key" ON "TaskType"("tenantId", "key");

-- CreateIndex
CREATE INDEX "Task_tenantId_ownerId_status_dueAt_idx" ON "Task"("tenantId", "ownerId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "Task_tenantId_dueAt_idx" ON "Task"("tenantId", "dueAt");

-- CreateIndex
CREATE INDEX "Task_tenantId_leadId_idx" ON "Task"("tenantId", "leadId");

-- CreateIndex
CREATE INDEX "Task_tenantId_status_dueAt_idx" ON "Task"("tenantId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "DistributionRule_tenantId_objectType_isActive_position_idx" ON "DistributionRule"("tenantId", "objectType", "isActive", "position");

-- CreateIndex
CREATE INDEX "Automation_tenantId_objectType_state_idx" ON "Automation"("tenantId", "objectType", "state");

-- CreateIndex
CREATE INDEX "AutomationVersion_tenantId_automationId_idx" ON "AutomationVersion"("tenantId", "automationId");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationVersion_automationId_versionNumber_key" ON "AutomationVersion"("automationId", "versionNumber");

-- CreateIndex
CREATE INDEX "AutomationEnrollment_tenantId_status_resumeAt_idx" ON "AutomationEnrollment"("tenantId", "status", "resumeAt");

-- CreateIndex
CREATE INDEX "AutomationEnrollment_tenantId_objectType_recordId_idx" ON "AutomationEnrollment"("tenantId", "objectType", "recordId");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationEnrollment_automationId_recordId_idempotencyKey_key" ON "AutomationEnrollment"("automationId", "recordId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "AutomationExecution_tenantId_enrollmentId_startedAt_idx" ON "AutomationExecution"("tenantId", "enrollmentId", "startedAt");

-- CreateIndex
CREATE INDEX "AutomationExecution_tenantId_status_startedAt_idx" ON "AutomationExecution"("tenantId", "status", "startedAt");

-- CreateIndex
CREATE INDEX "Campaign_tenantId_status_startDate_idx" ON "Campaign"("tenantId", "status", "startDate");

-- CreateIndex
CREATE INDEX "Campaign_tenantId_campaignType_idx" ON "Campaign"("tenantId", "campaignType");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_tenantId_code_key" ON "Campaign"("tenantId", "code");

-- CreateIndex
CREATE INDEX "MarketingList_tenantId_listType_idx" ON "MarketingList"("tenantId", "listType");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingList_tenantId_name_key" ON "MarketingList"("tenantId", "name");

-- CreateIndex
CREATE INDEX "MarketingListMember_tenantId_listId_idx" ON "MarketingListMember"("tenantId", "listId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingListMember_listId_recordId_key" ON "MarketingListMember"("listId", "recordId");

-- CreateIndex
CREATE INDEX "EmailCampaign_tenantId_status_scheduledAt_idx" ON "EmailCampaign"("tenantId", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "MessageTemplate_tenantId_channel_isActive_idx" ON "MessageTemplate"("tenantId", "channel", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "MessageTemplate_tenantId_key_key" ON "MessageTemplate"("tenantId", "key");

-- CreateIndex
CREATE INDEX "Communication_tenantId_leadId_createdAt_idx" ON "Communication"("tenantId", "leadId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Communication_tenantId_channel_status_idx" ON "Communication"("tenantId", "channel", "status");

-- CreateIndex
CREATE INDEX "Communication_tenantId_providerMessageId_idx" ON "Communication"("tenantId", "providerMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationProvider_tenantId_channel_providerKey_key" ON "CommunicationProvider"("tenantId", "channel", "providerKey");

-- CreateIndex
CREATE INDEX "Form_tenantId_state_idx" ON "Form"("tenantId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "Form_tenantId_key_key" ON "Form"("tenantId", "key");

-- CreateIndex
CREATE INDEX "FormField_tenantId_formId_position_idx" ON "FormField"("tenantId", "formId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "FormField_formId_key_key" ON "FormField"("formId", "key");

-- CreateIndex
CREATE INDEX "FormSubmission_tenantId_formId_createdAt_idx" ON "FormSubmission"("tenantId", "formId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "FormSubmission_tenantId_leadId_idx" ON "FormSubmission"("tenantId", "leadId");

-- CreateIndex
CREATE INDEX "LandingPage_tenantId_state_idx" ON "LandingPage"("tenantId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "LandingPage_tenantId_slug_key" ON "LandingPage"("tenantId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "LandingPageVersion_landingPageId_versionNumber_key" ON "LandingPageVersion"("landingPageId", "versionNumber");

-- CreateIndex
CREATE INDEX "FieldVisit_tenantId_userId_plannedAt_idx" ON "FieldVisit"("tenantId", "userId", "plannedAt");

-- CreateIndex
CREATE INDEX "FieldVisit_tenantId_leadId_idx" ON "FieldVisit"("tenantId", "leadId");

-- CreateIndex
CREATE INDEX "FieldAttendance_tenantId_workDate_idx" ON "FieldAttendance"("tenantId", "workDate");

-- CreateIndex
CREATE UNIQUE INDEX "FieldAttendance_userId_workDate_key" ON "FieldAttendance"("userId", "workDate");

-- CreateIndex
CREATE INDEX "TicketCategory_tenantId_isActive_idx" ON "TicketCategory"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "TicketCategory_tenantId_name_parentId_key" ON "TicketCategory"("tenantId", "name", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "SLA_tenantId_name_key" ON "SLA"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "HolidayCalendar_tenantId_name_key" ON "HolidayCalendar"("tenantId", "name");

-- CreateIndex
CREATE INDEX "Ticket_tenantId_status_priority_idx" ON "Ticket"("tenantId", "status", "priority");

-- CreateIndex
CREATE INDEX "Ticket_tenantId_agentId_status_idx" ON "Ticket"("tenantId", "agentId", "status");

-- CreateIndex
CREATE INDEX "Ticket_tenantId_slaState_resolutionDueAt_idx" ON "Ticket"("tenantId", "slaState", "resolutionDueAt");

-- CreateIndex
CREATE INDEX "Ticket_tenantId_createdAt_idx" ON "Ticket"("tenantId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_tenantId_number_key" ON "Ticket"("tenantId", "number");

-- CreateIndex
CREATE INDEX "TicketComment_tenantId_ticketId_createdAt_idx" ON "TicketComment"("tenantId", "ticketId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CannedResponse_tenantId_title_key" ON "CannedResponse"("tenantId", "title");

-- CreateIndex
CREATE INDEX "Document_tenantId_leadId_idx" ON "Document"("tenantId", "leadId");

-- CreateIndex
CREATE INDEX "Document_tenantId_status_expiresAt_idx" ON "Document"("tenantId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "Document_tenantId_category_idx" ON "Document"("tenantId", "category");

-- CreateIndex
CREATE INDEX "SmartView_tenantId_objectType_ownerId_idx" ON "SmartView"("tenantId", "objectType", "ownerId");

-- CreateIndex
CREATE INDEX "SavedFilter_tenantId_objectType_ownerId_idx" ON "SavedFilter"("tenantId", "objectType", "ownerId");

-- CreateIndex
CREATE INDEX "Dashboard_tenantId_ownerId_idx" ON "Dashboard"("tenantId", "ownerId");

-- CreateIndex
CREATE INDEX "DashboardWidget_tenantId_dashboardId_idx" ON "DashboardWidget"("tenantId", "dashboardId");

-- CreateIndex
CREATE INDEX "Report_tenantId_dataSource_idx" ON "Report"("tenantId", "dataSource");

-- CreateIndex
CREATE INDEX "ImportJob_tenantId_status_createdAt_idx" ON "ImportJob"("tenantId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ExportJob_tenantId_status_createdAt_idx" ON "ExportJob"("tenantId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Integration_tenantId_category_isActive_idx" ON "Integration"("tenantId", "category", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Integration_tenantId_key_key" ON "Integration"("tenantId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "APIKey_prefix_key" ON "APIKey"("prefix");

-- CreateIndex
CREATE UNIQUE INDEX "APIKey_keyHash_key" ON "APIKey"("keyHash");

-- CreateIndex
CREATE INDEX "APIKey_tenantId_revokedAt_idx" ON "APIKey"("tenantId", "revokedAt");

-- CreateIndex
CREATE INDEX "Webhook_tenantId_isActive_idx" ON "Webhook"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "WebhookDelivery_tenantId_webhookId_createdAt_idx" ON "WebhookDelivery"("tenantId", "webhookId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "WebhookDelivery_nextRetryAt_idx" ON "WebhookDelivery"("nextRetryAt");

-- CreateIndex
CREATE INDEX "Notification_tenantId_userId_readAt_createdAt_idx" ON "Notification"("tenantId", "userId", "readAt", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_occurredAt_idx" ON "AuditLog"("tenantId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_objectType_recordId_occurredAt_idx" ON "AuditLog"("tenantId", "objectType", "recordId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_actorUserId_occurredAt_idx" ON "AuditLog"("tenantId", "actorUserId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_event_occurredAt_idx" ON "AuditLog"("tenantId", "event", "occurredAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "RateLimitCounter_bucketKey_key" ON "RateLimitCounter"("bucketKey");

-- CreateIndex
CREATE INDEX "RateLimitCounter_windowEnd_idx" ON "RateLimitCounter"("windowEnd");

-- CreateIndex
CREATE INDEX "EmployeeTarget_tenantId_userId_periodStart_periodEnd_idx" ON "EmployeeTarget"("tenantId", "userId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "EmployeeTarget_tenantId_campaignId_idx" ON "EmployeeTarget"("tenantId", "campaignId");

-- CreateIndex
CREATE INDEX "TargetProgress_tenantId_userId_dateKey_idx" ON "TargetProgress"("tenantId", "userId", "dateKey");

-- CreateIndex
CREATE UNIQUE INDEX "TargetProgress_targetId_dateKey_key" ON "TargetProgress"("targetId", "dateKey");

-- CreateIndex
CREATE INDEX "Call_tenantId_callerId_createdAt_idx" ON "Call"("tenantId", "callerId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Call_tenantId_leadId_createdAt_idx" ON "Call"("tenantId", "leadId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Call_tenantId_campaignId_createdAt_idx" ON "Call"("tenantId", "campaignId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Call_tenantId_status_idx" ON "Call"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Call_tenantId_providerName_externalCallId_key" ON "Call"("tenantId", "providerName", "externalCallId");

-- CreateIndex
CREATE UNIQUE INDEX "Recording_callId_key" ON "Recording"("callId");

-- CreateIndex
CREATE INDEX "Recording_tenantId_retainUntil_idx" ON "Recording"("tenantId", "retainUntil");

-- CreateIndex
CREATE UNIQUE INDEX "RecordingConsent_callId_key" ON "RecordingConsent"("callId");

-- CreateIndex
CREATE INDEX "RecordingConsent_tenantId_callId_idx" ON "RecordingConsent"("tenantId", "callId");

-- CreateIndex
CREATE UNIQUE INDEX "Transcript_callId_key" ON "Transcript"("callId");

-- CreateIndex
CREATE INDEX "Transcript_tenantId_callId_idx" ON "Transcript"("tenantId", "callId");

-- CreateIndex
CREATE UNIQUE INDEX "AIAnalysis_callId_key" ON "AIAnalysis"("callId");

-- CreateIndex
CREATE INDEX "AIAnalysis_tenantId_status_idx" ON "AIAnalysis"("tenantId", "status");

-- CreateIndex
CREATE INDEX "AIAnalysis_tenantId_callId_idx" ON "AIAnalysis"("tenantId", "callId");

-- CreateIndex
CREATE INDEX "AuditScorecard_tenantId_campaignId_idx" ON "AuditScorecard"("tenantId", "campaignId");

-- CreateIndex
CREATE INDEX "AuditCriterion_tenantId_scorecardId_position_idx" ON "AuditCriterion"("tenantId", "scorecardId", "position");

-- CreateIndex
CREATE INDEX "CallAudit_tenantId_callId_idx" ON "CallAudit"("tenantId", "callId");

-- CreateIndex
CREATE INDEX "CallAudit_tenantId_scorecardId_idx" ON "CallAudit"("tenantId", "scorecardId");

-- CreateIndex
CREATE INDEX "FollowUpTask_tenantId_ownerId_status_dueAt_idx" ON "FollowUpTask"("tenantId", "ownerId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "FollowUpTask_tenantId_leadId_idx" ON "FollowUpTask"("tenantId", "leadId");

-- CreateIndex
CREATE INDEX "FollowUpTask_tenantId_callId_idx" ON "FollowUpTask"("tenantId", "callId");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationConnection_webhookKey_key" ON "IntegrationConnection"("webhookKey");

-- CreateIndex
CREATE INDEX "IntegrationConnection_tenantId_idx" ON "IntegrationConnection"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationConnection_tenantId_provider_key" ON "IntegrationConnection"("tenantId", "provider");

-- CreateIndex
CREATE INDEX "WebhookEvent_provider_processed_createdAt_idx" ON "WebhookEvent"("provider", "processed", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_tenantId_provider_externalId_key" ON "WebhookEvent"("tenantId", "provider", "externalId");

-- CreateIndex
CREATE INDEX "Event_tenantId_status_startAt_idx" ON "Event"("tenantId", "status", "startAt");

-- CreateIndex
CREATE INDEX "Event_tenantId_campaignId_idx" ON "Event"("tenantId", "campaignId");

-- CreateIndex
CREATE INDEX "Event_tenantId_hostId_idx" ON "Event"("tenantId", "hostId");

-- CreateIndex
CREATE INDEX "EventInvitee_tenantId_eventId_rsvpStatus_idx" ON "EventInvitee"("tenantId", "eventId", "rsvpStatus");

-- CreateIndex
CREATE INDEX "EventInvitee_tenantId_leadId_idx" ON "EventInvitee"("tenantId", "leadId");

-- CreateIndex
CREATE UNIQUE INDEX "EventInvitee_eventId_leadId_key" ON "EventInvitee"("eventId", "leadId");

-- CreateIndex
CREATE INDEX "CampaignScript_tenantId_campaignId_position_idx" ON "CampaignScript"("tenantId", "campaignId", "position");

-- CreateIndex
CREATE INDEX "CampaignTalkingPoint_tenantId_campaignId_position_idx" ON "CampaignTalkingPoint"("tenantId", "campaignId", "position");

-- CreateIndex
CREATE INDEX "CampaignQualification_tenantId_campaignId_position_idx" ON "CampaignQualification"("tenantId", "campaignId", "position");

-- CreateIndex
CREATE INDEX "CampaignMember_tenantId_campaignId_idx" ON "CampaignMember"("tenantId", "campaignId");

-- CreateIndex
CREATE INDEX "CampaignMember_tenantId_userId_idx" ON "CampaignMember"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignMember_campaignId_userId_key" ON "CampaignMember"("campaignId", "userId");

-- AddForeignKey
ALTER TABLE "TenantSubscription" ADD CONSTRAINT "TenantSubscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantSubscription" ADD CONSTRAINT "TenantSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModuleEntitlement" ADD CONSTRAINT "ModuleEntitlement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationSetting" ADD CONSTRAINT "OrganizationSetting_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Region" ADD CONSTRAINT "Region_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_parentTeamId_fkey" FOREIGN KEY ("parentTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTeam" ADD CONSTRAINT "UserTeam_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTeam" ADD CONSTRAINT "UserTeam_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "LeadStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadCustomFieldValue" ADD CONSTRAINT "LeadCustomFieldValue_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadCustomFieldValue" ADD CONSTRAINT "LeadCustomFieldValue_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "LeadCustomFieldDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadStageHistory" ADD CONSTRAINT "LeadStageHistory_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAssignmentHistory" ADD CONSTRAINT "LeadAssignmentHistory_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadScoreHistory" ADD CONSTRAINT "LeadScoreHistory_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_parentAccountId_fkey" FOREIGN KEY ("parentAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pipeline" ADD CONSTRAINT "Pipeline_opportunityTypeId_fkey" FOREIGN KEY ("opportunityTypeId") REFERENCES "OpportunityType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineStage" ADD CONSTRAINT "PipelineStage_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "OpportunityType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "PipelineStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityStageHistory" ADD CONSTRAINT "OpportunityStageHistory_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityCollaborator" ADD CONSTRAINT "OpportunityCollaborator_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityProduct" ADD CONSTRAINT "OpportunityProduct_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityProduct" ADD CONSTRAINT "OpportunityProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "ActivityType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "TaskType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationVersion" ADD CONSTRAINT "AutomationVersion_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationEnrollment" ADD CONSTRAINT "AutomationEnrollment_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationEnrollment" ADD CONSTRAINT "AutomationEnrollment_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "AutomationVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationExecution" ADD CONSTRAINT "AutomationExecution_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "AutomationEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingListMember" ADD CONSTRAINT "MarketingListMember_listId_fkey" FOREIGN KEY ("listId") REFERENCES "MarketingList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailCampaign" ADD CONSTRAINT "EmailCampaign_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Communication" ADD CONSTRAINT "Communication_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormField" ADD CONSTRAINT "FormField_formId_fkey" FOREIGN KEY ("formId") REFERENCES "Form"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_formId_fkey" FOREIGN KEY ("formId") REFERENCES "Form"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LandingPageVersion" ADD CONSTRAINT "LandingPageVersion_landingPageId_fkey" FOREIGN KEY ("landingPageId") REFERENCES "LandingPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketCategory" ADD CONSTRAINT "TicketCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "TicketCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TicketCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_slaId_fkey" FOREIGN KEY ("slaId") REFERENCES "SLA"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_parentTicketId_fkey" FOREIGN KEY ("parentTicketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketComment" ADD CONSTRAINT "TicketComment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardWidget" ADD CONSTRAINT "DashboardWidget_dashboardId_fkey" FOREIGN KEY ("dashboardId") REFERENCES "Dashboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "Webhook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeTarget" ADD CONSTRAINT "EmployeeTarget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TargetProgress" ADD CONSTRAINT "TargetProgress_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "EmployeeTarget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_callerId_fkey" FOREIGN KEY ("callerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recording" ADD CONSTRAINT "Recording_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordingConsent" ADD CONSTRAINT "RecordingConsent_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transcript" ADD CONSTRAINT "Transcript_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIAnalysis" ADD CONSTRAINT "AIAnalysis_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditCriterion" ADD CONSTRAINT "AuditCriterion_scorecardId_fkey" FOREIGN KEY ("scorecardId") REFERENCES "AuditScorecard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallAudit" ADD CONSTRAINT "CallAudit_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventInvitee" ADD CONSTRAINT "EventInvitee_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignTalkingPoint" ADD CONSTRAINT "CampaignTalkingPoint_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "CampaignScript"("id") ON DELETE SET NULL ON UPDATE CASCADE;
