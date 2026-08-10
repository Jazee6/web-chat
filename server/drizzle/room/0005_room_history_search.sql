CREATE TABLE `search_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`readiness` text DEFAULT 'preparing' NOT NULL,
	`boundaryCreatedAt` integer,
	`boundaryId` text,
	`cursorCreatedAt` integer,
	`cursorId` text,
	`batchSize` integer DEFAULT 500 NOT NULL,
	`failureCount` integer DEFAULT 0 NOT NULL,
	`retryAt` integer
);
--> statement-breakpoint
CREATE VIRTUAL TABLE `message_search_fts` USING fts5(
	`content`,
	content='',
	tokenize='trigram case_sensitive 1'
);
--> statement-breakpoint
INSERT INTO `search_state` (`id`, `readiness`, `batchSize`, `failureCount`)
SELECT 1,
	CASE WHEN EXISTS (SELECT 1 FROM `message`) THEN 'preparing' ELSE 'ready' END,
	500,
	0;
