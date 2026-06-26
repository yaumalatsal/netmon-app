import * as fs from 'fs';
import * as path from 'path';
import { initDb, query } from './db/db';
import * as dotenv from 'dotenv';

dotenv.config();

function parseRscFile(filePath: string) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const rawLines = content.split(/\r?\n/);
  const consolidatedLines: string[] = [];

  // Consolidate lines ending with backslash \
  let currentLine = '';
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (line.endsWith('\\')) {
      currentLine += line.slice(0, -1).trim() + ' ';
    } else {
      currentLine += line.trim();
      consolidatedLines.push(currentLine);
      currentLine = '';
    }
  }

  const leases: Array<{ ip: string; mac: string; comment: string }> = [];
  let currentSection = '';

  for (const line of consolidatedLines) {
    if (line.startsWith('/')) {
      // Clean section name (e.g., "/ip dhcp-server lease")
      currentSection = line.trim().split(' ')[0] + ' ' + (line.trim().split(' ')[1] || '') + ' ' + (line.trim().split(' ')[2] || '');
      currentSection = currentSection.trim();
      continue;
    }

    if (currentSection.startsWith('/ip dhcp-server lease') && line.startsWith('add ')) {
      // Parse key-value attributes from the lease configuration line
      // RouterOS format: key=value or key="value"
      // RegEx handles double-quoted strings with spaces
      const parseValue = (key: string): string => {
        const regex = new RegExp(`${key}=(?:"([^"]*)"|([^ ]*))`);
        const match = line.match(regex);
        if (match) {
          return match[1] !== undefined ? match[1] : match[2];
        }
        return '';
      };

      const ip = parseValue('address');
      const mac = parseValue('mac-address');
      const comment = parseValue('comment');

      if (ip && mac) {
        leases.push({ ip, mac: mac.toUpperCase(), comment });
      }
    }
  }

  return leases;
}

function inferDeviceType(comment: string): string {
  const c = comment.toLowerCase();
  
  // Note: in this config, "HP" means handphone (mobile), not Hewlett-Packard printer
  // Check printer first to avoid misclassifying a printer that might have both keywords
  if (c.includes('printer')) return 'printer';
  if (c.includes('pc') || c.includes('laptop') || c.includes('komputer') || c.includes('desktop')) return 'pc';
  if (c.includes('hp') || c.includes('handphone') || c.includes('phone') || c.includes('mobile')) return 'phone';
  if (c.includes('ap') || c.includes('access point') || c.includes('wifi') || c.includes('controller')) return 'ap';
  if (c.includes('mesin absen') || c.includes('absen') || c.includes('attendance')) return 'attendance_machine';
  if (c.includes('switch') || c.includes('router') || c.includes('hub')) return 'switch';

  return 'unclassified';
}

export async function runSeeder(filePath: string) {
  console.log(`Seeding database from: ${filePath}`);
  
  await initDb();

  // 1. Create or verify the Surabaya Office site
  const existingSites = await query("SELECT id FROM sites WHERE name = $1", ["Surabaya Office"]);
  let siteId: number;

  if (existingSites.length > 0) {
    siteId = existingSites[0].id;
    console.log(`Found existing site: Surabaya Office (ID: ${siteId})`);
  } else {
    const result = await query(
      "INSERT INTO sites (name, network_cidr, address_notes) VALUES ($1, $2, $3) RETURNING id",
      ["Surabaya Office", "192.168.1.0/24", "Main Branch Office"]
    );
    // Handle both pg (returning id) and sqlite3 (returning {lastID})
    siteId = result[0]?.id || result.lastID;
    console.log(`Created new site: Surabaya Office (ID: ${siteId})`);
  }

  // 2. Parse leases
  const leases = parseRscFile(filePath);
  console.log(`Parsed ${leases.length} lease entries from config file.`);

  let seededCount = 0;
  let updatedCount = 0;

  for (const lease of leases) {
    const friendlyName = lease.comment || 'Unnamed Device';
    const type = inferDeviceType(friendlyName);

    // Try to insert device. If MAC address exists, update current IP and friendly name
    try {
      const existing = await query("SELECT id FROM devices WHERE mac_address = $1", [lease.mac]);
      if (existing.length > 0) {
        await query(
          "UPDATE devices SET current_ip = $1, friendly_name = $2, type = $3, last_seen = CURRENT_TIMESTAMP WHERE id = $4",
          [lease.ip, friendlyName, type, existing[0].id]
        );
        updatedCount++;
      } else {
        await query(
          "INSERT INTO devices (site_id, friendly_name, type, mac_address, current_ip, source) VALUES ($1, $2, $3, $4, $5, $6)",
          [siteId, friendlyName, type, lease.mac, lease.ip, 'seeded_from_config']
        );
        seededCount++;
      }
    } catch (err) {
      console.error(`Failed to seed lease IP ${lease.ip} MAC ${lease.mac}:`, err);
    }
  }

  console.log(`Seed complete! Seeded: ${seededCount}, Updated: ${updatedCount} devices.`);
}

// If run directly from CLI
if (require.main === module) {
  // Use nama_file_config.rsc by default
  const defaultPath = path.resolve('C:\\Users\\ASUS\\Downloads\\nama_file_config.rsc');
  const targetPath = process.argv[2] || defaultPath;
  
  runSeeder(targetPath)
    .then(() => {
      console.log('Seeder process exited successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Seeder process crashed:', err);
      process.exit(1);
    });
}
