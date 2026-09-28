#[path = "../guest_playurl.rs"]
mod guest_playurl;
#[path = "../search.rs"]
mod search;
#[path = "../wbi.rs"]
mod wbi;

use bilibili_music_core::{bilibili_cookie_path, BILIBILI_REFERER, DESKTOP_USER_AGENT};
use guest_playurl::GuestPlayurlClient;
use reqwest::header::{ACCEPT_ENCODING, COOKIE, ORIGIN, REFERER, SET_COOKIE, USER_AGENT};
use reqwest::redirect::Policy;
use search::SearchClient;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use uuid::Uuid;

const TOOL_VERSION: &str = env!("CARGO_PKG_VERSION");

fn main() {
    if !tauri::async_runtime::block_on(run()) {
        std::process::exit(1);
    }
}

async fn run() -> bool {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if args.first().is_some_and(|arg| arg == "--experiment") {
        experiment(args.get(1).map(String::as_str)).await;
        return true;
    }

    let started = Instant::now();
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

async fn experiment(bvid: Option<&str>) {
    if !bvid.is_some_and(is_valid_bvid) {
        experiment_line("identity=failed");
        experiment_line("error=expected a valid BV identifier after --experiment");
        experiment_line("experiment=done");
        return;
    }
    let bvid = bvid.unwrap();
    let client = match reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(3))
        .timeout(std::time::Duration::from_secs(30))
        .redirect(Policy::none())
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            experiment_line("home_http=error");
            experiment_line("home_cookie_names=");
            identity_failed(&error_chain(&error));
            experiment_line("experiment=done");
            return;
        }
    };

    let mut cookies = BTreeMap::new();
    let home = match request(
        "home",
        client.get("https://www.bilibili.com/"),
        &cookies,
        None,
        false,
    )
    .await
    {
        Ok((status, response)) => {
            let mut home_names = BTreeSet::new();
            for (name, value) in response
                .headers()
                .get_all(SET_COOKIE)
                .iter()
                .filter_map(|value| value.to_str().ok())
                .filter_map(parse_cookie_pair)
            {
                home_names.insert(name.clone());
                if matches!(name.as_str(), "buvid3" | "buvid4" | "b_nut") {
                    cookies.insert(name, value);
                }
            }
            let names = home_names.into_iter().collect::<Vec<_>>().join(",");
            experiment_line(&format!("home_http={status}"));
            experiment_line(&format!("home_cookie_names={names}"));
            Ok(status)
        }
        Err(error) => {
            experiment_line("home_http=error");
            experiment_line("home_cookie_names=");
            Err(error)
        }
    };
    let home_status = match home {
        Ok(status) => status,
        Err(error) => {
            identity_failed(&error);
            experiment_line("experiment=done");
            return;
        }
    };
    if home_status == 412 {
        identity_failed("Bilibili homepage returned HTTP 412");
        experiment_line("experiment=done");
        return;
    }

    let mut identity_partial = false;
    let mut spi_error = None;
    if !cookies.contains_key("buvid3") || !cookies.contains_key("buvid4") {
        match request(
            "spi",
            client.get("https://api.bilibili.com/x/frontend/finger/spi"),
            &cookies,
            None,
            false,
        )
        .await
        {
            Ok((status, response)) => {
                let body = match response.json::<Value>().await {
                    Ok(body) => body,
                    Err(error) => {
                        experiment_line(&format!("spi_http={status} spi_code=-"));
                        identity_partial = true;
                        spi_error = Some(error_chain(&error));
                        Value::Null
                    }
                };
                if !body.is_null() {
                    let code = body
                        .get("code")
                        .and_then(Value::as_i64)
                        .map(|code| code.to_string())
                        .unwrap_or_else(|| "-".to_owned());
                    experiment_line(&format!("spi_http={status} spi_code={code}"));
                    if status == 412 || code != "0" {
                        identity_partial = true;
                        spi_error = Some(if status == 412 {
                            "Bilibili SPI returned HTTP 412".to_owned()
                        } else {
                            format!("SPI returned code {code}")
                        });
                    } else {
                        let data = body.get("data");
                        for (name, key) in [("buvid3", "b_3"), ("buvid4", "b_4")] {
                            if !cookies.contains_key(name) {
                                if let Some(value) = data
                                    .and_then(|data| data.get(key))
                                    .and_then(Value::as_str)
                                    .filter(|value| !value.is_empty())
                                {
                                    cookies.insert(name.to_owned(), value.to_owned());
                                }
                            }
                        }
                    }
                }
            }
            Err(error) => {
                experiment_line("spi_http=error spi_code=-");
                identity_partial = true;
                spi_error = Some(error);
            }
        }
    }
    experiment_line(&format!(
        "identity_cookie_names={}",
        cookies
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>()
            .join(",")
    ));
    if !cookies.contains_key("buvid3") {
        identity_failed(
            spi_error
                .as_deref()
                .unwrap_or("guest identity did not include buvid3"),
        );
        experiment_line("experiment=done");
        return;
    }
    if identity_partial {
        experiment_line("identity=partial");
        if let Some(error) = &spi_error {
            experiment_line(&format!("error={error}"));
        }
    }
    let mixin_key = match request(
        "nav",
        client.get("https://api.bilibili.com/x/web-interface/nav"),
        &cookies,
        None,
        false,
    )
    .await
    {
        Ok((status, response)) => {
            experiment_line(&format!("nav_http={status}"));
            if status == 412 {
                Err("Bilibili nav returned HTTP 412".to_owned())
            } else {
                match response.json::<Value>().await {
                    Ok(body) => mixin_key_from_nav(&body),
                    Err(error) => Err(error_chain(&error)),
                }
            }
        }
        Err(error) => {
            experiment_line("nav_http=error");
            Err(error)
        }
    };
    if let Err(error) = &mixin_key {
        experiment_line(&format!("nav_error={error}"));
    }

    let variants = ['A', 'B', 'C', 'D', 'E', 'F'];
    for (index, variant) in variants.into_iter().enumerate() {
        if index > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
        }
        let needs_signature = matches!(variant, 'C' | 'E');
        let key = if needs_signature {
            match &mixin_key {
                Ok(key) => key.as_str(),
                Err(_) => {
                    experiment_line(&format!(
                        "variant={variant} step=view http=skipped code=- error=WBI key unavailable"
                    ));
                    continue;
                }
            }
        } else {
            ""
        };

        let mut variant_cookies = cookies.clone();
        if matches!(variant, 'D' | 'E') {
            variant_cookies.insert("_uuid".to_owned(), generate_uuid_cookie());
        }
        let referer = if matches!(variant, 'B' | 'E') {
            format!("https://www.bilibili.com/video/{bvid}/")
        } else {
            BILIBILI_REFERER.to_owned()
        };
        let origin = matches!(variant, 'B' | 'E');

        let (step, url) = if variant == 'F' {
            (
                "pagelist",
                format!("https://api.bilibili.com/x/player/pagelist?bvid={bvid}"),
            )
        } else if variant == 'C' || variant == 'E' {
            let params = BTreeMap::from([("bvid".to_owned(), bvid.to_owned())]);
            let signed = wbi::sign_parameters(params, key, unix_seconds());
            (
                "view",
                format!("https://api.bilibili.com/x/web-interface/wbi/view?{signed}"),
            )
        } else {
            (
                "view",
                format!("https://api.bilibili.com/x/web-interface/view?bvid={bvid}"),
            )
        };

        let request_step = if step == "pagelist" {
            "pagelist"
        } else if variant == 'C' || variant == 'E' {
            "wbi/view"
        } else {
            "view"
        };
        let response = request(
            request_step,
            client.get(url),
            &variant_cookies,
            Some(&referer),
            origin,
        )
        .await;
        let (status, body) = match response {
            Ok((status, response)) => match response.json::<Value>().await {
                Ok(body) => (status.to_string(), body),
                Err(error) => {
                    experiment_line(&format!(
                        "variant={variant} step={step} http=error code=- error={}",
                        error_chain(&error)
                    ));
                    continue;
                }
            },
            Err(error) => {
                experiment_line(&format!(
                    "variant={variant} step={step} http=error code=- error={error}"
                ));
                continue;
            }
        };
        let code = body
            .get("code")
            .and_then(Value::as_i64)
            .map(|code| code.to_string())
            .unwrap_or_else(|| "-".to_owned());
        experiment_line(&format!(
            "variant={variant} step={step} http={status} code={code}"
        ));
        if status != "200" || code != "0" {
            continue;
        }
        let cid = if variant == 'F' {
            body.get("data")
                .and_then(Value::as_array)
                .and_then(|pages| pages.first())
                .and_then(|page| page.get("cid"))
                .and_then(Value::as_u64)
        } else {
            body.get("data")
                .and_then(|data| data.get("cid"))
                .and_then(Value::as_u64)
        };
        let Some(cid) = cid else {
            experiment_line(&format!(
                "variant={variant} step=playurl http=skipped code=- error=missing cid"
            ));
            continue;
        };
        let key = match &mixin_key {
            Ok(key) => key,
            Err(_) => {
                experiment_line(&format!(
                    "variant={variant} step=playurl http=skipped code=- error=WBI key unavailable"
                ));
                continue;
            }
        };
        experiment_playurl(
            &client,
            variant,
            bvid,
            cid,
            &variant_cookies,
            &referer,
            origin,
            key,
        )
        .await;
    }
    experiment_line("experiment=done");
}

