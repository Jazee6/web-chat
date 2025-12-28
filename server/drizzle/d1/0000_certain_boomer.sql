CREATE TABLE `room` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL
);
