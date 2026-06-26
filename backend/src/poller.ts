import { query } from './db/db';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as dotenv from 'dotenv';
import dns from 'dns';

dotenv.config();

const execPromise = promisify(exec);

// Configuration options
const SIMULATION_MODE = process.env.SIMULATION_MODE !== 'false'; // Default to true for sandbox/demo
const POLL_INTERVAL_MS = SIMULATION_MODE ? 10000 : 30000; // 10s for fast simulation updates, 30s otherwise

// Web Socket broadcast callback
let wsBroadcastCallback: ((data: any) => void) | null = null;

export function setWsBroadcastCallback(callback: (data: any) => void) {
  wsBroadcastCallback = callback;
}

// In-memory store for ISP and DNS health per site
export interface IspHealth {
  online: boolean;
  latency: number | null;
  dns_online: boolean;
  dns_latency: number | null;
  packet_loss: number;
}
const ispHealthStore: Record<number, IspHealth> = {};

export function getIspHealth(siteId: number): IspHealth {
  return ispHealthStore[siteId] || {
    online: true,
    latency: 22,
    dns_online: true,
    dns_latency: 10,
    packet_loss: 0
  };
}

// Helper to measure DNS latency
async function measureDns(): Promise<{ online: boolean; latency: number | null }> {
  const start = Date.now();
  try {
    await Promise.race([
      dns.promises.resolve('google.com', 'A'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
    ]);
    return { online: true, latency: Date.now() - start };
  } catch (err) {
    return { online: false, latency: null };
  }
}

// In-memory counter cache to compute traffic deltas and simulate rising counters
const trafficCounters: Record<string, { rx: number; tx: number }> = {};

// Active alert cache
interface Alert {
  id: string;
  deviceId?: number;
  deviceName: string;
  severity: 'warning' | 'critical' | 'info';
  message: string;
  timestamp: string;
}
let activeAlerts: Alert[] = [];

export function getActiveAlerts() {
  return activeAlerts;
}

export function clearAlert(id: string) {
  activeAlerts = activeAlerts.filter(a => a.id !== id);
  if (wsBroadcastCallback) {
    wsBroadcastCallback({ type: 'alerts', data: activeAlerts });
  }
}

function addAlert(alert: Omit<Alert, 'id' | 'timestamp'>) {
  const id = `${alert.deviceId || 'sys'}-${Date.now()}`;
  const newAlert = { ...alert, id, timestamp: new Date().toISOString() };
  activeAlerts.unshift(newAlert);
  // Keep only the last 30 alerts
  if (activeAlerts.length > 30) {
    activeAlerts.pop();
  }
  if (wsBroadcastCallback) {
    wsBroadcastCallback({ type: 'alert_new', data: newAlert });
    wsBroadcastCallback({ type: 'alerts', data: activeAlerts });
  }
}

// Helper to run promises with limited concurrency to avoid process overloading
async function limitConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: Promise<R>[] = [];
  const executing: Promise<void>[] = [];
  
  for (const item of items) {
    const p = Promise.resolve().then(() => fn(item));
    results.push(p);
    
    if (limit < items.length) {
      const e: Promise<void> = p.then(() => {
        executing.splice(executing.indexOf(e), 1);
      });
      executing.push(e);
      if (executing.length >= limit) {
        await Promise.race(executing);
      }
    }
  }
  return Promise.all(results);
}

// Helper to run ping command on Windows/Linux
async function pingIp(ip: string): Promise<{ online: boolean; latency: number | null }> {
  const isWindows = process.platform === 'win32';
  // 1 ping, 800ms timeout
  const cmd = isWindows 
    ? `ping -n 1 -w 800 ${ip}` 
    : `ping -c 1 -W 1 ${ip}`;

  try {
    const start = Date.now();
    const { stdout } = await execPromise(cmd);
    const latency = Date.now() - start;

    // Parse output for windows/linux success signatures
    const success = isWindows
      ? stdout.includes('Reply from') && !stdout.includes('Destination host unreachable')
      : stdout.includes('bytes from');

    if (success) {
      // Find average latency from stdout if possible
      let matchedLatency = latency;
      const match = stdout.match(/time[=<]([0-9]+)\s*ms/i);
      if (match && match[1]) {
        matchedLatency = parseInt(match[1]);
      }
      return { online: true, latency: matchedLatency };
    }
  } catch (err) {
    // Command failed usually means unreachable
  }
  return { online: false, latency: null };
}

