CREATE TABLE `image_asset` (
	`key` text PRIMARY KEY NOT NULL,
	`createdAt` integer NOT NULL,
	`unreferencedAt` integer,
	`reclaimingAt` integer
);
--> statement-breakpoint
CREATE INDEX `image_asset_reclamation_idx` ON `image_asset` (`unreferencedAt`);--> statement-breakpoint
CREATE TABLE `image_retention` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`roomId` text NOT NULL,
	`userId` text NOT NULL,
	`submissionId` text,
	`messageId` text,
	`position` integer NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`key`) REFERENCES `image_asset`(`key`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`roomId`) REFERENCES `room`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `image_retention_key_idx` ON `image_retention` (`key`);--> statement-breakpoint
CREATE INDEX `image_retention_room_idx` ON `image_retention` (`roomId`);--> statement-breakpoint
CREATE TABLE `maintenance_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`imageBackfillRoomCursor` text,
	`imageBackfillR2Cursor` text,
	`imageBackfillRoomsComplete` integer DEFAULT false NOT NULL,
	`imageBackfillR2Complete` integer DEFAULT false NOT NULL,
	`imageBackfillCompletedAt` integer,
	`imageReclamationReadyAt` integer
);
--> statement-breakpoint
ALTER TABLE `room` ADD `deletionRequestedAt` integer;--> statement-breakpoint
CREATE INDEX `room_expiration_idx` ON `room` (`deletionRequestedAt`,`lastActiveAt`,`id`);