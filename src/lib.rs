use serde::Deserialize;
use std::env;
use std::error::Error;
use std::fmt;
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub const BILIBILI_REFERER: &str = "https://www.bilibili.com";
pub const DESKTOP_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) \
AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const RESULT_PREFIX: &str = "__BILIBILI_AUDIO_RESULT__=";
const STREAM_RESULT_PREFIX: &str = "__BILIBILI_AUDIO_STREAM__=";

pub fn bilibili_cookie_path() -> PathBuf {
    if cfg!(debug_assertions) {
        return PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("cookies.txt");
    }

    let executable_directory = env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_owned))
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")));
    executable_directory.join("cookies.txt")
}

pub fn yt_dlp_path() -> PathBuf {
    let executable_name = if cfg!(windows) {
        "yt-dlp.exe"
    } else {
        "yt-dlp"
    };

    if cfg!(debug_assertions) {
        return PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tools")
            .join(executable_name);
    }

    let executable_directory = env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_owned))
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")));
    if let Some(path) = env::var_os("YT_DLP_PATH") {
        let path = PathBuf::from(path);
        return if path.is_absolute() {
            path
        } else {
            executable_directory.join(path)
        };
    }

    executable_directory.join(executable_name)
}

#[derive(Debug)]
pub struct AudioInfo {
    pub audio_file_path: PathBuf,
    pub title: String,
    pub uploader: String,
    pub thumbnail_url: String,
    pub duration_seconds: f64,
}

#[derive(Debug)]
pub struct StreamAudioInfo {
    pub audio_url: String,
    pub title: String,
    pub uploader: String,
    pub thumbnail_url: String,
    pub duration_seconds: f64,
}

#[derive(Debug)]
pub enum AudioError {
    InvalidBvId(String),
    CookieFileNotFound(PathBuf),
    CookieMissingSession,
    CookieExpired,
    CookieUnreadable(io::Error),
    WorkingDirectoryUnavailable(io::Error),
    YtDlpNotFound,
    YtDlpSpawnFailed(io::Error),
    YtDlpOutputReadFailed(io::Error),
    Cancelled,
    CookieRejected,
    YtDlpFailed { code: Option<i32>, details: String },
    InvalidMetadata(String),
    AudioFileMissing(PathBuf),
}

impl fmt::Display for AudioError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidBvId(id) => write!(f, "invalid Bilibili BV ID: {id}"),
            Self::CookieFileNotFound(path) => write!(
                f,
                "Bilibili cookie file not found: {}. Export cookies.txt while logged in.",
                path.display()
            ),
            Self::CookieMissingSession => write!(
                f,
                "Bilibili cookie is invalid: SESSDATA is missing. Export cookies.txt again while logged in."
            ),
            Self::CookieExpired => write!(
                f,
                "Bilibili cookie has expired. Export cookies.txt again while logged in."
            ),
            Self::CookieUnreadable(error) => {
                write!(f, "failed to read Bilibili cookie file: {error}")
            }
            Self::WorkingDirectoryUnavailable(error) => {
                write!(f, "failed to resolve the output directory: {error}")
            }
            Self::YtDlpNotFound => write!(
                f,
                "yt-dlp was not found. Set YT_DLP_PATH or place yt-dlp beside the executable."
            ),
            Self::YtDlpSpawnFailed(error) => write!(f, "failed to start yt-dlp: {error}"),
            Self::YtDlpOutputReadFailed(error) => {
                write!(f, "failed to read yt-dlp output: {error}")
            }
            Self::Cancelled => write!(f, "audio resolution was cancelled"),
            Self::CookieRejected => write!(
                f,
                "Bilibili rejected the cookie (HTTP 412 or login required). Export a fresh cookies.txt while logged in."
            ),
            Self::YtDlpFailed { code, details } => {
                write!(f, "yt-dlp failed with exit code {code:?}: {details}")
            }
            Self::InvalidMetadata(details) => {
                write!(f, "yt-dlp returned invalid audio metadata: {details}")
            }
            Self::AudioFileMissing(path) => write!(
                f,
                "yt-dlp reported success but the audio file was not found: {}",
                path.display()
            ),
        }
    }
}

