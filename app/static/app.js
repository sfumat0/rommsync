// RommSync Frontend Application

const API_BASE = '';

// State
let currentView = 'platform';
let currentPlatform = null;
let platforms = [];
let currentRoms = [];
let currentFilter = 'all';
let multiSelectMode = false;
let selectedRoms = new Set();
let downloadQueue = [];
let activeDownloads = 0;
const MAX_CONCURRENT_DOWNLOADS = 2;
let currentRomIndex = 0;
let currentScreenshots = [];
let currentScreenshotIndex = 0;

// DOM Elements
const elements = {
    loading: document.getElementById('loading'),
    error: document.getElementById('error'),
    platformView: document.getElementById('platform-view'),
    romView: document.getElementById('rom-view'),
    detailModal: document.getElementById('detail-modal'),
    platformList: document.getElementById('platform-list'),
    romList: document.getElementById('rom-list'),
    platformSearch: document.getElementById('platform-search'),
    romSearch: document.getElementById('rom-search'),
    scanBtn: document.getElementById('scan-btn'),
    refreshBtn: document.getElementById('refresh-btn'),
    backBtn: document.getElementById('back-btn'),
    detailPrevBtn: document.getElementById('detail-prev-btn'),
    detailNextBtn: document.getElementById('detail-next-btn'),
    detailCloseBtn: document.getElementById('detail-close-btn'),
    detailPosition: document.getElementById('detail-position'),
    detailDownloadBtn: document.getElementById('detail-download-btn'),
    scanModal: document.getElementById('scan-modal'),
    localCount: document.getElementById('local-count'),
    rommCount: document.getElementById('romm-count'),
    scanStatus: document.getElementById('scan-status'),
    multiSelectBtn: document.getElementById('multi-select-btn'),
    batchActions: document.getElementById('batch-actions'),
    selectedCount: document.getElementById('selected-count'),
    downloadSelectedBtn: document.getElementById('download-selected-btn'),
    downloadAllMissingBtn: document.getElementById('download-all-missing-btn'),
    cancelSelectBtn: document.getElementById('cancel-select-btn'),
    downloadQueuePanel: document.getElementById('download-queue-panel'),
    toggleQueueBtn: document.getElementById('toggle-queue-btn'),
    queueList: document.getElementById('queue-list'),
    confirmModal: document.getElementById('confirm-modal'),
    confirmTitle: document.getElementById('confirm-title'),
    confirmMessage: document.getElementById('confirm-message'),
    confirmOkBtn: document.getElementById('confirm-ok-btn'),
    confirmCancelBtn: document.getElementById('confirm-cancel-btn'),
};

// Custom confirm dialog
function showConfirm(title, message) {
    return new Promise((resolve) => {
        elements.confirmTitle.textContent = title;
        elements.confirmMessage.innerHTML = message.replace(/\n/g, '<br>');
        elements.confirmModal.classList.remove('hidden');
        
        const handleOk = () => {
            elements.confirmModal.classList.add('hidden');
            elements.confirmOkBtn.removeEventListener('click', handleOk);
            elements.confirmCancelBtn.removeEventListener('click', handleCancel);
            resolve(true);
        };
        
        const handleCancel = () => {
            elements.confirmModal.classList.add('hidden');
            elements.confirmOkBtn.removeEventListener('click', handleOk);
            elements.confirmCancelBtn.removeEventListener('click', handleCancel);
            resolve(false);
        };
        
        elements.confirmOkBtn.addEventListener('click', handleOk);
        elements.confirmCancelBtn.addEventListener('click', handleCancel);
    });
}

// Utility Functions
function showLoading(show = true) {
    elements.loading.classList.toggle('hidden', !show);
}

