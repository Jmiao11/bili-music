use super::*;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

fn response(body: &str) -> String {
    format!(
        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}

async fn server(replies: Vec<String>) -> (String, tokio::task::JoinHandle<Vec<String>>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/detail", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        let mut requests = Vec::new();
        while let Ok(Ok((mut stream, _))) =
            tokio::time::timeout(Duration::from_millis(300), listener.accept()).await
        {
            let mut buffer = vec![0; 4096];
            let size = stream.read(&mut buffer).await.unwrap();
            requests.push(String::from_utf8(buffer[..size].to_vec()).unwrap());
            let reply = replies
                .get(requests.len() - 1)
                .unwrap_or(replies.last().unwrap());
            stream.write_all(reply.as_bytes()).await.unwrap();
        }
        requests
    });
    (url, task)
}

#[tokio::test]
async fn malformed_optional_season_preserves_video_meta_and_lyrics_input() {
    for season in [
        serde_json::Value::Null,
        serde_json::json!(true),
        serde_json::json!("invalid"),
        serde_json::json!({"title":"合集","ep_count":2,"sections":[]}),
        serde_json::json!({"id":42,"title":"合集","sections":[]}),
        serde_json::json!({"id":"42","title":"合集","ep_count":2,"sections":[]}),
        serde_json::json!({"id":42,"title":"合集","ep_count":"2","sections":[]}),
        serde_json::json!({"id":42,"title":"合集","ep_count":2,"sections":"invalid"}),
        serde_json::json!({"id":42,"title":"合集","ep_count":2,"sections":[{"episodes":[]}]}),
        serde_json::json!({"id":42,"title":"合集","ep_count":2,"sections":[{"episodes":[{}]}]}),
    ] {
        let detail = serde_json::from_value(serde_json::json!({
            "code":0,"data":{
                "View":{"title":"纯音乐标题","desc":"原简介","duration":180,"videos":2,
                    "pages":[{"cid":456,"page":1,"part":"原分P","duration":123}],
                    "ugc_season":season,"owner":{"name":123}},
                "Tags":[{"tag_type":"bgm","tag_name":"发现《原歌曲》"}]
            }
        }))
        .unwrap();
        let meta = video_meta_from_response(detail).unwrap();
        assert!(meta.collection.is_none(), "{season}");
        assert_eq!(meta.duration, 180);
        assert_eq!((meta.pages.len(), meta.pages[0].page), (1, 1));
        let input = lyric_match_input(meta, 456);
        assert_eq!(input.title, "纯音乐标题");
        assert_eq!(input.desc, "原简介");
        assert_eq!(input.bgm_name.as_deref(), Some("原歌曲"));
        assert_eq!(input.videos, 2);
        assert_eq!(input.page_part.as_deref(), Some("原分P"));
        assert_eq!(input.page_duration, 123);
        assert_eq!(match_song(input).await.unwrap().confidence, "skip");
    }
}

