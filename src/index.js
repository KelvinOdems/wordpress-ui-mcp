#!/usr/bin/env node
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { WordPressClient } from "./wp-client.js";

const wp = new WordPressClient({});

const server = new McpServer({
  name: "wordpress-ui-mcp",
  version: "1.0.0",
});

function formatResult(data) {
  return {
    content: [
      {
        type: "text",
        text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

function formatError(err) {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: `Error: ${err.message || String(err)}`,
      },
    ],
  };
}

// ============================================================================
// 1. SITE & THEME OVERVIEW TOOLS
// ============================================================================

server.tool(
  "wp_get_site_overview",
  "Get WordPress site information, active theme details, stylesheet, template capabilities, and verify if the UI/UX Companion Bridge plugin is installed.",
  {},
  async () => {
    try {
      const [settings, themes] = await Promise.all([
        wp.request("/wp/v2/settings").catch((e) => ({ error: e.message })),
        wp.request("/wp/v2/themes", { params: { status: "active" } }).catch((e) => ({ error: e.message })),
      ]);

      let bridgeStatus = { installed: false };
      try {
        bridgeStatus = await wp.request("/wp-ui-mcp/v1/status");
      } catch {
        bridgeStatus = {
          installed: false,
          note: "Companion plugin 'wp-ui-mcp-bridge' not detected. Standard WP REST API tools work normally; install wp-plugin/wp-ui-mcp-bridge for direct PHP/CSS theme file editing and cache flushing.",
        };
      }

      return formatResult({
        siteUrl: wp.siteUrl,
        settings,
        activeThemes: themes,
        bridgePlugin: bridgeStatus,
      });
    } catch (err) {
      return formatError(err);
    }
  }
);

// ============================================================================
// 2. PAGES, POSTS & GUTENBERG BLOCK UI TOOLS
// ============================================================================

server.tool(
  "wp_list_content",
  "List WordPress pages, posts, or custom post types with their IDs, slugs, statuses, and templates.",
  {
    postType: z
      .string()
      .default("pages")
      .describe("REST endpoint plural slug, e.g., 'pages', 'posts', or custom post type rest_base"),
    search: z.string().optional().describe("Optional search query"),
    status: z
      .string()
      .default("publish,draft,private")
      .describe("Comma-separated post statuses (publish, draft, private)"),
    perPage: z.number().min(1).max(100).default(20),
  },
  async ({ postType, search, status, perPage }) => {
    try {
      const items = await wp.request(`/wp/v2/${postType}`, {
        params: {
          context: "edit",
          search,
          status,
          per_page: perPage,
        },
      });

      const summary = Array.isArray(items)
        ? items.map((item) => ({
            id: item.id,
            slug: item.slug,
            status: item.status,
            title: item.title?.raw ?? item.title?.rendered,
            template: item.template,
            link: item.link,
            modified: item.modified,
          }))
        : items;

      return formatResult(summary);
    } catch (err) {
      return formatError(err);
    }
  }
);

server.tool(
  "wp_get_content_ui",
  "Fetch the raw Gutenberg block markup, rendered HTML, page template assignment, and custom post meta (including Elementor/Bricks layout data if exposed) for a page or post.",
  {
    postType: z.string().default("pages").describe("'pages', 'posts', or custom post type rest_base"),
    id: z.number().describe("Numeric ID of the page or post"),
  },
  async ({ postType, id }) => {
    try {
      const item = await wp.request(`/wp/v2/${postType}/${id}`, {
        params: { context: "edit" },
      });

      return formatResult({
        id: item.id,
        slug: item.slug,
        status: item.status,
        title: item.title?.raw ?? item.title?.rendered,
        template: item.template,
        link: item.link,
        rawBlocksOrHtml: item.content?.raw,
        renderedHtml: item.content?.rendered,
        meta: item.meta || {},
      });
    } catch (err) {
      return formatError(err);
    }
  }
);

server.tool(
  "wp_update_content_ui",
  "Create or update a WordPress page or post's UI layout (raw Gutenberg blocks, HTML, Tailwind classes, title, page template, status, or meta fields).",
  {
    postType: z.string().default("pages").describe("'pages', 'posts', or custom post type rest_base"),
    id: z
      .number()
      .optional()
      .describe("ID of the existing page/post to update. Omit to create a new page/post."),
    title: z.string().optional().describe("Page/post title"),
    content: z
      .string()
      .optional()
      .describe("Full raw Gutenberg block markup (<!-- wp:... -->) or HTML content"),
    template: z.string().optional().describe("Block template or PHP page template slug"),
    status: z.enum(["publish", "draft", "private", "pending"]).optional(),
    slug: z.string().optional(),
    meta: z
      .record(z.any())
      .optional()
      .describe("Key-value map of post meta fields to update"),
  },
  async ({ postType, id, title, content, template, status, slug, meta }) => {
    try {
      const body = {};
      if (title !== undefined) body.title = title;
      if (content !== undefined) body.content = content;
      if (template !== undefined) body.template = template;
      if (status !== undefined) body.status = status;
      if (slug !== undefined) body.slug = slug;
      if (meta !== undefined) body.meta = meta;

      const endpoint = id ? `/wp/v2/${postType}/${id}` : `/wp/v2/${postType}`;
      const result = await wp.request(endpoint, {
        method: "POST",
        body,
      });

      return formatResult({
        message: id ? `Updated ${postType}/${id} successfully.` : `Created new item in ${postType}.`,
        id: result.id,
        link: result.link,
        status: result.status,
        template: result.template,
      });
    } catch (err) {
      return formatError(err);
    }
  }
);

// ============================================================================
// 3. FULL SITE EDITING (FSE): BLOCK TEMPLATES, HEADER/FOOTER PARTS & PATTERNS
// ============================================================================

server.tool(
  "wp_list_fse_templates",
  "List Full Site Editing (FSE) Block Templates (wp_template) or Template Parts like Header/Footer (wp_template_part).",
  {
    type: z
      .enum(["templates", "template-parts"])
      .default("templates")
      .describe("'templates' for full page layouts or 'template-parts' for headers/footers/sidebars"),
    area: z
      .string()
      .optional()
      .describe("Optional filter for template-parts area: 'header', 'footer', 'uncategorized'"),
  },
  async ({ type, area }) => {
    try {
      const items = await wp.request(`/wp/v2/${type}`, {
        params: { context: "edit", area },
      });

      const summary = Array.isArray(items)
        ? items.map((t) => ({
            id: t.id,
            slug: t.slug,
            theme: t.theme,
            type: t.type,
            area: t.area,
            title: t.title?.raw ?? t.title?.rendered,
            description: t.description,
            source: t.source,
            hasThemeFile: t.has_theme_file,
          }))
        : items;

      return formatResult(summary);
    } catch (err) {
      return formatError(err);
    }
  }
);

server.tool(
  "wp_get_fse_template",
  "Get the raw Gutenberg block markup of a specific Block Template or Template Part (e.g. 'twentytwentyfour//home' or 'twentytwentyfour//header').",
  {
    type: z.enum(["templates", "template-parts"]).default("templates"),
    id: z
      .string()
      .describe("Template compound ID in format 'theme_slug//template_slug', e.g., 'twentytwentyfour//header'"),
  },
  async ({ type, id }) => {
    try {
      const item = await wp.request(`/wp/v2/${type}/${id}`, {
        params: { context: "edit" },
      });
      return formatResult({
        id: item.id,
        slug: item.slug,
        title: item.title?.raw ?? item.title?.rendered,
        area: item.area,
        rawBlocks: item.content?.raw,
      });
    } catch (err) {
      return formatError(err);
    }
  }
);

server.tool(
  "wp_update_fse_template",
  "Update or create a Full Site Editing Block Template or Template Part (such as site header, footer, single post layout, or 404 template).",
  {
    type: z.enum(["templates", "template-parts"]).default("templates"),
    id: z
      .string()
      .describe("Template compound ID in format 'theme_slug//template_slug', e.g., 'twentytwentyfour//header'"),
    content: z.string().describe("Full raw Gutenberg block markup for the template or template part"),
    title: z.string().optional(),
    description: z.string().optional(),
  },
  async ({ type, id, content, title, description }) => {
    try {
      const body = { content };
      if (title !== undefined) body.title = title;
      if (description !== undefined) body.description = description;

      const updated = await wp.request(`/wp/v2/${type}/${id}`, {
        method: "POST",
        body,
      });

      return formatResult({
        message: `Successfully updated ${type} '${id}'`,
        id: updated.id,
        slug: updated.slug,
        source: updated.source,
      });
    } catch (err) {
      return formatError(err);
    }
  }
);

// ============================================================================
// 4. GLOBAL STYLES & DESIGN SYSTEM TOKENS (theme.json)
// ============================================================================

server.tool(
  "wp_get_global_styles",
  "Get the active theme's Global Styles (theme.json settings & styles: color palette, typography, spacing, layout dimensions, block defaults, and custom CSS).",
  {
    globalStylesId: z
      .number()
      .optional()
      .describe("Optional numeric Global Styles post ID. If omitted, automatically resolves the active theme's global styles."),
  },
  async ({ globalStylesId }) => {
    try {
      let targetId = globalStylesId;

      if (!targetId) {
        // Attempt via bridge plugin first, or resolve via active theme
        try {
          const bridgeGs = await wp.request("/wp-ui-mcp/v1/global-styles");
          if (bridgeGs?.id) {
            return formatResult(bridgeGs);
          }
        } catch {
          // Fallback to standard REST API discovery
        }

        const themes = await wp.request("/wp/v2/themes", { params: { status: "active" } });
        const activeTheme = Array.isArray(themes) ? themes[0] : null;
        const gsLink = activeTheme?._links?.["wp:user-global-styles"]?.[0]?.href;
        if (gsLink) {
          const match = gsLink.match(/global-styles\/(\d+)/);
          if (match) targetId = Number(match[1]);
        }
      }

      if (!targetId) {
        const themeConfig = await wp.request("/wp/v2/global-styles/themes/" + (await getActiveStylesheet()));
        return formatResult({
          note: "Returned read-only theme.json config. Pass globalStylesId or install wp-ui-mcp-bridge to auto-resolve user global styles ID.",
          themeConfig,
        });
      }

      const gs = await wp.request(`/wp/v2/global-styles/${targetId}`, {
        params: { context: "edit" },
      });

      return formatResult({
        id: gs.id,
        title: gs.title,
        settings: gs.settings,
        styles: gs.styles,
      });
    } catch (err) {
      return formatError(err);
    }
  }
);

async function getActiveStylesheet() {
  const themes = await wp.request("/wp/v2/themes", { params: { status: "active" } });
  if (Array.isArray(themes) && themes.length > 0) {
    return themes[0].stylesheet;
  }
  throw new Error("Could not determine active theme stylesheet.");
}

server.tool(
  "wp_update_global_styles",
  "Update WordPress Global Styles (theme.json user overrides): colors, typography, layout widths, block-level styles, and site-wide custom CSS (styles.css).",
  {
    globalStylesId: z
      .number()
      .optional()
      .describe("Global Styles ID (if omitted, resolved automatically from active theme)"),
    settings: z
      .record(z.any())
      .optional()
      .describe("theme.json 'settings' object (e.g. color.palette, typography.fontFamilies, layout)"),
    styles: z
      .record(z.any())
      .optional()
      .describe("theme.json 'styles' object (e.g. color, typography, spacing, elements, blocks, and 'css' for site-wide custom CSS)"),
  },
  async ({ globalStylesId, settings, styles }) => {
    try {
      let targetId = globalStylesId;
      if (!targetId) {
        const themes = await wp.request("/wp/v2/themes", { params: { status: "active" } });
        const activeTheme = Array.isArray(themes) ? themes[0] : null;
        const gsLink = activeTheme?._links?.["wp:user-global-styles"]?.[0]?.href;
        const match = gsLink?.match(/global-styles\/(\d+)/);
        if (match) targetId = Number(match[1]);
      }

      if (!targetId) {
        // Fallback to companion bridge endpoint if available
        const bridgeRes = await wp.request("/wp-ui-mcp/v1/global-styles", {
          method: "POST",
          body: { settings, styles },
        });
        return formatResult(bridgeRes);
      }

      const body = {};
      if (settings !== undefined) body.settings = settings;
      if (styles !== undefined) body.styles = styles;

      const updated = await wp.request(`/wp/v2/global-styles/${targetId}`, {
        method: "POST",
        body,
      });

      return formatResult({
        message: `Updated Global Styles (ID: ${targetId}) successfully.`,
        id: updated.id,
        settings: updated.settings,
        styles: updated.styles,
      });
    } catch (err) {
      return formatError(err);
    }
  }
);

// ============================================================================
// 5. CUSTOM CSS, SCRIPTS, PAGE BUILDERS & THEME FILE EDITING (Bridge + Fallback)
// ============================================================================

server.tool(
  "wp_update_custom_css",
  "Inject or update site-wide Custom CSS on the WordPress site (works via Global Styles CSS or the Companion Bridge Plugin's wp_get_custom_css / wp_update_custom_css_post).",
  {
    css: z.string().describe("Complete CSS stylesheet string to apply site-wide"),
    append: z
      .boolean()
      .default(false)
      .describe("If true, appends to existing custom CSS instead of replacing it"),
  },
  async ({ css, append }) => {
    try {
      // Try Companion Bridge first (works for both Classic and Block themes)
      try {
        const res = await wp.request("/wp-ui-mcp/v1/custom-css", {
          method: "POST",
          body: { css, append },
        });
        return formatResult(res);
      } catch {
        // Fallback to Global Styles styles.css via standard REST API
      }

      const themes = await wp.request("/wp/v2/themes", { params: { status: "active" } });
      const activeTheme = Array.isArray(themes) ? themes[0] : null;
      const gsLink = activeTheme?._links?.["wp:user-global-styles"]?.[0]?.href;
      const match = gsLink?.match(/global-styles\/(\d+)/);
      if (!match) {
        throw new Error(
          "Could not locate Global Styles endpoint for Custom CSS. Install the companion plugin 'wp-ui-mcp-bridge' for Classic Theme Customizer CSS support."
        );
      }

      const gsId = Number(match[1]);
      const currentGs = await wp.request(`/wp/v2/global-styles/${gsId}`, {
        params: { context: "edit" },
      });

      const existingCss = currentGs?.styles?.css || "";
      const nextCss = append && existingCss ? `${existingCss}\n\n${css}` : css;
      const nextStyles = { ...(currentGs.styles || {}), css: nextCss };

      const updated = await wp.request(`/wp/v2/global-styles/${gsId}`, {
        method: "POST",
        body: { styles: nextStyles },
      });

      return formatResult({
        message: "Updated site-wide Custom CSS via Global Styles.",
        cssLength: updated?.styles?.css?.length ?? nextCss.length,
      });
    } catch (err) {
      return formatError(err);
    }
  }
);

server.tool(
  "wp_page_builder_data",
  "Read or write Page Builder layout JSON (Elementor '_elementor_data', Bricks '_bricks_page_content_2', or arbitrary post meta) and regenerate builder CSS caches. Requires the Companion Bridge Plugin or REST-exposed meta.",
  {
    postId: z.number().describe("Numeric ID of the page or post"),
    action: z.enum(["get", "update"]).default("get"),
    builder: z
      .enum(["elementor", "bricks", "custom"])
      .default("elementor")
      .describe("Target page builder"),
    metaKey: z
      .string()
      .optional()
      .describe("Custom meta key when builder is 'custom' (defaults to '_elementor_data' for Elementor)"),
    data: z
      .any()
      .optional()
      .describe("JSON array/object or string to save when action is 'update'"),
  },
  async ({ postId, action, builder, metaKey, data }) => {
    try {
      const res = await wp.request(`/wp-ui-mcp/v1/builder/${postId}`, {
        method: action === "update" ? "POST" : "GET",
        params: action === "get" ? { builder, meta_key: metaKey } : {},
        body: action === "update" ? { builder, meta_key: metaKey, data } : undefined,
      });
      return formatResult(res);
    } catch (err) {
      return formatError(err);
    }
  }
);

server.tool(
  "wp_theme_files",
  "List, read, or write active theme files (style.css, theme.json, functions.php, templates/*.html, parts/*.html, assets/*.css, *.js) directly via the Companion Bridge Plugin.",
  {
    action: z.enum(["list", "read", "write"]).default("list"),
    relativePath: z
      .string()
      .optional()
      .describe("File path relative to the active theme root (e.g. 'theme.json', 'style.css', 'templates/index.html')"),
    content: z.string().optional().describe("New file content when action is 'write'"),
  },
  async ({ action, relativePath, content }) => {
    try {
      if (action === "list") {
        const res = await wp.request("/wp-ui-mcp/v1/theme-files", { method: "GET" });
        return formatResult(res);
      }
      if (!relativePath) {
        throw new Error("relativePath is required for 'read' and 'write' actions.");
      }
      if (action === "read") {
        const res = await wp.request("/wp-ui-mcp/v1/theme-file", {
          method: "GET",
          params: { path: relativePath },
        });
        return formatResult(res);
      }
      if (action === "write") {
        if (content === undefined) {
          throw new Error("content is required when action is 'write'.");
        }
        const res = await wp.request("/wp-ui-mcp/v1/theme-file", {
          method: "POST",
          body: { path: relativePath, content },
        });
        return formatResult(res);
      }
    } catch (err) {
      return formatError(err);
    }
  }
);

server.tool(
  "wp_navigation_menus",
  "List, read, or update WordPress Block Navigation menus (wp_navigation post type used in FSE headers/footers).",
  {
    action: z.enum(["list", "get", "update"]).default("list"),
    id: z.number().optional().describe("Navigation post ID for 'get' or 'update'"),
    title: z.string().optional(),
    content: z
      .string()
      .optional()
      .describe("Raw Gutenberg navigation block markup (<!-- wp:navigation-link ... /-->)"),
  },
  async ({ action, id, title, content }) => {
    try {
      if (action === "list") {
        const navs = await wp.request("/wp/v2/navigation", { params: { context: "edit" } });
        return formatResult(navs);
      }
      if (!id) throw new Error("id is required for 'get' and 'update'.");
      if (action === "get") {
        const nav = await wp.request(`/wp/v2/navigation/${id}`, { params: { context: "edit" } });
        return formatResult(nav);
      }
      const body = {};
      if (title !== undefined) body.title = title;
      if (content !== undefined) body.content = content;
      const updated = await wp.request(`/wp/v2/navigation/${id}`, {
        method: "POST",
        body,
      });
      return formatResult(updated);
    } catch (err) {
      return formatError(err);
    }
  }
);

server.tool(
  "wp_rest_raw",
  "Execute an arbitrary authenticated WordPress REST API request (e.g., '/wp/v2/media', '/wp/v2/block-patterns/patterns', '/wp/v2/plugins', '/wc/v3/products').",
  {
    endpoint: z.string().describe("REST API path starting with '/', e.g. '/wp/v2/types'"),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
    params: z.record(z.any()).optional().describe("URL query parameters"),
    body: z.record(z.any()).optional().describe("JSON request payload"),
  },
  async ({ endpoint, method, params, body }) => {
    try {
      const res = await wp.request(endpoint, { method, params, body });
      return formatResult(res);
    } catch (err) {
      return formatError(err);
    }
  }
);

// Start stdio transport
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error starting WordPress UI MCP server:", err);
  process.exit(1);
});
