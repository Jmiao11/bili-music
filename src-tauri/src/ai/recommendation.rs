use super::{
    build_taste_profile, filter_known_bvids, generate_search_intents, order_videos_by_bvids,
    read_ai_config, rerank_candidates, AiConfig, SearchIntent,
};
use crate::search::{SearchClient, SearchVideo};
use std::collections::HashMap;
use std::future::Future;
use std::time::Duration;
use tokio::time::{timeout_at, Instant};

#[derive(Clone, Copy)]
struct Budget {
    intents: Duration,
    search: Duration,
    rerank: Duration,
    total: Duration,
}

const BUDGET: Budget = Budget {
    intents: Duration::from_secs(20),
    search: Duration::from_secs(30),
    rerank: Duration::from_secs(20),
    total: Duration::from_secs(75),
};
const INTENT_TIMEOUT: &str = "推荐关键词生成超时，请稍后重试。";

// 只替代外部调用，测试和生产共用预算、候选收集、校验与降级流程。
trait Dependencies: Sync {
    fn intents(
        &self,
        profile: &str,
    ) -> impl Future<Output = Result<Vec<SearchIntent>, String>> + Send;
    fn search(
        &self,
        keyword: &str,
    ) -> impl Future<Output = Result<Vec<SearchVideo>, String>> + Send;
    fn rerank(
        &self,
        profile: &str,
        candidates: &[SearchVideo],
    ) -> impl Future<Output = Result<Vec<String>, String>> + Send;
}

struct RealDependencies<'a> {
    search: &'a SearchClient,
    config: AiConfig,
}

impl Dependencies for RealDependencies<'_> {
    async fn intents(&self, profile: &str) -> Result<Vec<SearchIntent>, String> {
        generate_search_intents(&self.config, profile).await
    }

    async fn search(&self, keyword: &str) -> Result<Vec<SearchVideo>, String> {
        self.search.search_videos(keyword).await
    }

    async fn rerank(
        &self,
        profile: &str,
        candidates: &[SearchVideo],
    ) -> Result<Vec<String>, String> {
        rerank_candidates(&self.config, profile, candidates).await
    }
}

pub(super) async fn generate(
    search: &SearchClient,
    user_hint: Option<String>,
) -> Result<Vec<SearchVideo>, String> {
    let started = Instant::now();
    let deadline = started + BUDGET.total;
    let mut profile = build_taste_profile();
    if let Some(hint) = user_hint
        .as_deref()
        .map(str::trim)
        .filter(|hint| !hint.is_empty())
    {
        if !profile.is_empty() {
            profile.push('\n');
        }
        profile.push_str(&format!(
            "【本次想听】{hint}（请优先按这个方向生成检索关键词）"
        ));
    }
    if profile.is_empty() {
        return Ok(Vec::new());
    }
    // 同一任务使用一个配置快照，避免两次 AI 调用中途切换服务商。
    let config = read_ai_config(&crate::storage::lock_storage()?)?;
    let result = generate_with_dependencies(
        &profile,
        &RealDependencies { search, config },
        deadline,
        BUDGET,
    )
    .await;
    eprintln!(
        "[recommendation] stage=total outcome={} elapsed_ms={} candidates={}",
        if result.is_ok() { "ok" } else { "error" },
        started.elapsed().as_millis(),
        result.as_ref().map_or(0, Vec::len)
    );
    result
}

