<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  confirmLabel: { type: String, default: '确认' },
  cancelLabel: { type: String, default: '取消' },
  tone: { type: String, default: 'default' },
  requireText: { type: String, default: '' },
  busy: { type: Boolean, default: false }
});

const emit = defineEmits(['confirm', 'close']);
const typed = ref('');
const confirmButton = ref(null);
const canConfirm = computed(() => !props.requireText || typed.value === props.requireText);

watch(
  () => props.open,
  async (open) => {
    document.body.classList.toggle('dialog-open', open);
    if (!open) {
      typed.value = '';
      return;
    }
    await nextTick();
    confirmButton.value?.focus();
  }
);

function close() {
  if (props.busy) return;
  emit('close');
}

function confirm() {
  if (!canConfirm.value || props.busy) return;
  emit('confirm');
}

function onKeydown(event) {
  if (event.key === 'Escape' && props.open) close();
}

onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  document.body.classList.remove('dialog-open');
});
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div v-if="open" class="dialog-backdrop" @mousedown.self="close">
        <section
          class="dialog-card"
          :class="`tone-${tone}`"
          role="dialog"
          aria-modal="true"
          :aria-label="title"
          @keydown.stop
        >
          <header class="dialog-head">
            <div>
              <p class="eyebrow">Operation check</p>
              <h2>{{ title }}</h2>
            </div>
            <button class="dialog-x" type="button" aria-label="关闭" :disabled="busy" @click="close">×</button>
          </header>
          <p v-if="description" class="dialog-description">{{ description }}</p>
          <div class="dialog-body">
            <slot></slot>
          </div>
          <label v-if="requireText" class="confirm-text field">
            <span class="field-label">输入「{{ requireText }}」继续</span>
            <input v-model="typed" class="input" autocomplete="off" />
          </label>
          <footer class="dialog-actions">
            <button class="button button-quiet" type="button" :disabled="busy" @click="close">
              {{ cancelLabel }}
            </button>
            <button
              ref="confirmButton"
              class="button"
              :class="tone === 'danger' ? 'button-danger' : 'button-signal'"
              type="button"
              :disabled="!canConfirm || busy"
              @click="confirm"
            >
              {{ busy ? '执行中…' : confirmLabel }}
            </button>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.dialog-backdrop {
  position: fixed;
  z-index: 1000;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(20, 28, 26, 0.58);
  backdrop-filter: blur(4px);
}

.dialog-card {
  width: min(560px, 100%);
  max-height: min(86vh, 760px);
  overflow: auto;
  padding: 22px;
  border: 1px solid var(--line-strong);
  border-top: 4px solid var(--signal);
  border-radius: var(--radius);
  background: var(--paper-light);
  box-shadow: 0 30px 90px rgba(0, 0, 0, 0.32);
}

.dialog-card.tone-danger {
  border-top-color: var(--danger);
}

.dialog-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}

.dialog-head h2 {
  margin: 0;
  font-size: 26px;
}

.dialog-x {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 50%;
  background: transparent;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}

.dialog-description {
  margin: 14px 0;
  color: var(--ink-soft);
}

.dialog-body {
  margin: 16px 0;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 9px;
  padding-top: 16px;
  border-top: 1px solid var(--line);
}

.confirm-text {
  margin-top: 12px;
}

.dialog-enter-active,
.dialog-leave-active {
  transition: opacity 160ms ease;
}

.dialog-enter-active .dialog-card,
.dialog-leave-active .dialog-card {
  transition: transform 160ms ease;
}

.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;
}

.dialog-enter-from .dialog-card,
.dialog-leave-to .dialog-card {
  transform: translateY(10px) scale(0.985);
}
</style>
