CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE user_messages (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    content TEXT,
    time TIMESTAMP DEFAULT NOW(),
    location_geom GEOGRAPHY(POINT, 4326),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_user_messages_user ON user_messages(user_id);
CREATE INDEX idx_user_messages_time ON user_messages(time);
CREATE INDEX idx_user_messages_location ON user_messages USING GIST(location_geom);

CREATE TABLE responder_messages (
    id SERIAL PRIMARY KEY,
    user_id TEXT,
    content TEXT,
    time TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_responder_messages_time ON responder_messages(time);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  location_geom GEOGRAPHY(POINT, 4326),
  priority INT DEFAULT 0
);

CREATE TABLE responders (
  id TEXT PRIMARY KEY,
  location_geom GEOGRAPHY(POINT, 4326)
);
