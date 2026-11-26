<script setup lang="ts">
import LibraryCover from "../../library/components/LibraryCover.vue";
import Icon from "../../../app/components/Icon.vue";
import type { PageCallbacks } from "../../../app/root-controls.ts";
import type { HomeSnapshot } from "../../../store/app-state.ts";
import type { RecentSnapshot } from "../../recent/recent-state.ts";
import type { TrackListModel } from "../../tracks/root-lists.ts";
import type { mainWindowRefs } from "../../../platform/main-window-refs.ts";
import { displayThumbnailUrl } from "../../../shared/track-utils.ts";
import { formatHomeUpdatedAt, homeFeeds } from "../home-view.ts";
import type { HomeFeed } from "../home-view.ts";
import HomeFeedCover from "./HomeFeedCover.vue";

const props = defineProps<{ home: HomeSnapshot; items: RecentSnapshot["items"]; day: number; list: TrackListModel | null; callbacks: PageCallbacks; focusRefs: Pick<typeof mainWindowRefs, "homeFeedBack" | "homeFeedCardOpen"> }>();
const sources = Object.keys(homeFeeds) as HomeFeed[];

function feedItems(source: HomeFeed) {
  return source === "ai" ? props.home.recommendations : props.home[source];
}

function detailsLabel(source: HomeFeed, failed = false): string {
  const ai = source === "ai";
  const time = formatHomeUpdatedAt(ai ? props.home.generatedAt : props.home.feed[source].fetchedAt, props.day);
  const count = failed ? "更新失败" : `${feedItems(source).length} 首`;
  return time ? `${count} · ${ai ? "生成于" : "更新于"} ${time}` : count;
}

function badge(source: HomeFeed) {
  return source === "ai" ? "AI 生成" : source === "forYou" ? "根据你的收听" : undefined;
}

function seedLabel(): string {
  return "根据" + props.home.forYouSeeds.map(seed => `《${seed.title}》`).join("") + "推荐";
}

function activateCard(event: MouseEvent): void {
  if (!(event.target instanceof Element)) return;
  const tile = event.target.closest<HTMLElement>("[data-feed]");
  const source = tile?.dataset.feed;
  if (source !== "ai" && source !== "ranking" && source !== "newSongs" && source !== "forYou") return;
  if (event.target.closest(".home-feed-play")) {
    props.callbacks.playFeed(source);
    return;
  }
  props.callbacks.openFeed(source);
}
</script>

