use tauri::PhysicalPosition;

#[derive(Debug, Clone, Copy)]
pub struct Rect {
    pub left: f64,
    pub top: f64,
    pub width: f64,
    pub height: f64,
}

impl Rect {
    pub fn right(&self) -> f64 {
        self.left + self.width
    }

    pub fn bottom(&self) -> f64 {
        self.top + self.height
    }

    pub fn center_x(&self) -> f64 {
        self.left + self.width * 0.5
    }

    pub fn center_y(&self) -> f64 {
        self.top + self.height * 0.5
    }
}

#[derive(Debug, Clone, Copy)]
pub struct Size {
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Copy)]
pub struct WorkArea {
    pub left: f64,
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
    pub scale_factor: f64,
}

impl WorkArea {
    fn margin_px(&self, logical_px: f64) -> f64 {
        (logical_px * self.scale_factor).max(0.0)
    }
}

/// Compute a context panel position anchored to the avatar rectangle.
///
/// Inputs are in physical pixels (virtual desktop coordinates).
pub fn place_context_panel(
    avatar: Rect,
    panel: Size,
    work_area: WorkArea,
    gap_logical_px: f64,
    edge_margin_logical_px: f64,
) -> PhysicalPosition<i32> {
    let gap = work_area.margin_px(gap_logical_px);
    let margin = work_area.margin_px(edge_margin_logical_px);

    let min_x = work_area.left + margin;
    let max_x = (work_area.right - margin - panel.width).max(min_x);
    let min_y = work_area.top + margin;
    let max_y = (work_area.bottom - margin - panel.height).max(min_y);

    // Prefer right-side placement.
    let mut x = avatar.right() + gap;
    if x > max_x {
        x = avatar.left - gap - panel.width;
    }
    x = x.clamp(min_x, max_x);

    // Prefer vertical centering around the avatar.
    let mut y = avatar.center_y() - panel.height * 0.5;
    y = y.clamp(min_y, max_y);

    PhysicalPosition {
        x: x.round() as i32,
        y: y.round() as i32,
    }
}

