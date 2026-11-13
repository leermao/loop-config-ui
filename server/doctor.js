import path from 'node:path';

import { commandPath, runCommand } from './command.js';
import { pathExists, readJsonIfExists, readTextIfExists } from './paths.js';
import { createSnapshotService } from './snapshot.js';

const REQUIRED_COMMANDS = [
  { id: 'jq', label: 'jq', fix: 'brew install jq' },
  { id: 'perl', label: 'perl', fix: 'macOS 通常自带；若缺失请安装 Perl' },
  { id: 'git', label: 'git', fix: '安装 Git 或 Xcode Command Line Tools' },
  { id: 'curl', label: 'curl', fix: '安装 curl' },
  { id: 'timeout', label: 'timeout', fix: 'brew install coreutils' },
  { id: 'pnpm', label: 'pnpm', fix: 'corepack enable && corepack prepare pnpm@8.14.3 --activate' },
  { id: 'claude', label: 'Claude Code', fix: '安装 Claude Code，并确认 ~/.local/bin 在 launchd PATH 中' },
  { id: 'codex', label: 'Codex CLI', fix: '安装 Codex CLI，并确认 ~/.local/bin 在 launchd PATH 中' },
  { id: 'agy', label: 'Agy', fix: '安装 Agy，并确认可执行文件在 PATH 中' },
  { id: 'glab', label: 'glab', fix: '安装 glab 并完成 glab auth login' },
  { id: 'launchctl', label: 'launchctl', fix: 'macOS 系统命令，检查系统完整性' },
  { id: '/usr/libexec/PlistBuddy', label: 'PlistBuddy', fix: 'macOS 系统命令，检查系统完整性' }
];

const OPTIONAL_COMMANDS = [
  { id: 'cmux', label: 'cmux', fix: '可选：安装 cmux 以优先使用 cmux 通知' },
  { id: 'osascript', label: 'osascript', fix: 'macOS 通知兜底命令' }
];

async function commandCheck(item, findCommand) {
  const target = item.id.startsWith('/') ? item.id : await findCommand(item.id);
  const exists = item.id.startsWith('/') ? await pathExists(target) : Boolean(target);
  return {
    id: `command:${item.id}`,
    label: item.label,
    status: exists ? 'ok' : (item.optional ? 'warn' : 'error'),
    detail: exists ? target : '未找到可执行文件',
    fix: exists ? null : item.fix
  };
}

function entryByKey(config, key) {
  return config.entries.find((entry) => entry.key === key) ?? null;
}

