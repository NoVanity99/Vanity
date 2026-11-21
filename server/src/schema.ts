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
-- Who can see this player's stats on their profile: everyone signed in (the default), friends, or only them.
ALTER TABLE vanity.profiles ADD COLUMN IF NOT EXISTS stats_visibility text NOT NULL DEFAULT 'everyone' CHECK (stats_visibility IN ('everyone', 'friends', 'private'));

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

-- Messages between friends. Kept for good: nothing here ever deletes a message
-- (only deleting an account removes that account's side of its conversations).
CREATE TABLE IF NOT EXISTS vanity.messages (
  id            bigserial PRIMARY KEY,
  sender_id     text NOT NULL REFERENCES vanity.profiles (id) ON DELETE CASCADE,
  recipient_id  text NOT NULL REFERENCES vanity.profiles (id) ON DELETE CASCADE,
  body          text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at    timestamptz NOT NULL DEFAULT now(),
  read_at       timestamptz,
  CHECK (sender_id <> recipient_id)
);
-- A conversation is the two people, whoever wrote: least/greatest puts both directions under one key.
CREATE INDEX IF NOT EXISTS messages_conversation ON vanity.messages (least(sender_id, recipient_id), greatest(sender_id, recipient_id), id DESC);
CREATE INDEX IF NOT EXISTS messages_unread ON vanity.messages (recipient_id, sender_id) WHERE read_at IS NULL;

-- Voice rooms. No codes: a room belongs to whoever started it (host_id), and friends of the
-- people in it can see and join it, unless it is private (hidden) or locked (seen, closed);
-- invited people can always join. Rooms close when the last person leaves.
CREATE TABLE IF NOT EXISTS vanity.voice_rooms (
  id          text PRIMARY KEY,
  host_id     text NOT NULL REFERENCES vanity.profiles (id) ON DELETE CASCADE,
  private     boolean NOT NULL DEFAULT false,
  locked      boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- Who is in which room: one room per account. last_seen is when their app last checked in.
CREATE TABLE IF NOT EXISTS vanity.voice_members (
  user_id    text PRIMARY KEY REFERENCES vanity.profiles (id) ON DELETE CASCADE,
  room_id    text NOT NULL REFERENCES vanity.voice_rooms (id) ON DELETE CASCADE,
  muted      boolean NOT NULL DEFAULT false,
  deafened   boolean NOT NULL DEFAULT false,
  -- Sharing their screen (the picture itself goes directly between apps, like the audio).
  sharing    boolean NOT NULL DEFAULT false,
  joined_at  timestamptz NOT NULL DEFAULT now(),
  last_seen  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE vanity.voice_members ADD COLUMN IF NOT EXISTS sharing boolean NOT NULL DEFAULT false;
-- Camera on, and which stream ids carry the screen and the camera (JSON).
ALTER TABLE vanity.voice_members ADD COLUMN IF NOT EXISTS camera boolean NOT NULL DEFAULT false;
ALTER TABLE vanity.voice_members ADD COLUMN IF NOT EXISTS streams text NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS voice_members_room ON vanity.voice_members (room_id);
CREATE TABLE IF NOT EXISTS vanity.voice_invites (
  room_id     text NOT NULL REFERENCES vanity.voice_rooms (id) ON DELETE CASCADE,
  user_id     text NOT NULL REFERENCES vanity.profiles (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);
-- WebRTC connection details on their way from one player to another (gone once fetched, or after 2 minutes).
CREATE TABLE IF NOT EXISTS vanity.voice_signals (
  id          bigserial PRIMARY KEY,
  room_id     text NOT NULL REFERENCES vanity.voice_rooms (id) ON DELETE CASCADE,
  from_id     text NOT NULL,
  to_id       text NOT NULL,
  data        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS voice_signals_to ON vanity.voice_signals (to_id, id);

-- Group chats: a name, who made it (or took over), who is in it, and the messages (kept for good).
CREATE TABLE IF NOT EXISTS vanity.chat_groups (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  owner_id    text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS vanity.chat_group_members (
  group_id   text NOT NULL REFERENCES vanity.chat_groups (id) ON DELETE CASCADE,
  user_id    text NOT NULL REFERENCES vanity.profiles (id) ON DELETE CASCADE,
  joined_at  timestamptz NOT NULL DEFAULT now(),
  -- The newest message they've read.
  last_read  bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS chat_group_members_user ON vanity.chat_group_members (user_id);
CREATE TABLE IF NOT EXISTS vanity.group_messages (
  id          bigserial PRIMARY KEY,
  group_id    text NOT NULL REFERENCES vanity.chat_groups (id) ON DELETE CASCADE,
  sender_id   text NOT NULL,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS group_messages_group ON vanity.group_messages (group_id, id);
-- GIFs sent from people's devices (base64), up to 3 MB each.
CREATE TABLE IF NOT EXISTS vanity.chat_media (
  id          text PRIMARY KEY,
  owner_id    text NOT NULL REFERENCES vanity.profiles (id) ON DELETE CASCADE,
  mime        text NOT NULL,
  data        text NOT NULL,
  size        integer NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

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

-- Official badges, by permanent account id (never by username, which can change).
CREATE TABLE IF NOT EXISTS vanity.roles (
  user_id   text PRIMARY KEY REFERENCES vanity.profiles (id) ON DELETE CASCADE,
  verified  boolean NOT NULL DEFAULT false,
  admin     boolean NOT NULL DEFAULT false
);
-- Names from roles.ts that have been turned into a badge on an account once. Never applied twice,
-- so a name that is later given up can't hand its badge to whoever takes it next.
CREATE TABLE IF NOT EXISTS vanity.role_seeds (
  name        text PRIMARY KEY,
  user_id     text NOT NULL,
  applied_at  timestamptz NOT NULL DEFAULT now()
);
-- Bans and time-outs, set by admins.
CREATE TABLE IF NOT EXISTS vanity.moderation (
  user_id        text PRIMARY KEY REFERENCES vanity.profiles (id) ON DELETE CASCADE,
  banned         boolean NOT NULL DEFAULT false,
  reason         text NOT NULL DEFAULT '',
  timeout_until  timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
-- Everything an admin did, for the record.
CREATE TABLE IF NOT EXISTS vanity.admin_log (
  id          bigserial PRIMARY KEY,
  admin_id    text NOT NULL,
  target_id   text,
  action      text NOT NULL,
  detail      text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- Every username an account has had (old_username is null for the first one).
CREATE TABLE IF NOT EXISTS vanity.username_history (
  id            bigserial PRIMARY KEY,
  user_id       text NOT NULL,
  old_username  text,
  new_username  text NOT NULL,
  by_admin      boolean NOT NULL DEFAULT false,
  changed_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS username_history_user ON vanity.username_history (user_id, changed_at DESC);

-- Vanity Coins. The ledger is the record: every purchase, spend, refund, chargeback and admin
-- adjustment is one row that is never edited. (kind, ref) is unique, so the same Stripe event or
-- the same purchase can never be written twice.
CREATE TABLE IF NOT EXISTS vanity.coin_ledger (
  id          bigserial PRIMARY KEY,
  user_id     text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('purchase', 'spend', 'refund', 'chargeback', 'reversal', 'admin')),
  amount      integer NOT NULL,
  ref         text NOT NULL,
  note        text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, ref)
);
CREATE INDEX IF NOT EXISTS coin_ledger_user ON vanity.coin_ledger (user_id, id DESC);
-- The running total of each account's ledger, changed only in the same statement that adds a
-- ledger row (so two purchases at the same moment can't both spend the same coins).
CREATE TABLE IF NOT EXISTS vanity.coin_wallets (
  user_id  text PRIMARY KEY,
  balance  integer NOT NULL DEFAULT 0
);
-- One row per Stripe Checkout started: what was offered, to whom, and what became of it.
CREATE TABLE IF NOT EXISTS vanity.coin_orders (
  session_id      text PRIMARY KEY,
  user_id         text NOT NULL,
  bundle_id       text NOT NULL,
  coins           integer NOT NULL,
  amount_cents    integer NOT NULL,
  currency        text NOT NULL,
  status          text NOT NULL DEFAULT 'pending',
  payment_intent  text,
  refunded_coins  integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  paid_at         timestamptz
);
CREATE INDEX IF NOT EXISTS coin_orders_user ON vanity.coin_orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS coin_orders_intent ON vanity.coin_orders (payment_intent);
-- Stripe events already handled (a repeated delivery is answered without doing anything).
CREATE TABLE IF NOT EXISTS vanity.stripe_events (
  id           text PRIMARY KEY,
  type         text NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now()
);
-- What an account bought with coins ("frame:diamond", later things for games).
CREATE TABLE IF NOT EXISTS vanity.shop_owned (
  user_id    text NOT NULL,
  item_id    text NOT NULL,
  bought_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_id)
);

-- Comments on a game's page, one thread per game (game_key: the game's normalised title).
CREATE TABLE IF NOT EXISTS vanity.game_comments (
  id          bigserial PRIMARY KEY,
  game_key    text NOT NULL,
  user_id     text NOT NULL REFERENCES vanity.profiles (id) ON DELETE CASCADE,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  edited_at   timestamptz
);
CREATE INDEX IF NOT EXISTS game_comments_game ON vanity.game_comments (game_key, id DESC);
CREATE TABLE IF NOT EXISTS vanity.comment_reports (
  id           bigserial PRIMARY KEY,
  comment_id   bigint NOT NULL REFERENCES vanity.game_comments (id) ON DELETE CASCADE,
  reporter_id  text NOT NULL,
  reason       text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  UNIQUE (comment_id, reporter_id)
);

-- Calls: a voice room started from a chat. chat is "dm:<id>:<id>" (the two ids in order) or "group:<id>".
ALTER TABLE vanity.voice_rooms ADD COLUMN IF NOT EXISTS chat text;
-- Whose shared screen each person is watching.
ALTER TABLE vanity.voice_members ADD COLUMN IF NOT EXISTS watching text;
-- A call ringing for someone, until they answer, decline, or it times out.
CREATE TABLE IF NOT EXISTS vanity.voice_rings (
  room_id     text NOT NULL REFERENCES vanity.voice_rooms (id) ON DELETE CASCADE,
  user_id     text NOT NULL REFERENCES vanity.profiles (id) ON DELETE CASCADE,
  from_id     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);
CREATE INDEX IF NOT EXISTS voice_rings_user ON vanity.voice_rings (user_id);
`

/** The schema as separate statements, without comments. */
export function schemaStatements(): string[] {
  return SCHEMA.split(/;\s*$/m)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean)
}
