CREATE TABLE `api_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`credits_used` integer DEFAULT 0,
	`ip_address` text,
	`user_agent` text,
	`response_time` integer,
	`success` integer DEFAULT true,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `cover_letters` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`extracted_job_id` text,
	`resume_id` text NOT NULL,
	`job_title` text,
	`company` text,
	`content` text NOT NULL,
	`credits_used` integer NOT NULL,
	`preferences` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`extracted_job_id`) REFERENCES `extracted_jobs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`resume_id`) REFERENCES `resumes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `credit_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`amount` integer NOT NULL,
	`balance` integer NOT NULL,
	`source` text NOT NULL,
	`source_id` text,
	`description` text,
	`metadata` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `extracted_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`url` text NOT NULL,
	`title` text,
	`company` text,
	`location` text,
	`salary` text,
	`job_type` text,
	`experience` text,
	`requirements` text,
	`description` text,
	`benefits` text,
	`skills` text,
	`industry` text,
	`remote` text,
	`page_type` text,
	`confidence` real,
	`extracted_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`stripe_payment_intent_id` text,
	`stripe_session_id` text,
	`stripe_invoice_id` text,
	`amount` integer NOT NULL,
	`currency` text DEFAULT 'usd',
	`status` text NOT NULL,
	`type` text NOT NULL,
	`credits_granted` integer DEFAULT 0,
	`description` text,
	`metadata` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `resumes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`filename` text NOT NULL,
	`file_key` text NOT NULL,
	`file_size` integer NOT NULL,
	`mime_type` text NOT NULL,
	`extracted_text` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`stripe_subscription_id` text NOT NULL,
	`stripe_price_id` text NOT NULL,
	`status` text NOT NULL,
	`current_period_start` text NOT NULL,
	`current_period_end` text NOT NULL,
	`cancel_at_period_end` integer DEFAULT false,
	`canceled_at` text,
	`trial_start` text,
	`trial_end` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`password_hash` text NOT NULL,
	`credits` integer DEFAULT 3,
	`plan` text DEFAULT 'free',
	`stripe_customer_id` text,
	`stripe_subscription_id` text,
	`subscription_status` text,
	`subscription_current_period_start` text,
	`subscription_current_period_end` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_stripe_payment_intent_id_unique` ON `payments` (`stripe_payment_intent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payments_stripe_session_id_unique` ON `payments` (`stripe_session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `subscriptions_stripe_subscription_id_unique` ON `subscriptions` (`stripe_subscription_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);