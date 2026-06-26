use bilibili_music_core::{BILIBILI_REFERER, DESKTOP_USER_AGENT};
use percent_encoding::{utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
use reqwest::header::{ACCEPT_ENCODING, COOKIE, REFERER, USER_AGENT};
use serde::Deserialize;
use std::collections::BTreeMap;
use std::time::Duration;

const NAV_URL: &str = "https://api.bilibili.com/x/web-interface/nav";
pub const WBI_CACHE_TTL: Duration = Duration::from_secs(60 * 60);
const WBI_ENCODE_SET: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'_')
    .remove(b'.')
    .remove(b'~');
const MIXIN_KEY_ENC_TAB: [usize; 64] = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29,
    28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25,
    54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

pub async fn fetch_mixin_key(
    client: &reqwest::Client,
    cookie_header: Option<&str>,
) -> Result<String, String> {
    let mut request = client
        .get(NAV_URL)
        .header(ACCEPT_ENCODING, "identity")
        .header(USER_AGENT, DESKTOP_USER_AGENT)
        .header(REFERER, BILIBILI_REFERER);
    if let Some(cookie_header) = cookie_header.filter(|value| !value.is_empty()) {
        request = request.header(COOKIE, cookie_header);
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("failed to fetch WBI keys: {error}"))?;
    if response.status().as_u16() == 412 {
        return Err("Bilibili rejected the WBI key request with HTTP 412".to_owned());
    }

    let envelope: NavEnvelope = response
        .json()
        .await
        .map_err(|error| format!("invalid WBI key response: {error}"))?;
    if envelope.code != 0 && envelope.code != -101 {
        return Err(format!(
            "failed to fetch WBI keys (code {}): {}",
            envelope.code, envelope.message
        ));
    }
    let wbi = envelope
        .data
        .ok_or_else(|| "WBI key response has no data".to_owned())?
        .wbi_img;
    let img_key = key_from_url(&wbi.img_url)?;
    let sub_key = key_from_url(&wbi.sub_url)?;
    gen_mixin_key(&(img_key + &sub_key))
}

pub fn sign_parameters(mut params: BTreeMap<String, String>, mixin_key: &str, wts: u64) -> String {
    params.insert("wts".to_owned(), wts.to_string());
    let query = params
        .into_iter()
        .map(|(key, value)| {
            let filtered: String = value
                .chars()
                .filter(|character| !"!'()*".contains(*character))
                .collect();
            format!(
                "{}={}",
                utf8_percent_encode(&key, WBI_ENCODE_SET),
                utf8_percent_encode(&filtered, WBI_ENCODE_SET)
            )
        })
        .collect::<Vec<_>>()
        .join("&");
    let digest = format!("{:x}", md5::compute(format!("{query}{mixin_key}")));
    format!("{query}&w_rid={digest}")
}

#[derive(Deserialize)]
struct NavEnvelope {
    code: i64,
    message: String,
    data: Option<NavData>,
}

#[derive(Deserialize)]
struct NavData {
    wbi_img: NavWbiImage,
}

#[derive(Deserialize)]
struct NavWbiImage {
    img_url: String,
    sub_url: String,
}

fn key_from_url(url: &str) -> Result<String, String> {
    let filename = url
        .rsplit('/')
        .next()
        .ok_or_else(|| "WBI key URL has no filename".to_owned())?;
    filename
        .split('.')
        .next()
        .filter(|key| !key.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| "WBI key URL has an empty key".to_owned())
}

pub(crate) fn gen_mixin_key(raw_key: &str) -> Result<String, String> {
    let bytes = raw_key.as_bytes();
    if bytes.len() < 64 {
        return Err("combined WBI key is shorter than 64 bytes".to_owned());
    }

    Ok(MIXIN_KEY_ENC_TAB
        .iter()
        .take(32)
        .map(|index| bytes[*index] as char)
        .collect())
}

#[cfg(test)]
mod tests {
    use super::{gen_mixin_key, sign_parameters, BTreeMap};

    #[test]
    fn generates_documented_mixin_key() {
        let raw = "7cd084941338484aae1ad9425b84077c4932caff0ff746eab6f01bf08b70ac45";
        assert_eq!(
            gen_mixin_key(raw).unwrap(),
            "ea1db124af3c7062474693fa704f4ff8"
        );
    }

    #[test]
    fn generates_documented_wbi_signature() {
        let mut params = BTreeMap::new();
        params.insert("foo".to_owned(), "114".to_owned());
        params.insert("bar".to_owned(), "514".to_owned());
        params.insert("zab".to_owned(), "1919810".to_owned());
        let signed = sign_parameters(params, "ea1db124af3c7062474693fa704f4ff8", 1_702_204_169);
        assert_eq!(
            signed,
            "bar=514&foo=114&wts=1702204169&zab=1919810&w_rid=8f6f2b5b3d485fe1886cec6a0be8c5d4"
        );
    }

    #[test]
    fn encodes_spaces_and_unicode_like_encode_uri_component() {
        let mut params = BTreeMap::new();
        params.insert("bar".to_owned(), "五一四".to_owned());
        params.insert("foo".to_owned(), "one one four".to_owned());
        let signed = sign_parameters(params, "mixin", 1);
        assert!(signed.starts_with("bar=%E4%BA%94%E4%B8%80%E5%9B%9B&foo=one%20one%20four&wts=1&"));
    }
}
