CREATE TYPE "public"."match_status" AS ENUM('scheduled', 'warmup', 'live', 'finished', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."point_method" AS ENUM('winner', 'unforced_error', 'forced_error', 'smash', 'volley', 'service_ace', 'double_fault', 'penalty');--> statement-breakpoint
CREATE TABLE "commentary" (
	"id" serial PRIMARY KEY NOT NULL,
	"match_id" integer NOT NULL,
	"set_number" integer,
	"game_number" integer,
	"message" text NOT NULL,
	"tags" text[],
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_sets" (
	"id" serial PRIMARY KEY NOT NULL,
	"match_id" integer NOT NULL,
	"set_number" integer NOT NULL,
	"pair_a_games" integer NOT NULL,
	"pair_b_games" integer NOT NULL,
	"tie_break_pair_a_points" integer,
	"tie_break_pair_b_points" integer
);
--> statement-breakpoint
CREATE TABLE "match_stats" (
	"id" serial PRIMARY KEY NOT NULL,
	"match_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"points_won" integer DEFAULT 0,
	"winners" integer DEFAULT 0,
	"unforced_errors" integer DEFAULT 0,
	"smash_winners" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" serial PRIMARY KEY NOT NULL,
	"pair_a_name" text,
	"pair_b_name" text,
	"pair_a_player1_id" integer NOT NULL,
	"pair_a_player2_id" integer NOT NULL,
	"pair_b_player1_id" integer NOT NULL,
	"pair_b_player2_id" integer NOT NULL,
	"status" "match_status" DEFAULT 'scheduled' NOT NULL,
	"current_set_idx" integer DEFAULT 1,
	"pair_a_games" integer DEFAULT 0,
	"pair_b_games" integer DEFAULT 0,
	"pair_a_score" text DEFAULT '0',
	"pair_b_score" text DEFAULT '0',
	"is_tie_break" boolean DEFAULT false,
	"has_gold_point" boolean DEFAULT false,
	"serving_player_id" integer,
	"winner_side" text,
	"start_time" timestamp,
	"end_time" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"image_url" text,
	"country" text,
	"ranking" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "point_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"match_id" integer NOT NULL,
	"set_number" integer NOT NULL,
	"game_number" integer NOT NULL,
	"point_number" integer NOT NULL,
	"winner_side" text NOT NULL,
	"winner_player_id" integer,
	"method" "point_method" DEFAULT 'winner',
	"score_after_pair_a" text NOT NULL,
	"score_after_pair_b" text NOT NULL,
	"is_game_point" boolean DEFAULT false,
	"is_set_point" boolean DEFAULT false,
	"is_match_point" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commentary" ADD CONSTRAINT "commentary_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_sets" ADD CONSTRAINT "match_sets_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_stats" ADD CONSTRAINT "match_stats_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_stats" ADD CONSTRAINT "match_stats_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_pair_a_player1_id_players_id_fk" FOREIGN KEY ("pair_a_player1_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_pair_a_player2_id_players_id_fk" FOREIGN KEY ("pair_a_player2_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_pair_b_player1_id_players_id_fk" FOREIGN KEY ("pair_b_player1_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_pair_b_player2_id_players_id_fk" FOREIGN KEY ("pair_b_player2_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_serving_player_id_players_id_fk" FOREIGN KEY ("serving_player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_history" ADD CONSTRAINT "point_history_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_history" ADD CONSTRAINT "point_history_winner_player_id_players_id_fk" FOREIGN KEY ("winner_player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;