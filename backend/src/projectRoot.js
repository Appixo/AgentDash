// Resolve a child working directory up to its project root.
//
// Claude Code records the exact `cwd` the user launched it from, which is
// often a subfolder (e.g. `PrayerTime/namaz_vakitleri_flutter` when running
// `flutter run`). The Scrum Master view wants the conceptual project — the
// repo root — so subfolders roll up under one workspace.
//
// Strategy: walk up from cwd to the first ancestor containing `.git`
// (file *or* directory — `.git` is a file inside git worktrees). If no
// `.git` is found anywhere, fall back to the original cwd so non-git
// projects still appear (under their literal folder name).

import fs from 'node:fs';
import path from 'node:path';

const cache = new Map();

export const findProjectRoot = (startDir) => {
  if (!startDir) return startDir;

  const cached = cache.get(startDir);
  if (cached) return cached;

  let current = path.resolve(startDir);
  // Guard against infinite loops on malformed paths.
  for (let i = 0; i < 64; i += 1) {
    try {
      if (fs.existsSync(path.join(current, '.git'))) {
        cache.set(startDir, current);
        return current;
      }
    } catch { /* unreadable parent — keep walking */ }

    const parent = path.dirname(current);
    if (parent === current) break; // reached filesystem root
    current = parent;
  }

  cache.set(startDir, startDir);
  return startDir;
};
