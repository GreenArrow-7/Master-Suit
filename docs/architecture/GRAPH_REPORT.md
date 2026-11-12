# Graph Report - ponytail-lite-0e416b  (2026-11-11)

## Corpus Check
- Large corpus: 2067 files · ~1,823,210 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder.

## Summary
- 10206 nodes · 36388 edges · 311 communities (283 shown, 28 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 325 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10
- Community 11
- Community 12
- Community 13
- Community 14
- Community 15
- Community 16
- Community 17
- Community 18
- Community 19
- Community 20
- Community 21
- Community 22
- Community 23
- Community 24
- Community 25
- Community 26
- Community 27
- Community 28
- Community 29
- Community 30
- Community 31
- Community 32
- Community 33
- Community 34
- Community 35
- Community 36
- Community 37
- Community 38
- Community 39
- Community 40
- Community 41
- Community 42
- Community 43
- Community 44
- Community 45
- Community 46
- Community 47
- Community 48
- Community 49
- Community 50
- Community 51
- Community 52
- Community 53
- Community 54
- Community 55
- Community 56
- Community 57
- Community 58
- Community 59
- Community 60
- Community 61
- Community 62
- Community 63
- Community 64
- Community 65
- Community 66
- Community 67
- Community 68
- Community 69
- Community 70
- Community 71
- Community 72
- Community 73
- Community 74
- Community 75
- Community 76
- Community 77
- Community 78
- Community 79
- Community 80
- Community 81
- Community 82
- Community 83
- Community 84
- Community 85
- Community 86
- Community 87
- Community 88
- Community 89
- Community 90
- Community 91
- Community 92
- Community 93
- Community 94
- Community 95
- Community 96
- Community 97
- Community 98
- Community 99
- Community 100
- Community 101
- Community 102
- Community 103
- Community 104
- Community 105
- Community 106
- Community 107
- Community 108
- Community 109
- Community 110
- Community 111
- Community 112
- Community 113
- Community 114
- Community 115
- Community 116
- Community 117
- Community 118
- Community 119
- Community 120
- Community 121
- Community 122
- Community 123
- Community 124
- Community 125
- Community 126
- Community 127
- Community 128
- Community 129
- Community 130
- Community 131
- Community 132
- Community 133
- Community 134
- Community 135
- Community 136
- Community 137
- Community 138
- Community 139
- Community 140
- Community 141
- Community 142
- Community 143
- Community 144
- Community 145
- Community 146
- Community 147
- Community 148
- Community 149
- Community 150
- Community 151
- Community 152
- Community 153
- Community 154
- Community 155
- Community 156
- Community 157
- Community 158
- Community 159
- Community 160
- Community 161
- Community 162
- Community 163
- Community 164
- Community 165
- Community 166
- Community 167
- Community 168
- Community 169
- Community 170
- Community 171
- Community 172
- Community 173
- Community 174
- Community 175
- Community 176
- Community 177
- Community 178
- Community 179
- Community 180
- Community 181
- Community 182
- Community 183
- Community 184
- Community 185
- Community 186
- Community 187
- Community 188
- Community 189
- Community 190
- Community 191
- Community 192
- Community 193
- Community 194
- Community 195
- Community 196
- Community 197
- Community 198
- Community 199
- Community 200
- Community 201
- Community 202
- Community 203
- Community 204
- Community 205
- Community 206
- Community 207
- Community 208
- Community 209
- Community 210
- Community 211
- Community 212
- Community 213
- Community 214
- Community 215
- Community 216
- Community 217
- Community 218
- Community 219
- Community 220
- Community 221
- Community 222
- Community 223
- Community 225
- Community 226
- Community 227
- Community 228
- Community 229
- Community 230
- Community 231
- Community 232
- Community 233
- Community 234
- Community 235
- Community 236
- Community 237
- Community 238
- Community 239
- Community 240
- Community 241
- Community 242
- Community 243
- Community 244
- Community 245
- Community 246
- Community 247
- Community 248
- Community 249
- Community 250
- Community 251
- Community 252
- Community 253
- Community 254
- Community 255
- Community 256
- Community 257
- Community 258
- Community 259
- Community 260
- Community 261
- Community 262
- Community 263
- Community 264
- Community 265
- Community 267
- Community 268
- Community 269
- Community 270
- Community 271
- Community 272
- Community 273
- Community 274
- Community 275
- Community 276
- Community 277
- Community 278
- Community 279
- Community 280
- Community 281
- Community 282
- Community 283
- Community 284
- Community 285
- Community 286
- Community 289
- Community 290
- Community 291
- Community 292
- Community 293
- Community 296
- Community 297
- Community 298
- Community 299

## God Nodes (most connected - your core abstractions)
1. `prisma` - 676 edges
2. `NotFound()` - 474 edges
3. `withTx()` - 357 edges
4. `vitest` - 349 edges
5. `audit()` - 284 edges
6. `Forbidden()` - 281 edges
7. `Conflict()` - 279 edges
8. `next` - 258 edges
9. `can()` - 258 edges
10. `zod` - 249 edges

## Surprising Connections (you probably didn't know these)
- `send()` --indirect_call--> `reason()`  [INFERRED]
  apps/web/src/app/(platform)/platform/workspaces/[workspaceId]/BreakGlass.tsx → apps/web/src/services/leads/timeline.ts
- `main()` --indirect_call--> `reason()`  [INFERRED]
  apps/web/scripts/platform-identity-email.mjs → apps/web/src/services/leads/timeline.ts
- `submit()` --indirect_call--> `challenge()`  [INFERRED]
  apps/web/src/app/(auth)/login/LoginForm.tsx → apps/web/tests/integration/mobile-attendance-push.spec.ts
- `resetEnrolment()` --indirect_call--> `reason()`  [INFERRED]
  apps/web/src/app/(workspace)/[workspaceSlug]/people/employees/[employeeId]/face/FaceEnrolmentConsole.tsx → apps/web/src/services/leads/timeline.ts
- `save()` --calls--> `authFetch()`  [EXTRACTED]
  apps/web/src/app/(workspace)/[workspaceSlug]/profile/notifications/NotificationPrefsForm.tsx → apps/web/src/lib/auth/client.ts

## Import Cycles
- 2-file cycle: `apps/web/src/services/hr/attendance.ts -> apps/web/src/services/targets/dailyBoard.ts -> apps/web/src/services/hr/attendance.ts`

## Communities (311 total, 28 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.02
Nodes (264): PATCH, PATCH, POST, POST, POST, DELETE, GET, params (+256 more)

### Community 1 - "Community 1"
Cohesion: 0.02
Nodes (182): body, OUTCOMES, params, POST, body, POST, params, patchBody (+174 more)

### Community 2 - "Community 2"
Cohesion: 0.03
Nodes (144): EmailTemplatesPage(), metadata, LeadSourcesPage(), metadata, LeadStagesPage(), metadata, formatWorkingHours(), metadata (+136 more)

### Community 3 - "Community 3"
Cohesion: 0.03
Nodes (196): GET, ACTION_PERMISSION, ActionPermission, ATTENDANCE_SETUP, HrAction, id, note, paramsSchema (+188 more)

### Community 4 - "Community 4"
Cohesion: 0.02
Nodes (122): TOOLS, PermissionMap, REPORTS, ALREADY_PROCESSING, MAX_ATTEMPTS, RetainedCategory, Report, suffix (+114 more)

### Community 5 - "Community 5"
Cohesion: 0.03
Nodes (155): GET, getParamsSchema, paramsSchema, POST, metadata, Page(), KINDS, Page() (+147 more)

### Community 6 - "Community 6"
Cohesion: 0.04
Nodes (128): GET, PATCH, createBody, GET, listQuery, onWorkspaceClock(), cursorOf(), describe() (+120 more)

### Community 7 - "Community 7"
Cohesion: 0.03
Nodes (119): DELETE, GET, params, PATCH, patchBody, createBody, GET, GRID_COLUMNS (+111 more)

### Community 8 - "Community 8"
Cohesion: 0.03
Nodes (107): GET, GET, FieldMapEditor(), save(), ReplayButton(), replay(), send(), deliveries() (+99 more)

### Community 9 - "Community 9"
Cohesion: 0.04
Nodes (95): DELETE, GET, id, paramsSchema, scope, dayOnly(), metadata, Page() (+87 more)

### Community 10 - "Community 10"
Cohesion: 0.05
Nodes (48): email(), RFC-6238, run, workspace, run, run, workspace, run (+40 more)

### Community 11 - "Community 11"
Cohesion: 0.04
Nodes (94): GET, query, body, extraFor(), GET, OBJECTS, PUT, query (+86 more)

### Community 12 - "Community 12"
Cohesion: 0.02
Nodes (74): c, GET, params, query, ACTOR_MODELS, ACTOR_USER_FIELDS, CREATE_OPS, FILTERED_WRITE_OPS (+66 more)

### Community 13 - "Community 13"
Cohesion: 0.03
Nodes (87): GET, makeUser(), ALL_ACTIONS, createAdminRole(), createTenant(), createWorkspaceUser(), grantPermissions(), member() (+79 more)

### Community 14 - "Community 14"
Cohesion: 0.03
Nodes (87): correctionBody, GET, params, PATCH, POST, auditBody, DELETE, deleteQuery (+79 more)

### Community 15 - "Community 15"
Cohesion: 0.04
Nodes (96): defaultRange(), GET, query, GET, query, GET, AssignDailyTarget(), DailyTargetDetailPage() (+88 more)

### Community 16 - "Community 16"
Cohesion: 0.02
Nodes (73): after, before, file, client, forced, LOOSE_CLIENTS, problems, RAW_METHODS (+65 more)

### Community 17 - "Community 17"
Cohesion: 0.04
Nodes (79): dynamic, body, POST, acceptSchema, GET, POST, bodySchema, POST() (+71 more)

### Community 18 - "Community 18"
Cohesion: 0.04
Nodes (101): POST, GET, GET, id, query, when, GET, POST (+93 more)

### Community 19 - "Community 19"
Cohesion: 0.04
Nodes (64): createBody, POST, logActivity(), POST, POST, POST, POST, Hierarchy (+56 more)

### Community 20 - "Community 20"
Cohesion: 0.03
Nodes (51): POST, GET, listQuery, markBody, PATCH, requireSession(), issueApiKey(), prisma (+43 more)

### Community 21 - "Community 21"
Cohesion: 0.04
Nodes (79): body, params, POST, GET, params, patchBody, POST, DELETE (+71 more)

### Community 22 - "Community 22"
Cohesion: 0.03
Nodes (73): GET(), back(), POST, POST(), POST(), convert(), wrapCredentials(), calendarEventId() (+65 more)

### Community 23 - "Community 23"
Cohesion: 0.04
Nodes (68): params, POST, GET, listQuery, params, POST, sendBody, visibleConversation() (+60 more)

### Community 24 - "Community 24"
Cohesion: 0.04
Nodes (51): Preview, PRE, metadata, metadata, TestimonialPage(), TestimonialForm(), submit(), TeamRow (+43 more)

### Community 25 - "Community 25"
Cohesion: 0.04
Nodes (52): POST(), GET, clear(), createPlatformSessionToken(), freshTotp(), makePerson(), Fixture, ownedPlatformUserIds (+44 more)

### Community 26 - "Community 26"
Cohesion: 0.04
Nodes (54): GET, MailAttachment, mockOutbox, outbox, SentMail, QueueName, sweepStaleTriage(), ClaimedRow (+46 more)

### Community 27 - "Community 27"
Cohesion: 0.03
Nodes (54): DELETE, GET, params, PATCH, patchBody, patchLead(), LeadRow, TenantGuardError (+46 more)

### Community 28 - "Community 28"
Cohesion: 0.06
Nodes (59): AiControlView(), Budgets(), Card(), Guardrails(), Routing(), SectionProps, Tab, Tokenomics() (+51 more)

### Community 29 - "Community 29"
Cohesion: 0.06
Nodes (67): main(), Scenario, tenantArg, body, params, POST, parseHadAmountBefore(), POST (+59 more)

### Community 30 - "Community 30"
Cohesion: 0.06
Nodes (68): POST, POST, POST(), POST, bodySchema, DELETE, PATCH, POST() (+60 more)

### Community 31 - "Community 31"
Cohesion: 0.05
Nodes (61): createBody, editBody, GET, idQuery, keyFor(), label, options, optionsFor() (+53 more)

### Community 32 - "Community 32"
Cohesion: 0.06
Nodes (62): POST, aggregate(), aggregateModels(), ModelSpend, NEAR_LIMIT_FRACTION, payerOf(), TenantSpend, UsageRow (+54 more)

### Community 33 - "Community 33"
Cohesion: 0.06
Nodes (66): ALLOWED, POST, GET, paramsSchema, POST, base32Decode(), base32Encode(), currentTotpStep() (+58 more)

### Community 34 - "Community 34"
Cohesion: 0.05
Nodes (51): GET, GET, GET, query, GET, loadVisible(), GET, Summary() (+43 more)

### Community 35 - "Community 35"
Cohesion: 0.04
Nodes (51): POST, POST, GET, dynamic, Forbidden(), workspaceAdmins(), resolveCtx(), pageText() (+43 more)

### Community 36 - "Community 36"
Cohesion: 0.07
Nodes (54): body, DELETE, forgetThisPhone(), POST, spec, params, PUT, GET (+46 more)

### Community 37 - "Community 37"
Cohesion: 0.07
Nodes (69): GET, id, paramsSchema, POST, isPrivilegedPlatformRole(), revokeAllSessions(), assertMayAdministerRole(), languageList() (+61 more)

### Community 38 - "Community 38"
Cohesion: 0.06
Nodes (56): body, GET(), POST(), revokeBody, subjectOr404(), DELETE(), POST(), metadata (+48 more)

### Community 39 - "Community 39"
Cohesion: 0.05
Nodes (44): Workspace, DeactivateAccount(), DeactivateForm(), deactivate(), HandOverChoice, HandOverStep(), OpenWork, plural() (+36 more)

### Community 40 - "Community 40"
Cohesion: 0.06
Nodes (51): body, LeaveScreen(), apply(), call(), cancel(), decide(), RequestTable(), ChecklistTask (+43 more)

### Community 41 - "Community 41"
Cohesion: 0.07
Nodes (53): DELETE, POST, DELETE(), GET, planSchema, POST, DELETE, PATCH (+45 more)

### Community 42 - "Community 42"
Cohesion: 0.05
Nodes (57): body, budget, BUDGET_ACTIONS, bulkUserBudget, guardrail, period, price, removal (+49 more)

### Community 43 - "Community 43"
Cohesion: 0.04
Nodes (57): DELETE, DELETE, HandlerArgs, AuditCapable, auditDiff(), AuditInput, redact(), SECRET_KEYS (+49 more)

### Community 44 - "Community 44"
Cohesion: 0.06
Nodes (54): CallLogLead, ActivityType, api(), Doc, DocumentsTab(), Dropdown(), fmtBytes(), fmtDate() (+46 more)

### Community 45 - "Community 45"
Cohesion: 0.07
Nodes (23): ExotelProvider, readBody(), STATUS, basic(), num(), TelephonyApiError, urlTokenValid(), vendorFetch() (+15 more)

### Community 46 - "Community 46"
Cohesion: 0.06
Nodes (47): EMPTY, FollowUpComposer(), submit(), FollowUpRowActions(), patch(), CallLogDialog(), submit(), prefill() (+39 more)

### Community 47 - "Community 47"
Cohesion: 0.06
Nodes (30): IntegrationCategory, ProviderSpec, providerSpec(), SettingField, SMS_SENDER, TELEPHONY_LABELS, TELEPHONY_SETTINGS, HmacTelephonyProvider (+22 more)

### Community 48 - "Community 48"
Cohesion: 0.07
Nodes (40): GET, POST, CustomFieldsLayout(), EmailTemplatesLayout(), LeadSourcesLayout(), LeadStagesLayout(), LeadEagleLayout(), PeopleLayout() (+32 more)

### Community 49 - "Community 49"
Cohesion: 0.07
Nodes (51): ANALYSIS_PROMPT_VERSION, AnalysisInput, AnalysisResult, analyzeTranscript(), buildPrompt(), degraded(), DetectedRequirement, providerReason() (+43 more)

### Community 50 - "Community 50"
Cohesion: 0.07
Nodes (50): body, POST, dynamic, Root(), burnCredentialCheck(), consumeMfaChallenge(), createMfaChallenge(), CredentialMatch (+42 more)

### Community 51 - "Community 51"
Cohesion: 0.07
Nodes (41): body, POST, body, GET, POST, query, metadata, ProposalPage() (+33 more)

### Community 52 - "Community 52"
Cohesion: 0.08
Nodes (46): body, params, POST, GET, POST, body, params, POST (+38 more)

### Community 53 - "Community 53"
Cohesion: 0.08
Nodes (48): authorised(), collectAccountDeletions(), collectConnections(), collectQueues(), collectRetentionWindows(), collectSecretAges(), collectTableSizes(), dynamic (+40 more)

### Community 54 - "Community 54"
Cohesion: 0.04
Nodes (44): hashPassword(), member(), open(), signInRefused(), Variant, variants, as(), password (+36 more)

### Community 55 - "Community 55"
Cohesion: 0.08
Nodes (46): POST, POST, applyCallEvent(), CALL_OUTCOME, CALL_STATUS, connected(), createInboundCall(), handleTelephonyWebhook() (+38 more)

### Community 56 - "Community 56"
Cohesion: 0.06
Nodes (40): react-dom@^19.0.0, POST, CalendarItem, CalendarView(), DAYS, dotColor(), KIND_COLOR, KIND_LABEL (+32 more)

### Community 57 - "Community 57"
Cohesion: 0.04
Nodes (33): ADMIN_ROLE_KEYS, APPLY, OLD_ACTIONS, OLD_EXTRAS, OLD_MODULES, prisma, provisioned, APPLY (+25 more)

### Community 58 - "Community 58"
Cohesion: 0.09
Nodes (46): body, params, CalendarEvent, CalendarEventResult, call(), createGoogleCalendarEvent(), createGraphEvent(), deleteGoogleCalendarEvent() (+38 more)

### Community 59 - "Community 59"
Cohesion: 0.06
Nodes (40): params, DELETE, params, POST, publicForm(), query, submitBody, body (+32 more)

### Community 60 - "Community 60"
Cohesion: 0.07
Nodes (39): POST, Page(), haversineM(), insideGeofence(), AccrualPolicy, annualLeaveAccrued(), EMPLOYMENT_STATUSES, EmploymentStatus (+31 more)

### Community 61 - "Community 61"
Cohesion: 0.06
Nodes (38): PATCH, POST, GET, POST, booking(), D(), payrollRun(), RANGE (+30 more)

### Community 62 - "Community 62"
Cohesion: 0.08
Nodes (42): POST, filterTreeSchema, WITHDRAWN_FIELDS, ActionContext, mayAssignLeads(), runAction(), viewableRecord(), enroll() (+34 more)

### Community 63 - "Community 63"
Cohesion: 0.04
Nodes (48): concurrency, cancel-in-progress, group, run, env, APPLE_TEAM_ID, ASC_ISSUER_ID, ASC_KEY_ID (+40 more)

### Community 64 - "Community 64"
Cohesion: 0.07
Nodes (41): closeBody, contestBody, decideBody, GET, listQuery, nominateBody, voteBody, createBody (+33 more)

### Community 65 - "Community 65"
Cohesion: 0.12
Nodes (40): bodySchema, POST, sha256(), bodySchema, GET, POST, proof, requireAdministrationSession() (+32 more)

### Community 66 - "Community 66"
Cohesion: 0.09
Nodes (42): GET, params, POST, DELETE, params, PATCH, patchBody, DialerConsole() (+34 more)

### Community 67 - "Community 67"
Cohesion: 0.08
Nodes (35): CommandPalette(), Result, WorkAreaTabs(), AreaLink(), Icon(), initials(), WorkspaceSidebar(), LEAD_SOURCES (+27 more)

### Community 68 - "Community 68"
Cohesion: 0.07
Nodes (4): ExampleInstrumentedTest, CallState, CallWatchPlugin, ExampleUnitTest

### Community 69 - "Community 69"
Cohesion: 0.07
Nodes (38): GET, GET, assertNobodyAssigned(), ATTENDANCE_SETUP, createBody, createDefaultEmployeeRole(), DEFAULT_EMPLOYEE_ROLE_RANK, DELETE (+30 more)

### Community 70 - "Community 70"
Cohesion: 0.07
Nodes (27): submit(), AccountForm(), metadata, NewAccountPage(), LeadOption, NewCallForm(), metadata, NewCallPage() (+19 more)

### Community 71 - "Community 71"
Cohesion: 0.04
Nodes (44): name, runs-on, steps, strategy, concurrency, cancel-in-progress, group, image (+36 more)

### Community 72 - "Community 72"
Cohesion: 0.07
Nodes (42): devDependencies, eslint@^9.39.5, eslint-config-next@^16.3.0, @eslint/js@^9.39.5, @playwright/test@^1.51.1, prettier@^3.9.6, prisma@^7.0.0, tailwindcss@^4.0.0 (+34 more)

### Community 73 - "Community 73"
Cohesion: 0.10
Nodes (37): assertDisposable(), line(), main(), seed(), WRONG, params, PATCH, patchBody (+29 more)

### Community 74 - "Community 74"
Cohesion: 0.08
Nodes (33): dynamic, GET(), runtime, body, GET, PATCH, PORTALS, SELECT (+25 more)

### Community 75 - "Community 75"
Cohesion: 0.08
Nodes (33): fmtMoney(), Hint, HINT_LABEL, HINT_TONE, LiveCallWorkspace(), endCall(), micChunks(), micLoop() (+25 more)

### Community 76 - "Community 76"
Cohesion: 0.10
Nodes (35): envSchema, assertDeepRoutesServed(), globalSetup(), assertDisposableEnvironment(), assertLocalStorage(), assertNoExternalCredentials(), assertProviders(), assertRuntimeIsolation() (+27 more)

### Community 77 - "Community 77"
Cohesion: 0.08
Nodes (33): DELETE, PlatformOverviewPage(), IntegrationsPage(), metadata, ChannelOverview(), MODE_COPY, CATEGORY_TITLES, DefaultProviderPicker() (+25 more)

### Community 78 - "Community 78"
Cohesion: 0.10
Nodes (28): EyeIcon(), LoginForm(), onCodeChange(), resetToCredentials(), submit(), LoginPage(), Search, ConfirmSignup() (+20 more)

### Community 79 - "Community 79"
Cohesion: 0.13
Nodes (36): Allowance, allowanceFor(), AllowanceSource, AllowanceState, allowanceState(), ALLOWED, decide(), enforceBudgets() (+28 more)

### Community 80 - "Community 80"
Cohesion: 0.05
Nodes (29): apiKeys, certDer, certPub, certs, certText, dryRun, fingerprint, here (+21 more)

### Community 81 - "Community 81"
Cohesion: 0.06
Nodes (39): BUILD_TIME, GIT_SHA, args, context, dockerfile, target, mailpit, replicas (+31 more)

### Community 82 - "Community 82"
Cohesion: 0.11
Nodes (33): allocateBody, askBody, cancelBody, decideBody, GET, listQuery, PATCH, poolFilter (+25 more)

### Community 83 - "Community 83"
Cohesion: 0.10
Nodes (30): dynamic, MonitoringLayout(), dynamic, PlatformLayout(), AppearanceScreen(), metadata, Page(), BellIcon() (+22 more)

### Community 84 - "Community 84"
Cohesion: 0.10
Nodes (34): date(), MOVEABLE, Page(), time(), total(), date(), Page(), TERMINAL (+26 more)

### Community 85 - "Community 85"
Cohesion: 0.09
Nodes (33): AssistantContext, AssistantEvent, assistantFailure(), bullet(), ChatMessage, declarations, leadLine(), modelTurn() (+25 more)

### Community 86 - "Community 86"
Cohesion: 0.08
Nodes (26): body, params, POST, enqueue(), createAccount(), CreateAccountInput, CrmEventKey, CrmNotification (+18 more)

### Community 87 - "Community 87"
Cohesion: 0.09
Nodes (28): GET, GET, params, GET, params, createBody, DELETE, deleteQuery (+20 more)

### Community 88 - "Community 88"
Cohesion: 0.10
Nodes (32): AiTransportCredential, complete(), ENDPOINTS, fail(), fromOpenAiToolCalls(), generateText(), generateWithTools(), googleUsage() (+24 more)

### Community 89 - "Community 89"
Cohesion: 0.06
Nodes (34): scripts, build, check:drift, check:observability, check:permissions, check:redis-auth, check:rls, check:test-data (+26 more)

### Community 90 - "Community 90"
Cohesion: 0.11
Nodes (29): GET, metadata, Page(), cancelAccountDeletion(), claim(), DeletionBlocker, deletionBlockers(), describe() (+21 more)

### Community 91 - "Community 91"
Cohesion: 0.10
Nodes (28): metadata, Bars(), CARD_GRID, Cell(), LinkedTile(), metadata, Panel(), RealtyDashboardPage() (+20 more)

### Community 92 - "Community 92"
Cohesion: 0.06
Nodes (19): Actor, actors, GRANTS, leads, password, PEOPLE, run, Who (+11 more)

### Community 93 - "Community 93"
Cohesion: 0.16
Nodes (29): bodySchema, Ctx, POST, run(), canSignIn(), changeWorkspaceRole(), clearSignInThrottle(), effectiveAccessFor() (+21 more)

### Community 94 - "Community 94"
Cohesion: 0.10
Nodes (25): finishBody, params, turnBody, clamp(), PracticeScenario, PracticeScoreResult, PracticeTurn, ProspectReply (+17 more)

### Community 95 - "Community 95"
Cohesion: 0.12
Nodes (18): assertSize(), currentGeminiModel(), DeepgramTranscriptionProvider, DiarisedSegment, GeminiTranscriptionProvider, getTranscriptionProvider(), GOOGLE_ENCODING, GoogleTranscriptionProvider (+10 more)

### Community 96 - "Community 96"
Cohesion: 0.08
Nodes (29): context, dockerfile, target, replicas, CHOKIDAR_USEPOLLING, DATABASE_URL, MIGRATION_DATABASE_URL, NODE_ENV (+21 more)

### Community 97 - "Community 97"
Cohesion: 0.10
Nodes (28): adapter, ADMIN_ACTIONS, businessDate(), chance(), CITIES, COMPANIES, db, DEMO_WORKSPACE (+20 more)

### Community 98 - "Community 98"
Cohesion: 0.10
Nodes (27): arg(), EPHEMERAL, flag(), main(), READ, readCompany(), milestone, Milestone (+19 more)

### Community 99 - "Community 99"
Cohesion: 0.12
Nodes (27): amounts(), DETAILS, emailIdOf(), Enquiry, ENTITIES, FieldMap, flatten(), htmlText() (+19 more)

### Community 100 - "Community 100"
Cohesion: 0.13
Nodes (17): AcceptInviteForm(), AcceptInvitePage(), metadata, BrandHero(), LEAD_EAGLE, BrandBackground(), YouhanMark(), sections (+9 more)

### Community 101 - "Community 101"
Cohesion: 0.10
Nodes (25): format(), GROUP_LABELS, Page(), queryString(), CachedActor, Scope, audienceFor(), availableReports() (+17 more)

### Community 102 - "Community 102"
Cohesion: 0.08
Nodes (27): pgbouncer, postgres, interval, retries, test, driver, options, max-file (+19 more)

### Community 103 - "Community 103"
Cohesion: 0.07
Nodes (21): @aws-sdk/client-s3@^3.700.0, bucket, DELETE_AFTER, DRY_RUN, root, s3, env, fast (+13 more)

### Community 104 - "Community 104"
Cohesion: 0.08
Nodes (26): alertNames, alertsYml, amDir, amEntrypoint, baseServices, compose, consumed, credsPath (+18 more)

### Community 105 - "Community 105"
Cohesion: 0.13
Nodes (25): body, DELETE, fieldMapBody, params, POST, PUT, verifyInput(), AiProviderKey (+17 more)

### Community 106 - "Community 106"
Cohesion: 0.10
Nodes (15): dynamic, loadShell(), WorkspaceLayout(), SupportModeBanner(), Icon(), ICONS, MobileTabBar(), activeModule() (+7 more)

### Community 107 - "Community 107"
Cohesion: 0.08
Nodes (15): run, run, frame(), FRAMES, framesPresent, here, run, turn() (+7 more)

### Community 108 - "Community 108"
Cohesion: 0.07
Nodes (26): runs-on, steps, timeout-minutes, MOBILE_SERVER_URL, jobs, apk, name, on (+18 more)

### Community 109 - "Community 109"
Cohesion: 0.14
Nodes (21): DELETE, params, PATCH, patchBody, TxClient, CALL_OUTCOME_OF, FOLLOW_UP_TITLE, claimKey() (+13 more)

### Community 110 - "Community 110"
Cohesion: 0.12
Nodes (9): analyse(), analyse_one(), AnalyseIn, decode(), Detection, diagnose(), engine(), health() (+1 more)

### Community 111 - "Community 111"
Cohesion: 0.08
Nodes (20): { chromium }, here, ios, jobs, mark, mobile, res, source (+12 more)

### Community 112 - "Community 112"
Cohesion: 0.20
Nodes (23): adapter, argv, audit(), client, commands, create(), createAccount(), existing() (+15 more)

### Community 113 - "Community 113"
Cohesion: 0.14
Nodes (22): apply, [command, ...rest], main(), tenantArg, assessEligibility(), counts(), daysBefore(), Eligibility (+14 more)

### Community 114 - "Community 114"
Cohesion: 0.13
Nodes (20): DELETE, findRule(), params, PATCH, patchBody, GET, POST, count (+12 more)

### Community 115 - "Community 115"
Cohesion: 0.13
Nodes (20): body, params, POST, metadata, SocialLeadsPage(), TABS, holdsAny(), PRIVATE_REPLY_WINDOW_MS (+12 more)

### Community 116 - "Community 116"
Cohesion: 0.12
Nodes (16): AccessState, BreakGlass(), send(), Grant, remaining(), date(), isoDate(), Page() (+8 more)

### Community 117 - "Community 117"
Cohesion: 0.12
Nodes (15): Draft, WhatsAppFollowUp(), MessageCard(), SmsDialog(), submit(), CHANNEL, HINT, MessageChannel (+7 more)

### Community 118 - "Community 118"
Cohesion: 0.14
Nodes (20): LeadImport(), downloadRejected(), handleFile(), reset(), parseCsv(), readFile(), Refused, Report (+12 more)

### Community 119 - "Community 119"
Cohesion: 0.17
Nodes (18): back(), dynamic, GET(), body, POST, POST, safeReturnTo(), beginMetaOAuth() (+10 more)

### Community 120 - "Community 120"
Cohesion: 0.14
Nodes (17): at(), NormalizedSocialComment, normalizeFacebookComment(), normalizeInstagramComment(), normalizeSocialComment(), at(), MetaEventKind, NormalizedMetaEvent (+9 more)

### Community 121 - "Community 121"
Cohesion: 0.15
Nodes (15): GET, Resource, RESOURCES, CsvColumn, csvHeader(), csvHeaders(), csvRow(), csvStream() (+7 more)

### Community 122 - "Community 122"
Cohesion: 0.12
Nodes (21): buildAuditPrompt(), buildPrompt(), bullet(), draftFollowUpEmail(), FollowUpEmailDraft, FollowUpEmailInput, FollowUpWhatsAppDraft, SCHEMA (+13 more)

### Community 123 - "Community 123"
Cohesion: 0.13
Nodes (20): approveBody, bandInput, BASES, createBody, GET, MODES, ApplyInput, applySlab() (+12 more)

### Community 124 - "Community 124"
Cohesion: 0.14
Nodes (14): BuyerPlaybooks(), csv(), EMPTY, lines(), PlaybookRow, metadata, PlaybookPage(), empty (+6 more)

### Community 125 - "Community 125"
Cohesion: 0.14
Nodes (16): header(), SORTABLE, cell(), clocks, column(), common(), Entry, escape() (+8 more)

### Community 126 - "Community 126"
Cohesion: 0.14
Nodes (19): save(), AssignmentPanel(), CHANNEL, ConvertPanel(), EXTERNAL_CHANNELS, INTENT_LABEL, Lead, Options (+11 more)

### Community 127 - "Community 127"
Cohesion: 0.12
Nodes (20): dependencies, @capacitor/android@^8.5.0, @capacitor/core@^8.5.0, @capacitor/ios@^8.5.0, @capacitor/push-notifications@8.1.2, description, devDependencies, @capacitor/cli@^8.5.0 (+12 more)

### Community 128 - "Community 128"
Cohesion: 0.10
Nodes (21): dependencies, bullmq@^5.34.0, ioredis@^5.4.1, leaflet@^1.9.4, next@16.4.2, nodemailer@^10.3.1, pg@^8.13.1, pino@^9.5.0 (+13 more)

### Community 129 - "Community 129"
Cohesion: 0.10
Nodes (14): dbPort, installed, [maj, min], ok, problems, redisPort, BODIES, port (+6 more)

### Community 130 - "Community 130"
Cohesion: 0.13
Nodes (19): DELETE, deleteBody, EDUCATION, EMPLOYMENT, GET, INTENT, listQuery, upsertBody (+11 more)

### Community 131 - "Community 131"
Cohesion: 0.19
Nodes (18): POST, apnsConfigured(), apnsToken(), apnsTopic(), base64url(), fcmAccessToken(), fcmConfigured(), jwt() (+10 more)

### Community 132 - "Community 132"
Cohesion: 0.14
Nodes (17): companyBody, hex, paramsSchema, retentionBody, retentionDays, securityBody, Page(), SECTION_PERMISSION (+9 more)

### Community 133 - "Community 133"
Cohesion: 0.13
Nodes (19): ActionSpec, ActionState, AssistantWidget(), patch(), retry(), runAction(), send(), stream() (+11 more)

### Community 134 - "Community 134"
Cohesion: 0.12
Nodes (18): createDeviceSession(), deviceFor(), agent, attempt(), burst(), call(), challenge(), checkIn() (+10 more)

### Community 135 - "Community 135"
Cohesion: 0.16
Nodes (14): assertFetchableUrl(), BlockedUrlError, hostAllowed(), isPrivateAddress(), isPrivateV4(), isPrivateV6(), publicLookup(), newWebhookSecret() (+6 more)

### Community 136 - "Community 136"
Cohesion: 0.13
Nodes (19): logging, replicas, driver, options, max-file, max-size, logging, services (+11 more)

### Community 137 - "Community 137"
Cohesion: 0.10
Nodes (19): volumes, replicas, interval, retries, start_period, test, timeout, restart (+11 more)

### Community 138 - "Community 138"
Cohesion: 0.11
Nodes (19): alerting, alertmanagers, static_configs, credentials_file, type, environment, global, evaluation_interval (+11 more)

### Community 139 - "Community 139"
Cohesion: 0.16
Nodes (3): MainActivity, BridgeWebViewClient, OnBackPressedCallback

### Community 140 - "Community 140"
Cohesion: 0.22
Nodes (5): _distance2bbox(), _distance2kps(), Face, FaceEngine, _nms()

### Community 142 - "Community 142"
Cohesion: 0.14
Nodes (14): body, HOW_IT_IS_WORKED, params, POST, DueRow, pause(), send(), sweepDueCampaigns() (+6 more)

### Community 143 - "Community 143"
Cohesion: 0.19
Nodes (14): GET, BAYUT, BAYUT_AGENT_FIRST, DUBIZZLE, DUBIZZLE_PRETTY, forwardedByAgent(), InboundMail, MENTIONS_A_PORTAL (+6 more)

### Community 144 - "Community 144"
Cohesion: 0.16
Nodes (11): SignOff(), endSession(), NativePush(), signOut(), forget(), CapacitorGlobal, Permission, plugin() (+3 more)

### Community 145 - "Community 145"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 146 - "Community 146"
Cohesion: 0.11
Nodes (18): entrypoint, environment, image, profiles, restart, tmpfs, volumes, ALERT_EMAIL_FROM (+10 more)

### Community 147 - "Community 147"
Cohesion: 0.14
Nodes (8): unbacked, perTenant, appliedAll, pending, seen, openAudit(), n(), lead()

### Community 148 - "Community 148"
Cohesion: 0.21
Nodes (13): POST, POST, POST, GET, PunchType, currentShift(), formNumber(), PHONE_ATTEMPTS (+5 more)

### Community 149 - "Community 149"
Cohesion: 0.20
Nodes (13): POST, body, POST, dynamic, PlatformSettingsPage(), SettingEditor(), sendMail(), smtpTransport() (+5 more)

### Community 150 - "Community 150"
Cohesion: 0.16
Nodes (15): day(), dynamic, metadata, MFA_LABEL, MFA_TONE, PlatformUsersPage(), Query, serialise() (+7 more)

### Community 151 - "Community 151"
Cohesion: 0.18
Nodes (14): LABELS, MergeLeadsPage(), metadata, assertMayMerge(), Delegate, earliest(), FILL, latest() (+6 more)

### Community 152 - "Community 152"
Cohesion: 0.22
Nodes (15): BusinessEcosystem(), curve(), GLYPHS, ModuleIcon(), COMPACT_CORE, COMPACT_MODULES, COMPACT_STORY, COMPACT_VIEWBOX (+7 more)

### Community 153 - "Community 153"
Cohesion: 0.16
Nodes (14): escalateSocialSla(), stamp(), AS_PRIORITY, INTENT_RANK, SlaSubject, SOCIAL_SLA_DEFAULT_MINUTES, socialSlaState(), SocialSlaTarget (+6 more)

### Community 156 - "Community 156"
Cohesion: 0.14
Nodes (16): ACCOUNTS, AREAS, BEDS, CONTACT_FIRST, CONTACT_LAST, CONTACT_TITLES, CRITERIA, CrmCtx (+8 more)

### Community 157 - "Community 157"
Cohesion: 0.18
Nodes (14): A, B, O, R, ROLES, RoleSpec, T, APPROVE (+6 more)

### Community 158 - "Community 158"
Cohesion: 0.21
Nodes (13): body, GET, PUT, applyDelta(), Db, DECAY_TRIGGER, decayCutoff(), decayDue() (+5 more)

### Community 159 - "Community 159"
Cohesion: 0.16
Nodes (8): AudiencePicker(), LeadRow, CampaignSend(), CampaignStatusActions(), MOVES, CampaignDetailPage(), metadata, STATUS_TONE

### Community 160 - "Community 160"
Cohesion: 0.20
Nodes (16): assignLead(), AssignOutcome, leadLanguages(), rotationOrder(), RULE_SELECT, RuleConditions, ruleForLead(), ruleMatches() (+8 more)

### Community 161 - "Community 161"
Cohesion: 0.22
Nodes (13): say(), install.sh script, ms-disk-preflight.sh script, busy(), expired_env_backups(), held_ids(), image_list(), log() (+5 more)

### Community 162 - "Community 162"
Cohesion: 0.13
Nodes (14): GET, GET, achievedToday(), agentCtx(), cookieJar, elements(), HQ, leadsCalledToday() (+6 more)

### Community 163 - "Community 163"
Cohesion: 0.19
Nodes (12): metadata, MetaIntegrationPage(), Config, Form, MetaConfiguration(), MODE_NOTE, PRIORITIES, RoutingDrawer() (+4 more)

### Community 164 - "Community 164"
Cohesion: 0.15
Nodes (12): Dest, DetailDest, isRoutableType(), normalise(), QueryDest, ROUTABLE_TYPES, ROUTES, ScreenDest (+4 more)

### Community 165 - "Community 165"
Cohesion: 0.14
Nodes (10): auditRows(), clearRows(), countRows(), deletedCaptures, OLD, platformRows(), RECENT, suffix (+2 more)

### Community 166 - "Community 166"
Cohesion: 0.20
Nodes (15): environment, ALERT_EMAIL_TO, ALLOW_UNSTAGED_MIGRATION, DATABASE_URL, EMAIL_PROVIDER, MIGRATION_DATABASE_URL, NODE_ENV, REDIS_URL (+7 more)

### Community 167 - "Community 167"
Cohesion: 0.13
Nodes (15): depends_on, environment, ports, profiles, mailpit, ALERT_EMAIL_FROM, ALERT_EMAIL_TO, ALERT_SMTP_REQUIRE_TLS (+7 more)

### Community 168 - "Community 168"
Cohesion: 0.15
Nodes (15): depends_on, image, logging, ports, restart, volumes, driver, options (+7 more)

### Community 169 - "Community 169"
Cohesion: 0.18
Nodes (13): assertActivityInScope(), DELETE, params, PATCH, patchBody, createBody, listQuery, POST (+5 more)

### Community 170 - "Community 170"
Cohesion: 0.18
Nodes (13): callLogin(), cookieOf(), freshLimits(), granted, jar, OWNER2_SECRET, request(), SECRET (+5 more)

### Community 171 - "Community 171"
Cohesion: 0.19
Nodes (3): authorise(), accepts(), refusal()

### Community 172 - "Community 172"
Cohesion: 0.15
Nodes (14): postgres, redis, depends_on, condition, condition, web, worker, depends_on (+6 more)

### Community 173 - "Community 173"
Cohesion: 0.22
Nodes (11): body, GET, PUT, NotificationPrefsForm(), save(), metadata, NotificationsPrefsPage(), PushTest() (+3 more)

### Community 174 - "Community 174"
Cohesion: 0.22
Nodes (12): nextDistributionOwner(), ACTIONABLE, applySocialComment(), Intent, isPleasantry(), PRAISE, Qualification, qualifyComment() (+4 more)

### Community 175 - "Community 175"
Cohesion: 0.16
Nodes (9): at(), cookieJar, cookies, documentNumbers, people, read(), renderAs(), strings() (+1 more)

### Community 176 - "Community 176"
Cohesion: 0.22
Nodes (11): auditsIn(), calledFrom(), EXEMPT, Exemption, fnBody(), Handler, handlers, importsOf() (+3 more)

### Community 178 - "Community 178"
Cohesion: 0.15
Nodes (13): ports, profiles, ports, restart, REDIS_PASSWORD, ports, environment, ports (+5 more)

### Community 179 - "Community 179"
Cohesion: 0.15
Nodes (12): ports, restart, ports, restart, name, services, clamav, mailpit (+4 more)

### Community 180 - "Community 180"
Cohesion: 0.24
Nodes (7): config, securityHeaders, config, proxy(), csp(), script, policy()

### Community 181 - "Community 181"
Cohesion: 0.19
Nodes (10): apply, argv, client, describe(), expectId, from, lower(), main() (+2 more)

### Community 182 - "Community 182"
Cohesion: 0.26
Nodes (9): current_file(), dc_for(), fail(), IMAGE_TAG, preflight(), previous_file(), read_tag(), say() (+1 more)

### Community 183 - "Community 183"
Cohesion: 0.21
Nodes (10): createBody, DELETE, deleteQuery, params, POST, createBody, listQuery, params (+2 more)

### Community 184 - "Community 184"
Cohesion: 0.28
Nodes (7): Loading(), Loading(), Loading(), Loading(), Loading(), BLOCK, PageSkeleton()

### Community 185 - "Community 185"
Cohesion: 0.21
Nodes (11): AssignedLocation, CheckInConsole(), captureFrames(), punch(), refreshRecent(), DailyTarget, deviceFingerprint(), gstNow() (+3 more)

### Community 186 - "Community 186"
Cohesion: 0.19
Nodes (11): clock(), Conversation, ConversationInbox(), DELIVERY, Filter, FILTERS, LastMessage, Message (+3 more)

### Community 187 - "Community 187"
Cohesion: 0.15
Nodes (12): concurrency, cancel-in-progress, group, defaults, run, jobs, name, on (+4 more)

### Community 188 - "Community 188"
Cohesion: 0.41
Nodes (12): healthcheck, healthcheck, healthcheck, interval, retries, start_period, test, timeout (+4 more)

### Community 189 - "Community 189"
Cohesion: 0.17
Nodes (12): APP_ENV, METRICS_TOKEN, PROMETHEUS_RETENTION, depends_on, entrypoint, environment, image, profiles (+4 more)

### Community 190 - "Community 190"
Cohesion: 0.17
Nodes (12): POSTGRES_DB, POSTGRES_HOST_AUTH_METHOD, POSTGRES_INITDB_ARGS, POSTGRES_PASSWORD, POSTGRES_USER, command, environment, image (+4 more)

### Community 191 - "Community 191"
Cohesion: 0.17
Nodes (12): POSTGRES_DB, POSTGRES_HOST_AUTH_METHOD, POSTGRES_INITDB_ARGS, POSTGRES_PASSWORD, interval, retries, test, environment (+4 more)

### Community 192 - "Community 192"
Cohesion: 0.17
Nodes (11): description, summary, groups, name, rules, severity, alert, annotations (+3 more)

### Community 193 - "Community 193"
Cohesion: 0.30
Nodes (10): checksum(), decide(), ledger(), main(), readRepoMigrations(), applied(), M1, M2 (+2 more)

### Community 194 - "Community 194"
Cohesion: 0.18
Nodes (10): adapter, argv, client, email, employeeNumber, fullName, main(), roleKey (+2 more)

### Community 195 - "Community 195"
Cohesion: 0.23
Nodes (11): queue(), Ineligibility, Accountability, openTriageEntry(), OpenTriageInput, OpenTriageResult, resolveAccountability(), reviewDeadline() (+3 more)

### Community 196 - "Community 196"
Cohesion: 0.29
Nodes (3): fetch(), main(), target_dir()

### Community 197 - "Community 197"
Cohesion: 0.22
Nodes (6): YouhanBridgeViewController, CallKit, Capacitor, QuickLook, UIKit, WebKit

### Community 198 - "Community 198"
Cohesion: 0.20
Nodes (11): postgres, redis, depends_on, condition, condition, web, depends_on, env_file (+3 more)

### Community 199 - "Community 199"
Cohesion: 0.27
Nodes (9): body, params, POST, deleteQuery, GET, PATCH, patchBody, callbackSecrets() (+1 more)

### Community 200 - "Community 200"
Cohesion: 0.36
Nodes (8): params, PATCH, GET, POST, setMembers(), TEAM_FIELDS, teamBody, teamCode()

### Community 201 - "Community 201"
Cohesion: 0.27
Nodes (9): call(), EnrolForm(), beginWith(), confirm(), submitPassword(), Stage, EnrolTwoFactorPage(), metadata (+1 more)

### Community 202 - "Community 202"
Cohesion: 0.22
Nodes (8): inter, jetbrainsMono, manrope, metadata, RootLayout(), viewport, ServiceWorkerRegistration(), THEME_BOOTSTRAP

### Community 203 - "Community 203"
Cohesion: 0.36
Nodes (9): register(), mockProviders(), PROVIDER_KEYS, assertEnvironmentSeparation(), assertProductionConfiguration(), assertProxyConfiguration(), assertRowLevelSecurityApplies(), databaseName() (+1 more)

### Community 204 - "Community 204"
Cohesion: 0.18
Nodes (8): ANDROID, apnsKey, apnsRequests, calls, CONFIGURED, loadSender(), pem, { privateKey, publicKey }

### Community 206 - "Community 206"
Cohesion: 0.20
Nodes (9): final_message, package_update, package_upgrade, packages, runcmd, write_files, content, path (+1 more)

### Community 207 - "Community 207"
Cohesion: 0.24
Nodes (10): ANTIVIRUS_PROVIDER, CLAMAV_HOST, CLAMAV_PORT, DATABASE_URL, FACE_SERVICE_URL, PROCESS_ROLE, REDIS_URL, S3_ENDPOINT (+2 more)

### Community 208 - "Community 208"
Cohesion: 0.20
Nodes (9): MP_SMTP_AUTH_ACCEPT_ANY, MP_SMTP_AUTH_ALLOW_INSECURE, MP_SMTP_REQUIRE_STARTTLS, MP_SMTP_TLS_CERT, MP_SMTP_TLS_KEY, environment, volumes, services (+1 more)

### Community 209 - "Community 209"
Cohesion: 0.20
Nodes (10): context, dockerfile, target, NODE_ENV, build, command, env_file, environment (+2 more)

### Community 210 - "Community 210"
Cohesion: 0.20
Nodes (7): @node-rs/argon2@^2.0.2, adapter, argv, client, email, fullName, @node-rs/argon2

### Community 211 - "Community 211"
Cohesion: 0.27
Nodes (8): engines, node, Assert-NoRepoNodeProcesses(), Get-LockHash(), Get-RepoNodeProcesses(), Test-DependenciesCurrent(), Test-DockerEngine(), Wait-DockerEngine()

### Community 212 - "Community 212"
Cohesion: 0.20
Nodes (7): args, clean, client, envFile, existing, results, total

### Community 213 - "Community 213"
Cohesion: 0.22
Nodes (8): adapter, apply, argv, db, forced, main(), withPlatformTx(), only()

### Community 214 - "Community 214"
Cohesion: 0.31
Nodes (6): dynamic, GET(), hostname(), isDirectLocalRequest(), listed(), LOOPBACK

### Community 215 - "Community 215"
Cohesion: 0.29
Nodes (9): POST, CONTACT, MESSAGE, refuse(), sendLeadSms(), smsBlock(), SmsContact, smsRecipientOf() (+1 more)

### Community 216 - "Community 216"
Cohesion: 0.31
Nodes (7): Field(), ModuleChoice(), NewWorkspaceForm(), SectionHeading(), StepActions(), steps, WorkspaceSummary()

### Community 217 - "Community 217"
Cohesion: 0.33
Nodes (7): metadata, PrivacyPage(), metadata, SupportPage(), legalFacts, missingLegalFacts(), OWNER_TODO

### Community 218 - "Community 218"
Cohesion: 0.31
Nodes (8): ANGLES, FaceEnrolmentConsole(), call(), captureSample(), grab(), resetEnrolment(), save(), stopCamera()

### Community 219 - "Community 219"
Cohesion: 0.38
Nodes (10): SecurityScreen(), beginEnrolment(), call(), cancelDeletion(), changePassword(), confirmEnrolment(), grantConsent(), requestDeletion() (+2 more)

### Community 220 - "Community 220"
Cohesion: 0.38
Nodes (8): Agent, ListAssign(), nameOf(), Outcome(), RecordActions(), RecordAssign(), send(), STATUS_LABEL

### Community 221 - "Community 221"
Cohesion: 0.20
Nodes (6): FIELD_MAP, Column, MODEL_OF, models, root, schema

### Community 222 - "Community 222"
Cohesion: 0.24
Nodes (8): cookieJar, cookies, elements(), found(), ids, listed(), suffix, tail

### Community 223 - "Community 223"
Cohesion: 0.47
Nodes (9): die(), node_in_migrate(), phase_backup(), phase_checkout(), phase_deploy(), phase_gate(), phase_images(), phase_verify() (+1 more)

### Community 225 - "Community 225"
Cohesion: 0.22
Nodes (9): context, dockerfile, target, build, command, env_file, extra_hosts, profiles (+1 more)

### Community 226 - "Community 226"
Cohesion: 0.22
Nodes (9): depends_on, environment, image, ports, restart, volumes, ACME_EMAIL, APP_DOMAIN (+1 more)

### Community 227 - "Community 227"
Cohesion: 0.22
Nodes (9): FACE_MODEL_DIR, FACE_SERVICE_ENV, FACE_SERVICE_TOKEN, FACE_SERVICE_TOKEN_PREVIOUS, environment, logging, ports, volumes (+1 more)

### Community 228 - "Community 228"
Cohesion: 0.22
Nodes (9): MINIO_ROOT_PASSWORD, MINIO_ROOT_USER, command, environment, image, logging, ports, volumes (+1 more)

### Community 229 - "Community 229"
Cohesion: 0.42
Nodes (8): admin(), bad(), cleanup(), manifest(), ok(), refuse(), say(), restore-verify.sh script

### Community 230 - "Community 230"
Cohesion: 0.42
Nodes (6): bad(), expect(), make_backup(), ok(), test-backup-roundtrip.sh script, status_backup()

### Community 231 - "Community 231"
Cohesion: 0.42
Nodes (8): loadContext(), params, POST, PUT, recipientFor(), sendBody, senderName(), shownTo()

### Community 232 - "Community 232"
Cohesion: 0.31
Nodes (8): DELETE, PATCH, patchBody, reach(), POST, assertTargetAssignee(), setsOwnTarget(), targetReach()

### Community 233 - "Community 233"
Cohesion: 0.39
Nodes (8): CallActions(), api(), createFollowUp(), recordConsent(), submitTranscript(), triggerAnalysis(), updateOutcome(), withdrawConsent()

### Community 234 - "Community 234"
Cohesion: 0.39
Nodes (8): isLeadSource(), RETRY, DeliveryStatus, inFlight(), listDeliveries(), replayDelivery(), statusOf(), storedProvider()

### Community 235 - "Community 235"
Cohesion: 0.22
Nodes (7): base, connectionCredentials, enqueue, findDuplicates, inboundEvent, leadgenEvent, prisma

### Community 236 - "Community 236"
Cohesion: 0.44
Nodes (7): makeAgent(), makeLead(), openEntry(), queued(), setRule(), suffix, T()

### Community 237 - "Community 237"
Cohesion: 0.22
Nodes (7): forbidden, mustChangePassword, myDeletionRequest, myDevices, myEmployee, resolveWorkspacePage, twoFactorStatus

### Community 238 - "Community 238"
Cohesion: 0.25
Nodes (5): allTsx(), DECLARED_IN_JS, root, sources, usedTokens()

### Community 239 - "Community 239"
Cohesion: 0.22
Nodes (9): POSTGRES_DB, POSTGRES_PASSWORD, POSTGRES_USER, services, env, image, options, ports (+1 more)

### Community 240 - "Community 240"
Cohesion: 0.22
Nodes (9): with, cache, cache-dependency-path, if-no-files-found, key, name, node-version, path (+1 more)

### Community 241 - "Community 241"
Cohesion: 0.32
Nodes (3): model_root(), ModelsMissing, _session()

### Community 242 - "Community 242"
Cohesion: 0.25
Nodes (8): REDIS_PASSWORD, command, environment, image, logging, ports, volumes, redis

### Community 243 - "Community 243"
Cohesion: 0.25
Nodes (7): networks, networks, staging_gate, services, migrate, external, name

### Community 244 - "Community 244"
Cohesion: 0.25
Nodes (8): volumes, amdata, clamavdb, facemodels, miniodata, pgdata, promdata, redisdata

### Community 245 - "Community 245"
Cohesion: 0.46
Nodes (6): bad(), check(), ok(), run(), selected(), retention-test.sh script

### Community 246 - "Community 246"
Cohesion: 0.46
Nodes (6): fail(), need(), note_bad(), remote_dir(), say(), backup-ship.sh script

### Community 247 - "Community 247"
Cohesion: 0.32
Nodes (6): main(), catalogueTokens(), CONFIGURATION_SURFACE, MANAGED_RECORD, PERMISSION_CATALOGUE, RECORD

### Community 248 - "Community 248"
Cohesion: 0.29
Nodes (5): download(), frames, grey, source(), sources

### Community 249 - "Community 249"
Cohesion: 0.39
Nodes (6): LeadTemperature, leadTemperature(), temperatureFromAnalysis(), TemperatureInput, TemperatureReason, TemperatureResult

### Community 250 - "Community 250"
Cohesion: 0.39
Nodes (7): entityRoute(), deliverPush(), emailHrEvent(), emailRecord(), HrEventJob, pushRecord(), RecordPushJob

### Community 251 - "Community 251"
Cohesion: 0.25
Nodes (6): PEOPLE, PLATFORM, run, SALES, workspace, WORKSPACE_LEVEL

### Community 252 - "Community 252"
Cohesion: 0.29
Nodes (8): CI, NODE_OPTIONS, env, if, runs-on, timeout-minutes, face-e2e, env

### Community 253 - "Community 253"
Cohesion: 0.43
Nodes (8): steps, id, if, name, run, timeout-minutes, uses, steps

### Community 254 - "Community 254"
Cohesion: 0.29
Nodes (6): volumes, attendance, caddyconfig, caddydata, x-logging, driver

### Community 255 - "Community 255"
Cohesion: 0.38
Nodes (7): logging, driver, options, logging, max-file, max-size, options

### Community 256 - "Community 256"
Cohesion: 0.29
Nodes (7): environment, image, logging, ports, volumes, CLAMAV_NO_MILTERD, clamav

### Community 257 - "Community 257"
Cohesion: 0.29
Nodes (7): MP_SMTP_AUTH_ACCEPT_ANY, MP_SMTP_AUTH_ALLOW_INSECURE, environment, image, logging, ports, mailpit

### Community 258 - "Community 258"
Cohesion: 0.48
Nodes (7): APP_ENV, DATABASE_URL, MIGRATION_DATABASE_URL, REDIS_URL, SHADOW_DATABASE_URL, environment, environment

### Community 259 - "Community 259"
Cohesion: 0.52
Nodes (6): act(), did(), fail(), say(), provision-host.sh script, skip()

### Community 260 - "Community 260"
Cohesion: 0.48
Nodes (6): fail(), HAVE, prop(), say(), backup-status.sh script, stamp_epoch()

### Community 261 - "Community 261"
Cohesion: 0.57
Nodes (6): die(), note(), restart(), say(), set_var(), rotate-face-token.sh script

### Community 262 - "Community 262"
Cohesion: 0.43
Nodes (6): metadata, ServiceLoginPage(), ServiceLoginForm(), enter(), onCodeChange(), submit()

### Community 263 - "Community 263"
Cohesion: 0.48
Nodes (4): metadata, Metric(), Row(), SiteVisitPage()

### Community 264 - "Community 264"
Cohesion: 0.52
Nodes (4): contentStream(), PdfLine, pdfString(), renderPdf()

### Community 265 - "Community 265"
Cohesion: 0.29
Nodes (7): ACCOUNT_DELETION_EXECUTION_ENABLED, ALLOW_DEMO_SEED, DEMO_PASSWORD, E2E_DELETION_WORKER, FACE_E2E, NODE_ENV, env

### Community 267 - "Community 267"
Cohesion: 0.33
Nodes (6): APP_ENV, METRICS_TOKEN, environment, ports, profiles, prometheus

### Community 268 - "Community 268"
Cohesion: 0.33
Nodes (6): MINIO_ROOT_PASSWORD, MINIO_ROOT_USER, environment, ports, restart, minio

### Community 269 - "Community 269"
Cohesion: 0.33
Nodes (6): POSTGRES_HOST_AUTH_METHOD, POSTGRES_INITDB_ARGS, POSTGRES_PASSWORD, environment, ports, postgres

### Community 270 - "Community 270"
Cohesion: 0.53
Nodes (6): context, dockerfile, target, build, build, build

### Community 271 - "Community 271"
Cohesion: 0.40
Nodes (6): postgres, redis, condition, condition, depends_on, depends_on

### Community 272 - "Community 272"
Cohesion: 0.33
Nodes (6): METRICS_TOKEN, PROMETHEUS_RETENTION, environment, ports, profiles, prometheus

### Community 273 - "Community 273"
Cohesion: 0.33
Nodes (6): MINIO_ROOT_PASSWORD, MINIO_ROOT_USER, environment, ports, restart, minio

### Community 274 - "Community 274"
Cohesion: 0.53
Nodes (4): mailpit(), messagesTo(), sleep(), waitForMail()

### Community 275 - "Community 275"
Cohesion: 0.47
Nodes (3): ForgotPasswordForm(), ForgotPasswordPage(), metadata

### Community 276 - "Community 276"
Cohesion: 0.47
Nodes (3): metadata, ResetPasswordPage(), ResetPasswordForm()

### Community 278 - "Community 278"
Cohesion: 0.80
Nodes (4): die(), emit_receiver(), safe(), alertmanager-entrypoint.sh script

### Community 279 - "Community 279"
Cohesion: 0.40
Nodes (5): FACE_SERVICE_ENV, environment, ports, restart, face

### Community 280 - "Community 280"
Cohesion: 0.40
Nodes (5): replicas, worker, deploy, env_file, volumes

### Community 281 - "Community 281"
Cohesion: 0.40
Nodes (5): FACE_SERVICE_ENV, environment, ports, restart, face

### Community 282 - "Community 282"
Cohesion: 0.40
Nodes (5): REDIS_PASSWORD, environment, ports, restart, redis

### Community 283 - "Community 283"
Cohesion: 0.40
Nodes (5): overrides, deepmerge-ts, mysql2, nanoid, postcss

### Community 284 - "Community 284"
Cohesion: 0.40
Nodes (4): arrowParens, printWidth, singleQuote, trailingComma

### Community 285 - "Community 285"
Cohesion: 0.40
Nodes (4): BOOTSTRAP, client, present, problems

### Community 286 - "Community 286"
Cohesion: 0.40
Nodes (3): phone, signedIn(), user()

### Community 289 - "Community 289"
Cohesion: 0.83
Nodes (3): fail(), say(), backup.sh script

### Community 290 - "Community 290"
Cohesion: 0.83
Nodes (3): fail(), say(), install-backup-schedule.sh script

### Community 291 - "Community 291"
Cohesion: 0.67
Nodes (3): leaf(), MSYS_NO_PATHCONV, make-local-tls.sh script

### Community 293 - "Community 293"
Cohesion: 0.50
Nodes (4): verify, runs-on, services, timeout-minutes

## Knowledge Gaps
- **2855 isolated node(s):** `name`, `workflow_dispatch`, `branches`, `contents`, `runs-on` (+2850 more)
  These have ≤1 connection - possible missing edges. (Counts symbols only; 3659 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **28 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `CallsPage()` connect `Community 6` to `Community 2`, `Community 34`, `Community 66`, `Community 7`, `Community 91`?**
  _High betweenness centrality (0.000) - this node is a cross-community bridge._
- **What connects `name`, `workflow_dispatch`, `branches` to the rest of the system?**
  _2855 weakly-connected nodes found - possible missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.021405560195680705 - nodes in this community are weakly interconnected._
- **Why does `route()` connect `Community 1` to `Community 0`, `Community 35`, `Community 38`, `Community 17`, `Community 18`, `Community 53`, `Community 59`, `Community 30`?**
  _High betweenness centrality (0.000) - this node is a cross-community bridge._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.016311993056179103 - nodes in this community are weakly interconnected._
- **Why does `renderCell()` connect `Community 56` to `Community 8`, `Community 46`?**
  _High betweenness centrality (0.000) - this node is a cross-community bridge._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.03193307874158938 - nodes in this community are weakly interconnected._