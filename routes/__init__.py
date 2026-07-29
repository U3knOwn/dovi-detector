# Copyright (c) 2026 Jamal2367
# Licensed under the MIT License. See LICENSE file in the project root for full license information.
"""
HTTP endpoints, grouped by what they are about.
"""
from routes import api_v1, entries, events, library, posters, scanning

BLUEPRINTS = (library.bp, scanning.bp, posters.bp, events.bp, entries.bp, api_v1.bp)


def register_routes(app):
    """Attach every endpoint to the application."""
    for blueprint in BLUEPRINTS:
        app.register_blueprint(blueprint)
