use reqwest::header::{HeaderMap, HeaderValue, ACCEPT};
use serde::{Deserialize, Serialize};
use std::time::Duration;

const LATEST_RELEASE_API: &str = "https://api.github.com/repos/Jmiao11/bili-music/releases/latest";
const RELEASES_PAGE: &str = "https://github.com/Jmiao11/bili-music/releases/latest";

#[derive(Debug, Serialize)]
pub struct AvailableUpdate {
    version: String,
}

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    assets: Vec<ReleaseAsset>,
}

#[derive(Deserialize)]
struct ReleaseAsset {
    name: String,
    state: String,
    size: u64,
}

// Match the stable vMAJOR.MINOR.PATCH tags used by the release workflow.
fn stable_version(tag: &str) -> Option<[u64; 3]> {
    let mut parts = tag.strip_prefix('v').unwrap_or(tag).split('.');
    let mut version = [0; 3];
    for part in &mut version {
        let text = parts.next()?;
        if text.is_empty()
            || !text.bytes().all(|byte| byte.is_ascii_digit())
            || (text.len() > 1 && text.starts_with('0'))
        {
            return None;
        }
        *part = text.parse().ok()?;
    }
    parts.next().is_none().then_some(version)
}

fn available_update(
    release: Release,
    package: &tauri::PackageInfo,
    asset_suffix: &str,
) -> Option<AvailableUpdate> {
    if release.draft || release.prerelease {
        return None;
    }
    let latest = stable_version(&release.tag_name)?;
    let current = [
        package.version.major,
        package.version.minor,
        package.version.patch,
    ];
    if latest < current || (latest == current && package.version.pre.is_empty()) {
        return None;
    }
    let version = release
        .tag_name
        .strip_prefix('v')
        .unwrap_or(&release.tag_name);
    let asset_name = format!("Bili-Music-v{version}-{asset_suffix}");
    release
        .assets
        .iter()
        .any(|asset| asset.name == asset_name && asset.state == "uploaded" && asset.size > 0)
        .then(|| AvailableUpdate {
            version: version.to_owned(),
        })
}

fn platform_asset_suffix() -> Option<&'static str> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => Some("windows-x64.zip"),
        ("macos", "aarch64") => Some("macos-arm64.dmg"),
        ("macos", "x86_64") => Some("macos-x64.dmg"),
        _ => None,
    }
}

#[tauri::command]
pub async fn check_for_update(app: tauri::AppHandle) -> Result<Option<AvailableUpdate>, String> {
    let Some(asset_suffix) = platform_asset_suffix() else {
        return Ok(None);
    };
    let package = app.package_info();
    let result = fetch_update(package, asset_suffix).await;
    if let Err(error) = &result {
        eprintln!("[updates] check failed: {error}");
    }
    result
}

async fn fetch_update(
    package: &tauri::PackageInfo,
    asset_suffix: &str,
) -> Result<Option<AvailableUpdate>, String> {
    let client = update_client(&package.version.to_string())?;
    Ok(fetch_release(&client, LATEST_RELEASE_API)
        .await?
        .and_then(|release| available_update(release, package, asset_suffix)))
}

fn update_client(version: &str) -> Result<reqwest::Client, String> {
    update_client_builder(version)
        .build()
        .map_err(|error| format!("failed to create update client: {error}"))
}

fn update_client_builder(version: &str) -> reqwest::ClientBuilder {
    // A separate anonymous client keeps Bilibili cookies and headers out of GitHub requests.
    let mut headers = HeaderMap::new();
    headers.insert(
        ACCEPT,
        HeaderValue::from_static("application/vnd.github+json"),
    );
    headers.insert(
        "X-GitHub-Api-Version",
        HeaderValue::from_static("2022-11-28"),
    );
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(4))
        .timeout(Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::none())
        .default_headers(headers)
        .user_agent(format!("Bili-Music/{version}"))
}

async fn fetch_release(client: &reqwest::Client, url: &str) -> Result<Option<Release>, String> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("GitHub release request failed: {error}"))?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if response.status() != reqwest::StatusCode::OK {
        return Err(format!(
            "GitHub release request returned {}",
            response.status()
        ));
    }
    let release = response
        .json::<Release>()
        .await
        .map_err(|error| format!("invalid GitHub release response: {error}"))?;
    Ok(Some(release))
}

