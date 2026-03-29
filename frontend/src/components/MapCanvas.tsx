import { useEffect, useMemo, useRef } from 'react'
import maplibregl, { type GeoJSONSource, type LngLatBoundsLike, type MapGeoJSONFeature } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { RegionPolygon } from '../services/api'

export type LocationTuple = [number, number, number?, string?]

export interface MapPointSelection {
  locationIndex: number
  role: number
  entityId: string | null
}

interface MapCanvasProps {
  locations: LocationTuple[]
  regions?: RegionPolygon[]
  onRegionClick?: (regionIndex: number) => void
  onPointClick?: (selection: MapPointSelection) => void
  currentClientId?: string
}

const TAMPA_BOUNDS: LngLatBoundsLike = [[-82.62, 27.82], [-82.24, 28.19]]
const TAMPA_CENTER: [number, number] = [-82.4572, 27.9506]
const TAMPA_BOUNDARY: GeoJSON.Feature<GeoJSON.Polygon> = {
  type: 'Feature',
  properties: { name: 'City of Tampa Focus' },
  geometry: {
    type: 'Polygon',
    coordinates: [[
      [-82.62, 27.82],
      [-82.24, 27.82],
      [-82.24, 28.19],
      [-82.62, 28.19],
      [-82.62, 27.82],
    ]],
  },
}

const MAPTILER_KEY = (import.meta.env.VITE_MAPTILER_API_KEY as string | undefined) ?? ''
const MAP_STYLE_URL = (import.meta.env.VITE_MAP_STYLE_URL as string | undefined)
  ?? (MAPTILER_KEY
    ? `https://api.maptiler.com/maps/streets-v2-dark/style.json?key=${MAPTILER_KEY}`
    : 'https://demotiles.maplibre.org/style.json')

function toLngLat(location: LocationTuple): [number, number] {
  return [location[1], location[0]]
}

