<script setup lang="ts">
import type { ApplicationSnapshot } from "../application-store.ts";
import type { PlaybackCallbacks, PlaybackControls } from "../root-playback.ts";
import { projectPlaybackProgress } from "../playback-display-view.ts";
const props = defineProps<{ display: ApplicationSnapshot["playbackDisplay"]; settings: ApplicationSnapshot["playbackSettings"]; controls: PlaybackControls; callbacks: PlaybackCallbacks; status: string }>();
const timeline = () => projectPlaybackProgress(props.display);
const playing = () => props.display.view.buttonVersion ? String(props.display.buttonPlaying) : undefined;
</script>
<template>
<footer id="result" class="player-bar panel" aria-label="当前播放">
      <div class="now-playing">
        <button id="open-immersive-button" class="cover-button" type="button" aria-label="打开沉浸播放页" @click="callbacks.openImmersive()" >
          <img id="thumbnail" alt="视频封面" width="54" height="54" referrerpolicy="no-referrer"  :src="display.presentation.thumbnailSet ? display.renderedTrack.thumbnailUrl : undefined" />
        </button>
        <div class="track-copy">
          <strong id="title">{{ display.renderedTrack.title }}</strong>
          <span id="uploader">{{ display.renderedTrack.uploader }}</span>
        </div>
      </div>

      <div class="transport-area">
        <div class="transport-controls" aria-label="播放控制">
          <button id="loop-mode-button" class="mode-button icon-mode" type="button" :data-loop-mode="controls.loopMode" :title="controls.loopLabel ?? undefined" :aria-label="controls.loopLabel ?? undefined" :class="{ 'is-active': controls.loopActive }" @click="callbacks.loop()" >
            <svg class="icon-repeat" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h8.6l-2.3-2.3 1.4-1.4L19.4 8l-4.7 4.7-1.4-1.4L15.6 9H7a3 3 0 0 0-3 3v1H2v-1a5 5 0 0 1 5-5Zm10 10H8.4l2.3 2.3-1.4 1.4L4.6 16l4.7-4.7 1.4 1.4L8.4 15H17a3 3 0 0 0 3-3v-1h2v1a5 5 0 0 1-5 5Z" /></svg>
            <svg class="icon-repeat-one" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h10.6l-2.3-2.3 1.4-1.4L21.4 6l-4.7 4.7-1.4-1.4L17.6 7H7a3 3 0 0 0-3 3v3H2v-3a5 5 0 0 1 5-5Zm10 14H6.4l2.3 2.3-1.4 1.4L2.6 18l4.7-4.7 1.4 1.4L6.4 17H17a3 3 0 0 0 3-3v-3h2v3a5 5 0 0 1-5 5ZM10 10l1-1h2v6h-2v-4h-1Z" /></svg>
          </button>
          <button id="previous-button" class="icon-button" type="button" aria-label="上一首" @click="callbacks.previous()" >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h2v14H6Zm3 7 9-7v14Z" /></svg>
          </button>
          <button id="play-pause-button" class="play-button" type="button" @click="callbacks.toggle()"  :data-playing="playing()" :aria-label="display.buttonPlaying ? '暂停' : '播放'" >
            <svg class="icon-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.6v12.8a1 1 0 0 0 1.53.85l9.6-6.4a1 1 0 0 0 0-1.7l-9.6-6.4A1 1 0 0 0 8 5.6Z" /></svg>
            <svg class="icon-pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /></svg>
          </button>
          <button id="next-button" class="icon-button" type="button" aria-label="下一首" @click="callbacks.next()" >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 5h2v14h-2ZM15 12 6 5v14Z" /></svg>
          </button>
          <label class="shuffle-control" aria-label="随机播放">
            <input id="shuffle-toggle" type="checkbox"  :checked="controls.shuffle" @change="callbacks.shuffle(($event.target as HTMLInputElement).checked)" />
            <span title="随机播放">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.6 4H21v3.4h-2V7.2l-4.1 4.1-1.4-1.4L17.4 6H17.6ZM3 7h3.1c1.5 0 2.9.6 3.9 1.7l1 1.1-1.4 1.4-1-1.1A3.4 3.4 0 0 0 6.1 9H3Zm13.6 10H17.4l-3.9-3.9 1.4-1.4 4.1 4.1V14h2v3.4H17.6ZM3 15h3.1c1 0 1.9-.4 2.5-1.1l7-7 1.4 1.4-7 7A5.4 5.4 0 0 1 6.1 17H3Z" /></svg>
            </span>
          </label>
        </div>

        <div class="timeline">
          <span id="current-time">{{ timeline().currentTime }}</span>
          <input id="progress-slider" type="range" min="0" step="0.01" aria-label="播放进度"  :max="timeline().max" :value="timeline().value" :style="timeline().styled ? { '--progress': timeline().progress } : undefined" @pointerdown="callbacks.seekStart()" @input="callbacks.preview(($event.target as HTMLInputElement).value)" @change="callbacks.seek(($event.target as HTMLInputElement).value)" />
          <span id="duration">{{ timeline().duration }}</span>
        </div>
      </div>

      <div class="right-tools">
        <span class="player-pages-group" :hidden="controls.pagesHidden">
          <button id="player-pages-button" class="page-count-badge player-pages-button" type="button" title="查看分P" :hidden="controls.pagesHidden" :aria-label="controls.pagesLabel" @click="callbacks.pages()" >{{ controls.pagesText }}</button>
          <button id="skip-video-button" class="player-skip-video-button" type="button" title="跳过本次合集" aria-label="跳过本次合集，播放下一首" @click="callbacks.skip()" >
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 6l7 6-7 6zM11 6l7 6-7 6zM18 6h2v12h-2z" /></svg>
          </button>
        </span>
        <span id="queue-position" class="queue-position">{{ controls.queuePosition }}</span>
        <button id="open-bilibili-bar-button" class="tool-button" type="button" aria-label="在 B站打开" @click="callbacks.openVideo()" :disabled="!display.currentTrack.bvid" >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3h7v7h-2V6.4l-8.3 8.3-1.4-1.4L17.6 5H14ZM5 5h6v2H5v12h12v-6h2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" /></svg>
        </button>
        <button id="favorite-current-button" class="tool-button favorite-current-button" type="button" aria-label="收藏当前歌曲" :disabled="controls.favoriteDisabled" :data-favorite-bvid="controls.bvid" :class="{ 'is-favorited': controls.favorited }" :title="controls.favorited ? '取消收藏当前歌曲' : '收藏当前歌曲'" @click="callbacks.favorite()" >{{ controls.favorited ? '♥' : '♡' }}</button>
        <button id="add-playlist-current-button" class="tool-button" type="button" aria-label="加入歌单" title="加入歌单" @click="callbacks.addPlaylist()" :disabled="controls.favoriteDisabled" >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6Z" /></svg>
        </button>
        <label class="volume-control" aria-label="音量">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9Zm12.5 6.5a5 5 0 0 0 0-7l1.4-1.4a7 7 0 0 1 0 9.8Z" /></svg>
          <input id="volume-slider" type="range" min="0" max="1" step="0.01"  :value="settings.userVolume" :style="settings.view.volumeVersion ? { '--progress': `${settings.userVolume * 100}%` } : undefined" @input="callbacks.volume(($event.target as HTMLInputElement).value)" />
        </label>
      </div>

      <p id="status" class="player-status" role="status">{{ status }}</p>

    </footer>
</template>
