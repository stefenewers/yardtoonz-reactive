CREATE TABLE `feed_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`themes_json` text NOT NULL,
	`status` text NOT NULL,
	`source_kind` text NOT NULL,
	`discovered_count` integer NOT NULL,
	`duplicate_count` integer NOT NULL,
	`imported_count` integer NOT NULL,
	`imported_candidate_ids_json` text NOT NULL,
	`error_code` text,
	`safe_error_message` text,
	`started_at` integer NOT NULL,
	`completed_at` integer NOT NULL,
	CONSTRAINT "feed_runs_status_valid" CHECK("feed_runs"."status" IN ('COMPLETE', 'FAILED')),
	CONSTRAINT "feed_runs_failure_reports_error" CHECK(("feed_runs"."status" = 'FAILED' AND "feed_runs"."error_code" IS NOT NULL) OR ("feed_runs"."status" = 'COMPLETE' AND "feed_runs"."error_code" IS NULL)),
	CONSTRAINT "feed_runs_counts_nonnegative" CHECK("feed_runs"."discovered_count" >= 0 AND "feed_runs"."duplicate_count" >= 0 AND "feed_runs"."imported_count" >= 0),
	CONSTRAINT "feed_runs_completed_after_started" CHECK("feed_runs"."completed_at" >= "feed_runs"."started_at")
);