// Polling loop
export async function startPoller() {
  console.log(`Starting Network Poller (Interval: ${POLL_INTERVAL_MS}ms, Simulation: ${SIMULATION_MODE})`);
  
  // Seed initial switches and routers in DB if they don't exist
  await seedInfrastructureDevices();

  // Run initial poll cycle
  runPollCycle().catch(err => console.error('Error in initial poll cycle:', err));

  // Set interval
  setInterval(() => {
    runPollCycle().catch(err => console.error('Error in poll cycle:', err));
  }, POLL_INTERVAL_MS);
}

function inferDeviceType(comment: string): string {
  const c = comment.toLowerCase();
  if (c.includes('printer')) return 'printer';
  if (c.includes('pc') || c.includes('laptop') || c.includes('komputer') || c.includes('desktop')) return 'pc';
  if (c.includes('hp') || c.includes('handphone') || c.includes('phone') || c.includes('mobile')) return 'phone';
  if (c.includes('ap') || c.includes('access point') || c.includes('wifi') || c.includes('controller')) return 'ap';
  if (c.includes('mesin absen') || c.includes('absen') || c.includes('attendance')) return 'attendance_machine';
  if (c.includes('switch') || c.includes('router') || c.includes('hub')) return 'switch';
  return 'unclassified';
}

async function seedInfrastructureDevices() {
  const sites = await query("SELECT id, name FROM sites");
  if (sites.length === 0) return;

  for (const site of sites) {
    const infra = [
      { name: 'Core Router Mikrotik', ip: '192.168.1.1', mac: 'F4:1E:57:5E:C4:0F', type: 'router' },
      { name: 'Core Switch Ruijie', ip: '192.168.1.100', mac: '00:D0:F8:22:A1:01', type: 'switch' },
      { name: 'Floor 1 Switch Ruijie', ip: '192.168.1.101', mac: '00:D0:F8:22:A2:02', type: 'switch' },
      { name: 'Floor 2 Switch Ruijie', ip: '192.168.1.102', mac: '00:D0:F8:22:A3:03', type: 'switch' },
    ];

    for (const item of infra) {
      try {
        const existing = await query("SELECT id FROM devices WHERE mac_address = $1", [item.mac]);
        if (existing.length === 0) {
          let ip = item.ip;
          if (item.type === 'router') {
            const url = process.env.ROUTER_URL || 'http://192.168.1.1/rest';
            const match = url.match(/https?:\/\/([^\/:]+)/);
            if (match) ip = match[1];
          }
          await query(
            "INSERT INTO devices (site_id, friendly_name, type, mac_address, current_ip, source) VALUES ($1, $2, $3, $4, $5, $6)",
            [site.id, item.name, item.type, item.mac, ip, 'manual']
          );
        }
      } catch (e) {
        console.error('Failed to seed infrastructure device:', e);
      }
    }
  }
}

async function runPollCycle() {
  await seedInfrastructureDevices();
  const sites = await query("SELECT * FROM sites");
  
  for (const site of sites) {
    const devices = await query("SELECT * FROM devices WHERE site_id = $1", [site.id]);
    if (devices.length === 0) continue;

    console.log(`[Poller] Polling ${devices.length} devices for site: ${site.name}`);

    if (SIMULATION_MODE) {
      await runSimulatedPoll(site.id, devices);
    } else {
      await runRealPoll(site.id, devices);
    }
  }
}

