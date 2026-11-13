<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import VChart from 'vue-echarts';
import { Activity, ChartColumn, Radio, TriangleAlert } from '@lucide/vue';

import { eventTone, formatClock, parseEventLine, priorityLabel } from '../lib/format.js';

const props = defineProps({
  logLines: { type: Array, default: () => [] },
  queue: { type: Array, default: () => [] },
  healthCards: { type: Array, default: () => [] },
  generatedAt: { type: String, default: '' },
  connection: { type: String, default: 'connecting' }
});

const BUCKET_MS = 30 * 60 * 1000;
const BUCKET_COUNT = 12;
const PRIORITY_COLORS = ['#a13d3d', '#d65a34', '#b2802d', '#2f7565', '#69736d'];
const TEXT_MUTED = '#5b6560';
const TEXT_INK = '#1c2724';
const GRID_LINE = 'rgba(28, 39, 36, 0.12)';
const reducedMotion = ref(false);
let motionQuery = null;

function syncMotionPreference(event) {
  reducedMotion.value = event.matches;
}

onMounted(() => {
  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  reducedMotion.value = motionQuery.matches;
  motionQuery.addEventListener('change', syncMotionPreference);
});

onBeforeUnmount(() => {
  motionQuery?.removeEventListener('change', syncMotionPreference);
});

const parsedEvents = computed(() => props.logLines.map((line) => {
  const event = parseEventLine(line);
  const timestamp = event.time ? new Date(event.time.replace(' ', 'T')).getTime() : Number.NaN;
  return {
    ...event,
    timestamp,
    tone: eventTone(event.message)
  };
}).filter((event) => Number.isFinite(event.timestamp)));

const latestTimestamp = computed(() => parsedEvents.value.reduce(
  (latest, event) => Math.max(latest, event.timestamp),
  0
));

const rangeEnd = computed(() => {
  const anchor = latestTimestamp.value || Date.now();
  return Math.floor(anchor / BUCKET_MS) * BUCKET_MS + BUCKET_MS;
});

const rangeStart = computed(() => rangeEnd.value - BUCKET_MS * BUCKET_COUNT);

const buckets = computed(() => {
  const result = Array.from({ length: BUCKET_COUNT }, (_, index) => ({
    timestamp: rangeStart.value + index * BUCKET_MS,
    total: 0,
    attention: 0,
    success: 0
  }));
  for (const event of parsedEvents.value) {
    if (event.timestamp < rangeStart.value || event.timestamp >= rangeEnd.value) continue;
    const index = Math.floor((event.timestamp - rangeStart.value) / BUCKET_MS);
    const bucket = result[index];
    if (!bucket) continue;
    bucket.total += 1;
    if (event.tone === 'warn' || event.tone === 'danger') bucket.attention += 1;
    if (event.tone === 'success') bucket.success += 1;
  }
  return result;
});

const activityTotal = computed(() => buckets.value.reduce((total, bucket) => total + bucket.total, 0));
const attentionCount = computed(() => buckets.value.reduce((total, bucket) => total + bucket.attention, 0));
const successCount = computed(() => buckets.value.reduce((total, bucket) => total + bucket.success, 0));
const hasActivity = computed(() => parsedEvents.value.length > 0);

const windowLabel = computed(() => {
  const start = new Date(rangeStart.value);
  const end = new Date(rangeEnd.value);
  return `${formatClock(start, false)}–${formatClock(end, false)}`;
});

const healthReadyCount = computed(() => props.healthCards.filter(
  (card) => card.tone !== 'warn' && card.tone !== 'danger'
).length);

const urgentCount = computed(() => props.queue.filter(
  (item) => Number(item.priorityRank) <= 2
).length);

const priorityCounts = computed(() => [1, 2, 3, 4, 5].map((rank) => (
  props.queue.filter((item) => (Number(item.priorityRank) || 5) === rank).length
)));

