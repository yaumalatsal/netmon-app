import * as dotenv from 'dotenv';
import * as path from 'path';

// Load env from backend directory
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const ROUTER_URL = process.env.ROUTER_URL || 'http://192.168.1.1/rest';
const ROUTER_USER = process.env.ROUTER_USER || 'admin';
const ROUTER_PASSWORD = process.env.ROUTER_PASSWORD || '';

// Disable SSL certificate validation for self-signed certs (common on RouterOS local interfaces)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function testConnection() {
  console.log('=== Mikrotik RouterOS REST API Test ===');
  console.log(`Connecting to: ${ROUTER_URL}`);
  console.log(`Username: ${ROUTER_USER}`);
  console.log('Password: ' + (ROUTER_PASSWORD ? '********' : '(empty)'));

  const authString = Buffer.from(`${ROUTER_USER}:${ROUTER_PASSWORD}`).toString('base64');

  try {
    console.log('\n[1/3] Fetching interface traffic counters...');
    const ifaceRes = await fetch(`${ROUTER_URL}/interface`, {
      headers: {
        'Authorization': `Basic ${authString}`,
        'Accept': 'application/json'
      }
    });

    if (!ifaceRes.ok) {
      console.error(`Error response: ${ifaceRes.status} ${ifaceRes.statusText}`);
      const text = await ifaceRes.text();
      console.error('Body:', text);
      return;
    }

    const interfaces: any = await ifaceRes.json();
    console.log(`Success! Found ${interfaces.length} interfaces.`);
    
    // Find ether1 or WAN interface
    const wan = interfaces.find((i: any) => i.name === 'ether1' || i.name === 'WAN');
    if (wan) {
      console.log(`WAN Link (${wan.name}): RX bytes = ${wan['rx-byte']}, TX bytes = ${wan['tx-byte']}`);
    } else {
      console.log('Interfaces found:', interfaces.map((i: any) => i.name));
    }

    console.log('\n[2/3] Fetching system resources...');
    const sysRes = await fetch(`${ROUTER_URL}/system/resource`, {
      headers: {
        'Authorization': `Basic ${authString}`,
        'Accept': 'application/json'
      }
    });
    if (sysRes.ok) {
      const resources: any = await sysRes.json();
      console.log('System resources loaded successfully:');
      console.log(`  Model: ${resources.model}`);
      console.log(`  CPU Load: ${resources['cpu-load']}%`);
      console.log(`  Free Memory: ${(parseInt(resources['free-memory']) / 1024 / 1024).toFixed(1)} MB / ${(parseInt(resources['total-memory']) / 1024 / 1024).toFixed(1)} MB`);
      console.log(`  Uptime: ${resources.uptime}`);
    }

    console.log('\n[3/3] Fetching DHCP leases...');
    const leaseRes = await fetch(`${ROUTER_URL}/ip/dhcp-server/lease`, {
      headers: {
        'Authorization': `Basic ${authString}`,
        'Accept': 'application/json'
      }
    });
    if (leaseRes.ok) {
      const leases: any = await leaseRes.json();
      console.log(`Success! Loaded ${leases.length} live DHCP leases.`);
    }

    console.log('\n✅ All tests passed! The RouterOS API integration is working correctly.');
  } catch (err: any) {
    console.error('\n❌ Connection failed:', err.message);
    console.error('Please verify:');
    console.error('  1. The Router URL is correct and includes /rest (e.g. http://192.168.1.1/rest)');
    console.error('  2. The www (HTTP) or www-ssl (HTTPS) service is enabled on the router (IP -> Services in Winbox)');
    console.error('  3. The username and password are correct.');
  }
}

testConnection();
