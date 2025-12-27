#!/usr/bin/env python3
import os
import json
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from flask import Flask, render_template_string, jsonify, request
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

app = Flask(__name__)

# Configuration
MEDIA_PATH = os.environ.get('MEDIA_PATH', '/media')
DATA_DIR = '/app/data'
DB_FILE = os.path.join(DATA_DIR, 'scanned_files.json')

# Scanner configuration constants (can be overridden by environment variables)
RPU_INFO_MAX_LENGTH = int(os.environ.get('RPU_INFO_MAX_LENGTH', '500'))
FILE_WRITE_DELAY = int(os.environ.get('FILE_WRITE_DELAY', '5'))
AUTO_REFRESH_INTERVAL = int(os.environ.get('AUTO_REFRESH_INTERVAL', '60'))

# Supported video formats
SUPPORTED_FORMATS = {'.mkv', '.mp4', '.m4v', '.ts', '.hevc'}

# Global data storage
scanned_files = {}
scanned_paths = set()
scan_lock = threading.Lock()

# Ensure data directory exists
os.makedirs(DATA_DIR, exist_ok=True)

def load_database():
    """Load previously scanned files from database"""
    global scanned_files, scanned_paths
    try:
        if os.path.exists(DB_FILE):
            with open(DB_FILE, 'r') as f:
                data = json.load(f)
                scanned_files = data.get('files', {})
                scanned_paths = set(data.get('paths', []))
                print(f"Loaded {len(scanned_files)} files from database")
    except Exception as e:
        print(f"Error loading database: {e}")
        scanned_files = {}
        scanned_paths = set()

def save_database():
    """Save scanned files to database"""
    try:
        with open(DB_FILE, 'w') as f:
            json.dump({
                'files': scanned_files,
                'paths': list(scanned_paths)
            }, f, indent=2)
    except Exception as e:
        print(f"Error saving database: {e}")