const axisLabels = computed(() => buckets.value.map(
  (bucket) => formatClock(new Date(bucket.timestamp), false)
));

const activityOption = computed(() => ({
  animationDuration: reducedMotion.value ? 0 : 760,
  animationDurationUpdate: reducedMotion.value ? 0 : 420,
  animationEasing: 'cubicOut',
  animationEasingUpdate: 'cubicOut',
  aria: {
    enabled: true,
    label: {
      description: `最近 6 小时事件趋势：${activityTotal.value} 个事件，其中 ${attentionCount.value} 个需关注，${successCount.value} 个已完成。`
    }
  },
  color: ['#d65a34', '#a13d3d'],
  grid: { top: 38, right: 12, bottom: 22, left: 8, containLabel: true },
  legend: {
    top: 2,
    right: 4,
    itemWidth: 14,
    itemHeight: 3,
    textStyle: { color: TEXT_MUTED, fontSize: 10 },
    data: ['全部事件', '需关注']
  },
  tooltip: {
    trigger: 'axis',
    backgroundColor: '#1c2724',
    borderColor: 'rgba(255, 255, 255, 0.14)',
    padding: [8, 10],
    textStyle: { color: '#f8f6ef', fontSize: 12 },
    axisPointer: { type: 'line', lineStyle: { color: 'rgba(214, 90, 52, 0.45)' } }
  },
  xAxis: {
    type: 'category',
    boundaryGap: false,
    data: axisLabels.value,
    axisLine: { lineStyle: { color: GRID_LINE } },
    axisTick: { show: false },
    axisLabel: {
      color: TEXT_MUTED,
      fontFamily: 'SFMono-Regular, Menlo, monospace',
    fontSize: 10,
      interval: 1
    }
  },
  yAxis: {
    type: 'value',
    minInterval: 1,
    splitNumber: 3,
    axisLabel: {
      color: TEXT_MUTED,
      fontFamily: 'SFMono-Regular, Menlo, monospace',
      fontSize: 10
    },
    splitLine: { lineStyle: { color: GRID_LINE, type: 'dashed' } }
  },
  series: [
    {
      name: '全部事件',
      type: 'line',
      smooth: 0.35,
      symbol: 'circle',
      symbolSize: 4,
      showSymbol: false,
      data: buckets.value.map((bucket) => bucket.total),
      lineStyle: { width: 2 },
      itemStyle: { color: '#d65a34' },
      areaStyle: {
        color: {
          type: 'linear',
          x: 0,
          y: 0,
          x2: 0,
          y2: 1,
          colorStops: [
            { offset: 0, color: 'rgba(214, 90, 52, 0.25)' },
            { offset: 1, color: 'rgba(214, 90, 52, 0.01)' }
          ]
        }
      }
    },
    {
      name: '需关注',
      type: 'line',
      smooth: 0.25,
      symbol: 'diamond',
      symbolSize: 5,
      data: buckets.value.map((bucket) => bucket.attention),
      lineStyle: { width: 1.5, type: 'dashed' },
      itemStyle: { color: '#a13d3d' }
    }
  ]
}));

