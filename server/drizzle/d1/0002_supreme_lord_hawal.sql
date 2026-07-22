PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_room` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`lastActiveAt` integer NOT NULL
);--> statement-breakpoint
INSERT INTO `__new_room`("id", "name", "type", "userId", "createdAt", "lastActiveAt") SELECT "id", "name", CASE WHEN "type" = 'private' THEN 'unlisted' ELSE "type" END, "userId", "createdAt", "createdAt" FROM `room`;--> statement-breakpoint
DROP TABLE `room`;--> statement-breakpoint
ALTER TABLE `__new_room` RENAME TO `room`;--> statement-breakpoint
CREATE INDEX `room_public_activity_idx` ON `room` (`type`,`lastActiveAt`,`id`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;
