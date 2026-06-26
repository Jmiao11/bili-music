#[path = "../guest_playurl.rs"]
mod guest_playurl;
#[path = "../search.rs"]
mod search;
#[path = "../wbi.rs"]
mod wbi;

use bilibili_music_core::bilibili_cookie_path;
use guest_playurl::{verify_guest_audio_playurl, GuestPlayurlClient};
use search::SearchClient;
use std::sync::Arc;

fn main() {
    if let Err(error) = tauri::async_runtime::block_on(run()) {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), String> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let explicit_bvid = args.first().filter(|value| is_valid_bvid(value)).cloned();
    let search_keyword = if explicit_bvid.is_some() {
        args.get(1).cloned()
    } else if args.is_empty() {
        None
    } else {
        Some(args.join(" "))
    }
    .unwrap_or_else(|| "阿Test正经比比".to_owned());

    let guest = Arc::new(GuestPlayurlClient::new()?);
    let search = SearchClient::new(bilibili_cookie_path(), Arc::clone(&guest))?;
    let results = search.search_videos(&search_keyword).await?;
    println!(
        "search_keyword={search_keyword} search_result_count={}",
        results.len()
    );
    let first = results
        .first()
        .ok_or_else(|| format!("search keyword {search_keyword:?} returned no videos"))?;
    println!(
        "search_first_bvid={} search_first_title={} search_first_uploader={}",
        first.bvid, first.title, first.uploader
    );

    let bvid = explicit_bvid.unwrap_or_else(|| first.bvid.clone());
    let probe = verify_guest_audio_playurl(&bvid).await?;
    println!("guest_bvid={}", probe.bvid);
    println!("guest_buvid3={}", probe.buvid3);
    println!(
        "guest_b_nut={}",
        probe.b_nut.as_deref().unwrap_or("<missing>")
    );
    println!("cid={}", probe.cid);
    println!("title={}", probe.title);
    println!("uploader={}", probe.uploader);
    println!("thumbnail_url={}", probe.thumbnail_url);
    println!("duration_seconds={}", probe.duration_seconds);
    println!("playurl_code={}", probe.playurl_code);
    println!("selected_audio_id={}", probe.selected_audio_id);
    println!(
        "selected_audio_codecs={}",
        probe
            .selected_audio_codecs
            .as_deref()
            .unwrap_or("<unknown>")
    );
    println!("probe_status={}", probe.probe_status);
    println!("probe_bytes={}", probe.probe_bytes);
    Ok(())
}

fn is_valid_bvid(value: &str) -> bool {
    value.len() == 12
        && value.starts_with("BV")
        && value[2..].bytes().all(|byte| byte.is_ascii_alphanumeric())
}
