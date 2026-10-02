// JSON wire types: output Option fields are present and nullable; input Option
// fields may be omitted. Numbers describe JSON representation, not u64 validation.
declare namespace CommandContract {
  interface AudioResponse { audioUrl: string; title: string; uploader: string; thumbnailUrl: string; durationSeconds: number; }
  interface VideoPage { page: number; cid: number; part: string; durationSeconds: number; }
  interface SearchVideo { bvid: string; title: string; uploader: string; thumbnailUrl: string; durationSeconds: number; playCount: number | null; pubdate: number | null; }
  interface RankingTrack { bvid: string; title: string; uploader: string; thumbnailUrl: string; durationSeconds: number; playCount: number | null; }
  interface YtDlpAvailability { available: boolean; path: string; }
  interface BackgroundImage { path: string; displayName: string; dataUrl: string; width: number; height: number; }
  interface AudioCacheSettings { enabled: boolean; maxBytes: number; }
  interface AudioCacheUsage { bytes: number; items: number; }
  interface TrackSnapshot { bvid: string; title: string; uploader: string; thumbnailUrl: string; durationSeconds: number; addedAt: string; }
  interface TrackSnapshotInput { bvid: string; title: string; uploader: string; thumbnailUrl: string; durationSeconds: number; }
  interface FavoriteToggleResult { favorited: boolean; items: TrackSnapshot[]; }
  interface Playlist { id: string; name: string; createdAt: string; items: TrackSnapshot[]; }
  interface ImportPage { mediaId: string; title: string; total: number; items: TrackSnapshot[]; skipped: number; duplicates: number; scanned: number; hasMore: boolean; truncated: boolean; }
  interface SearchHistoryItem { keyword: string; searchedAt: string; count: number; }
  interface PlayHistoryItem { bvid: string; title: string; uploader: string; thumbnailUrl: string; durationSeconds: number; lastPlayedAt: string; count: number; }
  interface PlaybackState { version: number; queue: TrackSnapshot[]; currentIndex: number; positionSeconds: number; page: number | null; cid: number | null; savedAt: number; }
  type PlaybackStateInput = Omit<PlaybackState, "page" | "cid"> & { page?: number | null; cid?: number | null; };
  interface UnavailableTrack { bvid: string; reason: string; markedAt: number; }
  interface PurgeResult { removedFavorites: number; removedPlaylistItems: number; clearedMarks: number; }
  interface ShortcutBindings { previous: string | null; playPause: string | null; next: string | null; volumeUp: string | null; volumeDown: string | null; }
  type ShortcutBindingsInput = Partial<ShortcutBindings>;
  interface Shortcuts { version: number; bindings: ShortcutBindings; }
  interface AiConfigView { apiFormat: string; baseUrl: string; model: string; hasKey: boolean; keyHint: string | null; }
  interface AiConnectionTestResult { ok: boolean; message: string; }
  interface Lyrics { lrc: string; trans: string; hasLyric: boolean; }
  interface PageMeta { cid: number; page: number; part: string; duration: number; }
  interface CachedVideoPages { videos: number; pages: PageMeta[]; cached_at: number; }
  interface VideoMeta { title: string; desc: string; duration: number; videos: number; bgm_name: string | null; pages: PageMeta[]; }
  interface LyricsBinding { song_id: string; song_name: string; singer: string; source: string; confidence: number; checked_at: number; }
  interface ResolveOutcome { status: string; song_id: string; song_name: string; singer: string; lyrics: Lyrics | null; offset_ms: number; used_keyword: string; candidates: ScoredCandidate[]; }
  interface Candidate { song_id: string; name: string; singer: string; duration: number; }
  interface ScoredCandidate { candidate: Candidate; score: number; }
}

