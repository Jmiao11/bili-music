<script setup lang="ts">
import { onUnmounted } from "vue";
import type { LibrarySnapshot } from "../library-state.ts";
import { displayThumbnailUrl } from "../track-utils.ts";

const props = defineProps<{
  kind: "delete" | "loudness" | "purge";
  busy: boolean;
  primaryLabel?: string;
  unavailable: NonNullable<LibrarySnapshot["session"]["data"]["unavailable"]>;
  locations: ReadonlyMap<string, string>;
  favorites: LibrarySnapshot["favorites"];
  playlists: LibrarySnapshot["playlists"];
  onClose: () => void;
  onSubmitDelete: () => void;
  onSubmitPurge: () => void;
}>();
let active = true;
onUnmounted(() => { active = false; });
function close() { if (active) props.onClose(); }
function submit() { if (active) (props.kind === "delete" ? props.onSubmitDelete : props.onSubmitPurge)(); }
const rows = (() => {
  const snapshots = new Map<string, LibrarySnapshot["favorites"][number]>();
  for (const track of props.favorites) snapshots.set(track.bvid.toLowerCase(), track);
  for (const playlist of props.playlists) for (const track of playlist.items ?? []) {
    const key = track.bvid.toLowerCase();
    if (!snapshots.has(key)) snapshots.set(key, track);
  }
  return props.unavailable.map(item => {
    const key = item.bvid.toLowerCase(), snapshot = snapshots.get(key);
    return { bvid: item.bvid, title: snapshot?.title || item.bvid, thumbnail: snapshot?.thumbnailUrl, reason: item.reason, location: props.locations.get(key) ?? "" };
  });
})();
</script>

<template>
  <template v-if="kind === 'delete'">
    <p class="library-confirm-copy">这个操作会移除歌单和其中的条目，之后需要重新创建。</p>
    <div class="library-modal-actions"><button type="button" class="small-button quiet" @click="close">取消</button><button type="button" class="secondary-button danger-action" :disabled="busy" @click="submit">{{ primaryLabel || '删除' }}</button></div>
  </template>
  <template v-else-if="kind === 'loudness'">
    <p class="library-confirm-copy">不同 UP 主上传的音源响度差别很大，切歌时忽大忽小。开启后，播放器会把音量补偿到接近的水平。</p>
    <p class="library-confirm-copy"><strong>需要先测量。</strong>每首歌播放约 30 秒后会自动在后台测量一次，测完才会生效，下次再听就是直接生效的。所以刚开启时你会觉得没什么变化，听一段时间后效果才明显。</p>
    <p class="library-confirm-copy"><strong>只会调小，不会调大。</strong>受浏览器限制只能衰减，整体音量会略低于原先，把系统音量推高一档即可。</p>
    <p class="library-confirm-copy">测量需要重新下载一遍音频，会消耗一些流量。</p>
    <div class="library-modal-actions"><button type="button" class="secondary-button" :disabled="busy" @click="close">{{ primaryLabel || '知道了' }}</button></div>
  </template>
  <template v-else>
    <p v-if="!rows.length" class="library-empty-copy">没有失效曲目。</p>
    <template v-else>
      <div class="unavailable-purge-list"><div v-for="row in rows" :key="row.bvid" class="unavailable-purge-item"><span class="unavailable-purge-cover"><img v-if="row.thumbnail" :src="displayThumbnailUrl(row.thumbnail)" alt="" :loading.prop="'lazy'" :referrerPolicy.prop="'no-referrer'"><span v-else class="cover-placeholder"></span></span><span class="unavailable-purge-copy"><strong>{{ row.title }}</strong><span class="unavailable-purge-reason">{{ row.reason }}</span><span class="unavailable-purge-location">{{ row.location }}</span></span></div></div>
      <div class="library-modal-actions"><button type="button" class="small-button quiet" @click="close">取消</button><button type="button" class="secondary-button" :disabled="busy" @click="submit">{{ primaryLabel || '全部清理' }}</button></div>
    </template>
  </template>
</template>
