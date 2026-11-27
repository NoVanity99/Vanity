import { app, Menu, shell, type MenuItemConstructorOptions } from 'electron'

/**
 * The Mac menu bar. Windows has no menu bar (Vanity draws its own title strip), so this is only
 * set on a Mac, where every app is expected to have one: and without an Edit menu, ⌘C / ⌘V /
 * ⌘A / ⌘Z don't work in text fields at all.
 */
export function setMacMenu(actions: { openSettings(): void; about(): void }): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Vanity',
      submenu: [
        { label: 'About Vanity', click: actions.about },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'Command+,', click: actions.openSettings },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide', label: 'Hide Vanity' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit', label: 'Quit Vanity' }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        ...(app.isPackaged ? [] : ([{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }] as MenuItemConstructorOptions[])),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Vanity on GitHub', click: () => void shell.openExternal('https://github.com/NoVanity99/Vanity') },
        { label: 'Release Notes', click: () => void shell.openExternal('https://github.com/NoVanity99/Vanity/releases') }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