const priorityOption = computed(() => ({
  animationDuration: reducedMotion.value ? 0 : 620,
  animationDelay: (index) => reducedMotion.value ? 0 : index * 55,
  animationEasing: 'cubicOut',
  aria: {
    enabled: true,
    label: {
      description: `队列优先级分布：${[1, 2, 3, 4, 5].map((rank, index) => `${priorityLabel(rank)} ${priorityCounts.value[index]} 条`).join('，')}。`
    }
  },
  grid: { top: 8, right: 24, bottom: 6, left: 4, containLabel: true },
  tooltip: {
    trigger: 'axis',
    axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(28, 39, 36, 0.04)' } },
    backgroundColor: '#1c2724',
    borderColor: 'rgba(255, 255, 255, 0.14)',
    padding: [8, 10],
    textStyle: { color: '#f8f6ef', fontSize: 12 },
    formatter: (params) => {
      const item = params[0];
      return `${item.name}<br/><strong>${item.value}</strong> 条待处理`;
    }
  },
  xAxis: {
    type: 'value',
    minInterval: 1,
    splitNumber: 3,
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { show: false },
    splitLine: { lineStyle: { color: GRID_LINE, type: 'dashed' } }
  },
  yAxis: {
    type: 'category',
    inverse: true,
    data: [1, 2, 3, 4, 5].map((rank) => priorityLabel(rank)),
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: TEXT_INK, fontSize: 11, fontWeight: 600 }
  },
  series: [{
    type: 'bar',
    barWidth: 11,
    showBackground: true,
    backgroundStyle: { color: 'rgba(28, 39, 36, 0.055)', borderRadius: 2 },
    label: {
      show: true,
      position: 'right',
      color: TEXT_MUTED,
      fontFamily: 'SFMono-Regular, Menlo, monospace',
      fontSize: 10,
      formatter: ({ value }) => value ? String(value) : ''
    },
    data: priorityCounts.value.map((value, index) => ({
      value,
      itemStyle: {
        color: PRIORITY_COLORS[index],
        borderRadius: [0, 2, 2, 0]
      }
    }))
  }]
}));
</script>

<template>
  <section class="telemetry panel" aria-labelledby="telemetry-title">
    <header class="telemetry-head">
      <div class="telemetry-title">
        <span class="telemetry-icon" aria-hidden="true"><Activity :size="18" :stroke-width="1.7" /></span>
        <div>
          <p class="eyebrow">Operations telemetry</p>
          <h2 id="telemetry-title">运行遥测</h2>
        </div>
      </div>
      <div class="telemetry-meta">
        <span class="live-mark" :class="{ paused: connection !== 'live' }">
          <Radio :size="12" aria-hidden="true" />
          {{ connection === 'live' ? 'LIVE DATA' : 'SNAPSHOT' }}
        </span>
        <span class="mono-small">{{ generatedAt ? `采样 ${formatClock(generatedAt)}` : '等待采样' }}</span>
      </div>
    </header>

    <div class="telemetry-grid">
      <article class="chart-card activity-card">
        <header class="chart-head">
          <div>
            <span class="chart-kicker">Event pulse / 6h</span>
            <strong><span :key="activityTotal" class="chart-metric-value">{{ activityTotal }}</span> <small>个事件</small></strong>
          </div>
          <div class="chart-stats">
            <span><i class="stat-dot success"></i>{{ successCount }} 完成</span>
            <span><i class="stat-dot alert"></i>{{ attentionCount }} 需关注</span>
          </div>
        </header>
        <p class="chart-caption">
          日志时间聚合 · {{ windowLabel }}
          <span v-if="hasActivity && attentionCount"> · 异常以虚线单独标记</span>
        </p>
        <div class="chart-shell">
          <VChart
            v-if="hasActivity"
            class="telemetry-chart activity-chart"
            :option="activityOption"
            autoresize
            aria-label="最近日志事件量及需关注事件趋势"
          />
          <div v-else class="chart-empty">
            <Activity :size="24" :stroke-width="1.4" aria-hidden="true" />
            <strong>等待日志脉冲</strong>
            <span>流水线产生带时间戳的事件后，这里会自动形成趋势。</span>
          </div>
        </div>
      </article>

      <article class="chart-card queue-chart-card">
        <header class="chart-head">
          <div>
            <span class="chart-kicker">Queue pressure</span>
            <strong><span :key="queue.length" class="chart-metric-value">{{ queue.length }}</span> <small>条待处理</small></strong>
          </div>
          <span class="badge" :class="urgentCount ? 'badge-danger' : 'badge-success'">
            {{ urgentCount ? `${urgentCount} 条紧急/高` : '无高优积压' }}
          </span>
        </header>
        <div class="chart-shell queue-chart-shell">
          <VChart
            v-if="queue.length"
            class="telemetry-chart priority-chart"
            :option="priorityOption"
            autoresize
            aria-label="队列按优先级分布"
          />
          <div v-else class="chart-empty compact">
            <ChartColumn :size="22" :stroke-width="1.4" aria-hidden="true" />
            <strong>队列为空</strong>
            <span>暂无待处理的缺陷任务。</span>
          </div>
        </div>
      </article>
    </div>

    <footer class="telemetry-foot">
      <span>
        <TriangleAlert :size="12" aria-hidden="true" />
        数据来自最近日志与当前队列，不做客户端推演
      </span>
      <span class="mono-small">HEALTH {{ healthReadyCount }}/{{ healthCards.length || 5 }}</span>
    </footer>
  </section>
