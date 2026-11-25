use crate::library::{self, entries::LibraryEntry, history::PlayHistoryItem};
use crate::lyrics::CachedVideoPages;
use crate::ranking::{RankingTrack, RelatedVideo, MAX_SECONDS, MIN_SECONDS};
use serde::{Deserialize, Serialize};
use std::cmp::Reverse;
use std::collections::{HashMap, HashSet};

const WEEK_MS: u64 = 7 * 24 * 60 * 60 * 1000;
const TRACKS_PER_OWNER: usize = 2;
const MAX_TRACKS: usize = 20;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub(super) struct Seed {
    pub(super) bvid: String,
    pub(super) title: String,
}

pub(super) struct Selection {
    pub(super) seeds: Vec<Seed>,
    excluded: HashSet<String>,
}

struct Candidate<'a> {
    seed: Seed,
    nickname: &'a str,
    mid: Option<u64>,
}

impl<'a> Candidate<'a> {
    fn new(
        bvid: &str,
        title: &str,
        uploader: &'a str,
        seconds: u64,
        last_page: Option<u32>,
        details: &HashMap<String, CachedVideoPages>,
    ) -> Option<Self> {
        let bvid = library::normalize_bvid(bvid).ok()?;
        if last_page.unwrap_or(1) > 1 {
            return None;
        }
        let (duration, mid) = match details.get(&bvid) {
            Some(detail) if detail.videos == 1 => (
                detail
                    .pages
                    .first()
                    .and_then(|page| u64::try_from(page.duration).ok())
                    .filter(|duration| *duration > 0)
                    .unwrap_or(seconds),
                detail.owner.as_ref().map(|owner| owner.mid),
            ),
            Some(_) => return None,
            None => (seconds, None),
        };
        (MIN_SECONDS..=MAX_SECONDS)
            .contains(&duration)
            .then(|| Self {
                seed: Seed {
                    bvid,
                    title: title.to_owned(),
                },
                nickname: match uploader.trim() {
                    "Unknown UP" | "未知 UP 主" => "",
                    nickname => nickname,
                },
                mid,
            })
    }

    fn same_owner(&self, other: &Self) -> bool {
        match (self.mid, other.mid) {
            (Some(left), Some(right)) => left == right,
            _ => !self.nickname.is_empty() && self.nickname == other.nickname,
        }
    }
}

pub(super) fn plan(now: u64, previous: &[Seed]) -> Result<Option<Selection>, String> {
    let history = library::get_play_history()?;
    let favorites = library::list_favorites()?;
    let recent = recent_history(&history, now);
    let favorites: Vec<_> = favorites
        .iter()
        .filter_map(LibraryEntry::video)
        .filter(|favorite| {
            !history.iter().any(|played| {
                played.last_page.unwrap_or(1) > 1
                    && played.bvid.eq_ignore_ascii_case(&favorite.bvid)
            })
        })
        .collect();
    let details = crate::lyrics::get_cached_video_pages(
        recent
            .iter()
            .map(|item| item.bvid.clone())
            .chain(favorites.iter().map(|item| item.bvid.clone()))
            .collect(),
    )?;
    Ok(select(&recent, &favorites, &details, previous))
}

fn recent_history(history: &[PlayHistoryItem], now: u64) -> Vec<&PlayHistoryItem> {
    let window = now.saturating_sub(WEEK_MS)..=now;
    let mut recent: Vec<_> = history
        .iter()
        .filter_map(|item| {
            let at = item.last_played_at.parse::<u64>().ok()?;
            window.contains(&at).then_some((at, item))
        })
        .collect();
    recent.sort_by_key(|(at, _)| Reverse(*at));
    recent.into_iter().map(|(_, item)| item).collect()
}

fn select(
    recent: &[&PlayHistoryItem],
    favorites: &[&library::TrackSnapshot],
    details: &HashMap<String, CachedVideoPages>,
    previous: &[Seed],
) -> Option<Selection> {
    let known = recent.iter().map(|item| {
        Candidate::new(
            &item.bvid,
            &item.title,
            &item.uploader,
            item.duration_seconds,
            item.last_page,
            details,
        )
    });
    // Keep the last known P when a played video also belongs to favorites.
    let favorites = favorites
        .iter()
        .filter(|item| {
            !recent
                .iter()
                .any(|played| played.bvid.eq_ignore_ascii_case(&item.bvid))
        })
        .map(|item| {
            Candidate::new(
                &item.bvid,
                &item.title,
                &item.uploader,
                item.duration_seconds,
                None,
                details,
            )
        });
    let previous: HashSet<_> = previous
        .iter()
        .map(|seed| seed.bvid.to_ascii_lowercase())
        .collect();
    let (unused, used): (Vec<_>, Vec<_>) = known
        .chain(favorites)
        .flatten()
        .partition(|candidate| !previous.contains(&candidate.seed.bvid.to_ascii_lowercase()));
    let mut ordered = unused.into_iter().chain(used);
    let first = ordered.next()?;
    let second = ordered.find(|candidate| {
        !first.seed.bvid.eq_ignore_ascii_case(&candidate.seed.bvid) && !first.same_owner(candidate)
    });
    let seeds: Vec<_> = std::iter::once(first.seed)
        .chain(second.map(|item| item.seed))
        .collect();
    let excluded = recent
        .iter()
        .map(|item| item.bvid.to_ascii_lowercase())
        .chain(seeds.iter().map(|seed| seed.bvid.to_ascii_lowercase()))
        .collect();
    Some(Selection { seeds, excluded })
}

impl Selection {
    pub(super) fn tracks(self, batches: Vec<Vec<RelatedVideo>>) -> Vec<RankingTrack> {
        let mut seen = self.excluded;
        let mut owners = HashMap::new();
        let mut result = Vec::new();
        let mut batches: Vec<_> = batches.into_iter().map(Vec::into_iter).collect();
        let rounds = batches
            .iter()
            .map(ExactSizeIterator::len)
            .max()
            .unwrap_or(0);
        for _ in 0..rounds {
            for (track, mid) in batches
                .iter_mut()
                .filter_map(Iterator::next)
                .filter_map(RelatedVideo::into_track)
            {
                let count = owners.entry(mid).or_insert(0);
                if *count >= TRACKS_PER_OWNER || !seen.insert(track.bvid.to_ascii_lowercase()) {
                    continue;
                }
                result.push(track);
                *count += 1;
                if result.len() == MAX_TRACKS {
                    return result;
                }
            }
        }
        result
    }
}

#[cfg(test)]
mod tests;