function showError(message, isSuccess = false) {
    elements.error.textContent = message;
    elements.error.style.background = isSuccess ? 'var(--success)' : 'var(--error)';
    elements.error.classList.remove('hidden');
    setTimeout(() => {
        elements.error.classList.add('hidden');
    }, 5000);
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// API Functions
async function fetchAPI(endpoint) {
    try {
        const response = await fetch(`${API_BASE}${endpoint}`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error(`API Error (${endpoint}):`, error);
        throw error;
    }
}

async function postAPI(endpoint, data) {
    try {
        const response = await fetch(`${API_BASE}${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data),
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error(`API Error (${endpoint}):`, error);
        throw error;
    }
}

// Data Functions
async function loadStats() {
    try {
        const stats = await fetchAPI('/api/stats');
        
        // Update stats display
        elements.localCount.textContent = stats.local?.total_roms || 0;
        elements.rommCount.textContent = stats.romm?.total_platforms || 0;
        
        if (stats.local?.last_scan) {
            const date = new Date(stats.local.last_scan.scanned_at);
            elements.scanStatus.textContent = `Last scan: ${date.toLocaleString()}`;
        } else {
            elements.scanStatus.textContent = 'Not scanned yet';
        }
    } catch (error) {
        console.error('Failed to load stats:', error);
    }
}

async function loadPlatforms() {
    showLoading(true);
    try {
        platforms = await fetchAPI('/api/platforms');
        renderPlatforms();
        showView('platform');
    } catch (error) {
        showError('Failed to load platforms');
    } finally {
        showLoading(false);
    }
}

async function loadPlatformRoms(platformId, platformName) {
    showLoading(true);
    try {
        currentRoms = await fetchAPI(`/api/platforms/${platformId}/roms`);
        currentPlatform = { id: platformId, name: platformName };
        renderRoms();
        showView('rom');
        window.scrollTo(0, 0); // Scroll to top
    } catch (error) {
        showError('Failed to load ROMs');
    } finally {
        showLoading(false);
    }
}

async function loadRomDetails(romId) {
    // Find the ROM in current list
    currentRomIndex = currentRoms.findIndex(r => r.id === romId);
    if (currentRomIndex === -1) return;
    
    showLoading(true);
    try {
        const rom = await fetchAPI(`/api/roms/${romId}`);
        
        // Reset to Overview tab
        document.querySelectorAll('.detail-tab').forEach(tab => tab.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
        document.querySelector('.detail-tab[data-tab="overview"]').classList.add('active');
        document.getElementById('tab-overview').classList.add('active');
        
        renderRomDetails(rom);
        elements.detailModal.classList.remove('hidden');
    } catch (error) {
        showError('Failed to load ROM details');
    } finally {
        showLoading(false);
    }
}

function navigateDetail(direction) {
    const newIndex = currentRomIndex + direction;
    if (newIndex >= 0 && newIndex < currentRoms.length) {
        const rom = currentRoms[newIndex];
        loadRomDetails(rom.id);
    }
}

async function downloadRom(romId, platform) {
    const rom = currentRoms.find(r => r.id === romId);
    if (!rom) return;
    
    const fileName = rom.files && rom.files[0] ? rom.files[0].file_name : `ROM ${romId}`;
    
    // Add to queue
    const queueItem = {
        id: romId,
        name: fileName,
        status: 'queued',
        progress: 0
    };
    downloadQueue.push(queueItem);
    updateQueueUI();
    
    // Show queue panel
    elements.downloadQueuePanel.classList.remove('hidden');
    
    try {
        // Start download via API (server-side, no browser download)
        queueItem.status = 'downloading';
        updateQueueUI();
        
        const response = await fetch('/api/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                rom_id: romId,
                platform: platform
            })
        });
        
        if (!response.ok) {
            throw new Error(`Download failed: ${response.statusText}`);
        }
        
        const result = await response.json();
        
        // Mark as complete
        queueItem.status = 'completed';
        queueItem.progress = 100;
        updateQueueUI();
        
        // Auto-remove from queue after 3 seconds
        setTimeout(() => {
            const index = downloadQueue.findIndex(q => q.id === romId);
            if (index !== -1) {
                downloadQueue.splice(index, 1);
                updateQueueUI();
                
                // Hide panel if queue is empty
                if (downloadQueue.length === 0) {
                    elements.downloadQueuePanel.classList.add('hidden');
                    // Refresh the current view
                    refreshCurrentView();
                }
            }
        }, 3000);
        
    } catch (error) {
        console.error('Download error:', error);
        queueItem.status = 'error';
        queueItem.error = error.message;
        updateQueueUI();
    }
}

async function refreshCurrentView() {
    await loadStats();
    if (currentPlatform) {
        await loadPlatformRoms(currentPlatform.id, currentPlatform.name);
    }
}

function updateQueueUI() {
    if (downloadQueue.length === 0) {
        elements.queueList.innerHTML = '<div class="queue-empty">No active downloads</div>';
        return;
    }
    
    elements.queueList.innerHTML = downloadQueue.map(item => {
        const statusText = {
            'queued': 'Queued...',
            'downloading': 'Downloading...',
            'completed': '✓ Complete',
            'error': `✗ Error: ${item.error || 'Unknown'}`
        }[item.status];
        
        const statusClass = item.status;
        
        return `
            <div class="queue-item ${statusClass}">
                <div class="queue-item-name">${item.name}</div>
                <div class="queue-item-status">${statusText}</div>
                <div class="queue-item-progress">
                    <div class="queue-item-progress-fill" style="width: ${item.progress}%"></div>
                </div>
            </div>
        `;
    }).join('');
}

// Toggle queue panel
elements.toggleQueueBtn.addEventListener('click', () => {
    const content = document.getElementById('download-queue-content');
    const isCollapsed = content.classList.toggle('collapsed');
    elements.toggleQueueBtn.textContent = isCollapsed ? '+' : '−';
});

// Enhance sticky batch actions with scroll detection
let batchActionsBar = null;
window.addEventListener('scroll', () => {
    if (!batchActionsBar) {
        batchActionsBar = document.querySelector('#rom-view .actions');
    }
    
    if (batchActionsBar && !batchActionsBar.classList.contains('hidden')) {
        if (window.scrollY > 100) {
            batchActionsBar.classList.add('sticky-active');
        } else {
            batchActionsBar.classList.remove('sticky-active');
        }
    }
});

async function scanLocalRoms() {
    // Get all platform mappings from config
    try {
        showLoading(true);
        const config = await fetchAPI('/api/config');
        const platformsToScan = Object.values(config.platform_mapping);
        
        if (platformsToScan.length === 0) {
            showError('No platforms configured for scanning');
            return;
        }
        
        elements.scanModal.classList.remove('hidden');
        
        await postAPI('/api/scan', { platforms: platformsToScan });
        
        // Poll for scan completion
        const pollInterval = setInterval(async () => {
            try {
                const status = await fetchAPI('/api/scan/status');
                
                if (!status.in_progress) {
                    clearInterval(pollInterval);
                    elements.scanModal.classList.add('hidden');
                    await loadStats();
                    await loadPlatforms();
                    showError('✓ Scan completed successfully!', true);
                }
            } catch (error) {
                console.error('Error polling scan status:', error);
            }
        }, 2000);
        
    } catch (error) {
        showError('Failed to start scan');
    } finally {
        showLoading(false);
    }
}

// Render Functions
function renderPlatforms(searchTerm = '') {
    const filtered = platforms.filter(p => 
        p.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
    
    elements.platformList.innerHTML = filtered.map(platform => {
        const localStats = platform.local_stats || {};
        const count = localStats.file_count || 0;
        const badgeClass = count === 0 ? 'badge badge-empty' : 'badge';
        const badgeText = count === 0 ? '' : `${count} local`;
        
        return `
            <div class="platform-item" data-id="${platform.id}" data-name="${platform.name}">
                <span class="platform-name">${platform.name}</span>
                <div class="platform-stats">
                    ${badgeText ? `<span class="${badgeClass}">${badgeText}</span>` : ''}
                </div>
            </div>
        `;
    }).join('');
    
    // Add click handlers
    document.querySelectorAll('.platform-item').forEach(item => {
        item.addEventListener('click', () => {
            const id = parseInt(item.dataset.id);
            const name = item.dataset.name;
            loadPlatformRoms(id, name);
        });
    });
}

function renderRoms(searchTerm = '') {
    document.getElementById('platform-name').textContent = currentPlatform.name;
    
    // Filter ROMs
    let filtered = currentRoms.filter(rom => {
        const name = rom.name || rom.file_name || '';
        return name.toLowerCase().includes(searchTerm.toLowerCase());
    });
    
    // Apply status filter
    if (currentFilter === 'downloaded') {
        filtered = filtered.filter(rom => rom.local_available);
    } else if (currentFilter === 'available') {
        filtered = filtered.filter(rom => !rom.local_available);
    }
    
    document.getElementById('rom-count-badge').textContent = `${filtered.length} games`;
    
    elements.romList.innerHTML = filtered.map(rom => {
        const isLocal = rom.local_available;
        const status = isLocal ? '✅' : '○';
        const fileName = rom.files && rom.files[0] ? rom.files[0].file_name : 'No file';
        const fileSize = rom.files && rom.files[0] ? formatBytes(rom.files[0].file_size_bytes) : '';
        const downloadedClass = isLocal ? 'downloaded' : '';
        const isSelected = selectedRoms.has(rom.id);
        const checkboxHtml = multiSelectMode && !isLocal ? 
            `<input type="checkbox" class="rom-checkbox" data-rom-id="${rom.id}" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation()">` : '';
        
        return `
            <div class="rom-item ${downloadedClass}" data-id="${rom.id}">
                ${checkboxHtml}
                <div class="rom-info">
                    <span class="rom-status">${status}</span>
                    <div>
                        <div class="rom-name">${rom.name || fileName}</div>
                        <div class="rom-size">${fileName}</div>
                    </div>
                </div>
                <div class="rom-meta">
                    <span class="rom-size">${fileSize}</span>
                    ${!isLocal && !multiSelectMode ? `<button class="btn btn-small btn-download download-rom-btn" data-rom-id="${rom.id}" onclick="event.stopPropagation()">⬇</button>` : ''}
                </div>
            </div>
        `;
    }).join('');
    
    // Add click handlers for ROM items (only if not in multi-select)
    if (!multiSelectMode) {
        document.querySelectorAll('.rom-item').forEach(item => {
            item.addEventListener('click', () => {
                const id = parseInt(item.dataset.id);
                loadRomDetails(id);
            });
        });
    }
    
    // Add click handlers for download buttons
    document.querySelectorAll('.download-rom-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const romId = parseInt(btn.dataset.romId);
            
            const config = await fetchAPI('/api/config');
            const platformFolder = config.platform_mapping[currentPlatform.name];
            
            if (platformFolder) {
                btn.disabled = true;
                btn.textContent = '⏳';
                await downloadRom(romId, platformFolder);
            } else {
                showError(`Platform "${currentPlatform.name}" not configured`);
            }
        });
    });
    
    // Add checkbox handlers
    document.querySelectorAll('.rom-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const romId = parseInt(checkbox.dataset.romId);
            if (checkbox.checked) {
                selectedRoms.add(romId);
            } else {
                selectedRoms.delete(romId);
            }
            updateSelectedCount();
        });
    });
}

