/**
 * UTMify Dashboard Automation Agent
 *
 * This script automates login and actions on app.utmify.com.br
 *
 * Requirements:
 * - Node.js 18+
 * - npm install playwright
 * - npx playwright install chromium
 *
 * Usage:
 *   node utmify_agent.js
 *
 * Environment variables:
 *   UTMIFY_EMAIL - Login email
 *   UTMIFY_PASSWORD - Login password
 *   HEADLESS - Set to "false" to see the browser (default: true)
 */

const { chromium } = require('playwright');

class UTMifyAgent {
  constructor(options = {}) {
    this.email = options.email || process.env.UTMIFY_EMAIL;
    this.password = options.password || process.env.UTMIFY_PASSWORD;
    this.headless = options.headless ?? (process.env.HEADLESS !== 'false');
    this.browser = null;
    this.context = null;
    this.page = null;
    this.isLoggedIn = false;
    this.authToken = null;
  }

  async init() {
    console.log('🚀 Initializing UTMify Agent...');

    this.browser = await chromium.launch({
      headless: this.headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    this.context = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'pt-BR'
    });

    this.page = await this.context.newPage();

    // Intercept API responses to capture auth token
    this.page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('/users/auth') && response.status() === 200) {
        try {
          const data = await response.json();
          if (data.auth?.token) {
            this.authToken = data.auth.token;
            console.log('🔑 Auth token captured');
          }
        } catch (e) {
          // Not JSON
        }
      }
    });

    console.log('✅ Browser initialized');
  }

  async login() {
    if (!this.email || !this.password) {
      throw new Error('Email and password are required');
    }

    console.log(`🔐 Logging in as ${this.email}...`);

    await this.page.goto('https://app.utmify.com.br/login/', {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    // Wait for the login form to be ready
    await this.page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 10000 });

    // Fill email
    const emailInput = await this.page.$('input[type="email"]') ||
                       await this.page.$('input[name="email"]') ||
                       await this.page.$('input[placeholder*="email" i]');
    await emailInput.fill(this.email);

    // Fill password
    const passwordInput = await this.page.$('input[type="password"]');
    await passwordInput.fill(this.password);

    // Click login button
    const submitButton = await this.page.$('button[type="submit"]') ||
                         await this.page.$('button:has-text("Entrar")') ||
                         await this.page.$('button:has-text("Login")');

    await Promise.all([
      this.page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }).catch(() => {}),
      submitButton.click()
    ]);

    // Wait for dashboard to load
    await this.page.waitForTimeout(3000);

    // Check if login was successful
    const currentUrl = this.page.url();
    if (currentUrl.includes('/login')) {
      // Check for error message
      const errorEl = await this.page.$('[class*="error"], [role="alert"]');
      if (errorEl) {
        const errorText = await errorEl.textContent();
        throw new Error(`Login failed: ${errorText}`);
      }
      throw new Error('Login failed: Still on login page');
    }

    this.isLoggedIn = true;
    console.log('✅ Login successful!');
    console.log(`📍 Current URL: ${currentUrl}`);

    return true;
  }

  async getDashboardData() {
    if (!this.isLoggedIn) {
      throw new Error('Not logged in. Call login() first.');
    }

    console.log('📊 Fetching dashboard data...');

    // Navigate to dashboard if not already there
    if (!this.page.url().includes('/dashboard')) {
      await this.page.goto('https://app.utmify.com.br/dashboard/', {
        waitUntil: 'networkidle'
      });
    }

    await this.page.waitForTimeout(2000);

    // Extract visible metrics
    const metrics = await this.page.evaluate(() => {
      const data = {};

      // Try to find metric cards
      const cards = document.querySelectorAll('[class*="card"], [class*="metric"], [class*="stat"]');
      cards.forEach((card, index) => {
        const text = card.textContent?.trim();
        if (text) {
          data[`metric_${index}`] = text.substring(0, 200);
        }
      });

      // Get page title
      data.title = document.title;

      // Get any visible numbers/values
      const values = document.querySelectorAll('[class*="value"], [class*="number"], [class*="amount"]');
      values.forEach((el, index) => {
        const text = el.textContent?.trim();
        if (text) {
          data[`value_${index}`] = text;
        }
      });

      return data;
    });

    console.log('📈 Dashboard data:', JSON.stringify(metrics, null, 2));
    return metrics;
  }

  async navigateTo(path) {
    if (!this.isLoggedIn) {
      throw new Error('Not logged in. Call login() first.');
    }

    const url = path.startsWith('http') ? path : `https://app.utmify.com.br${path}`;
    console.log(`🔗 Navigating to ${url}...`);

    await this.page.goto(url, { waitUntil: 'networkidle' });
    await this.page.waitForTimeout(1000);

    return this.page.url();
  }

  async getPageContent() {
    const content = await this.page.evaluate(() => {
      return {
        title: document.title,
        url: window.location.href,
        text: document.body.innerText.substring(0, 5000)
      };
    });
    return content;
  }

  async screenshot(path = 'screenshot.png') {
    await this.page.screenshot({ path, fullPage: true });
    console.log(`📸 Screenshot saved to ${path}`);
    return path;
  }

  async executeAction(selector, action, value = null) {
    console.log(`⚡ Executing ${action} on ${selector}...`);

    const element = await this.page.$(selector);
    if (!element) {
      throw new Error(`Element not found: ${selector}`);
    }

    switch (action) {
      case 'click':
        await element.click();
        break;
      case 'fill':
        await element.fill(value);
        break;
      case 'select':
        await element.selectOption(value);
        break;
      case 'getText':
        return await element.textContent();
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    await this.page.waitForTimeout(500);
    return true;
  }

  async makeApiCall(endpoint, options = {}) {
    if (!this.authToken) {
      console.warn('⚠️ No auth token available, API call may fail');
    }

    // Make API call using page context (with cookies/auth)
    const result = await this.page.evaluate(async ({ endpoint, options, token }) => {
      const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...options.headers
      };

      const response = await fetch(endpoint, {
        method: options.method || 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined
      });

      return {
        status: response.status,
        data: await response.text()
      };
    }, { endpoint, options, token: this.authToken });

    console.log(`📡 API ${options.method || 'GET'} ${endpoint}: ${result.status}`);
    return result;
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      console.log('👋 Browser closed');
    }
  }
}

// Example usage and CLI
async function main() {
  const agent = new UTMifyAgent({
    email: process.env.UTMIFY_EMAIL || 'lucascardoso01@proton.me',
    password: process.env.UTMIFY_PASSWORD || '!Senha123',
    headless: process.env.HEADLESS !== 'false'
  });

  try {
    await agent.init();
    await agent.login();

    // Get dashboard data
    const dashData = await agent.getDashboardData();
    console.log('\n📊 Dashboard Summary:');
    console.log(JSON.stringify(dashData, null, 2));

    // Take a screenshot
    await agent.screenshot('dashboard.png');

    // Example: Navigate to a specific page
    // await agent.navigateTo('/settings');

    // Example: Make an API call
    // const apiResult = await agent.makeApiCall('/api/stats');
    // console.log('API Result:', apiResult);

  } catch (error) {
    console.error('❌ Error:', error.message);
    await agent.screenshot('error.png');
  } finally {
    await agent.close();
  }
}

// Export for use as a module
module.exports = { UTMifyAgent };

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}