impl Error for AudioError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::CookieUnreadable(error)
            | Self::WorkingDirectoryUnavailable(error)
            | Self::YtDlpSpawnFailed(error)
            | Self::YtDlpOutputReadFailed(error) => Some(error),
            _ => None,
        }
    }
}

#[derive(Debug, Deserialize)]
struct YtDlpAudioInfo {
    audio_file_path: PathBuf,
    title: String,
    uploader: String,
    thumbnail_url: String,
    duration_seconds: f64,
}

#[derive(Debug, Deserialize)]
struct YtDlpStreamAudioInfo {
    audio_url: String,
    title: String,
    uploader: String,
    thumbnail_url: String,
    duration_seconds: f64,
}

pub fn download_bilibili_audio(bv_id: &str) -> Result<AudioInfo, AudioError> {
    let bv_id = bv_id.trim();
    if !is_valid_bv_id(bv_id) {
        return Err(AudioError::InvalidBvId(bv_id.to_owned()));
    }

    let working_directory = env::current_dir().map_err(AudioError::WorkingDirectoryUnavailable)?;
    let cookie_path = bilibili_cookie_path();
    validate_cookie(&cookie_path)?;

    let output_template = working_directory.join("%(title).200B [%(id)s].%(ext)s");
    let result_template = format!(
        "after_move:{RESULT_PREFIX}{{\"audio_file_path\":%(filepath)j,\"title\":%(title)j,\"uploader\":%(uploader)j,\"thumbnail_url\":%(thumbnail)j,\"duration_seconds\":%(duration)j}}"
    );
    let video_url = format!("https://www.bilibili.com/video/{bv_id}");

    let mut command = configured_yt_dlp(&cookie_path);
    command
        .arg("--format")
        .arg("bestaudio")
        .arg("--no-playlist")
        .arg("--quiet")
        .arg("--output")
        .arg(output_template)
        .arg("--print")
        .arg(result_template)
        .arg(video_url);

    let stdout = run_yt_dlp(&mut command)?;

    let json = stdout
        .lines()
        .rev()
        .find_map(|line| line.strip_prefix(RESULT_PREFIX))
        .ok_or_else(|| AudioError::InvalidMetadata("result line is missing".to_owned()))?;

    let parsed: YtDlpAudioInfo = serde_json::from_str(json)
        .map_err(|error| AudioError::InvalidMetadata(error.to_string()))?;

    if !parsed.audio_file_path.is_file() {
        return Err(AudioError::AudioFileMissing(parsed.audio_file_path));
    }

    Ok(AudioInfo {
        audio_file_path: parsed.audio_file_path,
        title: parsed.title,
        uploader: parsed.uploader,
        thumbnail_url: parsed.thumbnail_url,
        duration_seconds: parsed.duration_seconds,
    })
}

pub fn resolve_bilibili_audio(bv_id: &str) -> Result<StreamAudioInfo, AudioError> {
    let cancellation = AtomicBool::new(false);
    resolve_bilibili_audio_cancellable(bv_id, &cancellation)
}

