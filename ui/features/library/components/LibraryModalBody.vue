<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import type { LibrarySnapshot } from "../library-state.ts";
import { displayThumbnailUrl } from "../../../shared/track-utils.ts";
import { libraryVideos } from "../library-entry.ts";

const props = defineProps<{
  kind: Exclude<LibrarySnapshot["session"]["kind"], "generic">;
  data: LibrarySnapshot["session"]["data"];
  busy: boolean;
  primaryLabel?: string;
  unavailable: NonNullable<LibrarySnapshot["session"]["data"]["unavailable"]>;
  locations: ReadonlyMap<string, string>;
  favorites: LibrarySnapshot["favorites"];
  playlists: LibrarySnapshot["playlists"];
  onName: (name: string) => void;
  onLink: (link: string) => void;
  onSubmitName: (name: string) => void;
  onSubmitChoose: (id: string) => void;
  onCreateAndAdd: (name: string) => void;
  onSubmitImport: (link: string, name: string) => void;
  onClose: () => void;
  onSubmitDelete: () => void;
  onSubmitPurge: () => void;
}>();
let active = true;
onUnmounted(() => { active = false; });
function close() { if (active) props.onClose(); }
const nameInput = ref<HTMLInputElement | null>(null), linkInput = ref<HTMLInputElement | null>(null), primary = ref<HTMLButtonElement | null>(null);
onMounted(() => { if (nameInput.value) nameInput.value.value = props.data.name ?? ""; });
watch(() => props.data.name, value => { if (nameInput.value && nameInput.value.value !== value) nameInput.value.value = value ?? ""; }, { flush: "sync" });
function inputName(event: Event) { if (active) props.onName((event.target as HTMLInputElement).value); }
function inputLink(event: Event) { if (active) props.onLink((event.target as HTMLInputElement).value); }
function enter(event: KeyboardEvent) { if (event.key === "Enter") { event.preventDefault(); primary.value?.click(); } }
function choose(id: string) { if (active) props.onSubmitChoose(id); }
function submit() {
  if (!active) return;
  const name = nameInput.value?.value ?? "";
  if (props.kind === "name") props.onSubmitName(name);
  else if (props.kind === "choose") props.onCreateAndAdd(name);
  else if (props.kind === "favoriteImport") props.onSubmitImport(linkInput.value?.value ?? "", name);
  else (props.kind === "delete" ? props.onSubmitDelete : props.onSubmitPurge)();
}
const choices = props.playlists.map(playlist => ({ id: playlist.id, name: playlist.name, count: playlist.items.length,
  alreadyIn: props.data.collectionChoose ? !props.data.collectionChoose.split && playlist.items.some(entry => entry.kind === "collection" && entry.collectionId === props.data.collectionChoose?.collection.collectionId)
    : libraryVideos(playlist.items).some(item => item.bvid.toLowerCase() === props.data.track?.bvid.toLowerCase()) }));
const nameLabel = props.data.mode === "rename" ? "保存" : props.data.track ? "新建并加入" : "创建";
const rows = (() => {
  const snapshots = new Map<string, ReturnType<typeof libraryVideos>[number]>();
  for (const track of libraryVideos(props.favorites)) snapshots.set(track.bvid.toLowerCase(), track);
  for (const playlist of props.playlists) for (const track of libraryVideos(playlist.items ?? [])) {
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
  <template v-else-if="kind === 'purge'">
    <p v-if="!rows.length" class="library-empty-copy">没有失效曲目。</p>
    <template v-else>
      <div class="unavailable-purge-list"><div v-for="row in rows" :key="row.bvid" class="unavailable-purge-item"><span class="unavailable-purge-cover"><img v-if="row.thumbnail" :src="displayThumbnailUrl(row.thumbnail)" alt="" :loading.prop="'lazy'" :referrerPolicy.prop="'no-referrer'"><span v-else class="cover-placeholder"></span></span><span class="unavailable-purge-copy"><strong>{{ row.title }}</strong><span class="unavailable-purge-reason">{{ row.reason }}</span><span class="unavailable-purge-location">{{ row.location }}</span></span></div></div>
      <div class="library-modal-actions"><button type="button" class="small-button quiet" @click="close">取消</button><button type="button" class="secondary-button" :disabled="busy" @click="submit">{{ primaryLabel || '全部清理' }}</button></div>
    </template>
  </template>
  <template v-else-if="kind === 'name'">
    <label class="library-name-field"><span>歌单名称</span><input ref="nameInput" type="text" maxlength="40" placeholder="输入歌单名称" @input="inputName" @keydown="enter"></label>
    <div class="library-modal-actions"><button type="button" class="small-button quiet" @click="close">取消</button><button ref="primary" type="button" class="secondary-button" :disabled="busy" @click="submit">{{ primaryLabel || nameLabel }}</button></div>
  </template>
  <template v-else-if="kind === 'favoriteImport'">
    <label class="library-name-field"><span>收藏夹链接</span><input ref="linkInput" type="text" maxlength="4096" placeholder="https://space.bilibili.com/…/favlist?fid=…" :disabled="!!data.linkDisabled" @input="inputLink" @keydown="enter"></label>
    <label class="library-name-field" :hidden="!data.nameVisible"><span>歌单名称</span><input ref="nameInput" type="text" maxlength="40" placeholder="输入歌单名称" :disabled="busy && !!data.firstPage" @input="inputName" @keydown="enter"></label>
    <div class="library-modal-actions"><button type="button" class="small-button quiet" @click="close">取消</button><button ref="primary" type="button" class="secondary-button" :disabled="busy" @click="submit">{{ primaryLabel || '读取收藏夹' }}</button></div>
  </template>
  <template v-else>
    <div class="playlist-picker"><p v-if="!choices.length" class="library-empty-copy">还没有歌单。先在下方新建一个，再把这首歌放进去。</p><template v-else><button v-for="playlist in choices" :key="playlist.id" type="button" :class="['playlist-choice', { 'is-added': playlist.alreadyIn }]" :aria-disabled="playlist.alreadyIn ? 'true' : undefined" @click="choose(playlist.id)"><span>{{ playlist.name }}</span><small>{{ playlist.alreadyIn ? '已添加 · ' : '' }}{{ playlist.count }} 首</small></button></template></div>
    <div class="library-divider">新建歌单</div>
    <label class="library-name-field"><span>歌单名称</span><input ref="nameInput" type="text" maxlength="40" placeholder="输入歌单名称" @input="inputName" @keydown="enter"></label>
    <div class="library-modal-actions"><button type="button" class="small-button quiet" @click="close">取消</button><button ref="primary" type="button" class="secondary-button" :disabled="busy" @click="submit">{{ primaryLabel || '新建并加入' }}</button></div>
  </template>
</template>
