import os
from datetime import datetime
from typing import Dict, Any

from sqlalchemy import create_engine, text

from llama_index.core.retrievers import VectorIndexRetriever
from llama_index.core.query_engine import RetrieverQueryEngine
from llama_index.core import Document

from index.index import responder_messages_index

DATABASE_URL = os.getenv("DATABASE_URL", "uh oh")

engine = create_engine(DATABASE_URL)

def add_responder_message(
    content: str,
    user_id: str,
    time: datetime = None,
    extra_metadata: dict = None
):
    time = time or datetime.utcnow()

    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO responder_messages (user_id, content, time) "
                "VALUES (:user_id, :content, :time)"
            ),
            {"user_id": user_id, "content": content, "time": time}
        )

    metadata = {"user_id": user_id, "time": time.isoformat()}
    if extra_metadata:
        metadata.update(extra_metadata)

    doc = Document(text=content, metadata=metadata)
    responder_messages_index.insert(doc)

def query_responder_messages(
    query_text: str,
    top_k: int = 5,
    user_id: str = None,
    extra_filters: Dict[str, Any] = None
):
    filters = []
    if user_id:
        filters.append({"key": "user_id", "value": user_id})
    if extra_filters:
        for k, v in extra_filters.items():
            filters.append({"key": k, "value": v})

    retriever = VectorIndexRetriever(
        index=responder_messages_index,
        similarity_top_k=top_k,
        filters=filters if filters else None
    )

    query_engine = RetrieverQueryEngine(
        retriever=retriever,
    )
    return query_engine.query(query_text)
