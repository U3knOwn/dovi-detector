# Copyright (c) 2026 Jamal2367
# Licensed under the MIT License. See LICENSE file in the project root for full license information.
"""
The scanner and its dependencies wired together.

The service modules take every API call they need as an argument instead of
reaching for the configuration themselves, which keeps them testable. This is
the one place that ties them to the configured keys and paths.
"""
import config
from services.fanart_service import get_fanart_poster, get_fanart_portrait_by_id
from services.imdb_service import get_top250_rank
from services.poster_service import (delete_cached_poster, fetch_portrait,
                                     get_cached_backdrop_path,
                                     get_cached_portrait_path)
from services.ratings_service import get_ratings
from services.tmdb_service import (
    get_imdb_id, get_tmdb_credits, get_tmdb_details, get_tmdb_poster,
    get_tmdb_poster_by_id, get_tmdb_portrait_by_id
)
from services import database
from services.video_scanner import fetch_online_metadata, scan_video_file


def fetch_portrait_for(tmdb_id):
    """
    The upright cover for a TMDB id, from whichever source has one.

    Both sources are offered whatever ``IMAGE_SOURCE`` says: that setting picks
    where the 16:9 backdrop comes from, and the cover is a separate image with
    separate coverage - a title Fanart.tv has no cover for usually has one on
    TMDB, and the other way round.
    """
    return fetch_portrait(
        tmdb_id,
        lambda id_, media_type: get_tmdb_portrait_by_id(
            id_, media_type, config.TMDB_API_KEY, config.CONTENT_LANGUAGE),
        lambda id_, media_type: get_fanart_portrait_by_id(
            id_, media_type, config.FANART_API_KEY, config.CONTENT_LANGUAGE))


def cache_portrait_for(tmdb_id, portrait_url):
    """Wrapper for get_cached_portrait_path with the configured cache directory."""
    return get_cached_portrait_path(tmdb_id, portrait_url, config.POSTER_CACHE_DIR)


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
        lambda imdb_id, media_type=None: get_ratings(imdb_id, config.MDBLIST_API_KEY, media_type),
        lambda imdb_id: get_top250_rank(imdb_id, config.IMDB_TOP250_CACHE_FILE, config.IMDB_TOP250_TTL),
        lambda tmdb_id, media_type: get_tmdb_details(tmdb_id, media_type, config.TMDB_API_KEY, config.CONTENT_LANGUAGE),
        fetch_portrait_for,
        cache_portrait_for,
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
        lambda imdb_id, media_type=None: get_ratings(imdb_id, config.MDBLIST_API_KEY, media_type),
        lambda imdb_id: get_top250_rank(imdb_id, config.IMDB_TOP250_CACHE_FILE, config.IMDB_TOP250_TTL),
        lambda tmdb_id, media_type: get_tmdb_details(tmdb_id, media_type, config.TMDB_API_KEY, config.CONTENT_LANGUAGE),
        fetch_portrait_for,
        cache_portrait_for
    )


def delete_cached_poster_for(file_info):
    """Wrapper function for delete_cached_poster with dependencies"""
    return delete_cached_poster(file_info, config.POSTER_CACHE_DIR)
