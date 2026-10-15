<script setup lang="ts">
import LyricsDisplay from "./LyricsDisplay.vue";
import type { ApplicationSnapshot } from "../application-store.ts";
import type { PlaybackCallbacks, PlaybackControls } from "../root-playback.ts";
import { projectPlaybackProgress } from "../playback-display-view.ts";
const props = defineProps<{ display: ApplicationSnapshot["playbackDisplay"]; controls: PlaybackControls; lyrics: ApplicationSnapshot["lyricsDisplay"]; callbacks: PlaybackCallbacks }>();
const timeline = () => projectPlaybackProgress(props.display);
const playing = () => props.display.view.buttonVersion ? String(props.display.buttonPlaying) : undefined;
</script>
<template>
<section id="immersive-player" class="immersive-player" aria-label="沉浸播放页" :hidden="display.presentation.immersiveHidden" :class="{ 'is-open': display.presentation.immersiveOpen }" :aria-hidden="!display.presentation.immersiveOpen" @transitionend="callbacks.immersiveTransition($event)" @click="callbacks.immersiveBackdrop($event)" >
      <div class="immersive-backdrop" data-close-immersive="true"></div>
      <div class="immersive-sheet panel" role="dialog" aria-modal="true" aria-labelledby="immersive-title">
        <header class="immersive-header">
          <span>正在播放</span>
          <button id="close-immersive-button" class="small-button quiet" type="button" @click="callbacks.closeImmersive()" >收起</button>
        </header>

        <div class="immersive-content">
          <div class="immersive-art">
            <img id="immersive-cover" alt="当前歌曲封面" referrerpolicy="no-referrer"  :src="display.currentTrack.thumbnailUrl || undefined" />
            <img id="immersive-reflection" alt="" aria-hidden="true" referrerpolicy="no-referrer"  :src="display.currentTrack.thumbnailUrl || undefined" />
          </div>

          <div class="immersive-track">
            <h2 id="immersive-title">{{ display.currentTrack.title || '尚未播放' }}</h2>
            <p id="immersive-uploader">{{ display.currentTrack.uploader || '—' }}</p>
          </div>

          <LyricsDisplay :model="lyrics" :callbacks="callbacks" />

          <div class="immersive-controls">
            <div class="transport-controls" aria-label="沉浸播放控制">
              <button id="immersive-previous-button" class="icon-button" type="button" aria-label="上一首" @click="callbacks.previousImmersive()" >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h2v14H6Zm3 7 9-7v14Z" /></svg>
              </button>
              <button id="immersive-play-pause-button" class="play-button" type="button" @click="callbacks.toggleImmersive()"  :data-playing="playing()" :aria-label="display.buttonPlaying ? '暂停' : '播放'" >
                <svg class="icon-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.6v12.8a1 1 0 0 0 1.53.85l9.6-6.4a1 1 0 0 0 0-1.7l-9.6-6.4A1 1 0 0 0 8 5.6Z" /></svg>
                <svg class="icon-pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /></svg>
              </button>
              <button id="immersive-next-button" class="icon-button" type="button" aria-label="下一首" @click="callbacks.nextImmersive()" >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 5h2v14h-2ZM15 12 6 5v14Z" /></svg>
              </button>
            </div>

            <div class="timeline immersive-timeline">
              <span id="immersive-current-time">{{ timeline().currentTime }}</span>
              <input id="immersive-progress-slider" type="range" min="0" step="0.01" aria-label="沉浸播放进度"  :max="timeline().max" :value="timeline().value" :style="timeline().styled ? { '--progress': timeline().progress } : undefined" @pointerdown="callbacks.seekStart()" @input="callbacks.preview(($event.target as HTMLInputElement).value)" @change="callbacks.seek(($event.target as HTMLInputElement).value)" />
              <span id="immersive-duration">{{ timeline().duration }}</span>
            </div>

            <button id="open-bilibili-button" class="secondary-button" type="button" @click="callbacks.openVideo()" :disabled="!display.currentTrack.bvid" >在 B站打开</button>
            <button id="immersive-favorite-button" class="secondary-button favorite-current-button" type="button" aria-label="收藏当前歌曲" :disabled="controls.favoriteDisabled" :data-favorite-bvid="controls.bvid" :class="{ 'is-favorited': controls.favorited }" :title="controls.favorited ? '取消收藏当前歌曲' : '收藏当前歌曲'" @click="callbacks.favorite()" >{{ controls.favorited ? '♥ 已收藏' : '♡ 收藏' }}</button>
            <button id="immersive-add-playlist-button" class="secondary-button" type="button" @click="callbacks.addPlaylistImmersive()" >+ 加入歌单</button>
          </div>
        </div>
      </div>
    </section>
</template>
