CREATE TABLE `agent_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agent_key` text NOT NULL,
	`state` text DEFAULT 'WAITING' NOT NULL,
	`attempt` integer DEFAULT 1 NOT NULL,
	`input_evidence_json` text NOT NULL,
	`decision` text,
	`confidence` real,
	`provider` text,
	`model` text,
	`elapsed_ms` integer,
	`artifact_ids_json` text NOT NULL,
	`candidate_id` text,
	`production_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`production_id`) REFERENCES `productions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_runs_agent_key_valid" CHECK("agent_runs"."agent_key" IN ('trend-scout', 'humor-analyst', 'yardtoonz-director', 'clay-artist', 'animator', 'qa-inspector')),
	CONSTRAINT "agent_runs_state_valid" CHECK("agent_runs"."state" IN ('WAITING', 'RUNNING', 'COMPLETE', 'FAILED')),
	CONSTRAINT "agent_runs_provider_valid" CHECK("agent_runs"."provider" IS NULL OR "agent_runs"."provider" IN ('MOCK', 'OPENAI', 'RUNWAY')),
	CONSTRAINT "agent_runs_attempt_positive" CHECK("agent_runs"."attempt" > 0),
	CONSTRAINT "agent_runs_confidence_bounds" CHECK("agent_runs"."confidence" IS NULL OR ("agent_runs"."confidence" >= 0 AND "agent_runs"."confidence" <= 1)),
	CONSTRAINT "agent_runs_elapsed_nonnegative" CHECK("agent_runs"."elapsed_ms" IS NULL OR "agent_runs"."elapsed_ms" >= 0),
	CONSTRAINT "agent_runs_subject_link" CHECK("agent_runs"."candidate_id" IS NOT NULL OR "agent_runs"."production_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `agent_runs_candidate_id_idx` ON `agent_runs` (`candidate_id`);--> statement-breakpoint
CREATE INDEX `agent_runs_production_id_idx` ON `agent_runs` (`production_id`);