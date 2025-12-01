/**
 * UTMify → Monday.com Integration Script
 *
 * Syncs daily metrics from UTMify dashboards to Monday.com sub-items
 *
 * Usage:
 *   node utmify_monday_sync.js --dashboard "Dashboard Name" --days 7
 *
 * Environment variables:
 *   UTMIFY_EMAIL - UTMify login email
 *   UTMIFY_PASSWORD - UTMify login password
 *   MONDAY_API_KEY - Monday.com API key
 *   MONDAY_BOARD_ID - Monday.com board ID (default: 18282099872)
 */

const https = require('https');

// Configuration
const CONFIG = {
  utmify: {
    email: process.env.UTMIFY_EMAIL || 'contatolc01@proton.me',
    password: process.env.UTMIFY_PASSWORD || '!Usuariomp1',
    serverUrl: 'server.utmify.com.br'
  },
  monday: {
    apiKey: process.env.MONDAY_API_KEY || '',
    boardId: process.env.MONDAY_BOARD_ID || '18282099872',
    // Column mappings: UTMify metric -> Monday column ID
    columns: {
      date: 'date0',
      gasto: 'numeric_mky1cd8d',      // gastoAds
      faturado: 'numeric_mky1hegz',    // receitaLiquida
      conversoes: 'numeric_mky11r84'   // pedidosAprovados
    }
  }
};

// Dashboard to Monday Item mappings
const DASHBOARD_ITEM_MAP = {
  'Maria Clara': { itemId: '18294458473', dashboardId: null }, // dashboardId will be fetched
  // Add more mappings as needed
};

// ═══════════════════════════════════════════════════════════════════════════
// HTTP Utilities
// ═══════════════════════════════════════════════════════════════════════════

function httpsRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Request timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// UTMify API
// ═══════════════════════════════════════════════════════════════════════════

class UTMifyAPI {
  constructor(email, password) {
    this.email = email;
    this.password = password;
    this.token = null;
  }

  async login() {
    const basicAuth = Buffer.from(`${this.email}:${this.password}`).toString('base64');

    const result = await httpsRequest({
      hostname: CONFIG.utmify.serverUrl,
      port: 443,
      path: '/users/auth',
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Basic ${basicAuth}`,
        'Origin': 'https://app.utmify.com.br'
      }
    });

    if (result.status !== 200 || !result.data?.auth?.token) {
      throw new Error(`UTMify login failed: ${JSON.stringify(result.data)}`);
    }

    this.token = result.data.auth.token;
    console.log('✅ UTMify login successful');
    return result.data;
  }

  async getDashboards() {
    const result = await httpsRequest({
      hostname: CONFIG.utmify.serverUrl,
      port: 443,
      path: '/dashboards',
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${this.token}`
      }
    });

    if (result.status !== 200) {
      throw new Error(`Failed to get dashboards: ${JSON.stringify(result.data)}`);
    }

