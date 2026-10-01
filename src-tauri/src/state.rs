use crate::{
    fav_import, GuestPlayurlClient, ProxyState, RankingClient, RankingTrack, ResolveCoordinator,
    SearchClient,
};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tokio::sync::RwLock;

pub(super) struct AppState {
    pub(crate) loudness_busy: Arc<AtomicBool>,
    pub(crate) cache_busy: Arc<AtomicBool>,
    pub(crate) proxy: ProxyState,
    pub(crate) proxy_base_url: String,
    pub(crate) search: SearchClient,
    pub(crate) ranking: RankingClient,
    pub(crate) favorite_import: fav_import::FavoriteImportClient,
    pub(crate) ranking_cache: Arc<RwLock<Option<Vec<RankingTrack>>>>,
    pub(crate) guest: Arc<GuestPlayurlClient>,
    pub(crate) resolver: Arc<ResolveCoordinator>,
    pub(crate) stream_source: Arc<RwLock<StreamSource>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum StreamSource {
    Auto,
    YtDlp,
    Guest,
}

impl StreamSource {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::YtDlp => "yt-dlp",
            Self::Guest => "guest",
        }
    }

    pub(super) fn parse(value: &str) -> Result<Self, String> {
        match value {
            "auto" => Ok(Self::Auto),
            "yt-dlp" => Ok(Self::YtDlp),
            "guest" => Ok(Self::Guest),
            _ => Err(format!("unsupported stream source: {value}")),
        }
    }
}