async fn experiment_playurl(
    client: &reqwest::Client,
    variant: char,
    bvid: &str,
    cid: u64,
    cookies: &BTreeMap<String, String>,
    referer: &str,
    origin: bool,
    mixin_key: &str,
) {
    let params = BTreeMap::from([
        ("bvid".to_owned(), bvid.to_owned()),
        ("cid".to_owned(), cid.to_string()),
        ("fnval".to_owned(), "4048".to_owned()),
        ("fnver".to_owned(), "0".to_owned()),
        ("qn".to_owned(), "0".to_owned()),
    ]);
    let query = wbi::sign_parameters(params, mixin_key, unix_seconds());
    let response = request(
        "playurl",
        client.get(format!(
            "https://api.bilibili.com/x/player/wbi/playurl?{query}"
        )),
        cookies,
        Some(referer),
        origin,
    )
    .await;
    let (status, body) = match response {
        Ok((status, response)) => match response.json::<Value>().await {
            Ok(body) => (status.to_string(), body),
            Err(error) => {
                experiment_line(&format!(
                    "variant={variant} step=playurl http=error code=- audio_tracks=0 candidate_hosts= error={}",
                    error_chain(&error)
                ));
                return;
            }
        },
        Err(error) => {
            experiment_line(&format!(
                "variant={variant} step=playurl http=error code=- audio_tracks=0 candidate_hosts= error={}",
                error
            ));
            return;
        }
    };
    let code = body
        .get("code")
        .and_then(Value::as_i64)
        .map(|code| code.to_string())
        .unwrap_or_else(|| "-".to_owned());
    let audio = body
        .get("data")
        .and_then(|data| data.get("dash"))
        .and_then(|dash| dash.get("audio"))
        .and_then(Value::as_array);
    let audio_tracks = audio.map_or(0, Vec::len);
    let candidate_hosts = audio
        .and_then(|tracks| tracks.first())
        .map(audio_hosts)
        .unwrap_or_default()
        .into_iter()
        .collect::<Vec<_>>()
        .join(",");
    experiment_line(&format!(
        "variant={variant} step=playurl http={status} code={code} audio_tracks={audio_tracks} candidate_hosts={candidate_hosts}"
    ));
}

