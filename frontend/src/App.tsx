import React, { useState, useEffect, useCallback, useMemo } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Position,
  Handle,
  applyNodeChanges,
  applyEdgeChanges
} from 'reactflow';
import 'reactflow/dist/style.css';
import {
  Activity,
  Server,
  Network,
  Printer,
  Monitor,
  Smartphone,
  Wifi,
  Calendar,
  AlertTriangle,
  Search,
  Filter,
  Sliders,
  MapPin,
  Settings,
  Plus,
  RefreshCw,
  X,
  Layers,
  Terminal,
  Database,
  ArrowUpRight,
  ArrowDownLeft,
  Globe,
  Shield
} from 'lucide-react';

// Backend WS URL (Port 5005)
const WS_URL = `ws://${window.location.hostname}:5005/ws`;

// --- CUSTOM REACT FLOW NODE COMPONENTS ---

// 1. Router Node Component
const RouterNode = ({ data }: any) => (
  <div className="node-container node-router">
    <Handle type="source" position={Position.Bottom} id="router-out" />
    <div className="node-header">
      <div className="flex items-center gap-2" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Server size={18} />
        <span>{data.label}</span>
      </div>
      <span className={`status-indicator ${data.online ? 'status-online' : 'status-offline'}`} />
    </div>
    <div className="node-meta font-mono" style={{ fontSize: '10px', marginTop: '4px' }}>IP: {data.ip}</div>
    <div className="node-meta font-mono" style={{ fontSize: '10px' }}>MAC: {data.mac}</div>
  </div>
);

// 2. Switch Node Component
const SwitchNode = ({ data }: any) => (
  <div className="node-container node-switch" style={{ paddingBottom: data.childCount > 0 ? '12px' : '16px' }}>
    <Handle type="target" position={Position.Top} id="switch-in" />
    <Handle type="source" position={Position.Bottom} id="switch-out" />
    <div className="node-header">
      <div className="flex items-center gap-2" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Network size={18} />
        <span>{data.label}</span>
      </div>
      <span className={`status-indicator ${data.online ? 'status-online' : 'status-offline'}`} />
    </div>
    <div className="node-meta font-mono" style={{ fontSize: '10px', marginTop: '4px' }}>IP: {data.ip}</div>
    <div className="node-meta font-mono" style={{ fontSize: '10px', marginBottom: data.childCount > 0 ? '4px' : '0' }}>MAC: {data.mac}</div>
    
    {/* Dynamic Expand/Collapse Button */}
    {data.childCount > 0 && (
      <button 
        onClick={(e) => {
          e.stopPropagation();
          if (data.onToggleExpand) data.onToggleExpand(data.id);
        }}
        className="glass-button"
        style={{
          width: '100%', padding: '4px 8px', fontSize: '10px', marginTop: '8px',
          background: data.isExpanded ? 'rgba(239, 68, 68, 0.25)' : 'rgba(59, 130, 246, 0.25)',
          borderColor: data.isExpanded ? 'rgba(239, 68, 68, 0.4)' : 'rgba(59, 130, 246, 0.4)',
          color: '#fff', cursor: 'pointer', borderRadius: '6px', fontWeight: 'bold',
          transition: 'all 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px'
        }}
      >
        <span>{data.isExpanded ? 'Collapse' : 'Expand'}</span>
        <span style={{ fontSize: '9px', background: 'rgba(255,255,255,0.1)', padding: '1px 4px', borderRadius: '4px' }}>
          {data.childCount} Dev
        </span>
      </button>
    )}
  </div>
);

