const { chromium } = require('playwright');

(async () => {
  // Get proxy from environment
  const proxyUrl = process.env.HTTP_PROXY || process.env.http_proxy;

  console.log('=== UTMify Playwright Login Test ===');

  const user = (process.env.user || 'lucascardoso01@proton.me').trim();
  const pw = process.env.pw || '!Senha123';

  console.log(`User: ${user}`);
  console.log(`Proxy: ${proxyUrl ? 'Using environment proxy' : 'No proxy'}`);
  console.log('');

  let browser;
  try {
    // Launch with all necessary flags
    const launchArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--ignore-certificate-errors',
      '--ignore-certificate-errors-spki-list',
      '--disable-web-security',
      '--allow-insecure-localhost'
    ];

    const launchOptions = {
      headless: true,
      args: launchArgs
    };

    // Add proxy configuration if available
    if (proxyUrl) {
      const url = new URL(proxyUrl);
      launchOptions.proxy = {
        server: `${url.protocol}//${url.hostname}:${url.port}`,
        username: url.username ? decodeURIComponent(url.username) : undefined,
        password: url.password ? decodeURIComponent(url.password) : undefined
      };
      console.log(`Proxy server: ${launchOptions.proxy.server}`);
    }

    browser = await chromium.launch(launchOptions);

    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'pt-BR'
    });

    const page = await context.newPage();

    // Set up request/response logging
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log(`Console error: ${msg.text()}`);
      }
    });

    let loginApiEndpoint = null;
    let authToken = null;

    // Intercept network requests to find the login API
    page.on('request', request => {
      const url = request.url();
      if (url.includes('api') && (url.includes('login') || url.includes('auth') || url.includes('session'))) {
        console.log(`   [Request] ${request.method()} ${url}`);
        loginApiEndpoint = url;
      }
    });

    page.on('response', async response => {
      const url = response.url();
      if (url.includes('api') && (url.includes('login') || url.includes('auth') || url.includes('session'))) {
        console.log(`   [Response] ${response.status()} ${url}`);
        if (response.status() === 200 || response.status() === 201) {
          try {
            const json = await response.json();
            if (json.token || json.access_token || json.accessToken) {
              authToken = json.token || json.access_token || json.accessToken;
              console.log(`   Token found: ${authToken.substring(0, 30)}...`);
            }
          } catch (e) {
            // Not JSON or parse error
          }
        }
      }
    });

    console.log('1. Navigating to login page...');
    await page.goto('https://app.utmify.com.br/login/', {
      waitUntil: 'networkidle',
      timeout: 60000
    });

    console.log(`   Current URL: ${page.url()}`);

    // Wait for page to be ready
    await page.waitForTimeout(2000);

    // Take screenshot
    await page.screenshot({ path: '/home/user/scripts/screenshot_login.png', fullPage: true });
    console.log('   Screenshot saved: screenshot_login.png');

    // Get page content for debugging
    const pageContent = await page.content();
    console.log(`   Page content length: ${pageContent.length}`);

    // Find email input
    console.log('\n2. Looking for form fields...');

    const emailSelectors = [
      'input[type="email"]',
      'input[name="email"]',
      'input[placeholder*="email" i]',
      'input[placeholder*="e-mail" i]',
      '#email',
      '[data-testid="email"]',
      'input[autocomplete="email"]'
    ];

    let emailInput = null;
    for (const selector of emailSelectors) {
      const el = await page.$(selector);
      if (el) {
        emailInput = el;
        console.log(`   Found email input: ${selector}`);
        break;
      }
    }

    // Find password input
    const passwordSelectors = [
      'input[type="password"]',
      'input[name="password"]',
      'input[name="senha"]',
      'input[placeholder*="senha" i]',
      'input[placeholder*="password" i]',
      '#password',
      '[data-testid="password"]'
    ];

    let passwordInput = null;
    for (const selector of passwordSelectors) {
      const el = await page.$(selector);
      if (el) {
        passwordInput = el;
        console.log(`   Found password input: ${selector}`);
        break;
      }
    }

    if (!emailInput || !passwordInput) {
      // Debug: list all inputs
      const inputs = await page.$$('input');
      console.log(`\n   Found ${inputs.length} input elements`);
      for (let i = 0; i < Math.min(inputs.length, 10); i++) {
        const input = inputs[i];
        const type = await input.getAttribute('type');
        const name = await input.getAttribute('name');
        const placeholder = await input.getAttribute('placeholder');
        console.log(`   Input ${i}: type=${type}, name=${name}, placeholder=${placeholder}`);
      }

      throw new Error('Could not find login form fields');
    }

    console.log('\n3. Filling credentials...');
    await emailInput.fill(user);
    await passwordInput.fill(pw);

    await page.waitForTimeout(1000);
    await page.screenshot({ path: '/home/user/scripts/screenshot_filled.png', fullPage: true });
    console.log('   Screenshot saved: screenshot_filled.png');

    // Find submit button
    console.log('\n4. Looking for submit button...');

    const submitSelectors = [
      'button[type="submit"]',
      'button:has-text("Entrar")',
      'button:has-text("Login")',
      'button:has-text("Acessar")',
      'button:has-text("Sign in")',
      'input[type="submit"]',
      'form button'
    ];

    let submitButton = null;
    for (const selector of submitSelectors) {
      try {
        const el = await page.$(selector);
        if (el) {
          submitButton = el;
          console.log(`   Found submit button: ${selector}`);
          break;
        }
      } catch (e) {
        // Continue
      }
    }

    if (!submitButton) {
      const buttons = await page.$$('button');
      console.log(`   Found ${buttons.length} buttons`);
      if (buttons.length > 0) {
        submitButton = buttons[buttons.length - 1];
        console.log('   Using last button as submit');
      }
    }

    if (!submitButton) {
      throw new Error('Could not find submit button');
    }

    console.log('\n5. Submitting form...');

    // Click and wait for navigation or network
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }).catch(() => {}),
      submitButton.click()
    ]);

    // Wait for any post-login redirects
    await page.waitForTimeout(5000);

    const currentUrl = page.url();
    console.log(`   Current URL: ${currentUrl}`);

    await page.screenshot({ path: '/home/user/scripts/screenshot_after_login.png', fullPage: true });
    console.log('   Screenshot saved: screenshot_after_login.png');

    // Check if login was successful
    if (!currentUrl.includes('/login')) {
      console.log('\n✅ LOGIN SUCCESSFUL!');
      console.log(`   Redirected to: ${currentUrl}`);

      // Wait for dashboard to load
      await page.waitForTimeout(3000);

      // Take dashboard screenshot
      await page.screenshot({ path: '/home/user/scripts/screenshot_dashboard.png', fullPage: true });
      console.log('   Dashboard screenshot saved: screenshot_dashboard.png');

      // Get page title and content
      const title = await page.title();
      console.log(`\n6. Dashboard Information:`);
      console.log(`   Title: ${title}`);

      // Get visible text content
      const bodyText = await page.textContent('body');
      console.log(`\n   Page content (first 2000 chars):`);
      console.log(bodyText.substring(0, 2000).replace(/\s+/g, ' '));

      // Look for common dashboard elements
      const metrics = await page.$$eval('[class*="metric"], [class*="stat"], [class*="card"], [class*="value"]', elements => {
        return elements.slice(0, 20).map(el => el.textContent?.trim()).filter(Boolean);
      }).catch(() => []);

      if (metrics.length > 0) {
        console.log(`\n   Dashboard metrics found:`);
        metrics.forEach(m => console.log(`   - ${m.substring(0, 100)}`));
      }

      // If we have an auth token, try API calls
      if (authToken) {
        console.log(`\n7. Making API calls with token...`);

        const apiEndpoints = [
          '/api/dashboard',
          '/api/v1/dashboard',
          '/api/user',
          '/api/me',
          '/api/stats',
          '/api/analytics'
        ];

        for (const endpoint of apiEndpoints) {
          try {
            const apiResponse = await page.evaluate(async (url, token) => {
              const res = await fetch(url, {
                headers: { 'Authorization': `Bearer ${token}` }
              });
              return { status: res.status, data: await res.text() };
            }, `https://app.utmify.com.br${endpoint}`, authToken);

            if (apiResponse.status === 200) {
              console.log(`   ${endpoint}: ${apiResponse.data.substring(0, 500)}`);
            }
          } catch (e) {
            // Skip
          }
        }
      }

    } else {
      console.log('\n❌ Still on login page - checking for errors');

      // Check for error messages
      const errorSelectors = [
        '.error',
        '.alert-error',
        '.alert-danger',
        '[class*="error"]',
        '[class*="Error"]',
        '[role="alert"]'
      ];

      for (const selector of errorSelectors) {
        const errorEl = await page.$(selector);
        if (errorEl) {
          const errorText = await errorEl.textContent();
          console.log(`   Error found: ${errorText}`);
        }
      }
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    if (browser) {
      await browser.close();
    }
    console.log('\n=== Test Complete ===');
  }
})();
