import { relations, sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import {
  agentKeys,
  agentRunProviders,
  agentRunStates,
} from "@/domain/agent-trace";
import { qaOverallStatuses } from "@/domain/qa-report";

import { orchestrationRunStatuses } from "@/shared/orchestration";

import {
  animationProviders,
  artifactProviders,
  directorProviders,
  imageProviders,
} from "@/lib/providers";
import {
  feedRunErrorCodes,
  feedRunStatuses,
  trendFeedSourceKinds,
} from "@/shared/trend-scout";

export const humorAnalysisCorpusSources = [
  "DEMO_CORPUS",
  "PERSISTED_EXCERPTS",
] as const;

export const productionStatuses = [
  "DRAFT",
  "RIGHTS_CONFIRMED",
  "QUEUED",
  "EXTRACTING",
  "STYLING",
  "ANIMATING",
  "MUXING",
  "VALIDATING",
  "COMPLETE",
  "FAILED",
] as const;

export const productionStageNames = [
  "INGEST_SOURCE",
  "EXTRACT_MEDIA",
  "SELECT_KEYFRAME",
  "STYLE_IMAGE",
  "ANIMATE_IMAGE",
  "MUX_AND_NORMALIZE",
  "VALIDATE_OUTPUT",
] as const;

export const productionStageStatuses = [
  "WAITING",
  "RUNNING",
  "COMPLETE",
  "FAILED",
] as const;

export const artifactKinds = [
  "SOURCE_VIDEO",
  "EXTRACTED_CLIP",
  "EXTRACTED_AUDIO",
  "KEYFRAME",
  "STYLED_FRAME",
  "SILENT_ANIMATION",
  "FINAL_VIDEO",
] as const;

export const editorialDecisionSubjects = ["CANDIDATE", "OUTPUT"] as const;
export const editorialDecisionValues = ["APPROVED", "REJECTED"] as const;

const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });

