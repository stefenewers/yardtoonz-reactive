CREATE TABLE `worker_heartbeats` (
	`worker_id` text PRIMARY KEY NOT NULL,
	`observed_at` integer NOT NULL
);
