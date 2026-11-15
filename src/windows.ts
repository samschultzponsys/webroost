/*
 * Windows integration: what .desktop files, autostart entries and
 * mimeapps.list do on Linux.
 *  - Each app gets a Start menu shortcut (Programs\WebRoost apps\<Name>.lnk)
 *    carrying its own AppUserModelID. Windows uses that ID for the app's own
 *    taskbar button and icon, and only shows its notifications (toasts) with
 *    a matching shortcut in the Start menu.
 *  - Autostart is a shortcut in the Startup folder (with --hidden).
 *  - tel:/callto:/sip: are registered for the phone app under HKCU\Software\Classes.
 */
import * as fs from 'fs';
import * as path from 'path';
import { app, shell } from 'electron';
import type { AppConfig } from './config';
import { ensureDir, launcherCommand } from './paths';

export const appUserModelId = (id: string) => `io.github.samschultzponsys.WebRoost.${id}`;

const programs = () => path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs');
export const appsFolder = () => path.join(programs(), 'WebRoost apps');
export const startupFolder = () => path.join(programs(), 'Startup');

/** A name Windows accepts as a file name. */
export function safeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/, '').trim() || 'App';
}

/** Arguments for a shortcut or registry command line (Windows quoting). */
export function winArgs(args: string[]): string {
  return args.map((a) => (/^[^\s"]+$/.test(a) ? a : `"${a.replace(/"/g, '\\"')}"`)).join(' ');
}

/** ICO file holding one 256 px PNG (understood by Windows Vista and later). */
export function pngToIco(png: Buffer): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry.writeUInt8(0, 0); entry.writeUInt8(0, 1); // 0 = 256 px
  entry.writeUInt8(0, 2); entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8); entry.writeUInt32LE(22, 12);
  return Buffer.concat([header, entry, png]);
}

/** Shortcuts in `dir` that start app `id`. */
function shortcutsFor(dir: string, id: string): string[] {
  let names: string[] = [];
  try { names = fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.lnk')); } catch { return []; }
  const want = new RegExp(`(^|\\s)--app\\s+"?${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"?(\\s|$)`);
  return names.map((n) => path.join(dir, n)).filter((f) => {
    try { return want.test(shell.readShortcutLink(f).args || ''); } catch { return false; }
  });
}

function writeShortcut(file: string, app2: AppConfig, iconPng: string, extraArgs: string[]): void {
  const [target, ...pre] = launcherCommand();
  let icon: string | undefined;
  try {
    icon = iconPng.replace(/\.png$/i, '') + '.ico';
    fs.writeFileSync(icon, pngToIco(fs.readFileSync(iconPng)));
  } catch { icon = undefined; }
  ensureDir(path.dirname(file));
  shell.writeShortcutLink(file, 'replace', {
    target,
    args: winArgs([...pre, '--app', app2.id, ...extraArgs]),
    description: `${app2.name} — runs in the tray with WebRoost`,
    appUserModelId: appUserModelId(app2.id),
    ...(icon ? { icon, iconIndex: 0 } : {}),
  });
}

export function winIsInstalled(id: string) {
  return { menu: shortcutsFor(appsFolder(), id).length > 0, autostart: shortcutsFor(startupFolder(), id).length > 0 };
}

export function winSetAutostart(app2: AppConfig, iconPng: string, enabled: boolean): string | null {
  for (const f of shortcutsFor(startupFolder(), app2.id)) fs.rmSync(f, { force: true });
  if (!enabled) return null;
  const file = path.join(startupFolder(), `${safeFileName(app2.name)} (WebRoost).lnk`);
  writeShortcut(file, app2, iconPng, ['--hidden']);
  return file;
}

/** Register (or with an empty list, unregister) this app for tel:/callto:/sip: links. */
export function winSetSchemes(app2: AppConfig, schemes: string[]): void {
  const [exe, ...pre] = launcherCommand();
  for (const s of ['tel', 'callto', 'sip']) {
    const args = [...pre, '--app', app2.id];
    if (schemes.includes(s)) app.setAsDefaultProtocolClient(s, exe, args);
    else if (app.isDefaultProtocolClient(s, exe, args)) app.removeAsDefaultProtocolClient(s, exe, args);
  }
}

export function winInstallApp(app2: AppConfig, iconPng: string, autostart: boolean, schemes: string[]) {
  for (const f of shortcutsFor(appsFolder(), app2.id)) fs.rmSync(f, { force: true });
  const file = path.join(appsFolder(), `${safeFileName(app2.name)}.lnk`);
  writeShortcut(file, app2, iconPng, []);
  try { winSetSchemes(app2, schemes); } catch (e) { console.warn('[webroost] could not register the link handler', e); }
  return { desktop: file, autostart: winSetAutostart(app2, iconPng, autostart) };
}

export function winUninstallApp(id: string): string[] {
  const removed = [...shortcutsFor(appsFolder(), id), ...shortcutsFor(startupFolder(), id)];
  for (const f of removed) fs.rmSync(f, { force: true });
  try { winSetSchemes({ id, name: id, url: '' } as AppConfig, []); } catch { /* ignore */ }
  return removed;
}
