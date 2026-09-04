import { z } from "zod";

import {
  qaCheckKeys,
  qaCheckStatuses,
  qaOverallStatuses,
  qaSeverities,
} from "../domain/qa-report";

/**
 * Public contract for persisted QA Inspector reports. The Control Center
 * reads one report list per production; every field is bounded and safe to
 * render, mirroring the persisted qa_reports row plus its parsed checks.
 */

export const qaCheckResultSchema = z
  .object({
    key: z.enum(qaCheckKeys),
    label: z.string().trim().min(1),
    status: z.enum(qaCheckStatuses),
    /** Absent on PASS; declared importance of a WARN or FAIL. */
    severity: z.enum(qaSeverities).optional(),
    /** Absent on PASS; the concrete next step that clears the finding. */
    remediation: z.string().trim().min(1).optional(),
    detail: z.string().trim().min(1),
  })
  .readonly();
export type QaCheckResultView = z.infer<typeof qaCheckResultSchema>;

export const qaReportViewSchema = z
  .object({
    id: z.string().trim().min(1),
    productionId: z.string().trim().min(1),
    candidateId: z.string().trim().min(1),
    /** Runner semantics that produced this report. */
    runnerVersion: z.string().trim().min(1),
    overallStatus: z.enum(qaOverallStatuses),
    score: z.number().int().min(0).max(100),
    /** Registry order: stable across runs of the same runner version. */
    checks: z.array(qaCheckResultSchema),
    createdAt: z.iso.datetime(),
  })
  .readonly();
export type QaReportView = z.infer<typeof qaReportViewSchema>;

export const qaReportResponseSchema = z
  .object({
    /** The report the POST run just persisted. */
    report: qaReportViewSchema,
  })
  .readonly();
export type QaReportResponse = z.infer<typeof qaReportResponseSchema>;

/** Newest first: the latest inspection is the one the demo judges by. */
export const qaReportListResponseSchema = z
  .object({
    reports: z.array(qaReportViewSchema),
  })
  .readonly();
export type QaReportListResponse = z.infer<typeof qaReportListResponseSchema>;

export const qaReportErrorCodes = [
  "INVALID_REQUEST",
  "PRODUCTION_NOT_FOUND",
  "INTERNAL_ERROR",
] as const;
export type QaReportErrorCode = (typeof qaReportErrorCodes)[number];

export const qaErrorResponseSchema = z
  .object({
    error: z.object({
      code: z.enum(qaReportErrorCodes),
      message: z.string().trim().min(1),
    }),
  })
  .readonly();
