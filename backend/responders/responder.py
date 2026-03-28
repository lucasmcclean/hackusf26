import os

from sqlalchemy import create_engine, text

DATABASE_URL = os.getenv("DATABASE_URL", "uh oh")

engine = create_engine(DATABASE_URL)

def add_responder(id: str,):
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO responders (id) "
                "VALUES (:id)"
            ),
            {"id": id}
        )
