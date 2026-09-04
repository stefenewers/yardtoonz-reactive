CREATE TABLE `orchestration_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`candidate_id` text NOT NULL,
	`status` text DEFAULT 'RUNNING' NOT NULL,
	`current_step_key` text,
	`error_code` text,
	`safe_error_message` text,
	`started_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "orchestration_runs_status_valid" CHECK("orchestration_runs"."status" IN ('RUNNING', 'COMPLETE', 'FAILED', 'CANCELLED')),
	CONSTRAINT "orchestration_runs_current_step_valid" CHECK("orchestration_runs"."current_step_key" IS NULL OR "orchestration_runs"."current_step_key" IN ('trend-scout', 'humor-analyst', 'yardtoonz-director', 'clay-artist', 'animator', 'qa-inspector')),
	CONSTRAINT "orchestration_runs_terminal_reported" CHECK(("orchestration_runs"."status" IN ('COMPLETE', 'CANCELLED') AND "orchestration_runs"."completed_at" IS NOT NULL) OR ("orchestration_runs"."status" IN ('RUNNING', 'FAILED') AND "orchestration_runs"."completed_at" IS NULL)),
	CONSTRAINT "orchestration_runs_failure_reports_error" CHECK(("orchestration_runs"."status" = 'FAILED' AND "orchestration_runs"."error_code" IS NOT NULL) OR ("orchestration_runs"."status" != 'FAILED' AND "orchestration_runs"."error_code" IS NULL)),
	CONSTRAINT "orchestration_runs_completed_after_started" CHECK("orchestration_runs"."completed_at" IS NULL OR "orchestration_runs"."completed_at" >= "orchestration_runs"."started_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orchestration_runs_candidate_active_unique` ON `orchestration_runs` (`candidate_id`) WHERE status IN ('RUNNING', 'FAILED');--> statement-breakpoint
CREATE INDEX `orchestration_runs_candidate_id_idx` ON `orchestration_runs` (`candidate_id`);