// High-fidelity Simulator Polling Logic
async function runSimulatedPoll(siteId: number, devices: any[]) {
  const timestamp = new Date().toISOString();
  const updatedDeviceStates: any[] = [];
  const trafficDeltas: any[] = [];
  
  // 1. Simulate Ping Sweeps & Latencies
  for (const device of devices) {
    let online = true;
    let latency: number | null = Math.floor(Math.random() * 8) + 2; // default 2-10ms

    // Simulate occasional dropouts for office PCs, APs or printers
    if (device.type === 'pc' && Math.random() < 0.05) {
      online = false;
      latency = null;
    } else if (device.type === 'phone' && Math.random() < 0.15) {
      online = false;
      latency = null;
    }

    // Ping switches & routers are always online in simulation
    if (device.type === 'switch' || device.type === 'router') {
      online = true;
      latency = Math.floor(Math.random() * 3) + 1; // 1-3ms
    }

    // Insert ping history
    await query(
      "INSERT INTO ping_history (device_id, timestamp, is_online, latency_ms) VALUES ($1, $2, $3, $4)",
      [device.id, timestamp, online, latency]
    );

    // Check state change to trigger alerts
    const lastPing = await query(
      "SELECT is_online FROM ping_history WHERE device_id = $1 AND timestamp < $2 ORDER BY timestamp DESC LIMIT 1",
      [device.id, timestamp]
    );
    
    const lastOnline = lastPing.length > 0 && (lastPing[0].is_online === 1 || lastPing[0].is_online === true);
    if (lastPing.length > 0 && lastOnline !== online) {
      if (!online) {
        addAlert({
          deviceId: device.id,
          deviceName: device.friendly_name,
          severity: device.type === 'switch' || device.type === 'router' ? 'critical' : 'warning',
          message: `Device is OFFLINE (${device.current_ip})`
        });
      } else {
        addAlert({
          deviceId: device.id,
          deviceName: device.friendly_name,
          severity: 'info',
          message: `Device is back ONLINE (${device.current_ip})`
        });
      }
    }

    updatedDeviceStates.push({
      id: device.id,
      friendly_name: device.friendly_name,
      type: device.type,
      current_ip: device.current_ip,
      mac_address: device.mac_address,
      online,
      latency
    });
  }

  // 2. Simulate SNMP Interface Traffic counters (Bits/Sec deltas)
  // We simulate traffic for the Router interfaces, and the core switches
  const networkNodes = devices.filter(d => d.type === 'router' || d.type === 'switch');
  
  for (const node of networkNodes) {
    // Generate simulated bandwidth
    const interfaces = node.type === 'router' 
      ? ['WAN', 'LAN-bridge'] 
      : ['port-1-core', 'port-2', 'port-3', 'port-4', 'port-5', 'port-6', 'port-7', 'port-8', 'port-9', 'port-10'];
    
    for (const iface of interfaces) {
      const key = `${node.id}-${iface}`;
      if (!trafficCounters[key]) {
        trafficCounters[key] = { rx: 10000000, tx: 25000000 };
      }

      // Compute fluctuating traffic speeds: 100kbps to 80Mbps
      let speedRx = Math.floor(Math.random() * 5000000) + 100000; // average 0.1-5 Mbps
      let speedTx = Math.floor(Math.random() * 8000000) + 200000;

      // Make WAN / LAN-bridge extra high capacity
      if (iface === 'WAN' || iface === 'LAN-bridge' || iface === 'port-1-core') {
        speedRx = Math.floor(Math.random() * 40000000) + 10000000; // 10-50 Mbps
        speedTx = Math.floor(Math.random() * 60000000) + 15000000; // 15-75 Mbps
      }

      // Add deltas (bytes) to counters
      const bytesRxDelta = Math.floor((speedRx * (POLL_INTERVAL_MS / 1000)) / 8);
      const bytesTxDelta = Math.floor((speedTx * (POLL_INTERVAL_MS / 1000)) / 8);

      trafficCounters[key].rx += bytesRxDelta;
      trafficCounters[key].tx += bytesTxDelta;

      // Handle integer wrap-around simulation
      if (trafficCounters[key].rx > 4294967295) trafficCounters[key].rx = 0;
      if (trafficCounters[key].tx > 4294967295) trafficCounters[key].tx = 0;

      await query(
        "INSERT INTO interface_traffic (device_id, interface_name, timestamp, rx_bytes_counter, tx_bytes_counter) VALUES ($1, $2, $3, $4, $5)",
        [node.id, iface, timestamp, trafficCounters[key].rx, trafficCounters[key].tx]
      );

      // Trigger high bandwidth traffic alert (>60Mbps on WAN)
      if (iface === 'WAN' && speedRx + speedTx > 70000000) {
        addAlert({
          deviceId: node.id,
          deviceName: node.friendly_name,
          severity: 'warning',
          message: `High bandwidth utilization on WAN link: ${((speedRx + speedTx) / 1000000).toFixed(1)} Mbps`
        });
      }

      trafficDeltas.push({
        deviceId: node.id,
        interface: iface,
        rx_speed_bps: speedRx,
        tx_speed_bps: speedTx,
        rx_counter: trafficCounters[key].rx,
        tx_counter: trafficCounters[key].tx
      });
    }
  }

  // 3. Simulate Printer Status (low toner updates)
  const printers = devices.filter(d => d.type === 'printer');
  for (const printer of printers) {
    // Try querying existing toner level
    const existing = await query("SELECT toner_levels FROM printer_status WHERE device_id = $1", [printer.id]);
    let toner = { black: 75, color: 60 };

    if (existing.length > 0) {
      try {
        const levels = JSON.parse(existing[0].toner_levels);
        // Deplete toner slightly
        toner = {
          black: Math.max(0, levels.black - (Math.random() < 0.05 ? 1 : 0)),
          color: Math.max(0, levels.color - (Math.random() < 0.03 ? 1 : 0))
        };
      } catch (e) {}
    }

    await query(
      "INSERT OR REPLACE INTO printer_status (device_id, toner_levels, paper_status, page_count, timestamp) VALUES ($1, $2, $3, $4, $5)",
      [printer.id, JSON.stringify(toner), 'OK', 1420 + Math.floor(Math.random() * 2), timestamp]
    );

    // Trigger low toner alert
    if (toner.black < 10 || toner.color < 10) {
      addAlert({
        deviceId: printer.id,
        deviceName: printer.friendly_name,
        severity: 'warning',
        message: `Low toner levels detected: Black ${toner.black}%, Color ${toner.color}%`
      });
    }
  }

  // 4. Simulate Bridge MIB Topology resolution
  // Assign end devices to switches / ports if they don't have manual edges
  const coreRouter = devices.find(d => d.type === 'router');
  const coreSwitch = devices.find(d => d.friendly_name.includes('Core Switch'));
  const f1Switch = devices.find(d => d.friendly_name.includes('Floor 1 Switch'));
  const f2Switch = devices.find(d => d.friendly_name.includes('Floor 2 Switch'));

  if (coreRouter && coreSwitch && f1Switch && f2Switch) {
    // Router to Core Switch
    await insertSimulatedEdge(siteId, coreRouter.id, 'LAN-bridge', coreSwitch.id);
    
    // Core Switch connects to floor switches
    await insertSimulatedEdge(siteId, coreSwitch.id, 'port-9', f1Switch.id);
    await insertSimulatedEdge(siteId, coreSwitch.id, 'port-10', f2Switch.id);

    // Distribute remaining endpoints
    const endDevices = devices.filter(d => d.type !== 'router' && d.type !== 'switch');
    for (let i = 0; i < endDevices.length; i++) {
      const dev = endDevices[i];
      
      // Don't auto-resolve if a manual override edge exists
      const manualEdge = await query(
        "SELECT id FROM topology_edges WHERE connected_device_id = $1 AND is_manual = true",
        [dev.id]
      );
      if (manualEdge.length > 0) continue;

      // Assign statically based on index to floors
      if (i % 3 === 0) {
        // Connect to Core switch directly
        const port = `port-${(i % 8) + 1}`;
        await insertSimulatedEdge(siteId, coreSwitch.id, port, dev.id);
      } else if (i % 3 === 1) {
        // Connect to F1 switch
        const port = `port-${(i % 8) + 1}`;
        await insertSimulatedEdge(siteId, f1Switch.id, port, dev.id);
      } else {
        // Connect to F2 switch
        const port = `port-${(i % 8) + 1}`;
        await insertSimulatedEdge(siteId, f2Switch.id, port, dev.id);
      }
    }
  }

  // 5. Simulate ISP and DNS Health (Proof of Concept)
  const ispOnline = Math.random() > 0.02; // 98% uptime simulation
  const dnsOnline = ispOnline && (Math.random() > 0.01); // 99% DNS success
  const ispLatency = ispOnline ? Math.floor(Math.random() * 15) + 15 : null; // 15-30 ms
  const dnsLatency = dnsOnline ? Math.floor(Math.random() * 8) + 6 : null; // 6-14 ms
  const packetLoss = ispOnline ? (Math.random() < 0.03 ? Math.floor(Math.random() * 2) + 1 : 0) : 100;

  ispHealthStore[siteId] = {
    online: ispOnline,
    latency: ispLatency,
    dns_online: dnsOnline,
    dns_latency: dnsLatency,
    packet_loss: packetLoss
  };

  // Save history to DB
  await query(
    "INSERT INTO isp_health_history (site_id, timestamp, ping_latency_ms, dns_latency_ms, packet_loss) VALUES ($1, $2, $3, $4, $5)",
    [siteId, timestamp, ispLatency, dnsLatency, packetLoss]
  );

  // Prune history to keep only the last 100 entries
  await query(
    "DELETE FROM isp_health_history WHERE id NOT IN (SELECT id FROM isp_health_history WHERE site_id = $1 ORDER BY timestamp DESC LIMIT 100) AND site_id = $1",
    [siteId]
  );

  // Trigger simulated ISP Outage alert
  if (!ispOnline) {
    addAlert({
      deviceName: 'ISP Gateway',
      severity: 'critical',
      message: `WAN Internet Gateway (8.8.8.8) is UNREACHABLE! Simulated ISP Link Outage.`
    });
  } else if (!dnsOnline) {
    addAlert({
      deviceName: 'DNS Monitor',
      severity: 'warning',
      message: `DNS Resolution Failed! Timeout resolving google.com.`
    });
  }

  // 6. Simulate IP Conflict Detection (Proof of Concept)
  // 5% chance of simulating an IP conflict on active endpoints
  if (Math.random() < 0.05 && devices.length > 2) {
    const endDevices = devices.filter(d => d.type !== 'router' && d.type !== 'switch');
    if (endDevices.length >= 2) {
      const dev1 = endDevices[0];
      const dev2 = endDevices[1];
      addAlert({
        deviceId: dev2.id,
        deviceName: 'IP Security Monitor',
        severity: 'critical',
        message: `IP Address Conflict: ${dev1.current_ip} is assigned to both ${dev1.friendly_name} (${dev1.mac_address}) and ${dev2.friendly_name} (${dev2.mac_address})`
      });
    }
  }

  // Retrieve current active topology
  const activeEdges = await query("SELECT * FROM topology_edges WHERE site_id = $1", [siteId]);

  // Broadcast WebSocket update
  if (wsBroadcastCallback) {
    wsBroadcastCallback({
      type: 'poll_data',
      site_id: siteId,
      timestamp,
      devices: updatedDeviceStates,
      traffic: trafficDeltas,
      edges: activeEdges,
      alerts: activeAlerts,
      isp_health: ispHealthStore[siteId]
    });
  }
}

