<?php
/**
 * Plugin Name: WP UI/UX MCP Bridge
 * Description: Companion bridge plugin for the WordPress UI/UX MCP Server. Enables AI IDE agents to directly edit Customizer/Global CSS, Page Builder JSON (Elementor/Bricks), and active theme files (theme.json, CSS, HTML templates, PHP) with automatic cache flushing.
 * Version: 1.0.0
 * Author: Antigravity AI
 * License: MIT
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class WP_UI_MCP_Bridge {

	const NAMESPACE = 'wp-ui-mcp/v1';

	public static function init() {
		add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
	}

	public static function check_admin_permission() {
		return current_user_can( 'edit_theme_options' ) && current_user_can( 'manage_options' );
	}

	public static function register_routes() {
		// 1. Health & Capabilities Status
		register_rest_route(
			self::NAMESPACE,
			'/status',
			array(
				'methods'             => 'GET',
				'callback'            => array( __CLASS__, 'get_status' ),
				'permission_callback' => array( __CLASS__, 'check_admin_permission' ),
			)
		);

		// 2. Site-wide Custom CSS (Works for both Classic Customizer CSS and FSE Global Styles)
		register_rest_route(
			self::NAMESPACE,
			'/custom-css',
			array(
				array(
					'methods'             => 'GET',
					'callback'            => array( __CLASS__, 'get_custom_css' ),
					'permission_callback' => array( __CLASS__, 'check_admin_permission' ),
				),
				array(
					'methods'             => 'POST',
					'callback'            => array( __CLASS__, 'update_custom_css' ),
					'permission_callback' => array( __CLASS__, 'check_admin_permission' ),
				),
			)
		);

		// 3. Global Styles (theme.json user overrides)
		register_rest_route(
			self::NAMESPACE,
			'/global-styles',
			array(
				array(
					'methods'             => 'GET',
					'callback'            => array( __CLASS__, 'get_global_styles' ),
					'permission_callback' => array( __CLASS__, 'check_admin_permission' ),
				),
				array(
					'methods'             => 'POST',
					'callback'            => array( __CLASS__, 'update_global_styles' ),
					'permission_callback' => array( __CLASS__, 'check_admin_permission' ),
				),
			)
		);

		// 4. Page Builder Data (Elementor / Bricks / Custom Meta) + Cache Regeneration
		register_rest_route(
			self::NAMESPACE,
			'/builder/(?P<id>\d+)',
			array(
				array(
					'methods'             => 'GET',
					'callback'            => array( __CLASS__, 'get_builder_data' ),
					'permission_callback' => array( __CLASS__, 'check_admin_permission' ),
				),
				array(
					'methods'             => 'POST',
					'callback'            => array( __CLASS__, 'update_builder_data' ),
					'permission_callback' => array( __CLASS__, 'check_admin_permission' ),
				),
			)
		);

		// 5. Active Theme File Explorer & Editor
		register_rest_route(
			self::NAMESPACE,
			'/theme-files',
			array(
				'methods'             => 'GET',
				'callback'            => array( __CLASS__, 'list_theme_files' ),
				'permission_callback' => array( __CLASS__, 'check_admin_permission' ),
			)
		);

		register_rest_route(
			self::NAMESPACE,
			'/theme-file',
			array(
				array(
					'methods'             => 'GET',
					'callback'            => array( __CLASS__, 'read_theme_file' ),
					'permission_callback' => array( __CLASS__, 'check_admin_permission' ),
				),
				array(
					'methods'             => 'POST',
					'callback'            => array( __CLASS__, 'write_theme_file' ),
					'permission_callback' => array( __CLASS__, 'check_admin_permission' ),
				),
			)
		);
	}

	public static function get_status() {
		$theme = wp_get_theme();
		return rest_ensure_response(
			array(
				'installed'      => true,
				'version'        => '1.0.0',
				'wp_version'     => get_bloginfo( 'version' ),
				'is_block_theme' => function_exists( 'wp_is_block_theme' ) ? wp_is_block_theme() : false,
				'active_theme'   => array(
					'name'       => $theme->get( 'Name' ),
					'stylesheet' => get_stylesheet(),
					'template'   => get_template(),
					'version'    => $theme->get( 'Version' ),
				),
				'builders'       => array(
					'elementor' => did_action( 'elementor/loaded' ) || class_exists( '\Elementor\Plugin' ),
					'bricks'    => defined( 'BRICKS_VERSION' ),
				),
			)
		);
	}

	public static function get_custom_css() {
		$customizer_css = wp_get_custom_css();
		return rest_ensure_response(
			array(
				'stylesheet'     => get_stylesheet(),
				'customizer_css' => $customizer_css,
			)
		);
	}

	public static function update_custom_css( WP_REST_Request $request ) {
		$css    = (string) $request->get_param( 'css' );
		$append = (bool) $request->get_param( 'append' );

		if ( $append ) {
			$existing = wp_get_custom_css();
			$css      = trim( $existing . "\n\n" . $css );
		}

		$result = wp_update_custom_css_post( $css );
		if ( is_wp_error( $result ) ) {
			return $result;
		}

		self::flush_all_caches();

		return rest_ensure_response(
			array(
				'message' => 'Updated Custom CSS successfully.',
				'post_id' => $result->ID,
				'css'     => wp_get_custom_css(),
			)
		);
	}

	public static function get_global_styles() {
		if ( ! class_exists( 'WP_Theme_JSON_Resolver' ) ) {
			return new WP_Error( 'not_supported', 'Global Styles requires WordPress 5.9+.', array( 'status' => 400 ) );
		}

		$user_cpt = WP_Theme_JSON_Resolver::get_user_data_from_wp_global_styles( wp_get_theme(), true );
		$decoded  = json_decode( $user_cpt['post_content'], true );

		return rest_ensure_response(
			array(
				'id'       => $user_cpt['ID'],
				'settings' => isset( $decoded['settings'] ) ? $decoded['settings'] : new stdClass(),
				'styles'   => isset( $decoded['styles'] ) ? $decoded['styles'] : new stdClass(),
			)
		);
	}

	public static function update_global_styles( WP_REST_Request $request ) {
		if ( ! class_exists( 'WP_Theme_JSON_Resolver' ) ) {
			return new WP_Error( 'not_supported', 'Global Styles requires WordPress 5.9+.', array( 'status' => 400 ) );
		}

		$user_cpt = WP_Theme_JSON_Resolver::get_user_data_from_wp_global_styles( wp_get_theme(), true );
		$content  = json_decode( $user_cpt['post_content'], true );
		if ( ! is_array( $content ) ) {
			$content = array(
				'version'                     => 2,
				'isGlobalStylesUserThemeJSON' => true,
			);
		}

		$settings = $request->get_param( 'settings' );
		$styles   = $request->get_param( 'styles' );

		if ( null !== $settings ) {
			$content['settings'] = $settings;
		}
		if ( null !== $styles ) {
			$content['styles'] = $styles;
		}

		$updated = wp_update_post(
			array(
				'ID'           => $user_cpt['ID'],
				'post_content' => wp_slash( wp_json_encode( $content ) ),
			),
			true
		);

		if ( is_wp_error( $updated ) ) {
			return $updated;
		}

		self::flush_all_caches();

		return rest_ensure_response(
			array(
				'message'  => 'Updated Global Styles successfully.',
				'id'       => $user_cpt['ID'],
				'settings' => isset( $content['settings'] ) ? $content['settings'] : new stdClass(),
				'styles'   => isset( $content['styles'] ) ? $content['styles'] : new stdClass(),
			)
		);
	}

	public static function get_builder_data( WP_REST_Request $request ) {
		$post_id  = (int) $request->get_param( 'id' );
		$builder  = $request->get_param( 'builder' ) ? $request->get_param( 'builder' ) : 'elementor';
		$meta_key = $request->get_param( 'meta_key' );

		if ( ! $meta_key ) {
			$meta_key = ( 'bricks' === $builder ) ? '_bricks_page_content_2' : '_elementor_data';
		}

		$raw = get_post_meta( $post_id, $meta_key, true );
		$decoded = is_string( $raw ) ? json_decode( $raw, true ) : $raw;

		return rest_ensure_response(
			array(
				'post_id'  => $post_id,
				'builder'  => $builder,
				'meta_key' => $meta_key,
				'data'     => ( null !== $decoded && false !== $decoded ) ? $decoded : $raw,
			)
		);
	}

	public static function update_builder_data( WP_REST_Request $request ) {
		$post_id  = (int) $request->get_param( 'id' );
		$builder  = $request->get_param( 'builder' ) ? $request->get_param( 'builder' ) : 'elementor';
		$meta_key = $request->get_param( 'meta_key' );
		$data     = $request->get_param( 'data' );

		if ( ! $meta_key ) {
			$meta_key = ( 'bricks' === $builder ) ? '_bricks_page_content_2' : '_elementor_data';
		}

		if ( 'elementor' === $builder ) {
			$json_string = is_string( $data ) ? $data : wp_json_encode( $data );
			update_post_meta( $post_id, '_elementor_data', wp_slash( $json_string ) );
			update_post_meta( $post_id, '_elementor_edit_mode', 'builder' );

			if ( class_exists( '\Elementor\Plugin' ) ) {
				\Elementor\Plugin::$instance->files_manager->clear_cache();
			}
		} else {
			update_post_meta( $post_id, $meta_key, $data );
		}

		self::flush_all_caches();

		return rest_ensure_response(
			array(
				'message'  => "Updated {$builder} data for post {$post_id} and cleared cache.",
				'post_id'  => $post_id,
				'meta_key' => $meta_key,
			)
		);
	}

	public static function list_theme_files() {
		$theme_dir = get_stylesheet_directory();
		$files     = self::scan_dir_recursive( $theme_dir, $theme_dir );

		return rest_ensure_response(
			array(
				'stylesheet' => get_stylesheet(),
				'theme_root' => $theme_dir,
				'files'      => $files,
			)
		);
	}

	private static function scan_dir_recursive( $dir, $base_dir ) {
		$results = array();
		$items   = scandir( $dir );
		if ( ! $items ) {
			return $results;
		}

		foreach ( $items as $item ) {
			if ( '.' === $item || '..' === $item || '.git' === $item || 'node_modules' === $item ) {
				continue;
			}
			$full_path = $dir . DIRECTORY_SEPARATOR . $item;
			$rel_path  = ltrim( str_replace( '\\', '/', substr( $full_path, strlen( $base_dir ) ) ), '/' );

			if ( is_dir( $full_path ) ) {
				$results = array_merge( $results, self::scan_dir_recursive( $full_path, $base_dir ) );
			} else {
				$results[] = array(
					'path' => $rel_path,
					'size' => filesize( $full_path ),
				);
			}
		}
		return $results;
	}

	private static function resolve_safe_theme_path( $relative_path ) {
		$theme_dir = realpath( get_stylesheet_directory() );
		$clean_rel = ltrim( str_replace( array( '..', '\\' ), array( '', '/' ), (string) $relative_path ), '/' );
		$target    = $theme_dir . DIRECTORY_SEPARATOR . str_replace( '/', DIRECTORY_SEPARATOR, $clean_rel );

		$parent_dir = realpath( dirname( $target ) );
		if ( $parent_dir && 0 !== strpos( $parent_dir, $theme_dir ) ) {
			return new WP_Error( 'forbidden_path', 'Path traversal outside active theme directory is forbidden.', array( 'status' => 403 ) );
		}

		return $target;
	}

	public static function read_theme_file( WP_REST_Request $request ) {
		$rel_path = $request->get_param( 'path' );
		$target   = self::resolve_safe_theme_path( $rel_path );
		if ( is_wp_error( $target ) ) {
			return $target;
		}

		if ( ! file_exists( $target ) || ! is_file( $target ) ) {
			return new WP_Error( 'not_found', "Theme file '{$rel_path}' not found.", array( 'status' => 404 ) );
		}

		return rest_ensure_response(
			array(
				'path'    => $rel_path,
				'content' => file_get_contents( $target ),
			)
		);
	}

	public static function write_theme_file( WP_REST_Request $request ) {
		if ( ! current_user_can( 'edit_themes' ) && ! current_user_can( 'manage_options' ) ) {
			return new WP_Error( 'forbidden', 'Insufficient permissions to write theme files.', array( 'status' => 403 ) );
		}

		$rel_path = $request->get_param( 'path' );
		$content  = (string) $request->get_param( 'content' );
		$target   = self::resolve_safe_theme_path( $rel_path );
		if ( is_wp_error( $target ) ) {
			return $target;
		}

		$dir = dirname( $target );
		if ( ! is_dir( $dir ) ) {
			wp_mkdir_p( $dir );
		}

		$bytes = file_put_contents( $target, $content );
		if ( false === $bytes ) {
			return new WP_Error( 'write_failed', "Failed to write to '{$rel_path}'. Check filesystem permissions.", array( 'status' => 500 ) );
		}

		self::flush_all_caches();

		return rest_ensure_response(
			array(
				'message'       => "Saved '{$rel_path}' ({$bytes} bytes).",
				'path'          => $rel_path,
				'bytes_written' => $bytes,
			)
		);
	}

	private static function flush_all_caches() {
		wp_cache_flush();
		if ( function_exists( 'wp_clean_themes_cache' ) ) {
			wp_clean_themes_cache();
		}
		if ( function_exists( 'rocket_clean_domain' ) ) {
			rocket_clean_domain();
		}
		if ( class_exists( 'LiteSpeed_Cache_API' ) && method_exists( 'LiteSpeed_Cache_API', 'purge_all' ) ) {
			LiteSpeed_Cache_API::purge_all();
		}
		if ( function_exists( 'w3tc_flush_all' ) ) {
			w3tc_flush_all();
		}
	}
}

WP_UI_MCP_Bridge::init();