function isFiniteLocation(location: LocationTuple): boolean {
  return Number.isFinite(location[0]) && Number.isFinite(location[1])
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function toRgba(rgb: [number, number, number], alpha: number): string {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`
}

function blendChannel(start: number, end: number, t: number): number {
  return Math.round(start + ((end - start) * t))
}

function priorityToRgb(scale: number): [number, number, number] {
  const green: [number, number, number] = [52, 168, 83]
  const yellow: [number, number, number] = [245, 202, 88]
  const red: [number, number, number] = [214, 70, 74]
  const clamped = clamp01(scale)

  if (clamped < 0.5) {
    const t = clamped / 0.5
    return [
      blendChannel(green[0], yellow[0], t),
      blendChannel(green[1], yellow[1], t),
      blendChannel(green[2], yellow[2], t),
    ]
  }

  const t = (clamped - 0.5) / 0.5
  return [
    blendChannel(yellow[0], red[0], t),
    blendChannel(yellow[1], red[1], t),
    blendChannel(yellow[2], red[2], t),
  ]
}

function closeRing(points: [number, number][]): [number, number][] {
  if (points.length === 0) return points
  const first = points[0]
  const last = points[points.length - 1]
  if (first[0] === last[0] && first[1] === last[1]) return points
  return [...points, first]
}

function isLikelyTampaLatLon(lat: number, lon: number): boolean {
  return lat >= 27 && lat <= 29 && lon >= -83.2 && lon <= -81.8
}

function normalizeToLngLat(point: [number, number]): [number, number] {
  const a = point[0]
  const b = point[1]
  if (isLikelyTampaLatLon(a, b)) return [b, a]
  if (isLikelyTampaLatLon(b, a)) return [a, b]
  return [b, a]
}

function cross(origin: [number, number], a: [number, number], b: [number, number]): number {
  return (a[0] - origin[0]) * (b[1] - origin[1]) - (a[1] - origin[1]) * (b[0] - origin[0])
}

function convexHull(points: [number, number][]): [number, number][] {
  const sorted = [...points]
    .sort((p1, p2) => (p1[0] - p2[0]) || (p1[1] - p2[1]))
    .filter((point, index, list) => {
      if (index === 0) return true
      const previous = list[index - 1]
      return point[0] !== previous[0] || point[1] !== previous[1]
    })

  if (sorted.length <= 2) return sorted

  const lower: [number, number][] = []
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
      lower.pop()
    }
    lower.push(point)
  }

  const upper: [number, number][] = []
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
      upper.pop()
    }
    upper.push(point)
  }

  lower.pop()
  upper.pop()
  return [...lower, ...upper]
}

function pointSquare(lng: number, lat: number, halfSize: number): [number, number][] {
  return [
    [lng - halfSize, lat - halfSize],
    [lng + halfSize, lat - halfSize],
    [lng + halfSize, lat + halfSize],
    [lng - halfSize, lat + halfSize],
  ]
}

function pointCircle(lng: number, lat: number, radius: number, segments: number = 24): [number, number][] {
  const ring: [number, number][] = []
  for (let index = 0; index < segments; index += 1) {
    const theta = (index / segments) * Math.PI * 2
    ring.push([
      lng + Math.cos(theta) * radius,
      lat + Math.sin(theta) * radius,
    ])
  }
  return closeRing(ring)
}

function twoPointBuffer(points: [number, number][], halfSize: number): [number, number][] {
  const [a, b] = points
  return [
    [Math.min(a[0], b[0]) - halfSize, Math.min(a[1], b[1]) - halfSize],
    [Math.max(a[0], b[0]) + halfSize, Math.min(a[1], b[1]) - halfSize],
    [Math.max(a[0], b[0]) + halfSize, Math.max(a[1], b[1]) + halfSize],
    [Math.min(a[0], b[0]) - halfSize, Math.max(a[1], b[1]) + halfSize],
  ]
}

function dedupePoints(points: [number, number][], epsilon: number): [number, number][] {
  const unique: [number, number][] = []
  for (const point of points) {
    const exists = unique.some((candidate) => Math.hypot(candidate[0] - point[0], candidate[1] - point[1]) <= epsilon)
    if (!exists) {
      unique.push(point)
    }
  }
  return unique
}

function getMaxPairDistance(points: [number, number][]): number {
  if (points.length < 2) return 0
  let maxDistance = 0

  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const distance = Math.hypot(points[i][0] - points[j][0], points[i][1] - points[j][1])
      if (distance > maxDistance) {
        maxDistance = distance
      }
    }
  }

  return maxDistance
}

function expandRing(points: [number, number][], expansion: number): [number, number][] {
  if (points.length < 4) return points

  const ring = closeRing(points)
  const openRing = ring.slice(0, -1)
  if (openRing.length < 3) return ring

  const centroid: [number, number] = [
    openRing.reduce((sum, point) => sum + point[0], 0) / openRing.length,
    openRing.reduce((sum, point) => sum + point[1], 0) / openRing.length,
  ]

  const expandedOpenRing = openRing.map((point) => {
    const dx = point[0] - centroid[0]
    const dy = point[1] - centroid[1]
    const distance = Math.hypot(dx, dy)
    if (distance < 1e-9) return [point[0] + expansion, point[1]] as [number, number]

    const scale = (distance + expansion) / distance
    return [
      centroid[0] + dx * scale,
      centroid[1] + dy * scale,
    ] as [number, number]
  })

  return closeRing(expandedOpenRing)
}

function buildRegionRing(regionPoints: Array<[number, number]>): [number, number][] {
  const regionExpansion = 0.003
  const singlePointRadius = 0.001
  const dedupeEpsilon = 0.00008
  const nearPairThreshold = 0.00045
  const validPoints = regionPoints
    .filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]))
    .map((point) => normalizeToLngLat(point))

  const uniquePoints = dedupePoints(validPoints, dedupeEpsilon)

  if (uniquePoints.length === 0) return []
  if (uniquePoints.length === 1) {
    return pointCircle(uniquePoints[0][0], uniquePoints[0][1], singlePointRadius)
  }

  if (uniquePoints.length === 2) {
    const pairDistance = getMaxPairDistance(uniquePoints)
    if (pairDistance <= nearPairThreshold) {
      return pointCircle(uniquePoints[0][0], uniquePoints[0][1], singlePointRadius)
    }
    return closeRing(twoPointBuffer(uniquePoints, 0.0026))
  }

  const hull = convexHull(uniquePoints)
  if (hull.length < 3) {
    const pairDistance = getMaxPairDistance(uniquePoints)
    if (pairDistance <= nearPairThreshold) {
      return pointCircle(uniquePoints[0][0], uniquePoints[0][1], singlePointRadius)
    }
    return closeRing(twoPointBuffer(uniquePoints.slice(0, 2), 0.0026))
  }

  const footprint = getMaxPairDistance(hull)
  const dynamicExpansion = footprint <= 0.006 ? 0.0012 : regionExpansion
  return expandRing(closeRing(hull), dynamicExpansion)
}

function getFeatureLocationIndex(feature: GeoJSON.Feature<GeoJSON.Point>): number | null {
  const rawValue = (feature.properties as { locationIndex?: unknown } | null)?.locationIndex
  const locationIndex = typeof rawValue === 'number' ? rawValue : Number(rawValue)
  if (!Number.isInteger(locationIndex) || locationIndex < 0) return null
  return locationIndex
}

function getPointFeatureByLocationIndex(
  pointsCollection: GeoJSON.FeatureCollection<GeoJSON.Point>,
  locationIndex: number,
): GeoJSON.Feature<GeoJSON.Point> | null {
  return pointsCollection.features.find((feature) => getFeatureLocationIndex(feature) === locationIndex) ?? null
}

function getOverlapGroupIndices(
  map: maplibregl.Map,
  pointsCollection: GeoJSON.FeatureCollection<GeoJSON.Point>,
  hoveredIndex: number,
  radiusPx: number,
): number[] {
  const hoveredFeature = pointsCollection.features.find((feature) => getFeatureLocationIndex(feature) === hoveredIndex)
  if (!hoveredFeature) return []

  const hoveredCoordinates = hoveredFeature.geometry.coordinates
  const hoveredPixel = map.project({ lng: hoveredCoordinates[0], lat: hoveredCoordinates[1] })
  const groupIndices: number[] = []

  for (const feature of pointsCollection.features) {
    const candidateIndex = getFeatureLocationIndex(feature)
    if (candidateIndex === null) continue

    const coordinates = feature.geometry.coordinates
    const candidatePixel = map.project({ lng: coordinates[0], lat: coordinates[1] })
    const dx = candidatePixel.x - hoveredPixel.x
    const dy = candidatePixel.y - hoveredPixel.y
    if (Math.hypot(dx, dy) <= radiusPx) {
      groupIndices.push(candidateIndex)
    }
  }

  groupIndices.sort((a, b) => a - b)
  return groupIndices
}

function buildSpiderfiedPoints(
  map: maplibregl.Map,
  pointsCollection: GeoJSON.FeatureCollection<GeoJSON.Point>,
  groupIndices: number[],
  hoveredIndex: number,
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  const hoveredFeature = getPointFeatureByLocationIndex(pointsCollection, hoveredIndex)
  if (!hoveredFeature) return pointsCollection

  const orderedIndices = [hoveredIndex, ...groupIndices.filter((index) => index !== hoveredIndex)]
  const center = map.project({
    lng: hoveredFeature.geometry.coordinates[0],
    lat: hoveredFeature.geometry.coordinates[1],
  })
  const ringRadiusPx = Math.min(44, 20 + orderedIndices.length * 1.8)

  const displacedCoordinatesByIndex = new Map<number, [number, number]>()
  orderedIndices.forEach((locationIndex, offsetIndex) => {
    const angle = (offsetIndex / Math.max(orderedIndices.length, 1)) * Math.PI * 2
    const point = map.unproject([
      center.x + Math.cos(angle) * ringRadiusPx,
      center.y + Math.sin(angle) * ringRadiusPx,
    ])
    displacedCoordinatesByIndex.set(locationIndex, [point.lng, point.lat])
  })

  return {
    type: 'FeatureCollection',
    features: pointsCollection.features.map((feature) => {
      const locationIndex = getFeatureLocationIndex(feature)
      if (locationIndex === null || !displacedCoordinatesByIndex.has(locationIndex)) {
        return feature
      }

      const displaced = displacedCoordinatesByIndex.get(locationIndex) as [number, number]
      return {
        ...feature,
        geometry: {
          ...feature.geometry,
          coordinates: displaced,
        },
      }
    }),
  }
}

export function MapCanvas({ locations, regions = [], onRegionClick, onPointClick, currentClientId }: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const hoveredFeatureIdRef = useRef<number | string | null>(null)
  const hoveredPointIndexRef = useRef<number | null>(null)
  const pointPopupRef = useRef<maplibregl.Popup | null>(null)
  const onRegionClickRef = useRef<MapCanvasProps['onRegionClick']>(onRegionClick)
  const onPointClickRef = useRef<MapCanvasProps['onPointClick']>(onPointClick)
  const latestPointsGeoJsonRef = useRef<GeoJSON.FeatureCollection<GeoJSON.Point>>({
    type: 'FeatureCollection',
    features: [],
  })
  const latestRegionsGeoJsonRef = useRef<GeoJSON.FeatureCollection<GeoJSON.Polygon>>({
    type: 'FeatureCollection',
    features: [],
  })
  const spiderfiedGroupKeyRef = useRef<string | null>(null)
  const spiderfiedGroupIndicesRef = useRef<number[]>([])
  const spiderAnchorPixelRef = useRef<{ x: number, y: number } | null>(null)
  const spiderActiveRadiusRef = useRef<number>(0)
  const spiderCollapseTimerRef = useRef<number | null>(null)

  const pointsGeoJson = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point>>(() => {
    return {
      type: 'FeatureCollection',
      features: locations
        .filter((location) => isFiniteLocation(location))
        .map((location, index) => ({
          type: 'Feature',
          properties: {
            label: `N${index + 1}`,
            locationIndex: index,
            latitude: location[0],
            longitude: location[1],
            role: location[2] ?? 0,
            entityId: typeof location[3] === 'string' ? location[3] : null,
            isSelf: typeof location[3] === 'string' && typeof currentClientId === 'string'
              ? location[3] === currentClientId
              : false,
          },
          geometry: {
            type: 'Point',
            coordinates: toLngLat(location),
          },
        })),
    }
  }, [currentClientId, locations])

  const regionVisuals = useMemo(() => {
    if (regions.length === 0) {
      return [] as Array<RegionPolygon & {
        fillColor: string
        hoverFillColor: string
        outlineColor: string
      }>
    }

    const relativeValues = regions.map((region) => region.relativePriority)
    const minRelative = Math.min(...relativeValues)
    const maxRelative = Math.max(...relativeValues)
    const spread = maxRelative - minRelative

    return regions.map((region) => {
      const scale = spread < 1e-9
        ? 0.5
        : (region.relativePriority - minRelative) / spread
      const rgb = priorityToRgb(scale)
      return {
        ...region,
        fillColor: toRgba(rgb, 0.28),
        hoverFillColor: toRgba(rgb, 0.42),
        outlineColor: toRgba(rgb, 0.85),
      }
    })
  }, [regions])

  const regionsGeoJson = useMemo<GeoJSON.FeatureCollection<GeoJSON.Polygon>>(() => {
    return {
      type: 'FeatureCollection',
      features: regionVisuals.flatMap((region, regionIndex) => {
        const ring = buildRegionRing(region.points)
        if (ring.length < 4) return []

        return [{
          type: 'Feature',
          id: regionIndex,
          properties: {
            regionIndex,
            label: `Region ${regionIndex + 1}`,
            priority: region.priority,
            relativePriority: region.relativePriority,
            pointCount: region.pointCount,
            fillColor: region.fillColor,
            hoverFillColor: region.hoverFillColor,
            outlineColor: region.outlineColor,
          },
          geometry: {
            type: 'Polygon',
            coordinates: [ring],
          },
        }]
      }),
    }
  }, [regionVisuals])

  useEffect(() => {
    onRegionClickRef.current = onRegionClick
  }, [onRegionClick])

  useEffect(() => {
    onPointClickRef.current = onPointClick
  }, [onPointClick])

  useEffect(() => {
    latestPointsGeoJsonRef.current = pointsGeoJson
  }, [pointsGeoJson])

  useEffect(() => {
    latestRegionsGeoJsonRef.current = regionsGeoJson
  }, [regions, regionsGeoJson])

  useEffect(() => {
    if (!containerRef.current) return
    if (mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE_URL,
      center: TAMPA_CENTER,
      zoom: 11.2,
      minZoom: 10,
      maxZoom: 18,
      maxBounds: TAMPA_BOUNDS,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
    })

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')

    map.on('styleimagemissing', (event) => {
      if (!event.id) return
      if (map.hasImage(event.id)) return
      map.addImage(event.id, { width: 1, height: 1, data: new Uint8Array([0, 0, 0, 0]) })
    })

    map.on('load', () => {
      const clearSpiderCollapseTimer = () => {
        if (spiderCollapseTimerRef.current !== null) {
          window.clearTimeout(spiderCollapseTimerRef.current)
          spiderCollapseTimerRef.current = null
        }
      }

      const clearSpiderfy = () => {
        clearSpiderCollapseTimer()
        const source = map.getSource('points') as GeoJSONSource | undefined
        source?.setData(latestPointsGeoJsonRef.current)
        spiderfiedGroupKeyRef.current = null
        spiderfiedGroupIndicesRef.current = []
        spiderAnchorPixelRef.current = null
        spiderActiveRadiusRef.current = 0
      }

      const scheduleSpiderfyCollapse = () => {
        if (spiderCollapseTimerRef.current !== null) return
        spiderCollapseTimerRef.current = window.setTimeout(() => {
          spiderCollapseTimerRef.current = null
          clearSpiderfy()
        }, 100)
      }

      map.addSource('tampa-boundary', {
        type: 'geojson',
        data: TAMPA_BOUNDARY,
      })

      map.addSource('regions', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })

      map.addSource('points', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })

      map.addLayer({
        id: 'tampa-focus-fill',
        type: 'fill',
        source: 'tampa-boundary',
        paint: {
          'fill-color': 'rgba(32, 148, 222, 0.04)',
        },
      })

      map.addLayer({
        id: 'regions-fill',
        type: 'fill',
        source: 'regions',
        paint: {
          'fill-color': [
            'case',
            ['boolean', ['feature-state', 'hover'], false],
            ['coalesce', ['get', 'hoverFillColor'], 'rgba(245, 202, 88, 0.42)'],
            ['coalesce', ['get', 'fillColor'], 'rgba(245, 202, 88, 0.28)'],
          ],
        },
      })

      map.addLayer({
        id: 'regions-outline',
        type: 'line',
        source: 'regions',
        paint: {
          'line-color': ['coalesce', ['get', 'outlineColor'], 'rgba(245, 202, 88, 0.85)'],
          'line-width': 2,
        },
      })

      map.addLayer({
        id: 'points-glow',
        type: 'circle',
        source: 'points',
        paint: {
          'circle-radius': 18,
          'circle-color': [
            'case',
            ['==', ['get', 'isSelf'], true],
            'rgba(75, 201, 120, 0.28)',
            ['==', ['get', 'role'], 1],
            'rgba(255, 110, 110, 0.25)',
            'rgba(92, 177, 255, 0.25)',
          ],
          'circle-blur': 0.6,
        },
      })

      map.addLayer({
        id: 'points-circles',
        type: 'circle',
        source: 'points',
        paint: {
          'circle-radius': [
            'case',
            ['==', ['get', 'isSelf'], true],
            12.5,
            11,
          ],
          'circle-color': [
            'case',
            ['==', ['get', 'isSelf'], true],
            'rgba(75, 201, 120, 0.98)',
            ['==', ['get', 'role'], 1],
            'rgba(255, 110, 110, 0.95)',
            'rgba(74, 158, 255, 0.95)',
          ],
          'circle-stroke-width': 2.2,
          'circle-stroke-color': 'rgba(255, 244, 244, 0.95)',
        },
      })

      map.addLayer({
        id: 'points-hover-ring',
        type: 'circle',
        source: 'points',
        filter: ['==', ['get', 'locationIndex'], -1],
        paint: {
          'circle-radius': 16,
          'circle-color': 'rgba(0, 0, 0, 0)',
          'circle-stroke-width': 2.2,
          'circle-stroke-color': 'rgba(255, 255, 255, 0.96)',
        },
      })

      map.addLayer({
        id: 'points-labels',
        type: 'symbol',
        source: 'points',
        layout: {
          'text-field': ['get', 'label'],
          'text-size': 10,
          'text-font': ['Noto Sans Bold'],
          'text-offset': [0, -1.5],
        },
        paint: {
          'text-color': 'rgba(235, 247, 255, 0.96)',
          'text-halo-color': 'rgba(8, 16, 29, 0.92)',
          'text-halo-width': 1.3,
        },
      })

      map.addLayer({
        id: 'tampa-focus-outline',
        type: 'line',
        source: 'tampa-boundary',
        paint: {
          'line-color': 'rgba(125, 214, 255, 0.7)',
          'line-width': 2.4,
        },
      })

      const pointsSource = map.getSource('points') as GeoJSONSource | undefined
      pointsSource?.setData(latestPointsGeoJsonRef.current)

      const regionsSource = map.getSource('regions') as GeoJSONSource | undefined
      regionsSource?.setData(latestRegionsGeoJsonRef.current)

      console.debug('MapCanvas load snapshot', {
        pointFeatures: latestPointsGeoJsonRef.current.features.length,
        regionFeatures: latestRegionsGeoJsonRef.current.features.length,
      })

      map.on('mouseenter', 'regions-fill', () => {
        map.getCanvas().style.cursor = 'pointer'
      })

      map.on('mousemove', 'regions-fill', (event) => {
        const feature = event.features?.[0]
        if (!feature || feature.id === undefined || feature.id === null) return

        if (hoveredFeatureIdRef.current !== null && hoveredFeatureIdRef.current !== feature.id) {
          map.setFeatureState({ source: 'regions', id: hoveredFeatureIdRef.current }, { hover: false })
        }

        hoveredFeatureIdRef.current = feature.id
        map.setFeatureState({ source: 'regions', id: feature.id }, { hover: true })
      })

      map.on('mouseleave', 'regions-fill', () => {
        map.getCanvas().style.cursor = ''
        if (hoveredFeatureIdRef.current !== null) {
          map.setFeatureState({ source: 'regions', id: hoveredFeatureIdRef.current }, { hover: false })
          hoveredFeatureIdRef.current = null
        }
      })

      const triggerRegionSelection = (event: maplibregl.MapMouseEvent & { features?: MapGeoJSONFeature[] }) => {
        const handler = onRegionClickRef.current
        if (!handler) return

        event.preventDefault()

        const feature = event.features?.[0] as MapGeoJSONFeature | undefined
        if (!feature) return

        const regionIndexValue = feature.properties?.regionIndex
        const regionIndex = typeof regionIndexValue === 'number'
          ? regionIndexValue
          : Number(regionIndexValue)

        if (!Number.isInteger(regionIndex) || regionIndex < 0) return
        handler(regionIndex)
      }

      map.on('contextmenu', 'regions-fill', triggerRegionSelection)

      map.on('click', 'regions-fill', (event) => {
        const nativeEvent = event.originalEvent as MouseEvent | undefined
        if (!nativeEvent?.shiftKey) return
        triggerRegionSelection(event as maplibregl.MapMouseEvent & { features?: MapGeoJSONFeature[] })
      })

      map.on('mouseenter', 'points-circles', () => {
        map.getCanvas().style.cursor = 'pointer'
      })

      map.on('mousemove', 'points-circles', (event) => {
        const pointFeature = event.features?.[0] as MapGeoJSONFeature | undefined
        if (!pointFeature) return

        const pointIndexValue = pointFeature.properties?.locationIndex
        const pointIndex = typeof pointIndexValue === 'number'
          ? pointIndexValue
          : Number(pointIndexValue)

        if (!Number.isInteger(pointIndex) || pointIndex < 0) return
        if (!event.lngLat) return

        const overlapGroup = getOverlapGroupIndices(map, latestPointsGeoJsonRef.current, pointIndex, 14)
        const nextGroupKey = overlapGroup.length > 1 ? overlapGroup.join(',') : null

        if (nextGroupKey) {
          const anchorFeature = getPointFeatureByLocationIndex(latestPointsGeoJsonRef.current, pointIndex)
          if (anchorFeature) {
            const anchorCoordinates = anchorFeature.geometry.coordinates
            const anchorPixel = map.project({ lng: anchorCoordinates[0], lat: anchorCoordinates[1] })
            const ringRadius = Math.min(44, 20 + overlapGroup.length * 1.8)
            spiderAnchorPixelRef.current = { x: anchorPixel.x, y: anchorPixel.y }
            spiderActiveRadiusRef.current = ringRadius + 18
            spiderfiedGroupIndicesRef.current = [...overlapGroup]
          }
        }

        if (nextGroupKey) {
          if (spiderCollapseTimerRef.current !== null) {
            window.clearTimeout(spiderCollapseTimerRef.current)
            spiderCollapseTimerRef.current = null
          }
        }

        if (nextGroupKey !== spiderfiedGroupKeyRef.current) {
          const source = map.getSource('points') as GeoJSONSource | undefined
          if (source) {
            if (overlapGroup.length > 1) {
              source.setData(buildSpiderfiedPoints(map, latestPointsGeoJsonRef.current, overlapGroup, pointIndex))
              spiderfiedGroupKeyRef.current = nextGroupKey
            } else {
              clearSpiderfy()
            }
          }
        }

        if (hoveredPointIndexRef.current !== pointIndex) {
          hoveredPointIndexRef.current = pointIndex
          map.setFilter('points-hover-ring', ['==', ['get', 'locationIndex'], pointIndex])
        }

        const latitudeValue = pointFeature.properties?.latitude
        const longitudeValue = pointFeature.properties?.longitude
        const roleValue = pointFeature.properties?.role
        const latitude = typeof latitudeValue === 'number' ? latitudeValue : Number(latitudeValue)
        const longitude = typeof longitudeValue === 'number' ? longitudeValue : Number(longitudeValue)
        const role = typeof roleValue === 'number' ? roleValue : Number(roleValue)
        const roleLabel = role === 1 ? 'Responder' : 'User'

        const popup = pointPopupRef.current ?? new maplibregl.Popup({
          closeButton: false,
          closeOnClick: false,
          offset: 14,
          className: 'map-point-popup',
        })

        popup
          .setLngLat(event.lngLat)
          .setHTML(`
            <div class="map-point-popup-card">
              <div class="map-point-popup-title">${pointFeature.properties?.label ?? 'Point'}</div>
              <div class="map-point-popup-row">Role: ${roleLabel}</div>
              <div class="map-point-popup-row">Lat: ${Number.isFinite(latitude) ? latitude.toFixed(6) : 'n/a'}</div>
              <div class="map-point-popup-row">Lng: ${Number.isFinite(longitude) ? longitude.toFixed(6) : 'n/a'}</div>
            </div>
          `)
          .addTo(map)

        pointPopupRef.current = popup
      })

      map.on('mouseleave', 'points-circles', () => {
        map.getCanvas().style.cursor = ''
        if (hoveredPointIndexRef.current !== null) {
          hoveredPointIndexRef.current = null
          map.setFilter('points-hover-ring', ['==', ['get', 'locationIndex'], -1])
        }

        if (spiderfiedGroupKeyRef.current) {
          scheduleSpiderfyCollapse()
        }
        pointPopupRef.current?.remove()
      })

      map.on('mousemove', (event) => {
        if (!spiderfiedGroupKeyRef.current) return

        const pointHits = map.queryRenderedFeatures(event.point, { layers: ['points-circles'] }) as MapGeoJSONFeature[]
        const hoveredSpiderMember = pointHits.some((feature) => {
          const value = feature.properties?.locationIndex
          const index = typeof value === 'number' ? value : Number(value)
          return Number.isInteger(index) && spiderfiedGroupIndicesRef.current.includes(index)
        })

        const anchor = spiderAnchorPixelRef.current
        const radius = spiderActiveRadiusRef.current
        const inAnchorZone = Boolean(anchor) && Math.hypot(event.point.x - anchor.x, event.point.y - anchor.y) <= radius

        if (hoveredSpiderMember || inAnchorZone) {
          if (spiderCollapseTimerRef.current !== null) {
            window.clearTimeout(spiderCollapseTimerRef.current)
            spiderCollapseTimerRef.current = null
          }
          return
        }

        scheduleSpiderfyCollapse()
      })

      map.on('contextmenu', 'points-circles', (event) => {
        const handler = onPointClickRef.current
        if (!handler) return

        event.preventDefault()

        const pointFeature = event.features?.[0] as MapGeoJSONFeature | undefined
        if (!pointFeature) return

        const pointIndexValue = pointFeature.properties?.locationIndex
        const pointIndex = typeof pointIndexValue === 'number'
          ? pointIndexValue
          : Number(pointIndexValue)
        if (!Number.isInteger(pointIndex) || pointIndex < 0) return

        const roleValue = pointFeature.properties?.role
        const role = typeof roleValue === 'number' ? roleValue : Number(roleValue)
        if (!Number.isFinite(role)) return

        const entityIdValue = pointFeature.properties?.entityId
        const entityId = typeof entityIdValue === 'string' && entityIdValue.trim().length > 0
          ? entityIdValue
          : null

        handler({
          locationIndex: pointIndex,
          role,
          entityId,
        })
      })
    })

    mapRef.current = map

    return () => {
      pointPopupRef.current?.remove()
      pointPopupRef.current = null
      if (spiderCollapseTimerRef.current !== null) {
        window.clearTimeout(spiderCollapseTimerRef.current)
        spiderCollapseTimerRef.current = null
      }
      map.remove()
      mapRef.current = null
      hoveredFeatureIdRef.current = null
      hoveredPointIndexRef.current = null
      spiderfiedGroupKeyRef.current = null
      spiderfiedGroupIndicesRef.current = []
      spiderAnchorPixelRef.current = null
      spiderActiveRadiusRef.current = 0
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const source = map.getSource('points') as GeoJSONSource | undefined
    source?.setData(pointsGeoJson)
    if (spiderCollapseTimerRef.current !== null) {
      window.clearTimeout(spiderCollapseTimerRef.current)
      spiderCollapseTimerRef.current = null
    }
    spiderfiedGroupKeyRef.current = null
    spiderfiedGroupIndicesRef.current = []
    spiderAnchorPixelRef.current = null
    spiderActiveRadiusRef.current = 0
    if (!source) {
      console.debug('MapCanvas points source missing on update', {
        features: pointsGeoJson.features.length,
      })
    }
  }, [pointsGeoJson])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const regionsSource = map.getSource('regions') as GeoJSONSource | undefined
    regionsSource?.setData(regionsGeoJson)
    console.debug('MapCanvas region update', {
      incomingRegions: regions.length,
      polygonFeatures: regionsGeoJson.features.length,
      sourceReady: Boolean(regionsSource),
    })
  }, [regionsGeoJson])

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl border border-[var(--border-soft)]">
      <div ref={containerRef} className="h-full w-full" />
      {!MAPTILER_KEY && !import.meta.env.VITE_MAP_STYLE_URL && (
        <div className="pointer-events-none absolute left-3 top-3 rounded-md border border-[rgba(255,190,77,0.42)] bg-[rgba(255,190,77,0.14)] px-2 py-1 text-xs text-[#ffe0af]">
          Add `VITE_MAPTILER_API_KEY` for Tampa production map style.
        </div>
      )}
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-md border border-[var(--border-soft)] bg-[rgba(8,16,29,0.72)] px-2 py-1 text-[10px] text-[var(--text-muted)]">
        Tampa focus area enabled
      </div>
    </div>
  )
}