def extract_hevc_stream(video_file, output_file):
    """Extract HEVC stream from video file using ffmpeg (first 3 seconds only)"""
    try:
        cmd = [
            'ffmpeg', '-i', video_file,
            '-t', '3',  # Extract only first 3 seconds
            '-map', '0:v:0',
            '-c', 'copy',
            '-bsf:v', 'hevc_mp4toannexb',
            '-f', 'hevc',
            output_file,
            '-y'
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        return result.returncode == 0
    except Exception as e:
        print(f"Error extracting HEVC stream: {e}")
        return False

def extract_rpu(hevc_file, rpu_file):
    """Extract RPU from HEVC file using dovi_tool"""
    try:
        cmd = ['dovi_tool', 'extract-rpu', hevc_file, '-o', rpu_file]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        return result.returncode == 0 and os.path.exists(rpu_file)
    except Exception as e:
        print(f"Error extracting RPU: {e}")
        return False

def analyze_rpu(rpu_file):
    """Analyze RPU file using dovi_tool info"""
    try:
        cmd = ['dovi_tool', 'info', rpu_file]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode == 0:
            return result.stdout
        return None
    except Exception as e:
        print(f"Error analyzing RPU: {e}")
        return None

def get_video_resolution(video_file):
    """Get video resolution using ffprobe"""
    try:
        cmd = [
            'ffprobe', '-v', 'error',
            '-select_streams', 'v:0',
            '-show_entries', 'stream=width,height',
            '-of', 'json',
            video_file
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            data = json.loads(result.stdout)
            if 'streams' in data and len(data['streams']) > 0:
                stream = data['streams'][0]
                width = stream.get('width', 0)
                height = stream.get('height', 0)
                return f"{width}x{height}"
    except Exception as e:
        print(f"Error getting resolution: {e}")
    return "Unknown"

def parse_dovi_info(info_output):
    """Parse dovi_tool info output to extract profile and enhancement layer type"""
    profile = None
    el_type = None
    
    if not info_output:
        return profile, el_type
    
    lines = info_output.split('\n')
    for line in lines:
        line = line.strip()
        if 'Profile' in line or 'profile' in line:
            # Try to extract profile number
            if 'profile 7' in line.lower() or 'profile: 7' in line.lower():
                profile = 7
            elif 'dv profile 7' in line.lower():
                profile = 7
        
        if 'MEL' in line.upper():
            el_type = 'MEL'
        elif 'FEL' in line.upper():
            el_type = 'FEL'
    
    return profile, el_type

def scan_video_file(file_path):
    """Scan a single video file for Dolby Vision information"""
    print(f"Scanning: {file_path}")
    
    # Check if already scanned
    if file_path in scanned_paths:
        print(f"Already scanned: {file_path}")
        return None
    
    with tempfile.TemporaryDirectory() as tmpdir:
        hevc_file = os.path.join(tmpdir, 'stream.hevc')
        rpu_file = os.path.join(tmpdir, 'RPU.bin')
        
        # Extract HEVC stream
        if not extract_hevc_stream(file_path, hevc_file):
            print(f"Failed to extract HEVC stream from: {file_path}")
            return None
        
        # Extract RPU
        if not extract_rpu(hevc_file, rpu_file):
            print(f"No RPU found in: {file_path}")
            return None
        
        # Analyze RPU
        info_output = analyze_rpu(rpu_file)
        if not info_output:
            print(f"Failed to analyze RPU: {file_path}")
            return None
        
        # Parse info
        profile, el_type = parse_dovi_info(info_output)
        
        # Only process Profile 7
        if profile != 7:
            print(f"Not Profile 7: {file_path}")
            return None
        
        # Get resolution
        resolution = get_video_resolution(file_path)
        
        # Store result
        file_info = {
            'filename': os.path.basename(file_path),
            'path': file_path,
            'profile': profile,
            'el_type': el_type if el_type else 'Unknown',
            'resolution': resolution,
            'rpu_info': info_output[:RPU_INFO_MAX_LENGTH] if info_output else ''
        }
        
        with scan_lock:
            scanned_files[file_path] = file_info
            scanned_paths.add(file_path)
            save_database()
        
        print(f"Successfully scanned: {file_path} - Profile {profile} ({el_type})")
        return file_info

def scan_directory(directory):
    """Scan directory for video files"""
    if not os.path.exists(directory):
        print(f"Directory does not exist: {directory}")
        return []
    
    new_files = []
    for root, dirs, files in os.walk(directory):
        for file in files:
            ext = os.path.splitext(file)[1].lower()
            if ext in SUPPORTED_FORMATS:
                file_path = os.path.join(root, file)
                if file_path not in scanned_paths:
                    new_files.append(file_path)
    
    return new_files

def background_scan_new_files():
    """Background task to scan new files"""
    new_files = scan_directory(MEDIA_PATH)
    print(f"Found {len(new_files)} new files to scan")
    
    for file_path in new_files:
        try:
            scan_video_file(file_path)
        except Exception as e:
            print(f"Error scanning {file_path}: {e}")

class MediaFileHandler(FileSystemEventHandler):
    """Handle file system events for automatic scanning"""
    
    def on_created(self, event):
        if event.is_directory:
            return
        
        file_path = event.src_path
        ext = os.path.splitext(file_path)[1].lower()
        
        if ext in SUPPORTED_FORMATS:
            print(f"New file detected: {file_path}")
            # Wait to ensure file is fully written
            time.sleep(FILE_WRITE_DELAY)
            try:
                scan_video_file(file_path)
            except Exception as e:
                print(f"Error scanning new file {file_path}: {e}")

def start_file_observer():
    """Start watchdog observer for automatic file scanning"""
    if not os.path.exists(MEDIA_PATH):
        print(f"Creating media directory: {MEDIA_PATH}")
        os.makedirs(MEDIA_PATH, exist_ok=True)
    
    event_handler = MediaFileHandler()
    observer = Observer()
    observer.schedule(event_handler, MEDIA_PATH, recursive=True)
    observer.start()
    print(f"File observer started for: {MEDIA_PATH}")
    return observer

# HTML Template with Dark Theme
HTML_TEMPLATE = '''
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dolby Vision Profile 7 Scanner</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #1e1e2e 0%, #2d2d44 100%);
            color: #e0e0e0;
            min-height: 100vh;
            padding: 20px;
        }
        
        .container {
            max-width: 1400px;
            margin: 0 auto;
        }
        
        header {
            text-align: center;
            margin-bottom: 30px;
            padding: 20px;
            background: rgba(0, 0, 0, 0.3);
            border-radius: 10px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
        }
        
        h1 {
            font-size: 2.5em;
            color: #4ecca3;
            margin-bottom: 10px;
            text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
        }
        
        .subtitle {
            color: #a0a0a0;
            font-size: 1.1em;
        }
        
        .controls {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding: 15px;
            background: rgba(0, 0, 0, 0.3);
            border-radius: 10px;
        }
        
        .stats {
            color: #a0a0a0;
        }
        
        .stats strong {
            color: #4ecca3;
            font-size: 1.2em;
        }
        
        .button-group {
            display: flex;
            gap: 10px;
            align-items: center;
            flex-wrap: wrap;
        }
        
        #scanButton, #scanFileButton {
            background: linear-gradient(135deg, #4ecca3 0%, #3da88a 100%);
            color: #1e1e2e;
            border: none;
            padding: 12px 30px;
            font-size: 1em;
            font-weight: bold;
            border-radius: 25px;
            cursor: pointer;
            transition: all 0.3s ease;
            box-shadow: 0 4px 6px rgba(78, 204, 163, 0.3);
        }
        
        #scanButton:hover:not(:disabled), #scanFileButton:hover:not(:disabled) {
            transform: translateY(-2px);
            box-shadow: 0 6px 12px rgba(78, 204, 163, 0.4);
        }
        
        #scanButton:disabled, #scanFileButton:disabled {
            background: #555;
            cursor: not-allowed;
            box-shadow: none;
        }
        
        #fileSelect {
            background: rgba(0, 0, 0, 0.3);
            color: #e0e0e0;
            border: 2px solid #4ecca3;
            padding: 10px 15px;
            font-size: 1em;
            border-radius: 10px;
            cursor: pointer;
            min-width: 300px;
            max-width: 500px;
        }
        
        #fileSelect option {
            background: #2d2d44;
            color: #e0e0e0;
        }
        
        #fileSelect option:disabled {
            color: #666;
        }
        
        .loading {
            display: none;
            align-items: center;
            gap: 10px;
            color: #4ecca3;
        }
        
        .loading.active {
            display: flex;
        }
        
        .spinner {
            width: 20px;
            height: 20px;
            border: 3px solid rgba(78, 204, 163, 0.3);
            border-top-color: #4ecca3;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }
        
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        
        .message {
            padding: 10px 20px;
            border-radius: 5px;
            margin: 10px 0;
            display: none;
        }
        
        .message.success {
            background: rgba(78, 204, 163, 0.2);
            border: 1px solid #4ecca3;
            color: #4ecca3;
        }
        
        .message.info {
            background: rgba(100, 149, 237, 0.2);
            border: 1px solid #6495ED;
            color: #6495ED;
        }
        
        table {
            width: 100%;
            border-collapse: collapse;
            background: rgba(0, 0, 0, 0.3);
            border-radius: 10px;
            overflow: hidden;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
        }
        
        thead {
            background: linear-gradient(135deg, #4ecca3 0%, #3da88a 100%);
            color: #1e1e2e;
        }
        
        th {
            padding: 15px;
            text-align: left;
            font-weight: bold;
            text-transform: uppercase;
            font-size: 0.9em;
            letter-spacing: 1px;
        }
        
        td {
            padding: 15px;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
        }
        
        tbody tr {
            transition: background 0.2s ease;
        }
        
        tbody tr:hover {
            background: rgba(78, 204, 163, 0.1);
        }
        
        .profile-badge {
            display: inline-block;
            padding: 5px 12px;
            background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
            color: white;
            border-radius: 15px;
            font-weight: bold;
            font-size: 0.9em;
        }
        
        .el-badge {
            display: inline-block;
            padding: 5px 12px;
            border-radius: 15px;
            font-weight: bold;
            font-size: 0.9em;
        }
        
        .el-mel {
            background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
            color: white;
        }
        
        .el-fel {
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
            color: white;
        }
        
        .el-unknown {
            background: #555;
            color: #a0a0a0;
        }
        
        .resolution {
            color: #4ecca3;
            font-weight: bold;
        }
        
        .empty-state {
            text-align: center;
            padding: 60px 20px;
            color: #a0a0a0;
        }
        
        .empty-state h2 {
            font-size: 1.5em;
            margin-bottom: 10px;
        }
        
        .rpu-info {
            max-width: 300px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            color: #a0a0a0;
            font-size: 0.85em;
            font-family: monospace;
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>🎬 Dolby Vision Profile 7 Scanner</h1>
            <p class="subtitle">MEL/FEL Enhancement Layer Detection</p>
        </header>
        
        <div class="controls">
            <div class="stats">
                Gescannte Medien: <strong id="fileCount">{{ file_count }}</strong>
            </div>
            <div class="button-group">
                <div class="loading" id="loadingIndicator">
                    <div class="spinner"></div>
                    <span>Scanne Dateien...</span>
                </div>
                <button id="scanButton" onclick="startManualScan()">
                    🔍 Alle nicht gescannten Medien scannen
                </button>
            </div>
        </div>
        
        <div class="controls" style="margin-top: 10px;">
            <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
                <label for="fileSelect" style="color: #a0a0a0;">Einzelne Datei scannen:</label>
                <select id="fileSelect">
                    <option value="">-- Datei auswählen --</option>
                </select>
                <button id="scanFileButton" onclick="scanSelectedFile()" disabled>
                    ▶️ Ausgewählte Datei scannen
                </button>
            </div>
        </div>
        
        <div id="message" class="message"></div>
        
        {% if files %}
        <table>
            <thead>
                <tr>
                    <th>Dateiname</th>
                    <th>DV Profile</th>
                    <th>Enhancement Layer</th>
                    <th>Auflösung</th>
                    <th>RPU Info</th>
                </tr>
            </thead>
            <tbody>
                {% for file in files %}
                <tr>
                    <td title="{{ file.path }}">{{ file.filename }}</td>
                    <td><span class="profile-badge">Profile {{ file.profile }}</span></td>
                    <td>
                        <span class="el-badge el-{{ file.el_type.lower() }}">
                            {{ file.el_type }}
                        </span>
                    </td>
                    <td class="resolution">{{ file.resolution }}</td>
                    <td class="rpu-info" title="{{ file.rpu_info }}">{{ file.rpu_info[:100] }}</td>
                </tr>
                {% endfor %}
            </tbody>
        </table>
        {% else %}
        <div class="empty-state">
            <h2>Keine Dolby Vision Profile 7 Medien gefunden</h2>
            <p>Legen Sie Mediendateien im /media Verzeichnis ab oder klicken Sie auf "Nicht gescannte Medien scannen"</p>
        </div>
        {% endif %}
    </div>
    
    <script>
        function startManualScan() {
            const button = document.getElementById('scanButton');
            const loading = document.getElementById('loadingIndicator');
            const message = document.getElementById('message');
            
            // Disable button and show loading
            button.disabled = true;
            loading.classList.add('active');
            message.style.display = 'none';
            
            // Make AJAX request to scan endpoint
            fetch('/scan', {
                method: 'POST'
            })
            .then(response => response.json())
            .then(data => {
                // Hide loading
                loading.classList.remove('active');
                button.disabled = false;
                
                // Show message
                message.className = 'message';
                if (data.new_files > 0) {
                    message.classList.add('success');
                    message.textContent = `✓ Scan abgeschlossen! ${data.new_files} neue Datei(en) gefunden.`;
                } else {
                    message.classList.add('info');
                    message.textContent = 'ℹ Keine neuen Dateien gefunden.';
                }
                message.style.display = 'block';
                
                // Reload page if new files were found
                if (data.new_files > 0) {
                    setTimeout(() => {
                        location.reload();
                    }, 2000);
                }
            })
            .catch(error => {
                loading.classList.remove('active');
                button.disabled = false;
                message.className = 'message';
                message.style.display = 'block';
                message.textContent = '✗ Fehler beim Scannen: ' + error;
            });
        }
        
        function loadFileList() {
            fetch('/get_files')
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        const select = document.getElementById('fileSelect');
                        // Clear existing options except first
                        select.innerHTML = '<option value="">-- Datei auswählen --</option>';
                        
                        // Add files to dropdown
                        data.files.forEach(file => {
                            const option = document.createElement('option');
                            option.value = file.path;
                            option.textContent = file.name + (file.scanned ? ' ✓' : '');
                            if (file.scanned) {
                                option.style.color = '#4ecca3';
                            }
                            select.appendChild(option);
                        });
                    }
                })
                .catch(error => {
                    console.error('Error loading file list:', error);
                });
        }
        
        function scanSelectedFile() {
            const select = document.getElementById('fileSelect');
            const filePath = select.value;
            
            if (!filePath) {
                return;
            }
            
            const button = document.getElementById('scanFileButton');
            const loading = document.getElementById('loadingIndicator');
            const message = document.getElementById('message');
            
            // Disable button and show loading
            button.disabled = true;
            loading.classList.add('active');
            message.style.display = 'none';
            
            // Make AJAX request to scan specific file
            fetch('/scan_file', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ file_path: filePath })
            })
            .then(response => response.json())
            .then(data => {
                // Hide loading
                loading.classList.remove('active');
                button.disabled = false;
                
                // Show message
                message.className = 'message';
                if (data.success) {
                    message.classList.add('success');
                    message.textContent = '✓ ' + data.message;
                    
                    // Reload file list and page
                    loadFileList();
                    setTimeout(() => {
                        location.reload();
                    }, 2000);
                } else {
                    message.classList.add('info');
                    message.textContent = 'ℹ ' + data.message;
                }
                message.style.display = 'block';
            })
            .catch(error => {
                loading.classList.remove('active');
                button.disabled = false;
                message.className = 'message';
                message.style.display = 'block';
                message.textContent = '✗ Fehler beim Scannen: ' + error;
            });
        }
        
        // Enable/disable scan file button based on selection
        document.getElementById('fileSelect').addEventListener('change', function() {
            document.getElementById('scanFileButton').disabled = !this.value;
        });
        
        // Load file list on page load
        loadFileList();
        
        // Auto-refresh every configured interval to show new automatically scanned files
        setTimeout(() => {
            location.reload();
        }, {{ auto_refresh_interval }} * 1000);
    </script>
</body>
</html>
'''

@app.route('/')
def index():
    """Main page showing scanned files"""
    files_list = list(scanned_files.values())
    # Sort by filename
    files_list.sort(key=lambda x: x['filename'])
    
    return render_template_string(HTML_TEMPLATE, 
                                 files=files_list,
                                 file_count=len(files_list),
                                 auto_refresh_interval=AUTO_REFRESH_INTERVAL)

@app.route('/scan', methods=['POST'])
def manual_scan():
    """Endpoint for manual scan trigger"""
    try:
        initial_count = len(scanned_files)
        
        # Scan for new files
        new_files = scan_directory(MEDIA_PATH)
        
        # Scan each new file
        for file_path in new_files:
            try:
                scan_video_file(file_path)
            except Exception as e:
                print(f"Error scanning {file_path}: {e}")
        
        final_count = len(scanned_files)
        new_count = final_count - initial_count
        
        return jsonify({
            'success': True,
            'new_files': new_count,
            'total_files': final_count
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/get_files', methods=['GET'])
def get_files():
    """Get list of available video files for dropdown selection"""
    try:
        all_files = []
        for root, dirs, files in os.walk(MEDIA_PATH):
            for file in files:
                ext = os.path.splitext(file)[1].lower()
                if ext in SUPPORTED_FORMATS:
                    file_path = os.path.join(root, file)
                    relative_path = os.path.relpath(file_path, MEDIA_PATH)
                    is_scanned = file_path in scanned_paths
                    all_files.append({
                        'path': file_path,
                        'name': relative_path,
                        'scanned': is_scanned
                    })
        
        # Sort by name
        all_files.sort(key=lambda x: x['name'])
        
        return jsonify({
            'success': True,
            'files': all_files
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/scan_file', methods=['POST'])
def scan_single_file():
    """Endpoint to scan a specific file"""
    try:
        data = request.get_json()
        file_path = data.get('file_path')
        
        if not file_path:
            return jsonify({
                'success': False,
                'error': 'No file path provided'
            }), 400
        
        if not os.path.exists(file_path):
            return jsonify({
                'success': False,
                'error': 'File not found'
            }), 404
        
        # Scan the file
        result = scan_video_file(file_path)
        
        if result:
            return jsonify({
                'success': True,
                'message': f'File scanned successfully',
                'file_info': result
            })
        else:
            return jsonify({
                'success': False,
                'message': 'File was not Profile 7 or already scanned'
            })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

def main():
    """Main application entry point"""
    print("Starting Dolby Vision Profile 7 Scanner")
    
    # Load existing database
    load_database()
    
    # Start file observer in background
    observer = start_file_observer()
    
    # NOTE: Initial scan removed - user must manually trigger first scan via button
    print("Ready. Use the scan button in the web interface to start scanning.")
    
    # Start Flask app
    try:
        app.run(host='0.0.0.0', port=2367, debug=False)
    except KeyboardInterrupt:
        print("Shutting down...")
        observer.stop()
        observer.join()

if __name__ == '__main__':
    main()