pub fn resolve_bilibili_audio_cancellable(
    bv_id: &str,
    cancellation: &AtomicBool,
) -> Result<StreamAudioInfo, AudioError> {
    let bv_id = bv_id.trim();
    if !is_valid_bv_id(bv_id) {
        return Err(AudioError::InvalidBvId(bv_id.to_owned()));
    }

    let cookie_path = bilibili_cookie_path();
    validate_cookie(&cookie_path)?;

    let result_template = format!(
        "{STREAM_RESULT_PREFIX}{{\"audio_url\":%(url)j,\"title\":%(title)j,\"uploader\":%(uploader)j,\"thumbnail_url\":%(thumbnail)j,\"duration_seconds\":%(duration)j}}"
    );
    let video_url = format!("https://www.bilibili.com/video/{bv_id}");

    let mut command = configured_yt_dlp(&cookie_path);
    command
        .arg("--format")
        .arg("bestaudio")
        .arg("--no-playlist")
        .arg("--skip-download")
        .arg("--quiet")
        .arg("--print")
        .arg(result_template)
        .arg(video_url);

    let stdout = run_yt_dlp_cancellable(&mut command, cancellation)?;
    let json = stdout
        .lines()
        .rev()
        .find_map(|line| line.strip_prefix(STREAM_RESULT_PREFIX))
        .ok_or_else(|| AudioError::InvalidMetadata("stream result line is missing".to_owned()))?;

    let parsed: YtDlpStreamAudioInfo = serde_json::from_str(json)
        .map_err(|error| AudioError::InvalidMetadata(error.to_string()))?;

    if parsed.audio_url.trim().is_empty() {
        return Err(AudioError::InvalidMetadata(
            "audio stream URL is missing".to_owned(),
        ));
    }

    Ok(StreamAudioInfo {
        audio_url: parsed.audio_url,
        title: parsed.title,
        uploader: parsed.uploader,
        thumbnail_url: parsed.thumbnail_url,
        duration_seconds: parsed.duration_seconds,
    })
}

fn configured_yt_dlp(cookie_path: &Path) -> Command {
    let mut command = Command::new(yt_dlp_path());
    command
        .arg("--add-header")
        .arg(format!("Referer:{BILIBILI_REFERER}"))
        .arg("--add-header")
        .arg(format!("User-Agent:{DESKTOP_USER_AGENT}"))
        .arg("--cookies")
        .arg(cookie_path);
    command
}

fn run_yt_dlp(command: &mut Command) -> Result<String, AudioError> {
    let output = command.output().map_err(|error| {
        if error.kind() == io::ErrorKind::NotFound {
            AudioError::YtDlpNotFound
        } else {
            AudioError::YtDlpSpawnFailed(error)
        }
    })?;

    evaluate_yt_dlp_output(output.status, &output.stdout, &output.stderr)
}

fn run_yt_dlp_cancellable(
    command: &mut Command,
    cancellation: &AtomicBool,
) -> Result<String, AudioError> {
    if cancellation.load(Ordering::Acquire) {
        return Err(AudioError::Cancelled);
    }

    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|error| {
        if error.kind() == io::ErrorKind::NotFound {
            AudioError::YtDlpNotFound
        } else {
            AudioError::YtDlpSpawnFailed(error)
        }
    })?;
    let stdout = child
        .stdout
        .take()
        .expect("piped yt-dlp stdout must be available");
    let stderr = child
        .stderr
        .take()
        .expect("piped yt-dlp stderr must be available");
    let stdout_reader = thread::spawn(move || read_all(stdout));
    let stderr_reader = thread::spawn(move || read_all(stderr));

    let status = loop {
        if cancellation.load(Ordering::Acquire) {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            return Err(AudioError::Cancelled);
        }

        match child.try_wait().map_err(AudioError::YtDlpSpawnFailed)? {
            Some(status) => break status,
            None => thread::sleep(Duration::from_millis(25)),
        }
    };

    let stdout = join_output_reader(stdout_reader)?;
    let stderr = join_output_reader(stderr_reader)?;
    evaluate_yt_dlp_output(status, &stdout, &stderr)
}

fn read_all(mut reader: impl Read) -> io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    reader.read_to_end(&mut bytes)?;
    Ok(bytes)
}

fn join_output_reader(
    reader: thread::JoinHandle<io::Result<Vec<u8>>>,
) -> Result<Vec<u8>, AudioError> {
    reader
        .join()
        .map_err(|_| {
            AudioError::InvalidMetadata("yt-dlp output reader stopped unexpectedly".to_owned())
        })?
        .map_err(AudioError::YtDlpOutputReadFailed)
}

