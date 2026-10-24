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
  `
]
