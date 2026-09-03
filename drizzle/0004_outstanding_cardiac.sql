CREATE TABLE `director_treatments` (
	`id` text PRIMARY KEY NOT NULL,
	`candidate_id` text NOT NULL,
	`provider` text NOT NULL,
	`treatment_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "director_treatments_provider_valid" CHECK("director_treatments"."provider" IN ('MOCK'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `director_treatments_candidate_unique` ON `director_treatments` (`candidate_id`);