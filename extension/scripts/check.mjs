// Validates the extension can be loaded unpacked: manifest shape, referenced files exist, scripts parse.
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const errors = [];

if (manifest.manifest_version !== 3) errors.push('manifest_version must be 3');
for (const p of ['storage', 'alarms', 'idle']) if (!manifest.permissions?.includes(p)) errors.push(`missing permission ${p}`);
// Keep the permission list minimal for Chrome Web Store review: host permissions already cover claude.ai tabs.
for (const p of manifest.permissions ?? []) if (!['storage', 'alarms', 'idle'].includes(p)) errors.push(`unexpected permission ${p}`);
for (const size of ['16', '32', '48', '128']) {
  const icon = manifest.icons?.[size];
  if (!icon || !existsSync(join(root, icon))) errors.push(`missing ${size}px icon`);
}
for (const h of ['https://claude.ai/*', 'https://codegedanken.dev/*', 'http://localhost:3000/*'])
  if (!manifest.host_permissions?.includes(h)) errors.push(`missing host permission ${h}`);

const files = [
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  ...(manifest.content_scripts ?? []).flatMap((c) => c.js ?? []),
  'popup.js',
].filter(Boolean);
for (const f of files) if (!existsSync(join(root, f))) errors.push(`missing file ${f}`);

for (const f of files.filter((f) => f.endsWith('.js'))) {
  try {
    execFileSync(process.execPath, ['--check', join(root, f)], { stdio: 'pipe' });
  } catch (e) {
    errors.push(`${f}: ${e.stderr?.toString() || e.message}`);
  }
}

if (errors.length) {
  console.error('Extension check failed:\n - ' + errors.join('\n - '));
  process.exit(1);
}
console.log(`Extension OK: ${manifest.name} v${manifest.version} (${files.length} files checked)`);
