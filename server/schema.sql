-- Vanity account database (Neon / Postgres 15+).
-- Safe to run more than once: `npm run migrate`, or paste into Neon's SQL Editor.

CREATE TABLE IF NOT EXISTS users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username       text NOT NULL CHECK (username ~ '^[A-Za-z0-9_]{3,20}$'),
  password_hash  text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
-- Usernames are unique regardless of case.
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower ON users (lower(username));

-- One row per friend request; status becomes 'accepted' when the other side accepts.
CREATE TABLE IF NOT EXISTS friendships (
  requester_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  addressee_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status        text NOT NULL CHECK (status IN ('pending', 'accepted')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (requester_id, addressee_id),
  CHECK (requester_id <> addressee_id)
);
CREATE INDEX IF NOT EXISTS friendships_addressee ON friendships (addressee_id);

-- What each user is doing right now. The app sends a heartbeat about once a minute.
CREATE TABLE IF NOT EXISTS presence (
  user_id     uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  game_key    text,
  game_name   text,
  started_at  timestamptz,
  -- true after the user signs out or closes Vanity; updated_at is then "last seen"
  signed_off  boolean NOT NULL DEFAULT false,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Playtime per game, synced from each user's Vanity library.
CREATE TABLE IF NOT EXISTS game_stats (
  user_id           uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  game_key          text NOT NULL,
  game_name         text NOT NULL,
  playtime_seconds  integer NOT NULL DEFAULT 0 CHECK (playtime_seconds >= 0),
  last_played_at    timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, game_key)
);
CREATE INDEX IF NOT EXISTS game_stats_game ON game_stats (game_key);