function updateSelectedCount() {
    elements.selectedCount.textContent = `${selectedRoms.size} selected`;
}

async function renderRomDetails(rom) {
    // Fetch config for ROMM base URL
    const config = await fetchAPI('/api/config');
    const rommBaseUrl = config.romm_url; // Fixed: use romm_url not romm.url
    
    // Update header
    elements.detailPosition.textContent = `${currentRomIndex + 1}/${currentRoms.length}`;
    elements.detailPrevBtn.disabled = currentRomIndex === 0;
    elements.detailNextBtn.disabled = currentRomIndex === currentRoms.length - 1;
    
    // Title and subtitle
    document.getElementById('detail-title').textContent = rom.name || 'Unknown Game';
    const platform = rom.platform_display_name || currentPlatform?.name || 'Unknown';
    const year = rom.metadatum?.first_release_date ? new Date(rom.metadatum.first_release_date).getFullYear() : '';
    document.getElementById('detail-subtitle').textContent = year ? `${platform} • ${year}` : platform;
    
    // Download button / status
    const isLocal = rom.local_available;
    const downloadBtn = document.getElementById('detail-download-btn');
    const downloadedBadge = document.getElementById('detail-downloaded-badge');
    
    if (isLocal) {
        downloadBtn.classList.add('hidden');
        downloadedBadge.classList.remove('hidden');
    } else {
        downloadBtn.classList.remove('hidden');
        downloadedBadge.classList.add('hidden');
        
        downloadBtn.onclick = async () => {
            const platformFolder = config.platform_mapping[currentPlatform.name];
            
            if (platformFolder) {
                await downloadRom(rom.id, platformFolder);
                setTimeout(() => loadRomDetails(rom.id), 3500);
            } else {
                showError(`Platform "${currentPlatform.name}" not configured`);
            }
        };
    }
    
    // === OVERVIEW TAB ===
    // Cover art
    const coverImg = document.getElementById('detail-cover-img');
    if (rom.url_cover) {
        // Check if it's a relative path or full URL
        const coverUrl = rom.url_cover.startsWith('http') ? rom.url_cover : 
                        rom.url_cover.startsWith('/') ? rommBaseUrl + rom.url_cover : rom.url_cover;
        coverImg.src = coverUrl;
        coverImg.alt = rom.name;
    } else {
        coverImg.src = '/static/placeholder.png';
        coverImg.alt = 'No cover';
    }
    
    // Rating - gold stars only, no number
    const ratingEl = document.getElementById('detail-rating');
    const rating = rom.metadatum?.average_rating || rom.igdb_metadata?.total_rating;
    if (rating) {
        const stars = Math.round(rating / 20);
        const starsFilled = '<span style="color: #FFD700;">★</span>'.repeat(stars);
        const starsEmpty = '<span style="color: #4a4a4a;">★</span>'.repeat(5 - stars);
        ratingEl.innerHTML = starsFilled + starsEmpty;
    } else {
        ratingEl.innerHTML = '<span style="color: #4a4a4a;">★★★★★</span>';
    }
    
    // Meta chips - limit genres to first 3
    const allGenres = rom.metadatum?.genres || [];
    const genres = allGenres.slice(0, 3).join(', ') + (allGenres.length > 3 ? '...' : '');
    const developer = rom.igdb_metadata?.companies?.[0] || rom.metadatum?.companies?.[0] || 'Unknown';
    document.getElementById('detail-genres').textContent = genres || 'Unknown';
    document.getElementById('detail-year').textContent = year || 'Unknown Year';
    document.getElementById('detail-developer').textContent = developer;
    
    // Description
    const descEl = document.getElementById('detail-description-text');
    if (rom.summary) {
        descEl.textContent = rom.summary;
        descEl.style.fontStyle = 'normal';
        descEl.style.color = 'var(--text-primary)';
    } else {
        descEl.textContent = 'No description available.';
        descEl.style.fontStyle = 'italic';
        descEl.style.color = 'var(--text-secondary)';
    }
    
    // === MEDIA TAB ===
    // Screenshots + YouTube as first item - prepend ROMM base URL to relative paths
    console.log('ROMM Base URL:', rommBaseUrl);
    console.log('Raw screenshots:', rom.merged_screenshots);
    
    currentScreenshots = (rom.merged_screenshots || []).map(path => {
        if (path && path.startsWith('/')) {
            const fullUrl = rommBaseUrl + path;
            console.log('Converted:', path, '→', fullUrl);
            return fullUrl;
        }
        return path;
    });
    
    // Add YouTube as first item if available
    if (rom.youtube_video_id) {
        currentScreenshots.unshift({
            type: 'video',
            videoId: rom.youtube_video_id,
            thumbnail: `https://img.youtube.com/vi/${rom.youtube_video_id}/maxresdefault.jpg`
        });
    }
    
    console.log('Final screenshots array:', currentScreenshots);
    currentScreenshotIndex = 0;
    
    const mainScreenshot = document.getElementById('detail-main-screenshot');
    const mediaPrevBtn = document.getElementById('media-prev-btn');
    const mediaNextBtn = document.getElementById('media-next-btn');
    const mediaPosition = document.getElementById('media-position');
    
    function updateMediaView() {
        const playOverlay = document.getElementById('play-overlay');
        
        if (currentScreenshots.length > 0) {
            const current = currentScreenshots[currentScreenshotIndex];
            
            // Check if it's a video item
            if (typeof current === 'object' && current.type === 'video') {
                // Show YouTube thumbnail with play button overlay
                mainScreenshot.src = current.thumbnail;
                mainScreenshot.alt = 'Click to play video';
                mainScreenshot.style.cursor = 'pointer';
                playOverlay.classList.remove('hidden');
                mainScreenshot.onclick = () => {
                    const youtubeModal = document.getElementById('youtube-modal');
                    const iframe = document.getElementById('youtube-iframe');
                    iframe.src = `https://www.youtube.com/embed/${current.videoId}?autoplay=1&rel=0`;
                    youtubeModal.classList.remove('hidden');
                };
                
                mediaPosition.textContent = `🎬 / ${currentScreenshots.length}`;
            } else {
                // Regular screenshot
                mainScreenshot.src = current;
                mainScreenshot.alt = `${rom.name} screenshot ${currentScreenshotIndex + 1}`;
                mainScreenshot.style.cursor = 'default';
                mainScreenshot.onclick = null;
                playOverlay.classList.add('hidden');
                mediaPosition.textContent = `${currentScreenshotIndex + 1} / ${currentScreenshots.length}`;
            }
        } else if (rom.url_cover) {
            const coverUrl = rom.url_cover.startsWith('http') ? rom.url_cover : 
                            rom.url_cover.startsWith('/') ? rommBaseUrl + rom.url_cover : rom.url_cover;
            mainScreenshot.src = coverUrl;
            mainScreenshot.alt = rom.name;
            mainScreenshot.style.cursor = 'default';
            mainScreenshot.onclick = null;
            playOverlay.classList.add('hidden');
            mediaPosition.textContent = '1 / 1';
        } else {
            mainScreenshot.src = '/static/placeholder.png';
            mainScreenshot.alt = 'No image';
            mainScreenshot.style.cursor = 'default';
            mainScreenshot.onclick = null;
            playOverlay.classList.add('hidden');
            mediaPosition.textContent = '0 / 0';
        }
    }
    
    updateMediaView();
    
    // Set up navigation handlers
    const newPrevBtn = mediaPrevBtn.cloneNode(true);
    const newNextBtn = mediaNextBtn.cloneNode(true);
    mediaPrevBtn.parentNode.replaceChild(newPrevBtn, mediaPrevBtn);
    mediaNextBtn.parentNode.replaceChild(newNextBtn, mediaNextBtn);
    
    document.getElementById('media-prev-btn').addEventListener('click', () => {
        if (currentScreenshotIndex > 0) {
            currentScreenshotIndex--;
        } else {
            currentScreenshotIndex = currentScreenshots.length - 1;
        }
        updateMediaView();
    });
    
    document.getElementById('media-next-btn').addEventListener('click', () => {
        if (currentScreenshotIndex < currentScreenshots.length - 1) {
            currentScreenshotIndex++;
        } else {
            currentScreenshotIndex = 0;
        }
        updateMediaView();
    });
    
    // === DETAILS TAB ===
    const fileInfo = rom.files && rom.files[0] ? rom.files[0] : null;
    const detailsGrid = document.getElementById('details-grid-content');
    
    detailsGrid.innerHTML = `
        <div class="detail-section">
            <h3>File Information</h3>
            <div class="detail-row"><span class="label">File Name:</span><span class="value">${fileInfo ? fileInfo.file_name : 'N/A'}</span></div>
            <div class="detail-row"><span class="label">Size:</span><span class="value">${fileInfo ? formatBytes(fileInfo.file_size_bytes) : 'N/A'}</span></div>
            <div class="detail-row"><span class="label">Format:</span><span class="value">${rom.fs_extension || 'N/A'}</span></div>
            <div class="detail-row"><span class="label">Status:</span><span class="value" style="color: ${isLocal ? 'var(--success)' : 'var(--warning)'}">${isLocal ? 'Downloaded' : 'Available'}</span></div>
        </div>
        
        <div class="detail-section">
            <h3>Game Information</h3>
            <div class="detail-row"><span class="label">Platform:</span><span class="value">${platform}</span></div>
            <div class="detail-row"><span class="label">Region:</span><span class="value">${rom.regions?.join(', ') || 'Unknown'}</span></div>
            <div class="detail-row"><span class="label">Languages:</span><span class="value">${rom.languages?.join(', ') || 'Unknown'}</span></div>
            <div class="detail-row"><span class="label">Revision:</span><span class="value">${rom.revision || 'N/A'}</span></div>
        </div>
        
        <div class="detail-section">
            <h3>Metadata</h3>
            <div class="detail-row"><span class="label">IGDB ID:</span><span class="value">${rom.igdb_id || 'N/A'}</span></div>
            <div class="detail-row"><span class="label">Franchises:</span><span class="value">${rom.metadatum?.franchises?.join(', ') || 'N/A'}</span></div>
            <div class="detail-row"><span class="label">Game Modes:</span><span class="value">${rom.metadatum?.game_modes?.join(', ') || 'N/A'}</span></div>
            <div class="detail-row"><span class="label">Player Count:</span><span class="value">${rom.metadatum?.player_count || 'N/A'}</span></div>
        </div>
        
        <div class="detail-section">
            <h3>How Long to Beat</h3>
            ${rom.hltb_metadata ? `
                <div class="detail-row"><span class="label">Main Story:</span><span class="value">${formatTime(rom.hltb_metadata.main_story)}</span></div>
                <div class="detail-row"><span class="label">Main + Extra:</span><span class="value">${formatTime(rom.hltb_metadata.main_plus_extra)}</span></div>
                <div class="detail-row"><span class="label">Completionist:</span><span class="value">${formatTime(rom.hltb_metadata.completionist)}</span></div>
                <div class="detail-row"><span class="label">Completions:</span><span class="value">${rom.hltb_metadata.completions || 'N/A'}</span></div>
            ` : '<div style="color: var(--text-secondary); font-size: 0.875rem;">No HLTB data</div>'}
        </div>
    `;
    
    // === SIMILAR GAMES TAB ===
    const similarGrid = document.getElementById('similar-games-grid');
    const similarGames = rom.igdb_metadata?.similar_games || [];
    
    if (similarGames.length > 0) {
        similarGrid.innerHTML = similarGames.slice(0, 12).map(game => `
            <div class="similar-game-card">
                <img src="${game.cover_url || '/static/placeholder.png'}" alt="${game.name}">
                <div class="game-name">${game.name}</div>
            </div>
        `).join('');
    } else {
        similarGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: var(--text-secondary); padding: 2rem;">No similar games data</div>';
    }
    
    // === STATS TAB ===
    const statsContent = document.getElementById('stats-content');
    const igdbMeta = rom.igdb_metadata || {};
    const ssMeta = rom.ss_metadata || {};
    
    statsContent.innerHTML = `
        <div class="stat-box">
            <h3>IGDB Rating</h3>
            <div class="stat-value-large">${igdbMeta.total_rating ? (parseFloat(igdbMeta.total_rating).toFixed(1)) : 'N/A'}</div>
            <div class="stat-label">Critic Score</div>
        </div>
        
        <div class="stat-box">
            <h3>Aggregated Rating</h3>
            <div class="stat-value-large">${igdbMeta.aggregated_rating ? (parseFloat(igdbMeta.aggregated_rating).toFixed(1)) : 'N/A'}</div>
            <div class="stat-label">User Score</div>
        </div>
        
        <div class="stat-box">
            <h3>ScreenScraper</h3>
            <div class="stat-value-large">${ssMeta.ss_score || 'N/A'}</div>
            <div class="stat-label">SS Score</div>
        </div>
        
        ${rom.hltb_metadata ? `
            <div class="stat-box">
                <h3>HLTB Popularity</h3>
                <div class="stat-value-large">#${rom.hltb_metadata.popularity || 'N/A'}</div>
                <div class="stat-label">Rank</div>
            </div>
            
            <div class="stat-box">
                <h3>Review Score</h3>
                <div class="stat-value-large">${rom.hltb_metadata.review_score || 'N/A'}</div>
                <div class="stat-label">User Reviews</div>
            </div>
            
            <div class="stat-box">
                <h3>Review Count</h3>
                <div class="stat-value-large">${rom.hltb_metadata.review_count || 'N/A'}</div>
                <div class="stat-label">Total Reviews</div>
            </div>
        ` : ''}
    `;
}

