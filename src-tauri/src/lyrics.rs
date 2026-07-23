use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde::{Deserialize, Serialize};
use std::time::Duration;

const LYRIC_API_BASE: &str = "https://api.vkeys.cn/v2";
const REQUEST_TIMEOUT_SECS: u64 = 5;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Lyrics {
    pub lrc: String,
    pub trans: String,
    pub has_lyric: bool,
}

#[derive(Deserialize)]
struct LyricApiResponse {
    code: i32,
    #[serde(default)]
    data: Option<LyricApiData>,
}

#[derive(Deserialize)]
struct LyricApiData {
    #[serde(default)]
    lrc: Option<String>,
    #[serde(default)]
    trans: Option<String>,
    #[serde(default)]
    yrc: Option<String>,
    #[serde(default)]
    roma: Option<String>,
}

pub async fn fetch_lyrics_by_id(song_id: String) -> Result<Lyrics, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|error| format!("无法创建歌词请求客户端：{error}"))?;
    let url = format!(
        "{LYRIC_API_BASE}/music/tencent/lyric?id={}",
        utf8_percent_encode(&song_id, NON_ALPHANUMERIC)
    );

    let response = match client.get(&url).send().await {
        Ok(response) => response,
        Err(error) if error.is_timeout() || error.is_connect() || error.is_request() => client
            .get(&url)
            .send()
            .await
            .map_err(|error| format!("歌词请求失败：{error}"))?,
        Err(error) => return Err(format!("歌词请求失败：{error}")),
    };
    if !response.status().is_success() {
        return Ok(no_lyrics());
    }

    let response = response
        .json::<LyricApiResponse>()
        .await
        .map_err(|error| format!("歌词服务响应解析失败：{error}"))?;
    Ok(lyrics_from_response(response))
}

fn lyrics_from_response(response: LyricApiResponse) -> Lyrics {
    let Some(data) = response.data.filter(|_| response.code == 200) else {
        return no_lyrics();
    };
    let lrc = data.lrc.unwrap_or_default();
    if lrc.trim().is_empty() {
        return no_lyrics();
    }
    let _ = (data.yrc, data.roma);
    Lyrics {
        lrc,
        trans: data.trans.unwrap_or_default(),
        has_lyric: true,
    }
}

fn no_lyrics() -> Lyrics {
    Lyrics {
        lrc: String::new(),
        trans: String::new(),
        has_lyric: false,
    }
}

#[tauri::command]
pub async fn get_lyrics_by_id(song_id: String) -> Result<Lyrics, String> {
    fetch_lyrics_by_id(song_id).await
}

#[cfg(test)]
mod tests {
    use super::{lyrics_from_response, LyricApiResponse};

    #[test]
    fn missing_lyrics_is_a_successful_empty_result() {
        for json in [
            r#"{"code":404,"message":"not found"}"#,
            r#"{"code":200,"data":{"lrc":"","trans":null}}"#,
        ] {
            let lyrics =
                lyrics_from_response(serde_json::from_str::<LyricApiResponse>(json).unwrap());
            assert!(!lyrics.has_lyric);
            assert!(lyrics.lrc.is_empty());
            assert!(lyrics.trans.is_empty());
        }
    }
}
