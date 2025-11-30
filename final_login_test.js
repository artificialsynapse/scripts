const https = require('https');
const tunnel = require('tunnel');
const { URL } = require('url');

// Disable TLS verification
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const USER_EMAIL = 'lucascardoso01@proton.me';
const PASSWORD = '!Senha123';

console.log('=== UTMify Final Login Test ===');
console.log(`User: ${USER_EMAIL}`);
console.log('');

// Setup proxy
const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;
let agent = null;

if (proxyUrl) {
  const parsed = new URL(proxyUrl);
  console.log(`Proxy: ${parsed.hostname}:${parsed.port}`);
  agent = tunnel.httpsOverHttp({
    proxy: {
      host: parsed.hostname,
      port: parseInt(parsed.port),
      proxyAuth: parsed.username ? `${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}` : undefined
    },
    rejectUnauthorized: false
  });
}

// Helper function for HTTP requests with retry
async function makeRequest(url, options = {}, maxRetries = 5) {
  const parsedUrl = new URL(url);

  for (let retry = 0; retry < maxRetries; retry++) {
    try {
      const result = await new Promise((resolve, reject) => {
        const reqOptions = {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || 443,
          path: parsedUrl.pathname + parsedUrl.search,
          method: options.method || 'GET',
          agent: agent,
          rejectUnauthorized: false,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/html, */*',
            'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
            ...options.headers
          }
        };

        const req = https.request(reqOptions, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            resolve({
              statusCode: res.statusCode,
              headers: res.headers,
              body: data
            });
          });
        });

        req.on('error', reject);
        req.setTimeout(15000, () => {
          req.destroy();
          reject(new Error('Request timeout'));
        });

        if (options.body) {
          req.write(options.body);
        }
        req.end();
      });

      // Check if it's a TLS error response
      if (result.body && result.body.includes('TLS_error')) {
        throw new Error('TLS error, retrying...');
      }

      return result;
    } catch (err) {
      if (retry < maxRetries - 1) {
        console.log(`   Retry ${retry + 1}...`);
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      throw err;
    }
  }
}

async function testLogin() {
  try {
    // Test endpoints
    const endpoints = [
      // Try api.utmify.com.br with Basic Auth (email:password base64 encoded)
      {
        url: 'https://api.utmify.com.br/users/auth',
        method: 'GET',
        headers: {
          'Authorization': `Basic ${Buffer.from(`${USER_EMAIL}:${PASSWORD}`).toString('base64')}`
        }
      },
      // Try POST with JSON
      {
        url: 'https://api.utmify.com.br/users/auth',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: USER_EMAIL, password: PASSWORD })
      },
      // Try app.utmify.com.br endpoints
      {
        url: 'https://app.utmify.com.br/api/auth',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: USER_EMAIL, password: PASSWORD })
      },
      {
        url: 'https://app.utmify.com.br/api/v1/auth',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: USER_EMAIL, password: PASSWORD })
      }
    ];

    console.log('1. Testing login endpoints...\n');

    for (const endpoint of endpoints) {
      console.log(`${endpoint.method} ${endpoint.url}`);

      try {
        const response = await makeRequest(endpoint.url, {
          method: endpoint.method,
          headers: endpoint.headers,
          body: endpoint.body
        });

        console.log(`   Status: ${response.statusCode}`);

        if (response.statusCode !== 404 && response.statusCode !== 405) {
          console.log(`   Response: ${response.body.substring(0, 400)}`);

          if (response.statusCode === 200 || response.statusCode === 201) {
            console.log('\n✅ LOGIN SUCCESSFUL!');

            try {
              const data = JSON.parse(response.body);
              console.log('\n   Parsed Response:');
              console.log(JSON.stringify(data, null, 2).substring(0, 2000));

              // Look for token
              const token = data.auth?.token || data.token || data.access_token || data.accessToken;
              if (token) {
                console.log(`\n   Token: ${token.substring(0, 50)}...`);
                await fetchDashboard(token);
              }
            } catch (e) {
              console.log(`   Not JSON: ${e.message}`);
            }

            return;
          }
        }
      } catch (err) {
        console.log(`   Error: ${err.message}`);
      }
      console.log('');
    }

    console.log('\n❌ No working login endpoint found');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
  }
}

async function fetchDashboard(token) {
  console.log('\n2. Fetching dashboard data...');

  const endpoints = [
    '/api/dashboard',
    '/api/v1/dashboard',
    '/api/me',
    '/api/user',
    '/api/account',
    '/api/stats'
  ];

  for (const path of endpoints) {
    const url = `https://app.utmify.com.br${path}`;
    console.log(`\n   GET ${path}`);

    try {
      const response = await makeRequest(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      });

      console.log(`   Status: ${response.statusCode}`);

      if (response.statusCode === 200) {
        console.log(`   ✅ Data:`);
        try {
          const data = JSON.parse(response.body);
          console.log(JSON.stringify(data, null, 2).substring(0, 2000));
        } catch {
          console.log(response.body.substring(0, 1000));
        }
      }
    } catch (err) {
      console.log(`   Error: ${err.message}`);
    }
  }
}

testLogin().then(() => {
  console.log('\n=== Test Complete ===');
});
