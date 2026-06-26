import express, { Request, Response } from 'express';
import * as http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import { initDb, query } from './db/db';
import { startPoller, setWsBroadcastCallback, getActiveAlerts, clearAlert, getIspHealth } from './poller';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Track connected WebSocket clients
const clients = new Set<WebSocket>();

wss.on('connection', async (ws) => {
  clients.add(ws);
  console.log(`[WebSocket] Client connected. Total: ${clients.size}`);

  // Send initial dump of state to the newly connected client
  try {
    const sites = await query("SELECT * FROM sites");
    const activeAlerts = getActiveAlerts();
    
    ws.send(JSON.stringify({
      type: 'init',
      data: {
        sites,
        alerts: activeAlerts
      }
    }));
  } catch (err) {
    console.error('Error sending init data over WebSocket:', err);
  }

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[WebSocket] Client disconnected. Total: ${clients.size}`);
  });
});

// Set broadcast callback for poller notifications
setWsBroadcastCallback((data: any) => {
  const payload = JSON.stringify(data);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
});

// --- REST API ENDPOINTS ---

// 1. Sites Endpoints
app.get('/api/sites', async (req: Request, res: Response) => {
  try {
    const sites = await query("SELECT * FROM sites ORDER BY name ASC");
    res.json(sites);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sites', async (req: Request, res: Response) => {
  const { name, network_cidr, address_notes } = req.body;
  if (!name || !network_cidr) {
    res.status(400).json({ error: 'name and network_cidr are required' });
    return;
  }
  try {
    const result = await query(
      "INSERT INTO sites (name, network_cidr, address_notes) VALUES ($1, $2, $3)",
      [name, network_cidr, address_notes || '']
    );
    res.status(201).json({ success: true, id: result.lastID || result[0]?.id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Devices Endpoints
app.get('/api/devices', async (req: Request, res: Response) => {
  const { site_id } = req.query;
  if (!site_id) {
    res.status(400).json({ error: 'site_id query parameter is required' });
    return;
  }
  try {
    const devices = await query(
      "SELECT d.*, (SELECT latency_ms FROM ping_history p WHERE p.device_id = d.id ORDER BY p.timestamp DESC LIMIT 1) as last_latency, (SELECT is_online FROM ping_history p WHERE p.device_id = d.id ORDER BY p.timestamp DESC LIMIT 1) as is_online FROM devices d WHERE d.site_id = $1 ORDER BY d.id ASC",
      [site_id]
    );
    
    // Supplement printer toner level details
    const finalDevices = [];
    for (const d of devices) {
      if (d.type === 'printer') {
        const printerData = await query("SELECT toner_levels, paper_status, page_count FROM printer_status WHERE device_id = $1", [d.id]);
        if (printerData.length > 0) {
          d.toner_levels = JSON.parse(printerData[0].toner_levels || '{}');
          d.paper_status = printerData[0].paper_status;
          d.page_count = printerData[0].page_count;
        }
      }
      // Coerce online to boolean if present
      d.is_online = d.is_online === 1 || d.is_online === true;
      finalDevices.push(d);
    }

    res.json(finalDevices);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/devices/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { friendly_name, type, location_dept, asset_tag, notes } = req.body;
  try {
    await query(
      "UPDATE devices SET friendly_name = $1, type = $2, location_dept = $3, asset_tag = $4, notes = $5 WHERE id = $6",
      [friendly_name, type, location_dept || '', asset_tag || '', notes || '', id]
    );
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Topology Layout Generator
app.get('/api/topology', async (req: Request, res: Response) => {
  const { site_id } = req.query;
  if (!site_id) {
    res.status(400).json({ error: 'site_id query parameter is required' });
    return;
  }

  try {
    // Get all devices at site
    const devices = await query(
      "SELECT d.*, (SELECT is_online FROM ping_history p WHERE p.device_id = d.id ORDER BY p.timestamp DESC LIMIT 1) as is_online FROM devices d WHERE d.site_id = $1",
      [site_id]
    );

    // Get active topology edges
    const dbEdges = await query(
      "SELECT * FROM topology_edges WHERE site_id = $1",
      [site_id]
    );

    // Construct simple hierarchical coordinates for React Flow
    // Level 0: Router
    // Level 1: Switches
    // Level 2: APs, Printers, PCs, Phones, etc.
    const nodes: any[] = [];
    const edges: any[] = [];

    const routers = devices.filter((d: any) => d.type === 'router');
    const switches = devices.filter((d: any) => d.type === 'switch');
    const leafNodes = devices.filter((d: any) => d.type !== 'router' && d.type !== 'switch');

    // Layout dimensions
    const width = 1200;
    const routerY = 50;
    const switchY = 220;
    const leafY = 480;

    // 1. Position Router(s)
    routers.forEach((r: any, idx: number) => {
      const x = width / 2 + (idx - (routers.length - 1) / 2) * 200;
      nodes.push({
        id: String(r.id),
        type: 'routerNode',
        position: { x, y: routerY },
        data: { label: r.friendly_name, ip: r.current_ip, mac: r.mac_address, online: r.is_online === 1 || r.is_online === true }
      });
    });

    // 2. Position Switches
    switches.forEach((sw: any, idx: number) => {
      const x = (width / (switches.length + 1)) * (idx + 1);
      nodes.push({
        id: String(sw.id),
        type: 'switchNode',
        position: { x, y: switchY },
        data: { label: sw.friendly_name, ip: sw.current_ip, mac: sw.mac_address, online: sw.is_online === 1 || sw.is_online === true }
      });
    });

    // Group leaf nodes by connected switch to cluster them neatly
    const switchChildrenMap: Record<string, any[]> = {};
    const unattachedLeaves: any[] = [];

    leafNodes.forEach((leaf: any) => {
      const edge = dbEdges.find((e: any) => e.connected_device_id === leaf.id);
      if (edge && edge.switch_device_id) {
        const swId = String(edge.switch_device_id);
        if (!switchChildrenMap[swId]) switchChildrenMap[swId] = [];
        switchChildrenMap[swId].push(leaf);
      } else {
        unattachedLeaves.push(leaf);
      }
    });

    // 3. Position Leaf Nodes under their switches
    let leafIndex = 0;
    const totalLeavesToLayout = leafNodes.length;

    // Position attached leaf nodes in a neat centered grid to prevent horizontal sprawl
    switches.forEach((sw: any, swIdx: number) => {
      const swNodeId = String(sw.id);
      const children = switchChildrenMap[swNodeId] || [];
      const swX = (width / (switches.length + 1)) * (swIdx + 1);

      const cols = 5; // grid columns per switch
      const xSpacing = 140;
      const ySpacing = 85;
      const startY = switchY + 110;

      children.forEach((child: any, childIdx: number) => {
        const row = Math.floor(childIdx / cols);
        const col = childIdx % cols;

        // Symmetrically center items on the current row
        const numColsInRow = Math.min(cols, children.length - row * cols);
        const rowWidth = (numColsInRow - 1) * xSpacing;
        const x = swX + (col * xSpacing) - (rowWidth / 2);
        const y = startY + (row * ySpacing);

        nodes.push({
          id: String(child.id),
          type: 'deviceNode',
          position: { x, y },
          data: { 
            label: child.friendly_name, 
            ip: child.current_ip, 
            mac: child.mac_address, 
            type: child.type, 
            online: child.is_online === 1 || child.is_online === true,
            switchId: sw.id
          }
        });
      });
    });

    // Position unattached leaf nodes in a centered grid at the bottom
    unattachedLeaves.forEach((leaf: any, idx: number) => {
      const cols = 8;
      const xSpacing = 130;
      const ySpacing = 85;
      const startY = leafY + 300;

      const row = Math.floor(idx / cols);
      const col = idx % cols;

      const numColsInRow = Math.min(cols, unattachedLeaves.length - row * cols);
      const rowWidth = (numColsInRow - 1) * xSpacing;
      const x = (width / 2) + (col * xSpacing) - (rowWidth / 2);
      const y = startY + (row * ySpacing);

      nodes.push({
        id: String(leaf.id),
        type: 'deviceNode',
        position: { x, y },
        data: { 
          label: leaf.friendly_name, 
          ip: leaf.current_ip, 
          mac: leaf.mac_address, 
          type: leaf.type, 
          online: leaf.is_online === 1 || leaf.is_online === true,
          switchId: null
        }
      });
    });

    // 4. Format Edges
    dbEdges.forEach((edge: any) => {
      const edgeId = `edge-${edge.id}`;
      edges.push({
        id: edgeId,
        source: String(edge.switch_device_id || routers[0]?.id || ''),
        target: String(edge.connected_device_id),
        label: edge.switch_port ? `Port ${edge.switch_port}` : '',
        animated: false, // Disabled animation to prevent heavy rendering lag
        style: (edge.is_manual === 1 || edge.is_manual === true) 
          ? { stroke: '#e2e8f0', strokeWidth: 2, strokeDasharray: '4 4' } // Dashed line for manual
          : { stroke: '#3b82f6', strokeWidth: 2 } // Blue solid line for auto
      });
    });

    res.json({ nodes, edges });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3.5 ISP Health Endpoint (Proof of Concept)
app.get('/api/isp-health', async (req: Request, res: Response) => {
  const { site_id } = req.query;
  if (!site_id) {
    res.status(400).json({ error: 'site_id query parameter is required' });
    return;
  }
  try {
    const current = getIspHealth(Number(site_id));
    const history = await query(
      "SELECT timestamp, ping_latency_ms, dns_latency_ms, packet_loss FROM isp_health_history WHERE site_id = $1 ORDER BY timestamp ASC LIMIT 100",
      [site_id]
    );
    res.json({
      current,
      history
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/topology/edges', async (req: Request, res: Response) => {
  const { site_id, switch_device_id, switch_port, connected_device_id } = req.body;
  if (!site_id || !switch_device_id || !connected_device_id) {
    res.status(400).json({ error: 'site_id, switch_device_id, and connected_device_id are required' });
    return;
  }

  try {
    // Remove any existing manual or auto edges for this connected device to re-bind it
    await query(
      "DELETE FROM topology_edges WHERE connected_device_id = $1",
      [connected_device_id]
    );

    // Insert new manual edge override
    const result = await query(
      "INSERT INTO topology_edges (site_id, switch_device_id, switch_port, connected_device_id, is_manual) VALUES ($1, $2, $3, $4, true)",
      [site_id, switch_device_id, switch_port || 'manual', connected_device_id]
    );

    res.status(201).json({ success: true, id: result.lastID || result[0]?.id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Interface Traffic History Endpoint
app.get('/api/traffic', async (req: Request, res: Response) => {
  const { site_id } = req.query;
  if (!site_id) {
    res.status(400).json({ error: 'site_id query parameter is required' });
    return;
  }

  try {
    // Get recent 15 traffic readings grouped by device
    const trafficRows = await query(`
      SELECT t.*, d.friendly_name 
      FROM interface_traffic t
      JOIN devices d ON t.device_id = d.id
      WHERE d.site_id = $1
      ORDER BY t.timestamp DESC LIMIT 100
    `, [site_id]);

    res.json(trafficRows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Alerts Endpoints
app.get('/api/alerts', (req: Request, res: Response) => {
  res.json(getActiveAlerts());
});

app.post('/api/alerts/clear', (req: Request, res: Response) => {
  const { id } = req.body;
  if (!id) {
    res.status(400).json({ error: 'Alert id is required' });
    return;
  }
  clearAlert(id);
  res.json({ success: true });
});

// --- SETTINGS HELPER FUNCTIONS ---
function readEnvFile(): Record<string, string> {
  const envPath = path.resolve(__dirname, '../.env');
  if (!fs.existsSync(envPath)) return {};
  const content = fs.readFileSync(envPath, 'utf8');
  const result: Record<string, string> = {};
  content.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const parts = trimmed.split('=');
    if (parts.length >= 2) {
      const key = parts[0].trim();
      const val = parts.slice(1).join('=').trim();
      result[key] = val;
    }
  });
  return result;
}

function writeEnvFile(updates: Record<string, string>) {
  const envPath = path.resolve(__dirname, '../.env');
  let content = '';
  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, 'utf8');
  }
  
  const lines = content.split('\n');
  const keysUpdated = new Set<string>();
  
  const newLines = lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    const parts = trimmed.split('=');
    const key = parts[0].trim();
    if (updates[key] !== undefined) {
      keysUpdated.add(key);
      return `${key}=${updates[key]}`;
    }
    return line;
  });
  
  // Append any keys that weren't in the original file
  Object.keys(updates).forEach(key => {
    if (!keysUpdated.has(key)) {
      newLines.push(`${key}=${updates[key]}`);
    }
  });
  
  fs.writeFileSync(envPath, newLines.join('\n'), 'utf8');
}

// 6. Router & System Settings Endpoints
app.get('/api/settings', (req: Request, res: Response) => {
  try {
    const env = readEnvFile();
    res.json({
      SIMULATION_MODE: env.SIMULATION_MODE !== 'false',
      ROUTER_URL: env.ROUTER_URL || 'http://192.168.1.1/rest',
      ROUTER_USER: env.ROUTER_USER || 'admin',
      hasPassword: !!env.ROUTER_PASSWORD
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings', (req: Request, res: Response) => {
  const { SIMULATION_MODE, ROUTER_URL, ROUTER_USER, ROUTER_PASSWORD } = req.body;
  try {
    const updates: Record<string, string> = {
      SIMULATION_MODE: SIMULATION_MODE ? 'true' : 'false',
      ROUTER_URL: ROUTER_URL || 'http://192.168.1.1/rest',
      ROUTER_USER: ROUTER_USER || 'admin'
    };
    if (ROUTER_PASSWORD !== undefined && ROUTER_PASSWORD !== '') {
      updates.ROUTER_PASSWORD = ROUTER_PASSWORD;
    }
    writeEnvFile(updates);
    
    // Touch config-trigger.json to restart nodemon
    const triggerPath = path.resolve(__dirname, './config-trigger.json');
    fs.writeFileSync(triggerPath, JSON.stringify({ timestamp: Date.now() }), 'utf8');
    
    res.json({ success: true, message: 'Settings saved. Polling server is restarting...' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings/test', async (req: Request, res: Response) => {
  const { ROUTER_URL, ROUTER_USER, ROUTER_PASSWORD } = req.body;
  
  let resolvedPassword = ROUTER_PASSWORD;
  if (resolvedPassword === undefined || resolvedPassword === '') {
    const env = readEnvFile();
    resolvedPassword = env.ROUTER_PASSWORD || '';
  }
  
  const authString = Buffer.from(`${ROUTER_USER}:${resolvedPassword}`).toString('base64');
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  
  const logs: string[] = [];
  logs.push(`Connecting to: ${ROUTER_URL}`);
  logs.push(`Username: ${ROUTER_USER}`);
  logs.push(`Password: ${resolvedPassword ? '********' : '(empty)'}`);
  
  try {
    logs.push('\n[1/3] Fetching interface traffic counters...');
    const ifaceRes = await fetch(`${ROUTER_URL}/interface`, {
      headers: {
        'Authorization': `Basic ${authString}`,
        'Accept': 'application/json'
      }
    });
    
    if (!ifaceRes.ok) {
      const text = await ifaceRes.text();
      throw new Error(`Router returned status ${ifaceRes.status} ${ifaceRes.statusText}. Response body: ${text}`);
    }
    
    const interfaces: any = await ifaceRes.json();
    logs.push(`Success! Found ${interfaces.length} interfaces.`);
    
    const wan = interfaces.find((i: any) => i.name === 'ether1' || i.name === 'WAN');
    if (wan) {
      logs.push(`WAN Link (${wan.name}): RX bytes = ${wan['rx-byte']}, TX bytes = ${wan['tx-byte']}`);
    }
    
    logs.push('\n[2/3] Fetching system resources...');
    const sysRes = await fetch(`${ROUTER_URL}/system/resource`, {
      headers: {
        'Authorization': `Basic ${authString}`,
        'Accept': 'application/json'
      }
    });
    if (sysRes.ok) {
      const resources: any = await sysRes.json();
      logs.push(`Success! CPU Load: ${resources['cpu-load']}%, Model: ${resources.model || 'Mikrotik'}`);
    }
    
    logs.push('\n[3/3] Fetching DHCP leases...');
    const leaseRes = await fetch(`${ROUTER_URL}/ip/dhcp-server/lease`, {
      headers: {
        'Authorization': `Basic ${authString}`,
        'Accept': 'application/json'
      }
    });
    if (leaseRes.ok) {
      const leases: any = await leaseRes.json();
      logs.push(`Success! Loaded ${leases.length} live DHCP leases.`);
    }
    
    res.json({
      success: true,
      logs: logs.join('\n')
    });
  } catch (err: any) {
    logs.push(`\n❌ Error: ${err.message}`);
    res.json({
      success: false,
      logs: logs.join('\n')
    });
  }
});

// Default server root
app.get('/', (req: Request, res: Response) => {
  res.send('Custom Network Monitor API Server is active.');
});

// --- SERVER INITIALIZATION ---
const PORT = process.env.PORT || 5000;

async function bootstrap() {
  await initDb();
  await startPoller();
  
  server.listen(PORT, () => {
    console.log(`Backend Server listening on port ${PORT}`);
  });
}

bootstrap().catch(err => {
  console.error('Bootstrap crashed:', err);
});
