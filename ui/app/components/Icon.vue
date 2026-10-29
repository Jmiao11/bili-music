<script setup lang="ts">
defineProps<{ name: keyof typeof paths; size?: number }>();
const paths = {
  bolt: "M13 2 4 14h7l-1 8 10-12h-7Z",
  play: "M8 5v14l11-7Z",
  pause: "M8 5v14M16 5v14",
  previous: "M5 5v14M19 5l-10 7 10 7Z",
  next: "M19 5v14M5 5l10 7-10 7Z",
  skip: "M3 6l8 6-8 6ZM11 6l8 6-8 6ZM21 6v12",
  shuffle: "M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5",
  repeat: "M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3",
  repeatOne: "M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3M10 10l2-1v6M10 15h4",
  heart: "M12 20S4 15 4 9a4 4 0 0 1 8-1 4 4 0 0 1 8 1c0 6-8 11-8 11Z",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  external: "M14 4h6v6M20 4l-9 9M18 14v5H5V6h5",
  volume: "M4 9v6h4l5 4V5L8 9ZM16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12",
  lyrics: "M4 7h10M4 12h16M4 17h12",
  chevronDown: "M6 9l6 6 6-6",
  check: "M5 12l4 4L19 6",
  grip: "M8 5h.01M16 5h.01M8 12h.01M16 12h.01M8 19h.01M16 19h.01",
};
</script>
<template>
  <svg class="ui-icon" :width="size ?? 16" :height="size ?? 16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path :d="paths[name]" /></svg>
</template>