interface CommandMap {
  read_public_favorite_page: { args: { link: string; page: number; existing: string[] }; result: CommandContract.ImportPage };
  create_imported_playlist: { args: { name: string; tracks: CommandContract.TrackSnapshotInput[] }; result: CommandContract.Playlist };
  set_taskbar_playback_state: { args: { isPlaying: boolean }; result: null };
  open_mini_player: { args: undefined; result: null };
  mini_player_ready: { args: undefined; result: null };
  exit_mini_player: { args: undefined; result: null };
  prepare_audio: { args: { bvId: string; cid?: number | null; cacheCid?: number | null; page?: number | null; part?: string | null; durationSeconds?: number | null }; result: CommandContract.AudioResponse };
  analyze_track_loudness: { args: { audioUrl: string; key: string }; result: number | null };
  cache_track_audio: { args: { audioUrl: string; bvid: string; cid?: number | null; title: string; uploader: string; thumbnailUrl: string; durationSeconds: number }; result: string };
  get_audio_cache_settings: { args: undefined; result: CommandContract.AudioCacheSettings };
  set_audio_cache_settings: { args: { enabled: boolean; maxBytes: number }; result: CommandContract.AudioCacheSettings };
  get_audio_cache_usage: { args: undefined; result: CommandContract.AudioCacheUsage };
  clear_audio_cache: { args: undefined; result: number };
  get_track_loudness: { args: { key: string }; result: number | null };
  clear_loudness_data: { args: undefined; result: null };
  get_video_pages: { args: { bvId: string }; result: CommandContract.VideoPage[] };
  get_video_meta: { args: { bvid: string }; result: CommandContract.VideoMeta };
  get_cached_video_pages: { args: { bvids: string[] }; result: Record<string, CommandContract.CachedVideoPages> };
  clear_video_pages_cache: { args: undefined; result: number };
  cancel_prepare_audio: { args: undefined; result: null };
  debug_register_local_stream: { args: { path: string }; result: string };
  search_videos: { args: { keyword: string; page?: number | null; tids?: number | null; order?: string | null; sortMode?: string | null; rerank: boolean }; result: CommandContract.SearchVideo[] };
  get_music_ranking: { args: { forceRefresh?: boolean | null }; result: CommandContract.RankingTrack[] };
  get_stream_source: { args: undefined; result: string };
  get_yt_dlp_availability: { args: undefined; result: CommandContract.YtDlpAvailability };
  set_stream_source: { args: { source: string }; result: string };
  open_bilibili_video: { args: { bvId: string }; result: null };
  choose_background_image: { args: undefined; result: CommandContract.BackgroundImage | null };
  load_background_image: { args: { path: string }; result: CommandContract.BackgroundImage };
  list_favorites: { args: undefined; result: CommandContract.TrackSnapshot[] };
  is_favorite: { args: { bvid: string }; result: boolean };
  toggle_favorite: { args: { track: CommandContract.TrackSnapshotInput }; result: CommandContract.FavoriteToggleResult };
  reorder_favorite: { args: { fromIndex: number; toIndex: number }; result: CommandContract.TrackSnapshot[] };
  list_playlists: { args: undefined; result: CommandContract.Playlist[] };
  create_playlist: { args: { name: string }; result: CommandContract.Playlist[] };
  rename_playlist: { args: { id: string; name: string }; result: CommandContract.Playlist[] };
  delete_playlist: { args: { id: string }; result: CommandContract.Playlist[] };
  add_to_playlist: { args: { id: string; track: CommandContract.TrackSnapshotInput }; result: CommandContract.Playlist[] };
  remove_from_playlist: { args: { id: string; bvid: string }; result: CommandContract.Playlist[] };
  reorder_playlist_item: { args: { id: string; fromIndex: number; toIndex: number }; result: CommandContract.Playlist[] };
  reorder_playlist: { args: { fromIndex: number; toIndex: number }; result: CommandContract.Playlist[] };
  record_search_history: { args: { keyword: string }; result: null };
  get_search_history: { args: undefined; result: CommandContract.SearchHistoryItem[] };
  clear_search_history: { args: undefined; result: null };
  get_shortcuts: { args: undefined; result: CommandContract.Shortcuts };
  set_shortcuts: { args: { bindings: CommandContract.ShortcutBindingsInput }; result: null };
  record_play: { args: { track: CommandContract.TrackSnapshotInput }; result: null };
  get_play_history: { args: undefined; result: CommandContract.PlayHistoryItem[] };
  get_playback_state: { args: undefined; result: CommandContract.PlaybackState | null };
  save_playback_state: { args: { state: CommandContract.PlaybackStateInput }; result: null };
  clear_playback_state: { args: undefined; result: null };
  mark_track_unavailable: { args: { bvid: string; reason: string }; result: null };
  clear_track_unavailable: { args: { bvid: string }; result: null };
  list_unavailable_tracks: { args: undefined; result: CommandContract.UnavailableTrack[] };
  list_disabled_pages: { args: undefined; result: Record<string, number[]> };
  set_page_disabled: { args: { bvid: string; cid: number; disabled: boolean }; result: null };
  clear_disabled_pages: { args: { bvid: string }; result: null };
  purge_unavailable_tracks: { args: undefined; result: CommandContract.PurgeResult };
  get_ai_config: { args: undefined; result: CommandContract.AiConfigView };
  set_ai_config: { args: { apiFormat: string; baseUrl: string; model: string; apiKey: string }; result: CommandContract.AiConfigView };
  test_ai_connection: { args: { apiFormat?: string | null; baseUrl?: string | null; model?: string | null; apiKey?: string | null }; result: CommandContract.AiConnectionTestResult };
  get_saved_recommendations: { args: undefined; result: CommandContract.SearchVideo[] };
  get_lyrics_by_id: { args: { songId: string }; result: CommandContract.Lyrics };
  search_lyrics_songs: { args: { keyword: string }; result: CommandContract.Candidate[] };
  clear_lyrics_cache: { args: undefined; result: number };
  get_lyrics_offset: { args: { bvid: string; cid: number }; result: number };
  set_lyrics_offset: { args: { bvid: string; cid: number; offsetMs: number }; result: null };
  resolve_lyrics: { args: { bvid: string; cid: number; force?: boolean | null }; result: CommandContract.ResolveOutcome };
  get_lyrics_binding: { args: { bvid: string; cid: number }; result: CommandContract.LyricsBinding | null };
  set_lyrics_binding: { args: { bvid: string; cid: number; songId: string; songName: string; singer: string }; result: null };
  clear_lyrics_binding: { args: { bvid: string; cid: number }; result: null };
  get_recommendations: { args: { userHint?: string | null }; result: CommandContract.SearchVideo[] };
  export_data: { args: undefined; result: string | null };
  import_data: { args: undefined; result: string | null };
}

type CommandArguments<K extends keyof CommandMap> = CommandMap[K]["args"] extends undefined
  ? [args?: undefined]
  : {} extends CommandMap[K]["args"]
    ? [args?: CommandMap[K]["args"]]
    : [args: CommandMap[K]["args"]];
type CommandInvoke = <K extends keyof CommandMap>(command: K, ...args: CommandArguments<K>) => Promise<CommandMap[K]["result"]>;
