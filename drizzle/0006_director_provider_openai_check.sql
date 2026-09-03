PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_director_treatments` (
	`id` text PRIMARY KEY NOT NULL,
	`candidate_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_request_id` text,
	`model` text,
	`treatment_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "director_treatments_provider_valid" CHECK("__new_director_treatments"."provider" IN ('MOCK', 'OPENAI'))
);
--> statement-breakpoint
INSERT INTO `__new_director_treatments`("id", "candidate_id", "provider", "provider_request_id", "model", "treatment_json", "created_at", "updated_at") SELECT "id", "candidate_id", "provider", "provider_request_id", "model", "treatment_json", "created_at", "updated_at" FROM `director_treatments`;--> statement-breakpoint
DROP TABLE `director_treatments`;--> statement-breakpoint
ALTER TABLE `__new_director_treatments` RENAME TO `director_treatments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `director_treatments_candidate_unique` ON `director_treatments` (`candidate_id`);