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

WITH cluster_centers(cluster_code, base_lon, base_lat) AS (
  VALUES
    ('A', -82.56, 27.88),
    ('B', -82.30, 27.88),
    ('C', -82.56, 28.12),
    ('D', -82.30, 28.12)
),
cluster_offsets(point_num, dlon, dlat) AS (
  VALUES
    (1, -0.012, -0.008),
    (2, -0.009, 0.006),
    (3, -0.006, -0.003),
    (4, -0.003, 0.010),
    (5, 0.000, 0.000),
    (6, 0.004, -0.007),
    (7, 0.007, 0.005),
    (8, 0.010, -0.002),
    (9, 0.012, 0.008),
    (10, 0.008, -0.010)
),
seed_points AS (
  SELECT
    c.cluster_code,
    o.point_num,
    c.base_lon + o.dlon AS lon,
    c.base_lat + o.dlat AS lat,
    md5(c.cluster_code || '-' || o.point_num::text) AS h
  FROM cluster_centers c
  CROSS JOIN cluster_offsets o
)
INSERT INTO users (id, priority, location_geom)
SELECT
  lower(
    substr(h, 1, 8) || '-' ||
    substr(h, 9, 4) || '-' ||
    substr(h, 13, 4) || '-' ||
    substr(h, 17, 4) || '-' ||
    substr(h, 21, 12)
  ) AS id,
  0 AS priority,
  ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography AS location_geom
FROM seed_points
ORDER BY cluster_code, point_num;
