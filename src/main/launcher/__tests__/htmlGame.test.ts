import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { prettifyName } from '../../util/executables'
import { gameFileResponse, gameIdFromHost, gameUrl, isHtmlGame, nameFromHtml } from '../htmlGame'

describe('web games', () => {
  it('recognises web games and names them', () => {
    expect(isHtmlGame('C:\\Games\\Tiny\\index.HTML')).toBe(true)
    expect(isHtmlGame('C:\\Games\\Tiny\\game.htm')).toBe(true)
    expect(isHtmlGame('C:\\Games\\Tiny\\game.exe')).toBe(false)
    expect(nameFromHtml('/games/Cookie_Clicker/index.html', prettifyName)).toBe('Cookie Clicker')
    expect(nameFromHtml('/downloads/flappy-bird.html', prettifyName)).toBe('flappy-bird')
    expect(nameFromHtml('/downloads/SuperSnake.htm', prettifyName)).toBe('Super Snake')
  })

  it('gives each game its own origin', () => {
    expect(gameUrl(12, '/games/x/my game.html')).toBe('vanity-game://game-12/my%20game.html')
    expect(gameIdFromHost('game-12')).toBe(12)
    expect(gameIdFromHost('evil')).toBeNull()
  })

  it('serves files from the game folder only, with the right types and headers', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vanity-web-'))
    mkdirSync(join(root, 'Build'))
    writeFileSync(join(root, 'index.html'), '<h1>hi</h1>')
    writeFileSync(join(root, 'Build', 'game.wasm.br'), 'compressed')
    writeFileSync(join(root, 'Build', 'music.ogg'), '0123456789')
    writeFileSync(join(root, '..', 'secret.txt'), 'nope')

    const html = await gameFileResponse(root, '/index.html', null)
    expect(html.status).toBe(200)
    expect(html.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(html.headers.get('cross-origin-opener-policy')).toBe('same-origin')
    expect(await html.text()).toBe('<h1>hi</h1>')

    expect((await gameFileResponse(root, '/', null)).status).toBe(200) // defaults to index.html

    const wasm = await gameFileResponse(root, '/Build/game.wasm.br', 'bytes=0-3')
    expect(wasm.status).toBe(200) // compressed files are never served in ranges
    expect(wasm.headers.get('content-type')).toBe('application/wasm')
    expect(wasm.headers.get('content-encoding')).toBe('br')

    const part = await gameFileResponse(root, '/Build/music.ogg', 'bytes=2-5')
    expect(part.status).toBe(206)
    expect(part.headers.get('content-range')).toBe('bytes 2-5/10')
    expect(await part.text()).toBe('2345')

    for (const bad of ['/../secret.txt', '/%2e%2e/secret.txt', '/Build/../../secret.txt', '/missing.js', '/Build', '/%E0%A4%A']) {
      expect((await gameFileResponse(root, bad, null)).status, bad).toBeGreaterThanOrEqual(400)
    }
  })
})
