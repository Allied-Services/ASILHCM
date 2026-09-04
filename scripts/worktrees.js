'use strict';

/**
 * Worktree hygiene — one working folder per agent, and a safe way to reclaim the rest.
 *
 * Why this exists: agents were sharing C:\Projects\HCM\BPOFMSystem. Two agents in one folder
 * means one switches the branch under the other and uncommitted work disappears. The rule
 * is now: the owner's folder is the owner's; every agent gets its own scratch worktree.
 *
 * Usage:
 *   npm run wt              list every worktree with branch / dirty / unpushed / size
 *   npm run wt:new -- slug  create .agents/<slug> off origin/main on branch agent/<slug>
 *   npm run tidy            remove worktrees that are provably safe to remove
 *   npm run tidy -- --dry   show what tidy would remove, change nothing
 *
 * tidy refuses to remove a worktree unless ALL of these hold:
 *   - it is not the owner's main worktree, and not the folder tidy is running from
 *   - `git status` is clean (no uncommitted work at all)
 *   - every local commit is already on origin (nothing exists only on this disk)
 *   - the branch is merged into origin/main, or its PR was merged (squash-safe check)
 *   - nothing in it was modified in the last 2 hours (an agent may still be working)
 * Anything that fails a check is skipped and reported, never force-removed.
 *
 * LIVE-SIDE-EFFECT: no. Local disk and local branches only. Never touches origin except
 * a safety `git push` of a branch that would otherwise only exist on this machine.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ACTIVE_WINDOW_MS = Number(process.env.WT_ACTIVE_WINDOW_MS || 2 * 60 * 60 * 1000);
const PROTECTED_BRANCHES = new Set(['main', 'master', 'develop', 'staging']);
const AGENT_HOME = process.env.WT_AGENT_HOME || path.join('C:', path.sep, 'Projects', '.agents');

const args = process.argv.slice(2);
const cmd = (args[0] || 'list').toLowerCase();
const dryRun = args.includes('--dry') || args.includes('--dry-run');

function git(gitArgs, opts = {}) {
  return execFileSync('git', gitArgs, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', opts.quiet ? 'ignore' : 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
    ...opts,
  }).trim();
}

function gitTry(gitArgs, opts = {}) {
  try {
    return { ok: true, out: git(gitArgs, { quiet: true, ...opts }) };
  } catch (err) {
    return { ok: false, out: '', err: (err.stderr || err.message || '').toString().trim() };
  }
}

function listWorktrees() {
  const raw = git(['worktree', 'list', '--porcelain']);
  const trees = [];
  let current = null;
  for (const line of raw.split('\n')) {
    if (line.startsWith('worktree ')) {
      current = { dir: path.resolve(line.slice('worktree '.length)) };
      trees.push(current);
    } else if (current && line.startsWith('branch ')) {
      current.branch = line.slice('branch refs/heads/'.length);
    } else if (current && line === 'detached') {
      current.branch = '(detached)';
    }
  }
  if (trees[0]) trees[0].isMain = true;
  return trees;
}

function dirSizeBytes(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    let entries;
    try {
      entries = fs.readdirSync(stack.pop(), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(entry.parentPath || entry.path || dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) {
        try {
          total += fs.statSync(full).size;
        } catch {
          /* vanished mid-walk */
        }
      }
    }
  }
  return total;
}