</template>

<style scoped>
.telemetry {
  overflow: hidden;
  padding: 20px 22px 15px;
  background:
    linear-gradient(120deg, rgba(47, 117, 101, 0.055), transparent 34%),
    rgba(248, 246, 239, 0.94);
}

.telemetry::after {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 230px;
  height: 78px;
  background: repeating-linear-gradient(
    -45deg,
    transparent,
    transparent 7px,
    rgba(28, 39, 36, 0.026) 7px,
    rgba(28, 39, 36, 0.026) 8px
  );
  content: "";
  pointer-events: none;
}

.telemetry-head,
.telemetry-foot,
.chart-head,
.telemetry-title,
.telemetry-meta,
.chart-stats,
.telemetry-foot > span {
  display: flex;
  align-items: center;
}

.telemetry-head {
  position: relative;
  z-index: 1;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--line);
}

.telemetry-title {
  gap: 10px;
}

.telemetry-title h2 {
  margin: 0;
  font-size: 22px;
}

.telemetry-title .eyebrow {
  margin-bottom: 1px;
}

.telemetry-icon {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border: 1px solid rgba(214, 90, 52, 0.28);
  border-radius: var(--radius-small);
  background: rgba(214, 90, 52, 0.075);
  color: var(--signal);
  box-shadow: inset 0 -2px 0 rgba(214, 90, 52, 0.24);
}

.telemetry-icon svg {
  animation: telemetry-scan 4.8s ease-in-out infinite;
}

.telemetry-meta {
  justify-content: flex-end;
  gap: 12px;
  color: var(--ink-muted);
}

.live-mark {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 7px;
  border: 1px solid rgba(47, 117, 101, 0.28);
  border-radius: var(--radius-small);
  background: rgba(47, 117, 101, 0.075);
  color: var(--copper-dark);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.live-mark.paused {
  border-color: rgba(178, 128, 45, 0.3);
  background: rgba(178, 128, 45, 0.08);
  color: var(--brass-dark);
}

.live-mark:not(.paused) svg {
  animation: live-tick 2.2s ease-in-out infinite;
}

.telemetry-grid {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: minmax(0, 1.65fr) minmax(270px, 0.75fr);
  gap: 16px;
  padding: 16px 0 14px;
}

.chart-card {
  min-width: 0;
  padding: 15px 16px 12px;
  border: 1px solid var(--line);
  border-top-color: var(--line-strong);
  border-radius: var(--radius);
  background:
    linear-gradient(rgba(28, 39, 36, 0.018) 1px, transparent 1px),
    linear-gradient(90deg, rgba(28, 39, 36, 0.018) 1px, transparent 1px),
    rgba(255, 255, 255, 0.3);
  background-size: 24px 24px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.52);
  animation: chart-enter 480ms cubic-bezier(0.22, 1, 0.36, 1) both;
  transition:
    border-color var(--transition),
    box-shadow var(--transition),
    transform var(--transition);
}

.chart-card:hover {
  border-color: var(--line-strong);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.58),
    0 8px 20px rgba(28, 39, 36, 0.055);
  transform: translateY(-2px);
}

