import os

from sqlalchemy import create_engine, text

DATABASE_URL = os.getenv("DATABASE_URL", "uh oh")

engine = create_engine(DATABASE_URL)

def add_user(id: str, lat: float, lon: float,):
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                    INSERT INTO users (id, location_geom)
                    VALUES (
                        :id,
                        ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography
                    )
                """
            ),
            {"id": id, "lat": lat, "lon": lon}
        )

def update_user(id: int, lat: float, lon: float, priority: int = None):
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                UPDATE users
                SET location_geom = ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography
                WHERE id = :id
                """
            ),
            {"id": id, "lat": lat, "lon": lon}
        )


def upsert_user(id: str, lat: float, lon: float):
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO users (id, location_geom)
                VALUES (
                    :id,
                    ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography
                )
                ON CONFLICT (id)
                DO UPDATE SET location_geom = EXCLUDED.location_geom
                """
            ),
            {"id": id, "lat": lat, "lon": lon}
        )