function formatTime(seconds) {
    if (!seconds) return 'N/A';
    const hours = Math.floor(seconds / 3600);
    return `${hours}h`;
}

// YouTube modal handlers
document.addEventListener('DOMContentLoaded', () => {
    const youtubeCloseBtn = document.getElementById('youtube-close-btn');
    const youtubeModal = document.getElementById('youtube-modal');
    
    if (youtubeCloseBtn) {
        youtubeCloseBtn.addEventListener('click', () => {
            youtubeModal.classList.add('hidden');
            document.getElementById('youtube-iframe').src = ''; // Stop video
        });
    }
    
    // Close on click outside
    if (youtubeModal) {
        youtubeModal.addEventListener('click', (e) => {
            if (e.target === youtubeModal) {
                youtubeModal.classList.add('hidden');
                document.getElementById('youtube-iframe').src = '';
            }
        });
    }
});

// View Management
// Event Listeners
elements.scanBtn.addEventListener('click', scanLocalRoms);
elements.refreshBtn.addEventListener('click', () => {
    loadStats();
    loadPlatforms();
});

elements.backBtn.addEventListener('click', () => {
    showView('platform');
});

elements.platformSearch.addEventListener('input', (e) => {
    renderPlatforms(e.target.value);
});

elements.romSearch.addEventListener('input', (e) => {
    renderRoms(e.target.value);
});

