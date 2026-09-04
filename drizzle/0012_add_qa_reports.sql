CREATE TABLE `qa_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`production_id` text NOT NULL,
	`candidate_id` text NOT NULL,
	`runner_version` text NOT NULL,
	`overall_status` text NOT NULL,
	`score` integer NOT NULL,
	`checks_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`production_id`) REFERENCES `productions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "qa_reports_overall_status_valid" CHECK("qa_reports"."overall_status" IN ('PASS', 'WARN', 'FAIL')),
	CONSTRAINT "qa_reports_score_bounds" CHECK("qa_reports"."score" >= 0 AND "qa_reports"."score" <= 100)
);
--> statement-breakpoint
CREATE INDEX `qa_reports_production_id_idx` ON `qa_reports` (`production_id`);