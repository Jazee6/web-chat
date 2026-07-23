CREATE TABLE `room_setting` (
	`id` integer PRIMARY KEY NOT NULL,
	`aiEnabled` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_message` (
	`id` text PRIMARY KEY NOT NULL,
	`content` text NOT NULL,
	`authorType` text DEFAULT 'user' NOT NULL,
	`userId` text,
	`type` text DEFAULT 'text' NOT NULL,
	`replyTo` text,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_message`("id", "content", "authorType", "userId", "type", "replyTo", "createdAt") SELECT "id", "content", 'user', "userId", "type", "replyTo", "createdAt" FROM `message`;--> statement-breakpoint
DROP TABLE `message`;--> statement-breakpoint
ALTER TABLE `__new_message` RENAME TO `message`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
