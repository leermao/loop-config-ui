const PRIORITY_LABELS = {
  1: '紧急',
  2: '高',
  3: '中',
  4: '低',
  5: '普通'
};

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.floor(seconds);
  if (total < 60) return `${total} 秒`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
}

export function formatBytes(value) {
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDateTime(value, { seconds = false } = {}) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
    hour12: false
  }).format(date);
}

export function formatClock(value = new Date(), withSeconds = true) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' } : {}),
    hour12: false
  }).format(date);
}

export function formatRelative(value) {
  if (!value) return '还没有';
  const date = new Date(value);
  const delta = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (!Number.isFinite(delta)) return '—';
  if (delta < 45) return '刚刚';
  if (delta < 3600) return `${Math.floor(delta / 60)} 分钟前`;
  if (delta < 86400) return `${Math.floor(delta / 3600)} 小时前`;
  return `${Math.floor(delta / 86400)} 天前`;
}

export function priorityLabel(rank) {
  return PRIORITY_LABELS[Number(rank)] || (rank ? `P${rank}` : '普通');
}

export function stageLabel(stage) {
  return stage || '等待任务';
}

export function eventTone(message) {
  if (/❌|⛔|失败|异常|错误|error|fatal/i.test(message)) return 'danger';
  if (/⚠|blocked|halt|暂停|不一致|未加载/i.test(message)) return 'warn';
  if (/✅|完成|成功|已修复|已合并|同步完成/i.test(message)) return 'success';
  return 'neutral';
}

export function parseEventLine(line) {
  const match = String(line).match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s+(.*)$/);
  return {
    time: match?.[1] || '',
    message: match?.[2] || String(line)
  };
}

export function taskSourceLabel(source) {
  return {
    current: '当前任务',
    queue: '队列',
    manual: '人工跟进'
  }[source] || source;
}

export function sourceLabel(source) {
  return {
    environment: '环境变量',
    env: '.env',
    default: '默认值'
  }[source] || source;
}

export function artifactLabel(name) {
  const fixed = {
    'task.json': '原始数据',
    '00-缺陷详情.md': '缺陷详情',
    'design.md': '设计方案',
    'codex.md': '修复输出',
    'test.log': '测试日志',
    'diff.patch': 'Diff',
    'review.md': 'Review',
    'comment.md': '云效评论',
    err: '错误与结算',
    'yunxiao.out': '云效回写',
    base: '基线提交',
    start: '开始时间',
    stashed: '已存 Stash',
    keep: '人工跟进',
    same: '同一提交',
    'prev.patch': '历史修复',
    'branch.patch': '分支提交',
    'main-sync.log': 'main 同步'
  };
  if (fixed[name]) return fixed[name];
  if (name.endsWith('-prompt.md')) return 'Prompt';
  return name;
}

export function isImage(name) {
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(name);
}

export function isPdf(name) {
  return /\.pdf$/i.test(name);
}

export function isMarkdown(name) {
  return /\.md$/i.test(name);
}
