use super::*;
use crate::home_feed::{HomeFeed, Mode, Source};
use crate::lyrics::{PageMeta, VideoOwner};
use serde_json::{json, Value};

const NOW: u64 = 1_800_000_000_000;
const DAY: &str = "2026-11-25";

fn bv(n: u32) -> String {
    format!("BV{n:010}")
}

fn played(n: u32, age: u64, nickname: &str) -> PlayHistoryItem {
    PlayHistoryItem {
        bvid: bv(n),
        title: format!("合成种子 {n}"),
        uploader: nickname.into(),
        thumbnail_url: String::new(),
        duration_seconds: 60,
        last_played_at: (NOW - age).to_string(),
        count: 1,
        last_cid: None,
        last_page: Some(1),
        last_part_name: None,
    }
}

fn favorite(n: u32, nickname: &str) -> library::TrackSnapshot {
    library::TrackSnapshot {
        bvid: bv(n),
        title: format!("合成收藏 {n}"),
        uploader: nickname.into(),
        thumbnail_url: String::new(),
        duration_seconds: 600,
        added_at: NOW.to_string(),
    }
}

fn detail(videos: i64, duration: i64, mid: Option<u64>) -> CachedVideoPages {
    CachedVideoPages {
        videos,
        pages: vec![PageMeta {
            cid: 1,
            page: 1,
            part: String::new(),
            duration,
        }],
        cached_at: 1,
        owner: mid.map(|mid| VideoOwner { mid }),
    }
}

fn seed_ids(selection: Selection) -> Vec<String> {
    selection.seeds.into_iter().map(|seed| seed.bvid).collect()
}

#[test]
fn selects_recent_week_in_order_before_favorites_and_excludes_played_even_if_ineligible() {
    let mut recent_multipart = played(1, 1, "甲");
    recent_multipart.last_page = Some(2);
    let history = [
        played(2, WEEK_MS + 1, "乙"),
        played(3, WEEK_MS, "丙"),
        recent_multipart,
        played(4, 20, "丁"),
    ];
    let favorites = [favorite(1, "甲"), favorite(5, "戊")];
    let recent = recent_history(&history, NOW);
    assert_eq!(
        recent
            .iter()
            .map(|item| item.bvid.as_str())
            .collect::<Vec<_>>(),
        [bv(1), bv(4), bv(3)]
    );
    let selection = select(
        &recent,
        &[&favorites[0], &favorites[1]],
        &HashMap::new(),
        &[],
    )
    .unwrap();
    assert!(selection.excluded.contains(&bv(1).to_ascii_lowercase()));
    assert!(!selection.excluded.contains(&bv(2).to_ascii_lowercase()));
    assert_eq!(seed_ids(selection), [bv(4), bv(3)]);
    let fallback = select(
        &recent[..2],
        &[&favorites[0], &favorites[1]],
        &HashMap::new(),
        &[],
    )
    .unwrap();
    assert_eq!(seed_ids(fallback), [bv(4), bv(5)]);
}

#[test]
fn missing_details_use_known_duration_and_last_page() {
    for (seconds, expected) in [
        (0, false),
        (59, false),
        (60, true),
        (600, true),
        (601, false),
    ] {
        let mut item = played(1, 0, "甲");
        item.duration_seconds = seconds;
        assert_eq!(
            select(&[&item], &[], &HashMap::new(), &[]).is_some(),
            expected,
            "{seconds}"
        );
    }
    let mut item = played(1, 0, "甲");
    item.last_page = None;
    assert!(select(&[&item], &[], &HashMap::new(), &[]).is_some());
    item.last_page = Some(2);
    assert!(select(&[&item], &[], &HashMap::new(), &[]).is_none());
    assert!(select(
        &[&item],
        &[],
        &HashMap::from([(bv(1), detail(1, 100, None))]),
        &[]
    )
    .is_none());
    assert!(select(&[], &[], &HashMap::new(), &[]).is_none());
}

#[test]
fn cached_pages_gate_duration_and_multipart_without_requiring_mid() {
    let mut item = played(1, 0, "甲");
    item.duration_seconds = 0;
    let second = played(2, 1, "乙");
    for (pages, duration, expected) in [
        (2, 60, false),
        (1, 59, false),
        (1, 60, true),
        (1, 600, true),
        (1, 601, false),
    ] {
        let details = HashMap::from([(bv(1), detail(pages, duration, None))]);
        let selection = select(&[&item, &second], &[], &details, &[]).unwrap();
        assert_eq!(
            selection.seeds.len(),
            if expected { 2 } else { 1 },
            "{pages} P, {duration}s"
        );
    }
}

