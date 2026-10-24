/**
 * Schema migrations, applied in order. PRAGMA user_version records how many
 * have run. Never edit a released migration; append a new one instead.
 */
export const migrations: string[] = [
  // 1: games library
  `
  CREATE TABLE games (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    source            TEXT    NOT NULL,
    external_id       TEXT    NOT NULL,
    name              TEXT    NOT NULL,
    -- 1 once the user renames the game, so rescans don't overwrite it
    name_locked       INTEGER NOT NULL DEFAULT 0,
    install_path      TEXT,
    executable_path   TEXT,
    favorite          INTEGER NOT NULL DEFAULT 0,
    hidden            INTEGER NOT NULL DEFAULT 0,
    missing           INTEGER NOT NULL DEFAULT 0,
    added_at          INTEGER NOT NULL,
    last_seen_at      INTEGER NOT NULL,
    last_played_at    INTEGER,
    playtime_seconds  INTEGER NOT NULL DEFAULT 0,
    description       TEXT,
    genres            TEXT    NOT NULL DEFAULT '[]',
    release_date      TEXT,
    developer         TEXT,
    cover_path        TEXT,
    hero_path         TEXT,
    logo_path         TEXT,
    icon_path         TEXT,
    UNIQUE (source, external_id)
  );
  CREATE INDEX games_name ON games (name COLLATE NOCASE);
  CREATE INDEX games_last_played ON games (last_played_at);
  `,
  // 2: play sessions
  `
  CREATE TABLE play_sessions (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id           INTEGER NOT NULL REFERENCES games (id) ON DELETE CASCADE,
    started_at        INTEGER NOT NULL,
    ended_at          INTEGER,
    duration_seconds  INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX play_sessions_game ON play_sessions (game_id, started_at);
  -- 1 once the user picks the exe, so rescans don't overwrite it
  ALTER TABLE games ADD COLUMN executable_locked INTEGER NOT NULL DEFAULT 0;
  `,
  // 3: metadata matching and artwork
  `
  ALTER TABLE games ADD COLUMN metadata_status TEXT NOT NULL DEFAULT 'pending';
  ALTER TABLE games ADD COLUMN metadata_error TEXT;
  ALTER TABLE games ADD COLUMN metadata_updated_at INTEGER;
  ALTER TABLE games ADD COLUMN steamgriddb_id INTEGER;
  ALTER TABLE games ADD COLUMN igdb_id INTEGER;
  ALTER TABLE games ADD COLUMN match_locked INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE games ADD COLUMN details_locked INTEGER NOT NULL DEFAULT 0;
  -- comma-separated artwork kinds the user picked by hand
  ALTER TABLE games ADD COLUMN artwork_locked TEXT NOT NULL DEFAULT '';
  CREATE INDEX games_metadata_status ON games (metadata_status);
  `,
  // 4: small key-value cache (Trending list)
  `
  CREATE TABLE kv (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  INTEGER NOT NULL
  );
  `
]
