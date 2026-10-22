<script setup lang="ts">
import Icon from "../../../app/components/Icon.vue";
import type {mainWindowRefs} from "../../../platform/main-window-refs.ts";
import type { ApplicationSnapshot } from "../../../store/application-store.ts";
import type { PlaybackCallbacks, PlaybackControls } from "../root-playback.ts";
import { projectPlaybackProgress } from "../playback-display-view.ts";
const props = defineProps<{mainWindowRefs:typeof mainWindowRefs; display: ApplicationSnapshot["playbackDisplay"]; settings: ApplicationSnapshot["playbackSettings"]; queue: ApplicationSnapshot["playbackQueue"]; controls: PlaybackControls; callbacks: PlaybackCallbacks; status: string }>();
const timeline = () => projectPlaybackProgress(props.display);
const entry = () => props.queue.queue[props.queue.currentIndex];
const group = () => entry()?.collection;
const videoTitle = () => {
  const collection = group();
  return collection ? collection.data.snapshot.items[collection.memberIndex]?.title ?? "" : entry()?.title ?? "";
};
const playing = () => props.display.view.buttonVersion ? String(props.display.buttonPlaying) : undefined;
</script>
<template>
<footer id="result" :ref="element => mainWindowRefs.result(element as HTMLElement|null)" class="player-bar panel" aria-label="当前播放">
      <div class="now-playing">
        <img id="thumbnail" alt="视频封面" width="40" height="40" referrerpolicy="no-referrer"  :src="display.presentation.thumbnailSet ? display.renderedTrack.thumbnailUrl : undefined" />
        <button id="open-immersive-button" class="tool-button player-immersive-button" type="button" aria-label="打开沉浸播放页" @click="callbacks.openImmersive()" >
          <Icon name="lyrics" />
        </button>
        <div class="track-copy">
          <strong id="title">{{ display.renderedTrack.title }}</strong>
          <span class="player-subtitle"><span id="uploader">{{ display.renderedTrack.uploader }}</span><span v-if="videoTitle() && videoTitle() !== display.renderedTrack.title" class="player-video-title"> · {{ videoTitle() }}</span></span>
        </div>
      </div>

      <div class="transport-area">
        <div class="transport-controls" aria-label="播放控制">
          <button id="loop-mode-button" class="mode-button icon-mode" type="button" :data-loop-mode="controls.loopMode" :title="controls.loopLabel ?? undefined" :aria-label="controls.loopLabel ?? undefined" :class="{ 'is-active': controls.loopActive }" @click="callbacks.loop()" >
            <Icon name="repeat" class="icon-repeat" />
            <Icon name="repeatOne" class="icon-repeat-one" />
          </button>
          <button id="previous-button" class="icon-button" type="button" aria-label="上一首" @click="callbacks.previous()" >
            <Icon name="previous" />
          </button>
          <button id="play-pause-button" :ref="element => mainWindowRefs.resumePlayPauseButton(element as HTMLButtonElement|null)" class="play-button" type="button" @click="callbacks.toggle()"  :data-playing="playing()" :aria-label="display.buttonPlaying ? '暂停' : '播放'" >
            <Icon name="play" class="icon-play" />
            <Icon name="pause" class="icon-pause" />
          </button>
          <button id="next-button" class="icon-button" type="button" aria-label="下一首" @click="callbacks.next()" >
            <Icon name="next" />
          </button>
          <label class="shuffle-control" aria-label="随机播放">
            <input id="shuffle-toggle" type="checkbox"  :checked="controls.shuffle" @change="callbacks.shuffle(($event.target as HTMLInputElement).checked)" />
            <span title="随机播放">
              <Icon name="shuffle" />
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
        <span class="player-pages-group" :hidden="controls.pagesHidden && !group()">
          <span v-if="group()" class="player-collection-position">合集 {{ group()!.memberIndex + 1 }}/{{ group()!.data.snapshot.items.length }}</span>
          <button id="player-pages-button" :ref="element => mainWindowRefs.playerPagesButton(element as HTMLButtonElement|null)" class="page-count-badge player-pages-button" type="button" title="查看分P" :hidden="controls.pagesHidden" :aria-label="controls.pagesLabel" @click="callbacks.pages()" >{{ controls.pagesText }}</button>
          <button id="skip-video-button" class="player-skip-video-button" type="button" title="跳过本次合集" aria-label="跳过本次合集，播放下一首" @click="callbacks.skip()" >
            <Icon name="skip" />
          </button>
        </span>
        <span id="queue-position" class="queue-position">{{ controls.queuePosition }}</span>
        <button id="open-bilibili-bar-button" class="tool-button" type="button" aria-label="在 B站打开" @click="callbacks.openVideo()" :disabled="!display.currentTrack.bvid" >
          <Icon name="external" />
        </button>
        <button id="favorite-current-button" class="tool-button favorite-current-button" type="button" aria-label="收藏当前歌曲" :disabled="controls.favoriteDisabled" :data-favorite-bvid="controls.bvid" :class="{ 'is-favorited': controls.favorited }" :title="controls.favorited ? '取消收藏当前歌曲' : '收藏当前歌曲'" @click="callbacks.favorite()" ><span class="sr-only" aria-hidden="true">{{ controls.favorited ? '♥' : '♡' }}</span><Icon name="heart" /></button>
        <button id="add-playlist-current-button" class="tool-button" type="button" aria-label="加入歌单" title="加入歌单" @click="callbacks.addPlaylist()" :disabled="controls.favoriteDisabled" >
          <Icon name="plus" />
        </button>
        <label class="volume-control" aria-label="音量">
          <Icon name="volume" />
          <input id="volume-slider" type="range" min="0" max="1" step="0.01"  :value="settings.userVolume" :style="settings.view.volumeVersion ? { '--progress': `${settings.userVolume * 100}%` } : undefined" @input="callbacks.volume(($event.target as HTMLInputElement).value)" />
        </label>
      </div>

      <p id="status" class="player-status" role="status">{{ status }}</p>

    </footer>
</template>