#[test]
fn mixed_levels_follow_recency_and_mid_takes_precedence_over_nickname() {
    let recent = [
        played(1, 0, "  甲 "),
        played(2, 1, "甲"),
        played(3, 2, "乙"),
        played(4, 3, "乙"),
    ];
    let details = HashMap::from([
        (bv(2), detail(1, 60, Some(10))),
        (bv(3), detail(1, 60, Some(10))),
        (bv(4), detail(1, 60, Some(20))),
    ]);
    let selection = select(&recent.iter().collect::<Vec<_>>(), &[], &details, &[]).unwrap();
    // One of two selected seeds uses detail information, and one uses the legacy record.
    assert_eq!(seed_ids(selection), [bv(1), bv(3)]);
    assert_eq!(
        seed_ids(select(&[&recent[1], &recent[2], &recent[3]], &[], &details, &[]).unwrap()),
        [bv(2), bv(4)]
    );
    assert_eq!(
        seed_ids(select(&[&recent[2], &recent[3]], &[], &details, &[]).unwrap()),
        [bv(3), bv(4)]
    );
}

#[test]
fn legacy_nicknames_are_trimmed_and_two_unknown_owners_can_be_used() {
    let recent = [
        played(1, 0, "甲 "),
        played(2, 1, " 甲 "),
        played(3, 2, ""),
        played(4, 3, "  "),
    ];
    let details = HashMap::new();
    assert_eq!(
        seed_ids(select(&[&recent[0], &recent[1], &recent[2]], &[], &details, &[]).unwrap()),
        [bv(1), bv(3)]
    );
    assert_eq!(
        seed_ids(select(&[&recent[2], &recent[3]], &[], &details, &[]).unwrap()),
        [bv(3), bv(4)]
    );
}

#[test]
fn skips_previous_seeds_when_possible_and_deduplicates_bv_across_inputs() {
    let recent = [played(1, 0, "甲"), played(2, 1, "乙"), played(3, 2, "甲")];
    let favorites = [favorite(1, "不同显示名"), favorite(4, "丙")];
    let details = HashMap::new();
    let previous = select(&[&recent[0], &recent[1]], &[], &details, &[])
        .unwrap()
        .seeds;
    let select_ids = |recent: &[&PlayHistoryItem], favorites: &[&library::TrackSnapshot]| {
        seed_ids(select(recent, favorites, &details, &previous).unwrap())
    };
    assert_eq!(
        select_ids(&[&recent[0], &recent[1], &recent[2]], &[&favorites[1]]),
        [bv(3), bv(4)]
    );
    assert_eq!(
        select_ids(&[&recent[0], &recent[1], &recent[2]], &[]),
        [bv(3), bv(2)]
    );
    assert_eq!(select_ids(&[&recent[0]], &[&favorites[0]]), [bv(1)]);
}

fn related(n: u32, mid: u32, edits: Value) -> RelatedVideo {
    let mut data = json!({"bvid":bv(n), "title":"合成音乐", "duration":120, "pid_v2":1003, "owner":{"mid":mid,"name":"合成作者"}});
    for (key, value) in edits.as_object().unwrap() {
        data[key] = value.clone();
    }
    serde_json::from_value(data).unwrap()
}

#[test]
fn parses_new_or_old_music_division_and_rejects_other_divisions() {
    assert!(related(1, 1, json!({"tid":1})).into_track().is_some());
    assert!(related(1, 1, json!({"pid_v2":1,"tid":28}))
        .into_track()
        .is_some());
    assert!(related(1, 1, json!({"pid_v2":1,"tid":1}))
        .into_track()
        .is_none());
}

#[test]
fn rejects_review_and_instruction_names_in_both_taxonomies() {
    for field in ["tname", "tnamev2"] {
        for name in ["乐评盘点", "音乐教学"] {
            assert!(
                related(1, 1, json!({(field):name})).into_track().is_none(),
                "{field}: {name}"
            );
        }
    }
}

#[test]
fn rejects_negative_titles() {
    for word in crate::search::NEGATIVE_TITLE_WORDS {
        assert!(
            related(1, 1, json!({"title":format!("合成 {word}")}))
                .into_track()
                .is_none(),
            "{word}"
        );
    }
}

#[test]
fn result_duration_is_inclusive_and_requires_known_owner_mid() {
    for (seconds, allowed) in [(59, false), (60, true), (600, true), (601, false)] {
        assert_eq!(
            related(1, 1, json!({"duration":seconds}))
                .into_track()
                .is_some(),
            allowed,
            "{seconds}"
        );
    }
    assert!(related(1, 0, json!({})).into_track().is_none());
}

fn selection() -> Selection {
    select(
        &[&played(1, 0, "甲"), &played(2, 1, "甲")],
        &[&favorite(3, "乙")],
        &HashMap::new(),
        &[],
    )
    .unwrap()
}

fn ids(tracks: Vec<RankingTrack>) -> Vec<String> {
    tracks.into_iter().map(|track| track.bvid).collect()
}

