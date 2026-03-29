from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends
from fastapi.middleware.cors import CORSMiddleware
import json
import uuid
import asyncio
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base, Session

from dotenv import load_dotenv
import os

from responders.responder import add_responder, update_responder
from responders.responder_message import add_responder_message
from users.user import add_user, upsert_user
from users.user_message import add_user_message, query_user_messages
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

async def broadcast_periodic():
    loop = asyncio.get_running_loop()

    while True:
        await asyncio.sleep(5)

        def get_locations_sync():
            db = SessionLocal()
            try:
                users_result = db.execute(text("""
                    SELECT ST_Y(location_geom::geometry) AS latitude,
                           ST_X(location_geom::geometry) AS longitude,
                           priority
                    FROM users
                    WHERE location_geom IS NOT NULL;
                """)).mappings().all()

                responders_result = db.execute(text("""
                    SELECT ST_Y(location_geom::geometry) AS latitude,
                           ST_X(location_geom::geometry) AS longitude
                    FROM responders
                    WHERE location_geom IS NOT NULL;
                """)).mappings().all()

                valid_user_points = [
                    [row.latitude, row.longitude, int(row.priority) if row.priority is not None else 0]
                    for row in users_result
                    if _is_valid_map_point(row.latitude, row.longitude)
                ]

                valid_responder_points = [
                    [row.latitude, row.longitude, 1]
                    for row in responders_result
                    if _is_valid_map_point(row.latitude, row.longitude)
                ]

                all_locations = [
                    [point[0], point[1], 0] for point in valid_user_points
                ] + valid_responder_points

                regions = group_points_into_regions(valid_user_points)

                debug = {
                    "users_total": len(users_result),
                    "users_valid_for_regions": len(valid_user_points),
                    "responders_total": len(responders_result),
                    "responders_valid_for_map": len(valid_responder_points),
                    "regions_count": len(regions),
                    "active_connections": len(manager.active_connections),
                }

                return all_locations, regions, debug
            finally:
                db.close()

        try:
            locations, regions, debug = await loop.run_in_executor(None, get_locations_sync)
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

# @app.post("/report")
# async def get_summary_for_users(user_ids: int = 0, db = Depends(get_db)):
#     polygon = regions[region_id]
#     query = text("""
#         SELECT ST_Y(location_geom::geometry) AS latitude,
#                ST_X(location_geom::geometry) AS longitude,
#                id
#         FROM users;
#     """)
#     
#     users_result = db.execute(query).mappings().all()
#     
#     users_inside = []
#     for user in users_result:
#         if is_point_in_polygon(user['latitude'], user['longitude'], polygon):
#             users_inside.append(user["id"])
#
#     res = query_user_messages("Make a summary", user_id=users_inside)
#     return res.response

def get_user_messages(client_id: str = "", user_id: str = "", db: Session = Depends(get_db)):
    sql = text("SELECT * FROM user_messages WHERE user_id = :user_id")
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
