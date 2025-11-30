const tunnel = require('tunnel');
const https = require('https');
const { URL } = require('url');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const user = (process.env.user || 'lucascardoso01@proton.me').trim();
const pw = process.env.pw || '!Senha123';

console.log('=== UTMify Tunnel Login Test ===');
console.log(`User: ${user}`);
console.log('');

// Parse proxy
const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;
let agent = undefined;

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

// Create a simple request helper
async function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);

    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      agent: agent,
      rejectUnauthorized: false,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'Host': parsedUrl.hostname,
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
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

const client = { request };

async function testLogin() {
  try {
    console.log('1. Fetching login page...');
    const loginPage = await request('https://app.utmify.com.br/login/');
    console.log(`   Status: ${loginPage.statusCode}`);
    console.log(`   Content length: ${loginPage.body.length}`);

    // Look for API patterns in the page
    const apiPatterns = loginPage.body.match(/["']\/api\/[^"']+["']/g) || [];
    console.log(`   API patterns found: ${[...new Set(apiPatterns)].join(', ')}`);

    // Look for JS bundle files
    const jsBundles = loginPage.body.match(/_app\/immutable\/[^"']+\.js/g) || [];
    console.log(`   JS bundles: ${jsBundles.length}`);

    if (jsBundles.length > 0) {
      console.log('\n2. Analyzing JS bundles for API endpoints...');

      for (const bundle of jsBundles.slice(0, 3)) {
        try {
          const jsUrl = `https://app.utmify.com.br/${bundle}`;
          console.log(`   Fetching: ${bundle}`);
          const jsContent = await request(jsUrl);

          // Look for API endpoints
          const endpoints = jsContent.body.match(/["']\/api\/[^"']+["']/g) || [];
          const authPatterns = jsContent.body.match(/["'][^"']*(login|auth|session)[^"']*["']/gi) || [];

          if (endpoints.length > 0) {
            console.log(`   Found endpoints: ${[...new Set(endpoints)].slice(0, 5).join(', ')}`);
          }
          if (authPatterns.length > 0) {
            console.log(`   Found auth patterns: ${[...new Set(authPatterns)].slice(0, 5).join(', ')}`);
          }
        } catch (e) {
          console.log(`   Error fetching ${bundle}: ${e.message}`);
        }
      }
    }

    // Try common login endpoints
    console.log('\n3. Testing login endpoints...');

    const endpoints = [
      'https://app.utmify.com.br/api/auth/login',
      'https://app.utmify.com.br/api/v1/auth/login',
      'https://app.utmify.com.br/api/login',
      'https://app.utmify.com.br/api/sessions',
      'https://api.utmify.com.br/auth/login',
      'https://api.utmify.com.br/v1/auth/login'
    ];

    const payloads = [
      { email: user, password: pw },
      { email: user, senha: pw }
    ];

    for (const endpoint of endpoints) {
      for (const payload of payloads) {
        try {
          console.log(`\n   POST ${endpoint}`);

          const response = await request(endpoint, {
            method: 'POST',
            body: JSON.stringify(payload),
            headers: {
              'Content-Type': 'application/json',
              'Origin': 'https://app.utmify.com.br',
              'Referer': 'https://app.utmify.com.br/login/'
            }
          });

          console.log(`   Status: ${response.statusCode}`);

          if (response.statusCode !== 404 && response.statusCode !== 405) {
            console.log(`   Response: ${response.body.substring(0, 500)}`);

            if (response.statusCode === 200 || response.statusCode === 201) {
              console.log('\n✅ LOGIN SUCCESSFUL!');

              try {
                const data = JSON.parse(response.body);
                console.log(`   Data: ${JSON.stringify(data, null, 2).substring(0, 1000)}`);

                const token = data.token || data.access_token || data.accessToken ||
                              (data.data && (data.data.token || data.data.access_token));

                if (token) {
                  console.log('\n4. Fetching dashboard with token...');

                  const dashEndpoints = [
                    '/api/dashboard',
                    '/api/v1/dashboard',
                    '/api/me',
                    '/api/user',
                    '/api/v1/user'
                  ];

                  for (const dashPath of dashEndpoints) {
                    try {
                      const dashRes = await request(`https://app.utmify.com.br${dashPath}`, {
                        headers: {
                          'Authorization': `Bearer ${token}`
                        }
                      });

                      if (dashRes.statusCode === 200) {
                        console.log(`\n   ✅ ${dashPath}:`);
                        console.log(`   ${dashRes.body.substring(0, 2000)}`);
                      }
                    } catch (e) {
                      // Skip
                    }
                  }
                }
              } catch (e) {
                console.log(`   Not JSON: ${e.message}`);
              }

              return;
            }
          }
        } catch (e) {
          if (!e.message.includes('ECONNREFUSED')) {
            console.log(`   Error: ${e.message}`);
          }
        }
      }
    }

    console.log('\n❌ No working login endpoint found');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.response) {
      console.log('Response:', error.response.statusCode, error.response.body?.substring(0, 500));
    }
  }
}

testLogin().then(() => {
  console.log('\n=== Test Complete ===');
});
