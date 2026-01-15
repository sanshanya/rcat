use arc_swap::ArcSwapOption;
use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
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
}

#[derive(Default)]
pub struct HitTestMaskStore {
    latest_seq: AtomicU64,
    snapshot: ArcSwapOption<MaskSnapshot>,
    force_transparent: AtomicBool,
}

impl HitTestMaskStore {
    pub fn set_force_transparent(&self, value: bool) {
        self.force_transparent.store(value, Ordering::SeqCst);
    }

    pub fn force_transparent(&self) -> bool {
        self.force_transparent.load(Ordering::SeqCst)
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
