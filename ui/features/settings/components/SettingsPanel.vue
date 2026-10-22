<script setup lang="ts">
import type {ComponentPublicInstance} from "vue";
import type {draftBindings} from "../../../platform/draft-ports.ts";
import type {ObjectDirective} from 'vue';
import {applySettingsField} from './field-directive.ts';
import type {SettingsControl,SettingsControls} from '../settings-controls.ts';
import type {SettingsSnapshot} from '../settings-state.ts';
import type {SettingsCallbacks} from '../root-settings.ts';
const props=defineProps<{draftBindings:typeof draftBindings;appearanceStatus:string;purgeBusy:boolean;state:SettingsSnapshot;model:SettingsControls;callbacks:SettingsCallbacks;normalization:boolean;normalizationVersion:number}>();
const empty:SettingsControl={};
const field=(name:string)=>props.model[name]??empty;
const vField:ObjectDirective<HTMLInputElement|HTMLSelectElement,SettingsControl>={mounted:(element,binding)=>applySettingsField(element,binding.value),updated:(element,binding)=>applySettingsField(element,binding.value,binding.oldValue ?? undefined)};
function draftRef(value:Element|ComponentPublicInstance|null):void {
 const input=value as HTMLInputElement|null;
 props.draftBindings.key(input ? {read:()=>input.value,write:value=>{input.value=value;}} : null);
}
function aiDetailsRef(value:Element|ComponentPublicInstance|null):void {
 const details=value as HTMLDetailsElement|null;
 props.draftBindings.aiDetails(details ? ()=>{details.open=true;} : null);
}
</script>
<template>
      <div class="settings-panel panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header class="settings-header">
          <div>
            <h2 id="settings-title">设置</h2>
            <p>主题、背景与音频设置</p>
          </div>
          <button id="close-settings-button" class="tool-button" type="button" aria-label="关闭设置">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4Z" /></svg>
          </button>
        </header>

        <section class="setting-group">
          <h3>主题</h3>
          <div class="theme-row" role="radiogroup" aria-label="主题">
            <button class="theme-option" type="button" data-theme-option="dark" :class="{ 'is-selected': field('theme:dark').selected }" :aria-checked="field('theme:dark').selected === undefined ? undefined : field('theme:dark').selected" @click="callbacks.theme('dark')">
              <span class="swatch swatch-dark"></span>
              深色
            </button>
            <button class="theme-option" type="button" data-theme-option="light" :class="{ 'is-selected': field('theme:light').selected }" :aria-checked="field('theme:light').selected === undefined ? undefined : field('theme:light').selected" @click="callbacks.theme('light')">
              <span class="swatch swatch-light"></span>
              浅色
            </button>
            <button class="theme-option" type="button" data-theme-option="image" :class="{ 'is-selected': field('theme:image').selected }" :aria-checked="field('theme:image').selected === undefined ? undefined : field('theme:image').selected" @click="callbacks.theme('image')">
              <span class="swatch swatch-image"></span>
              背景图
            </button>
            <button class="theme-option" type="button" data-theme-option="dynamic" :class="{ 'is-selected': field('theme:dynamic').selected }" :aria-checked="field('theme:dynamic').selected === undefined ? undefined : field('theme:dynamic').selected" @click="callbacks.theme('dynamic')">
              <span class="swatch swatch-dynamic"></span>
              动态
            </button>
          </div>
        </section>

        <section id="image-settings" class="setting-group image-only" :class="{ 'is-disabled': state.view.themeVersion > 0 && state.theme !== 'image' }">
          <h3>背景图</h3>
          <div class="setting-actions">
            <button id="choose-background-button" @click="callbacks.chooseBackground()" class="secondary-button" type="button" :disabled="field('chooseBackgroundButton').disabled ?? false">选择本地图片</button>
            <button id="reset-background-button" @click="callbacks.resetBackground()" class="small-button quiet" type="button">恢复默认</button>
          </div>
          <small id="background-name" :title="field('backgroundName').title ?? undefined">{{ field('backgroundName').text ?? "使用默认背景" }}</small>
        </section>

        <section id="texture-settings" class="setting-group image-only" :class="{ 'is-disabled': state.view.themeVersion > 0 && state.theme !== 'image' }">
          <h3>质感微调</h3>
          <label class="slider-row">
            <span>毛玻璃模糊 <output id="glass-blur-value">{{ field('glassBlurValue').text ?? "40px" }}</output></span>
            <input id="glass-blur-slider" @input="callbacks.slider('blur', ($event.target as HTMLInputElement).value)" v-field="field('glassBlurSlider')" type="range" min="0" max="80" value="40" />
          </label>
          <label class="slider-row">
            <span>面板不透明度 <output id="panel-alpha-value">{{ field('panelAlphaValue').text ?? "72%" }}</output></span>
            <input id="panel-alpha-slider" @input="callbacks.slider('alpha', ($event.target as HTMLInputElement).value)" v-field="field('panelAlphaSlider')" type="range" min="20" max="100" value="72" />
          </label>
          <label class="slider-row">
            <span>背景暗化 <output id="background-dim-value">{{ field('backgroundDimValue').text ?? "90%" }}</output></span>
            <input id="background-dim-slider" @input="callbacks.slider('dim', ($event.target as HTMLInputElement).value)" v-field="field('backgroundDimSlider')" type="range" min="40" max="95" value="90" />
          </label>
        </section>

        <details class="setting-group collapsible-group">
          <summary><h3>音频</h3></summary>
          <div class="setting-subgroup audio-source-section">
            <label class="select-row audio-source-row" for="stream-source-select">
              <span>音频获取方式</span>
              <select id="stream-source-select" @change="callbacks.source(($event.target as HTMLInputElement).value)" v-field="field('streamSourceSelect')" class="settings-select" :disabled="field('streamSourceSelect').disabled ?? false">
                <option value="guest" title="游客直连（免登录，推荐）">游客直连</option>
                <option value="auto" :disabled="field('autoSource').disabled" :title="field('autoSource').title ?? '自动（游客优先，失败用 yt-dlp 兜底）'">自动兜底</option>
              </select>
            </label>
            <small id="stream-source-status">{{ field('streamSourceStatus').text ?? "" }}</small>
            <small class="setting-note">决定从 B 站获取音频的方式。游客直连免登录、开箱即用；自动模式在获取失败时用 yt-dlp 兜底，需自备 yt-dlp.exe。</small>
          </div>
          <div class="setting-subgroup">
            <label class="checkbox-row" for="loudness-normalization-toggle">
              <input id="loudness-normalization-toggle" v-field="{checked:normalization,checkedVersion:normalizationVersion}" @change="callbacks.normalization(($event.target as HTMLInputElement).checked)" type="checkbox" aria-describedby="loudness-normalization-note" />
              响度归一化
            </label>
            <small id="loudness-normalization-note" class="setting-note">降低已测量歌曲之间的音量差异，不放大较轻的歌曲。未测量的歌曲保持原音量。</small>
          </div>
          <div class="setting-subgroup audio-cache-section">
            <label class="checkbox-row" for="audio-cache-enabled">
              <input id="audio-cache-enabled" @change="callbacks.cache()" v-field="field('audioCacheEnabled')" type="checkbox" aria-describedby="audio-cache-note" :disabled="field('audioCacheEnabled').disabled ?? true" />
              启用本地音频缓存
            </label>
            <small id="audio-cache-note" class="setting-note">缓存播放过的音频，可提升再次播放的速度和稳定性。缓存会占用磁盘空间，可随时清除。</small>
            <div class="audio-cache-details">
              <div class="audio-cache-row audio-cache-usage-row">
                <span>缓存占用</span>
                <small id="audio-cache-usage" class="setting-note audio-cache-usage">{{ field('audioCacheUsage').text ?? "读取中…" }}</small>
                <button id="clear-audio-cache-button" @click="callbacks.clearCache()" class="audio-cache-clear" type="button" :disabled="field('clearAudioCacheButton').disabled ?? false">清空缓存</button>
              </div>
              <label class="audio-cache-row" for="audio-cache-capacity">
                <span>缓存上限</span>
                <select id="audio-cache-capacity" @change="callbacks.cache()" v-field="field('audioCacheCapacity')" class="settings-select" :disabled="field('audioCacheCapacity').disabled ?? true">
                  <option value="536870912">512 MB</option>
                  <option value="1073741824">1 GB</option>
                  <option value="2147483648" selected>2 GB</option>
                  <option value="5368709120">5 GB</option>
                  <option value="10737418240">10 GB</option>
                </select>
              </label>
            </div>
            <small id="audio-cache-status" class="setting-note audio-cache-status" role="status" aria-live="polite">{{ field('audioCacheStatus').text ?? "" }}</small>
          </div>
          <div class="setting-subgroup shuffle-collection-section">
            <label class="shuffle-collection-row" for="shuffle-collection-order">
              <span>随机时合集内顺序</span>
              <select id="shuffle-collection-order" @change="callbacks.collection('order', ($event.target as HTMLInputElement).value)" v-field="field('shuffleCollectionOrder')" class="settings-select">
                <option value="random">随机</option>
                <option value="sequential">按原顺序</option>
              </select>
            </label>
            <label class="shuffle-collection-row" for="shuffle-collection-limit">
              <span>随机时每个合集播放</span>
              <select id="shuffle-collection-limit" @change="callbacks.collection('limit', ($event.target as HTMLInputElement).value)" v-field="field('shuffleCollectionLimit')" class="settings-select">
                <option value="all">全部</option>
                <option value="1">1 首</option>
                <option value="3">3 首</option>
                <option value="5">5 首</option>
                <option value="10">10 首</option>
              </select>
            </label>
            <small class="setting-note">开启随机播放时，遇到多P视频（合集）的播放方式。可随时点分P标识旁的跳过按钮跳过当前合集。</small>
          </div>
        </details>

        <details id="accent-color-settings" class="setting-group collapsible-group">
          <summary><h3>主题色</h3></summary>
          <div class="theme-row" role="radiogroup" aria-label="主题色">
            <label class="accent-option">
              <input class="sr-only" type="radio" name="accent-color" value="pink" data-accent-color v-field="field('accent:pink')" @change="callbacks.accent('pink')" checked />
                <span class="accent-dot" aria-hidden="true" :style="field('accent:pink').color ? {backgroundColor:field('accent:pink').color} : undefined"></span>
              <span>粉</span>
            </label>
            <label class="accent-option">
              <input class="sr-only" type="radio" name="accent-color" value="blue" data-accent-color v-field="field('accent:blue')" @change="callbacks.accent('blue')" />
                <span class="accent-dot" aria-hidden="true" :style="field('accent:blue').color ? {backgroundColor:field('accent:blue').color} : undefined"></span>
              <span>蓝</span>
            </label>
            <label class="accent-option">
              <input class="sr-only" type="radio" name="accent-color" value="purple" data-accent-color v-field="field('accent:purple')" @change="callbacks.accent('purple')" />
                <span class="accent-dot" aria-hidden="true" :style="field('accent:purple').color ? {backgroundColor:field('accent:purple').color} : undefined"></span>
              <span>紫</span>
            </label>
            <label class="accent-option">
              <input class="sr-only" type="radio" name="accent-color" value="green" data-accent-color v-field="field('accent:green')" @change="callbacks.accent('green')" />
                <span class="accent-dot" aria-hidden="true" :style="field('accent:green').color ? {backgroundColor:field('accent:green').color} : undefined"></span>
              <span>绿</span>
            </label>
            <label class="accent-option">
              <input class="sr-only" type="radio" name="accent-color" value="orange" data-accent-color v-field="field('accent:orange')" @change="callbacks.accent('orange')" />
                <span class="accent-dot" aria-hidden="true" :style="field('accent:orange').color ? {backgroundColor:field('accent:orange').color} : undefined"></span>
              <span>橙</span>
            </label>
            <label class="accent-option">
              <input class="sr-only" type="radio" name="accent-color" value="cyan" data-accent-color v-field="field('accent:cyan')" @change="callbacks.accent('cyan')" />
                <span class="accent-dot" aria-hidden="true" :style="field('accent:cyan').color ? {backgroundColor:field('accent:cyan').color} : undefined"></span>
              <span>青</span>
            </label>
          </div>
        </details>

        <details class="setting-group ai-settings collapsible-group" :ref="aiDetailsRef">
          <summary><h3>AI 推荐</h3></summary>
          <label class="settings-field" for="ai-api-format-select">
            <span>接口规范</span>
            <select id="ai-api-format-select" @change="callbacks.aiFormat()" v-field="field('aiApiFormatSelect')" class="settings-select">
              <option value="openai-chat-completions">OpenAI Chat Completions</option>
              <option value="openai-responses">OpenAI Responses</option>
              <option value="anthropic-messages">Anthropic Messages</option>
            </select>
          </label>
          <label class="settings-field" for="ai-model-input">
            <span>模型</span>
            <input id="ai-model-input" v-field="field('aiModelInput')" class="settings-input" type="text" autocomplete="off" placeholder="gpt-4o-mini" />
          </label>
          <label class="settings-field" for="ai-api-key-input">
            <span>API Key</span>
            <input id="ai-api-key-input" :ref="draftRef" class="settings-input" type="password" autocomplete="new-password" placeholder="留空则保留已保存的 key" />
          </label>
          <label class="settings-field" for="ai-base-url-input">
            <span>Base URL<span
                  class="ai-help-trigger"
                  tabindex="0"
                  role="button"
                  aria-label="Base URL 填写说明"
                  aria-describedby="ai-help-bubble">?<span
                    id="ai-help-bubble"
                    class="ai-help-bubble"
                    role="tooltip"><strong>规则</strong>
                    <ul>
                      <li>请填到服务商要求的版本段，例如 https://api.openai.com/v1</li>
                      <li>只追加所选规范的端点，不自动补 /v1</li>
                      <li>缺少协议头时补 https://，末尾的 / 会去掉</li>
                    </ul>
                    <strong>示例</strong>
                    <ul>
                      <li>OpenAI：https://api.openai.com/v1</li>
                      <li>智谱：open.bigmodel.cn/api/v1</li>
                      <li>智谱 Anthropic：open.bigmodel.cn/api/anthropic/v1</li>
                      <li>百炼：dashscope.aliyuncs.com/compatible-mode/v1</li>
                    </ul></span></span></span>
            <input id="ai-base-url-input" :placeholder="field('aiBaseUrlInput').placeholder ?? 'https://api.openai.com/v1'" v-field="field('aiBaseUrlInput')" class="settings-input" type="url" autocomplete="off" />
          </label>
          <small class="setting-note">鼠标悬浮 Base URL 旁的“?”可查看填写说明</small>
          <div class="setting-actions">
            <button id="save-ai-config-button" @click="callbacks.saveAi()" class="secondary-button" type="button" :disabled="field('saveAiConfigButton').disabled ?? false">保存 AI 配置</button>
            <button id="test-ai-connection-button" @click="callbacks.testAi()" class="small-button quiet" type="button" :disabled="field('testAiConnectionButton').disabled ?? false">测试连接</button>
          </div>
          <small id="ai-config-status">{{ field('aiConfigStatus').text ?? "尚未读取 AI 配置" }}</small>
        </details>

        <details class="setting-group collapsible-group">
          <summary><h3>快捷键</h3></summary>
          <div class="setting-subgroup shortcut-row">
            <h4>上一曲</h4>
            <div class="shortcut-binding-actions">
              <button class="secondary-button shortcut-record-button" type="button" data-shortcut-action="previous" :class="{ 'is-recording':field('shortcut:previous').selected }" @click="callbacks.shortcut('previous')">{{ field('shortcut:previous').text ?? '未设置' }}</button>
              <button class="small-button quiet" type="button" data-shortcut-clear="previous" @click="callbacks.clearShortcut('previous')">清除</button>
            </div>
          </div>
          <div class="setting-subgroup shortcut-row">
            <h4>播放/暂停</h4>
            <div class="shortcut-binding-actions">
              <button class="secondary-button shortcut-record-button" type="button" data-shortcut-action="playPause" :class="{ 'is-recording':field('shortcut:playPause').selected }" @click="callbacks.shortcut('playPause')">{{ field('shortcut:playPause').text ?? '未设置' }}</button>
              <button class="small-button quiet" type="button" data-shortcut-clear="playPause" @click="callbacks.clearShortcut('playPause')">清除</button>
            </div>
          </div>
          <div class="setting-subgroup shortcut-row">
            <h4>下一曲</h4>
            <div class="shortcut-binding-actions">
              <button class="secondary-button shortcut-record-button" type="button" data-shortcut-action="next" :class="{ 'is-recording':field('shortcut:next').selected }" @click="callbacks.shortcut('next')">{{ field('shortcut:next').text ?? '未设置' }}</button>
              <button class="small-button quiet" type="button" data-shortcut-clear="next" @click="callbacks.clearShortcut('next')">清除</button>
            </div>
          </div>
          <div class="setting-subgroup shortcut-row">
            <h4>音量增加</h4>
            <div class="shortcut-binding-actions">
              <button class="secondary-button shortcut-record-button" type="button" data-shortcut-action="volumeUp" :class="{ 'is-recording':field('shortcut:volumeUp').selected }" @click="callbacks.shortcut('volumeUp')">{{ field('shortcut:volumeUp').text ?? '未设置' }}</button>
              <button class="small-button quiet" type="button" data-shortcut-clear="volumeUp" @click="callbacks.clearShortcut('volumeUp')">清除</button>
            </div>
          </div>
          <div class="setting-subgroup shortcut-row">
            <h4>音量降低</h4>
            <div class="shortcut-binding-actions">
              <button class="secondary-button shortcut-record-button" type="button" data-shortcut-action="volumeDown" :class="{ 'is-recording':field('shortcut:volumeDown').selected }" @click="callbacks.shortcut('volumeDown')">{{ field('shortcut:volumeDown').text ?? '未设置' }}</button>
              <button class="small-button quiet" type="button" data-shortcut-clear="volumeDown" @click="callbacks.clearShortcut('volumeDown')">清除</button>
            </div>
          </div>
          <small class="setting-note">系统级快捷键在软件处于后台时也会生效，支持 Windows 与 macOS。</small>
        </details>

        <details class="setting-group collapsible-group">
          <summary><h3>数据与隐私</h3></summary>
          <div class="setting-subgroup">
            <h4>数据备份</h4>
            <div class="setting-actions">
              <button id="export-data-button" :disabled="state.controls.dataBusy.backupExport" @click="callbacks.exportData()" class="secondary-button" type="button">导出数据</button>
              <button id="import-data-button" :disabled="state.controls.dataBusy.backupImport" @click="callbacks.importData()" class="secondary-button" type="button">导入数据</button>
            </div>
          </div>
          <div class="setting-subgroup">
            <h4>搜索历史</h4>
            <div class="setting-actions">
              <button id="clear-search-history-button" :disabled="state.controls.dataBusy.history" @click="callbacks.clearHistory()" class="small-button quiet" type="button">清空搜索历史</button>
            </div>
          </div>
          <div class="setting-subgroup">
            <h4>失效曲目</h4>
            <div class="setting-actions">
              <button id="purge-unavailable-tracks-button" :disabled="purgeBusy" @click="callbacks.purge()" class="small-button quiet" type="button">清理失效曲目</button>
            </div>
          </div>
          <small class="setting-note">导出的备份包含收藏、歌单、听歌记录、AI 配置与背景图，但不包含 AI API Key，在新设备导入后需要重新填写；导入会覆盖当前数据。清空搜索历史仅删除本地搜索记录，不影响收藏、歌单或播放队列。清理失效曲目会从收藏和所有歌单中移除这些歌曲。</small>
        </details>

        <p id="appearance-status" class="appearance-status" role="status">{{ appearanceStatus }}</p>
      </div>
</template>
