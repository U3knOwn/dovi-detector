// Internationalization support
let currentTranslations = {};
let currentLanguage = localStorage.getItem('dovi_language') || 'de';

// Load translations from server
async function loadTranslations(lang) {
    try {
        const response = await fetch(`/lang/${lang}`);
        if (!response.ok) {
            console.error('Failed to load translations:', response.statusText);
            return false;
        }
        currentTranslations = await response.json();
        currentLanguage = lang;
        localStorage.setItem('dovi_language', lang);
        return true;
    } catch (error) {
        console.error('Error loading translations:', error);
        return false;
    }
}

// Get translation by key path (e.g., "stats.media")
function t(key, replacements = {}) {
    const keys = key.split('.');
    let value = currentTranslations;
    
    for (const k of keys) {
        if (value && typeof value === 'object') {
            value = value[k];
        } else {
            return key; // Return key if translation not found
        }
    }
    
    // Replace placeholders like {count}, {error}, {message}
    if (typeof value === 'string') {
        Object.keys(replacements).forEach(placeholder => {
            value = value.replace(`{${placeholder}}`, replacements[placeholder]);
        });
    }
    
    return value || key;
}

// Update all elements with data-i18n attribute
function updatePageTranslations() {
    // Update text content
    document.querySelectorAll('[data-i18n]').forEach(element => {
        const key = element.getAttribute('data-i18n');
        element.textContent = t(key);
    });
    
    // Update HTML content (for elements with code tags, etc.)
    document.querySelectorAll('[data-i18n-html]').forEach(element => {
        const key = element.getAttribute('data-i18n-html');
        element.innerHTML = t(key);
    });
    
    // Update select options
    document.querySelectorAll('option[data-i18n]').forEach(option => {
        const key = option.getAttribute('data-i18n');
        option.textContent = t(key);
    });
    
    // Update data-label attributes in table cells
    document.querySelectorAll('td[data-label]').forEach(td => {
        const label = td.getAttribute('data-label');
        // Map label to translation key
        const labelMap = {
            'Poster / Dateiname': 'table.posterFilename',
            'HDR Format': 'table.hdrFormat',
            'Auflösung': 'table.resolution',
            'Audiocodec': 'table.audioCodec'
        };
        if (labelMap[label]) {
            td.setAttribute('data-label', t(labelMap[label]));
        }
    });
    
    // Update language button
    const langBtn = document.getElementById('currentLang');
    if (langBtn) {
        langBtn.textContent = currentLanguage.toUpperCase();
    }
    
    // Update HTML lang attribute
    document.documentElement.lang = currentLanguage;
}

// Toggle between languages
async function toggleLanguage() {
    const newLang = currentLanguage === 'de' ? 'en' : 'de';
    const success = await loadTranslations(newLang);
    if (success) {
        updatePageTranslations();
    }
}

// Bestehende Funktionen (startManualScan, loadFileList, scanSelectedFile) bleiben erhalten.
// Ich erweitere das Script um Sortier-Logik und Initialisierung.

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
            message.textContent = t('messages.scanComplete', { count: data.new_files });
        } else {
            message.classList.add('info');
            message.textContent = t('messages.noNewFiles');
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
        message.textContent = t('messages.scanError', { error: error });
    });
}
}

function loadFileList() {
    fetch('/get_files')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                const select = document.getElementById('fileSelect');
                // Clear existing options and add translated placeholder
                const placeholderOption = document.createElement('option');
                placeholderOption.value = '';
                placeholderOption.textContent = t('select.fileSelect');
                placeholderOption.setAttribute('data-i18n', 'select.fileSelect');
                select.innerHTML = '';
                select.appendChild(placeholderOption);
                
                // Add files to dropdown
                data.files.forEach(file => {
                    const option = document.createElement('option');
                    option.value = file.path;
                    option.textContent = file.name + (file.scanned ? ' ✓' : '');
                    option.setAttribute('data-i18n-skip', 'true'); // Don't translate file names
                    if (file.scanned) {
                        option.style.color = '#4ecca3';
                    }
                    select.appendChild(option);
                });

                // enable scan for selected file when choosing
				select.addEventListener('change', function() {
					const scanBtn = document.getElementById('scanFileButton');
					if (this.value) {
						scanBtn.classList.remove('hidden');
						scanBtn.disabled = false;
					} else {
						scanBtn.classList.add('hidden');
						scanBtn.disabled = true;
					}
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
            message.textContent = t('messages.fileScanSuccess', { message: data.message });
            
            // Reload file list and page
            loadFileList();
            setTimeout(() => {
                location.reload();
            }, 2000);
        } else {
            message.classList.add('info');
            message.textContent = t('messages.fileScanInfo', { message: data.message });
        }
        message.style.display = 'block';
    })
    .catch(error => {
        loading.classList.remove('active');
        button.disabled = false;
        message.className = 'message';
        message.style.display = 'block';
        message.textContent = t('messages.fileScanError', { error: error });
    });
}

