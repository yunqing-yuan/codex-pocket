import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const browser = await chromium.launch({ executablePath: process.env.POCKET_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
  const svg = readFileSync('resources/icon.svg', 'utf8');
  const foreground = svg.replace(/<rect[^>]+\/>/g, '').replace('scale(1.22)', 'scale(.92)');
  const draw = async (source, size, path) => {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>${source}`);
    await page.screenshot({ path, omitBackground: true });
  };
  await draw(svg, 512, 'resources/icon.png');
  const res = 'android/app/src/main/res';
  for (const [density, scale] of [['mdpi',1],['hdpi',1.5],['xhdpi',2],['xxhdpi',3],['xxxhdpi',4]]) {
    const dir = join(res, 'mipmap-' + density); mkdirSync(dir, { recursive: true });
    await draw(svg, 48 * scale, join(dir, 'ic_launcher.png'));
    await draw(svg.replace(/rx="116"/g, 'rx="256"').replace('rx="102"', 'rx="240"'), 48 * scale, join(dir, 'ic_launcher_round.png'));
    await draw(foreground, 108 * scale, join(dir, 'ic_launcher_foreground.png'));
  }
  writeFileSync(join(res, 'values/ic_launcher_background.xml'), '<?xml version="1.0" encoding="utf-8"?>\n<resources><color name="ic_launcher_background">#13332F</color></resources>\n');
  console.log('Launcher icons generated for all five Android densities.');
} finally { await browser.close(); }
