-- Every tenant-scoped table gets its foreign key.
--
-- 131 of the 177 tables carrying a `tenantId` had no constraint behind it, so
-- deleting a workspace removed the rows in the 46 that did and silently
-- abandoned the rest. On the development database that had left 318,666 rows
-- belonging to workspaces that no longer existed — 308,703 of them
-- RolePermission, held alive by 951 orphaned Roles.
--
-- Nothing read those rows: row-level security matches `tenantId` against the
-- session's workspace, and a deleted workspace can never be one. But everything
-- that aggregates across tenants counted them. The permission backfill reported
-- granting 121,891 permissions against a database with seven workspaces,
-- because most of it landed on roles nobody could reach.
--
-- CASCADE, and it is safe: no product code hard-deletes a Tenant. Every path in
-- src/ soft-deletes by setting `deletedAt`, so this fires only when somebody
-- deliberately removes a workspace — a teardown or an operator — which is
-- exactly when its rows should go too. The 46 tables that already had the
-- constraint already had CASCADE.
--
-- ── How this is applied ────────────────────────────────────────────────────
--
--   1. Sweep rows whose workspace is already gone. A constraint cannot be
--      validated while a row violates it, and an operator having run
--      scripts/clean-orphaned-rows.mjs first is a hope rather than a guarantee.
--   2. ADD CONSTRAINT ... NOT VALID, and only where one is not already present.
--      All 177 are listed rather than the 131 that were missing, so this is
--      correct on a database built by replaying every migration (where 46
--      already exist) and on one that has drifted. NOT VALID takes a brief lock
--      and skips the scan; from that moment no *new* row can be orphaned.
--   3. VALIDATE CONSTRAINT, which scans under SHARE UPDATE EXCLUSIVE and does
--      not block reads or writes.
--
-- Splitting 2 from 3 is the whole reason this is not one statement per table.

-- ── 1. Rows whose workspace is already gone ────────────────────────────────
--
-- Repeated passes rather than a hand-maintained order: these tables reference
-- each other, so a parent can fail on a child not yet cleared.
DO $$
DECLARE
  target TEXT;
  removed BIGINT;
  pass INT;
  covered CONSTANT TEXT[] := ARRAY[
    'AIAnalysis',
    'APIKey',
    'Account',
    'Activity',
    'ActivityType',
    'AllocationRequest',
    'Amenity',
    'AuditCriterion',
    'AuditLog',
    'AuditScorecard',
    'Automation',
    'AutomationEnrollment',
    'AutomationExecution',
    'AutomationVersion',
    'BillingEvent',
    'BiometricConsent',
    'Booking',
    'Branch',
    'Call',
    'CallAudit',
    'Campaign',
    'CampaignContact',
    'CampaignMember',
    'CampaignQualification',
    'CampaignScript',
    'CampaignTalkingPoint',
    'CannedResponse',
    'ClientProfile',
    'ClientRequirement',
    'Commission',
    'CommissionSlab',
    'CommissionSlabBand',
    'Communication',
    'CommunicationProvider',
    'Contact',
    'Contest',
    'ContestStanding',
    'Dashboard',
    'DashboardWidget',
    'Department',
    'Designation',
    'Developer',
    'DialerSession',
    'DistributionRule',
    'Document',
    'DuplicateRule',
    'EmailCampaign',
    'EmployeeProfile',
    'EmployeeTarget',
    'Event',
    'EventInvitee',
    'ExportJob',
    'FieldAttendance',
    'FieldPermission',
    'FieldVisit',
    'FollowUpTask',
    'Form',
    'FormField',
    'FormSubmission',
    'HolidayCalendar',
    'HrAttendanceExceptionRequest',
    'HrAttendancePunch',
    'HrAttendanceRecord',
    'HrCandidate',
    'HrCandidateStageEvent',
    'HrChecklistTask',
    'HrCompensation',
    'HrCompetency',
    'HrEmployeeDocument',
    'HrEmployeeLocationAssignment',
    'HrEmployeeShift',
    'HrFaceTemplate',
    'HrGoal',
    'HrHoliday',
    'HrInterview',
    'HrInterviewFeedback',
    'HrLeaveBalance',
    'HrLeaveRequest',
    'HrLeaveType',
    'HrOffboardingCase',
    'HrOffer',
    'HrOvertimeRequest',
    'HrPayrollAdjustment',
    'HrPayrollRun',
    'HrPayslip',
    'HrPayslipLine',
    'HrPip',
    'HrPipCheckpoint',
    'HrRequisition',
    'HrReview',
    'HrReviewCompetencyScore',
    'HrReviewCycle',
    'HrRosterEntry',
    'HrSettlementSnapshot',
    'HrShift',
    'HrShiftChangeRequest',
    'HrTemporaryLocationRequest',
    'HrWorkLocation',
    'ImportJob',
    'Integration',
    'IntegrationConnection',
    'LandingPage',
    'LandingPageVersion',
    'Lead',
    'LeadAssignmentHistory',
    'LeadCustomFieldDefinition',
    'LeadCustomFieldValue',
    'LeadScoreHistory',
    'LeadStage',
    'LeadStageHistory',
    'LeadTag',
    'Listing',
    'ListingMedia',
    'LossReason',
    'Mandate',
    'MarketingList',
    'MarketingListMember',
    'MembershipRole',
    'MessageTemplate',
    'Micromarket',
    'ModuleEntitlement',
    'Nomination',
    'NominationVote',
    'Notification',
    'Opportunity',
    'OpportunityCollaborator',
    'OpportunityProduct',
    'OpportunityStageHistory',
    'OpportunityType',
    'OrganizationSetting',
    'Owner',
    'PasswordResetToken',
    'Payout',
    'Pipeline',
    'PipelineStage',
    'PlatformAuditEvent',
    'Post',
    'PostReaction',
    'Product',
    'Project',
    'ProjectFavourite',
    'ProjectMedia',
    'RateLimitCounter',
    'Recording',
    'RecordingConsent',
    'Referral',
    'ReferralCode',
    'Region',
    'Report',
    'Role',
    'RolePermission',
    'SLA',
    'SavedFilter',
    'ScoringRule',
    'SiteVisit',
    'SmartView',
    'TargetProgress',
    'Task',
    'TaskType',
    'Team',
    'TenantSubscription',
    'Territory',
    'Testimonial',
    'Ticket',
    'TicketCategory',
    'TicketComment',
    'Transcript',
    'UnitInventory',
    'UnitPlan',
    'User',
    'UserTeam',
    'Webhook',
    'WebhookDelivery',
    'WebhookEvent',
    'WorkspaceInvitation',
    'WorkspaceMembership',
    'WorkspaceUsage'
  ];