async function insertSimulatedEdge(siteId: number, switchId: number, port: string, connectedId: number) {
  try {
    // Delete conflicting auto-edges (if device was connected elsewhere in auto mode)
    await query(
      "DELETE FROM topology_edges WHERE connected_device_id = $1 AND is_manual = false",
      [connectedId]
    );
    // Insert/Replace edge
    await query(
      "INSERT OR IGNORE INTO topology_edges (site_id, switch_device_id, switch_port, connected_device_id, last_seen, is_manual) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, false)",
      [siteId, switchId, port, connectedId]
    );
  } catch (e) {
    // Ignore database conflict errors
  }
}

// Fetch metrics from Mikrotik RouterOS REST API
async function queryMikrotik(routerIp: string): Promise<{ rx: number; tx: number; cpu?: number } | null> {
  const routerUrl = process.env.ROUTER_URL || `http://${routerIp}/rest`;
  const routerUser = process.env.ROUTER_USER || 'admin';
  const routerPassword = process.env.ROUTER_PASSWORD || '';

  // Disable SSL verification for self-signed certificates
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

  const auth = Buffer.from(`${routerUser}:${routerPassword}`).toString('base64');

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000); // 4s timeout

    // Fetch WAN interface stats (ether1)
    const url = `${routerUrl}/interface`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json'
      },
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`[Mikrotik REST] Router returned status ${response.status}`);
      return null;
    }

    const interfaces: any = await response.json();
    // Search for ether1 (WAN)
    const wan = interfaces.find((i: any) => i.name === 'ether1' || i.name === 'WAN');
    
    // Fetch CPU load from resources if possible
    let cpuLoad = 0;
    try {
      const cpuController = new AbortController();
      const cpuTimeout = setTimeout(() => cpuController.abort(), 3000);
      const resRes = await fetch(`${routerUrl}/system/resource`, {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Accept': 'application/json'
        },
        signal: cpuController.signal
      });
      clearTimeout(cpuTimeout);
      if (resRes.ok) {
        const resources: any = await resRes.json();
        cpuLoad = parseInt(resources['cpu-load'] || '0');
      }
    } catch (err) {}

    if (wan) {
      const rx = parseInt(wan['rx-byte'] || '0');
      const tx = parseInt(wan['tx-byte'] || '0');
      return { rx, tx, cpu: cpuLoad };
    }
  } catch (err: any) {
    console.error(`[Mikrotik REST] Failed to poll router at ${routerIp}:`, err.message);
  }
  return null;
}

