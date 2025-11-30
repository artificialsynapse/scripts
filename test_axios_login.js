const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

// Disable SSL verification globally
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const user = (process.env.user || 'lucascardoso01@proton.me').trim();
const pw = process.env.pw || '!Senha123';

console.log('=== UTMify Axios Login Test ===');
console.log(`User: ${user}`);
console.log('');

const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;
const httpsAgent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;

const axiosInstance = axios.create({
  httpsAgent,
  timeout: 30000,
  headers: {
    'Host': 'app.utmify.com.br',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Cache-Control': 'max-age=0',
    'Upgrade-Insecure-Requests': '1',
    'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1'
  }
});

async function testLogin() {
  try {
    console.log('1. Fetching login page...');
    const loginPageRes = await axiosInstance.get('https://app.utmify.com.br/login/');
    console.log(`   Status: ${loginPageRes.status}`);

    // Look for API endpoints in the JS files
    const jsMatches = loginPageRes.data.match(/_app\/immutable\/entry\/[a-zA-Z0-9._-]+\.js/g) || [];
    console.log(`   Found ${jsMatches.length} JS files`);

    // Try to find the API base URL by checking common patterns
    console.log('\n2. Trying login endpoints...');

    const endpoints = [
      'https://app.utmify.com.br/api/auth/login',
      'https://app.utmify.com.br/api/v1/auth/login',
      'https://app.utmify.com.br/api/sessions',
      'https://app.utmify.com.br/api/v1/sessions',
      'https://api.utmify.com.br/auth/login',
      'https://api.utmify.com.br/v1/auth/login',
      'https://api.utmify.com.br/sessions',
      'https://api.utmify.com.br/login'
    ];

    const payloads = [
      { email: user, password: pw },
      { email: user, senha: pw },
      { username: user, password: pw }
    ];

    for (const endpoint of endpoints) {
      for (const payload of payloads) {
        try {
          console.log(`\n   POST ${endpoint}`);
          console.log(`   Payload: ${JSON.stringify(payload)}`);

          const res = await axiosInstance.post(endpoint, payload, {
            headers: { 'Content-Type': 'application/json' },
            validateStatus: () => true // Accept all status codes
          });

          console.log(`   Status: ${res.status}`);

          if (res.status !== 404 && res.status !== 405) {
            const responseData = typeof res.data === 'string' ? res.data.substring(0, 500) : JSON.stringify(res.data).substring(0, 500);
            console.log(`   Response: ${responseData}`);

            if (res.status === 200 || res.status === 201) {
              console.log('\n✅ LOGIN SUCCESSFUL!');

              // Extract token
              const token = res.data.token || res.data.access_token || res.data.accessToken ||
                            (res.data.data && (res.data.data.token || res.data.data.access_token));

              if (token) {
                console.log(`   Token: ${token.substring(0, 50)}...`);

                // Store cookies if any
                const cookies = res.headers['set-cookie'];
                if (cookies) {
                  console.log(`   Cookies received: ${cookies.length}`);
                }

                // Try to fetch dashboard data
                console.log('\n3. Fetching dashboard data...');

                const dashboardEndpoints = [
                  'https://app.utmify.com.br/api/dashboard',
                  'https://app.utmify.com.br/api/v1/dashboard',
                  'https://api.utmify.com.br/dashboard',
                  'https://app.utmify.com.br/api/user',
                  'https://app.utmify.com.br/api/me',
                  'https://app.utmify.com.br/api/v1/me'
                ];

                for (const dashEndpoint of dashboardEndpoints) {
                  try {
                    const dashRes = await axiosInstance.get(dashEndpoint, {
                      headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                      },
                      validateStatus: () => true
                    });

                    if (dashRes.status === 200) {
                      console.log(`\n   ✅ ${dashEndpoint}`);
                      console.log(`   Data: ${JSON.stringify(dashRes.data, null, 2).substring(0, 2000)}`);
                    }
                  } catch (e) {
                    // Skip errors
                  }
                }
              }

              return;
            }
          }
        } catch (err) {
          if (!err.message.includes('ECONNREFUSED') && !err.message.includes('ENOTFOUND')) {
            console.log(`   Error: ${err.message}`);
          }
        }
      }
    }

    console.log('\n❌ Could not find working login endpoint');
    console.log('\n4. Trying to analyze app.js for API discovery...');

    // Try to get one of the JS bundles
    if (jsMatches.length > 0) {
      const appJs = jsMatches.find(f => f.includes('app.'));
      if (appJs) {
        try {
          const jsRes = await axiosInstance.get(`https://app.utmify.com.br/_app/immutable/entry/app.lDrsfXEf.js`);
          const apiMatches = jsRes.data.match(/["']\/api\/[^"']+["']/g) || [];
          const authMatches = jsRes.data.match(/["'][^"']*auth[^"']*["']/gi) || [];
          console.log(`   Found API paths: ${[...new Set(apiMatches)].slice(0, 10).join(', ')}`);
          console.log(`   Found auth patterns: ${[...new Set(authMatches)].slice(0, 10).join(', ')}`);
        } catch (e) {
          console.log(`   Could not fetch app JS: ${e.message}`);
        }
      }
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.response) {
      console.log('Response status:', error.response.status);
      console.log('Response data:', error.response.data);
    }
  }
}

testLogin().then(() => {
  console.log('\n=== Test Complete ===');
}).catch(err => {
  console.error('Fatal error:', err);
});
