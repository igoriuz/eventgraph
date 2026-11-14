import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** See the CLI's presetsDir: bundled beside the output once published. */
export function presetsDirPath(): string {
  const candidates = [
    join(import.meta.dirname, 'presets'),
    join(import.meta.dirname, '..', 'presets'),
    join(import.meta.dirname, '..', '..', 'presets'),
    join(import.meta.dirname, '..', '..', '..', '..', 'presets'),
  ];
  return candidates.find(existsSync) ?? candidates[candidates.length - 1]!;
}
