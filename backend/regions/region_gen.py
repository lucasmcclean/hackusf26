import numpy as np
from scipy.spatial import Voronoi, ConvexHull
from collections import defaultdict

def priority_polygons(points, high_priority_threshold=0.7, min_region_size=3, max_region_size=4):
    """
    Given n x 3 array of [x, y, priority], returns polygon index groups
    where high-priority points are clustered into regions of 3-4 points.

    Args:
        points: list or np.ndarray of shape (n, 3) — [x, y, priority]
        high_priority_threshold: float, priority cutoff to consider "high"
        min_region_size: minimum points per high-priority polygon
        max_region_size: maximum points per high-priority polygon

    Returns:
        List of lists of indices, e.g. [[0,1,2], [3,4,5,6], [7], ...]
    """
    points = np.array(points)
    coords = points[:, :2]
    priorities = points[:, 2]
    n = len(points)

    high_pri_idx = set(np.where(priorities >= high_priority_threshold)[0])
    low_pri_idx  = set(range(n)) - high_pri_idx

    adjacency = defaultdict(set)
    if n >= 4:
        vor = Voronoi(coords)
        for ridge in vor.ridge_points:
            i, j = ridge
            adjacency[i].add(j)
            adjacency[j].add(i)
    else:
        for i in range(n):
            for j in range(n):
                if i != j:
                    adjacency[i].add(j)

    visited = set()
    polygons = []

    sorted_high = sorted(high_pri_idx, key=lambda i: -priorities[i])

    for seed in sorted_high:
        if seed in visited:
            continue

        cluster = [seed]
        visited.add(seed)

        queue = [seed]
        while queue and len(cluster) < max_region_size:
            current = queue.pop(0)
            for neighbor in sorted(adjacency[current], key=lambda i: -priorities[i]):
                if neighbor in high_pri_idx and neighbor not in visited:
                    cluster.append(neighbor)
                    visited.add(neighbor)
                    queue.append(neighbor)
                    if len(cluster) >= max_region_size:
                        break

        if len(cluster) >= min_region_size:
            polygons.append(cluster)
        else:
            for idx in cluster:
                visited.discard(idx)
            visited.update(cluster)
            polygons.append(cluster)

    for idx in sorted(low_pri_idx):
        polygons.append([idx])

    return polygons


def order_polygon_vertices(indices, coords):
    """
    Given a cluster of point indices and their 2D coordinates,
    returns indices reordered counter-clockwise using convex hull.
    Only meaningful for 3+ points.
    """
    if len(indices) < 3:
        return indices
    pts = np.array([coords[i] for i in indices])
    try:
        hull = ConvexHull(pts)
        return [indices[i] for i in hull.vertices]
    except Exception:
        return indices

def normalize(obj):
    if isinstance(obj, dict):
        return {k: normalize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [normalize(v) for v in obj]
    if isinstance(obj, tuple):
        return [normalize(v) for v in obj]
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.floating):
        return float(obj)
    if isinstance(obj, np.ndarray):
        return normalize(obj.tolist())
    return obj