export async function runDoctor(config, {
  run = runCommand,
  snapshotService,
  findCommand = commandPath,
  env = process.env
} = {}) {
  const items = [];
  const snapshots = snapshotService ?? createSnapshotService(config, { run });
  const snapshot = await snapshots.build();

  for (const item of REQUIRED_COMMANDS) items.push(await commandCheck(item, findCommand));
  for (const item of OPTIONAL_COMMANDS) items.push(await commandCheck({ ...item, optional: true }, findCommand));

  items.push({
    id: 'node',
    label: 'Node.js',
    status: 'ok',
    detail: process.version,
    fix: null
  });

  const pnpm = await run('pnpm', ['-v'], { timeoutMs: 5_000 });
  items.push({
    id: 'pnpm:version',
    label: 'pnpm 版本',
    status: pnpm.code === 0 ? 'ok' : 'warn',
    detail: pnpm.code === 0 ? pnpm.stdout.trim() : '无法读取 pnpm 版本',
    fix: pnpm.code === 0 ? null : 'corepack enable && corepack prepare pnpm@8.14.3 --activate'
  });

  const pathChecks = [
    ['app', '安装副本', config.appDir, '运行安装脚本或执行版本同步'],
    ['runs', '状态目录', config.runsDir, '启动一次 autofix，或检查 AUTOFIX_HOME'],
    ['repo', 'worktree', config.repoDir, '启动主流水线后会自动创建，或在运维页重建'],
    ['main', '主仓库', config.mainRepo, '检查 AUTOFIX_MAIN'],
    ['skill', '源码 skill', config.skillDir, '检查 AUTOFIX_MAIN 或 AUTOFIX_SKILL_DIR']
  ];
  for (const [id, label, target, fix] of pathChecks) {
    const exists = await pathExists(target);
    items.push({
      id: `path:${id}`,
      label,
      status: exists ? 'ok' : 'error',
      detail: target,
      fix: exists ? null : fix
    });
  }

  const envExists = await pathExists(config.envFile);
  items.push({
    id: 'path:env',
    label: '配置文件 .env',
    status: envExists ? 'ok' : 'warn',
    detail: config.envFile,
    fix: envExists ? null : '从 .env.example 复制并填写配置'
  });

  const mainPlist = snapshot.main.plist;
  items.push({
    id: 'launchd:main',
    label: '主 launchd 配置',
    status: snapshot.main.loaded ? 'ok' : (mainPlist ? 'warn' : 'error'),
    detail: snapshot.main.loaded ? `已加载：${snapshot.main.label}` : (mainPlist ?? '未找到 plist'),
    fix: snapshot.main.loaded ? null : '在运维页启动主流水线，或检查 ~/Library/LaunchAgents/com.autofix.plist'
  });
  const notifyPlist = path.join(config.launchAgentsDir, 'com.autofix.notify.plist');
  const notifyExists = await pathExists(notifyPlist);
  items.push({
    id: 'launchd:notify',
    label: '通知 launchd 配置',
    status: snapshot.notify.loaded ? 'ok' : (notifyExists ? 'warn' : 'error'),
    detail: snapshot.notify.loaded ? '已加载' : (notifyExists ? '存在但未加载' : '未找到 plist'),
    fix: snapshot.notify.loaded ? null : '在运维页启动通知任务'
  });

  items.push({
    id: 'version',
    label: 'skill / 安装版本',
    status: snapshot.versions.match ? 'ok' : 'warn',
    detail: `源码 ${snapshot.versions.source ?? '无'} / 安装 ${snapshot.versions.installed ?? '无'}`,
    fix: snapshot.versions.match ? null : '在运维页执行“同步版本并重启”'
  });

  let queueOk = true;
  let queueDetail = `${snapshot.queue.count} 条`;
  try {
    const queue = await readJsonIfExists(path.join(config.runsDir, 'queue.json'), []);
    if (!Array.isArray(queue)) throw new Error('queue.json 不是数组');
    queueDetail = `${queue.length} 条`;
  } catch (error) {
    queueOk = false;
    queueDetail = `无法解析：${error.message}`;
  }
  items.push({
    id: 'queue',
    label: '队列文件',
    status: queueOk ? 'ok' : 'error',
    detail: queueDetail,
    fix: queueOk ? null : '修复 ~/autofix/runs/queue.json，必须是 JSON 数组'
  });

  const xToken = entryByKey(config, 'YUNXIAO_TOKEN');
  const gitlabToken = entryByKey(config, 'GITLAB_TOKEN');
  items.push({
    id: 'credential:yunxiao',
    label: '云效 token',
    status: xToken?.configured ? 'ok' : 'warn',
    detail: xToken?.configured ? '已配置' : '未配置（流水线 MCP 可能仍可用）',
    fix: xToken?.configured ? null : '如使用 OpenAPI 直调，在配置页填写 YUNXIAO_TOKEN'
  });
  items.push({
    id: 'credential:gitlab',
    label: 'GitLab token',
    status: gitlabToken?.configured ? 'ok' : 'warn',
    detail: gitlabToken?.configured ? '已配置' : '未配置，将尝试 glab auth login',
    fix: gitlabToken?.configured ? null : '配置 GITLAB_TOKEN 或执行 glab auth login'
  });

  if (await findCommand('glab')) {
    const glab = await run('glab', ['auth', 'status'], { timeoutMs: 5_000 });
    items.push({
      id: 'glab:auth',
      label: 'glab 登录状态',
      status: glab.code === 0 ? 'ok' : 'warn',
      detail: (glab.stdout || glab.stderr || '').trim() || (glab.code === 0 ? '已登录' : '未登录'),
      fix: glab.code === 0 ? null : '执行 glab auth login'
    });
  }

  items.push({
    id: 'worktree',
    label: 'worktree 状态',
    status: snapshot.worktree.exists ? (snapshot.worktree.dirty ? 'warn' : 'ok') : 'warn',
    detail: snapshot.worktree.exists
      ? `${snapshot.worktree.branch ?? 'detached'}${snapshot.worktree.dirty ? ` · ${snapshot.worktree.changedFiles.length} 个改动` : ' · 干净'}`
      : config.repoDir,
    fix: snapshot.worktree.exists ? (snapshot.worktree.dirty ? '确认改动来源；必要时 stash 或手工清理' : null) : '在运维页重建 worktree'
  });

  const summary = {
    ok: items.filter((item) => item.status === 'ok').length,
    warn: items.filter((item) => item.status === 'warn').length,
    error: items.filter((item) => item.status === 'error').length
  };
  return {
    generatedAt: new Date().toISOString(),
    summary,
    items,
    envFile: config.envFile,
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      path: env.PATH ?? ''
    }
  };
}