// 3. Leaf Device Node Component
const DeviceNode = ({ data }: any) => {
  const getDeviceIcon = (type: string) => {
    switch (type) {
      case 'pc': return <Monitor size={16} className="text-blue-400" style={{ color: '#60a5fa' }} />;
      case 'phone': return <Smartphone size={16} className="text-purple-400" style={{ color: '#c084fc' }} />;
      case 'printer': return <Printer size={16} className="text-amber-400" style={{ color: '#fbbf24' }} />;
      case 'ap': return <Wifi size={16} className="text-green-400" style={{ color: '#34d399' }} />;
      case 'attendance_machine': return <Calendar size={16} className="text-rose-400" style={{ color: '#f87171' }} />;
      default: return <Terminal size={16} className="text-slate-400" style={{ color: '#94a3b8' }} />;
    }
  };

  return (
    <div className="node-container node-device" style={{ background: data.online ? '#1b2237' : '#22191b' }}>
      <Handle type="target" position={Position.Top} id="device-in" />
      <div className="node-header">
        <div className="flex items-center gap-2" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {getDeviceIcon(data.type)}
          <span style={{ maxWidth: '110px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {data.label}
          </span>
        </div>
        <span className={`status-indicator ${data.online ? 'status-online' : 'status-offline'}`} />
      </div>
      <div className="node-meta font-mono" style={{ fontSize: '9px', marginTop: '2px' }}>IP: {data.ip}</div>
      <div className="node-meta font-mono" style={{ fontSize: '9px' }}>Type: {data.type}</div>
    </div>
  );
};

// Node type registry
const nodeTypes = {
  routerNode: RouterNode,
  switchNode: SwitchNode,
  deviceNode: DeviceNode
};

export default function App() {
  // Navigation & UI States
  const [activeTab, setActiveTab] = useState<'topology' | 'inventory' | 'settings'>('topology');
  const [sites, setSites] = useState<any[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<number>(1);
  const [devices, setDevices] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [trafficData, setTrafficData] = useState<any[]>([]);

  // Settings page state
  const [settings, setSettingsData] = useState({
    SIMULATION_MODE: true,
    ROUTER_URL: 'http://192.168.1.1/rest',
    ROUTER_USER: 'admin',
    ROUTER_PASSWORD: ''
  });
  const [hasSavedPassword, setHasSavedPassword] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [testLogs, setTestLogs] = useState('');
  const [testSuccess, setTestSuccess] = useState<boolean | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    async function loadSettings() {
      try {
        const res = await fetch('/api/settings');
        if (res.ok) {
          const data = await res.json();
          setSettingsData({
            SIMULATION_MODE: data.SIMULATION_MODE,
            ROUTER_URL: data.ROUTER_URL,
            ROUTER_USER: data.ROUTER_USER,
            ROUTER_PASSWORD: ''
          });
          setHasSavedPassword(data.hasPassword);
        }
      } catch (e) {
        console.error('Failed to fetch settings:', e);
      }
    }
    loadSettings();
  }, []);

  const handleTestConnection = async () => {
    setTestingConnection(true);
    setTestLogs('Starting connection test...\n');
    setTestSuccess(null);
    try {
      const res = await fetch('/api/settings/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      if (res.ok) {
        const data = await res.json();
        setTestLogs(data.logs);
        setTestSuccess(data.success);
      } else {
        setTestLogs(prev => prev + `\n❌ Error: Server returned status ${res.status}`);
        setTestSuccess(false);
      }
    } catch (e: any) {
      setTestLogs(prev => prev + `\n❌ Error: ${e.message}`);
      setTestSuccess(false);
    } finally {
      setTestingConnection(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    setSaveStatus(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      if (res.ok) {
        const data = await res.json();
        setSaveStatus({ type: 'success', message: data.message });
        setHasSavedPassword(!!settings.ROUTER_PASSWORD || hasSavedPassword);
        // Refresh site data after save (if switching modes)
        setTimeout(() => fetchData(selectedSiteId), 2000);
      } else {
        setSaveStatus({ type: 'error', message: 'Failed to save settings.' });
      }
    } catch (e: any) {
      setSaveStatus({ type: 'error', message: `Error: ${e.message}` });
    } finally {
      setSavingSettings(false);
    }
  };

  // Backup & Restore Configuration States
  const [importingConfig, setImportingConfig] = useState(false);
  const [backupLogs, setBackupLogs] = useState('');

  const handleExportConfig = async () => {
    setBackupLogs('Contacting backend to retrieve backup data...');
    try {
      const res = await fetch('/api/backup/export');
      if (res.ok) {
        const data = await res.json();
        const jsonStr = JSON.stringify(data, null, 2);
        
        // Trigger file download
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const dateStr = new Date().toISOString().split('T')[0];
        link.download = `netops_backup_${dateStr}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        setBackupLogs(`✅ Configuration backup successfully generated and downloaded.\nBackup includes:\n- ${data.sites?.length || 0} Sites\n- ${data.devices?.length || 0} Devices\n- ${data.topology_edges?.length || 0} Topology Connection Lines.`);
      } else {
        setBackupLogs(`❌ Failed to export configuration backup. Status: ${res.status}`);
      }
    } catch (e: any) {
      setBackupLogs(`❌ Error exporting backup: ${e.message}`);
    }
  };

  const handleImportConfig = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportingConfig(true);
    setBackupLogs(`Reading backup file: ${file.name}...\n`);

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const jsonStr = event.target?.result as string;
        
        // Verify JSON parses locally before sending
        JSON.parse(jsonStr);

        setBackupLogs(prev => prev + 'Uploading backup payload to backend server...\n');
        
        const res = await fetch('/api/backup/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: jsonStr
        });

        if (res.ok) {
          const result = await res.json();
          setBackupLogs(`✅ Import successfully completed!\n\nImport logs:\n${result.logs}`);
          // Refresh site data immediately
          fetchData(selectedSiteId);
        } else {
          const errRes = await res.json().catch(() => ({ error: 'Unknown server error' }));
          setBackupLogs(`❌ Import failed. Status: ${res.status}\nError details:\n${errRes.error || 'Unknown error'}\n\nLogs:\n${errRes.logs || ''}`);
        }
      } catch (err: any) {
        setBackupLogs(prev => prev + `\n❌ Parsing error: ${err.message}`);
      } finally {
        setImportingConfig(false);
        // Clear input file
        e.target.value = '';
      }
    };

    reader.onerror = () => {
      setBackupLogs(prev => prev + '\n❌ Failed to read file.');
      setImportingConfig(false);
      e.target.value = '';
    };

    reader.readAsText(file);
  };

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  // React Flow States (Raw Data & Visibility Filtering)
  const [rawNodes, setRawNodes] = useState<any[]>([]);
  const [rawEdges, setRawEdges] = useState<any[]>([]);
  const [expandedSwitchIds, setExpandedSwitchIds] = useState<Set<number>>(new Set());
  const [ispHealth, setIspHealth] = useState<any>({
    online: true,
    latency: 22,
    dns_online: true,
    dns_latency: 10,
    packet_loss: 0
  });
  const [ispHealthHistory, setIspHealthHistory] = useState<any[]>([]);

  const toggleSwitchExpand = useCallback((switchId: number) => {
    setExpandedSwitchIds(prev => {
      const next = new Set(prev);
      if (next.has(switchId)) {
        next.delete(switchId);
      } else {
        next.add(switchId);
      }
      return next;
    });
  }, []);

  const visibleNodes = useMemo(() => {
    const switchChildCounts: Record<string, number> = {};
    rawNodes.forEach(node => {
      if (node.type === 'deviceNode' && node.data?.switchId) {
        const swId = String(node.data.switchId);
        switchChildCounts[swId] = (switchChildCounts[swId] || 0) + 1;
      }
    });

    return rawNodes.map(node => {
      if (node.type === 'switchNode') {
        const swIdNum = Number(node.id);
        const childCount = switchChildCounts[node.id] || 0;
        return {
          ...node,
          data: {
            ...node.data,
            id: swIdNum,
            childCount,
            isExpanded: expandedSwitchIds.has(swIdNum),
            onToggleExpand: toggleSwitchExpand
          }
        };
      }
      return node;
    }).filter(node => {
      if (node.type === 'deviceNode' && node.data?.switchId) {
        return expandedSwitchIds.has(Number(node.data.switchId));
      }
      return true;
    });
  }, [rawNodes, expandedSwitchIds, toggleSwitchExpand]);

  const visibleEdges = useMemo(() => {
    const visibleNodeIds = new Set(visibleNodes.map(n => n.id));
    return rawEdges.filter(edge => 
      visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
    );
  }, [rawEdges, visibleNodes]);

  const onNodesChange = useCallback(
    (changes: any) => setRawNodes((nds) => applyNodeChanges(changes, nds)),
    []
  );
  const onEdgesChange = useCallback(
    (changes: any) => setRawEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  );

  // Modal Editing States
  const [editingDevice, setEditingDevice] = useState<any | null>(null);
  const [showAddSiteModal, setShowAddSiteModal] = useState(false);
  const [newSiteName, setNewSiteName] = useState('');
  const [newSiteCidr, setNewSiteCidr] = useState('192.168.2.0/24');
  const [newSiteNotes, setNewSiteNotes] = useState('');

  // WebSocket Connection
  const [wsConnected, setWsConnected] = useState(false);

  // Fetch initial REST data
  const fetchData = useCallback(async (siteId: number) => {
    try {
      // Fetch devices
      const devRes = await fetch(`/api/devices?site_id=${siteId}`);
      if (devRes.ok) {
        const devData = await devRes.json();
        setDevices(devData);
      }

      // Fetch topology
      const topoRes = await fetch(`/api/topology?site_id=${siteId}`);
      if (topoRes.ok) {
        const topoData = await topoRes.json();
        setRawNodes(topoData.nodes || []);
        setRawEdges(topoData.edges || []);
      }

      // Fetch traffic history
      const trafficRes = await fetch(`/api/traffic?site_id=${siteId}`);
      if (trafficRes.ok) {
        const tData = await trafficRes.json();
        setTrafficData(tData);
      }

      // Fetch ISP health status (Proof of Concept)
      const ispRes = await fetch(`/api/isp-health?site_id=${siteId}`);
      if (ispRes.ok) {
        const ispData = await ispRes.json();
        setIspHealth(ispData.current);
        setIspHealthHistory(ispData.history || []);
      }
    } catch (e) {
      console.error('REST Fetch Error:', e);
    }
  }, []);

  // Initial Boot
  useEffect(() => {
    async function loadSites() {
      try {
        const res = await fetch('/api/sites');
        if (res.ok) {
          const data = await res.json();
          setSites(data);
          if (data.length > 0) {
            setSelectedSiteId(data[0].id);
            fetchData(data[0].id);
          }
        }
      } catch (e) {
        console.error('Failed to load sites:', e);
      }
    }

    async function loadAlerts() {
      try {
        const res = await fetch('/api/alerts');
        if (res.ok) {
          const data = await res.json();
          setAlerts(data);
        }
      } catch (e) {}
    }

    loadSites();
    loadAlerts();
  }, [fetchData]);

  // Handle Site Change
  const handleSiteChange = (id: number) => {
    setSelectedSiteId(id);
    fetchData(id);
  };

  // WebSocket Subscriber
  useEffect(() => {
    let ws: WebSocket;
    let reconnectTimeout: any;

    function connect() {
      console.log('Connecting to WebSocket...');
      ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        console.log('WebSocket connected.');
        setWsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          
          if (msg.type === 'init') {
            if (msg.data.sites) setSites(msg.data.sites);
            if (msg.data.alerts) setAlerts(msg.data.alerts);
          } 
          else if (msg.type === 'alerts') {
            setAlerts(msg.data);
          }
          else if (msg.type === 'alert_new') {
            // Trigger visual alert, preventing duplicate keys
            setAlerts(prev => {
              if (prev.some(a => a.id === msg.data.id)) return prev;
              return [msg.data, ...prev];
            });
          }
          else if (msg.type === 'poll_data' && Number(msg.site_id) === Number(selectedSiteId)) {
            // Update device inventory online status and pings
            setDevices(prevDevices => {
              return prevDevices.map(d => {
                const updated = msg.devices.find((ud: any) => ud.id === d.id);
                if (updated) {
                  return {
                    ...d,
                    is_online: updated.online,
                    last_latency: updated.latency
                  };
                }
                return d;
              });
            });

            // Update React Flow nodes and edges
            if (msg.devices) {
              setRawNodes(prevNodes => 
                prevNodes.map(node => {
                  const devState = msg.devices.find((d: any) => String(d.id) === node.id);
                  if (devState) {
                    return {
                      ...node,
                      data: {
                        ...node.data,
                        online: devState.online
                      }
                    };
                  }
                  return node;
                })
              );
            }

            if (msg.edges) {
              setRawEdges(msg.edges.map((edge: any) => ({
                id: `edge-${edge.id}`,
                source: String(edge.switch_device_id || ''),
                target: String(edge.connected_device_id),
                label: edge.switch_port ? `Port ${edge.switch_port}` : '',
                animated: false, // Disabled animation to prevent heavy rendering lag
                style: (edge.is_manual === 1 || edge.is_manual === true) 
                  ? { stroke: '#e2e8f0', strokeWidth: 2, strokeDasharray: '4 4' }
                  : { stroke: '#3b82f6', strokeWidth: 2 }
              })));
            }

            // Prepend new traffic history delta
            if (msg.traffic && msg.traffic.length > 0) {
              setTrafficData(prev => {
                const formatted = msg.traffic.map((t: any) => ({
                  device_id: t.deviceId,
                  interface_name: t.interface,
                  timestamp: msg.timestamp,
                  rx_bytes_counter: t.rx_counter,
                  tx_bytes_counter: t.tx_counter,
                  rx_speed: t.rx_speed_bps,
                  tx_speed: t.tx_speed_bps
                }));
                // Keep history capped at 100 rows
                return [...formatted, ...prev].slice(0, 100);
              });
            }

            if (msg.isp_health) {
              setIspHealth(msg.isp_health);
              setIspHealthHistory(prev => {
                // Prevent duplicate entries for the exact same timestamp ticks
                if (prev.length > 0 && prev[prev.length - 1].timestamp === msg.timestamp) return prev;
                return [...prev, {
                  timestamp: msg.timestamp,
                  ping_latency_ms: msg.isp_health.latency,
                  dns_latency_ms: msg.isp_health.dns_latency,
                  packet_loss: msg.isp_health.packet_loss
                }].slice(-100);
              });
            }
          }
        } catch (e) {
          console.error('Error parsing WS message:', e);
        }
      };

      ws.onclose = () => {
        console.log('WebSocket closed. Reconnecting...');
        setWsConnected(false);
        reconnectTimeout = setTimeout(connect, 3000);
      };

      ws.onerror = (err) => {
        console.error('WebSocket Error:', err);
        ws.close();
      };
    }

    connect();

    return () => {
      if (ws) ws.close();
      clearTimeout(reconnectTimeout);
    };
  }, [selectedSiteId]);

  // Handle Drag-and-Connect Manual Topology Edge Overrides
  const onConnect = useCallback((params: any) => {
    if (!params.source || !params.target) return;

    // Send connection assignment to API
    fetch('/api/topology/edges', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        site_id: selectedSiteId,
        switch_device_id: parseInt(params.source),
        switch_port: 'manual-' + Math.floor(Math.random() * 8 + 1), // Assign a manual port label
        connected_device_id: parseInt(params.target)
      })
    })
    .then(res => {
      if (res.ok) {
        console.log('Manual edge successfully recorded.');
        fetchData(selectedSiteId); // Refresh topology nodes & edges
      }
    })
    .catch(err => console.error('Error creating manual edge override:', err));
  }, [selectedSiteId, fetchData]);

  // Handle Device Save
  const handleSaveDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDevice) return;

    try {
      const res = await fetch(`/api/devices/${editingDevice.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingDevice)
      });

      if (res.ok) {
        setEditingDevice(null);
        fetchData(selectedSiteId);
      }
    } catch (e) {
      console.error('Error saving device details:', e);
    }
  };

  // Add Site Form Submission
  const handleAddSite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSiteName || !newSiteCidr) return;

    try {
      const res = await fetch('/api/sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newSiteName,
          network_cidr: newSiteCidr,
          address_notes: newSiteNotes
        })
      });

      if (res.ok) {
        const data = await res.json();
        const createdId = data.id;
        const newSiteObj = { id: createdId, name: newSiteName, network_cidr: newSiteCidr, address_notes: newSiteNotes };
        setSites(prev => [...prev, newSiteObj]);
        setShowAddSiteModal(false);
        setNewSiteName('');
        // Switch to newly created site
        handleSiteChange(createdId);
      }
    } catch (e) {
      console.error('Error adding site:', e);
    }
  };

  // Clear/Dismiss Alert
  const handleDismissAlert = async (id: string) => {
    try {
      await fetch('/api/alerts/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      setAlerts(prev => prev.filter(a => a.id !== id));
    } catch (e) {}
  };

  // Compute Real-time Traffic Graph coordinates from historical entries
  const currentSiteName = useMemo(() => {
    return sites.find(s => s.id === selectedSiteId)?.name || 'Surabaya Office';
  }, [sites, selectedSiteId]);

  const routerDevice = useMemo(() => {
    return devices.find(d => d.type === 'router');
  }, [devices]);

  // Aggregate recent interface rates for Charting (WAN port)
  const chartPoints = useMemo(() => {
    if (!routerDevice) return [];

    const wanTraffic = trafficData
      .filter(t => t.device_id === routerDevice.id && t.interface_name === 'WAN')
      // Sort oldest to newest for chronological plotting
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    // Pull last 10 points
    const points = wanTraffic.slice(-10);

    return points.map((p, idx) => {
      // In simulation mode speed is parsed directly, otherwise compute deltas
      let rxBps = p.rx_speed || 0;
      let txBps = p.tx_speed || 0;

      // Fallback: Compute delta if speed is missing
      if (!rxBps && idx > 0) {
        const prev = points[idx - 1];
        const timeDiffSec = (new Date(p.timestamp).getTime() - new Date(prev.timestamp).getTime()) / 1000;
        if (timeDiffSec > 0) {
          const rxDelta = p.rx_bytes_counter - prev.rx_bytes_counter;
          const txDelta = p.tx_bytes_counter - prev.tx_bytes_counter;
          rxBps = Math.max(0, (rxDelta * 8) / timeDiffSec);
          txBps = Math.max(0, (txDelta * 8) / timeDiffSec);
        }
      }

      return {
        label: new Date(p.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        rxMbps: rxBps / 1000000,
        txMbps: txBps / 1000000
      };
    });
  }, [trafficData, routerDevice]);

  // Calculate coordinates for custom SVG charting
  const svgDimensions = { width: 500, height: 160 };
  const chartPaths = useMemo(() => {
    if (chartPoints.length < 2) return { rxPath: '', txPath: '', rxArea: '', txArea: '' };

    const maxVal = Math.max(10, ...chartPoints.map(p => Math.max(p.rxMbps, p.txMbps))) * 1.15; // 15% head padding
    const xStep = svgDimensions.width / (chartPoints.length - 1);
    
    let rxPoints: string[] = [];
    let txPoints: string[] = [];

    chartPoints.forEach((p, idx) => {
      const x = idx * xStep;
      const rxY = svgDimensions.height - (p.rxMbps / maxVal) * (svgDimensions.height - 20);
      const txY = svgDimensions.height - (p.txMbps / maxVal) * (svgDimensions.height - 20);
      
      rxPoints.push(`${x},${rxY}`);
      txPoints.push(`${x},${txY}`);
    });

    const rxPath = `M ${rxPoints.join(' L ')}`;
    const txPath = `M ${txPoints.join(' L ')}`;

    // Add baseline for filled area charts
    const rxArea = `${rxPath} L ${svgDimensions.width},${svgDimensions.height} L 0,${svgDimensions.height} Z`;
    const txArea = `${txPath} L ${svgDimensions.width},${svgDimensions.height} L 0,${svgDimensions.height} Z`;

    return { rxPath, txPath, rxArea, txArea, maxVal };
  }, [chartPoints]);

  // Calculate coordinates for ISP and DNS latency history SVG charting
  const latencyChartPaths = useMemo(() => {
    if (ispHealthHistory.length < 2) return { pingPath: '', dnsPath: '', pingArea: '', dnsArea: '', maxVal: 0 };

    const maxVal = Math.max(30, ...ispHealthHistory.map(p => Math.max(p.ping_latency_ms || 0, p.dns_latency_ms || 0))) * 1.15;
    const xStep = svgDimensions.width / (ispHealthHistory.length - 1);

    let pingPoints: string[] = [];
    let dnsPoints: string[] = [];

    ispHealthHistory.forEach((p, idx) => {
      const x = idx * xStep;
      const pingY = svgDimensions.height - ((p.ping_latency_ms || 0) / maxVal) * (svgDimensions.height - 20);
      const dnsY = svgDimensions.height - ((p.dns_latency_ms || 0) / maxVal) * (svgDimensions.height - 20);

      pingPoints.push(`${x},${pingY}`);
      dnsPoints.push(`${x},${dnsY}`);
    });

    const pingPath = `M ${pingPoints.join(' L ')}`;
    const dnsPath = `M ${dnsPoints.join(' L ')}`;

    const pingArea = `${pingPath} L ${svgDimensions.width},${svgDimensions.height} L 0,${svgDimensions.height} Z`;
    const dnsArea = `${dnsPath} L ${svgDimensions.width},${svgDimensions.height} L 0,${svgDimensions.height} Z`;

    return { pingPath, dnsPath, pingArea, dnsArea, maxVal };
  }, [ispHealthHistory, svgDimensions.width, svgDimensions.height]);

  // Filter Inventory Lists
  const filteredDevices = useMemo(() => {
    return devices.filter(d => {
      const matchesSearch = 
        d.friendly_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        d.current_ip.includes(searchQuery) ||
        d.mac_address.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesType = typeFilter === 'all' || d.type === typeFilter;
      
      const matchesStatus = 
        statusFilter === 'all' || 
        (statusFilter === 'online' && d.is_online) || 
        (statusFilter === 'offline' && !d.is_online);

      return matchesSearch && matchesType && matchesStatus;
    });
  }, [devices, searchQuery, typeFilter, statusFilter]);

  // Pull Printer details
  const printers = useMemo(() => {
    return devices.filter(d => d.type === 'printer');
  }, [devices]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      
      {/* HEADER BAR */}
      <header className="glass-card" style={{ borderRadius: '0', padding: '16px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: 'none', borderLeft: 'none', borderRight: 'none', zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ background: 'linear-gradient(135deg, var(--accent-blue), var(--accent-violet))', padding: '10px', borderRadius: '12px', boxShadow: '0 0 15px rgba(59, 130, 246, 0.4)' }}>
            <Activity className="animate-pulse" size={24} style={{ color: '#fff' }} />
          </div>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: '800', background: 'linear-gradient(to right, #ffffff, #94a3b8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              NETOPS MONITOR
            </h1>
            <p style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Multi-Site Infrastructure Dashboard</p>
          </div>
        </div>

        {/* CONTROLS */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          
          {/* Site Selector Dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.03)', padding: '6px 12px', borderRadius: '10px', border: '1px solid var(--border-glass)' }}>
            <MapPin size={16} style={{ color: 'var(--accent-blue)' }} />
            <select 
              value={selectedSiteId} 
              onChange={(e) => handleSiteChange(Number(e.target.value))}
              style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: '13px', outline: 'none', cursor: 'pointer', fontFamily: 'var(--font-display)', fontWeight: 500 }}
            >
              {sites.map(site => (
                <option key={site.id} value={site.id} style={{ background: 'var(--bg-secondary)', color: '#fff' }}>
                  {site.name} ({site.network_cidr})
                </option>
              ))}
            </select>
            <button 
              onClick={() => setShowAddSiteModal(true)}
              style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
              title="Add New Site"
            >
              <Plus size={16} className="hover:text-white" style={{ transition: 'color 0.2s' }} />
            </button>
          </div>

          {/* Connection Status indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-secondary)' }}>
            <span className={`status-indicator ${wsConnected ? 'status-online' : 'status-offline'}`} style={{ width: '6px', height: '6px' }} />
            <span>{wsConnected ? 'Live stream' : 'Disconnected'}</span>
          </div>

          {/* Refresh Button */}
          <button 
            onClick={() => fetchData(selectedSiteId)} 
            className="glass-button glass-button-secondary"
            style={{ padding: '8px 12px' }}
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </header>

      {/* DASHBOARD GRID SYSTEM */}
      <main style={{ flex: 1, padding: '24px 32px', display: 'grid', gridTemplateColumns: '1fr 340px', gap: '24px', overflow: 'hidden' }}>
        
        {/* LEFT COLUMN - CENTRAL ACTION AREA */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          {/* NAVIGATION TABS */}
          <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border-glass)', paddingBottom: '4px' }}>
            <button 
              onClick={() => setActiveTab('topology')} 
              className={`glass-button ${activeTab === 'topology' ? '' : 'glass-button-secondary'}`}
              style={{ borderRadius: '8px 8px 0 0', boxShadow: 'none' }}
            >
              <Layers size={16} /> Topology Graph
            </button>
            <button 
              onClick={() => setActiveTab('inventory')} 
              className={`glass-button ${activeTab === 'inventory' ? '' : 'glass-button-secondary'}`}
              style={{ borderRadius: '8px 8px 0 0', boxShadow: 'none' }}
            >
              <Database size={16} /> Asset Inventory ({filteredDevices.length})
            </button>
            <button 
              onClick={() => setActiveTab('settings')} 
              className={`glass-button ${activeTab === 'settings' ? '' : 'glass-button-secondary'}`}
              style={{ borderRadius: '8px 8px 0 0', boxShadow: 'none' }}
            >
              <Settings size={16} /> Router Settings
            </button>
          </div>

          {/* TAB 1: TOPOLOGY DIAGRAM */}
          {activeTab === 'topology' && (
            <div className="glass-card" style={{ flex: 1, position: 'relative', minHeight: '480px', overflow: 'hidden', padding: '0', display: 'flex', flexDirection: 'column' }}>
              
              <div className="diagram-controls">
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Sliders size={14} style={{ color: 'var(--accent-blue)' }} />
                  <span>Connect switch ports to devices to overwrite auto-topology</span>
                </span>
              </div>

              <div style={{ flex: 1, width: '100%', height: '100%' }}>
                <ReactFlow
                  nodes={visibleNodes}
                  edges={visibleEdges}
                  nodeTypes={nodeTypes}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  onConnect={onConnect}
                  fitView
                >
                  <Background color="#1e293b" gap={20} size={1} />
                  <Controls style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-glass)', fill: '#fff' }} />
                  <MiniMap 
                    nodeColor={(node) => {
                      if (node.type === 'routerNode') return '#8b5cf6';
                      if (node.type === 'switchNode') return '#06b6d4';
                      return '#3b82f6';
                    }} 
                    style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-glass)' }}
                  />
                </ReactFlow>
              </div>
            </div>
          )}

          {/* TAB 2: INVENTORY LIST TABLE */}
          {activeTab === 'inventory' && (
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              
              {/* Filter Controls */}
              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                
                {/* Search */}
                <div style={{ flex: 1, minWidth: '200px', position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <Search size={16} style={{ position: 'absolute', left: '12px', color: 'var(--text-muted)' }} />
                  <input 
                    type="text" 
                    placeholder="Search by IP, MAC, Friendly Name..." 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="glass-input"
                    style={{ width: '100%', paddingLeft: '36px' }}
                  />
                </div>

                {/* Filter Type */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Filter size={16} style={{ color: 'var(--text-secondary)' }} />
                  <select 
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value)}
                    className="glass-input"
                    style={{ background: 'var(--bg-tertiary)' }}
                  >
                    <option value="all">All Types</option>
                    <option value="pc">PCs / Laptops</option>
                    <option value="phone">Phones / Handphones</option>
                    <option value="printer">Printers</option>
                    <option value="ap">Access Points</option>
                    <option value="switch">Switches</option>
                    <option value="router">Routers</option>
                    <option value="attendance_machine">Attendance Machines</option>
                    <option value="unclassified">Unclassified</option>
                  </select>
                </div>

                {/* Filter Online Status */}
                <div>
                  <select 
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="glass-input"
                    style={{ background: 'var(--bg-tertiary)' }}
                  >
                    <option value="all">All Statuses</option>
                    <option value="online">Online Only</option>
                    <option value="offline">Offline Only</option>
                  </select>
                </div>
              </div>

              {/* Table wrapper */}
              <div style={{ overflowX: 'auto', border: '1px solid var(--border-glass)', borderRadius: '12px' }}>
                <table className="custom-table">
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Friendly Name</th>
                      <th>IP Address</th>
                      <th>MAC Address</th>
                      <th>Type</th>
                      <th>Location / Dept</th>
                      <th>Latency</th>
                      <th>Source</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDevices.length === 0 ? (
                      <tr>
                        <td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '32px' }}>
                          No assets found matching the search criteria.
                        </td>
                      </tr>
                    ) : (
                      filteredDevices.map(d => (
                        <tr key={d.id}>
                          <td>
                            <span className={`status-indicator ${d.is_online ? 'status-online' : 'status-offline'}`} />
                          </td>
                          <td style={{ fontWeight: 500 }}>{d.friendly_name}</td>
                          <td className="font-mono">{d.current_ip}</td>
                          <td className="font-mono" style={{ fontSize: '12px' }}>{d.mac_address}</td>
                          <td>
                            <span style={{ fontSize: '11px', background: 'rgba(255,255,255,0.05)', padding: '2px 8px', borderRadius: '4px', textTransform: 'capitalize' }}>
                              {d.type}
                            </span>
                          </td>
                          <td>{d.location_dept || <span style={{ color: 'var(--text-muted)' }}>--</span>}</td>
                          <td className="font-mono">{d.is_online ? `${d.last_latency || 2}ms` : '--'}</td>
                          <td style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                            {d.source === 'seeded_from_config' ? 'Seeded RSC' : d.source}
                          </td>
                          <td>
                            <button 
                              onClick={() => setEditingDevice(d)} 
                              className="glass-button glass-button-secondary"
                              style={{ padding: '6px 10px', fontSize: '11px' }}
                            >
                              <Settings size={12} /> Edit
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: SETTINGS PANEL */}
          {activeTab === 'settings' && (
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div style={{ borderBottom: '1px solid var(--border-glass)', paddingBottom: '12px' }}>
                <h3 style={{ fontSize: '18px', fontWeight: '700' }}>Router Integration & Discovery Settings</h3>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  Configure your Mikrotik RouterOS REST API endpoint to discover connected devices and read real WAN bandwidth.
                </p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px' }}>
                {/* CONFIGURATION FORM */}
                <form onSubmit={handleSaveSettings} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  
                  {/* Simulation Mode Toggle */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.02)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border-glass)' }}>
                    <div>
                      <div style={{ fontWeight: '600', fontSize: '14px' }}>Simulation Mode</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                        If enabled, the poller will mock pings, traffic, and devices without connecting to a physical router.
                      </div>
                    </div>
                    <label className="switch-toggle" style={{ position: 'relative', display: 'inline-block', width: '48px', height: '24px' }}>
                      <input 
                        type="checkbox" 
                        checked={settings.SIMULATION_MODE}
                        onChange={(e) => setSettingsData({ ...settings, SIMULATION_MODE: e.target.checked })}
                        style={{ opacity: 0, width: 0, height: 0 }}
                      />
                      <span className="slider-toggle" style={{
                        position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                        backgroundColor: settings.SIMULATION_MODE ? '#3b82f6' : '#475569',
                        transition: '.3s', borderRadius: '24px'
                      }}>
                        <span style={{
                          position: 'absolute', content: '""', height: '18px', width: '18px', left: '3px', bottom: '3px',
                          backgroundColor: 'white', transition: '.3s', borderRadius: '50%',
                          transform: settings.SIMULATION_MODE ? 'translateX(24px)' : 'none'
                        }} />
                      </span>
                    </label>
                  </div>

                  {/* Router REST API URL */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)' }}>
                      Mikrotik Router REST API URL
                    </label>
                    <input 
                      type="url" 
                      placeholder="http://192.168.1.1/rest" 
                      value={settings.ROUTER_URL}
                      onChange={(e) => setSettingsData({ ...settings, ROUTER_URL: e.target.value })}
                      className="glass-input"
                      required
                    />
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                      Include the `/rest` suffix. Must be accessible from the backend server.
                    </span>
                  </div>

                  {/* Credentials Grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    {/* Username */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)' }}>
                        Username
                      </label>
                      <input 
                        type="text" 
                        placeholder="admin" 
                        value={settings.ROUTER_USER}
                        onChange={(e) => setSettingsData({ ...settings, ROUTER_USER: e.target.value })}
                        className="glass-input"
                        required
                      />
                    </div>

                    {/* Password */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)' }}>
                        Password
                      </label>
                      <input 
                        type="password" 
                        placeholder={hasSavedPassword ? '••••••••' : 'No password set'}
                        value={settings.ROUTER_PASSWORD}
                        onChange={(e) => setSettingsData({ ...settings, ROUTER_PASSWORD: e.target.value })}
                        className="glass-input"
                      />
                    </div>
                  </div>

                  {/* Status Alerts */}
                  {saveStatus && (
                    <div className={`alert-toast ${saveStatus.type === 'success' ? 'info' : 'critical'}`} style={{ width: '100%' }}>
                      <div style={{ fontSize: '12px' }}>{saveStatus.message}</div>
                    </div>
                  )}

                  {/* Form Actions */}
                  <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                    <button 
                      type="button" 
                      onClick={handleTestConnection}
                      disabled={testingConnection}
                      className="glass-button glass-button-secondary"
                      style={{ flex: 1, padding: '12px' }}
                    >
                      {testingConnection ? 'Testing Connection...' : 'Test Connection'}
                    </button>
                    <button 
                      type="submit" 
                      disabled={savingSettings}
                      className="glass-button"
                      style={{ flex: 1, padding: '12px', background: 'linear-gradient(135deg, var(--accent-blue), var(--accent-violet))' }}
                    >
                      {savingSettings ? 'Saving...' : 'Save & Apply Settings'}
                    </button>
                  </div>

                </form>

                {/* DIAGNOSTIC LOGGER OUTPUT */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)' }}>
                      Diagnostic Log Output
                    </label>
                    {testSuccess !== null && (
                      <span style={{ 
                        fontSize: '11px', fontWeight: '700', padding: '2px 8px', borderRadius: '4px',
                        background: testSuccess ? 'rgba(52, 211, 153, 0.2)' : 'rgba(248, 113, 113, 0.2)',
                        color: testSuccess ? '#34d399' : '#f87171'
                      }}>
                        {testSuccess ? 'TEST PASSED' : 'TEST FAILED'}
                      </span>
                    )}
                  </div>
                  <pre style={{
                    flex: 1, background: '#0a0d16', border: '1px solid var(--border-glass)',
                    borderRadius: '12px', padding: '16px', color: '#a7f3d0', fontFamily: 'monospace',
                    fontSize: '11px', overflowY: 'auto', whiteSpace: 'pre-wrap', minHeight: '260px', maxHeight: '400px'
                  }}>
                    {testLogs || 'Click "Test Connection" to run connection diagnostics.'}
                  </pre>
                </div>
              </div>

              {/* BACKUP & RESTORE SECTION */}
              <div style={{ borderTop: '1px solid var(--border-glass)', paddingTop: '24px', display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '12px' }}>
                <div>
                  <h4 style={{ fontSize: '15px', fontWeight: '700' }}>Dashboard Configuration Backup</h4>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    Export your custom sites, device assets, and manual topology connections to a JSON file, or restore them from an existing backup.
                  </p>
                </div>

                <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                  <button 
                    onClick={handleExportConfig}
                    type="button"
                    className="glass-button glass-button-secondary"
                    style={{ padding: '10px 20px', display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-glass)' }}
                  >
                    <Database size={16} style={{ color: 'var(--accent-cyan)' }} /> Export Backup (.json)
                  </button>

                  <div style={{ position: 'relative' }}>
                    <input 
                      type="file" 
                      accept=".json"
                      onChange={handleImportConfig}
                      style={{ display: 'none' }}
                      id="import-backup-file"
                      disabled={importingConfig}
                    />
                    <label 
                      htmlFor="import-backup-file"
                      className="glass-button"
                      style={{ 
                        padding: '10px 20px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer',
                        background: 'linear-gradient(135deg, var(--accent-cyan), var(--accent-blue))',
                        opacity: importingConfig ? 0.6 : 1, borderRadius: '8px', fontWeight: 'bold'
                      }}
                    >
                      <Database size={16} /> {importingConfig ? 'Importing...' : 'Import Backup (.json)'}
                    </label>
                  </div>
                </div>

                {backupLogs && (
                  <pre style={{
                    background: '#0a0d16', border: '1px solid var(--border-glass)',
                    borderRadius: '8px', padding: '12px', color: '#a7f3d0', fontFamily: 'monospace',
                    fontSize: '11px', overflowY: 'auto', whiteSpace: 'pre-wrap', maxHeight: '160px'
                  }}>
                    {backupLogs}
                  </pre>
                )}
              </div>

            </div>
          )}
        </section>

        {/* RIGHT COLUMN - SIDEBAR DETAILS PANEL */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          {/* WAN PORT BANDWIDTH CHART */}
          <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontSize: '15px' }}>WAN Bandwidth Monitor</h3>
                <p style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>{currentSiteName} (Internet Feed)</p>
              </div>
              <Activity size={18} style={{ color: 'var(--accent-blue)' }} />
            </div>

            {/* Custom SVG Traffic graph */}
            <div style={{ height: '160px', background: 'rgba(10, 13, 22, 0.4)', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.02)', padding: '6px', position: 'relative' }}>
              {chartPoints.length < 2 ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: '12px' }}>
                  Awaiting traffic readings...
                </div>
              ) : (
                <>
                  <svg width="100%" height="100%" viewBox={`0 0 ${svgDimensions.width} ${svgDimensions.height}`} preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="rxGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--accent-blue)" stopOpacity="0.25"/>
                        <stop offset="100%" stopColor="var(--accent-blue)" stopOpacity="0.0"/>
                      </linearGradient>
                      <linearGradient id="txGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--accent-violet)" stopOpacity="0.25"/>
                        <stop offset="100%" stopColor="var(--accent-violet)" stopOpacity="0.0"/>
                      </linearGradient>
                    </defs>

                    {/* Grids */}
                    <line x1="0" y1="40" x2={svgDimensions.width} y2="40" stroke="rgba(255,255,255,0.03)" strokeDasharray="3 3"/>
                    <line x1="0" y1="80" x2={svgDimensions.width} y2="80" stroke="rgba(255,255,255,0.03)" strokeDasharray="3 3"/>
                    <line x1="0" y1="120" x2={svgDimensions.width} y2="120" stroke="rgba(255,255,255,0.03)" strokeDasharray="3 3"/>

                    {/* Areas */}
                    <path d={chartPaths.rxArea} fill="url(#rxGrad)" />
                    <path d={chartPaths.txArea} fill="url(#txGrad)" />

                    {/* Lines */}
                    <path d={chartPaths.rxPath} fill="none" stroke="var(--accent-blue)" strokeWidth="2.5" />
                    <path d={chartPaths.txPath} fill="none" stroke="var(--accent-violet)" strokeWidth="2.5" />
                  </svg>
                  
                  {/* Legend Overlay */}
                  <div style={{ position: 'absolute', bottom: '8px', left: '12px', display: 'flex', gap: '12px', fontSize: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{ width: '8px', height: '8px', background: 'var(--accent-blue)', borderRadius: '2px' }} />
                      <span style={{ color: '#fff' }}>Incoming (Rx)</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{ width: '8px', height: '8px', background: 'var(--accent-violet)', borderRadius: '2px' }} />
                      <span style={{ color: '#fff' }}>Outgoing (Tx)</span>
                    </div>
                  </div>
                  
                  {/* Max label */}
                  <div style={{ position: 'absolute', top: '8px', right: '12px', fontSize: '9px', color: 'var(--text-muted)' }}>
                    Peak: {chartPaths.maxVal?.toFixed(1)} Mbps
                  </div>
                </>
              )}
            </div>

            {/* Current Rates */}
            {chartPoints.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '4px' }}>
                <div style={{ background: 'rgba(255,255,255,0.02)', padding: '10px', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <ArrowDownLeft style={{ color: 'var(--accent-blue)' }} size={20} />
                  <div>
                    <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>Download</div>
                    <div style={{ fontSize: '14px', fontWeight: '700', color: 'var(--accent-blue)' }}>
                      {chartPoints[chartPoints.length - 1].rxMbps.toFixed(2)} <span style={{ fontSize: '10px' }}>Mbps</span>
                    </div>
                  </div>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.02)', padding: '10px', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <ArrowUpRight style={{ color: 'var(--accent-violet)' }} size={20} />
                  <div>
                    <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>Upload</div>
                    <div style={{ fontSize: '14px', fontWeight: '700', color: 'var(--accent-violet)' }}>
                      {chartPoints[chartPoints.length - 1].txMbps.toFixed(2)} <span style={{ fontSize: '10px' }}>Mbps</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ISP & DNS HEALTH MONITOR (Proof of Concept) */}
          <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontSize: '15px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Globe size={18} style={{ color: ispHealth.online ? 'var(--accent-cyan)' : 'var(--accent-red)' }} />
                  <span>ISP & DNS Health</span>
                </h3>
                <p style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>External WAN Gateway Outage Monitor</p>
              </div>
              <span style={{ 
                fontSize: '10px', 
                background: ispHealth.online ? 'rgba(6, 182, 212, 0.15)' : 'rgba(239, 68, 68, 0.2)', 
                color: ispHealth.online ? 'var(--accent-cyan)' : 'var(--accent-red)', 
                padding: '2px 8px', 
                borderRadius: '20px', 
                fontWeight: '600' 
              }}>
                {ispHealth.online ? 'CONNECTED' : 'DISCONNECTED'}
              </span>
            </div>

            {/* Custom SVG Latency History Graph */}
            <div style={{ height: '110px', background: 'rgba(10, 13, 22, 0.4)', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.02)', padding: '6px', position: 'relative' }}>
              {ispHealthHistory.length < 2 ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: '11px' }}>
                  Awaiting gateway latency logs...
                </div>
              ) : (
                <>
                  <svg width="100%" height="100%" viewBox={`0 0 ${svgDimensions.width} ${svgDimensions.height}`} preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="pingGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--accent-cyan)" stopOpacity="0.15"/>
                        <stop offset="100%" stopColor="var(--accent-cyan)" stopOpacity="0.0"/>
                      </linearGradient>
                      <linearGradient id="dnsGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--accent-blue)" stopOpacity="0.15"/>
                        <stop offset="100%" stopColor="var(--accent-blue)" stopOpacity="0.0"/>
                      </linearGradient>
                    </defs>

                    {/* Grids */}
                    <line x1="0" y1="40" x2={svgDimensions.width} y2="40" stroke="rgba(255,255,255,0.03)" strokeDasharray="3 3"/>
                    <line x1="0" y1="80" x2={svgDimensions.width} y2="80" stroke="rgba(255,255,255,0.03)" strokeDasharray="3 3"/>
                    <line x1="0" y1="120" x2={svgDimensions.width} y2="120" stroke="rgba(255,255,255,0.03)" strokeDasharray="3 3"/>

                    {/* Areas */}
                    <path d={latencyChartPaths.pingArea} fill="url(#pingGrad)" />
                    <path d={latencyChartPaths.dnsArea} fill="url(#dnsGrad)" />

                    {/* Lines */}
                    <path d={latencyChartPaths.pingPath} fill="none" stroke="var(--accent-cyan)" strokeWidth="2.5" />
                    <path d={latencyChartPaths.dnsPath} fill="none" stroke="var(--accent-blue)" strokeWidth="2.5" />
                  </svg>
                  
                  {/* Legend Overlay */}
                  <div style={{ position: 'absolute', bottom: '6px', left: '10px', display: 'flex', gap: '10px', fontSize: '9px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <span style={{ width: '6px', height: '6px', background: 'var(--accent-cyan)', borderRadius: '2px' }} />
                      <span style={{ color: 'var(--text-secondary)' }}>Gateway Ping</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <span style={{ width: '6px', height: '6px', background: 'var(--accent-blue)', borderRadius: '2px' }} />
                      <span style={{ color: 'var(--text-secondary)' }}>DNS Lookup</span>
                    </div>
                  </div>
                  
                  {/* Max label */}
                  <div style={{ position: 'absolute', top: '6px', right: '10px', fontSize: '9px', color: 'var(--text-muted)' }}>
                    Peak: {latencyChartPaths.maxVal?.toFixed(0)} ms
                  </div>
                </>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {/* ISP Latency Row */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)', padding: '10px', borderRadius: '8px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: ispHealth.online ? 'var(--accent-cyan)' : 'var(--accent-red)' }} />
                  Gateway Ping (8.8.8.8)
                </span>
                <span style={{ fontSize: '13px', fontWeight: '700', color: ispHealth.online ? '#fff' : 'var(--text-muted)' }}>
                  {ispHealth.online ? `${ispHealth.latency} ms` : 'N/A'}
                </span>
              </div>

              {/* DNS Latency Row */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)', padding: '10px', borderRadius: '8px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: ispHealth.dns_online ? 'var(--accent-blue)' : 'var(--accent-red)' }} />
                  DNS Resolve (google.com)
                </span>
                <span style={{ fontSize: '13px', fontWeight: '700', color: ispHealth.dns_online ? '#fff' : 'var(--text-muted)' }}>
                  {ispHealth.dns_online ? `${ispHealth.dns_latency} ms` : 'Resolve Fail'}
                </span>
              </div>

              {/* Packet Loss Row */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)', padding: '10px', borderRadius: '8px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: ispHealth.packet_loss === 0 ? 'var(--accent-cyan)' : ispHealth.packet_loss < 100 ? 'var(--accent-amber)' : 'var(--accent-red)' }} />
                  Packet Loss
                </span>
                <span style={{ 
                  fontSize: '13px', 
                  fontWeight: '700', 
                  color: ispHealth.packet_loss === 0 ? 'var(--accent-cyan)' : ispHealth.packet_loss < 100 ? 'var(--accent-amber)' : 'var(--accent-red)'
                }}>
                  {ispHealth.packet_loss}%
                </span>
              </div>
            </div>
          </div>

          {/* ACTIVE ALERTS */}
          <div className="glass-card" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '16px', minHeight: '200px', maxHeight: '320px', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '15px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertTriangle size={18} style={{ color: alerts.length > 0 ? 'var(--accent-red)' : 'var(--text-muted)' }} />
                <span>Active Alerts ({alerts.length})</span>
              </h3>
              {alerts.length > 0 && (
                <span style={{ fontSize: '10px', background: 'rgba(239, 68, 68, 0.2)', color: 'var(--accent-red)', padding: '2px 8px', borderRadius: '20px', fontWeight: '700' }}>
                  ALERT
                </span>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', flex: 1 }}>
              {alerts.length === 0 ? (
                <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
                  No outstanding alerts. All links green!
                </div>
              ) : (
                alerts.map(alert => {
                  const isSecurity = alert.deviceName.toLowerCase().includes('security') || alert.deviceName.toLowerCase().includes('guard');
                  return (
                    <div key={alert.id} className={`alert-toast ${alert.severity}`}>
                      {isSecurity ? (
                        <Shield size={16} style={{ color: 'var(--accent-red)', marginTop: '2px', flexShrink: 0 }} />
                      ) : (
                        <AlertTriangle size={16} style={{ color: alert.severity === 'critical' ? 'var(--accent-red)' : 'var(--accent-amber)', marginTop: '2px', flexShrink: 0 }} />
                      )}
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '11px', fontWeight: '700', color: '#fff' }}>{alert.deviceName}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>{alert.message}</div>
                        <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '4px' }}>
                          {new Date(alert.timestamp).toLocaleTimeString()}
                        </div>
                      </div>
                      <button 
                        onClick={() => handleDismissAlert(alert.id)}
                        style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '2px' }}
                        title="Acknowledge Alert"
                      >
                        <X size={14} className="hover:text-white" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* PRINTER TONER DETAILS */}
          {printers.length > 0 && (
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <h3 style={{ fontSize: '15px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Printer size={18} style={{ color: 'var(--accent-amber)' }} />
                <span>Printer Ink & Consumables</span>
              </h3>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {printers.map(p => {
                  const toner = p.toner_levels || { black: 80, color: 60 };
                  const dashOffsetBlack = 2 * Math.PI * 18 * (1 - toner.black / 100);
                  const dashOffsetColor = 2 * Math.PI * 18 * (1 - toner.color / 100);

                  return (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px', background: 'rgba(255,255,255,0.02)', borderRadius: '10px' }}>
                      <div>
                        <div style={{ fontSize: '12px', fontWeight: '600' }}>{p.friendly_name}</div>
                        <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '2px' }}>Page Count: {p.page_count || 1420}</div>
                        <div style={{ fontSize: '10px', color: toner.black < 10 ? 'var(--accent-red)' : 'var(--text-muted)' }}>
                          Status: {p.paper_status || 'OK'}
                        </div>
                      </div>
                      
                      {/* Ink percentage wheels */}
                      <div style={{ display: 'flex', gap: '12px' }}>
                        {/* Black Toner */}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                          <div className="ink-ring">
                            <svg>
                              <circle className="bg" cx="21" cy="21" r="18" />
                              <circle className="val" cx="21" cy="21" r="18" 
                                      style={{ strokeDasharray: 2 * Math.PI * 18, strokeDashoffset: dashOffsetBlack, stroke: '#1e293b' }} 
                              />
                            </svg>
                            <span style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', fontSize: '9px', fontWeight: '700' }}>
                              K
                            </span>
                          </div>
                          <span style={{ fontSize: '9px', color: 'var(--text-secondary)', marginTop: '4px' }}>{toner.black}%</span>
                        </div>

                        {/* Color Toner */}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                          <div className="ink-ring">
                            <svg>
                              <circle className="bg" cx="21" cy="21" r="18" />
                              <circle className="val" cx="21" cy="21" r="18" 
                                      style={{ strokeDasharray: 2 * Math.PI * 18, strokeDashoffset: dashOffsetColor, stroke: 'var(--accent-amber)' }} 
                              />
                            </svg>
                            <span style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', fontSize: '9px', fontWeight: '700', color: 'var(--accent-amber)' }}>
                              CMY
                            </span>
                          </div>
                          <span style={{ fontSize: '9px', color: 'var(--text-secondary)', marginTop: '4px' }}>{toner.color}%</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </aside>
      </main>

      {/* FOOTER */}
      <footer style={{ borderTop: '1px solid var(--border-glass)', padding: '16px 32px', display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)' }}>
        <div>Created with Antigravity IDE • Surabaya IT Ops Dashboard Client</div>
        <div>RouterOS v7.15.2 Integration • SNMP Poller Engine Active</div>
      </footer>

      {/* MODAL 1: EDIT DEVICE METADATA */}
      {editingDevice && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div className="glass-card" style={{ width: '450px', background: 'var(--bg-secondary)', border: '1px solid rgba(255,255,255,0.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-glass)', paddingBottom: '12px', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '16px' }}>Edit Network Asset</h3>
              <button onClick={() => setEditingDevice(null)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>
            
            <form onSubmit={handleSaveDevice} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              
              {/* Friendly Name */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Friendly Name</label>
                <input 
                  type="text" 
                  value={editingDevice.friendly_name}
                  onChange={(e) => setEditingDevice({ ...editingDevice, friendly_name: e.target.value })}
                  className="glass-input"
                  required
                />
              </div>

              {/* IP / MAC Info (Read Only) */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>IP Address</span>
                  <span className="font-mono" style={{ fontSize: '13px' }}>{editingDevice.current_ip}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>MAC Address</span>
                  <span className="font-mono" style={{ fontSize: '13px' }}>{editingDevice.mac_address}</span>
                </div>
              </div>

              {/* Type Select */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Device Type</label>
                <select 
                  value={editingDevice.type}
                  onChange={(e) => setEditingDevice({ ...editingDevice, type: e.target.value })}
                  className="glass-input"
                  style={{ background: 'var(--bg-tertiary)' }}
                >
                  <option value="pc">PC / Laptop</option>
                  <option value="phone">Phone / Handphone</option>
                  <option value="printer">Printer</option>
                  <option value="ap">Access Point</option>
                  <option value="switch">Switch</option>
                  <option value="router">Router</option>
                  <option value="attendance_machine">Attendance Machine</option>
                  <option value="other">Other</option>
                  <option value="unclassified">Unclassified</option>
                </select>
              </div>

              {/* Location/Dept */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Location / Department</label>
                <input 
                  type="text" 
                  value={editingDevice.location_dept || ''}
                  onChange={(e) => setEditingDevice({ ...editingDevice, location_dept: e.target.value })}
                  placeholder="e.g. HRD, Kasir Ops, Floor 2"
                  className="glass-input"
                />
              </div>

              {/* Asset Tag */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Asset Tag</label>
                <input 
                  type="text" 
                  value={editingDevice.asset_tag || ''}
                  onChange={(e) => setEditingDevice({ ...editingDevice, asset_tag: e.target.value })}
                  placeholder="e.g. ASSET-2026-0042"
                  className="glass-input"
                />
              </div>

              {/* Notes */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Notes</label>
                <textarea 
                  value={editingDevice.notes || ''}
                  onChange={(e) => setEditingDevice({ ...editingDevice, notes: e.target.value })}
                  rows={3}
                  className="glass-input"
                  style={{ resize: 'none' }}
                />
              </div>

              {/* Form buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', borderTop: '1px solid var(--border-glass)', paddingTop: '16px', marginTop: '8px' }}>
                <button type="button" onClick={() => setEditingDevice(null)} className="glass-button glass-button-secondary">
                  Cancel
                </button>
                <button type="submit" className="glass-button">
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: ADD NEW SITE */}
      {showAddSiteModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div className="glass-card" style={{ width: '450px', background: 'var(--bg-secondary)', border: '1px solid rgba(255,255,255,0.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-glass)', paddingBottom: '12px', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '16px' }}>Add New Office Site</h3>
              <button onClick={() => setShowAddSiteModal(false)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>
            
            <form onSubmit={handleAddSite} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              
              {/* Site Name */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Site Name</label>
                <input 
                  type="text" 
                  placeholder="e.g. Jakarta HQ, Bali Branch"
                  value={newSiteName}
                  onChange={(e) => setNewSiteName(e.target.value)}
                  className="glass-input"
                  required
                />
              </div>

              {/* CIDR Range */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Network CIDR Range</label>
                <input 
                  type="text" 
                  placeholder="e.g. 192.168.2.0/24"
                  value={newSiteCidr}
                  onChange={(e) => setNewSiteCidr(e.target.value)}
                  className="glass-input"
                  required
                />
              </div>

              {/* Notes */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Location / Address Notes</label>
                <textarea 
                  value={newSiteNotes}
                  onChange={(e) => setNewSiteNotes(e.target.value)}
                  placeholder="Street address or router model information..."
                  rows={3}
                  className="glass-input"
                  style={{ resize: 'none' }}
                />
              </div>

              {/* Form buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', borderTop: '1px solid var(--border-glass)', paddingTop: '16px', marginTop: '8px' }}>
                <button type="button" onClick={() => setShowAddSiteModal(false)} className="glass-button glass-button-secondary">
                  Cancel
                </button>
                <button type="submit" className="glass-button">
                  Create Site
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
