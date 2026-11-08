import { mkdir, rename } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'
import { preview } from 'vite'

const root = fileURLToPath(new URL('../', import.meta.url))
const server = await preview({ root, logLevel: 'error', preview: { host: '127.0.0.1', port: 0, open: false } })
let browser
try {
  browser = await chromium.launch()
  const url = server.resolvedUrls.local[0]
  await mkdir(resolve(root, 'assets'), { recursive: true })
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 1000, height: 1000 }, deviceScaleFactor: 2, reducedMotion: 'reduce', colorScheme: theme })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${url}?profile=1&theme=${theme}`, { waitUntil: 'networkidle' })
    await page.locator('canvas[data-ready="true"][data-settled="true"][data-progress="1.000"]').waitFor()
    await page.evaluate(() => document.fonts.ready)
    if (errors.length) throw new Error(`Profile rendering failed: ${errors.join('; ')}`)
    const path = resolve(root, `assets/contribution-skyline-${theme}.png`)
    await page.getByTestId('profile-render').screenshot({ path: path + '.tmp', type: 'png', animations: 'disabled', omitBackground: true })
    await rename(path + '.tmp', path)
    await context.close()
    console.log(`Rendered assets/contribution-skyline-${theme}.png`)
  }
} finally {
  await browser?.close()
  await new Promise((done, reject) => server.httpServer.close(error => error ? reject(error) : done()))
}