// Request counts and messages below are the behavior of 26818b12's fetch_video_meta.
#[tokio::test]
async fn legacy_metadata_invalid_bv_reaches_upstream_with_original_error() {
    let (url, requests) = server(vec![response(r#"{"code":-400,"message":"旧接口错误"}"#)]).await;
    let client = video_detail_client().unwrap();
    assert_eq!(
        fetch_view_detail(&client, "invalid BV")
            .await
            .err()
            .unwrap(),
        "无效的 BV 号"
    );
    let error = fetch_video_meta_url(&client, &video_detail_url(&url, "invalid BV"))
        .await
        .err()
        .unwrap();
    assert_eq!(error, "B站视频元数据接口返回错误（code -400）：旧接口错误");
    let requests = requests.await.unwrap();
    assert_eq!(requests.len(), 1);
    assert!(requests[0].starts_with("GET /detail?bvid=invalid%20BV "));
}

#[tokio::test]
async fn legacy_metadata_json_failures_preserve_original_retry_counts_and_messages() {
    let truncated =
        "HTTP/1.1 200 OK\r\nContent-Length: 1000\r\nConnection: close\r\n\r\n{".to_owned();
    for (reply, expected_error) in [
        (
            response("{"),
            "视频元数据响应解析失败：error decoding response body",
        ),
        (
            truncated,
            "视频元数据响应解析失败：error decoding response body",
        ),
        (
            response(r#"{"code":-412,"message":"旧风控错误"}"#),
            "B站视频元数据接口返回错误（code -412）：旧风控错误",
        ),
    ] {
        let (url, requests) = server(vec![reply]).await;
        let error = fetch_video_meta_url(&video_detail_client().unwrap(), &url)
            .await
            .err()
            .unwrap();
        let expected = if expected_error.starts_with("视频元数据响应解析失败：") {
            format!("{expected_error} for url ({url})")
        } else {
            expected_error.to_owned()
        };
        assert_eq!(error, expected);
        assert_eq!(requests.await.unwrap().len(), 1);
    }
}

#[tokio::test]
async fn legacy_metadata_body_timeout_retries_once_then_preserves_original_error() {
    for recover in [true, false] {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/detail", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let mut requests = Vec::new();
            for attempt in 0..2 {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut buffer = [0; 4096];
                let size = stream.read(&mut buffer).await.unwrap();
                requests.push(String::from_utf8(buffer[..size].to_vec()).unwrap());
                if recover && attempt == 1 {
                    stream
                        .write_all(response(r#"{"code":0,"data":{"View":{}}}"#).as_bytes())
                        .await
                        .unwrap();
                } else {
                    stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 1000\r\nConnection: close\r\n\r\n{").await.unwrap();
                    tokio::time::sleep(Duration::from_millis(600)).await;
                }
            }
            requests
        });
        let client = reqwest::Client::builder()
            .timeout(Duration::from_millis(500))
            .build()
            .unwrap();
        let result = fetch_video_meta_url(&client, &url).await;
        if recover {
            assert!(result.is_ok());
        } else {
            assert_eq!(
                result.err().unwrap(),
                format!("视频元数据响应解析失败：error decoding response body for url ({url})")
            );
        }
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(3), server)
                .await
                .unwrap()
                .unwrap()
                .len(),
            2
        );
    }
}

#[tokio::test]
async fn collection_detail_body_failure_and_risk_code_are_not_retried() {
    for (reply, message) in [
        (
            "HTTP/1.1 200 OK\r\nContent-Length: 1000\r\nConnection: close\r\n\r\n{".to_owned(),
            "视频详情响应无法解析",
        ),
        (
            response(r#"{"code":-412,"message":"fixture"}"#),
            "B站拒绝了视频详情请求（code -412），请稍后再试",
        ),
    ] {
        let (url, requests) = server(vec![reply]).await;
        assert_eq!(
            fetch_view_detail_url(&video_detail_client().unwrap(), &url)
                .await
                .err()
                .unwrap(),
            message
        );
        assert_eq!(requests.await.unwrap().len(), 1);
    }
}

#[tokio::test]
async fn video_detail_client_is_independent_cookie_free_and_times_out_at_eight_seconds() {
    fn bvid_only_command<F, R>(_: F)
    where
        F: Fn(String) -> R,
    {
    }
    bvid_only_command(crate::commands::media::get_video_meta);
    let client = video_detail_client().unwrap();
    let request = video_detail_request(&client, "http://127.0.0.1/detail")
        .build()
        .unwrap();
    assert!(!request.headers().contains_key(reqwest::header::COOKIE));
    assert_eq!(
        request.headers()[reqwest::header::USER_AGENT],
        bilibili_music_core::DESKTOP_USER_AGENT
    );
    assert_eq!(
        request.headers()[reqwest::header::REFERER],
        bilibili_music_core::BILIBILI_REFERER
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/detail", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut buffer = [0; 4096];
        stream.read(&mut buffer).await.unwrap();
        tokio::time::sleep(Duration::from_secs(30)).await;
    });
    let started = std::time::Instant::now();
    let error = tokio::time::timeout(
        Duration::from_secs(12),
        video_detail_request(&client, &url).send(),
    )
    .await
    .unwrap()
    .unwrap_err();
    assert!(error.is_timeout());
    assert!(started.elapsed() >= Duration::from_secs(8));
    server.abort();
}