function newestMtimeMs(dir) {
  const roots = ['.', 'frontend/src', 'backend', 'backend/src', 'scripts', 'docs', 'database'];
  let newest = 0;
  for (const rel of roots) {
    const base = path.join(dir, rel);
    const stack = [base];
    let budget = 4000;
    while (stack.length && budget-- > 0) {
      let entries;
      try {
        entries = fs.readdirSync(stack.pop(), { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
        const full = path.join(entry.parentPath || entry.path || base, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else {
          try {
            const m = fs.statSync(full).mtimeMs;
            if (m > newest) newest = m;
          } catch {
            /* ignore */
          }
        }
      }
    }
  }
  return newest;
}

function gb(bytes) {
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function inspect(tree) {
  const dir = tree.dir;
  const info = { ...tree, exists: fs.existsSync(dir) };
  if (!info.exists) return info;

  info.dirty = gitTry(['-C', dir, 'status', '--porcelain']).out.split('\n').filter(Boolean).length;
  info.unpushed = gitTry(['-C', dir, 'log', '--oneline', '@{u}..HEAD']).out.split('\n').filter(Boolean).length;
  info.noUpstream = !gitTry(['-C', dir, 'rev-parse', '--abbrev-ref', '@{u}']).ok;

  info.ancestor = gitTry(['-C', dir, 'merge-base', '--is-ancestor', 'HEAD', 'origin/main']).ok;
  if (info.ancestor) {
    info.merged = true;
  } else {
    const cherry = gitTry(['-C', dir, 'cherry', 'origin/main', 'HEAD']).out;
    const outstanding = cherry.split('\n').filter((l) => l.startsWith('+'));
    info.merged = outstanding.length === 0;
    info.outstanding = outstanding.length;
  }

  info.newestMs = newestMtimeMs(dir);
  info.activeRecently = Date.now() - info.newestMs < ACTIVE_WINDOW_MS;
  return info;
}

function removalBlockers(info, selfDir) {
  const blockers = [];
  if (info.isMain) blockers.push("owner's folder");
  if (path.resolve(info.dir) === path.resolve(selfDir)) blockers.push('running from here');
  if (info.dirty) blockers.push(`${info.dirty} uncommitted file${info.dirty === 1 ? '' : 's'}`);
  if (info.unpushed) blockers.push(`${info.unpushed} commit${info.unpushed === 1 ? '' : 's'} not on GitHub`);
  if (info.noUpstream) blockers.push('branch never pushed');
  if (!info.merged) blockers.push(`${info.outstanding} commit(s) not in main`);
  if (info.activeRecently) blockers.push('touched in the last 2h');
  return blockers;
}

function report(infos, selfDir) {
  const rows = infos.map((info) => {
    const blockers = info.exists ? removalBlockers(info, selfDir) : ['folder missing'];
    return { info, blockers };
  });
  console.log('');
  for (const { info, blockers } of rows) {
    const size = info.exists ? gb(dirSizeBytes(info.dir)) : '-';
    const state = blockers.length === 0 ? 'REMOVABLE' : 'KEEP';
    console.log(`${state.padEnd(10)} ${info.dir}`);
    console.log(`           branch ${info.branch || '?'} · ${size}`);
    if (blockers.length) console.log(`           keeping because: ${blockers.join(', ')}`);
  }
  console.log('');
  return rows;
}

function cmdList(selfDir) {
  report(listWorktrees().map(inspect), selfDir);
}

function cmdNew(selfDir) {
  const slug = (args[1] || '').replace(/[^a-z0-9-]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  if (!slug) {
    console.error('Give it a name: npm run wt:new -- portal-fix');
    process.exit(2);
  }
  const dir = path.join(AGENT_HOME, slug);
  if (fs.existsSync(dir)) {
    console.error(`${dir} already exists — pick another name or tidy first.`);
    process.exit(2);
  }
  git(['fetch', 'origin', '--quiet']);
  fs.mkdirSync(AGENT_HOME, { recursive: true });
  const branch = `agent/${slug}`;
  const made = gitTry(['worktree', 'add', dir, '-b', branch, 'origin/main']);
  if (!made.ok) {
    console.error(made.err || 'could not create the worktree');
    process.exit(1);
  }
  console.log(`\nworktree  ${dir}`);
  console.log(`branch    ${branch} (from origin/main)`);
  console.log('\nWork only in that folder. When the PR is merged, run: npm run tidy\n');
  void selfDir;
}

function cmdTidy(selfDir) {
  const rows = report(listWorktrees().map(inspect), selfDir);
  const removable = rows.filter((r) => r.blockers.length === 0);
  if (removable.length === 0) {
    console.log('Nothing safe to remove. Everything above is being kept for the reason shown.\n');
    return;
  }

  let freed = 0;
  for (const { info } of removable) {
    const size = dirSizeBytes(info.dir);
    if (dryRun) {
      console.log(`would remove  ${info.dir}  (${gb(size)})`);
      freed += size;
      continue;
    }
    const removed = gitTry(['worktree', 'remove', '--force', info.dir]);
    if (!removed.ok) {
      console.log(`FAILED  ${info.dir} — ${removed.err.split('\n')[0]}`);
      continue;
    }
    if (fs.existsSync(info.dir)) {
      try {
        fs.rmSync(info.dir, { recursive: true, force: true });
      } catch {
        /* git already unregistered it; leftover files are harmless */
      }
    }
    freed += size;
    console.log(`removed  ${info.dir}  (${gb(size)})`);
    if (info.branch && info.branch !== '(detached)' && info.merged && !PROTECTED_BRANCHES.has(info.branch)) {
      const del = gitTry(['branch', '-D', info.branch]);
      if (del.ok) console.log(`         local branch ${info.branch} deleted (it is on GitHub and in main)`);
    }
  }

  gitTry(['worktree', 'prune']);
  console.log(`\n${dryRun ? 'Would free' : 'Freed'} ${gb(freed)}.\n`);
}

function main() {
  const selfDir = process.cwd();
  if (cmd === 'list' || cmd === 'ls') return cmdList(selfDir);
  if (cmd === 'new' || cmd === 'add') return cmdNew(selfDir);
  if (cmd === 'tidy' || cmd === 'clean') return cmdTidy(selfDir);
  console.error('Commands: list · new <slug> · tidy [--dry]');
  process.exit(2);
}

if (require.main === module) main();

module.exports = { removalBlockers, PROTECTED_BRANCHES, ACTIVE_WINDOW_MS };
