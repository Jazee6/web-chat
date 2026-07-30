ALTER TABLE `message` ADD `submissionId` text;--> statement-breakpoint
CREATE UNIQUE INDEX `message_user_submission_unique` ON `message` (`userId`,`submissionId`);