CREATE TABLE `sticker` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`key` text NOT NULL,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sticker_userId_key_unique` ON `sticker` (`userId`,`key`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_favorite_room` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`roomId` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`roomId`) REFERENCES `room`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_favorite_room`("id", "userId", "roomId", "createdAt") SELECT "id", "userId", "roomId", "createdAt" FROM `favorite_room`;--> statement-breakpoint
DROP TABLE `favorite_room`;--> statement-breakpoint
ALTER TABLE `__new_favorite_room` RENAME TO `favorite_room`;--> statement-breakpoint
PRAGMA foreign_keys=ON;