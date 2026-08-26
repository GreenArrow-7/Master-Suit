/**
 * The wire contract for `/api/v1/workspaces/[workspaceSlug]/hr/[resource]`.
 *
 * Lifted out of the route so the route and the handler modules can both name it
 * without importing each other. The route validates with these schemas; the
 * handlers take the types that come out of them, so a resource added to the
 * enum and not handled is a compile error rather than a 200 with an empty body
 * — which is precisely what the dispatcher used to answer for a resource it had
 * no case for, and what `tests/hr/dispatch-characterisation.spec.ts` now
 * catches at run time as well.
 */
import { z } from 'zod';

const paramsSchema = z.object({
  workspaceSlug: z.string().min(2).max(64),
  resource: z.enum([
    'departments',
    'designations',
    'employees',
    'attendance',
    'shifts',
    'leave',
    'holidays',
    'documents',
    'work-locations',
    'leave-types',
    'leave-balances',
    'leave-pending',
    'leave-calendar',
    'checklist',
    'lifecycle',
    'expiring-documents',
    'settlement',
    'attendance-days',
    'attendance-punches',
    'attendance-review',
    'face-status',
    'location-assignments',
    'settings',
    'temporary-requests',
    'exception-requests',
    'exception-reasons',
    'overtime',
    'overtime-pending',
    'payroll-runs',
    'payroll-run',
    'payslips',
    'compensation',
    'roster',
    'shift-changes',
    'requisitions',
    'candidates',
    'candidate',
    'pipeline',
    'review-cycles',
    'reviews',
    'goals',
    'competencies',
    'pips',
    'performance-summary',
    'reports',
    'report',
  ]),
});

const querySchema = z
  .object({
    employeeId: z.string().max(64).optional(),
    phase: z.enum(['ONBOARDING', 'OFFBOARDING']).optional(),
    withinDays: z.coerce.number().int().min(1).max(365).optional(),
    start: z.coerce.date().optional(),
    end: z.coerce.date().optional(),
    noticeShortfallDays: z.coerce.number().int().min(0).max(365).optional(),
    noticeBasis: z.enum(['total', 'basic']).optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
    locationId: z.string().max(64).optional(),
    mine: z.string().optional(),
    status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
    cursor: z.string().max(64).optional(),
    runId: z.string().max(64).optional(),
    candidateId: z.string().max(64).optional(),
    cycleId: z.string().max(64).optional(),
    reportKey: z.string().max(64).optional(),
    departmentId: z.string().max(64).optional(),
    requisitionId: z.string().max(64).optional(),
    requisitionStatus: z.enum(['DRAFT', 'PENDING_APPROVAL', 'OPEN', 'ON_HOLD', 'CLOSED', 'REJECTED']).optional(),
    stage: z
      .enum([
        'APPLIED',
        'SCREENING',
        'SHORTLISTED',
        'INTERVIEW',
        'ASSESSMENT',
        'FINAL_INTERVIEW',
        'OFFER',
        'HIRED',
        'REJECTED',
        'WITHDRAWN',
        'ON_HOLD',
      ])
      .optional(),
  })
  .passthrough();
export type HrResource = z.infer<typeof paramsSchema>['resource'];
export type HrReadParams = z.infer<typeof paramsSchema>;
export type HrReadQuery = z.infer<typeof querySchema>;

export { paramsSchema, querySchema };
