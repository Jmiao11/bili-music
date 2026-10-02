pub(crate) use tests::assert_fixture;

#[cfg(test)]
mod tests {
    use serde::Serialize;
    use std::path::PathBuf;

    pub(crate) fn assert_fixture<T: Serialize>(name: &str, value: &T) {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../tests/fixtures/contract")
            .join(format!("{name}.json"));
        // Compact JSON has no line endings for core.autocrlf to change.
        let actual = serde_json::to_vec(value).unwrap();
        if std::env::var("UPDATE_CONTRACT_FIXTURES").as_deref() == Ok("1") {
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, &actual).unwrap();
        }
        assert_eq!(actual, std::fs::read(&path).unwrap(), "{}", path.display());
    }

    fn track() -> crate::library::TrackSnapshot {
        crate::library::TrackSnapshot {
            bvid: "BV1234567890".into(),
            title: "曲目".into(),
            uploader: "作者".into(),
            thumbnail_url: "https://example.com/cover.jpg".into(),
            duration_seconds: 120,
            added_at: "1700000000000".into(),
        }
    }

    fn bindings(some: bool) -> crate::library::shortcut_config::ShortcutBindings {
        let value = some.then(|| "Ctrl+Alt+P".to_owned());
        crate::library::shortcut_config::ShortcutBindings {
            previous: value.clone(),
            play_pause: value.clone(),
            next: value.clone(),
            volume_up: value.clone(),
            volume_down: value,
        }
    }

    #[test]
    fn public_dto_output_contract_fixtures() {
        use crate::library::{
            favorites, history, playback_state, playlists, shortcut_config, unavailable,
        };
        use crate::lyrics::{Candidate, ScoredCandidate};

        assert_fixture(
            "audio-response",
            &crate::resolve::AudioResponse {
                audio_url: "http://127.0.0.1:1234/audio/token".into(),
                title: "曲目".into(),
                uploader: "作者".into(),
                thumbnail_url: "https://example.com/cover.jpg".into(),
                duration_seconds: 120.5,
            },
        );
        assert_fixture(
            "video-page",
            &crate::guest_playurl::VideoPage {
                page: 1,
                cid: 123,
                part: "分P".into(),
                duration_seconds: 120,
            },
        );
        assert_fixture("track-snapshot", &track());
        assert_fixture(
            "favorite-toggle-result",
            &favorites::FavoriteToggleResult {
                favorited: true,
                items: vec![track()],
            },
        );
        assert_fixture(
            "playlist",
            &playlists::Playlist {
                id: "playlist-1".into(),
                name: "歌单".into(),
                created_at: "1700000000000".into(),
                items: vec![track()],
            },
        );
        assert_fixture(
            "search-history-item",
            &history::SearchHistoryItem {
                keyword: "音乐".into(),
                searched_at: "1700000000000".into(),
                count: 2,
            },
        );
        assert_fixture(
            "play-history-item",
            &history::PlayHistoryItem {
                bvid: "BV1234567890".into(),
                title: "曲目".into(),
                uploader: "作者".into(),
                thumbnail_url: "https://example.com/cover.jpg".into(),
                duration_seconds: 120,
                last_played_at: "1700000000000".into(),
                count: 2,
            },
        );
        assert_fixture(
            "unavailable-track",
            &unavailable::UnavailableTrack {
                bvid: "BV1234567890".into(),
                reason: "不可用".into(),
                marked_at: 1700000000000,
            },
        );
        assert_fixture(
            "purge-result",
            &unavailable::PurgeResult {
                removed_favorites: 1,
                removed_playlist_items: 2,
                cleared_marks: 1,
            },
        );
        for some in [true, false] {
            let suffix = if some { "some" } else { "none" };
            assert_fixture(
                &format!("search-video-{suffix}"),
                &crate::search::SearchVideo {
                    bvid: "BV1234567890".into(),
                    title: "曲目".into(),
                    uploader: "作者".into(),
                    thumbnail_url: "https://example.com/cover.jpg".into(),
                    duration_seconds: 120,
                    play_count: some.then_some(42),
                    pubdate: some.then_some(1700000000),
                },
            );
            assert_fixture(
                &format!("ranking-track-{suffix}"),
                &crate::ranking::RankingTrack {
                    bvid: "BV1234567890".into(),
                    title: "曲目".into(),
                    uploader: "作者".into(),
                    thumbnail_url: "https://example.com/cover.jpg".into(),
                    duration_seconds: 120,
                    play_count: some.then_some(42),
                },
            );
            assert_fixture(
                &format!("playback-state-{suffix}"),
                &playback_state::PlaybackState {
                    version: 1,
                    queue: vec![track()],
                    current_index: 0,
                    position_seconds: 12.5,
                    page: some.then_some(1),
                    cid: some.then_some(123),
                    saved_at: 1700000000000,
                },
            );
            assert_fixture(&format!("shortcut-bindings-{suffix}"), &bindings(some));
            let mut shortcuts = shortcut_config::Shortcuts::default();
            shortcuts.bindings = bindings(some);
            assert_fixture(&format!("shortcuts-{suffix}"), &shortcuts);
            assert_fixture(
                &format!("ai-config-view-{suffix}"),
                &crate::ai::AiConfigView {
                    api_format: "openai-chat-completions".into(),
                    base_url: "https://example.com/v1".into(),
                    model: "model".into(),
                    has_key: some,
                    key_hint: some.then(|| "***1234".into()),
                },
            );
            assert_fixture(
                &format!("video-meta-{suffix}"),
                &crate::lyrics::VideoMeta {
                    title: "视频".into(),
                    desc: "说明".into(),
                    duration: 120,
                    videos: 1,
                    bgm_name: some.then(|| "音乐".into()),
                    pages: vec![page_meta()],
                },
            );
            assert_fixture(
                &format!("resolve-outcome-{suffix}"),
                &crate::lyrics::ResolveOutcome {
                    status: "matched".into(),
                    song_id: "song-1".into(),
                    song_name: "歌曲".into(),
                    singer: "歌手".into(),
                    lyrics: some.then(lyrics),
                    offset_ms: 100,
                    used_keyword: "歌曲".into(),
                    candidates: vec![scored_candidate()],
                },
            );
        }
        assert_fixture(
            "ai-connection-test-result",
            &crate::ai::AiConnectionTestResult {
                ok: true,
                message: "连接成功".into(),
            },
        );
        assert_fixture("lyrics", &lyrics());
        assert_fixture("page-meta", &page_meta());
        assert_fixture(
            "cached-video-pages",
            &crate::lyrics::CachedVideoPages {
                videos: 1,
                pages: vec![page_meta()],
                cached_at: 1700000000000,
            },
        );
        assert_fixture(
            "lyrics-binding",
            &crate::lyrics::LyricsBinding {
                song_id: "song-1".into(),
                song_name: "歌曲".into(),
                singer: "歌手".into(),
                source: "manual".into(),
                confidence: 0.9,
                checked_at: 1700000000000,
            },
        );
        assert_fixture("candidate", &candidate());
        assert_fixture("scored-candidate", &scored_candidate());

        fn lyrics() -> crate::lyrics::Lyrics {
            crate::lyrics::Lyrics {
                lrc: "[00:01.00]歌词".into(),
                trans: "译文".into(),
                has_lyric: true,
            }
        }
        fn page_meta() -> crate::lyrics::PageMeta {
            crate::lyrics::PageMeta {
                cid: 123,
                page: 1,
                part: "分P".into(),
                duration: 120,
            }
        }
        fn candidate() -> Candidate {
            Candidate {
                song_id: "song-1".into(),
                name: "歌曲".into(),
                singer: "歌手".into(),
                duration: 120,
            }
        }
        fn scored_candidate() -> ScoredCandidate {
            ScoredCandidate {
                candidate: candidate(),
                score: 0.9,
            }
        }
    }

    #[test]
    fn command_input_contract_fixtures_deserialize() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/contract");
        let input: crate::library::TrackSnapshotInput =
            serde_json::from_slice(&std::fs::read(root.join("input-track-snapshot.json")).unwrap())
                .unwrap();
        assert_eq!(input.duration_seconds, 120);
        let _: crate::library::TrackSnapshot =
            serde_json::from_slice(&std::fs::read(root.join("track-snapshot.json")).unwrap())
                .unwrap();
        for suffix in ["some", "none"] {
            let _: crate::library::playback_state::PlaybackState = serde_json::from_slice(
                &std::fs::read(root.join(format!("playback-state-{suffix}.json"))).unwrap(),
            )
            .unwrap();
            let _: crate::library::shortcut_config::ShortcutBindings = serde_json::from_slice(
                &std::fs::read(root.join(format!("shortcut-bindings-{suffix}.json"))).unwrap(),
            )
            .unwrap();
        }
        let _: crate::library::shortcut_config::ShortcutBindings =
            serde_json::from_str("{}").unwrap();
    }

    fn input_duration(
        value: &str,
    ) -> Result<crate::library::TrackSnapshotInput, serde_json::Error> {
        serde_json::from_str(
            &include_str!("../../tests/fixtures/contract/input-track-snapshot.json").replace(
                "\"durationSeconds\":120",
                &format!("\"durationSeconds\":{value}"),
            ),
        )
    }

    #[test]
    fn contract_duration_accepts_and_rounds_without_losing_integer_precision() {
        for (value, expected) in [
            ("0", 0),
            ("-0", 0),
            ("-0.0", 0),
            ("0.4", 0),
            ("0.5", 1),
            ("120.5", 121),
            ("9007199254740993", 9007199254740993),
            ("18446744073709551615", u64::MAX),
            ("18446744073709549568.0", 18446744073709549568),
        ] {
            assert_eq!(
                input_duration(value).unwrap().duration_seconds,
                expected,
                "{value}"
            );
        }
    }

    #[test]
    fn contract_duration_rejects_negative_and_out_of_range_numbers() {
        for value in [
            "-0.1",
            "-0.4",
            "-1",
            "18446744073709551616",
            "18446744073709551616.0",
            "18446744073709551615.9",
            "1e100",
        ] {
            assert!(input_duration(value).is_err(), "{value}");
        }
    }

    #[test]
    fn contract_stored_tracks_and_playback_state_remain_strict() {
        let track = include_str!("../../tests/fixtures/contract/track-snapshot.json")
            .replace("\"durationSeconds\":120", "\"durationSeconds\":120.5");
        assert!(serde_json::from_str::<crate::library::TrackSnapshot>(&track).is_err());
        let state = include_str!("../../tests/fixtures/contract/playback-state-some.json")
            .replace("\"durationSeconds\":120", "\"durationSeconds\":120.5");
        assert!(
            serde_json::from_str::<crate::library::playback_state::PlaybackState>(&state).is_err()
        );
    }
}
