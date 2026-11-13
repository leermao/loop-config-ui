<script setup>
import { computed } from 'vue';

import { notify } from '../stores/console.js';

const props = defineProps({
  report: { type: Object, default: null },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' }
});

const emit = defineEmits(['refresh']);

const statusText = {
  ok: '正常',
  warn: '注意',
  error: '缺失'
};

const grouped = computed(() => {
  const items = props.report?.items ?? [];
  return [
    { id: 'error', label: '需要处理', items: items.filter((item) => item.status === 'error') },
    { id: 'warn', label: '建议检查', items: items.filter((item) => item.status === 'warn') },
    { id: 'ok', label: '已就绪', items: items.filter((item) => item.status === 'ok') }
  ].filter((group) => group.items.length);
});

async function copyFix(command) {
  await navigator.clipboard.writeText(command);
  notify('修复命令已复制', 'success');
}
</script>

<template>
<section class="doctor panel">
  <div class="doctor-head">
    <div>
      <p class="eyebrow">Environment doctor</p>
      <h2>环境诊断</h2>
    </div>
    <div class="doctor-head-right">
      <div v-if="report" class="doctor-summary">
        <span class="badge badge-success">{{ report.summary.ok }} 正常</span>
        <span class="badge badge-warn">{{ report.summary.warn }} 注意</span>
        <span class="badge badge-danger">{{ report.summary.error }} 缺失</span>
      </div>
      <button class="button button-small" type="button" :disabled="loading" @click="emit('refresh')">
        {{ loading ? '检查中…' : '重新检查' }}
      </button>
    </div>
  </div>

  <p v-if="error" class="doctor-error">{{ error }}</p>
  <div v-else-if="loading && !report" class="doctor-loading">正在探测命令、路径、配置和版本…</div>
  <template v-else-if="report">
    <div v-for="group in grouped" :key="group.id" class="doctor-group">
      <h3>{{ group.label }}</h3>
      <div class="doctor-grid">
        <article v-for="item in group.items" :key="item.id" class="doctor-item" :class="`status-${item.status}`">
          <div class="doctor-item-head">
            <strong>{{ item.label }}</strong>
            <span class="badge" :class="`badge-${item.status === 'error' ? 'danger' : item.status === 'warn' ? 'warn' : 'success'}`">
              {{ statusText[item.status] }}
            </span>
          </div>
          <p class="doctor-detail">{{ item.detail || '—' }}</p>
          <div v-if="item.fix" class="doctor-fix">
            <code>{{ item.fix }}</code>
            <button class="button button-small button-quiet" type="button" @click="copyFix(item.fix)">复制</button>
          </div>
        </article>
      </div>
    </div>
    <footer class="doctor-foot">
      <span>node {{ report.environment?.node }}</span>
      <span>{{ report.environment?.platform }} / {{ report.environment?.arch }}</span>
      <span class="mono-small">{{ report.envFile }}</span>
    </footer>
  </template>
</section>
</template>

<style scoped>
.doctor {
  padding: 18px;
}

.doctor-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.doctor-head h2 {
  margin: 0;
}

.doctor-head-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.doctor-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.doctor-group + .doctor-group {
  margin-top: 18px;
}

.doctor-group h3 {
  padding-bottom: 6px;
  margin: 0 0 8px;
  border-bottom: 1px solid var(--line);
  color: var(--ink-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.doctor-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.doctor-item {
  padding: 10px 11px;
  border: 1px solid var(--line);
  border-left-width: 3px;
  border-radius: var(--radius);
  background: rgba(255, 255, 255, 0.26);
}

.doctor-item.status-ok {
  border-left-color: var(--copper);
}

.doctor-item.status-warn {
  border-left-color: var(--brass);
}

.doctor-item.status-error {
  border-left-color: var(--danger);
}

.doctor-item-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.doctor-detail {
  margin: 4px 0 0;
  overflow-wrap: anywhere;
  color: var(--ink-muted);
  font-family: var(--font-mono);
  font-size: 10.5px;
}

.doctor-fix {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 6px;
  padding-top: 7px;
  margin-top: 7px;
  border-top: 1px dashed var(--line);
}

.doctor-fix code {
  overflow-wrap: anywhere;
  color: var(--danger);
  font-size: 10.5px;
}

.doctor-error {
  padding: 10px;
  border: 1px solid rgba(161, 61, 61, 0.28);
  background: var(--danger-light);
  color: var(--danger);
}

.doctor-loading {
  padding: 30px;
  color: var(--ink-muted);
  text-align: center;
}

.doctor-foot {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding-top: 16px;
  margin-top: 18px;
  border-top: 1px solid var(--line);
  color: var(--ink-muted);
  font-size: 11px;
}

@media (max-width: 760px) {
  .doctor-head {
    flex-direction: column;
  }

  .doctor-head-right {
    width: 100%;
    justify-content: space-between;
  }

  .doctor-grid {
    grid-template-columns: 1fr;
  }
}
</style>