async fn generate_with_dependencies(
    profile: &str,
    dependencies: &impl Dependencies,
    deadline: Instant,
    budget: Budget,
) -> Result<Vec<SearchVideo>, String> {
    let started = Instant::now();
    if started >= deadline {
        return Err(INTENT_TIMEOUT.to_owned());
    }
    let intents = timeout_at(
        deadline.min(started + budget.intents),
        dependencies.intents(profile),
    )
    .await
    .map_err(|_| INTENT_TIMEOUT.to_owned())??;
    eprintln!(
        "[recommendation] stage=intents outcome=ok elapsed_ms={}",
        started.elapsed().as_millis()
    );
    if intents.is_empty() {
        return Err("AI 未返回有效的推荐关键词，请稍后重试。".to_owned());
    }

    let search_started = Instant::now();
    let search_deadline = deadline.min(search_started + budget.search);
    let mut candidates_by_bvid = HashMap::new();
    for intent in intents.into_iter().take(5) {
        if candidates_by_bvid.len() >= 30 || Instant::now() >= search_deadline {
            break;
        }
        // 所有关键词共享同一个检索截止时间，不能按每个关键词重新领取预算。
        let videos = match timeout_at(search_deadline, dependencies.search(&intent.keyword)).await {
            Ok(Ok(videos)) => videos,
            Ok(Err(_)) => continue,
            Err(_) => break,
        };
        for video in videos {
            if candidates_by_bvid.len() >= 30 {
                break;
            }
            candidates_by_bvid
                .entry(video.bvid.clone())
                .or_insert(video);
        }
    }
    eprintln!(
        "[recommendation] stage=search elapsed_ms={} candidates={}",
        search_started.elapsed().as_millis(),
        candidates_by_bvid.len()
    );
    if candidates_by_bvid.is_empty() {
        return Err("未能获取推荐候选，请稍后重试。".to_owned());
    }
    let mut baseline: Vec<SearchVideo> = candidates_by_bvid.into_values().collect();
    baseline.sort_by(|left, right| {
        right
            .play_count
            .unwrap_or(0)
            .cmp(&left.play_count.unwrap_or(0))
            .then_with(|| left.title.cmp(&right.title))
    });

    let rerank_started = Instant::now();
    if rerank_started >= deadline {
        eprintln!(
            "[recommendation] stage=rerank outcome=budget_fallback candidates={}",
            baseline.len()
        );
        return Ok(baseline);
    }
    let (ordered, outcome) = match timeout_at(
        deadline.min(rerank_started + budget.rerank),
        dependencies.rerank(profile, &baseline),
    )
    .await
    {
        Ok(Ok(bvids)) => (
            filter_known_bvids(bvids, baseline.iter().map(|video| video.bvid.as_str())),
            "ok",
        ),
        Ok(Err(_)) => (Vec::new(), "error_fallback"),
        Err(_) => (Vec::new(), "timeout_fallback"),
    };
    eprintln!(
        "[recommendation] stage=rerank outcome={} elapsed_ms={} candidates={}",
        if ordered.is_empty() && outcome == "ok" {
            "invalid_order_fallback"
        } else {
            outcome
        },
        rerank_started.elapsed().as_millis(),
        baseline.len()
    );
    if ordered.is_empty() {
        Ok(baseline)
    } else {
        Ok(order_videos_by_bvids(baseline, &ordered))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Mutex,
    };

    enum Step<T> {
        Ready(Result<T, String>),
        Pending,
    }
    struct PendingDrop<'a>(&'a AtomicUsize);
    impl Drop for PendingDrop<'_> {
        fn drop(&mut self) {
            self.0.fetch_add(1, Ordering::SeqCst);
        }
    }
    async fn answer<T>(step: Step<T>, dropped: &AtomicUsize) -> Result<T, String> {
        match step {
            Step::Ready(value) => value,
            Step::Pending => {
                let _guard = PendingDrop(dropped);
                std::future::pending().await
            }
        }
    }
    struct Fake {
        intent: Mutex<Option<Step<Vec<SearchIntent>>>>,
        searches: Mutex<VecDeque<Step<Vec<SearchVideo>>>>,
        order: Mutex<Option<Step<Vec<String>>>>,
        dropped: AtomicUsize,
        search_calls: AtomicUsize,
        rerank_calls: AtomicUsize,
    }
    impl Dependencies for Fake {
        async fn intents(&self, _profile: &str) -> Result<Vec<SearchIntent>, String> {
            let step = self.intent.lock().unwrap().take().unwrap();
            answer(step, &self.dropped).await
        }
        async fn search(&self, _keyword: &str) -> Result<Vec<SearchVideo>, String> {
            self.search_calls.fetch_add(1, Ordering::SeqCst);
            let step = self.searches.lock().unwrap().pop_front().unwrap();
            answer(step, &self.dropped).await
        }
        async fn rerank(
            &self,
            _profile: &str,
            _candidates: &[SearchVideo],
        ) -> Result<Vec<String>, String> {
            self.rerank_calls.fetch_add(1, Ordering::SeqCst);
            let step = self.order.lock().unwrap().take().unwrap();
            answer(step, &self.dropped).await
        }
    }
    fn video(id: &str, plays: u64) -> SearchVideo {
        SearchVideo {
            bvid: id.to_owned(),
            title: id.to_owned(),
            uploader: "测试作者".to_owned(),
            thumbnail_url: String::new(),
            duration_seconds: 60,
            play_count: Some(plays),
            pubdate: None,
        }
    }
    fn fake(searches: Vec<Step<Vec<SearchVideo>>>, order: Step<Vec<String>>) -> Fake {
        Fake {
            intent: Mutex::new(Some(Step::Ready(Ok((0..searches.len())
                .map(|index| SearchIntent {
                    keyword: format!("测试{index}"),
                    reason: None,
                })
                .collect())))),
            searches: Mutex::new(searches.into()),
            order: Mutex::new(Some(order)),
            dropped: AtomicUsize::new(0),
            search_calls: AtomicUsize::new(0),
            rerank_calls: AtomicUsize::new(0),
        }
    }
    fn budget() -> Budget {
        Budget {
            intents: Duration::from_millis(10),
            search: Duration::from_millis(10),
            rerank: Duration::from_millis(10),
            total: Duration::from_secs(2),
        }
    }
    fn run(fake: &Fake, budget: Budget) -> Result<Vec<SearchVideo>, String> {
        tauri::async_runtime::block_on(async {
            generate_with_dependencies("合成口味", fake, Instant::now() + budget.total, budget)
                .await
        })
    }

    #[test]
    fn stalled_rerank_returns_real_baseline_and_drops_work() {
        let fake = fake(
            vec![Step::Ready(Ok(vec![video("low", 1), video("high", 100)]))],
            Step::Pending,
        );
        let result = run(&fake, budget()).unwrap();
        assert_eq!(
            result.iter().map(|v| v.bvid.as_str()).collect::<Vec<_>>(),
            ["high", "low"]
        );
        assert_eq!(fake.dropped.load(Ordering::SeqCst), 1);
        assert_eq!(fake.rerank_calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn partial_search_timeout_keeps_candidates_and_can_still_rerank() {
        let fake = fake(
            vec![
                Step::Ready(Ok(vec![video("low", 1), video("high", 100)])),
                Step::Pending,
            ],
            Step::Ready(Ok(vec!["low".to_owned()])),
        );
        let result = run(&fake, budget()).unwrap();
        assert_eq!(
            result.iter().map(|v| v.bvid.as_str()).collect::<Vec<_>>(),
            ["low", "high"]
        );
        assert_eq!(fake.dropped.load(Ordering::SeqCst), 1);
        assert_eq!(fake.search_calls.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn total_budget_exhausted_during_search_skips_rerank() {
        let fake = fake(
            vec![Step::Ready(Ok(vec![video("candidate", 1)])), Step::Pending],
            Step::Pending,
        );
        let budget = Budget {
            intents: Duration::from_secs(2),
            search: Duration::from_secs(2),
            rerank: Duration::from_secs(2),
            total: Duration::from_millis(30),
        };
        let started = std::time::Instant::now();
        assert_eq!(run(&fake, budget).unwrap()[0].bvid, "candidate");
        assert!(started.elapsed() < Duration::from_secs(1));
        assert_eq!(fake.rerank_calls.load(Ordering::SeqCst), 0);
        assert_eq!(fake.dropped.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn rerank_is_bounded_by_the_remaining_total_budget() {
        let fake = fake(
            vec![Step::Ready(Ok(vec![video("candidate", 1)]))],
            Step::Pending,
        );
        let budget = Budget {
            intents: Duration::from_secs(2),
            search: Duration::from_secs(2),
            rerank: Duration::from_secs(2),
            total: Duration::from_millis(30),
        };
        let started = std::time::Instant::now();
        assert_eq!(run(&fake, budget).unwrap()[0].bvid, "candidate");
        assert!(started.elapsed() < Duration::from_secs(1));
        assert_eq!(fake.rerank_calls.load(Ordering::SeqCst), 1);
        assert_eq!(fake.dropped.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn no_candidates_and_intent_timeout_are_errors_and_do_not_start_rerank() {
        let no_candidates = fake(vec![Step::Pending], Step::Pending);
        assert!(run(&no_candidates, budget())
            .unwrap_err()
            .contains("推荐候选"));
        assert_eq!(no_candidates.rerank_calls.load(Ordering::SeqCst), 0);
        let intent_timeout = fake(vec![Step::Ready(Ok(Vec::new()))], Step::Pending);
        *intent_timeout.intent.lock().unwrap() = Some(Step::Pending);
        assert_eq!(run(&intent_timeout, budget()).unwrap_err(), INTENT_TIMEOUT);
        assert_eq!(intent_timeout.search_calls.load(Ordering::SeqCst), 0);
        assert_eq!(intent_timeout.dropped.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn rejected_or_unknown_rerank_uses_baseline_and_invalid_intents_fail() {
        for order in [
            Step::Ready(Err("HTTP 400".to_owned())),
            Step::Ready(Ok(vec!["unknown".to_owned()])),
            Step::Ready(Ok(Vec::new())),
        ] {
            let fake = fake(vec![Step::Ready(Ok(vec![video("candidate", 1)]))], order);
            assert_eq!(run(&fake, budget()).unwrap()[0].bvid, "candidate");
        }
        let fake = fake(Vec::new(), Step::Pending);
        assert!(run(&fake, budget()).unwrap_err().contains("关键词"));
        assert_eq!(fake.rerank_calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn an_already_expired_total_deadline_does_not_start_external_work() {
        let fake = fake(
            vec![Step::Ready(Ok(vec![video("candidate", 1)]))],
            Step::Pending,
        );
        let result = tauri::async_runtime::block_on(async {
            generate_with_dependencies("合成口味", &fake, Instant::now(), budget()).await
        });
        assert_eq!(result.unwrap_err(), INTENT_TIMEOUT);
        assert!(fake.intent.lock().unwrap().is_some());
        assert_eq!(fake.search_calls.load(Ordering::SeqCst), 0);
    }
}
