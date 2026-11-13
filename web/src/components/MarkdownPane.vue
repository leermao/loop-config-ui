<script setup>
import { computed } from 'vue';

import { renderMarkdown } from '../lib/markdown.js';

const props = defineProps({
  text: { type: String, default: '' }
});

const html = computed(() => renderMarkdown(props.text));
</script>

<template>
  <article class="markdown" v-html="html"></article>
</template>

<style scoped>
.markdown {
  max-width: 900px;
  color: var(--ink-soft);
  line-height: 1.75;
}

.markdown :deep(h2),
.markdown :deep(h3),
.markdown :deep(h4),
.markdown :deep(h5) {
  margin: 1.4em 0 0.5em;
  color: var(--ink);
}

.markdown :deep(h2:first-child),
.markdown :deep(h3:first-child) {
  margin-top: 0;
}

.markdown :deep(p) {
  margin: 0 0 0.85em;
}

.markdown :deep(ul),
.markdown :deep(ol) {
  padding-left: 1.4em;
  margin: 0.5em 0 1em;
}

.markdown :deep(li) {
  margin-bottom: 0.28em;
}

.markdown :deep(blockquote) {
  padding: 9px 14px;
  margin: 1em 0;
  border-left: 3px solid var(--brass);
  background: var(--brass-light);
  color: var(--ink-soft);
}

.markdown :deep(code) {
  padding: 1px 5px;
  border: 1px solid var(--line);
  border-radius: 3px;
  background: var(--paper-deep);
  color: var(--signal-dark);
  font-size: 0.88em;
}

.markdown :deep(pre) {
  overflow: auto;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--ink);
  color: #e8ece8;
  line-height: 1.55;
}

.markdown :deep(pre code) {
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font-size: 12px;
}
</style>
