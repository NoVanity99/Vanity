/** The Vanity database, as SQL. Applied by the server when it starts (every statement is safe to repeat). */
export const SCHEMA = `
-- Vanity backend database (Neon / Postgres 15+).
-- Sign-in itself is handled by Neon Auth (its tables live in the neon_auth schema).
-- Everything Vanity stores is in its own "vanity" schema, keyed by the Neon Auth user id.
-- Safe to run more than once. The server runs it by itself when it starts.

CREATE SCHEMA IF NOT EXISTS vanity;

-- One row per account: the public username friends add you by.
CREATE TABLE IF NOT EXISTS vanity.profiles (
  id          text PRIMARY KEY,
  username    text NOT NULL CHECK (username ~ '^[A-Za-z0-9_]{3,20}$'),
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- Usernames are unique regardless of case.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_lower ON vanity.profiles (lower(username));
-- The profile picture (a small image the app shrinks before sending, kept as a data: address) and a short bio.
ALTER TABLE vanity.profiles ADD COLUMN IF NOT EXISTS avatar text;
ALTER TABLE vanity.profiles ADD COLUMN IF NOT EXISTS bio text NOT NULL DEFAULT '';
-- How the profile looks (banner, picture frame, name effect, emoji): ids from a fixed list, as JSON.
ALTER TABLE vanity.profiles ADD COLUMN IF NOT EXISTS style text NOT NULL DEFAULT '{}';

-- One row per friend request. The status becomes 'accepted' when the other side accepts.
CREATE TABLE IF NOT EXISTS vanity.friendships (
  requester_id  text NOT NULL REFERENCES vanity.profiles (id) ON DELETE CASCADE,
  addressee_id  text NOT NULL REFERENCES vanity.profiles (id) ON DELETE CASCADE,
  status        text NOT NULL CHECK (status IN ('pending', 'accepted')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (requester_id, addressee_id),
  CHECK (requester_id <> addressee_id)
);
CREATE INDEX IF NOT EXISTS friendships_addressee ON vanity.friendships (addressee_id);

-- What each user is doing right now. The app sends a heartbeat about once a minute.
-- signed_off is true after the user signs out or closes Vanity. updated_at is then "last seen".
CREATE TABLE IF NOT EXISTS vanity.presence (
  user_id     text PRIMARY KEY REFERENCES vanity.profiles (id) ON DELETE CASCADE,
  game_key    text,
  game_name   text,
  started_at  timestamptz,
  signed_off  boolean NOT NULL DEFAULT false,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Playtime per game, synced from each user's Vanity library.
CREATE TABLE IF NOT EXISTS vanity.game_stats (
  user_id           text NOT NULL REFERENCES vanity.profiles (id) ON DELETE CASCADE,
  game_key          text NOT NULL,
  game_name         text NOT NULL,
  playtime_seconds  integer NOT NULL DEFAULT 0 CHECK (playtime_seconds >= 0),
  last_played_at    timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, game_key)
);
CREATE INDEX IF NOT EXISTS game_stats_game ON vanity.game_stats (game_key);

-- Cloud-saved progress. Playtime and launch counts are kept per device and added up,
-- so two devices that were both used offline never overwrite each other.
CREATE TABLE IF NOT EXISTS vanity.device_games (
  user_id           text NOT NULL REFERENCES vanity.profiles (id) ON DELETE CASCADE,
  device_id         text NOT NULL,
  game_key          text NOT NULL,
  game_name         text NOT NULL,
  playtime_seconds  integer NOT NULL DEFAULT 0 CHECK (playtime_seconds >= 0),
  launches          integer NOT NULL DEFAULT 0 CHECK (launches >= 0),
  last_played_at    timestamptz,
  first_played_at   timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, device_id, game_key)
);

-- Your own choices per game. updated_at is when they last changed, in milliseconds, as the device saw it.
CREATE TABLE IF NOT EXISTS vanity.game_prefs (
  user_id      text NOT NULL REFERENCES vanity.profiles (id) ON DELETE CASCADE,
  game_key     text NOT NULL,
  favorite     boolean NOT NULL DEFAULT false,
  play_status  text,
  user_rating  integer CHECK (user_rating BETWEEN 1 AND 5),
  notes        text,
  updated_at   bigint NOT NULL,
  PRIMARY KEY (user_id, game_key)
);

-- One row per account: level, days played, badges, collections and the synced settings.
CREATE TABLE IF NOT EXISTS vanity.user_state (
  user_id                 text PRIMARY KEY REFERENCES vanity.profiles (id) ON DELETE CASCADE,
  xp                      integer NOT NULL DEFAULT 0,
  level                   integer NOT NULL DEFAULT 1,
  days                    jsonb NOT NULL DEFAULT '[]',
  badges                  jsonb NOT NULL DEFAULT '{}',
  collections             jsonb,
  collections_updated_at  bigint,
  settings                jsonb,
  settings_updated_at     bigint,
  device_name             text,
  updated_at              timestamptz NOT NULL DEFAULT now()
);
-- Accounts on other services that a Vanity account is linked to (Steam for now).
-- verified is true when the link was made by signing in through the service, not by typing an id.
CREATE TABLE IF NOT EXISTS vanity.linked_accounts (
  user_id       text NOT NULL REFERENCES vanity.profiles (id) ON DELETE CASCADE,
  provider      text NOT NULL,
  external_id   text NOT NULL,
  display_name  text NOT NULL,
  avatar_url    text,
  profile_url   text NOT NULL,
  verified      boolean NOT NULL DEFAULT false,
  linked_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, provider)
);

-- Answers from outside services (the Steam Web API), kept for a few minutes so the same question isn't asked twice.
CREATE TABLE IF NOT EXISTS vanity.api_cache (
  cache_key   text PRIMARY KEY,
  body        jsonb NOT NULL,
  expires_at  timestamptz NOT NULL
);

-- How many calls to outside services each account has caused per day (its daily budget).
CREATE TABLE IF NOT EXISTS vanity.api_usage (
  user_id  text NOT NULL REFERENCES vanity.profiles (id) ON DELETE CASCADE,
  day      date NOT NULL,
  calls    integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

-- Achievement counts per Steam game, so the total doesn't need every game asked every time.
CREATE TABLE IF NOT EXISTS vanity.steam_achievements (
  user_id     text NOT NULL REFERENCES vanity.profiles (id) ON DELETE CASCADE,
  steam_id    text NOT NULL,
  app_id      integer NOT NULL,
  unlocked    integer NOT NULL DEFAULT 0,
  total       integer NOT NULL DEFAULT 0,
  checked_at  timestamptz NOT NULL,
  PRIMARY KEY (user_id, steam_id, app_id)
);

-- "Sign in through Steam" in progress: which account started it. Each is used once and expires after 10 minutes.
CREATE TABLE IF NOT EXISTS vanity.openid_states (
  state       text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES vanity.profiles (id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL
);
`

/** The schema as separate statements, without comments. */
export function schemaStatements(): string[] {
  return SCHEMA.split(/;\s*$/m)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean)
}
