CREATE TABLE `message` (
	`id` text PRIMARY KEY NOT NULL,
	`content` text NOT NULL,
	`userId` text NOT NULL,
	`type` text DEFAULT 'text' NOT NULL,
	`createdAt` integer NOT NULL
);
