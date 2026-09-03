CREATE TABLE `candidate_comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`candidate_id` text NOT NULL,
	`position` integer NOT NULL,
	`excerpt` text NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`platform` text NOT NULL,
	`source_url` text,
	`source_label` text NOT NULL,
	`caption` text NOT NULL,
	`published_at` text,
	`observed_at` text NOT NULL,
	`metrics_json` text NOT NULL,
	`adaptation_note` text,
	`fit_checklist_json` text NOT NULL,
	`scores_json` text NOT NULL,
	`status` text DEFAULT 'NEW' NOT NULL,
	`decision_reason` text,
	`decided_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `editorial_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`candidate_id` text NOT NULL,
	`decision` text NOT NULL,
	`reason` text,
	`decided_at` text NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `rights_confirmations` (
	`id` text PRIMARY KEY NOT NULL,
	`candidate_id` text NOT NULL,
	`confirmed_at` text NOT NULL,
	`confirmation_text_version` text NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rights_candidate_id_unique` ON `rights_confirmations` (`candidate_id`);