<template>
  <div v-if="home.view.section === null" class="home-discovery">
    <div class="home-feed-grid" @click="activateCard">
      <article v-for="source in sources.filter(source => (source !== 'ai' || home.aiHasKey === true) && (source !== 'forYou' || home.forYouAvailable))" :key="source" class="home-feed-card" :data-feed="source" :aria-busy="source === 'ai' ? home.recommendationLoading : home.feed[source].busy">
        <div v-if="source !== 'ai' && home.feed[source].busy && !home[source].length" class="home-feed-skeleton" role="status">
          <span class="sr-only">正在加载{{ homeFeeds[source].title }}…</span>
        </div>
        <template v-else>
          <button :ref="node => focusRefs.homeFeedCardOpen(source, node as HTMLButtonElement | null)" class="home-feed-open" type="button" :aria-label="`打开${homeFeeds[source].title}`">
            <HomeFeedCover :title="homeFeeds[source].title" :thumbnail="feedItems(source)[0]?.thumbnailUrl ?? ''" :badge="badge(source)" />
            <span class="home-feed-label">
              <strong>{{ homeFeeds[source].title }}</strong>
              <span>{{ source === 'ai' ? (home.generatedAt ? detailsLabel(source) : '点击生成') : home[source].length ? detailsLabel(source, Boolean(home.feed[source].notice)) : '暂无内容 · 点击查看' }}</span>
            </span>
          </button>
          <button v-if="feedItems(source).length" class="home-feed-play" type="button" :aria-label="`播放${homeFeeds[source].title}`">
            <Icon name="play" :size="18" />
          </button>
        </template>
      </article>
    </div>

    <section v-if="items.length" class="home-recent" aria-labelledby="home-recent-title">
      <header class="home-recent-head">
        <h2 id="home-recent-title">最近播放</h2>
        <button class="home-text-button" type="button" @click="callbacks.openRecent">查看全部 ›</button>
      </header>
      <ul class="home-recent-items">
        <li v-for="(item, index) in items.slice(0, 10)" :key="item.bvid">
          <button type="button" :title="item.title" class="home-recent-item" @click="callbacks.playRecent(index)">
            <span class="home-recent-cover"><img v-if="item.thumbnailUrl" :src="displayThumbnailUrl(item.thumbnailUrl)" alt="" loading="lazy" referrerpolicy="no-referrer" /><span class="recent-play-hint" aria-hidden="true"><Icon name="play" :size="14" /></span></span>
            <span class="home-recent-track">{{ item.title }}</span>
            <span class="home-recent-uploader">{{ item.uploader }}</span>
          </button>
        </li>
      </ul>
    </section>

    <p v-if="!home.aiHasKey" id="home-setup-hint" class="home-discovery-setup">配置 API Key 后，这里还会出现 AI 生成的专属推荐 · <button id="home-setup-settings" type="button" class="home-text-button" @click="callbacks.setup">去设置</button></p>
  </div>

  <section v-else class="home-feed-detail" :data-feed="home.view.section" aria-labelledby="home-feed-title">
    <button :ref="node => focusRefs.homeFeedBack(node as HTMLButtonElement | null)" class="home-feed-back secondary-button" type="button" @click="callbacks.openFeed(null)">‹ 发现音乐</button>
    <header class="home-feed-head">
      <div v-if="home.view.section === 'ai'" class="ai-section-cover">
        <HomeFeedCover title="AI 推荐" :thumbnail="home.recommendations[0]?.thumbnailUrl ?? ''" badge="AI 生成" />
        <LibraryCover v-if="list" :rows="list.rows" tone="green" :shown="true" />
      </div>
      <HomeFeedCover v-else :title="homeFeeds[home.view.section].title" :thumbnail="feedItems(home.view.section)[0]?.thumbnailUrl ?? ''" :badge="badge(home.view.section)" />
      <div class="home-feed-copy">
        <p>栏目 · {{ homeFeeds[home.view.section].source }}</p>
        <h1 id="home-feed-title">{{ homeFeeds[home.view.section].title }}</h1>
        <p>{{ detailsLabel(home.view.section) }}</p>
        <p v-if="home.view.section === 'forYou' && home.forYouSeeds.length" class="home-feed-seeds" :title="seedLabel()">{{ seedLabel() }}</p>
        <p v-if="home.view.section === 'ai' && home.description" class="home-feed-seeds" :title="home.description">描述：{{ home.description }}</p>
        <div class="home-feed-actions">
          <button class="primary-cta" type="button" :disabled="!feedItems(home.view.section).length" @click="callbacks.playFeed(home.view.section)"><Icon name="play" :size="14" />播放全部</button>
          <button v-if="home.view.section !== 'ai'" class="secondary-button" type="button" :disabled="home.cooling || home.feed[home.view.section].busy" :title="home.cooling ? '刚刚更新，请稍后再试' : undefined" @click="callbacks.retryFeed(home.view.section)">刷新</button>
        </div>
        <slot v-if="home.view.section === 'ai'" name="ai-feedback" />
        <div v-else class="home-feed-feedback" role="status" aria-live="polite">
          <span v-if="home.feed[home.view.section].busy">正在{{ home[home.view.section].length ? '刷新' : '加载' }}{{ homeFeeds[home.view.section].title }}…</span>
          <button v-else-if="home.feed[home.view.section].notice" class="home-text-button" type="button" :disabled="home.feed[home.view.section].restricted && home.cooling" @click="callbacks.retryFeed(home.view.section)">{{ home.feed[home.view.section].notice }}</button>
        </div>
      </div>
    </header>
    <slot v-if="home.view.section === 'ai'" name="ai-input" />
    <slot :list="list" :source="home.view.section" />
  </section>
</template>
