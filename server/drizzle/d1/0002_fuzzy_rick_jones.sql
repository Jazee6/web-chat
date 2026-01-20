CREATE TABLE `favorite_room` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`roomId` text NOT NULL,
	`createdAt` integer NOT NULL
);