// Filter tabs
document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentFilter = tab.dataset.filter;
        renderRoms();
    });
});

// Multi-select handlers
elements.multiSelectBtn.addEventListener('click', () => {
    multiSelectMode = true;
    selectedRoms.clear();
    updateSelectedCount(); // Initialize count display
    elements.multiSelectBtn.classList.add('hidden');
    elements.batchActions.classList.remove('hidden');
    renderRoms();
});

elements.cancelSelectBtn.addEventListener('click', () => {
    multiSelectMode = false;
    selectedRoms.clear();
    elements.multiSelectBtn.classList.remove('hidden');
    elements.batchActions.classList.add('hidden');
    renderRoms();
});

elements.downloadSelectedBtn.addEventListener('click', async () => {
    if (selectedRoms.size === 0) {
        showError('No ROMs selected');
        return;
    }
    
    const config = await fetchAPI('/api/config');
    const platformFolder = config.platform_mapping[currentPlatform.name];
    
    if (!platformFolder) {
        showError(`Platform "${currentPlatform.name}" not configured`);
        return;
    }
    
    // Calculate total size
    const selectedRomsList = currentRoms.filter(r => selectedRoms.has(r.id));
    const totalSize = selectedRomsList.reduce((sum, rom) => {
        return sum + (rom.files && rom.files[0] ? rom.files[0].file_size_bytes : 0);
    }, 0);
    
    const confirmed = await showConfirm(
        `Download ${selectedRoms.size} ROMs?`,
        `<strong>Total size:</strong> ${formatBytes(totalSize)}<br><br>Downloads will queue in the background.`
    );
    
    if (!confirmed) return;
    
    // Queue all downloads
    for (const romId of selectedRoms) {
        await downloadRom(romId, platformFolder);
        // Small delay between queueing
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    showError(`✓ Queued ${selectedRoms.size} downloads`, true);
    
    // Exit multi-select mode
    multiSelectMode = false;
    selectedRoms.clear();
    elements.multiSelectBtn.classList.remove('hidden');
    elements.batchActions.classList.add('hidden');
    renderRoms();
});

elements.downloadAllMissingBtn.addEventListener('click', async () => {
    const missingRoms = currentRoms.filter(r => !r.local_available);
    
    if (missingRoms.length === 0) {
        showError('All ROMs already downloaded!', true);
        return;
    }
    
    const config = await fetchAPI('/api/config');
    const platformFolder = config.platform_mapping[currentPlatform.name];
    
    if (!platformFolder) {
        showError(`Platform "${currentPlatform.name}" not configured`);
        return;
    }
    
    const totalSize = missingRoms.reduce((sum, rom) => {
        return sum + (rom.files && rom.files[0] ? rom.files[0].file_size_bytes : 0);
    }, 0);
    
    const confirmed = await showConfirm(
        `Download ALL ${missingRoms.length} missing ROMs?`,
        `<strong>Total size:</strong> ${formatBytes(totalSize)}<br><br>Downloads will queue in the background.`
    );
    
    if (!confirmed) return;
    
    // Queue all downloads
    for (const rom of missingRoms) {
        await downloadRom(rom.id, platformFolder);
        // Small delay between queueing
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    showError(`✓ Queued ${missingRoms.length} downloads`, true);
    
    // Exit multi-select mode
    multiSelectMode = false;
    selectedRoms.clear();
    elements.multiSelectBtn.classList.remove('hidden');
    elements.batchActions.classList.add('hidden');
    renderRoms();
});

// Tab switching
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('detail-tab')) {
        const tabName = e.target.dataset.tab;
        
        // Update active tab
        document.querySelectorAll('.detail-tab').forEach(tab => tab.classList.remove('active'));
        e.target.classList.add('active');
        
        // Update active content
        document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
        document.getElementById(`tab-${tabName}`).classList.add('active');
    }
});

