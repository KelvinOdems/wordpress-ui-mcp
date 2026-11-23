/**
 * WordPress REST API & UI Bridge Client
 * Supports both standard WP REST API (/wp/v2/*) and the optional Companion Bridge Plugin (/wp-ui-mcp/v1/*)
 */

export class WordPressClient {
  constructor({ siteUrl, username, appPassword, bearerToken }) {
    this.siteUrl = (siteUrl || process.env.WP_SITE_URL || "").replace(/\/+$/, "");
    this.username = username || process.env.WP_USERNAME || "";
    this.appPassword = appPassword || process.env.WP_APP_PASSWORD || "";
    this.bearerToken = bearerToken || process.env.WP_BEARER_TOKEN || "";
  }

  validateConfig() {
    if (!this.siteUrl) {
      throw new Error(
        "Missing WP_SITE_URL environment variable. Set WP_SITE_URL, WP_USERNAME, and WP_APP_PASSWORD in your MCP config or .env file."
      );
    }
    if (!this.bearerToken && (!this.username || !this.appPassword)) {
      throw new Error(
        "Missing authentication credentials. Provide WP_USERNAME + WP_APP_PASSWORD (or WP_BEARER_TOKEN)."
      );
    }
  }

  getAuthHeaders() {
    this.validateConfig();
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "WordPress-UI-MCP/1.0",
    };

    if (this.bearerToken) {
      headers["Authorization"] = `Bearer ${this.bearerToken}`;
    } else {
      const token = Buffer.from(`${this.username}:${this.appPassword}`).toString("base64");
      headers["Authorization"] = `Basic ${token}`;
    }
    return headers;
  }

  /**
   * Make an authenticated request to the WordPress REST API.
   * Automatically handles /wp-json/ prefixing.
   */
  async request(endpoint, { method = "GET", params = {}, body = undefined } = {}) {
    const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
    const baseApi = this.siteUrl.endsWith("/wp-json")
      ? this.siteUrl
      : `${this.siteUrl}/wp-json`;

    const url = new URL(`${baseApi}${cleanEndpoint}`);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") {
        url.searchParams.set(k, String(v));
      }
    }

    const options = {
      method,
      headers: this.getAuthHeaders(),
    };

    if (body !== undefined && method !== "GET") {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url.toString(), options);
    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { rawResponse: text };
    }

    if (!response.ok) {
      const msg = data?.message || response.statusText || "Unknown WordPress API error";
      const code = data?.code || `HTTP_${response.status}`;
      throw new Error(`WordPress API Error [${code}] (${response.status}): ${msg}`);
    }

    return data;
  }
}
