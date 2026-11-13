import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CONSOLE_ROOT = fileURLToPath(new URL('..', import.meta.url));

export const CONFIG_SCHEMA = [
  { key: 'YUNXIAO_TOKEN', group: '云效', label: '云效个人访问令牌', default: '', sensitive: true, restart: true, help: 'OpenAPI 直调用；流水线同步主要走 MCP。' },
  { key: 'YUNXIAO_ORG_ID', group: '云效', label: '企业 ID', default: '667be395d5996dad49454947', restart: true },
  { key: 'YUNXIAO_SPACE_ID', group: '云效', label: '项目空间 ID', default: '5e0cdcbd0d02a0a794dc35fe7e', restart: true },
  { key: 'YUNXIAO_ENDPOINT', group: '云效', label: 'OpenAPI 地址', default: 'https://openapi-rdc.aliyuncs.com/oapi/v1', restart: true },
  { key: 'YUNXIAO_ASSIGNEE_ID', group: '云效', label: '缺陷指派人 ID', default: '6aaf4b6e0216df31e7c1e13a', restart: true },
  { key: 'YUNXIAO_BUG_TYPE_ID', group: '云效', label: '缺陷类型 ID', default: '37da3a07df4d08aef2e3b393', restart: true },
  { key: 'YUNXIAO_ST_NEW', group: '云效', label: '待确认状态 ID', default: '28', restart: true },
  { key: 'YUNXIAO_ST_REOPEN', group: '云效', label: '再次打开状态 ID', default: '30', restart: true },
  { key: 'YUNXIAO_ST_DOING', group: '云效', label: '处理中状态 ID', default: '100010', restart: true },
  { key: 'YUNXIAO_ST_FIXED', group: '云效', label: '已修复未提交状态 ID', default: '848f5a1633c068b72e71137fe5', restart: true },
  { key: 'YUNXIAO_ST_DEFER', group: '云效', label: '推迟修复状态 ID', default: '34', restart: true },
  { key: 'YUNXIAO_AI_FALLBACK', group: '云效', label: 'OpenAPI 失败时改走 MCP', default: '0', restart: true },
  { key: 'YUNXIAO_MCP_ENDPOINT', group: '云效', label: 'MCP 地址', default: 'https://openapi-rdc.aliyuncs.com/ai/mcp', restart: true },

  { key: 'GITLAB_TOKEN', group: 'GitLab', label: 'GitLab 访问令牌', default: '', sensitive: true, restart: true, help: '留空时使用 glab auth login 的凭据。' },
  { key: 'GITLAB_HOST', group: 'GitLab', label: 'GitLab Host', default: 'code.lingyiwanwu.net', restart: true },

  { key: 'AUTOFIX_MAIN', group: '路径', label: '主仓库', default: '${HOME}/01/hbp-editor', restart: true },
  { key: 'AUTOFIX_REPO', group: '路径', label: '流水线 worktree', default: '${HOME}/autofix/worktree', restart: true },
  { key: 'AUTOFIX_HOME', group: '路径', label: '状态目录', default: '${HOME}/autofix/runs', restart: true },
  { key: 'AUTOFIX_DEPS_DIRS', group: '路径', label: '依赖目录', default: 'client', restart: true },
  { key: 'AUTOFIX_WT_COPY', group: '路径', label: '复制到 worktree 的本地文件', default: 'client/.env.local', restart: true },

  { key: 'AUTOFIX_MR_TARGET', group: '运行', label: 'MR 目标分支', default: 'main', restart: true },
  { key: 'AUTOFIX_AGENT_TIMEOUT', group: '运行', label: 'Agent 超时（秒）', default: '1200', restart: true },
  { key: 'AUTOFIX_NET_TIMEOUT', group: '运行', label: '网络操作超时（秒）', default: '60', restart: true },
  { key: 'AUTOFIX_SYNC_START', group: '运行', label: '同步开始小时', default: '9', restart: true },
  { key: 'AUTOFIX_SYNC_END', group: '运行', label: '同步结束小时', default: '21', restart: true },
  { key: 'AUTOFIX_TZ', group: '运行', label: '时区', default: 'Asia/Shanghai', restart: true },
  { key: 'AUTOFIX_SYNC_MODEL', group: '运行', label: '同步 / 回写模型', default: 'claude-haiku-5-5', restart: true },
  { key: 'AUTOFIX_DESIGN_MODEL', group: '运行', label: '设计模型', default: 'claude-opus-5-5', restart: true },
  { key: 'AUTOFIX_STOP_MATCH', group: '运行', label: '停止进程匹配规则', default: 'autofix/app/scripts/run\\.sh|autofix-e2e[^/]*/.*run\\.sh', restart: false },
  { key: 'AUTOFIX_STOP_TIMEOUT', group: '运行', label: '停止等待秒数', default: '10', restart: false }
];

