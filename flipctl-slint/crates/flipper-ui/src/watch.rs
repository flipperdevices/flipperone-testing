//! A value refreshed on a background thread.
//!
//! Every scene that shows live system state has the same shape in the prototype:
//! `enter()` starts a `setInterval`, `exit()` clears it, and the render function
//! draws whatever the last response left behind. The interval exists because the
//! data is expensive: `mmcli -m 0 -J` plus three `qmicli` calls, or a `git fetch`,
//! take hundreds of milliseconds to tens of seconds.
//!
//! Doing that on the render loop would stall the panel, so a `Watch` owns a thread
//! that refreshes at a fixed cadence and hands the newest value over a mutex. The
//! loop only ever locks, clones and draws.
//!
//! The thread stops when the `Watch` is dropped, which is what makes this the
//! equivalent of `exit()`: closing a screen drops its watch and the polling stops.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::Duration;

struct Shared<T> {
    value: Mutex<T>,
    dirty: AtomicBool,
    /// Set on drop. The thread waits on `wake` rather than sleeping, so a dropped
    /// watch stops within microseconds instead of at the end of its interval.
    stop: Mutex<bool>,
    wake: Condvar,
}

pub struct Watch<T: Send + 'static> {
    shared: Arc<Shared<T>>,
}

impl<T: Clone + PartialEq + Send + 'static> Watch<T> {
    /// Start polling. `fetch` runs immediately, then every `interval`.
    pub fn spawn(name: &str, interval: Duration, initial: T, fetch: impl Fn() -> T + Send + 'static) -> Self {
        let shared = Arc::new(Shared {
            value: Mutex::new(initial),
            dirty: AtomicBool::new(false),
            stop: Mutex::new(false),
            wake: Condvar::new(),
        });
        let s = Arc::clone(&shared);
        thread::Builder::new()
            .name(name.into())
            .spawn(move || loop {
                let fresh = fetch();
                {
                    let mut cur = s.value.lock().unwrap();
                    if *cur != fresh {
                        *cur = fresh;
                        s.dirty.store(true, Ordering::Relaxed);
                    }
                }
                let stop = s.stop.lock().unwrap();
                if *stop {
                    return;
                }
                let (stop, _) = s.wake.wait_timeout(stop, interval).unwrap();
                if *stop {
                    return;
                }
            })
            .expect("spawn watch thread");
        Self { shared }
    }

    pub fn get(&self) -> T {
        self.shared.value.lock().unwrap().clone()
    }

    /// True once per change, so a caller repaints only when something moved.
    pub fn take_dirty(&self) -> bool {
        self.shared.dirty.swap(false, Ordering::Relaxed)
    }

    /// Overwrite the value without waiting for the next poll.
    ///
    /// This is the optimistic write the prototype does on every setter: flip the
    /// local value so the row redraws on the same frame as the key press, and let
    /// the next poll reconcile if the system disagreed.
    pub fn set(&self, value: T) {
        *self.shared.value.lock().unwrap() = value;
        self.shared.dirty.store(true, Ordering::Relaxed);
    }

    /// Poll again now instead of at the end of the current interval.
    pub fn refresh_now(&self) {
        self.shared.wake.notify_all();
    }
}

impl<T: Send + 'static> Drop for Watch<T> {
    fn drop(&mut self) {
        *self.shared.stop.lock().unwrap() = true;
        self.shared.wake.notify_all();
    }
}
