CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`production_id` text NOT NULL,
	`production_stage_id` text NOT NULL,
	`kind` text NOT NULL,
	`storage_key` text NOT NULL,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`sha256` text NOT NULL,
	`parent_artifact_ids_json` text NOT NULL,
	`provider` text NOT NULL,
	`provider_request_id` text,
	`metadata_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`production_id`) REFERENCES `productions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`production_stage_id`,`production_id`) REFERENCES `production_stages`(`id`,`production_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "artifacts_byte_size_nonnegative" CHECK("artifacts"."byte_size" >= 0),
	CONSTRAINT "artifacts_kind_valid" CHECK("artifacts"."kind" IN ('SOURCE_VIDEO', 'EXTRACTED_CLIP', 'EXTRACTED_AUDIO', 'KEYFRAME', 'STYLED_FRAME', 'SILENT_ANIMATION', 'FINAL_VIDEO')),
	CONSTRAINT "artifacts_provider_valid" CHECK("artifacts"."provider" IN ('USER_UPLOAD', 'FFMPEG', 'MOCK', 'OPENAI', 'RUNWAY'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `artifacts_storage_key_unique` ON `artifacts` (`storage_key`);--> statement-breakpoint
CREATE INDEX `artifacts_production_id_idx` ON `artifacts` (`production_id`);--> statement-breakpoint
CREATE INDEX `artifacts_production_stage_id_idx` ON `artifacts` (`production_stage_id`);--> statement-breakpoint
CREATE TABLE `production_stages` (
	`id` text PRIMARY KEY NOT NULL,
	`production_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'WAITING' NOT NULL,
	`attempt` integer DEFAULT 1 NOT NULL,
	`input_fingerprint` text,
	`started_at` integer,
	`completed_at` integer,
	`error_code` text,
	`safe_error_message` text,
	`worker_lease_owner` text,
	`worker_lease_expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`production_id`) REFERENCES `productions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "production_stages_attempt_positive" CHECK("production_stages"."attempt" > 0),
	CONSTRAINT "production_stages_name_valid" CHECK("production_stages"."name" IN ('INGEST_SOURCE', 'EXTRACT_MEDIA', 'SELECT_KEYFRAME', 'STYLE_IMAGE', 'ANIMATE_IMAGE', 'MUX_AND_NORMALIZE', 'VALIDATE_OUTPUT')),
	CONSTRAINT "production_stages_status_valid" CHECK("production_stages"."status" IN ('WAITING', 'RUNNING', 'COMPLETE', 'FAILED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `production_stages_production_name_attempt_unique` ON `production_stages` (`production_id`,`name`,`attempt`);--> statement-breakpoint
CREATE UNIQUE INDEX `production_stages_id_production_unique` ON `production_stages` (`id`,`production_id`);--> statement-breakpoint
CREATE INDEX `production_stages_lease_idx` ON `production_stages` (`status`,`worker_lease_expires_at`);--> statement-breakpoint
CREATE TABLE `productions` (
	`id` text PRIMARY KEY NOT NULL,
	`candidate_id` text NOT NULL,
	`rights_confirmation_id` text,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`image_provider` text NOT NULL,
	`animation_provider` text NOT NULL,
	`segment_start_ms` integer NOT NULL,
	`segment_end_ms` integer NOT NULL,
	`segment_duration_ms` integer NOT NULL,
	`creative_direction` text,
	`active_stage` text,
	`attempt` integer DEFAULT 1 NOT NULL,
	`error_code` text,
	`safe_error_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`rights_confirmation_id`,`candidate_id`) REFERENCES `rights_confirmations`(`id`,`candidate_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "productions_attempt_positive" CHECK("productions"."attempt" > 0),
	CONSTRAINT "productions_rights_gate" CHECK("productions"."status" = 'DRAFT' OR "productions"."rights_confirmation_id" IS NOT NULL),
	CONSTRAINT "productions_status_valid" CHECK("productions"."status" IN ('DRAFT', 'RIGHTS_CONFIRMED', 'QUEUED', 'EXTRACTING', 'STYLING', 'ANIMATING', 'MUXING', 'VALIDATING', 'COMPLETE', 'FAILED')),
	CONSTRAINT "productions_providers_valid" CHECK("productions"."image_provider" IN ('MOCK', 'OPENAI') AND "productions"."animation_provider" IN ('MOCK', 'RUNWAY')),
	CONSTRAINT "productions_active_stage_valid" CHECK("productions"."active_stage" IS NULL OR "productions"."active_stage" IN ('INGEST_SOURCE', 'EXTRACT_MEDIA', 'SELECT_KEYFRAME', 'STYLE_IMAGE', 'ANIMATE_IMAGE', 'MUX_AND_NORMALIZE', 'VALIDATE_OUTPUT')),
	CONSTRAINT "productions_segment_bounds" CHECK("productions"."segment_start_ms" >= 0 AND "productions"."segment_end_ms" > "productions"."segment_start_ms" AND "productions"."segment_duration_ms" = "productions"."segment_end_ms" - "productions"."segment_start_ms" AND "productions"."segment_duration_ms" BETWEEN 5000 AND 8000)
);
--> statement-breakpoint
CREATE INDEX `productions_candidate_id_idx` ON `productions` (`candidate_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_editorial_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`candidate_id` text NOT NULL,
	`production_id` text,
	`subject` text DEFAULT 'CANDIDATE' NOT NULL,
	`decision` text NOT NULL,
	`reason` text,
	`decided_at` text NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`production_id`) REFERENCES `productions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "editorial_decisions_subject_target" CHECK(("__new_editorial_decisions"."subject" = 'CANDIDATE' AND "__new_editorial_decisions"."production_id" IS NULL) OR ("__new_editorial_decisions"."subject" = 'OUTPUT' AND "__new_editorial_decisions"."production_id" IS NOT NULL)),
	CONSTRAINT "editorial_decisions_value_valid" CHECK("__new_editorial_decisions"."decision" IN ('APPROVED', 'REJECTED'))
);
--> statement-breakpoint
INSERT INTO `__new_editorial_decisions`("id", "candidate_id", "production_id", "subject", "decision", "reason", "decided_at") SELECT "id", "candidate_id", NULL, 'CANDIDATE', "decision", "reason", "decided_at" FROM `editorial_decisions`;--> statement-breakpoint
DROP TABLE `editorial_decisions`;--> statement-breakpoint
ALTER TABLE `__new_editorial_decisions` RENAME TO `editorial_decisions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `editorial_decisions_candidate_id_idx` ON `editorial_decisions` (`candidate_id`);--> statement-breakpoint
CREATE INDEX `editorial_decisions_production_id_idx` ON `editorial_decisions` (`production_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `candidate_comments_candidate_position_unique` ON `candidate_comments` (`candidate_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `rights_id_candidate_unique` ON `rights_confirmations` (`id`,`candidate_id`);