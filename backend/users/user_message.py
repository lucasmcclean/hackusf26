import os
from datetime import datetime
from typing import Dict, Any

from geoalchemy2 import WKTElement
from sqlalchemy import create_engine, text

from llama_index.core.retrievers import VectorIndexRetriever
from llama_index.core.query_engine import RetrieverQueryEngine
from llama_index.core import Document
from llama_index.core.vector_stores import MetadataFilters, ExactMatchFilter

from index.index import user_messages_index

DATABASE_URL = os.getenv("DATABASE_URL", "uh oh")

engine = create_engine(DATABASE_URL)

async def add_user_message(
    content: str,
    user_id: str,
    lat: float = None,
    lon: float = None,
    time: datetime = None,
    extra_metadata: dict = None
):
    time = time or datetime.utcnow()

    location_geom = WKTElement(f"POINT({lon} {lat})", srid=4326) if lat is not None and lon is not None else None

    with engine.begin() as conn:
        if location_geom:
            conn.execute(
                text(
                    """
                    INSERT INTO user_messages (user_id, content, time, location_geom)
                    VALUES (
                        :user_id,
                        :content,
                        :time,
                        ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography
                    )
                    """
                ),
                {
                    "user_id": user_id,
                    "content": content,
                    "time": time,
                    "lat": lat,
                    "lon": lon,
                }
            )
        else:
            conn.execute(
                text(
                    "INSERT INTO user_messages (user_id, content, time) "
                    "VALUES (:user_id, :content, :time)"
                ),
                {"user_id": user_id, "content": content, "time": time}
            )

    metadata = {"user_id": user_id, "time": time.isoformat()}
    if lat is not None and lon is not None:
        metadata.update({"lat": lat, "lon": lon})
    if extra_metadata:
        metadata.update(extra_metadata)

    resp = await query_user_messages("Return a single integer from 0-10 for this user. 0 indicates that the user is likely completely safe and is zero danger at all. 10 indicates that this user is in mortal danger and requires immediate assistance. Do not include in whitespace, backticks, etc. Just a single number please. If you have no relevant info just return 0.", user_id=user_id)
    priority = resp.response
    print(priority)
    try:
        priority = int(priority)
    except Exception:
        priority = 0
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                UPDATE users
                SET priority = :priority
                WHERE id = :id
                """
            ),
            {"id": user_id, "priority": priority}
        )

    doc = Document(text=content, metadata=metadata)
    user_messages_index.insert(doc)

async def query_user_messages(
    query_text: str,
    top_k: int = 5,
    user_id: str | list[str] = None,
    radius_meters: float = None,
    lat: float = None,
    lon: float = None,
    extra_filters: Dict[str, Any] = None
):
    postgis_filter_ids = None
    if radius_meters and lat is not None and lon is not None:
        with engine.begin() as conn:
            result = conn.execute(
                text(
                    "SELECT id FROM user_messages "
                    "WHERE ST_DWithin(location_geom, ST_MakePoint(:lon, :lat)::geography, :radius)"
                ),
                {"lat": lat, "lon": lon, "radius": radius_meters}
            )
            postgis_filter_ids = [row[0] for row in result]

    filter_list = []

    if user_id:
        if isinstance(user_id, list):
            filter_list.append(
                MetadataFilters(
                    filters=[ExactMatchFilter(key="user_id", value=uid) for uid in user_id],
                    condition="or"
                )
            )
        else:
            filter_list.append(ExactMatchFilter(key="user_id", value=user_id))

    if extra_filters:
        for k, v in extra_filters.items():
            if isinstance(v, list):
                filter_list.append(
                    MetadataFilters(
                        filters=[ExactMatchFilter(key=k, value=item) for item in v],
                        condition="or"
                    )
                )
            else:
                filter_list.append(ExactMatchFilter(key=k, value=v))

    if postgis_filter_ids:
        filter_list.append(
            MetadataFilters(
                filters=[ExactMatchFilter(key="message_id", value=i) for i in postgis_filter_ids],
                condition="or"
            )
        )

    final_filters = MetadataFilters(filters=filter_list) if filter_list else None

    retriever = VectorIndexRetriever(
        index=user_messages_index,
        similarity_top_k=top_k,
        filters=final_filters
    )

    query_engine = RetrieverQueryEngine(
        retriever=retriever,
    )
    return await query_engine.aquery(query_text)
