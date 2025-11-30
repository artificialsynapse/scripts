/**
 * UTMify Dashboard Automation Agent
 *
 * Features:
 * - Automatic login with email/password
 * - Token management with auto-refresh
 * - API calls to dashboard endpoints
 * - Session persistence (optional)
 *
 * Usage:
 *   const agent = new UTMifyAgent({ email, password });
 *   await agent.init();
 *   await agent.login();
 *   const data = await agent.getDashboards();
 *
 * Environment variables:
 *   UTMIFY_EMAIL - Login email
 *   UTMIFY_PASSWORD - Login password
 *   HEADLESS - Set to "false" to see browser (default: true)
 *   SESSION_FILE - Path to save session for reuse
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

class UTMifyAgent {
  constructor(options = {}) {
    this.email = options.email || process.env.UTMIFY_EMAIL;
    this.password = options.password || process.env.UTMIFY_PASSWORD;
    this.headless = options.headless ?? (process.env.HEADLESS !== 'false');
    this.sessionFile = options.sessionFile || process.env.SESSION_FILE || null;

    this.browser = null;
    this.context = null;
    this.page = null;

    // Auth state
    this.authData = null;      // { token, refreshToken, expInSecs }
    this.userData = null;      // User info from login
    this.tokenExpiresAt = null;
    this.isLoggedIn = false;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════════════════

  async init() {
    console.log('🚀 Initializing UTMify Agent...');

    this.browser = await chromium.launch({
      headless: this.headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    // Try to load existing session
    if (this.sessionFile && fs.existsSync(this.sessionFile)) {
      console.log('📂 Loading saved session...');
      const sessionData = JSON.parse(fs.readFileSync(this.sessionFile, 'utf8'));
      this.context = await this.browser.newContext({ storageState: sessionData.storageState });
      this.authData = sessionData.authData;
      this.userData = sessionData.userData;
      this.tokenExpiresAt = new Date(sessionData.tokenExpiresAt);
    } else {
      this.context = await this.browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
        locale: 'pt-BR'
      });
    }

    this.page = await this.context.newPage();
    this._setupNetworkInterceptor();

    console.log('✅ Browser initialized');
    return this;
  }

  _setupNetworkInterceptor() {
    // Capture auth responses
    this.page.on('response', async (response) => {
      const url = response.url();

      // Capture login response
      if (url.includes('/users/auth') && response.status() === 200) {
        try {
          const data = await response.json();
          if (data.auth?.token) {
            this._setAuthData(data.auth, data.data);
            console.log('🔑 Auth token captured');
          }
        } catch (e) { /* Not JSON */ }
      }

      // Capture token refresh response
      if (url.includes('/users/refresh-token') && response.status() === 200) {
        try {
          const data = await response.json();
          if (data.token) {
            this.authData.token = data.token;
            if (data.refreshToken) this.authData.refreshToken = data.refreshToken;
            this._updateTokenExpiry(data.expInSecs || 3600);
            console.log('🔄 Token refreshed');
          }
        } catch (e) { /* Not JSON */ }
      }
    });
  }

  _setAuthData(auth, userData) {
    this.authData = {
      token: auth.token,
      refreshToken: auth.refreshToken,
      expInSecs: auth.expInSecs || 3600
    };
    this.userData = userData;
    this._updateTokenExpiry(auth.expInSecs || 3600);
  }

  _updateTokenExpiry(expInSecs) {
    // Set expiry to 90% of actual time (refresh early to be safe)
    const safeExpiry = expInSecs * 0.9 * 1000;
    this.tokenExpiresAt = new Date(Date.now() + safeExpiry);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // AUTHENTICATION
  // ═══════════════════════════════════════════════════════════════════════

  async login() {
    if (!this.email || !this.password) {
      throw new Error('Email and password are required');
    }

    // Check if we have a valid saved session
    if (this.authData && this.tokenExpiresAt && new Date() < this.tokenExpiresAt) {
      console.log('✅ Using existing valid session');
      this.isLoggedIn = true;
      return true;
    }

    // Try to refresh token if we have a refresh token
    if (this.authData?.refreshToken) {
      console.log('🔄 Attempting token refresh...');
      const refreshed = await this.refreshToken();
      if (refreshed) {
        this.isLoggedIn = true;
        return true;
      }
    }

    // Full login required
    console.log(`🔐 Logging in as ${this.email}...`);

    await this.page.goto('https://app.utmify.com.br/login/', {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    await this.page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 10000 });

    // Fill credentials
    const emailInput = await this.page.$('input[type="email"]') ||
                       await this.page.$('input[name="email"]');
    await emailInput.fill(this.email);

    const passwordInput = await this.page.$('input[type="password"]');
    await passwordInput.fill(this.password);

    // Submit
    const submitButton = await this.page.$('button[type="submit"]') ||
                         await this.page.$('button:has-text("Entrar")');

    await Promise.all([
      this.page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }).catch(() => {}),
      submitButton.click()
    ]);

    await this.page.waitForTimeout(3000);

    // Verify login success
    const currentUrl = this.page.url();
    if (currentUrl.includes('/login')) {
      const errorEl = await this.page.$('[class*="error"], [role="alert"]');
      if (errorEl) {
        const errorText = await errorEl.textContent();
        throw new Error(`Login failed: ${errorText}`);
      }
      throw new Error('Login failed: Still on login page');
    }

    this.isLoggedIn = true;
    console.log('✅ Login successful!');

    // Save session if configured
    await this._saveSession();

    return true;
  }

  async refreshToken() {
    if (!this.authData?.refreshToken) {
      console.log('❌ No refresh token available');
      return false;
    }

    try {
      const result = await this.page.evaluate(async (refreshToken) => {
        const response = await fetch('/users/refresh-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: refreshToken })
        });

        if (!response.ok) return null;
        return await response.json();
      }, this.authData.refreshToken);

      if (result?.token) {
        this.authData.token = result.token;
        if (result.refreshToken) this.authData.refreshToken = result.refreshToken;
        this._updateTokenExpiry(result.expInSecs || 3600);
        await this._saveSession();
        console.log('✅ Token refreshed successfully');
        return true;
      }
    } catch (e) {
      console.log('❌ Token refresh failed:', e.message);
    }

    return false;
  }

  async ensureValidToken() {
    if (!this.isLoggedIn) {
      await this.login();
      return;
    }

    // Check if token is expired or about to expire
    if (this.tokenExpiresAt && new Date() >= this.tokenExpiresAt) {
      console.log('⏰ Token expired, refreshing...');
      const refreshed = await this.refreshToken();
      if (!refreshed) {
        console.log('🔄 Refresh failed, re-logging in...');
        this.authData = null;
        await this.login();
      }
    }
  }

  async _saveSession() {
    if (!this.sessionFile) return;

    try {
      const storageState = await this.context.storageState();
      const sessionData = {
        storageState,
        authData: this.authData,
        userData: this.userData,
        tokenExpiresAt: this.tokenExpiresAt?.toISOString()
      };
      fs.writeFileSync(this.sessionFile, JSON.stringify(sessionData, null, 2));
      console.log('💾 Session saved');
    } catch (e) {
      console.log('⚠️ Failed to save session:', e.message);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // API CALLS
  // ═══════════════════════════════════════════════════════════════════════

  async apiCall(endpoint, options = {}) {
    await this.ensureValidToken();

    const result = await this.page.evaluate(async ({ endpoint, options, token }) => {
      const url = endpoint.startsWith('http') ? endpoint : endpoint;

      const fetchOptions = {
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
          ...options.headers
        }
      };

      if (options.body) {
        fetchOptions.body = JSON.stringify(options.body);
      }

      try {
        const response = await fetch(url, fetchOptions);
        const text = await response.text();

        let data;
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }

        return {
          ok: response.ok,
          status: response.status,
          data
        };
      } catch (error) {
        return {
          ok: false,
          status: 0,
          error: error.message
        };
      }
    }, { endpoint, options, token: this.authData?.token });

    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CONVENIENCE METHODS - Dashboard Data
  // ═══════════════════════════════════════════════════════════════════════

  async getDashboards() {
    console.log('📊 Fetching dashboards...');
    return this.apiCall('/dashboards');
  }

  async getDashboardSummary(dashboardId) {
    console.log(`📈 Fetching summary for dashboard ${dashboardId}...`);
    // Navigate to the summary page to trigger data load
    await this.page.goto(`https://app.utmify.com.br/dashboards/${dashboardId}/resumo`, {
      waitUntil: 'networkidle'
    });

    // Extract visible data
    return this.page.evaluate(() => {
      const data = {};

      // Get all text content from metric-like elements
      document.querySelectorAll('[class*="card"], [class*="metric"], [class*="stat"], [class*="value"]').forEach((el, i) => {
        const text = el.innerText?.trim();
        if (text && text.length < 500) {
          data[`element_${i}`] = text;
        }
      });

      return data;
    });
  }

  async getOrdersFilters(dashboardId) {
    console.log('🛒 Fetching order filters...');
    return this.apiCall('/orders/filters', {
      method: 'POST',
      body: { dashboardId }
    });
  }

  async getUserPlanInfo() {
    console.log('📋 Fetching plan info...');
    return this.apiCall('/users/plan-info');
  }

  async getMetaAdAccounts(dashboardId) {
    console.log('📘 Fetching Meta ad accounts...');
    return this.apiCall(`/dashboards/meta/ad-accounts/list`, {
      method: 'POST',
      body: { dashboardId }
    });
  }

  async getGoogleProfiles(dashboardId) {
    console.log('🔍 Fetching Google profiles...');
    return this.apiCall(`/dashboards/google/profiles/list`, {
      method: 'POST',
      body: { dashboardId }
    });
  }

  async getWebhooks(dashboardId) {
    console.log('🔗 Fetching webhooks...');
    return this.apiCall('/webhooks/objects/list', {
      method: 'POST',
      body: { dashboardId }
    });
  }

  async getApiCredentials(dashboardId) {
    console.log('🔑 Fetching API credentials...');
    return this.apiCall('/api-credentials/list', {
      method: 'POST',
      body: { dashboardId }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // UTILITY METHODS
  // ═══════════════════════════════════════════════════════════════════════

  async navigateTo(path) {
    await this.ensureValidToken();
    const url = path.startsWith('http') ? path : `https://app.utmify.com.br${path}`;
    console.log(`🔗 Navigating to ${url}...`);
    await this.page.goto(url, { waitUntil: 'networkidle' });
    return this.page.url();
  }

  async screenshot(filename = 'screenshot.png') {
    const filepath = path.resolve(filename);
    await this.page.screenshot({ path: filepath, fullPage: true });
    console.log(`📸 Screenshot saved: ${filepath}`);
    return filepath;
  }

  async getPageContent() {
    return this.page.evaluate(() => ({
      title: document.title,
      url: window.location.href,
      text: document.body.innerText.substring(0, 10000)
    }));
  }

  getAuthInfo() {
    return {
      isLoggedIn: this.isLoggedIn,
      email: this.userData?.user?.email,
      tokenExpiresAt: this.tokenExpiresAt,
      tokenExpiresIn: this.tokenExpiresAt
        ? Math.max(0, Math.round((this.tokenExpiresAt - new Date()) / 1000)) + 's'
        : null
    };
  }

  async close() {
    await this._saveSession();
    if (this.browser) {
      await this.browser.close();
      console.log('👋 Browser closed');
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CLI / Demo Usage
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  const agent = new UTMifyAgent({
    email: process.env.UTMIFY_EMAIL || 'lucascardoso01@proton.me',
    password: process.env.UTMIFY_PASSWORD || '!Senha123',
    headless: process.env.HEADLESS !== 'false',
    sessionFile: './utmify_session.json'  // Enable session persistence
  });

  try {
    await agent.init();
    await agent.login();

    // Show auth info
    console.log('\n📋 Auth Info:', agent.getAuthInfo());

    // Fetch dashboards
    const dashboards = await agent.getDashboards();
    console.log('\n📊 Dashboards:', JSON.stringify(dashboards, null, 2));

    // If we have dashboards, get more data
    if (dashboards.ok && dashboards.data?.length > 0) {
      const dashboardId = dashboards.data[0]._id || dashboards.data[0].id;

      if (dashboardId) {
        const orderFilters = await agent.getOrdersFilters(dashboardId);
        console.log('\n🛒 Order Filters:', JSON.stringify(orderFilters, null, 2));

        const planInfo = await agent.getUserPlanInfo();
        console.log('\n📋 Plan Info:', JSON.stringify(planInfo, null, 2));
      }
    }

    // Take screenshot
    await agent.screenshot('dashboard_screenshot.png');

  } catch (error) {
    console.error('❌ Error:', error.message);
    await agent.screenshot('error_screenshot.png');
  } finally {
    await agent.close();
  }
}

// Export for module use
module.exports = { UTMifyAgent };

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}
