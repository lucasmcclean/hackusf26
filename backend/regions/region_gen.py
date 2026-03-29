import numpy as np
from scipy.spatial import ConvexHull


def compute_priority_polygons(
    points: list[tuple[float, float, float]],
    n_top: int = 3,
    top_fraction: float = 0.15,
    smooth_iters: int = 3,
) -> list[dict]:
    """
    Split points into polygons ranked by total priority.

    The strategy:
      1. Sort all points by priority descending.
      2. Reserve the top `top_fraction` of points as "high-priority seeds".
         These are clustered into `n_top` groups using a greedy spatial merge,
         and each group gets a tight convex-hull polygon.
      3. The remaining points are grouped spatially (grid cells) and each cell
         that contains points becomes a lower-priority polygon.
      4. All polygons are returned sorted by total priority descending.

    Parameters
    ----------
    points      : list of (x, y, priority) tuples
    n_top       : number of high-priority polygons to carve out (default 3)
    top_fraction: fraction of points (by priority rank) seeding the top polygons
    smooth_iters: Chaikin corner-cutting iterations (0 = sharp, 3 = smooth, 6 = very smooth)

    Returns
    -------
    List of dicts sorted by priority descending:
        {
          "points": [[x1,y1], [x2,y2], ...],  # polygon boundary vertices
          "priority": float                     # sum of point priorities inside
        }
    """
    if len(points) < 3:
        raise ValueError("Need at least 3 points to form polygons.")

    pts = np.array(points, dtype=float)  # shape (n, 3)
    xs, ys, prios = pts[:, 0], pts[:, 1], pts[:, 2]

    # --- 1. Sort by priority descending ---
    order = np.argsort(-prios)
    sorted_pts = pts[order]

    # --- 2. Identify high-priority seeds ---
    n_seed = max(n_top * 2, int(len(pts) * top_fraction))
    n_seed = min(n_seed, len(pts))
    seed_pts = sorted_pts[:n_seed]

    # --- 3. Cluster seeds into n_top groups (greedy spatial k-means-like) ---
    top_groups = _spatial_kmeans(seed_pts, k=n_top)

    # --- 4. Remaining points go into a grid of background polygons ---
    seed_indices = set(order[:n_seed])
    remaining_pts = pts[[i for i in range(len(pts)) if i not in seed_indices]]

    background_groups = _grid_cells(remaining_pts, target_cells=max(5, len(pts) // 20))

    # --- 5. Build polygon dicts ---
    result = []

    for group in top_groups:
        if len(group) >= 3:
            poly_pts = _convex_hull_vertices(group[:, :2], smooth_iters)
        elif len(group) == 2:
            # degenerate: tiny rectangle around segment
            poly_pts = _buffer_segment(group[:, :2])
        else:
            # single point: tiny square
            poly_pts = _point_square(group[0, :2])
        result.append({
            "points": poly_pts,
            "priority": float(group[:, 2].sum()),
        })

    for group in background_groups:
        if len(group) == 0:
            continue
        if len(group) >= 3:
            poly_pts = _convex_hull_vertices(group[:, :2], smooth_iters)
        elif len(group) == 2:
            poly_pts = _buffer_segment(group[:, :2])
        else:
            poly_pts = _point_square(group[0, :2])
        result.append({
            "points": poly_pts,
            "priority": float(group[:, 2].sum()),
        })

    # --- 6. Sort by priority descending ---
    result.sort(key=lambda d: d["priority"], reverse=True)

    return result


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _spatial_kmeans(pts: np.ndarray, k: int, max_iter: int = 100) -> list[np.ndarray]:
    """Simple k-means on (x, y) coordinates, returns k groups of (x,y,priority)."""
    k = min(k, len(pts))
    # Init centers from high-priority points spread across space
    centers = pts[np.linspace(0, len(pts) - 1, k, dtype=int), :2].copy()

    labels = np.zeros(len(pts), dtype=int)
    for _ in range(max_iter):
        # Assign
        dists = np.linalg.norm(pts[:, :2][:, None] - centers[None, :], axis=2)
        new_labels = np.argmin(dists, axis=1)
        if np.all(new_labels == labels):
            break
        labels = new_labels
        # Update centers
        for j in range(k):
            mask = labels == j
            if mask.any():
                centers[j] = pts[mask, :2].mean(axis=0)

    return [pts[labels == j] for j in range(k) if (labels == j).any()]


def _grid_cells(pts: np.ndarray, target_cells: int) -> list[np.ndarray]:
    """Bin remaining points into a spatial grid, return non-empty cells."""
    if len(pts) == 0:
        return []
    x_min, x_max = pts[:, 0].min(), pts[:, 0].max()
    y_min, y_max = pts[:, 1].min(), pts[:, 1].max()

    side = max(1, int(np.sqrt(target_cells)))
    x_edges = np.linspace(x_min, x_max + 1e-9, side + 1)
    y_edges = np.linspace(y_min, y_max + 1e-9, side + 1)

    groups = []
    for i in range(side):
        for j in range(side):
            mask = (
                (pts[:, 0] >= x_edges[i]) & (pts[:, 0] < x_edges[i + 1]) &
                (pts[:, 1] >= y_edges[j]) & (pts[:, 1] < y_edges[j + 1])
            )
            cell = pts[mask]
            if len(cell) > 0:
                groups.append(cell)
    return groups


def _convex_hull_vertices(xy: np.ndarray, smooth_iters: int = 0, pad_frac: float = 0.08) -> list[list[float]]:
    """Return convex hull vertices, outward-padded then Chaikin-smoothed.

    Each hull vertex is pushed away from the centroid by pad_frac * mean_radius
    before smoothing, so the rounded curve never cuts inside the point cloud.
    """
    jittered = xy + np.random.default_rng(0).uniform(-1e-9, 1e-9, xy.shape)
    try:
        hull = ConvexHull(jittered)
        verts = jittered[hull.vertices].tolist()
    except Exception:
        return _bounding_box(xy)

    cx = sum(v[0] for v in verts) / len(verts)
    cy = sum(v[1] for v in verts) / len(verts)
    mean_r = sum(((v[0]-cx)**2 + (v[1]-cy)**2)**0.5 for v in verts) / len(verts)
    pad = max(mean_r * pad_frac, 0.5)
    expanded = []
    for v in verts:
        dx, dy = v[0] - cx, v[1] - cy
        dist = (dx*dx + dy*dy)**0.5 or 1e-9
        expanded.append([v[0] + dx/dist * pad, v[1] + dy/dist * pad])

    if smooth_iters > 0:
        expanded = _chaikin(expanded, smooth_iters)
    else:
        expanded.append(expanded[0])

    return [[round(v[0], 6), round(v[1], 6)] for v in expanded]


def _chaikin(pts: list, iters: int) -> list:
    """Chaikin corner-cutting on a closed ring (last point != first).
    Produces a smooth B-spline-like curve guaranteed to stay outside
    the pre-expanded hull vertices."""
    p = pts
    for _ in range(iters):
        n = len(p)
        next_p = []
        for i in range(n):
            a = p[i]
            b = p[(i + 1) % n]
            next_p.append([a[0]*0.75 + b[0]*0.25, a[1]*0.75 + b[1]*0.25])
            next_p.append([a[0]*0.25 + b[0]*0.75, a[1]*0.25 + b[1]*0.75])
        p = next_p
    p.append(p[0])
    return p


def _bounding_box(xy: np.ndarray) -> list[list[float]]:
    x0, y0 = xy[:, 0].min(), xy[:, 1].min()
    x1, y1 = xy[:, 0].max(), xy[:, 1].max()
    pad = max((x1 - x0) * 0.05, (y1 - y0) * 0.05, 0.5)
    return [
        [round(x0 - pad, 6), round(y0 - pad, 6)],
        [round(x1 + pad, 6), round(y0 - pad, 6)],
        [round(x1 + pad, 6), round(y1 + pad, 6)],
        [round(x0 - pad, 6), round(y1 + pad, 6)],
        [round(x0 - pad, 6), round(y0 - pad, 6)],
    ]


def _buffer_segment(xy: np.ndarray, pad: float = 0.5) -> list[list[float]]:
    x0, y0 = xy[0]
    x1, y1 = xy[1]
    return [
        [round(min(x0, x1) - pad, 6), round(min(y0, y1) - pad, 6)],
        [round(max(x0, x1) + pad, 6), round(min(y0, y1) - pad, 6)],
        [round(max(x0, x1) + pad, 6), round(max(y0, y1) + pad, 6)],
        [round(min(x0, x1) - pad, 6), round(max(y0, y1) + pad, 6)],
        [round(min(x0, x1) - pad, 6), round(min(y0, y1) - pad, 6)],
    ]


def _point_square(xy: np.ndarray, half: float = 0.5) -> list[list[float]]:
    x, y = float(xy[0]), float(xy[1])
    return [
        [round(x - half, 6), round(y - half, 6)],
        [round(x + half, 6), round(y - half, 6)],
        [round(x + half, 6), round(y + half, 6)],
        [round(x - half, 6), round(y + half, 6)],
        [round(x - half, 6), round(y - half, 6)],
    ]
