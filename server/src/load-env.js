import fs from 'node:fs';

// The mobile app never receives this file. Process environment wins over local setup.
if (!process.env.OPENAI_API_KEY) {
  try {
    const file = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8');
    const line = file.split(/\r?\n/).find((item) => item.startsWith('OPENAI_API_KEY='));
    if (line) process.env.OPENAI_API_KEY = line.slice('OPENAI_API_KEY='.length).trim();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
