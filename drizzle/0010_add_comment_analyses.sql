CREATE TABLE `comment_analyses` (
	`id` text PRIMARY KEY NOT NULL,
	`candidate_id` text NOT NULL,
	`corpus_source` text NOT NULL,
	`analysis_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "comment_analyses_corpus_source_valid" CHECK("comment_analyses"."corpus_source" IN ('DEMO_CORPUS', 'PERSISTED_EXCERPTS'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `comment_analyses_candidate_unique` ON `comment_analyses` (`candidate_id`);