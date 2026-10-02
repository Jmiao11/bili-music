// Compile-only checks; these JSON files are also checked by Rust tests.
import fixtureAiConfigViewNone from "../tests/fixtures/contract/ai-config-view-none.json";
import fixtureAiConfigViewSome from "../tests/fixtures/contract/ai-config-view-some.json";
import fixtureAiConnectionTestResult from "../tests/fixtures/contract/ai-connection-test-result.json";
import fixtureAudioCacheSettings from "../tests/fixtures/contract/audio-cache-settings.json";
import fixtureAudioCacheUsage from "../tests/fixtures/contract/audio-cache-usage.json";
import fixtureAudioResponse from "../tests/fixtures/contract/audio-response.json";
import fixtureBackgroundImage from "../tests/fixtures/contract/background-image.json";
import fixtureCachedVideoPages from "../tests/fixtures/contract/cached-video-pages.json";
import fixtureCandidate from "../tests/fixtures/contract/candidate.json";
import fixtureFavoriteToggleResult from "../tests/fixtures/contract/favorite-toggle-result.json";
import fixtureImportPage from "../tests/fixtures/contract/import-page.json";
import fixtureInputTrackSnapshot from "../tests/fixtures/contract/input-track-snapshot.json";
import fixtureLyricsBinding from "../tests/fixtures/contract/lyrics-binding.json";
import fixtureLyrics from "../tests/fixtures/contract/lyrics.json";
import fixturePageMeta from "../tests/fixtures/contract/page-meta.json";
import fixturePlayHistoryItem from "../tests/fixtures/contract/play-history-item.json";
import fixturePlaybackStateNone from "../tests/fixtures/contract/playback-state-none.json";
import fixturePlaybackStateSome from "../tests/fixtures/contract/playback-state-some.json";
import fixturePlaylist from "../tests/fixtures/contract/playlist.json";
import fixturePurgeResult from "../tests/fixtures/contract/purge-result.json";
import fixtureRankingTrackNone from "../tests/fixtures/contract/ranking-track-none.json";
import fixtureRankingTrackSome from "../tests/fixtures/contract/ranking-track-some.json";
import fixtureResolveOutcomeNone from "../tests/fixtures/contract/resolve-outcome-none.json";
import fixtureResolveOutcomeSome from "../tests/fixtures/contract/resolve-outcome-some.json";
import fixtureScoredCandidate from "../tests/fixtures/contract/scored-candidate.json";
import fixtureSearchHistoryItem from "../tests/fixtures/contract/search-history-item.json";
import fixtureSearchVideoNone from "../tests/fixtures/contract/search-video-none.json";
import fixtureSearchVideoSome from "../tests/fixtures/contract/search-video-some.json";
import fixtureShortcutBindingsNone from "../tests/fixtures/contract/shortcut-bindings-none.json";
import fixtureShortcutBindingsSome from "../tests/fixtures/contract/shortcut-bindings-some.json";
import fixtureShortcutsNone from "../tests/fixtures/contract/shortcuts-none.json";
import fixtureShortcutsSome from "../tests/fixtures/contract/shortcuts-some.json";
import fixtureTrackSnapshot from "../tests/fixtures/contract/track-snapshot.json";
import fixtureUnavailableTrack from "../tests/fixtures/contract/unavailable-track.json";
import fixtureVideoMetaNone from "../tests/fixtures/contract/video-meta-none.json";
import fixtureVideoMetaSome from "../tests/fixtures/contract/video-meta-some.json";
import fixtureVideoPage from "../tests/fixtures/contract/video-page.json";
import fixtureYtDlpAvailability from "../tests/fixtures/contract/yt-dlp-availability.json";
const fixtureAiConfigViewNoneOutput: CommandContract.AiConfigView = fixtureAiConfigViewNone;
const fixtureAiConfigViewSomeOutput: CommandContract.AiConfigView = fixtureAiConfigViewSome;
const fixtureAiConnectionTestResultOutput: CommandContract.AiConnectionTestResult = fixtureAiConnectionTestResult;
const fixtureAudioCacheSettingsOutput: CommandContract.AudioCacheSettings = fixtureAudioCacheSettings;
const fixtureAudioCacheUsageOutput: CommandContract.AudioCacheUsage = fixtureAudioCacheUsage;
const fixtureAudioResponseOutput: CommandContract.AudioResponse = fixtureAudioResponse;
const fixtureBackgroundImageOutput: CommandContract.BackgroundImage = fixtureBackgroundImage;
const fixtureCachedVideoPagesOutput: CommandContract.CachedVideoPages = fixtureCachedVideoPages;
const fixtureCandidateOutput: CommandContract.Candidate = fixtureCandidate;
const fixtureFavoriteToggleResultOutput: CommandContract.FavoriteToggleResult = fixtureFavoriteToggleResult;
const fixtureImportPageOutput: CommandContract.ImportPage = fixtureImportPage;
const fixtureLyricsBindingOutput: CommandContract.LyricsBinding = fixtureLyricsBinding;
const fixtureLyricsOutput: CommandContract.Lyrics = fixtureLyrics;
const fixturePageMetaOutput: CommandContract.PageMeta = fixturePageMeta;
const fixturePlayHistoryItemOutput: CommandContract.PlayHistoryItem = fixturePlayHistoryItem;
const fixturePlaybackStateNoneOutput: CommandContract.PlaybackState = fixturePlaybackStateNone;
const fixturePlaybackStateSomeOutput: CommandContract.PlaybackState = fixturePlaybackStateSome;
const fixturePlaylistOutput: CommandContract.Playlist = fixturePlaylist;
const fixturePurgeResultOutput: CommandContract.PurgeResult = fixturePurgeResult;
const fixtureRankingTrackNoneOutput: CommandContract.RankingTrack = fixtureRankingTrackNone;
const fixtureRankingTrackSomeOutput: CommandContract.RankingTrack = fixtureRankingTrackSome;
const fixtureResolveOutcomeNoneOutput: CommandContract.ResolveOutcome = fixtureResolveOutcomeNone;
const fixtureResolveOutcomeSomeOutput: CommandContract.ResolveOutcome = fixtureResolveOutcomeSome;
const fixtureScoredCandidateOutput: CommandContract.ScoredCandidate = fixtureScoredCandidate;
const fixtureSearchHistoryItemOutput: CommandContract.SearchHistoryItem = fixtureSearchHistoryItem;
const fixtureSearchVideoNoneOutput: CommandContract.SearchVideo = fixtureSearchVideoNone;
const fixtureSearchVideoSomeOutput: CommandContract.SearchVideo = fixtureSearchVideoSome;
const fixtureShortcutBindingsNoneOutput: CommandContract.ShortcutBindings = fixtureShortcutBindingsNone;
const fixtureShortcutBindingsSomeOutput: CommandContract.ShortcutBindings = fixtureShortcutBindingsSome;
const fixtureShortcutsNoneOutput: CommandContract.Shortcuts = fixtureShortcutsNone;
const fixtureShortcutsSomeOutput: CommandContract.Shortcuts = fixtureShortcutsSome;
const fixtureTrackSnapshotOutput: CommandContract.TrackSnapshot = fixtureTrackSnapshot;
const fixtureUnavailableTrackOutput: CommandContract.UnavailableTrack = fixtureUnavailableTrack;
const fixtureVideoMetaNoneOutput: CommandContract.VideoMeta = fixtureVideoMetaNone;
const fixtureVideoMetaSomeOutput: CommandContract.VideoMeta = fixtureVideoMetaSome;
const fixtureVideoPageOutput: CommandContract.VideoPage = fixtureVideoPage;
const fixtureYtDlpAvailabilityOutput: CommandContract.YtDlpAvailability = fixtureYtDlpAvailability;
const trackInput: CommandMap["record_play"]["args"] = { track: fixtureInputTrackSnapshot };
const playbackSomeInput: CommandMap["save_playback_state"]["args"] = { state: fixturePlaybackStateSome };
const playbackNoneInput: CommandMap["save_playback_state"]["args"] = { state: fixturePlaybackStateNone };
const bindingsSomeInput: CommandMap["set_shortcuts"]["args"] = { bindings: fixtureShortcutBindingsSome };
const bindingsNoneInput: CommandMap["set_shortcuts"]["args"] = { bindings: fixtureShortcutBindingsNone };
const bindingsOmittedInput: CommandMap["set_shortcuts"]["args"] = { bindings: {} };
const commandResults = {
  read_public_favorite_page: fixtureImportPage,
  create_imported_playlist: fixturePlaylist,
  set_taskbar_playback_state: null,
  open_mini_player: null,
  mini_player_ready: null,
  exit_mini_player: null,
  prepare_audio: fixtureAudioResponse,
  analyze_track_loudness: 1,
  cache_track_audio: "sample",
  get_audio_cache_settings: fixtureAudioCacheSettings,
  set_audio_cache_settings: fixtureAudioCacheSettings,
  get_audio_cache_usage: fixtureAudioCacheUsage,
  clear_audio_cache: 1,
  get_track_loudness: 1,
  clear_loudness_data: null,
  get_video_pages: [fixtureVideoPage],
  get_video_meta: fixtureVideoMetaSome,
  get_cached_video_pages: { BV1234567890: fixtureCachedVideoPages },
  clear_video_pages_cache: 1,
  cancel_prepare_audio: null,
  debug_register_local_stream: "sample",
  search_videos: [fixtureSearchVideoSome],
  get_music_ranking: [fixtureRankingTrackSome],
  get_stream_source: "sample",
  get_yt_dlp_availability: fixtureYtDlpAvailability,
  set_stream_source: "sample",
  open_bilibili_video: null,
  choose_background_image: fixtureBackgroundImage,
  load_background_image: fixtureBackgroundImage,
  list_favorites: [fixtureTrackSnapshot],
  is_favorite: true,
  toggle_favorite: fixtureFavoriteToggleResult,
  reorder_favorite: [fixtureTrackSnapshot],
  list_playlists: [fixturePlaylist],
  create_playlist: [fixturePlaylist],
  rename_playlist: [fixturePlaylist],
  delete_playlist: [fixturePlaylist],
  add_to_playlist: [fixturePlaylist],
  remove_from_playlist: [fixturePlaylist],
  reorder_playlist_item: [fixturePlaylist],
  reorder_playlist: [fixturePlaylist],
  record_search_history: null,
  get_search_history: [fixtureSearchHistoryItem],
  clear_search_history: null,
  get_shortcuts: fixtureShortcutsSome,
  set_shortcuts: null,
  record_play: null,
  get_play_history: [fixturePlayHistoryItem],
  get_playback_state: fixturePlaybackStateSome,
  save_playback_state: null,
  clear_playback_state: null,
  mark_track_unavailable: null,
  clear_track_unavailable: null,
  list_unavailable_tracks: [fixtureUnavailableTrack],
  list_disabled_pages: { BV1234567890: [123] },
  set_page_disabled: null,
  clear_disabled_pages: null,
  purge_unavailable_tracks: fixturePurgeResult,
  get_ai_config: fixtureAiConfigViewSome,
  set_ai_config: fixtureAiConfigViewSome,
  test_ai_connection: fixtureAiConnectionTestResult,
  get_saved_recommendations: [fixtureSearchVideoSome],
  get_lyrics_by_id: fixtureLyrics,
  search_lyrics_songs: [fixtureCandidate],
  clear_lyrics_cache: 1,
  get_lyrics_offset: 1,
  set_lyrics_offset: null,
  resolve_lyrics: fixtureResolveOutcomeSome,
  get_lyrics_binding: fixtureLyricsBinding,
  set_lyrics_binding: null,
  clear_lyrics_binding: null,
  get_recommendations: [fixtureSearchVideoSome],
  export_data: "sample",
  import_data: "sample",
} satisfies { [K in keyof CommandMap]: CommandMap[K]["result"] };
declare const invoke: CommandInvoke;
invoke("get_ai_config");
invoke("record_play", trackInput);
invoke("save_playback_state", playbackSomeInput);
invoke("set_shortcuts", bindingsSomeInput);
invoke("get_recommendations");
// @ts-expect-error Unknown command names must be rejected.
invoke("get_ai_confi");
// @ts-expect-error Rust bv_id uses bvId at the top-level boundary.
invoke("get_video_pages", { bv_id: "BV1234567890" });
// @ts-expect-error Required parameters must not be omitted.
invoke("record_play");
// @ts-expect-error Parameter types must be checked.
invoke("set_stream_source", { source: false });
// @ts-expect-error Output nullable fields are present, not optional.
const missingNullableField: CommandContract.AiConfigView = { apiFormat: "format", baseUrl: "url", model: "model", hasKey: false };

declare const eventApi: TauriEventApi;
eventApi.listen("global-shortcut", ({ payload }) => payload.toUpperCase());
eventApi.emit("taskbar-media-control", "play_pause");
eventApi.emit("mini-player-command", { action: "toggle_play" });
eventApi.emit("mini-player-ready");
eventApi.listen("tauri://resize", ({ payload }) => { const frameworkPayload: unknown = payload; });
// @ts-expect-error Wrong known action must not fall through to framework overloads.
eventApi.emit("taskbar-media-control", "toggle_play");
// @ts-expect-error Known events require their payload.
eventApi.emit("mini-player-command");
// @ts-expect-error Mini commands have a different action vocabulary.
eventApi.emit("mini-player-command", { action: "play_pause" });
// @ts-expect-error Unknown app events need an explicit external declaration.
eventApi.listen("mini-player-unknown", () => {});
