from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import json
import uuid
import asyncio
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base

from dotenv import load_dotenv
import os

from responders.responder import add_responder, update_responder
from responders.responder_message import add_responder_message
from users.user import add_user, update_user
from users.user_message import add_user_message, query_user_messages
from regions.region_gen import compute_priority_polygons

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

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@app.get("/")
def root():
    return {"message": "API is running"}

app = FastAPI()

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
            await websocket.send_text(message)

    async def broadcast(self, message: str):
        for websocket in self.active_connections.values():
            await websocket.send_text(message)

manager = ConnectionManager()

async def broadcast_periodic():
    loop = asyncio.get_running_loop()
    prev_regions = []
    reports = []

    while True:
        await asyncio.sleep(5)

        def get_locations_sync():
            nonlocal prev_regions
            db = SessionLocal()
            try:
                users_result = db.execute(text("""
                    SELECT ST_Y(location_geom::geometry) AS latitude,
                           ST_X(location_geom::geometry) AS longitude,
                           priority
                    FROM users;
                """)).mappings().all()

                # Fetch locations from responders
                responders_result = db.execute(text("""
                    SELECT ST_Y(location_geom::geometry) AS latitude,
                           ST_X(location_geom::geometry) AS longitude
                    FROM responders;
                """)).mappings().all()

                all_locations = [[row.latitude, row.longitude, 0] for row in users_result] + [[row.latitude, row.longitude, 1] for row in responders_result]

                points = [[row.latitude, row.longitude, row.priority] for row in users_result]
                regions = compute_priority_polygons(points)
                if regions != prev_regions:
                    # TODO: Generate summaries for regions
                    print("Changed regions")
                prev_regions = regions

                return all_locations, regions
            finally:
                db.close()

        locations, regions = await loop.run_in_executor(None, get_locations_sync)

        await manager.broadcast(json.dumps({
            "locations": locations,
            "regions": regions,
            "reports": reports
        }))

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
            query = text("""
                SELECT EXISTS (
                SELECT 1 FROM users WHERE id = :user_id
                )
                """)
            result = db.execute(query, {"user_id": client_id}).scalar()
            if result:
                update_user(client_id, float(location[0]), float(location[1]))
            else:
                update_responder(client_id, float(location[0]), float(location[1]))

    except WebSocketDisconnect:
        manager.disconnect(client_id)
        await manager.broadcast(f"Client {client_id} disconnected")
    finally:
        db.close()

@app.post("/switch")
async def handle_switch(client_id: str = "", role: str = "User"):
    if role.lower() == "user":
        add_user(client_id, 0, 0)
    else:
        add_responder(client_id, 0, 0)
    return {"status": "switch handled"}

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