fn audio_hosts(track: &Value) -> BTreeSet<String> {
    ["baseUrl", "base_url"]
        .iter()
        .filter_map(|key| track.get(key).and_then(Value::as_str))
        .chain(
            ["backupUrl", "backup_url"]
                .iter()
                .filter_map(|key| track.get(key).and_then(Value::as_array))
                .flat_map(|urls| urls.iter().filter_map(Value::as_str)),
        )
        .filter_map(|url| reqwest::Url::parse(url).ok()?.host_str().map(str::to_owned))
        .collect()
}

fn mixin_key_from_nav(body: &Value) -> Result<String, String> {
    let code = body
        .get("code")
        .and_then(Value::as_i64)
        .ok_or_else(|| "nav response has no code".to_owned())?;
    if code != 0 && code != -101 {
        return Err(format!("nav response returned code {code}"));
    }
    let image = body
        .get("data")
        .and_then(|data| data.get("wbi_img"))
        .ok_or_else(|| "nav response has no WBI image data".to_owned())?;
    fn key_from_url(key: &str) -> Result<&str, String> {
        key.rsplit('/')
            .next()
            .and_then(|name| name.split('.').next())
            .filter(|name| !name.is_empty())
            .ok_or_else(|| "nav response has an invalid WBI key URL".to_owned())
    }
    let image_key = key_from_url(
        image
            .get("img_url")
            .and_then(Value::as_str)
            .ok_or_else(|| "nav response has no WBI image URL".to_owned())?,
    )?;
    let sub_key = key_from_url(
        image
            .get("sub_url")
            .and_then(Value::as_str)
            .ok_or_else(|| "nav response has no WBI sub-key URL".to_owned())?,
    )?;
    wbi::gen_mixin_key(&format!("{image_key}{sub_key}"))
}

