<script setup>
defineProps({
  tone: { type: String, default: 'neutral' },
  label: { type: String, default: '' },
  showLabel: { type: Boolean, default: true }
});
</script>

<template>
  <span class="status-lamp" :class="`tone-${tone}`">
    <span class="lamp" aria-hidden="true"></span>
    <span v-if="showLabel && label" class="lamp-label">{{ label }}</span>
  </span>
</template>

<style scoped>
.status-lamp {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.lamp {
  position: relative;
  flex: 0 0 auto;
  width: 9px;
  height: 9px;
  border: 1px solid currentColor;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 13%, transparent);
}

.lamp-label {
  overflow: hidden;
  font-size: 12px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tone-running {
  color: var(--copper);
}

.tone-running .lamp::after {
  position: absolute;
  inset: -4px;
  border: 1px solid currentColor;
  border-radius: 50%;
  content: "";
  animation: signal 2.6s ease-out infinite;
}

.tone-warn {
  color: var(--brass);
}

.tone-danger {
  color: var(--danger);
}

.tone-neutral {
  color: var(--ink-muted);
}

@keyframes signal {
  0% {
    opacity: 0.7;
    transform: scale(0.65);
  }
  75%,
  100% {
    opacity: 0;
    transform: scale(1.5);
  }
}
</style>
