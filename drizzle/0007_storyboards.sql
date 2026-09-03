CREATE TABLE `storyboards` (
	`id` text PRIMARY KEY NOT NULL,
	`candidate_id` text NOT NULL,
	`provider` text NOT NULL,
	`treatment_id` text NOT NULL,
	`plan_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "storyboards_provider_valid" CHECK("storyboards"."provider" IN ('MOCK'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `storyboards_candidate_unique` ON `storyboards` (`candidate_id`);