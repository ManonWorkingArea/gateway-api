/**
 * MongoDB Connection Auditor
 * 
 * Instruments every MongoClient creation to verify:
 * - maxPoolSize is applied at runtime
 * - Pool deduplication (only ONE client per process)
 * - Stack trace at creation point
 */

const clients = [];

function auditMongoClient(serviceName, fileName, options) {
  const entry = {
    pid: process.pid,
    instanceId: process.env.GAE_INSTANCE || process.env.INSTANCE_ID || 'unknown',
    service: serviceName,
    file: fileName,
    maxPoolSize: options.maxPoolSize || '(default)',
    minPoolSize: options.minPoolSize || '(default)',
    options: { ...options },
    stack: new Error().stack.split('\n').slice(2, 7).map(s => s.trim()).join('\n  '),
    timestamp: new Date().toISOString()
  };

  clients.push(entry);

  console.log(`\n══════════════════════════════════════════════════════`);
  console.log(`🔌 [MONGO-AUDIT] MongoClient CREATED`);
  console.log(`   pid:        ${entry.pid}`);
  console.log(`   instance:   ${entry.instanceId}`);
  console.log(`   service:    ${entry.service}`);
  console.log(`   file:       ${entry.file}`);
  console.log(`   maxPoolSize: ${entry.maxPoolSize}`);
  console.log(`   minPoolSize: ${entry.minPoolSize}`);
  console.log(`   total clients in process: ${clients.length}`);
  console.log(`   stack:`);
  console.log(`  ${entry.stack}`);
  console.log(`══════════════════════════════════════════════════════\n`);

  // Report if multiple clients detected
  if (clients.length > 1) {
    console.error(`\n🔴🔴🔴 [MONGO-AUDIT] WARNING: ${clients.length} MongoClient instances detected in process ${process.pid}! 🔴🔴🔴`);
    clients.forEach((c, i) => {
      console.error(`  [${i + 1}] ${c.service} @ ${c.file} — pool=${c.maxPoolSize}`);
    });
    console.error(`  This means ${clients.reduce((sum, c) => sum + (c.maxPoolSize === '(default)' ? 100 : c.maxPoolSize), 0)} total connections per process.\n`);
  }

  return entry;
}

function getAuditReport() {
  return {
    pid: process.pid,
    totalClients: clients.length,
    totalConnections: clients.reduce((sum, c) => {
      const pool = c.maxPoolSize === '(default)' ? 100 : c.maxPoolSize;
      return sum + pool;
    }, 0),
    clients
  };
}

// Express endpoint to view audit report
function auditMiddleware(req, res) {
  res.json(getAuditReport());
}

module.exports = { auditMongoClient, getAuditReport, auditMiddleware };
