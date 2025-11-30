/**
 * Discover UTMify API endpoints from JavaScript bundles
 */

const https = require('https');
const tunnel = require('tunnel');
const { URL } = require('url');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Setup proxy
const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;
let agent = null;

if (proxyUrl) {
  const parsed = new URL(proxyUrl);
  agent = tunnel.httpsOverHttp({
    proxy: {
      host: parsed.hostname,
      port: parseInt(parsed.port),
      proxyAuth: parsed.username ? `${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}` : undefined
    },
    rejectUnauthorized: false
  });
}

async function fetch(url, retries = 5) {
  for (let i = 0; i < retries; i++) {
    try {
      const result = await new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const req = https.request({
          hostname: parsedUrl.hostname,
          port: 443,
          path: parsedUrl.pathname + parsedUrl.search,
          method: 'GET',
          agent,
          rejectUnauthorized: false,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': '*/*'
          }
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => resolve({ status: res.statusCode, body: data }));
        });
        req.on('error', reject);
        req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); });
        req.end();
      });

      if (!result.body.includes('TLS_error')) {
        return result;
      }
    } catch (e) {
      if (i === retries - 1) throw e;
    }
    await new Promise(r => setTimeout(r, 1000));
  }
}

async function main() {
  console.log('=== UTMify API Endpoint Discovery ===\n');

  // Fetch login page to get JS file list
  console.log('1. Fetching login page...');
  const loginPage = await fetch('https://app.utmify.com.br/login/');
  console.log(`   Status: ${loginPage.status}, Length: ${loginPage.body.length}`);

  // Extract JS files
  const jsFiles = [...new Set(loginPage.body.match(/_app\/immutable\/[^"'> ]+\.js/g) || [])];
  console.log(`   Found ${jsFiles.length} JS files\n`);

  // Also look for chunk imports in the entry files
  const allEndpoints = new Set();
  const allChunks = new Set(jsFiles);

  // Fetch entry files and find more chunks
  console.log('2. Fetching entry files and discovering chunks...');
  for (const jsFile of jsFiles.slice(0, 2)) {
    try {
      const content = await fetch(`https://app.utmify.com.br/${jsFile}`);
      // Find more chunk imports
      const chunks = content.body.match(/chunks\/[^"']+\.js/g) || [];
      chunks.forEach(c => allChunks.add(`_app/immutable/${c}`));
    } catch (e) {
      console.log(`   Error fetching ${jsFile}: ${e.message}`);
    }
  }

  console.log(`   Total chunks to analyze: ${allChunks.size}\n`);

  // Analyze each chunk for API endpoints
  console.log('3. Analyzing chunks for API endpoints...\n');

  for (const chunk of allChunks) {
    try {
      const content = await fetch(`https://app.utmify.com.br/${chunk}`);

      // Search for various API patterns
      const patterns = [
        // Direct API paths
        /["'](\/[a-z]+\/[a-z0-9\/_-]+)["']/gi,
        // Fetch/axios calls
        /(?:get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/gi,
        // API configuration
        /api[._]?(?:url|endpoint|path)\s*[:=]\s*["'`]([^"'`]+)["'`]/gi
      ];

      const endpoints = new Set();

      for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(content.body)) !== null) {
          const path = match[1];
          // Filter to likely API endpoints
          if (path &&
              path.startsWith('/') &&
              !path.includes('.js') &&
              !path.includes('.css') &&
              !path.includes('.svg') &&
              !path.includes('.png') &&
              !path.includes('node_modules') &&
              path.length > 2 &&
              path.length < 100) {
            endpoints.add(path);
          }
        }
      }

      if (endpoints.size > 0) {
        console.log(`📁 ${chunk.split('/').pop()}:`);
        [...endpoints].sort().forEach(ep => {
          console.log(`   ${ep}`);
          allEndpoints.add(ep);
        });
        console.log('');
      }
    } catch (e) {
      // Skip failed fetches
    }
  }

  // Summary
  console.log('\n=== SUMMARY: All discovered endpoints ===\n');
  const sorted = [...allEndpoints].sort();

  // Group by category
  const categories = {
    'Users/Auth': sorted.filter(e => e.includes('user') || e.includes('auth') || e.includes('login')),
    'Dashboard': sorted.filter(e => e.includes('dashboard')),
    'Analytics/Stats': sorted.filter(e => e.includes('stat') || e.includes('analytic') || e.includes('metric')),
    'Campaigns/UTM': sorted.filter(e => e.includes('campaign') || e.includes('utm') || e.includes('pixel')),
    'Reports/Export': sorted.filter(e => e.includes('report') || e.includes('export') || e.includes('download')),
    'Settings': sorted.filter(e => e.includes('setting') || e.includes('config')),
    'Other': sorted.filter(e =>
      !e.includes('user') && !e.includes('auth') && !e.includes('login') &&
      !e.includes('dashboard') && !e.includes('stat') && !e.includes('analytic') &&
      !e.includes('campaign') && !e.includes('utm') && !e.includes('pixel') &&
      !e.includes('report') && !e.includes('export') && !e.includes('setting') &&
      !e.includes('config') && !e.includes('metric') && !e.includes('download')
    )
  };

  for (const [category, endpoints] of Object.entries(categories)) {
    if (endpoints.length > 0) {
      console.log(`📂 ${category}:`);
      endpoints.forEach(ep => console.log(`   ${ep}`));
      console.log('');
    }
  }

  console.log(`\n✅ Total unique endpoints found: ${allEndpoints.size}`);
}

main().catch(console.error);
