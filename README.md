# WordPress UI/UX MCP Server (`wordpress-ui-mcp`)

A full-control Model Context Protocol (MCP) server that gives AI IDE agents (like Antigravity) direct control over your WordPress UI/UX — working across **Gutenberg / Full Site Editing (FSE)**, **Global Styles (`theme.json`)**, **Page Builders (Elementor & Bricks)**, **Custom CSS**, and **Active Theme Files**.

---

## Architecture & What Tools the Agent Gets

| Tool Name | What It Controls in WordPress | Requires Companion Plugin? |
| :--- | :--- | :---: |
| `wp_get_site_overview` | Inspects active theme, site settings, and checks if the Companion Bridge Plugin is active | No |
| `wp_list_content` | Lists pages, posts, or custom post types with templates and slugs | No |
| `wp_get_content_ui` | Reads raw Gutenberg blocks (`<!-- wp:... -->`), HTML, template assignments, and post meta | No |
| `wp_update_content_ui` | Updates or creates pages/posts with new Gutenberg block layouts, HTML, templates, or meta | No |
| `wp_list_fse_templates` | Lists Full Site Editing Block Templates (`wp_template`) and Template Parts (`header`, `footer`) | No |
| `wp_get_fse_template` | Reads raw block markup of any FSE template or header/footer part | No |
| `wp_update_fse_template` | Modifies FSE block templates and headers/footers directly | No |
| `wp_get_global_styles` | Reads `theme.json` Global Styles (color palette, typography, spacing, layout tokens) | No |
| `wp_update_global_styles` | Updates site-wide design tokens (colors, fonts, buttons, layout widths, block styles) | No |
| `wp_navigation_menus` | Lists, reads, and updates FSE `wp_navigation` header/footer menus | No |
| `wp_update_custom_css` | Injects or appends site-wide Custom CSS (Global Styles CSS or Classic Customizer CSS) | Optional (Enables Classic Theme CSS) |
| `wp_page_builder_data` | Reads/writes Elementor (`_elementor_data`) or Bricks JSON trees and clears Elementor CSS cache | **Yes** |
| `wp_theme_files` | Lists, reads, and edits active theme files (`theme.json`, `style.css`, `functions.php`, `templates/*.html`) | **Yes** |
| `wp_rest_raw` | Executes any authenticated request against `/wp-json/*` (Media, Plugins, WooCommerce, etc.) | No |

---

## Step 1: Create a WordPress Application Password

1. Log in to your WordPress Admin Dashboard (`https://your-site.com/wp-admin`).
2. Go to **Users → Profile**.
3. Scroll down to **Application Passwords**.
4. Enter a name (e.g., `Antigravity IDE`) and click **Add New Application Password**.
5. Copy the generated password (e.g., `abcd efgh ijkl mnop qrst uvwx`).

---

## Step 2: (Optional) Install the Companion Bridge Plugin

Standard WordPress REST API endpoints let you edit Gutenberg blocks, FSE templates, and Global Styles out of the box.
If you **also** want the agent to:
- Edit active theme files on disk (`style.css`, `theme.json`, `functions.php`, `.html` templates)
- Edit **Elementor** or **Bricks** page builder layouts and auto-regenerate Elementor CSS caches
- Edit Classic Theme Customizer **Additional CSS** and auto-flush caching plugins (WP Rocket, LiteSpeed, W3TC)

Upload and activate [`wp-ui-mcp-bridge.zip`](./wp-plugin/wp-ui-mcp-bridge.zip) in **WP Admin → Plugins → Add New Plugin → Upload Plugin**.

---

## Step 3: Register the MCP Server in Antigravity IDE

Add `wordpress-ui` to your global MCP configuration file at `C:\Users\Kelvin Odems\.gemini\config\mcp_config.json` (or via **Additional Options (...) → MCP Servers**):

```json
{
  "mcpServers": {
    "wordpress-ui": {
      "command": "node",
      "args": [
        "c:\\Users\\Kelvin Odems\\Downloads\\Wordpress mcp\\src\\index.js"
      ],
      "env": {
        "WP_SITE_URL": "https://your-wordpress-site.com",
        "WP_USERNAME": "your-admin-username",
        "WP_APP_PASSWORD": "xxxx xxxx xxxx xxxx xxxx xxxx"
      }
    }
  }
}
```

*(Alternatively, copy `.env.example` to `.env` inside this folder and fill in your credentials).*

---

## Example Prompts You Can Give the Agent

Once connected, you can prompt the agent directly in the IDE:
- *"Check my WordPress site overview and show me the active theme and pages."*
- *"Update the Global Styles color palette to use `#0f172a` as contrast, `#3b82f6` as primary, and set headings to use Plus Jakarta Sans."*
- *"Inspect the Home page UI blocks and redesign the hero section with a modern dark-gradient cover block, two call-to-action buttons, and a 3-column feature grid below it."*
- *"Read the site header template part (`twentytwentyfour//header`) and add a sticky glassmorphism effect using Custom CSS."*
- *"Inspect the Elementor JSON layout on page ID 42 and update the pricing section headline and button colors."*
