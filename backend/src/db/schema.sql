-- PostgreSQL Schema for Custom IT Ops Network Dashboard

-- 1. Sites Table (Supports multi-site architecture)
CREATE TABLE IF NOT EXISTS sites (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    network_cidr VARCHAR(50) NOT NULL, -- e.g., '192.168.1.0/24'
    address_notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Devices Table (Asset Inventory)
CREATE TABLE IF NOT EXISTS devices (
    id SERIAL PRIMARY KEY,
    site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    friendly_name VARCHAR(255) NOT NULL,
    type VARCHAR(50) DEFAULT 'unclassified', -- pc, phone, printer, switch, ap, router, attendance_machine, other, unclassified
    mac_address VARCHAR(17) UNIQUE NOT NULL, -- e.g. '00:11:22:33:44:55'
    current_ip VARCHAR(45) NOT NULL,
    location_dept VARCHAR(255), -- free text location/department
    asset_tag VARCHAR(100),
    notes TEXT,
    source VARCHAR(50) DEFAULT 'discovered', -- seeded_from_config, discovered, manual
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Device Credentials Table
CREATE TABLE IF NOT EXISTS device_credentials (
    id SERIAL PRIMARY KEY,
    device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    protocol VARCHAR(50) NOT NULL, -- 'snmp' or 'routeros_api'
    auth_details TEXT NOT NULL -- Encrypted JSON or connection string
);

-- 4. Ping History Table (Time-Series data)
CREATE TABLE IF NOT EXISTS ping_history (
    id BIGSERIAL PRIMARY KEY,
    device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_online BOOLEAN NOT NULL,
    latency_ms INTEGER
);

-- Index for time-series ping queries
CREATE INDEX IF NOT EXISTS idx_ping_history_device_time ON ping_history(device_id, timestamp DESC);

-- 5. Interface Traffic Table (Time-Series data)
CREATE TABLE IF NOT EXISTS interface_traffic (
    id BIGSERIAL PRIMARY KEY,
    device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    interface_name VARCHAR(100) NOT NULL,
    timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    rx_bytes_counter BIGINT NOT NULL,
    tx_bytes_counter BIGINT NOT NULL
);

-- Index for time-series traffic queries
CREATE INDEX IF NOT EXISTS idx_traffic_device_time ON interface_traffic(device_id, timestamp DESC);

-- 6. Topology Edges Table (Stores the best-known network hierarchy connections)
CREATE TABLE IF NOT EXISTS topology_edges (
    id SERIAL PRIMARY KEY,
    site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    switch_device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
    switch_port VARCHAR(50) NOT NULL,
    connected_device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_manual BOOLEAN DEFAULT FALSE, -- Identifies manually created override connections
    UNIQUE (switch_device_id, switch_port, connected_device_id)
);

-- 7. Printer Status Table (Time-series / latest status details)
CREATE TABLE IF NOT EXISTS printer_status (
    id SERIAL PRIMARY KEY,
    device_id INTEGER UNIQUE NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    toner_levels JSONB NOT NULL, -- e.g. {"black": 80, "cyan": 45}
    paper_status VARCHAR(100) DEFAULT 'OK',
    page_count INTEGER DEFAULT 0,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 8. ISP & DNS Health History Table (Time-Series data)
CREATE TABLE IF NOT EXISTS isp_health_history (
    id SERIAL PRIMARY KEY,
    site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ping_latency_ms INTEGER,
    dns_latency_ms INTEGER,
    packet_loss INTEGER
);

-- Index for time-series ISP health queries
CREATE INDEX IF NOT EXISTS idx_isp_health_time ON isp_health_history(site_id, timestamp DESC);
