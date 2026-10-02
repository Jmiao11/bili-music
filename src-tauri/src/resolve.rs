use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

pub(crate) const AUDIO_RESOLUTION_CANCELLED: &str = "audio resolution was cancelled";

#[derive(Default)]
pub(crate) struct ResolveCoordinator {
    next_id: AtomicU64,
    current: Mutex<Option<ResolveJob>>,
}

pub(crate) struct ResolveJob {
    pub(crate) id: u64,
    pub(crate) cancellation: Arc<AtomicBool>,
}

impl ResolveCoordinator {
    pub(crate) fn begin(&self) -> ResolveJob {
        let job = ResolveJob {
            id: self.next_id.fetch_add(1, Ordering::Relaxed),
            cancellation: Arc::new(AtomicBool::new(false)),
        };
        let mut current = self.current.lock().expect("resolve coordinator poisoned");
        if let Some(previous) = current.replace(ResolveJob {
            id: job.id,
            cancellation: job.cancellation.clone(),
        }) {
            previous.cancellation.store(true, Ordering::Release);
        }
        job
    }

    pub(crate) fn cancel_current(&self) {
        if let Some(job) = self
            .current
            .lock()
            .expect("resolve coordinator poisoned")
            .take()
        {
            job.cancellation.store(true, Ordering::Release);
        }
    }

    pub(crate) fn is_current(&self, id: u64) -> bool {
        self.current
            .lock()
            .expect("resolve coordinator poisoned")
            .as_ref()
            .is_some_and(|job| job.id == id && !job.cancellation.load(Ordering::Acquire))
    }

    pub(crate) fn finish(&self, id: u64) {
        let mut current = self.current.lock().expect("resolve coordinator poisoned");
        if current.as_ref().is_some_and(|job| job.id == id) {
            current.take();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::ResolveCoordinator;
    use std::sync::atomic::Ordering;

    #[test]
    fn newer_resolution_cancels_and_supersedes_the_previous_one() {
        let coordinator = ResolveCoordinator::default();
        let first = coordinator.begin();
        let second = coordinator.begin();

        assert!(first.cancellation.load(Ordering::Acquire));
        assert!(!coordinator.is_current(first.id));
        assert!(coordinator.is_current(second.id));

        coordinator.finish(first.id);
        assert!(coordinator.is_current(second.id));
        coordinator.cancel_current();
        assert!(!coordinator.is_current(second.id));
        assert!(second.cancellation.load(Ordering::Acquire));
    }

    #[test]
    fn coordinator_old_finish_after_new_begin_keeps_new_job() {
        let coordinator = std::sync::Arc::new(ResolveCoordinator::default());
        let (started, ready) = std::sync::mpsc::channel();
        let (release, proceed) = std::sync::mpsc::channel();
        let old = coordinator.clone();
        let thread = std::thread::spawn(move || {
            let job = old.begin();
            started.send(job.id).unwrap();
            proceed.recv().unwrap();
            old.finish(job.id);
        });
        let old_id = ready.recv().unwrap();
        let new = coordinator.begin();
        assert!(!coordinator.is_current(old_id));
        release.send(()).unwrap();
        thread.join().unwrap();
        assert!(coordinator.is_current(new.id));
    }

    #[test]
    fn coordinator_cancel_between_current_checks_invalidates_job() {
        let coordinator = std::sync::Arc::new(ResolveCoordinator::default());
        let job = coordinator.begin();
        let (release, proceed) = std::sync::mpsc::channel();
        let worker = coordinator.clone();
        let thread = std::thread::spawn(move || {
            proceed.recv().unwrap();
            worker.cancel_current();
        });
        assert!(coordinator.is_current(job.id));
        release.send(()).unwrap();
        thread.join().unwrap();
        assert!(!coordinator.is_current(job.id));
        assert!(job.cancellation.load(Ordering::Acquire));
    }

    #[test]
    fn coordinator_two_threads_begin_supersedes_first_job() {
        let coordinator = std::sync::Arc::new(ResolveCoordinator::default());
        let (started, ready) = std::sync::mpsc::channel();
        let (release, proceed) = std::sync::mpsc::channel();
        let first = coordinator.clone();
        let thread = std::thread::spawn(move || {
            let job = first.begin();
            started.send(job.id).unwrap();
            proceed.recv().unwrap();
            assert!(job.cancellation.load(Ordering::Acquire));
            assert!(!first.is_current(job.id));
        });
        let first_id = ready.recv().unwrap();
        let second = coordinator.clone();
        let next = std::thread::spawn(move || second.begin()).join().unwrap();
        assert_ne!(first_id, next.id);
        assert!(coordinator.is_current(next.id));
        assert!(!next.cancellation.load(Ordering::Acquire));
        release.send(()).unwrap();
        thread.join().unwrap();
    }
}