fn evaluate_yt_dlp_output(
    status: ExitStatus,
    stdout_bytes: &[u8],
    stderr_bytes: &[u8],
) -> Result<String, AudioError> {
    let stdout = String::from_utf8_lossy(stdout_bytes);
    let stderr = String::from_utf8_lossy(stderr_bytes);

    if !status.success() {
        let details = format!("{stdout}\n{stderr}").trim().to_owned();
        #[cfg(debug_assertions)]
        eprintln!(
            "[yt-dlp] exited with code {:?}; raw output:\n{}",
            status.code(),
            details
        );
        let lowercase_details = details.to_ascii_lowercase();
        if details.contains("HTTP Error 412")
            || details.contains("Precondition Failed")
            || lowercase_details.contains("sign in")
            || lowercase_details.contains("login required")
            || lowercase_details.contains("cookie")
        {
            return Err(AudioError::CookieRejected);
        }

        return Err(AudioError::YtDlpFailed {
            code: status.code(),
            details,
        });
    }

    Ok(stdout.into_owned())
}

fn is_valid_bv_id(value: &str) -> bool {
    value.len() == 12
        && value.starts_with("BV")
        && value[2..].bytes().all(|byte| byte.is_ascii_alphanumeric())
}

fn validate_cookie(path: &Path) -> Result<(), AudioError> {
    if !path.is_file() {
        return Err(AudioError::CookieFileNotFound(path.to_owned()));
    }

    let contents = fs::read_to_string(path).map_err(AudioError::CookieUnreadable)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    validate_cookie_contents(&contents, now)
}

fn validate_cookie_contents(contents: &str, now: u64) -> Result<(), AudioError> {
    let session = contents.lines().find_map(parse_session_cookie);
    let (expires_at, value) = session.ok_or(AudioError::CookieMissingSession)?;

    if value.trim().is_empty() {
        return Err(AudioError::CookieMissingSession);
    }

    if expires_at != 0 && expires_at <= now {
        return Err(AudioError::CookieExpired);
    }

    Ok(())
}

fn parse_session_cookie(line: &str) -> Option<(u64, &str)> {
    let line = if let Some(value) = line.strip_prefix("#HttpOnly_") {
        value
    } else if line.starts_with('#') {
        return None;
    } else {
        line
    };

    let fields: Vec<&str> = line.split('\t').collect();
    if fields.len() < 7 || !fields[0].ends_with("bilibili.com") || fields[5] != "SESSDATA" {
        return None;
    }

    let expires_at = fields[4].parse().ok()?;
    Some((expires_at, fields[6]))
}

#[cfg(test)]
mod tests {
    use super::{
        bilibili_cookie_path, is_valid_bv_id, run_yt_dlp_cancellable, validate_cookie_contents,
        yt_dlp_path, AudioError,
    };
    use std::path::PathBuf;
    use std::process::Command;
    use std::sync::atomic::AtomicBool;

    #[test]
    fn validates_bv_id_shape() {
        assert!(is_valid_bv_id("BV1LAjP61EbF"));
        assert!(!is_valid_bv_id("BV1xxxxxxx"));
        assert!(!is_valid_bv_id("https://www.bilibili.com"));
    }

    #[test]
    fn debug_runtime_paths_do_not_depend_on_working_directory() {
        let project_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        assert_eq!(bilibili_cookie_path(), project_root.join("cookies.txt"));
        assert_eq!(
            yt_dlp_path(),
            project_root.join("tools").join(if cfg!(windows) {
                "yt-dlp.exe"
            } else {
                "yt-dlp"
            })
        );
    }

    #[test]
    fn rejects_cookie_without_session() {
        let result =
            validate_cookie_contents(".bilibili.com\tTRUE\t/\tFALSE\t0\tbuvid3\tvalue", 100);
        assert!(matches!(result, Err(AudioError::CookieMissingSession)));
    }

    #[test]
    fn rejects_expired_session_cookie() {
        let cookie = "#HttpOnly_.bilibili.com\tTRUE\t/\tFALSE\t99\tSESSDATA\tvalue";
        let result = validate_cookie_contents(cookie, 100);
        assert!(matches!(result, Err(AudioError::CookieExpired)));
    }

    #[test]
    fn skips_starting_yt_dlp_when_already_cancelled() {
        let cancelled = AtomicBool::new(true);
        let mut command = Command::new("an-executable-that-does-not-exist");
        let result = run_yt_dlp_cancellable(&mut command, &cancelled);
        assert!(matches!(result, Err(AudioError::Cancelled)));
    }
}
