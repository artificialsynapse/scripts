const https = require('https');
const tunnel = require('tunnel');
const { URL } = require('url');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const proxyUrl = process.env.HTTPS_PROXY;
const parsed = new URL(proxyUrl);
const agent = tunnel.httpsOverHttp({
  proxy: {
    host: parsed.hostname,
    port: parseInt(parsed.port),
    proxyAuth: `${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}`
  },
  rejectUnauthorized: false
});

async function fetch(url) {
  for (let i = 0; i < 5; i++) {
    try {
      const result = await new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const req = https.request({
          hostname: parsedUrl.hostname,
          port: 443,
          path: parsedUrl.pathname,
          method: 'GET',
          agent,
          rejectUnauthorized: false
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => resolve(data));
        });
        req.on('error', reject);
        req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); });
        req.end();
      });
      if (!result.includes('TLS_error')) return result;
    } catch (e) {}
    await new Promise(r => setTimeout(r, 1000));
  }
  return '';
}

async function main() {
  console.log('=== Detailed Orders/Data API Analysis ===\n');

  // Analyze GetOrdersFiltersAction
  console.log('📊 Analyzing GetOrdersFiltersAction.js...');
  const ordersContent = await fetch('https://app.utmify.com.br/_app/immutable/chunks/GetOrdersFiltersAction.GyIecZSc.js');
  console.log(`   Content length: ${ordersContent.length}`);
  console.log(`   Content preview: ${ordersContent.substring(0, 500)}...`);

  // Look for order-related endpoints
  const orderEndpoints = ordersContent.match(/["'][/][a-zA-Z0-9/_-]+["']/g) || [];
  console.log('\n   Order endpoints found:');
  [...new Set(orderEndpoints)].forEach(e => console.log(`      ${e}`));

  // Analyze Engine.js for data patterns
  console.log('\n📊 Analyzing Engine.js for data endpoints...');
  const engineContent = await fetch('https://app.utmify.com.br/_app/immutable/chunks/Engine.pmRgMa9i.js');

  // Look for data-related terms
  const dataTerms = ['order', 'sale', 'revenue', 'conversion', 'funnel', 'campaign', 'analytics', 'metric', 'report', 'export', 'download', 'csv', 'excel'];
  console.log('\n   Searching for data-related patterns...');

  for (const term of dataTerms) {
    const regex = new RegExp(`["'][^"']*${term}[^"']*["']`, 'gi');
    const matches = engineContent.match(regex) || [];
    if (matches.length > 0) {
      console.log(`\n   📌 "${term}" (${matches.length} matches):`);
      [...new Set(matches)].slice(0, 5).forEach(m => console.log(`      ${m}`));
    }
  }

  // Also check Store.js for data models
  console.log('\n📊 Analyzing Store.js for data models...');
  const storeContent = await fetch('https://app.utmify.com.br/_app/immutable/chunks/Store.dcuQM3l8.js');

  // Look for class definitions or data structures
  const classPatterns = storeContent.match(/class\s+[A-Z][a-zA-Z]+/g) || [];
  console.log('\n   Classes found:');
  [...new Set(classPatterns)].slice(0, 10).forEach(c => console.log(`      ${c}`));

  // Search for more action files
  console.log('\n📊 Looking for more Action files in the app...');
  const loginPage = await fetch('https://app.utmify.com.br/login/');
  const actionChunks = loginPage.match(/[a-zA-Z]+Action\.[a-zA-Z0-9_]+\.js/g) || [];
  console.log('   Action files referenced:');
  [...new Set(actionChunks)].forEach(a => console.log(`      ${a}`));
}

main().catch(console.error);