#[test]
fn excludes_favorite_seed_from_results() {
    assert_eq!(
        ids(selection().tracks(vec![vec![
            related(3, 3, json!({})),
            related(4, 4, json!({}))
        ]])),
        [bv(4)]
    );
}

#[test]
fn excludes_recent_playback_that_was_not_used_as_a_seed() {
    assert_eq!(
        ids(selection().tracks(vec![vec![
            related(2, 2, json!({})),
            related(4, 4, json!({}))
        ]])),
        [bv(4)]
    );
}

#[test]
fn merges_in_alternating_order_and_deduplicates_across_batches() {
    let a = [4, 5, 7].map(|n| related(n, n, json!({}))).into();
    let b = [6, 5, 8, 9].map(|n| related(n, n, json!({}))).into();
    assert_eq!(
        ids(selection().tracks(vec![a, b])),
        [bv(4), bv(6), bv(5), bv(7), bv(8), bv(9)]
    );
}

#[test]
fn limits_each_uploader_across_both_batches() {
    let a = [4, 5].map(|n| related(n, 7, json!({}))).into();
    let b = vec![
        related(6, 7, json!({"owner":{"mid":7,"name":"另一个昵称"}})),
        related(7, 8, json!({})),
    ];
    assert_eq!(ids(selection().tracks(vec![a, b])), [bv(4), bv(6), bv(7)]);
}

#[test]
fn returns_at_most_twenty_tracks() {
    let batch = (4..35).map(|n| related(n, n, json!({}))).collect();
    assert_eq!(
        ids(selection().tracks(vec![batch])),
        (4..24).map(bv).collect::<Vec<_>>()
    );
}

#[tokio::test]
async fn legacy_cache_cold_start_same_day_and_daily_risk_exclusion() {
    let dir = std::env::temp_dir().join(format!("bili-r3-cache-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&dir).unwrap();
    let path = dir.join("home_feed.json");
    {
        let guard = crate::storage::lock_storage().unwrap();
        let legacy = br#"{"version":1,"ranking":{"date":"2026-11-24","fetchedAt":1,"items":[]},"newSongs":{"date":"2026-11-24","fetchedAt":2,"items":[]}}"#;
        crate::storage::write_bytes_atomic(&guard, &path, legacy).unwrap();
        let cache = super::super::read(&guard, &path).unwrap();
        assert_eq!(cache.version, 1);
        assert_eq!(cache.ranking.fetched_at, 1);
        assert_eq!(cache.new_songs.fetched_at, 2);
        assert!(cache.for_you.seeds.is_empty());
    }
    let feed = HomeFeed::default();
    let no_plan =
        |_: &[Seed]| -> Result<Option<Selection>, String> { panic!("无须重新选种") };
    let no_fetch = |_| async { panic!("不应发请求") };
    let cold = feed
        .load_from(
            &path,
            Source::ForYou,
            Mode::Auto,
            DAY.into(),
            |_| Ok(None),
            no_fetch,
        )
        .await
        .unwrap();
    assert_eq!(cold.available, Some(false));
    assert!(cold.request_at.is_none());
    assert!(HomeFeed::default()
        .load_from(
            &path,
            Source::ForYou,
            Mode::Auto,
            DAY.into(),
            no_plan,
            no_fetch
        )
        .await
        .unwrap()
        .request_at
        .is_none());
    let loaded = feed
        .load_from(
            &path,
            Source::ForYou,
            Mode::Refresh,
            DAY.into(),
            |_| Ok(Some(selection())),
            |_| async { Ok(vec![]) },
        )
        .await
        .unwrap();
    assert_eq!(loaded.available, Some(true));
    assert_eq!(loaded.section.seeds.len(), 2);
    assert!(HomeFeed::default()
        .load_from(
            &path,
            Source::ForYou,
            Mode::Auto,
            DAY.into(),
            no_plan,
            no_fetch
        )
        .await
        .unwrap()
        .request_at
        .is_none());
    let tomorrow = "2026-11-26";
    let failure = feed
        .load_from(
            &path,
            Source::ForYou,
            Mode::Auto,
            tomorrow.into(),
            |_| Ok(Some(selection())),
            |_| async { Err("首页请求受限".into()) },
        )
        .await
        .unwrap();
    assert!(failure.restricted);
    assert_eq!(failure.section.fetched_at, loaded.section.fetched_at);
    assert_eq!(failure.section.seeds, loaded.section.seeds);
    let stopped = HomeFeed::default()
        .load_from(
            &path,
            Source::ForYou,
            Mode::Auto,
            tomorrow.into(),
            no_plan,
            no_fetch,
        )
        .await
        .unwrap();
    assert!(stopped.restricted);
    assert_eq!(stopped.section.risk_date.as_deref(), Some(tomorrow));
    crate::storage::remove_file(&crate::storage::lock_storage().unwrap(), path).unwrap();
    std::fs::remove_dir(dir).unwrap();
}
