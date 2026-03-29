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

add_user_message("Roads are blocked by debris and I can't leave.", '6124eebd-7f79-42dc-9286-0dccf792139d')
add_user_message("My neighbor needs help, they're stuck in their house.", '54bcbd55-ea03-40cc-98c5-0133e9e3a69e')
add_user_message("Roads are blocked by debris and I can't leave.", 'd94c855e-5e49-4578-a603-fe71d1311af1')
add_user_message("My neighbor needs help, they're stuck in their house.", '116ed88e-dac3-4ea8-84df-000a32cf1266')
add_user_message("Roads are blocked by debris and I can't leave.", '90fc6d54-7098-4870-aa10-78e48c449537')
add_user_message("Roads are blocked by debris and I can't leave.", '9739a13c-4e49-4601-abd4-ff0d89dbded6')
add_user_message("My house is flooding and I can't get out!", '5ed00697-fed9-47b2-9b82-c641aa00055d')
add_user_message("My neighbor needs help, they're stuck in their house.", '03bc65a2-bc45-440e-9859-e053d236273a')
add_user_message("My house is flooding and I can't get out!", '2542ed50-8db6-4494-a263-7798ce90ea3b')
add_user_message("Basement is completely under water.", 'b230c499-54ca-41f0-9eda-e11501e87954')
add_user_message("Trees fell on power lines, no electricity.", '5547f935-115a-4676-8476-37d50da390ff')
add_user_message("Trees fell on power lines, no electricity.", '1efb30df-8d2f-456a-9fd9-5778cb08d3b1')
add_user_message("Trapped in my car due to flood water.", '57cdb684-fc2d-44fc-9877-781ef2ebb852')
add_user_message("Trees fell on power lines, no electricity.", 'd6fbf520-e4c5-49fd-974d-16f3c0884d8c')
add_user_message("Water level rising fast in my area, need evacuation!", 'e58e2c0e-e542-46cb-87f7-43bebbe16cfb')
add_user_message("Strong winds blew the roof off my shed, please help!", 'd2894577-bba7-4da4-98a5-572c187fae6c')
add_user_message("Trees fell on power lines, no electricity.", 'fefedc77-69b9-4678-86d7-b38cf86eff46')
add_user_message("Flooded streets, can't reach the main road.", '909ccf56-c0b8-4546-a81b-12d6546144de')
add_user_message("My neighbor needs help, they're stuck in their house.", '7cf2a669-8a2b-4d63-9a88-eff1fd352b40')
add_user_message("My neighbor needs help, they're stuck in their house.", 'd34d5edb-39cd-4ff9-953a-1c8f9f32de56')
add_user_message("Trapped in my car due to flood water.", '57b8eb99-d453-46a4-bf74-f5c3ae4cc00c')
add_user_message("Basement is completely under water.", '654644aa-b0c0-4d44-bbf7-e787f4c6d548')
add_user_message("Basement is completely under water.", '96824908-75cc-418e-bf0e-f95f799a73fa')
add_user_message("Roads are blocked by debris and I can't leave.", 'aec9d235-6ac4-459f-b32f-f915806ad67a')
add_user_message("Flooded streets, can't reach the main road.", 'b9047c3b-8179-45a3-9671-a5c8d11cb732')
add_user_message("My neighbor needs help, they're stuck in their house.", '712c29c3-21e5-4f47-bf54-f28861f6058b')
add_user_message("Trapped in my car due to flood water.", '6c3d817c-2c2b-4f52-8409-0d3086653956')
add_user_message("Water level rising fast in my area, need evacuation!", 'b334e685-da44-4e9b-a893-5bd2e178291d')
add_user_message("Water level rising fast in my area, need evacuation!", '82f6fd28-e395-441b-b8a0-580fb6d74bef')
add_user_message("Water level rising fast in my area, need evacuation!", 'c6187f97-89bd-4926-bc5a-284d69b20970')

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