export const candidates = sqliteTable("candidates", {
  id: text("id").primaryKey(),
  platform: text("platform").notNull(),
  sourceUrl: text("source_url"),
  sourceLabel: text("source_label").notNull(),
  caption: text("caption").notNull(),
  publishedAt: text("published_at"),
  observedAt: text("observed_at").notNull(),
  metricsJson: text("metrics_json").notNull(),
  adaptationNote: text("adaptation_note"),
  fitChecklistJson: text("fit_checklist_json").notNull(),
  scoresJson: text("scores_json").notNull(),
  status: text("status").notNull().default("NEW"),
  decisionReason: text("decision_reason"),
  decidedAt: text("decided_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const candidateComments = sqliteTable(
  "candidate_comments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    candidateId: text("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    excerpt: text("excerpt").notNull(),
  },
  (table) => [
    uniqueIndex("candidate_comments_candidate_position_unique").on(
      table.candidateId,
      table.position,
    ),
  ],
);

export const rightsConfirmations = sqliteTable(
  "rights_confirmations",
  {
    id: text("id").primaryKey(),
    candidateId: text("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    confirmedAt: text("confirmed_at").notNull(),
    confirmationTextVersion: text("confirmation_text_version").notNull(),
  },
  (table) => [
    uniqueIndex("rights_candidate_id_unique").on(table.candidateId),
    uniqueIndex("rights_id_candidate_unique").on(table.id, table.candidateId),
  ],
);

export const productions = sqliteTable(
  "productions",
  {
    id: text("id").primaryKey(),
    candidateId: text("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "restrict" }),
    rightsConfirmationId: text("rights_confirmation_id"),
    status: text("status", { enum: productionStatuses })
      .notNull()
      .default("DRAFT"),
    imageProvider: text("image_provider", { enum: imageProviders }).notNull(),
    animationProvider: text("animation_provider", {
      enum: animationProviders,
    }).notNull(),
    segmentStartMs: integer("segment_start_ms").notNull(),
    segmentEndMs: integer("segment_end_ms").notNull(),
    segmentDurationMs: integer("segment_duration_ms").notNull(),
    creativeDirection: text("creative_direction"),
    activeStage: text("active_stage", { enum: productionStageNames }),
    attempt: integer("attempt").notNull().default(1),
    errorCode: text("error_code"),
    safeErrorMessage: text("safe_error_message"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    index("productions_candidate_id_idx").on(table.candidateId),
    foreignKey({
      name: "productions_candidate_rights_fk",
      columns: [table.rightsConfirmationId, table.candidateId],
      foreignColumns: [rightsConfirmations.id, rightsConfirmations.candidateId],
    }).onDelete("restrict"),
    check("productions_attempt_positive", sql`${table.attempt} > 0`),
    check(
      "productions_rights_gate",
      sql`${table.status} = 'DRAFT' OR ${table.rightsConfirmationId} IS NOT NULL`,
    ),
    check(
      "productions_status_valid",
      sql`${table.status} IN ('DRAFT', 'RIGHTS_CONFIRMED', 'QUEUED', 'EXTRACTING', 'STYLING', 'ANIMATING', 'MUXING', 'VALIDATING', 'COMPLETE', 'FAILED')`,
    ),
    check(
      "productions_providers_valid",
      sql`${table.imageProvider} IN ('MOCK', 'OPENAI') AND ${table.animationProvider} IN ('MOCK', 'RUNWAY')`,
    ),
    check(
      "productions_active_stage_valid",
      sql`${table.activeStage} IS NULL OR ${table.activeStage} IN ('INGEST_SOURCE', 'EXTRACT_MEDIA', 'SELECT_KEYFRAME', 'STYLE_IMAGE', 'ANIMATE_IMAGE', 'MUX_AND_NORMALIZE', 'VALIDATE_OUTPUT')`,
    ),
    check(
      "productions_segment_bounds",
      sql`${table.segmentStartMs} >= 0 AND ${table.segmentEndMs} > ${table.segmentStartMs} AND ${table.segmentDurationMs} = ${table.segmentEndMs} - ${table.segmentStartMs} AND ${table.segmentDurationMs} BETWEEN 5000 AND 8000`,
    ),
  ],
);

export const productionStages = sqliteTable(
  "production_stages",
  {
    id: text("id").primaryKey(),
    productionId: text("production_id")
      .notNull()
      .references(() => productions.id, { onDelete: "cascade" }),
    name: text("name", { enum: productionStageNames }).notNull(),
    status: text("status", { enum: productionStageStatuses })
      .notNull()
      .default("WAITING"),
    attempt: integer("attempt").notNull().default(1),
    inputFingerprint: text("input_fingerprint"),
    /**
     * Live-provider request ID for reconcile-before-retry. Written when a
     * stage execution creates (or reconciles) a remote provider request so a
     * retried attempt reconciles by request ID instead of generating again.
     */
    providerRequestId: text("provider_request_id"),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    errorCode: text("error_code"),
    safeErrorMessage: text("safe_error_message"),
    workerLeaseOwner: text("worker_lease_owner"),
    workerLeaseExpiresAt: timestamp("worker_lease_expires_at"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("production_stages_production_name_attempt_unique").on(
      table.productionId,
      table.name,
      table.attempt,
    ),
    uniqueIndex("production_stages_id_production_unique").on(
      table.id,
      table.productionId,
    ),
    index("production_stages_lease_idx").on(
      table.status,
      table.workerLeaseExpiresAt,
    ),
    check("production_stages_attempt_positive", sql`${table.attempt} > 0`),
    check(
      "production_stages_name_valid",
      sql`${table.name} IN ('INGEST_SOURCE', 'EXTRACT_MEDIA', 'SELECT_KEYFRAME', 'STYLE_IMAGE', 'ANIMATE_IMAGE', 'MUX_AND_NORMALIZE', 'VALIDATE_OUTPUT')`,
    ),
    check(
      "production_stages_status_valid",
      sql`${table.status} IN ('WAITING', 'RUNNING', 'COMPLETE', 'FAILED')`,
    ),
  ],
);

export const artifacts = sqliteTable(
  "artifacts",
  {
    id: text("id").primaryKey(),
    productionId: text("production_id")
      .notNull()
      .references(() => productions.id, { onDelete: "cascade" }),
    productionStageId: text("production_stage_id").notNull(),
    kind: text("kind", { enum: artifactKinds }).notNull(),
    storageKey: text("storage_key").notNull().unique(),
    mimeType: text("mime_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: text("sha256").notNull(),
    parentArtifactIdsJson: text("parent_artifact_ids_json").notNull(),
    provider: text("provider", { enum: artifactProviders }).notNull(),
    providerRequestId: text("provider_request_id"),
    metadataJson: text("metadata_json").notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    index("artifacts_production_id_idx").on(table.productionId),
    index("artifacts_production_stage_id_idx").on(table.productionStageId),
    foreignKey({
      name: "artifacts_stage_production_fk",
      columns: [table.productionStageId, table.productionId],
      foreignColumns: [productionStages.id, productionStages.productionId],
    }).onDelete("cascade"),
    check("artifacts_byte_size_nonnegative", sql`${table.byteSize} >= 0`),
    check(
      "artifacts_kind_valid",
      sql`${table.kind} IN ('SOURCE_VIDEO', 'EXTRACTED_CLIP', 'EXTRACTED_AUDIO', 'KEYFRAME', 'STYLED_FRAME', 'SILENT_ANIMATION', 'FINAL_VIDEO')`,
    ),
    check(
      "artifacts_provider_valid",
      sql`${table.provider} IN ('USER_UPLOAD', 'FFMPEG', 'MOCK', 'OPENAI', 'RUNWAY')`,
    ),
  ],
);

export const editorialDecisions = sqliteTable(
  "editorial_decisions",
  {
    id: text("id").primaryKey(),
    candidateId: text("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    productionId: text("production_id").references(() => productions.id, {
      onDelete: "cascade",
    }),
    subject: text("subject", { enum: editorialDecisionSubjects })
      .notNull()
      .default("CANDIDATE"),
    decision: text("decision", { enum: editorialDecisionValues }).notNull(),
    reason: text("reason"),
    decidedAt: text("decided_at").notNull(),
  },
  (table) => [
    index("editorial_decisions_candidate_id_idx").on(table.candidateId),
    index("editorial_decisions_production_id_idx").on(table.productionId),
    check(
      "editorial_decisions_subject_target",
      sql`(${table.subject} = 'CANDIDATE' AND ${table.productionId} IS NULL) OR (${table.subject} = 'OUTPUT' AND ${table.productionId} IS NOT NULL)`,
    ),
    check(
      "editorial_decisions_value_valid",
      sql`${table.decision} IN ('APPROVED', 'REJECTED')`,
    ),
  ],
);

export const workerHeartbeats = sqliteTable("worker_heartbeats", {
  workerId: text("worker_id").primaryKey(),
  observedAt: timestamp("observed_at").notNull(),
});

/**
 * Persisted Director Agent treatments. One current treatment per candidate:
 * the unique candidate index makes treatment creation idempotent, so a
 * repeated ask during the demo returns the same reviewable row instead of
 * duplicating history that belongs to the agent-run trace.
 */
export const directorTreatments = sqliteTable(
  "director_treatments",
  {
    id: text("id").primaryKey(),
    candidateId: text("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: directorProviders }).notNull(),
    /**
     * Live-provider request ID for reconcile-before-retry. Written when a
     * LIVE treatment run creates (or reconciles) a remote provider request.
     */
    providerRequestId: text("provider_request_id"),
    /**
     * Disclosed generating model for the run that produced the treatment;
     * null when the row predates run attribution.
     */
    model: text("model"),
    treatmentJson: text("treatment_json").notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("director_treatments_candidate_unique").on(table.candidateId),
    check(
      "director_treatments_provider_valid",
      sql`${table.provider} IN ('MOCK', 'OPENAI')`,
    ),
  ],
);

/**
 * Persisted storyboards. One current storyboard per candidate, derived
 * from that candidate's Director treatment: the treatment is the only
 * input, so a storyboard row is a cue-plan snapshot of one treatment.
 */
export const storyboards = sqliteTable(
  "storyboards",
  {
    id: text("id").primaryKey(),
    candidateId: text("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: directorProviders }).notNull(),
    treatmentId: text("treatment_id").notNull(),
    planJson: text("plan_json").notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("storyboards_candidate_unique").on(table.candidateId),
    check("storyboards_provider_valid", sql`${table.provider} IN ('MOCK')`),
  ],
);

/**
 * Persisted Trend Scout runs. One row per run request: which themed feeds
 * were examined, what the fingerprint dedupe found, and which candidates
 * were imported, so the inbox header can show a trustworthy last-run
 * status without recomputing anything.
 */
export const feedRuns = sqliteTable(
  "feed_runs",
  {
    id: text("id").primaryKey(),
    themesJson: text("themes_json").notNull(),
    status: text("status", { enum: feedRunStatuses }).notNull(),
    sourceKind: text("source_kind", {
      enum: trendFeedSourceKinds,
    }).notNull(),
    discoveredCount: integer("discovered_count").notNull(),
    duplicateCount: integer("duplicate_count").notNull(),
    importedCount: integer("imported_count").notNull(),
    importedCandidateIdsJson: text("imported_candidate_ids_json").notNull(),
    errorCode: text("error_code", { enum: feedRunErrorCodes }),
    safeErrorMessage: text("safe_error_message"),
    startedAt: timestamp("started_at").notNull(),
    completedAt: timestamp("completed_at").notNull(),
  },
  (table) => [
    check(
      "feed_runs_status_valid",
      sql`${table.status} IN ('COMPLETE', 'FAILED')`,
    ),
    check(
      "feed_runs_failure_reports_error",
      sql`(${table.status} = 'FAILED' AND ${table.errorCode} IS NOT NULL) OR (${table.status} = 'COMPLETE' AND ${table.errorCode} IS NULL)`,
    ),
    check(
      "feed_runs_counts_nonnegative",
      sql`${table.discoveredCount} >= 0 AND ${table.duplicateCount} >= 0 AND ${table.importedCount} >= 0`,
    ),
    check(
      "feed_runs_completed_after_started",
      sql`${table.completedAt} >= ${table.startedAt}`,
    ),
  ],
);

/**
 * Persisted Control Center trace: one row per named-agent run, mutated in
 * place through the same WAITING/RUNNING/COMPLETE/FAILED lifecycle the
 * production stages use. Writers materialize a row only when the agent's
 * work reaches a terminal state (COMPLETE or FAILED) so the trace records
 * observed outcomes with measured elapsed time and produced artifact ids —
 * never anticipated work. Insertion order (the autoincrement id) is the
 * demo's chronological agent story per candidate.
 */
export const agentRuns = sqliteTable(
  "agent_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    agentKey: text("agent_key", { enum: agentKeys }).notNull(),
    state: text("state", { enum: agentRunStates }).notNull().default("WAITING"),
    attempt: integer("attempt").notNull().default(1),
    /** Bounded scalar record of the evidence the run actually received. */
    inputEvidenceJson: text("input_evidence_json").notNull(),
    decision: text("decision"),
    /** Self-reported agent confidence; null when the agent reports none. */
    confidence: real("confidence"),
    /** Provider that performed the work; null for local deterministic agents. */
    provider: text("provider", { enum: agentRunProviders }),
    model: text("model"),
    /** Measured wall time of the observed work; null when not measured. */
    elapsedMs: integer("elapsed_ms"),
    /** Artifact ids the run produced, in stable order (JSON array). */
    artifactIdsJson: text("artifact_ids_json").notNull(),
    candidateId: text("candidate_id").references(() => candidates.id, {
      onDelete: "cascade",
    }),
    productionId: text("production_id").references(() => productions.id, {
      onDelete: "cascade",
    }),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    index("agent_runs_candidate_id_idx").on(table.candidateId),
    index("agent_runs_production_id_idx").on(table.productionId),
    check(
      "agent_runs_agent_key_valid",
      sql`${table.agentKey} IN ('trend-scout', 'humor-analyst', 'yardtoonz-director', 'clay-artist', 'animator', 'qa-inspector')`,
    ),
    check(
      "agent_runs_state_valid",
      sql`${table.state} IN ('WAITING', 'RUNNING', 'COMPLETE', 'FAILED')`,
    ),
    check(
      "agent_runs_provider_valid",
      sql`${table.provider} IS NULL OR ${table.provider} IN ('MOCK', 'OPENAI', 'RUNWAY')`,
    ),
    check("agent_runs_attempt_positive", sql`${table.attempt} > 0`),
    check(
      "agent_runs_confidence_bounds",
      sql`${table.confidence} IS NULL OR (${table.confidence} >= 0 AND ${table.confidence} <= 1)`,
    ),
    check(
      "agent_runs_elapsed_nonnegative",
      sql`${table.elapsedMs} IS NULL OR ${table.elapsedMs} >= 0`,
    ),
    check(
      "agent_runs_subject_link",
      sql`${table.candidateId} IS NOT NULL OR ${table.productionId} IS NOT NULL`,
    ),
  ],
);

/**
 * Persisted Humor Analyst output. One current analysis per candidate: the
 * analyst refreshes in place, so a row is always the latest evidence read
 * over that candidate's comment corpus. Evidence only — it never feeds the
 * locked candidate scoring.
 */
export const commentAnalyses = sqliteTable(
  "comment_analyses",
  {
    id: text("id").primaryKey(),
    candidateId: text("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    corpusSource: text("corpus_source", {
      enum: humorAnalysisCorpusSources,
    }).notNull(),
    analysisJson: text("analysis_json").notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("comment_analyses_candidate_unique").on(table.candidateId),
    check(
      "comment_analyses_corpus_source_valid",
      sql`${table.corpusSource} IN ('DEMO_CORPUS', 'PERSISTED_EXCERPTS')`,
    ),
  ],
);

/**
 * Persisted QA Inspector reports. One row per inspection run: a report is
 * an observation with a timestamp, so repeats append history instead of
 * overwriting — the latest row is the demo's current QA verdict. The checks
 * JSON is the deterministic runner's results over the production's persisted
 * artifact facts at inspection time, stamped with the runner version so
 * stored reports stay interpretable as check semantics evolve.
 */
export const qaReports = sqliteTable(
  "qa_reports",
  {
    id: text("id").primaryKey(),
    productionId: text("production_id")
      .notNull()
      .references(() => productions.id, { onDelete: "cascade" }),
    candidateId: text("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    runnerVersion: text("runner_version").notNull(),
    overallStatus: text("overall_status", {
      enum: qaOverallStatuses,
    }).notNull(),
    score: integer("score").notNull(),
    checksJson: text("checks_json").notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    index("qa_reports_production_id_idx").on(table.productionId),
    check(
      "qa_reports_overall_status_valid",
      sql`${table.overallStatus} IN ('PASS', 'WARN', 'FAIL')`,
    ),
    check(
      "qa_reports_score_bounds",
      sql`${table.score} >= 0 AND ${table.score} <= 100`,
    ),
  ],
);

export const candidateRelations = relations(candidates, ({ many, one }) => ({
  comments: many(candidateComments),
  editorialDecisions: many(editorialDecisions),
  productions: many(productions),
  rightsConfirmation: one(rightsConfirmations),
  storyboards: many(storyboards),
}));

export const candidateCommentRelations = relations(
  candidateComments,
  ({ one }) => ({
    candidate: one(candidates, {
      fields: [candidateComments.candidateId],
      references: [candidates.id],
    }),
  }),
);

export const rightsConfirmationRelations = relations(
  rightsConfirmations,
  ({ one, many }) => ({
    candidate: one(candidates, {
      fields: [rightsConfirmations.candidateId],
      references: [candidates.id],
    }),
    productions: many(productions),
  }),
);

export const productionRelations = relations(productions, ({ one, many }) => ({
  candidate: one(candidates, {
    fields: [productions.candidateId],
    references: [candidates.id],
  }),
  rightsConfirmation: one(rightsConfirmations, {
    fields: [productions.rightsConfirmationId],
    references: [rightsConfirmations.id],
  }),
  stages: many(productionStages),
  artifacts: many(artifacts),
  editorialDecisions: many(editorialDecisions),
}));

export const productionStageRelations = relations(
  productionStages,
  ({ one, many }) => ({
    production: one(productions, {
      fields: [productionStages.productionId],
      references: [productions.id],
    }),
    artifacts: many(artifacts),
  }),
);

export const artifactRelations = relations(artifacts, ({ one }) => ({
  production: one(productions, {
    fields: [artifacts.productionId],
    references: [productions.id],
  }),
  productionStage: one(productionStages, {
    fields: [artifacts.productionStageId],
    references: [productionStages.id],
  }),
}));

export const editorialDecisionRelations = relations(
  editorialDecisions,
  ({ one }) => ({
    candidate: one(candidates, {
      fields: [editorialDecisions.candidateId],
      references: [candidates.id],
    }),
    production: one(productions, {
      fields: [editorialDecisions.productionId],
      references: [productions.id],
    }),
  }),
);

export const agentRunRelations = relations(agentRuns, ({ one }) => ({
  candidate: one(candidates, {
    fields: [agentRuns.candidateId],
    references: [candidates.id],
  }),
  production: one(productions, {
    fields: [agentRuns.productionId],
    references: [productions.id],
  }),
}));

export const qaReportRelations = relations(qaReports, ({ one }) => ({
  candidate: one(candidates, {
    fields: [qaReports.candidateId],
    references: [candidates.id],
  }),
  production: one(productions, {
    fields: [qaReports.productionId],
    references: [productions.id],
  }),
}));

export const directorTreatmentRelations = relations(
  directorTreatments,
  ({ one }) => ({
    candidate: one(candidates, {
      fields: [directorTreatments.candidateId],
      references: [candidates.id],
    }),
  }),
);

export const storyboardRelations = relations(storyboards, ({ one }) => ({
  candidate: one(candidates, {
    fields: [storyboards.candidateId],
    references: [candidates.id],
  }),
}));

export const commentAnalysisRelations = relations(
  commentAnalyses,
  ({ one }) => ({
    candidate: one(candidates, {
      fields: [commentAnalyses.candidateId],
      references: [candidates.id],
    }),
  }),
);

/**
 * Persisted orchestration runs: one tracked pass of the six-agent demo
 * sequence for one candidate. The row records identity and human intent —
 * started, cancelled, failed-with-error — while step progress is always
 * derived from the persisted agent_runs rows, so the planner can never
 * disagree with the trace it observes. At most one run per candidate is
 * active (RUNNING or FAILED); completed and cancelled runs are history.
 */
export const orchestrationRuns = sqliteTable(
  "orchestration_runs",
  {
    id: text("id").primaryKey(),
    candidateId: text("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    status: text("status", { enum: orchestrationRunStatuses })
      .notNull()
      .default("RUNNING"),
    /** The planner cursor: first step not yet COMPLETE, null when done. */
    currentStepKey: text("current_step_key", { enum: agentKeys }),
    /** Safe failure classification when status is FAILED. */
    errorCode: text("error_code"),
    safeErrorMessage: text("safe_error_message"),
    startedAt: timestamp("started_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    /** Terminal time for COMPLETE and CANCELLED runs; FAILED stays open. */
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    uniqueIndex("orchestration_runs_candidate_active_unique")
      .on(table.candidateId)
      .where(sql`status IN ('RUNNING', 'FAILED')`),
    index("orchestration_runs_candidate_id_idx").on(table.candidateId),
    check(
      "orchestration_runs_status_valid",
      sql`${table.status} IN ('RUNNING', 'COMPLETE', 'FAILED', 'CANCELLED')`,
    ),
    check(
      "orchestration_runs_current_step_valid",
      sql`${table.currentStepKey} IS NULL OR ${table.currentStepKey} IN ('trend-scout', 'humor-analyst', 'yardtoonz-director', 'clay-artist', 'animator', 'qa-inspector')`,
    ),
    check(
      "orchestration_runs_terminal_reported",
      sql`(${table.status} IN ('COMPLETE', 'CANCELLED') AND ${table.completedAt} IS NOT NULL) OR (${table.status} IN ('RUNNING', 'FAILED') AND ${table.completedAt} IS NULL)`,
    ),
    check(
      "orchestration_runs_failure_reports_error",
      sql`(${table.status} = 'FAILED' AND ${table.errorCode} IS NOT NULL) OR (${table.status} != 'FAILED' AND ${table.errorCode} IS NULL)`,
    ),
    check(
      "orchestration_runs_completed_after_started",
      sql`${table.completedAt} IS NULL OR ${table.completedAt} >= ${table.startedAt}`,
    ),
  ],
);
