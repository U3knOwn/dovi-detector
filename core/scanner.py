# Copyright (c) 2026 Jamal2367
# Licensed under the MIT License. See LICENSE file in the project root for full license information.
"""
The scanner and its dependencies wired together.

The service modules take every API call they need as an argument instead of
reaching for the configuration themselves, which keeps them testable. This is
the one place that ties them to the configured keys and paths.
"""
import config
from services.fanart_service import get_fanart_poster
from services.imdb_service import get_top250_rank
from services.poster_service import delete_cached_poster, get_cached_backdrop_path
from services.ratings_service import get_ratings
from services.tmdb_service import (
    get_imdb_id, get_tmdb_credits, get_tmdb_details, get_tmdb_poster,
    get_tmdb_poster_by_id
)
from services import database
from services.video_scanner import fetch_online_metadata, scan_video_file


# Helper function wrappers to pass dependencies to scan_video_file
def scan_video_file_with_deps(file_path, defer_save=False):
    """Wrapper function for scan_video_file with all dependencies"""
    return scan_video_file(
        file_path,
        database.scanned_paths,
        database.scanned_files,
        database.scan_lock,
        lambda: database.save_database(config.DB_FILE),
        lambda filename: get_fanart_poster(filename, config.FANART_API_KEY, config.CONTENT_LANGUAGE),
        lambda filename: get_tmdb_poster(filename, config.TMDB_API_KEY, config.CONTENT_LANGUAGE),
        lambda tmdb_id, media_type: get_tmdb_poster_by_id(tmdb_id, media_type, config.TMDB_API_KEY, config.CONTENT_LANGUAGE),
        lambda tmdb_id, media_type: get_tmdb_credits(tmdb_id, media_type, config.TMDB_API_KEY),
        lambda tmdb_id, poster_url: get_cached_backdrop_path(tmdb_id, poster_url, config.POSTER_CACHE_DIR),
        lambda tmdb_id, media_type: get_imdb_id(tmdb_id, media_type, config.TMDB_API_KEY),
        lambda imdb_id: get_ratings(imdb_id, config.MDBLIST_API_KEY),
        lambda imdb_id: get_top250_rank(imdb_id, config.IMDB_TOP250_CACHE_FILE, config.IMDB_TOP250_TTL),
        lambda tmdb_id, media_type: get_tmdb_details(tmdb_id, media_type, config.TMDB_API_KEY, config.CONTENT_LANGUAGE),
        defer_save=defer_save
    )


def fetch_online_metadata_with_deps(filename):
    """Wrapper for fetch_online_metadata with all dependencies"""
    return fetch_online_metadata(
        filename,
        lambda fn: get_fanart_poster(fn, config.FANART_API_KEY, config.CONTENT_LANGUAGE),
        lambda fn: get_tmdb_poster(fn, config.TMDB_API_KEY, config.CONTENT_LANGUAGE),
        lambda tmdb_id, media_type: get_tmdb_poster_by_id(tmdb_id, media_type, config.TMDB_API_KEY, config.CONTENT_LANGUAGE),
        lambda tmdb_id, media_type: get_tmdb_credits(tmdb_id, media_type, config.TMDB_API_KEY),
        lambda tmdb_id, poster_url: get_cached_backdrop_path(tmdb_id, poster_url, config.POSTER_CACHE_DIR),
        lambda tmdb_id, media_type: get_imdb_id(tmdb_id, media_type, config.TMDB_API_KEY),
        lambda imdb_id: get_ratings(imdb_id, config.MDBLIST_API_KEY),
        lambda imdb_id: get_top250_rank(imdb_id, config.IMDB_TOP250_CACHE_FILE, config.IMDB_TOP250_TTL),
        lambda tmdb_id, media_type: get_tmdb_details(tmdb_id, media_type, config.TMDB_API_KEY, config.CONTENT_LANGUAGE)
    )


def delete_cached_poster_for(file_info):
    """Wrapper function for delete_cached_poster with dependencies"""
    return delete_cached_poster(file_info, config.POSTER_CACHE_DIR)