// Detail modal navigation
elements.detailPrevBtn.addEventListener('click', () => navigateDetail(-1));
elements.detailNextBtn.addEventListener('click', () => navigateDetail(1));
elements.detailCloseBtn.addEventListener('click', () => {
    elements.detailModal.classList.add('hidden');
});

// Keyboard navigation for detail modal
document.addEventListener('keydown', (e) => {
    // Only handle if detail modal is open
    if (!elements.detailModal.classList.contains('hidden')) {
        if (e.key === 'ArrowLeft') {
            e.preventDefault();
            navigateDetail(-1);
        } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            navigateDetail(1);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            elements.detailModal.classList.add('hidden');
        }
    }
});

// Click outside modal to close
elements.detailModal.addEventListener('click', (e) => {
    if (e.target === elements.detailModal) {
        elements.detailModal.classList.add('hidden');
    }
});

// Settings page
elements.settingsBtn = document.getElementById('settings-btn');
elements.settingsBackBtn = document.getElementById('settings-back-btn');
elements.settingsView = document.getElementById('settings-view');
elements.genMappingsBtn = document.getElementById('gen-mappings-btn');
elements.saveConfigBtn = document.getElementById('save-config-btn');

elements.settingsBtn.addEventListener('click', async () => {
    showLoading(true);
    const config = await fetchAPI('/api/config');
    
    document.getElementById('set-romm-url').value = config.romm_url || '';
    document.getElementById('set-romm-user').value = config.romm_username || '';
    document.getElementById('set-retrodeck-path').value = config.retrodeck_path || '';
    
    renderMappings(config.platform_mapping || {});
    showView('settings');
    showLoading(false);
});

