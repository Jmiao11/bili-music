use super::entries::{LibraryCollection, LibraryEntry};
use super::favorites::{favorites_path, read_favorites, write_favorites, FavoriteToggleResult};
use super::playlists::{playlists_path, read_playlists, write_playlists, Playlist};
use serde::Serialize;

#[tauri::command]
pub fn toggle_collection_favorite(
    collection: LibraryCollection,
) -> Result<FavoriteToggleResult, String> {
    collection.validate()?;
    let guard = crate::storage::lock_storage()?;
    let mut file = read_favorites(&guard)?;
    let favorited = if let Some(index) = file
        .items
        .iter()
        .position(|entry| entry.collection_id() == Some(collection.collection_id))
    {
        file.items.remove(index);
        false
    } else {
        file.items
            .insert(0, LibraryEntry::new_collection(collection)?);
        true
    };
    write_favorites(&guard, &favorites_path(&guard)?, &file)?;
    Ok(FavoriteToggleResult {
        favorited,
        items: file.items,
    })
}

#[tauri::command]
pub fn add_collection_to_playlist(
    id: String,
    collection: LibraryCollection,
) -> Result<Vec<Playlist>, String> {
    collection.validate()?;
    let guard = crate::storage::lock_storage()?;
    let mut file = read_playlists(&guard)?;
    let playlist = file
        .playlists
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or("歌单不存在。")?;
    if playlist
        .items
        .iter()
        .any(|entry| entry.collection_id() == Some(collection.collection_id))
    {
        return Err(format!("合集已在歌单“{}”中。", playlist.name));
    }
    playlist
        .items
        .push(LibraryEntry::new_collection(collection)?);
    write_playlists(&guard, &playlists_path(&guard)?, &file)?;
    Ok(file.playlists)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchAddResult {
    pub playlists: Vec<Playlist>,
    pub added: usize,
    pub duplicates: usize,
}

#[tauri::command]
pub fn add_collection_videos_to_playlist(
    id: String,
    collection: LibraryCollection,
) -> Result<BatchAddResult, String> {
    collection.validate()?;
    let guard = crate::storage::lock_storage()?;
    let mut file = read_playlists(&guard)?;
    let playlist = file
        .playlists
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or("歌单不存在。")?;
    let mut added = 0;
    let mut duplicates = 0;
    for mut video in collection.snapshot.items {
        if playlist
            .items
            .iter()
            .any(|entry| entry.is_video(&video.bvid))
        {
            duplicates += 1;
        } else {
            video.added_at = super::now_string();
            playlist.items.push(video.into());
            added += 1;
        }
    }
    if added > 0 {
        write_playlists(&guard, &playlists_path(&guard)?, &file)?;
    }
    Ok(BatchAddResult {
        playlists: file.playlists,
        added,
        duplicates,
    })
}

// Deleting and re-adding creates a new entryId; a late refresh must not resurrect it.
pub(super) fn replace_snapshot(
    entry: &mut LibraryEntry,
    entry_id: &str,
    mut next: LibraryCollection,
) -> Result<bool, String> {
    next.validate()?;
    let LibraryEntry::Collection {
        entry_id: current_id,
        collection,
    } = entry
    else {
        return Ok(false);
    };
    if current_id != entry_id {
        return Ok(false);
    }
    if collection.collection_id != next.collection_id {
        return Err("合集身份不匹配，未更新快照。".to_owned());
    }
    next.added_at = collection.added_at.clone();
    *collection = next;
    Ok(true)
}

#[tauri::command]
pub fn update_collection_entry(
    entry_id: String,
    playlist_id: Option<String>,
    collection: LibraryCollection,
) -> Result<bool, String> {
    collection.validate()?;
    let guard = crate::storage::lock_storage()?;
    if let Some(id) = playlist_id {
        let mut file = read_playlists(&guard)?;
        let Some(entry) = file
            .playlists
            .iter_mut()
            .find(|p| p.id == id)
            .and_then(|p| {
                p.items
                    .iter_mut()
                    .find(|entry| entry.entry_id() == entry_id)
            })
        else {
            return Ok(false);
        };
        let changed = replace_snapshot(entry, &entry_id, collection)?;
        if changed {
            write_playlists(&guard, &playlists_path(&guard)?, &file)?;
        }
        Ok(changed)
    } else {
        let mut file = read_favorites(&guard)?;
        let Some(entry) = file
            .items
            .iter_mut()
            .find(|entry| entry.entry_id() == entry_id)
        else {
            return Ok(false);
        };
        let changed = replace_snapshot(entry, &entry_id, collection)?;
        if changed {
            write_favorites(&guard, &favorites_path(&guard)?, &file)?;
        }
        Ok(changed)
    }
}

#[tauri::command]
pub fn remove_collection_entry(
    entry_id: String,
    playlist_id: Option<String>,
) -> Result<(), String> {
    let guard = crate::storage::lock_storage()?;
    let remove = |items: &mut Vec<LibraryEntry>| {
        items.retain(|entry| entry.entry_id() != entry_id || entry.collection_id().is_none())
    };
    if let Some(id) = playlist_id {
        let mut file = read_playlists(&guard)?;
        let Some(playlist) = file.playlists.iter_mut().find(|p| p.id == id) else {
            return Ok(());
        };
        let before = playlist.items.len();
        remove(&mut playlist.items);
        if before != playlist.items.len() {
            write_playlists(&guard, &playlists_path(&guard)?, &file)?;
        }
    } else {
        let mut file = read_favorites(&guard)?;
        let before = file.items.len();
        remove(&mut file.items);
        if before != file.items.len() {
            write_favorites(&guard, &favorites_path(&guard)?, &file)?;
        }
    }
    Ok(())
}
