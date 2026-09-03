import { relations } from "drizzle-orm";
import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

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

export const candidateComments = sqliteTable("candidate_comments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  candidateId: text("candidate_id")
    .notNull()
    .references(() => candidates.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  excerpt: text("excerpt").notNull(),
});

export const editorialDecisions = sqliteTable("editorial_decisions", {
  id: text("id").primaryKey(),
  candidateId: text("candidate_id")
    .notNull()
    .references(() => candidates.id, { onDelete: "cascade" }),
  decision: text("decision").notNull(),
  reason: text("reason"),
  decidedAt: text("decided_at").notNull(),
});

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
  (table) => [uniqueIndex("rights_candidate_id_unique").on(table.candidateId)],
);

export const candidateRelations = relations(candidates, ({ many, one }) => ({
  comments: many(candidateComments),
  rightsConfirmation: one(rightsConfirmations),
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