    return result.data;
  }

  async getDashboardMetrics(dashboardId, dateFrom, dateTo) {
    const result = await httpsRequest({
      hostname: CONFIG.utmify.serverUrl,
      port: 443,
      path: '/orders/dashboard-info',
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`
      }
    }, {
      dashboardId,
      dateRange: { from: dateFrom, to: dateTo },
      screenSize: 'xl',
      resumoItems: [{ type: 'ApprovalRate' }]
    });

    if (result.status !== 200) {
      throw new Error(`Failed to get metrics: ${JSON.stringify(result.data)}`);
    }

    return result.data;
  }

  async getDailyMetrics(dashboardId, days = 7) {
    const dailyData = [];
    const today = new Date();

    for (let i = 0; i < days; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);

      const dateStr = date.toISOString().split('T')[0];
      const fromDate = `${dateStr}T00:00:00.000Z`;
      const toDate = `${dateStr}T23:59:59.999Z`;

      try {
        const metrics = await this.getDashboardMetrics(dashboardId, fromDate, toDate);

        dailyData.push({
          date: dateStr,
          gastoAds: metrics.gastoAds || 0,
          receitaLiquida: metrics.receitaLiquida || 0,
          pedidosAprovados: metrics.pedidosAprovados || 0
        });

        console.log(`  📊 ${dateStr}: Gasto=${metrics.gastoAds?.toFixed(2) || 0}, Faturado=${metrics.receitaLiquida?.toFixed(2) || 0}, Conversões=${metrics.pedidosAprovados || 0}`);
      } catch (e) {
        console.log(`  ⚠️ ${dateStr}: Error - ${e.message}`);
      }

      // Rate limiting
      await new Promise(r => setTimeout(r, 200));
    }

    return dailyData;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Monday.com API
// ═══════════════════════════════════════════════════════════════════════════

class MondayAPI {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  async graphql(query, variables = {}) {
    const result = await httpsRequest({
      hostname: 'api.monday.com',
      port: 443,
      path: '/v2',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': this.apiKey,
        'API-Version': '2024-10'
      }
    }, { query, variables });

    if (result.data?.errors) {
      throw new Error(`Monday API error: ${JSON.stringify(result.data.errors)}`);
    }

    return result.data;
  }

  async getSubItems(parentItemId) {
    const query = `
      query ($itemId: [ID!]) {
        items(ids: $itemId) {
          subitems {
            id
            name
            column_values {
              id
              text
            }
          }
        }
      }
    `;

    const result = await this.graphql(query, { itemId: [parentItemId] });
    return result?.data?.items?.[0]?.subitems || [];
  }

  async createSubItem(parentItemId, name, columnValues) {
    const query = `
      mutation ($parentId: ID!, $name: String!, $columns: JSON!) {
        create_subitem(
          parent_item_id: $parentId,
          item_name: $name,
          column_values: $columns
        ) {
          id
        }
      }
    `;

    const result = await this.graphql(query, {
      parentId: parentItemId,
      name: name,
      columns: JSON.stringify(columnValues)
    });

    return result?.data?.create_subitem?.id;
  }

  async updateSubItem(subitemId, columnValues) {
    const query = `
      mutation ($itemId: ID!, $boardId: ID!, $columns: JSON!) {
        change_multiple_column_values(
          item_id: $itemId,
          board_id: $boardId,
          column_values: $columns
        ) {
          id
        }
      }
    `;

    // Get subitem board ID first
    const boardQuery = `
      query ($itemId: [ID!]) {
        items(ids: $itemId) {
          board { id }
        }
      }
    `;

    const boardResult = await this.graphql(boardQuery, { itemId: [subitemId] });
    const boardId = boardResult?.data?.items?.[0]?.board?.id;

    if (!boardId) {
      throw new Error(`Could not find board for subitem ${subitemId}`);
    }

    const result = await this.graphql(query, {
      itemId: subitemId,
      boardId: boardId,
      columns: JSON.stringify(columnValues)
    });

    return result?.data?.change_multiple_column_values?.id;
  }

  async syncDailyMetrics(parentItemId, dailyData) {
    console.log(`\n📤 Syncing ${dailyData.length} days to Monday.com...`);

    // Get existing subitems
    const existingSubitems = await this.getSubItems(parentItemId);
    const existingByDate = {};

    for (const sub of existingSubitems) {
      const dateCol = sub.column_values.find(c => c.id === CONFIG.monday.columns.date);
      if (dateCol?.text) {
        existingByDate[dateCol.text] = sub.id;
      }
    }

    for (const day of dailyData) {
      const columnValues = {
        [CONFIG.monday.columns.date]: { date: day.date },
        [CONFIG.monday.columns.gasto]: day.gastoAds.toString(),
        [CONFIG.monday.columns.faturado]: day.receitaLiquida.toString(),
        [CONFIG.monday.columns.conversoes]: day.pedidosAprovados.toString()
      };

      // Format date for display (DD/MM/YYYY)
      const displayDate = day.date.split('-').reverse().join('/');

      if (existingByDate[day.date]) {
        // Update existing
        await this.updateSubItem(existingByDate[day.date], columnValues);
        console.log(`  ✏️ Updated: ${displayDate}`);
      } else {
        // Create new
        await this.createSubItem(parentItemId, displayDate, columnValues);
        console.log(`  ➕ Created: ${displayDate}`);
      }

      await new Promise(r => setTimeout(r, 100)); // Rate limiting
    }

    console.log('✅ Monday sync complete');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Execution
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  // Parse command line args
  const args = process.argv.slice(2);
  const dashboardName = args.find((a, i) => args[i-1] === '--dashboard') || 'Maria Clara';
  const days = parseInt(args.find((a, i) => args[i-1] === '--days') || '7');

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║          UTMify → Monday.com Sync                           ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`\nDashboard: ${dashboardName}`);
  console.log(`Days: ${days}\n`);

  // Validate config
  if (!CONFIG.monday.apiKey) {
    console.error('❌ MONDAY_API_KEY environment variable is required');
    console.log('\nUsage: MONDAY_API_KEY=your_key node utmify_monday_sync.js --dashboard "Maria Clara" --days 7');
    process.exit(1);
  }

  // Initialize APIs
  const utmify = new UTMifyAPI(CONFIG.utmify.email, CONFIG.utmify.password);
  const monday = new MondayAPI(CONFIG.monday.apiKey);

  try {
    // 1. Login to UTMify
    console.log('🔐 Logging in to UTMify...');
    await utmify.login();

    // 2. Get dashboards and find matching one
    console.log('📊 Fetching dashboards...');
    const dashboards = await utmify.getDashboards();

    const dashboard = dashboards.find(d =>
      d.name?.toLowerCase().includes(dashboardName.toLowerCase())
    );

    if (!dashboard) {
      console.error(`❌ Dashboard "${dashboardName}" not found`);
      console.log('Available dashboards:');
      dashboards.forEach(d => console.log(`  - ${d.name}`));
      process.exit(1);
    }

    console.log(`✅ Found dashboard: ${dashboard.name} (${dashboard._id})`);

    // 3. Get daily metrics from UTMify
    console.log(`\n📈 Fetching ${days} days of metrics...`);
    const dailyMetrics = await utmify.getDailyMetrics(dashboard._id, days);

    // 4. Get Monday item mapping
    const mapping = DASHBOARD_ITEM_MAP[dashboardName];
    if (!mapping) {
      console.error(`❌ No Monday.com mapping found for "${dashboardName}"`);
      console.log('Add mapping to DASHBOARD_ITEM_MAP in the script');
      process.exit(1);
    }

    // 5. Sync to Monday.com
    await monday.syncDailyMetrics(mapping.itemId, dailyMetrics);

    console.log('\n🎉 Sync completed successfully!');

  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    process.exit(1);
  }
}

// Run
main().catch(console.error);
