const { SocksProxyAgent } = require('socks-proxy-agent');
const https = require('https');
const { URL } = require('url');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const user = (process.env.user || 'lucascardoso01@proton.me').trim();
const pw = process.env.pw || '!Senha123';

console.log('=== UTMify SOCKS Login Test ===');
console.log(`User: ${user}`);
console.log('');

// SOCKS proxy
const socksProxy = 'socks5://contatolc01:L7VfG53bHC@200.234.131.27:51524';
console.log('Using SOCKS5 proxy: 200.234.131.27:51524');

const agent = new SocksProxyAgent(socksProxy);

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

async function testLogin() {
  try {
    console.log('\n1. Fetching login page...');
    const loginPage = await request('https://app.utmify.com.br/login/');
    console.log(`   Status: ${loginPage.statusCode}`);
    console.log(`   Content length: ${loginPage.body.length}`);

    if (loginPage.statusCode !== 200) {
      console.log(`   Response: ${loginPage.body.substring(0, 500)}`);
      return;
    }

    // Look for API patterns in the page
    const apiPatterns = loginPage.body.match(/["']\/api\/[^"']+["']/g) || [];
    console.log(`   API patterns found: ${[...new Set(apiPatterns)].join(', ')}`);

    // Look for JS bundle files
    const jsBundles = loginPage.body.match(/_app\/immutable\/[^"']+\.js/g) || [];
    console.log(`   JS bundles: ${jsBundles.length}`);

    if (jsBundles.length > 0) {
      console.log('\n2. Analyzing JS bundles for API endpoints...');

      for (const bundle of jsBundles.slice(0, 5)) {
        try {
          const jsUrl = `https://app.utmify.com.br/${bundle}`;
          console.log(`   Fetching: ${bundle.substring(0, 50)}...`);
          const jsContent = await request(jsUrl);

          // Look for API endpoints
          const endpoints = jsContent.body.match(/["']\/api\/[^"']+["']/g) || [];
          const authPatterns = jsContent.body.match(/["'][^"']*(login|auth|session|signin)[^"']*["']/gi) || [];
          const postPatterns = jsContent.body.match(/fetch\([^)]+POST/g) || [];

          if (endpoints.length > 0) {
            console.log(`   Found API endpoints: ${[...new Set(endpoints)].slice(0, 10).join(', ')}`);
          }
          if (authPatterns.length > 0) {
            console.log(`   Found auth patterns: ${[...new Set(authPatterns)].slice(0, 10).join(', ')}`);
          }
        } catch (e) {
          console.log(`   Error fetching bundle: ${e.message}`);
        }
      }
    }

    // Try common login endpoints
    console.log('\n3. Testing login endpoints...');

    const endpoints = [
      'https://app.utmify.com.br/api/auth/login',
      'https://app.utmify.com.br/api/v1/auth/login',
      'https://app.utmify.com.br/api/login',
      'https://app.utmify.com.br/api/v1/login',
      'https://app.utmify.com.br/api/sessions',
      'https://app.utmify.com.br/api/v1/sessions',
      'https://app.utmify.com.br/api/auth/signin',
      'https://app.utmify.com.br/api/v1/auth/signin',
      'https://api.utmify.com.br/auth/login',
      'https://api.utmify.com.br/v1/auth/login',
      'https://api.utmify.com.br/login',
      'https://api.utmify.com.br/sessions'
    ];

    const payloads = [
      { email: user, password: pw },
      { email: user, senha: pw },
      { username: user, password: pw },
      { login: user, password: pw }
    ];

    for (const endpoint of endpoints) {
      for (const payload of payloads) {
        try {
          console.log(`\n   POST ${endpoint}`);
          console.log(`   Payload keys: [${Object.keys(payload).join(', ')}]`);

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
            const bodyPreview = response.body.substring(0, 300);
            console.log(`   Response: ${bodyPreview}`);

            if (response.statusCode === 200 || response.statusCode === 201) {
              console.log('\n✅ LOGIN SUCCESSFUL!');

              try {
                const data = JSON.parse(response.body);
                console.log(`\n   Full Response Data:`);
                console.log(JSON.stringify(data, null, 2).substring(0, 2000));

                const token = data.token || data.access_token || data.accessToken ||
                              (data.data && (data.data.token || data.data.access_token));

                if (token) {
                  console.log(`\n   Token found: ${token.substring(0, 50)}...`);
                  console.log('\n4. Fetching dashboard with token...');

                  const dashEndpoints = [
                    '/api/dashboard',
                    '/api/v1/dashboard',
                    '/api/me',
                    '/api/v1/me',
                    '/api/user',
                    '/api/v1/user',
                    '/api/account',
                    '/api/v1/account',
                    '/api/stats',
                    '/api/v1/stats'
                  ];

                  for (const dashPath of dashEndpoints) {
                    try {
                      console.log(`   Trying ${dashPath}...`);
                      const dashRes = await request(`https://app.utmify.com.br${dashPath}`, {
                        headers: {
                          'Authorization': `Bearer ${token}`,
                          'Accept': 'application/json'
                        }
                      });

                      console.log(`   ${dashPath}: Status ${dashRes.statusCode}`);
                      if (dashRes.statusCode === 200) {
                        console.log(`\n   ✅ ${dashPath} - SUCCESS:`);
                        try {
                          const dashData = JSON.parse(dashRes.body);
                          console.log(JSON.stringify(dashData, null, 2).substring(0, 3000));
                        } catch {
                          console.log(dashRes.body.substring(0, 1000));
                        }
                      }
                    } catch (e) {
                      console.log(`   ${dashPath}: Error - ${e.message}`);
                    }
                  }
                } else {
                  console.log('\n   No token in response, but login succeeded');
                  // Check if cookies are set
                  if (response.headers['set-cookie']) {
                    console.log(`   Cookies: ${response.headers['set-cookie']}`);
                  }
                }
              } catch (e) {
                console.log(`   Response is not JSON: ${e.message}`);
                console.log(`   Raw response: ${response.body.substring(0, 1000)}`);
              }

              return;
            }
          }
        } catch (e) {
          if (!e.message.includes('ECONNREFUSED') && !e.message.includes('ENOTFOUND')) {
            console.log(`   Error: ${e.message}`);
          }
        }
      }
    }

    console.log('\n❌ No working login endpoint found');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
  }
}

testLogin().then(() => {
  console.log('\n=== Test Complete ===');
});
