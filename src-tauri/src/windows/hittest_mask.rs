use arc_swap::ArcSwapOption;
use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering},
    Arc,
};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaskRect {
    pub min_x: u32,
    pub min_y: u32,
    pub max_x: u32,
    pub max_y: u32,
}

impl MaskRect {
    pub fn is_empty(&self) -> bool {
        self.max_x <= self.min_x || self.max_y <= self.min_y
    }

    pub fn clamp_to(&self, w: u32, h: u32) -> Self {
        let min_x = self.min_x.min(w);
        let min_y = self.min_y.min(h);
        let max_x = self.max_x.min(w).max(min_x);
        let max_y = self.max_y.min(h).max(min_y);
        Self {
            min_x,
            min_y,
            max_x,
            max_y,
        }
    }

    pub fn contains(&self, x: u32, y: u32) -> bool {
        x >= self.min_x && x < self.max_x && y >= self.min_y && y < self.max_y
    }
}

#[derive(Debug)]
pub struct MaskSnapshot {
    pub seq: u64,
    pub mask_w: u32,
    pub mask_h: u32,
    pub rect: MaskRect,
    pub stride: usize,
    pub bitset: Vec<u8>,
    pub viewport_w: u32,
    pub viewport_h: u32,
}

impl MaskSnapshot {
    pub fn new(
        seq: u64,
        mask_w: u32,
        mask_h: u32,
        rect: MaskRect,
        bitset: Vec<u8>,
        viewport_w: u32,
        viewport_h: u32,
    ) -> Option<Self> {
        if mask_w == 0 || mask_h == 0 || viewport_w == 0 || viewport_h == 0 {
            return None;
        }
        let stride = ((mask_w as usize) + 7) / 8;
        let expected_len = stride * (mask_h as usize);
        if bitset.len() != expected_len {
            return None;
        }
        Some(Self {
            seq,
            mask_w,
            mask_h,
            rect: rect.clamp_to(mask_w, mask_h),
            stride,
            bitset,
            viewport_w,
            viewport_h,
        })
    }

    pub fn hit_test_client_point(&self, client_x: i32, client_y: i32, client_w: i32, client_h: i32) -> bool {
        if self.rect.is_empty() {
            return false;
        }

        if client_x < 0 || client_y < 0 || client_x >= client_w || client_y >= client_h {
            return false;
        }

        let client_w = (client_w as i64).max(1);
        let client_h = (client_h as i64).max(1);

        let mx = ((client_x as i64) * (self.mask_w as i64) / client_w) as i64;
        let my = ((client_y as i64) * (self.mask_h as i64) / client_h) as i64;

        if mx < 0 || my < 0 {
            return false;
        }
        let mx = mx as u32;
        let my = my as u32;
        if mx >= self.mask_w || my >= self.mask_h {
            return false;
        }
        if !self.rect.contains(mx, my) {
            return false;
        }

        let mx_usize = mx as usize;
        let my_usize = my as usize;
        let idx = my_usize * self.stride + (mx_usize / 8);
        let Some(byte) = self.bitset.get(idx) else {
            return false;
        };
        let bit = (byte >> (mx_usize % 8)) & 1;
        bit == 1
    }
}

#[derive(Default)]
pub struct HitTestMaskStore {
    latest_seq: AtomicU64,
    snapshot: ArcSwapOption<MaskSnapshot>,
    force_transparent: AtomicBool,
    viewport_client_mismatch_count: AtomicU64,
    viewport_client_last_client_w: AtomicU32,
    viewport_client_last_client_h: AtomicU32,
    viewport_client_last_viewport_w: AtomicU32,
    viewport_client_last_viewport_h: AtomicU32,
}

impl HitTestMaskStore {
    pub fn set_force_transparent(&self, value: bool) {
        self.force_transparent.store(value, Ordering::SeqCst);
    }

    pub fn force_transparent(&self) -> bool {
        self.force_transparent.load(Ordering::SeqCst)
    }

    pub fn record_viewport_client_mismatch(
        &self,
        client_w: u32,
        client_h: u32,
        viewport_w: u32,
        viewport_h: u32,
    ) {
        let _ = self
            .viewport_client_mismatch_count
            .fetch_add(1, Ordering::Relaxed);
        self.viewport_client_last_client_w
            .store(client_w, Ordering::Relaxed);
        self.viewport_client_last_client_h
            .store(client_h, Ordering::Relaxed);
        self.viewport_client_last_viewport_w
            .store(viewport_w, Ordering::Relaxed);
        self.viewport_client_last_viewport_h
            .store(viewport_h, Ordering::Relaxed);
    }

    pub fn viewport_client_mismatch_count(&self) -> u64 {
        self.viewport_client_mismatch_count.load(Ordering::Relaxed)
    }

    pub fn viewport_client_last_mismatch(&self) -> Option<(u32, u32, u32, u32)> {
        if self.viewport_client_mismatch_count() == 0 {
            return None;
        }
        Some((
            self.viewport_client_last_client_w.load(Ordering::Relaxed),
            self.viewport_client_last_client_h.load(Ordering::Relaxed),
            self.viewport_client_last_viewport_w.load(Ordering::Relaxed),
            self.viewport_client_last_viewport_h.load(Ordering::Relaxed),
        ))
    }

    pub fn update(&self, snapshot: MaskSnapshot) -> bool {
        let seq = snapshot.seq;
        let current = self.latest_seq.load(Ordering::SeqCst);
        // Frontend hot-reload can restart the JS sequence counter while the Rust process stays
        // alive. Treat a large backwards jump as a reset and accept the new stream.
        let reset = current.saturating_sub(seq) > 1024;
        if seq <= current && !reset {
            return false;
        }
        self.latest_seq.store(seq, Ordering::SeqCst);
        self.snapshot.store(Some(Arc::new(snapshot)));
        true
    }

    pub fn load(&self) -> Option<Arc<MaskSnapshot>> {
        self.snapshot.load_full()
    }
}
