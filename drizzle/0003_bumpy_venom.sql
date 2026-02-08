CREATE TABLE "courts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"auth_token" text NOT NULL,
	"active_match_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "courts_auth_token_unique" UNIQUE("auth_token")
);
--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "court_id" integer;--> statement-breakpoint
ALTER TABLE "courts" ADD CONSTRAINT "courts_active_match_id_matches_id_fk" FOREIGN KEY ("active_match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_court_id_courts_id_fk" FOREIGN KEY ("court_id") REFERENCES "public"."courts"("id") ON DELETE no action ON UPDATE no action;