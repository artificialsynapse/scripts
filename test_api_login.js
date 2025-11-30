const https = require('https');
const http = require('http');
const { URL } = require('url');

// Disable SSL verification
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const user = process.env.user || 'lucascardoso01@proton.me';
const pw = process.env.pw || '!Senha123';

console.log('=== UTMify API Login Test ===');
console.log(`User: ${user}`);
console.log('');

// Parse proxy URL
const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;
let proxyHost, proxyPort, proxyAuth;

if (proxyUrl) {
  const parsed = new URL(proxyUrl);
  proxyHost = parsed.hostname;
  proxyPort = parseInt(parsed.port);
  if (parsed.username && parsed.password) {
    proxyAuth = `${parsed.username}:${parsed.password}`;
  }
  console.log(`Using proxy: ${proxyHost}:${proxyPort}`);
}

async function makeRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const protocol = options.protocol === 'https:' ? https : http;

    const req = protocol.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

async function connectThroughProxy(targetHost, targetPort) {
  return new Promise((resolve, reject) => {
    const connectReq = http.request({
      host: proxyHost,
      port: proxyPort,
      method: 'CONNECT',
      path: `${targetHost}:${targetPort}`,
      headers: {
        'Host': `${targetHost}:${targetPort}`,
        'Proxy-Authorization': proxyAuth ? `Basic ${Buffer.from(proxyAuth).toString('base64')}` : undefined
      }
    });

    connectReq.on('connect', (res, socket) => {
      if (res.statusCode === 200) {
        resolve(socket);
      } else {
        reject(new Error(`Proxy CONNECT failed: ${res.statusCode}`));
      }
    });

    connectReq.on('error', reject);
    connectReq.end();
  });
}

async function httpsRequestThroughProxy(targetUrl, options = {}) {
  const target = new URL(targetUrl);

  // Connect to proxy first
  const socket = await connectThroughProxy(target.hostname, 443);

  // Make HTTPS request through the tunnel
  const tlsOptions = {
    socket: socket,
    servername: target.hostname,
    rejectUnauthorized: false
  };

  return new Promise((resolve, reject) => {
    const tls = require('tls');
    const tlsSocket = tls.connect(tlsOptions, () => {
      const requestOptions = {
        method: options.method || 'GET',
        path: target.pathname + target.search,
        headers: {
          'Host': target.hostname,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Content-Type': 'application/json',
          ...options.headers
        }
      };

      let request = `${requestOptions.method} ${requestOptions.path} HTTP/1.1\r\n`;
      for (const [key, value] of Object.entries(requestOptions.headers)) {
        if (value) request += `${key}: ${value}\r\n`;
      }

      if (options.body) {
        request += `Content-Length: ${Buffer.byteLength(options.body)}\r\n`;
      }
      request += '\r\n';

      if (options.body) {
        request += options.body;
      }

      tlsSocket.write(request);

      let response = '';
      tlsSocket.on('data', (data) => {
        response += data.toString();
      });

      tlsSocket.on('end', () => {
        // Parse HTTP response
        const headerEndIndex = response.indexOf('\r\n\r\n');
        const headerPart = response.substring(0, headerEndIndex);
        const body = response.substring(headerEndIndex + 4);

        const statusLine = headerPart.split('\r\n')[0];
        const statusCode = parseInt(statusLine.split(' ')[1]);

        const headers = {};
        headerPart.split('\r\n').slice(1).forEach(line => {
          const colonIndex = line.indexOf(':');
          if (colonIndex > 0) {
            headers[line.substring(0, colonIndex).toLowerCase()] = line.substring(colonIndex + 2);
          }
        });

        resolve({ statusCode, headers, body });
      });

      tlsSocket.on('error', reject);
    });

    tlsSocket.on('error', reject);
  });
}

async function testLogin() {
  try {
    // Common UTMify API endpoints to try
    const apiEndpoints = [
      '/api/auth/login',
      '/api/login',
      '/api/v1/auth/login',
      '/api/v1/login',
      '/auth/login',
      '/login',
      '/api/sessions',
      '/api/v1/sessions'
    ];

    console.log('1. Testing common API endpoints...\n');

    // First, let's try to get the login page and find API endpoints
    console.log('   Fetching login page to discover API...');
    const loginPageResponse = await httpsRequestThroughProxy('https://app.utmify.com.br/login/');
    console.log(`   Login page status: ${loginPageResponse.statusCode}`);

    // Look for API references in the page
    const pageContent = loginPageResponse.body;
    const apiMatches = pageContent.match(/\/api\/[a-zA-Z0-9/_-]+/g) || [];
    const uniqueApis = [...new Set(apiMatches)];
    console.log(`   Found ${uniqueApis.length} API references in page:`, uniqueApis.slice(0, 10));

    // Try login with different endpoints
    console.log('\n2. Attempting login with common endpoints...');

    const loginPayloads = [
      { email: user.trim(), password: pw },
      { email: user.trim(), senha: pw },
      { user: user.trim(), password: pw },
      { username: user.trim(), password: pw },
      { login: user.trim(), password: pw }
    ];

    for (const endpoint of apiEndpoints) {
      for (const payload of loginPayloads) {
        try {
          console.log(`\n   Trying: ${endpoint} with payload keys: [${Object.keys(payload).join(', ')}]`);

          const response = await httpsRequestThroughProxy(`https://app.utmify.com.br${endpoint}`, {
            method: 'POST',
            body: JSON.stringify(payload),
            headers: {
              'Origin': 'https://app.utmify.com.br',
              'Referer': 'https://app.utmify.com.br/login/'
            }
          });

          console.log(`   Status: ${response.statusCode}`);

          // If we got a response that's not 404, let's see what it says
          if (response.statusCode !== 404) {
            console.log(`   Response (first 500 chars): ${response.body.substring(0, 500)}`);

            // Check for success indicators
            if (response.statusCode === 200 || response.statusCode === 201) {
              console.log('\n✅ LOGIN APPEARS SUCCESSFUL!');

              // Try to parse the response
              try {
                const jsonResponse = JSON.parse(response.body);
                console.log('\n   Response data:', JSON.stringify(jsonResponse, null, 2).substring(0, 1000));

                // If we got a token, try to access dashboard
                if (jsonResponse.token || jsonResponse.access_token || jsonResponse.accessToken) {
                  const token = jsonResponse.token || jsonResponse.access_token || jsonResponse.accessToken;
                  console.log('\n3. Token received! Fetching dashboard...');

                  const dashboardResponse = await httpsRequestThroughProxy('https://app.utmify.com.br/api/dashboard', {
                    headers: {
                      'Authorization': `Bearer ${token}`
                    }
                  });

                  console.log(`   Dashboard status: ${dashboardResponse.statusCode}`);
                  console.log(`   Dashboard data: ${dashboardResponse.body.substring(0, 1000)}`);
                }
              } catch (e) {
                console.log('   Response is not JSON');
              }

              return;
            }
          }
        } catch (err) {
          console.log(`   Error: ${err.message}`);
        }
      }
    }

    console.log('\n❌ Could not find working login endpoint');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
  }
}

testLogin().then(() => {
  console.log('\n=== Test Complete ===');
});
