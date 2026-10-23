<script setup lang="ts">
import type { SidebarPresentation } from "../shell-stages.ts";
defineProps<{model:SidebarPresentation;currentView:string}>();
</script>
<template>
<aside id="sidebar" class="sidebar panel" aria-label="侧边栏">

        <nav class="side-nav" aria-label="主要区域">
          <span class="nav-group-label">音乐</span>
          <button class="nav-item" :class="{active:currentView === 'home'}" :aria-label="model.initialized ? '首页' : undefined" :title="model.initialized ? '首页' : undefined" type="button" data-view="home">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 11.4 12 4l8 7.4V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1Z" /></svg>
            <span>首页</span>
          </button>
          <button class="nav-item" :class="{active:currentView === 'search'}" :aria-label="model.initialized ? '搜索' : undefined" :title="model.initialized ? '搜索' : undefined" type="button" data-view="search">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m20.3 21.7-5.7-5.7a8 8 0 1 1 1.4-1.4l5.7 5.7ZM4 10a6 6 0 1 0 12 0A6 6 0 0 0 4 10Z" /></svg>
            <span>搜索</span>
          </button>
          <span class="nav-group-label">资料库</span>
          <button class="nav-item" :class="{active:currentView === 'favorites'}" :aria-label="model.initialized ? '我的收藏' : undefined" :title="model.initialized ? '我的收藏' : undefined" type="button" data-view="favorites">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 21.2 10.7 20C5.4 15.2 2 12.2 2 8.4A5.4 5.4 0 0 1 7.5 3c1.8 0 3.5.8 4.5 2.1A5.6 5.6 0 0 1 16.5 3 5.4 5.4 0 0 1 22 8.4c0 3.8-3.4 6.8-8.7 11.6Z" /></svg>
            <span>我的收藏</span>
          </button>
          <button class="nav-item" :class="{active:currentView === 'playlists'}" :aria-label="model.initialized ? '我的歌单' : undefined" :title="model.initialized ? '我的歌单' : undefined" type="button" data-view="playlists">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 6h10v2H4Zm0 5h10v2H4Zm0 5h7v2H4Zm13-3.2V5h2v7.1a3 3 0 1 1-2 .7Z" /></svg>
            <span>我的歌单</span>
          </button>
          <!-- 兼容节点：保留启动监听；本地音乐功能落地或批准重建 G0 时可删除。 -->
          <button class="nav-item" :class="{active:currentView === 'local'}" :aria-label="model.initialized ? '本地音乐' : undefined" :title="model.initialized ? '本地音乐' : undefined" type="button" data-view="local" style="display: none" tabindex="-1" aria-hidden="true">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm0 2v12h14V6Zm2 3h10v2H7Zm0 4h7v2H7Z" /></svg>
            <span>本地音乐</span>
            <small>待开发</small>
          </button>
        </nav>

        <div class="sidebar-foot">
          <button id="sidebar-toggle" class="nav-item" type="button" aria-controls="sidebar" :aria-expanded="!model.collapsed" :aria-label="model.collapsed ? '展开侧栏' : '收起侧栏'" :title="model.collapsed ? '展开侧栏' : '收起侧栏'">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v16H4Zm2 2v12h12V6Zm3 0h2v12H9Zm7 3-3 3 3 3 1.4-1.4-1.6-1.6 1.6-1.6Z" /></svg>
            <span>{{model.collapsed ? "展开侧栏" : "收起侧栏"}}</span>
          </button>
          <button id="open-settings-button" :aria-label="model.initialized ? '设置' : undefined" :title="model.initialized ? '设置' : undefined" class="nav-item" type="button">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M19.4 13.5a7.8 7.8 0 0 0 .1-1.5 7.8 7.8 0 0 0-.1-1.5l2-1.5-2-3.5-2.4 1a8 8 0 0 0-2.6-1.5L14 2h-4l-.4 3a8 8 0 0 0-2.6 1.5l-2.4-1-2 3.5 2 1.5a7.8 7.8 0 0 0-.1 1.5c0 .5 0 1 .1 1.5l-2 1.5 2 3.5 2.4-1a8 8 0 0 0 2.6 1.5l.4 3h4l.4-3a8 8 0 0 0 2.6-1.5l2.4 1 2-3.5ZM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z" /></svg>
            <span>设置</span>
          </button>
        </div>
        <div id="sidebar-resize" role="separator" aria-label="调整侧栏宽度" aria-orientation="vertical" aria-controls="sidebar" aria-valuemin="72" aria-valuemax="320" :aria-valuenow="String(model.width)" :aria-valuetext="model.initialized ? model.collapsed ? '已折叠，按右方向键展开' : model.width+' 像素' : undefined" tabindex="0"></div>
      </aside>
</template>
