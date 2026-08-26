-- Index every foreign key that had no index at all.
--
-- Postgres indexes the *referenced* side of a foreign key automatically (it must
-- be unique) and the *referencing* side not at all. Eighty-six columns here were
-- therefore unindexed, and every one of them turns a parent delete into a
-- sequential scan of the child table: to enforce ON DELETE CASCADE or SET NULL,
-- Postgres has to find the referencing rows, and with no index it reads the
-- whole table. One delete, one full scan, per child table.
--
-- The three worst clusters, by parent:
--
--   EmployeeProfile  21 children — offboarding an employee scanned 21 HR tables
--   Account           6 children
--   Tenant            2 children — LandingPageVersion and one more were scanned
--                                  on every workspace deletion, which is also
--                                  what the test suite does in teardown
--
-- Nothing here changes behaviour or shape: these are pure additions, and the
-- planner may also use them for ordinary joins on the same columns.
--
-- Composite indexes that merely *contain* the column were not counted as
-- coverage: `@@index([tenantId, leadId])` cannot serve a lookup by `leadId`
-- alone, which is exactly the shape a cascade issues. Columns already leading an
-- index, or appearing anywhere in one, were left alone — no duplicates are
-- created here.
--
-- ponytail: plain CREATE INDEX, which takes a brief ACCESS EXCLUSIVE lock per
-- table. That is right for tables of this size and for a deploy window. If a
-- table here ever grows past a few million rows, split it out and use CREATE
-- INDEX CONCURRENTLY, which cannot run inside a migration's transaction.