const SCHEMA_BY_KEY = new Map(CONFIG_SCHEMA.map((item) => [item.key, item]));

export function isSensitiveKey(key, value = '') {
  const text = String(value).trim();
  if (/(?:^|_)(?:TOKEN|SECRET|PASSWORD|PASSWD|PWD|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY|CREDENTIALS?|AUTH|COOKIE|SESSION)(?:$|_)/i.test(key)) {
    return true;
  }
  if (/(?:^|_)(?:DATABASE|REDIS|MONGO|MYSQL|POSTGRES|PG|AMQP|BROKER)_?(?:URL|URI|DSN)$/i.test(key)) {
    return true;
  }
  if (/(?:^|_)(?:URL|URI|DSN)$/i.test(key) && /(?:token|key|secret|password|passwd|auth)=/i.test(String(value))) {
    return true;
  }
  if (/^[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/i.test(text)) return true;
  if (/^(?:gh[pousr]_|glpat-|sk-|xox[baprs]-|AKIA|eyJ[A-Za-z0-9_-]+\.)/.test(text)) return true;
  if (/^-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) return true;
  return /^[A-Za-z0-9+/=_-]{32,}$/.test(text) && /[A-Za-z]/.test(text) && /\d/.test(text);
}

function stripInlineComment(value) {
  let quote = '';
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (quote) {
      if (char === quote && value[i - 1] !== '\\') quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '#' && (i === 0 || /\s/.test(value[i - 1]))) return value.slice(0, i);
  }
  return value;
}

export function expandHome(value, home = os.homedir()) {
  let result = value;
  if (result === '~' || result.startsWith('~/')) result = path.join(home, result.slice(1));
  result = result.replace(/\$\{HOME\}/g, home).replace(/\$HOME/g, home);
  return result;
}

export function parseDotenv(text, home = os.homedir()) {
  const result = new Map();
  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = rawLine.trimStart();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    let value = stripInlineComment(rawValue).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result.set(key, expandHome(value, home));
  }
  return result;
}

