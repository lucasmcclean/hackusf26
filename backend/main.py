from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import json
import uuid
import asyncio
from fastapi import FastAPI
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from dotenv import load_dotenv
import os

from messages.user_message import add_user_message

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
    while True:
        await asyncio.sleep(5)
        locations = [[1, 2], [2, 3], [3, 4]] #get all lcoations by selecting location column from users
        regions = [[1, 2], [3]] # get regions using agents
        await manager.broadcast(json.dumps({ "locations": locations, "regions": regions }))

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(broadcast_periodic())

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    client_id = await manager.connect(websocket)
    await manager.send_personal_message(json.dumps({ "client_id": client_id }), client_id)

    try:
        while True:
            json_data = await websocket.receive_text()
            json_data = json_data.strip().strip("'").strip('"')
            location = json.loads(json_data)
            print(location)
            # set location in the db

    except WebSocketDisconnect:
        manager.disconnect(client_id)
        await manager.broadcast(f"Client {client_id} disconnected")

@app.post("/switch")
async def handle_switch(client_id: str = ""):
    current_type = "User"  # get db type
    if current_type == "User":
        pass  # add a responder to the table with this client id
    else:
        pass  # add a user to the table with this current client id
    return {"status": "switch handled"}

@app.post("/query")
async def handle_query(client_id: str = "", content: str = ""):
    # query the RAG
    return {"content": "stuff"}

@app.post("/message")
async def handle_message(client_id: str = "", content: str = ""):
    current_type = "User"  # get user type from db
    if current_type == "User":
        add_user_message(content, client_id)
    else:
        await manager.broadcast(json.dumps({ "responder_message": content }));
    return {"status": "message handled"}
