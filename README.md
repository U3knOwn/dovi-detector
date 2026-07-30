# 🎟️ Universal Video Scanner

Automatic detection of HDR formats - including Dolby Vision enhancement layers -
in your video library, with a web interface and a versioned HTTP API.

Point it at a directory, and it watches for new files, probes each one with
[hdrprobe](https://github.com/matthane/hdrprobe) and [MediaInfo](https://mediaarea.net/en/MediaInfo), enriches the
result with posters and ratings, and shows the whole library on a dashboard at
port `2367`.

<a href="https://hub.docker.com/r/u3known/universal-video-scanner/" target="_blank">
  <img src="https://github.com/user-attachments/assets/5f58e083-eac7-4eab-84c7-bc75b204f246"
       alt="Docker Hub"
       width="250">
</a>

---

## Table of Contents

1. [Features](#1-features)
2. [Quick Start](#2-quick-start)
3. [Using the Scanner](#3-using-the-scanner)
4. [Configuration](#4-configuration)
5. [Metadata Sources](#5-metadata-sources)
6. [Customizing the Interface](#6-customizing-the-interface)
7. [The API](#7-the-api)
8. [How It Works](#8-how-it-works)
9. [Operating the Container](#9-operating-the-container)
10. [Troubleshooting](#10-troubleshooting)
11. [Development](#11-development)
12. [Project Info](#12-project-info)

---

## 1. Features

| | |
|---|---|
| **Automatic scanning** | Watchdog-based detection of new media files |
| **All HDR formats** | SDR, HDR10, HDR10+, HLG and Dolby Vision (all profiles) |
| **Enhancement layers** | MEL and FEL detection for every Dolby Vision profile |
| **Full HDR metadata** | Mastering display luminance, MaxCLL/MaxFALL, RPU L5/L6, CM version |
| **Blu-ray disc images** | `.iso` support - the main feature is found and analyzed in place |
| **Web interface** | Dark-theme dashboard on port `2367`, virtualized for large libraries |
| **Posters & ratings** | TMDB or Fanart.tv artwork, all ratings from MDBList - IMDb, Rotten Tomatoes (Tomatometer and Audience), Trakt and Metacritic - with TMDB fallback and an IMDb Top 250 badge |
| **Sorting & filtering** | Separate sort modes for IMDb, TMDb, Rotten Tomatoes (Tomatometer and Audience), Trakt and Metacritic, with a persistent direction toggle |
| **Title details** | Tagline above the plot, genres beside the directors, plot folded to five lines and expandable |
| **API** | Token-protected `/api/v1` - read the library filtered/sorted/paged, drive scans, follow progress live |
| **Docker-based** | One `docker-compose up -d` away |

---

## 2. Quick Start

### Prerequisites

- Docker
- Docker Compose

### Installation

```bash
git clone https://github.com/jamal2362/universal-video-scanner.git
cd universal-video-scanner
mkdir -p media
docker-compose up -d
```

Then open the web interface:

```
http://localhost:2367
```

The image is also published on
[Docker Hub](https://hub.docker.com/r/u3known/universal-video-scanner/) as
`u3known/universal-video-scanner`.

---

## 3. Using the Scanner

### Adding Media

Copy your video files into the `media/` directory:

```bash
cp /path/to/video.mkv ./media/
```

New files are detected automatically and analyzed in the background. A file is
only picked up once its size has stopped changing (see `FILE_WRITE_DELAY`), so
copies still in flight are never scanned half-written.

### Supported Formats

| Extension | Format |
|-----------|--------|
| `.mkv` | Matroska |
| `.mp4` | MP4 |
| `.m4v` | M4V |
| `.ts` | Transport Stream |
| `.m2ts` | BDAV Transport Stream |
| `.hevc` | HEVC raw stream |
| `.iso` | Blu-ray disc image (see below) |

### Manual Scan

If automatic detection missed a file:

1. Open the web interface
2. Click **🔍 Scan unscanned media**
3. Wait for the completion message

### The Dashboard

| Column | Description |
|--------|-------------|
| **Filename** | Name of the media file (or its poster, once artwork is available) |
| **HDR Format** | Detected format - SDR, HDR10, HDR10+, HLG, Dolby Vision with profile |
| **Resolution** | Video resolution, e.g. `3840x2160` |
| **Audio Codec** | Audio codec information, e.g. `Dolby TrueHD Atmos` |

On top of the table: a dark theme, auto-refresh every 10 seconds, live status
while a scan is running, and a search box plus sort controls that work on the
whole library.

---

## 4. Configuration

Everything is configured through environment variables in `docker-compose.yml`
(or a `.env` file next to it).

### Environment Variables

#### Scanning

| Variable | Default | Description |
|----------|---------|-------------|
| `FILE_WRITE_DELAY` | `5` | Seconds between file size checks - a new file is scanned once its size stops changing |
| `SCAN_WORKERS` | `1` | Files probed at once during a bulk scan. `1` = strictly sequential and light (best for a single spinning disk / NAS). Raise to `2`-`4` for SSD / NVMe / fast storage |
| `SCAN_SAVE_BATCH` | `25` | Newly scanned files buffered before the database is written. Avoids rewriting the whole database per file on a large library; an interrupted scan re-reads at most this many files. `1` persists after every file |
| `ISO_SAMPLE_SIZE_MB` | `16` | Size in MB of the main-feature `.m2ts` sample extracted from `.iso` images for MediaInfo analysis |

#### Metadata

| Variable | Default | Description |
|----------|---------|-------------|
| `TMDB_API_KEY` | *(empty)* | [TMDB](https://www.themoviedb.org/settings/api) key for posters and movie details (optional) |
| `FANART_API_KEY` | *(empty)* | [Fanart.tv](https://fanart.tv/get-an-api-key/) key for thumb posters (optional) |
| `MDBLIST_API_KEY` | *(empty)* | [MDBList](https://mdblist.com/preferences/) key for every rating - IMDb, Rotten Tomatoes Tomatometer and Audience, Trakt and Metacritic (optional - without it the TMDB rating is shown) |
| `OMDB_API_KEY` | *(empty)* | [OMDb](https://www.omdbapi.com/apikey.aspx) key, used only when no MDBList key is set. Knows no audience score and no Trakt rating |
| `IMAGE_SOURCE` | `tmdb` | Image source: `tmdb` or `fanart` |
| `CONTENT_LANGUAGE` | `en` | Preferred content language (ISO 639-1) for TMDB/Fanart.tv content and audio track selection |
| `METADATA_RETRY_INTERVAL` | `30` | Minutes between retries for entries whose online lookups came back incomplete (API down, rate limit, key added later). They fill themselves in without a rescan. `0` disables the retries |
| `METADATA_RETRY_BATCH` | `250` | Incomplete entries one retry run looks up. Keeps a large library from firing thousands of requests every interval; the run rotates, so every entry still gets its turn. `0` retries all of them |

#### Interface and API

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTO_REFRESH_INTERVAL` | `10` | Auto-refresh interval of the web UI in seconds |
| `API_TOKEN` | *(empty)* | Token for the `/api/v1` API. Without it the API is disabled (`503`). Generate one with `openssl rand -hex 32` |
| `API_CORS_ORIGINS` | *(empty)* | Comma-separated origins a **browser app** may call `/api/v1` from, or `*`. Empty = same-origin only; does not affect curl or server-side callers |

A non-numeric value for any numeric variable is logged and replaced with the
default rather than taking the service down.

### Volumes

| Host | Container | Contents |
|------|-----------|----------|
| `./media` | `/media` | Your media directory |
| `./data` | `/app/data` | Database, cached posters, static files and templates |

### Content Language

`CONTENT_LANGUAGE` controls two things: the language of TMDB/Fanart.tv titles,
descriptions and posters, and which audio track is picked as the primary one.

```yaml
environment:
  - CONTENT_LANGUAGE=de   # German
```

**Supported codes (ISO 639-1):** `en` (default), `de`, `ru`, `bg`, `fr`, `es`,
`it`, `pt`, `ja`, `ko`, `zh`, `nl`, `pl`, `sv`, `no`, `da`, `fi`, `tr`, `ar`,
`he`, `hi`, `th`, `cs`, `hu`, `ro`, `el`, `uk`.

**Fallbacks:** TMDB queries fall back to English when the content is not
available in the configured language. Audio track selection prefers the
configured language, then English (`eng`), then the first available track.

---

## 5. Metadata Sources

All four services are optional - without any key the app works normally and
shows filenames instead of posters.

### TMDB (posters, titles, plot, tagline, cast)

1. Get a free API key from [TMDB](https://www.themoviedb.org/settings/api)
2. Add it to `docker-compose.yml` or `.env`:

```yaml
environment:
  - TMDB_API_KEY=your_api_key_here
```

**Matching:** include `{tmdb-12345}` in the filename (e.g.
`Movie Name {tmdb-12345}.mkv`) to pin an entry to a specific TMDB ID. Without
one, TMDB is searched by the movie name extracted from the filename.

**Poster caching:** posters are downloaded into `/app/data/posters/` and reused
on later page loads, so bandwidth and load times stay low. Existing posters are
migrated into the cache at startup.

### Fanart.tv (alternative thumb posters)

1. Get a free API key from [Fanart.tv](https://fanart.tv/get-an-api-key/)
2. Enable it as the image source:

```yaml
environment:
  - FANART_API_KEY=your_api_key_here
  - IMAGE_SOURCE=fanart
```

Notes:

- Fanart.tv **requires** a TMDB ID in the filename: `{tmdb-12345}`
- Only movies are supported (TV shows would need a TVDB ID, which is not extracted)
- There is no fallback between sources - only the selected one is used
- Both keys may be configured, but only `IMAGE_SOURCE` decides which is used

### MDBList (all ratings)

An [MDBList](https://mdblist.com/preferences/) key makes the posters show the
IMDb rating and the IMDb Top 250 rank badge, and fills the rating row in the
details dialog with the IMDb, Rotten Tomatoes **Tomatometer** and **Audience**,
Trakt and Metacritic scores. Without it, the TMDB rating is shown instead.

```yaml
environment:
  - MDBLIST_API_KEY=your_api_key_here
```

One request per title returns every rating at once, so a title costs a single
call out of the free tier's 1000 per day. The same sources are also what the
sort dropdown offers, so the library can be ordered by any one of them.

### OMDb (fallback ratings)

[OMDb](https://www.omdbapi.com/apikey.aspx) is used only when no MDBList key is
set - it exists for installations that were configured before MDBList. It knows
the IMDb rating, the Rotten Tomatoes Tomatometer and Metacritic, but neither the
Rotten Tomatoes audience score nor the Trakt rating, so those stay empty.

```yaml
environment:
  - OMDB_API_KEY=your_api_key_here
```

Setting both keys is fine: MDBList answers, OMDb is never asked.

---

## 6. Customizing the Interface

Static files and templates are version-tracked copies under `./data/`, so your
changes survive restarts but still pick up new releases.

| Location | Path |
|----------|------|
| Host | `./data/static/` and `./data/templates/` |
| Container | `/app/data/static/` and `/app/data/templates/` |

**How it works:**

1. On first startup, `static/` and `templates/` are copied out of the container into `./data/`
2. You edit whatever you like - CSS, JS, HTML, translations
3. On restart your customizations are **preserved**; files are not overwritten
4. When you update the image (`docker-compose pull`), the app detects the new version and refreshes the files
5. After an update you can customize again, and those changes persist as before

All copied files and directories are writable by user and group, so no special
permissions are needed. Changes take effect after a container restart.

```bash
# Edit CSS styles (one file per part of the interface)
nano ./data/static/css/table.css

# Modify translations
nano ./data/static/locale/en.json

# Customize the HTML template
nano ./data/templates/index.html

# Change the behaviour of a part of the interface
nano ./data/static/js/library/sorting.js

# Apply the changes
docker-compose restart
```

---

## 7. The API

Other services - dashboards, automation, scripts - can read the library and
drive scans through a versioned API at `/api/v1`. It is **off** until you give
it a token.

### 7.1 Enabling It

```yaml
environment:
  - API_TOKEN=a-long-random-secret        # required, the API is off without it
  - API_CORS_ORIGINS=https://dash.local   # only for browser apps, see 7.8
```

Generate a token with `openssl rand -hex 32`. Without `API_TOKEN` every
`/api/v1` request answers `503 api_disabled` - an API that can empty the
database must not be open to whoever reaches the port.

### 7.2 Authentication

Every request carries the token, in whichever form suits the client:

```bash
curl -H "Authorization: Bearer $TOKEN" http://host:2367/api/v1/library
curl -H "X-API-Token: $TOKEN"          http://host:2367/api/v1/library
curl "http://host:2367/api/v1/library?token=$TOKEN"
```

The query parameter exists because the browser's `EventSource` cannot send
headers; prefer a header everywhere else, as URLs end up in logs and history.

### 7.3 Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1` | Version, the list of endpoints and the query options `/library` accepts |
| `GET` | `/api/v1/library` | Scanned entries: `{success, count, total, offset, limit, files:[…]}`. Filter, sort and page it - see [7.5](#75-narrowing-the-library-down) |
| `GET` | `/api/v1/library/stats` | Counts per HDR format, resolution and audio codec, plus the total size - without shipping the library |
| `GET` | `/api/v1/entries?file_path=…` | One entry by its path, without pulling the whole library |
| `GET` | `/api/v1/files` | Video files in the media directory: `{name, path, scanned}` |
| `GET` | `/api/v1/posters/<filename>` | The cached poster image an entry's `poster_url` names |
| `GET` | `/api/v1/scan/status` | `{running, scan:{…}}` - progress of the running scan |
| `GET` | `/api/v1/events` | Server-Sent Events: `scan_state`, `scan_progress`, `file_deleted` |
| `POST` | `/api/v1/scan` | Scan everything that is not in the library yet (returns `202`, runs in the background) |
| `POST` | `/api/v1/scan/files` | Scan `{"file_paths": ["/media/a.mkv", …]}` (`202`) |
| `POST` | `/api/v1/scan/cancel` | Stop the running scan (`202`); what it already scanned stays |
| `POST` | `/api/v1/entries/scan` | Scan one `{"file_path": "…"}` and wait for the result |
| `POST` | `/api/v1/entries/rescan` | Re-read one `{"file_path": "…"}` from scratch, including every online lookup |
| `POST` | `/api/v1/entries/delete` | Remove one `{"file_path": "…"}` from the library |
| `POST` | `/api/v1/database/clear` | Empty the library |

Only one scan runs at a time. While one is going - including the one that starts
with the application - `/scan` and `/scan/files` answer `409 scan_running`
instead of starting a second walk over the same media directory; follow the
running one at `/scan/status` or stop it at `/scan/cancel`.

### 7.4 Entry Fields

An entry in `/api/v1/library` holds: `filename`, `path`, `hdr_format`,
`hdr_detail`, `el_type`, `resolution`, `audio_codec`, `duration`,
`video_bitrate`, `audio_bitrate`, `file_size`, `mtime`, `dv_cm_version`,
`hdr_metadata`, `poster_url`, `tmdb_id`, `tmdb_title`, `tmdb_year`,
`tmdb_rating`, `tmdb_plot`, `tmdb_tagline`, `tmdb_directors`, `tmdb_cast`,
`tmdb_genres`, `imdb_id`, `imdb_rating`, `imdb_top250`, `rt_rating`,
`rt_audience`, `trakt_rating`, `metacritic`.

### 7.5 Narrowing the Library Down

`/api/v1/library` without parameters is the whole library. With them the server
does the work, instead of the client downloading thousands of entries to find a
handful:

| Parameter | Meaning |
|-----------|---------|
| `hdr_format`, `el_type`, `resolution`, `audio_codec` | Keep only entries whose field matches, compared case-insensitively (`hdr_format=dolby vision`, `el_type=FEL`) |
| `search` | Substring of the file name or the TMDB title |
| `sort` | `filename`, `tmdb_title`, `mtime`, `file_size`, `duration`, `tmdb_year`, `tmdb_rating`, `imdb_rating`, `rt_rating`, `rt_audience`, `trakt_rating`, `metacritic` (default `filename`) |
| `order` | `asc` (default) or `desc` |
| `limit`, `offset` | The window to return; `total` always counts every match before it |

An unknown `sort`, a non-numeric `limit` and the like are refused with
`400 invalid_parameter` rather than quietly ignored.

### 7.6 Posters

An entry's `poster_url` is `/poster/<name>.jpg` once the image has been cached.
The same file is served inside the API at `/api/v1/posters/<name>.jpg`, so a
consumer never has to leave the versioned surface:

```bash
curl -s -H "X-API-Token: $TOKEN" "$API/library?limit=1" \
  | jq -r '.files[0].poster_url | sub("^/poster/"; "")' \
  | xargs -I{} curl -s -H "X-API-Token: $TOKEN" -o poster.jpg "$API/posters/{}"
```

An entry whose image could **not** be cached carries the remote URL instead -
a `poster_url` beginning with `http` is fetched from its own host, not from here.

### 7.7 Following Along Live

`/api/v1/events` is a Server-Sent Events stream. It opens with a `scan_state`
event carrying the current state (so a client that connects mid-scan is not left
guessing until the next file finishes), then delivers `scan_progress` and
`file_deleted` as they happen. A scan reports `status` `scanning`, then `done`,
`cancelled` or `error`.

Every event carries an `id`. A client that reconnects with `Last-Event-ID` - the
browser's `EventSource` sends it by itself, others may pass
`?last_event_id=<id>` - is handed what it missed first, and the current state
after it. The stream also asks clients to wait 3 seconds before reconnecting,
and sends a comment every 30 seconds so an idle connection is not dropped as
dead.

### 7.8 Errors

Every answer carries `success`, **including the errors the framework itself
produces**: a path that does not exist, a method that is not allowed for one, or
an unhandled failure are JSON here, not HTML. A failure adds a human-readable
`error` and a machine-readable `code`, with the matching HTTP status:

| Code | Status | When |
|------|--------|------|
| `api_disabled` | `503` | No `API_TOKEN` is configured |
| `unauthorized` | `401` | Token missing or wrong |
| `not_found` | `404` | No such endpoint |
| `method_not_allowed` | `405` | Wrong method for the endpoint (the answer names the right ones in `Allow`) |
| `invalid_parameter` | `400` | A query parameter is not a number, or not one of the allowed values |
| `missing_file_path` / `missing_file_paths` | `400` | The body (or query) lacks the path(s) |
| `file_not_found` | `404` | The file itself is not there |
| `entry_not_found` | `404` | The library holds no entry for that path |
| `invalid_poster_name` / `poster_not_found` | `400` / `404` | Not a poster file name / no such cached poster |
| `scan_running` | `409` | A scan is already running |
| `no_scan_running` | `409` | Nothing to cancel |
| `scan_failed` / `rescan_failed` | `409`, `500` | The file could not be scanned |
| `delete_failed` / `clear_failed` | `500` | The library could not be changed |
| `media_unreadable` | `500` | The media directory could not be walked |
| `internal_error` | `500` | Unhandled failure - the reason is logged, not returned |

### 7.9 Browser Apps (CORS)

`curl`, scripts and server-side dashboards are never subject to CORS and need
nothing beyond the token. A web app served from **another** origin does: list
its origin in `API_CORS_ORIGINS` (comma-separated, or `*` for any). Left empty,
no CORS headers are sent and only same-origin requests work.

### 7.10 What the Token Does and Does Not Protect

The token guards `/api/v1`. The endpoints the web interface itself uses
(`/api/library`, `/get_files`, `/scan`, `/delete_entry`, …) stay open, because
the page has no token to send - anyone who can open the interface can already do
these things. So the token keeps automation honest and stable; it is not a lock
on the instance. To actually restrict access, put the whole thing behind a
reverse proxy with authentication, or keep the port on your LAN.

### 7.11 Examples

```bash
TOKEN=a-long-random-secret
API=http://host:2367/api/v1

# How many titles, by HDR format - the cheap call for a dashboard
curl -s -H "X-API-Token: $TOKEN" $API/library/stats | jq '.hdr_formats'

# Every Dolby Vision FEL title - filtered by the server, not by jq
curl -s -H "X-API-Token: $TOKEN" "$API/library?el_type=FEL" | jq '.files[].filename'

# The 20 largest titles, one page at a time
curl -s -H "X-API-Token: $TOKEN" "$API/library?sort=file_size&order=desc&limit=20"

# The 10 most recently added, and how many there are in total
curl -s -H "X-API-Token: $TOKEN" "$API/library?sort=mtime&order=desc&limit=10" \
  | jq '{total, showing: .count}'

# One entry, without downloading the library
curl -s -H "X-API-Token: $TOKEN" \
  --get --data-urlencode "file_path=/media/Film.mkv" $API/entries

# Scan everything new and follow along
curl -s -X POST -H "X-API-Token: $TOKEN" $API/scan
curl -sN "$API/events?token=$TOKEN"

# Changed your mind - what was scanned so far stays in the library
curl -s -X POST -H "X-API-Token: $TOKEN" $API/scan/cancel

# Re-read one entry
curl -s -X POST -H "X-API-Token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"file_path": "/media/Film.mkv"}' $API/entries/rescan
```

---

## 8. How It Works

### Scanner Workflow

1. **Watchdog** monitors `/media` for new files
2. **hdrprobe** analyzes the video and detects SDR, HDR10, HDR10+, HLG and
   Dolby Vision (profile, EL type, CM version) along with the static HDR
   metadata - mastering display luminance, MaxCLL/MaxFALL, the RPU's L6 values
   and L5 active area
3. **MediaInfo** extracts resolution, duration, audio codec and bitrate
4. **Online lookups** add poster, title, plot, cast and ratings
5. **Results** are written to the JSON database in batches

### Web Interface Rendering

The library page ships as a small shell and fetches the scanned entries from
`/api/library` as JSON. Sorting, searching and the statistics run on that data
in the browser, and only the rows currently in view are put into the DOM (from
120 entries upwards) - so a library of several thousand titles loads in a
fraction of a second instead of shipping megabytes of markup. Text responses are
gzip-compressed.

### Project Layout

```
universal-video-scanner/
├── app.py              # Entry point: builds the app and starts everything
├── config.py           # Configuration read from the environment
├── core/               # Events, scan state, scanner wiring, background tasks
│   ├── api_access.py   # API token check and CORS
│   ├── compression.py  # Gzip for text responses
│   ├── events.py       # Server-Sent Events fan-out, with ids and replay
│   ├── library_ops.py  # What can be done with the library, without HTTP
│   ├── posters.py      # Finding a cached poster on disk, safely
│   ├── scan_state.py   # Progress of the running scan, and its lifecycle
│   ├── scanner.py      # The scanner and its dependencies wired together
│   ├── sse.py          # The event stream both surfaces serve
│   └── tasks.py        # Backfills, metadata retry, initial scan
├── routes/             # HTTP endpoints, grouped by topic
│   ├── api_v1.py       # The public, versioned API (/api/v1)
│   ├── library.py      # / and /api/library
│   ├── scanning.py     # /scan, /scan_file(s), /get_files, /scan_status
│   ├── entries.py      # /delete_entry, /rescan_entry, /clear_database
│   ├── posters.py      # /poster/<file>
│   └── events.py       # /events
├── services/           # Scanning, online lookups, database
├── utils/              # File, media and translation helpers
├── watchers/           # File system watcher
├── static/
│   ├── css/            # One stylesheet per part of the interface
│   ├── js/             # ES modules
│   │   ├── main.js     # Entry point
│   │   ├── core/       # Translations, theme, server calls, live updates
│   │   ├── helpers/    # Formatting, ranking, small DOM helpers
│   │   ├── library/    # The entries, their sorting and the table
│   │   └── ui/         # Dialogs, dropdowns, buttons, layout
│   ├── fonts/          # Bundled fonts
│   └── locale/         # Translations
├── templates/          # HTML templates
├── Dockerfile          # Container definition
├── docker-compose.yml  # Deployment configuration
├── requirements.txt    # Python dependencies
├── media/              # Media directory (volume)
└── data/               # Database directory (volume)
    ├── scanned_files.json  # Video scan results
    ├── posters/            # Cached poster images
    ├── static/             # Static files (CSS, JS, fonts, locales)
    └── templates/          # HTML templates
```

### Technology Stack

- **Backend**: Python 3 + Flask
- **Scanner**: watchdog (filesystem events)
- **Video analysis**: hdrprobe + MediaInfo
- **Frontend**: HTML5 + CSS3 + vanilla JavaScript (ES modules)
- **Container**: Docker + Docker Compose

---

## 9. Operating the Container

```bash
# Start
docker-compose up -d

# Follow the logs
docker-compose logs -f

# Restart (customizations under ./data are preserved)
docker-compose restart

# Stop and remove the container
docker-compose down

# Rebuild after local changes
docker-compose up -d --build

# Update to a new image
docker-compose pull
docker-compose up -d
```

---

## 10. Troubleshooting

### The container won't start

```bash
docker-compose logs universal-video-scanner
```

### No files are being scanned

1. Check that the files really are in the `media/` directory
2. Trigger the manual scan button in the web interface
3. Watch the logs: `docker-compose logs -f`

### A Blu-ray image fails to analyze

Encrypted images are rejected by design. For decrypted ones, confirm that a
7-Zip >= 21.01 is available (the bundled image ships one) and try raising
`ISO_SAMPLE_SIZE_MB`.

### Posters or ratings are missing

Entries with incomplete online metadata are retried automatically every
`METADATA_RETRY_INTERVAL` minutes - including after you add an API key later, so
no rescan is needed. A title with no TMDB match at all stays without a poster.

### Reset the database

```bash
rm -f data/scanned_files.json
docker-compose restart
```

---

## 11. Development

### Running Locally Without Docker

```bash
# Install the Python dependencies
pip3 install -r requirements.txt

# mediainfo and hdrprobe must be installed manually.
# hdrprobe >= 1.0.0 is required - it emits the JSON schema 3.0 this app reads.

# Start the app, then open http://localhost:2367
python3 app.py
```

Note that `MEDIA_PATH` (`/media`) and `DATA_DIR` (`/app/data`) are absolute
container paths; a local run expects those to exist or be adjusted in
[config.py](config.py).

### Contributing

Pull requests and issues are welcome.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a pull request

---

## 12. Project Info

### License

MIT License - see [LICENSE](LICENSE).

### Credits

- [hdrprobe](https://github.com/matthane/hdrprobe) by matthane
- [MediaInfo](https://mediaarea.net/en/MediaInfo)
- [Flask](https://flask.palletsprojects.com/)
- [Watchdog](https://github.com/gorakhargosh/watchdog)

### Support

For questions or issues, please open an issue in the GitHub repository.