.queue-chart-card {
  animation-delay: 70ms;
}

.chart-head {
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.chart-head > div:first-child {
  display: grid;
  gap: 2px;
}

.chart-kicker {
  color: var(--ink-muted);
  font-family: var(--font-mono);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.105em;
  text-transform: uppercase;
}

.chart-head strong {
  font-family: var(--font-display);
  font-size: 28px;
  line-height: 1;
}

.chart-head strong small {
  color: var(--ink-muted);
  font-family: var(--font-body);
  font-size: 11px;
  font-weight: 500;
}

.chart-metric-value {
  display: inline-block;
  animation: metric-tick 320ms cubic-bezier(0.22, 1, 0.36, 1);
}

.chart-stats {
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 4px 9px;
  color: var(--ink-muted);
  font-size: 10.5px;
}

.chart-stats span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}

.stat-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--copper);
}

.stat-dot.alert {
  background: var(--danger);
  animation: alert-glint 2.4s ease-in-out infinite;
}

.chart-caption {
  margin: 5px 0 0;
  color: var(--ink-muted);
  font-size: 10.5px;
}

.chart-shell {
  position: relative;
  min-height: 198px;
}

.telemetry-chart {
  width: 100%;
  height: 198px;
}

.priority-chart {
  height: 198px;
}

.chart-empty {
  display: grid;
  place-items: center;
  align-content: center;
  gap: 5px;
  min-height: 198px;
  color: var(--ink-muted);
  text-align: center;
}

.chart-empty svg {
  color: var(--signal);
  opacity: 0.72;
  animation: empty-float 3.4s ease-in-out infinite alternate;
}

.chart-empty strong {
  color: var(--ink-soft);
  font-family: var(--font-display);
  font-size: 16px;
}

.chart-empty span {
  max-width: 280px;
  font-size: 11px;
}

.chart-empty.compact {
  min-height: 198px;
}

.telemetry-foot {
  position: relative;
  z-index: 1;
  justify-content: space-between;
  gap: 12px;
  padding-top: 10px;
  border-top: 1px dashed var(--line);
  color: var(--ink-muted);
  font-size: 10.5px;
}

.telemetry-foot > span {
  gap: 5px;
}

@keyframes chart-enter {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes telemetry-scan {
  0%,
  100% {
    transform: translateX(0);
  }
  48%,
  56% {
    transform: translateX(2px);
  }
}

@keyframes live-tick {
  0%,
  100% {
    opacity: 0.55;
  }
  50% {
    opacity: 1;
  }
}

@keyframes metric-tick {
  from {
    opacity: 0.4;
    transform: translateY(-4px);
  }
}

@keyframes alert-glint {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(161, 61, 61, 0.3);
  }
  52% {
    box-shadow: 0 0 0 4px rgba(161, 61, 61, 0);
  }
}

@keyframes empty-float {
  from {
    transform: translateY(0);
  }
  to {
    transform: translateY(-4px);
  }
}

@media (max-width: 980px) {
  .telemetry-grid {
    grid-template-columns: 1fr;
  }

  .queue-chart-shell,
  .priority-chart {
    min-height: 176px;
    height: 176px;
  }
}

@media (max-width: 620px) {
  .telemetry {
    padding: 15px;
  }

  .telemetry-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .telemetry-meta {
    width: 100%;
    justify-content: space-between;
  }

  .chart-head {
    flex-direction: column;
  }

  .chart-stats {
    justify-content: flex-start;
  }

  .telemetry-foot {
    align-items: flex-start;
    flex-direction: column;
  }
}

@media (prefers-reduced-motion: reduce) {
  .chart-card,
  .chart-card:hover,
  .chart-empty svg,
  .chart-metric-value,
  .live-mark svg,
  .stat-dot.alert,
  .telemetry-icon svg {
    animation: none;
    transform: none;
  }
}
</style>