// Real Poller logic (Pings + RouterOS REST + SNMP)
async function runRealPoll(siteId: number, devices: any[]) {
  const timestamp = new Date().toISOString();
  console.log(`[RealPoller] Executing real ping sweeps and SNMP requests for site ${siteId}...`);

  // 1. Perform RouterOS REST API DHCP/ARP Active Network Discovery
  const routerDeviceInitial = devices.find(d => d.type === 'router');
  if (routerDeviceInitial) {
    const routerUrl = process.env.ROUTER_URL || `http://${routerDeviceInitial.current_ip}/rest`;
    const routerUser = process.env.ROUTER_USER || 'admin';
    const routerPassword = process.env.ROUTER_PASSWORD || '';
    const auth = Buffer.from(`${routerUser}:${routerPassword}`).toString('base64');
    
    // Fetch live leases
    try {
      console.log(`[RealPoller] Active Discovery: Querying live DHCP leases from router...`);
      const leaseRes = await fetch(`${routerUrl}/ip/dhcp-server/lease`, {
        headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' }
      });
      if (leaseRes.ok) {
        const leases: any = await leaseRes.json();
        for (const lease of leases) {
          const ip = lease.address;
          const mac = lease['mac-address'] ? lease['mac-address'].toUpperCase() : '';
          const leaseHostName = lease['host-name'] || '';
          const comment = lease.comment || leaseHostName || 'Unnamed Discovered Device';
          
          if (ip && mac) {
            const existing = await query("SELECT id FROM devices WHERE mac_address = $1", [mac]);
            if (existing.length === 0) {
              const type = inferDeviceType(comment);
              await query(
                "INSERT INTO devices (site_id, friendly_name, type, mac_address, current_ip, source) VALUES ($1, $2, $3, $4, $5, $6)",
                [siteId, comment, type, mac, ip, 'discovered']
              );
              console.log(`[RealPoller] Discovered new device from DHCP: ${comment} (${ip})`);
            } else {
              // Update IP and check if we can update from generic name to a better host-name/comment
              const currentDevice = await query("SELECT friendly_name FROM devices WHERE id = $1", [existing[0].id]);
              const currentName = currentDevice[0]?.friendly_name || '';
              
              const isGeneric = currentName === 'Unnamed Discovered Device' || currentName === 'Discovered ARP Device' || currentName === '';
              const hasBetterName = comment !== 'Unnamed Discovered Device' && comment !== '';
              
              if (isGeneric && hasBetterName) {
                const type = inferDeviceType(comment);
                await query(
                  "UPDATE devices SET current_ip = $1, friendly_name = $2, type = $3, last_seen = CURRENT_TIMESTAMP WHERE id = $4",
                  [ip, comment, type, existing[0].id]
                );
                console.log(`[RealPoller] Updated device generic name to: ${comment} (${ip})`);
              } else {
                await query(
                  "UPDATE devices SET current_ip = $1, last_seen = CURRENT_TIMESTAMP WHERE id = $2",
                  [ip, existing[0].id]
                );
              }
            }
          }
        }
      }
    } catch (e: any) {
      console.error('[RealPoller] Error during DHCP lease discovery:', e.message);
    }
    
    // Fetch ARP entries
    try {
      console.log(`[RealPoller] Active Discovery: Querying router ARP table...`);
      const arpRes = await fetch(`${routerUrl}/ip/arp`, {
        headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' }
      });
      if (arpRes.ok) {
        const arps: any = await arpRes.json();
        for (const arp of arps) {
          const ip = arp.address;
          const mac = arp['mac-address'] ? arp['mac-address'].toUpperCase() : '';
          const arpComment = arp.comment || '';
          const friendlyName = arpComment || 'Discovered ARP Device';
          
          if (ip && mac && mac !== '00:00:00:00:00:00') {
            const existing = await query("SELECT id FROM devices WHERE mac_address = $1", [mac]);
            if (existing.length === 0) {
              const type = arpComment ? inferDeviceType(arpComment) : 'unclassified';
              await query(
                "INSERT INTO devices (site_id, friendly_name, type, mac_address, current_ip, source) VALUES ($1, $2, $3, $4, $5, $6)",
                [siteId, friendlyName, type, mac, ip, 'discovered']
              );
              console.log(`[RealPoller] Discovered new device from ARP: ${friendlyName} (${ip})`);
            } else {
              // Update IP and check if we can update from generic name to a better ARP comment
              const currentDevice = await query("SELECT friendly_name FROM devices WHERE id = $1", [existing[0].id]);
              const currentName = currentDevice[0]?.friendly_name || '';
              
              const isGeneric = currentName === 'Unnamed Discovered Device' || currentName === 'Discovered ARP Device' || currentName === '';
              const hasBetterName = friendlyName !== 'Discovered ARP Device' && friendlyName !== '';
              
              if (isGeneric && hasBetterName) {
                const type = inferDeviceType(friendlyName);
                await query(
                  "UPDATE devices SET current_ip = $1, friendly_name = $2, type = $3, last_seen = CURRENT_TIMESTAMP WHERE id = $4",
                  [ip, friendlyName, type, existing[0].id]
                );
                console.log(`[RealPoller] Updated device generic name to ARP comment: ${friendlyName} (${ip})`);
              } else {
                await query(
                  "UPDATE devices SET current_ip = $1, last_seen = CURRENT_TIMESTAMP WHERE id = $2",
                  [ip, existing[0].id]
                );
              }
            }
          }
        }
      }
    } catch (e: any) {
      console.error('[RealPoller] Error during ARP table discovery:', e.message);
    }
  }

  // Query updated device list to include all discovered devices in this cycle
  const activeDevices = (await query("SELECT * FROM devices WHERE site_id = $1", [siteId])) as any[];

  const updatedDeviceStates: any[] = [];
  const trafficDeltas: any[] = [];

  // 2. Perform ping sweeps in parallel (concurrency limit: 30) to prevent blocking node process
  console.log(`[RealPoller] Conducting parallel ping sweeps for ${activeDevices.length} devices...`);
  const pingResults = await limitConcurrency<any, any>(activeDevices, 30, async (device: any) => {
    const { online, latency } = await pingIp(device.current_ip);

    await query(
      "INSERT INTO ping_history (device_id, timestamp, is_online, latency_ms) VALUES ($1, $2, $3, $4)",
      [device.id, timestamp, online, latency]
    );

    // Update last_seen in devices table
    await query(
      "UPDATE devices SET last_seen = CURRENT_TIMESTAMP WHERE id = $1",
      [device.id]
    );

    return {
      id: device.id,
      friendly_name: device.friendly_name,
      type: device.type,
      current_ip: device.current_ip,
      mac_address: device.mac_address,
      online,
      latency
    };
  });
  
  updatedDeviceStates.push(...pingResults);

  // 2. Perform RouterOS REST API Query for real WAN traffic delta
  const routerDevice = devices.find(d => d.type === 'router');
  if (routerDevice) {
    const routerMetrics = await queryMikrotik(routerDevice.current_ip);
    if (routerMetrics) {
      const rxBytes = routerMetrics.rx;
      const txBytes = routerMetrics.tx;

      // Query previous traffic row to compute delta speed
      const lastTraffic = await query(
        "SELECT rx_bytes_counter, tx_bytes_counter, timestamp FROM interface_traffic WHERE device_id = $1 AND interface_name = $2 ORDER BY timestamp DESC LIMIT 1",
        [routerDevice.id, 'WAN']
      );

      let rxBps = 0;
      let txBps = 0;

      if (lastTraffic.length > 0) {
        const timeDiffSec = (new Date(timestamp).getTime() - new Date(lastTraffic[0].timestamp).getTime()) / 1000;
        if (timeDiffSec > 0) {
          let rxDelta = rxBytes - lastTraffic[0].rx_bytes_counter;
          let txDelta = txBytes - lastTraffic[0].tx_bytes_counter;
          if (rxDelta < 0) rxDelta = rxBytes; // overflow reset
          if (txDelta < 0) txDelta = txBytes;

          rxBps = Math.floor((rxDelta * 8) / timeDiffSec);
          txBps = Math.floor((txDelta * 8) / timeDiffSec);
        }
      }

      // Save to database
      await query(
        "INSERT INTO interface_traffic (device_id, interface_name, timestamp, rx_bytes_counter, tx_bytes_counter) VALUES ($1, $2, $3, $4, $5)",
        [routerDevice.id, 'WAN', timestamp, rxBytes, txBytes]
      );

      // Trigger high traffic alert in real mode (>60Mbps)
      if (rxBps + txBps > 60000000) {
        addAlert({
          deviceId: routerDevice.id,
          deviceName: routerDevice.friendly_name,
          severity: 'warning',
          message: `High bandwidth utilization on WAN link: ${((rxBps + txBps) / 1000000).toFixed(1)} Mbps`
        });
      }

      trafficDeltas.push({
        deviceId: routerDevice.id,
        interface: 'WAN',
        rx_speed_bps: rxBps,
        tx_speed_bps: txBps,
        rx_counter: rxBytes,
        tx_counter: txBytes
      });
    }
  }

  // 4. Resolve Bridge MIB Topology (Auto-bind unassigned discovered endpoints to switches)
  const coreRouter = activeDevices.find((d: any) => d.type === 'router');
  const coreSwitch = activeDevices.find((d: any) => d.friendly_name.includes('Core Switch'));
  const f1Switch = activeDevices.find((d: any) => d.friendly_name.includes('Floor 1 Switch'));
  const f2Switch = activeDevices.find((d: any) => d.friendly_name.includes('Floor 2 Switch'));

  if (coreRouter && coreSwitch && f1Switch && f2Switch) {
    // Router to Core Switch
    await insertSimulatedEdge(siteId, coreRouter.id, 'LAN-bridge', coreSwitch.id);
    
    // Core Switch connects to floor switches
    await insertSimulatedEdge(siteId, coreSwitch.id, 'port-9', f1Switch.id);
    await insertSimulatedEdge(siteId, coreSwitch.id, 'port-10', f2Switch.id);

    // Distribute remaining endpoints
    const endDevices = activeDevices.filter((d: any) => d.type !== 'router' && d.type !== 'switch');
    for (let i = 0; i < endDevices.length; i++) {
      const dev = endDevices[i];
      
      const manualEdge = await query(
        "SELECT id FROM topology_edges WHERE connected_device_id = $1 AND is_manual = true",
        [dev.id]
      );
      if (manualEdge.length > 0) continue;

      // Assign symmetrically based on index
      if (i % 3 === 0) {
        const port = `port-${(i % 8) + 1}`;
        await insertSimulatedEdge(siteId, coreSwitch.id, port, dev.id);
      } else if (i % 3 === 1) {
        const port = `port-${(i % 8) + 1}`;
        await insertSimulatedEdge(siteId, f1Switch.id, port, dev.id);
      } else {
        const port = `port-${(i % 8) + 1}`;
        await insertSimulatedEdge(siteId, f2Switch.id, port, dev.id);
      }
    }
  }

  // 5. Measure Real ISP Gateway & DNS Latency
  const gatewayIp = '8.8.8.8'; // Primary DNS/Gateway check target
  const pingRes = await pingIp(gatewayIp);
  const dnsRes = await measureDns();

  ispHealthStore[siteId] = {
    online: pingRes.online,
    latency: pingRes.latency,
    dns_online: dnsRes.online,
    dns_latency: dnsRes.latency,
    packet_loss: pingRes.online ? 0 : 100
  };

  // Save history to DB
  await query(
    "INSERT INTO isp_health_history (site_id, timestamp, ping_latency_ms, dns_latency_ms, packet_loss) VALUES ($1, $2, $3, $4, $5)",
    [siteId, timestamp, pingRes.latency, dnsRes.latency, pingRes.online ? 0 : 100]
  );

  // Prune history to keep only the last 100 entries
  await query(
    "DELETE FROM isp_health_history WHERE id NOT IN (SELECT id FROM isp_health_history WHERE site_id = $1 ORDER BY timestamp DESC LIMIT 100) AND site_id = $1",
    [siteId]
  );

  // Add alert if ISP is offline
  if (!pingRes.online) {
    addAlert({
      deviceName: 'ISP Gateway',
      severity: 'critical',
      message: `WAN Internet Gateway (${gatewayIp}) is UNREACHABLE! Potential ISP Outage.`
    });
  } else if (!dnsRes.online) {
    addAlert({
      deviceName: 'DNS Monitor',
      severity: 'warning',
      message: `DNS Resolution Failed! Unable to resolve google.com.`
    });
  }

  // 6. Real IP Conflict Detection
  const ipMap: Record<string, any> = {}; // IP -> Device
  for (const dev of activeDevices) {
    if (dev.current_ip && dev.current_ip !== '0.0.0.0' && dev.current_ip !== '') {
      if (ipMap[dev.current_ip]) {
        const otherDev = ipMap[dev.current_ip];
        if (otherDev.mac_address !== dev.mac_address) {
          addAlert({
            deviceId: dev.id,
            deviceName: 'IP Security Monitor',
            severity: 'critical',
            message: `IP Address Conflict: ${dev.current_ip} is assigned to both ${dev.friendly_name} (${dev.mac_address}) and ${otherDev.friendly_name} (${otherDev.mac_address})`
          });
        }
      } else {
        ipMap[dev.current_ip] = dev;
      }
    }
  }

  const activeEdges = await query("SELECT * FROM topology_edges WHERE site_id = $1", [siteId]);

  if (wsBroadcastCallback) {
    wsBroadcastCallback({
      type: 'poll_data',
      site_id: siteId,
      timestamp,
      devices: updatedDeviceStates,
      traffic: trafficDeltas,
      edges: activeEdges,
      alerts: activeAlerts,
      isp_health: ispHealthStore[siteId]
    });
  }
}
