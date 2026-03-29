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

INSERT INTO users (id, priority, location_geom) VALUES
('6124eebd-7f79-42dc-9286-0dccf792139d', 0, ST_SetSRID(ST_MakePoint(-82.72579, 28.067605), 4326)::geography),
('54bcbd55-ea03-40cc-98c5-0133e9e3a69e', 0, ST_SetSRID(ST_MakePoint(-82.409268, 27.894825), 4326)::geography),
('d94c855e-5e49-4578-a603-fe71d1311af1', 0, ST_SetSRID(ST_MakePoint(-82.316682, 28.125996), 4326)::geography),
('116ed88e-dac3-4ea8-84df-000a32cf1266', 0, ST_SetSRID(ST_MakePoint(-82.759033, 27.739019), 4326)::geography),
('90fc6d54-7098-4870-aa10-78e48c449537', 0, ST_SetSRID(ST_MakePoint(-82.6282, 28.173317), 4326)::geography),
('9739a13c-4e49-4601-abd4-ff0d89dbded6', 0, ST_SetSRID(ST_MakePoint(-82.763466, 28.043848), 4326)::geography),
('5ed00697-fed9-47b2-9b82-c641aa00055d', 0, ST_SetSRID(ST_MakePoint(-82.260978, 28.070956), 4326)::geography),
('03bc65a2-bc45-440e-9859-e053d236273a', 0, ST_SetSRID(ST_MakePoint(-82.261248, 27.802236), 4326)::geography),
('2542ed50-8db6-4494-a263-7798ce90ea3b', 0, ST_SetSRID(ST_MakePoint(-82.742153, 28.144696), 4326)::geography),
('b230c499-54ca-41f0-9eda-e11501e87954', 0, ST_SetSRID(ST_MakePoint(-82.753621, 28.137648), 4326)::geography),
('5547f935-115a-4676-8476-37d50da390ff', 0, ST_SetSRID(ST_MakePoint(-82.619102, 27.927029), 4326)::geography),
('1efb30df-8d2f-456a-9fd9-5778cb08d3b1', 0, ST_SetSRID(ST_MakePoint(-82.743213, 27.779966), 4326)::geography),
('57cdb684-fc2d-44fc-9877-781ef2ebb852', 0, ST_SetSRID(ST_MakePoint(-82.342877, 28.009346), 4326)::geography),
('d6fbf520-e4c5-49fd-974d-16f3c0884d8c', 0, ST_SetSRID(ST_MakePoint(-82.23476, 28.134727), 4326)::geography),
('e58e2c0e-e542-46cb-87f7-43bebbe16cfb', 0, ST_SetSRID(ST_MakePoint(-82.582925, 27.951537), 4326)::geography),
('d2894577-bba7-4da4-98a5-572c187fae6c', 0, ST_SetSRID(ST_MakePoint(-82.636973, 27.737943), 4326)::geography),
('fefedc77-69b9-4678-86d7-b38cf86eff46', 0, ST_SetSRID(ST_MakePoint(-82.484587, 28.078428), 4326)::geography),
('909ccf56-c0b8-4546-a81b-12d6546144de', 0, ST_SetSRID(ST_MakePoint(-82.632812, 27.946688), 4326)::geography),
('7cf2a669-8a2b-4d63-9a88-eff1fd352b40', 0, ST_SetSRID(ST_MakePoint(-82.265594, 27.939202), 4326)::geography),
('d34d5edb-39cd-4ff9-953a-1c8f9f32de56', 0, ST_SetSRID(ST_MakePoint(-82.512709, 27.790219), 4326)::geography),
('57b8eb99-d453-46a4-bf74-f5c3ae4cc00c', 0, ST_SetSRID(ST_MakePoint(-82.741229, 27.975363), 4326)::geography),
('654644aa-b0c0-4d44-bbf7-e787f4c6d548', 0, ST_SetSRID(ST_MakePoint(-82.677537, 27.948663), 4326)::geography),
('96824908-75cc-418e-bf0e-f95f799a73fa', 0, ST_SetSRID(ST_MakePoint(-82.685639, 28.011543), 4326)::geography),
('aec9d235-6ac4-459f-b32f-f915806ad67a', 0, ST_SetSRID(ST_MakePoint(-82.297876, 27.844689), 4326)::geography),
('b9047c3b-8179-45a3-9671-a5c8d11cb732', 0, ST_SetSRID(ST_MakePoint(-82.655183, 28.060184), 4326)::geography),
('712c29c3-21e5-4f47-bf54-f28861f6058b', 0, ST_SetSRID(ST_MakePoint(-82.42563, 28.083957), 4326)::geography),
('6c3d817c-2c2b-4f52-8409-0d3086653956', 0, ST_SetSRID(ST_MakePoint(-82.643126, 27.845842), 4326)::geography),
('b334e685-da44-4e9b-a893-5bd2e178291d', 0, ST_SetSRID(ST_MakePoint(-82.49808, 27.715453), 4326)::geography),
('82f6fd28-e395-441b-b8a0-580fb6d74bef', 0, ST_SetSRID(ST_MakePoint(-82.725776, 28.161267), 4326)::geography),
('c6187f97-89bd-4926-bc5a-284d69b20970', 0, ST_SetSRID(ST_MakePoint(-82.786738, 28.135765), 4326)::geography);