/* -------------------------------
   Neue Sortier-Logik (client-side)
   ------------------------------- */

function getProfileRank(hdrFormat, hdrDetail, elType) {
    // Normalisiere Strings
    const f = (hdrFormat || '').toLowerCase();
    const d = (hdrDetail || '').toLowerCase();
    const e = (elType || '').toLowerCase();

    // 0: Profile 7 FEL
    if ((d.includes('profile 7') || d.includes('prof 7') || d.includes('p7') || d.includes('profile7') || f.includes('dolby vision') || f.includes('dolby')) && e.includes('fel')) {
        return 0;
    }
    // 1: Profile 7 MEL
    if ((d.includes('profile 7') || d.includes('prof 7') || d.includes('p7') || d.includes('profile7') || f.includes('dolby vision') || f.includes('dolby')) && e.includes('mel')) {
        return 1;
    }
    // 2: Profile 8
    if (d.includes('profile 8') || d.includes('profile8') || d.includes('p8') || f.includes('profile 8') || f.includes('p8') ) {
        return 2;
    }
    // 3: Profile 5
    if (d.includes('profile 5') || d.includes('profile5') || d.includes('p5') ) {
        return 3;
    }
    // 4: HDR10+
    if (f.includes('hdr10+') || d.includes('hdr10+') || f.includes('hdr10plus') || d.includes('hdr10plus')) {
        return 4;
    }
    // 5: HDR (HDR10 or HLG)
    if (f.includes('hdr10') || d.includes('hdr10') || f.includes('hlg') || d.includes('hlg') || f.includes('smpte2084') || d.includes('smpte2084')) {
        return 5;
    }
    // 6: SDR
    if (f.includes('sdr') || d.includes('sdr')) {
        return 6;
    }
    // 7: fallback / unknown
    return 7;
}

function getFilenameFromRow(row) {
    // Versuche mehrere Orte: title-Attribut, .poster-title, .filename-fallback
    const td = row.querySelector('td[data-label="Poster / Dateiname"]');
    if (!td) return '';
    // title attribute on td
    if (td.getAttribute('title')) return td.getAttribute('title').trim();
    const posterTitle = td.querySelector('.poster-title');
    if (posterTitle) return posterTitle.textContent.trim();
    const fallback = td.querySelector('.filename-fallback');
    if (fallback) return fallback.textContent.trim();
    return td.textContent.trim();
}

function sortTableByProfile() {
    const table = document.getElementById('mediaTable');
    if (!table) return;
    const tbody = table.querySelector('tbody');
    const rows = Array.from(tbody.querySelectorAll('tr'));

    rows.sort((a, b) => {
        const aFmt = a.getAttribute('data-hdr-format') || '';
        const aDet = a.getAttribute('data-hdr-detail') || '';
        const aEl  = a.getAttribute('data-el-type') || '';

        const bFmt = b.getAttribute('data-hdr-format') || '';
        const bDet = b.getAttribute('data-hdr-detail') || '';
        const bEl  = b.getAttribute('data-el-type') || '';

        const aRank = getProfileRank(aFmt, aDet, aEl);
        const bRank = getProfileRank(bFmt, bDet, bEl);

        if (aRank !== bRank) return aRank - bRank;

        // Wenn gleiche Priorität, sekundär nach Dateiname sortieren
        const aName = getFilenameFromRow(a).toLowerCase();
        const bName = getFilenameFromRow(b).toLowerCase();
        if (aName < bName) return -1;
        if (aName > bName) return 1;
        return 0;
    });

    // Reihenfolge im DOM aktualisieren
    rows.forEach(r => tbody.appendChild(r));
}

function sortTableByFilename() {
    const table = document.getElementById('mediaTable');
    if (!table) return;
    const tbody = table.querySelector('tbody');
    const rows = Array.from(tbody.querySelectorAll('tr'));

    rows.sort((a, b) => {
        const aName = getFilenameFromRow(a).toLowerCase();
        const bName = getFilenameFromRow(b).toLowerCase();
        if (aName < bName) return -1;
        if (aName > bName) return 1;
        return 0;
    });

    rows.forEach(r => tbody.appendChild(r));
}

function applySort(mode) {
    if (!mode) mode = localStorage.getItem('dovi_sort_mode') || 'filename';
    const select = document.getElementById('sortSelect');
    if (select) select.value = mode;

    if (mode === 'profile') {
        sortTableByProfile();
    } else {
        sortTableByFilename();
    }
}

document.addEventListener('DOMContentLoaded', async function() {
    // Load translations first
    await loadTranslations(currentLanguage);
    updatePageTranslations();
    
    // Lade Dateiliste für Scan-Dropdown
    loadFileList();

    // Initiale Sortierung anwenden
    applySort();

    // Listener für Sortenauswahl
    const sortSelect = document.getElementById('sortSelect');
    if (sortSelect) {
        sortSelect.addEventListener('change', function() {
            const mode = this.value || 'filename';
            localStorage.setItem('dovi_sort_mode', mode);
            applySort(mode);
        });
    }
});
