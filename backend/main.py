from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import json
import uuid
import asyncio
import random
from math import sqrt
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base, Session

from dotenv import load_dotenv
import os

from responders.responder import add_responder, update_responder
from responders.responder_message import add_responder_message
from users.user import add_user, upsert_user
from users.user_message import add_user_message, add_simulated_user_message, query_user_messages
from regions.region_gen import group_points_into_regions

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    print("DATABSE URL DOESNT EXIST")
    exit(0)

engine = create_engine(DATABASE_URL)

SessionLocal = sessionmaker(bind=engine)

Base = declarative_base()

Base.metadata.create_all(bind=engine)

app = FastAPI()

SIM_USER_PREFIX = "sim-user-"
SIM_RESPONDER_PREFIX = "sim-responder-"
TAMPA_MIN_LAT = 27.82
TAMPA_MAX_LAT = 28.19
TAMPA_MIN_LON = -82.62
TAMPA_MAX_LON = -82.24


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except Exception:
        return default


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return float(raw)
    except Exception:
        return default


ENABLE_DEV_SIMULATION = _env_bool("ENABLE_DEV_SIMULATION", True)
SIM_CLEANUP_ON_START = _env_bool("SIM_CLEANUP_ON_START", True)
SIM_TICK_SECONDS = max(0.05, _env_float("SIM_TICK_SECONDS", 0.2))
SIM_MIN_USERS = max(0, _env_int("SIM_MIN_USERS", 10))
SIM_MAX_USERS = max(SIM_MIN_USERS, _env_int("SIM_MAX_USERS", 24))
SIM_MIN_RESPONDERS = max(0, _env_int("SIM_MIN_RESPONDERS", 3))
SIM_MAX_RESPONDERS = max(SIM_MIN_RESPONDERS, _env_int("SIM_MAX_RESPONDERS", 10))
SIM_SPAWN_PROB = min(1.0, max(0.0, _env_float("SIM_SPAWN_PROB", 0.01)))
SIM_MOVE_PROB = min(1.0, max(0.0, _env_float("SIM_MOVE_PROB", 0.2)))
SIM_MESSAGE_PROB = min(1.0, max(0.0, _env_float("SIM_MESSAGE_PROB", 0.05)))

# Fixed simulation hubs for repeatable clustered behavior in Tampa.
# Each hub is (lat, lon, weight, severity_bias).
SIM_HUBS: list[tuple[float, float, float, float]] = [
    (27.936, -82.458, 1.4, 0.70),
    (28.058, -82.416, 1.2, 0.65),
    (27.878, -82.553, 0.9, 0.55),
    (28.121, -82.305, 0.8, 0.45),
]

SIM_SPAWN_USER_JITTER = max(0.0003, _env_float("SIM_SPAWN_USER_JITTER", 0.007))
SIM_SPAWN_RESPONDER_JITTER = max(0.0003, _env_float("SIM_SPAWN_RESPONDER_JITTER", 0.010))
SIM_HUB_PULL = min(1.0, max(0.0, _env_float("SIM_HUB_PULL", 0.03)))
SIM_MESSAGE_HUB_BIAS = min(1.0, max(0.0, _env_float("SIM_MESSAGE_HUB_BIAS", 0.1)))

def _is_zero_point(lat: float, lon: float) -> bool:
    return abs(lat) < 1e-9 and abs(lon) < 1e-9


def _is_valid_map_point(lat: float, lon: float) -> bool:
    if lat is None or lon is None:
        return False
    try:
        lat_f = float(lat)
        lon_f = float(lon)
    except (TypeError, ValueError):
        return False

    if not (-90 <= lat_f <= 90 and -180 <= lon_f <= 180):
        return False
    if _is_zero_point(lat_f, lon_f):
        return False
    return True


def _clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(value, upper))


def _random_tampa_point() -> tuple[float, float]:
    lat = random.uniform(TAMPA_MIN_LAT, TAMPA_MAX_LAT)
    lon = random.uniform(TAMPA_MIN_LON, TAMPA_MAX_LON)
    return lat, lon


def _pick_sim_hub() -> tuple[float, float, float, float]:
    weights = [hub[2] for hub in SIM_HUBS]
    return random.choices(SIM_HUBS, weights=weights, k=1)[0]


def _closest_sim_hub(lat: float, lon: float) -> tuple[float, float, float, float]:
    return min(
        SIM_HUBS,
        key=lambda hub: (lat - hub[0]) ** 2 + (lon - hub[1]) ** 2,
    )


