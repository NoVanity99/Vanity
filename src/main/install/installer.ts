import type { Game } from '@shared/types'

/** What happened when an install was started. */
export interface InstallStart {
  /** Which installer took it. */
  installer: string
  /** One sentence for the user about what happens next. */
  note: string
}

/**
 * Something that can install a game that is owned but not on this PC.
 *
 * Each store gets its own installer. Today Steam hands the job to the Steam client; a
 * SteamCMD-based installer (downloading inside Vanity, with its own progress) can be added later
 * as another class with the same three members and put ahead of it in the list.
 */
export interface Installer {
  readonly id: string
  /** Whether this installer can install the game. */
  canInstall(game: Game): boolean
  /** Starts the install. Rejects with a message that can be shown to the user. */
  install(game: Game): Promise<InstallStart>
}

/** A failure with a message that can be shown as-is. */
export class InstallError extends Error {}

/**
 * Steam, the simple way: asks the Steam client to install the game (steam://install/<appid>).
 * Steam shows its own install window and does the download; Vanity notices when it is finished.
 */
export class SteamClientInstaller implements Installer {
  readonly id = 'steam-client'

  constructor(private openExternal: (url: string) => Promise<void>) {}

  canInstall(game: Game): boolean {
    return game.source === 'steam' && /^\d+$/.test(game.externalId)
  }

  async install(game: Game): Promise<InstallStart> {
    try {
      await this.openExternal(`steam://install/${game.externalId}`)
    } catch {
      throw new InstallError("Couldn't open Steam. Is it installed on this PC?")
    }
    return { installer: this.id, note: 'Steam games install through Steam. Finish the install in the Steam window; the game moves to Installed here by itself.' }
  }
}

/** Picks the first installer that can handle a game. */
export class Installers {
  constructor(private list: Installer[]) {}

  canInstall(game: Game): boolean {
    return !game.installed && this.list.some((i) => i.canInstall(game))
  }

  async install(game: Game): Promise<InstallStart> {
    if (game.installed) throw new InstallError(`${game.name} is already installed.`)
    const installer = this.list.find((i) => i.canInstall(game))
    if (!installer) {
      if (process.platform === 'darwin' && (game.source === 'epic' || game.source === 'gog')) throw new InstallError(`On a Mac, install ${game.name} from ${game.source === 'epic' ? 'the Epic Games Launcher' : 'GOG Galaxy'}. Vanity finds it there by itself.`)
      throw new InstallError(`Vanity can't install ${game.name} yet. Install it from its own launcher.`)
    }
    return installer.install(game)
  }
}
