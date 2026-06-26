use bilibili_music_core::resolve_bilibili_audio;
use std::env;
use std::process::ExitCode;

fn main() -> ExitCode {
    let Some(bv_id) = env::args().nth(1) else {
        eprintln!("usage: verify <BV_ID>");
        return ExitCode::FAILURE;
    };

    match resolve_bilibili_audio(&bv_id) {
        Ok(info) => {
            println!("AudioUrlResolved: {}", !info.audio_url.is_empty());
            println!("Title: {}", info.title);
            println!("Uploader: {}", info.uploader);
            println!("ThumbnailUrl: {}", info.thumbnail_url);
            println!("DurationSeconds: {}", info.duration_seconds);
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("error: {error}");
            ExitCode::FAILURE
        }
    }
}