def _point_around_hub(hub: tuple[float, float, float, float], jitter: float) -> tuple[float, float]:
    # Slightly elliptical jitter creates natural-looking clusters.
    lat = _clamp(hub[0] + random.gauss(0, jitter), TAMPA_MIN_LAT, TAMPA_MAX_LAT)
    lon = _clamp(hub[1] + random.gauss(0, jitter * 1.15), TAMPA_MIN_LON, TAMPA_MAX_LON)
    return lat, lon


def _random_sim_user_id() -> str:
    return f"{SIM_USER_PREFIX}{uuid.uuid4()}"


def _random_sim_responder_id() -> str:
    return f"{SIM_RESPONDER_PREFIX}{uuid.uuid4()}"


SIMULATED_MESSAGE_TEMPLATES = [
    "Water is rising near our building and the first floor is taking on water.",
    "Power is out in this block and we need assistance with medical equipment.",
    "A road is flooded and several people are stranded without transport.",
    "We can smell gas near the intersection and residents are evacuating.",
    "Elderly neighbors need help moving to a safer location.",
    "Supplies are running low and families nearby need drinking water.",
    "Debris is blocking the street and emergency vehicles cannot pass.",
    "Multiple homes reported roof damage after the storm passed through.",
    "Phone signal is unstable and we cannot reach nearby responders reliably.",
    "Flash flooding just started and we need urgent evacuation guidance.",
]


def _priority_for_hub(hub: tuple[float, float, float, float]) -> int:
    severity = hub[3]
    baseline = int(round(severity * 8))
    return int(_clamp(baseline + random.randint(-2, 3), 0, 10))

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@app.get("/")
def root():
    return {"message": "API is running"}

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # allow all origins
    allow_credentials=True,  # allow cookies/auth headers
    allow_methods=["*"],  # allow all HTTP methods
    allow_headers=["*"],  # allow all headers
)

class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[str, WebSocket] = {}

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        client_id = str(uuid.uuid4())
        self.active_connections[client_id] = websocket
        return client_id

    def disconnect(self, client_id: str):
        self.active_connections.pop(client_id, None)

    async def send_personal_message(self, message: str, client_id: str):
        websocket = self.active_connections.get(client_id)
        if websocket:
            try:
                await websocket.send_text(message)
            except Exception:
                self.disconnect(client_id)

    async def broadcast(self, message: str):
        disconnected_ids: list[str] = []
        for client_id, websocket in list(self.active_connections.items()):
            try:
                await websocket.send_text(message)
            except Exception:
                disconnected_ids.append(client_id)

        for client_id in disconnected_ids:
            self.disconnect(client_id)

manager = ConnectionManager()
client_roles: dict[str, str] = {}
latest_regions: list[list[list[float]]] = []
regions_lock = asyncio.Lock()


def _deep_copy_regions(regions: list[list[list[float]]]) -> list[list[list[float]]]:
    return [
        [[float(point[0]), float(point[1]), float(point[2])] for point in region]
        for region in regions
    ]


def _distance(a: tuple[float, float], b: tuple[float, float]) -> float:
    return sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2)


def _cross(origin: tuple[float, float], a: tuple[float, float], b: tuple[float, float]) -> float:
    return (a[0] - origin[0]) * (b[1] - origin[1]) - (a[1] - origin[1]) * (b[0] - origin[0])


