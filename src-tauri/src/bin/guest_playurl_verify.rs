#[path = "../guest_playurl.rs"]
mod guest_playurl;
#[path = "../search.rs"]
mod search;
#[path = "../wbi.rs"]
mod wbi;

use bilibili_music_core::bilibili_cookie_path;
use guest_playurl::GuestPlayurlClient;
use search::SearchClient;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Instant;

const TOOL_VERSION: &str = env!("CARGO_PKG_VERSION");

fn main() {
    if !tauri::async_runtime::block_on(run()) {
        std::process::exit(1);
    }
}

async fn run() -> bool {
    let started = Instant::now();
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let explicit_bvid = args.first().filter(|value| is_valid_bvid(value));
    let guest = match GuestPlayurlClient::new() {
        Ok(guest) => Arc::new(guest),
        Err(error) => {
            print_error("", started.elapsed().as_millis(), &error);
            return false;
        }
    };

    let bvid = if let Some(bvid) = explicit_bvid {
        bvid.clone()
    } else {
        let keyword = if args.is_empty() {
            "阿Test正经比比".to_owned()
        } else {
            args.join(" ")
        };
        let search = match SearchClient::new(bilibili_cookie_path(), Arc::clone(&guest)) {
            Ok(search) => search,
            Err(error) => {
                print_error("", started.elapsed().as_millis(), &error);
                return false;
            }
        };
        match search.search_videos(&keyword).await {
            Ok(results) => match results.first() {
                Some(result) => result.bvid.clone(),
                None => {
                    print_error(
                        "",
                        started.elapsed().as_millis(),
                        &format!("search keyword {keyword:?} returned no videos"),
                    );
                    return false;
                }
            },
            Err(error) => {
                print_error("", started.elapsed().as_millis(), &error);
                return false;
            }
        }
    };

    let resolve_started = Instant::now();
    let result = guest.resolve(&bvid, None, &AtomicBool::new(false)).await;
    let elapsed_ms = resolve_started.elapsed().as_millis();
    match result {
        Ok(audio) => match reqwest::Url::parse(&audio.audio_url)
            .ok()
            .and_then(|url| url.host_str().map(str::to_owned))
        {
            Some(audio_host) => {
                print_field("tool_version", TOOL_VERSION);
                print_field("bvid", &bvid);
                print_field("title", &audio.title);
                print_field("uploader", &audio.uploader);
                print_field("duration_seconds", &audio.duration_seconds.to_string());
                print_field("audio_host", &audio_host);
                print_field("muxed_preview", &audio.muxed_preview.to_string());
                print_field("elapsed_ms", &elapsed_ms.to_string());
                print_field("result", "ok");
                true
            }
            None => {
                print_error(&bvid, elapsed_ms, "resolved audio URL has no valid host");
                false
            }
        },
        Err(error) => {
            print_error(&bvid, elapsed_ms, &error);
            false
        }
    }
}

fn print_error(bvid: &str, elapsed_ms: u128, error: &str) {
    print_field("tool_version", TOOL_VERSION);
    print_field("bvid", bvid);
    print_field("elapsed_ms", &elapsed_ms.to_string());
    print_field("result", "error");
    print_field("error", error);
}

fn print_field(key: &str, value: &str) {
    println!("{key}={}", redact_urls(value));
}

fn redact_urls(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut cursor = 0;

    while cursor < input.len() {
        let remaining = &input[cursor..];
        let next = ["http://", "https://"]
            .iter()
            .filter_map(|scheme| remaining.find(scheme).map(|index| (index, *scheme)))
            .min_by_key(|(index, _)| *index);

        let Some((index, _)) = next else {
            output.push_str(remaining);
            break;
        };
        output.push_str(&remaining[..index]);
        let url_start = cursor + index;
        let suffix = &input[url_start..];
        let url_end = suffix
            .find(|character: char| {
                character.is_whitespace()
                    || matches!(character, ')' | ']' | '}' | '"' | '\'' | '<' | '>' | ',')
            })
            .unwrap_or(suffix.len());
        let candidate = &suffix[..url_end];
        if let Ok(url) = reqwest::Url::parse(candidate) {
            if let Some(host) = url.host_str() {
                output.push_str(url.scheme());
                output.push_str("://");
                output.push_str(host);
                cursor = url_start + url_end;
                continue;
            }
        }
        output.push_str(candidate);
        cursor = url_start + url_end;
    }

    output
}

fn is_valid_bvid(value: &str) -> bool {
    value.len() == 12
        && value.starts_with("BV")
        && value[2..].bytes().all(|byte| byte.is_ascii_alphanumeric())
}

#[cfg(test)]
mod tests {
    use super::redact_urls;

    #[test]
    fn redacts_upos_url_with_query() {
        assert_eq!(
            redact_urls("https://upos-sz-mirrorcos.bilivideo.com/audio.m4s?oi=123&x=y"),
            "https://upos-sz-mirrorcos.bilivideo.com"
        );
    }

    #[test]
    fn redacts_reqwest_error_url() {
        assert_eq!(
            redact_urls("error sending request for url (https://host/path?oi=123&x=y)"),
            "error sending request for url (https://host)"
        );
    }

    #[test]
    fn redacts_multiple_urls_in_one_string() {
        assert_eq!(
            redact_urls("from http://one.test/a to https://two.test/b?q=1"),
            "from http://one.test to https://two.test"
        );
    }

    #[test]
    fn leaves_strings_without_urls_unchanged() {
        assert_eq!(redact_urls("connection timed out"), "connection timed out");
    }
}
