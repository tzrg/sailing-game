// Führt alle Testdateien nacheinander aus (npm test).
// Jede Datei ist eigenständig: startet ihren eigenen Server + Browser und
// beendet sich mit Exit-Code 0/1.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const files = ['api.test.mjs', 'landing.test.mjs', 'wurm.test.mjs', 'td.test.mjs'];

let failed = 0;
for (const f of files) {
  console.log('\n━━━━━━ ' + f + ' ━━━━━━');
  const code = await new Promise((resolve) => {
    const c = spawn(process.execPath, [path.join(dir, f)], { stdio: 'inherit' });
    c.on('exit', resolve);
  });
  if (code !== 0) { failed++; console.log('✗ ' + f + ' fehlgeschlagen (Exit ' + code + ')'); }
}

console.log(failed
  ? '\n✗ ' + failed + ' von ' + files.length + ' Testdateien fehlgeschlagen'
  : '\n✓ Alle ' + files.length + ' Testdateien grün');
process.exit(failed ? 1 : 0);
