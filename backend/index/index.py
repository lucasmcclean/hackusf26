import os

from llama_index.llms.google_genai import GoogleGenAI
from llama_index.embeddings.huggingface import HuggingFaceEmbedding
from llama_index.vector_stores.postgres import PGVectorStore
from llama_index.core import VectorStoreIndex, Settings

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "uh oh")

Settings.llm = GoogleGenAI(
    model="gemini-2.5-flash",
    api_key=GEMINI_API_KEY,
)

embedding_model = HuggingFaceEmbedding(
    model_name="sentence-transformers/all-MiniLM-L6-v2"
)

user_messages_vector_store = PGVectorStore.from_params(
    database="db",
    host="db",
    user="postgres",
    password="postgres",
    port=5432,
    table_name="embedded_user_messages",
    embed_dim=384,
)

responder_messages_vector_store = PGVectorStore.from_params(
    database="db",
    host="db",
    user="postgres",
    password="postgres",
    port=5432,
    table_name="embedded_responder_messages",
    embed_dim=384,
)

user_messages_index = VectorStoreIndex.from_vector_store(
        user_messages_vector_store,
        embed_model=embedding_model,
)

responder_messages_index = VectorStoreIndex.from_vector_store(
        responder_messages_vector_store,
        embed_model=embedding_model,
)
