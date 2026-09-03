CREATE TABLE `push_destination` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`deviceLabel` text NOT NULL,
	`createdAt` integer NOT NULL,
	`lastUsedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_destination_endpoint_unique` ON `push_destination` (`endpoint`);--> statement-breakpoint
CREATE INDEX `push_destination_user_idx` ON `push_destination` (`userId`);--> statement-breakpoint
CREATE INDEX `push_destination_user_last_used_idx` ON `push_destination` (`userId`,`lastUsedAt`);--> statement-breakpoint
CREATE TABLE `room_notification_subscription` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`roomId` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`roomId`) REFERENCES `room`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `room_notification_subscription_user_room_unique` ON `room_notification_subscription` (`userId`,`roomId`);--> statement-breakpoint
CREATE INDEX `room_notification_subscription_room_idx` ON `room_notification_subscription` (`roomId`);--> statement-breakpoint
CREATE INDEX `room_notification_subscription_user_idx` ON `room_notification_subscription` (`userId`);