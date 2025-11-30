const { chromium } = require('playwright');

(async () => {
  const proxyServer = process.env.HTTP_PROXY || process.env.http_proxy;

  const launchOptions = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--ignore-certificate-errors',
      '--ignore-certificate-errors-spki-list'
    ]
  };

  // Configure proxy if available
  if (proxyServer) {
    launchOptions.proxy = {
      server: proxyServer
    };
  }

  const browser = await chromium.launch(launchOptions);

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ignoreHTTPSErrors: true
  });

  const page = await context.newPage();

  const user = process.env.user || 'lucascardoso01@proton.me';
  const pw = process.env.pw || '!Senha123';

  console.log('=== UTMify Login Test ===');
  console.log(`User: ${user}`);
  console.log('');

  try {
    // Navigate to login page
    console.log('1. Navigating to login page...');
    await page.goto('https://app.utmify.com.br/login/', {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    // Wait for the page to load
    await page.waitForTimeout(3000);

    // Take screenshot of login page
    await page.screenshot({ path: '/home/user/scripts/login_page.png', fullPage: true });
    console.log('   Screenshot saved: login_page.png');

    // Find and fill email field
    console.log('2. Looking for login form fields...');

    // Try different selectors for email input
    const emailSelectors = [
      'input[type="email"]',
      'input[name="email"]',
      'input[placeholder*="email" i]',
      'input[placeholder*="e-mail" i]',
      '#email',
      'input[type="text"]'
    ];

    let emailInput = null;
    for (const selector of emailSelectors) {
      emailInput = await page.$(selector);
      if (emailInput) {
        console.log(`   Found email input with selector: ${selector}`);
        break;
      }
    }

    // Try different selectors for password input
    const passwordSelectors = [
      'input[type="password"]',
      'input[name="password"]',
      'input[placeholder*="senha" i]',
      'input[placeholder*="password" i]',
      '#password'
    ];

    let passwordInput = null;
    for (const selector of passwordSelectors) {
      passwordInput = await page.$(selector);
      if (passwordInput) {
        console.log(`   Found password input with selector: ${selector}`);
        break;
      }
    }

    if (!emailInput || !passwordInput) {
      // Get page content for debugging
      const content = await page.content();
      console.log('\n   Page HTML (first 2000 chars):');
      console.log(content.substring(0, 2000));
      throw new Error('Could not find login form fields');
    }

    // Fill in credentials
    console.log('3. Filling in credentials...');
    await emailInput.fill(user);
    await passwordInput.fill(pw);

    // Take screenshot after filling
    await page.screenshot({ path: '/home/user/scripts/login_filled.png', fullPage: true });
    console.log('   Screenshot saved: login_filled.png');

    // Find and click submit button
    console.log('4. Looking for submit button...');
    const submitSelectors = [
      'button[type="submit"]',
      'button:has-text("Entrar")',
      'button:has-text("Login")',
      'button:has-text("Acessar")',
      'input[type="submit"]',
      'button.btn-primary',
      'button.submit'
    ];

    let submitButton = null;
    for (const selector of submitSelectors) {
      try {
        submitButton = await page.$(selector);
        if (submitButton) {
          console.log(`   Found submit button with selector: ${selector}`);
          break;
        }
      } catch (e) {
        // Continue to next selector
      }
    }

    if (!submitButton) {
      // Try to find any button
      const buttons = await page.$$('button');
      if (buttons.length > 0) {
        submitButton = buttons[buttons.length - 1]; // Usually last button is submit
        console.log('   Using last button on page as submit');
      }
    }

    if (!submitButton) {
      throw new Error('Could not find submit button');
    }

    // Click submit and wait for navigation
    console.log('5. Submitting login form...');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }).catch(() => {}),
      submitButton.click()
    ]);

    // Wait for page to settle
    await page.waitForTimeout(5000);

    // Get current URL
    const currentUrl = page.url();
    console.log(`   Current URL: ${currentUrl}`);

    // Take screenshot of result
    await page.screenshot({ path: '/home/user/scripts/after_login.png', fullPage: true });
    console.log('   Screenshot saved: after_login.png');

    // Check if login was successful (not on login page anymore)
    if (currentUrl.includes('/login')) {
      // Check for error messages
      const errorText = await page.textContent('body');
      if (errorText.includes('incorret') || errorText.includes('inválid') || errorText.includes('error') || errorText.includes('Error')) {
        console.log('\n❌ LOGIN FAILED - Invalid credentials or error detected');
      } else {
        console.log('\n⚠️  Still on login page - might need to wait more or check for issues');
      }
    } else {
      console.log('\n✅ LOGIN SUCCESSFUL!');

      // Extract dashboard information
      console.log('\n6. Extracting dashboard information...');

      // Wait a bit more for dashboard to load
      await page.waitForTimeout(3000);

      // Take dashboard screenshot
      await page.screenshot({ path: '/home/user/scripts/dashboard.png', fullPage: true });
      console.log('   Dashboard screenshot saved: dashboard.png');

      // Get page title
      const title = await page.title();
      console.log(`   Page title: ${title}`);

      // Try to get main content
      const bodyText = await page.textContent('body');
      console.log('\n   Dashboard content preview (first 1500 chars):');
      console.log('   ' + bodyText.substring(0, 1500).replace(/\n/g, '\n   '));

      // Look for specific dashboard elements
      console.log('\n7. Looking for dashboard elements...');

      // Try to find common dashboard elements
      const possibleElements = [
        { selector: '[class*="dashboard"]', name: 'Dashboard container' },
        { selector: '[class*="metric"]', name: 'Metrics' },
        { selector: '[class*="stat"]', name: 'Statistics' },
        { selector: '[class*="chart"]', name: 'Charts' },
        { selector: '[class*="card"]', name: 'Cards' },
        { selector: 'table', name: 'Tables' },
        { selector: '[class*="user"]', name: 'User info' },
        { selector: '[class*="account"]', name: 'Account info' }
      ];

      for (const elem of possibleElements) {
        const elements = await page.$$(elem.selector);
        if (elements.length > 0) {
          console.log(`   Found ${elements.length} ${elem.name} element(s)`);
        }
      }
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    try {
      await page.screenshot({ path: '/home/user/scripts/error.png', fullPage: true });
      console.log('   Error screenshot saved: error.png');
    } catch (e) {
      console.log('   Could not save error screenshot');
    }
  } finally {
    await browser.close();
    console.log('\n=== Test Complete ===');
  }
})();
