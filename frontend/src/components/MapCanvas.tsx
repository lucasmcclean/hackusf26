import { useEffect, useMemo, useRef } from 'react'
import maplibregl, { type GeoJSONSource, type LngLatBoundsLike, type MapGeoJSONFeature } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

export type LocationTuple = [number, number]
export type RegionGroup = number[]

interface MapCanvasProps {
  locations: LocationTuple[]
  regions?: RegionGroup[]
  onRegionClick?: (regionIndex: number, nodeIndices: RegionGroup) => void
  highlightedRegion?: number | null
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

function orderPolygonPoints(points: [number, number][]): [number, number][] {
  const centroid: [number, number] = [
    points.reduce((sum, point) => sum + point[0], 0) / points.length,
    points.reduce((sum, point) => sum + point[1], 0) / points.length,
  ]

  return [...points].sort((a, b) => {
    const angleA = Math.atan2(a[1] - centroid[1], a[0] - centroid[0])
    const angleB = Math.atan2(b[1] - centroid[1], b[0] - centroid[0])
    return angleA - angleB
  })
}

export function MapCanvas({
  locations,
  regions = [],
  onRegionClick,
  highlightedRegion = null,
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const hoveredFeatureIdRef = useRef<number | string | null>(null)
  const regionsRef = useRef<RegionGroup[]>(regions)
  const onRegionClickRef = useRef<MapCanvasProps['onRegionClick']>(onRegionClick)

  useEffect(() => {
    regionsRef.current = regions
    onRegionClickRef.current = onRegionClick
  }, [onRegionClick, regions])

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
          },
          geometry: {
            type: 'Point',
            coordinates: toLngLat(location),
          },
        })),
    }
  }, [locations])

  const regionsGeoJson = useMemo<GeoJSON.FeatureCollection<GeoJSON.Polygon>>(() => {
    return {
      type: 'FeatureCollection',
      features: regions.flatMap((region, regionIndex) => {
        const orderedPoints = orderPolygonPoints(
          region
            .map((pointIndex) => locations[pointIndex])
            .filter((location): location is LocationTuple => Array.isArray(location) && isFiniteLocation(location))
            .map((location) => toLngLat(location)),
        )

        if (orderedPoints.length < 3) return []
        const closedRing = [...orderedPoints, orderedPoints[0]]

        return [{
          type: 'Feature',
          id: regionIndex,
          properties: {
            regionIndex,
            label: `Region ${regionIndex + 1}`,
          },
          geometry: {
            type: 'Polygon',
            coordinates: [closedRing],
          },
        }]
      }),
    }
  }, [locations, regions])

  const regionLabelsGeoJson = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point>>(() => {
    return {
      type: 'FeatureCollection',
      features: regionsGeoJson.features.map((feature) => {
        const ring = feature.geometry.coordinates[0]
        const center: [number, number] = [
          ring.reduce((sum, point) => sum + point[0], 0) / ring.length,
          ring.reduce((sum, point) => sum + point[1], 0) / ring.length,
        ]

        return {
          type: 'Feature',
          properties: {
            label: feature.properties?.label,
          },
          geometry: {
            type: 'Point',
            coordinates: center,
          },
        }
      }),
    }
  }, [regionsGeoJson])

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

    map.on('load', () => {
      map.addSource('tampa-boundary', {
        type: 'geojson',
        data: TAMPA_BOUNDARY,
      })

      map.addSource('regions', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })

      map.addSource('region-labels', {
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
            'rgba(79, 194, 255, 0.34)',
            'rgba(53, 184, 255, 0.18)',
          ],
        },
      })

      map.addLayer({
        id: 'regions-outline',
        type: 'line',
        source: 'regions',
        paint: {
          'line-color': 'rgba(110, 207, 255, 0.55)',
          'line-width': 1.8,
        },
      })

      map.addLayer({
        id: 'regions-highlight-fill',
        type: 'fill',
        source: 'regions',
        filter: ['==', ['get', 'regionIndex'], -1],
        paint: {
          'fill-color': 'rgba(42, 212, 155, 0.32)',
        },
      })

      map.addLayer({
        id: 'regions-highlight-outline',
        type: 'line',
        source: 'regions',
        filter: ['==', ['get', 'regionIndex'], -1],
        paint: {
          'line-color': 'rgba(42, 212, 155, 0.95)',
          'line-width': 2.8,
        },
      })

      map.addLayer({
        id: 'region-labels',
        type: 'symbol',
        source: 'region-labels',
        layout: {
          'text-field': ['coalesce', ['get', 'label'], ''],
          'text-size': 11,
          'text-font': ['Noto Sans Regular'],
        },
        paint: {
          'text-color': 'rgba(225, 241, 255, 0.95)',
          'text-halo-color': 'rgba(8, 16, 29, 0.92)',
          'text-halo-width': 1.3,
        },
      })

      map.addLayer({
        id: 'points-circles',
        type: 'circle',
        source: 'points',
        paint: {
          'circle-radius': 7,
          'circle-color': 'rgba(255, 110, 110, 0.9)',
          'circle-stroke-width': 2,
          'circle-stroke-color': 'rgba(255, 233, 233, 0.85)',
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

      map.on('mouseenter', 'regions-fill', () => {
        map.getCanvas().style.cursor = 'pointer'
      })

      map.on('mousemove', 'regions-fill', (event) => {
        if (event.features?.length !== 1) return
        const feature = event.features[0]
        if (feature.id === undefined || feature.id === null) return

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

      map.on('click', 'regions-fill', (event) => {
        const clickHandler = onRegionClickRef.current
        if (!clickHandler) return
        const feature = event.features?.[0] as MapGeoJSONFeature | undefined
        if (!feature) return
        const regionIndexValue = feature.properties?.regionIndex
        const regionIndex = typeof regionIndexValue === 'number'
          ? regionIndexValue
          : Number(regionIndexValue)
        if (!Number.isInteger(regionIndex) || regionIndex < 0) return

        const clickedRegion = regionsRef.current[regionIndex]
        if (!clickedRegion) return
        clickHandler(regionIndex, clickedRegion)
      })
    })

    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
      hoveredFeatureIdRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!map.isStyleLoaded()) return

    const source = map.getSource('points') as GeoJSONSource | undefined
    source?.setData(pointsGeoJson)
  }, [pointsGeoJson])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!map.isStyleLoaded()) return

    const regionsSource = map.getSource('regions') as GeoJSONSource | undefined
    regionsSource?.setData(regionsGeoJson)

    const labelsSource = map.getSource('region-labels') as GeoJSONSource | undefined
    labelsSource?.setData(regionLabelsGeoJson)

    const highlightFilter = ['==', ['get', 'regionIndex'], highlightedRegion ?? -1] as maplibregl.FilterSpecification
    map.setFilter('regions-highlight-fill', highlightFilter)
    map.setFilter('regions-highlight-outline', highlightFilter)
  }, [highlightedRegion, regionLabelsGeoJson, regionsGeoJson])

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl border border-[var(--border-soft)]">
      <div ref={containerRef} className="h-full w-full" />
      {!MAPTILER_KEY && !import.meta.env.VITE_MAP_STYLE_URL && (
        <div className="pointer-events-none absolute left-3 top-3 rounded-md border border-[rgba(255,190,77,0.42)] bg-[rgba(255,190,77,0.14)] px-2 py-1 text-xs text-[#ffe0af]">
          Add `VITE_MAPTILER_API_KEY` for Tampa production map style.
        </div>
      )}
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-md border border-[var(--border-soft)] bg-[rgba(8,16,29,0.72)] px-2 py-1 text-[10px] text-[var(--text-muted)]">
        Tampa focus region enabled
      </div>
    </div>
  )
}