elements.settingsBackBtn.addEventListener('click', () => {
    showView('platform');
});

elements.genMappingsBtn.addEventListener('click', async () => {
    showLoading(true);
    try {
        const response = await fetch('/generate_mappings', { method: 'POST' });
        const mappings = await response.json();
        renderMappings(mappings);
        showError('✓ Platform mappings generated!', true);
    } catch (error) {
        showError('Failed to generate mappings');
    } finally {
        showLoading(false);
    }
});

elements.saveConfigBtn.addEventListener('click', async () => {
    showLoading(true);
    try {
        const mappings = {};
        document.querySelectorAll('.mapping-item').forEach(item => {
            const rommName = item.dataset.romm;
            const retrodeckFolder = item.querySelector('input').value;
            if (retrodeckFolder) mappings[rommName] = retrodeckFolder;
        });
        
        const config = {
            romm_url: document.getElementById('set-romm-url').value,
            romm_username: document.getElementById('set-romm-user').value,
            romm_password: document.getElementById('set-romm-pass').value,
            retrodeck_path: document.getElementById('set-retrodeck-path').value,
            platform_mapping: mappings
        };
        
        await postAPI('/api/config', config);
        showError('✓ Configuration saved!', true);
        
        setTimeout(() => {
            showView('platform');
            loadPlatforms();
        }, 1000);
    } catch (error) {
        showError('Failed to save configuration');
    } finally {
        showLoading(false);
    }
});

function renderMappings(mappings) {
    const container = document.getElementById('mappings-container');
    container.innerHTML = Object.entries(mappings).map(([rommName, folder]) => `
        <div class="mapping-item" data-romm="${rommName}">
            <span class="label">${rommName}:</span>
            <input type="text" value="${folder}" placeholder="retrodeck folder">
        </div>
    `).join('');
}

function showView(view) {
    const platformView = document.getElementById('platform-view');
    const romView = document.getElementById('rom-view');
    const settingsView = document.getElementById('settings-view');
    
    platformView.classList.add('hidden');
    romView.classList.add('hidden');
    settingsView.classList.add('hidden');
    
    if (view === 'platform') platformView.classList.remove('hidden');
    else if (view === 'rom') romView.classList.remove('hidden');
    else if (view === 'settings') settingsView.classList.remove('hidden');
    
    currentView = view;
}

// Initialize
async function init() {
    await loadStats();
    await loadPlatforms();
}

init();
