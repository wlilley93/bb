ALTER TABLE `projects` ADD `parent_project_id` text REFERENCES `projects`(`id`);--> statement-breakpoint
CREATE INDEX `projects_parent_idx` ON `projects` (`parent_project_id`);--> statement-breakpoint
CREATE TABLE `seat_primaries` (
	`project_id` text NOT NULL,
	`person_key` text NOT NULL,
	`thread_id` text,
	`previous_thread_id` text,
	PRIMARY KEY (`project_id`, `person_key`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