async fn request(
    step: &str,
    request: reqwest::RequestBuilder,
    cookies: &BTreeMap<String, String>,
    referer: Option<&str>,
    origin: bool,
) -> Result<(u16, reqwest::Response), String> {
    let mut request = request
        .header(ACCEPT_ENCODING, "identity")
        .header(USER_AGENT, DESKTOP_USER_AGENT)
        .header(REFERER, referer.unwrap_or(BILIBILI_REFERER));
    if origin {
        request = request.header(ORIGIN, BILIBILI_REFERER);
    }
    if !cookies.is_empty() {
        request = request.header(COOKIE, cookie_header(cookies));
    }
    let retry = request.try_clone();
    let response = match request.send().await {
        Ok(response) => response,
        Err(error)
            if (error.is_connect() || error.is_timeout() || error.is_request())
                && retry.is_some() =>
        {
            experiment_line(&format!("retry={step}"));
            tokio::time::sleep(std::time::Duration::from_millis(300)).await;
            retry
                .unwrap()
                .send()
                .await
                .map_err(|error| error_chain(&error))?
        }
        Err(error) => return Err(error_chain(&error)),
    };
    let status = response.status().as_u16();
    Ok((status, response))
}

fn error_chain(error: &(dyn std::error::Error + 'static)) -> String {
    let mut message = error.to_string();
    let mut source = error.source();
    while let Some(error) = source {
        message.push_str(" <- ");
        message.push_str(&error.to_string());
        source = error.source();
    }
    message
}

fn parse_cookie_pair(header: &str) -> Option<(String, String)> {
    let (name, value) = header.split(';').next()?.split_once('=')?;
    if !name.is_empty() && !value.is_empty() {
        Some((name.to_owned(), value.to_owned()))
    } else {
        None
    }
}

fn cookie_header(cookies: &BTreeMap<String, String>) -> String {
    cookies
        .iter()
        .map(|(name, value)| format!("{name}={value}"))
        .collect::<Vec<_>>()
        .join("; ")
}

fn generate_uuid_cookie() -> String {
    generate_uuid_cookie_at(Uuid::new_v4(), unix_millis())
}

fn generate_uuid_cookie_at(uuid: Uuid, millis: u128) -> String {
    format!(
        "{}{:05}infoc",
        uuid.hyphenated().to_string().to_uppercase(),
        millis % 100_000
    )
}

fn unix_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn unix_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn identity_failed(error: &str) {
    experiment_line("identity=failed");
    experiment_line(&format!("error={error}"));
}

fn experiment_line(line: &str) {
    let sanitized = redact_urls(line);
    let ascii = sanitized
        .chars()
        .map(|character| if character.is_ascii() { character } else { '?' })
        .collect::<String>();
    println!("{ascii}");
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
    use super::{generate_uuid_cookie_at, redact_urls};
    use uuid::Uuid;

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

    #[test]
    fn uuid_cookie_matches_bilibili_format() {
        let cookie = generate_uuid_cookie_at(
            Uuid::parse_str("12345678-1234-4234-9234-123456789abc").unwrap(),
            7,
        );
        let (uuid, suffix) = cookie.split_at(36);
        assert_eq!(uuid, "12345678-1234-4234-9234-123456789ABC");
        assert_eq!(suffix, "00007infoc");
        assert!(uuid
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() || byte == b'-'));
    }

    #[test]
    fn parses_mixin_key_from_nav_response() {
        let raw = "7cd084941338484aae1ad9425b84077c4932caff0ff746eab6f01bf08b70ac45";
        let body = serde_json::json!({
            "code": 0,
            "data": {
                "wbi_img": {
                    "img_url": format!("https://i0.hdslb.com/bfs/wbi/{}.png", &raw[..32]),
                    "sub_url": format!("https://i0.hdslb.com/bfs/wbi/{}.png", &raw[32..]),
                }
            }
        });
        assert_eq!(
            super::mixin_key_from_nav(&body).unwrap(),
            "ea1db124af3c7062474693fa704f4ff8"
        );
    }
}
