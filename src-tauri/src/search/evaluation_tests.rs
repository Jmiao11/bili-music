use super::*;
use std::collections::BTreeMap;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Query {
    keyword: String,
    explicit_intent: bool,
    items: Vec<Item>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Item {
    raw_rank: usize,
    bvid: String,
    title: String,
    duration_seconds: u64,
    label: String,
}

fn ids(videos: &[SearchVideo]) -> Vec<&str> {
    videos.iter().map(|v| v.bvid.as_str()).collect()
}

#[test]
fn reviewed_offline_search_rankings() {
    let queries: Vec<Query> =
        serde_json::from_str(include_str!("../../tests/fixtures/search-evaluation.json")).unwrap();
    assert_eq!(queries.len(), 45);
    let mut hits = [[0; 2]; 2];
    let mut protected_queries = 0;
    let mut mixed_performance = None;
    let mut unchanged_examples = 0;
    let mut suitable_dropped = 0;
    for query in queries {
        let k = &query.keyword;
        assert_eq!(query.items.len(), 20);
        let mut videos = Vec::new();
        let mut suitable = BTreeMap::new();
        for (i, item) in query.items.iter().enumerate() {
            assert_eq!(item.raw_rank, i + 1);
            assert!(matches!(
                item.label.as_str(),
                "适合听歌" | "不适合" | "存疑"
            ));
            suitable.insert(item.bvid.as_str(), item.label == "适合听歌");
            videos.push(SearchVideo {
                bvid: item.bvid.clone(),
                title: item.title.clone(),
                duration_seconds: item.duration_seconds,
                uploader: String::new(),
                thumbnail_url: String::new(),
                play_count: None,
                pubdate: None,
            });
        }
        let raw = ids(&videos);
        assert_eq!(
            ids(&rerank_search_results(
                k,
                videos.clone(),
                false,
                SortMode::All
            )),
            raw
        );
        let base = score_search_results(k, videos.clone(), true, SortMode::All, false);
        let new = rerank_search_results(k, videos.clone(), true, SortMode::All);
        let old_order = ids(&base);
        let new_order = ids(&new);
        let mut expected = raw;
        expected.sort_unstable();
        for (i, order) in [&old_order, &new_order].into_iter().enumerate() {
            let mut actual = order.clone();
            actual.sort_unstable();
            assert_eq!(actual, expected, "{k}");
            for (j, limit) in [10, 20].into_iter().enumerate() {
                hits[i][j] += order.iter().take(limit).filter(|id| suitable[**id]).count();
            }
        }
        if query.explicit_intent {
            protected_queries += 1;
            assert_eq!(new_order, old_order, "显式意图查询逐条不变：{k}");
        }
        if matches!(
            k.as_str(),
            "学习纯音乐 一小时" | "游戏原声 歌单" | "跳舞的梵谷"
        ) {
            assert_eq!(new_order, old_order, "{k}");
            unchanged_examples += 1;
        }
        if k == "权御天下" {
            let rank =
                |order: &[&str]| order.iter().position(|id| *id == "BV1aiBqYtEPd").unwrap() + 1;
            mixed_performance = Some((rank(&old_order), rank(&new_order)));
        }
        suitable_dropped += old_order[..10]
            .iter()
            .filter(|id| suitable[**id] && !new_order[..10].contains(id))
            .count();
    }
    assert_eq!(
        (protected_queries, unchanged_examples, mixed_performance),
        (4, 3, Some((11, 19)))
    );
    assert_eq!(suitable_dropped, 0);
    assert!(hits[1][0] >= hits[0][0]);
    assert_eq!(hits, [[375, 700], [379, 700]]);
}

#[test]
fn voucher_is_a_terminal_search_error_even_with_results() {
    for result in [
        serde_json::json!([]),
        serde_json::json!([{"bvid":"BV0000000001"}]),
    ] {
        let env:SearchEnvelope=serde_json::from_value(serde_json::json!({"code":0,"message":"ok","data":{"v_voucher":"synthetic","result":result}})).unwrap();
        assert!(
            matches!(env.data.unwrap().check_search_restriction(), Err(SearchAttemptError::Fatal(message)) if message=="SEARCH_TEMPORARILY_RESTRICTED")
        );
    }
    for data in [r#"{}"#, r#"{"v_voucher":null}"#, r#"{"v_voucher":""}"#] {
        assert!(serde_json::from_str::<SearchData>(data)
            .unwrap()
            .check_search_restriction()
            .is_ok());
    }
}
