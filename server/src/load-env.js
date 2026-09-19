import fs from 'node:fs';

// The mobile app never receives this file. Process environment wins over local setup.
try {
  const file = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8');
  for (const line of file.split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (match && !Object.hasOwn(process.env, match[1])) process.env[match[1]] = match[2].trim();
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