BEGIN
  FOR pass IN 1..5 LOOP
    FOREACH target IN ARRAY covered LOOP
      BEGIN
        EXECUTE format(
          'DELETE FROM %I x WHERE x."tenantId" IS NOT NULL '
          'AND NOT EXISTS (SELECT 1 FROM "Tenant" t WHERE t.id = x."tenantId")',
          target
        );
        GET DIAGNOSTICS removed = ROW_COUNT;
        IF removed > 0 THEN
          RAISE NOTICE 'pass %: removed % orphaned row(s) from %', pass, removed, target;
        END IF;
      EXCEPTION
        WHEN foreign_key_violation THEN
          -- A child elsewhere still points at these. A later pass gets them.
          NULL;
        WHEN check_violation THEN
          -- Removing an orphan can null a column on a row that is *not* an
          -- orphan, through an ON DELETE SET NULL reference, and that row may
          -- then fail its own check constraint. An orphaned Project under a
          -- live Booking does exactly this to Booking_subject_check. Left in
          -- place; phase 3 names whatever could not be validated.
          NULL;
      END;
    END LOOP;
  END LOOP;
END $$;

-- ── 2 and 3. Add what is missing, then validate what can be validated ──────
--
-- A constraint that cannot be validated — because a row survived phase 1 —
-- stays NOT VALID rather than failing the deployment. It still enforces on
-- every new and updated row, which is what stops the problem growing, and the
-- warning names the table so the residue is dealt with deliberately.
DO $$
DECLARE
  entry TEXT[];
  added INT := 0;
  present INT := 0;
  unvalidated TEXT[] := ARRAY[]::TEXT[];
  entries CONSTANT TEXT[][] := ARRAY[
    ARRAY['AIAnalysis', 'AIAnalysis_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['APIKey', 'APIKey_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['Account', 'Account_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['Activity', 'Activity_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['ActivityType', 'ActivityType_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['AllocationRequest', 'AllocationRequest_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['Amenity', 'Amenity_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['AuditCriterion', 'AuditCriterion_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['AuditLog', 'AuditLog_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['AuditScorecard', 'AuditScorecard_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['Automation', 'Automation_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['AutomationEnrollment', 'AutomationEnrollment_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['AutomationExecution', 'AutomationExecution_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['AutomationVersion', 'AutomationVersion_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['BillingEvent', 'BillingEvent_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['BiometricConsent', 'BiometricConsent_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['Booking', 'Booking_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['Branch', 'Branch_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['Call', 'Call_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['CallAudit', 'CallAudit_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['Campaign', 'Campaign_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['CampaignContact', 'CampaignContact_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['CampaignMember', 'CampaignMember_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['CampaignQualification', 'CampaignQualification_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['CampaignScript', 'CampaignScript_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['CampaignTalkingPoint', 'CampaignTalkingPoint_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['CannedResponse', 'CannedResponse_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['ClientProfile', 'ClientProfile_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['ClientRequirement', 'ClientRequirement_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['Commission', 'Commission_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['CommissionSlab', 'CommissionSlab_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['CommissionSlabBand', 'CommissionSlabBand_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['Communication', 'Communication_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['CommunicationProvider', 'CommunicationProvider_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['Contact', 'Contact_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['Contest', 'Contest_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['ContestStanding', 'ContestStanding_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['Dashboard', 'Dashboard_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['DashboardWidget', 'DashboardWidget_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['Department', 'Department_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['Designation', 'Designation_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['Developer', 'Developer_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['DialerSession', 'DialerSession_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['DistributionRule', 'DistributionRule_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['Document', 'Document_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['DuplicateRule', 'DuplicateRule_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['EmailCampaign', 'EmailCampaign_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['EmployeeProfile', 'EmployeeProfile_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['EmployeeTarget', 'EmployeeTarget_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['Event', 'Event_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['EventInvitee', 'EventInvitee_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['ExportJob', 'ExportJob_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['FieldAttendance', 'FieldAttendance_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['FieldPermission', 'FieldPermission_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['FieldVisit', 'FieldVisit_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['FollowUpTask', 'FollowUpTask_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['Form', 'Form_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['FormField', 'FormField_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['FormSubmission', 'FormSubmission_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['HolidayCalendar', 'HolidayCalendar_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['HrAttendanceExceptionRequest', 'HrAttendanceExceptionRequest_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['HrAttendancePunch', 'HrAttendancePunch_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['HrAttendanceRecord', 'HrAttendanceRecord_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['HrCandidate', 'HrCandidate_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['HrCandidateStageEvent', 'HrCandidateStageEvent_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['HrChecklistTask', 'HrChecklistTask_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['HrCompensation', 'HrCompensation_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['HrCompetency', 'HrCompetency_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['HrEmployeeDocument', 'HrEmployeeDocument_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['HrEmployeeLocationAssignment', 'HrEmployeeLocationAssignment_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['HrEmployeeShift', 'HrEmployeeShift_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['HrFaceTemplate', 'HrFaceTemplate_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['HrGoal', 'HrGoal_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['HrHoliday', 'HrHoliday_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['HrInterview', 'HrInterview_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['HrInterviewFeedback', 'HrInterviewFeedback_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['HrLeaveBalance', 'HrLeaveBalance_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['HrLeaveRequest', 'HrLeaveRequest_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['HrLeaveType', 'HrLeaveType_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['HrOffboardingCase', 'HrOffboardingCase_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['HrOffer', 'HrOffer_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['HrOvertimeRequest', 'HrOvertimeRequest_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['HrPayrollAdjustment', 'HrPayrollAdjustment_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['HrPayrollRun', 'HrPayrollRun_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['HrPayslip', 'HrPayslip_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['HrPayslipLine', 'HrPayslipLine_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['HrPip', 'HrPip_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['HrPipCheckpoint', 'HrPipCheckpoint_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['HrRequisition', 'HrRequisition_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['HrReview', 'HrReview_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['HrReviewCompetencyScore', 'HrReviewCompetencyScore_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['HrReviewCycle', 'HrReviewCycle_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['HrRosterEntry', 'HrRosterEntry_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['HrSettlementSnapshot', 'HrSettlementSnapshot_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['HrShift', 'HrShift_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['HrShiftChangeRequest', 'HrShiftChangeRequest_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['HrTemporaryLocationRequest', 'HrTemporaryLocationRequest_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['HrWorkLocation', 'HrWorkLocation_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['ImportJob', 'ImportJob_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['Integration', 'Integration_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['IntegrationConnection', 'IntegrationConnection_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['LandingPage', 'LandingPage_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['LandingPageVersion', 'LandingPageVersion_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['Lead', 'Lead_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['LeadAssignmentHistory', 'LeadAssignmentHistory_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['LeadCustomFieldDefinition', 'LeadCustomFieldDefinition_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['LeadCustomFieldValue', 'LeadCustomFieldValue_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['LeadScoreHistory', 'LeadScoreHistory_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['LeadStage', 'LeadStage_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['LeadStageHistory', 'LeadStageHistory_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['LeadTag', 'LeadTag_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['Listing', 'Listing_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['ListingMedia', 'ListingMedia_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['LossReason', 'LossReason_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['Mandate', 'Mandate_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['MarketingList', 'MarketingList_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['MarketingListMember', 'MarketingListMember_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['MembershipRole', 'MembershipRole_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['MessageTemplate', 'MessageTemplate_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['Micromarket', 'Micromarket_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['ModuleEntitlement', 'ModuleEntitlement_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['Nomination', 'Nomination_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['NominationVote', 'NominationVote_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['Notification', 'Notification_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['Opportunity', 'Opportunity_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['OpportunityCollaborator', 'OpportunityCollaborator_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['OpportunityProduct', 'OpportunityProduct_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['OpportunityStageHistory', 'OpportunityStageHistory_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['OpportunityType', 'OpportunityType_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['OrganizationSetting', 'OrganizationSetting_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['Owner', 'Owner_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['PasswordResetToken', 'PasswordResetToken_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['Payout', 'Payout_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['Pipeline', 'Pipeline_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['PipelineStage', 'PipelineStage_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['PlatformAuditEvent', 'PlatformAuditEvent_tenantId_fkey', 'ON DELETE SET NULL ON UPDATE CASCADE'],
    ARRAY['Post', 'Post_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['PostReaction', 'PostReaction_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['Product', 'Product_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['Project', 'Project_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['ProjectFavourite', 'ProjectFavourite_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['ProjectMedia', 'ProjectMedia_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['RateLimitCounter', 'RateLimitCounter_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['Recording', 'Recording_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['RecordingConsent', 'RecordingConsent_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['Referral', 'Referral_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['ReferralCode', 'ReferralCode_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['Region', 'Region_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['Report', 'Report_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['Role', 'Role_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['RolePermission', 'RolePermission_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['SLA', 'SLA_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['SavedFilter', 'SavedFilter_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['ScoringRule', 'ScoringRule_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['SiteVisit', 'SiteVisit_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['SmartView', 'SmartView_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['TargetProgress', 'TargetProgress_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['Task', 'Task_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['TaskType', 'TaskType_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['Team', 'Team_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['TenantSubscription', 'TenantSubscription_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['Territory', 'Territory_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['Testimonial', 'Testimonial_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['Ticket', 'Ticket_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['TicketCategory', 'TicketCategory_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['TicketComment', 'TicketComment_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['Transcript', 'Transcript_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['UnitInventory', 'UnitInventory_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['UnitPlan', 'UnitPlan_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['User', 'User_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['UserTeam', 'UserTeam_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['Webhook', 'Webhook_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['WebhookDelivery', 'WebhookDelivery_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['WebhookEvent', 'WebhookEvent_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['WorkspaceInvitation', 'WorkspaceInvitation_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['WorkspaceMembership', 'WorkspaceMembership_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'],
    ARRAY['WorkspaceUsage', 'WorkspaceUsage_tenantId_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE']
  ];
BEGIN
  FOREACH entry SLICE 1 IN ARRAY entries LOOP
    IF EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = entry[2] AND conrelid = format('%I', entry[1])::regclass
    ) THEN
      present := present + 1;
    ELSE
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") %s NOT VALID',
        entry[1], entry[2], entry[3]
      );
      added := added + 1;
    END IF;

    BEGIN
      EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', entry[1], entry[2]);
    EXCEPTION WHEN OTHERS THEN
      unvalidated := unvalidated || entry[1];
    END;
  END LOOP;

  RAISE NOTICE 'tenant foreign keys: % added, % already present', added, present;
  IF array_length(unvalidated, 1) > 0 THEN
    RAISE WARNING 'Left NOT VALID (still enforced for new rows), rows predate the constraint: %',
      array_to_string(unvalidated, ', ');
  END IF;
END $$;