-- CreateIndex
CREATE INDEX "Account_parentAccountId_idx" ON "Account"("parentAccountId");
-- CreateIndex
CREATE INDEX "Activity_accountId_idx" ON "Activity"("accountId");
-- CreateIndex
CREATE INDEX "AutomationEnrollment_versionId_idx" ON "AutomationEnrollment"("versionId");
-- CreateIndex
CREATE INDEX "BillingEvent_subscriptionId_idx" ON "BillingEvent"("subscriptionId");
-- CreateIndex
CREATE INDEX "Booking_listingId_idx" ON "Booking"("listingId");
-- CreateIndex
CREATE INDEX "Booking_unitInventoryId_idx" ON "Booking"("unitInventoryId");
-- CreateIndex
CREATE INDEX "Campaign_ownerId_idx" ON "Campaign"("ownerId");
-- CreateIndex
CREATE INDEX "CampaignTalkingPoint_scriptId_idx" ON "CampaignTalkingPoint"("scriptId");
-- CreateIndex
CREATE INDEX "Commission_slabId_idx" ON "Commission"("slabId");
-- CreateIndex
CREATE INDEX "Contact_ownerId_idx" ON "Contact"("ownerId");
-- CreateIndex
CREATE INDEX "Document_accountId_idx" ON "Document"("accountId");
-- CreateIndex
CREATE INDEX "Document_activityId_idx" ON "Document"("activityId");
-- CreateIndex
CREATE INDEX "Document_opportunityId_idx" ON "Document"("opportunityId");
-- CreateIndex
CREATE INDEX "Document_productId_idx" ON "Document"("productId");
-- CreateIndex
CREATE INDEX "Document_taskId_idx" ON "Document"("taskId");
-- CreateIndex
CREATE INDEX "Document_ticketId_idx" ON "Document"("ticketId");
-- CreateIndex
CREATE INDEX "EmailCampaign_campaignId_idx" ON "EmailCampaign"("campaignId");
-- CreateIndex
CREATE INDEX "EmployeeProfile_departmentId_idx" ON "EmployeeProfile"("departmentId");
-- CreateIndex
CREATE INDEX "EmployeeProfile_designationId_idx" ON "EmployeeProfile"("designationId");
-- CreateIndex
CREATE INDEX "EmployeeProfile_hiredFromCandidateId_idx" ON "EmployeeProfile"("hiredFromCandidateId");
-- CreateIndex
CREATE INDEX "HrAttendanceExceptionRequest_createdPunchId_idx" ON "HrAttendanceExceptionRequest"("createdPunchId");
-- CreateIndex
CREATE INDEX "HrAttendanceExceptionRequest_hrId_idx" ON "HrAttendanceExceptionRequest"("hrId");
-- CreateIndex
CREATE INDEX "HrAttendanceExceptionRequest_managerId_idx" ON "HrAttendanceExceptionRequest"("managerId");
-- CreateIndex
CREATE INDEX "HrAttendanceExceptionRequest_nearestLocationId_idx" ON "HrAttendanceExceptionRequest"("nearestLocationId");
-- CreateIndex
CREATE INDEX "HrAttendancePunch_locationId_idx" ON "HrAttendancePunch"("locationId");
-- CreateIndex
CREATE INDEX "HrAttendanceRecord_locationId_idx" ON "HrAttendanceRecord"("locationId");
-- CreateIndex
CREATE INDEX "HrChecklistTask_completedById_idx" ON "HrChecklistTask"("completedById");
-- CreateIndex
CREATE INDEX "HrEmployeeLocationAssignment_assignedById_idx" ON "HrEmployeeLocationAssignment"("assignedById");
-- CreateIndex
CREATE INDEX "HrEmployeeShift_shiftId_idx" ON "HrEmployeeShift"("shiftId");
-- CreateIndex
CREATE INDEX "HrLeaveRequest_approverId_idx" ON "HrLeaveRequest"("approverId");
-- CreateIndex
CREATE INDEX "HrLeaveRequest_leaveTypeId_idx" ON "HrLeaveRequest"("leaveTypeId");
-- CreateIndex
CREATE INDEX "HrOffboardingCase_startedById_idx" ON "HrOffboardingCase"("startedById");
-- CreateIndex
CREATE INDEX "HrOffer_approvedById_idx" ON "HrOffer"("approvedById");
-- CreateIndex
CREATE INDEX "HrOvertimeRequest_approverId_idx" ON "HrOvertimeRequest"("approverId");
-- CreateIndex
CREATE INDEX "HrOvertimeRequest_requestedById_idx" ON "HrOvertimeRequest"("requestedById");
-- CreateIndex
CREATE INDEX "HrPayrollRun_approvedById_idx" ON "HrPayrollRun"("approvedById");
-- CreateIndex
CREATE INDEX "HrPayrollRun_preparedById_idx" ON "HrPayrollRun"("preparedById");
-- CreateIndex
CREATE INDEX "HrPip_managerId_idx" ON "HrPip"("managerId");
-- CreateIndex
CREATE INDEX "HrRequisition_approvedById_idx" ON "HrRequisition"("approvedById");
-- CreateIndex
CREATE INDEX "HrRequisition_departmentId_idx" ON "HrRequisition"("departmentId");
-- CreateIndex
CREATE INDEX "HrRequisition_hiringManagerId_idx" ON "HrRequisition"("hiringManagerId");
-- CreateIndex
CREATE INDEX "HrRequisition_locationId_idx" ON "HrRequisition"("locationId");
-- CreateIndex
CREATE INDEX "HrRequisition_recruiterId_idx" ON "HrRequisition"("recruiterId");
-- CreateIndex
CREATE INDEX "HrReview_calibratedById_idx" ON "HrReview"("calibratedById");
-- CreateIndex
CREATE INDEX "HrReview_managerId_idx" ON "HrReview"("managerId");
-- CreateIndex
CREATE INDEX "HrSettlementSnapshot_offboardingCaseId_idx" ON "HrSettlementSnapshot"("offboardingCaseId");
-- CreateIndex
CREATE INDEX "HrShiftChangeRequest_approverId_idx" ON "HrShiftChangeRequest"("approverId");
-- CreateIndex
CREATE INDEX "HrShiftChangeRequest_counterpartEntryId_idx" ON "HrShiftChangeRequest"("counterpartEntryId");
-- CreateIndex
CREATE INDEX "HrShiftChangeRequest_counterpartId_idx" ON "HrShiftChangeRequest"("counterpartId");
-- CreateIndex
CREATE INDEX "HrShiftChangeRequest_entryId_idx" ON "HrShiftChangeRequest"("entryId");
-- CreateIndex
CREATE INDEX "HrShiftChangeRequest_requestedShiftId_idx" ON "HrShiftChangeRequest"("requestedShiftId");
-- CreateIndex
CREATE INDEX "HrTemporaryLocationRequest_approverId_idx" ON "HrTemporaryLocationRequest"("approverId");
-- CreateIndex
CREATE INDEX "HrTemporaryLocationRequest_createdLocationId_idx" ON "HrTemporaryLocationRequest"("createdLocationId");
-- CreateIndex
CREATE INDEX "HrTemporaryLocationRequest_requestedById_idx" ON "HrTemporaryLocationRequest"("requestedById");
-- CreateIndex
CREATE INDEX "LandingPageVersion_tenantId_idx" ON "LandingPageVersion"("tenantId");
-- CreateIndex
CREATE INDEX "Lead_accountId_idx" ON "Lead"("accountId");
-- CreateIndex
CREATE INDEX "Lead_campaignId_idx" ON "Lead"("campaignId");
-- CreateIndex
CREATE INDEX "Listing_projectId_idx" ON "Listing"("projectId");
-- CreateIndex
CREATE INDEX "Listing_unitInventoryId_idx" ON "Listing"("unitInventoryId");
-- CreateIndex
CREATE INDEX "MetaLeadFormRouting_assignedTeamId_idx" ON "MetaLeadFormRouting"("assignedTeamId");
-- CreateIndex
CREATE INDEX "MetaLeadFormRouting_assignedUserId_idx" ON "MetaLeadFormRouting"("assignedUserId");
-- CreateIndex
CREATE INDEX "MetaLeadFormRouting_stageId_idx" ON "MetaLeadFormRouting"("stageId");
-- CreateIndex
CREATE INDEX "Opportunity_campaignId_idx" ON "Opportunity"("campaignId");
-- CreateIndex
CREATE INDEX "Opportunity_typeId_idx" ON "Opportunity"("typeId");
-- CreateIndex
CREATE INDEX "OpportunityProduct_productId_idx" ON "OpportunityProduct"("productId");
-- CreateIndex
CREATE INDEX "Pipeline_opportunityTypeId_idx" ON "Pipeline"("opportunityTypeId");
-- CreateIndex
CREATE INDEX "RateLimitCounter_tenantId_idx" ON "RateLimitCounter"("tenantId");
-- CreateIndex
CREATE INDEX "SiteVisit_listingId_idx" ON "SiteVisit"("listingId");
-- CreateIndex
CREATE INDEX "SiteVisit_unitInventoryId_idx" ON "SiteVisit"("unitInventoryId");
-- CreateIndex
CREATE INDEX "SocialComment_linkedLeadId_idx" ON "SocialComment"("linkedLeadId");
-- CreateIndex
CREATE INDEX "SocialComment_teamId_idx" ON "SocialComment"("teamId");
-- CreateIndex
CREATE INDEX "Task_accountId_idx" ON "Task"("accountId");
-- CreateIndex
CREATE INDEX "Task_opportunityId_idx" ON "Task"("opportunityId");
-- CreateIndex
CREATE INDEX "Task_parentTaskId_idx" ON "Task"("parentTaskId");
-- CreateIndex
CREATE INDEX "Task_typeId_idx" ON "Task"("typeId");
-- CreateIndex
CREATE INDEX "Team_departmentId_idx" ON "Team"("departmentId");
-- CreateIndex
CREATE INDEX "TenantSubscription_planId_idx" ON "TenantSubscription"("planId");
-- CreateIndex
CREATE INDEX "Ticket_accountId_idx" ON "Ticket"("accountId");
-- CreateIndex
CREATE INDEX "Ticket_categoryId_idx" ON "Ticket"("categoryId");
-- CreateIndex
CREATE INDEX "Ticket_contactId_idx" ON "Ticket"("contactId");
-- CreateIndex
CREATE INDEX "Ticket_leadId_idx" ON "Ticket"("leadId");
-- CreateIndex
CREATE INDEX "Ticket_parentTicketId_idx" ON "Ticket"("parentTicketId");
-- CreateIndex
CREATE INDEX "Ticket_slaId_idx" ON "Ticket"("slaId");
-- CreateIndex
CREATE INDEX "UnitInventory_unitPlanId_idx" ON "UnitInventory"("unitPlanId");
-- CreateIndex
CREATE INDEX "WorkspaceInvitation_departmentId_idx" ON "WorkspaceInvitation"("departmentId");
-- CreateIndex
CREATE INDEX "WorkspaceInvitation_roleId_idx" ON "WorkspaceInvitation"("roleId");
