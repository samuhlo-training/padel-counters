CREATE TYPE "public"."padel_stroke" AS ENUM('forehand', 'backhand', 'smash', 'bandeja', 'vibora', 'volley_forehand', 'volley_backhand', 'lob', 'drop_shot', 'wall_boast');--> statement-breakpoint
ALTER TABLE "point_history" ALTER COLUMN "method" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "point_history" ALTER COLUMN "method" SET DEFAULT 'winner'::text;--> statement-breakpoint
DROP TYPE "public"."point_method";--> statement-breakpoint
CREATE TYPE "public"."point_method" AS ENUM('winner', 'unforced_error', 'forced_error', 'service_ace', 'double_fault');--> statement-breakpoint
ALTER TABLE "point_history" ALTER COLUMN "method" SET DEFAULT 'winner'::"public"."point_method";--> statement-breakpoint
ALTER TABLE "point_history" ALTER COLUMN "method" SET DATA TYPE "public"."point_method" USING "method"::"public"."point_method";--> statement-breakpoint
ALTER TABLE "matches" ALTER COLUMN "pair_a_name" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "matches" ALTER COLUMN "pair_a_name" SET DEFAULT 'Pair A';--> statement-breakpoint
ALTER TABLE "matches" ALTER COLUMN "pair_b_name" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "matches" ALTER COLUMN "pair_b_name" SET DEFAULT 'Pair B';--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "match_type" varchar(50) DEFAULT 'friendly' NOT NULL;--> statement-breakpoint
ALTER TABLE "point_history" ADD COLUMN "stroke" "padel_stroke";--> statement-breakpoint
ALTER TABLE "point_history" ADD COLUMN "is_net_point" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "match_sets" ADD CONSTRAINT "match_sets_match_id_set_number_unique" UNIQUE("match_id","set_number");--> statement-breakpoint
ALTER TABLE "match_stats" ADD CONSTRAINT "match_stats_match_player_unique" UNIQUE("match_id","player_id");