#[tauri::command]
pub fn open_update_download() -> Result<(), String> {
    // No frontend-supplied URL or release content is passed to the system opener.
    super::runtime::open_url_in_system_browser(RELEASES_PAGE).map_err(|error| {
        eprintln!("[updates] failed to open release page: {error}");
        error
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn available_update_contract_fixture() {
        crate::contract_tests::assert_fixture(
            "available-update",
            &Some(AvailableUpdate {
                version: "0.9.0".into(),
            }),
        );
        assert_eq!(
            serde_json::to_value(None::<AvailableUpdate>).unwrap(),
            serde_json::Value::Null
        );
    }

    #[tokio::test]
    async fn http_status_body_headers_redirect_and_timeout_handling() {
        use axum::{routing::get, Json, Router};
        use reqwest::StatusCode;
        let app = Router::new()
            .route("/latest", get(|headers: HeaderMap| async move {
                assert_eq!(headers["accept"], "application/vnd.github+json");
                assert_eq!(headers["user-agent"], "Bili-Music/0.8.0");
                assert_eq!(headers["x-github-api-version"], "2022-11-28");
                assert!(!headers.contains_key("cookie"));
                assert!(!headers.contains_key("authorization"));
                assert!(!headers.contains_key("referer"));
                Json(serde_json::json!({"tag_name":"v0.9.0","draft":false,"prerelease":false,
                    "assets":[{"name":"Bili-Music-v0.9.0-windows-x64.zip","state":"uploaded","size":1024}]}))
            }))
            .route("/not-found", get(|| async { StatusCode::NOT_FOUND }))
            .route("/limited", get(|| async { StatusCode::FORBIDDEN }))
            .route("/server-error", get(|| async { StatusCode::BAD_GATEWAY }))
            .route("/bad-json", get(|| async { "invalid json" }))
            .route("/incomplete", get(|| async { Json(serde_json::json!({"tag_name":"v0.9.0"})) }))
            .route("/redirect", get(|| async { axum::response::Redirect::temporary("/latest") }))
            .route("/slow", get(|| async { tokio::time::sleep(Duration::from_millis(300)).await; "{}" }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let client = update_client_builder("0.8.0").no_proxy().build().unwrap();
        let release = fetch_release(&client, &format!("{base}/latest"))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            available_update(release, &package("0.8.0"), "windows-x64.zip")
                .unwrap()
                .version,
            "0.9.0"
        );
        assert!(fetch_release(&client, &format!("{base}/not-found"))
            .await
            .unwrap()
            .is_none());
        for path in [
            "limited",
            "server-error",
            "bad-json",
            "incomplete",
            "redirect",
        ] {
            assert!(
                fetch_release(&client, &format!("{base}/{path}"))
                    .await
                    .is_err(),
                "{path}"
            );
        }
        let impatient = reqwest::Client::builder()
            .no_proxy()
            .timeout(Duration::from_millis(20))
            .build()
            .unwrap();
        assert!(fetch_release(&impatient, &format!("{base}/slow"))
            .await
            .is_err());
        server.abort();
        let _ = server.await;
        assert!(fetch_release(&impatient, &format!("{base}/latest"))
            .await
            .is_err());
    }

    fn package(version: &str) -> tauri::PackageInfo {
        tauri::PackageInfo {
            name: "Bili Music".into(),
            version: version.parse().unwrap(),
            authors: "",
            description: "",
            crate_name: "bili-music",
        }
    }

    fn release(tag: &str, suffix: &str) -> Release {
        Release {
            tag_name: tag.into(),
            draft: false,
            prerelease: false,
            assets: vec![ReleaseAsset {
                name: format!("Bili-Music-v{}-{suffix}", tag.trim_start_matches('v')),
                state: "uploaded".into(),
                size: 1024,
            }],
        }
    }

    #[test]
    fn compares_numeric_versions_and_ignores_same_or_older_releases() {
        for (current, latest, expected) in [
            ("0.8.0", "v0.8.1", true),
            ("0.9.0", "v0.10.0", true),
            ("0.8.0", "v1.0.0", true),
            ("0.8.0", "v0.8.0", false),
            ("0.10.0", "v0.9.0", false),
            ("0.8.0+local", "v0.8.0", false),
            ("0.9.0-rc.1", "v0.9.0", true),
        ] {
            assert_eq!(
                available_update(
                    release(latest, "windows-x64.zip"),
                    &package(current),
                    "windows-x64.zip"
                )
                .is_some(),
                expected,
                "{current} -> {latest}"
            );
        }
    }

    #[test]
    fn requires_a_completed_nonempty_build_for_the_current_platform() {
        for suffix in ["windows-x64.zip", "macos-arm64.dmg", "macos-x64.dmg"] {
            let update =
                available_update(release("v0.9.0", suffix), &package("0.8.0"), suffix).unwrap();
            assert_eq!(update.version, "0.9.0");
        }
        let check = |release| available_update(release, &package("0.8.0"), "windows-x64.zip");
        assert!(check(release("v0.9.0", "macos-arm64.dmg")).is_none());
        let mut empty = release("v0.9.0", "windows-x64.zip");
        empty.assets.clear();
        assert!(check(empty).is_none());
        for (state, size) in [("new", 1024), ("uploaded", 0)] {
            let mut incomplete = release("v0.9.0", "windows-x64.zip");
            incomplete.assets[0].state = state.into();
            incomplete.assets[0].size = size;
            assert!(check(incomplete).is_none());
        }
    }

    #[test]
    fn excludes_drafts_prereleases_and_malformed_tags() {
        let check = |release| available_update(release, &package("0.8.0"), "windows-x64.zip");
        let mut draft = release("v0.9.0", "windows-x64.zip");
        draft.draft = true;
        assert!(check(draft).is_none());
        let mut prerelease = release("v0.9.0", "windows-x64.zip");
        prerelease.prerelease = true;
        assert!(check(prerelease).is_none());
        for tag in [
            "v0.9.0-beta.1",
            "v01.0.0",
            "v1.2",
            "v1.2.3.4",
            "v+1.0.0",
            "v1..0",
            "latest",
            "v18446744073709551616.0.0",
        ] {
            assert!(check(release(tag, "windows-x64.zip")).is_none(), "{tag}");
        }
        assert_eq!(stable_version("1.2.3"), Some([1, 2, 3]));
    }
}