function quoteEnvValue(value) {
  if (!/[\s#"'\\]/.test(value)) return value;
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function loadConsoleConfig({
  home = os.homedir(),
  env = process.env,
  rootDir = CONSOLE_ROOT
} = {}) {
  const appDir = path.join(home, 'autofix', 'app');
  const envFile = env.AUTOFIX_ENV && env.AUTOFIX_ENV.trim()
    ? expandHome(env.AUTOFIX_ENV, home)
    : path.join(appDir, '.env');
  let envText = '';
  let envExists = false;
  try {
    envText = fs.readFileSync(envFile, 'utf8');
    envExists = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const fileValues = parseDotenv(envText, home);
  const sources = new Map();
  const rawValues = new Map();

  for (const item of CONFIG_SCHEMA) {
    let source = 'default';
    let value = expandHome(String(item.default ?? ''), home);
    if (fileValues.has(item.key)) {
      source = 'env';
      value = fileValues.get(item.key);
    }
    if (env[item.key] !== undefined && env[item.key] !== '') {
      source = 'environment';
      value = expandHome(String(env[item.key]), home);
    }
    sources.set(item.key, source);
    rawValues.set(item.key, value);
  }
  for (const [key, value] of fileValues) {
    if (SCHEMA_BY_KEY.has(key)) continue;
    sources.set(key, 'env');
    rawValues.set(key, value);
  }

  const value = (key, fallback = '') => rawValues.get(key) ?? fallback;
  const mainRepo = value('AUTOFIX_MAIN', path.join(home, '01', 'hbp-editor'));
  const skillDir = env.AUTOFIX_SKILL_DIR
    ? expandHome(env.AUTOFIX_SKILL_DIR, home)
    : path.join(mainRepo, '.claude', 'skills', 'loop-autofix');
  const launchAgentsDir = path.join(home, 'Library', 'LaunchAgents');
  const runsDir = value('AUTOFIX_HOME', path.join(home, 'autofix', 'runs'));
  const repoDir = value('AUTOFIX_REPO', path.join(home, 'autofix', 'worktree'));
  const port = Number(env.AUTOFIX_CONSOLE_PORT || 4177);

  return {
    home,
    rootDir,
    loadOptions: { home, env, rootDir },
    appDir,
    runsDir,
    repoDir,
    mainRepo,
    skillDir,
    launchAgentsDir,
    envFile,
    envExists,
    dataDir: path.join(rootDir, '.data'),
    bindHost: '127.0.0.1',
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 4177,
    values: rawValues,
    sources,
    entries: buildPublicEntries(rawValues, sources)
  };
}

export function buildPublicEntries(rawValues, sources) {
  const entries = CONFIG_SCHEMA.map((item) => {
    const raw = rawValues.get(item.key) ?? '';
    const sensitive = item.sensitive || isSensitiveKey(item.key);
    return {
      key: item.key,
      group: item.group,
      label: item.label,
      help: item.help ?? '',
      restart: item.restart !== false,
      sensitive,
      source: sources.get(item.key) ?? 'default',
      configured: item.sensitive || isSensitiveKey(item.key) ? Boolean(raw) : true,
      value: sensitive ? null : raw,
      display: sensitive ? (raw ? '已配置' : '未配置') : raw,
      editable: sources.get(item.key) !== 'environment',
      displayOnly: false
    };
  });
  for (const [key, raw] of rawValues) {
    if (SCHEMA_BY_KEY.has(key)) continue;
    const sensitive = isSensitiveKey(key, raw);
    entries.push({
      key,
      group: '其他 .env',
      label: key,
      help: '未列入控制台白名单；只读展示，不会写入或回传明文敏感值。',
      restart: false,
      sensitive,
      source: sources.get(key) ?? 'env',
      configured: sensitive ? Boolean(raw) : true,
      value: sensitive ? null : raw,
      display: sensitive ? (raw ? '已脱敏' : '未配置') : raw,
      editable: false,
      displayOnly: true
    });
  }
  return entries;
}

export async function saveEnvUpdates(config, updates, now = new Date()) {
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    throw Object.assign(new Error('配置更新必须是对象'), { statusCode: 400 });
  }
  const changed = [];
  for (const [key, rawValue] of Object.entries(updates)) {
    const item = SCHEMA_BY_KEY.get(key);
    if (!item) throw Object.assign(new Error(`不支持的配置项：${key}`), { statusCode: 400 });
    if (config.sources.get(key) === 'environment') {
      throw Object.assign(new Error(`${key} 由环境变量覆盖，不能通过控制台修改`), { statusCode: 409 });
    }
    if (rawValue === '__KEEP__') continue;
    if (typeof rawValue !== 'string') {
      throw Object.assign(new Error(`${key} 的值必须是字符串`), { statusCode: 400 });
    }
    changed.push([key, rawValue]);
  }
  if (changed.length === 0) return { changed: [], backupPath: null };

  let original = '';
  try {
    original = await fsp.readFile(config.envFile, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const lines = original ? original.replace(/\n$/, '').split(/\r?\n/) : [];
  const pending = new Map(changed);
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=/);
    if (!match || !pending.has(match[1])) continue;
    const key = match[1];
    lines[i] = `${key}=${quoteEnvValue(pending.get(key))}`;
    pending.delete(key);
  }
  for (const [key, value] of pending) lines.push(`${key}=${quoteEnvValue(value)}`);

  await fsp.mkdir(path.dirname(config.envFile), { recursive: true });
  let backupPath = null;
  if (original) {
    const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    backupPath = `${config.envFile}.${stamp}.bak`;
    await fsp.copyFile(config.envFile, backupPath);
  }
  const tempPath = `${config.envFile}.tmp-${process.pid}-${Date.now()}`;
  await fsp.writeFile(tempPath, `${lines.join('\n')}\n`, { mode: 0o600 });
  await fsp.rename(tempPath, config.envFile);
  return { changed: changed.map(([key]) => key), backupPath };
}

export function getSchemaItem(key) {
  return SCHEMA_BY_KEY.get(key) ?? null;
}