def _convex_hull(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    unique_points = sorted(set(points))
    if len(unique_points) <= 2:
        return unique_points

    lower: list[tuple[float, float]] = []
    for point in unique_points:
        while len(lower) >= 2 and _cross(lower[-2], lower[-1], point) <= 0:
            lower.pop()
        lower.append(point)

    upper: list[tuple[float, float]] = []
    for point in reversed(unique_points):
        while len(upper) >= 2 and _cross(upper[-2], upper[-1], point) <= 0:
            upper.pop()
        upper.append(point)

    return lower[:-1] + upper[:-1]


def _distance_point_to_segment(
    point: tuple[float, float],
    seg_a: tuple[float, float],
    seg_b: tuple[float, float],
) -> float:
    ab_x = seg_b[0] - seg_a[0]
    ab_y = seg_b[1] - seg_a[1]
    ap_x = point[0] - seg_a[0]
    ap_y = point[1] - seg_a[1]
    denom = ab_x * ab_x + ab_y * ab_y
    if denom == 0:
        return _distance(point, seg_a)

    t = max(0.0, min(1.0, (ap_x * ab_x + ap_y * ab_y) / denom))
    closest = (seg_a[0] + t * ab_x, seg_a[1] + t * ab_y)
    return _distance(point, closest)


def _point_in_polygon(point: tuple[float, float], polygon: list[tuple[float, float]]) -> bool:
    if len(polygon) < 3:
        return False

    x, y = point
    inside = False
    j = len(polygon) - 1
    for i in range(len(polygon)):
        xi, yi = polygon[i]
        xj, yj = polygon[j]

        intersects = (yi > y) != (yj > y)
        if intersects:
            x_at_y = (xj - xi) * (y - yi) / (yj - yi) + xi
            if x < x_at_y:
                inside = not inside
        j = i

    return inside


def _is_point_inside_region(lat: float, lon: float, region: list[list[float]]) -> bool:
    candidate = (float(lon), float(lat))
    region_points = [(float(point[1]), float(point[0])) for point in region if len(point) >= 2]
    if not region_points:
        return False

    tolerance = 0.0035
    unique_points = list(dict.fromkeys(region_points))
    if len(unique_points) == 1:
        return _distance(candidate, unique_points[0]) <= tolerance

    if len(unique_points) == 2:
        return _distance_point_to_segment(candidate, unique_points[0], unique_points[1]) <= tolerance

    hull = _convex_hull(unique_points)
    if len(hull) < 3:
        return _distance_point_to_segment(candidate, unique_points[0], unique_points[1]) <= tolerance

    if _point_in_polygon(candidate, hull):
        return True

    for index in range(len(hull)):
        seg_a = hull[index]
        seg_b = hull[(index + 1) % len(hull)]
        if _distance_point_to_segment(candidate, seg_a, seg_b) <= tolerance:
            return True

    return False


def _cleanup_simulated_data_sync():
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM user_messages WHERE user_id LIKE :prefix"), {"prefix": f"{SIM_USER_PREFIX}%"})
        conn.execute(text("DELETE FROM responder_messages WHERE user_id LIKE :prefix"), {"prefix": f"{SIM_RESPONDER_PREFIX}%"})
        conn.execute(text("DELETE FROM users WHERE id LIKE :prefix"), {"prefix": f"{SIM_USER_PREFIX}%"})
        conn.execute(text("DELETE FROM responders WHERE id LIKE :prefix"), {"prefix": f"{SIM_RESPONDER_PREFIX}%"})


def _run_simulation_step_sync():
    with engine.begin() as conn:
        sim_users = conn.execute(text("""
            SELECT id,
                   ST_Y(location_geom::geometry) AS latitude,
                   ST_X(location_geom::geometry) AS longitude,
                   priority
            FROM users
            WHERE id LIKE :prefix AND location_geom IS NOT NULL
        """), {"prefix": f"{SIM_USER_PREFIX}%"}).mappings().all()

        sim_responders = conn.execute(text("""
            SELECT id,
                   ST_Y(location_geom::geometry) AS latitude,
                   ST_X(location_geom::geometry) AS longitude
            FROM responders
            WHERE id LIKE :prefix AND location_geom IS NOT NULL
        """), {"prefix": f"{SIM_RESPONDER_PREFIX}%"}).mappings().all()

        users = [
            {
                "id": str(row.id),
                "latitude": float(row.latitude),
                "longitude": float(row.longitude),
                "priority": int(row.priority) if row.priority is not None else 0,
                "hub": _closest_sim_hub(float(row.latitude), float(row.longitude)),
            }
            for row in sim_users
            if _is_valid_map_point(row.latitude, row.longitude)
        ]

        responders = [
            {
                "id": str(row.id),
                "latitude": float(row.latitude),
                "longitude": float(row.longitude),
                "hub": _closest_sim_hub(float(row.latitude), float(row.longitude)),
            }
            for row in sim_responders
            if _is_valid_map_point(row.latitude, row.longitude)
        ]

        while len(users) < SIM_MIN_USERS:
            user_id = _random_sim_user_id()
            hub = _pick_sim_hub()
            lat, lon = _point_around_hub(hub, SIM_SPAWN_USER_JITTER)
            conn.execute(text("""
                INSERT INTO users (id, priority, location_geom)
                VALUES (
                    :id,
                    0,
                    ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography
                )
                ON CONFLICT (id) DO NOTHING
            """), {"id": user_id, "lat": lat, "lon": lon})
            users.append({"id": user_id, "latitude": lat, "longitude": lon, "priority": 0, "hub": hub})

        while len(responders) < SIM_MIN_RESPONDERS:
            responder_id = _random_sim_responder_id()
            hub = _pick_sim_hub()
            lat, lon = _point_around_hub(hub, SIM_SPAWN_RESPONDER_JITTER)
            conn.execute(text("""
                INSERT INTO responders (id, location_geom)
                VALUES (
                    :id,
                    ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography
                )
                ON CONFLICT (id) DO NOTHING
            """), {"id": responder_id, "lat": lat, "lon": lon})
            responders.append({"id": responder_id, "latitude": lat, "longitude": lon, "hub": hub})

        if len(users) < SIM_MAX_USERS and random.random() < SIM_SPAWN_PROB:
            user_id = _random_sim_user_id()
            hub = _pick_sim_hub()
            lat, lon = _point_around_hub(hub, SIM_SPAWN_USER_JITTER)
            conn.execute(text("""
                INSERT INTO users (id, priority, location_geom)
                VALUES (
                    :id,
                    0,
                    ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography
                )
                ON CONFLICT (id) DO NOTHING
            """), {"id": user_id, "lat": lat, "lon": lon})
            users.append({"id": user_id, "latitude": lat, "longitude": lon, "priority": 0, "hub": hub})

        if len(responders) < SIM_MAX_RESPONDERS and random.random() < SIM_SPAWN_PROB * 0.75:
            responder_id = _random_sim_responder_id()
            hub = _pick_sim_hub()
            lat, lon = _point_around_hub(hub, SIM_SPAWN_RESPONDER_JITTER)
            conn.execute(text("""
                INSERT INTO responders (id, location_geom)
                VALUES (
                    :id,
                    ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography
                )
                ON CONFLICT (id) DO NOTHING
            """), {"id": responder_id, "lat": lat, "lon": lon})
            responders.append({"id": responder_id, "latitude": lat, "longitude": lon, "hub": hub})

        for user in users:
            if random.random() > SIM_MOVE_PROB:
                continue
            hub = user.get("hub") or _closest_sim_hub(user["latitude"], user["longitude"])
            to_hub_lat = (hub[0] - user["latitude"]) * SIM_HUB_PULL
            to_hub_lon = (hub[1] - user["longitude"]) * SIM_HUB_PULL
            next_lat = _clamp(user["latitude"] + random.uniform(-0.00016, 0.00016) + to_hub_lat, TAMPA_MIN_LAT, TAMPA_MAX_LAT)
            next_lon = _clamp(user["longitude"] + random.uniform(-0.00016, 0.00016) + to_hub_lon, TAMPA_MIN_LON, TAMPA_MAX_LON)
            conn.execute(text("""
                UPDATE users
                SET location_geom = ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography
                WHERE id = :id AND id LIKE :prefix
            """), {"id": user["id"], "lat": next_lat, "lon": next_lon, "prefix": f"{SIM_USER_PREFIX}%"})
            user["latitude"] = next_lat
            user["longitude"] = next_lon
            user["hub"] = hub

        for responder in responders:
            if random.random() > SIM_MOVE_PROB:
                continue
            hub = responder.get("hub") or _closest_sim_hub(responder["latitude"], responder["longitude"])
            to_hub_lat = (hub[0] - responder["latitude"]) * SIM_HUB_PULL
            to_hub_lon = (hub[1] - responder["longitude"]) * SIM_HUB_PULL
            next_lat = _clamp(responder["latitude"] + random.uniform(-0.00018, 0.00018) + to_hub_lat, TAMPA_MIN_LAT, TAMPA_MAX_LAT)
            next_lon = _clamp(responder["longitude"] + random.uniform(-0.00018, 0.00018) + to_hub_lon, TAMPA_MIN_LON, TAMPA_MAX_LON)
            conn.execute(text("""
                UPDATE responders
                SET location_geom = ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography
                WHERE id = :id AND id LIKE :prefix
            """), {"id": responder["id"], "lat": next_lat, "lon": next_lon, "prefix": f"{SIM_RESPONDER_PREFIX}%"})
            responder["latitude"] = next_lat
            responder["longitude"] = next_lon
            responder["hub"] = hub

    if users and random.random() < SIM_MESSAGE_PROB:
        user_weights = []
        for user in users:
            hub = user.get("hub") or _closest_sim_hub(user["latitude"], user["longitude"])
            severity = hub[3]
            weight = 1.0 + severity * (2.4 * SIM_MESSAGE_HUB_BIAS)
            user_weights.append(weight)

        selected = random.choices(users, weights=user_weights, k=1)[0]
        selected_hub = selected.get("hub") or _closest_sim_hub(selected["latitude"], selected["longitude"])
        generated_priority = _priority_for_hub(selected_hub)
        content = random.choice(SIMULATED_MESSAGE_TEMPLATES)
        add_simulated_user_message(
            content=content,
            user_id=selected["id"],
            priority=generated_priority,
            lat=selected["latitude"],
            lon=selected["longitude"],
            extra_metadata={"simulated": True, "hub_lat": selected_hub[0], "hub_lon": selected_hub[1]},
        )


async def simulation_periodic():
    if not ENABLE_DEV_SIMULATION:
        return

    loop = asyncio.get_running_loop()

    if SIM_CLEANUP_ON_START:
        await loop.run_in_executor(None, _cleanup_simulated_data_sync)

    while True:
        await asyncio.sleep(SIM_TICK_SECONDS)
        try:
            await loop.run_in_executor(None, _run_simulation_step_sync)
        except Exception as error:
            print(f"simulation_periodic error: {error}")

async def broadcast_periodic():
    loop = asyncio.get_running_loop()

    while True:
        await asyncio.sleep(5)

        def get_locations_sync():
            db = SessionLocal()
            try:
                users_result = db.execute(text("""
                    SELECT id,
                           ST_Y(location_geom::geometry) AS latitude,
                           ST_X(location_geom::geometry) AS longitude,
                           priority
                    FROM users
                    WHERE location_geom IS NOT NULL;
                """)).mappings().all()

                responders_result = db.execute(text("""
                    SELECT id,
                           ST_Y(location_geom::geometry) AS latitude,
                           ST_X(location_geom::geometry) AS longitude
                    FROM responders
                    WHERE location_geom IS NOT NULL;
                """)).mappings().all()

                valid_users = [
                    {
                        "id": str(row.id),
                        "latitude": float(row.latitude),
                        "longitude": float(row.longitude),
                        "priority": int(row.priority) if row.priority is not None else 0,
                    }
                    for row in users_result
                    if _is_valid_map_point(row.latitude, row.longitude)
                ]

                valid_responders = [
                    {
                        "id": str(row.id),
                        "latitude": float(row.latitude),
                        "longitude": float(row.longitude),
                    }
                    for row in responders_result
                    if _is_valid_map_point(row.latitude, row.longitude)
                ]

                all_locations = [
                    [user["latitude"], user["longitude"], 0, user["id"]] for user in valid_users
                ] + [
                    [responder["latitude"], responder["longitude"], 1, responder["id"]]
                    for responder in valid_responders
                ]

                valid_user_points = [
                    [user["latitude"], user["longitude"], user["priority"]]
                    for user in valid_users
                ]

                regions = group_points_into_regions(valid_user_points)

                debug = {
                    "users_total": len(users_result),
                    "users_valid_for_regions": len(valid_users),
                    "responders_total": len(responders_result),
                    "responders_valid_for_map": len(valid_responders),
                    "regions_count": len(regions),
                    "active_connections": len(manager.active_connections),
                }

                return all_locations, regions, debug
            finally:
                db.close()

        try:
            locations, regions, debug = await loop.run_in_executor(None, get_locations_sync)

            global latest_regions
            async with regions_lock:
                latest_regions = _deep_copy_regions(regions)

            await manager.broadcast(json.dumps({
                "locations": locations,
                "regions": regions,
                "region_debug": debug,
            }))
        except Exception as error:
            print(f"broadcast_periodic error: {error}")

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(broadcast_periodic())
    if ENABLE_DEV_SIMULATION:
        asyncio.create_task(simulation_periodic())

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    client_id = await manager.connect(websocket)
    await manager.send_personal_message(json.dumps({ "client_id": client_id }), client_id)

    db = SessionLocal()

    try:
        while True:
            json_data = await websocket.receive_text()
            json_data = json_data.strip().strip("'").strip('"')
            location = json.loads(json_data)
            if not isinstance(location, list) or len(location) < 2:
                continue

            try:
                lat = float(location[0])
                lon = float(location[1])
            except (TypeError, ValueError):
                continue
            role = client_roles.get(client_id)

            if role == "user":
                upsert_user(client_id, lat, lon)
                continue

            if role == "responder":
                update_responder(client_id, lat, lon)
                continue

            query = text("""
                SELECT EXISTS (
                SELECT 1 FROM users WHERE id = :user_id
                )
                """)
            user_exists = db.execute(query, {"user_id": client_id}).scalar()
            if user_exists:
                upsert_user(client_id, lat, lon)
                continue

            responder_query = text("""
                SELECT EXISTS (
                SELECT 1 FROM responders WHERE id = :responder_id
                )
                """)
            responder_exists = db.execute(responder_query, {"responder_id": client_id}).scalar()
            if responder_exists:
                update_responder(client_id, lat, lon)
                continue

            # Role has not been persisted yet; wait for /switch.
            continue

    except WebSocketDisconnect:
        manager.disconnect(client_id)
        client_roles.pop(client_id, None)
        await manager.broadcast(f"Client {client_id} disconnected")
    finally:
        db.close()

@app.post("/switch")
async def handle_switch(client_id: str = "", role: str = "User"):
    role_lower = role.lower()
    if role_lower not in {"user", "responder"}:
        role_lower = "user"

    with engine.begin() as conn:
        user_exists = conn.execute(
            text("SELECT EXISTS (SELECT 1 FROM users WHERE id = :id)"),
            {"id": client_id}
        ).scalar()
        responder_exists = conn.execute(
            text("SELECT EXISTS (SELECT 1 FROM responders WHERE id = :id)"),
            {"id": client_id}
        ).scalar()

    if role_lower == "user":
        if responder_exists:
            with engine.begin() as conn:
                conn.execute(text("DELETE FROM responders WHERE id = :id"), {"id": client_id})
        if not user_exists:
            add_user(client_id, 0, 0)
    else:
        if user_exists:
            with engine.begin() as conn:
                conn.execute(text("DELETE FROM users WHERE id = :id"), {"id": client_id})
        if not responder_exists:
            add_responder(client_id, 0, 0)

    client_roles[client_id] = role_lower
    return {"status": "switch handled"}

@app.post("/report")
async def get_summary_for_region(region_id: int = 0, prompt: str = "", db: Session = Depends(get_db)):
    async with regions_lock:
        regions_snapshot = _deep_copy_regions(latest_regions)

    if region_id < 0 or region_id >= len(regions_snapshot):
        raise HTTPException(status_code=404, detail="Region not found")

    selected_region = regions_snapshot[region_id]

    users_result = db.execute(text("""
        SELECT id,
               ST_Y(location_geom::geometry) AS latitude,
               ST_X(location_geom::geometry) AS longitude
        FROM users
        WHERE location_geom IS NOT NULL;
    """)).mappings().all()

    matched_user_ids: list[str] = []
    for user in users_result:
        lat = user.latitude
        lon = user.longitude
        if lat is None or lon is None:
            continue
        if _is_point_inside_region(float(lat), float(lon), selected_region):
            matched_user_ids.append(str(user.id))

    if len(matched_user_ids) == 0:
        return {
            "region_id": region_id,
            "matched_user_ids": [],
            "matched_user_count": 0,
            "report": "No users were found in this region.",
        }

    report_prompt = prompt.strip() or (
        "Generate a concise operational situation report for these users in this region. "
        "Include immediate risks, recurring themes, and recommended responder actions."
    )

    res = await query_user_messages(report_prompt, user_id=matched_user_ids)

    if res.response.lower().strip() == "empty response":
        res.response = "Can not generate report since there are no messages"

    return {
        "region_id": region_id,
        "matched_user_ids": matched_user_ids,
        "matched_user_count": len(matched_user_ids),
        "report": res.response,
    }

@app.get("/user_messages")
def get_user_messages(client_id: str = "", user_id: str = "", db: Session = Depends(get_db)):
    sql = text("""
        SELECT id,
               user_id,
               content,
               time,
               ST_Y(location_geom::geometry) AS latitude,
               ST_X(location_geom::geometry) AS longitude
        FROM user_messages
        WHERE user_id = :user_id
        ORDER BY time DESC
    """)
    results = db.execute(sql, {"user_id": user_id}).fetchall()
    messages = [dict(row._mapping) for row in results]
    return {"messages": messages}

@app.post("/query")
async def handle_query(client_id: str = "", content: str = ""):
    res = await query_user_messages(content)
    # query the RAG
    return {"content": res.response}

@app.post("/message")
async def handle_message(client_id: str = "", content: str = "", role: str = ""):
    if role.lower() == "user":
        await add_user_message(content, client_id)
    else:
        add_responder_message(content, client_id)
        await manager.broadcast(json.dumps({ "responder_message": content }))
    return {"status": "message handled"}
