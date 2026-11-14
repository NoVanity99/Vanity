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
`

/** The schema as separate statements, without comments. */
export function schemaStatements(): string[] {
  return SCHEMA.split(/;\s*$/m)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean)
}
