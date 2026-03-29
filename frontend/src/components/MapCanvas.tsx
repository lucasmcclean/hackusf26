import { useEffect, useMemo, useRef } from 'react'
import maplibregl, { type GeoJSONSource, type LngLatBoundsLike, type MapGeoJSONFeature } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { RegionPolygon } from '../services/api'

export type LocationTuple = [number, number, number?]

interface MapCanvasProps {
  locations: LocationTuple[]
  regions?: RegionPolygon[]
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

function twoPointBuffer(points: [number, number][], halfSize: number): [number, number][] {
  const [a, b] = points
  return [
    [Math.min(a[0], b[0]) - halfSize, Math.min(a[1], b[1]) - halfSize],
    [Math.max(a[0], b[0]) + halfSize, Math.min(a[1], b[1]) - halfSize],
    [Math.max(a[0], b[0]) + halfSize, Math.max(a[1], b[1]) + halfSize],
    [Math.min(a[0], b[0]) - halfSize, Math.max(a[1], b[1]) + halfSize],
  ]
}

function buildRegionRing(regionPoints: Array<[number, number]>): [number, number][] {
  const validPoints = regionPoints
    .filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]))
    .map((point) => normalizeToLngLat(point))

  if (validPoints.length === 0) return []
  if (validPoints.length === 1) return closeRing(pointSquare(validPoints[0][0], validPoints[0][1], 0.0045))
  if (validPoints.length === 2) return closeRing(twoPointBuffer(validPoints, 0.0035))

  const hull = convexHull(validPoints)
  if (hull.length < 3) return closeRing(twoPointBuffer(validPoints.slice(0, 2), 0.0035))
  return closeRing(hull)
}

export function MapCanvas({ locations, regions = [] }: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const hoveredFeatureIdRef = useRef<number | string | null>(null)
  const hoveredPointIndexRef = useRef<number | null>(null)
  const pointPopupRef = useRef<maplibregl.Popup | null>(null)
  const latestPointsGeoJsonRef = useRef<GeoJSON.FeatureCollection<GeoJSON.Point>>({
    type: 'FeatureCollection',
    features: [],
  })
  const latestRegionsGeoJsonRef = useRef<GeoJSON.FeatureCollection<GeoJSON.Polygon>>({
    type: 'FeatureCollection',
    features: [],
  })

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
          },
          geometry: {
            type: 'Point',
            coordinates: toLngLat(location),
          },
        })),
    }
  }, [locations])

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
          'circle-radius': 11,
          'circle-color': [
            'case',
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
        pointPopupRef.current?.remove()
      })
    })

    mapRef.current = map

    return () => {
      pointPopupRef.current?.remove()
      pointPopupRef.current = null
      map.remove()
      mapRef.current = null
      hoveredFeatureIdRef.current = null
      hoveredPointIndexRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const source = map.getSource('points') as GeoJSONSource | undefined
    source?.setData(pointsGeoJson)
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
