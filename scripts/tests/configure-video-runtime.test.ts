import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { H3_ENDPOINT, H3_PROVIDER, SIXREF_PROVIDER } from '../../apps/web/lib/video/hypit-runner';

const run = promisify(execFile);
const repo = path.resolve(import.meta.dirname, '../..');
const tsx = path.join(repo, 'apps/web/node_modules/tsx/dist/cli.mjs');
const script = path.join(repo, 'scripts/configure-video-runtime.ts');

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'configure-sixref-'));
  for (const name of [H3_PROVIDER, SIXREF_PROVIDER]) {
    const dir = path.join(root, 'packages', name);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'package.json'), '{}');
  }
  return root;
}
async function configure(root: string, route?: string) {
  const output = path.join(root, route === 'sixref-v1' ? 'sixref.json' : 'legacy.json');
  const args = [tsx, script, '--path', output, '--env', '--package-root', root, ...(route ? ['--route', route] : [])];
  const result = await run(process.execPath, args, { cwd: path.join(repo, 'apps/web') });
  return { output, stdout: result.stdout };
}

test('sixref configuration creates a separate pinned account01 runtime without secrets', async () => {
  const root = await fixture();
  const legacy = await configure(root);
  const sixref = await configure(root, 'sixref-v1');
  const profile = JSON.parse(await readFile(sixref.output, 'utf8'));
  const sidecar = JSON.parse(await readFile(`${sixref.output}.account.json`, 'utf8'));
  assert.equal(profile.endpoints[H3_ENDPOINT].use, SIXREF_PROVIDER);
  assert.equal(profile.endpoints[H3_ENDPOINT].config.instanceType, 'default');
  assert.equal(profile.endpoints[H3_ENDPOINT].config.firstPassMegapixels, 0.4096);
  assert.equal(profile.endpoints[H3_ENDPOINT].config.upscaleFactor, 1.5);
  assert.equal(sidecar.account, '01');
  assert.equal(sidecar.route, 'sixref-v1');
  assert.equal(sidecar.credential.key, 'RUNNINGHUB_API_KEY_01');
  assert.match(sixref.stdout, /VIDEO_SIXREF_HYPIT_RUNTIME/);
  assert.ok(!JSON.stringify(profile).includes('secret'));
  const originalLegacy = await readFile(legacy.output, 'utf8');
  assert.equal(JSON.parse(originalLegacy).endpoints[H3_ENDPOINT].use, H3_PROVIDER);
  await assert.rejects(configure(root, 'sixref-v1'));
  assert.equal(await readFile(legacy.output, 'utf8'), originalLegacy);
});
