ALTER TABLE `app_theme` ADD `typography_profile` text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE `app_theme` ADD `font_scale_percent` integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE `threads` ADD `native_resume` text;--> statement-breakpoint
ALTER TABLE `threads` ADD `native_tail_fingerprint` text;