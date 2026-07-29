#!/usr/bin/env python3
# Copyright (c) 2026 Jamal2367
# Licensed under the MIT License. See LICENSE file in the project root for full license information.
"""
Universal Video Scanner - Main Application

Wires the pieces together and starts them:

    config.py     configuration read from the environment
    core/         events, scan state, the scanner's dependencies, background work
    routes/       the HTTP endpoints
    services/     scanning, the online lookups and the database
    utils/        small helpers (files, translations, parsing)
    watchers/     the file system watcher
"""
from flask import Flask
from flask.helpers import send_from_directory

# Import configuration
import config

# Import utility functions
from utils.file_utils import copy_static_and_templates_to_data_dir

# Import core modules
from core.compression import register_compression
from core.events import deletion_event_queue
from core.scanner import delete_cached_poster_for, scan_video_file_with_deps
from core.tasks import start_background_tasks

# Import the HTTP endpoints
from routes import register_routes

# Import service modules
from services import database
from services.poster_service import migrate_poster_urls_to_cache

# Import watcher
from watchers.media_watcher import start_file_observer


def create_app():
    """Build the Flask application with its endpoints and response handling."""
    app = Flask(__name__,
                template_folder=config.TEMPLATES_DIR,
                static_folder=config.STATIC_DIR)
    register_routes(app)
    register_compression(app)
    return app


app = create_app()


def _use_data_directory_assets():
    """
    Serve the static files and templates from the data directory.

    They are copied there at startup so they can be edited from the host; this
    points Flask at the copies.
    """
    app.template_folder = config.get_templates_dir()
    app.static_folder = config.get_static_dir()

    # Flask caches the static folder path in its view function at initialization.
    # We need to update the static view function to use the new folder.
    # This ensures static files (CSS, JS, etc.) are served from the data directory.
    if app.static_folder and 'static' in app.view_functions:
        def updated_static(filename):
            """
            Updated static file handler that uses the new static folder.
            Flask's send_from_directory already handles path traversal security.
            """
            return send_from_directory(app.static_folder, filename)

        app.view_functions['static'] = updated_static

    print(f"Flask using templates from: {app.template_folder}")
    print(f"Flask using static files from: {app.static_folder}")


def _report_configuration():
    """Print what the scanner will and will not be able to do with these keys."""
    print(f"Content language: {config.CONTENT_LANGUAGE.upper()}")

    if config.API_TOKEN:
        origins = ', '.join(config.API_CORS_ORIGINS) if config.API_CORS_ORIGINS else 'same-origin only'
        print(f"✓ API enabled at /api/v1 (token required, CORS: {origins})")
    else:
        print("API disabled (set API_TOKEN to enable /api/v1)")

    if not config.REQUESTS_AVAILABLE:
        return

    print(f"Image source: {config.IMAGE_SOURCE.upper()}")
    if config.IMAGE_SOURCE == 'fanart':
        if config.FANART_API_KEY:
            print("✓ Fanart.tv API key configured")
        else:
            print("⚠ Warning: Fanart.tv selected but FANART_API_KEY not configured - no posters will be fetched")
    else:
        if config.IMAGE_SOURCE != 'tmdb':
            print(f"⚠ Warning: Unknown IMAGE_SOURCE '{config.IMAGE_SOURCE}' - defaulting to TMDB")
        if config.TMDB_API_KEY:
            print("✓ TMDB API key configured")
        else:
            print("⚠ Warning: TMDB selected but TMDB_API_KEY not configured - no posters will be fetched")

    if config.OMDB_API_KEY:
        print("✓ OMDb API key configured - IMDb ratings enabled")
    else:
        print("⚠ Warning: OMDB_API_KEY not configured - falling back to TMDB ratings")


def main():
    """Main application entry point"""
    print("=" * 50)
    print("Starting Universal Video Scanner")
    print("=" * 50)

    # Ensure all required directories exist
    config.ensure_directories()

    # Copy static and templates directories to data directory
    # This allows users to modify these files from the host system
    copy_static_and_templates_to_data_dir(
        config.STATIC_DIR,
        config.TEMPLATES_DIR,
        config.DATA_DIR
    )
    _use_data_directory_assets()

    # Load existing database
    database.load_database(config.DB_FILE)

    _report_configuration()

    # Migrate existing poster URLs to cached versions
    if config.REQUESTS_AVAILABLE:
        print("Migrating poster URLs to cache...")
        migrate_poster_urls_to_cache(
            database.scanned_files,
            database.scan_lock,
            lambda: database.save_database(config.DB_FILE),
            config.POSTER_CACHE_DIR
        )

    # Clean up database for non-existent files
    removed_count = database.cleanup_database(config.DB_FILE, delete_cached_poster_for)
    if removed_count > 0:
        print(f"Cleaned up {removed_count} entries for non-existent files")

    # Start file observer in background
    observer = start_file_observer(
        scan_video_file_with_deps,
        database.scanned_files,
        database.scanned_paths,
        database.scan_lock,
        lambda: database.save_database(config.DB_FILE),
        delete_cached_poster_for,
        deletion_event_queue
    )

    # Backfills, the metadata retry and the initial scan
    start_background_tasks()

    # Start Flask app
    try:
        app.run(host='0.0.0.0', port=2367, debug=False, threaded=True)
    except KeyboardInterrupt:
        print("Shutting down...")
        observer.stop()
        observer.join()


if __name__ == '__main__':
    main()
