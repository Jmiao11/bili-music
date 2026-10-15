<script setup lang="ts">
import type { LyricsDisplaySnapshot } from "../lyrics-display-state.ts";
import type { PlaybackCallbacks } from "../root-playback.ts";
defineProps<{ model: LyricsDisplaySnapshot; callbacks: PlaybackCallbacks }>();
</script>
<template>
<div class="lyrics-pane">
            <div id="lyrics-match" class="lyrics-match" :hidden="model.matchHidden" :class="{ 'is-idle': model.idle }" >
              <p id="lyrics-match-hint" class="lyrics-match-hint" :hidden="model.hintHidden" >{{ model.hint }}</p>
              <div id="lyrics-candidates" class="lyrics-candidates" :hidden="model.candidatesHidden" ><button v-for="(candidate, index) in model.candidates" :key="index" type="button" class="lyrics-candidate" @click="callbacks.bindLyrics(candidate)">{{ candidate.singer ? `${candidate.name} - ${candidate.singer}` : candidate.name }}</button><button v-if="model.rejectCandidate" type="button" class="lyrics-candidate lyrics-candidate-none" @click="callbacks.rejectLyrics()">都不是</button></div>
              <div class="lyrics-match-actions">
                <button id="lyrics-match-manual" class="small-button quiet" type="button">手动匹配</button>
                <button id="lyrics-match-rematch" class="small-button quiet" type="button">重新匹配</button>
              </div>
              <div id="lyrics-manual-row" class="lyrics-manual-row" :hidden="model.manualHidden" >
                <input id="lyrics-manual-input" type="text" placeholder="搜索歌名手动匹配，如：晴天 周杰伦" />
                <button id="lyrics-manual-search" class="small-button" type="button" :disabled="model.manualBusy" >{{ model.manualBusy ? '搜索中…' : '搜索' }}</button>
              </div>
              <div id="lyrics-manual-results" class="lyrics-manual-results" :hidden="model.resultsHidden" ><p v-if="model.resultMessage !== null" class="lyrics-manual-empty">{{ model.resultMessage }}</p><button v-for="(candidate, index) in model.results" :key="index" type="button" class="lyrics-manual-result" @click="callbacks.bindManualLyrics(candidate)"><span>{{ candidate.name }}</span><span v-if="candidate.metadata" class="lyrics-manual-result-meta">{{ candidate.metadata }}</span></button></div>
            </div>

            <div class="immersive-lyrics" :class="{ 'has-lyrics': model.lines.length > 0 }" aria-label="歌词">
              <div id="lyrics-lines" class="lyrics-lines" :class="{ 'mode-full': model.full }" ><p v-for="(line, index) in model.lines" :key="`${model.generation}:${index}`" class="lyrics-line" :class="{ 'is-active': model.activeIndex === index }" :data-index="index">{{ line.text }}</p></div>
              <p id="lyrics-placeholder" class="lyrics-placeholder">{{ model.placeholder }}</p>
            </div>
          </div>

          <div class="lyrics-controls" aria-label="歌词控制">
            <span class="lyrics-controls-label">歌词校准</span>
            <button id="lyrics-offset-minus" class="small-button quiet" type="button" aria-label="歌词提前 0.5 秒">−0.5s</button>
            <span id="lyrics-offset-value" class="lyrics-offset-value">{{ model.offset }}</span>
            <button id="lyrics-offset-plus" class="small-button quiet" type="button" aria-label="歌词延后 0.5 秒">+0.5s</button>
            <button id="lyrics-mode-toggle" class="small-button quiet" type="button">{{ model.full ? '同步' : '全文' }}</button>
          </div>
</template>
