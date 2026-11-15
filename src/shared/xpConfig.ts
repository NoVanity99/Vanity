/**
 * Every number behind XP, levels and badges, in one place. Change a value here and the whole
 * launcher (Windows and Android, the level badge, the profile page) follows on the next build.
 *
 * XP is always worked out again from what you have actually done (playtime, launches, days played…),
 * so changing a value re-scores everyone fairly: nobody keeps XP earned under old numbers.
 */
export const XP_CONFIG = {
  // ---- playing ----
  /** XP for each full minute played. */
  perMinutePlayed: 1,
  /** XP the first time you ever launch a game (once per game). */
  firstLaunchOfGame: 25,

  // ---- showing up ----
  /** XP for each day you play at all. */
  perDayPlayed: 10,
  /**
   * Streak bonus: on the 2nd day in a row you get this much extra, on the 3rd twice as much,
   * and so on, up to `streakBonusCap` per day.
   */
  streakBonusPerDay: 5,
  streakBonusCap: 50,

  // ---- Steam ----
  /** XP for each Steam achievement unlocked (needs a linked Steam account). */
  perSteamAchievement: 15,

  // ---- your journal ----
  /** Marking a game "Beaten". */
  gameBeaten: 150,
  /** Marking a game "Completed" (instead of the Beaten bonus, not on top of it). */
  gameCompleted: 300,
  /** Giving a game a star rating. */
  gameRated: 20,

  // ---- levels ----
  /**
   * Level 2 takes `levelBase` XP. Each level after that takes `levelGrowth` more than the last
   * (100, 200, 300… with the defaults).
   */
  levelBase: 100,
  levelGrowth: 100,
  /** The title shown from each level upwards. */
  titles: [
    [1, 'Rookie'],
    [5, 'Adventurer'],
    [10, 'Veteran'],
    [20, 'Elite'],
    [30, 'Master'],
    [45, 'Grandmaster'],
    [60, 'Legend'],
    [80, 'Mythic']
  ] as [level: number, title: string][]
}

export type XpConfig = typeof XP_CONFIG
